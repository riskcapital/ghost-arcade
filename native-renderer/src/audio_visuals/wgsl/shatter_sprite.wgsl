// Mesh Shatter's draw: each point was shaded by cs_shatter_points; this only
// expands it into a soft sprite (the vertex shader runs 6 times a point, so
// the per-point work lives in the compute pass).
@group(0) @binding(0) var<storage, read> drawn: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;

@vertex
fn vs_shatter(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {
  var out: PointOut;
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.color = vec3<f32>(0.0);
  out.quad = vec2<f32>(0.0);
  let clip = drawn[ii * 2u];
  let look = drawn[ii * 2u + 1u];
  if (clip.w <= 0.01) {
    return out;
  }
  let corner = SPRITE_CORNERS[vi];
  let px = vec2<f32>(2.0 / C.res.x, 2.0 / C.res.y) * look.w;
  out.position = vec4<f32>(clip.xy + corner * px * clip.w, clip.z, clip.w);
  out.quad = corner;
  out.color = look.rgb;
  return out;
}
