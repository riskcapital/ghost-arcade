/**
 * WebGPUParticleField — a one-shader particle universe.
 *
 * The goal is to feel both sub-atomic and galactic depending on the
 * mode, with a connections layer that reads as a cellular scaffold
 * stitching particles together. Everything runs on the GPU; the only
 * CPU work per frame is param packing.
 *
 * BEHAVIOR MODES (selected by `mode` uniform; compute branches on it):
 *   galaxy  — logarithmic spiral; particles ride curving arms with
 *             differential rotation (inner faster than outer)
 *   atomic  — N nucleus points with electron shells orbiting each;
 *             shells rotate at different speeds, particles wobble
 *             radially. Reads as molecular / sub-atomic
 *   swarm   — boid-style flock; cohesion + separation + alignment
 *             with curl-noise turbulence
 *   lattice — particles bound to a 3D grid; vibrate around their
 *             lattice site, audio-reactive vibration amplitude
 *   field   — pure curl-noise drift around home positions
 *   media   — positions sampled from an image / video luminance map;
 *             classic Refik-style media-driven particle field
 *   gravity — particles fall through orbiting gravity wells with
 *             core repulsion, velocity clamp, and audio-expanded
 *             attractor radius. Inspired by WebGPU compute-body demos,
 *             but implemented in this renderer's WGSL pipeline.
 *
 * TOPOLOGIES (per-particle render primitive):
 *   points  — sharp dots (cheap, classic)
 *   glow    — soft additive billboard (the "star field" look)
 *   streaks — velocity-extruded quads (motion trails)
 *   sphere  — billboard sphere impostor with diffuse/specular material
 *             lighting and a cheap reflective environment
 *   softSphere — larger shaded sphere impostors with varied radii,
 *             depth testing, soft edges, and pastel volumetric mass
 *
 * CONNECTIONS (toggle):
 *   For each particle we deterministically pick K "partner candidates"
 *   based on a hash of the particle id. Per frame, a compute pass
 *   visits each (i, partner) pair, computes distance, and writes an
 *   edge entry into a shared edge buffer if the distance falls in
 *   one of the configured radii — local (close) or bridge (medium).
 *   The edge buffer is a `drawIndirect`-compatible target so the
 *   line render pass consumes exactly the number of edges written
 *   this frame without a CPU readback.
 *
 *   This is a stylistic neighbor search, not a true k-NN — the
 *   partners are randomly assigned by hash so the connection graph
 *   has a pleasing irregular topology rather than the rigid grid
 *   of a true spatial index. Visually compelling at 100K particles
 *   with ~16 partners each (1.6M pair checks/frame — fast).
 *
 * ATMOSPHERE:
 *   fog       — depth-based exponential falloff to a fog color
 *   lighting  — single directional light, dot product modulates
 *               brightness across all topologies; sphere topology
 *               gets a proper Lambert shade from its billboard UV
 *
 * Particle layout (64 bytes per particle, std430-aligned):
 *   pos:   vec3<f32>  alpha: f32
 *   vel:   vec3<f32>  size:  f32
 *   color: vec3<f32>  life:  f32
 *   group: u32        age:   f32  _pad: vec2<f32>
 *
 * Edge layout (16 bytes per edge):
 *   particle_i: u32, particle_j: u32, type: u32 (0=local, 1=bridge), _pad: u32
 *
 * The edge buffer's first 16 bytes are an indirect-draw header:
 *   [u32 vertex_count, u32 instance_count, u32 first_vertex, u32 first_instance]
 * vertex_count is constant 2 (lines), instance_count is atomically
 * incremented by the edge-gen compute pass.
 */

const PARTICLE_BYTES = 64;
const EDGE_BYTES = 16;
const DEFAULT_PARTICLES = 80_000;
const MAX_PARTICLES = 500_000;
const DEFAULT_PARTNERS = 16;
const MAX_EDGES = 600_000;

type BehaviorMode = 'galaxy' | 'atomic' | 'swarm' | 'lattice' | 'field' | 'media' | 'gravity';
type Topology     = 'points' | 'glow' | 'streaks' | 'sphere' | 'softSphere';

const MODE_ID: Record<BehaviorMode, number> = {
  'galaxy': 0, 'atomic': 1, 'swarm': 2, 'lattice': 3, 'field': 4, 'media': 5, 'gravity': 6,
};
const TOPO_ID: Record<Topology, number> = {
  'points': 0, 'glow': 1, 'streaks': 2, 'sphere': 3, 'softSphere': 4,
};

// Color enums shared with the rest of the GPU edition. Kept in lockstep
// with the WGSL switch ladders below.
export type ColorMode = 'solid' | 'gradient2' | 'gradient3' | 'palette4' | 'rainbow' | 'random' | 'group';
export type ColorMap  = 'index' | 'group' | 'radial' | 'y-axis' | 'speed' | 'depth-z' | 'noise';

const COLOR_MODE_ID: Record<ColorMode, number> = {
  'solid': 0, 'gradient2': 1, 'gradient3': 2, 'palette4': 3,
  'rainbow': 4, 'random': 5, 'group': 6,
};
const COLOR_MAP_ID: Record<ColorMap, number> = {
  'index': 0, 'group': 1, 'radial': 2, 'y-axis': 3,
  'speed': 4, 'depth-z': 5, 'noise': 6,
};

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}
function identityMat4(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI / 180) / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = far / (near - far); m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}
function translate(x: number, y: number, z: number): Float32Array {
  const m = identityMat4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/* ============================================================== */
/* BEHAVIOR COMPUTE — updates particle pos/vel per mode           */
/* ============================================================== */
const BEHAVIOR_WGSL = /* wgsl */ `
struct Particle {
  pos:   vec3<f32>, alpha: f32,
  vel:   vec3<f32>, size:  f32,
  color: vec3<f32>, life:  f32,
  group: u32, age: f32, _pad0: f32, _pad1: f32,
};

struct U {
  // Block 0 — core
  dt: f32, time: f32, pointCount: u32, baseSize: f32,
  // Block 1 — mode + flags
  mode: u32, topology: u32, connectEnabled: u32, _pad0: u32,
  // Block 2 — motion
  windStrength: f32, windScale: f32, anchorPull: f32, damping: f32,
  // Block 3 — audio
  bass: f32, treble: f32, burstImpulse: f32, shimmerStrength: f32,
  // Block 4 — galaxy params
  galaxyArms: f32, galaxyRotateInner: f32, galaxyRotateOuter: f32, galaxyTilt: f32,
  // Block 5 — atomic params
  atomicNuclei: f32, atomicShells: f32, atomicShellSpacing: f32, atomicOrbitSpeed: f32,
  // Block 6 — swarm params
  swarmCohesion: f32, swarmSeparation: f32, swarmAlignment: f32, swarmRange: f32,
  // Block 7 — lattice params
  latticeSize: f32, latticeSpacing: f32, latticeVibration: f32, _pad1: f32,
  // Block 8 — media params
  mediaDepthAmount: f32, mediaSampleScale: f32, _pad2: f32, _pad3: f32,
  // Block 9 — fog + light
  fogDensity: f32, lightX: f32, lightY: f32, lightZ: f32,
  // Block 10 — color basics
  saturation: f32, brightness: f32, colorMode: u32, colorMap: u32,
  // Block 11 — color mix + map shaping
  colorMix: f32, colorMapScale: f32, colorMapOffset: f32, colorCycleOffset: f32,
  // Block 12 — random hue + hue shift
  randomSat: f32, randomVal: f32, hueShift: f32, _pad4: f32,
  // Blocks 13-16 — palette
  colorA: vec3<f32>, _padA: f32,
  colorB: vec3<f32>, _padB: f32,
  colorC: vec3<f32>, _padC: f32,
  colorD: vec3<f32>, _padD: f32,
  // Block 17 — gravity well params
  gravityWells: f32, gravityStrength: f32, gravityOrbit: f32, gravityCoreSize: f32,
  // Block 18 — gravity shaping
  gravityVortex: f32, gravityMaxVelocity: f32, gravityAudioDrive: f32, gravityChaos: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform>              u:         U;
@group(0) @binding(2) var                       mediaTex:  texture_2d<f32>;
@group(0) @binding(3) var                       mediaSamp: sampler;

// ── Helpers ─────────────────────────────────────────────────────
fn hash3(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7,  74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}
fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  let nxy0 = mix(nx00, nx10, s.y);
  let nxy1 = mix(nx01, nx11, s.y);
  return mix(nxy0, nxy1, s.z) * 2.0 - 1.0;
}
fn curl3(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = noise3(p + vec3<f32>(0.0,  e, 0.0));
  let ax2 = noise3(p + vec3<f32>(0.0, -e, 0.0));
  let ay1 = noise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = noise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  return vec3<f32>(ay1 - ay2, az1 - az2, ax1 - ax2) / (2.0 * e);
}
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  var p: vec4<f32>;
  if (c.g < c.b) { p = vec4<f32>(c.b, c.g, K.w, K.z); }
  else { p = vec4<f32>(c.g, c.b, K.x, K.y); }
  var q: vec4<f32>;
  if (c.r < p.x) { q = vec4<f32>(p.x, p.y, p.w, c.r); }
  else { q = vec4<f32>(c.r, p.y, p.z, p.x); }
  let d = q.x - min(q.w, q.y);
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// ── Behavior targets ───────────────────────────────────────────
// Each behavior returns a "target velocity" the particle smoothly
// blends toward. Keeping behaviors as velocity targets (not direct
// position writes) means audio bursts + shimmer + connections can
// all layer on top without fighting.

fn behaviorGalaxy(i: u32, p: Particle) -> vec3<f32> {
  // Particles ride a logarithmic spiral. Arm index from particle id.
  // Inner radius rotates faster than outer (differential rotation =
  // the visual signature of a real galaxy).
  let arms     = u.galaxyArms;
  let armIdx   = f32(p.group);
  let armPhase = armIdx / arms;
  let r        = length(vec2<f32>(p.pos.x, p.pos.z)) + 1e-4;
  let theta    = atan2(p.pos.z, p.pos.x);
  let innerFalloff = 1.0 - smoothstep(0.0, 1.0, r);
  let omega    = mix(u.galaxyRotateOuter, u.galaxyRotateInner, innerFalloff);
  // Target angle = current theta + omega; convert (r, theta+omega) to xz
  let nextTheta = theta + omega * u.dt;
  let tx = cos(nextTheta) * r;
  let tz = sin(nextTheta) * r;
  // Subtle vertical thickness modulated by radius (thinner at edge)
  let ty = mix(0.05, 0.0, smoothstep(0.0, 1.0, r)) * sin(p.pos.x * 7.0 + p.pos.z * 11.0);
  let targetPos = vec3<f32>(tx, ty + u.galaxyTilt * p.pos.x * 0.1, tz);
  return (targetPos - p.pos) / max(u.dt, 0.001);
}

fn behaviorAtomic(i: u32, p: Particle) -> vec3<f32> {
  // Each particle is assigned a (nucleus, shell) by its group id.
  // We orbit around its nucleus, on a tilted plane unique to the
  // shell. The shell radius determines orbital speed (closer = faster).
  let nuclei = max(1.0, floor(u.atomicNuclei));
  let nIdx = f32(p.group % u32(nuclei));
  let shellIdx = f32((p.group / u32(nuclei)) % u32(max(1.0, u.atomicShells)));
  // Nucleus position — N nuclei arranged on a unit circle.
  let nTheta = (nIdx / nuclei) * 6.2831853;
  let nucPos = vec3<f32>(cos(nTheta) * 0.5, 0.0, sin(nTheta) * 0.5);
  // Shell radius and tilt
  let r = (shellIdx + 1.0) * u.atomicShellSpacing;
  let tilt = nIdx * 0.731 + shellIdx * 1.13;
  let cosT = cos(tilt); let sinT = sin(tilt);
  // Orbital angle from particle id + time scaled by 1/r (Kepler-ish)
  let phase = f32(i) * 0.0173 + u.time * u.atomicOrbitSpeed / max(r, 0.05);
  // Position on tilted shell relative to nucleus
  let local = vec3<f32>(cos(phase) * r, sin(phase) * r * sinT, sin(phase) * r * cosT);
  let targetPos = nucPos + local;
  return (targetPos - p.pos) / max(u.dt, 0.001);
}

fn behaviorSwarm(i: u32, p: Particle) -> vec3<f32> {
  // Cheap boid analog: cohesion toward a moving "leader" attractor
  // (sin/cos of time), separation from a synthetic neighborhood
  // (use curl noise instead of true neighbor lookup to avoid the
  // cost of a real boid simulation at 100K particles), alignment
  // pushes velocity toward the curl direction.
  let leader = vec3<f32>(sin(u.time * 0.4) * 0.5, sin(u.time * 0.31) * 0.3, cos(u.time * 0.4) * 0.5);
  let cohesion = (leader - p.pos) * u.swarmCohesion;
  let flow = curl3(p.pos * u.swarmRange + vec3<f32>(0.0, 0.0, u.time * 0.3));
  let align = flow * u.swarmAlignment;
  // Pseudo-separation: random outward jitter so they don't collapse
  let n = vec3<f32>(
    hash3(p.pos * 3.1 + vec3<f32>(u.time, 0.0, 0.0)) * 2.0 - 1.0,
    hash3(p.pos * 3.1 + vec3<f32>(0.0, u.time, 0.0)) * 2.0 - 1.0,
    hash3(p.pos * 3.1 + vec3<f32>(0.0, 0.0, u.time)) * 2.0 - 1.0,
  );
  let separation = n * u.swarmSeparation;
  return cohesion + align + separation;
}

fn behaviorLattice(i: u32, p: Particle) -> vec3<f32> {
  // Each particle has a deterministic lattice site derived from its
  // id. Vibration amplitude = base + audio bass kick.
  let n = max(2.0, floor(u.latticeSize));
  let ix = f32(i % u32(n));
  let iy = f32((i / u32(n)) % u32(n));
  let iz = f32((i / (u32(n) * u32(n))) % u32(n));
  let cx = (ix / n - 0.5) * u.latticeSpacing;
  let cy = (iy / n - 0.5) * u.latticeSpacing;
  let cz = (iz / n - 0.5) * u.latticeSpacing;
  // Vibration around the lattice site
  let amp = u.latticeVibration * (1.0 + u.bass * 2.0);
  let vibe = vec3<f32>(
    sin(u.time * 3.7 + f32(i)),
    cos(u.time * 4.1 + f32(i) * 1.3),
    sin(u.time * 2.9 + f32(i) * 0.7),
  ) * amp;
  let targetPos = vec3<f32>(cx, cy, cz) + vibe;
  return (targetPos - p.pos) / max(u.dt, 0.001);
}

fn behaviorField(i: u32, p: Particle) -> vec3<f32> {
  // Pure curl-noise drift — same engine as the flythrough / point
  // cloud, here applied as a velocity field that constantly stirs
  // the swarm. Anchor pull is OFF for this mode so particles keep
  // drifting freely.
  let flow = curl3(p.pos * u.windScale + vec3<f32>(0.0, 0.0, u.time * 0.1));
  return flow * u.windStrength * 6.0;
}

fn behaviorMedia(i: u32, p: Particle) -> vec3<f32> {
  // Sample the media texture at the particle's XY projection. The
  // particle's "home" position is its UV anchor (mapped to [-1, 1]
  // XY) with the depth derived from sampled luminance.
  let homeUV = vec2<f32>(
    (f32(i % 1024u) + 0.5) / 1024.0,
    (f32((i / 1024u) % 1024u) + 0.5) / 1024.0,
  );
  let homeXY = homeUV * 2.0 - 1.0;
  let texColor = textureSampleLevel(mediaTex, mediaSamp, homeUV * u.mediaSampleScale, 0.0);
  let lum = dot(texColor.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let z = (lum - 0.5) * u.mediaDepthAmount;
  let targetPos = vec3<f32>(homeXY.x, -homeXY.y, z);
  return (targetPos - p.pos) / max(u.dt, 0.001);
}

fn behaviorGravity(i: u32, p: Particle) -> vec3<f32> {
  // Multi-attractor particle-body field. Particles are assigned a
  // primary well by group, but every well contributes a softened force.
  // This gets the "compute-sim bodies around glowing masses" feeling
  // without an O(N^2) particle/particle collision pass.
  let wells = max(1.0, min(8.0, floor(u.gravityWells)));
  let audio = clamp(u.bass * 0.8 + u.treble * 0.25, 0.0, 1.5);
  let strength = u.gravityStrength * (1.0 + audio * u.gravityAudioDrive);
  let core = max(0.02, u.gravityCoreSize * (1.0 + audio * 0.9));
  let orbitT = u.time * u.gravityOrbit;

  var accel = vec3<f32>(0.0);
  for (var wi: u32 = 0u; wi < 8u; wi = wi + 1u) {
    if (f32(wi) >= wells) { break; }
    let wf = f32(wi);
    let phase = wf / wells * 6.2831853;
    let ring = mix(0.28, 0.88, fract(wf * 0.37 + 0.17));
    let wob = sin(orbitT * 0.73 + phase * 1.9) * 0.25;
    let center = vec3<f32>(
      cos(orbitT + phase) * ring,
      sin(orbitT * 0.41 + phase * 2.3) * 0.34,
      sin(orbitT * 1.13 + phase + wob) * ring,
    );

    let dv = center - p.pos;
    let d2 = dot(dv, dv) + 0.018;
    let d = sqrt(d2);
    let dir = dv / max(d, 1e-4);
    let primary = select(0.45, 1.0, (p.group % u32(wells)) == wi);
    let pull = dir * (strength * primary / d2);

    // Tangential swirl turns a raw point attractor into a theatrical
    // orbital well. Alternate handedness so multiple wells braid.
    let up = normalize(vec3<f32>(
      sin(phase + 0.3),
      1.25,
      cos(phase * 1.7 + 0.2),
    ));
    let tangent = normalize(cross(dir, up) + vec3<f32>(1e-4, 0.0, 0.0));
    let spinSign = select(-1.0, 1.0, (wi % 2u) == 0u);
    let spin = tangent * spinSign * u.gravityVortex * primary / max(d, 0.14);

    // Core repulsion mimics collision separation from the central body:
    // near the well, particles are pushed out instead of collapsing.
    let repelMask = 1.0 - smoothstep(core * 0.45, core * 2.2, d);
    let repel = -dir * repelMask * strength * 2.2;
    accel = accel + pull + spin + repel;
  }

  // Mild curl chaos keeps the cloud organic and lets treble shimmer
  // read as nervous filament motion rather than random sparkle.
  let chaos = curl3(p.pos * 3.0 + vec3<f32>(0.0, orbitT * 0.35, u.time * 0.12));
  accel = accel + chaos * u.gravityChaos * (0.45 + u.treble * 1.4);

  let speed = length(accel);
  if (speed > u.gravityMaxVelocity) {
    accel = accel * (u.gravityMaxVelocity / max(speed, 1e-4));
  }
  return accel;
}

// ── Color computation ──────────────────────────────────────────
fn paletteColor(t: f32, i: u32) -> vec3<f32> {
  if (u.colorMode == 0u) { return u.colorA; }                                                // solid
  if (u.colorMode == 1u) { return mix(u.colorA, u.colorB, t); }                              // gradient2
  if (u.colorMode == 2u) {                                                                    // gradient3
    if (t < 0.5) { return mix(u.colorA, u.colorB, t * 2.0); }
    return mix(u.colorB, u.colorC, (t - 0.5) * 2.0);
  }
  if (u.colorMode == 3u) {                                                                    // palette4
    let s = t * 3.0;
    if (s < 1.0) { return mix(u.colorA, u.colorB, s); }
    if (s < 2.0) { return mix(u.colorB, u.colorC, s - 1.0); }
    return mix(u.colorC, u.colorD, s - 2.0);
  }
  if (u.colorMode == 4u) {                                                                    // rainbow
    return hsv2rgb(vec3<f32>(fract(t + u.colorCycleOffset), 1.0, 1.0));
  }
  if (u.colorMode == 5u) {                                                                    // random
    let hue = hash3(vec3<f32>(f32(i) * 0.317, 13.0, 91.0));
    return hsv2rgb(vec3<f32>(fract(hue + u.colorCycleOffset), u.randomSat, u.randomVal));
  }
  // 6 — group (each particle group gets one of the 4 palette colors)
  let g = f32(i % 4u);
  if (g < 1.0) { return u.colorA; }
  if (g < 2.0) { return u.colorB; }
  if (g < 3.0) { return u.colorC; }
  return u.colorD;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.pointCount) { return; }
  var p = particles[i];

  // Dispatch to the active behavior. Each returns a TARGET VELOCITY
  // (delta over dt) the particle's velocity blends toward.
  var targetVel = vec3<f32>(0.0);
  if      (u.mode == 0u) { targetVel = behaviorGalaxy(i, p); }
  else if (u.mode == 1u) { targetVel = behaviorAtomic(i, p); }
  else if (u.mode == 2u) { targetVel = behaviorSwarm(i, p); }
  else if (u.mode == 3u) { targetVel = behaviorLattice(i, p); }
  else if (u.mode == 4u) { targetVel = behaviorField(i, p); }
  else if (u.mode == 5u) { targetVel = behaviorMedia(i, p); }
  else if (u.mode == 6u) { targetVel = behaviorGravity(i, p); }

  // Bass burst — universal radial impulse, blends with the behavior.
  let outward = normalize(p.pos + vec3<f32>(1e-5, 0.0, 0.0));
  targetVel = targetVel + outward * u.burstImpulse;

  // Treble shimmer — small random per-particle jitter.
  let jx = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 0.0)) - 0.5) * 2.0;
  let jy = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 1.0)) - 0.5) * 2.0;
  let jz = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 2.0)) - 0.5) * 2.0;
  targetVel = targetVel + vec3<f32>(jx, jy, jz) * u.shimmerStrength * u.treble;

  // Integrate.
  p.vel = mix(p.vel, targetVel, clamp(u.dt * 6.0, 0.0, 1.0));
  p.pos = p.pos + p.vel * u.dt;
  p.vel = p.vel * (1.0 - u.damping * u.dt);

  // ── Color ──────────────────────────────────────────────────────
  // Mapping value 't' (no backticks — JS template literal context).
  var t: f32 = 0.0;
  if      (u.colorMap == 0u) { t = f32(i) / max(f32(u.pointCount), 1.0); }                    // index
  else if (u.colorMap == 1u) { t = f32(p.group) / 16.0; }                                     // group
  else if (u.colorMap == 2u) { t = clamp(length(p.pos), 0.0, 1.5) / 1.5; }                    // radial
  else if (u.colorMap == 3u) { t = p.pos.y * 0.5 + 0.5; }                                     // y-axis
  else if (u.colorMap == 4u) { t = clamp(length(p.vel) * 0.3, 0.0, 1.0); }                    // speed
  else if (u.colorMap == 5u) { t = p.pos.z * 0.5 + 0.5; }                                     // depth-z
  else if (u.colorMap == 6u) { t = noise3(p.pos * 3.0 + vec3<f32>(0.0, 0.0, u.time * 0.2)) * 0.5 + 0.5; } // noise
  t = clamp(t * u.colorMapScale + u.colorMapOffset, 0.0, 1.0);

  // Mode color + mix with prior frame color (gives a small temporal
  // smoothing on color transitions — feels less popcorn-y).
  var modeColor = paletteColor(t, i);
  // In media mode, blend mode color with sampled source color for the
  // Refik look — particle is at the right pixel AND the right color.
  if (u.mode == 5u) {
    let homeUV = vec2<f32>(
      (f32(i % 1024u) + 0.5) / 1024.0,
      (f32((i / 1024u) % 1024u) + 0.5) / 1024.0,
    );
    let srcColor = textureSampleLevel(mediaTex, mediaSamp, homeUV * u.mediaSampleScale, 0.0).rgb;
    modeColor = mix(srcColor, modeColor, u.colorMix);
  } else {
    // Other modes: colorMix is interpretted as how much of the mode
    // color vs a desaturated white background to use. (1.0 default
    // = pure mode color.)
    modeColor = mix(vec3<f32>(0.6), modeColor, u.colorMix);
  }

  // HSV adjustments on top of the mode color.
  var hsv = rgb2hsv(modeColor);
  hsv.x = fract(hsv.x + u.hueShift);
  hsv.y = clamp(hsv.y * u.saturation, 0.0, 2.0);
  hsv.z = clamp(hsv.z * u.brightness, 0.0, 4.0);
  p.color = hsv2rgb(hsv);

  // Size pulse on bass. p.life carries a stable per-particle radius
  // multiplier seeded on the CPU; soft spheres lean into it so the
  // cloud reads like mixed 3D balls instead of same-size particles.
  let radiusVar = max(p.life, 0.1);
  if (u.topology == 4u) {
    p.size = u.baseSize * radiusVar * (1.0 + u.bass * 0.75);
  } else if (u.topology == 3u) {
    p.size = u.baseSize * mix(1.0, radiusVar, 0.35) * (1.0 + u.bass * 1.0);
  } else {
    p.size = u.baseSize * (1.0 + u.bass * 1.2);
  }
  p.alpha = 1.0;

  particles[i] = p;
}
`;

/* ============================================================== */
/* EDGE GENERATION COMPUTE — neighbor pairs into indirect buffer  */
/* ============================================================== */
const EDGE_GEN_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>, alpha: f32,
  vel: vec3<f32>, size:  f32,
  color: vec3<f32>, life: f32,
  group: u32, age: f32, _p0: f32, _p1: f32,
};
struct Edge { i: u32, j: u32, kind: u32, _p: u32, };

struct UEdge {
  pointCount:    u32,
  partnerCount:  u32,
  maxEdges:      u32,
  _pad0:         u32,
  localRadius:   f32,
  bridgeRadius:  f32,
  _pad1:         f32,
  _pad2:         f32,
};

@group(0) @binding(0) var<storage, read>             particles: array<Particle>;
@group(0) @binding(1) var<uniform>                   u:         UEdge;
// Indirect-draw args buffer: [vertex_count, instance_count,
// first_vertex, first_instance]. We atomicAdd instance_count (slot
// 1) for each new edge so the line render pass can drawIndirect
// straight off this buffer — no CPU readback needed.
//
// This is its OWN buffer (not packed with the edges) because WebGPU
// requires storage buffer bindings to start on a 256-byte-aligned
// offset; trying to bind "the edges section starting at byte 16"
// failed validation. Two buffers, two bindings, both at offset 0.
@group(0) @binding(2) var<storage, read_write>       indirect:  array<atomic<u32>, 4>;
@group(0) @binding(3) var<storage, read_write>       edges:     array<Edge>;

@compute @workgroup_size(64)
fn cs_edges(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.pointCount) { return; }
  let pi = particles[i].pos;

  // Deterministic partner picking: each particle gets partnerCount
  // partners computed by hashing (id, slot). Stable across frames so
  // the connection graph doesn't flicker, but irregular enough that
  // the resulting edge structure looks organic rather than gridlike.
  for (var k: u32 = 0u; k < u.partnerCount; k = k + 1u) {
    // Explicit parens required — WGSL refuses to mix * and ^ without
    // them ("mixing '*' and '^' requires parenthesis").
    let seed = (i * 73856093u) ^ (k * 19349663u);
    let mixed = (seed ^ (seed >> 13u)) * 2246822519u;
    let j = (mixed ^ (mixed >> 16u)) % u.pointCount;
    if (j <= i) { continue; }  // avoid duplicate edges and self

    let pj = particles[j].pos;
    let d  = distance(pi, pj);

    var kind: u32 = 99u;
    if (d < u.localRadius)        { kind = 0u; }
    else if (d < u.bridgeRadius)  { kind = 1u; }
    if (kind > 1u) { continue; }

    let slot = atomicAdd(&indirect[1], 1u);
    if (slot < u.maxEdges) {
      edges[slot] = Edge(i, j, kind, 0u);
    } else {
      // Buffer full — roll the counter back so the next frame doesn't
      // see a stale value and skip every draw. Cheap.
      atomicStore(&indirect[1], u.maxEdges);
    }
  }
}
`;

/* ============================================================== */
/* PARTICLE RENDER — 5 topologies in one shader                   */
/* ============================================================== */
const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>, alpha: f32,
  vel: vec3<f32>, size:  f32,
  color: vec3<f32>, life: f32,
  group: u32, age: f32, _p0: f32, _p1: f32,
};

struct UR {
  viewProj:     mat4x4<f32>,
  camRight:     vec3<f32>,
  _p0:          f32,
  camUp:        vec3<f32>,
  _p1:          f32,
  camPos:       vec3<f32>,
  topology:     u32,
  // sizing
  strokeLength: f32,
  strokeWidth:  f32,
  opacity:      f32,
  _p2:          f32,
  // atmosphere
  fogColor:     vec3<f32>,
  fogDensity:   f32,
  lightDir:     vec3<f32>,    // already normalized
  lightStrength: f32,
  // sphere material
  materialAmbient: f32,
  materialDiffuse: f32,
  materialSpecular: f32,
  materialShininess: f32,
  materialReflection: f32,
  _p3: f32,
  _p4: f32,
  _p5: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform>       u:         UR;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,
  @location(1) color:     vec3<f32>,
  @location(2) alpha:     f32,
  @location(3) worldDist: f32,
  // particleDir = normalize(particle.pos - cloud origin). We use it
  // in the fragment shader to fake directional lighting across all
  // topologies — dot(particleDir, lightDir) tells us whether the
  // particle is on the "lit side" (toward the light) or the "shadow
  // side" (away). This is the cheap-but-convincing self-shadowing
  // surrogate, since true per-particle shadow casting at 100K+
  // particles isn't tractable in real time without a shadow map
  // pass which we explicitly chose to skip for v1.
  @location(4) particleDir: vec3<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = particles[iid];

  var uvOut:  vec2<f32> = vec2<f32>(0.0);
  var offset: vec3<f32> = vec3<f32>(0.0);

  if (u.topology == 2u) {
    // STREAKS — quad extruded along velocity vector.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0,  1.0),
      vec2<f32>(0.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
    );
    let q = xy[vid];
    uvOut = vec2<f32>(q.x, q.y * 0.5 + 0.5);
    let speed = length(p.vel);
    let dir = select(vec3<f32>(1.0, 0.0, 0.0), p.vel / max(speed, 1e-4), speed > 1e-4);
    let fwd = normalize(cross(u.camRight, u.camUp));
    var perp = normalize(cross(dir, fwd));
    if (length(perp) < 1e-3) { perp = normalize(cross(dir, u.camUp)); }
    offset = -dir * (q.x * u.strokeLength) + perp * (q.y * u.strokeWidth * 0.5);
  } else {
    // POINTS / GLOW / SPHERE — camera-facing billboard
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    );
    let q = xy[vid];
    uvOut = vec2<f32>(q.x, q.y);  // -1..1 — used by sphere shading
    // Glow billboards are 2× the size to give a soft halo. Soft
    // spheres are slightly overscanned so their anti-aliased rim has
    // room to breathe.
    var scale = select(p.size, p.size * 2.0, u.topology == 1u);
    if (u.topology == 4u) {
      scale = p.size * 1.35;
    }
    offset = u.camRight * (q.x * scale) + u.camUp * (q.y * scale);
  }

  let worldPos = p.pos + offset;
  let toCam = u.camPos - worldPos;

  // Particle direction from cloud origin — used for fake directional
  // lighting in the fragment shader. Falls back to camera-up when the
  // particle is right at the origin (degenerate case).
  let pLen = length(p.pos);
  let pDir = select(vec3<f32>(0.0, 1.0, 0.0), p.pos / max(pLen, 1e-4), pLen > 1e-4);

  var out: VSOut;
  out.pos         = u.viewProj * vec4<f32>(worldPos, 1.0);
  out.uv          = uvOut;
  out.color       = p.color;
  out.alpha       = p.alpha * u.opacity;
  out.worldDist   = length(toCam);
  out.particleDir = pDir;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var mask: f32 = 1.0;
  var shade: f32 = 1.0;
  var litColor: vec3<f32> = in.color;

  if (u.topology == 2u) {
    // Stroke taper
    let headTail = 1.0 - in.uv.x;
    let perp     = 1.0 - abs(in.uv.y - 0.5) * 2.0;
    mask = headTail * smoothstep(0.0, 0.4, perp);
  } else if (u.topology == 1u) {
    // Glow — soft exponential disc
    let d = length(in.uv);
    if (d > 1.0) { discard; }
    mask = exp(-d * d * 2.5);
  } else if (u.topology == 3u || u.topology == 4u) {
    // Sphere impostor: reconstruct a camera-facing hemisphere normal
    // from billboard UV, then run a compact material model. This stays
    // intentionally simple WGSL so stricter Windows/D3D12 backends do
    // not fail the whole WebGPU layer with a black frame.
    let d2 = dot(in.uv, in.uv);
    if (d2 > 1.0) { discard; }
    let r = sqrt(d2);
    let z = sqrt(max(1.0 - d2, 0.0));
    let n = normalize(vec3<f32>(in.uv.x, in.uv.y, z));
    let viewDir = vec3<f32>(0.0, 0.0, 1.0);
    let ndl = max(dot(n, u.lightDir), 0.0);
    let wrapped = pow(clamp(dot(n, u.lightDir) * 0.5 + 0.5, 0.0, 1.0), 1.35);
    let halfDir = normalize(u.lightDir + viewDir);
    let gloss = max(u.materialShininess, 1.0);
    let spec = pow(max(dot(n, halfDir), 0.0), gloss) * u.materialSpecular * (0.25 + u.lightStrength * 1.75);
    let fresnel = pow(clamp(1.0 - dot(n, viewDir), 0.0, 1.0), 3.0);
    let ambient = max(u.materialAmbient, 0.22);
    let diffuse = max(u.materialDiffuse, 0.0) * mix(wrapped, ndl, 0.62) * (0.28 + u.lightStrength);
    let rimLift = fresnel * u.materialReflection * 0.55;
    let surface = max(ambient + diffuse + rimLift, 0.24);
    let reflectionTint = mix(vec3<f32>(0.18, 0.28, 0.42), vec3<f32>(0.86, 0.94, 1.0), clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
    litColor = in.color * surface
      + vec3<f32>(1.0, 0.95, 0.86) * spec
      + reflectionTint * u.materialReflection * (0.08 + fresnel * 0.42);

    if (u.topology == 4u) {
      let edge = 1.0 - smoothstep(0.88, 1.0, r);
      let volume = mix(0.68, 1.0, pow(clamp(z, 0.0, 1.0), 0.48));
      mask = edge * volume;
      litColor = mix(litColor, litColor + in.color * 0.12, fresnel * 0.45);
      if (mask < 0.025) { discard; }
    } else {
      mask = 1.0 - smoothstep(0.9, 1.0, r);
      if (mask < 0.01) { discard; }
    }
  } else {
    // POINT — soft disc
    let d = length(in.uv);
    if (d > 1.0) { discard; }
    mask = 1.0 - smoothstep(0.2, 1.0, d);
  }

  // Per-particle directional lighting for non-sphere topologies.
  // Sphere already shaded above via the billboard-normal trick; this
  // block adds a coarser "lit side vs shadow side" tint for points /
  // glow / streaks. dot(particleDir, lightDir) ∈ [-1, 1]:
  //   +1 = particle directly toward the light (full light)
  //   -1 = particle on the far side of the cloud (deep shadow)
  // We remap to [0, 1] and blend with the unlit color. lightStrength
  // is the user-facing strength control — 0 disables (everything stays
  // unshaded), 1 maximally separates lit from shadow.
  //
  // This isn't physically accurate shadowing — but visually it reads
  // as "the cloud has a lit side and a dark side," which is what users
  // want when they put a light into a particle field.
  if (u.topology != 3u && u.topology != 4u && u.lightStrength > 0.001) {
    let ndl = dot(in.particleDir, u.lightDir);          // [-1, 1]
    let lit = ndl * 0.5 + 0.5;                          // [0, 1]
    // Bias toward dark side getting darker than the unlit baseline —
    // gives the impression of self-occlusion.
    let shadeMod = mix(0.25, 1.35, lit);                // dark side ~0.25, lit side ~1.35
    shade = shade * mix(1.0, shadeMod, u.lightStrength);
  }
  if (u.topology != 3u && u.topology != 4u) {
    litColor = in.color * shade;
  }

  // Depth-based fog. Particles farther from the camera fade INTO
  // fogColor. Combined with the fog fullscreen-fill pass that runs
  // before this one, far particles literally blend into the
  // background atmosphere — that's what makes the fog read as
  // volumetric rather than just "particles get a color tint."
  let rawFog = exp(-u.fogDensity * in.worldDist);
  var fog = rawFog;
  var alphaFog = rawFog;
  if (u.topology == 3u || u.topology == 4u) {
    // Spheres are alpha-over + depth tested, so they cannot rely on
    // additive accumulation to punch through dense dark fog. Keep
    // enough lit surface contribution that Gravity Wells never turns
    // into a black canvas when switching to sphere topologies.
    fog = max(rawFog, 0.48);
    alphaFog = max(rawFog, 0.58);
  }
  let col = mix(u.fogColor, litColor, fog);
  let a = in.alpha * mask * alphaFog;
  return vec4<f32>(col * a, a);
}
`;

/* ============================================================== */
/* FOG FILL — fullscreen quad in fog color                        */
/* ============================================================== */
// Without this pass, the canvas background stays transparent (or
// black) and the fog never reads as "volumetric atmosphere" — far
// particles fade toward the fog color but there's nothing to fade
// INTO behind them. This pass paints the entire canvas with the fog
// color at user-controlled opacity BEFORE particles + lines render
// on top. With it, the scene gains real atmospheric depth: far
// particles vanish smoothly into the colored haze, lines fade into
// the same haze, light beams (if added later) tint that haze.
const FOG_WGSL = /* wgsl */ `
struct UFog { color: vec3<f32>, opacity: f32, };
@group(0) @binding(0) var<uniform> u: UFog;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  // Fullscreen triangle (two triangles into one bigger one for
  // discard efficiency).
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  return vec4<f32>(positions[vid], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  // Premultiplied-alpha output so this blends cleanly with the
  // existing premult pipeline used by particles + lines.
  let a = u.opacity;
  return vec4<f32>(u.color * a, a);
}
`;

/* ============================================================== */
/* EDGE RENDER — lines between connected particles                */
/* ============================================================== */
const LINE_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>, alpha: f32,
  vel: vec3<f32>, size:  f32,
  color: vec3<f32>, life: f32,
  group: u32, age: f32, _p0: f32, _p1: f32,
};
struct Edge { i: u32, j: u32, kind: u32, _p: u32, };

struct UL {
  viewProj:    mat4x4<f32>,
  camPos:      vec3<f32>,
  _p0:         f32,
  colorLocal:  vec3<f32>,
  alphaLocal:  f32,
  colorBridge: vec3<f32>,
  alphaBridge: f32,
  fogColor:    vec3<f32>,
  fogDensity:  f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> edges:     array<Edge>;
@group(0) @binding(2) var<uniform>       u:         UL;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color:     vec3<f32>,
  @location(1) alpha:     f32,
  @location(2) worldDist: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let e = edges[iid];
  // vid 0 = particle i endpoint, vid 1 = particle j endpoint
  let pIdx = select(e.j, e.i, vid == 0u);
  let p = particles[pIdx];
  let isBridge = e.kind == 1u;
  let col = select(u.colorLocal, u.colorBridge, isBridge);
  let aBase = select(u.alphaLocal, u.alphaBridge, isBridge);

  var out: VSOut;
  out.pos       = u.viewProj * vec4<f32>(p.pos, 1.0);
  out.color     = col;
  out.alpha     = aBase;
  out.worldDist = length(u.camPos - p.pos);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let fog = exp(-u.fogDensity * in.worldDist);
  let col = mix(u.fogColor, in.color, fog);
  let a = in.alpha * fog;
  return vec4<f32>(col * a, a);
}
`;

/* ============================================================== */
/* TYPESCRIPT WRAPPER                                              */
/* ============================================================== */

export interface ParticleFieldParams {
  // Behavior
  mode: BehaviorMode;
  particleCount: number;
  baseSize: number;
  opacity: number;
  // Motion (universal)
  windStrength: number;
  windScale: number;
  anchorPull: number;
  damping: number;
  // Audio
  bass: number;
  treble: number;
  shimmerStrength: number;
  burstGain: number;
  burstDecay: number;
  // Mode-specific (only the active mode's params matter)
  galaxyArms: number;
  galaxyRotateInner: number;
  galaxyRotateOuter: number;
  galaxyTilt: number;
  atomicNuclei: number;
  atomicShells: number;
  atomicShellSpacing: number;
  atomicOrbitSpeed: number;
  swarmCohesion: number;
  swarmSeparation: number;
  swarmAlignment: number;
  swarmRange: number;
  latticeSize: number;
  latticeSpacing: number;
  latticeVibration: number;
  mediaDepthAmount: number;
  mediaSampleScale: number;
  gravityWells: number;
  gravityStrength: number;
  gravityOrbit: number;
  gravityCoreSize: number;
  gravityVortex: number;
  gravityMaxVelocity: number;
  gravityAudioDrive: number;
  gravityChaos: number;
  // Topology
  topology: Topology;
  strokeLength: number;
  strokeWidth: number;
  // Color
  colorMode: ColorMode;
  colorMap: ColorMap;
  colorMix: number;
  colorMapScale: number;
  colorMapOffset: number;
  colorCycleSpeed: number;
  randomSat: number;
  randomVal: number;
  hueShiftSpeed: number;
  saturation: number;
  brightness: number;
  colorA: [number, number, number];
  colorB: [number, number, number];
  colorC: [number, number, number];
  colorD: [number, number, number];
  // Connections
  connectEnabled: boolean;
  partnerCount: number;
  localRadius: number;
  bridgeRadius: number;
  colorLocal: [number, number, number];
  colorBridge: [number, number, number];
  alphaLocal: number;
  alphaBridge: number;
  // Atmosphere
  fogDensity: number;       // exponential falloff rate for particle-distance fog tint
  fogOpacity: number;       // 0..1 — opacity of the fullscreen fog-fill behind particles
  fogColor: [number, number, number];
  lightX: number;
  lightY: number;
  lightZ: number;
  lightStrength: number;
  materialAmbient: number;
  materialDiffuse: number;
  materialSpecular: number;
  materialShininess: number;
  materialReflection: number;
  // Camera + object rotation
  fovDeg: number;
  cameraZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  autoRotateX: number;
  autoRotateY: number;
  autoRotateZ: number;
}

const DEFAULT_PARAMS: ParticleFieldParams = {
  mode: 'galaxy',
  particleCount: DEFAULT_PARTICLES,
  baseSize: 0.006,
  opacity: 1.0,
  windStrength: 0.2,
  windScale: 2.0,
  anchorPull: 0,
  damping: 1.0,
  bass: 0, treble: 0,
  shimmerStrength: 0.02,
  burstGain: 0.6,
  burstDecay: 2.5,
  galaxyArms: 4,
  galaxyRotateInner: 1.2,
  galaxyRotateOuter: 0.3,
  galaxyTilt: 0.1,
  atomicNuclei: 5,
  atomicShells: 3,
  atomicShellSpacing: 0.18,
  atomicOrbitSpeed: 0.8,
  swarmCohesion: 0.6,
  swarmSeparation: 0.05,
  swarmAlignment: 0.8,
  swarmRange: 1.5,
  latticeSize: 16,
  latticeSpacing: 1.6,
  latticeVibration: 0.015,
  mediaDepthAmount: 0.6,
  mediaSampleScale: 1.0,
  gravityWells: 4,
  gravityStrength: 0.18,
  gravityOrbit: 0.45,
  gravityCoreSize: 0.09,
  gravityVortex: 0.34,
  gravityMaxVelocity: 5.0,
  gravityAudioDrive: 1.15,
  gravityChaos: 0.18,
  topology: 'glow',
  strokeLength: 0.04,
  strokeWidth: 0.004,
  colorMode: 'palette4',
  colorMap: 'radial',
  colorMix: 1.0,
  colorMapScale: 1.0,
  colorMapOffset: 0.0,
  colorCycleSpeed: 0.05,
  randomSat: 0.85,
  randomVal: 1.0,
  hueShiftSpeed: 0.02,
  saturation: 1.1,
  brightness: 1.1,
  colorA: [0.18, 0.42, 1.00],  // blue
  colorB: [0.95, 0.28, 0.65],  // pink
  colorC: [1.00, 0.78, 0.20],  // gold
  colorD: [0.20, 0.95, 0.85],  // cyan
  connectEnabled: true,
  partnerCount: 12,
  localRadius: 0.12,
  bridgeRadius: 0.4,
  colorLocal: [0.4, 1.0, 1.0],   // cyan-ish
  colorBridge: [0.95, 0.3, 0.8], // magenta-ish
  alphaLocal: 0.35,
  alphaBridge: 0.12,
  fogDensity: 0.6,
  fogOpacity: 0.85,           // strong default so users see the fog effect immediately
  fogColor: [0.02, 0.02, 0.06],
  lightX: 0.4,
  lightY: 0.6,
  lightZ: 0.7,
  lightStrength: 0.6,
  materialAmbient: 0.34,
  materialDiffuse: 0.92,
  materialSpecular: 0.58,
  materialShininess: 56,
  materialReflection: 0.18,
  fovDeg: 50,
  cameraZ: 2.4,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  autoRotateX: 0,
  autoRotateY: 6,
  autoRotateZ: 0,
};

const BLEND_ADD: any = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
};
// Premultiplied alpha-over. Used for the fog fill pass + the line
// pass: with thousands of connection edges the additive blend
// saturated every overlap to pure white. Switching to premult-over
// means alphaLocal/alphaBridge actually control real opacity — pile
// up 100 overlapping edges and they still composite cleanly.
const BLEND_PREMULT_OVER: any = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export class WebGPUParticleField {
  private device: any;
  private presentFormat: any;
  // Buffers
  private particleBuffer: any = null;
  // Edge data: split into two buffers because WebGPU requires storage
  // bindings to begin at a 256-byte-aligned offset. The indirect-args
  // header (16 bytes) lives alone so the edges array can be bound at
  // offset 0 without padding waste.
  private indirectBuffer: any = null;   // 16 bytes: vertex_count, instance_count, first_vert, first_inst
  private edgeBuffer: any = null;       // MAX_EDGES * 16 bytes of edge entries
  private behaviorUniform: any;
  private edgeUniform: any;
  private renderUniform: any;
  private lineUniform: any;
  private fogUniform: any;
  // Source texture for `media` mode
  private mediaTex: any = null;
  private mediaTexView: any = null;
  private mediaSampler: any;
  private mediaW = 1;
  private mediaH = 1;
  // Pipelines
  private fogPipeline: any;
  private fogBindGroup: any = null;
  private fogLayout: any;
  private behaviorPipeline: any;
  private edgePipeline: any;
  private renderPipeline: any;
  private renderAlphaPipeline: any;
  private linePipeline: any;
  private depthTexture: any = null;
  private depthTextureView: any = null;
  private depthW = 0;
  private depthH = 0;
  // Bind groups
  private behaviorBindGroup: any = null;
  private edgeBindGroup: any = null;
  private renderBindGroup: any = null;
  private lineBindGroup: any = null;
  // Layouts (cached to rebuild bind groups on resize/source change)
  private behaviorLayout: any;
  private edgeLayout: any;
  private renderLayout: any;
  private lineLayout: any;

  // CPU state
  private params: ParticleFieldParams = { ...DEFAULT_PARAMS };
  private particleCount = DEFAULT_PARTICLES;
  private partnerCount = DEFAULT_PARTNERS;
  private viewportW = 1920;
  private viewportH = 1080;
  private prevFrameTime = 0;
  private burstImpulse = 0;
  private prevBass = 0;
  private hueShiftPhase = 0;
  private colorCyclePhase = 0;
  private autoRotXPhase = 0;
  private autoRotYPhase = 0;
  private autoRotZPhase = 0;
  private currentMode: BehaviorMode = 'galaxy';

  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.init();
  }

  private init(): void {
    // ── Allocate uniform buffers ────────────────────────────────
    // Behavior uniform: core blocks + palette + gravity controls.
    // Current layout uses 19 16-byte blocks (304 bytes); keep 384 for
    // alignment and future headroom.
    this.behaviorUniform = this.device.createBuffer({
      size: 384,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Edge-gen uniform: 8 floats / 32 bytes; round to 64.
    this.edgeUniform = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Render uniform: matrices/camera + sizing + fog/light +
    // two sphere-material blocks. Exactly 192 bytes.
    this.renderUniform = this.device.createBuffer({
      size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Line uniform: 64 (viewProj) + 16 (camPos+pad) + 16 (colorLocal+a) + 16 (colorBridge+a) + 16 (fog) = 128. Round to 160.
    this.lineUniform = this.device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Fog uniform: vec3 color + f32 opacity = 16 bytes. WGSL aligns
    // to 16 anyway; allocate exactly 16.
    this.fogUniform = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Particle buffer (sized later by setParticleCount) ───────
    this.allocateParticleBuffer(this.particleCount);

    // ── Indirect-draw args buffer (16 bytes, separate from edges) ──
    // Bound as storage (so the edge-gen compute pass can atomicAdd
    // into it) AND as indirect (so the line render pass can read it
    // for drawIndirect). 16 bytes total — well under the storage-
    // binding alignment quirk that forced the buffer split.
    this.indirectBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT,
    });
    // Header: vertex_count=2 (line = 2 verts), instance_count=0,
    // first_vertex=0, first_instance=0. Only instance_count is
    // mutated per frame (atomically by the edge-gen compute pass).
    const hdr = new Uint32Array(4);
    hdr[0] = 2; hdr[1] = 0; hdr[2] = 0; hdr[3] = 0;
    this.device.queue.writeBuffer(this.indirectBuffer, 0, hdr);

    // ── Edge data buffer (just the edges, no header) ───────────
    this.edgeBuffer = this.device.createBuffer({
      size: MAX_EDGES * EDGE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // ── 1x1 placeholder media texture (sampled even in non-media modes) ──
    this.mediaTex = this.device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.mediaTexView = this.mediaTex.createView();
    this.mediaSampler = this.device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    // ── Pipelines + bind group layouts ──────────────────────────
    this.buildPipelines();
    this.rebuildBindGroups();
  }

  /** Allocate / re-allocate the particle storage buffer for a new
   *  count + seed it with initial positions for the current mode. */
  private allocateParticleBuffer(n: number): void {
    n = Math.max(1024, Math.min(MAX_PARTICLES, Math.floor(n)));
    if (this.particleBuffer) { try { this.particleBuffer.destroy?.(); } catch { /* */ } }
    this.particleBuffer = this.device.createBuffer({
      size: n * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.particleCount = n;
    this.seedParticles();
    // Bind groups capture buffer handles — rebuild whenever the
    // particle buffer changes (count or mode reseed).
    if (this.behaviorLayout) this.rebuildBindGroups();
  }

  /** Seed initial positions matching the current mode. Behaviors are
   *  driven by velocity targets so initial positions get pulled to
   *  the mode's attractor within a second anyway, but a good initial
   *  seed avoids a visible "snap" the moment the mode activates. */
  private seedParticles(): void {
    const n = this.particleCount;
    const buf = new ArrayBuffer(n * PARTICLE_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    const mode = this.params.mode;

    for (let i = 0; i < n; i++) {
      const off = i * 16;  // 64 bytes / 4 = 16 floats per particle
      let x = 0, y = 0, z = 0;
      let group = 0;
      let radiusVar = 1;
      if (mode === 'galaxy') {
        // Spawn near the disc; arm index = i mod arms
        group = i % Math.max(1, this.params.galaxyArms | 0);
        const armPhase = group / Math.max(1, this.params.galaxyArms);
        const r = Math.sqrt(Math.random()) * 0.95;
        const theta = armPhase * Math.PI * 2 + r * 3.0 + (Math.random() - 0.5) * 0.4;
        x = Math.cos(theta) * r;
        z = Math.sin(theta) * r;
        y = (Math.random() - 0.5) * 0.04 * (1 - r);
      } else if (mode === 'atomic') {
        // Spawn near a nucleus + on a shell at the appropriate radius
        const nuc = Math.max(1, this.params.atomicNuclei | 0);
        const sh  = Math.max(1, this.params.atomicShells | 0);
        const nIdx = i % nuc;
        const shIdx = Math.floor(i / nuc) % sh;
        group = nIdx + shIdx * nuc;
        const nT = (nIdx / nuc) * Math.PI * 2;
        const r = (shIdx + 1) * this.params.atomicShellSpacing;
        const phase = Math.random() * Math.PI * 2;
        x = Math.cos(nT) * 0.5 + Math.cos(phase) * r;
        y = (Math.random() - 0.5) * r * 0.5;
        z = Math.sin(nT) * 0.5 + Math.sin(phase) * r * 0.6;
      } else if (mode === 'lattice') {
        const sz = Math.max(2, this.params.latticeSize | 0);
        const ix = i % sz;
        const iy = Math.floor(i / sz) % sz;
        const iz = Math.floor(i / (sz * sz)) % sz;
        x = (ix / sz - 0.5) * this.params.latticeSpacing;
        y = (iy / sz - 0.5) * this.params.latticeSpacing;
        z = (iz / sz - 0.5) * this.params.latticeSpacing;
        group = i;
      } else if (mode === 'gravity') {
        const wells = Math.max(1, Math.min(8, this.params.gravityWells | 0));
        group = i % wells;
        const phase = (group / wells) * Math.PI * 2;
        const shell = Math.pow(Math.random(), 0.55) * 0.9 + 0.08;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const cx = Math.cos(phase) * 0.45;
        const cz = Math.sin(phase) * 0.45;
        x = cx + Math.sin(phi) * Math.cos(theta) * shell;
        y = (Math.random() - 0.5) * 0.75 + Math.cos(phi) * shell * 0.35;
        z = cz + Math.sin(phi) * Math.sin(theta) * shell;
        const jumbo = i % 233 === 0;
        radiusVar = jumbo
          ? 4.2 + Math.random() * 2.4
          : 0.36 + Math.pow(Math.random(), 2.35) * 2.8;
      } else {
        // swarm / field / media — random unit sphere
        let rx = 0, ry = 0, rz = 0, ll = 0;
        do {
          rx = Math.random() * 2 - 1;
          ry = Math.random() * 2 - 1;
          rz = Math.random() * 2 - 1;
          ll = rx * rx + ry * ry + rz * rz;
        } while (ll > 1);
        x = rx; y = ry; z = rz;
        group = i & 15;
      }
      if (mode !== 'gravity') {
        radiusVar = 0.72 + Math.pow(Math.random(), 1.8) * 1.35;
      }

      f[off + 0] = x; f[off + 1] = y; f[off + 2] = z; f[off + 3] = 1; // pos + alpha
      f[off + 4] = 0; f[off + 5] = 0; f[off + 6] = 0; f[off + 7] = this.params.baseSize; // vel + size
      f[off + 8] = 0.6; f[off + 9] = 0.7; f[off + 10] = 0.95; f[off + 11] = radiusVar; // color + radius var
      u[off + 12] = group >>> 0;  // group as u32
      f[off + 13] = 0;             // age
      f[off + 14] = 0;             // pad
      f[off + 15] = 0;             // pad
    }
    this.device.queue.writeBuffer(this.particleBuffer, 0, buf);
    this.currentMode = mode;
  }

  private buildPipelines(): void {
    // ── Fog fullscreen pipeline ─────────────────────────────────
    // Runs first each frame, paints the canvas with fog color so
    // the rest of the scene composites against an atmospheric
    // background rather than transparent black.
    const fogMod = this.device.createShaderModule({ code: FOG_WGSL });
    this.fogLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.fogPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.fogLayout] }),
      vertex:   { module: fogMod, entryPoint: 'vs_main' },
      fragment: {
        module: fogMod,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.fogBindGroup = this.device.createBindGroup({
      layout: this.fogLayout,
      entries: [
        { binding: 0, resource: { buffer: this.fogUniform } },
      ],
    });

    // ── Behavior compute pipeline ───────────────────────────────
    const behaviorMod = this.device.createShaderModule({ code: BEHAVIOR_WGSL });
    this.behaviorLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      ],
    });
    this.behaviorPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.behaviorLayout] }),
      compute: { module: behaviorMod, entryPoint: 'cs_main' },
    });

    // ── Edge-gen compute pipeline ───────────────────────────────
    const edgeMod = this.device.createShaderModule({ code: EDGE_GEN_WGSL });
    this.edgeLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.edgePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.edgeLayout] }),
      compute: { module: edgeMod, entryPoint: 'cs_edges' },
    });

    // ── Particle render pipeline ───────────────────────────────
    const renderMod = this.device.createShaderModule({ code: RENDER_WGSL });
    this.renderLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderLayout] }),
      vertex:   { module: renderMod, entryPoint: 'vs_main' },
      fragment: {
        module: renderMod,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_ADD }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.renderAlphaPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderLayout] }),
      vertex:   { module: renderMod, entryPoint: 'vs_main' },
      fragment: {
        module: renderMod,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // ── Line render pipeline ───────────────────────────────────
    const lineMod = this.device.createShaderModule({ code: LINE_WGSL });
    this.lineLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.linePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.lineLayout] }),
      vertex:   { module: lineMod, entryPoint: 'vs_main' },
      fragment: {
        module: lineMod,
        entryPoint: 'fs_main',
        // Premult alpha-over (not additive) — otherwise overlapping
        // edges saturate to white. With premult, alphaLocal and
        // alphaBridge control real opacity: 0.1 = ghostly, 1.0 = solid.
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'line-list' },
    });
  }

  private rebuildBindGroups(): void {
    this.behaviorBindGroup = this.device.createBindGroup({
      layout: this.behaviorLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.behaviorUniform } },
        { binding: 2, resource: this.mediaTexView },
        { binding: 3, resource: this.mediaSampler },
      ],
    });
    this.edgeBindGroup = this.device.createBindGroup({
      layout: this.edgeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.edgeUniform } },
        // Indirect args + edges in two separate buffers, both at
        // offset 0 — sidesteps the 256-byte storage-binding align.
        { binding: 2, resource: { buffer: this.indirectBuffer } },
        { binding: 3, resource: { buffer: this.edgeBuffer } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniform } },
      ],
    });
    this.lineBindGroup = this.device.createBindGroup({
      layout: this.lineLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        // Edges now in their own buffer; bind whole thing at offset 0.
        { binding: 1, resource: { buffer: this.edgeBuffer } },
        { binding: 2, resource: { buffer: this.lineUniform } },
      ],
    });
  }

  setParams(p: Partial<ParticleFieldParams>): void {
    const wasMode = this.params.mode;
    const wasCount = this.params.particleCount;
    this.params = { ...this.params, ...p };
    // Mode change or particle-count change requires a re-seed.
    if (this.params.particleCount !== wasCount) {
      this.allocateParticleBuffer(this.params.particleCount);
    } else if (this.params.mode !== wasMode) {
      this.seedParticles();
    }
  }

  setViewport(w: number, h: number): void { this.viewportW = w; this.viewportH = h; }

  setSourceImage(img: HTMLImageElement | ImageBitmap | HTMLCanvasElement): Promise<void> {
    return new Promise((resolve) => {
      const w = (img as any).naturalWidth ?? (img as any).width ?? 1;
      const h = (img as any).naturalHeight ?? (img as any).height ?? 1;
      this.resizeMediaTexture(w, h);
      try {
        this.device.queue.copyExternalImageToTexture(
          { source: img, flipY: false },
          { texture: this.mediaTex, premultipliedAlpha: true },
          { width: w, height: h, depthOrArrayLayers: 1 },
        );
      } catch { /* */ }
      resolve();
    });
  }

  updateSourceFromVideo(video: HTMLVideoElement): void {
    if (video.readyState < 2) return;
    const w = video.videoWidth | 0;
    const h = video.videoHeight | 0;
    if (!w || !h) return;
    this.resizeMediaTexture(w, h);
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video, flipY: false },
        { texture: this.mediaTex, premultipliedAlpha: true },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch { /* */ }
  }

  updateSourceFromCanvas(canvas: HTMLCanvasElement): void {
    const w = canvas.width | 0, h = canvas.height | 0;
    if (!w || !h) return;
    this.resizeMediaTexture(w, h);
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: canvas, flipY: false },
        { texture: this.mediaTex, premultipliedAlpha: true },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch { /* */ }
  }

  private resizeMediaTexture(w: number, h: number): void {
    if (this.mediaW === w && this.mediaH === h) return;
    try { this.mediaTex?.destroy?.(); } catch { /* */ }
    this.mediaTex = this.device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.mediaTexView = this.mediaTex.createView();
    this.mediaW = w; this.mediaH = h;
    // Rebind the behavior bind group (it captured the old view).
    this.rebuildBindGroups();
  }

  private ensureDepthTexture(w: number, h: number): void {
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    if (this.depthTexture && this.depthW === w && this.depthH === h) return;
    try { this.depthTexture?.destroy?.(); } catch { /* */ }
    this.depthTexture = this.device.createTexture({
      size: [w, h, 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTextureView = this.depthTexture.createView();
    this.depthW = w;
    this.depthH = h;
  }

  encodeFrame(encoder: any, targetView: any, time?: number, frameDt?: number): void {
    const wallNow = performance.now() / 1000;
    const now = typeof time === 'number' && Number.isFinite(time) ? Math.max(0, time) : wallNow;
    let dt = typeof frameDt === 'number' && Number.isFinite(frameDt)
      ? frameDt
      : (this.prevFrameTime === 0 ? 1 / 60 : (now - this.prevFrameTime));
    dt = Math.min(Math.max(dt, 0), 1 / 15);
    this.prevFrameTime = now;

    // CPU-side accumulators
    this.hueShiftPhase = (this.hueShiftPhase + this.params.hueShiftSpeed * dt) % 1;
    this.colorCyclePhase = (this.colorCyclePhase + this.params.colorCycleSpeed * dt) % 1;
    const bassDelta = Math.max(0, this.params.bass - this.prevBass);
    if (bassDelta > 0.04) this.burstImpulse += bassDelta * this.params.burstGain * 8;
    this.burstImpulse = Math.max(0, this.burstImpulse - this.burstImpulse * this.params.burstDecay * dt);
    this.prevBass = this.params.bass;
    this.autoRotXPhase += this.params.autoRotateX * dt;
    this.autoRotYPhase += this.params.autoRotateY * dt;
    this.autoRotZPhase += this.params.autoRotateZ * dt;

    // ── Behavior uniform ───────────────────────────────────────
    const bBuf = new ArrayBuffer(384);
    const bF = new Float32Array(bBuf);
    const bU = new Uint32Array(bBuf);
    // Block 0
    bF[0] = dt; bF[1] = now; bU[2] = this.particleCount >>> 0; bF[3] = this.params.baseSize;
    // Block 1
    bU[4] = MODE_ID[this.params.mode] >>> 0;
    bU[5] = TOPO_ID[this.params.topology] >>> 0;
    bU[6] = this.params.connectEnabled ? 1 : 0;
    // Block 2
    bF[8] = this.params.windStrength; bF[9] = this.params.windScale;
    bF[10] = this.params.anchorPull; bF[11] = this.params.damping;
    // Block 3
    bF[12] = this.params.bass; bF[13] = this.params.treble;
    bF[14] = this.burstImpulse; bF[15] = this.params.shimmerStrength;
    // Block 4 — galaxy
    bF[16] = this.params.galaxyArms; bF[17] = this.params.galaxyRotateInner;
    bF[18] = this.params.galaxyRotateOuter; bF[19] = this.params.galaxyTilt;
    // Block 5 — atomic
    bF[20] = this.params.atomicNuclei; bF[21] = this.params.atomicShells;
    bF[22] = this.params.atomicShellSpacing; bF[23] = this.params.atomicOrbitSpeed;
    // Block 6 — swarm
    bF[24] = this.params.swarmCohesion; bF[25] = this.params.swarmSeparation;
    bF[26] = this.params.swarmAlignment; bF[27] = this.params.swarmRange;
    // Block 7 — lattice
    bF[28] = this.params.latticeSize; bF[29] = this.params.latticeSpacing;
    bF[30] = this.params.latticeVibration;
    // Block 8 — media
    bF[32] = this.params.mediaDepthAmount; bF[33] = this.params.mediaSampleScale;
    // Block 9 — fog + light
    bF[36] = this.params.fogDensity;
    bF[37] = this.params.lightX; bF[38] = this.params.lightY; bF[39] = this.params.lightZ;
    // Block 10 — color basics
    bF[40] = this.params.saturation; bF[41] = this.params.brightness;
    bU[42] = COLOR_MODE_ID[this.params.colorMode] >>> 0;
    bU[43] = COLOR_MAP_ID[this.params.colorMap]   >>> 0;
    // Block 11
    bF[44] = this.params.colorMix; bF[45] = this.params.colorMapScale;
    bF[46] = this.params.colorMapOffset; bF[47] = this.colorCyclePhase;
    // Block 12
    bF[48] = this.params.randomSat; bF[49] = this.params.randomVal; bF[50] = this.hueShiftPhase;
    // Blocks 13-16 — palette (vec3+pad each, 4 bytes pad after the 12 bytes of vec3)
    bF[52] = this.params.colorA[0]; bF[53] = this.params.colorA[1]; bF[54] = this.params.colorA[2];
    bF[56] = this.params.colorB[0]; bF[57] = this.params.colorB[1]; bF[58] = this.params.colorB[2];
    bF[60] = this.params.colorC[0]; bF[61] = this.params.colorC[1]; bF[62] = this.params.colorC[2];
    bF[64] = this.params.colorD[0]; bF[65] = this.params.colorD[1]; bF[66] = this.params.colorD[2];
    // Block 17 — gravity wells
    bF[68] = this.params.gravityWells; bF[69] = this.params.gravityStrength;
    bF[70] = this.params.gravityOrbit; bF[71] = this.params.gravityCoreSize;
    // Block 18 — gravity shaping
    bF[72] = this.params.gravityVortex; bF[73] = this.params.gravityMaxVelocity;
    bF[74] = this.params.gravityAudioDrive; bF[75] = this.params.gravityChaos;
    this.device.queue.writeBuffer(this.behaviorUniform, 0, bBuf);

    // ── Reset the indirect counter (instance_count = 0) ────────
    // vertex_count = 2 already (set at init); we only zero the
    // instance count so the upcoming edge-gen pass starts fresh.
    if (this.params.connectEnabled) {
      this.device.queue.writeBuffer(this.indirectBuffer, 4, new Uint32Array([0]));

      // ── Edge-gen uniform ─────────────────────────────────────
      const eBuf = new ArrayBuffer(64);
      const eF = new Float32Array(eBuf);
      const eU = new Uint32Array(eBuf);
      eU[0] = this.particleCount >>> 0;
      eU[1] = Math.max(1, Math.min(32, this.params.partnerCount | 0));
      eU[2] = MAX_EDGES >>> 0;
      eF[4] = this.params.localRadius;
      eF[5] = this.params.bridgeRadius;
      this.device.queue.writeBuffer(this.edgeUniform, 0, eBuf);
    }

    // ── Behavior pass ──────────────────────────────────────────
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.behaviorPipeline);
      pass.setBindGroup(0, this.behaviorBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
      pass.end();
    }

    // ── Edge-gen pass ──────────────────────────────────────────
    if (this.params.connectEnabled) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.edgePipeline);
      pass.setBindGroup(0, this.edgeBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
      pass.end();
    }

    // ── Camera + object rotation matrices ──────────────────────
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const proj = perspective(this.params.fovDeg, aspect, 0.05, 100);
    const view = translate(0, 0, -this.params.cameraZ);
    const D2R = Math.PI / 180;
    const rxRad = (this.params.rotateX + this.autoRotXPhase) * D2R;
    const ryRad = (this.params.rotateY + this.autoRotYPhase) * D2R;
    const rzRad = (this.params.rotateZ + this.autoRotZPhase) * D2R;
    const cx = Math.cos(rxRad), sx = Math.sin(rxRad);
    const cyy = Math.cos(ryRad), syy = Math.sin(ryRad);
    const cz = Math.cos(rzRad), sz = Math.sin(rzRad);
    const rxM = new Float32Array([1, 0, 0, 0,  0, cx, sx, 0,  0, -sx, cx, 0,  0, 0, 0, 1]);
    const ryM = new Float32Array([cyy, 0, -syy, 0,  0, 1, 0, 0,  syy, 0, cyy, 0,  0, 0, 0, 1]);
    const rzM = new Float32Array([cz, sz, 0, 0,  -sz, cz, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);
    const objRot = mat4Mul(rzM, mat4Mul(ryM, rxM));
    const viewProj = mat4Mul(proj, mat4Mul(view, objRot));

    // Camera position in world space — used for fog distance + light
    // direction in the fragment shader.
    const camPos = [0, 0, this.params.cameraZ];

    // Normalize the light direction once on the CPU.
    const lx = this.params.lightX, ly = this.params.lightY, lz = this.params.lightZ;
    const llen = Math.sqrt(lx*lx + ly*ly + lz*lz) || 1;
    const ldn = [lx / llen, ly / llen, lz / llen];

    // ── Render uniform ─────────────────────────────────────────
    const rBuf = new ArrayBuffer(192);
    const rF = new Float32Array(rBuf);
    const rU = new Uint32Array(rBuf);
    rF.set(viewProj, 0);
    rF[16] = 1; rF[17] = 0; rF[18] = 0;       // camRight
    rF[20] = 0; rF[21] = 1; rF[22] = 0;       // camUp
    rF[24] = camPos[0]; rF[25] = camPos[1]; rF[26] = camPos[2];
    rU[27] = TOPO_ID[this.params.topology] >>> 0;
    rF[28] = this.params.strokeLength;
    rF[29] = this.params.strokeWidth;
    rF[30] = this.params.opacity;
    // Block — fog
    rF[32] = this.params.fogColor[0]; rF[33] = this.params.fogColor[1]; rF[34] = this.params.fogColor[2];
    rF[35] = this.params.fogDensity;
    // Block — light
    rF[36] = ldn[0]; rF[37] = ldn[1]; rF[38] = ldn[2];
    rF[39] = this.params.lightStrength;
    // Blocks — sphere material
    rF[40] = this.params.materialAmbient;
    rF[41] = this.params.materialDiffuse;
    rF[42] = this.params.materialSpecular;
    rF[43] = this.params.materialShininess;
    rF[44] = this.params.materialReflection;
    this.device.queue.writeBuffer(this.renderUniform, 0, rBuf);

    // ── Line uniform ───────────────────────────────────────────
    const lBuf = new ArrayBuffer(160);
    const lF = new Float32Array(lBuf);
    lF.set(viewProj, 0);
    lF[16] = camPos[0]; lF[17] = camPos[1]; lF[18] = camPos[2];
    lF[20] = this.params.colorLocal[0]; lF[21] = this.params.colorLocal[1]; lF[22] = this.params.colorLocal[2];
    lF[23] = this.params.alphaLocal;
    lF[24] = this.params.colorBridge[0]; lF[25] = this.params.colorBridge[1]; lF[26] = this.params.colorBridge[2];
    lF[27] = this.params.alphaBridge;
    lF[28] = this.params.fogColor[0]; lF[29] = this.params.fogColor[1]; lF[30] = this.params.fogColor[2];
    lF[31] = this.params.fogDensity;
    this.device.queue.writeBuffer(this.lineUniform, 0, lBuf);

    // ── Fog uniform (color + opacity) ──────────────────────────
    const fBuf = new ArrayBuffer(16);
    const fF = new Float32Array(fBuf);
    fF[0] = this.params.fogColor[0];
    fF[1] = this.params.fogColor[1];
    fF[2] = this.params.fogColor[2];
    fF[3] = this.params.fogOpacity;
    this.device.queue.writeBuffer(this.fogUniform, 0, fBuf);

    // ── Render passes ──────────────────────────────────────────
    // 1) Fog fullscreen fill — paints the canvas with the fog color
    //    at user-set opacity. Provides the "atmosphere" particles
    //    fade INTO. Without this the canvas stays transparent
    //    and fog only tints the particles themselves, which doesn't
    //    read as volumetric.
    // 2) Particles — premult alpha-over composites onto the fog.
    // 3) Lines — premult alpha-over so opacity controls really work
    //    rather than additive saturation to white.
    const useSphereDepth = this.params.topology === 'sphere' || this.params.topology === 'softSphere';
    if (useSphereDepth) this.ensureDepthTexture(this.viewportW, this.viewportH);

    // (1) Fog fill — only if opacity > epsilon (skip the no-op).
    if (this.params.fogOpacity > 0.001) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.fogPipeline);
      pass.setBindGroup(0, this.fogBindGroup);
      pass.draw(3, 1, 0, 0);  // 3-vertex fullscreen triangle
      pass.end();
    }

    // (2) Particles. Sphere impostors use a depth attachment so they
    // occlude like objects; point/glow/streak modes stay additive.
    {
      const renderPassDesc: any = {
        colorAttachments: [{
          view: targetView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      };
      if (useSphereDepth && this.depthTextureView) {
        renderPassDesc.depthStencilAttachment = {
          view: this.depthTextureView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        };
      }
      const pass = encoder.beginRenderPass(renderPassDesc);
      pass.setPipeline(useSphereDepth ? this.renderAlphaPipeline : this.renderPipeline);
      pass.setBindGroup(0, this.renderBindGroup);
      pass.draw(6, this.particleCount, 0, 0);
      pass.end();
    }

    // (3) Lines
    if (this.params.connectEnabled) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      // drawIndirect reads (vertex_count, instance_count, first_vertex,
      // first_instance) from the indirect buffer at offset 0. Edge-gen
      // has atomically populated instance_count this frame.
      pass.drawIndirect(this.indirectBuffer, 0);
      pass.end();
    }
  }

  dispose(): void {
    try { this.particleBuffer?.destroy?.(); } catch { /* */ }
    try { this.indirectBuffer?.destroy?.(); } catch { /* */ }
    try { this.edgeBuffer?.destroy?.(); } catch { /* */ }
    try { this.behaviorUniform?.destroy?.(); } catch { /* */ }
    try { this.edgeUniform?.destroy?.(); } catch { /* */ }
    try { this.renderUniform?.destroy?.(); } catch { /* */ }
    try { this.lineUniform?.destroy?.(); } catch { /* */ }
    try { this.fogUniform?.destroy?.(); } catch { /* */ }
    try { this.mediaTex?.destroy?.(); } catch { /* */ }
    try { this.depthTexture?.destroy?.(); } catch { /* */ }
    this.particleBuffer = null;
    this.indirectBuffer = null;
    this.edgeBuffer = null;
    this.mediaTex = null;
    this.mediaTexView = null;
    this.depthTexture = null;
    this.depthTextureView = null;
  }
}
