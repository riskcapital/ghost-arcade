// Ghost WGSL stdlib: HDR resolve and display tone curves.

fn ghost_aces_tonemap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn ghost_reinhard_tonemap(x: vec3<f32>) -> vec3<f32> {
  return x / (vec3<f32>(1.0) + x);
}

fn ghost_apply_exposure(c: vec3<f32>, exposureStops: f32) -> vec3<f32> {
  return c * exp2(exposureStops);
}

fn ghost_display_aces(c: vec3<f32>, exposureStops: f32) -> vec3<f32> {
  return ghost_aces_tonemap(ghost_apply_exposure(max(c, vec3<f32>(0.0)), exposureStops));
}
