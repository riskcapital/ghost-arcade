// HandFX body and face modes.
//
// These modes run a dense particle simulation on the GPU. Particles are not
// drawn as quads: a compute pass adds each one into a full-frame light grid
// (atomic adds, four taps), the grid fades a little every frame so motion
// leaves trails, and one render pass tone-maps the grid with a blurred copy
// for glow. The cost follows the particle count, not the overdraw, which is
// what lets a million particles run at full rate.
//
// No pass seeds state. A zeroed particle is a dead particle and respawns from
// the live body, so a skipped first frame (async pipeline warm-up) costs
// nothing.
import type { PoseLandmark, SignalFrame } from '$lib/mediapipe/signals';

export const HAND_FX_FIELD_MODES = ['bodyswarm', 'bodyflow', 'bodyaura', 'facemask', 'facestream'] as const;
export type HandFxFieldMode = typeof HAND_FX_FIELD_MODES[number];
export const HAND_FX_BODY_MODES: readonly string[] = ['bodyswarm', 'bodyflow', 'bodyaura'];
export const HAND_FX_FACE_MODES: readonly string[] = ['facemask', 'facestream'];
/** Index of the first field mode in the shader's mode number. */
export const HAND_FX_FIELD_MODE_BASE = 11;
export const HAND_FX_QUALITY_PARTICLES: Record<string, number> = {
  low: 131_072,
  medium: 262_144,
  high: 524_288,
  ultra: 1_048_576,
  max: 2_097_152,
};
export const HAND_FX_DEFAULT_QUALITY = 'high';
export const HAND_FX_POSE_POINTS = 33;
export const HAND_FX_FACE_POINTS = 478;
export const HAND_FX_BODY_HEADER_VEC4 = 8;
export const HAND_FX_BODY_BUFFER_BYTES = (HAND_FX_BODY_HEADER_VEC4 + HAND_FX_POSE_POINTS * 2 + HAND_FX_FACE_POINTS) * 16;
export const HAND_FX_FLUID_WIDTH = 256;
export const HAND_FX_FLUID_JACOBI = 21;

export function handFxFieldModeIndex(mode: unknown): number {
  const index = HAND_FX_FIELD_MODES.indexOf(String(mode) as HandFxFieldMode);
  return index < 0 ? -1 : HAND_FX_FIELD_MODE_BASE + index;
}

/** Which trackers the selected mode needs. Each one costs camera frame rate. */
export function handFxTrackingNeeds(params: Record<string, any> | null | undefined): { trackBody: boolean; trackFace: boolean } {
  const mode = String(params?.handfxMode ?? '');
  return { trackBody: HAND_FX_BODY_MODES.includes(mode), trackFace: HAND_FX_FACE_MODES.includes(mode) };
}

const COMMON_WGSL = /* wgsl */ `
struct U {
  resolution: vec2<f32>, time: f32, dt: f32,
  handCount: u32, mode: u32, colorMode: u32, pad0: u32,
  smoothing: f32, thickness: f32, intensity: f32, threshold: f32,
  fade: f32, flow: f32, bgAlpha: f32, seed: f32,
  panelColor: vec4<f32>, skeletonColor: vec4<f32>,
  velocityScale: f32, sparkDensity: f32, inkOpacity: f32, panelPadding: f32,
  panelRadius: f32, predictSeconds: f32, cameraOpacity: f32, pad1: f32,
  performance: vec4<f32>,
};
// head[0] = pose seen, face seen, body size, body speed
// head[1] = mouth open, brows raised, head turn, head tilt
// head[2] = face centre xy, face size, shatter
// head[3] = mouth xy, mouth direction xy
// head[4] = trails, swirl, particle count, grid width
// head[5] = grid height, fluid width, fluid height, energy per particle
// head[6] = body centre xy, glow width, glow height
// head[7] = fade per frame, smile, spare, spare
// pose    = 33 x (xy, z, visibility) then (velocity xy, 0, 0)
// face    = 478 x (xy, z, 1)
struct Body {
  head: array<vec4<f32>, 8>,
  pose: array<vec4<f32>, 66>,
  face: array<vec4<f32>, 478>,
};
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn unit(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }
fn grad(ip: vec2<i32>) -> vec2<f32> {
  let h = pcg(bitcast<u32>(ip.x) * 1597334677u ^ pcg(bitcast<u32>(ip.y) * 3812015801u));
  let a = unit(h) * 6.2831853;
  return vec2(cos(a), sin(a));
}
fn gnoise(p: vec2<f32>) -> f32 {
  let i = vec2<i32>(floor(p)); let f = fract(p);
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(grad(i), f);
  let b = dot(grad(i + vec2(1, 0)), f - vec2(1.0, 0.0));
  let c = dot(grad(i + vec2(0, 1)), f - vec2(0.0, 1.0));
  let d = dot(grad(i + vec2(1, 1)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn psi(p: vec2<f32>, t: f32) -> f32 {
  return gnoise(p + vec2(t * 0.21, -t * 0.17)) + 0.5 * gnoise(p * 2.13 + vec2(-t * 0.3, t * 0.26) + vec2(17.0, 5.0));
}
// Divergence-free swirl: particles following it never bunch up or thin out.
fn curl(p: vec2<f32>, t: f32) -> vec2<f32> {
  let e = 0.02;
  let a = psi(p + vec2(0.0, e), t) - psi(p - vec2(0.0, e), t);
  let b = psi(p + vec2(e, 0.0), t) - psi(p - vec2(e, 0.0), t);
  return vec2(a, -b) / (2.0 * e);
}
`;

export const HAND_FIELD_SIM_WGSL = /* wgsl */ `${COMMON_WGSL}
struct Particle { pos: vec2<f32>, vel: vec2<f32>, life: f32, span: f32, aux: f32, tag: u32 };
struct ParticleBuffer { values: array<Particle> };
struct AccBuffer { values: array<atomic<u32>> };
struct Vec4Buffer { values: array<vec4<f32>> };
struct Vec2Buffer { values: array<vec2<f32>> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> body: Body;
@group(0) @binding(2) var<storage, read_write> particles: ParticleBuffer;
@group(0) @binding(3) var<storage, read_write> acc: AccBuffer;
@group(0) @binding(4) var<storage, read> fluid: Vec4Buffer;
@group(0) @binding(5) var<storage, read> topology: Vec4Buffer;
@group(0) @binding(6) var<storage, read> glowSrc: Vec2Buffer;
@group(0) @binding(7) var<storage, read_write> glowDst: Vec2Buffer;

fn rnd(seed: ptr<function, u32>) -> f32 { *seed = pcg(*seed); return unit(*seed); }
fn aspect() -> vec2<f32> { return vec2(u.resolution.x / max(1.0, u.resolution.y), 1.0); }
fn P(i: u32) -> vec2<f32> { return body.pose[i * 2u].xy; }
fn PV(i: u32) -> vec2<f32> { return body.pose[i * 2u + 1u].xy; }
fn PVis(i: u32) -> f32 { return body.pose[i * 2u].w; }

struct Spawn { pos: vec2<f32>, vel: vec2<f32>, vis: f32, region: f32, normal: vec2<f32> };
// A random point on the body: torso, head or a limb, with the speed the body has there.
fn body_spawn(seed: ptr<function, u32>, spread: f32) -> Spawn {
  let A = aspect();
  let scale = body.head[0].z;
  var s: Spawn;
  let pick = rnd(seed);
  if (pick < 0.22) {
    let a = rnd(seed); let b = rnd(seed);
    s.pos = mix(mix(P(11u), P(12u), a), mix(P(23u), P(24u), a), b);
    s.vel = mix(mix(PV(11u), PV(12u), a), mix(PV(23u), PV(24u), a), b);
    s.vis = min(min(PVis(11u), PVis(12u)), min(PVis(23u), PVis(24u)));
    s.region = 0.08;
    let side = normalize((P(12u) - P(11u)) * A + vec2(0.0001, 0.0));
    s.normal = side * sign(a - 0.5);
    s.pos += s.normal * abs(a - 0.5) * spread * scale * 0.08 / A;
  } else if (pick < 0.34) {
    let centre = (P(7u) + P(8u)) * 0.5;
    let radius = max(distance(P(7u) * A, P(8u) * A) * 0.62, scale * 0.14);
    let angle = rnd(seed) * 6.2831853;
    let reach = mix(sqrt(rnd(seed)), 1.0, clamp(spread - 1.0, 0.0, 1.0));
    s.normal = vec2(cos(angle), sin(angle));
    s.pos = centre + s.normal * radius * reach / A;
    s.vel = PV(0u);
    s.vis = PVis(0u);
    s.region = 0.0;
  } else {
    let limbs = array<vec2<u32>, 12>(
      vec2(11u, 13u), vec2(13u, 15u), vec2(12u, 14u), vec2(14u, 16u),
      vec2(23u, 25u), vec2(25u, 27u), vec2(24u, 26u), vec2(26u, 28u),
      vec2(27u, 31u), vec2(28u, 32u), vec2(15u, 19u), vec2(16u, 20u));
    let girth = array<f32, 12>(0.085, 0.065, 0.085, 0.065, 0.12, 0.09, 0.12, 0.09, 0.05, 0.05, 0.045, 0.045);
    let index = min(11u, u32(rnd(seed) * 12.0));
    let bone = limbs[index];
    let t = rnd(seed);
    let a = P(bone.x); let b = P(bone.y);
    let along = normalize((b - a) * A + vec2(0.0, 0.0001));
    let side = (rnd(seed) + rnd(seed)) - 1.0;
    s.normal = vec2(-along.y, along.x) * select(-1.0, 1.0, side >= 0.0);
    let offset = mix(abs(side), 1.0, clamp(spread - 1.0, 0.0, 1.0)) * girth[index] * scale * min(spread, 1.0);
    s.pos = mix(a, b, t) + s.normal * offset / A;
    s.vel = mix(PV(bone.x), PV(bone.y), t);
    s.vis = min(PVis(bone.x), PVis(bone.y));
    s.region = 0.16 + f32(index / 2u) * 0.07;
  }
  return s;
}

fn fluid_at(pos: vec2<f32>) -> vec2<f32> {
  let size = vec2(body.head[5].y, body.head[5].z);
  let g = clamp(pos * size - 0.5, vec2(0.0), size - 1.001);
  let i = vec2<u32>(floor(g)); let f = fract(g);
  let w = u32(size.x);
  let a = fluid.values[i.y * w + i.x].xy;
  let b = fluid.values[i.y * w + i.x + 1u].xy;
  let c = fluid.values[(i.y + 1u) * w + i.x].xy;
  let d = fluid.values[(i.y + 1u) * w + i.x + 1u].xy;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) / size;
}

struct FacePoint { home: vec2<f32>, z: f32, wire: f32 };
// Where a mask particle belongs: on a line between two neighbouring face
// points (the wire) or in a soft cloud around one.
fn face_home(slot: u32, stable: u32) -> FacePoint {
  let A = aspect();
  let a = slot % 478u;
  let kind = (slot / 478u) % 4u;
  let la = body.face[a];
  var out: FacePoint;
  out.home = la.xy; out.z = la.z; out.wire = 1.0;
  if (kind < 3u) {
    let b = min(477u, u32(topology.values[a][kind]));
    let lb = body.face[b];
    let t = unit(stable);
    out.home = mix(la.xy, lb.xy, t); out.z = mix(la.z, lb.z, t);
  } else {
    let angle = unit(stable) * 6.2831853;
    let reach = sqrt(-2.0 * log(max(0.0001, unit(pcg(stable + 7u))))) * 0.011;
    out.home += vec2(cos(angle), sin(angle)) * reach * body.head[2].z / A;
    out.wire = 0.45;
  }
  return out;
}

@compute @workgroup_size(64)
fn cs_particles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let count = u32(body.head[4].z);
  let i = gid.x;
  if (i >= count) { return; }
  var p = particles.values[i];
  var seed = pcg(i * 2654435761u + u32(fract(u.time * 0.137) * 16777216.0) + 1u);
  let stable = pcg(i * 7919u + 13u);
  let ps = unit(stable);
  let dt = clamp(u.dt, 1.0 / 240.0, 1.0 / 20.0);
  let A = aspect();
  let swirl = body.head[4].y;
  let audio = u.performance.w;
  let poseSeen = body.head[0].x > 0.5;
  let faceSeen = body.head[0].y > 0.5;
  let scale = max(0.05, body.head[0].z) * u.performance.y;
  var energy = 0.0;
  var hue = 0.0;
  if (p.tag != u.mode) { p.life = 0.0; p.span = 1.0; p.aux = 0.0; p.vel = vec2(0.0); p.tag = u.mode; }

  if (u.mode == 11u) {
    // Particle body: born all over the body, thrown off by whatever moves.
    if (p.life <= 0.0) {
      if (poseSeen) {
        var s = body_spawn(&seed, 1.0);
        if (ps >= 0.3) {
          // Dust favours whatever is moving: of two places, take the faster.
          let other = body_spawn(&seed, 1.0);
          if (other.vis > 0.3 && (s.vis <= 0.3 || length(other.vel * A) > length(s.vel * A))) { s = other; }
        }
        if (s.vis > 0.3) {
          let angle = rnd(&seed) * 6.2831853;
          let speed = length(s.vel * A);
          p.pos = s.pos;
          if (ps < 0.3) {
            // Skin: short-lived and riding with the body, so the figure stays sharp.
            p.vel = s.vel;
            p.span = 0.1 + 0.25 * rnd(&seed);
          } else {
            // Dust: keeps part of the body's speed and is left behind.
            p.vel = s.vel * (0.2 + 0.9 * rnd(&seed)) + vec2(cos(angle), sin(angle)) * (0.006 + speed * 0.22) * rnd(&seed) / A;
            // What a still body sheds dies young; what a fast limb throws lives to trail.
            p.span = (0.7 + 3.6 * rnd(&seed) * rnd(&seed)) * mix(0.25, 1.0, smoothstep(0.03, 0.35, speed));
          }
          p.life = p.span;
          p.aux = s.region;
        }
      }
    } else {
      let c = curl(p.pos * A * 3.2 / max(0.3, u.performance.y), u.time * 0.7) / A;
      let age = 1.0 - p.life / p.span;
      p.vel += c * (0.12 + swirl * 0.42) * (1.0 + audio * 1.5) * dt;
      p.vel *= exp(-1.25 * dt);
      p.vel.y += 0.02 * dt;
      // Old dust is also carried by the swirl itself, which pulls it into wisps.
      p.pos += (p.vel + c * (0.012 + swirl * 0.05) * smoothstep(0.1, 0.6, age) * step(0.3, ps)) * dt;
      p.life -= dt;
      let speed = length(p.vel * A);
      energy = smoothstep(0.0, 0.06, age) * smoothstep(0.0, 0.55, 1.0 - age) * (0.4 + min(speed * 7.0, 5.0));
      hue = clamp(p.aux * 0.5 + ps * 0.25 + min(speed * 0.9, 0.6), 0.0, 1.0);
    }
  } else if (u.mode == 12u) {
    // Force field: tracers ride a fluid that the skeleton stirs.
    let outside = p.pos.x < -0.02 || p.pos.x > 1.02 || p.pos.y < -0.02 || p.pos.y > 1.02;
    if (p.life <= 0.0 || outside) {
      p.pos = vec2(rnd(&seed), rnd(&seed));
      p.vel = vec2(0.0);
      p.span = 2.5 + 6.0 * rnd(&seed);
      p.life = p.span;
    } else {
      let wind = curl(p.pos * A * 2.1, u.time * 0.5) / A * (0.02 + swirl * 0.05);
      let want = fluid_at(p.pos) + wind;
      p.vel = mix(p.vel, want, 1.0 - exp(-12.0 * dt));
      p.pos += p.vel * dt;
      p.life -= dt;
      let age = 1.0 - p.life / p.span;
      let speed = length(p.vel * A);
      energy = smoothstep(0.0, 0.08, age) * smoothstep(0.0, 0.2, 1.0 - age) * (0.04 + min(speed * speed * 14.0 + speed * 1.2, 2.6) + audio * 0.12);
      hue = clamp(0.04 + ps * 0.14 + min(speed * 1.6, 0.85), 0.0, 1.0);
    }
  } else if (u.mode == 13u) {
    // Aura: ribbons pour off wrists and ankles, flames climb off the outline.
    let ribbon = (i % 16u) < 10u;
    if (p.life <= 0.0) {
      if (poseSeen && ribbon) {
        let joints = array<u32, 4>(15u, 16u, 27u, 28u);
        let joint = joints[(i / 16u) % 4u];
        if (PVis(joint) > 0.3) {
          let v = PV(joint);
          let speed = length(v * A);
          let dir = select(vec2(0.0, 1.0), v * A / max(speed, 0.0001), speed > 0.02);
          let strand = (floor(ps * 7.0) / 6.0 - 0.5) * 2.0;
          // Spread this frame's births along the path just travelled, so a fast
          // wrist draws an unbroken band and not a row of dots.
          p.pos = P(joint) - v * dt * rnd(&seed) + vec2(-dir.y, dir.x) * strand * scale * 0.1 / A;
          p.vel = v * 0.1;
          p.span = 1.0 + 2.6 * rnd(&seed);
          p.life = p.span;
          p.aux = clamp(speed * 1.6, 0.03, 1.6);
        }
      } else if (poseSeen) {
        let s = body_spawn(&seed, 2.0);
        if (s.vis > 0.3) {
          p.pos = s.pos;
          p.vel = s.vel * 0.25 + (s.normal * 0.03 + vec2(0.0, 0.07 + 0.16 * rnd(&seed)) * (1.0 + audio * 1.5)) * scale * 3.0 / A;
          p.span = 0.35 + 0.9 * rnd(&seed);
          p.life = p.span;
          p.aux = 0.0;
        }
      }
    } else {
      let age = 1.0 - p.life / p.span;
      if (ribbon) {
        let c = curl(p.pos * A * 1.4, u.time * 0.35) / A;
        p.vel += c * (0.03 + swirl * 0.12) * dt;
        p.vel *= exp(-1.3 * dt);
        // The band is carried by the swirl as it ages, so it billows like silk.
        p.pos += c * (0.012 + swirl * 0.045) * smoothstep(0.05, 0.7, age) * dt;
        let thread = 0.45 + 0.55 * fract(floor(ps * 7.0) * 0.618);
        energy = p.aux * thread * smoothstep(0.0, 0.03, age) * pow(1.0 - age, 1.5) * 2.4;
        hue = clamp(0.2 + f32((i / 16u) % 4u) * 0.12 + thread * 0.25 + (1.0 - age) * 0.25, 0.0, 1.0);
      } else {
        let c = curl(p.pos * A * 6.0, u.time * 1.2) / A;
        p.vel += c * (0.3 + swirl * 0.8) * dt;
        p.vel.y += 0.25 * scale * dt;
        p.vel *= exp(-1.0 * dt);
        energy = smoothstep(0.0, 0.1, age) * (1.0 - age) * (0.55 + audio);
        hue = clamp(0.75 - age * 0.7, 0.0, 1.0);
      }
      p.pos += p.vel * dt;
      p.life -= dt;
    }
  } else if (u.mode == 14u) {
    // Face mask: every particle has a home on the face and is sprung to it.
    // A sudden change of expression loosens the springs and blows it apart.
    let fc = body.head[2].xy;
    let size = max(0.02, body.head[2].z);
    let fp = face_home(i, stable);
    let home = fp.home + (fp.home - fc) * audio * 0.07;
    // A small change of expression does nothing; a big one breaks the mask.
    let burst = smoothstep(0.12, 0.7, body.head[2].w);
    let loose = clamp(burst + body.head[1].x * 0.05, 0.0, 1.0);
    p.aux = mix(p.aux, select(0.0, 1.0, faceSeen), 1.0 - exp(-4.0 * dt));
    if (p.life <= 0.0) {
      if (faceSeen) {
        let angle = rnd(&seed) * 6.2831853;
        p.pos = home + vec2(cos(angle), sin(angle)) * (0.1 + 0.7 * rnd(&seed)) / A;
        p.vel = vec2(0.0);
        p.life = 1.0;
      }
    } else {
      let outward = normalize((p.pos - fc) * A + vec2(0.00001, 0.0));
      if (faceSeen) {
        p.vel += (home - p.pos) * mix(170.0, 5.0, loose) * dt;
        // Every particle around one face point is thrown the same way, so the
        // mask breaks into shards and not into fog.
        let shard = pcg((i % 478u) * 31u + 5u);
        let turn = (unit(shard) - 0.5) * 1.9;
        let throwDir = vec2(outward.x * cos(turn) - outward.y * sin(turn), outward.x * sin(turn) + outward.y * cos(turn));
        p.vel += throwDir * (0.35 + unit(pcg(shard)) + ps * 0.25) * burst * size * 5.5 * dt / A;
      }
      p.vel += curl(p.pos * A * 7.0, u.time) / A * (loose * (0.25 + swirl * 0.7) + 0.004) * dt * 4.0;
      p.vel *= exp(-mix(15.0, 1.4, loose) * dt);
      p.pos += p.vel * dt;
      let speed = length(p.vel * A);
      let depth = clamp(0.75 - fp.z / size * 2.2, 0.25, 1.7);
      energy = p.aux * fp.wire * depth * (0.8 + min(speed * 1.6, 0.9));
      hue = clamp(0.45 + (home.y - fc.y) / size * 0.45 - fp.z / size * 0.6 + min(speed * 0.8, 0.5), 0.0, 1.0);
    }
  } else if (u.mode == 15u) {
    // Mouth stream: an open mouth breathes particles out. Head turn aims
    // the jet, raised brows lift and curl it.
    let fc = body.head[2].xy;
    let size = max(0.02, body.head[2].z);
    let open = body.head[1].x;
    let brows = body.head[1].y;
    if ((i % 4u) == 0u) {
      let fp = face_home(i / 4u, stable);
      p.aux = mix(p.aux, select(0.0, 1.0, faceSeen), 1.0 - exp(-4.0 * dt));
      if (p.life <= 0.0) {
        if (faceSeen) { p.pos = fp.home; p.vel = vec2(0.0); p.life = 1.0; }
      } else {
        if (faceSeen) { p.vel += (fp.home - p.pos) * 170.0 * dt; }
        p.vel *= exp(-15.0 * dt);
        p.pos += p.vel * dt;
        energy = p.aux * fp.wire * clamp(0.75 - fp.z / size * 2.2, 0.25, 1.7) * (0.5 + open * 0.5);
        hue = clamp(0.3 + (fp.home.y - fc.y) / size * 0.25, 0.0, 1.0);
      }
    } else if (p.life <= 0.0) {
      let puff = 0.55 + 0.9 * smoothstep(-0.3, 0.5, gnoise(vec2(u.time * 3.1, ps * 2.0)));
      if (faceSeen && rnd(&seed) < clamp(open * 1.4 - 0.04, 0.0, 1.0) * dt * 3.0 * puff) {
        let dir = body.head[3].zw;
        let across = vec2(-dir.y, dir.x);
        let angle = (rnd(&seed) + rnd(&seed) - 1.0) * 0.38;
        let aim = dir * cos(angle) + across * sin(angle);
        let speed = (1.3 + 2.0 * open + 1.6 * audio) * (0.35 + 1.0 * rnd(&seed)) * size;
        p.pos = body.head[3].xy + (across * (rnd(&seed) - 0.5) * 0.16 + dir * (rnd(&seed) - 0.3) * 0.08 * open) * size / A;
        p.vel = aim * speed / A;
        p.span = 1.8 + 3.4 * rnd(&seed);
        p.life = p.span;
      }
    } else {
      let age = 1.0 - p.life / p.span;
      let c = (curl(p.pos * A * 4.2, u.time * 0.7) + curl(p.pos * A * 11.0, u.time * 1.3) * 0.45) / A;
      p.vel += c * (0.2 + swirl * 0.6 + brows * 1.2) * (0.3 + age) * dt;
      p.vel.y += brows * 0.3 * dt;
      // The jet loses its push quickly, then hangs and curls like breath in cold air.
      p.vel *= exp(-1.25 * dt);
      p.pos += (p.vel + c * (0.035 + swirl * 0.09 + brows * 0.08) * smoothstep(0.03, 0.4, age)) * dt;
      p.life -= dt;
      let speed = length(p.vel * A);
      energy = smoothstep(0.0, 0.02, age) * pow(1.0 - age, 1.4) * (0.55 + min(speed * 3.0, 3.0));
      hue = clamp(1.0 - age * 0.95 + ps * 0.08, 0.0, 1.0);
    }
  }
  particles.values[i] = p;

  if (energy <= 0.0) { return; }
  let grid = vec2(body.head[4].w, body.head[5].x);
  let g = p.pos * grid - 0.5;
  if (g.x < 0.0 || g.y < 0.0 || g.x >= grid.x - 1.0 || g.y >= grid.y - 1.0) { return; }
  let cell = vec2<u32>(floor(g)); let f = fract(g);
  let width = u32(grid.x);
  let e = energy * body.head[5].w * 1024.0;
  let weights = array<f32, 4>((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  for (var tap = 0u; tap < 4u; tap++) {
    let index = ((cell.y + tap / 2u) * width + cell.x + tap % 2u) * 2u;
    let amount = e * weights[tap];
    atomicAdd(&acc.values[index], u32(amount));
    atomicAdd(&acc.values[index + 1u], u32(amount * hue));
  }
}

@compute @workgroup_size(8, 8)
fn cs_decay(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = u32(body.head[4].w); let height = u32(body.head[5].x);
  if (gid.x >= width || gid.y >= height) { return; }
  let keep = pow(clamp(body.head[7].x, 0.0, 0.999), clamp(u.dt, 1.0 / 240.0, 1.0 / 20.0) * 60.0);
  let index = (gid.y * width + gid.x) * 2u;
  atomicStore(&acc.values[index], u32(f32(atomicLoad(&acc.values[index])) * keep));
  atomicStore(&acc.values[index + 1u], u32(f32(atomicLoad(&acc.values[index + 1u])) * keep));
}

// Quarter-size copy of the light grid, then a wide blur: the glow.
@compute @workgroup_size(8, 8)
fn cs_glow_down(@builtin(global_invocation_id) gid: vec3<u32>) {
  let gw = u32(body.head[6].z); let gh = u32(body.head[6].w);
  if (gid.x >= gw || gid.y >= gh) { return; }
  let width = u32(body.head[4].w); let height = u32(body.head[5].x);
  var sum = vec2(0.0);
  for (var y = 0u; y < 4u; y++) {
    for (var x = 0u; x < 4u; x++) {
      let index = (min(height - 1u, gid.y * 4u + y) * width + min(width - 1u, gid.x * 4u + x)) * 2u;
      sum += vec2(f32(atomicLoad(&acc.values[index])), f32(atomicLoad(&acc.values[index + 1u])));
    }
  }
  glowDst.values[gid.y * gw + gid.x] = sum / (16.0 * 1024.0);
}
fn glow_blur(gid: vec3<u32>, step: vec2<i32>) {
  let gw = i32(body.head[6].z); let gh = i32(body.head[6].w);
  if (i32(gid.x) >= gw || i32(gid.y) >= gh) { return; }
  var sum = vec2(0.0); var total = 0.0;
  for (var k = -7; k <= 7; k++) {
    let q = clamp(vec2<i32>(gid.xy) + step * k, vec2(0), vec2(gw - 1, gh - 1));
    let w = exp(-f32(k * k) / 24.0);
    sum += glowSrc.values[q.y * gw + q.x] * w; total += w;
  }
  glowDst.values[i32(gid.y) * gw + i32(gid.x)] = sum / total;
}
@compute @workgroup_size(8, 8)
fn cs_glow_h(@builtin(global_invocation_id) gid: vec3<u32>) { glow_blur(gid, vec2(1, 0)); }
@compute @workgroup_size(8, 8)
fn cs_glow_v(@builtin(global_invocation_id) gid: vec3<u32>) { glow_blur(gid, vec2(0, 1)); }
`;

export const HAND_FIELD_FLUID_WGSL = /* wgsl */ `${COMMON_WGSL}
// One cell = (velocity xy in cells per second, pressure, divergence).
struct Cells { values: array<vec4<f32>> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> body: Body;
@group(0) @binding(2) var<storage, read> src: Cells;
@group(0) @binding(3) var<storage, read_write> dst: Cells;
fn size() -> vec2<i32> { return vec2(i32(body.head[5].y), i32(body.head[5].z)); }
fn at(q: vec2<i32>) -> vec4<f32> {
  let s = size(); let c = clamp(q, vec2(0), s - 1);
  return src.values[c.y * s.x + c.x];
}
fn sample_velocity(g: vec2<f32>) -> vec2<f32> {
  let s = vec2<f32>(size());
  let c = clamp(g - 0.5, vec2(0.0), s - 1.001);
  let i = vec2<i32>(floor(c)); let f = fract(c);
  return mix(mix(at(i).xy, at(i + vec2(1, 0)).xy, f.x), mix(at(i + vec2(0, 1)).xy, at(i + vec2(1, 1)).xy, f.x), f.y);
}
@compute @workgroup_size(8, 8)
fn cs_advect(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = size(); let q = vec2<i32>(gid.xy);
  if (q.x >= s.x || q.y >= s.y) { return; }
  let sf = vec2<f32>(s);
  let dt = clamp(u.dt, 1.0 / 240.0, 1.0 / 20.0);
  let here = at(q);
  let g = vec2<f32>(q) + 0.5;
  var v = sample_velocity(g - here.xy * dt);
  let uv = g / sf;
  let A = vec2(u.resolution.x / max(1.0, u.resolution.y), 1.0);
  let scale = max(0.05, body.head[0].z) * u.performance.y;
  if (body.head[0].x > 0.5) {
    let bones = array<vec2<u32>, 16>(
      vec2(11u, 12u), vec2(11u, 13u), vec2(13u, 15u), vec2(12u, 14u), vec2(14u, 16u), vec2(11u, 23u), vec2(12u, 24u), vec2(23u, 24u),
      vec2(23u, 25u), vec2(25u, 27u), vec2(24u, 26u), vec2(26u, 28u), vec2(27u, 31u), vec2(28u, 32u), vec2(15u, 19u), vec2(16u, 20u));
    let radius = scale * 0.2;
    for (var b = 0u; b < 16u; b++) {
      let pa = body.pose[bones[b].x * 2u]; let pb = body.pose[bones[b].y * 2u];
      if (min(pa.w, pb.w) < 0.3) { continue; }
      let a = pa.xy * A; let ab = pb.xy * A - a;
      let t = clamp(dot(uv * A - a, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0);
      let d = length(uv * A - a - ab * t);
      let boneVel = mix(body.pose[bones[b].x * 2u + 1u].xy, body.pose[bones[b].y * 2u + 1u].xy, t);
      let speed = length(boneVel * A);
      let w = exp(-d * d / (radius * radius));
      // A moving limb drags the fluid with it; a still one only slows it a little.
      v = mix(v, boneVel * sf * 1.25, clamp(w * (smoothstep(0.02, 0.5, speed) * 26.0 + 1.2) * dt, 0.0, 1.0));
    }
    // Bass pushes outwards from the chest.
    let away = uv * A - body.head[6].xy * A;
    let reach = length(away);
    v += away / max(reach, 0.001) / A * sf * u.performance.w * exp(-reach * reach / (scale * scale * 1.6)) * 1.6 * dt;
  }
  v += curl(uv * A * 1.6, u.time * 0.25) / A * sf * (0.012 + body.head[4].y * 0.035) * dt;
  v *= exp(-0.32 * dt);
  // Keep the walls closed so the pressure solve stays calm at the edges.
  if (q.x == 0 || q.x == s.x - 1) { v.x = 0.0; }
  if (q.y == 0 || q.y == s.y - 1) { v.y = 0.0; }
  let limit = 6.0 * max(sf.x, sf.y);
  let fast = length(v);
  if (fast > limit) { v *= limit / fast; }
  dst.values[q.y * s.x + q.x] = vec4(v, here.z, 0.0);
}
@compute @workgroup_size(8, 8)
fn cs_divergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = size(); let q = vec2<i32>(gid.xy);
  if (q.x >= s.x || q.y >= s.y) { return; }
  let here = at(q);
  let d = 0.5 * (at(q + vec2(1, 0)).x - at(q - vec2(1, 0)).x + at(q + vec2(0, 1)).y - at(q - vec2(0, 1)).y);
  dst.values[q.y * s.x + q.x] = vec4(here.xy, here.z * 0.8, d);
}
@compute @workgroup_size(8, 8)
fn cs_jacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = size(); let q = vec2<i32>(gid.xy);
  if (q.x >= s.x || q.y >= s.y) { return; }
  let here = at(q);
  let pressure = (at(q + vec2(1, 0)).z + at(q - vec2(1, 0)).z + at(q + vec2(0, 1)).z + at(q - vec2(0, 1)).z - here.w) * 0.25;
  dst.values[q.y * s.x + q.x] = vec4(here.xy, pressure, here.w);
}
@compute @workgroup_size(8, 8)
fn cs_project(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = size(); let q = vec2<i32>(gid.xy);
  if (q.x >= s.x || q.y >= s.y) { return; }
  let here = at(q);
  let gradient = 0.5 * vec2(at(q + vec2(1, 0)).z - at(q - vec2(1, 0)).z, at(q + vec2(0, 1)).z - at(q - vec2(0, 1)).z);
  dst.values[q.y * s.x + q.x] = vec4(here.xy - gradient, here.z, 0.0);
}
`;

export const HAND_FIELD_RENDER_WGSL = /* wgsl */ `${COMMON_WGSL}
struct AccBuffer { values: array<u32> };
struct Vec2Buffer { values: array<vec2<f32>> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> body: Body;
@group(0) @binding(2) var<storage, read> acc: AccBuffer;
@group(0) @binding(3) var<storage, read> glow: Vec2Buffer;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_field(@builtin(vertex_index) i: u32) -> V {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var o: V; o.pos = vec4(p[i], 0.0, 1.0); o.uv = p[i] * 0.5 + 0.5; return o;
}
fn hsv(c: vec3<f32>) -> vec3<f32> {
  let p = abs(fract(c.xxx + vec3(1.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, vec3(0.0), vec3(1.0)), c.y);
}
// Three-stop ramps: a deep tone, the palette's body colour, a hot highlight.
fn ramp(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  var a = vec3(0.05, 0.1, 0.9); var b = vec3(0.05, 0.75, 1.0); var c = vec3(0.55, 1.0, 0.85);
  if (u.colorMode == 0u) { return hsv(vec3(fract(0.62 - x * 0.8 + u.time * 0.03), 0.9 - 0.35 * x * x, 1.0)); }
  if (u.colorMode == 1u) { a = vec3(0.75, 0.08, 0.25); b = vec3(1.0, 0.38, 0.38); c = vec3(1.0, 0.8, 0.6); }
  if (u.colorMode == 2u) { a = vec3(0.02, 0.3, 0.85); b = vec3(0.15, 0.9, 1.0); c = vec3(0.8, 1.0, 1.0); }
  if (u.colorMode == 3u) { a = vec3(0.45, 0.55, 0.8); b = vec3(0.9, 0.93, 1.0); c = vec3(1.0, 0.97, 0.9); }
  if (u.colorMode == 5u) { a = vec3(0.85, 0.05, 0.02); b = vec3(1.0, 0.42, 0.05); c = vec3(1.0, 0.86, 0.35); }
  if (u.colorMode == 6u) { a = vec3(0.2, 0.05, 0.95); b = vec3(0.85, 0.15, 0.9); c = vec3(1.0, 0.5, 0.65); }
  if (u.colorMode == 7u) { a = vec3(0.0, 0.55, 0.35); b = vec3(0.3, 1.0, 0.2); c = vec3(0.95, 1.0, 0.3); }
  return mix(mix(a, b, smoothstep(0.0, 0.5, x)), c, smoothstep(0.5, 1.0, x));
}
fn acc_at(q: vec2<i32>) -> vec2<f32> {
  let s = vec2(i32(body.head[4].w), i32(body.head[5].x));
  let c = clamp(q, vec2(0), s - 1);
  let index = u32(c.y * s.x + c.x) * 2u;
  return vec2(f32(acc.values[index]), f32(acc.values[index + 1u])) / 1024.0;
}
fn glow_at(q: vec2<i32>) -> vec2<f32> {
  let s = vec2(i32(body.head[6].z), i32(body.head[6].w));
  let c = clamp(q, vec2(0), s - 1);
  return glow.values[u32(c.y * s.x + c.x)];
}
fn seg(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0));
}
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
// Signed distance to the body: negative inside. Aspect-corrected units.
fn body_distance(p: vec2<f32>, A: vec2<f32>, scale: f32) -> f32 {
  let bones = array<vec2<u32>, 12>(
    vec2(11u, 13u), vec2(13u, 15u), vec2(12u, 14u), vec2(14u, 16u), vec2(23u, 25u), vec2(25u, 27u),
    vec2(24u, 26u), vec2(26u, 28u), vec2(27u, 31u), vec2(28u, 32u), vec2(15u, 19u), vec2(16u, 20u));
  let girth = array<f32, 12>(0.085, 0.065, 0.085, 0.065, 0.12, 0.09, 0.12, 0.09, 0.05, 0.05, 0.045, 0.045);
  var d = 10.0;
  let k = 0.05 * scale;
  for (var b = 0u; b < 12u; b++) {
    let pa = body.pose[bones[b].x * 2u]; let pb = body.pose[bones[b].y * 2u];
    if (min(pa.w, pb.w) < 0.3) { continue; }
    d = smin(d, seg(p, pa.xy * A, pb.xy * A) - girth[b] * scale * 0.8, k);
  }
  // Torso: two thick diagonals and the spine fill the chest.
  let ls = body.pose[22].xy * A; let rs = body.pose[24].xy * A;
  let lh = body.pose[46].xy * A; let rh = body.pose[48].xy * A;
  let chest = distance(ls, rs) * 0.5;
  d = smin(d, seg(p, mix(ls, rs, 0.25), mix(lh, rh, 0.2)) - chest * 0.42, k * 2.0);
  d = smin(d, seg(p, mix(ls, rs, 0.75), mix(lh, rh, 0.8)) - chest * 0.42, k * 2.0);
  d = smin(d, seg(p, ls, rs) - scale * 0.08, k);
  let head = (body.pose[14].xy + body.pose[16].xy) * 0.5 * A;
  d = smin(d, distance(p, head) - max(distance(body.pose[14].xy * A, body.pose[16].xy * A) * 0.62, scale * 0.14), k * 0.6);
  return d;
}
@fragment fn fs_field(in: V) -> @location(0) vec4<f32> {
  let grid = vec2(body.head[4].w, body.head[5].x);
  let centre = in.uv * grid - 0.5;
  // The frame this draws into can be smaller than the light grid. Average the
  // cells each pixel covers, or thin lines shimmer as they move.
  let reach = fwidth(centre);
  let taps = vec2<i32>(clamp(ceil(reach - 0.05), vec2(1.0), vec2(3.0)));
  var sharp = vec2(0.0);
  for (var ty = 0; ty < taps.y; ty++) {
    for (var tx = 0; tx < taps.x; tx++) {
      let g = centre + (vec2(f32(tx), f32(ty)) + 0.5) / vec2<f32>(taps) * reach - reach * 0.5;
      let cell = vec2<i32>(floor(g)); let f = fract(g);
      sharp += mix(mix(acc_at(cell), acc_at(cell + vec2(1, 0)), f.x), mix(acc_at(cell + vec2(0, 1)), acc_at(cell + vec2(1, 1)), f.x), f.y);
    }
  }
  sharp /= f32(taps.x * taps.y);
  let gs = vec2(body.head[6].z, body.head[6].w);
  let gg = in.uv * gs - 0.5;
  let gc = vec2<i32>(floor(gg)); let gf = fract(gg);
  let soft = mix(mix(glow_at(gc), glow_at(gc + vec2(1, 0)), gf.x), mix(glow_at(gc + vec2(0, 1)), glow_at(gc + vec2(1, 1)), gf.x), gf.y);
  let hue = sharp.y / max(sharp.x, 0.0001);
  let softHue = soft.y / max(soft.x, 0.0001);
  let core = 1.0 - exp(-sharp.x * 1.15);
  let halo = 1.0 - exp(-soft.x * 0.85);
  // Thin light keeps the deep end of the palette; dense light climbs to the highlight.
  var color = ramp(hue * 0.75 + core * 0.25) * core * (0.5 + 0.5 * core);
  // The hottest light picks up a second colour, so a palette is never one flat hue.
  color += ramp(1.0).brg * smoothstep(0.62, 1.0, hue) * core * 0.6;
  color += vec3(1.0, 0.97, 0.92) * pow(core, 4.0) * 0.5;
  color += ramp(softHue * 0.7) * halo * 0.5;
  if (u.mode == 13u && body.head[0].x > 0.5) {
    let A = vec2(u.resolution.x / max(1.0, u.resolution.y), 1.0);
    let scale = max(0.05, body.head[0].z) * u.performance.y;
    let p = in.uv * A;
    // Flame noise climbs the outline: it bends the edge and breaks up its light.
    let q = p / scale;
    let climb = vec2(0.0, -u.time * 0.9);
    let lick = gnoise(q * vec2(3.2, 1.9) + climb) * 0.09 + gnoise(q * vec2(9.0, 5.5) + climb * 2.2) * 0.035;
    let d = body_distance(p, A, scale) / scale + lick;
    let beat = 1.0 + u.performance.w * 1.4;
    let spark = 0.3 + 0.7 * smoothstep(-0.25, 0.45, gnoise(q * vec2(7.0, 4.0) + climb * 1.7 + vec2(u.time * 0.4, 0.0)));
    let rim = exp(-abs(d) / 0.014) * spark;
    let aura = exp(-max(d, 0.0) / (0.2 * beat)) * (0.22 + 0.3 * spark) * step(0.0, d);
    let inside = smoothstep(0.0, -0.25, d) * 0.1 * spark;
    color += ramp(clamp(0.75 - d * 1.6, 0.0, 1.0)) * (rim * 0.9 + aura) * beat + ramp(0.1) * inside;
  }
  color *= u.performance.x * (1.0 + u.performance.w * 0.35);
  color = clamp(color, vec3(0.0), vec3(1.0));
  let base = vec4(vec3(0.008, 0.008, 0.018) * u.bgAlpha, u.bgAlpha);
  let alpha = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0);
  return vec4(base.rgb + color, max(base.a, alpha));
}
`;

const DEMO_ASPECT = 9 / 16;

/** A dancing figure for rehearsal: 33 pose points in camera space (y down). */
export function handFxDemoPose(time: number): PoseLandmark[] {
  const t = time;
  const points: PoseLandmark[] = Array.from({ length: HAND_FX_POSE_POINTS }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const put = (index: number, x: number, y: number) => { points[index] = { x: 0.5 + (x - 0.5), y, z: 0, visibility: 1 }; };
  const lean = 0.16 * Math.sin(t * 0.9);
  const hipX = 0.5 + 0.17 * Math.sin(t * 0.47);
  const hipY = 0.57 + 0.025 * Math.sin(t * 2.6);
  const torso = 0.25;
  // Offsets are in units of frame height; x shrinks by the frame's aspect.
  const at = (ox: number, oy: number, dx: number, dy: number): [number, number] => [ox + dx * DEMO_ASPECT, oy + dy];
  const [shX, shY] = at(hipX, hipY, Math.sin(lean) * torso, -Math.cos(lean) * torso);
  const across = [Math.cos(lean), Math.sin(lean)];
  const limb = (ox: number, oy: number, angle: number, length: number, side: number) =>
    at(ox, oy, Math.sin(angle) * side * length, Math.cos(angle) * length);
  for (const side of [1, -1]) {
    // MediaPipe numbers the performer's left side with odd indices.
    const shift = side === 1 ? 0 : 1;
    const phase = side === 1 ? 0 : 2.1;
    const [sx, sy] = at(shX, shY, across[0] * 0.095 * side, across[1] * 0.095 * side);
    const [hx, hy] = at(hipX, hipY, 0.06 * side, 0);
    const upper = 1.45 + 1.15 * Math.sin(t * 1.15 + phase);
    const fore = upper + 0.35 + 0.85 * Math.sin(t * 1.9 + phase * 1.7);
    const [ex, ey] = limb(sx, sy, upper, 0.14, side);
    const [wx, wy] = limb(ex, ey, fore, 0.13, side);
    const [fx, fy] = limb(wx, wy, fore, 0.04, side);
    const thigh = 0.14 + 0.3 * Math.max(0, Math.sin(t * 2.6 + phase * 1.5));
    const shin = thigh - 0.5 * Math.max(0, Math.sin(t * 2.6 + phase * 1.5));
    const [kx, ky] = limb(hx, hy, thigh, 0.19, side);
    const [ax, ay] = limb(kx, ky, shin, 0.19, side);
    put(11 + shift, sx, sy); put(13 + shift, ex, ey); put(15 + shift, wx, wy);
    put(17 + shift, fx, fy); put(19 + shift, fx, fy); put(21 + shift, fx, fy);
    put(23 + shift, hx, hy); put(25 + shift, kx, ky); put(27 + shift, ax, ay);
    put(29 + shift, ax, ay + 0.015); put(31 + shift, ...at(ax, ay, 0.045 * side, 0.02));
  }
  const [nx, ny] = at(shX, shY, Math.sin(lean) * 0.11, -Math.cos(lean) * 0.11);
  put(0, nx, ny);
  for (const [index, dx, dy] of [[1, 0.012, -0.015], [2, 0.018, -0.015], [3, 0.024, -0.015], [4, -0.012, -0.015], [5, -0.018, -0.015], [6, -0.024, -0.015],
    [7, 0.04, -0.005], [8, -0.04, -0.005], [9, 0.012, 0.02], [10, -0.012, 0.02]] as const) {
    put(index, ...at(nx, ny, dx, dy));
  }
  return points;
}

/**
 * A talking, turning face for rehearsal: 478 points in camera space (y down).
 * The points that the tracker's expression maths reads (lips, lids, brows,
 * nose, outline) sit at their real MediaPipe indices; the rest fill the face.
 */
export function handFxDemoFace(time: number): { x: number; y: number; z: number }[] {
  const t = time;
  // The mouth snaps open and shut, as a shout does, not as a sine does.
  const mouthWave = Math.min(1, Math.max(0, Math.sin(t * 1.3) / 0.22));
  const mouth = mouthWave * mouthWave * (3 - 2 * mouthWave);
  const brows = Math.max(0, Math.sin(t * 0.9 + 2)) ** 2;
  const turn = 0.55 * Math.sin(t * 0.6);
  const nod = 0.18 * Math.sin(t * 0.43);
  const tilt = 0.16 * Math.sin(t * 0.5 + 1);
  const cx = 0.5 + 0.07 * Math.sin(t * 0.4);
  const cy = 0.48 + 0.03 * Math.sin(t * 0.7);
  const half = 0.23;
  const special = new Map<number, [number, number]>([
    [10, [0, -1]], [152, [0, 1 + mouth * 0.12]], [234, [-0.72, 0]], [454, [0.72, 0]], [1, [0, 0.12]],
    [13, [0, 0.42]], [14, [0, 0.45 + mouth * 0.24]], [61, [-0.26, 0.45 + mouth * 0.06]], [291, [0.26, 0.45 + mouth * 0.06]],
    [33, [-0.5, -0.22]], [133, [-0.2, -0.22]], [159, [-0.35, -0.27]], [145, [-0.35, -0.17]],
    [263, [0.5, -0.22]], [362, [0.2, -0.22]], [386, [0.35, -0.27]], [374, [0.35, -0.17]],
    [105, [-0.38, -0.42 - brows * 0.1]], [334, [0.38, -0.42 - brows * 0.1]],
    [468, [-0.35, -0.22]], [473, [0.35, -0.22]],
  ]);
  for (let k = 0; k < 4; k += 1) {
    const angle = (k / 4) * Math.PI * 2;
    special.set(469 + k, [-0.35 + Math.cos(angle) * 0.04, -0.22 + Math.sin(angle) * 0.04]);
    special.set(474 + k, [0.35 + Math.cos(angle) * 0.04, -0.22 + Math.sin(angle) * 0.04]);
  }
  const pool: [number, number][] = [];
  const ring = (count: number, x: number, y: number, rx: number, ry: number) => {
    for (let k = 0; k < count; k += 1) {
      const angle = (k / count) * Math.PI * 2;
      pool.push([x + Math.cos(angle) * rx, y + Math.sin(angle) * ry]);
    }
  };
  for (let k = 0; k < 40; k += 1) {
    const angle = (k / 40) * Math.PI * 2;
    const low = Math.max(0, Math.sin(angle));
    pool.push([Math.cos(angle) * 0.72 * (1 - 0.18 * low * low), Math.sin(angle) * (1 + mouth * 0.12 * low)]);
  }
  ring(16, -0.35, -0.22, 0.15, 0.055); ring(16, 0.35, -0.22, 0.15, 0.055);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 10; k += 1) {
      const f = k / 9;
      pool.push([side * (0.16 + f * 0.42), -0.4 - Math.sin(f * Math.PI) * 0.06 - brows * 0.1 * (0.5 + 0.5 * Math.sin(f * Math.PI))]);
    }
  }
  ring(22, 0, 0.45 + mouth * 0.12, 0.27, 0.07 + mouth * 0.13);
  ring(18, 0, 0.45 + mouth * 0.12, 0.17, 0.018 + mouth * 0.115);
  for (let k = 0; k < 10; k += 1) pool.push([0, -0.26 + k * 0.042]);
  ring(8, 0, 0.16, 0.11, 0.035);
  const fill = HAND_FX_FACE_POINTS - special.size - pool.length;
  for (let k = 0; k < fill; k += 1) {
    const radius = Math.sqrt((k + 0.5) / fill) * 0.97;
    const angle = k * 2.399963;
    let y = Math.sin(angle) * radius;
    const x = Math.cos(angle) * radius * 0.72 * (1 - 0.18 * Math.max(0, y) ** 2);
    if (y > 0.5) y += mouth * 0.12 * ((y - 0.5) / 0.5);
    pool.push([x, y]);
  }
  let next = 0;
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  return Array.from({ length: HAND_FX_FACE_POINTS }, (_, index) => {
    const [u0, v0] = special.get(index) ?? pool[next++] ?? [0, 0];
    const bulge = Math.sqrt(Math.max(0, 1 - (u0 / 0.74) ** 2 - (v0 / 1.14) ** 2));
    const depth = bulge * (index === 1 ? 0.8 : 0.6);
    const u1 = u0 * (1 - 0.12 * Math.abs(turn)) + turn * depth * 0.55;
    const v1 = v0 + nod * depth * 0.55;
    return {
      x: cx + (u1 * cosT - v1 * sinT) * half * DEMO_ASPECT,
      y: cy + (u1 * sinT + v1 * cosT) * half,
      z: -depth * half * DEMO_ASPECT,
    };
  });
}

export type HandFxFieldState = {
  bodyStamp?: number;
  /** 33 x (x, y, z, visibility, vx, vy), smoothed, y up. */
  posePoints?: number[];
  poseSeen?: boolean;
  /** 478 x (x, y, z), smoothed, y up. */
  facePoints?: number[];
  faceSeen?: boolean;
  /** Four nearest neighbours of each face point: the mask's wire. */
  faceTopology?: number[];
  faceTopologyVersion?: number;
  faceExpression?: number[];
  faceShatter?: number;
};

export type HandFxFieldInput = {
  params: Record<string, any>;
  width: number;
  height: number;
  time: number;
  frameDelta: number;
  frame?: SignalFrame | null;
};

export type HandFxFieldLayout = {
  particles: number;
  gridWidth: number;
  gridHeight: number;
  glowWidth: number;
  glowHeight: number;
  fluidWidth: number;
  fluidHeight: number;
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

export function handFxFieldLayout(params: Record<string, any>, width: number, height: number): HandFxFieldLayout {
  const quality = String(params.handfxQuality ?? HAND_FX_DEFAULT_QUALITY);
  const particles = HAND_FX_QUALITY_PARTICLES[quality] ?? HAND_FX_QUALITY_PARTICLES[HAND_FX_DEFAULT_QUALITY];
  const w = Math.max(16, Math.round(width)), h = Math.max(16, Math.round(height));
  // The light grid follows the output up to 1080p; larger outputs stretch it.
  const fit = Math.min(1, 1920 / w, 1080 / h);
  const gridWidth = Math.max(16, Math.round(w * fit));
  const gridHeight = Math.max(16, Math.round(h * fit));
  return {
    particles,
    gridWidth,
    gridHeight,
    glowWidth: Math.ceil(gridWidth / 4),
    glowHeight: Math.ceil(gridHeight / 4),
    fluidWidth: HAND_FX_FLUID_WIDTH,
    fluidHeight: Math.max(16, Math.round(HAND_FX_FLUID_WIDTH * h / w)),
  };
}

function faceNeighbours(points: number[]): number[] {
  const out = new Array<number>(HAND_FX_FACE_POINTS * 4).fill(0);
  for (let a = 0; a < HAND_FX_FACE_POINTS; a += 1) {
    const best = [-1, -1, -1, -1];
    const bestDistance = [Infinity, Infinity, Infinity, Infinity];
    const ax = points[a * 3], ay = points[a * 3 + 1], az = points[a * 3 + 2];
    for (let b = 0; b < HAND_FX_FACE_POINTS; b += 1) {
      if (b === a) continue;
      const dx = points[b * 3] - ax, dy = points[b * 3 + 1] - ay, dz = (points[b * 3 + 2] - az) * 0.5;
      const d = dx * dx + dy * dy + dz * dz;
      // Points stacked on one spot would make zero-length wires.
      if (d < 1e-9) continue;
      for (let slot = 0; slot < 4; slot += 1) {
        if (d >= bestDistance[slot]) continue;
        for (let move = 3; move > slot; move -= 1) { best[move] = best[move - 1]; bestDistance[move] = bestDistance[move - 1]; }
        best[slot] = b; bestDistance[slot] = d;
        break;
      }
    }
    for (let slot = 0; slot < 4; slot += 1) out[a * 4 + slot] = best[slot] < 0 ? a : best[slot];
  }
  return out;
}

/**
 * Smooth the tracked body and face and pack them, with the values the shaders
 * derive everything else from, into the GPU body buffer.
 */
export function packHandFxBody(input: HandFxFieldInput, previous: HandFxFieldState | null | undefined, modeIndex: number): {
  buffer: Float32Array;
  topology: Float32Array;
  state: HandFxFieldState;
  layout: HandFxFieldLayout;
} {
  const params = input.params;
  const demo = params.handfxInput === 'demo';
  const mode = HAND_FX_FIELD_MODES[modeIndex - HAND_FX_FIELD_MODE_BASE];
  const wantsBody = HAND_FX_BODY_MODES.includes(mode);
  const wantsFace = HAND_FX_FACE_MODES.includes(mode);
  const pose = !wantsBody ? null : demo ? handFxDemoPose(input.time) : input.frame?.pose ?? null;
  const face = !wantsFace ? null : demo ? handFxDemoFace(input.time) : input.frame?.face ?? null;
  const stamp = demo ? input.time * 1000 : Number(input.frame?.timestamp ?? 0);
  const state: HandFxFieldState = { ...(previous ?? {}) };
  const layout = handFxFieldLayout(params, input.width, input.height);
  const aspect = Math.max(1, input.width) / Math.max(1, input.height);
  const smoothing = clampNumber(params.handfxSmoothing, 0, 1, 0.15);
  // The camera delivers fewer frames than the renderer draws. Speeds are
  // measured between camera frames only, so a repeated frame is not a stop.
  const fresh = previous?.bodyStamp === undefined || stamp !== previous.bodyStamp;
  const elapsed = previous?.bodyStamp === undefined
    ? Math.max(1 / 240, input.frameDelta || 1 / 60)
    : Math.min(0.25, Math.max(1 / 240, (stamp - previous.bodyStamp) / 1000));
  state.bodyStamp = stamp;

  const buffer = new Float32Array(HAND_FX_BODY_BUFFER_BYTES / 4);
  const poseOffset = HAND_FX_BODY_HEADER_VEC4 * 4;
  const faceOffset = poseOffset + HAND_FX_POSE_POINTS * 8;

  // ── Body ──
  let posePoints = previous?.posePoints;
  const poseValid = !!pose && pose.length >= HAND_FX_POSE_POINTS;
  if (poseValid && (fresh || !posePoints || !previous?.poseSeen)) {
    const before = previous?.poseSeen ? posePoints : undefined;
    const nextPoints = new Array<number>(HAND_FX_POSE_POINTS * 6).fill(0);
    for (let index = 0; index < HAND_FX_POSE_POINTS; index += 1) {
      const point = pose![index];
      const o = index * 6;
      const rawX = Number(point.x) || 0, rawY = 1 - (Number(point.y) || 0), rawZ = Number(point.z) || 0;
      const px = before ? before[o] : rawX, py = before ? before[o + 1] : rawY, pz = before ? before[o + 2] : rawZ;
      const motion = Math.hypot(rawX - px, rawY - py);
      const alpha = Math.min(1, (1 - smoothing) + motion * 30);
      const x = px + (rawX - px) * alpha, y = py + (rawY - py) * alpha;
      let vx = 0, vy = 0;
      // A point that crosses a quarter of the frame between two camera frames
      // was lost and found again, not moved: that is not a speed.
      if (before && motion < 0.25) {
        vx = before[o + 4] * 0.55 + ((x - px) / elapsed) * 0.45;
        vy = before[o + 5] * 0.55 + ((y - py) / elapsed) * 0.45;
        const speed = Math.hypot(vx, vy);
        if (speed > 5) { vx *= 5 / speed; vy *= 5 / speed; }
      }
      nextPoints[o] = x; nextPoints[o + 1] = y; nextPoints[o + 2] = pz + (rawZ - pz) * alpha;
      nextPoints[o + 3] = point.visibility === undefined ? 1 : clampNumber(point.visibility, 0, 1, 1);
      nextPoints[o + 4] = Number.isFinite(vx) ? vx : 0; nextPoints[o + 5] = Number.isFinite(vy) ? vy : 0;
    }
    posePoints = nextPoints;
  }
  state.posePoints = posePoints;
  state.poseSeen = poseValid;
  let bodyScale = 0.25, bodyEnergy = 0, bodyX = 0.5, bodyY = 0.5;
  if (poseValid && posePoints) {
    for (let index = 0; index < HAND_FX_POSE_POINTS; index += 1) {
      const o = index * 6, target = poseOffset + index * 8;
      buffer[target] = posePoints[o]; buffer[target + 1] = posePoints[o + 1]; buffer[target + 2] = posePoints[o + 2]; buffer[target + 3] = posePoints[o + 3];
      buffer[target + 4] = posePoints[o + 4]; buffer[target + 5] = posePoints[o + 5];
      bodyEnergy += Math.hypot(posePoints[o + 4] * aspect, posePoints[o + 5]) / HAND_FX_POSE_POINTS;
    }
    const mid = (a: number, b: number) => [(posePoints![a * 6] + posePoints![b * 6]) / 2, (posePoints![a * 6 + 1] + posePoints![b * 6 + 1]) / 2];
    const shoulders = mid(11, 12), hips = mid(23, 24);
    const torso = Math.hypot((shoulders[0] - hips[0]) * aspect, shoulders[1] - hips[1]);
    const span = Math.hypot((posePoints[11 * 6] - posePoints[12 * 6]) * aspect, posePoints[11 * 6 + 1] - posePoints[12 * 6 + 1]);
    // A body seen side-on or cut off at the hips still needs a usable size.
    bodyScale = Math.min(0.8, Math.max(0.06, torso, span * 1.2));
    bodyX = (shoulders[0] + hips[0]) / 2; bodyY = (shoulders[1] * 2 + hips[1]) / 3;
  }

  // ── Face ──
  let facePoints = previous?.facePoints;
  const faceValid = !!face && face.length >= HAND_FX_FACE_POINTS;
  if (faceValid && (fresh || !facePoints || !previous?.faceSeen)) {
    const before = previous?.faceSeen ? facePoints : undefined;
    const nextPoints = new Array<number>(HAND_FX_FACE_POINTS * 3);
    for (let index = 0; index < HAND_FX_FACE_POINTS; index += 1) {
      const point = face![index];
      const o = index * 3;
      const rawX = Number(point.x) || 0, rawY = 1 - (Number(point.y) || 0), rawZ = Number(point.z) || 0;
      const px = before ? before[o] : rawX, py = before ? before[o + 1] : rawY, pz = before ? before[o + 2] : rawZ;
      const alpha = Math.min(1, (1 - smoothing * 0.6) + Math.hypot(rawX - px, rawY - py) * 30);
      nextPoints[o] = px + (rawX - px) * alpha; nextPoints[o + 1] = py + (rawY - py) * alpha; nextPoints[o + 2] = pz + (rawZ - pz) * alpha;
    }
    facePoints = nextPoints;
  }
  state.facePoints = facePoints;
  state.faceSeen = faceValid;
  let mouthOpen = 0, brows = 0, turn = 0, tilt = 0, smile = 0, faceX = 0.5, faceY = 0.5, faceSize = 0.3;
  let mouthX = 0.5, mouthY = 0.4, aimX = 0, aimY = -1;
  let shatter = (previous?.faceShatter ?? 0) * Math.exp(-(input.frameDelta || 1 / 60) * 1.7);
  if (faceValid && facePoints) {
    const fp = facePoints;
    const X = (i: number) => fp[i * 3] * aspect, Y = (i: number) => fp[i * 3 + 1];
    const gap = (a: number, b: number) => Math.hypot(X(a) - X(b), Y(a) - Y(b));
    for (let index = 0; index < HAND_FX_FACE_POINTS; index += 1) {
      const o = index * 3, target = faceOffset + index * 4;
      buffer[target] = fp[o]; buffer[target + 1] = fp[o + 1]; buffer[target + 2] = fp[o + 2]; buffer[target + 3] = 1;
    }
    faceSize = Math.max(0.02, gap(10, 152));
    const faceWidth = Math.max(0.01, gap(234, 454));
    const cxA = (X(234) + X(454) + X(10) + X(152)) / 4, cyA = (Y(234) + Y(454) + Y(10) + Y(152)) / 4;
    faceX = cxA / aspect; faceY = cyA;
    const values = !demo ? input.frame?.values : undefined;
    const signal = (id: string, fallback: number) => {
      const value = values?.[id];
      return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
    };
    mouthOpen = signal('face.mouth', Math.min(1, Math.max(0, (gap(13, 14) / faceSize - 0.02) / 0.11)));
    brows = signal('face.brows', Math.min(1, Math.max(0, (((gap(105, 159) + gap(334, 386)) / 2) / faceSize - 0.078) / 0.045)));
    smile = signal('face.smile', 0);
    // Head turn from where the nose sits between the cheeks, in face widths.
    const noseX = (X(1) - (X(234) + X(454)) / 2) / faceWidth, noseY = (Y(1) - (Y(10) + Y(152)) / 2) / faceSize;
    turn = Math.min(1, Math.max(-1, noseX * 2.4));
    tilt = Math.atan2(Y(263) - Y(33), X(263) - X(33));
    mouthX = (fp[13 * 3] + fp[14 * 3]) / 2; mouthY = (fp[13 * 3 + 1] + fp[14 * 3 + 1]) / 2;
    const downX = (X(152) - X(10)) / faceSize, downY = (Y(152) - Y(10)) / faceSize;
    // Aim: mostly where the head points, with a little of "out past the chin".
    let dirX = noseX * 3.2 + downX * 0.42, dirY = (noseY + 0.06) * 3.2 + downY * 0.42;
    const length = Math.hypot(dirX, dirY) || 1;
    dirX /= length; dirY /= length;
    aimX = dirX; aimY = dirY;
    const expression = [mouthOpen, brows, turn * 0.6, smile, tilt];
    const last = previous?.faceSeen ? previous.faceExpression : undefined;
    if (last && fresh) {
      const rate = expression.reduce((sum, value, index) => sum + Math.abs(value - last[index]), 0) / elapsed;
      shatter = Math.max(shatter, Math.min(1, Math.max(0, rate * 0.3 - 0.12)));
    }
    if (fresh || !last) state.faceExpression = expression;
    if (!state.faceTopology) {
      state.faceTopology = faceNeighbours(fp);
      state.faceTopologyVersion = (previous?.faceTopologyVersion ?? 0) + 1;
    }
  }
  state.faceShatter = Number.isFinite(shatter) ? shatter : 0;

  const trails = clampNumber(params.handfxTrails, 0, 1, 0.5);
  const fadeRange: Record<string, [number, number]> = {
    bodyswarm: [0.5, 0.95], bodyflow: [0.72, 0.975], bodyaura: [0.6, 0.97], facemask: [0.35, 0.93], facestream: [0.55, 0.96],
  };
  const [fadeLow, fadeHigh] = fadeRange[mode] ?? [0.5, 0.95];
  const fade = fadeLow + (fadeHigh - fadeLow) * trails;
  const gain: Record<string, number> = { bodyswarm: 0.035, bodyflow: 0.22, bodyaura: 0.03, facemask: 0.012, facestream: 0.04 };
  // Light per particle is set so the picture keeps its brightness whatever the
  // particle count, grid size or trail length.
  const energy = (gain[mode] ?? 1) * (layout.gridWidth * layout.gridHeight / layout.particles) * (1 - fade) * 4;
  const head = [
    poseValid ? 1 : 0, faceValid ? 1 : 0, bodyScale, bodyEnergy,
    mouthOpen, brows, turn, tilt,
    faceX, faceY, faceSize, state.faceShatter,
    mouthX, mouthY, aimX, aimY,
    trails, clampNumber(params.handfxSwirl, 0, 1, 0.5), layout.particles, layout.gridWidth,
    layout.gridHeight, layout.fluidWidth, layout.fluidHeight, energy,
    bodyX, bodyY, layout.glowWidth, layout.glowHeight,
    fade, smile, 0, 0,
  ];
  for (let index = 0; index < head.length; index += 1) buffer[index] = Number.isFinite(head[index]) ? head[index] : 0;
  return {
    buffer,
    topology: Float32Array.from(state.faceTopology ?? new Array<number>(HAND_FX_FACE_POINTS * 4).fill(0)),
    state,
    layout,
  };
}

export type HandFxFieldGraphInput = {
  id: (name: string) => string;
  sourceId: string;
  frameIndex: number;
  modeIndex: number;
  uniformB64: string;
  bodyB64: string;
  topologyB64: string;
  layout: HandFxFieldLayout;
  cameraSourceId?: string | null;
  reset: boolean;
};

/** Buffers and passes for one field mode. The uniform is HandFX's own 144 bytes. */
export function buildHandFxFieldConfig(input: HandFxFieldGraphInput): Record<string, unknown> {
  const { id, layout } = input;
  const cells = layout.gridWidth * layout.gridHeight;
  const glowCells = layout.glowWidth * layout.glowHeight;
  const fluidCells = layout.fluidWidth * layout.fluidHeight;
  const uniform = { binding: 0, resource: id('uniform'), kind: 'uniform' };
  const bodyBinding = { binding: 1, resource: id('body'), kind: 'read-only-storage' };
  const gridDispatch = [Math.ceil(layout.gridWidth / 8), Math.ceil(layout.gridHeight / 8), 1];
  const glowDispatch = [Math.ceil(layout.glowWidth / 8), Math.ceil(layout.glowHeight / 8), 1];
  const fluidDispatch = [Math.ceil(layout.fluidWidth / 8), Math.ceil(layout.fluidHeight / 8), 1];
  const fluidPass = (name: string, entry: string, from: string, to: string) => ({
    name: `handfx-fluid-${name}`, shader_id: 'handfx/field-fluid', entry, dispatch: fluidDispatch,
    bindings: [uniform, bodyBinding,
      { binding: 2, resource: id(from), kind: 'read-only-storage' },
      { binding: 3, resource: id(to), kind: 'storage' }],
  });
  const passes: Record<string, unknown>[] = [];
  if (input.modeIndex === HAND_FX_FIELD_MODE_BASE + 1) {
    passes.push(fluidPass('advect', 'cs_advect', 'fluid-a', 'fluid-b'), fluidPass('divergence', 'cs_divergence', 'fluid-b', 'fluid-a'));
    // An odd count leaves the pressure in fluid-b, and the projection puts the
    // finished velocity back in fluid-a for the particles and the next frame.
    for (let iteration = 0; iteration < HAND_FX_FLUID_JACOBI; iteration += 1) {
      passes.push(iteration % 2 === 0
        ? fluidPass(`jacobi-${iteration}`, 'cs_jacobi', 'fluid-a', 'fluid-b')
        : fluidPass(`jacobi-${iteration}`, 'cs_jacobi', 'fluid-b', 'fluid-a'));
    }
    passes.push(fluidPass('project', 'cs_project', 'fluid-b', 'fluid-a'));
  }
  const glowPass = (name: string, entry: string, from: string, to: string) => ({
    name: `handfx-field-${name}`, shader_id: 'handfx/field-sim', entry, dispatch: glowDispatch,
    bindings: [bodyBinding,
      { binding: 6, resource: id(from), kind: 'read-only-storage' },
      { binding: 7, resource: id(to), kind: 'storage' }],
  });
  passes.push(
    {
      name: 'handfx-field-fade', shader_id: 'handfx/field-sim', entry: 'cs_decay', dispatch: gridDispatch,
      bindings: [uniform, bodyBinding, { binding: 3, resource: id('light'), kind: 'storage' }],
    },
    {
      name: 'handfx-field-particles', shader_id: 'handfx/field-sim', entry: 'cs_particles',
      dispatch: [Math.ceil(layout.particles / 64), 1, 1],
      bindings: [uniform, bodyBinding,
        { binding: 2, resource: id('field-particles'), kind: 'storage' },
        { binding: 3, resource: id('light'), kind: 'storage' },
        { binding: 4, resource: id('fluid-a'), kind: 'read-only-storage' },
        { binding: 5, resource: id('face-topology'), kind: 'read-only-storage' }],
    },
    {
      name: 'handfx-field-glow', shader_id: 'handfx/field-sim', entry: 'cs_glow_down', dispatch: glowDispatch,
      bindings: [bodyBinding, { binding: 3, resource: id('light'), kind: 'storage' }, { binding: 7, resource: id('glow-a'), kind: 'storage' }],
    },
    glowPass('glow-h', 'cs_glow_h', 'glow-a', 'glow-b'),
    glowPass('glow-v', 'cs_glow_v', 'glow-b', 'glow-a'),
  );
  return {
    buffers: [
      { id: id('uniform'), kind: 'uniform', byte_length: 144, initial_b64: input.uniformB64 },
      { id: id('body'), kind: 'storage', byte_length: HAND_FX_BODY_BUFFER_BYTES, initial_b64: input.bodyB64 },
      { id: id('face-topology'), kind: 'storage', byte_length: HAND_FX_FACE_POINTS * 16, initial_b64: input.topologyB64 },
      { id: id('field-particles'), kind: 'storage', byte_length: layout.particles * 32, persistent: true, clear: input.reset },
      { id: id('light'), kind: 'storage', byte_length: cells * 8, persistent: true, clear: input.reset },
      { id: id('glow-a'), kind: 'storage', byte_length: glowCells * 8, persistent: true, clear: input.reset },
      { id: id('glow-b'), kind: 'storage', byte_length: glowCells * 8, persistent: true, clear: input.reset },
      { id: id('fluid-a'), kind: 'storage', byte_length: fluidCells * 16, persistent: true, clear: input.reset },
      { id: id('fluid-b'), kind: 'storage', byte_length: fluidCells * 16, persistent: true, clear: input.reset },
    ],
    passes,
    render_passes: [
      ...(input.cameraSourceId ? [{
        name: 'handfx-camera', shader_id: 'handfx/render', vertex_entry: 'vs_bg', fragment_entry: 'fs_camera',
        target: 'source_frame', source_id: input.sourceId, seq: input.frameIndex, clear: true, blend: 'alpha',
        vertex_count: 3, instance_count: 1,
        bindings: [uniform,
          { binding: 3, kind: 'source-frame-sampler' },
          { binding: 4, kind: 'source-frame-texture', source_id: input.cameraSourceId }],
      }] : []),
      {
        name: 'handfx-field', shader_id: 'handfx/field-render', vertex_entry: 'vs_field', fragment_entry: 'fs_field',
        target: 'source_frame', source_id: input.sourceId, seq: input.frameIndex, clear: !input.cameraSourceId, blend: 'alpha',
        vertex_count: 3, instance_count: 1,
        bindings: [uniform, bodyBinding,
          { binding: 2, resource: id('light'), kind: 'read-only-storage' },
          { binding: 3, resource: id('glow-a'), kind: 'read-only-storage' }],
      },
    ],
    readbacks: [],
  };
}
