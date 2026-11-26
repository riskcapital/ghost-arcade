// Rasterised layers (GA_CORE_COMPOSITOR=raster, compositor/raster.rs),
// appended to heartbeat.wgsl built with RASTER_LEAN.
//
// Each layer is one draw of fs_main's fullscreen triangle (vs_main), cut by
// a scissor to the canvas pixels it can touch (its cull rectangle), so each
// pixel sees the very canvas UV fs_main sees. The layer's index arrives as
// the instance (VertexOut.pass_kind). Layers draw bottom to top into a
// float accumulation target that holds what fs_main keeps in registers: the
// stack composited over black in rgb, its coverage in alpha. The per-pixel work is fs_main's own
// (layer_in_quad_bounds, plain_rect_coverage, layer_content), so a layer
// gives the same colour and alpha; only the blend moves:
//   Normal, Screen, Multiply  hardware blending (the pipelines' blend states)
//   any other mode            reads the stack below from a copy of the
//                             target (raster_input) and blends with
//                             native_blend, replacing the pixel
// fs_resolve then runs fs_main's finish (composite_finish) over the target.

// The accumulation target's copy for read-back blends (fs_raster_dst), or
// the accumulation target itself (fs_resolve).
@group(2) @binding(0)
var raster_input: texture_2d<f32>;

// What layer `layer_index` blends at this pixel, as fs_main's loop finds it:
// (rgb before the blend's clamp, blend alpha). Alpha below zero: nothing
// (fs_main's `continue`). Hierarchy masks, Edge Effects and generated
// content never get here: raster.rs draws those frames with fs_main. The
// output stage is the identity here (raster.rs), so `canvas_uv` is the
// fragment's own UV, as output_source_uv gives it to fs_main.
fn raster_layer_source(canvas_uv: vec2<f32>, layer_index: u32) -> vec4<f32> {
  let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
  let nothing = vec4<f32>(-1.0);
  if (layer_index >= 1024u || f32(layer_index) >= u.layer_count) {
    return nothing;
  }
  if (layers[layer_index].fast_flags.z == 1u && u.dlayer.x > 0.5) {
    return nothing;
  }
  let border = vec2<f32>(1.6 / max(min(u.resolution.x, u.resolution.y), 64.0));
  let layer_uv = clamp(canvas_uv, border, vec2<f32>(1.0) - border);
  let cull = layers[layer_index].cull;
  if (any(layer_uv < cull.xy) || any(layer_uv > cull.zw)) {
    return nothing;
  }
  if (layers[layer_index].info.x < 0.5 || layers[layer_index].color.a <= 0.001) {
    return nothing;
  }
  let tl = layers[layer_index].p0.xy;
  let tr = layers[layer_index].p0.zw;
  let br = layers[layer_index].p1.xy;
  let bl = layers[layer_index].p1.zw;
  let bezier_mesh = layers[layer_index].fast_flags.y == 1u;
  if (!layer_in_quad_bounds(layer_index, layer_uv, tl, tr, br, bl, bezier_mesh)) {
    return nothing;
  }
  if (layers[layer_index].fast_flags.x != 0u) {
    let coverage = plain_rect_coverage(layer_index, layer_uv, tl, br);
    if (coverage > 0.001) {
      let fill_alpha = clamp(layers[layer_index].color.a * layers[layer_index].edge_extra.y * coverage, 0.0, 1.0);
      return vec4<f32>(layers[layer_index].color.rgb * layers[layer_index].tint.rgb, fill_alpha);
    }
    return nothing;
  }
  let content = layer_content(layer_index, layer_uv, tl, tr, br, bl, bezier_mesh, vec2<f32>(0.0), vec2<f32>(0.0),
    false, vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0), aspect, u.time);
  if (content.a > 0.0) {
    let blend_alpha = clamp(min(layers[layer_index].color.a, 1.0) * content.a, 0.0, 1.0);
    return vec4<f32>(content.rgb * layers[layer_index].tint.rgb, blend_alpha);
  }
  return nothing;
}

// Normal, Screen and Multiply, for the blend state of each pipeline
// (raster.rs). With the stack below at d (0..1.5, see raster.rs) and the
// layer's clamped colour s at alpha a, native_blend gives:
//   Normal    d + (s - d) a          src * a + dst * (1 - a)
//   Screen    d + (s - d s) a        a s + dst * (1 - a s)
//   Multiply  d + (d s - d) a        dst * (1 - a + a s)
// and every mode's alpha is a + alpha * (1 - a). A pixel the layer misses
// writes the value its blend leaves the target unchanged by.
@fragment
fn fs_raster(in: VertexOut) -> @location(0) vec4<f32> {
  let source = raster_layer_source(in.uv, in.pass_kind);
  let mode = i32(floor(layers[in.pass_kind].style.x + 0.5));
  let a = clamp(source.a, 0.0, 1.0);
  let s = clamp(source.rgb, vec3<f32>(0.0), vec3<f32>(1.5));
  if (mode == 2) {
    return vec4<f32>(vec3<f32>(1.0 - a) + a * s, a);
  }
  if (mode == 3) {
    return vec4<f32>(a * s, a);
  }
  return vec4<f32>(s, a);
}

// Any blend mode: the stack below comes from the target's copy, the blend
// is fs_main's own.
@fragment
fn fs_raster_dst(in: VertexOut) -> @location(0) vec4<f32> {
  let below = textureLoad(raster_input, vec2<i32>(in.position.xy), 0);
  let source = raster_layer_source(in.uv, in.pass_kind);
  if (source.a < 0.0) {
    return below;
  }
  let color = native_blend(below.rgb, source.rgb, source.a, layers[in.pass_kind].style.x);
  return vec4<f32>(color, source.a + below.a * (1.0 - source.a));
}

// fs_main's finish over the accumulated stack, on its fullscreen triangle.
@fragment
fn fs_resolve(in: VertexOut) -> @location(0) vec4<f32> {
  let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
  let source = output_source_uv(in.uv);
  let stack = textureLoad(raster_input, vec2<i32>(in.position.xy), 0);
  return composite_finish(stack.rgb, stack.a, in.uv, source.xy, source.xy, source.z, aspect, u.time);
}
