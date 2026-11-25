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
 * Collisions are exact: a block is a prism (a face's outline, from the face
 * back to its depth, in the face's own frame), so its distance is the 2D
 * distance to the outline combined with the distance along the face's
 * normal. On the flat wall the wall, the floor ledge and an invisible front
 * pane close the world; in a room, a ground plane. Gravity is a vector, and
 * spawn points, touches and the output all go through the projector
 * (settings.proj_*), see worldGeometry.ts.
 *
 * Bindings (group 0), besides the scene's: 13 balls, 14 last substep's copy,
 * 15 ball kinds, 16 blocks, 17 physics, 18 input.
 */
import { effectParams } from '../mobile/studio/interactiveEffects';
import { SCENE3D_COMMON_WGSL, SCENE3D_RELIEF_WGSL, SCENE3D_WORLD_WGSL } from './scene3dShaders';

/** Floats per ball: position + radius, velocity + age, kind / seed / number / span, zones it is in. */
export const BALL_FLOATS = 16;
/** The most zones balls can set off (a bit each in a float), and floats per zone. */
export const MAX_BALL_ZONES = 24;
export const BALL_ZONE_FLOATS = (2 + 32) * 4;
/** Floats per ball kind: slots, emit, 5 vec4 of params, 40 vec4 of their mods. */
export const BALL_KIND_FLOATS = (2 + 5 + 40) * 4;
/** Floats per block: bounds, depth and count, its frame (origin, u, v, n), 32 vec4 holding 64 points. */
export const BALL_BLOCK_FLOATS = (6 + 32) * 4;
export const BALL_PHYS_FLOATS = 36;
/** Head, 8 pointers and 8 throws of two vec4 each. */
export const BALL_INPUT_FLOATS = 4 + 8 * 8 + 8 * 8;
/** The order of a ball kind's params (effectParams('balls3d')). */
export const BALL_PARAM_KEYS = effectParams('balls3d').map((d) => d.key);
export const BALL_SUBSTEPS = 4;

const PARAM_CONSTS = BALL_PARAM_KEYS.map((key, i) => `const P_${key.toUpperCase()} = ${i}u;`).join('\n');

const WORLD_COMMON = /* wgsl */ `
struct Phys {
  down: vec4f,    // which way things fall (unit), gravity (m/s²)
  bounds: vec4f,  // front pane z (0 none), floor top y, deepest spawn z, floor depth (the wall)
  counts: vec4f,  // balls, ball kinds, blocks, substeps
  kill: vec4f,    // the wall: below this y, beyond this |x|, nearer than this z
  drips: vec4f,   // drops, drop kinds, seconds a stain takes to fade, seconds paint stays wet
  fire: vec4f,    // flame particles, flame kinds, zones balls set off
  plane: vec4f,   // the plane behind or under everything: normal (0: none), offset
  room: vec4f,    // mode (0 the wall, 1 a room), spawn reference, lost beyond this from the middle
  middle: vec4f,  // the room's middle
}
@group(0) @binding(17) var<uniform> phys: Phys;

fn gravity() -> vec3f { return phys.down.xyz * phys.down.w; }
fn proj_across() -> vec3f { return normalize(settings.proj_right.xyz); }
fn proj_upward() -> vec3f { return normalize(settings.proj_up.xyz); }
// Out of the world: fallen away, or (the wall) off its sides or behind the camera.
fn lost(p: vec3f) -> bool {
  if (phys.room.x > 0.5) { return length(p - phys.middle.xyz) > phys.room.z; }
  return p.y < phys.kill.x || abs(p.x) > phys.kill.y || p.z > phys.kill.z;
}

// A param with its modulation (a: source, amount, speed, invert; b: low,
// high, beat sync, ranged), the same maths as evaluateEffect.
fn modulated(base: f32, a: vec4f, b: vec4f) -> f32 {
  if (a.x < 0.5) { return base; }
  let source = u32(a.x);
  let phase = frame.time * a.z * select(1.0, select(120.0, frame.tempo, frame.tempo >= 1.0) / 60.0, b.z > 0.5);
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

fn hue_rgb(h: f32) -> vec3f {
  let k = fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0));
  return clamp(abs(k * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}

`;

/** The world's shape, for the simulations: blocks, wall, floor and pane, and the touches. */
const WORLD_SIM = /* wgsl */ `
// box: the outline's min and max in the face's plane; info: depth, points; o, u, v, n: the face's frame.
struct Block { box: vec4f, info: vec4f, o: vec4f, u: vec4f, v: vec4f, n: vec4f, pts: array<vec4f, 32> }
struct Pointer { a: vec4f, b: vec4f }  // a: hit xyz, tool (1 push, 2 attract, 3 repel, 4 vortex, 5 pour, 6 ignite); b: velocity xyz, strength
struct Throw { a: vec4f, b: vec4f }    // a: position xyz, number; b: velocity xyz, spare
struct Input { head: vec4f, pointers: array<Pointer, 8>, throws: array<Throw, 8> } // head: pointers, throws

@group(0) @binding(2) var<storage, read> view: View;
@group(0) @binding(16) var<storage, read> blocks: array<Block>;
@group(0) @binding(18) var<uniform> input: Input;

const AWAY = vec4f(0.0, -1.0e4, 0.0, 0.0);

fn corner_of(bi: u32, i: u32) -> vec2f {
  let v = blocks[bi].pts[i / 2u];
  return select(v.xy, v.zw, (i & 1u) == 1u);
}

// Signed distance to an outline in its face's plane (negative inside).
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

// A block: its face's outline, from the face back to its depth.
fn sd_block(bi: u32, p: vec3f) -> f32 {
  let blk = blocks[bi];
  let r = p - blk.o.xyz;
  let l = vec3f(dot(r, blk.u.xyz), dot(r, blk.v.xyz), dot(r, blk.n.xyz));
  let dz = max(l.z, -l.z - blk.info.x);
  let q = clamp(l.xy, blk.box.xy, blk.box.zw);
  let dxy = length(l.xy - q);
  // Far from it: the distance to its bounds is close enough (and never more).
  if (dxy > 0.3) { return length(vec2f(dxy, max(dz, 0.0))); }
  let w = vec2f(sd_outline(bi, l.xy), dz);
  return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0)));
}

fn world_sdf(p: vec3f) -> f32 {
  var d = 1.0e9;
  if (dot(phys.plane.xyz, phys.plane.xyz) > 0.5) { d = dot(p, phys.plane.xyz) - phys.plane.w; }  // the wall or ground
  if (phys.room.x < 0.5) {
    if (phys.bounds.x > 0.0) { d = min(d, phys.bounds.x - p.z); }   // the front pane
    if (p.z < phys.bounds.w) { d = min(d, p.y - phys.bounds.y); }   // the floor ledge
  }
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

// A point of the output (0..1, y down) at spawn depth z: on the wall, z in
// front of it; in a room, z nearer the projector than the farthest face.
fn unproject(uv: vec2f, z: f32) -> vec3f {
  return settings.proj_pos.xyz + proj_dir(uv) * (phys.room.y - z);
}
// A direction on the output (x right, y up) in the world, at right angles to the projector.
fn on_output(d: vec2f) -> vec3f { return proj_across() * d.x + proj_upward() * d.y; }

`;

const BALL_COMMON = /* wgsl */ `
struct BallKind {
  slots: vec4f,   // first slot, slot count, emission (0 flow, 1 pulse, 2 burst, 3 thrown), burst generation
  emit: vec4f,    // from (0 a point, 1 a block), that block's depth, spare, on
  params: array<vec4f, 5>,
  mods: array<vec4f, 40>,
}
// pos.w radius (0: not in play). vel.w age, negative while waiting to be born.
// info: kind, seed, birth number (throws) or burst seen, life span.
// extra.x: the zones it is in, a bit each.
struct Ball { pos: vec4f, vel: vec4f, info: vec4f, extra: vec4f }
@group(0) @binding(15) var<storage, read> kinds: array<BallKind>;

${PARAM_CONSTS}

// A param of a kind with its modulation.
fn param(k: u32, i: u32) -> f32 {
  return modulated(kinds[k].params[i / 4u][i % 4u], kinds[k].mods[i * 2u], kinds[k].mods[i * 2u + 1u]);
}
// A ball's radius in meters, before it grows in and shrinks out.
fn ball_radius(k: u32, seed: f32) -> f32 {
  let spread = (fract(seed * 91.7) - 0.5) * param(k, P_VARIETY) * 0.7;
  return mix(0.03, 0.2, clamp(param(k, P_SIZE), 0.0, 1.0)) * (1.0 + spread);
}
`;

export const SCENE3D_BALLS_WGSL = /* wgsl */ `${SCENE3D_COMMON_WGSL}
${WORLD_COMMON}
${WORLD_SIM}
${BALL_COMMON}

@group(0) @binding(13) var<storage, read_write> balls: array<Ball>;
@group(0) @binding(14) var<storage, read_write> prev: array<Ball>;
// Zones balls set off: outlines on the output (box: min, max), and how many
// times a ball has come into each, which the app reads back.
struct Zone { box: vec4f, info: vec4f, pts: array<vec4f, 32> }
@group(0) @binding(26) var<storage, read> zones: array<Zone>;
@group(0) @binding(27) var<storage, read_write> zone_hits: array<atomic<u32>>;

fn zone_corner(z: u32, i: u32) -> vec2f {
  let v = zones[z].pts[i / 2u];
  return select(v.xy, v.zw, (i & 1u) == 1u);
}

// The zones a point of the output is in, a bit each.
fn zones_at(uv: vec2f) -> u32 {
  var mask = 0u;
  for (var z = 0u; z < u32(phys.fire.z); z++) {
    let box = zones[z].box;
    if (any(uv < box.xy) || any(uv > box.zw)) { continue; }
    let n = u32(zones[z].info.x);
    var inside = false;
    var j = n - 1u;
    for (var i = 0u; i < n; i++) {
      let a = zone_corner(z, i);
      let c = zone_corner(z, j);
      if (((a.y > uv.y) != (c.y > uv.y)) && (uv.x < (c.x - a.x) * (uv.y - a.y) / (c.y - a.y) + a.x)) { inside = !inside; }
      j = i;
    }
    if (inside) { mask |= 1u << z; }
  }
  return mask;
}

fn kind_of(i: u32) -> i32 {
  for (var k = 0u; k < u32(phys.counts.y); k++) {
    let s = kinds[k].slots;
    if (f32(i) >= s.x && f32(i) < s.x + s.y) { return i32(k); }
  }
  return -1;
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
  let jitter = on_output(vec2f(h3, h4) - 0.5) * 0.6;
  b.pos = vec4f(unproject(uv, z), r);
  b.vel = vec4f(on_output(vec2f(dir.x, -dir.y)) * param(k, P_SPEED) * 10.0 + jitter, 0.0);
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
    if (!on || age > b.info.w || lost(b.pos.xyz)) {
      b.pos = AWAY;
      b.vel = vec4f(0.0, 0.0, 0.0, -0.05);
      b.extra.x = 0.0;
    } else {
      // Grows in, shrinks out.
      let fade = smoothstep(0.0, 0.12, age) * smoothstep(b.info.w, b.info.w - 0.5, age);
      b.pos.w = max(ball_radius(k, b.info.y) * fade, 0.004);
      // Zones: count each one the ball has just come into, as seen on the output.
      if (phys.fire.z > 0.0) {
        let now_in = zones_at(proj_uv(b.pos.xyz));
        let came = now_in & ~u32(b.extra.x);
        for (var z = 0u; z < u32(phys.fire.z); z++) {
          if ((came & (1u << z)) != 0u) { atomicAdd(&zone_hits[z], 1u); }
        }
        b.extra.x = f32(now_in);
      }
      for (var p = 0u; p < u32(input.head.x); p++) {
        let ptr = input.pointers[p];
        let eye = settings.proj_pos.xyz;
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
        if (tool > 4.5) { continue; }  // Pour and Ignite are for paint and fire
        if (tool < 1.5) {
          // Push: carried along with the finger, and nudged out of its way.
          b.vel = vec4f(b.vel.xyz + (ptr.b.xyz - b.vel.xyz) * min(1.0, w * 12.0 * dt) + out * w * 4.0 * dt, b.vel.w);
        } else if (tool < 2.5) {
          b.vel = vec4f(b.vel.xyz + normalize(ptr.a.xyz - b.pos.xyz + vec3f(1e-5)) * 30.0 * s * w * dt, b.vel.w);
        } else if (tool < 3.5) {
          b.vel = vec4f(b.vel.xyz + (out - dir * 0.3) * 30.0 * s * w * dt, b.vel.w);
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
  v += gravity() * h;
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
${WORLD_COMMON}
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
  return lighting(m, h.pos, h.n, h.v) + fire_lighting(m, h.pos, h.n, h.v);
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
    let into = dot(bent, phys.plane.xyz);
    if (into < -1e-3) {
      let behind = h.pos + bent * ((phys.plane.w - dot(h.pos, phys.plane.xyz)) / into);
      col += thrown_light(behind).rgb * settings.post_b.z * (look.base * 0.7 + vec3f(0.3)) * 0.8;
    }
  }
  var out: BallFrag;
  out.color = vec4f(fogged(col, h.pos), 1.0);
  out.depth = h.depth;
  return out;
}
`;

// ── Paint drips ──────────────────────────────────────────────────────────

/** Floats per drop: position + radius, velocity + age, kind / seed / state / span, burst seen. */
export const DRIP_FLOATS = 16;
/** Floats per drop kind: slots, emit, params, mods, 16 sites of three vec4 (ends, the face's normal and depth). */
export const DRIP_KIND_FLOATS = (2 + 5 + 40 + 48) * 4;
export const DRIP_PARAM_KEYS = effectParams('drips').map((d) => d.key);
/** Drops poured each frame while a finger pours. */
export const POURED_PER_FRAME = 6;

const DRIP_CONSTS = DRIP_PARAM_KEYS.map((key, i) => `const D_${key.toUpperCase()} = ${i}u;`).join('\n');

const DRIP_COMMON = /* wgsl */ `
struct DripKind {
  slots: vec4f,   // first slot, slot count, emission (0 flow, 1 pulse, 2 burst, 3 poured), burst generation
  emit: vec4f,    // sites (0: from a point), spare, spare, on
  params: array<vec4f, 5>,
  mods: array<vec4f, 40>,
  sites: array<vec4f, 48>,  // upper edges of a face: a, b, then its normal (xyz) and depth (w)
}
// pos.w radius (0: not in play); vel.w age, negative while waiting to be born;
// info: kind, seed, state (1 falling, 2 on a surface), life span; extra.x the burst seen.
struct Drip { pos: vec4f, vel: vec4f, info: vec4f, extra: vec4f }
@group(0) @binding(22) var<storage, read> dkinds: array<DripKind>;

${DRIP_CONSTS}

fn dparam(k: u32, i: u32) -> f32 {
  return modulated(dkinds[k].params[i / 4u][i % 4u], dkinds[k].mods[i * 2u], dkinds[k].mods[i * 2u + 1u]);
}

fn drip_radius(k: u32, seed: f32) -> f32 {
  return mix(0.012, 0.06, clamp(dparam(k, D_SIZE), 0.0, 1.0)) * (0.7 + 0.6 * fract(seed * 53.1));
}

// The paint color at full strength: its brightest channel is 1.
fn drip_color(k: u32, seed: f32) -> vec3f {
  let hue = dparam(k, D_HUE) / 360.0 + (fract(seed * 7.13) - 0.5) * dparam(k, D_VARIETY) * 0.6;
  return mix(vec3f(1.0), hue_rgb(hue), 0.9);
}
`;

export const SCENE3D_DRIPS_WGSL = /* wgsl */ `${SCENE3D_COMMON_WGSL}
${WORLD_COMMON}
${WORLD_SIM}
${DRIP_COMMON}

@group(0) @binding(21) var<storage, read_write> drips: array<Drip>;

fn drip_kind_of(i: u32) -> i32 {
  for (var k = 0u; k < u32(phys.drips.y); k++) {
    let s = dkinds[k].slots;
    if (f32(i) >= s.x && f32(i) < s.x + s.y) { return i32(k); }
  }
  return -1;
}

// A new drop of its kind: on the front face of a block just under one of its
// upper edges, or falling from the emitter.
fn drip_born(k: u32, i: u32, tick: u32) -> Drip {
  let h1 = hash1(i * 97u + tick * 13u + 1u);
  let h2 = hash1(i * 89u + tick * 7u + 2u);
  let h3 = hash1(i * 83u + tick * 5u + 3u);
  var d: Drip;
  let seed = hash1(i * 71u + tick * 11u + 5u) + 1e-4;
  let r = drip_radius(k, seed);
  let sites = u32(dkinds[k].emit.x);
  if (sites > 0u) {
    let at = min(u32(h1 * f32(sites)), sites - 1u);
    let a = dkinds[k].sites[at * 3u].xyz;
    let b = dkinds[k].sites[at * 3u + 1u].xyz;
    let n = dkinds[k].sites[at * 3u + 2u].xyz;
    // From a few spots along the edge, so the paint runs in rivulets; the
    // spots wander slowly.
    let spots = max(2.0, round(length(b - a) / 0.14));
    let wander = sin(frame.time * 0.13 + f32(at) * 2.1) * 0.3;
    let t = clamp((floor(h2 * spots) + 0.5 + wander + (h3 - 0.5) * 0.12) / spots, 0.02, 0.98);
    d.pos = vec4f(mix(a, b, t) + phys.down.xyz * r * 1.5 + n * r * 0.4, r);
    d.vel = vec4f(phys.down.xyz * 0.02, 0.0);
    d.info = vec4f(f32(k), seed, 2.0, 0.0);
  } else {
    let uv = vec2f(dparam(k, D_X) + (h1 * 2.0 - 1.0) * dparam(k, D_RADIUS), dparam(k, D_Y));
    let z = mix(r + 0.01, max(phys.bounds.z - r, r + 0.01), h2);
    d.pos = vec4f(unproject(uv, z), r);
    d.vel = vec4f(proj_across() * (h3 - 0.5) * 0.2 + phys.down.xyz * 0.3, 0.0);
    d.info = vec4f(f32(k), seed, 1.0, 0.0);
  }
  d.info.w = max(dparam(k, D_LIFETIME), 0.5) * (0.75 + 0.5 * h3);
  return d;
}

// One substep of a drop. Falling, it lands and mostly sticks. On a surface it
// runs down it, now slower now faster, follows it over edges, and falls off
// where the surface turns to face down.
fn drip_step(d: ptr<function, Drip>, k: u32, h: f32) {
  var p = (*d).pos.xyz;
  var v = (*d).vel.xyz;
  let r = (*d).pos.w;
  let seed = (*d).info.y;
  let g = gravity();
  if ((*d).info.z < 1.5) {
    v = (v + g * h) * (1.0 - 0.3 * h);
    p += v * h;
    let s = world_sdf(p) - r;
    if (s < 0.0) {
      let n = world_normal(p);
      p -= n * s;
      if (hash1(u32(seed * 9973.0) + u32((*d).vel.w * 600.0)) < 0.3 + 0.7 * dparam(k, D_STICK) || length(v) < 0.8) {
        (*d).info.z = 2.0;
        v = (v - n * dot(v, n)) * 0.15;
      } else {
        v = reflect(v, n) * 0.25;
      }
    }
  } else {
    let n = world_normal(p);
    if (dot(n, phys.down.xyz) > 0.55) {
      (*d).info.z = 1.0;
      v += n * 0.05;
    } else {
      let along = g - n * dot(g, n);
      // Runs and stops: each drop has its own stutter.
      let stutter = 0.5 + 0.5 * sin((*d).vel.w * (2.0 + 3.0 * fract(seed * 17.3)) + seed * 40.0);
      let mobility = mix(0.12, 0.012, clamp(dparam(k, D_VISCOSITY), 0.0, 1.0)) * (0.2 + 0.8 * stutter) * (0.6 + 0.8 * fract(seed * 29.7));
      v = mix(v, along * mobility, 1.0 - exp(-h * 6.0));
      p += v * h;
      // Back onto the surface, a film off it.
      let s = world_sdf(p);
      if (s > r * 4.0) {
        (*d).info.z = 1.0;
      } else {
        p -= world_normal(p) * (s - r * 0.4);
      }
    }
  }
  (*d).pos = vec4f(p, r);
  (*d).vel = vec4f(v, (*d).vel.w);
}

@compute @workgroup_size(64)
fn cs_drips(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (f32(i) >= phys.drips.x) { return; }
  var d = drips[i];
  let ki = drip_kind_of(i);
  if (ki < 0) { d.pos = AWAY; drips[i] = d; return; }
  let k = u32(ki);
  let slots = dkinds[k].slots;
  let on = dkinds[k].emit.w > 0.5;
  let emission = slots.z;
  let local = i - u32(slots.x);
  let dt = view.clock.x;
  let tick = u32(view.clock.y);
  if (d.info.y == 0.0) {
    d.pos = AWAY;
    d.vel = vec4f(0.0, 0.0, 0.0, -hash1(i * 31u + 5u) * min(max(dparam(k, D_LIFETIME), 1.0), 6.0) * 0.5);
    d.info = vec4f(f32(k), hash1(i * 7919u + 17u) + 1e-4, 0.0, 0.0);
    d.extra = vec4f(slots.w, 0.0, 0.0, 0.0);
  }
  let in_use = min(slots.y, max(dparam(k, D_AMOUNT), 0.0));
  if (emission > 2.5) {
    // Poured: a few slots a frame, round the pool, go to the fingers that pour.
    var pours = 0u;
    for (var p = 0u; p < u32(input.head.x); p++) { if (abs(input.pointers[p].a.w - 5.0) < 0.5) { pours++; } }
    let pool = u32(slots.y);
    let off = (local + pool - (tick * ${POURED_PER_FRAME}u) % pool) % pool;
    if (pours > 0u && off < ${POURED_PER_FRAME}u) {
      var want = off % pours;
      for (var p = 0u; p < u32(input.head.x); p++) {
        let ptr = input.pointers[p];
        if (abs(ptr.a.w - 5.0) > 0.5) { continue; }
        if (want > 0u) { want--; continue; }
        let seed = hash1(i * 37u + tick * 101u + 3u) + 1e-4;
        let r = drip_radius(k, seed);
        let toward = normalize(settings.proj_pos.xyz - ptr.a.xyz);
        let jitter = (vec2f(hash1(i * 13u + tick), hash1(i * 17u + tick * 3u)) - 0.5) * 0.12;
        // Onto whatever is under the finger: it runs down from there.
        d.pos = vec4f(ptr.a.xyz + toward * r * 0.4 + on_output(jitter), r);
        d.vel = vec4f(ptr.b.xyz * 0.3, 0.0);
        d.info = vec4f(f32(k), seed, 2.0, max(dparam(k, D_LIFETIME), 0.5));
        break;
      }
    }
  } else if (on && slots.w != d.extra.x) {
    if (f32(local) < max(in_use * 0.25, 1.0)) { d = drip_born(k, i, tick + u32(slots.w) * 977u); }
    d.extra.x = slots.w;
  }
  let seen = d.extra.x;
  if (d.pos.w > 0.0) {
    d.vel.w += dt;
    if (!on || d.vel.w > d.info.w || lost(d.pos.xyz)) {
      d.pos = AWAY;
      d.vel = vec4f(0.0, 0.0, 0.0, -0.05);
    } else {
      drip_step(&d, k, dt * 0.5);
      drip_step(&d, k, dt * 0.5);
    }
  } else if (on && emission < 1.5) {
    d.vel.w += dt;
    if (d.vel.w >= 0.0) {
      var hazard = 0.0;
      if (f32(local) < in_use) {
        let flow = clamp(dparam(k, D_FLOW), 0.0, 1.0);
        let life = max(dparam(k, D_LIFETIME), 0.5);
        if (emission < 0.5) {
          hazard = flow / (life * max(1.0 - flow, 0.02));
        } else {
          let period = max(dparam(k, D_PERIOD), 0.2);
          let open = fract(frame.time / period) * period < dparam(k, D_DURATION);
          hazard = select(0.0, 6.0 * flow / max(dparam(k, D_DURATION), 0.05), open);
        }
      }
      if (hash1(i * 613u + tick * 1031u + 7u) < 1.0 - exp(-hazard * dt)) {
        d = drip_born(k, i, tick);
      }
    }
  }
  d.extra.x = seen;
  drips[i] = d;
}
`;

export const SCENE3D_DRIPS_DRAW_WGSL = /* wgsl */ `${SCENE3D_RELIEF_WGSL}
${WORLD_COMMON}
${DRIP_COMMON}

struct Block { box: vec4f, info: vec4f, o: vec4f, u: vec4f, v: vec4f, n: vec4f, pts: array<vec4f, 32> }
@group(0) @binding(16) var<storage, read> blocks: array<Block>;
@group(0) @binding(21) var<storage, read> drips: array<Drip>;

struct DripOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) index: u32,
}
struct DripFrag { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }

@vertex
fn vs_drip(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DripOut {
  let d = drips[ii];
  var out: DripOut;
  out.index = ii;
  if (d.pos.w <= 0.0) { out.clip = OFFSCREEN; return out; }
  let c = corner(vi);
  let to_cam = normalize(view.cam_pos.xyz - d.pos.xyz);
  let world = d.pos.xyz + to_cam * d.pos.w + (view.cam_right.xyz * c.x + view.cam_up.xyz * c.y) * d.pos.w * 1.5;
  out.clip = view.view_proj * vec4f(world, 1.0);
  out.world = world;
  return out;
}

// A drop of paint: a glossy sphere. Depth 2 when the ray misses it.
fn drip_shade(in: DripOut) -> DripFrag {
  let d = drips[in.index];
  let o = view.cam_pos.xyz;
  let dir = normalize(in.world - o);
  let oc = o - d.pos.xyz;
  let bq = dot(oc, dir);
  let disc = bq * bq - (dot(oc, oc) - d.pos.w * d.pos.w);
  var out: DripFrag;
  if (disc < 0.0) { out.depth = 2.0; return out; }
  let hit = o + dir * (-bq - sqrt(disc));
  let n = normalize(hit - d.pos.xyz);
  let k = u32(d.info.x);
  var m: Material;
  m.base = drip_color(k, d.info.y) * 0.8;
  m.metal = 0.0;
  m.rough = mix(0.45, 0.04, clamp(dparam(k, D_GLOSS), 0.0, 1.0));
  m.emissive = max(dparam(k, D_GLOW), 0.0) * 3.0;
  m.opacity = 1.0;
  m.catcher = 0.0;
  out.color = vec4f(fogged(lighting(m, hit, n, -dir) + fire_lighting(m, hit, n, -dir), hit), 1.0);
  let clip = view.view_proj * vec4f(hit, 1.0);
  out.depth = clip.z / clip.w;
  return out;
}

@fragment
fn fs_drip(in: DripOut) -> DripFrag {
  let f = drip_shade(in);
  if (f.depth > 1.5) { discard; }
  return f;
}

@fragment
fn fs_drip_relief(in: DripOut) -> DripFrag {
  var f = drip_shade(in);
  if (f.depth > 1.5) { discard; }
  f.color = vec4f(f.color.rgb + thrown_light(drips[in.index].pos.xyz).rgb * settings.post_b.z * 0.3, 1.0);
  return f;
}

// ── Liquid paint ─────────────────────────────────────────────────────────
// The drops are not drawn one by one: each adds a soft blob to a field on the
// screen, stretched along its motion, and the field is drawn as one surface.
// Neighbors flow together into runs, sheets and pools; a lone drop stays a bead.

// How far a drop's blob reaches, in drop radii, and the field level its surface sits at.
const LIQUID_REACH = 3.2;
const LIQUID_EDGE = vec2f(0.45, 0.78);

struct LiquidOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) index: u32,
}

@vertex
fn vs_liquid(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LiquidOut {
  let d = drips[ii];
  var out: LiquidOut;
  out.index = ii;
  if (d.pos.w <= 0.0) { out.clip = OFFSCREEN; return out; }
  let c = corner(vi);
  // Its motion across the screen: a fast drop stretches into a run.
  let across = vec2f(dot(d.vel.xyz, view.cam_right.xyz), dot(d.vel.xyz, view.cam_up.xyz));
  let speed = length(across);
  let axis = select(vec2f(0.0, 1.0), across / max(speed, 1e-5), speed > 1e-4);
  let side = vec2f(-axis.y, axis.x);
  let stretch = 1.0 + min(2.5, speed * 5.0);
  let q = (axis * c.y * stretch + side * c.x) * d.pos.w * LIQUID_REACH;
  let world = d.pos.xyz + view.cam_right.xyz * q.x + view.cam_up.xyz * q.y;
  out.clip = view.view_proj * vec4f(world, 1.0);
  out.uv = c;
  return out;
}

// A metaball falloff: flat enough at the middle that neighbors add up into one shape.
fn liquid_weight(uv: vec2f) -> f32 {
  let r2 = dot(uv, uv);
  if (r2 > 1.0) { return 0.0; }
  let k = 1.0 - r2;
  return k * k;
}

// Field: the paint's color and how much paint, added up (rgb * w, w).
@fragment
fn fs_liquid_field(in: LiquidOut) -> @location(0) vec4f {
  let d = drips[in.index];
  let w = liquid_weight(in.uv);
  if (w <= 0.0) { discard; }
  return vec4f(drip_color(u32(d.info.x), d.info.y) * w, w);
}

// Where: the paint's position, bulging toward the camera at a blob's middle,
// and its gloss, added up the same way (xyz * w, gloss * w).
@fragment
fn fs_liquid_where(in: LiquidOut) -> @location(0) vec4f {
  let d = drips[in.index];
  let w = liquid_weight(in.uv);
  if (w <= 0.0) { discard; }
  let to_cam = normalize(view.cam_pos.xyz - d.pos.xyz);
  let bulge = sqrt(max(0.0, 1.0 - dot(in.uv, in.uv))) * d.pos.w;
  let gloss = clamp(dparam(u32(d.info.x), D_GLOSS), 0.0, 1.0);
  return vec4f((d.pos.xyz + to_cam * bulge) * w, gloss * w);
}

@group(0) @binding(28) var liquid_field: texture_2d<f32>;
@group(0) @binding(29) var liquid_where: texture_2d<f32>;

fn liquid_at(p: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(liquid_field));
  return textureLoad(liquid_field, clamp(p, vec2i(0), size - 1), 0);
}

// The field blurred across, then down, so the blobs of a run melt into one
// smooth body before its surface is found.
fn liquid_blur(clip: vec4f, step: vec2i) -> vec4f {
  let p = vec2i(clip.xy);
  var sum = liquid_at(p) * 0.2;
  let w = array<f32, 4>(0.17, 0.12, 0.07, 0.03);
  for (var i = 1; i <= 4; i++) {
    sum += (liquid_at(p + step * i * 2) + liquid_at(p - step * i * 2)) * w[i - 1];
  }
  return sum / (0.2 + 2.0 * (0.17 + 0.12 + 0.07 + 0.03));
}

@fragment
fn fs_liquid_blur_x(in: FullOut) -> @location(0) vec4f { return liquid_blur(in.clip, vec2i(1, 0)); }

@fragment
fn fs_liquid_blur_y(in: FullOut) -> @location(0) vec4f { return liquid_blur(in.clip, vec2i(0, 1)); }

// The surface: where the field is deep enough there is paint; its slope tilts
// the surface, so runs are round and pools flatten out; it is lit like the drops.
fn liquid_shade(clip: vec4f) -> DripFrag {
  var out: DripFrag;
  let p = vec2i(clip.xy);
  let f = liquid_at(p);
  let w = f.a;
  if (w < LIQUID_EDGE.x) { out.depth = 2.0; return out; }
  let cover = smoothstep(LIQUID_EDGE.x, LIQUID_EDGE.y, w);
  let e = 5;
  let gx = liquid_at(p + vec2i(e, 0)).a - liquid_at(p - vec2i(e, 0)).a;
  let gy = liquid_at(p + vec2i(0, e)).a - liquid_at(p - vec2i(0, e)).a;
  let where_ = textureLoad(liquid_where, p, 0);
  let hit = where_.xyz / w;
  let gloss = clamp(where_.w / w, 0.0, 1.0);
  let to_cam = normalize(view.cam_pos.xyz - hit);
  // Screen y runs down. The surface curves at its edges and lies flat over a
  // deep pool, so a run of drops reads as one body of paint, not a row of beads.
  let flat_ = 1.0 - smoothstep(LIQUID_EDGE.y, LIQUID_EDGE.y * 2.6, w);
  let tilt = vec2f(-gx, gy) * (1.4 / (1.0 + w)) * (0.25 + 0.75 * flat_);
  let n = normalize(view.cam_right.xyz * tilt.x + view.cam_up.xyz * tilt.y + to_cam * 0.55);
  var m: Material;
  m.base = (f.rgb / w) * 0.8;
  m.metal = 0.0;
  m.rough = mix(0.45, 0.04, gloss);
  m.emissive = max(dparam(0u, D_GLOW), 0.0) * 3.0;
  m.opacity = 1.0;
  m.catcher = 0.0;
  let col = fogged(lighting(m, hit, n, to_cam) + fire_lighting(m, hit, n, to_cam), hit);
  out.color = vec4f(col * cover, cover);
  let c = view.view_proj * vec4f(hit, 1.0);
  out.depth = clamp(c.z / c.w, 0.0, 1.0);
  return out;
}

@fragment
fn fs_liquid(in: FullOut) -> DripFrag {
  let f = liquid_shade(in.clip);
  if (f.depth > 1.5) { discard; }
  return f;
}

@fragment
fn fs_liquid_relief(in: FullOut) -> DripFrag {
  var f = liquid_shade(in.clip);
  if (f.depth > 1.5) { discard; }
  let w = liquid_at(vec2i(in.clip.xy)).a;
  let hit = textureLoad(liquid_where, vec2i(in.clip.xy), 0).xyz / max(w, 1e-4);
  f.color = vec4f(f.color.rgb + thrown_light(hit).rgb * settings.post_b.z * 0.3 * f.color.a, f.color.a);
  return f;
}

// The wet map: two face-on pictures of the paint on the world. The stain
// (premultiplied, its strongest channel how much paint) fades over
// phys.drips.z seconds, the gloss (red: how wet) over phys.drips.w. Each
// frame both fade, then every drop on a surface paints itself into both.

struct FullOut { @builtin(position) clip: vec4f }

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> FullOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: FullOut;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

// Drawn with premultiplied blending, so what is there keeps 1 - a of itself.
@fragment
fn fs_fade_stain(in: FullOut) -> @location(0) vec4f {
  return vec4f(0.0, 0.0, 0.0, 1.0 - exp(-view.clock.x / max(phys.drips.z, 0.1)));
}

@fragment
fn fs_fade_gloss(in: FullOut) -> @location(0) vec4f {
  return vec4f(0.0, 0.0, 0.0, 1.0 - exp(-view.clock.x / max(phys.drips.w, 0.1)));
}

struct SplatOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

fn block_corner(bi: u32, i: u32) -> vec2f {
  let v = blocks[bi].pts[i / 2u];
  return select(v.xy, v.zw, (i & 1u) == 1u);
}

// Whether a face between the projector and a drop hides it. A hidden drop
// paints nothing, or its trail would show on the front of that face.
fn hidden(p: vec3f) -> bool {
  let eye = settings.proj_pos.xyz;
  for (var b = 0u; b < u32(phys.counts.z); b++) {
    let face_n = blocks[b].n.xyz;
    let o = blocks[b].o.xyz;
    if (dot(p - o, face_n) > -0.03) { continue; }   // the drop is not behind it
    let ray = p - eye;
    let into = dot(ray, face_n);
    if (into > -1e-6) { continue; }                 // the projector sees it from behind
    let hit = eye + ray * (dot(o - eye, face_n) / into) - o;
    let q = vec2f(dot(hit, blocks[b].u.xyz), dot(hit, blocks[b].v.xyz));
    let box = blocks[b].box;
    if (any(q < box.xy) || any(q > box.zw)) { continue; }
    let n = u32(blocks[b].info.y);
    var inside = false;
    var j = n - 1u;
    for (var i = 0u; i < n; i++) {
      let a = block_corner(b, i);
      let c = block_corner(b, j);
      if (((a.y > q.y) != (c.y > q.y)) && (q.x < (c.x - a.x) * (q.y - a.y) / (c.y - a.y) + a.x)) { inside = !inside; }
      j = i;
    }
    if (inside) { return true; }
  }
  return false;
}

@vertex
fn vs_splat(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SplatOut {
  let d = drips[ii];
  var out: SplatOut;
  if (d.pos.w <= 0.0 || d.info.z < 1.5 || hidden(d.pos.xyz)) { out.clip = OFFSCREEN; return out; }
  let c = corner(vi);
  let uv = proj_uv(d.pos.xyz);
  let middle = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let t = max(proj_depth(d.pos.xyz), 1e-3);
  let size = vec2f(d.pos.w / (t * length(settings.proj_right.xyz)), d.pos.w / (t * length(settings.proj_up.xyz))) * 1.6;
  out.clip = vec4f(middle + c * size, 0.0, 1.0);
  out.uv = c;
  out.color = drip_color(u32(d.info.x), d.info.y);
  return out;
}

// A drop's mark per frame at 60 fps, the same per second at any frame rate:
// (1 - a)^(frames) is what is left of the old picture after a second.
fn splat_alpha(a: f32) -> f32 {
  return 1.0 - pow(1.0 - a, clamp(view.clock.x * 60.0, 0.0, 2.0));
}

@fragment
fn fs_splat_stain(in: SplatOut) -> @location(0) vec4f {
  let a = splat_alpha(smoothstep(1.0, 0.3, length(in.uv)) * 0.12);
  return vec4f(in.color * a, a);
}

// Gloss eases toward 1 under a drop (alpha blend) instead of adding up: added,
// a pool of drops passed the half float's 65504 and left Inf and NaN behind
// that never dried. The surface shader reads it clamped to 0..1 anyway.
@fragment
fn fs_splat_gloss(in: SplatOut) -> @location(0) vec4f {
  let a = splat_alpha(smoothstep(1.0, 0.3, length(in.uv)) * 0.3);
  return vec4f(a, 0.0, 0.0, a);
}
`;

// ── Fire and smoke ──────────────────────────────────────────────────────

/** Floats per flame particle: position + size, velocity + age, kind / seed / type / span, burst seen. */
export const FLAME_FLOATS = 16;
/** Floats per flame kind: the same layout as a drop kind. */
export const FLAME_KIND_FLOATS = DRIP_KIND_FLOATS;
export const FLAME_PARAM_KEYS = effectParams('flames').map((d) => d.key);
/** Flame particles lit each frame at each burning spot. */
export const IGNITED_PER_FRAME = 6;
/** Head and 8 lights of two vec4: position + power, color + flicker seed. */
export const FIRE_LIGHT_FLOATS = 4 + 8 * 8;

const FLAME_CONSTS = FLAME_PARAM_KEYS.map((key, i) => `const F_${key.toUpperCase()} = ${i}u;`).join('\n');

const FLAME_COMMON = /* wgsl */ `
struct FlameKind {
  slots: vec4f,   // first slot, slot count, emission (0 flow, 1 pulse, 2 burst, 3 ignited), burst generation
  emit: vec4f,    // sites (0: from a point), spare, spare, on
  params: array<vec4f, 5>,
  mods: array<vec4f, 40>,
  sites: array<vec4f, 48>,  // upper edges of a face: a, b, then its normal (xyz) and depth (w)
}
// pos.w size (0: not in play); vel.w age, negative while waiting to be born;
// info: kind, seed, type (1 flame, 2 ember), life span; extra.x the burst seen.
struct Flame { pos: vec4f, vel: vec4f, info: vec4f, extra: vec4f }
@group(0) @binding(25) var<storage, read> fkinds: array<FlameKind>;

${FLAME_CONSTS}

fn fparam(k: u32, i: u32) -> f32 {
  return modulated(fkinds[k].params[i / 4u][i % 4u], fkinds[k].mods[i * 2u], fkinds[k].mods[i * 2u + 1u]);
}
`;

export const SCENE3D_FLAMES_WGSL = /* wgsl */ `${SCENE3D_COMMON_WGSL}
${WORLD_COMMON}
${WORLD_SIM}
${FLAME_COMMON}

@group(0) @binding(24) var<storage, read_write> flames: array<Flame>;

fn flame_kind_of(i: u32) -> i32 {
  for (var k = 0u; k < u32(phys.fire.y); k++) {
    let s = fkinds[k].slots;
    if (f32(i) >= s.x && f32(i) < s.x + s.y) { return i32(k); }
  }
  return -1;
}

// A new particle at a point: a flame, or now and then an ember.
fn flame_at(k: u32, i: u32, tick: u32, at: vec3f) -> Flame {
  let h3 = hash1(i * 83u + tick * 5u + 3u);
  let h4 = hash1(i * 79u + tick * 3u + 4u);
  let h5 = hash1(i * 67u + tick * 17u + 6u);
  // Its own hash for the second sideways direction: h4 also picks embers,
  // which sent every ember the same way.
  let h6 = hash1(i * 59u + tick * 23u + 8u);
  var f: Flame;
  let seed = hash1(i * 71u + tick * 11u + 5u) + 1e-4;
  let life = max(fparam(k, F_LIFETIME), 0.1);
  // Up is against gravity (a room's down need not be -Y); on the wall these
  // are x, y and z as before.
  let up = -phys.down.xyz;
  var side = cross(up, vec3f(0.0, 0.0, 1.0));
  if (dot(side, side) < 1e-4) { side = cross(up, vec3f(1.0, 0.0, 0.0)); }
  side = normalize(side);
  let depth = cross(side, up);
  if (h4 < clamp(fparam(k, F_EMBERS), 0.0, 1.0) * 0.12) {
    f.pos = vec4f(at, 0.012 + 0.01 * h5);
    f.vel = vec4f(side * (h3 - 0.5) * 2.0 + up * (1.8 + 2.5 * h5) + depth * (h6 - 0.5) * 1.0, 0.0);
    f.info = vec4f(f32(k), seed, 2.0, life * (1.5 + h3));
  } else {
    f.pos = vec4f(at, mix(0.05, 0.35, clamp(fparam(k, F_SIZE), 0.0, 1.0)) * (0.6 + 0.6 * h5));
    f.vel = vec4f(side * (h3 - 0.5) * 0.3 + up * (0.2 + 0.3 * h5) + depth * (h4 - 0.5) * 0.2, 0.0);
    f.info = vec4f(f32(k), seed, 1.0, life * (0.6 + 0.6 * h3));
  }
  return f;
}

// A new particle of its kind: on top of a block along one of its upper
// edges, or at the emitter.
fn flame_born(k: u32, i: u32, tick: u32) -> Flame {
  let h1 = hash1(i * 97u + tick * 13u + 1u);
  let h2 = hash1(i * 89u + tick * 7u + 2u);
  let h3 = hash1(i * 61u + tick * 19u + 9u);
  let sites = u32(fkinds[k].emit.x);
  var at: vec3f;
  if (sites > 0u) {
    let n = min(u32(h1 * f32(sites)), sites - 1u);
    let a = fkinds[k].sites[n * 3u].xyz;
    let b = fkinds[k].sites[n * 3u + 1u].xyz;
    let face = fkinds[k].sites[n * 3u + 2u];
    // Along the edge, and back from the face across the top of its solid.
    // Never in front of the face, even on a block thinner than 5 cm.
    let back = max(face.w - mix(0.04, max(face.w - 0.04, 0.05), h3), 0.0);
    at = mix(a, b, h2) - phys.down.xyz * 0.02 - face.xyz * back;
  } else {
    let uv = vec2f(fparam(k, F_X) + (h1 * 2.0 - 1.0) * fparam(k, F_RADIUS), fparam(k, F_Y));
    at = unproject(uv, mix(0.05, max(phys.bounds.z * 0.8, 0.1), h2));
  }
  return flame_at(k, i, tick, at);
}

fn curl(p: vec3f) -> vec3f {
  return vec3f(
    sin(p.y * 1.3 + p.z) - cos(p.z * 1.7 - p.x),
    sin(p.z * 1.1 + p.x) - cos(p.x * 1.5 + p.y) * 0.5,
    sin(p.x * 1.2 - p.y) - cos(p.y * 1.4 + p.z));
}

@compute @workgroup_size(64)
fn cs_flames(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (f32(i) >= phys.fire.x) { return; }
  var f = flames[i];
  let ki = flame_kind_of(i);
  if (ki < 0) { f.pos = AWAY; flames[i] = f; return; }
  let k = u32(ki);
  let slots = fkinds[k].slots;
  let on = fkinds[k].emit.w > 0.5;
  let emission = slots.z;
  let local = i - u32(slots.x);
  let dt = view.clock.x;
  let tick = u32(view.clock.y);
  if (f.info.y == 0.0) {
    f.pos = AWAY;
    f.vel = vec4f(0.0, 0.0, 0.0, -hash1(i * 31u + 5u) * max(fparam(k, F_LIFETIME), 0.1));
    f.info = vec4f(f32(k), hash1(i * 7919u + 17u) + 1e-4, 0.0, 0.0);
    f.extra = vec4f(slots.w, 0.0, 0.0, 0.0);
  }
  let in_use = min(slots.y, max(fparam(k, F_AMOUNT), 0.0));
  if (emission > 2.5) {
    // Ignited: a few slots a frame, round the pool, go to the burning spots.
    var fires = 0u;
    for (var p = 0u; p < u32(input.head.x); p++) { if (abs(input.pointers[p].a.w - 6.0) < 0.5) { fires++; } }
    let pool = u32(slots.y);
    let off = (local + pool - (tick * ${IGNITED_PER_FRAME}u) % pool) % pool;
    if (fires > 0u && off < ${IGNITED_PER_FRAME}u) {
      var want = off % fires;
      for (var p = 0u; p < u32(input.head.x); p++) {
        let ptr = input.pointers[p];
        if (abs(ptr.a.w - 6.0) > 0.5) { continue; }
        if (want > 0u) { want--; continue; }
        // A spot dying down lights fewer.
        if (hash1(i * 29u + tick * 7u) > ptr.b.w) { break; }
        let toward = normalize(settings.proj_pos.xyz - ptr.a.xyz);
        let jitter = (vec2f(hash1(i * 13u + tick), hash1(i * 17u + tick * 3u)) - 0.5) * 0.16;
        f = flame_at(k, i, tick, ptr.a.xyz + toward * 0.04 + on_output(jitter));
        break;
      }
    }
  } else if (on && slots.w != f.extra.x) {
    if (f32(local) < max(in_use * 0.3, 1.0)) { f = flame_born(k, i, tick + u32(slots.w) * 977u); }
    f.extra.x = slots.w;
  }
  let seen = f.extra.x;
  if (f.pos.w > 0.0) {
    f.vel.w += dt;
    let gone = lost(f.pos.xyz) || (phys.room.x < 0.5 && f.pos.y > -phys.kill.x);
    if (f.vel.w > f.info.w || gone) {
      f.pos = AWAY;
      f.vel = vec4f(0.0, 0.0, 0.0, -0.02);
    } else {
      var p = f.pos.xyz;
      var v = f.vel.xyz;
      if (f.info.z < 1.5) {
        // A flame rises while it is hot, curls, and slows; it slides round what it meets.
        let t = f.vel.w / f.info.w;
        let up = -phys.down.xyz;
        // The curl noise scrolls down past the flame as it rises.
        let q = p * 1.6 - up * frame.time * 1.2 + vec3f(0.0, 0.0, frame.time * 0.3) + f.info.y * 10.0;
        let lift = max(fparam(k, F_HEAT), 0.0) * 2.4 * (1.0 - t) + 0.4;
        v += (up * lift + curl(q) * max(fparam(k, F_TURBULENCE), 0.0) * 1.1) * dt;
        // Sideways motion dies fast, so the fire rises as a column.
        let rise = up * dot(v, up);
        v = rise * exp(-dt * 2.6) + (v - rise) * exp(-dt * 4.5);
        p += v * dt;
        let s = world_sdf(p) - f.pos.w * 0.25;
        if (s < 0.0) {
          let n = world_normal(p);
          p -= n * s;
          let vn = dot(v, n);
          if (vn < 0.0) { v -= n * vn; }
        }
      } else {
        // An ember: thrown up, falls, bounces.
        v += gravity() * dt;
        v *= exp(-dt * 0.3);
        p += v * dt;
        let s = world_sdf(p) - f.pos.w;
        if (s < 0.0) {
          let n = world_normal(p);
          p -= n * s;
          let vn = dot(v, n);
          if (vn < 0.0) { v = (v - n * vn) * 0.7 - n * vn * 0.4; }
        }
      }
      f.pos = vec4f(p, f.pos.w);
      f.vel = vec4f(v, f.vel.w);
    }
  } else if (on && emission < 1.5) {
    f.vel.w += dt;
    if (f.vel.w >= 0.0) {
      var hazard = 0.0;
      if (f32(local) < in_use) {
        let flow = clamp(fparam(k, F_FLOW), 0.0, 1.0);
        let life = max(fparam(k, F_LIFETIME), 0.1);
        if (emission < 0.5) {
          hazard = flow / (life * max(1.0 - flow, 0.02));
        } else {
          let period = max(fparam(k, F_PERIOD), 0.2);
          let open = fract(frame.time / period) * period < fparam(k, F_DURATION);
          hazard = select(0.0, 6.0 * flow / max(fparam(k, F_DURATION), 0.05), open);
        }
      }
      if (hash1(i * 613u + tick * 1031u + 7u) < 1.0 - exp(-hazard * dt)) {
        f = flame_born(k, i, tick);
      }
    }
  }
  f.extra.x = seen;
  flames[i] = f;
}
`;

export const SCENE3D_FLAMES_DRAW_WGSL = /* wgsl */ `${SCENE3D_WORLD_WGSL}
${WORLD_COMMON}
${FLAME_COMMON}

@group(0) @binding(24) var<storage, read> flames: array<Flame>;

struct FlameOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
}

// The flame's color as it cools: white-yellow at its root, its own color,
// then red. Brighter than white, so it blooms.
fn flame_color(k: u32, t: f32) -> vec3f {
  let own = mix(vec3f(1.0), hue_rgb(fparam(k, F_HUE) / 360.0), 0.9) * vec3f(1.0, 0.75, 0.5);
  let hot = mix(vec3f(1.0, 0.9, 0.65), own, smoothstep(0.0, 0.35, t));
  return mix(hot, vec3f(0.9, 0.12, 0.02), smoothstep(0.35, 0.7, t));
}

// A quad facing the camera, stretched along the way it moves: a tongue of
// flame, a streak of ember.
fn sprite(f: Flame, vi: u32, size: f32, stretch: f32) -> vec4f {
  let c = corner(vi);
  let v = f.vel.xyz;
  let along = v - dot(v, normalize(view.cam_pos.xyz - f.pos.xyz)) * normalize(view.cam_pos.xyz - f.pos.xyz);
  let speed = length(along);
  var up = view.cam_up.xyz;
  if (speed > 1e-3) { up = along / speed; }
  let side = normalize(cross(up, normalize(view.cam_pos.xyz - f.pos.xyz)));
  let world = f.pos.xyz + side * c.x * size + up * c.y * size * (1.0 + speed * stretch);
  return view.view_proj * vec4f(world, 1.0);
}

// Additive: flames while they are hot, and embers.
@vertex
fn vs_fire(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FlameOut {
  let f = flames[ii];
  var out: FlameOut;
  if (f.pos.w <= 0.0) { out.clip = OFFSCREEN; return out; }
  let k = u32(f.info.x);
  let t = clamp(f.vel.w / max(f.info.w, 1e-3), 0.0, 1.0);
  out.uv = corner(vi);
  if (f.info.z > 1.5) {
    out.clip = sprite(f, vi, f.pos.w * 1.5, 1.5);
    out.color = vec4f(vec3f(1.0, 0.45, 0.1) * 4.0 * (1.0 - t), 1.0);
    return out;
  }
  out.clip = sprite(f, vi, f.pos.w * (0.35 + 0.5 * t), 1.2);
  let strength = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.3, 0.75, t));
  out.color = vec4f(flame_color(k, t) * strength * 0.12, 1.0);
  return out;
}

@fragment
fn fs_fire(in: FlameOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  return vec4f(in.color.rgb * (1.0 - r2) * (1.0 - r2), 0.0);
}

// Premultiplied: smoke, from flames as they cool, wider as it rises.
@vertex
fn vs_smoke(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FlameOut {
  let f = flames[ii];
  var out: FlameOut;
  if (f.pos.w <= 0.0 || f.info.z > 1.5) { out.clip = OFFSCREEN; return out; }
  let k = u32(f.info.x);
  let t = clamp(f.vel.w / max(f.info.w, 1e-3), 0.0, 1.0);
  out.uv = corner(vi);
  out.clip = sprite(f, vi, f.pos.w * (1.0 + 2.2 * t), 0.0);
  let a = clamp(fparam(k, F_SMOKE), 0.0, 1.0) * smoothstep(0.3, 0.65, t) * (1.0 - t) * 0.6;
  let lit = 0.04 + 0.05 * view.light.w;
  out.color = vec4f(vec3f(lit) * a, a);
  return out;
}

@fragment
fn fs_smoke(in: FlameOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  return in.color * (1.0 - r2);
}
`;

export const SCENE3D_WORLD_SHADERS: { id: string; stage: 'compute' | 'render'; entry: string; source: string }[] = [
  { id: 'scene3d/balls', stage: 'compute', entry: 'cs_balls_step', source: SCENE3D_BALLS_WGSL },
  { id: 'scene3d/balls-draw', stage: 'render', entry: 'fs_ball', source: SCENE3D_BALLS_DRAW_WGSL },
  { id: 'scene3d/drips', stage: 'compute', entry: 'cs_drips', source: SCENE3D_DRIPS_WGSL },
  { id: 'scene3d/drips-draw', stage: 'render', entry: 'fs_drip', source: SCENE3D_DRIPS_DRAW_WGSL },
  { id: 'scene3d/flames', stage: 'compute', entry: 'cs_flames', source: SCENE3D_FLAMES_WGSL },
  { id: 'scene3d/flames-draw', stage: 'render', entry: 'fs_fire', source: SCENE3D_FLAMES_DRAW_WGSL },
];

/** Commands that compile the world's shaders ahead of the first frame. */
export const scene3dWorldPrecompileCommands = () =>
  SCENE3D_WORLD_SHADERS.map((s) => ({ type: 'precompile_shader' as const, shader_id: s.id, stage: s.stage, entry: s.entry, source: s.source }));
