// Map Sim projector view: what one physical projector must emit so the
// content lands on the real object. The scene is drawn from the output
// projector's lens; each surface point takes the content its mapping lens
// (the projector itself, or another "content from" projector) throws onto
// it, with that lens's occlusion and facing falloff, exactly as the Map Sim
// preview shader lights the model.

struct ViewUniforms {
  view_proj: mat4x4<f32>,
  map_view_proj: mat4x4<f32>,
  // xyz: mapping lens position; w: 1 when the mapping lens is another
  // projector, so its depth map decides occlusion.
  map_position: vec4<f32>,
  // near, far of the mapping lens; relative and absolute depth bias.
  map_params: vec4<f32>,
  // Content crop on the master, (x, y, w, h) with y down.
  crop: vec4<f32>,
  // Output projector edge blend (left, right, top, bottom).
  blend: vec4<f32>,
  // x: mode (0 content, 1 black, 2 model shading), y: content bound,
  // zw: target size in pixels.
  params: vec4<f32>,
  own_position: vec4<f32>,
  // Calibration overlay: cursor uv (y down), cursor shown, marker count.
  overlay: vec4<f32>,
  overlay2: vec4<f32>,
  // xy: marker uv (y down), z: 1 for the selected marker.
  markers: array<vec4<f32>, 32>,
};

struct ObjectData {
  model: mat4x4<f32>,
  n0: vec4<f32>,
  n1: vec4<f32>,
  n2: vec4<f32>,
  // x: receives projection, y: the floor.
  flags: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: ViewUniforms;
@group(0) @binding(1) var<storage, read> objects: array<ObjectData>;
@group(0) @binding(2) var map_depth: texture_depth_2d;
@group(0) @binding(3) var content: texture_2d<f32>;
@group(0) @binding(4) var content_sampler: sampler;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) @interpolate(flat) receive: f32,
  @location(3) @interpolate(flat) floor: f32,
};

@vertex
fn vs_main(v: VsIn, @builtin(instance_index) instance: u32) -> VsOut {
  let o = objects[instance];
  let world = o.model * vec4<f32>(v.position, 1.0);
  var out: VsOut;
  out.clip = u.view_proj * world;
  out.world = world.xyz;
  out.normal = mat3x3<f32>(o.n0.xyz, o.n1.xyz, o.n2.xyz) * v.normal;
  out.receive = o.flags.x;
  out.floor = o.flags.y;
  return out;
}

@vertex
fn vs_depth(v: VsIn, @builtin(instance_index) instance: u32) -> @builtin(position) vec4<f32> {
  let o = objects[instance];
  return u.view_proj * (o.model * vec4<f32>(v.position, 1.0));
}

// wgpu depth (0..1) of the mapping lens back to distance along its axis.
fn map_linear_depth(z: f32) -> f32 {
  let n = u.map_params.x;
  let f = u.map_params.y;
  return n * f / (f - z * (f - n));
}

fn edge_fade(uv: vec2<f32>, blend: vec4<f32>) -> f32 {
  var l = 1.0;
  var r = 1.0;
  var t = 1.0;
  var b = 1.0;
  if (blend.x > 0.0001) { l = smoothstep(0.0, blend.x, uv.x); }
  if (blend.y > 0.0001) { r = smoothstep(0.0, blend.y, 1.0 - uv.x); }
  if (blend.z > 0.0001) { t = smoothstep(0.0, blend.z, uv.y); }
  if (blend.w > 0.0001) { b = smoothstep(0.0, blend.w, 1.0 - uv.y); }
  return clamp(min(min(l, r), min(t, b)), 0.0, 1.0);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let black = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  let target_size = max(u.params.zw, vec2<f32>(1.0));
  let edge = edge_fade(in.clip.xy / target_size, u.blend);
  let n = normalize(in.normal);
  if (u.params.x > 1.5) {
    // Model shading for calibration: the virtual model as a grey relief,
    // lit from this projector, so it can be lined up with the real one.
    let lit = max(dot(n, normalize(u.own_position.xyz - in.world)), 0.0);
    let base = select(0.06 + 0.6 * lit, 0.03 + 0.1 * lit, in.floor > 0.5);
    return vec4<f32>(vec3<f32>(base) * edge, 1.0);
  }
  if (u.params.x > 0.5 || in.receive < 0.5 || u.params.y < 0.5) {
    return black;
  }
  let p = u.map_view_proj * vec4<f32>(in.world, 1.0);
  if (p.w <= 1e-6) {
    return black;
  }
  let ndc = p.xyz / p.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return black;
  }
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  var visible = 1.0;
  if (u.map_position.w > 0.5) {
    let size = vec2<f32>(textureDimensions(map_depth));
    let texel = vec2<i32>(clamp(uv * size, vec2<f32>(0.0), size - vec2<f32>(1.0)));
    let nearest = map_linear_depth(textureLoad(map_depth, texel, 0));
    // p.w is this point's distance along the mapping lens axis.
    if (p.w > nearest + u.map_params.w + u.map_params.z * p.w) {
      visible = 0.0;
    }
  }
  let facing = smoothstep(0.01, 0.08, dot(n, normalize(u.map_position.xyz - in.world)));
  let tex = vec2<f32>(u.crop.x + uv.x * u.crop.z, u.crop.y + uv.y * u.crop.w);
  let color = textureSampleLevel(content, content_sampler, tex, 0.0).rgb;
  return vec4<f32>(color * (visible * facing * edge), 1.0);
}

@vertex
fn vs_overlay(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  return vec4<f32>(pos[index], 0.0, 1.0);
}

fn ring(p: vec2<f32>, c: vec2<f32>, radius: f32, width: f32) -> f32 {
  let d = abs(length(p - c) - radius);
  return 1.0 - smoothstep(width * 0.5, width * 0.5 + 1.0, d);
}

fn disc(p: vec2<f32>, c: vec2<f32>, radius: f32) -> f32 {
  return 1.0 - smoothstep(radius, radius + 1.0, length(p - c));
}

// Calibration marks drawn over the projector view: the crosshair the
// operator drags onto a physical feature, and a ring on every point that
// has been matched already.
@fragment
fn fs_overlay(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let size = max(u.params.zw, vec2<f32>(1.0));
  let p = frag.xy;
  let s = max(1.0, size.y / 1080.0);
  var color = vec3<f32>(0.0);
  var alpha = 0.0;
  let count = min(i32(u.overlay.w), 32);
  for (var i = 0; i < count; i = i + 1) {
    let m = u.markers[i];
    let c = m.xy * size;
    let a = max(ring(p, c, 10.0 * s, 2.0 * s), disc(p, c, 1.5 * s));
    if (a > alpha) {
      alpha = a;
      color = select(vec3<f32>(1.0, 0.8, 0.2), vec3<f32>(0.3, 0.9, 1.0), m.z > 0.5);
    }
  }
  if (u.overlay.z > 0.5) {
    let c = u.overlay.xy * size;
    let half_width = 0.75 * s;
    let dx = abs(p.x - c.x);
    let dy = abs(p.y - c.y);
    let lines = max(1.0 - smoothstep(half_width, half_width + 1.0, dx), 1.0 - smoothstep(half_width, half_width + 1.0, dy));
    // Leave the centre open so the physical feature stays visible.
    let open_centre = smoothstep(5.0 * s, 6.0 * s, length(p - c));
    let mark = max(lines * open_centre, ring(p, c, 16.0 * s, 2.0 * s));
    if (mark > 0.0) {
      color = mix(color, vec3<f32>(1.0, 1.0, 1.0), mark);
      alpha = max(alpha, mark);
    }
    let centre = disc(p, c, 1.0 * s);
    if (centre > 0.0) {
      color = mix(color, vec3<f32>(1.0, 0.2, 0.3), centre);
      alpha = max(alpha, centre);
    }
  }
  return vec4<f32>(color * alpha, alpha);
}
