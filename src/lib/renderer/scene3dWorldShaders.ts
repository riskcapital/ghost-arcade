/**
 * WGSL for the elements of the relief world (scene3dWorld.ts): balls that
 * fall, roll and bounce down the blocks and off each other.
 *
 *   scene3d/balls       cs_balls_life: birth, throws, age and death, the
 *                       touches' forces; cs_balls_copy + cs_balls_step: one
 *                       physics substep (others are read from last substep's
 *                       copy, so every ball sees the same picture)
 *   scene3d/balls-draw  vs_ball + fs_ball / fs_ball_relief: true spheres drawn
 *                       on quads, with their real depth; vs_ball_shadow: a disc
 *                       facing the key light, into the shadow map
 *
 * Collisions are exact: a block is a prism (its outline, from the wall to its
 * depth), so its distance is the 2D distance to the outline combined with
 * the distance along Z. The wall, the floor ledge and an invisible front pane
 * close the world.
 *
 * Bindings (group 0), besides the scene's: 13 balls, 14 last substep's copy,
 * 15 ball kinds, 16 blocks, 17 physics, 18 input.
 */
import { effectParams } from '../mobile/studio/interactiveEffects';
import { SCENE3D_COMMON_WGSL, SCENE3D_RELIEF_WGSL } from './scene3dShaders';

/** Floats per ball: position + radius, velocity + age, kind / seed / number / span. */
export const BALL_FLOATS = 12;
/** Floats per ball kind: slots, emit, 5 vec4 of params, 40 vec4 of their mods. */
export const BALL_KIND_FLOATS = (2 + 5 + 40) * 4;
/** Floats per block: bounds, depth and count, 32 vec4 holding 64 points. */
export const BALL_BLOCK_FLOATS = (2 + 32) * 4;
export const BALL_PHYS_FLOATS = 16;
/** Head, 8 pointers and 8 throws of two vec4 each. */
export const BALL_INPUT_FLOATS = 4 + 8 * 8 + 8 * 8;
/** The order of a ball kind's params (effectParams('balls3d')). */
export const BALL_PARAM_KEYS = effectParams('balls3d').map((d) => d.key);
export const BALL_SUBSTEPS = 4;

const PARAM_CONSTS = BALL_PARAM_KEYS.map((key, i) => `const P_${key.toUpperCase()} = ${i}u;`).join('\n');

const BALL_COMMON = /* wgsl */ `
struct BallKind {
  slots: vec4f,   // first slot, slot count, emission (0 flow, 1 pulse, 2 burst, 3 thrown), burst generation
  emit: vec4f,    // from (0 a point, 1 a block), that block's depth, spare, on
  params: array<vec4f, 5>,
  mods: array<vec4f, 40>,
}
// pos.w radius (0: not in play). vel.w age, negative while waiting to be born.
// info: kind, seed, birth number (throws) or burst seen, life span.
struct Ball { pos: vec4f, vel: vec4f, info: vec4f }
struct Phys {
  frame: vec4f,   // wall width, height, camera distance, gravity (m/s²)
  bounds: vec4f,  // front pane z (0 none), floor top y, deepest spawn z, floor depth
  counts: vec4f,  // balls, kinds, blocks, substeps
  kill: vec4f,    // below this y, beyond this |x|, nearer than this z
}

@group(0) @binding(15) var<storage, read> kinds: array<BallKind>;
@group(0) @binding(17) var<uniform> phys: Phys;

${PARAM_CONSTS}

// A param of a kind with its modulation, the same maths as evaluateEffect.
fn param(k: u32, i: u32) -> f32 {
  let base = kinds[k].params[i / 4u][i % 4u];
  let a = kinds[k].mods[i * 2u];
  let b = kinds[k].mods[i * 2u + 1u];
  if (a.x < 0.5) { return base; }
  let source = u32(a.x);
  let phase = frame.time * a.z * select(1.0, max(frame.tempo, 1.0) / 60.0, b.z > 0.5);
  var signal = 0.0;
  switch (source) {
    case 1u, 2u: { signal = frame.bass; }
    case 3u: { signal = (frame.bass + frame.mid) * 0.5; }
    case 4u: { signal = frame.mid; }
    case 5u: { signal = (frame.mid + frame.treble) * 0.5; }
    case 6u, 7u, 8u, 9u: { signal = frame.treble; }
    case 10u: { signal = frame.energy; }
    case 11u: { signal = frame.beat_phase; }
    case 12u: { signal = frame.kick; }
    case 13u: { signal = frame.snare; }
    case 14u: { signal = 0.5 + 0.5 * sin(phase * 6.2831853); }
    case 15u: { signal = 1.0 - abs(fract(phase) * 2.0 - 1.0); }
    case 16u: { signal = fract(phase); }
    case 17u: { signal = select(0.0, 1.0, fract(phase) < 0.5); }
    default: {}
  }
  signal = clamp(signal, 0.0, 1.0);
  if (b.w > 0.5) { return mix(b.x, b.y, select(signal, 1.0 - signal, a.w > 0.5)); }
  if (source < 11u || source == 12u || source == 13u) { signal = 0.5 + signal * 0.5; }
  signal = select(signal, 1.0 - signal, a.w > 0.5);
  return clamp(base + (signal - 0.5) * a.y * (b.y - b.x), b.x, b.y);
}

// A ball's radius in meters, before it grows in and shrinks out.
fn ball_radius(k: u32, seed: f32) -> f32 {
  let spread = (fract(seed * 91.7) - 0.5) * param(k, P_VARIETY) * 0.7;
  return mix(0.03, 0.2, clamp(param(k, P_SIZE), 0.0, 1.0)) * (1.0 + spread);
}
`;

export const SCENE3D_BALLS_WGSL = /* wgsl */ `${SCENE3D_COMMON_WGSL}
${BALL_COMMON}

struct Block { box: vec4f, info: vec4f, pts: array<vec4f, 32> } // box: min xy, max xy; info: depth, points
struct Pointer { a: vec4f, b: vec4f }  // a: hit xyz, tool (1 push, 2 attract, 3 repel, 4 vortex); b: velocity xyz, strength
struct Throw { a: vec4f, b: vec4f }    // a: position xyz, number; b: velocity xyz, spare
struct Input { head: vec4f, pointers: array<Pointer, 8>, throws: array<Throw, 8> } // head: pointers, throws

@group(0) @binding(2) var<storage, read> view: View;
@group(0) @binding(13) var<storage, read_write> balls: array<Ball>;
@group(0) @binding(14) var<storage, read_write> prev: array<Ball>;
@group(0) @binding(16) var<storage, read> blocks: array<Block>;
@group(0) @binding(18) var<uniform> input: Input;

const AWAY = vec4f(0.0, -1.0e4, 0.0, 0.0);

fn corner_of(bi: u32, i: u32) -> vec2f {
  let v = blocks[bi].pts[i / 2u];
  return select(v.xy, v.zw, (i & 1u) == 1u);
}

// Signed distance to an outline in the wall's plane (negative inside).
fn sd_outline(bi: u32, q: vec2f) -> f32 {
  let n = u32(blocks[bi].info.y);
  let v0 = corner_of(bi, 0u);
  var d = dot(q - v0, q - v0);
  var s = 1.0;
  var j = n - 1u;
  for (var i = 0u; i < n; i++) {
    let vi = corner_of(bi, i);
    let vj = corner_of(bi, j);
    let e = vj - vi;
    let w = q - vi;
    let b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    d = min(d, dot(b, b));
    let c = vec3<bool>((q.y >= vi.y), (q.y < vj.y), (e.x * w.y > e.y * w.x));
    if (all(c) || !any(c)) { s = -s; }
    j = i;
  }
  return s * sqrt(d);
}

// A block: its outline from the wall (z = 0) out to its depth.
fn sd_block(bi: u32, p: vec3f) -> f32 {
  let blk = blocks[bi];
  let dz = max(p.z - blk.info.x, -p.z);
  let q = clamp(p.xy, blk.box.xy, blk.box.zw);
  let dxy = length(p.xy - q);
  // Far from it: the distance to its bounds is close enough (and never more).
  if (dxy > 0.3) { return length(vec2f(dxy, max(dz, 0.0))); }
  let w = vec2f(sd_outline(bi, p.xy), dz);
  return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0)));
}

fn world_sdf(p: vec3f) -> f32 {
  var d = p.z;                                                     // the wall
  if (phys.bounds.x > 0.0) { d = min(d, phys.bounds.x - p.z); }   // the front pane
  if (p.z < phys.bounds.w) { d = min(d, p.y - phys.bounds.y); }   // the floor ledge
  for (var i = 0u; i < u32(phys.counts.z); i++) { d = min(d, sd_block(i, p)); }
  return d;
}

fn world_normal(p: vec3f) -> vec3f {
  let e = 0.002;
  let k = vec2f(1.0, -1.0);
  return normalize(
    k.xyy * world_sdf(p + k.xyy * e) + k.yyx * world_sdf(p + k.yyx * e) +
    k.yxy * world_sdf(p + k.yxy * e) + k.xxx * world_sdf(p + k.xxx * e));
}

fn kind_of(i: u32) -> i32 {
  for (var k = 0u; k < u32(phys.counts.y); k++) {
    let s = kinds[k].slots;
    if (f32(i) >= s.x && f32(i) < s.x + s.y) { return i32(k); }
  }
  return -1;
}

// A point of the output (0..1, y down) at depth z in front of the wall.
fn unproject(uv: vec2f, z: f32) -> vec3f {
  let k = 1.0 - z / phys.frame.z;
  return vec3f((uv.x - 0.5) * phys.frame.x * k, (0.5 - uv.y) * phys.frame.y * k, z);
}

// A new ball from its kind's emitter.
fn born(k: u32, i: u32, tick: u32) -> Ball {
  let h1 = hash1(i * 97u + tick * 13u + 1u);
  let h2 = hash1(i * 89u + tick * 7u + 2u);
  let h3 = hash1(i * 83u + tick * 5u + 3u);
  let h4 = hash1(i * 79u + tick * 3u + 4u);
  var b: Ball;
  let seed = hash1(i * 71u + tick * 11u + 5u) + 1e-4;
  let r = ball_radius(k, seed);
  let a = radians(param(k, P_DIRECTION));
  let dir = vec2f(cos(a), sin(a));
  let uv = vec2f(param(k, P_X), param(k, P_Y)) + vec2f(-dir.y, dir.x) * (h1 * 2.0 - 1.0) * param(k, P_RADIUS);
  var deepest = phys.bounds.z;
  if (kinds[k].emit.x > 0.5) { deepest = kinds[k].emit.y; }
  if (phys.bounds.x > 0.0) { deepest = min(deepest, phys.bounds.x); }
  let z = mix(r + 0.01, max(deepest - r, r + 0.01), h2);
  let jitter = (vec3f(h3, h4, 0.5) - 0.5) * 0.6;
  b.pos = vec4f(unproject(uv, z), r);
  b.vel = vec4f(vec3f(dir.x, -dir.y, 0.0) * param(k, P_SPEED) * 10.0 + jitter, 0.0);
  b.info = vec4f(f32(k), seed, 0.0, max(param(k, P_LIFETIME), 0.5) * (0.8 + 0.4 * h3));
  return b;
}

// Birth, throws, age and death, and what the touches do. Once a frame.
@compute @workgroup_size(64)
fn cs_balls_life(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (f32(i) >= phys.counts.x) { return; }
  var b = balls[i];
  let ki = kind_of(i);
  if (ki < 0) { b.pos = AWAY; balls[i] = b; return; }
  let k = u32(ki);
  let slots = kinds[k].slots;
  let dt = view.clock.x;
  let tick = u32(view.clock.y);
  let local = i - u32(slots.x);
  let emission = slots.z;
  let on = kinds[k].emit.w > 0.5;
  // A new buffer: waiting, staggered, so the first balls come in a few at a time.
  if (b.info.y == 0.0) {
    b.pos = AWAY;
    b.vel = vec4f(0.0, 0.0, 0.0, -hash1(i * 31u + 5u) * min(max(param(k, P_LIFETIME), 1.0), 6.0) * 0.5);
    b.info = vec4f(f32(k), hash1(i * 7919u + 17u) + 1e-4, select(slots.w, 0.0, emission > 2.5), 0.0);
  }
  let in_use = min(slots.y, max(param(k, P_AMOUNT), 0.0));
  if (emission > 2.5) {
    // Thrown: each throw number lands in slot number % slots, once.
    for (var t = 0u; t < u32(input.head.y); t++) {
      let th = input.throws[t];
      let n = th.a.w;
      if (u32(n) % u32(slots.y) == local && n != b.info.z) {
        let seed = hash1(u32(n) * 131u + 9u) + 1e-4;
        b.pos = vec4f(th.a.xyz, ball_radius(k, seed));
        b.vel = vec4f(th.b.xyz, 0.0);
        b.info = vec4f(f32(k), seed, n, max(param(k, P_LIFETIME), 0.5));
      }
    }
  } else if (on && slots.w != b.info.z) {
    // A burst: a share of the slots go at once, whether or not they are in play.
    if (f32(local) < max(in_use * (0.25 + 0.5 * param(k, P_FLOW)), 1.0)) {
      b = born(k, i, tick + u32(slots.w) * 977u);
    }
    b.info.z = slots.w;
  }
  let gen = b.info.z;
  if (b.pos.w > 0.0) {
    b.vel.w += dt;
    let age = b.vel.w;
    let gone = b.pos.y < phys.kill.x || abs(b.pos.x) > phys.kill.y || b.pos.z > phys.kill.z;
    if (!on || age > b.info.w || gone) {
      b.pos = AWAY;
      b.vel = vec4f(0.0, 0.0, 0.0, -0.05);
    } else {
      // Grows in, shrinks out.
      let fade = smoothstep(0.0, 0.12, age) * smoothstep(b.info.w, b.info.w - 0.5, age);
      b.pos.w = max(ball_radius(k, b.info.y) * fade, 0.004);
      for (var p = 0u; p < u32(input.head.x); p++) {
        let ptr = input.pointers[p];
        let eye = vec3f(0.0, 0.0, phys.frame.z);
        let dir = normalize(ptr.a.xyz - eye);
        let rel = b.pos.xyz - eye;
        let off = rel - dir * dot(rel, dir);
        let d = length(off);
        let reach = 0.3 + 0.35 * ptr.b.w;
        if (d >= reach) { continue; }
        let w = (1.0 - d / reach) * (1.0 - d / reach);
        let out = off / max(d, 1e-4);
        let tool = ptr.a.w;
        let s = ptr.b.w;
        if (tool < 1.5) {
          // Push: carried along with the finger, and nudged out of its way.
          b.vel = vec4f(b.vel.xyz + (ptr.b.xyz - b.vel.xyz) * min(1.0, w * 12.0 * dt) + out * w * 4.0 * dt, b.vel.w);
        } else if (tool < 2.5) {
          b.vel = vec4f(b.vel.xyz + normalize(ptr.a.xyz - b.pos.xyz + vec3f(1e-5)) * 30.0 * s * w * dt, b.vel.w);
        } else if (tool < 3.5) {
          b.vel = vec4f(b.vel.xyz + (out + vec3f(0.0, 0.0, 0.3)) * 30.0 * s * w * dt, b.vel.w);
        } else {
          b.vel = vec4f(b.vel.xyz + (cross(dir, out) * 26.0 - out * 6.0) * s * w * dt, b.vel.w);
        }
      }
    }
  } else if (on && emission < 1.5) {
    b.vel.w += dt;
    if (b.vel.w >= 0.0) {
      var hazard = 0.0;
      if (f32(local) < in_use) {
        let flow = clamp(param(k, P_FLOW), 0.0, 1.0);
        let life = max(param(k, P_LIFETIME), 0.5);
        if (emission < 0.5) {
          // So that about \`flow\` of the slots are in play.
          hazard = flow / (life * max(1.0 - flow, 0.02));
        } else {
          let period = max(param(k, P_PERIOD), 0.2);
          let open = fract(frame.time / period) * period < param(k, P_DURATION);
          hazard = select(0.0, 6.0 * flow / max(param(k, P_DURATION), 0.05), open);
        }
      }
      if (hash1(i * 613u + tick * 1031u + 7u) < 1.0 - exp(-hazard * dt)) {
        b = born(k, i, tick);
        b.info.z = gen;
      }
    }
  }
  balls[i] = b;
}

@compute @workgroup_size(64)
fn cs_balls_copy(@builtin(global_invocation_id) gid: vec3u) {
  if (f32(gid.x) < phys.counts.x) { prev[gid.x] = balls[gid.x]; }
}

// One substep: gravity, the other balls, the blocks and the walls.
@compute @workgroup_size(64)
fn cs_balls_step(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let count = u32(phys.counts.x);
  if (i >= count) { return; }
  var b = prev[i];
  if (b.pos.w <= 0.0) { return; }
  let k = u32(b.info.x);
  let h = view.clock.x / max(phys.counts.w, 1.0);
  let r = b.pos.w;
  let e = clamp(param(k, P_BOUNCE), 0.0, 0.98);
  var v = b.vel.xyz;
  v.y -= phys.frame.w * h;
  // The others, as they were: each pair is pushed apart half each way.
  var shift = vec3f(0.0);
  var dv = vec3f(0.0);
  for (var j = 0u; j < count; j++) {
    if (j == i) { continue; }
    let o = prev[j];
    if (o.pos.w <= 0.0) { continue; }
    let d = b.pos.xyz - o.pos.xyz;
    let reach = r + o.pos.w;
    let d2 = dot(d, d);
    if (d2 >= reach * reach || d2 < 1e-12) { continue; }
    let dist = sqrt(d2);
    let n = d / dist;
    shift += n * (reach - dist) * 0.5;
    let vn = dot(v - o.vel.xyz, n);
    if (vn < 0.0) { dv -= n * vn * (1.0 + e) * 0.5; }
  }
  v += dv;
  var p = b.pos.xyz + shift + v * h;
  // The world: out of whatever it went into, bounce and friction.
  let s = world_sdf(p) - r;
  if (s < 0.0) {
    let n = world_normal(p);
    p += n * (-s);
    let vn = dot(v, n);
    if (vn < 0.0) {
      let vt = v - n * vn;
      let hit = -vn;
      // Resting contact does not bounce, or balls never settle.
      let bounce = select(0.0, e, hit > 0.6);
      let slip = length(vt);
      let keep = max(0.0, 1.0 - clamp(param(k, P_FRICTION), 0.0, 1.0) * 0.5 * hit * (1.0 + bounce) / max(slip, 1e-4));
      v = vt * keep + n * hit * bounce;
    }
  }
  v *= 1.0 - 0.08 * h;
  let speed = length(v);
  if (speed > 18.0) { v *= 18.0 / speed; }
  b.pos = vec4f(p, r);
  b.vel = vec4f(v, b.vel.w);
  balls[i] = b;
}
`;

export const SCENE3D_BALLS_DRAW_WGSL = /* wgsl */ `${SCENE3D_RELIEF_WGSL}
${BALL_COMMON}

@group(0) @binding(13) var<storage, read> balls: array<Ball>;

struct BallOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) index: u32,
}
struct BallFrag { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
struct BallHit { ok: bool, pos: vec3f, n: vec3f, v: vec3f, depth: f32 }
struct BallLook { base: vec3f, metal: f32, rough: f32, glow: f32, glass: f32 }

// A quad in front of the ball, facing the camera and wide enough to hold it.
@vertex
fn vs_ball(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BallOut {
  let b = balls[ii];
  var out: BallOut;
  out.index = ii;
  if (b.pos.w <= 0.0) { out.clip = OFFSCREEN; return out; }
  let c = corner(vi);
  let to_cam = normalize(view.cam_pos.xyz - b.pos.xyz);
  let world = b.pos.xyz + to_cam * b.pos.w + (view.cam_right.xyz * c.x + view.cam_up.xyz * c.y) * b.pos.w * 1.5;
  out.clip = view.view_proj * vec4f(world, 1.0);
  out.world = world;
  return out;
}

// The ball's shadow: a disc facing the key light, as deep as its center.
@vertex
fn vs_ball_shadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ShadowOut {
  let b = balls[ii];
  var out: ShadowOut;
  if (b.pos.w <= 0.0) { out.clip = OFFSCREEN; return out; }
  let l = view.light.xyz;
  var u = cross(l, vec3f(0.0, 0.0, 1.0));
  if (length(u) < 0.01) { u = cross(l, vec3f(1.0, 0.0, 0.0)); }
  u = normalize(u);
  let w = cross(l, u);
  let tri = vi / 3u;
  let at = vi % 3u;
  var p = b.pos.xyz;
  if (at > 0u) {
    let a = f32(tri + at - 1u) / 12.0 * 2.0 * PI;
    p += (u * cos(a) + w * sin(a)) * b.pos.w;
  }
  out.clip = view.light_view_proj * vec4f(p, 1.0);
  return out;
}

fn ball_hit(in: BallOut) -> BallHit {
  let b = balls[in.index];
  let o = view.cam_pos.xyz;
  let d = normalize(in.world - o);
  let oc = o - b.pos.xyz;
  let bq = dot(oc, d);
  let disc = bq * bq - (dot(oc, oc) - b.pos.w * b.pos.w);
  var h: BallHit;
  h.ok = disc >= 0.0;
  if (!h.ok) { return h; }
  h.pos = o + d * (-bq - sqrt(disc));
  h.n = normalize(h.pos - b.pos.xyz);
  h.v = -d;
  let clip = view.view_proj * vec4f(h.pos, 1.0);
  h.depth = clip.z / clip.w;
  return h;
}

fn hue_rgb(h: f32) -> vec3f {
  let k = fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0));
  return clamp(abs(k * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}

// A ball's color and finish: its kind's, varied by its seed. With Variety up,
// some balls take another finish: chrome, glass or neon.
fn ball_look(b: Ball) -> BallLook {
  let k = u32(b.info.x);
  let seed = b.info.y;
  let variety = clamp(param(k, P_VARIETY), 0.0, 1.0);
  let hue = param(k, P_HUE) / 360.0 + (fract(seed * 7.13) - 0.5) * variety * 0.7;
  var look: BallLook;
  look.base = pow(mix(vec3f(1.0), hue_rgb(hue), 0.85), vec3f(2.2));
  let shine = clamp(param(k, P_SHINE), 0.0, 1.0);
  look.metal = shine;
  look.rough = mix(0.55, 0.06, shine);
  look.glow = max(param(k, P_GLOW), 0.0);
  look.glass = select(0.0, 1.0, fract(seed * 41.1) < param(k, P_CLEAR));
  if (fract(seed * 13.7) < variety * 0.6) {
    let pick = fract(seed * 29.3);
    if (pick < 0.34) { look.metal = 1.0; look.rough = 0.05; look.glass = 0.0; }
    else if (pick < 0.67) { look.glass = 1.0; }
    else { look.glow = max(look.glow, 0.9); look.metal = 0.2; look.glass = 0.0; }
  }
  return look;
}

fn ball_color(h: BallHit, look: BallLook) -> vec3f {
  if (look.glass > 0.5) {
    // Glass: the sky and the sun mirrored, a rim of its tint.
    let facing = max(dot(h.n, h.v), 0.0);
    let fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
    let half_v = normalize(view.light.xyz + h.v);
    let spec = pow(max(dot(h.n, half_v), 0.0), 900.0) * view.light.w * 10.0 * shadow_at(h.pos, h.n);
    return sky_at(reflect(-h.v, h.n)) * fresnel * 2.0 + spec * settings.key_color.rgb
      + look.base * (0.03 + pow(1.0 - facing, 2.0) * 0.3 + look.glow * 2.0);
  }
  var m: Material;
  m.base = look.base;
  m.metal = look.metal;
  m.rough = look.rough;
  m.emissive = look.glow * 4.0;
  m.opacity = 1.0;
  m.catcher = 0.0;
  return lighting(m, h.pos, h.n, h.v);
}

@fragment
fn fs_ball(in: BallOut) -> BallFrag {
  let h = ball_hit(in);
  if (!h.ok) { discard; }
  var out: BallFrag;
  out.color = vec4f(fogged(ball_color(h, ball_look(balls[in.index])), h.pos), 1.0);
  out.depth = h.depth;
  return out;
}

// With the flat picture thrown on the world: it lights the balls too, and a
// glass ball shows it bent through the glass.
@fragment
fn fs_ball_relief(in: BallOut) -> BallFrag {
  let h = ball_hit(in);
  if (!h.ok) { discard; }
  let look = ball_look(balls[in.index]);
  var col = ball_color(h, look);
  let facing = max(dot(h.n, normalize(projector_pos() - h.pos)), 0.0);
  col += thrown_light(h.pos).rgb * settings.post_b.z * facing * (look.base * (1.0 - look.metal) + vec3f(0.1));
  if (look.glass > 0.5) {
    let bent = refract(-h.v, h.n, 1.0 / 1.5);
    if (bent.z < -1e-3) {
      let behind = h.pos + bent * (-h.pos.z / bent.z);
      col += thrown_light(behind).rgb * settings.post_b.z * (look.base * 0.7 + vec3f(0.3)) * 0.8;
    }
  }
  var out: BallFrag;
  out.color = vec4f(fogged(col, h.pos), 1.0);
  out.depth = h.depth;
  return out;
}
`;

export const SCENE3D_WORLD_SHADERS: { id: string; stage: 'compute' | 'render'; entry: string; source: string }[] = [
  { id: 'scene3d/balls', stage: 'compute', entry: 'cs_balls_step', source: SCENE3D_BALLS_WGSL },
  { id: 'scene3d/balls-draw', stage: 'render', entry: 'fs_ball', source: SCENE3D_BALLS_DRAW_WGSL },
];

/** Commands that compile the world's shaders ahead of the first frame. */
export const scene3dWorldPrecompileCommands = () =>
  SCENE3D_WORLD_SHADERS.map((s) => ({ type: 'precompile_shader' as const, shader_id: s.id, stage: s.stage, entry: s.entry, source: s.source }));
