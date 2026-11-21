// Shockwave Rings (shockwave.rs has the CPU side). Positions are in picture
// heights: y in -1..1 bottom to top, x in -aspect..aspect.

struct ShockRing {
  a: vec4<f32>, // centre xy, radius, width
  b: vec4<f32>, // intensity, band, front speed, seed
}

struct ShockU {
  res: vec4<f32>,   // width, height, aspect, particles per ring
  clock: vec4<f32>, // time, live rings, level, drive level
  look: vec4<f32>,  // brightness, dust glow, streak seconds, chroma
  field: vec4<f32>, // dust push, refraction, dust columns, dust rows
  shape: vec4<f32>, // particle px, size variation, shell share, high level
  view: View2,
  core: vec4<f32>,
  mid: vec4<f32>,
  fringe: vec4<f32>,
  rings: array<ShockRing, 16>,
}

// How far a front reaches either side of itself (picture heights).
fn shock_reach(ring: ShockRing) -> f32 {
  return ring.a.w * 2.0 + 0.05;
}

// Signed distance from the front in units of its reach (+ = ahead of it).
fn shock_d(p: vec2<f32>, ring: ShockRing) -> vec3<f32> {
  let rel = p - ring.a.xy;
  let r = length(rel);
  let dir = rel / max(r, 1e-4);
  return vec3<f32>(dir, (r - ring.a.z) / shock_reach(ring));
}

// A ring as the camera shows it (centre through the view, radius zoomed).
fn shock_seen(ring: ShockRing, v: View2) -> ShockRing {
  var r = ring;
  r.a = vec4<f32>(view2_apply(v, ring.a.xy), ring.a.z * v.r0.w, ring.a.w * v.r0.w);
  return r;
}
