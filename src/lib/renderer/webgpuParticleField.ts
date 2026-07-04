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

import { createAndWarmWgslShaderModule, resolveGhostWgsl } from './wgsl';
import { GhostGpuFrameGraph, type GhostGpuFrameGraphRunStats } from './gpuFrameGraph';
import { getGhostGpuRuntime } from './webgpuShared';

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
#include <noise>
#include <color>

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
  return ghost_hash13(p);
}
fn noise3(p: vec3<f32>) -> f32 {
  return ghost_value_noise3(p);
}
fn curl3(p: vec3<f32>) -> vec3<f32> {
  return ghost_curl_noise3(p);
}
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  return ghost_rgb2hsv(c);
}
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  return ghost_hsv2rgb(c);
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
#include <camera>
#include <color>

struct UFog { color: vec3<f32>, opacity: f32, };
@group(0) @binding(0) var<uniform> u: UFog;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  return ghost_fullscreen_triangle_pos(vid);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  // Premultiplied-alpha output so this blends cleanly with the
  // existing premult pipeline used by particles + lines.
  return ghost_premul(u.color, u.opacity);
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

export const PARTICLE_FIELD_NATIVE_SHADER_IDS = Object.freeze({
  behavior: 'particle-field/behavior',
  fog: 'particle-field/fog',
  render: 'particle-field/render',
  edges: 'particle-field/edges',
  lines: 'particle-field/lines',
});

export type ParticleFieldNativeShaderStage = 'compute' | 'render';

export interface ParticleFieldNativeShaderSource {
  shaderId: string;
  label: string;
  stage: ParticleFieldNativeShaderStage;
  entry: string;
  source: string;
}

export interface ParticleFieldNativePrecompileCommand {
  type: 'precompile_shader';
  shader_id: string;
  stage: ParticleFieldNativeShaderStage;
  entry: string;
  source: string;
}

type ParticleFieldNativeGraphBinding = {
  binding: number;
  resource?: string;
  kind?: string;
  source_id?: string;
  allow_missing?: boolean;
};

type ParticleFieldNativeGraphBuffer = {
  id: string;
  kind: 'uniform' | 'storage' | 'read-only-storage';
  byte_length: number;
  persistent?: boolean;
  clear?: boolean;
  initial_b64?: string;
  initial_buffer?: ArrayBuffer | Uint8Array;
  initial_u32?: number[];
  indirect?: boolean;
};

type ParticleFieldNativeGraphPass = {
  name: string;
  shader_id: string;
  entry: string;
  dispatch: [number, number, number];
  bindings: ParticleFieldNativeGraphBinding[];
};

type ParticleFieldNativeGraphRenderPass = {
  name: string;
  shader_id: string;
  vertex_entry: string;
  fragment_entry: string;
  target: 'source_frame';
  source_id: string;
  seq: number;
  clear: boolean;
  include_snapshot?: boolean;
  blend: 'replace' | 'alpha' | 'add';
  primitive?: 'triangle-list' | 'line-list';
  vertex_count: number;
  instance_count: number;
  draw_indirect_buffer?: string;
  draw_indirect_offset?: number;
  depth?: boolean;
  depth_write?: boolean;
  depth_compare?: 'less' | 'less-equal' | 'always';
  bindings: ParticleFieldNativeGraphBinding[];
};

export interface ParticleFieldNativeGraphState {
  mode: BehaviorMode;
  particleCount: number;
  prevFrameTime: number;
  burstImpulse: number;
  prevBass: number;
  hueShiftPhase: number;
  colorCyclePhase: number;
  autoRotXPhase: number;
  autoRotYPhase: number;
  autoRotZPhase: number;
}

export interface ParticleFieldNativeGraphOptions {
  sourceId: string;
  params?: Partial<ParticleFieldParams>;
  width?: number;
  height?: number;
  time?: number;
  frameDelta?: number;
  frameIndex?: number;
  state?: ParticleFieldNativeGraphState | null;
  reset?: boolean;
  includeSnapshot?: boolean;
  mediaSourceId?: string | null;
  audioBass?: number;
  audioTreble?: number;
}

export interface ParticleFieldNativeGraphBuildResult {
  config: {
    buffers: ParticleFieldNativeGraphBuffer[];
    passes: ParticleFieldNativeGraphPass[];
    render_passes: ParticleFieldNativeGraphRenderPass[];
    readbacks: string[];
  };
  sourceId: string;
  state: ParticleFieldNativeGraphState;
  particleCount: number;
  topology: Topology;
  passCount: number;
}

export function getParticleFieldNativeShaderSources(): ParticleFieldNativeShaderSource[] {
  return [
    {
      shaderId: PARTICLE_FIELD_NATIVE_SHADER_IDS.behavior,
      label: 'particle-field/behavior',
      stage: 'compute',
      entry: 'cs_main',
      source: resolveGhostWgsl(BEHAVIOR_WGSL, 'particle-field/behavior'),
    },
    {
      shaderId: PARTICLE_FIELD_NATIVE_SHADER_IDS.edges,
      label: 'particle-field/edges',
      stage: 'compute',
      entry: 'cs_edges',
      source: resolveGhostWgsl(EDGE_GEN_WGSL, 'particle-field/edges'),
    },
    {
      shaderId: PARTICLE_FIELD_NATIVE_SHADER_IDS.fog,
      label: 'particle-field/fog',
      stage: 'render',
      entry: 'fs_main',
      source: resolveGhostWgsl(FOG_WGSL, 'particle-field/fog'),
    },
    {
      shaderId: PARTICLE_FIELD_NATIVE_SHADER_IDS.render,
      label: 'particle-field/render',
      stage: 'render',
      entry: 'fs_main',
      source: resolveGhostWgsl(RENDER_WGSL, 'particle-field/render'),
    },
    {
      shaderId: PARTICLE_FIELD_NATIVE_SHADER_IDS.lines,
      label: 'particle-field/lines',
      stage: 'render',
      entry: 'fs_main',
      source: resolveGhostWgsl(LINE_WGSL, 'particle-field/lines'),
    },
  ];
}

export function buildParticleFieldNativePrecompileCommands(): ParticleFieldNativePrecompileCommand[] {
  return getParticleFieldNativeShaderSources().map((shader) => ({
    type: 'precompile_shader',
    shader_id: shader.shaderId,
    stage: shader.stage,
    entry: shader.entry,
    source: shader.source,
  }));
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolParam(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function enumParam<T extends string>(value: unknown, allowed: Record<T, number>, fallback: T): T {
  const key = String(value ?? '').trim() as T;
  return Object.prototype.hasOwnProperty.call(allowed, key) ? key : fallback;
}

function colorParam(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value)) return [...fallback] as [number, number, number];
  return [
    clampFinite(value[0], 0, 8, fallback[0]),
    clampFinite(value[1], 0, 8, fallback[1]),
    clampFinite(value[2], 0, 8, fallback[2]),
  ];
}

function normalizeParticleFieldParams(raw: Partial<ParticleFieldParams> | undefined): ParticleFieldParams {
  const src = raw ?? {};
  return {
    mode: enumParam(src.mode, MODE_ID, DEFAULT_PARAMS.mode),
    particleCount: Math.round(clampFinite(src.particleCount, 1024, MAX_PARTICLES, DEFAULT_PARAMS.particleCount)),
    baseSize: clampFinite(src.baseSize, 0.0001, 0.2, DEFAULT_PARAMS.baseSize),
    opacity: clampFinite(src.opacity, 0, 4, DEFAULT_PARAMS.opacity),
    windStrength: clampFinite(src.windStrength, -8, 8, DEFAULT_PARAMS.windStrength),
    windScale: clampFinite(src.windScale, 0.001, 64, DEFAULT_PARAMS.windScale),
    anchorPull: clampFinite(src.anchorPull, -8, 8, DEFAULT_PARAMS.anchorPull),
    damping: clampFinite(src.damping, 0, 16, DEFAULT_PARAMS.damping),
    bass: clampFinite(src.bass, 0, 4, DEFAULT_PARAMS.bass),
    treble: clampFinite(src.treble, 0, 4, DEFAULT_PARAMS.treble),
    shimmerStrength: clampFinite(src.shimmerStrength, 0, 4, DEFAULT_PARAMS.shimmerStrength),
    burstGain: clampFinite(src.burstGain, 0, 16, DEFAULT_PARAMS.burstGain),
    burstDecay: clampFinite(src.burstDecay, 0, 24, DEFAULT_PARAMS.burstDecay),
    galaxyArms: Math.round(clampFinite(src.galaxyArms, 1, 16, DEFAULT_PARAMS.galaxyArms)),
    galaxyRotateInner: clampFinite(src.galaxyRotateInner, -16, 16, DEFAULT_PARAMS.galaxyRotateInner),
    galaxyRotateOuter: clampFinite(src.galaxyRotateOuter, -16, 16, DEFAULT_PARAMS.galaxyRotateOuter),
    galaxyTilt: clampFinite(src.galaxyTilt, -4, 4, DEFAULT_PARAMS.galaxyTilt),
    atomicNuclei: Math.round(clampFinite(src.atomicNuclei, 1, 32, DEFAULT_PARAMS.atomicNuclei)),
    atomicShells: Math.round(clampFinite(src.atomicShells, 1, 16, DEFAULT_PARAMS.atomicShells)),
    atomicShellSpacing: clampFinite(src.atomicShellSpacing, 0.001, 4, DEFAULT_PARAMS.atomicShellSpacing),
    atomicOrbitSpeed: clampFinite(src.atomicOrbitSpeed, -16, 16, DEFAULT_PARAMS.atomicOrbitSpeed),
    swarmCohesion: clampFinite(src.swarmCohesion, -8, 8, DEFAULT_PARAMS.swarmCohesion),
    swarmSeparation: clampFinite(src.swarmSeparation, -8, 8, DEFAULT_PARAMS.swarmSeparation),
    swarmAlignment: clampFinite(src.swarmAlignment, -8, 8, DEFAULT_PARAMS.swarmAlignment),
    swarmRange: clampFinite(src.swarmRange, 0.001, 32, DEFAULT_PARAMS.swarmRange),
    latticeSize: Math.round(clampFinite(src.latticeSize, 2, 128, DEFAULT_PARAMS.latticeSize)),
    latticeSpacing: clampFinite(src.latticeSpacing, 0.001, 8, DEFAULT_PARAMS.latticeSpacing),
    latticeVibration: clampFinite(src.latticeVibration, 0, 4, DEFAULT_PARAMS.latticeVibration),
    mediaDepthAmount: clampFinite(src.mediaDepthAmount, -8, 8, DEFAULT_PARAMS.mediaDepthAmount),
    mediaSampleScale: clampFinite(src.mediaSampleScale, 0.001, 16, DEFAULT_PARAMS.mediaSampleScale),
    gravityWells: Math.round(clampFinite(src.gravityWells, 1, 8, DEFAULT_PARAMS.gravityWells)),
    gravityStrength: clampFinite(src.gravityStrength, -8, 8, DEFAULT_PARAMS.gravityStrength),
    gravityOrbit: clampFinite(src.gravityOrbit, -16, 16, DEFAULT_PARAMS.gravityOrbit),
    gravityCoreSize: clampFinite(src.gravityCoreSize, 0.001, 4, DEFAULT_PARAMS.gravityCoreSize),
    gravityVortex: clampFinite(src.gravityVortex, -16, 16, DEFAULT_PARAMS.gravityVortex),
    gravityMaxVelocity: clampFinite(src.gravityMaxVelocity, 0.001, 64, DEFAULT_PARAMS.gravityMaxVelocity),
    gravityAudioDrive: clampFinite(src.gravityAudioDrive, 0, 16, DEFAULT_PARAMS.gravityAudioDrive),
    gravityChaos: clampFinite(src.gravityChaos, 0, 16, DEFAULT_PARAMS.gravityChaos),
    topology: enumParam(src.topology, TOPO_ID, DEFAULT_PARAMS.topology),
    strokeLength: clampFinite(src.strokeLength, 0, 4, DEFAULT_PARAMS.strokeLength),
    strokeWidth: clampFinite(src.strokeWidth, 0, 2, DEFAULT_PARAMS.strokeWidth),
    colorMode: enumParam(src.colorMode, COLOR_MODE_ID, DEFAULT_PARAMS.colorMode),
    colorMap: enumParam(src.colorMap, COLOR_MAP_ID, DEFAULT_PARAMS.colorMap),
    colorMix: clampFinite(src.colorMix, 0, 1, DEFAULT_PARAMS.colorMix),
    colorMapScale: clampFinite(src.colorMapScale, -16, 16, DEFAULT_PARAMS.colorMapScale),
    colorMapOffset: clampFinite(src.colorMapOffset, -16, 16, DEFAULT_PARAMS.colorMapOffset),
    colorCycleSpeed: clampFinite(src.colorCycleSpeed, -16, 16, DEFAULT_PARAMS.colorCycleSpeed),
    randomSat: clampFinite(src.randomSat, 0, 2, DEFAULT_PARAMS.randomSat),
    randomVal: clampFinite(src.randomVal, 0, 4, DEFAULT_PARAMS.randomVal),
    hueShiftSpeed: clampFinite(src.hueShiftSpeed, -16, 16, DEFAULT_PARAMS.hueShiftSpeed),
    saturation: clampFinite(src.saturation, 0, 4, DEFAULT_PARAMS.saturation),
    brightness: clampFinite(src.brightness, 0, 8, DEFAULT_PARAMS.brightness),
    colorA: colorParam(src.colorA, DEFAULT_PARAMS.colorA),
    colorB: colorParam(src.colorB, DEFAULT_PARAMS.colorB),
    colorC: colorParam(src.colorC, DEFAULT_PARAMS.colorC),
    colorD: colorParam(src.colorD, DEFAULT_PARAMS.colorD),
    connectEnabled: boolParam(src.connectEnabled, DEFAULT_PARAMS.connectEnabled),
    partnerCount: Math.round(clampFinite(src.partnerCount, 1, 32, DEFAULT_PARAMS.partnerCount)),
    localRadius: clampFinite(src.localRadius, 0, 8, DEFAULT_PARAMS.localRadius),
    bridgeRadius: clampFinite(src.bridgeRadius, 0, 8, DEFAULT_PARAMS.bridgeRadius),
    colorLocal: colorParam(src.colorLocal, DEFAULT_PARAMS.colorLocal),
    colorBridge: colorParam(src.colorBridge, DEFAULT_PARAMS.colorBridge),
    alphaLocal: clampFinite(src.alphaLocal, 0, 1, DEFAULT_PARAMS.alphaLocal),
    alphaBridge: clampFinite(src.alphaBridge, 0, 1, DEFAULT_PARAMS.alphaBridge),
    fogDensity: clampFinite(src.fogDensity, 0, 16, DEFAULT_PARAMS.fogDensity),
    fogOpacity: clampFinite(src.fogOpacity, 0, 1, DEFAULT_PARAMS.fogOpacity),
    fogColor: colorParam(src.fogColor, DEFAULT_PARAMS.fogColor),
    lightX: clampFinite(src.lightX, -8, 8, DEFAULT_PARAMS.lightX),
    lightY: clampFinite(src.lightY, -8, 8, DEFAULT_PARAMS.lightY),
    lightZ: clampFinite(src.lightZ, -8, 8, DEFAULT_PARAMS.lightZ),
    lightStrength: clampFinite(src.lightStrength, 0, 8, DEFAULT_PARAMS.lightStrength),
    materialAmbient: clampFinite(src.materialAmbient, 0, 4, DEFAULT_PARAMS.materialAmbient),
    materialDiffuse: clampFinite(src.materialDiffuse, 0, 4, DEFAULT_PARAMS.materialDiffuse),
    materialSpecular: clampFinite(src.materialSpecular, 0, 4, DEFAULT_PARAMS.materialSpecular),
    materialShininess: clampFinite(src.materialShininess, 1, 256, DEFAULT_PARAMS.materialShininess),
    materialReflection: clampFinite(src.materialReflection, 0, 4, DEFAULT_PARAMS.materialReflection),
    fovDeg: clampFinite(src.fovDeg, 1, 160, DEFAULT_PARAMS.fovDeg),
    cameraZ: clampFinite(src.cameraZ, 0.05, 100, DEFAULT_PARAMS.cameraZ),
    rotateX: clampFinite(src.rotateX, -3600, 3600, DEFAULT_PARAMS.rotateX),
    rotateY: clampFinite(src.rotateY, -3600, 3600, DEFAULT_PARAMS.rotateY),
    rotateZ: clampFinite(src.rotateZ, -3600, 3600, DEFAULT_PARAMS.rotateZ),
    autoRotateX: clampFinite(src.autoRotateX, -3600, 3600, DEFAULT_PARAMS.autoRotateX),
    autoRotateY: clampFinite(src.autoRotateY, -3600, 3600, DEFAULT_PARAMS.autoRotateY),
    autoRotateZ: clampFinite(src.autoRotateZ, -3600, 3600, DEFAULT_PARAMS.autoRotateZ),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

function particleRand(seed: number): number {
  let x = seed >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) / 4294967296);
}

function particleInitialBuffer(params: ParticleFieldParams, count: number): ArrayBuffer {
  const n = Math.max(1024, Math.min(MAX_PARTICLES, Math.floor(count)));
  const buffer = new ArrayBuffer(n * PARTICLE_BYTES);
  const f = new Float32Array(buffer);
  const u = new Uint32Array(buffer);

  for (let i = 0; i < n; i++) {
    const off = i * 16;
    const r0 = particleRand(i * 747796405 + 2891336453);
    const r1 = particleRand(i * 2891336453 + 747796405);
    const r2 = particleRand(i * 1597334677 + 3812015801);
    const r3 = particleRand(i * 3812015801 + 1597334677);
    let x = 0;
    let y = 0;
    let z = 0;
    let group = 0;
    let radiusVar = 1;

    if (params.mode === 'galaxy') {
      group = i % Math.max(1, params.galaxyArms | 0);
      const armPhase = group / Math.max(1, params.galaxyArms);
      const r = Math.sqrt(r0) * 0.95;
      const theta = armPhase * Math.PI * 2 + r * 3.0 + (r1 - 0.5) * 0.4;
      x = Math.cos(theta) * r;
      z = Math.sin(theta) * r;
      y = (r2 - 0.5) * 0.04 * (1 - r);
    } else if (params.mode === 'atomic') {
      const nuc = Math.max(1, params.atomicNuclei | 0);
      const sh = Math.max(1, params.atomicShells | 0);
      const nIdx = i % nuc;
      const shIdx = Math.floor(i / nuc) % sh;
      group = nIdx + shIdx * nuc;
      const nT = (nIdx / nuc) * Math.PI * 2;
      const r = (shIdx + 1) * params.atomicShellSpacing;
      const phase = r0 * Math.PI * 2;
      x = Math.cos(nT) * 0.5 + Math.cos(phase) * r;
      y = (r1 - 0.5) * r * 0.5;
      z = Math.sin(nT) * 0.5 + Math.sin(phase) * r * 0.6;
    } else if (params.mode === 'lattice') {
      const sz = Math.max(2, params.latticeSize | 0);
      const ix = i % sz;
      const iy = Math.floor(i / sz) % sz;
      const iz = Math.floor(i / (sz * sz)) % sz;
      x = (ix / sz - 0.5) * params.latticeSpacing;
      y = (iy / sz - 0.5) * params.latticeSpacing;
      z = (iz / sz - 0.5) * params.latticeSpacing;
      group = i;
    } else if (params.mode === 'gravity') {
      const wells = Math.max(1, Math.min(8, params.gravityWells | 0));
      group = i % wells;
      const phase = (group / wells) * Math.PI * 2;
      const shell = Math.pow(r0, 0.55) * 0.9 + 0.08;
      const theta = r1 * Math.PI * 2;
      const phi = Math.acos(r2 * 2 - 1);
      const cx = Math.cos(phase) * 0.45;
      const cz = Math.sin(phase) * 0.45;
      x = cx + Math.sin(phi) * Math.cos(theta) * shell;
      y = (r3 - 0.5) * 0.75 + Math.cos(phi) * shell * 0.35;
      z = cz + Math.sin(phi) * Math.sin(theta) * shell;
      radiusVar = i % 233 === 0 ? 4.2 + r3 * 2.4 : 0.36 + Math.pow(r3, 2.35) * 2.8;
    } else {
      const theta = r0 * Math.PI * 2;
      const phi = Math.acos(r1 * 2 - 1);
      const radius = Math.cbrt(r2);
      x = Math.sin(phi) * Math.cos(theta) * radius;
      y = Math.cos(phi) * radius;
      z = Math.sin(phi) * Math.sin(theta) * radius;
      group = i & 15;
    }

    if (params.mode !== 'gravity') {
      radiusVar = 0.72 + Math.pow(r3, 1.8) * 1.35;
    }

    f[off + 0] = x; f[off + 1] = y; f[off + 2] = z; f[off + 3] = 1;
    f[off + 4] = 0; f[off + 5] = 0; f[off + 6] = 0; f[off + 7] = params.baseSize;
    f[off + 8] = 0.6; f[off + 9] = 0.7; f[off + 10] = 0.95; f[off + 11] = radiusVar;
    u[off + 12] = group >>> 0;
    f[off + 13] = 0;
    f[off + 14] = 0;
    f[off + 15] = 0;
  }
  return buffer;
}

function particleNativeInitialState(params: ParticleFieldParams, time: number): ParticleFieldNativeGraphState {
  return {
    mode: params.mode,
    particleCount: params.particleCount,
    prevFrameTime: time,
    burstImpulse: 0,
    prevBass: 0,
    hueShiftPhase: 0,
    colorCyclePhase: 0,
    autoRotXPhase: 0,
    autoRotYPhase: 0,
    autoRotZPhase: 0,
  };
}

function particleSourcePrefix(sourceId: string, params: ParticleFieldParams): string {
  return `particle-field:${String(sourceId || 'source').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 160)}:${params.mode}:${params.particleCount}`;
}

function buildParticleBehaviorUniform(params: ParticleFieldParams, state: ParticleFieldNativeGraphState, dt: number, time: number): string {
  const buffer = new ArrayBuffer(384);
  const f = new Float32Array(buffer);
  const u = new Uint32Array(buffer);
  f[0] = dt; f[1] = time; u[2] = params.particleCount >>> 0; f[3] = params.baseSize;
  u[4] = MODE_ID[params.mode] >>> 0;
  u[5] = TOPO_ID[params.topology] >>> 0;
  u[6] = params.connectEnabled ? 1 : 0;
  f[8] = params.windStrength; f[9] = params.windScale; f[10] = params.anchorPull; f[11] = params.damping;
  f[12] = params.bass; f[13] = params.treble; f[14] = state.burstImpulse; f[15] = params.shimmerStrength;
  f[16] = params.galaxyArms; f[17] = params.galaxyRotateInner; f[18] = params.galaxyRotateOuter; f[19] = params.galaxyTilt;
  f[20] = params.atomicNuclei; f[21] = params.atomicShells; f[22] = params.atomicShellSpacing; f[23] = params.atomicOrbitSpeed;
  f[24] = params.swarmCohesion; f[25] = params.swarmSeparation; f[26] = params.swarmAlignment; f[27] = params.swarmRange;
  f[28] = params.latticeSize; f[29] = params.latticeSpacing; f[30] = params.latticeVibration;
  f[32] = params.mediaDepthAmount; f[33] = params.mediaSampleScale;
  f[36] = params.fogDensity; f[37] = params.lightX; f[38] = params.lightY; f[39] = params.lightZ;
  f[40] = params.saturation; f[41] = params.brightness; u[42] = COLOR_MODE_ID[params.colorMode] >>> 0; u[43] = COLOR_MAP_ID[params.colorMap] >>> 0;
  f[44] = params.colorMix; f[45] = params.colorMapScale; f[46] = params.colorMapOffset; f[47] = state.colorCyclePhase;
  f[48] = params.randomSat; f[49] = params.randomVal; f[50] = state.hueShiftPhase;
  f[52] = params.colorA[0]; f[53] = params.colorA[1]; f[54] = params.colorA[2];
  f[56] = params.colorB[0]; f[57] = params.colorB[1]; f[58] = params.colorB[2];
  f[60] = params.colorC[0]; f[61] = params.colorC[1]; f[62] = params.colorC[2];
  f[64] = params.colorD[0]; f[65] = params.colorD[1]; f[66] = params.colorD[2];
  f[68] = params.gravityWells; f[69] = params.gravityStrength; f[70] = params.gravityOrbit; f[71] = params.gravityCoreSize;
  f[72] = params.gravityVortex; f[73] = params.gravityMaxVelocity; f[74] = params.gravityAudioDrive; f[75] = params.gravityChaos;
  return bufferToBase64(buffer);
}

function buildParticleRenderUniform(params: ParticleFieldParams, state: ParticleFieldNativeGraphState, width: number, height: number): string {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const proj = perspective(params.fovDeg, aspect, 0.05, 100);
  const view = translate(0, 0, -params.cameraZ);
  const d2r = Math.PI / 180;
  const rxRad = (params.rotateX + state.autoRotXPhase) * d2r;
  const ryRad = (params.rotateY + state.autoRotYPhase) * d2r;
  const rzRad = (params.rotateZ + state.autoRotZPhase) * d2r;
  const cx = Math.cos(rxRad), sx = Math.sin(rxRad);
  const cy = Math.cos(ryRad), sy = Math.sin(ryRad);
  const cz = Math.cos(rzRad), sz = Math.sin(rzRad);
  const rxM = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
  const ryM = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
  const rzM = new Float32Array([cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const viewProj = mat4Mul(proj, mat4Mul(view, mat4Mul(rzM, mat4Mul(ryM, rxM))));
  const lx = params.lightX, ly = params.lightY, lz = params.lightZ;
  const llen = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
  const buffer = new ArrayBuffer(192);
  const f = new Float32Array(buffer);
  const u = new Uint32Array(buffer);
  f.set(viewProj, 0);
  f[16] = 1; f[17] = 0; f[18] = 0;
  f[20] = 0; f[21] = 1; f[22] = 0;
  f[24] = 0; f[25] = 0; f[26] = params.cameraZ;
  u[27] = TOPO_ID[params.topology] >>> 0;
  f[28] = params.strokeLength; f[29] = params.strokeWidth; f[30] = params.opacity;
  f[32] = params.fogColor[0]; f[33] = params.fogColor[1]; f[34] = params.fogColor[2]; f[35] = params.fogDensity;
  f[36] = lx / llen; f[37] = ly / llen; f[38] = lz / llen; f[39] = params.lightStrength;
  f[40] = params.materialAmbient; f[41] = params.materialDiffuse; f[42] = params.materialSpecular; f[43] = params.materialShininess; f[44] = params.materialReflection;
  return bufferToBase64(buffer);
}

function buildParticleFogUniform(params: ParticleFieldParams): string {
  const buffer = new ArrayBuffer(16);
  const f = new Float32Array(buffer);
  f[0] = params.fogColor[0];
  f[1] = params.fogColor[1];
  f[2] = params.fogColor[2];
  f[3] = params.fogOpacity;
  return bufferToBase64(buffer);
}

function buildParticleLineUniform(params: ParticleFieldParams, state: ParticleFieldNativeGraphState, width: number, height: number): string {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const proj = perspective(params.fovDeg, aspect, 0.05, 100);
  const view = translate(0, 0, -params.cameraZ);
  const d2r = Math.PI / 180;
  const rxRad = (params.rotateX + state.autoRotXPhase) * d2r;
  const ryRad = (params.rotateY + state.autoRotYPhase) * d2r;
  const rzRad = (params.rotateZ + state.autoRotZPhase) * d2r;
  const cx = Math.cos(rxRad), sx = Math.sin(rxRad);
  const cy = Math.cos(ryRad), sy = Math.sin(ryRad);
  const cz = Math.cos(rzRad), sz = Math.sin(rzRad);
  const rxM = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
  const ryM = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
  const rzM = new Float32Array([cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const viewProj = mat4Mul(proj, mat4Mul(view, mat4Mul(rzM, mat4Mul(ryM, rxM))));
  const buffer = new ArrayBuffer(160);
  const f = new Float32Array(buffer);
  f.set(viewProj, 0);
  f[16] = 0; f[17] = 0; f[18] = params.cameraZ;
  f[20] = params.colorLocal[0]; f[21] = params.colorLocal[1]; f[22] = params.colorLocal[2]; f[23] = params.alphaLocal;
  f[24] = params.colorBridge[0]; f[25] = params.colorBridge[1]; f[26] = params.colorBridge[2]; f[27] = params.alphaBridge;
  f[28] = params.fogColor[0]; f[29] = params.fogColor[1]; f[30] = params.fogColor[2]; f[31] = params.fogDensity;
  return bufferToBase64(buffer);
}

export function buildParticleFieldNativeComputeGraph(options: ParticleFieldNativeGraphOptions): ParticleFieldNativeGraphBuildResult {
  const params = normalizeParticleFieldParams(options.params);
  if (typeof options.audioBass === 'number') params.bass = clampFinite(options.audioBass, 0, 4, params.bass);
  if (typeof options.audioTreble === 'number') params.treble = clampFinite(options.audioTreble, 0, 4, params.treble);
  const sourceId = String(options.sourceId || 'particle-field-native-source');
  const time = Math.max(0, Number.isFinite(options.time) ? Number(options.time) : 0);
  const mustReset = !!options.reset
    || !options.state
    || options.state.mode !== params.mode
    || options.state.particleCount !== params.particleCount;
  const state = mustReset ? particleNativeInitialState(params, time) : { ...options.state! };
  let dt = typeof options.frameDelta === 'number' && Number.isFinite(options.frameDelta)
    ? options.frameDelta
    : (state.prevFrameTime === 0 ? 1 / 60 : time - state.prevFrameTime);
  dt = Math.min(Math.max(dt, 0), 1 / 15);
  state.prevFrameTime = time;
  const bassDelta = Math.max(0, params.bass - state.prevBass);
  if (bassDelta > 0.04) state.burstImpulse += bassDelta * params.burstGain * 8;
  state.burstImpulse = Math.max(0, state.burstImpulse - state.burstImpulse * params.burstDecay * dt);
  state.prevBass = params.bass;
  state.hueShiftPhase = (state.hueShiftPhase + params.hueShiftSpeed * dt) % 1;
  state.colorCyclePhase = (state.colorCyclePhase + params.colorCycleSpeed * dt) % 1;
  state.autoRotXPhase += params.autoRotateX * dt;
  state.autoRotYPhase += params.autoRotateY * dt;
  state.autoRotZPhase += params.autoRotateZ * dt;

  const prefix = particleSourcePrefix(sourceId, params);
  const id = (name: string) => `${prefix}:${name}`;
  const width = Math.round(options.width || 1920);
  const height = Math.round(options.height || 1080);
  const buffers: ParticleFieldNativeGraphBuffer[] = [
    { id: id('behavior-uniform'), kind: 'uniform', byte_length: 384, initial_b64: buildParticleBehaviorUniform(params, state, dt, time) },
    { id: id('render-uniform'), kind: 'uniform', byte_length: 192, initial_b64: buildParticleRenderUniform(params, state, width, height) },
    { id: id('fog-uniform'), kind: 'uniform', byte_length: 16, initial_b64: buildParticleFogUniform(params) },
    {
      id: id('particles'),
      kind: 'storage',
      byte_length: params.particleCount * PARTICLE_BYTES,
      persistent: true,
      clear: mustReset,
      initial_buffer: mustReset ? particleInitialBuffer(params, params.particleCount) : undefined,
    },
  ];
  if (params.connectEnabled) {
    buffers.push(
      {
        id: id('edge-uniform'),
        kind: 'uniform',
        byte_length: 64,
        initial_b64: (() => {
          const buffer = new ArrayBuffer(64);
          const f = new Float32Array(buffer);
          const u = new Uint32Array(buffer);
          u[0] = params.particleCount >>> 0;
          u[1] = Math.max(1, Math.min(32, params.partnerCount | 0)) >>> 0;
          u[2] = MAX_EDGES >>> 0;
          f[4] = params.localRadius;
          f[5] = params.bridgeRadius;
          return bufferToBase64(buffer);
        })(),
      },
      { id: id('line-uniform'), kind: 'uniform', byte_length: 160, initial_b64: buildParticleLineUniform(params, state, width, height) },
      {
        id: id('indirect'),
        kind: 'storage',
        byte_length: 16,
        persistent: true,
        initial_u32: [2, 0, 0, 0],
        indirect: true,
      },
      {
        id: id('edges'),
        kind: 'storage',
        byte_length: MAX_EDGES * EDGE_BYTES,
        persistent: true,
        clear: mustReset,
      },
    );
  }

  const workgroups = Math.ceil(params.particleCount / 64);
  const mediaSourceId = String(options.mediaSourceId || '');
  const passes: ParticleFieldNativeGraphPass[] = [
    {
      name: 'particle-behavior',
      shader_id: PARTICLE_FIELD_NATIVE_SHADER_IDS.behavior,
      entry: 'cs_main',
      dispatch: [workgroups, 1, 1],
      bindings: [
        { binding: 0, resource: id('particles'), kind: 'storage' },
        { binding: 1, resource: id('behavior-uniform'), kind: 'uniform' },
        mediaSourceId
          ? { binding: 2, kind: 'source-frame-texture', source_id: mediaSourceId }
          : { binding: 2, kind: 'source-frame-texture', allow_missing: true },
        { binding: 3, kind: 'source-frame-sampler' },
      ],
    },
  ];
  if (params.connectEnabled) {
    passes.push({
      name: 'particle-edges',
      shader_id: PARTICLE_FIELD_NATIVE_SHADER_IDS.edges,
      entry: 'cs_edges',
      dispatch: [workgroups, 1, 1],
      bindings: [
        { binding: 0, resource: id('particles'), kind: 'read-only-storage' },
        { binding: 1, resource: id('edge-uniform'), kind: 'uniform' },
        { binding: 2, resource: id('indirect'), kind: 'storage' },
        { binding: 3, resource: id('edges'), kind: 'storage' },
      ],
    });
  }

  const renderPasses: ParticleFieldNativeGraphRenderPass[] = [];
  if (params.fogOpacity > 0.001) {
    renderPasses.push({
      name: 'particle-fog',
      shader_id: PARTICLE_FIELD_NATIVE_SHADER_IDS.fog,
      vertex_entry: 'vs_main',
      fragment_entry: 'fs_main',
      target: 'source_frame',
      source_id: sourceId,
      seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
      clear: true,
      include_snapshot: false,
      blend: 'alpha',
      vertex_count: 3,
      instance_count: 1,
      bindings: [
        { binding: 0, resource: id('fog-uniform'), kind: 'uniform' },
      ],
    });
  }

  const useSphereDepth = params.topology === 'sphere' || params.topology === 'softSphere';
  renderPasses.push({
    name: 'particle-render',
    shader_id: PARTICLE_FIELD_NATIVE_SHADER_IDS.render,
    vertex_entry: 'vs_main',
    fragment_entry: 'fs_main',
    target: 'source_frame',
    source_id: sourceId,
    seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
    clear: renderPasses.length === 0,
    include_snapshot: !!options.includeSnapshot,
    blend: useSphereDepth ? 'alpha' : 'add',
    vertex_count: 6,
    instance_count: params.particleCount,
    depth: useSphereDepth,
    depth_write: useSphereDepth,
    depth_compare: 'less',
    bindings: [
      { binding: 0, resource: id('particles'), kind: 'read-only-storage' },
      { binding: 1, resource: id('render-uniform'), kind: 'uniform' },
    ],
  });
  if (params.connectEnabled) {
    renderPasses.push({
      name: 'particle-lines',
      shader_id: PARTICLE_FIELD_NATIVE_SHADER_IDS.lines,
      vertex_entry: 'vs_main',
      fragment_entry: 'fs_main',
      target: 'source_frame',
      source_id: sourceId,
      seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
      clear: false,
      include_snapshot: false,
      blend: 'alpha',
      primitive: 'line-list',
      vertex_count: 2,
      instance_count: 0,
      draw_indirect_buffer: id('indirect'),
      draw_indirect_offset: 0,
      bindings: [
        { binding: 0, resource: id('particles'), kind: 'read-only-storage' },
        { binding: 1, resource: id('edges'), kind: 'read-only-storage' },
        { binding: 2, resource: id('line-uniform'), kind: 'uniform' },
      ],
    });
  }

  return {
    config: {
      buffers,
      passes,
      render_passes: renderPasses,
      readbacks: [],
    },
    sourceId,
    state,
    particleCount: params.particleCount,
    topology: params.topology,
    passCount: passes.length + renderPasses.length,
  };
}

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
  private lastGraphStats: GhostGpuFrameGraphRunStats | null = null;

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
    const shaderRuntime = getGhostGpuRuntime() ?? this.device;
    // ── Fog fullscreen pipeline ─────────────────────────────────
    // Runs first each frame, paints the canvas with fog color so
    // the rest of the scene composites against an atmospheric
    // background rather than transparent black.
    const fogMod = createAndWarmWgslShaderModule(shaderRuntime, FOG_WGSL, 'particle-field/fog');
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
    const behaviorMod = createAndWarmWgslShaderModule(shaderRuntime, BEHAVIOR_WGSL, 'particle-field/behavior');
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
    const edgeMod = createAndWarmWgslShaderModule(shaderRuntime, EDGE_GEN_WGSL, 'particle-field/edges');
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
    const renderMod = createAndWarmWgslShaderModule(shaderRuntime, RENDER_WGSL, 'particle-field/render');
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
    const lineMod = createAndWarmWgslShaderModule(shaderRuntime, LINE_WGSL, 'particle-field/lines');
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

    this.lastGraphStats = this.buildFrameGraph(encoder, targetView, useSphereDepth).execute();
  }

  private buildFrameGraph(encoder: any, targetView: any, useSphereDepth: boolean): { execute: () => GhostGpuFrameGraphRunStats } {
    const graph = new GhostGpuFrameGraph(getGhostGpuRuntime() ?? { device: this.device });
    this.importParticleGraphResources(graph);
    const workgroups = Math.ceil(this.particleCount / 64);

    graph.addPass({
      name: 'particle-behavior',
      kind: 'compute',
      reads: ['particles', 'behavior-uniform'],
      writes: ['particles'],
      execute: (ctx) => {
        const pass = ctx.encoder.beginComputePass();
        pass.setPipeline(this.behaviorPipeline);
        pass.setBindGroup(0, this.behaviorBindGroup);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
      },
    });

    if (this.params.connectEnabled) {
      graph.addPass({
        name: 'particle-edges',
        kind: 'compute',
        reads: ['particles', 'edge-uniform'],
        writes: ['edge-buffer', 'indirect-args'],
        execute: (ctx) => {
          const pass = ctx.encoder.beginComputePass();
          pass.setPipeline(this.edgePipeline);
          pass.setBindGroup(0, this.edgeBindGroup);
          pass.dispatchWorkgroups(workgroups);
          pass.end();
        },
      });
    }

    if (this.params.fogOpacity > 0.001) {
      graph.addPass({
        name: 'particle-fog',
        kind: 'render',
        reads: ['fog-uniform'],
        execute: (ctx) => {
          const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [{
              view: targetView,
              loadOp: 'load',
              storeOp: 'store',
            }],
          });
          pass.setPipeline(this.fogPipeline);
          pass.setBindGroup(0, this.fogBindGroup);
          pass.draw(3, 1, 0, 0);
          pass.end();
        },
      });
    }

    graph.addPass({
      name: 'particle-render',
      kind: 'render',
      reads: ['particles', 'render-uniform'],
      execute: (ctx) => {
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
        const pass = ctx.encoder.beginRenderPass(renderPassDesc);
        pass.setPipeline(useSphereDepth ? this.renderAlphaPipeline : this.renderPipeline);
        pass.setBindGroup(0, this.renderBindGroup);
        pass.draw(6, this.particleCount, 0, 0);
        pass.end();
      },
    });

    if (this.params.connectEnabled) {
      graph.addPass({
        name: 'particle-lines',
        kind: 'render',
        reads: ['particles', 'edge-buffer', 'indirect-args', 'line-uniform'],
        execute: (ctx) => {
          const pass = ctx.encoder.beginRenderPass({
            colorAttachments: [{
              view: targetView,
              loadOp: 'load',
              storeOp: 'store',
            }],
          });
          pass.setPipeline(this.linePipeline);
          pass.setBindGroup(0, this.lineBindGroup);
          pass.drawIndirect(this.indirectBuffer, 0);
          pass.end();
        },
      });
    }

    return {
      execute: () => graph.execute(encoder),
    };
  }

  getDebugStats(): Record<string, any> {
    return {
      instrument: 'particle-field',
      mode: this.params.mode,
      topology: this.params.topology,
      particleCount: this.particleCount,
      connectEnabled: this.params.connectEnabled,
      partnerCount: this.params.partnerCount,
      passes: this.lastGraphStats?.passes ?? [],
      graphCpuMs: this.lastGraphStats?.totalCpuMs ?? 0,
    };
  }

  private importParticleGraphResources(graph: GhostGpuFrameGraph): void {
    graph
      .importBuffer('particles', this.particleBuffer)
      .importBuffer('indirect-args', this.indirectBuffer)
      .importBuffer('edge-buffer', this.edgeBuffer)
      .importBuffer('behavior-uniform', this.behaviorUniform)
      .importBuffer('edge-uniform', this.edgeUniform)
      .importBuffer('render-uniform', this.renderUniform)
      .importBuffer('line-uniform', this.lineUniform)
      .importBuffer('fog-uniform', this.fogUniform);
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
