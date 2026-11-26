//! Stage3D: the scene bridge from the app, the overlay and mesh items it
//! draws, their shaders, and drawing them over the composite.

use crate::*;

pub(crate) const STAGE3D_OVERLAY_WGSL: &str = r#"
struct Stage3DOverlayUniforms {
  resolution: vec2<f32>,
  item_count: f32,
  time: f32,
}

struct Stage3DOverlayItem {
  center: vec2<f32>,
  half_size: vec2<f32>,
  color: vec4<f32>,
  params: vec4<f32>, // shape, rotation, brightness, reserved
}

@group(0) @binding(0)
var<uniform> u: Stage3DOverlayUniforms;

@group(0) @binding(1)
var<storage, read> items: array<Stage3DOverlayItem>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let p = pos[vertex_index];
  var out: VertexOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

fn sd_box(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0);
}

fn rotate2(p: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);
  let px = 2.0 / max(1.0, min(u.resolution.x, u.resolution.y));
  var color = vec3<f32>(0.0);
  var alpha = 0.0;
  let count = min(u32(u.item_count), u32(128));
  for (var i: u32 = 0u; i < count; i = i + 1u) {
    let item = items[i];
    let shape = item.params.x;
    let brightness = max(0.05, item.params.z);
    let p = rotate2(ndc - item.center, -item.params.y);
    var mask = 0.0;
    var glow = 0.0;
    if (shape < 0.5) {
      let dist = sd_box(p, max(item.half_size, vec2<f32>(px * 2.0)));
      mask = 1.0 - smoothstep(0.0, px * 2.2, dist);
      let inner = 1.0 - smoothstep(px * 2.0, px * 7.0, abs(dist));
      glow = exp(-max(dist, 0.0) * 18.0) * 0.22 + inner * 0.18;
    } else {
      let q = p / max(item.half_size, vec2<f32>(px * 4.0));
      let dist = length(q) - 1.0;
      mask = 1.0 - smoothstep(0.0, px * 4.0, dist);
      glow = exp(-max(dist, 0.0) * 6.0) * 0.24;
    }
    let edge = clamp(mask + glow, 0.0, 1.0);
    let a = clamp(edge * item.color.a * brightness, 0.0, 0.86);
    let premul = item.color.rgb * a;
    color = color + premul * (1.0 - alpha);
    alpha = alpha + a * (1.0 - alpha);
  }
  return vec4<f32>(color, alpha);
}
"#;

pub(crate) const STAGE3D_MESH_WGSL: &str = concat!(
    include_str!("../../src/lib/renderer/wgsl/lighting.wgsl"),
    r#"
struct Stage3DMeshUniforms {
  resolution: vec2<f32>,
  item_count: f32,
  time: f32,
  camera_pos: vec4<f32>,
  camera_target: vec4<f32>,
  params: vec4<f32>, // fov radians, aspect, near, far
  lighting: vec4<f32>, // room darkness, screen boost, exposure, room intensity
  atmosphere: vec4<f32>, // haze density, reserved
}

struct Stage3DMeshItem {
  position: vec4<f32>, // xyz, shape
  scale: vec4<f32>,    // xyz, reserved
  rotation: vec4<f32>, // xyz radians, reserved
  color: vec4<f32>,
  material: vec4<f32>, // source_slot+1, brightness, uv_mode, opacity
  uv: vec4<f32>,       // offset x/y, zoom, rotation radians
}

@group(0) @binding(0)
var<uniform> u: Stage3DMeshUniforms;

@group(0) @binding(1)
var<storage, read> items: array<Stage3DMeshItem>;

//#SOURCE_FRAMES

@group(0) @binding(3)
var source_sampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) view_z: f32,
  @location(3) uv: vec2<f32>,
  @location(4) material: vec4<f32>,
}

fn cube_vertex(index: u32) -> vec3<f32> {
  let verts = array<vec3<f32>, 36>(
    vec3<f32>(-0.5, -0.5,  0.5), vec3<f32>( 0.5, -0.5,  0.5), vec3<f32>( 0.5,  0.5,  0.5),
    vec3<f32>(-0.5, -0.5,  0.5), vec3<f32>( 0.5,  0.5,  0.5), vec3<f32>(-0.5,  0.5,  0.5),
    vec3<f32>( 0.5, -0.5, -0.5), vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>(-0.5,  0.5, -0.5),
    vec3<f32>( 0.5, -0.5, -0.5), vec3<f32>(-0.5,  0.5, -0.5), vec3<f32>( 0.5,  0.5, -0.5),
    vec3<f32>(-0.5,  0.5,  0.5), vec3<f32>( 0.5,  0.5,  0.5), vec3<f32>( 0.5,  0.5, -0.5),
    vec3<f32>(-0.5,  0.5,  0.5), vec3<f32>( 0.5,  0.5, -0.5), vec3<f32>(-0.5,  0.5, -0.5),
    vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>( 0.5, -0.5, -0.5), vec3<f32>( 0.5, -0.5,  0.5),
    vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>( 0.5, -0.5,  0.5), vec3<f32>(-0.5, -0.5,  0.5),
    vec3<f32>( 0.5, -0.5,  0.5), vec3<f32>( 0.5, -0.5, -0.5), vec3<f32>( 0.5,  0.5, -0.5),
    vec3<f32>( 0.5, -0.5,  0.5), vec3<f32>( 0.5,  0.5, -0.5), vec3<f32>( 0.5,  0.5,  0.5),
    vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>(-0.5, -0.5,  0.5), vec3<f32>(-0.5,  0.5,  0.5),
    vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>(-0.5,  0.5,  0.5), vec3<f32>(-0.5,  0.5, -0.5),
  );
  return verts[index % 36u];
}

fn plane_vertex(index: u32) -> vec3<f32> {
  let verts = array<vec3<f32>, 6>(
    vec3<f32>(-0.5, -0.5, 0.0), vec3<f32>( 0.5, -0.5, 0.0), vec3<f32>( 0.5,  0.5, 0.0),
    vec3<f32>(-0.5, -0.5, 0.0), vec3<f32>( 0.5,  0.5, 0.0), vec3<f32>(-0.5,  0.5, 0.0),
  );
  return verts[index % 6u];
}

fn polar_vertex(theta: f32, phi: f32, radius: f32) -> vec3<f32> {
  let sp = sin(phi);
  return vec3<f32>(cos(theta) * sp * radius, cos(phi) * radius, sin(theta) * sp * radius);
}

fn sphere_vertex(index: u32, hemisphere: bool) -> vec3<f32> {
  let segments = 12u;
  let stacks = 2u;
  let quad = index / 6u;
  let seg = quad % segments;
  let stack = min(quad / segments, stacks - 1u);
  let corner = index % 6u;
  let theta0 = f32(seg) / f32(segments) * 6.28318530718;
  let theta1 = f32(seg + 1u) / f32(segments) * 6.28318530718;
  let phi_max = select(3.14159265359, 1.57079632679, hemisphere);
  let phi0 = f32(stack) / f32(stacks) * phi_max;
  let phi1 = f32(stack + 1u) / f32(stacks) * phi_max;
  let a = polar_vertex(theta0, phi0, 0.5);
  let b = polar_vertex(theta1, phi0, 0.5);
  let c = polar_vertex(theta1, phi1, 0.5);
  let d = polar_vertex(theta0, phi1, 0.5);
  if (corner == 0u) { return a; }
  if (corner == 1u) { return c; }
  if (corner == 2u) { return b; }
  if (corner == 3u) { return a; }
  if (corner == 4u) { return d; }
  return c;
}

fn pyramid_vertex(index: u32) -> vec3<f32> {
  let verts = array<vec3<f32>, 18>(
    vec3<f32>(-0.5, -0.5,  0.5), vec3<f32>( 0.5, -0.5,  0.5), vec3<f32>( 0.0,  0.5,  0.0),
    vec3<f32>( 0.5, -0.5,  0.5), vec3<f32>( 0.5, -0.5, -0.5), vec3<f32>( 0.0,  0.5,  0.0),
    vec3<f32>( 0.5, -0.5, -0.5), vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>( 0.0,  0.5,  0.0),
    vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>(-0.5, -0.5,  0.5), vec3<f32>( 0.0,  0.5,  0.0),
    vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>( 0.5, -0.5, -0.5), vec3<f32>( 0.5, -0.5,  0.5),
    vec3<f32>(-0.5, -0.5, -0.5), vec3<f32>( 0.5, -0.5,  0.5), vec3<f32>(-0.5, -0.5,  0.5),
  );
  return verts[index % 18u];
}

fn cylinder_vertex(index: u32) -> vec3<f32> {
  let segments = 12u;
  let quad = index / 6u;
  let seg = quad % segments;
  let corner = index % 6u;
  let theta0 = f32(seg) / f32(segments) * 6.28318530718;
  let theta1 = f32(seg + 1u) / f32(segments) * 6.28318530718;
  let a = vec3<f32>(cos(theta0) * 0.5, -0.5, sin(theta0) * 0.5);
  let b = vec3<f32>(cos(theta1) * 0.5, -0.5, sin(theta1) * 0.5);
  let c = vec3<f32>(cos(theta1) * 0.5,  0.5, sin(theta1) * 0.5);
  let d = vec3<f32>(cos(theta0) * 0.5,  0.5, sin(theta0) * 0.5);
  if (corner == 0u) { return a; }
  if (corner == 1u) { return b; }
  if (corner == 2u) { return c; }
  if (corner == 3u) { return a; }
  if (corner == 4u) { return c; }
  return d;
}

fn cone_vertex(index: u32) -> vec3<f32> {
  let segments = 12u;
  let tri = index / 3u;
  let seg = tri % segments;
  let corner = index % 3u;
  let theta0 = f32(seg) / f32(segments) * 6.28318530718;
  let theta1 = f32(seg + 1u) / f32(segments) * 6.28318530718;
  let a = vec3<f32>(cos(theta0) * 0.5, -0.5, sin(theta0) * 0.5);
  let b = vec3<f32>(cos(theta1) * 0.5, -0.5, sin(theta1) * 0.5);
  let top = vec3<f32>(0.0, 0.5, 0.0);
  if (tri < segments) {
    if (corner == 0u) { return a; }
    if (corner == 1u) { return b; }
    return top;
  }
  if (corner == 0u) { return vec3<f32>(0.0, -0.5, 0.0); }
  if (corner == 1u) { return b; }
  return a;
}

fn mesh_vertex(index: u32, shape: f32) -> vec3<f32> {
  if (shape < 0.5) { return plane_vertex(index); }
  if (shape < 1.5) { return cube_vertex(index); }
  if (shape < 2.5) { return sphere_vertex(index, false); }
  if (shape < 3.5) { return sphere_vertex(index, true); }
  if (shape < 4.5) { return pyramid_vertex(index); }
  if (shape < 5.5) { return cylinder_vertex(index); }
  return cone_vertex(index);
}

fn mesh_base_uv(local: vec3<f32>, shape: f32) -> vec2<f32> {
  if (shape > 1.5) {
    let angle = atan2(local.z, local.x) / 6.28318530718 + 0.5;
    let v = select(0.5 - local.y, 1.0 - local.y * 2.0, shape > 2.5 && shape < 3.5);
    return vec2<f32>(angle, clamp(v, 0.0, 1.0));
  }
  return vec2<f32>(local.x + 0.5, 0.5 - local.y);
}

fn rotate_y(p: vec3<f32>, yaw: f32) -> vec3<f32> {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn rotate_x(p: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

fn rotate_z(p: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

fn rotate_xyz(p: vec3<f32>, rotation: vec3<f32>) -> vec3<f32> {
  return rotate_z(rotate_y(rotate_x(p, rotation.x), rotation.y), rotation.z);
}

fn cube_normal(local: vec3<f32>) -> vec3<f32> {
  let a = abs(local);
  if (a.x >= a.y && a.x >= a.z) { return vec3<f32>(sign(local.x), 0.0, 0.0); }
  if (a.y >= a.x && a.y >= a.z) { return vec3<f32>(0.0, sign(local.y), 0.0); }
  return vec3<f32>(0.0, 0.0, sign(local.z));
}

fn mesh_normal(local: vec3<f32>, shape: f32) -> vec3<f32> {
  if (shape < 0.5) { return vec3<f32>(0.0, 0.0, 1.0); }
  if (shape < 1.5) { return cube_normal(local); }
  if (shape < 3.5) { return normalize(local + vec3<f32>(0.0, 0.001, 0.0)); }
  if (shape < 4.5) { return normalize(vec3<f32>(local.x, 0.35, local.z)); }
  if (shape < 5.5) { return normalize(vec3<f32>(local.x, 0.0, local.z)); }
  return normalize(vec3<f32>(local.x, 0.25, local.z));
}

fn rotate_uv(p: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn stage_uv(base_uv: vec2<f32>, material: vec4<f32>, uv_params: vec4<f32>) -> vec2<f32> {
  let zoom = max(0.001, uv_params.z);
  var uv = rotate_uv((base_uv - vec2<f32>(0.5)) / zoom, uv_params.w) + vec2<f32>(0.5) + uv_params.xy;
  let mode = material.z;
  if (mode > 1.5 && mode < 3.5) {
    let centered = uv - vec2<f32>(0.5);
    let angle = atan2(centered.y, centered.x) / 6.28318530718 + 0.5;
    let radius = length(centered) * 1.41421356237;
    uv = vec2<f32>(angle, radius);
  } else if (mode > 0.5 && mode < 1.5) {
    let folded = fract(uv * 0.5) * 2.0;
    uv = select(folded, 2.0 - folded, folded > vec2<f32>(1.0));
  } else {
    uv = fract(uv);
  }
  return uv;
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32, @builtin(instance_index) instance_index: u32) -> VertexOut {
  let item = items[min(instance_index, u32(127))];
  let shape = item.position.w;
  let local = mesh_vertex(vertex_index, shape);
  let scaled = local * max(item.scale.xyz, vec3<f32>(0.001));
  let world = item.position.xyz + rotate_xyz(scaled, item.rotation.xyz);

  let eye = u.camera_pos.xyz;
  let look_at = u.camera_target.xyz;
  let forward = normalize(look_at - eye);
  var right = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
  if (length(right) < 0.001) {
    right = vec3<f32>(1.0, 0.0, 0.0);
  }
  let up = normalize(cross(right, forward));
  let rel = world - eye;
  let view = vec3<f32>(dot(rel, right), dot(rel, up), dot(rel, forward));
  let near = max(0.01, u.params.z);
  let far = max(near + 1.0, u.params.w);
  let tan_half = tan(max(0.1, u.params.x) * 0.5);
  let aspect = max(0.1, u.params.y);

  var out: VertexOut;
  if (view.z <= near) {
    out.position = vec4<f32>(-4.0, -4.0, 1.0, 1.0);
  } else {
    let ndc = vec2<f32>(
      view.x / (view.z * tan_half * aspect),
      view.y / (view.z * tan_half)
    );
    let depth = clamp((view.z - near) / (far - near), 0.0, 1.0);
    out.position = vec4<f32>(ndc, depth, 1.0);
  }
  out.color = item.color;
  out.normal = normalize(rotate_xyz(mesh_normal(local, shape), item.rotation.xyz));
  out.view_z = view.z;
  out.uv = stage_uv(mesh_base_uv(local, shape), item.material, item.uv);
  out.material = item.material;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let light = ghost_safe_normalize3(vec3<f32>(-0.3, 0.75, 0.55), vec3<f32>(0.0, 1.0, 0.0));
  let shade = ghost_apply_directional_light(
    vec3<f32>(1.0),
    ghost_safe_normalize3(in.normal + vec3<f32>(0.0, 0.15, 0.0), vec3<f32>(0.0, 1.0, 0.0)),
    light,
    vec3<f32>(1.0),
    0.48,
    0.52,
  ).r;
  let haze_density = clamp(u.atmosphere.x, 0.0, 4.0);
  let haze_floor = clamp(0.58 - haze_density * 0.22, 0.18, 0.80);
  let haze = clamp(1.0 - in.view_z * (0.012 + haze_density * 0.012), haze_floor, 1.0);
  let opacity = clamp(in.material.w, 0.0, 1.0);
  var alpha = clamp(in.color.a * opacity, 0.0, 1.0);
  let room_visibility = clamp(1.0 - u.lighting.x, 0.0, 1.0);
  let screen_boost = max(0.0, u.lighting.y);
  let exposure = max(0.02, u.lighting.z);
  let room_light = room_visibility * max(0.0, u.lighting.w) * exposure;
  let source_active = select(0.0, 1.0, in.material.x >= 0.5);
  let light_mul = mix(room_light, screen_boost, source_active);
  var rgb = in.color.rgb;
  if (in.material.x >= 0.5) {
    let source_slot = clamp(i32(floor(in.material.x - 1.0 + 0.5)), 0, source_frame_count() - 1);
    let tex = source_frame_sample(source_slot, source_sampler, in.uv);
    rgb = mix(rgb, tex.rgb, clamp(opacity, 0.0, 1.0));
    alpha = clamp(in.color.a * opacity * tex.a, 0.0, 1.0);
  }
  rgb *= max(0.0, in.material.y) * light_mul;
  return vec4<f32>(rgb * shade * haze * alpha, alpha);
}
"#
);

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct Stage3DOverlayUniforms {
    pub(crate) resolution: [f32; 2],
    pub(crate) item_count: f32,
    pub(crate) time: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub(crate) struct Stage3DOverlayItemGpu {
    pub(crate) center: [f32; 2],
    pub(crate) half_size: [f32; 2],
    pub(crate) color: [f32; 4],
    pub(crate) meta: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct Stage3DMeshUniforms {
    pub(crate) resolution: [f32; 2],
    pub(crate) item_count: f32,
    pub(crate) time: f32,
    pub(crate) camera_pos: [f32; 4],
    pub(crate) camera_target: [f32; 4],
    pub(crate) params: [f32; 4],
    pub(crate) lighting: [f32; 4],
    pub(crate) atmosphere: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub(crate) struct Stage3DMeshItemGpu {
    pub(crate) position: [f32; 4],
    pub(crate) scale: [f32; 4],
    pub(crate) rotation: [f32; 4],
    pub(crate) color: [f32; 4],
    pub(crate) material: [f32; 4],
    pub(crate) uv: [f32; 4],
}

#[derive(Clone, Debug)]
pub(crate) struct Stage3DMeshFrame {
    pub(crate) camera_pos: [f32; 3],
    pub(crate) camera_target: [f32; 3],
    pub(crate) fov_degrees: f32,
    pub(crate) lighting: [f32; 4],
    pub(crate) atmosphere: [f32; 4],
    pub(crate) items: Vec<Stage3DMeshItemGpu>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct NativeSceneBridgeSummary {
    pub(crate) schema_version: u32,
    pub(crate) scene_kind: String,
    pub(crate) scene_id: String,
    pub(crate) scene_name: String,
    pub(crate) source_schema_version: u32,
    pub(crate) payload_bytes: u64,
    pub(crate) updated_at_ms: u64,
    pub(crate) node_count: u32,
    pub(crate) screen_count: u32,
    pub(crate) primitive_count: u32,
    pub(crate) truss_count: u32,
    pub(crate) light_count: u32,
    pub(crate) laser_count: u32,
    pub(crate) fog_volume_count: u32,
    pub(crate) user_element_count: u32,
    pub(crate) scenery_override_count: u32,
    pub(crate) projector_count: u32,
    pub(crate) object_count: u32,
    pub(crate) model_count: u32,
    pub(crate) point_cloud_count: u32,
}

impl NativeSceneBridgeSummary {
    pub(crate) fn empty(scene_kind: &str) -> Self {
        Self {
            schema_version: 1,
            scene_kind: scene_kind.to_string(),
            scene_id: String::new(),
            scene_name: String::new(),
            source_schema_version: 0,
            payload_bytes: 0,
            updated_at_ms: 0,
            node_count: 0,
            screen_count: 0,
            primitive_count: 0,
            truss_count: 0,
            light_count: 0,
            laser_count: 0,
            fog_volume_count: 0,
            user_element_count: 0,
            scenery_override_count: 0,
            projector_count: 0,
            object_count: 0,
            model_count: 0,
            point_cloud_count: 0,
        }
    }
}

pub(crate) fn scene_payload<'a>(params: &'a Value, scene_key: &str) -> Result<&'a Value, String> {
    let scene = params
        .get("scene")
        .or_else(|| params.get(scene_key))
        .unwrap_or(params);
    if !scene.is_object() {
        return Err(format!(
            "native {scene_key} scene ingest requires a JSON object scene"
        ));
    }
    Ok(scene)
}

pub(crate) fn scene_payload_bytes(scene: &Value) -> u64 {
    serde_json::to_vec(scene)
        .map(|bytes| bytes.len() as u64)
        .unwrap_or(0)
}

pub(crate) fn scene_bridge_epoch_ms() -> u64 {
    epoch_ms().min(u64::MAX as u128) as u64
}

pub(crate) fn summarize_stage3d_scene(scene: &Value) -> NativeSceneBridgeSummary {
    let mut summary = NativeSceneBridgeSummary::empty("stage3d");
    summary.scene_id = string_at(scene, &["id"]).unwrap_or_default();
    summary.scene_name = string_at(scene, &["name"]).unwrap_or_default();
    summary.source_schema_version = number_at(scene, &["schemaVersion"])
        .unwrap_or(0.0)
        .round()
        .clamp(0.0, u32::MAX as f64) as u32;
    summary.payload_bytes = scene_payload_bytes(scene);
    summary.updated_at_ms = scene_bridge_epoch_ms();
    count_stage3d_nodes(scene.get("nodes"), &mut summary);

    if let Some(user_elements) = scene.get("userElements").and_then(Value::as_array) {
        summary.user_element_count = user_elements.len().min(u32::MAX as usize) as u32;
    }
    summary.scenery_override_count = scene
        .get("sceneryOverrides")
        .and_then(Value::as_object)
        .map(|object| object.len().min(u32::MAX as usize) as u32)
        .unwrap_or(0);
    summary
}

pub(crate) fn count_stage3d_nodes(value: Option<&Value>, summary: &mut NativeSceneBridgeSummary) {
    let Some(nodes) = value.and_then(Value::as_array) else {
        return;
    };
    for node in nodes {
        summary.node_count = summary.node_count.saturating_add(1);
        match node.get("type").and_then(Value::as_str).unwrap_or_default() {
            "led-screen" => summary.screen_count = summary.screen_count.saturating_add(1),
            "primitive" | "svg-extrude" => {
                summary.primitive_count = summary.primitive_count.saturating_add(1)
            }
            "truss" => summary.truss_count = summary.truss_count.saturating_add(1),
            "spot-light" | "point-light" | "rect-area-light" => {
                summary.light_count = summary.light_count.saturating_add(1)
            }
            "laser" => summary.laser_count = summary.laser_count.saturating_add(1),
            "fog-volume" => summary.fog_volume_count = summary.fog_volume_count.saturating_add(1),
            "imported-glb" => summary.model_count = summary.model_count.saturating_add(1),
            _ => {}
        }
        count_stage3d_nodes(node.get("children"), summary);
    }
}

pub(crate) fn collect_stage3d_overlay_nodes(value: Option<&Value>, items: &mut Vec<Stage3DOverlayItemGpu>) {
    let Some(nodes) = value.and_then(Value::as_array) else {
        return;
    };
    for node in nodes {
        if items.len() >= MAX_STAGE3D_OVERLAY_ITEMS {
            return;
        }
        if !bool_at(node, &["visible"]).unwrap_or(true) {
            continue;
        }
        let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();
        match node_type {
            "led-screen" => {
                let position = vec3_path_or(node, &["position"], [0.0, 2.4, 0.0]);
                let rotation = vec3_path_or(node, &["rotation"], [0.0, 0.0, 0.0]);
                let scale = vec3_path_or(node, &["scale"], [1.0, 1.0, 1.0]);
                let width = number_at(node, &["width"]).unwrap_or(4.0) as f32 * scale[0].abs();
                let height = number_at(node, &["height"]).unwrap_or(2.25) as f32 * scale[1].abs();
                let brightness = number_at(node, &["brightness"]).unwrap_or(1.0) as f32;
                items.push(stage3d_overlay_item(
                    position,
                    width,
                    height,
                    [0.25, 0.92, 1.0, 0.62],
                    0.0,
                    rotation[2],
                    brightness.clamp(0.1, 4.0),
                ));
            }
            "primitive" | "svg-extrude" => {
                let position = vec3_path_or(node, &["position"], [0.0, 1.0, 0.0]);
                let rotation = vec3_path_or(node, &["rotation"], [0.0, 0.0, 0.0]);
                let scale = vec3_path_or(node, &["scale"], [1.0, 1.0, 1.0]);
                let dimensions = vec3_path_or(node, &["dimensions"], [2.0, 2.0, 2.0]);
                let color = color_path_or(node, &["material", "emissive"])
                    .or_else(|| color_path_or(node, &["material", "color"]))
                    .unwrap_or([0.86, 0.78, 1.0]);
                let geometry = string_at(node, &["geometry"]).unwrap_or_default();
                let shape = if matches!(geometry.as_str(), "sphere" | "cylinder" | "cone") {
                    1.0
                } else {
                    0.0
                };
                let brightness = number_at(node, &["material", "emissiveIntensity"])
                    .unwrap_or(0.85)
                    .clamp(0.1, 4.0) as f32;
                items.push(stage3d_overlay_item(
                    position,
                    dimensions[0].abs() * scale[0].abs(),
                    dimensions[1].abs().max(dimensions[2].abs()) * scale[1].abs(),
                    [color[0], color[1], color[2], 0.42],
                    shape,
                    rotation[2],
                    brightness,
                ));
            }
            "truss" | "imported-glb" => {
                let position = vec3_path_or(node, &["position"], [0.0, 1.0, 0.0]);
                let rotation = vec3_path_or(node, &["rotation"], [0.0, 0.0, 0.0]);
                let scale = vec3_path_or(node, &["scale"], [1.0, 1.0, 1.0]);
                let width = number_at(node, &["length"]).unwrap_or(3.0) as f32 * scale[0].abs();
                let height =
                    number_at(node, &["thickness"]).unwrap_or(0.28) as f32 * scale[1].abs();
                let color = color_path_or(node, &["color"]).unwrap_or([0.62, 0.66, 0.72]);
                items.push(stage3d_overlay_item(
                    position,
                    width,
                    height.max(0.2),
                    [color[0], color[1], color[2], 0.28],
                    0.0,
                    rotation[2],
                    0.85,
                ));
            }
            "spot-light" | "point-light" | "rect-area-light" => {
                let position = vec3_path_or(node, &["position"], [0.0, 3.0, 0.0]);
                let color = color_path_or(node, &["color"]).unwrap_or([1.0, 0.9, 0.65]);
                let intensity = number_at(node, &["intensity"])
                    .unwrap_or(1.0)
                    .clamp(0.1, 5.0) as f32;
                let radius = 0.55 + intensity * 0.18;
                items.push(stage3d_overlay_item(
                    position,
                    radius,
                    radius,
                    [color[0], color[1], color[2], 0.34],
                    1.0,
                    0.0,
                    intensity,
                ));
            }
            "laser" => {
                let position = vec3_path_or(node, &["position"], [0.0, 2.0, 0.0]);
                let rotation = vec3_path_or(node, &["rotation"], [0.0, 0.0, 0.0]);
                let color = color_path_or(node, &["color"]).unwrap_or([1.0, 0.1, 0.9]);
                let length = number_at(node, &["length"]).unwrap_or(5.0) as f32;
                let thickness = number_at(node, &["thickness"]).unwrap_or(0.05) as f32;
                let intensity = number_at(node, &["intensity"])
                    .unwrap_or(1.0)
                    .clamp(0.1, 5.0) as f32;
                items.push(stage3d_overlay_item(
                    position,
                    length,
                    thickness.max(0.12),
                    [color[0], color[1], color[2], 0.44],
                    0.0,
                    rotation[2],
                    intensity,
                ));
            }
            "fog-volume" => {
                let position = vec3_path_or(node, &["position"], [0.0, 1.2, 0.0]);
                let dimensions = vec3_path_or(node, &["dimensions"], [4.0, 2.0, 4.0]);
                let color = color_path_or(node, &["color"]).unwrap_or([0.55, 0.72, 1.0]);
                let density = number_at(node, &["density"])
                    .unwrap_or(0.5)
                    .clamp(0.05, 2.0) as f32;
                items.push(stage3d_overlay_item(
                    position,
                    dimensions[0],
                    dimensions[1],
                    [color[0], color[1], color[2], 0.16],
                    1.0,
                    0.0,
                    density,
                ));
            }
            _ => {}
        }
        collect_stage3d_overlay_nodes(node.get("children"), items);
    }
}

pub(crate) fn collect_stage3d_user_overlay_items(
    value: Option<&Value>,
    items: &mut Vec<Stage3DOverlayItemGpu>,
) {
    let Some(elements) = value.and_then(Value::as_array) else {
        return;
    };
    for element in elements {
        if items.len() >= MAX_STAGE3D_OVERLAY_ITEMS {
            return;
        }
        let position = vec3_path_or(element, &["position"], [0.0, 1.0, 0.0]);
        let scale = number_at(element, &["scale"])
            .unwrap_or(1.0)
            .clamp(0.05, 100.0) as f32;
        let element_type = string_at(element, &["type"]).unwrap_or_default();
        let width = number_at(element, &["params", "width"])
            .or_else(|| number_at(element, &["params", "w"]))
            .unwrap_or(1.6) as f32
            * scale;
        let height = number_at(element, &["params", "height"])
            .or_else(|| number_at(element, &["params", "h"]))
            .unwrap_or(1.0) as f32
            * scale;
        let is_round = element_type.contains("sphere")
            || element_type.contains("ball")
            || element_type.contains("head")
            || element_type.contains("light");
        let color = color_path_or(element, &["params", "color"])
            .or_else(|| color_path_or(element, &["params", "lightColor"]))
            .unwrap_or(if is_round {
                [1.0, 0.74, 0.36]
            } else {
                [0.72, 0.76, 0.82]
            });
        items.push(stage3d_overlay_item(
            position,
            width,
            height,
            [color[0], color[1], color[2], 0.32],
            if is_round { 1.0 } else { 0.0 },
            number_at(element, &["rotationY"]).unwrap_or(0.0) as f32,
            1.0,
        ));
    }
}

pub(crate) fn stage3d_overlay_item(
    position: [f32; 3],
    width: f32,
    height: f32,
    color: [f32; 4],
    shape: f32,
    rotation: f32,
    brightness: f32,
) -> Stage3DOverlayItemGpu {
    let center = stage3d_project_position(position);
    let depth_scale = (1.0 - position[2] * 0.012).clamp(0.45, 1.45);
    let half_width = (width.abs() * 0.055 * depth_scale).clamp(0.012, 1.15);
    let half_height = (height.abs() * 0.075 * depth_scale).clamp(0.012, 1.15);
    Stage3DOverlayItemGpu {
        center,
        half_size: [half_width, half_height],
        color,
        meta: [shape, rotation, brightness, 0.0],
    }
}

pub(crate) fn stage3d_project_position(position: [f32; 3]) -> [f32; 2] {
    [
        (position[0] / 18.0).clamp(-1.35, 1.35),
        ((position[1] - 1.8) / 8.0 - position[2] * 0.018).clamp(-1.35, 1.35),
    ]
}

pub(crate) fn collect_stage3d_mesh_nodes(
    value: Option<&Value>,
    items: &mut Vec<Stage3DMeshItemGpu>,
    app: &App,
) {
    let Some(nodes) = value.and_then(Value::as_array) else {
        return;
    };
    for node in nodes {
        if items.len() >= MAX_STAGE3D_MESH_ITEMS {
            return;
        }
        if !bool_at(node, &["visible"]).unwrap_or(true) {
            continue;
        }
        match node.get("type").and_then(Value::as_str).unwrap_or_default() {
            "led-screen" => {
                let position = vec3_path_or(node, &["position"], [0.0, 2.4, 0.0]);
                let rotation = vec3_path_or(node, &["rotation"], [0.0, 0.0, 0.0]);
                let scale = vec3_path_or(node, &["scale"], [1.0, 1.0, 1.0]);
                let width = number_at(node, &["width"]).unwrap_or(4.0) as f32 * scale[0].abs();
                let height = number_at(node, &["height"]).unwrap_or(2.25) as f32 * scale[1].abs();
                let brightness = number_at(node, &["brightness"])
                    .unwrap_or(1.0)
                    .clamp(0.1, 4.0) as f32;
                let source_slot = app.stage3d_source_slot_for_value(node.get("source"));
                items.push(stage3d_mesh_item(
                    position,
                    [width.max(0.05), height.max(0.05), 0.04],
                    rotation,
                    [0.18, 0.8, 1.0, (0.48 + brightness * 0.1).clamp(0.45, 0.82)],
                    0.0,
                    stage3d_material(source_slot, brightness, 0.0, 1.0),
                    [0.0, 0.0, 1.0, 0.0],
                ));
            }
            "primitive" | "svg-extrude" => {
                let position = vec3_path_or(node, &["position"], [0.0, 1.0, 0.0]);
                let rotation = vec3_path_or(node, &["rotation"], [0.0, 0.0, 0.0]);
                let scale = vec3_path_or(node, &["scale"], [1.0, 1.0, 1.0]);
                let dimensions = vec3_path_or(node, &["dimensions"], [1.5, 1.5, 1.5]);
                let geometry = string_at(node, &["geometry"]).unwrap_or_default();
                let color = color_path_or(node, &["material", "emissive"])
                    .or_else(|| color_path_or(node, &["material", "color"]))
                    .unwrap_or([0.78, 0.68, 1.0]);
                let alpha = if node
                    .get("material")
                    .and_then(|m| m.get("emissive"))
                    .is_some()
                {
                    0.72
                } else {
                    0.5
                };
                items.push(stage3d_mesh_item(
                    position,
                    [
                        (dimensions[0] * scale[0]).abs().max(0.08),
                        (dimensions[1] * scale[1]).abs().max(0.08),
                        (dimensions[2] * scale[2]).abs().max(0.08),
                    ],
                    rotation,
                    [color[0], color[1], color[2], alpha],
                    stage3d_geometry_shape_code(&geometry),
                    stage3d_material(None, 1.0, 0.0, 1.0),
                    [0.0, 0.0, 1.0, 0.0],
                ));
            }
            "truss" | "imported-glb" => {
                let position = vec3_path_or(node, &["position"], [0.0, 1.0, 0.0]);
                let rotation = vec3_path_or(node, &["rotation"], [0.0, 0.0, 0.0]);
                let scale = vec3_path_or(node, &["scale"], [1.0, 1.0, 1.0]);
                let width = number_at(node, &["length"]).unwrap_or(2.5) as f32 * scale[0].abs();
                let thickness =
                    number_at(node, &["thickness"]).unwrap_or(0.24) as f32 * scale[1].abs();
                let color = color_path_or(node, &["color"]).unwrap_or([0.45, 0.48, 0.54]);
                items.push(stage3d_mesh_item(
                    position,
                    [width.max(0.1), thickness.max(0.08), thickness.max(0.08)],
                    rotation,
                    [color[0], color[1], color[2], 0.38],
                    1.0,
                    stage3d_material(None, 1.0, 0.0, 1.0),
                    [0.0, 0.0, 1.0, 0.0],
                ));
            }
            "spot-light" | "point-light" | "rect-area-light" => {
                let position = vec3_path_or(node, &["position"], [0.0, 3.0, 0.0]);
                let color = color_path_or(node, &["color"]).unwrap_or([1.0, 0.86, 0.55]);
                let intensity = number_at(node, &["intensity"])
                    .unwrap_or(1.0)
                    .clamp(0.1, 5.0) as f32;
                let size = 0.32 + intensity * 0.08;
                items.push(stage3d_mesh_item(
                    position,
                    [size, size, size],
                    [0.0, 0.0, 0.0],
                    [color[0], color[1], color[2], 0.62],
                    1.0,
                    stage3d_material(None, 1.0, 0.0, 1.0),
                    [0.0, 0.0, 1.0, 0.0],
                ));
            }
            "fog-volume" => {
                let position = vec3_path_or(node, &["position"], [0.0, 1.2, 0.0]);
                let dimensions = vec3_path_or(node, &["dimensions"], [4.0, 2.0, 4.0]);
                let color = color_path_or(node, &["color"]).unwrap_or([0.42, 0.62, 1.0]);
                let density = number_at(node, &["density"])
                    .unwrap_or(0.5)
                    .clamp(0.05, 2.0) as f32;
                items.push(stage3d_mesh_item(
                    position,
                    [
                        dimensions[0].abs().max(0.1),
                        dimensions[1].abs().max(0.1),
                        dimensions[2].abs().max(0.1),
                    ],
                    [0.0, 0.0, 0.0],
                    [
                        color[0],
                        color[1],
                        color[2],
                        (0.10 + density * 0.08).min(0.26),
                    ],
                    1.0,
                    stage3d_material(None, 1.0, 0.0, 1.0),
                    [0.0, 0.0, 1.0, 0.0],
                ));
            }
            _ => {}
        }
        collect_stage3d_mesh_nodes(node.get("children"), items, app);
    }
}

pub(crate) fn collect_stage3d_user_mesh_items(
    value: Option<&Value>,
    items: &mut Vec<Stage3DMeshItemGpu>,
    app: &App,
) {
    let Some(elements) = value.and_then(Value::as_array) else {
        return;
    };
    for element in elements {
        if items.len() >= MAX_STAGE3D_MESH_ITEMS {
            return;
        }
        let scalar = number_at(element, &["scale"])
            .unwrap_or(1.0)
            .clamp(0.05, 100.0) as f32;
        let (mesh_scale, shape, y_offset) = stage3d_user_mesh_spec(element, scalar);
        let mut position = vec3_path_or(element, &["position"], [0.0, 1.0, 0.0]);
        position[1] += y_offset;
        let color = color_path_or(element, &["params", "color"])
            .or_else(|| color_path_or(element, &["params", "lightColor"]))
            .unwrap_or([0.78, 0.8, 0.86]);
        let brightness = number_at(element, &["params", "brightness"])
            .unwrap_or(1.0)
            .clamp(0.0, 8.0) as f32;
        let opacity = number_at(element, &["params", "opacity"])
            .unwrap_or(1.0)
            .clamp(0.0, 1.0) as f32;
        let source_slot = app.stage3d_source_slot_for_value(element.pointer("/params/vjSource"));
        let uv_mode = string_at(element, &["params", "uvMode"])
            .map(|mode| stage3d_uv_mode(&mode))
            .unwrap_or(0.0);
        let uv_zoom = number_at(element, &["params", "uvZoom"])
            .unwrap_or(1.0)
            .clamp(0.05, 64.0) as f32;
        let uv_offset_x = number_at(element, &["params", "uvOffsetX"])
            .unwrap_or(0.0)
            .clamp(-64.0, 64.0) as f32;
        let uv_offset_y = number_at(element, &["params", "uvOffsetY"])
            .unwrap_or(0.0)
            .clamp(-64.0, 64.0) as f32;
        let uv_rotation = number_at(element, &["params", "uvRotation"]).unwrap_or(0.0) as f32
            * std::f32::consts::PI
            / 180.0;
        let rotation = [
            number_at(element, &["rotationX"]).unwrap_or(0.0) as f32,
            number_at(element, &["rotationY"]).unwrap_or(0.0) as f32,
            number_at(element, &["rotationZ"]).unwrap_or(0.0) as f32,
        ];
        items.push(stage3d_mesh_item(
            position,
            mesh_scale,
            rotation,
            [
                color[0],
                color[1],
                color[2],
                (0.18 + opacity * 0.62).clamp(0.18, 0.86),
            ],
            shape,
            stage3d_material(source_slot, brightness, uv_mode, opacity),
            [uv_offset_x, uv_offset_y, uv_zoom, uv_rotation],
        ));
    }
}

pub(crate) fn stage3d_param_number(element: &Value, keys: &[&str], fallback: f32) -> f32 {
    let Some(params) = element.get("params") else {
        return fallback;
    };
    for key in keys {
        if let Some(value) = params.get(*key).and_then(Value::as_f64) {
            return value.clamp(-1.0e6, 1.0e6) as f32;
        }
    }
    fallback
}

pub(crate) fn stage3d_user_mesh_spec(element: &Value, scalar: f32) -> ([f32; 3], f32, f32) {
    let element_type = string_at(element, &["type"]).unwrap_or_default();
    let safe_scalar = scalar.abs().max(0.05);
    let spec = match element_type.as_str() {
        "visualpanel" => {
            let w = stage3d_param_number(element, &["width", "w"], 10.0);
            let h = stage3d_param_number(element, &["height", "h"], 5.0);
            let d = stage3d_param_number(element, &["depth", "d"], 0.12);
            ([w, h, d], 1.0, h * 0.5)
        }
        "visualbox" => {
            let w = stage3d_param_number(element, &["width", "w"], 8.0);
            let h = stage3d_param_number(element, &["height", "h"], 4.0);
            let d = stage3d_param_number(element, &["depth", "d"], 1.0);
            ([w, h, d], 1.0, h * 0.5)
        }
        "visualcube" => {
            let size = stage3d_param_number(element, &["size"], 5.0);
            ([size, size, size], 1.0, size * 0.5)
        }
        "visualsphere" => {
            let radius = stage3d_param_number(element, &["radius", "r"], 4.0);
            ([radius * 2.0, radius * 2.0, radius * 2.0], 2.0, radius)
        }
        "visualhemi" | "visualdome" | "visualhemisphere" => {
            let radius = stage3d_param_number(element, &["radius", "r"], 8.0);
            ([radius * 2.0, radius * 2.0, radius * 2.0], 3.0, 0.0)
        }
        "visualpyramid" => {
            let radius = stage3d_param_number(element, &["radius", "r"], 4.0);
            let height = stage3d_param_number(element, &["height", "h"], 6.0);
            ([radius * 2.0, height, radius * 2.0], 4.0, height * 0.5)
        }
        "visualcylinder" => {
            let radius = stage3d_param_number(element, &["radius", "r"], 3.0);
            let height = stage3d_param_number(element, &["height", "h"], 8.0);
            ([radius * 2.0, height, radius * 2.0], 5.0, height * 0.5)
        }
        "visualcone" => {
            let radius = stage3d_param_number(element, &["radius", "r"], 3.0);
            let height = stage3d_param_number(element, &["height", "h"], 7.0);
            ([radius * 2.0, height, radius * 2.0], 6.0, height * 0.5)
        }
        _ => {
            let w = stage3d_param_number(element, &["width", "w", "len"], 1.4);
            let h = stage3d_param_number(element, &["height", "h"], 1.0);
            let d = stage3d_param_number(element, &["depth", "d"], 1.0);
            ([w, h, d], 1.0, 0.0)
        }
    };
    (
        [
            (spec.0[0] * safe_scalar).abs().max(0.08),
            (spec.0[1] * safe_scalar).abs().max(0.08),
            (spec.0[2] * safe_scalar).abs().max(0.08),
        ],
        spec.1,
        spec.2 * safe_scalar,
    )
}

pub(crate) fn stage3d_mesh_item(
    position: [f32; 3],
    scale: [f32; 3],
    rotation: [f32; 3],
    color: [f32; 4],
    shape: f32,
    material: [f32; 4],
    uv: [f32; 4],
) -> Stage3DMeshItemGpu {
    Stage3DMeshItemGpu {
        position: [position[0], position[1], position[2], shape],
        scale: [scale[0], scale[1], scale[2], 0.0],
        rotation: [rotation[0], rotation[1], rotation[2], 0.0],
        color,
        material,
        uv,
    }
}

pub(crate) fn stage3d_material(
    source_slot: Option<usize>,
    brightness: f32,
    uv_mode: f32,
    opacity: f32,
) -> [f32; 4] {
    [
        source_slot
            .map(|slot| (slot + 1) as f32)
            .unwrap_or(0.0),
        brightness.clamp(0.0, 8.0),
        uv_mode,
        opacity.clamp(0.0, 1.0),
    ]
}

pub(crate) fn stage3d_default_lighting_uniform() -> [f32; 4] {
    [0.0, 1.0, 1.0, 1.0]
}

pub(crate) fn stage3d_default_atmosphere_uniform() -> [f32; 4] {
    [0.0, 0.0, 0.0, 0.0]
}

pub(crate) fn stage3d_scene_lighting_uniform(scene: &Value) -> ([f32; 4], [f32; 4]) {
    let lighting = scene.get("lighting");
    let room_darkness = lighting
        .and_then(|value| number_at(value, &["roomDarkness"]))
        .unwrap_or(0.0)
        .clamp(0.0, 1.0) as f32;
    let screen_boost = lighting
        .and_then(|value| number_at(value, &["screenBoost"]))
        .unwrap_or(1.0)
        .clamp(0.0, 8.0) as f32;
    let exposure = lighting
        .and_then(|value| number_at(value, &["exposure"]))
        .filter(|value| *value > 0.0)
        .unwrap_or(1.0)
        .clamp(0.02, 8.0) as f32;
    let room_intensity = lighting
        .and_then(|value| number_at(value, &["roomIntensity"]))
        .unwrap_or(1.0)
        .clamp(0.0, 8.0) as f32;

    let atmosphere = scene.get("atmosphere");
    let haze_enabled = atmosphere
        .and_then(|value| bool_at(value, &["haze"]))
        .unwrap_or(false);
    let haze_density = if haze_enabled {
        atmosphere
            .and_then(|value| number_at(value, &["hazeDensity"]))
            .unwrap_or(1.0)
            .clamp(0.0, 4.0) as f32
    } else {
        0.0
    };

    (
        [room_darkness, screen_boost, exposure, room_intensity],
        [haze_density, 0.0, 0.0, 0.0],
    )
}

pub(crate) fn stage3d_uv_mode(mode: &str) -> f32 {
    match mode.trim().to_ascii_lowercase().as_str() {
        "mirror" => 1.0,
        "radial" => 2.0,
        "dome" => 3.0,
        "wrap" => 4.0,
        _ => 0.0,
    }
}

pub(crate) fn stage3d_geometry_shape_code(geometry: &str) -> f32 {
    match geometry.trim().to_ascii_lowercase().as_str() {
        "plane" | "panel" | "quad" => 0.0,
        "sphere" | "ball" => 2.0,
        "hemisphere" | "half-sphere" | "half_sphere" | "dome" => 3.0,
        "pyramid" => 4.0,
        "cylinder" | "column" => 5.0,
        "cone" => 6.0,
        _ => 1.0,
    }
}

pub(crate) fn stage3d_mesh_wgsl(mode: SourceFrameMode, bindings: usize) -> String {
    let body = STAGE3D_MESH_WGSL.replace(
        "//#SOURCE_FRAMES",
        &source_frames::compositor_source_frames_wgsl(mode, 1, 0, bindings),
    );
    format!("{}{body}", source_frames::source_frames_enable(mode))
}

pub(crate) fn build_stage3d_mesh_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    item_buffer: &wgpu::Buffer,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Ghost Render Core Stage3D Mesh Bind Group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: item_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    })
}

impl App {
    pub(crate) fn set_stage3d_scene(&mut self, params: &Value) -> Result<Value, String> {
        // A null scene is an explicit CLEAR — the stage environment must
        // never linger in the composite after the 3D view closes.
        let scene_value = params
            .get("scene")
            .or_else(|| params.get("stage3d"))
            .unwrap_or(params);
        if scene_value.is_null() {
            eprintln!("[ghost-core] stage3d scene CLEARED");
            self.stage3d_scene = None;
            self.stage3d_scene_summary = NativeSceneBridgeSummary::empty("stage3d");
            return Ok(json!(self.stage3d_scene_summary.clone()));
        }
        let scene = scene_payload(params, "stage3d")?;
        let summary = summarize_stage3d_scene(scene);
        eprintln!("[ghost-core] stage3d scene SET");
        self.stage3d_scene = Some(scene.clone());
        self.stage3d_scene_summary = summary.clone();
        Ok(json!(summary))
    }

    pub(crate) fn scene_overlay_items(&self) -> Vec<Stage3DOverlayItemGpu> {
        let mut items = Vec::new();
        if let Some(scene) = self.stage3d_scene.as_ref() {
            collect_stage3d_overlay_nodes(scene.get("nodes"), &mut items);
            collect_stage3d_user_overlay_items(scene.get("userElements"), &mut items);
        }
        if let Some(scene) = self.projection_sim_scene.as_ref() {
            collect_projection_sim_overlay_items(scene, &mut items);
        }
        items
    }

    pub(crate) fn stage3d_mesh_frame(&self) -> Option<Stage3DMeshFrame> {
        let mut items = Vec::new();
        let mut camera = None;
        let mut lighting = stage3d_default_lighting_uniform();
        let mut atmosphere = stage3d_default_atmosphere_uniform();
        if let Some(scene) = self.stage3d_scene.as_ref() {
            collect_stage3d_mesh_nodes(scene.get("nodes"), &mut items, self);
            collect_stage3d_user_mesh_items(scene.get("userElements"), &mut items, self);
            camera = scene.get("camera");
            let scene_lighting = stage3d_scene_lighting_uniform(scene);
            lighting = scene_lighting.0;
            atmosphere = scene_lighting.1;
        }
        if let Some(scene) = self.projection_sim_scene.as_ref() {
            collect_projection_sim_mesh_items(scene, &mut items, self);
            if camera.is_none() {
                camera = scene.get("camera");
            }
        }
        if items.is_empty() {
            return None;
        }
        Some(Stage3DMeshFrame {
            camera_pos: camera
                .map(|value| vec3_path_or(value, &["position"], [12.0, 6.0, 14.0]))
                .unwrap_or([12.0, 6.0, 14.0]),
            camera_target: camera
                .map(|value| vec3_path_or(value, &["target"], [0.0, 2.0, 0.0]))
                .unwrap_or([0.0, 2.0, 0.0]),
            fov_degrees: camera
                .and_then(|value| number_at(value, &["fov"]))
                .unwrap_or(50.0)
                .clamp(12.0, 120.0) as f32,
            lighting,
            atmosphere,
            items,
        })
    }

    pub(crate) fn stage3d_source_slot_for_text(&self, value: &str) -> Option<usize> {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("solid") {
            return None;
        }
        if trimmed.eq_ignore_ascii_case("master") {
            return self.first_visible_source_frame_slot();
        }
        if let Some(slot) = self.source_frame_slots.get(trimmed).copied() {
            return Some(slot);
        }
        if let Some(slot) = self.scene_layer_source_slot(trimmed) {
            return Some(slot);
        }
        if let Ok(index) = trimmed.parse::<i32>() {
            return self
                .scene_layers
                .values()
                .filter(|layer| layer.visible && layer.vj_layer_index == Some(index))
                .min_by_key(|layer| layer.z_index)
                .and_then(|layer| self.scene_layer_source_slot(&layer.id));
        }
        None
    }

    pub(crate) fn stage3d_source_slot_for_value(&self, value: Option<&Value>) -> Option<usize> {
        let value = value?;
        if let Some(text) = value.as_str() {
            return self.stage3d_source_slot_for_text(text);
        }
        value
            .as_i64()
            .and_then(|index| self.stage3d_source_slot_for_text(&index.to_string()))
    }

    pub(crate) fn scene_layer_source_slot(&self, layer_id: &str) -> Option<usize> {
        let layer = self.scene_layers.get(layer_id)?;
        layer.frame_slot.or_else(|| {
            layer
                .source_id
                .as_deref()
                .and_then(|source_id| self.source_frame_slots.get(source_id).copied())
        })
    }

    pub(crate) fn first_visible_source_frame_slot(&self) -> Option<usize> {
        self.scene_layers
            .values()
            .filter(|layer| layer.visible)
            .min_by_key(|layer| layer.z_index)
            .and_then(|layer| self.scene_layer_source_slot(&layer.id))
    }
}

impl RenderState {
    pub(crate) fn draw_stage3d_overlay_to_view(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        label: &'static str,
        time_seconds: Option<f32>,
        overlay_items: &[Stage3DOverlayItemGpu],
    ) {
        let item_count = overlay_items.len().min(MAX_STAGE3D_OVERLAY_ITEMS);
        if item_count == 0 {
            return;
        }
        churn_probe::write_buffer(&self.queue, 
            &self.stage3d_overlay_uniform_buffer,
            0,
            bytemuck::bytes_of(&Stage3DOverlayUniforms {
                resolution: [self.config.width as f32, self.config.height as f32],
                item_count: item_count as f32,
                time: time_seconds.unwrap_or_else(|| shader_clock_seconds(self.start_time.elapsed().as_secs_f64())),
            }),
        );
        churn_probe::write_buffer(&self.queue, 
            &self.stage3d_overlay_item_buffer,
            0,
            bytemuck::cast_slice(&overlay_items[..item_count]),
        );

        let pass_time = pass_timing::slot(label);
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes: pass_timing::render_writes(&pass_time),
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.stage3d_overlay_pipeline);
        pass.set_bind_group(0, &self.stage3d_overlay_bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    pub(crate) fn draw_stage3d_mesh_to_view(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        label: &'static str,
        time_seconds: Option<f32>,
        frame: Option<&Stage3DMeshFrame>,
    ) {
        let Some(frame) = frame else {
            return;
        };
        let item_count = frame.items.len().min(MAX_STAGE3D_MESH_ITEMS);
        if item_count == 0 {
            return;
        }
        let aspect = self.config.width.max(1) as f32 / self.config.height.max(1) as f32;
        churn_probe::write_buffer(&self.queue, 
            &self.stage3d_mesh_uniform_buffer,
            0,
            bytemuck::bytes_of(&Stage3DMeshUniforms {
                resolution: [self.config.width as f32, self.config.height as f32],
                item_count: item_count as f32,
                time: time_seconds.unwrap_or_else(|| shader_clock_seconds(self.start_time.elapsed().as_secs_f64())),
                camera_pos: [
                    frame.camera_pos[0],
                    frame.camera_pos[1],
                    frame.camera_pos[2],
                    0.0,
                ],
                camera_target: [
                    frame.camera_target[0],
                    frame.camera_target[1],
                    frame.camera_target[2],
                    0.0,
                ],
                params: [
                    frame.fov_degrees.to_radians().clamp(0.2, 2.6),
                    aspect,
                    0.05,
                    180.0,
                ],
                lighting: frame.lighting,
                atmosphere: frame.atmosphere,
            }),
        );
        churn_probe::write_buffer(&self.queue, 
            &self.stage3d_mesh_item_buffer,
            0,
            bytemuck::cast_slice(&frame.items[..item_count]),
        );

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &self.stage3d_mesh_depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Discard,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.stage3d_mesh_pipeline);
        pass.set_bind_group(0, &self.stage3d_mesh_bind_group, &[]);
        pass.set_bind_group(1, &self.source_frames_bind_group, &[]);
        pass.draw(0..144, 0..item_count as u32);
    }
}
