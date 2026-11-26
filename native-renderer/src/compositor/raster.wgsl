// Rasterised layers (GA_CORE_COMPOSITOR=raster, compositor/raster.rs),
// appended to heartbeat.wgsl built with RASTER_LEAN (SOURCE_MIPS for the
// build that draws minified pictures; without RASTER_LEAN for the build
// that draws generated content).
//
// Each layer is one draw of fs_main's fullscreen triangle (vs_main), cut by
// a scissor to the output pixels it can touch (its cull rectangle, through
// the output stage for a Screen drawn straight from the compositor:
// raster_stage.rs), so each pixel sees the very canvas UV fs_main sees. The layer's index arrives as
// the instance (VertexOut.pass_kind). Layers draw bottom to top into a
// float accumulation target that holds what fs_main keeps in registers: the
// stack composited over black in rgb, its coverage in alpha. The per-pixel
// work is fs_main's own (layer_in_quad_bounds, plain_rect_coverage,
// layer_content, apply_native_edge_effects, native_polygon_mask), so a
// layer gives the same colour and alpha; only the blend moves:
//   Normal, Screen, Multiply  hardware blending (the pipelines' blend states)
//   any other mode            reads the stack below from the other
//                             accumulation target (raster_input) and blends
//                             with native_blend, replacing the pixel
//   hierarchy mask            multiplies the stack by its coverage in
//                             hardware (fs_raster_mask)
// A pass that reads the stack below starts on the other target with a copy
// of it (fs_raster_copy); raster.rs groups layers so none reads a pixel an
// earlier draw of the same pass wrote. fs_resolve then runs fs_main's finish
// (composite_finish) over the last target.
//
// Layers with Edge Effects draw with their own entry points (the _edges
// ones), so the Edge Effects code weighs only on their draws.

// The other accumulation target: the stack as the pass began (layer
// passes), or the finished stack (fs_resolve).
@group(2) @binding(0)
var raster_input: texture_2d<f32>;

// The canvas UV fs_main composites at this output pixel and its dome mask:
// the output stage's map (the identity for the program, a deck monitor or
// the record target; a Screen's crop and warps for a Screen drawn straight
// from the compositor).
fn raster_canvas(uv: vec2<f32>) -> vec3<f32> {
  let source = output_source_uv(uv);
  var canvas_uv = source.xy;
  var dome_mask = source.z;
  if (u.dome0.x > 0.5) {
    let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
    let domed = dome_source_uv(canvas_uv, aspect, aspect);
    canvas_uv = domed.xy;
    dome_mask = dome_mask * domed.z * domed.w;
  }
  return vec3<f32>(canvas_uv, dome_mask);
}

// fs_main's per-pixel steps, taken where control flow is uniform: one
// output pixel in canvas UV (source mips) and the analytic edge width
// (Edge Effects).
struct RasterSteps {
  step_x: vec2<f32>,
  step_y: vec2<f32>,
  edge_aa: f32,
}

fn raster_steps(canvas_uv: vec2<f32>) -> RasterSteps {
  var steps: RasterSteps;
  steps.step_x = vec2<f32>(0.0);
  steps.step_y = vec2<f32>(0.0);
  if (SOURCE_MIPS) {
    steps.step_x = dpdx(canvas_uv);
    steps.step_y = dpdy(canvas_uv);
  }
  let canvas_px = canvas_uv * u.resolution;
  steps.edge_aa = clamp(max(length(dpdx(canvas_px)), length(dpdy(canvas_px))), 0.25, 8.0);
  return steps;
}

// The layer's UV at this pixel and whether fs_main's loop gets past its
// first checks there (z > 0.5).
fn raster_layer_uv(canvas_uv: vec2<f32>, layer_index: u32) -> vec3<f32> {
  if (layer_index >= 1024u || f32(layer_index) >= u.layer_count) {
    return vec3<f32>(0.0);
  }
  if (layers[layer_index].fast_flags.z == 1u && u.dlayer.x > 0.5) {
    return vec3<f32>(0.0);
  }
  let border = vec2<f32>(1.6 / max(min(u.resolution.x, u.resolution.y), 64.0));
  let layer_uv = clamp(canvas_uv, border, vec2<f32>(1.0) - border);
  let cull = layers[layer_index].cull;
  if (any(layer_uv < cull.xy) || any(layer_uv > cull.zw)) {
    return vec3<f32>(0.0);
  }
  if (layers[layer_index].info.x < 0.5 || layers[layer_index].color.a <= 0.001) {
    return vec3<f32>(0.0);
  }
  return vec3<f32>(layer_uv, 1.0);
}

// What layer `layer_index` blends at this pixel, as fs_main's loop finds it:
// (rgb before the blend's clamp, blend alpha). Alpha below zero: nothing
// (fs_main's `continue`). Generated content draws with the build without
// RASTER_LEAN; Edge Effects with the _edges entry points, hierarchy masks
// with fs_raster_mask.
fn raster_layer_source(canvas_uv: vec2<f32>, layer_index: u32, steps: RasterSteps) -> vec4<f32> {
  let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
  let nothing = vec4<f32>(-1.0);
  let at = raster_layer_uv(canvas_uv, layer_index);
  if (at.z < 0.5) {
    return nothing;
  }
  let layer_uv = at.xy;
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
  let content = layer_content(layer_index, layer_uv, tl, tr, br, bl, bezier_mesh, steps.step_x, steps.step_y,
    false, vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0), aspect, u.time);
  if (content.a > 0.0) {
    let blend_alpha = clamp(min(layers[layer_index].color.a, 1.0) * content.a, 0.0, 1.0);
    return vec4<f32>(content.rgb * layers[layer_index].tint.rgb, blend_alpha);
  }
  return nothing;
}

// raster_layer_source for a layer with Edge Effects: also evaluated inside
// the rectangle its edge stack can reach, as fs_main's in_edges.
fn raster_edge_layer_source(canvas_uv: vec2<f32>, layer_index: u32, steps: RasterSteps) -> vec4<f32> {
  let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
  let nothing = vec4<f32>(-1.0);
  let at = raster_layer_uv(canvas_uv, layer_index);
  if (at.z < 0.5) {
    return nothing;
  }
  let layer_uv = at.xy;
  let tl = layers[layer_index].p0.xy;
  let tr = layers[layer_index].p0.zw;
  let br = layers[layer_index].p1.xy;
  let bl = layers[layer_index].p1.zw;
  let edge_bounds = pool_edge(layer_index, 3u);
  let in_edges = pool_edge(layer_index, 0u).y > 0.5 && pool_edge(layer_index, 0u).x > 2.5
    && all(layer_uv >= edge_bounds.xy) && all(layer_uv <= edge_bounds.zw);
  let bezier_mesh = layers[layer_index].fast_flags.y == 1u;
  let in_quad_bounds = layer_in_quad_bounds(layer_index, layer_uv, tl, tr, br, bl, bezier_mesh);
  if (!in_quad_bounds && !in_edges) {
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
  var layer_rgb = layers[layer_index].color.rgb;
  var content_alpha = 0.0;
  if (in_quad_bounds) {
    let content = layer_content(layer_index, layer_uv, tl, tr, br, bl, bezier_mesh, steps.step_x, steps.step_y,
      false, vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0), aspect, u.time);
    layer_rgb = content.rgb;
    content_alpha = content.a;
  }
  var layer_alpha = layers[layer_index].color.a;
  if (in_edges) {
    let own = clamp(layers[layer_index].tint.w, 0.0, 1.0);
    let edged = apply_native_edge_effects(vec4<f32>(layer_rgb, content_alpha * own), layer_uv, layer_index, steps.edge_aa);
    layer_rgb = edged.rgb;
    content_alpha = edged.a;
    layer_alpha = layer_alpha / max(own, 1e-4);
  }
  if (content_alpha > 0.0) {
    let blend_alpha = clamp(min(layer_alpha, 1.0) * content_alpha, 0.0, 1.0);
    return vec4<f32>(layer_rgb * layers[layer_index].tint.rgb, blend_alpha);
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
fn raster_hardware_out(source: vec4<f32>, layer_index: u32) -> vec4<f32> {
  let mode = i32(floor(layers[layer_index].style.x + 0.5));
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

// Any blend mode over the stack below (from raster_input; none yet in the
// frame's first pass, which raster.rs marks by adding RASTER_BELOW_CLEAR to
// the instance), fs_main's blend.
const RASTER_BELOW_CLEAR: u32 = 65536u;

fn raster_readback_out(position: vec4<f32>, source: vec4<f32>, layer_index: u32, below_clear: bool) -> vec4<f32> {
  var below = vec4<f32>(0.0);
  if (!below_clear) {
    below = textureLoad(raster_input, vec2<i32>(position.xy), 0);
  }
  if (source.a < 0.0) {
    return below;
  }
  let color = native_blend(below.rgb, source.rgb, source.a, layers[layer_index].style.x);
  return vec4<f32>(color, source.a + below.a * (1.0 - source.a));
}

@fragment
fn fs_raster(in: VertexOut) -> @location(0) vec4<f32> {
  let canvas_uv = raster_canvas(in.uv).xy;
  let steps = raster_steps(canvas_uv);
  return raster_hardware_out(raster_layer_source(canvas_uv, in.pass_kind, steps), in.pass_kind);
}

@fragment
fn fs_raster_edges(in: VertexOut) -> @location(0) vec4<f32> {
  let canvas_uv = raster_canvas(in.uv).xy;
  let steps = raster_steps(canvas_uv);
  return raster_hardware_out(raster_edge_layer_source(canvas_uv, in.pass_kind, steps), in.pass_kind);
}

@fragment
fn fs_raster_dst(in: VertexOut) -> @location(0) vec4<f32> {
  let canvas_uv = raster_canvas(in.uv).xy;
  let steps = raster_steps(canvas_uv);
  let layer_index = in.pass_kind % RASTER_BELOW_CLEAR;
  return raster_readback_out(in.position, raster_layer_source(canvas_uv, layer_index, steps), layer_index,
    in.pass_kind >= RASTER_BELOW_CLEAR);
}

@fragment
fn fs_raster_dst_edges(in: VertexOut) -> @location(0) vec4<f32> {
  let canvas_uv = raster_canvas(in.uv).xy;
  let steps = raster_steps(canvas_uv);
  let layer_index = in.pass_kind % RASTER_BELOW_CLEAR;
  return raster_readback_out(in.position, raster_edge_layer_source(canvas_uv, layer_index, steps), layer_index,
    in.pass_kind >= RASTER_BELOW_CLEAR);
}

// A hierarchy mask layer (blend code 26): fs_main multiplies the stack
// below by its coverage, colour and alpha alike; the pipeline's blend
// multiplies the target by this. A disabled mask leaves it be.
@fragment
fn fs_raster_mask(in: VertexOut) -> @location(0) vec4<f32> {
  let layer_index = in.pass_kind;
  let keep = vec4<f32>(1.0);
  if (layer_index >= 1024u || f32(layer_index) >= u.layer_count) {
    return keep;
  }
  if (layers[layer_index].fast_flags.z == 1u && u.dlayer.x > 0.5) {
    return keep;
  }
  let border = vec2<f32>(1.6 / max(min(u.resolution.x, u.resolution.y), 64.0));
  let layer_uv = clamp(raster_canvas(in.uv).xy, border, vec2<f32>(1.0) - border);
  let cull = layers[layer_index].cull;
  if (any(layer_uv < cull.xy) || any(layer_uv > cull.zw) || layers[layer_index].info.x < 0.5) {
    return keep;
  }
  let mask_enabled = pool_mask(layer_index, 0u).x > 0.5 && pool_mask(layer_index, 0u).w >= 2.5;
  if (!mask_enabled) {
    return keep;
  }
  let tl = layers[layer_index].p0.xy;
  let tr = layers[layer_index].p0.zw;
  let br = layers[layer_index].p1.xy;
  let bl = layers[layer_index].p1.zw;
  let mask_local = select(quad_local_uv(layer_uv, tl, tr, br, bl), quad_local_uv_perspective(layer_uv, tl, tr, br, bl),
    (layers[layer_index].fast_flags.w & 2u) != 0u);
  var coverage = select(0.0, 1.0, pool_mask(layer_index, 0u).y > 0.5);
  if (mask_local.x > 0.5) {
    coverage = native_polygon_mask(mask_local.yz, layer_index);
  }
  return vec4<f32>(coverage);
}

// The start of a pass that reads the stack below: the stack so far, from
// the other target.
@fragment
fn fs_raster_copy(in: VertexOut) -> @location(0) vec4<f32> {
  return textureLoad(raster_input, vec2<i32>(in.position.xy), 0);
}

// fs_main's finish over the accumulated stack, on its fullscreen triangle.
@fragment
fn fs_resolve(in: VertexOut) -> @location(0) vec4<f32> {
  let aspect = max(0.01, u.resolution.x / max(1.0, u.resolution.y));
  let source = output_source_uv(in.uv);
  let canvas = raster_canvas(in.uv);
  let stack = textureLoad(raster_input, vec2<i32>(in.position.xy), 0);
  return composite_finish(stack.rgb, stack.a, in.uv, source.xy, canvas.xy, canvas.z, aspect, u.time);
}
