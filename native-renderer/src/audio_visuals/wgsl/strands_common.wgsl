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
  shapes: array<StrandShape, 8>,
}

struct Particle {
  p: vec4<f32>, // pos xy, vel xy
  q: vec4<f32>, // age, life, heat, shape
  r: vec4<f32>, // spectral, side, birth level, 0
}

