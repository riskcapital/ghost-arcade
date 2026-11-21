// The 2D instruments' camera (controls2.rs `view2_floats`): the picture as a
// card turned in 3D with perspective, zoomed and offset. Picture heights.

struct View2 {
  r0: vec4<f32>, // rotation row 0, zoom
  r1: vec4<f32>, // rotation row 1, perspective
  r2: vec4<f32>, // rotation row 2
  off: vec4<f32>, // offset xy
}

fn view2_apply(v: View2, p: vec2<f32>) -> vec2<f32> {
  let q = vec3<f32>(dot(v.r0.xyz, vec3<f32>(p, 0.0)), dot(v.r1.xyz, vec3<f32>(p, 0.0)), dot(v.r2.xyz, vec3<f32>(p, 0.0)));
  let k = v.r0.w / max(1.0 + q.z * v.r1.w * 0.5, 0.05);
  return q.xy * k + v.off.xy;
}

// The picture point that lands on screen point s (the card's inverse).
fn view2_invert(v: View2, s: vec2<f32>) -> vec2<f32> {
  let sp = (s - v.off.xy) / max(v.r0.w, 1e-4);
  let c0 = vec3<f32>(v.r0.x, v.r1.x, v.r2.x);
  let c1 = vec3<f32>(v.r0.y, v.r1.y, v.r2.y);
  let ps = v.r1.w * 0.5;
  let a = c0.xy - sp * ps * c0.z;
  let b = c1.xy - sp * ps * c1.z;
  let det = a.x * b.y - a.y * b.x;
  if (abs(det) < 1e-5) {
    return vec2<f32>(1e4);
  }
  return vec2<f32>(sp.x * b.y - sp.y * b.x, a.x * sp.y - a.y * sp.x) / det;
}
