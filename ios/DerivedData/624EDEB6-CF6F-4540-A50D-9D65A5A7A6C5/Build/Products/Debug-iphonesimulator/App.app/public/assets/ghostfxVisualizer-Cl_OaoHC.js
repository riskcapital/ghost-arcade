import{e as se}from"./modulationBroadcast-DDTQeuhI.js";import{D as oe,F as ae,C as Y,S as ne,O as le,G as ce,M as ue,P as de,J as pe}from"./main-4BlCn4xa.js";import"./index-jeXJYamp.js";import"./audio-BnbxmTFR.js";import"./customEffects-Detx1fUt.js";import"./parser-B2YdyCJi.js";const fe=`
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

const NUM_PARTICLES: u32 = \${NUM_PARTICLES}u;
const TRAIL_LEN: u32 = \${TRAIL_LEN}u;

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
`,he=`
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
`,ve=`
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
`;function be(_,e){const s=fe.replace(/\$\{NUM_PARTICLES\}/g,String(_)).replace(/\$\{TRAIL_LEN\}/g,String(e));return{compute:s+he,render:s+ve}}const ge=`
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

const NUM_RIBBONS: u32 = \${NUM_RIBBONS}u;
const TRAIL_LEN: u32 = \${TRAIL_LEN}u;

const FLY_ZONE_LEN: f32 = 80.0;
const SPAWN_RADIUS_BASE: f32 = 6.0;

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
fn palette(t: f32, intensity: f32) -> vec3<f32> {
  let h = fract(0.86 + u.hueShift + t * 0.22);
  let s = clamp(0.55 + intensity * 0.30 + u.trebSlow * 0.10, 0.0, 1.0);
  let v = clamp(0.55 + intensity * 0.45, 0.0, 1.0);
  return hsv2rgb(vec3<f32>(h, s, v));
}

// Camera — slow drift along +z, very gentle bob (no audio bouncing).
fn cameraPos() -> vec3<f32> {
  let z = u.time * (2.0 + u.energy * 2.5);  // energy → ribbons stream past faster
  let x = sin(u.time * 0.17) * 0.45;
  let y = cos(u.time * 0.21) * 0.30;
  return vec3<f32>(x, y, z);
}
fn cameraForward(t: f32) -> vec3<f32> {
  let yaw   = sin(t * 0.11) * 0.06;
  let pitch = cos(t * 0.14) * 0.04;
  return normalize(vec3<f32>(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
}

// 3D value noise + curl (divergence-free vector field) — same as Drift,
// but at a larger spatial scale so ribbons make long sweeping curves
// instead of tight scribbles.
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
  let s = 0.18;  // smaller s → larger spatial scale → smoother sweeps
  return vec3<f32>(
    vnoise(p * s + vec3<f32>(0.0,  0.0,  0.0)),
    vnoise(p * s + vec3<f32>(31.4, 12.7, 6.28)),
    vnoise(p * s + vec3<f32>(-7.3, 41.2, 23.1)),
  );
}
fn curlNoise(p: vec3<f32>) -> vec3<f32> {
  let e = 0.15;
  let dy_dz = potential(p + vec3<f32>(0.0, 0.0, e)).y - potential(p - vec3<f32>(0.0, 0.0, e)).y;
  let dz_dy = potential(p + vec3<f32>(0.0, e, 0.0)).z - potential(p - vec3<f32>(0.0, e, 0.0)).z;
  let dz_dx = potential(p + vec3<f32>(e, 0.0, 0.0)).z - potential(p - vec3<f32>(e, 0.0, 0.0)).z;
  let dx_dz = potential(p + vec3<f32>(0.0, 0.0, e)).x - potential(p - vec3<f32>(0.0, 0.0, e)).x;
  let dx_dy = potential(p + vec3<f32>(0.0, e, 0.0)).x - potential(p - vec3<f32>(0.0, e, 0.0)).x;
  let dy_dx = potential(p + vec3<f32>(e, 0.0, 0.0)).y - potential(p - vec3<f32>(e, 0.0, 0.0)).y;
  return vec3<f32>(dy_dz - dz_dy, dz_dx - dx_dz, dx_dy - dy_dx) / (2.0 * e);
}

// Projection — same convention as Drift.
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

// Build a camera-facing side vector for a ribbon segment.
fn ribbonSide(p0: vec3<f32>, p1: vec3<f32>) -> vec3<f32> {
  let cam = cameraPos();
  let mid = (p0 + p1) * 0.5;
  let toCam = normalize(cam - mid);
  let seg = p1 - p0;
  let segLen = length(seg);
  if (segLen < 1e-5) {
    return vec3<f32>(1.0, 0.0, 0.0);  // degenerate: arbitrary direction
  }
  let side = cross(seg / segLen, toCam);
  let sLen = length(side);
  if (sLen < 1e-5) {
    return vec3<f32>(1.0, 0.0, 0.0);
  }
  return side / sLen;
}
`,me=`
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> trail: array<vec4<f32>>;

fn respawn(idx: u32, p: ptr<function, Particle>) {
  let s = f32(idx) * PHI + u.time * 0.013;
  let h = hash33(vec3<f32>(s, s + 11.3, s + 23.7));
  let cam = cameraPos();
  // Spawn point: ahead of the camera in a cylinder around +z
  let angle = h.x * TAU;
  let radius = SPAWN_RADIUS_BASE * mix(0.4, 1.4, h.y);
  let zOffset = mix(20.0, FLY_ZONE_LEN, h.z);
  let pos = vec3<f32>(cos(angle) * radius, sin(angle) * radius, cam.z + zOffset);
  (*p).pos = pos;
  (*p).vel = vec3<f32>(0.0, 0.0, -1.0) * (0.5 + h.x * 0.5);
  (*p).age = 0.0;
  // seed encodes per-ribbon randomness + serves as "alive" flag (non-zero)
  (*p).seed = 0.1 + h.y * 0.9;
}

@compute @workgroup_size(64)
fn csAdvect(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= NUM_RIBBONS) { return; }
  var p = particles[idx];

  // Dead ribbon — probabilistic respawn gated by audio. This is the
  // visible "obvious audio reactivity" — beats and bass produce
  // bursts of new ribbons bursting into existence.
  if (p.seed == 0.0) {
    let r = hash11(f32(idx) * 0.1731 + u.time * 13.7);
    // Base trickle so the field never goes empty; bass + beats add
    // big bursts. Tuned so quiet ≈ a few ribbons/sec, beats ≈
    // hundreds/sec from the 4096-pool.
    let spawnProb = (0.0008 + u.bassSlow * 0.022 + u.beatPulse * 0.10 + u.energy * 0.003) * u.ribbonSpawn;
    if (r < spawnProb) {
      respawn(idx, &p);
      // Initialize trail to all spawn position
      for (var i: u32 = 0u; i < TRAIL_LEN; i = i + 1u) {
        trail[idx * TRAIL_LEN + i] = vec4<f32>(p.pos, 0.0);
      }
    } else {
      // Stay dead; write degenerate trail (off-screen, far away)
      let dead = vec4<f32>(10000.0, 10000.0, 10000.0, -1.0);
      for (var i: u32 = 0u; i < TRAIL_LEN; i = i + 1u) {
        trail[idx * TRAIL_LEN + i] = dead;
      }
      particles[idx] = p;
      return;
    }
  }

  // Integrate position through curl-noise. vortexStrength is a user
  // tunable; bassSlow modulates turbulence (still rates, not shapes).
  let fieldP = p.pos * 0.12 + vec3<f32>(0.0, 0.0, u.time * 0.08);
  let force = curlNoise(fieldP) * (1.5 + u.vortexStrength * 0.5) * (0.6 + u.bassSlow * 0.6);

  // Forward drift: ribbons stream past the camera as it advances.
  // energy → faster current (visible velocity coupling).
  let drift = vec3<f32>(0.0, 0.0, -0.4 - u.energy * 0.5);
  let dt = clamp(u.dt, 0.0, 0.05);
  p.vel = p.vel * 0.93 + (force + drift) * dt;
  p.pos = p.pos + p.vel;
  p.age = p.age + dt;

  // Death conditions: out of range, or aged out (long lifespan so
  // ribbons fully form before they die).
  let cam = cameraPos();
  let rel = p.pos - cam;
  let outOfBox = rel.z < -12.0 || rel.z > FLY_ZONE_LEN * 1.8 || length(rel.xy) > 22.0;
  let aged = p.age > 8.0;
  if (outOfBox || aged) {
    // Kill — wait for next probabilistic respawn
    p.seed = 0.0;
    let dead = vec4<f32>(10000.0, 10000.0, 10000.0, -1.0);
    for (var i: u32 = 0u; i < TRAIL_LEN; i = i + 1u) {
      trail[idx * TRAIL_LEN + i] = dead;
    }
    particles[idx] = p;
    return;
  }

  // Shift trail history one slot back, write new head at slot 0.
  for (var i: u32 = TRAIL_LEN - 1u; i > 0u; i = i - 1u) {
    trail[idx * TRAIL_LEN + i] = trail[idx * TRAIL_LEN + i - 1u];
  }
  trail[idx * TRAIL_LEN + 0u] = vec4<f32>(p.pos, p.age);
  particles[idx] = p;
}
`,xe=`
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> trail: array<vec4<f32>>;

// Background — deep cosmic gradient, no audio coupling.
struct VsBg { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsBg(@builtin(vertex_index) vid: u32) -> VsBg {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsBg;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}
@fragment fn fsBg(in: VsBg) -> @location(0) vec4<f32> {
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  let p = vec2<f32>((in.uv.x * 2.0 - 1.0) * aspect, 1.0 - in.uv.y * 2.0);
  let r = length(p);
  // Slow ambient palette; brightness barely changes — audio doesn't drive bg.
  let baseHue = palette(0.10, 0.30);
  let glow = exp(-r * 1.3) * 0.15;
  let glowCol = palette(0.55, 0.85);
  var col = baseHue * 0.18 + glowCol * glow;
  // Sparse starfield — fixed pattern, not audio-driven.
  let starN = hash11(floor(in.uv.x * 900.0) + floor(in.uv.y * 900.0) * 31.13);
  if (starN > 0.9975) {
    col = col + vec3<f32>((starN - 0.9975) * 220.0);
  }
  return vec4<f32>(col, 1.0);
}

// Ribbons — camera-facing quad strip. 6 vertices per segment, drawn
// triangle-list (NO topology change between draws). Per ribbon,
// (TRAIL_LEN-1) segments. Total verts = N_RIBBONS * (TRAIL_LEN-1) * 6.
//
// Vertex decoding:
//   vid → (ribbonIdx, segIdx, cornerId in [0..5])
// Quad layout (corners around the strip):
//     2 ── 5    (=2)
//     │  ╱ │
//     │ ╱  │
//     0 ── 4
//     │  ╲ │
//     │ ╲  │
//     1 ── 3    (=4)
// Tri1: 0,1,2  Tri2: 1,4,2 → six corner ids = [0,1,2, 1,4,2]
// We index that array via cornerId.
struct VsR {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) brightness: f32,
  @location(2) crossU: f32,   // [-1..1] across ribbon width
  @location(3) litFront: f32, // diffuse term on +normal side (0..1+)
  @location(4) litBack: f32,  // diffuse term on -normal side (0..1+)
};
@vertex fn vsRibbon(@builtin(vertex_index) vid: u32) -> VsR {
  let vertsPerSeg: u32 = 6u;
  let segsPerRibbon: u32 = TRAIL_LEN - 1u;
  let vertsPerRibbon: u32 = segsPerRibbon * vertsPerSeg;
  let ribbonIdx = vid / vertsPerRibbon;
  let inRibbon  = vid % vertsPerRibbon;
  let segIdx    = inRibbon / vertsPerSeg;       // 0..segsPerRibbon-1
  let cornerId  = inRibbon % vertsPerSeg;       // 0..5

  // Lookup table for the six corners of the quad-as-two-triangles.
  // Each entry encodes (which endpoint: 0=p0 1=p1, sideSign +1/-1).
  // Tri1: (p0,+) (p0,-) (p1,+)
  // Tri2: (p0,-) (p1,-) (p1,+)
  var endpoint: u32 = 0u;
  var sideSign: f32 = 1.0;
  if      (cornerId == 0u) { endpoint = 0u; sideSign =  1.0; }
  else if (cornerId == 1u) { endpoint = 0u; sideSign = -1.0; }
  else if (cornerId == 2u) { endpoint = 1u; sideSign =  1.0; }
  else if (cornerId == 3u) { endpoint = 0u; sideSign = -1.0; }
  else if (cornerId == 4u) { endpoint = 1u; sideSign = -1.0; }
  else                     { endpoint = 1u; sideSign =  1.0; }

  let t0 = trail[ribbonIdx * TRAIL_LEN + segIdx];
  let t1 = trail[ribbonIdx * TRAIL_LEN + segIdx + 1u];

  var out: VsR;
  // Degenerate / dead ribbon → off-screen vertex.
  if (t0.w < -0.5 || t1.w < -0.5) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.brightness = 0.0;
    out.crossU = 0.0;
    out.litFront = 0.0;
    out.litBack = 0.0;
    return out;
  }

  let p0 = t0.xyz;
  let p1 = t1.xyz;
  let side = ribbonSide(p0, p1);

  // Width: user-tunable head width tapers to ~15% at tail. NO audio
  // coupling — keeps ribbon shape stable, audio drives spawn rate
  // and flow speed instead.
  let widthHead: f32 = u.ribbonWidth;
  let widthTail: f32 = u.ribbonWidth * 0.15;
  let tA = f32(segIdx) / f32(TRAIL_LEN);
  let tB = f32(segIdx + 1u) / f32(TRAIL_LEN);
  let wA = mix(widthHead, widthTail, tA);
  let wB = mix(widthHead, widthTail, tB);

  let p = select(p1, p0, endpoint == 0u);
  let w = select(wB, wA, endpoint == 0u);
  let worldCorner = p + side * (sideSign * w);
  let proj = projectToClip(worldCorner);

  if (proj.depth < 0.0) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.brightness = 0.0;
    out.crossU = 0.0;
    out.litFront = 0.0;
    out.litBack = 0.0;
    return out;
  }
  out.pos = vec4<f32>(proj.clip.x, proj.clip.y, 0.0, 1.0);

  // Color: per-ribbon hue from seed, slowly migrating with time.
  let pr = particles[ribbonIdx];
  let hueAtRibbon = fract(pr.seed * 0.73 + u.time * 0.015);
  out.color = palette(hueAtRibbon, 0.95);

  // Brightness: head bright, tail dim (along-length falloff). Depth
  // fog adds atmosphere. No audio coupling on brightness here — the
  // ribbon already feels alive from the flow.
  let alongAge = 1.0 - tA;   // 1 at head, 0 at tail
  let depth01 = clamp(1.0 - proj.depth / FLY_ZONE_LEN, 0.0, 1.0);
  out.brightness = alongAge * (0.6 + depth01 * 0.8);

  // Directional lighting. The ribbon's surface normal is perpendicular
  // to both the segment direction and the side vector. Two-sided
  // shading: litFront for sideSign>0, litBack for sideSign<0 — the
  // fragment shader picks based on its interpolated crossU sign.
  let seg = p1 - p0;
  var ribbonNormal = vec3<f32>(0.0, 0.0, 1.0);
  if (length(seg) > 1e-5) {
    let n = cross(normalize(seg), side);
    if (length(n) > 1e-5) {
      ribbonNormal = normalize(n);
    }
  }
  let lightDir = normalize(u.lightDirAndStrength.xyz);
  let lightStr = u.lightDirAndStrength.w;
  let frontDot = max(dot(ribbonNormal, lightDir), 0.0);
  let backDot  = max(dot(-ribbonNormal, lightDir), 0.0);
  // Subsurface scattering: back side gets some transmitted light too
  // (30% of front). Makes the ribbon feel translucent under back-lighting
  // rather than going pitch-black like opaque metal.
  out.litFront = u.ambient + lightStr * (frontDot + 0.30 * backDot);
  out.litBack  = u.ambient + lightStr * (backDot  + 0.30 * frontDot);

  out.crossU = sideSign;
  return out;
}
@fragment fn fsRibbon(in: VsR) -> @location(0) vec4<f32> {
  // Soft cross-section: bright core, alpha falls off at edges so the
  // ribbon doesn't look like a hard quad.
  let core = exp(-in.crossU * in.crossU * 2.2);

  // Pick front- or back-side lighting from the interpolated crossU sign.
  // (Side > 0 = "front" face = the side the cross-product normal points to.)
  let lit = select(in.litBack, in.litFront, in.crossU >= 0.0);

  // Final color is base * brightness * lighting * core. Translucency
  // raises alpha so back-ribbons remain visible through front ones
  // under glass-blend; under additive blend it just increases the
  // additive contribution (visible as a slight brightness boost).
  let col = in.color * in.brightness * lit * core * 1.2;
  let alpha = in.brightness * core * (0.6 + u.ribbonTranslucency * 0.8);
  return vec4<f32>(col, alpha);
}
`;function ye(_,e){const s=ge.replace(/\$\{NUM_RIBBONS\}/g,String(_)).replace(/\$\{TRAIL_LEN\}/g,String(e));return{compute:s+me,render:s+xe}}const T=`
struct Uniforms {
  simRes: vec2<f32>,
  canvasRes: vec2<f32>,
  time: f32,
  dt: f32,
  // Audio (smoothed)
  bassSlow: f32, midSlow: f32, trebSlow: f32, energy: f32,
  beatPhase: f32, beatPulse: f32, hueShift: f32, exposure: f32,
  // Tuning
  splatForce: f32,
  splatRadius: f32,
  dyeDecay: f32,
  velDecay: f32,
  // Splat count
  numSplats: u32,
  pad0: u32, pad1: u32, pad2: u32,
};

struct Splat {
  posVel: vec4<f32>,        // xy = uv center, zw = velocity impulse (uv/s)
  colorRadius: vec4<f32>,   // xyz = color, w = radius (uv units)
};

@group(0) @binding(0) var<uniform> u: Uniforms;

// Manual bilinear sample of a texture_2d<f32>. We can't use samplers
// in compute (well, we can, but textureSampleLevel requires uniform
// control flow — easier to do it ourselves). uv in [0,1].
fn sampleBilinear(t: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let dim = vec2<f32>(textureDimensions(t));
  let p = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * dim - 0.5;
  let pi = floor(p);
  let pf = p - pi;
  let maxC = vec2<i32>(dim - 1.0);
  let i0 = clamp(vec2<i32>(pi), vec2<i32>(0), maxC);
  let i1 = clamp(i0 + vec2<i32>(1, 0), vec2<i32>(0), maxC);
  let i2 = clamp(i0 + vec2<i32>(0, 1), vec2<i32>(0), maxC);
  let i3 = clamp(i0 + vec2<i32>(1, 1), vec2<i32>(0), maxC);
  let c00 = textureLoad(t, i0, 0);
  let c10 = textureLoad(t, i1, 0);
  let c01 = textureLoad(t, i2, 0);
  let c11 = textureLoad(t, i3, 0);
  let cx0 = mix(c00, c10, pf.x);
  let cx1 = mix(c01, c11, pf.x);
  return mix(cx0, cx1, pf.y);
}

fn uvFromCoord(coord: vec2<i32>, dim: vec2<i32>) -> vec2<f32> {
  return (vec2<f32>(coord) + 0.5) / vec2<f32>(dim);
}
`,Be=T+`
@group(0) @binding(1) var<storage, read> splats: array<Splat>;
@group(0) @binding(2) var velIn: texture_2d<f32>;
@group(0) @binding(3) var dyeIn: texture_2d<f32>;
@group(0) @binding(4) var velOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var dyeOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csSplat(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(velIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);

  var vel = textureLoad(velIn, coord, 0).xy;
  var dye = textureLoad(dyeIn, coord, 0);

  // Aspect ratio of the sim grid — circular splats need x scaled by
  // aspect so they don't stretch into ellipses on wide sim grids.
  let aspect = u.simRes.x / max(u.simRes.y, 1.0);

  for (var i: u32 = 0u; i < u.numSplats; i = i + 1u) {
    let s = splats[i];
    let d = uv - s.posVel.xy;
    let dC = vec2<f32>(d.x * aspect, d.y);
    let r = max(s.colorRadius.w, 1e-4);
    let g = exp(-dot(dC, dC) / (r * r));
    vel = vel + s.posVel.zw * g * u.splatForce;
    let cAdd = s.colorRadius.xyz * g * u.splatForce * 0.6;
    dye = vec4<f32>(dye.xyz + cAdd, min(dye.w + g * u.splatForce * 0.5, 4.0));
  }

  textureStore(velOut, coord, vec4<f32>(vel, 0.0, 1.0));
  textureStore(dyeOut, coord, dye);
}
`,_e=T+`
@group(0) @binding(1) var velIn: texture_2d<f32>;
@group(0) @binding(2) var velOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csAdvectVel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(velIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);

  let v0 = textureLoad(velIn, coord, 0).xy;
  // Backtrack to where this parcel came from. dt scaled by aspect-
  // free factor; sim grid is in uv-space velocity.
  let uvBack = uv - v0 * u.dt;
  let v1 = sampleBilinear(velIn, uvBack).xy * u.velDecay;
  textureStore(velOut, coord, vec4<f32>(v1, 0.0, 1.0));
}
`,Pe=T+`
@group(0) @binding(1) var velIn: texture_2d<f32>;
@group(0) @binding(2) var divOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csDivergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(velIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let maxC = dim - vec2<i32>(1);
  let l = clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxC);
  let r = clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), maxC);
  let b = clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxC);
  let t = clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), maxC);
  let vL = textureLoad(velIn, l, 0).x;
  let vR = textureLoad(velIn, r, 0).x;
  let vB = textureLoad(velIn, b, 0).y;
  let vT = textureLoad(velIn, t, 0).y;
  let div = 0.5 * ((vR - vL) + (vT - vB));
  textureStore(divOut, coord, vec4<f32>(div, 0.0, 0.0, 1.0));
}
`,we=T+`
@group(0) @binding(1) var presIn: texture_2d<f32>;
@group(0) @binding(2) var divIn: texture_2d<f32>;
@group(0) @binding(3) var presOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csJacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(presIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let maxC = dim - vec2<i32>(1);
  let pL = textureLoad(presIn, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxC), 0).x;
  let pR = textureLoad(presIn, clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), maxC), 0).x;
  let pB = textureLoad(presIn, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxC), 0).x;
  let pT = textureLoad(presIn, clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), maxC), 0).x;
  let d = textureLoad(divIn, coord, 0).x;
  let pNew = (pL + pR + pB + pT - d) * 0.25;
  textureStore(presOut, coord, vec4<f32>(pNew, 0.0, 0.0, 1.0));
}
`,Se=T+`
@group(0) @binding(1) var velIn: texture_2d<f32>;
@group(0) @binding(2) var presIn: texture_2d<f32>;
@group(0) @binding(3) var velOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csSubtractGradient(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(velIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let maxC = dim - vec2<i32>(1);
  let pL = textureLoad(presIn, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxC), 0).x;
  let pR = textureLoad(presIn, clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), maxC), 0).x;
  let pB = textureLoad(presIn, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxC), 0).x;
  let pT = textureLoad(presIn, clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), maxC), 0).x;
  let v = textureLoad(velIn, coord, 0).xy;
  let grad = vec2<f32>(pR - pL, pT - pB) * 0.5;
  let vNew = v - grad;
  textureStore(velOut, coord, vec4<f32>(vNew, 0.0, 1.0));
}
`,Ae=T+`
@group(0) @binding(1) var dyeIn: texture_2d<f32>;
@group(0) @binding(2) var velIn: texture_2d<f32>;
@group(0) @binding(3) var dyeOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csAdvectDye(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dim = vec2<i32>(textureDimensions(dyeIn));
  if (i32(gid.x) >= dim.x || i32(gid.y) >= dim.y) { return; }
  let coord = vec2<i32>(gid.xy);
  let uv = uvFromCoord(coord, dim);

  let v = textureLoad(velIn, coord, 0).xy;
  let uvBack = uv - v * u.dt;
  let d = sampleBilinear(dyeIn, uvBack) * u.dyeDecay;
  textureStore(dyeOut, coord, d);
}
`,Te=T+`
@group(0) @binding(1) var dyeTex: texture_2d<f32>;
@group(0) @binding(2) var dyeSamp: sampler;

struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsRender(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsOut;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}

@fragment fn fsRender(in: VsOut) -> @location(0) vec4<f32> {
  let dye = textureSampleLevel(dyeTex, dyeSamp, in.uv, 0.0);
  // HDR color stays HDR — composite will tonemap. Boost dye colors
  // a bit so bloom has something to extract from quiet sections.
  let col = dye.rgb * 1.4;
  // Alpha = density. Composite reads sceneTex.a and outputs premul.
  let alpha = clamp(dye.a + dot(col, vec3<f32>(0.2126, 0.7152, 0.0722)) * 0.4, 0.0, 1.0);
  return vec4<f32>(col, alpha);
}
`,Le=`
struct Uniforms {
  resolution: vec2<f32>,         // full-res scene size
  bloomThreshold: f32,           // pixels above this contribute to bloom
  bloomIntensity: f32,           // how much bloom adds back at composite
  exposure: f32,                 // post-tonemap exposure
  vignette: f32,                 // 0..1 vignette strength
  padA: f32, padB: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var sceneTex: texture_2d<f32>;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;  // unused by extract; used by vBlur (samples hBlur output) and composite

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
  let x = f32(((vid << 1u) & 2u));
  let y = f32(vid & 2u);
  var out: VsOut;
  out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv  = vec2<f32>(x, y);
  return out;
}

// Karis-style perceptual bright-pass. Subtract threshold then push
// the remainder through a soft knee so we don't get hard halos
// around sharp specular spikes.
fn brightPass(c: vec3<f32>, threshold: f32) -> vec3<f32> {
  let knee = 0.5;
  let lum = max(max(c.r, c.g), c.b);
  let soft = clamp(lum - threshold + knee, 0.0, 2.0 * knee);
  let softFactor = soft * soft / (4.0 * knee + 0.0001);
  let amt = max(softFactor, lum - threshold) / max(lum, 0.0001);
  return c * amt;
}

// 9-tap separable gaussian. Weights pre-baked for sigma ~3.5.
// In hBlur we sample sceneTex with horizontal offsets after
// brightPass; in vBlur we sample bloomTex (the hBlur output) with
// vertical offsets and skip the bright pass.
const GAUSS_W: array<f32, 5> = array<f32, 5>(0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);

@fragment
fn fsExtractHBlur(in: VsOut) -> @location(0) vec4<f32> {
  // Half-res sampling — caller binds half-res target. Source pixel
  // step is in scene-space units so we use 2x the full-res inverse
  // to compensate for the downsample.
  let texel = vec2<f32>(2.0, 0.0) / u.resolution;
  var acc: vec3<f32> = brightPass(textureSampleLevel(sceneTex, srcSampler, in.uv, 0.0).rgb, u.bloomThreshold) * GAUSS_W[0];
  for (var i = 1; i < 5; i = i + 1) {
    let off = texel * f32(i);
    acc = acc + brightPass(textureSampleLevel(sceneTex, srcSampler, in.uv + off, 0.0).rgb, u.bloomThreshold) * GAUSS_W[i];
    acc = acc + brightPass(textureSampleLevel(sceneTex, srcSampler, in.uv - off, 0.0).rgb, u.bloomThreshold) * GAUSS_W[i];
  }
  return vec4<f32>(acc, 1.0);
}

@fragment
fn fsVBlur(in: VsOut) -> @location(0) vec4<f32> {
  // We're now sampling bloomTex (hBlur output, half-res). Use
  // bloomTex resolution implicitly via textureDimensions — keeps
  // the blur radius consistent regardless of target size.
  let dim = vec2<f32>(textureDimensions(bloomTex, 0));
  let texel = vec2<f32>(0.0, 1.0) / dim;
  var acc: vec3<f32> = textureSampleLevel(bloomTex, srcSampler, in.uv, 0.0).rgb * GAUSS_W[0];
  for (var i = 1; i < 5; i = i + 1) {
    let off = texel * f32(i);
    acc = acc + textureSampleLevel(bloomTex, srcSampler, in.uv + off, 0.0).rgb * GAUSS_W[i];
    acc = acc + textureSampleLevel(bloomTex, srcSampler, in.uv - off, 0.0).rgb * GAUSS_W[i];
  }
  return vec4<f32>(acc, 1.0);
}

// ACES Filmic tone curve — preserves highlight saturation better
// than Reinhard while keeping shadows rich. Fit-coefficient version
// from Stephen Hill / Krzysztof Narkowicz.
fn acesTonemap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fsComposite(in: VsOut) -> @location(0) vec4<f32> {
  let sceneRGBA = textureSampleLevel(sceneTex, srcSampler, in.uv, 0.0);
  let bloomRGB  = textureSampleLevel(bloomTex, srcSampler, in.uv, 0.0).rgb;
  let scene = sceneRGBA.rgb;

  // Additive bloom — multiply by user-tunable intensity. We DON'T
  // mix(bloom, scene, k) because that washes out shadows. Pure add
  // keeps blacks black, just lights bright regions.
  var col = scene + bloomRGB * u.bloomIntensity;

  // Exposure trim (user) → tonemap
  col = col * exp2(u.exposure);
  col = acesTonemap(col);

  // Smooth vignette in NDC space — frames the eye toward center
  // without obvious dark corners.
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  let p = vec2<f32>((in.uv.x * 2.0 - 1.0) * aspect, 1.0 - in.uv.y * 2.0);
  let vig = 1.0 - smoothstep(0.55, 1.30, length(p));
  col = col * mix(1.0, 0.85 + 0.15 * vig, u.vignette);

  // Alpha: union of scene coverage and bloom luminance — bloom halos
  // around bright particles should still be visible even where the
  // raw scene alpha is sparse. Tonemap above already clamped col to
  // [0,1], so taking max with col luma gives a reasonable cutoff.
  let bloomLuma = dot(bloomRGB * u.bloomIntensity, vec3<f32>(0.2126, 0.7152, 0.0722));
  var alpha = clamp(max(sceneRGBA.a, bloomLuma), 0.0, 1.0);
  // Premultiplied output — canvas is configured alphaMode:'premultiplied'
  // and the Three.js material reads premultipliedAlpha:true.
  return vec4<f32>(col * alpha, alpha);
}
`,$={bassSlow:0,midSlow:0,trebSlow:0,bassFast:0,midFast:0,trebFast:0,energy:0,beatPhase:0,beatPulse:0,amp:0};function m(_,e,s,u){if(s<=0)return e;const r=1-Math.pow(.5,u*1e3/s);return _+(e-_)*r}class Ie{state={...$};lastBeatCount=0;lastBeatAt=0;phaseRate=2;energyHistory=[];historyLimit=90;constructor(){}step(e,s,u){if(!s)return this.state.bassSlow=m(this.state.bassSlow,0,1200,e),this.state.midSlow=m(this.state.midSlow,0,1200,e),this.state.trebSlow=m(this.state.trebSlow,0,1200,e),this.state.bassFast=m(this.state.bassFast,0,300,e),this.state.midFast=m(this.state.midFast,0,300,e),this.state.trebFast=m(this.state.trebFast,0,300,e),this.state.energy=m(this.state.energy,0,2e3,e),this.state.amp=m(this.state.amp,0,200,e),this.state.beatPulse*=Math.pow(.5,e/.15),this.state.beatPhase=(this.state.beatPhase+e*this.phaseRate)%1,this.state;const r=s.bands,t=u,o=Math.min(1,(r.sub*.5+r.bass)*.7*t),c=Math.min(1,(r.lowMid*.3+r.mid)*.7*t),n=Math.min(1,(r.highMid*.3+r.treble*.5+r.air*.3)*t);this.state.bassSlow=m(this.state.bassSlow,o,800,e),this.state.midSlow=m(this.state.midSlow,c,600,e),this.state.trebSlow=m(this.state.trebSlow,n,500,e),this.state.bassFast=m(this.state.bassFast,o,180,e),this.state.midFast=m(this.state.midFast,c,140,e),this.state.trebFast=m(this.state.trebFast,n,120,e);const d=Math.min(1,(s.amplitude??0)*t);this.state.amp=m(this.state.amp,d,80,e),this.energyHistory.push(d),this.energyHistory.length>this.historyLimit&&this.energyHistory.shift();let a=0;for(let b=0;b<this.energyHistory.length;b++)a+=this.energyHistory[b]*this.energyHistory[b];const p=Math.sqrt(a/Math.max(1,this.energyHistory.length));this.state.energy=m(this.state.energy,p,1500,e);const i=s.bpm??0;if(i>50&&(s.bpmConfidence??0)>.35?this.phaseRate=i/60:this.phaseRate=m(this.phaseRate,2,800,e),s.beat?.beatCount>this.lastBeatCount){const b=this.state.beatPhase;this.state.beatPhase=b*.25,this.lastBeatCount=s.beat.beatCount,this.lastBeatAt=performance.now(),this.state.beatPulse=Math.max(this.state.beatPulse,s.beat.beatIntensity??1)}return this.state.beatPhase=(this.state.beatPhase+e*this.phaseRate)%1,this.state.beatPulse*=Math.pow(.5,e/.15),this.state}reset(){this.state={...$},this.lastBeatCount=0,this.energyHistory=[]}snapshot(){return this.state}}const A=5e4,R=16,I=4096,U=48,X=384,Ge=30,q=32,Q=32,Ve={scenePreset:"drift",sensitivity:1.4,hueDriftSpeed:.15,exposure:.1,bloomIntensity:1.4,bloomThreshold:.45,vignette:.7,bgAlpha:0,vortexStrength:2,latticeThreshold:2.5,trailIntensity:1,feedbackAmount:.35,feedbackZoom:1.003,ribbonWidth:.1,ribbonSpawn:1,ribbonTranslucency:.35,ribbonBlend:"additive",lightAzimuth:35,lightElevation:55,lightStrength:.9,ambient:.3,liquidSplatForce:1,liquidSplatRadius:.08,liquidDyeDecay:.995,liquidVelDecay:.992,liquidBassRate:1},K=112,qe=K/4,Z=32,Re=Z/4;class Ne{canvas;device=null;context=null;presentFormat="bgra8unorm";scenePipeline=null;particlePipeline=null;_ribbonPipelines=null;_liquidPipelines=null;_liquidTextures=null;_liquidBindGroups=null;_liquidUniformBuffer=null;_liquidSplatBuffer=null;_liquidSplatCpu=new Float32Array(q*8);_liquidUniformCpu=new ArrayBuffer(96);_liquidUniformF32=new Float32Array(this._liquidUniformCpu);_liquidUniformU32=new Uint32Array(this._liquidUniformCpu);_liquidVelIsA=!0;_liquidDyeIsA=!0;_liquidPrevBeatPulse=0;_liquidAmbientAcc=0;trailPipeline=null;latticePipeline=null;computePipeline=null;_particleVertCount=6;_particleInstCount=0;_computeDispatchCount=0;sceneUniformBuffer=null;sceneBindGroup=null;driftComputeBindGroup=null;particleBuffer=null;trailBuffer=null;postExtractPipeline=null;postBlurVPipeline=null;postCompositePipeline=null;postUniformBuffer=null;linearSampler=null;_postBindLayout=null;postExtractBindGroup=null;postBlurVBindGroup=null;postCompositeBindGroup=null;sceneTex=null;bloomTexA=null;bloomTexB=null;sceneTexView=null;bloomTexAView=null;bloomTexBView=null;texWidth=0;texHeight=0;postUniformCpu=new Float32Array(Re);uniformCpu=new Float32Array(qe);ready=!1;attemptedScene="";currentScene="";texture;scene;camera;material;quad;width;height;params={...Ve};timeStart=performance.now();accHue=0;smoother=new Ie;constructor(e,s){this.width=e,this.height=s,this.canvas=document.createElement("canvas"),this.canvas.width=e,this.canvas.height=s,this.canvas.style.cssText="position:absolute;top:-99999px;left:-99999px;pointer-events:none;",document.body.appendChild(this.canvas),this.texture=new oe(this.canvas),this.texture.colorSpace=ae,this.texture.minFilter=Y,this.texture.magFilter=Y,this.texture.generateMipmaps=!1,this.texture.flipY=!1,this.scene=new ne,this.camera=new le(-1,1,1,-1,0,1),this.material=new ce({map:this.texture,transparent:!0,depthTest:!1,depthWrite:!1,premultipliedAlpha:!0}),this.quad=new ue(new de(2,2),this.material),this.scene.add(this.quad),this._initWebGPU()}init(e){}setParams(e){Object.assign(this.params,e),e.scenePreset!==void 0&&e.scenePreset!==this.attemptedScene&&this.device&&this._buildScenePipeline().catch(s=>console.warn("[GhostFX] scene rebuild failed",s))}resize(e,s){e===this.width&&s===this.height||(this.width=e,this.height=s,this.canvas.width=e,this.canvas.height=s,this.device&&this._allocateTextures())}render(e,s,u,r){if(!this.ready||!this.device||!this.context||!this.scenePipeline||!this.sceneUniformBuffer||!this.sceneBindGroup||!this.postExtractPipeline||!this.postBlurVPipeline||!this.postCompositePipeline||!this.sceneTexView||!this.bloomTexAView||!this.bloomTexBView)return;const t=this.smoother.step(r,u,this.params.sensitivity);this.accHue=(this.accHue+r*this.params.hueDriftSpeed*.04)%1;const o=this.uniformCpu;o[0]=this.width,o[1]=this.height,o[2]=(performance.now()-this.timeStart)/1e3,o[3]=r,o[4]=t.bassSlow,o[5]=t.midSlow,o[6]=t.trebSlow,o[7]=t.bassFast,o[8]=t.midFast,o[9]=t.trebFast,o[10]=t.energy,o[11]=t.beatPhase,o[12]=t.beatPulse,o[13]=t.amp,o[14]=this.accHue,o[15]=this.params.exposure,o[16]=this.params.latticeThreshold*(.6+t.energy*.8),o[17]=this.params.vortexStrength,o[18]=this.params.ribbonWidth,o[19]=this.params.ribbonTranslucency;{const i=this.params.lightAzimuth*Math.PI/180,f=this.params.lightElevation*Math.PI/180;o[20]=Math.cos(f)*Math.sin(i),o[21]=Math.sin(f),o[22]=Math.cos(f)*Math.cos(i),o[23]=this.params.lightStrength}o[24]=this.params.ambient,o[25]=this.params.ribbonSpawn,this.device.queue.writeBuffer(this.sceneUniformBuffer,0,o.buffer,o.byteOffset,o.byteLength);const c=this.postUniformCpu;c[0]=this.width,c[1]=this.height,c[2]=this.params.bloomThreshold,c[3]=this.params.bloomIntensity,c[4]=this.params.exposure,c[5]=this.params.vignette,c[6]=this.params.feedbackAmount,c[7]=this.params.feedbackZoom,this.device.queue.writeBuffer(this.postUniformBuffer,0,c.buffer,c.byteOffset,c.byteLength);const n=this.device.createCommandEncoder({label:"ghostfx"});if(this.currentScene==="liquid"&&this._renderLiquid(n,t,r),this.computePipeline){const i=n.beginComputePass({label:"ghostfx:drift:advect"});i.setPipeline(this.computePipeline),i.setBindGroup(0,this.driftComputeBindGroup),i.dispatchWorkgroups(this._computeDispatchCount),i.end()}{const i=this.currentScene==="liquid"||this.params.bgAlpha>.001,f=n.beginRenderPass({colorAttachments:[{view:this.sceneTexView,clearValue:{r:0,g:0,b:0,a:i?1:0},loadOp:"clear",storeOp:"store"}],label:"ghostfx:bg"});i&&(f.setPipeline(this.scenePipeline),f.setBindGroup(0,this.sceneBindGroup),f.draw(3)),f.end()}if(this.trailPipeline&&this.params.trailIntensity>.001){const i=n.beginRenderPass({colorAttachments:[{view:this.sceneTexView,loadOp:"load",storeOp:"store"}],label:"ghostfx:trails"});i.setPipeline(this.trailPipeline),i.setBindGroup(0,this.sceneBindGroup),i.draw(2*(R-1)*A),i.end()}if(this.currentScene==="ribbons"&&this._ribbonPipelines&&(this.particlePipeline=this._ribbonPipelines[this.params.ribbonBlend]??this._ribbonPipelines.additive),this.particlePipeline){const i=n.beginRenderPass({colorAttachments:[{view:this.sceneTexView,loadOp:"load",storeOp:"store"}],label:"ghostfx:particles"});i.setPipeline(this.particlePipeline),i.setBindGroup(0,this.sceneBindGroup),i.draw(this._particleVertCount,this._particleInstCount),i.end()}if(this.latticePipeline&&this.params.latticeThreshold>.001){const i=n.beginRenderPass({colorAttachments:[{view:this.sceneTexView,loadOp:"load",storeOp:"store"}],label:"ghostfx:lattice"});i.setPipeline(this.latticePipeline),i.setBindGroup(0,this.sceneBindGroup),i.draw(2*A),i.end()}{const i=n.beginRenderPass({colorAttachments:[{view:this.bloomTexAView,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});i.setPipeline(this.postExtractPipeline),i.setBindGroup(0,this.postExtractBindGroup),i.draw(3),i.end()}{const i=n.beginRenderPass({colorAttachments:[{view:this.bloomTexBView,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});i.setPipeline(this.postBlurVPipeline),i.setBindGroup(0,this.postBlurVBindGroup),i.draw(3),i.end()}{const i=this.context.getCurrentTexture().createView(),f=n.beginRenderPass({colorAttachments:[{view:i,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});f.setPipeline(this.postCompositePipeline),f.setBindGroup(0,this.postCompositeBindGroup),f.draw(3),f.end()}this.device.queue.submit([n.finish()]),this.texture.needsUpdate=!0;const d=e.getRenderTarget();e.setRenderTarget(s);const a=new pe,p=e.getClearAlpha();e.getClearColor(a),e.setClearColor(0,0),e.clear(!0,!0,!1),e.render(this.scene,this.camera),e.setClearColor(a,p),e.setRenderTarget(d)}dispose(){try{this.sceneUniformBuffer?.destroy()}catch{}try{this.postUniformBuffer?.destroy()}catch{}try{this.sceneTex?.destroy()}catch{}try{this.bloomTexA?.destroy()}catch{}try{this.bloomTexB?.destroy()}catch{}try{this.particleBuffer?.destroy()}catch{}try{this.trailBuffer?.destroy()}catch{}if(this.sceneUniformBuffer=null,this.postUniformBuffer=null,this.scenePipeline=null,this.particlePipeline=null,this.trailPipeline=null,this.latticePipeline=null,this.computePipeline=null,this.particleBuffer=null,this.trailBuffer=null,this.sceneBindGroup=null,this.driftComputeBindGroup=null,this._ribbonPipelines=null,this._liquidTextures){try{this._liquidTextures.velA?.destroy()}catch{}try{this._liquidTextures.velB?.destroy()}catch{}try{this._liquidTextures.dyeA?.destroy()}catch{}try{this._liquidTextures.dyeB?.destroy()}catch{}try{this._liquidTextures.presA?.destroy()}catch{}try{this._liquidTextures.presB?.destroy()}catch{}try{this._liquidTextures.div?.destroy()}catch{}}try{this._liquidUniformBuffer?.destroy()}catch{}try{this._liquidSplatBuffer?.destroy()}catch{}this._liquidTextures=null,this._liquidPipelines=null,this._liquidBindGroups=null,this._liquidUniformBuffer=null,this._liquidSplatBuffer=null,this.postExtractPipeline=null,this.postBlurVPipeline=null,this.postCompositePipeline=null,this.postExtractBindGroup=null,this.postBlurVBindGroup=null,this.postCompositeBindGroup=null,this.sceneTex=this.bloomTexA=this.bloomTexB=null,this.sceneTexView=this.bloomTexAView=this.bloomTexBView=null,this.linearSampler=null;try{this.context?.unconfigure?.()}catch{}this.context=null,this.texture.dispose(),this.material.dispose(),this.quad.geometry.dispose();try{this.canvas.remove()}catch{}this.ready=!1}isReady(){return this.ready}async _initWebGPU(){try{const{device:e,presentFormat:s}=await se();if(this.device=e,this.presentFormat=s,this.context=this.canvas.getContext("webgpu"),!this.context)throw new Error('canvas.getContext("webgpu") returned null');this.context.configure({device:this.device,format:this.presentFormat,alphaMode:"premultiplied"}),this.sceneUniformBuffer=this.device.createBuffer({size:K,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:"ghostfx:sceneUniforms"}),this.postUniformBuffer=this.device.createBuffer({size:Z,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:"ghostfx:postUniforms"}),this.linearSampler=this.device.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this._allocateTextures(),await this._buildPostPipelines(),await this._buildScenePipeline(),this.ready=!0}catch(e){console.warn("[GhostFX] WebGPU init failed",e),this.ready=!1}}_allocateTextures(){if(!this.device)return;try{this.sceneTex?.destroy()}catch{}try{this.bloomTexA?.destroy()}catch{}try{this.bloomTexB?.destroy()}catch{}this.texWidth=this.width,this.texHeight=this.height;const e=Math.max(1,Math.floor(this.width/2)),s=Math.max(1,Math.floor(this.height/2)),u="rgba16float",r=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING;this.sceneTex=this.device.createTexture({size:[this.width,this.height],format:u,usage:r,label:"ghostfx:sceneTex"}),this.bloomTexA=this.device.createTexture({size:[e,s],format:u,usage:r,label:"ghostfx:bloomA"}),this.bloomTexB=this.device.createTexture({size:[e,s],format:u,usage:r,label:"ghostfx:bloomB"}),this.sceneTexView=this.sceneTex.createView(),this.bloomTexAView=this.bloomTexA.createView(),this.bloomTexBView=this.bloomTexB.createView(),this._rebuildPostBindGroups()}async _buildPostPipelines(){if(!this.device)return;const e=this.device.createShaderModule({code:Le,label:"ghostfx:post"}),u=((await e.getCompilationInfo?.())?.messages??[]).filter(c=>c.type==="error");if(u.length){for(const c of u)console.error(`[GhostFX] WGSL post ${c.lineNum}:${c.linePos}: ${c.message}`);throw new Error("post shader compile failed")}const r="rgba16float",t=this.device.createBindGroupLayout({label:"ghostfx:postBindLayout",entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}}]}),o=this.device.createPipelineLayout({label:"ghostfx:postPipelineLayout",bindGroupLayouts:[t]});this._postBindLayout=t,this.postExtractPipeline=this.device.createRenderPipeline({layout:o,label:"ghostfx:extract+hBlur",vertex:{module:e,entryPoint:"vsMain"},fragment:{module:e,entryPoint:"fsExtractHBlur",targets:[{format:r}]},primitive:{topology:"triangle-list"}}),this.postBlurVPipeline=this.device.createRenderPipeline({layout:o,label:"ghostfx:vBlur",vertex:{module:e,entryPoint:"vsMain"},fragment:{module:e,entryPoint:"fsVBlur",targets:[{format:r}]},primitive:{topology:"triangle-list"}}),this.postCompositePipeline=this.device.createRenderPipeline({layout:o,label:"ghostfx:composite",vertex:{module:e,entryPoint:"vsMain"},fragment:{module:e,entryPoint:"fsComposite",targets:[{format:this.presentFormat}]},primitive:{topology:"triangle-list"}}),this._rebuildPostBindGroups()}_rebuildPostBindGroups(){!this.device||!this.postExtractPipeline||!this.postBlurVPipeline||!this.postCompositePipeline||!this.sceneTexView||!this.bloomTexAView||!this.bloomTexBView||this._postBindLayout&&(this.device.pushErrorScope?.("validation"),this.postExtractBindGroup=this.device.createBindGroup({layout:this._postBindLayout,label:"ghostfx:extractBG",entries:[{binding:0,resource:{buffer:this.postUniformBuffer}},{binding:1,resource:this.linearSampler},{binding:2,resource:this.sceneTexView},{binding:3,resource:this.sceneTexView}]}),this.postBlurVBindGroup=this.device.createBindGroup({layout:this._postBindLayout,label:"ghostfx:vBlurBG",entries:[{binding:0,resource:{buffer:this.postUniformBuffer}},{binding:1,resource:this.linearSampler},{binding:2,resource:this.bloomTexAView},{binding:3,resource:this.bloomTexAView}]}),this.postCompositeBindGroup=this.device.createBindGroup({layout:this._postBindLayout,label:"ghostfx:compositeBG",entries:[{binding:0,resource:{buffer:this.postUniformBuffer}},{binding:1,resource:this.linearSampler},{binding:2,resource:this.sceneTexView},{binding:3,resource:this.bloomTexBView}]}),this.device.popErrorScope?.().then(e=>{e&&console.error("[GhostFX] bind group validation error:",e.message)}))}async _checkModule(e,s){try{const r=((await s.getCompilationInfo?.())?.messages??[]).filter(t=>t.type==="error");if(r.length){for(const t of r)console.error(`[GhostFX] WGSL ${e} ${t.lineNum}:${t.linePos}: ${t.message}`);return!1}}catch{}return!0}async _buildScenePipeline(){if(!this.device||!this.sceneUniformBuffer)return;const e=this.params.scenePreset||"drift";if(this.attemptedScene=e,e==="drift"){const r=be(A,R),t=this.device.createShaderModule({code:r.compute,label:"ghostfx:drift:compute"}),o=this.device.createShaderModule({code:r.render,label:"ghostfx:drift:render"}),c=await this._checkModule("drift:compute",t),n=await this._checkModule("drift:render",o);if(!c||!n){this.ready=!1;return}this._buildDriftPipelines(t,o),this.currentScene=e;return}if(e==="ribbons"){const r=ye(I,U),t=this.device.createShaderModule({code:r.compute,label:"ghostfx:ribbons:compute"}),o=this.device.createShaderModule({code:r.render,label:"ghostfx:ribbons:render"}),c=await this._checkModule("ribbons:compute",t),n=await this._checkModule("ribbons:render",o);if(!c||!n){this.ready=!1;return}this._buildRibbonsPipelines(t,o),this.currentScene=e;return}if(e==="liquid"){const r=this.device.createShaderModule({code:Be,label:"ghostfx:liquid:splat"}),t=this.device.createShaderModule({code:_e,label:"ghostfx:liquid:advectVel"}),o=this.device.createShaderModule({code:Pe,label:"ghostfx:liquid:divergence"}),c=this.device.createShaderModule({code:we,label:"ghostfx:liquid:jacobi"}),n=this.device.createShaderModule({code:Se,label:"ghostfx:liquid:subtract"}),d=this.device.createShaderModule({code:Ae,label:"ghostfx:liquid:advectDye"}),a=this.device.createShaderModule({code:Te,label:"ghostfx:liquid:render"});if((await Promise.all([this._checkModule("liquid:splat",r),this._checkModule("liquid:advectVel",t),this._checkModule("liquid:divergence",o),this._checkModule("liquid:jacobi",c),this._checkModule("liquid:subtract",n),this._checkModule("liquid:advectDye",d),this._checkModule("liquid:render",a)])).some(i=>!i)){this.ready=!1;return}this._buildLiquidPipelines({modSplat:r,modAdvectVel:t,modDiv:o,modJacobi:c,modSubtract:n,modAdvectDye:d,modRender:a}),this.currentScene=e;return}const s=this._wgslForScene(e),u=this.device.createShaderModule({code:s,label:`ghostfx:${e}`});if(!await this._checkModule(e,u)){this.ready=!1;return}{const r=this.device.createBindGroupLayout({label:`ghostfx:${e}:bindLayout`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),t=this.device.createPipelineLayout({bindGroupLayouts:[r]});this.scenePipeline=this.device.createRenderPipeline({layout:t,label:`ghostfx:${e}`,vertex:{module:u,entryPoint:"vsMain"},fragment:{module:u,entryPoint:"fsMain",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}}),this.particlePipeline=null,this.trailPipeline=null,this.latticePipeline=null,this.computePipeline=null,this.sceneBindGroup=this.device.createBindGroup({layout:r,entries:[{binding:0,resource:{buffer:this.sceneUniformBuffer}}]})}this.currentScene=e}_buildDriftPipelines(e,s){if(!this.device||!this.sceneUniformBuffer)return;const u=A*32,r=A*R*16;if(!this.particleBuffer||this.particleBuffer.size!==u){try{this.particleBuffer?.destroy()}catch{}this.particleBuffer=this.device.createBuffer({size:u,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:"ghostfx:drift:particles"});const d=new ArrayBuffer(u);this.device.queue.writeBuffer(this.particleBuffer,0,d)}if(!this.trailBuffer||this.trailBuffer.size!==r){try{this.trailBuffer?.destroy()}catch{}this.trailBuffer=this.device.createBuffer({size:r,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:"ghostfx:drift:trails"})}const t=this.device.createBindGroupLayout({label:"ghostfx:drift:computeBindLayout",entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),o=this.device.createBindGroupLayout({label:"ghostfx:drift:renderBindLayout",entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}}]}),c=this.device.createPipelineLayout({label:"ghostfx:drift:computePipelineLayout",bindGroupLayouts:[t]}),n=this.device.createPipelineLayout({label:"ghostfx:drift:renderPipelineLayout",bindGroupLayouts:[o]});this.computePipeline=this.device.createComputePipeline({layout:c,label:"ghostfx:drift:csAdvect",compute:{module:e,entryPoint:"csAdvect"}}),this.scenePipeline=this.device.createRenderPipeline({layout:n,label:"ghostfx:drift:bg",vertex:{module:s,entryPoint:"vsBg"},fragment:{module:s,entryPoint:"fsBg",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}}),this.trailPipeline=this.device.createRenderPipeline({layout:n,label:"ghostfx:drift:trails",vertex:{module:s,entryPoint:"vsTrail"},fragment:{module:s,entryPoint:"fsTrail",targets:[{format:"rgba16float",blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"line-list"}}),this.particlePipeline=this.device.createRenderPipeline({layout:n,label:"ghostfx:drift:particles",vertex:{module:s,entryPoint:"vsParticle"},fragment:{module:s,entryPoint:"fsParticle",targets:[{format:"rgba16float",blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.latticePipeline=this.device.createRenderPipeline({layout:n,label:"ghostfx:drift:lattice",vertex:{module:s,entryPoint:"vsLattice"},fragment:{module:s,entryPoint:"fsLattice",targets:[{format:"rgba16float",blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"line-list"}}),this.driftComputeBindGroup=this.device.createBindGroup({layout:t,label:"ghostfx:drift:computeBindGroup",entries:[{binding:0,resource:{buffer:this.sceneUniformBuffer}},{binding:1,resource:{buffer:this.particleBuffer}},{binding:2,resource:{buffer:this.trailBuffer}}]}),this.sceneBindGroup=this.device.createBindGroup({layout:o,label:"ghostfx:drift:renderBindGroup",entries:[{binding:0,resource:{buffer:this.sceneUniformBuffer}},{binding:1,resource:{buffer:this.particleBuffer}},{binding:2,resource:{buffer:this.trailBuffer}}]}),this._particleVertCount=6,this._particleInstCount=A,this._computeDispatchCount=Math.ceil(A/64)}_buildRibbonsPipelines(e,s){if(!this.device||!this.sceneUniformBuffer)return;const u=I*32,r=I*U*16;if(!this.particleBuffer||this.particleBuffer.size!==u){try{this.particleBuffer?.destroy()}catch{}this.particleBuffer=this.device.createBuffer({size:u,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:"ghostfx:ribbons:particles"});const a=new ArrayBuffer(u);this.device.queue.writeBuffer(this.particleBuffer,0,a)}if(!this.trailBuffer||this.trailBuffer.size!==r){try{this.trailBuffer?.destroy()}catch{}this.trailBuffer=this.device.createBuffer({size:r,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:"ghostfx:ribbons:trails"});const a=new Float32Array(r/4);for(let p=0;p<a.length;p+=4)a[p+0]=1e4,a[p+1]=1e4,a[p+2]=1e4,a[p+3]=-1;this.device.queue.writeBuffer(this.trailBuffer,0,a)}const t=this.device.createBindGroupLayout({label:"ghostfx:ribbons:computeBindLayout",entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),o=this.device.createBindGroupLayout({label:"ghostfx:ribbons:renderBindLayout",entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}}]}),c=this.device.createPipelineLayout({label:"ghostfx:ribbons:computePipelineLayout",bindGroupLayouts:[t]}),n=this.device.createPipelineLayout({label:"ghostfx:ribbons:renderPipelineLayout",bindGroupLayouts:[o]});this.computePipeline=this.device.createComputePipeline({layout:c,label:"ghostfx:ribbons:csAdvect",compute:{module:e,entryPoint:"csAdvect"}}),this.scenePipeline=this.device.createRenderPipeline({layout:n,label:"ghostfx:ribbons:bg",vertex:{module:s,entryPoint:"vsBg"},fragment:{module:s,entryPoint:"fsBg",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}});const d=(a,p)=>this.device.createRenderPipeline({layout:n,label:a,vertex:{module:s,entryPoint:"vsRibbon"},fragment:{module:s,entryPoint:"fsRibbon",targets:[{format:"rgba16float",blend:p}]},primitive:{topology:"triangle-list"}});this._ribbonPipelines={additive:d("ghostfx:ribbons:strip:additive",{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}),lighten:d("ghostfx:ribbons:strip:lighten",{color:{srcFactor:"one",dstFactor:"one",operation:"max"},alpha:{srcFactor:"one",dstFactor:"one",operation:"max"}}),glass:d("ghostfx:ribbons:strip:glass",{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}})},this.particlePipeline=this._ribbonPipelines.additive,this.trailPipeline=null,this.latticePipeline=null,this.driftComputeBindGroup=this.device.createBindGroup({layout:t,label:"ghostfx:ribbons:computeBindGroup",entries:[{binding:0,resource:{buffer:this.sceneUniformBuffer}},{binding:1,resource:{buffer:this.particleBuffer}},{binding:2,resource:{buffer:this.trailBuffer}}]}),this.sceneBindGroup=this.device.createBindGroup({layout:o,label:"ghostfx:ribbons:renderBindGroup",entries:[{binding:0,resource:{buffer:this.sceneUniformBuffer}},{binding:1,resource:{buffer:this.particleBuffer}},{binding:2,resource:{buffer:this.trailBuffer}}]}),this._particleVertCount=I*(U-1)*6,this._particleInstCount=1,this._computeDispatchCount=Math.ceil(I/64)}_buildLiquidPipelines(e){if(!this.device)return;const s=X,u=Math.max(8,Math.round(X*this.height/Math.max(this.width,1))),r=v=>this.device.createTexture({label:v,size:[s,u],format:"rgba16float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING}),t=r,o=r,c=r,n=t("ghostfx:liquid:velA"),d=t("ghostfx:liquid:velB"),a=o("ghostfx:liquid:dyeA"),p=o("ghostfx:liquid:dyeB"),i=c("ghostfx:liquid:presA"),f=c("ghostfx:liquid:presB"),b=c("ghostfx:liquid:div"),x=this.device.createSampler({label:"ghostfx:liquid:sampler",magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});if(this._liquidTextures={velA:n,velB:d,dyeA:a,dyeB:p,presA:i,presB:f,div:b,velAView:n.createView(),velBView:d.createView(),dyeAView:a.createView(),dyeBView:p.createView(),presAView:i.createView(),presBView:f.createView(),divView:b.createView(),sampler:x,simW:s,simH:u},this._liquidUniformBuffer)try{this._liquidUniformBuffer.destroy()}catch{}if(this._liquidUniformBuffer=this.device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:"ghostfx:liquid:uniforms"}),this._liquidSplatBuffer)try{this._liquidSplatBuffer.destroy()}catch{}this._liquidSplatBuffer=this.device.createBuffer({size:q*Q,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:"ghostfx:liquid:splats"});const h={compute:GPUShaderStage.COMPUTE,frag:GPUShaderStage.FRAGMENT,vert:GPUShaderStage.VERTEX},P={type:"uniform"},J={type:"read-only-storage"},B={sampleType:"unfilterable-float"},ee={sampleType:"float"},C=this.device.createBindGroupLayout({label:"ghostfx:liquid:splat:bl",entries:[{binding:0,visibility:h.compute,buffer:P},{binding:1,visibility:h.compute,buffer:J},{binding:2,visibility:h.compute,texture:B},{binding:3,visibility:h.compute,texture:B},{binding:4,visibility:h.compute,storageTexture:{access:"write-only",format:"rgba16float"}},{binding:5,visibility:h.compute,storageTexture:{access:"write-only",format:"rgba16float"}}]}),E=this.device.createBindGroupLayout({label:"ghostfx:liquid:advectVel:bl",entries:[{binding:0,visibility:h.compute,buffer:P},{binding:1,visibility:h.compute,texture:B},{binding:2,visibility:h.compute,storageTexture:{access:"write-only",format:"rgba16float"}}]}),D=this.device.createBindGroupLayout({label:"ghostfx:liquid:divergence:bl",entries:[{binding:0,visibility:h.compute,buffer:P},{binding:1,visibility:h.compute,texture:B},{binding:2,visibility:h.compute,storageTexture:{access:"write-only",format:"rgba16float"}}]}),M=this.device.createBindGroupLayout({label:"ghostfx:liquid:jacobi:bl",entries:[{binding:0,visibility:h.compute,buffer:P},{binding:1,visibility:h.compute,texture:B},{binding:2,visibility:h.compute,texture:B},{binding:3,visibility:h.compute,storageTexture:{access:"write-only",format:"rgba16float"}}]}),F=this.device.createBindGroupLayout({label:"ghostfx:liquid:subtract:bl",entries:[{binding:0,visibility:h.compute,buffer:P},{binding:1,visibility:h.compute,texture:B},{binding:2,visibility:h.compute,texture:B},{binding:3,visibility:h.compute,storageTexture:{access:"write-only",format:"rgba16float"}}]}),N=this.device.createBindGroupLayout({label:"ghostfx:liquid:advectDye:bl",entries:[{binding:0,visibility:h.compute,buffer:P},{binding:1,visibility:h.compute,texture:B},{binding:2,visibility:h.compute,texture:B},{binding:3,visibility:h.compute,storageTexture:{access:"write-only",format:"rgba16float"}}]}),z=this.device.createBindGroupLayout({label:"ghostfx:liquid:render:bl",entries:[{binding:0,visibility:h.vert|h.frag,buffer:P},{binding:1,visibility:h.frag,texture:ee},{binding:2,visibility:h.frag,sampler:{type:"filtering"}}]}),te=(v,g)=>this.device.createPipelineLayout({label:v,bindGroupLayouts:[g]}),L=(v,g,y,S)=>this.device.createComputePipeline({label:v,layout:te(`${v}:pl`,g),compute:{module:y,entryPoint:S}});this._liquidPipelines={splat:L("ghostfx:liquid:splat",C,e.modSplat,"csSplat"),advectVel:L("ghostfx:liquid:advectVel",E,e.modAdvectVel,"csAdvectVel"),divergence:L("ghostfx:liquid:divergence",D,e.modDiv,"csDivergence"),jacobi:L("ghostfx:liquid:jacobi",M,e.modJacobi,"csJacobi"),subtractGradient:L("ghostfx:liquid:subtractGradient",F,e.modSubtract,"csSubtractGradient"),advectDye:L("ghostfx:liquid:advectDye",N,e.modAdvectDye,"csAdvectDye"),render:this.device.createRenderPipeline({label:"ghostfx:liquid:render",layout:this.device.createPipelineLayout({bindGroupLayouts:[z]}),vertex:{module:e.modRender,entryPoint:"vsRender"},fragment:{module:e.modRender,entryPoint:"fsRender",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}})},this.scenePipeline=this._liquidPipelines.render;const l=this._liquidTextures,w=this._liquidUniformBuffer,ie=this._liquidSplatBuffer,G=(v,g,y,S,re)=>this.device.createBindGroup({label:re,layout:C,entries:[{binding:0,resource:{buffer:w}},{binding:1,resource:{buffer:ie}},{binding:2,resource:v},{binding:3,resource:g},{binding:4,resource:y},{binding:5,resource:S}]}),O=(v,g,y)=>this.device.createBindGroup({label:y,layout:E,entries:[{binding:0,resource:{buffer:w}},{binding:1,resource:v},{binding:2,resource:g}]}),k=(v,g)=>this.device.createBindGroup({label:g,layout:D,entries:[{binding:0,resource:{buffer:w}},{binding:1,resource:v},{binding:2,resource:l.divView}]}),j=(v,g,y)=>this.device.createBindGroup({label:y,layout:M,entries:[{binding:0,resource:{buffer:w}},{binding:1,resource:v},{binding:2,resource:l.divView},{binding:3,resource:g}]}),H=(v,g,y,S)=>this.device.createBindGroup({label:S,layout:F,entries:[{binding:0,resource:{buffer:w}},{binding:1,resource:v},{binding:2,resource:g},{binding:3,resource:y}]}),V=(v,g,y,S)=>this.device.createBindGroup({label:S,layout:N,entries:[{binding:0,resource:{buffer:w}},{binding:1,resource:v},{binding:2,resource:g},{binding:3,resource:y}]}),W=(v,g)=>this.device.createBindGroup({label:g,layout:z,entries:[{binding:0,resource:{buffer:w}},{binding:1,resource:v},{binding:2,resource:l.sampler}]});this._liquidBindGroups={splat_vA_dA:G(l.velAView,l.dyeAView,l.velBView,l.dyeBView,"splat:vA_dA"),splat_vA_dB:G(l.velAView,l.dyeBView,l.velBView,l.dyeAView,"splat:vA_dB"),splat_vB_dA:G(l.velBView,l.dyeAView,l.velAView,l.dyeBView,"splat:vB_dA"),splat_vB_dB:G(l.velBView,l.dyeBView,l.velAView,l.dyeAView,"splat:vB_dB"),advectVelAB:O(l.velAView,l.velBView,"advectVel:AB"),advectVelBA:O(l.velBView,l.velAView,"advectVel:BA"),divergenceA:k(l.velAView,"div:A"),divergenceB:k(l.velBView,"div:B"),jacobiAB:j(l.presAView,l.presBView,"jacobi:AB"),jacobiBA:j(l.presBView,l.presAView,"jacobi:BA"),subtractAB:H(l.velAView,l.presAView,l.velBView,"subtract:AB"),subtractBA:H(l.velBView,l.presAView,l.velAView,"subtract:BA"),advectDye_vA_dA:V(l.dyeAView,l.velAView,l.dyeBView,"advectDye:vA_dA"),advectDye_vA_dB:V(l.dyeBView,l.velAView,l.dyeAView,"advectDye:vA_dB"),advectDye_vB_dA:V(l.dyeAView,l.velBView,l.dyeBView,"advectDye:vB_dA"),advectDye_vB_dB:V(l.dyeBView,l.velBView,l.dyeAView,"advectDye:vB_dB"),renderA:W(l.dyeAView,"render:A"),renderB:W(l.dyeBView,"render:B")},this.particlePipeline=null,this.trailPipeline=null,this.latticePipeline=null,this.computePipeline=null,this._particleVertCount=0,this._particleInstCount=0,this._computeDispatchCount=0,this.sceneBindGroup=this._liquidBindGroups.renderA,this._liquidVelIsA=!0,this._liquidDyeIsA=!0,this._liquidPrevBeatPulse=0,this._liquidAmbientAcc=0}_scheduleLiquidSplats(e,s){const u=this._liquidSplatCpu;let r=0;const t=(c,n,d)=>{const a=Math.floor(c*6),p=c*6-a,i=d*(1-n),f=d*(1-p*n),b=d*(1-(1-p)*n);switch(a%6){case 0:return[d,b,i];case 1:return[f,d,i];case 2:return[i,d,b];case 3:return[i,f,d];case 4:return[b,i,d];default:return[d,i,f]}},o=(c,n,d,a,p,i,f,b)=>{if(r>=q)return;const x=r*8;u[x+0]=c,u[x+1]=n,u[x+2]=d,u[x+3]=a,u[x+4]=p,u[x+5]=i,u[x+6]=f,u[x+7]=b,r++};if(e.beatPulse>.5&&this._liquidPrevBeatPulse<.3){const c=1+(e.energy>.4?1:0);for(let n=0;n<c;n++){const d=(this.accHue+Math.random()*.4)%1,[a,p,i]=t(d,.9,1),f=[Math.random(),Math.random()],b=Math.random()*Math.PI*2,x=.4+e.energy*.8;o(f[0],f[1],Math.cos(b)*x,Math.sin(b)*x,a,p,i,this.params.liquidSplatRadius*1.4)}}for(this._liquidPrevBeatPulse=e.beatPulse,this._liquidAmbientAcc+=s*(.8+e.bassSlow*10)*Math.max(this.params.liquidBassRate,0);this._liquidAmbientAcc>1&&r<q;){this._liquidAmbientAcc-=1;const c=(this.accHue+Math.random()*.6)%1,[n,d,a]=t(c,.75,.95),p=[Math.random(),Math.random()],i=Math.random()*Math.PI*2,f=.15+e.energy*.3;o(p[0],p[1],Math.cos(i)*f,Math.sin(i)*f,n,d,a,this.params.liquidSplatRadius*(.5+Math.random()*.5))}return r>0&&this.device.queue.writeBuffer(this._liquidSplatBuffer,0,u.buffer,0,r*Q),r}_writeLiquidUniforms(e,s,u){const r=this._liquidTextures,t=this._liquidUniformF32,o=this._liquidUniformU32;t[0]=r.simW,t[1]=r.simH,t[2]=this.width,t[3]=this.height,t[4]=(performance.now()-this.timeStart)/1e3,t[5]=s,t[6]=e.bassSlow,t[7]=e.midSlow,t[8]=e.trebSlow,t[9]=e.energy,t[10]=e.beatPhase,t[11]=e.beatPulse,t[12]=this.accHue,t[13]=this.params.exposure,t[14]=this.params.liquidSplatForce,t[15]=this.params.liquidSplatRadius,t[16]=this.params.liquidDyeDecay,t[17]=this.params.liquidVelDecay,o[18]=u,this.device.queue.writeBuffer(this._liquidUniformBuffer,0,this._liquidUniformCpu)}_renderLiquid(e,s,u){if(!this._liquidPipelines||!this._liquidBindGroups||!this._liquidTextures)return;const r=this._liquidPipelines,t=this._liquidBindGroups,o=this._liquidTextures,c=this._scheduleLiquidSplats(s,u);this._writeLiquidUniforms(s,u,c);const n=Math.ceil(o.simW/8),d=Math.ceil(o.simH/8),a=e.beginComputePass({label:"ghostfx:liquid"});if(c>0){a.setPipeline(r.splat);let i;this._liquidVelIsA&&this._liquidDyeIsA?i=t.splat_vA_dA:this._liquidVelIsA&&!this._liquidDyeIsA?i=t.splat_vA_dB:!this._liquidVelIsA&&this._liquidDyeIsA?i=t.splat_vB_dA:i=t.splat_vB_dB,a.setBindGroup(0,i),a.dispatchWorkgroups(n,d),this._liquidVelIsA=!this._liquidVelIsA,this._liquidDyeIsA=!this._liquidDyeIsA}a.setPipeline(r.advectVel),a.setBindGroup(0,this._liquidVelIsA?t.advectVelAB:t.advectVelBA),a.dispatchWorkgroups(n,d),this._liquidVelIsA=!this._liquidVelIsA,a.setPipeline(r.divergence),a.setBindGroup(0,this._liquidVelIsA?t.divergenceA:t.divergenceB),a.dispatchWorkgroups(n,d);for(let i=0;i<Ge;i++)a.setPipeline(r.jacobi),a.setBindGroup(0,i%2===0?t.jacobiAB:t.jacobiBA),a.dispatchWorkgroups(n,d);a.setPipeline(r.subtractGradient),a.setBindGroup(0,this._liquidVelIsA?t.subtractAB:t.subtractBA),a.dispatchWorkgroups(n,d),this._liquidVelIsA=!this._liquidVelIsA,a.setPipeline(r.advectDye);let p;this._liquidVelIsA&&this._liquidDyeIsA?p=t.advectDye_vA_dA:this._liquidVelIsA&&!this._liquidDyeIsA?p=t.advectDye_vA_dB:!this._liquidVelIsA&&this._liquidDyeIsA?p=t.advectDye_vB_dA:p=t.advectDye_vB_dB,a.setBindGroup(0,p),a.dispatchWorkgroups(n,d),this._liquidDyeIsA=!this._liquidDyeIsA,a.end(),this.sceneBindGroup=this._liquidDyeIsA?t.renderA:t.renderB}_wgslForScene(e){return`
      struct Uniforms { resolution: vec2<f32> };
      @group(0) @binding(0) var<uniform> u: Uniforms;
      struct VsOut { @builtin(position) pos: vec4<f32> };
      @vertex fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
        let x = f32(((vid << 1u) & 2u));
        let y = f32(vid & 2u);
        var out: VsOut;
        out.pos = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
        return out;
      }
      @fragment fn fsMain() -> @location(0) vec4<f32> { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    `}}export{Ne as GhostFXVisualizer};
