// Strands: each hit launches a shape; fibres of particles stream off it,
// pushed out along the normal by the spectrum read at their place on the
// shape, bent by the waveform and frayed by curl noise. Drawn as thin
// additive streaks into the HDR accumulation (hdr_post.rs does the rest).

struct StrandShape {
  a: vec4<f32>, // kind, sides, count, seed
  b: vec4<f32>, // centre xy, size xy
  c: vec4<f32>, // rotation, emission, strength, age
  d: vec4<f32>, // band, life scale, speed scale, spread
}

struct StrandsU {
  res: vec4<f32>,      // width, height, aspect, particle count
  clock: vec4<f32>,    // time, dt, frame, total emission
  motion: vec4<f32>,   // speed, fray, drag, displacement
  look: vec4<f32>,     // streak seconds, width px, brightness, lifetime
  fibre: vec4<f32>,    // fibres, jitter, cooling, waveform mix
  audio: vec4<f32>,    // level, bass env, mid env, high env
  core: vec4<f32>,     // rgb, intensity
  mid: vec4<f32>,
  fringe: vec4<f32>,
  shape_count: vec4<f32>,
  view: vec4<f32>,     // cos, sin of the picture's turn, zoom, width variation
  pan: vec4<f32>,      // offset xy, curl scale, trail segments drawn
  shapes: array<StrandShape, 8>,
}

const TRAIL_POINTS: u32 = 8u;
/// Frames between trail samples.
const TRAIL_STEP: u32 = 2u;

struct Particle {
  p: vec4<f32>, // pos xy, vel xy
  q: vec4<f32>, // age, life, heat, shape
  r: vec4<f32>, // spectral, side, birth level, 0
  col: vec4<f32>, // this frame's colour (rgb), w = 1 while alive
  // Where the particle was, one sample every TRAIL_STEP frames; the newest
  // is at (frame / TRAIL_STEP) % TRAIL_POINTS.
  trail: array<vec2<f32>, 8>,
}

fn trail_head(frame: u32) -> u32 {
  return (frame / TRAIL_STEP) % TRAIL_POINTS;
}

fn palette(t: f32) -> vec3<f32> {
  // Mostly fringe; the mid tone is a thin band on the way to the core.
  let s1 = smoothstep(0.55, 0.85, t);
  let s2 = smoothstep(1.0, 1.5, t);
  var col = mix(U.fringe.rgb * U.fringe.w, U.mid.rgb * U.mid.w, s1);
  col = mix(col, U.core.rgb * U.core.w, s2);
  return col * smoothstep(0.0, 0.12, t);
}

fn particle_color(pt: Particle) -> vec4<f32> {
  if (pt.q.x >= pt.q.y || pt.q.y <= 0.0) {
    return vec4<f32>(0.0);
  }
  let t = pt.q.x / pt.q.y;
  let fade = smoothstep(0.0, 0.06, t) * pow(1.0 - t, 1.6);
  let heat = pt.q.z * exp(-pt.q.x * U.fibre.z);
  return vec4<f32>(palette(heat) * fade * U.look.z, 1.0);
}

