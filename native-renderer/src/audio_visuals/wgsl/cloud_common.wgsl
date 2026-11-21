// Shared by the cloud instruments (Cloud Pulse, Cloud Flock, Depth Lights):
// the view uniform, band colours and the soft point sprite.

struct CloudU {
  view_proj: mat4x4<f32>,
  model: mat4x4<f32>,
  cam: vec4<f32>,      // camera position xyz, point size px
  res: vec4<f32>,      // width, height, aspect, point count
  origin: vec4<f32>,   // xyz, metric (0 radius, 1 depth, 2 height)
  look: vec4<f32>,     // base glow, wave gain, exposure, displacement
  forward: vec4<f32>,  // camera forward xyz, twinkle
  bass: vec4<f32>,     // rgb, intensity
  mid: vec4<f32>,
  high: vec4<f32>,
  base: vec4<f32>,     // base tint rgb, how much the scan's own colour shows
  audio: vec4<f32>,    // time, level, high env, wave count
  data: array<vec4<f32>, 24>, // the instrument's own block
}

// xyz, then the colour as packed RGBA8 (ply_reader.rs).
struct PointOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) quad: vec2<f32>,
}

fn band_color(band: f32) -> vec3<f32> {
  if (band < 0.5) {
    return C.bass.rgb * C.bass.w;
  }
  if (band < 1.5) {
    return C.mid.rgb * C.mid.w;
  }
  return C.high.rgb * C.high.w;
}

const SPRITE_CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
  vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0));

fn unpack_point_color(bits: f32) -> vec4<f32> {
  return unpack4x8unorm(bitcast<u32>(bits));
}

// A point worked out once per frame by an instrument's compute pass and
// drawn as a quad by sprite_draw.wgsl: clip position, colour, size in px
// (size 0 = not drawn).
struct Sprite {
  clip: vec4<f32>,
  color: vec4<f32>,
}

fn no_sprite() -> Sprite {
  return Sprite(vec4<f32>(0.0, 0.0, 0.0, 1.0), vec4<f32>(0.0));
}

/// Perspective size: nearer points draw larger, within limits.
fn sprite_size(clip_w: f32, scale: f32) -> f32 {
  return C.cam.w * clamp(1.6 / clip_w, 0.55, 2.2) * scale;
}

fn depth_fade(clip_w: f32) -> f32 {
  return clamp(2.2 / clip_w, 0.25, 1.0);
}

@fragment
fn fs_point(in: PointOut) -> @location(0) vec4<f32> {
  let d = dot(in.quad, in.quad);
  if (d > 1.0) {
    discard;
  }
  let a = exp(-d * 3.2);
  return vec4<f32>(in.color * a, 0.0);
}
