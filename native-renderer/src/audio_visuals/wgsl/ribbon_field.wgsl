// Ribbon Field: each ribbon's head follows a 3D curl flow; every real frame
// it writes its position, width, side vector and heat into a ring of the last
// N points, and the ribbon is drawn as one continuous lit strip through that
// ring (ribbons.rs has the CPU side).

struct RibbonU {
  view_proj: mat4x4<f32>,
  eye: vec4<f32>,     // camera xyz, fog
  res: vec4<f32>,     // width, height, aspect, ribbon count
  clock: vec4<f32>,   // time, dt, ring head, ring length
  shape: vec4<f32>,   // filled points, width, kink, twist
  motion: vec4<f32>,  // speed, flow scale, flow speed, half length of the river
  level: vec4<f32>,   // bass, mid, high, level
  env: vec4<f32>,     // onset envelopes bass, mid, high; sheen
  kink: vec4<f32>,    // this frame's kink impulse per band; w = real steps so far
  spin: vec4<f32>,    // twist spin per band; w = width variation
  seq: vec4<f32>,     // the hit seq per band (seeds the kink direction); w = drive level
  core: vec4<f32>,    // sheen colour, intensity
  front: vec4<f32>,
  back: vec4<f32>,
}

struct Head {
  p: vec4<f32>, // position, the step it (re)entered
  v: vec4<f32>, // velocity, 1 once placed
  w: vec4<f32>, // side vector, band
  k: vec4<f32>, // kink velocity still to be spent, 0
}

struct TrailPoint {
  a: vec4<f32>, // position, half width
  b: vec4<f32>, // side vector, heat
}

fn rib_band(i: u32) -> u32 {
  let h = hash11(i * 7919u + 3u);
  if (h < 0.45) {
    return 0u;
  }
  if (h < 0.75) {
    return 1u;
  }
  return 2u;
}

fn rand_unit(seed: u32) -> vec3<f32> {
  let z = hash11(seed) * 2.0 - 1.0;
  let a = hash11(seed ^ 0x68bc21ebu) * 6.28318530718;
  let r = sqrt(max(1.0 - z * z, 0.0));
  return vec3<f32>(r * cos(a), z, r * sin(a));
}

fn safe_normalize(v: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let l = length(v);
  if (l < 1e-6) {
    return fallback;
  }
  return v / l;
}
