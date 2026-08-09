// "Spheres" — glossy orbs riding a volumetric flow (GhostFX scene).
//
// The look: a milky, softly-lit fluid mass (billboard puff volume) with
// hundreds of glossy pastel spheres swirling through and around it in
// true 3D — perspective camera, per-primitive depth of field, fog, and
// a photographic light-gray backdrop.
//
// Shares the GhostFX 112-byte uniform layout (drift/ribbons family).
// Scene-specific controls ride the generic param slots:
//   slot16 flowSpeed · slot17 sphereSize · slot18 puffDensity · slot19 palette

const SPHERES_HEADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  dt: f32,
  bassSlow: f32, midSlow: f32, trebSlow: f32,
  bassFast: f32, midFast: f32, trebFast: f32,
  energy: f32,
  beatPhase: f32,
  beatPulse: f32,
  amp: f32,
  hueShift: f32,
  exposure: f32,
  flowSpeed: f32,     // slot16
  sphereSize: f32,    // slot17
  puffDensity: f32,   // slot18
  paletteSel: f32,    // slot19
  lightDirAndStrength: vec4<f32>,
  ambient: f32,
  drive: f32,
  bgAlpha: f32,
  extra: f32,
};

struct Particle {
  pos: vec3<f32>,
  size: f32,
  vel: vec3<f32>,
  seed: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

const TAU: f32 = 6.28318530718;
const SPHERE_COUNT: u32 = ${'$'}{SPHERE_COUNT}u;
const PUFF_COUNT: u32 = ${'$'}{PUFF_COUNT}u;
const TOTAL_COUNT: u32 = ${'$'}{TOTAL_COUNT}u;
const CAM_DIST: f32 = 2.35;

fn hash11(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn hash31(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}
fn vnoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i);
  let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, s.x), mix(n010, n110, s.x), s.y),
    mix(mix(n001, n101, s.x), mix(n011, n111, s.x), s.y),
    s.z,
  );
}
fn potential(p: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    vnoise(p + vec3<f32>(31.4, 0.0, 0.0)),
    vnoise(p + vec3<f32>(0.0, 47.2, 0.0)),
    vnoise(p + vec3<f32>(0.0, 0.0, 12.9)),
  );
}
fn curl(p: vec3<f32>) -> vec3<f32> {
  let e = 0.11;
  let dy_dz = potential(p + vec3<f32>(0.0, e, 0.0)).z - potential(p - vec3<f32>(0.0, e, 0.0)).z;
  let dz_dy = potential(p + vec3<f32>(0.0, 0.0, e)).y - potential(p - vec3<f32>(0.0, 0.0, e)).y;
  let dz_dx = potential(p + vec3<f32>(e, 0.0, 0.0)).z - potential(p - vec3<f32>(e, 0.0, 0.0)).z;
  let dx_dz = potential(p + vec3<f32>(0.0, 0.0, e)).x - potential(p - vec3<f32>(0.0, 0.0, e)).x;
  let dx_dy = potential(p + vec3<f32>(0.0, e, 0.0)).x - potential(p - vec3<f32>(0.0, e, 0.0)).x;
  let dy_dx = potential(p + vec3<f32>(e, 0.0, 0.0)).y - potential(p - vec3<f32>(e, 0.0, 0.0)).y;
  return vec3<f32>(dy_dz - dz_dy, dz_dx - dx_dz, dx_dy - dy_dx) / (2.0 * e);
}

fn cameraPos() -> vec3<f32> {
  let a = u.time * 0.05;
  return vec3<f32>(sin(a) * 0.35, 0.12, -CAM_DIST + cos(a * 0.8) * 0.15);
}

struct Projected { clip: vec2<f32>, depth: f32, scale: f32 };
fn project(worldPos: vec3<f32>) -> Projected {
  let cam = cameraPos();
  let fwd = normalize(vec3<f32>(-cam.x * 0.25, -cam.y * 0.4, 1.0));
  let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), fwd));
  let upV = cross(fwd, right);
  let rel = worldPos - cam;
  let vz = dot(rel, fwd);
  var out: Projected;
  if (vz <= 0.08) {
    out.clip = vec2<f32>(4.0);
    out.depth = -1.0;
    out.scale = 0.0;
    return out;
  }
  let focal = 1.45;
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  out.clip = vec2<f32>(dot(rel, right) / vz * focal / aspect, dot(rel, upV) / vz * focal);
  out.depth = vz;
  out.scale = focal / vz;
  return out;
}

// Per-primitive depth of field: distance from the focus plane widens
// billboards and fades their energy — the cheap path to the shallow
// photographic depth in the reference.
fn dofBlur(depth: f32) -> f32 {
  let focus = CAM_DIST * 0.92;
  return clamp(abs(depth - focus) / 1.6, 0.0, 1.0);
}
fn fogAmount(depth: f32) -> f32 {
  return clamp(1.0 - exp(-max(depth - CAM_DIST * 0.55, 0.0) * 0.5), 0.0, 0.8);
}
fn bgColorAt(y: f32) -> vec3<f32> {
  // Steel-blue studio backdrop, brighter up top, floor shadowing below.
  return mix(vec3<f32>(0.42, 0.47, 0.54), vec3<f32>(0.66, 0.71, 0.77), clamp(y, 0.0, 1.0));
}
fn paletteColor(seed: f32) -> vec3<f32> {
  let sel = i32(u.paletteSel + 0.5);
  let pick = hash11(seed * 17.3);
  if (sel == 1) { // Candy
    if (pick < 0.4) { return vec3<f32>(0.95, 0.42, 0.56); }
    if (pick < 0.75) { return vec3<f32>(0.42, 0.72, 0.98); }
    return vec3<f32>(0.99, 0.83, 0.36);
  }
  if (sel == 2) { // Ember (mono-warm)
    if (pick < 0.5) { return vec3<f32>(0.88, 0.86, 0.84); }
    if (pick < 0.8) { return vec3<f32>(0.72, 0.44, 0.30); }
    return vec3<f32>(0.94, 0.66, 0.25);
  }
  // Pastel (reference): milky aqua, blush copper, amber accents.
  if (pick < 0.55) { return vec3<f32>(0.63, 0.86, 0.87); }
  if (pick < 0.85) { return vec3<f32>(0.83, 0.60, 0.48); }
  return vec3<f32>(0.93, 0.72, 0.30);
}
`;

const COMPUTE_BODY = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn csFlow(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= TOTAL_COUNT) { return; }
  var p = particles[gid.x];
  let isPuff = gid.x >= SPHERE_COUNT;
  let seedBase = f32(gid.x) * 0.61803 + 0.137;

  // First-frame init: zeroed buffer → scatter into a shell.
  if (p.seed <= 0.0) {
    let a = hash11(seedBase) * TAU;
    let b = hash11(seedBase + 7.7) * 2.0 - 1.0;
    let r = select(0.30 + hash11(seedBase + 3.1) * 0.55, 0.10 + hash11(seedBase + 3.1) * 0.35, isPuff);
    let ring = sqrt(max(1.0 - b * b, 0.0));
    p.pos = vec3<f32>(cos(a) * ring, b, sin(a) * ring) * r;
    p.vel = vec3<f32>(0.0);
    p.seed = 0.05 + hash11(seedBase + 11.3);
    let sizeRnd = hash11(seedBase + 23.9);
    if (isPuff) {
      p.size = 0.24 + sizeRnd * 0.22;
    } else {
      // Few large hero spheres, many small ones.
      p.size = (0.016 + pow(sizeRnd, 2.6) * 0.085);
    }
  }

  let flow = u.flowSpeed * (0.55 + u.energy * 0.75);
  let t = u.time * 0.16;
  let noiseScale = select(1.7, 1.1, isPuff);
  var force = curl(p.pos * noiseScale + vec3<f32>(0.0, t, 0.0)) * flow * select(0.85, 0.45, isPuff);

  // Central updraft column + gentle swirl — the reference's rising plume.
  let radial = vec3<f32>(p.pos.x, 0.0, p.pos.z);
  let swirl = normalize(vec3<f32>(-p.pos.z, 0.0, p.pos.x) + vec3<f32>(1e-4)) * 0.35 * flow;
  force = force + swirl + vec3<f32>(0.0, 0.22 * flow + u.beatPulse * 0.55, 0.0);
  // Soft containment: pull back toward the plume axis + vertical wrap.
  force = force - radial * 0.55 * max(length(radial) - 0.55, 0.0) * 4.0;

  p.vel = (p.vel + force * u.dt) * select(0.94, 0.90, isPuff);
  p.pos = p.pos + p.vel * u.dt;
  if (p.pos.y > 1.15) { p.pos.y = -1.05; p.vel.y = 0.0; }
  if (p.pos.y < -1.25) { p.pos.y = -1.05; }

  particles[gid.x] = p;
}
`;

const RENDER_BODY = /* wgsl */ `
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

// ── Background ──────────────────────────────────────────────────────
struct VsBg { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsBg(@builtin(vertex_index) vid: u32) -> VsBg {
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  var out: VsBg;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}
@fragment fn fsBg(in: VsBg) -> @location(0) vec4<f32> {
  var col = bgColorAt(1.0 - in.uv.y);
  // Soft corner vignette keeps the frame photographic.
  let d = distance(in.uv, vec2<f32>(0.5, 0.45));
  col = col * (1.0 - smoothstep(0.45, 0.95, d) * 0.35);
  return vec4<f32>(col * u.bgAlpha, u.bgAlpha);
}

// ── Volumetric puffs (the milky fluid mass) ─────────────────────────
struct VsP {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) seed: f32,
  @location(2) @interpolate(flat) shade: vec3<f32>,
  @location(3) @interpolate(flat) alpha: f32,
};
@vertex fn vsPuff(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VsP {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let p = particles[SPHERE_COUNT + iid];
  let proj = project(p.pos);
  var out: VsP;
  if (proj.depth < 0.0 || u.puffDensity <= 0.01) {
    out.pos = vec4<f32>(4.0, 4.0, 0.0, 1.0);
    out.local = vec2<f32>(0.0);
    out.seed = 0.0;
    out.shade = vec3<f32>(0.0);
    out.alpha = 0.0;
    return out;
  }
  let blur = dofBlur(proj.depth);
  let size = p.size * (1.0 + blur * 1.4);
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  let corner = corners[vid];
  out.pos = vec4<f32>(
    proj.clip.x + corner.x * size * proj.scale / aspect,
    proj.clip.y + corner.y * size * proj.scale,
    0.0, 1.0,
  );
  out.local = corner;
  out.seed = p.seed;
  // Milk body lit from the key: white top, cool occluded base + fog.
  let l = normalize(u.lightDirAndStrength.xyz);
  let topLight = clamp(dot(vec3<f32>(0.0, 1.0, 0.0), l) * 0.5 + 0.6, 0.0, 1.2);
  var shade = mix(vec3<f32>(0.72, 0.74, 0.78), vec3<f32>(0.97, 0.965, 0.955), topLight)
    * (u.ambient + u.lightDirAndStrength.w * 0.8);
  shade = mix(shade, bgColorAt(0.6), fogAmount(proj.depth));
  out.shade = shade;
  out.alpha = 0.20 * u.puffDensity / (1.0 + blur * 1.6);
  return out;
}
@fragment fn fsPuff(in: VsP) -> @location(0) vec4<f32> {
  let r2 = dot(in.local, in.local);
  if (r2 > 1.0 || in.alpha <= 0.001) { discard; }
  // Two-octave animated noise breaks the disc into curds of "liquid".
  let n = vnoise(vec3<f32>(in.local * 2.4, in.seed * 40.0 + u.time * 0.25))
    * 0.65 + vnoise(vec3<f32>(in.local * 5.1, in.seed * 90.0 - u.time * 0.18)) * 0.35;
  let body = smoothstep(0.25, 0.75, n) * (1.0 - smoothstep(0.45, 1.0, r2));
  let a = body * in.alpha;
  return vec4<f32>(in.shade * a, a);
}

// ── Glossy spheres ──────────────────────────────────────────────────
struct VsS {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) tint: vec3<f32>,
  @location(2) @interpolate(flat) fxv: vec3<f32>, // x fog, y blur, z fade
};
@vertex fn vsSphere(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VsS {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let p = particles[iid];
  let proj = project(p.pos);
  var out: VsS;
  if (proj.depth < 0.0) {
    out.pos = vec4<f32>(4.0, 4.0, 0.0, 1.0);
    out.local = vec2<f32>(0.0);
    out.tint = vec3<f32>(0.0);
    out.fxv = vec3<f32>(0.0);
    return out;
  }
  let blur = dofBlur(proj.depth);
  let size = p.size * u.sphereSize * (1.0 + blur * 2.2);
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  let corner = corners[vid];
  out.pos = vec4<f32>(
    proj.clip.x + corner.x * size * proj.scale / aspect,
    proj.clip.y + corner.y * size * proj.scale,
    0.0, 1.0,
  );
  out.local = corner;
  out.tint = paletteColor(p.seed);
  out.fxv = vec3<f32>(fogAmount(proj.depth), blur, 1.0 / (1.0 + blur * 2.0));
  return out;
}
@fragment fn fsSphere(in: VsS) -> @location(0) vec4<f32> {
  let r2 = dot(in.local, in.local);
  if (r2 > 1.0) { discard; }
  let nz = sqrt(max(1.0 - r2, 0.0));
  let n = normalize(vec3<f32>(in.local.x, -in.local.y, nz));
  let l = normalize(u.lightDirAndStrength.xyz);
  let strength = u.lightDirAndStrength.w;
  let v = vec3<f32>(0.0, 0.0, 1.0);
  let hVec = normalize(l + v);

  let diff = max(dot(n, l), 0.0);
  let spec = pow(max(dot(n, hVec), 0.0), 140.0) * 2.0;
  let fres = pow(1.0 - nz, 2.6);

  // Studio shading: tinted body, sky-lit rim from the backdrop, hot key
  // specular. Soft bottom-bounce keeps shadows from going black.
  let sky = bgColorAt(clamp(n.y * 0.5 + 0.6, 0.0, 1.0));
  var col = in.tint * (u.ambient * 0.9 + diff * strength)
    + in.tint * vec3<f32>(0.2, 0.22, 0.26) * max(-n.y, 0.0) * 0.4
    + sky * fres * 0.55
    + vec3<f32>(spec) * strength;

  col = mix(col, bgColorAt(0.55), in.fxv.x);
  let edgeAA = 1.0 - smoothstep(0.86, 1.0, r2);
  let a = edgeAA * in.fxv.z;
  return vec4<f32>(col * a, a);
}
`;

export function buildSpheresWgsl(sphereCount: number, puffCount: number): {
  compute: string;
  render: string;
} {
  const header = SPHERES_HEADER
    .replace(/\$\{SPHERE_COUNT\}/g, String(sphereCount))
    .replace(/\$\{PUFF_COUNT\}/g, String(puffCount))
    .replace(/\$\{TOTAL_COUNT\}/g, String(sphereCount + puffCount));
  return {
    compute: header + COMPUTE_BODY,
    render: header + RENDER_BODY,
  };
}
