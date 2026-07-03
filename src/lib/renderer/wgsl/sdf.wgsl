// Ghost WGSL stdlib: common signed distance functions.

fn ghost_sdf_sphere(p: vec3<f32>, radius: f32) -> f32 {
  return length(p) - radius;
}

fn ghost_sdf_box(p: vec3<f32>, halfExtents: vec3<f32>) -> f32 {
  let q = abs(p) - halfExtents;
  return length(max(q, vec3<f32>(0.0))) + min(max(max(q.x, q.y), q.z), 0.0);
}

fn ghost_sdf_capsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radius: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - radius;
}

fn ghost_sdf_smooth_union(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-6), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
