// Cloud Flock drawing: points at their live positions; still points take the
// rest colour, moving ones heat toward the motion colour.
@group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> C: CloudU;
@group(0) @binding(2) var<storage, read> flock: array<FlockPoint>;

@vertex
fn vs_flock(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {
  var out: PointOut;
  out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  out.color = vec3<f32>(0.0);
  out.quad = vec2<f32>(0.0);
  let rgba = unpack_point_color(points[ii].w);
  let f = flock[ii];
  if (rgba.a <= 0.02 || f.v.w == 0.0) {
    return out;
  }
  let world = (C.model * vec4<f32>(f.p.xyz, 1.0)).xyz;
  let clip = C.view_proj * vec4<f32>(world, 1.0);
  if (clip.w <= 0.01) {
    return out;
  }
  let heat = clamp(f.p.w * C.look.w, 0.0, 1.0);
  let corner = SPRITE_CORNERS[vi];
  let size_px = C.cam.w * clamp(1.6 / clip.w, 0.55, 2.2) * (1.0 + heat * 0.6);
  let px = vec2<f32>(2.0 / C.res.x, 2.0 / C.res.y) * size_px;
  out.position = vec4<f32>(clip.xy + corner * px * clip.w, clip.z, clip.w);
  out.quad = corner;
  let scan = mix(C.base.rgb, rgba.rgb * C.base.rgb * 2.0, C.base.w);
  let rest_col = scan * C.look.x;
  let hot = mix(C.mid.rgb * C.mid.w, C.high.rgb * C.high.w, smoothstep(0.5, 1.0, heat)) * C.look.y;
  let depth_fade = clamp(2.2 / clip.w, 0.25, 1.0);
  out.color = mix(rest_col, hot, smoothstep(0.15, 0.9, heat)) * C.look.z * rgba.a * depth_fade;
  return out;
}
