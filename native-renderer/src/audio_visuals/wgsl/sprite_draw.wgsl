// Draws the sprites a cloud instrument's compute pass prepared. All the
// per-point work happened once, there; a vertex only places a corner.
@group(0) @binding(0) var<storage, read> sprites: array<Sprite>;
@group(0) @binding(1) var<uniform> C: CloudU;

@vertex
fn vs_sprite(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {
  var out: PointOut;
  let s = sprites[ii];
  if (s.color.w <= 0.0 || s.clip.w <= 0.01) {
    out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.quad = vec2<f32>(0.0);
    return out;
  }
  let corner = SPRITE_CORNERS[vi];
  let px = vec2<f32>(2.0 / C.res.x, 2.0 / C.res.y) * s.color.w;
  out.position = vec4<f32>(s.clip.xy + corner * px * s.clip.w, s.clip.z, s.clip.w);
  out.quad = corner;
  out.color = s.color.rgb;
  return out;
}
