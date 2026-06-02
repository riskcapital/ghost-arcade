// "Drift" v2 — compute-driven particle vortex with trails + lattice + feedback.
//
// WGSL forbids `read_write` storage access in vertex/fragment stages
// (compute-only). The same storage buffer is bound read_write in the
// compute pipeline and read in the render pipelines — same binding
// number, because the GPUBindGroupLayout entry type is `storage`
// (writable). The per-stage access mode is declared per WGSL module.
//
// Therefore the WGSL is split into three sections built into two
// modules at runtime:
//
//   SHARED_HEADER — uniforms, structs, hashing, palette, camera,
//                   projection. NO storage decls, NO entry points.
//                   Safe in any stage.
//   COMPUTE_BODY  — read_write storage decls + respawn + csAdvect.
//                   Compute-only.
//   RENDER_BODY   — read storage decls + ALL vs/fs entry points
//                   (vsBg/fsBg, vsParticle/fsParticle, vsTrail/fsTrail,
//                   vsLattice/fsLattice). Render-only.
//
// Pipelines (entry points listed):
//   csAdvect — compute pass: advect particles through curl-noise field,
//              decrement age, respawn when out of frustum, shift trail
//              history one slot.
//   vsBg/fsBg — background fullscreen pass.
//   vsParticle/fsParticle — instanced point sprites reading particle
//              positions from storage. Additive blend.
//   vsTrail/fsTrail — line topology, reads consecutive trail points
//              from storage. One draw call emits all trails.
//   vsLattice/fsLattice — line topology, draws segment from each
//              particle to its deterministic buddy when distance
//              under audio-modulated threshold.
//
// Storage layout:
//   particles[NUM_PARTICLES]            32 B each
//   trail[NUM_PARTICLES * TRAIL_LEN]    16 B each (vec3 pos + age)
//
// Audio (all signals SMOOTHED by AudioSmoother before reaching here):
//   energy   → flight velocity + lattice opacity + trail length
//   bassSlow → vortex strength + radial breathing
//   midSlow  → palette intensity
//   trebSlow → particle size + sparkle floor
//   beatPhase → continuous radial breathing oscillator
//   beatPulse → brief accent (kept low gain to avoid strobing)

// ── Shared header (no storage, no entry points) ────────────────────
const SHARED_HEADER = /* wgsl */ `
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
  latticeThreshold: f32,
  vortexStrength: f32,
  ribbonWidth: f32,
  ribbonTranslucency: f32,
  lightDirAndStrength: vec4<f32>,
  ambient: f32,
  ribbonSpawn: f32,
  pad1: f32, pad2: f32,
};

struct Particle {
  pos: vec3<f32>,
  age: f32,
  vel: vec3<f32>,
  seed: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

const TAU: f32 = 6.28318530718;
const PHI: f32 = 0.61803398875;

const NUM_PARTICLES: u32 = ${'$'}{NUM_PARTICLES}u;
const TRAIL_LEN: u32 = ${'$'}{TRAIL_LEN}u;

const TUBE_LENGTH: f32 = 60.0;
const TUBE_RADIUS_BASE: f32 = 4.5;

// Hashing
fn hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x = x * (x + 33.33);
  return fract(x * x);
}
fn hash33(p: vec3<f32>) -> vec3<f32> {
  var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  q = q + dot(q, q.yxz + 33.33);
  return fract(vec3<f32>(q.x + q.y, q.y + q.z, q.z + q.x) * q.zyx);
}
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}
fn paletteColor(t: f32, intensity: f32) -> vec3<f32> {
  let h = fract(0.92 + u.hueShift + t * 0.18);
  let s = clamp(0.55 + intensity * 0.30, 0.0, 1.0);
  let v = clamp(0.55 + intensity * 0.45, 0.0, 1.0);
  return hsv2rgb(vec3<f32>(h, s, v));
}

// Camera (procedural)
fn cameraPos() -> vec3<f32> {
  let v = 4.0 + u.energy * 4.0;
  let z = u.time * v;
  let x = sin(u.time * 0.21) * 0.6 + cos(u.time * 0.37) * 0.3;
  let y = cos(u.time * 0.19) * 0.4 + sin(u.time * 0.27) * 0.2;
  return vec3<f32>(x, y, z);
}
fn cameraForward(t: f32) -> vec3<f32> {
  let yaw   = sin(t * 0.13) * 0.08;
  let pitch = cos(t * 0.17) * 0.06;
  return normalize(vec3<f32>(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
}

// 3D value noise + curl (divergence-free vector field)
fn vnoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u3 = f * f * (3.0 - 2.0 * f);
  let n000 = hash11(dot(i + vec3<f32>(0.0,0.0,0.0), vec3<f32>(1.0,57.0,113.0)));
  let n100 = hash11(dot(i + vec3<f32>(1.0,0.0,0.0), vec3<f32>(1.0,57.0,113.0)));
  let n010 = hash11(dot(i + vec3<f32>(0.0,1.0,0.0), vec3<f32>(1.0,57.0,113.0)));
  let n110 = hash11(dot(i + vec3<f32>(1.0,1.0,0.0), vec3<f32>(1.0,57.0,113.0)));
  let n001 = hash11(dot(i + vec3<f32>(0.0,0.0,1.0), vec3<f32>(1.0,57.0,113.0)));
  let n101 = hash11(dot(i + vec3<f32>(1.0,0.0,1.0), vec3<f32>(1.0,57.0,113.0)));
  let n011 = hash11(dot(i + vec3<f32>(0.0,1.0,1.0), vec3<f32>(1.0,57.0,113.0)));
  let n111 = hash11(dot(i + vec3<f32>(1.0,1.0,1.0), vec3<f32>(1.0,57.0,113.0)));
  let xy0 = mix(mix(n000, n100, u3.x), mix(n010, n110, u3.x), u3.y);
  let xy1 = mix(mix(n001, n101, u3.x), mix(n011, n111, u3.x), u3.y);
  return mix(xy0, xy1, u3.z) * 2.0 - 1.0;
}
fn potential(p: vec3<f32>) -> vec3<f32> {
  let s = 0.4;
  return vec3<f32>(
    vnoise(p * s + vec3<f32>(0.0,  0.0,  0.0)),
    vnoise(p * s + vec3<f32>(31.4, 12.7, 6.28)),
    vnoise(p * s + vec3<f32>(-7.3, 41.2, 23.1)),
  );
}
fn curlNoise(p: vec3<f32>) -> vec3<f32> {
  let e = 0.1;
  let dy_dz = potential(p + vec3<f32>(0.0, 0.0, e)).y - potential(p - vec3<f32>(0.0, 0.0, e)).y;
  let dz_dy = potential(p + vec3<f32>(0.0, e, 0.0)).z - potential(p - vec3<f32>(0.0, e, 0.0)).z;
  let dz_dx = potential(p + vec3<f32>(e, 0.0, 0.0)).z - potential(p - vec3<f32>(e, 0.0, 0.0)).z;
  let dx_dz = potential(p + vec3<f32>(0.0, 0.0, e)).x - potential(p - vec3<f32>(0.0, 0.0, e)).x;
  let dx_dy = potential(p + vec3<f32>(0.0, e, 0.0)).x - potential(p - vec3<f32>(0.0, e, 0.0)).x;
  let dy_dx = potential(p + vec3<f32>(e, 0.0, 0.0)).y - potential(p - vec3<f32>(e, 0.0, 0.0)).y;
  return vec3<f32>(dy_dz - dz_dy, dz_dx - dx_dz, dx_dy - dy_dx) / (2.0 * e);
}

// Camera projection helper
struct Projected { clip: vec3<f32>, depth: f32 };
fn projectToClip(worldPos: vec3<f32>) -> Projected {
  let cam = cameraPos();
  let fwd = cameraForward(u.time);
  let up0 = vec3<f32>(0.0, 1.0, 0.0);
  let right = normalize(cross(up0, fwd));
  let upV = cross(fwd, right);
  let rel = worldPos - cam;
  let vx = dot(rel, right);
  let vy = dot(rel, upV);
  let vz = dot(rel, fwd);
  let focal = 1.3;
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  var out: Projected;
  if (vz <= 0.05) {
    out.clip = vec3<f32>(2.0, 2.0, 1.0);
    out.depth = -1.0;
  } else {
    out.clip = vec3<f32>(
      (vx / vz) * focal / aspect,
      (vy / vz) * focal,
      vz,
    );
    out.depth = vz;
  }
  return out;
}
`;

// ── Compute body: read_write storage + respawn + csAdvect ──────────
const COMPUTE_BODY = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> trail: array<vec4<f32>>;

fn respawn(idx: u32, p: ptr<function, Particle>) {
  let s = f32(idx) * PHI + u.time * 0.001;
  let h = hash33(vec3<f32>(s, s + 11.3, s + 23.7));
  let cam = cameraPos();
  let angle = h.x * TAU;
  let radius = TUBE_RADIUS_BASE * mix(0.5, 1.3, h.y);
  let zOffset = mix(10.0, TUBE_LENGTH, h.z);
  (*p).pos = vec3<f32>(cos(angle) * radius, sin(angle) * radius, cam.z + zOffset);
  (*p).vel = vec3<f32>(0.0);
  (*p).age = 0.0;
  (*p).seed = h.x;
}

@compute @workgroup_size(64)
fn csAdvect(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= NUM_PARTICLES) { return; }
  var p = particles[idx];
  if (p.seed == 0.0) {
    respawn(idx, &p);
    for (var i: u32 = 0u; i < TRAIL_LEN; i = i + 1u) {
      trail[idx * TRAIL_LEN + i] = vec4<f32>(p.pos, 0.0);
    }
  }
  let fieldP = p.pos * 0.18 + vec3<f32>(0.0, 0.0, u.time * 0.1);
  let force = curlNoise(fieldP) * u.vortexStrength * (0.5 + u.bassSlow * 0.8);
  let axisPull = vec3<f32>(-p.pos.x, -p.pos.y, 0.0) * 0.3;
  let drift = vec3<f32>(0.0, 0.0, -0.3 - u.energy * 0.4);
  let dt = clamp(u.dt, 0.0, 0.05);
  p.vel = p.vel * 0.90 + (force + axisPull + drift) * dt;
  p.pos = p.pos + p.vel;
  p.age = p.age + dt * 0.1;
  let cam = cameraPos();
  let rel = p.pos - cam;
  let outOfBox = rel.z < -8.0 || rel.z > TUBE_LENGTH * 1.5 || length(rel.xy) > 18.0;
  if (outOfBox || p.age > 1.0) {
    respawn(idx, &p);
    for (var i: u32 = 0u; i < TRAIL_LEN; i = i + 1u) {
      trail[idx * TRAIL_LEN + i] = vec4<f32>(p.pos, 0.0);
    }
  }
  for (var i: u32 = TRAIL_LEN - 1u; i > 0u; i = i - 1u) {
    trail[idx * TRAIL_LEN + i] = trail[idx * TRAIL_LEN + i - 1u];
  }
  trail[idx * TRAIL_LEN + 0u] = vec4<f32>(p.pos, p.age);
  particles[idx] = p;
}
`;

// ── Render body: read storage + all vs/fs entry points ─────────────
const RENDER_BODY = /* wgsl */ `
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> trail: array<vec4<f32>>;

// Background
struct VsBg {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex
fn vsBg(@builtin(vertex_index) vid: u32) -> VsBg {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsBg;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}
@fragment
fn fsBg(in: VsBg) -> @location(0) vec4<f32> {
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  let p = vec2<f32>((in.uv.x * 2.0 - 1.0) * aspect, 1.0 - in.uv.y * 2.0);
  let r = length(p);
  let baseHue = paletteColor(0.15, 0.4 + u.energy * 0.3);
  let glow = exp(-r * 1.4) * (0.20 + u.energy * 0.55);
  let glowCol = paletteColor(0.6, 1.0);
  var col = baseHue * 0.22 + glowCol * glow;
  let starN = hash11(floor(in.uv.x * 800.0) + floor(in.uv.y * 800.0) * 31.13);
  if (starN > 0.997) {
    col = col + vec3<f32>((starN - 0.997) * 200.0);
  }
  return vec4<f32>(col, 1.0);
}

// Particle (instanced point sprites)
struct VsP {
  @builtin(position) pos: vec4<f32>,
  @location(0) uvQuad: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) brightness: f32,
};
@vertex
fn vsParticle(@builtin(instance_index) iid: u32, @builtin(vertex_index) vid: u32) -> VsP {
  var quadXY = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
  );
  let qv = quadXY[vid];
  let p = particles[iid];
  let proj = projectToClip(p.pos);

  var out: VsP;
  if (proj.depth < 0.0) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.uvQuad = qv;
    out.color = vec3<f32>(0.0);
    out.brightness = 0.0;
    return out;
  }

  let baseSize = mix(0.015, 0.045, p.seed) * (0.75 + u.trebSlow * 0.6 + u.energy * 0.4);
  let focal = 1.3;
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  let qx = qv.x * baseSize * focal / (proj.depth * aspect);
  let qy = qv.y * baseSize * focal / proj.depth;
  out.pos = vec4<f32>(proj.clip.x + qx, proj.clip.y + qy, 0.0, 1.0);
  out.uvQuad = qv;
  let hueAtZ = fract(p.pos.z * 0.025 + p.seed * 0.15);
  out.color = paletteColor(hueAtZ, 0.85 + u.energy * 0.3);
  let depth01 = clamp(1.0 - proj.depth / TUBE_LENGTH, 0.0, 1.0);
  out.brightness = depth01 * (0.9 + u.energy * 0.5) + u.beatPulse * p.seed * 0.5;
  return out;
}
@fragment
fn fsParticle(in: VsP) -> @location(0) vec4<f32> {
  let d = length(in.uvQuad);
  if (d > 1.0) { discard; }
  let core = pow(1.0 - d, 4.0);
  let halo = pow(1.0 - d, 2.0) * 0.35;
  let col = in.color * in.brightness * (core + halo);
  return vec4<f32>(col, clamp(core + halo, 0.0, 1.0));
}

// Trail ribbons (line list)
struct VsTrail {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) brightness: f32,
};
@vertex
fn vsTrail(@builtin(vertex_index) vid: u32) -> VsTrail {
  let vertsPerParticle = (TRAIL_LEN - 1u) * 2u;
  let particleIdx = vid / vertsPerParticle;
  let inParticle  = vid % vertsPerParticle;
  let segmentIdx  = inParticle / 2u;
  let endpoint    = inParticle % 2u;
  let slot        = segmentIdx + endpoint;

  let tp = trail[particleIdx * TRAIL_LEN + slot];
  let worldPos = tp.xyz;
  let proj = projectToClip(worldPos);

  var out: VsTrail;
  if (proj.depth < 0.0) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.brightness = 0.0;
    return out;
  }
  out.pos = vec4<f32>(proj.clip.x, proj.clip.y, 0.0, 1.0);

  let p = particles[particleIdx];
  let hueAtZ = fract(worldPos.z * 0.025 + p.seed * 0.15);
  out.color = paletteColor(hueAtZ, 0.85 + u.energy * 0.3);
  let ageDim = 1.0 - f32(slot) / f32(TRAIL_LEN);
  let depth01 = clamp(1.0 - proj.depth / TUBE_LENGTH, 0.0, 1.0);
  out.brightness = ageDim * ageDim * depth01 * (0.7 + u.energy * 0.6);
  return out;
}
@fragment
fn fsTrail(in: VsTrail) -> @location(0) vec4<f32> {
  let col = in.color * in.brightness * 0.6;
  return vec4<f32>(col, in.brightness);
}

// Lattice connectors (line list, deterministic golden-ratio buddy)
struct VsLattice {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) opacity: f32,
};
@vertex
fn vsLattice(@builtin(vertex_index) vid: u32) -> VsLattice {
  let particleIdx = vid / 2u;
  let endpoint    = vid % 2u;
  let a = particles[particleIdx];
  let buddyOffset = u32(hash11(f32(particleIdx) * PHI + 7.0) * f32(NUM_PARTICLES));
  let buddyIdx = (particleIdx + buddyOffset) % NUM_PARTICLES;
  let b = particles[buddyIdx];

  let dist = length(a.pos - b.pos);
  let thresh = u.latticeThreshold;
  var op = clamp(1.0 - dist / thresh, 0.0, 1.0);
  op = op * op;

  let worldPos = select(b.pos, a.pos, endpoint == 0u);
  let proj = projectToClip(worldPos);

  var out: VsLattice;
  if (proj.depth < 0.0 || op < 0.01) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.opacity = 0.0;
    return out;
  }
  out.pos = vec4<f32>(proj.clip.x, proj.clip.y, 0.0, 1.0);
  let hueAtMid = fract(((a.pos.z + b.pos.z) * 0.5) * 0.025 + a.seed * 0.1);
  out.color = paletteColor(hueAtMid, 0.9 + u.energy * 0.3);
  out.opacity = op * (0.4 + u.midSlow * 0.5 + u.energy * 0.4);
  return out;
}
@fragment
fn fsLattice(in: VsLattice) -> @location(0) vec4<f32> {
  let col = in.color * in.opacity * 0.8;
  return vec4<f32>(col, in.opacity);
}
`;

export function buildDriftWgsl(numParticles: number, trailLen: number): {
  compute: string;
  render: string;
} {
  const headerReplaced = SHARED_HEADER
    .replace(/\$\{NUM_PARTICLES\}/g, String(numParticles))
    .replace(/\$\{TRAIL_LEN\}/g, String(trailLen));
  return {
    compute: headerReplaced + COMPUTE_BODY,
    render: headerReplaced + RENDER_BODY,
  };
}
