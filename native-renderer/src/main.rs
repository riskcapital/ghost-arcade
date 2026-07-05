#![recursion_limit = "512"]

mod shared_texture;

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

use base64::Engine;
use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared_texture::SharedTextureSourceFrameDescriptor;
use wgpu::util::{DeviceExt, TextureBlitter, TextureBlitterBuilder};
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalPosition, LogicalSize, PhysicalSize},
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    window::{Fullscreen, Window, WindowAttributes, WindowId},
};

const MAX_SCENE_LAYERS: usize = 64;
const MAX_SOURCE_PREVIEWS: usize = 16;
const SOURCE_PREVIEW_SIZE: usize = 256;
const SOURCE_PREVIEW_PIXELS: usize = SOURCE_PREVIEW_SIZE * SOURCE_PREVIEW_SIZE;
const MAX_SOURCE_FRAME_SLOTS: usize = 8;
const SOURCE_FRAME_SIZE_PERFORMANCE: usize = 1024;
const SOURCE_FRAME_SIZE_BALANCED: usize = 1536;
const SOURCE_FRAME_SIZE_DEFAULT: usize = 2048;
const SOURCE_FRAME_SIZE_INSANE: usize = 3072;
const SOURCE_FRAME_MIP_LEVELS_MAX: u32 = 5;
const MAX_NATIVE_IMAGE_DECODE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_NATIVE_IMAGE_DECODE_PIXELS: u64 = 8192 * 8192;
const MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION: usize = 4096;
const NATIVE_VIDEO_FRAME_CACHE_MAX_ENTRIES: usize = 8;
const NATIVE_VIDEO_FRAME_CACHE_MAX_BYTES: usize = 192 * 1024 * 1024;
const NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES: u32 = 4;
const NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS: f64 = 30.0;
const NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS: f64 = 1.0;
const NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS: f64 = 120.0;
const NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT: usize = 2;
const NATIVE_VIDEO_DECODE_PUMP_PER_TICK: usize = 1;
const NATIVE_VIDEO_DECODE_PUMP_WINDOW_FRAMES: u32 = 2;
const SOURCE_FRAME_FORMAT_FALLBACK: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const SOURCE_FRAME_FORMAT_HDR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const MAX_STAGE3D_OVERLAY_ITEMS: usize = 128;
const MAX_STAGE3D_MESH_ITEMS: usize = 128;
const DEFAULT_COMMAND_QUEUE_CAPACITY: u32 = 8192;
const DEFAULT_COMMAND_DRAIN_LIMIT: u32 = 1024;
const GHOST_AUDIO_LAYOUT_SCHEMA_VERSION: u32 = 1;
const GHOST_AUDIO0_FIELDS: [&str; 4] = ["level", "bass", "mid", "treble"];
const GHOST_AUDIO1_FIELDS: [&str; 4] = ["high", "beat", "beat_phase", "bpm"];
const GHOST_AUDIO2_FIELDS: [&str; 4] = ["centroid", "kick", "snare", "active"];

fn ghost_audio_uniform_layout() -> Value {
    json!({
        "schema_version": GHOST_AUDIO_LAYOUT_SCHEMA_VERSION,
        "audio0": GHOST_AUDIO0_FIELDS,
        "audio1": GHOST_AUDIO1_FIELDS,
        "audio2": GHOST_AUDIO2_FIELDS,
    })
}
const SOURCE_FRAME_SLOT_OFFSET: f32 = 100.0;
const NATIVE_SHADER_SOURCE_KIND: f32 = 17.0;
const GPU_TIMESTAMP_READ_BYTES: u64 = 16;
const COMPUTE_READBACK_PREVIEW_WORDS: usize = 128;
const CORE_RPC_METHODS: &[&str] = &[
    "start",
    "stop",
    "status",
    "get_status",
    "stats",
    "get_stats",
    "snapshot",
    "get_snapshot",
    "frame_snapshot",
    "get_frame_snapshot",
    "export_frame_snapshot",
    "prefetch_media",
    "clear_prefetch_cache",
    "clear_decode_preview_cache",
    "decode_capabilities",
    "get_decode_capabilities",
    "upload_source_gpu_shared_texture",
    "output_shared_texture",
    "get_output_shared_texture",
    "set_stage3d_scene",
    "get_stage3d_scene_summary",
    "set_projection_sim_scene",
    "get_projection_sim_scene_summary",
    "readiness",
    "get_readiness_report",
    "reset_stats",
    "submit_batch",
    "submit_commands",
    "set_output",
    "set_output_window",
    "set_present_policy",
    "set_command_drain_policy",
    "set_auto_present_policy",
    "attach_output_window",
    "detach_output_window",
    "set_target_fps",
    "set_native_quality_policy",
    "set_render_clock",
    "set_shader_precompile_policy",
    "set_texture_pool_cap",
    "set_vram_budget",
    "set_decode_cpu_backup_policy",
    "set_decode_synthetic_fallback_policy",
    "set_media_prefetch_policy",
    "set_media_drop_policy",
    "set_decode_preview_policy",
    "set_decode_target_policy",
    "set_decode_upload_policy",
    "set_decode_handoff_policy",
    "set_decode_estimate_cache_policy",
    "set_metadata_cache_caps",
    "clear_runtime_caches",
    "present",
    "capabilities",
    "get_capabilities",
    "compute_probe",
    "run_compute_probe",
    "compute_graph",
    "run_compute_graph",
    "shutdown",
];
const CORE_COMMAND_TYPES: &[&str] = &[
    "set_output",
    "set_present_policy",
    "set_command_drain_policy",
    "set_command_drain_limit",
    "set_auto_present_policy",
    "set_vram_budget",
    "set_decode_cpu_backup_policy",
    "set_decode_synthetic_fallback_policy",
    "set_media_prefetch_policy",
    "set_media_drop_policy",
    "set_decode_preview_policy",
    "set_decode_target_policy",
    "set_decode_upload_policy",
    "set_decode_handoff_policy",
    "set_decode_estimate_cache_policy",
    "set_media_source_playback",
    "upsert_layer",
    "set_layer_visibility",
    "set_layer_color",
    "set_layer_native_params",
    "set_effect_chain",
    "set_texture_pool_cap",
    "set_shader_precompile_policy",
    "set_metadata_cache_caps",
    "present",
    "set_native_quality_policy",
    "set_audio_state",
    "set_render_clock",
    "bind_media_source",
    "decode_media_source",
    "upload_source_preview",
    "upload_source_frame",
    "upload_source_gpu_shared_texture",
    "set_stage3d_scene",
    "set_projection_sim_scene",
    "precompile_shader",
    "bind_isf_shader",
    "update_isf_uniforms",
    "render_isf_to_layer",
    "remove_layer",
];
const NATIVE_SHADER_FULLSCREEN_VERTEX_WGSL: &str = r#"
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
"#;
const STAGE3D_OVERLAY_WGSL: &str = r#"
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
const STAGE3D_MESH_WGSL: &str = r#"
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

@group(0) @binding(2)
var source_frames: texture_2d_array<f32>;

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
  let light = normalize(vec3<f32>(-0.3, 0.75, 0.55));
  let shade = 0.48 + 0.52 * clamp(dot(normalize(in.normal + vec3<f32>(0.0, 0.15, 0.0)), light), 0.0, 1.0);
  let haze_density = clamp(u.atmosphere.x, 0.0, 4.0);
  let haze_floor = clamp(0.58 - haze_density * 0.22, 0.18, 0.80);
  let haze = clamp(1.0 - in.view_z * (0.012 + haze_density * 0.012), haze_floor, 1.0);
  let opacity = clamp(in.material.w, 0.0, 1.0);
  var alpha = clamp(in.color.a * opacity, 0.0, 0.96);
  let room_visibility = clamp(1.0 - u.lighting.x, 0.0, 1.0);
  let screen_boost = max(0.0, u.lighting.y);
  let exposure = max(0.02, u.lighting.z);
  let room_light = room_visibility * max(0.0, u.lighting.w) * exposure;
  let source_active = select(0.0, 1.0, in.material.x >= 0.5);
  let light_mul = mix(room_light, screen_boost, source_active);
  var rgb = in.color.rgb;
  if (in.material.x >= 0.5) {
    let source_slot = i32(clamp(floor(in.material.x - 1.0 + 0.5), 0.0, 7.0));
    let tex = textureSampleLevel(source_frames, source_sampler, in.uv, source_slot, 0.0);
    rgb = mix(rgb, tex.rgb, clamp(opacity, 0.0, 1.0));
    alpha = clamp(in.color.a * opacity * tex.a, 0.0, 0.96);
  }
  rgb *= max(0.0, in.material.y) * light_mul;
  return vec4<f32>(rgb * shade * haze * alpha, alpha);
}
"#;

#[derive(Debug)]
enum UserEvent {
    Rpc(RpcRequest),
    NativeVideoFrameDecoded(NativeVideoFrameDecodeResult),
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Clone, Debug)]
struct NativeVideoFrameDecodeJob {
    source_id: String,
    uri: String,
    path: PathBuf,
    width: usize,
    height: usize,
    time_seconds: f64,
    frame_bucket: u64,
    signature: String,
    seq: u64,
}

#[derive(Debug)]
struct NativeVideoFrameDecodeResult {
    source_id: String,
    uri: String,
    frame_bucket: u64,
    signature: String,
    seq: u64,
    result: Result<Vec<NativeVideoFrameDecodeOutput>, String>,
}

#[derive(Debug)]
struct NativeVideoFrameDecodeOutput {
    width: usize,
    height: usize,
    frame_bucket: u64,
    signature: String,
    rgba: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
struct CoreStatus {
    running: bool,
    backend: String,
    backend_ready: bool,
    adapter_name: Option<String>,
    native_caps: NativeGpuCaps,
    native_quality: NativeQualityState,
    width: u32,
    height: u32,
    target_fps: u32,
    present_mode: String,
    surface_present_mode: String,
    allow_tearing: bool,
    max_frame_latency: u32,
    use_waitable_object: bool,
    command_queue_capacity: u32,
    command_drain_limit: u32,
    auto_present_on_state_change: bool,
    decode_store_cpu_backup_frames: bool,
    decode_allow_synthetic_fallback: bool,
    media_queue_capacity: u32,
    decode_handoff_queue_capacity: u32,
    media_high_burst_limit: u32,
    prefetch_cache_max_entries: u32,
    prefetch_cache_prune_count: u32,
    media_drop_command_pressure_pct: u32,
    media_drop_decode_pressure_pct: u32,
    media_drop_io_pressure_pct: u32,
    media_drop_decode_priority_cutoff: u32,
    media_drop_io_priority_cutoff: u32,
    decode_preview_size: u32,
    decode_preview_cache_mb: u32,
    decode_use_output_resolution: bool,
    decode_target_width: u32,
    decode_target_height: u32,
    decode_preview_cache_bypassed: bool,
    decode_upload_queue_cap_mb: u32,
    decode_handoff_byte_cap_mb: u32,
    decode_handoff_predecode_shed_pct: u32,
    decode_predecode_estimate_cache_entries: u32,
    decode_predecode_estimate_cache_cap_entries: u32,
    decode_predecode_estimate_cache_backpressure_active: bool,
    decode_backpressure_active: bool,
    decode_jobs_submitted: u64,
    decode_jobs_completed: u64,
    decode_jobs_dropped: u64,
    decode_queue_peak: u64,
    vram_budget_mb: u32,
    command_drain_limit_hits: u64,
    queued_commands_after_drain: u64,
    source_preview_size: u32,
    source_previews_active: u32,
    source_preview_slots: u32,
    source_preview_dirty: bool,
    source_frame_size: u32,
    source_frame_format: String,
    source_frame_hdr: bool,
    source_frame_mip_levels: u32,
    source_frames_active: u32,
    source_frame_slots: u32,
    isf_shader_bindings: u32,
    isf_uniform_sets: u32,
    native_shader_layers: u32,
    native_procedural_layers: u32,
    native_instrument_layers: u32,
    native_instrument_proxy_layers: u32,
    native_graph_source_frame_layers: u32,
    shader_precompile_queue_cap: u32,
    shader_precompile_per_frame: u32,
    shader_metadata_cache_cap: u32,
    pipeline_metadata_cache_cap: u32,
    texture_pool_cap_mb: u32,
    shader_cache_entries: u32,
    pipeline_cache_entries: u32,
    precompiled_vertex_shaders: u32,
    precompiled_pixel_shaders: u32,
    shader_precompile_queued: u64,
    shader_precompile_compiled: u64,
    shader_precompile_failed: u64,
    shader_precompile_dropped: u64,
    source_frame_uploads: u64,
    source_frame_bytes_uploaded: u64,
    source_frame_cpu_fallback_uploads: u64,
    source_frame_file_uploads: u64,
    source_frame_base64_uploads: u64,
    source_frame_json_uploads: u64,
    source_frame_shared_texture_uploads: u64,
    source_frame_shared_texture_rejected_uploads: u64,
    source_frame_rejected_uploads: u64,
    source_frame_input_bytes_uploaded: u64,
    source_frame_resampled_bytes_uploaded: u64,
    source_frame_last_input_bytes: u64,
    source_frame_last_upload_bytes: u64,
    source_frame_last_upload_width: u32,
    source_frame_last_upload_height: u32,
    source_frame_last_upload_transport: String,
    source_frame_last_reject_reason: String,
    native_image_decodes: u64,
    native_image_decode_failures: u64,
    native_image_decode_bytes_uploaded: u64,
    native_image_decode_last_error: String,
    native_video_frame_decodes: u64,
    native_video_frame_decode_failures: u64,
    native_video_frame_decode_bytes_uploaded: u64,
    native_video_frame_decode_last_error: String,
    native_video_frame_cache_entries: u32,
    native_video_frame_cache_bytes: u64,
    native_video_frame_cache_hits: u64,
    native_video_frame_cache_misses: u64,
    native_video_frame_cache_evictions: u64,
    native_instrument_frame_renders: u64,
    compute_graph_runs: u64,
    compute_graph_passes: u64,
    compute_graph_render_passes: u64,
    compute_graph_snapshot_renders: u64,
    compute_graph_source_frame_renders: u64,
    compute_graph_readbacks: u64,
    compute_graph_readback_bytes: u64,
    compute_graph_persistent_buffers: u32,
    render_clock_mode: String,
    render_clock_time: f32,
    render_clock_frame_index: u64,
    render_clock_updates: u64,
    frame_snapshot_reads: u64,
    frame_snapshot_bytes_read: u64,
    frame_health_checks: u64,
    dark_frame_warnings: u64,
    last_frame_checksum: Option<String>,
    last_frame_nonzero_pixels: u64,
    last_frame_bright_pixels: u64,
    last_frame_average_luma: f64,
    last_frame_max_luma: f64,
    last_frame_dark: bool,
    last_shader_error: Option<String>,
    frames_presented: u64,
    commands_applied: u64,
    commands_dropped: u64,
    layers_seen: u32,
    output_width: u32,
    output_height: u32,
    output_format: String,
    output_refresh_hz: u32,
    output_window_attached: bool,
    output_swapchain_ready: bool,
    output_tearing_active: bool,
    output_waitable_object_active: bool,
    output_present_healthy: bool,
    output_present_consecutive_failures: u32,
    swapchain_present_attempts: u64,
    swapchain_presented: u64,
    swapchain_present_failures: u64,
    swapchain_last_present_result: String,
    swapchain_last_present_error: String,
    swapchain_present_timeouts: u64,
    swapchain_present_occluded: u64,
    swapchain_present_outdated: u64,
    swapchain_present_lost: u64,
    swapchain_present_validation_errors: u64,
    swapchain_present_max_consecutive_failures: u32,
    swapchain_present_tearing_attempts: u64,
    swapchain_waitable_waits: u64,
    swapchain_waitable_timeouts: u64,
    frames_without_swapchain_present: u64,
    supports_tearing: bool,
    supports_waitable_object: bool,
    gpu_timing_supported: bool,
    avg_render_cpu_ms: f64,
    last_render_gpu_ms: f64,
    avg_render_gpu_ms: f64,
    max_render_gpu_ms: f64,
    gpu_timing_samples: u64,
    gpu_timing_resolve_misses: u64,
    last_frame_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
struct NativeGpuCaps {
    adapter_name: String,
    adapter_vendor: u32,
    adapter_device: u32,
    adapter_device_type: String,
    adapter_driver: String,
    adapter_driver_info: String,
    max_texture_dimension_2d: u32,
    max_texture_dimension_3d: u32,
    max_texture_array_layers: u32,
    max_bind_groups: u32,
    max_bindings_per_bind_group: u32,
    max_sampled_textures_per_shader_stage: u32,
    max_storage_buffers_per_shader_stage: u32,
    max_storage_textures_per_shader_stage: u32,
    max_uniform_buffer_binding_size: u64,
    max_storage_buffer_binding_size: u64,
    max_buffer_size: u64,
    max_compute_workgroup_storage_size: u32,
    max_compute_invocations_per_workgroup: u32,
    max_compute_workgroup_size_x: u32,
    max_compute_workgroup_size_y: u32,
    max_compute_workgroup_size_z: u32,
    max_compute_workgroups_per_dimension: u32,
    supports_shader_f16: bool,
    supports_float32_filterable: bool,
    supports_timestamp_query: bool,
    supports_timestamp_query_inside_encoders: bool,
    supports_timestamp_query_inside_passes: bool,
    supports_texture_binding_array: bool,
    supports_buffer_binding_array: bool,
    supports_storage_resource_binding_array: bool,
    supports_texture_adapter_specific_format_features: bool,
    requested_shader_f16: bool,
    requested_float32_filterable: bool,
    requested_timestamp_query: bool,
    requested_timestamp_query_inside_encoders: bool,
    requested_timestamp_query_inside_passes: bool,
    recommended_quality_tier: String,
}

#[derive(Clone, Debug, Serialize)]
struct NativeQualityState {
    policy: String,
    caps_tier: String,
    active_tier: String,
    quality_scale: f32,
    target_frame_ms: f64,
    cpu_ema_ms: f64,
    gpu_ema_ms: f64,
    overload_frames: u32,
    recovery_frames: u32,
    step_downs: u64,
    step_ups: u64,
}

impl Default for NativeQualityState {
    fn default() -> Self {
        Self {
            policy: "auto".to_string(),
            caps_tier: "balanced".to_string(),
            active_tier: "balanced".to_string(),
            quality_scale: tier_quality_scale("balanced"),
            target_frame_ms: 16.67,
            cpu_ema_ms: 0.0,
            gpu_ema_ms: 0.0,
            overload_frames: 0,
            recovery_frames: 0,
            step_downs: 0,
            step_ups: 0,
        }
    }
}

impl NativeQualityState {
    fn rebase_to_caps(&mut self, caps_tier: &str) {
        let tier = normalize_native_tier(caps_tier);
        self.caps_tier = tier.to_string();
        if self.policy == "auto" {
            self.active_tier = tier.to_string();
            self.quality_scale = tier_quality_scale(tier);
            self.overload_frames = 0;
            self.recovery_frames = 0;
        }
    }

    fn set_policy(&mut self, policy: &str) {
        let normalized = policy.trim().to_ascii_lowercase();
        if normalized == "auto" || normalized.is_empty() {
            self.policy = "auto".to_string();
            let tier = normalize_native_tier(&self.caps_tier);
            self.active_tier = tier.to_string();
            self.quality_scale = tier_quality_scale(tier);
        } else {
            let tier = normalize_native_tier(&normalized);
            self.policy = tier.to_string();
            self.active_tier = tier.to_string();
            self.quality_scale = tier_quality_scale(tier);
        }
        self.overload_frames = 0;
        self.recovery_frames = 0;
    }

    fn observe_frame(
        &mut self,
        render_ms: f64,
        render_gpu_ms: Option<f64>,
        target_fps: u32,
        native_task_count: usize,
    ) {
        let target_ms = 1000.0 / target_fps.max(1) as f64;
        self.target_frame_ms = target_ms;
        self.cpu_ema_ms = if self.cpu_ema_ms <= 0.0 {
            render_ms
        } else {
            self.cpu_ema_ms * 0.94 + render_ms * 0.06
        };
        if let Some(render_gpu_ms) = render_gpu_ms.filter(|value| value.is_finite() && *value > 0.0)
        {
            self.gpu_ema_ms = if self.gpu_ema_ms <= 0.0 {
                render_gpu_ms
            } else {
                self.gpu_ema_ms * 0.94 + render_gpu_ms * 0.06
            };
        }

        if self.policy != "auto" || native_task_count == 0 {
            self.overload_frames = 0;
            self.recovery_frames = 0;
            return;
        }

        let overload_ms = target_ms * 0.88;
        let recovery_ms = target_ms * 0.42;
        let budget_ms = if self.gpu_ema_ms > 0.0 {
            self.gpu_ema_ms
        } else {
            self.cpu_ema_ms
        };
        if budget_ms > overload_ms {
            self.overload_frames = self.overload_frames.saturating_add(1);
            self.recovery_frames = 0;
        } else if budget_ms < recovery_ms {
            self.recovery_frames = self.recovery_frames.saturating_add(1);
            self.overload_frames = 0;
        } else {
            self.overload_frames = 0;
            self.recovery_frames = 0;
        }

        if self.overload_frames >= 90 {
            if self.step_active_tier(-1) {
                self.step_downs = self.step_downs.saturating_add(1);
            }
            self.overload_frames = 0;
        } else if self.recovery_frames >= 240 {
            if self.step_active_tier(1) {
                self.step_ups = self.step_ups.saturating_add(1);
            }
            self.recovery_frames = 0;
        }
    }

    fn step_active_tier(&mut self, direction: i32) -> bool {
        let current = native_tier_index(&self.active_tier);
        let max_tier = native_tier_index(&self.caps_tier);
        let next = (current + direction).clamp(0, max_tier);
        if next == current {
            return false;
        }
        let tier = native_tier_for_index(next);
        self.active_tier = tier.to_string();
        self.quality_scale = tier_quality_scale(tier);
        true
    }
}

#[derive(Clone, Debug, Serialize, Default)]
struct CoreStats {
    frames_submitted: u64,
    frames_presented: u64,
    frames_presented_explicit: u64,
    frames_presented_auto: u64,
    commands_applied: u64,
    commands_dropped: u64,
    batch_commands_coalesced: u64,
    command_queue_peak: u64,
    command_drain_limit_hits: u64,
    queued_commands_after_drain: u64,
    draw_calls: u64,
    shader_precompile_queued: u64,
    shader_precompile_compiled: u64,
    shader_precompile_failed: u64,
    shader_precompile_dropped: u64,
    source_frame_uploads: u64,
    source_frame_bytes_uploaded: u64,
    source_frame_cpu_fallback_uploads: u64,
    source_frame_file_uploads: u64,
    source_frame_base64_uploads: u64,
    source_frame_json_uploads: u64,
    source_frame_shared_texture_uploads: u64,
    source_frame_shared_texture_rejected_uploads: u64,
    source_frame_rejected_uploads: u64,
    source_frame_input_bytes_uploaded: u64,
    source_frame_resampled_bytes_uploaded: u64,
    source_frame_last_input_bytes: u64,
    source_frame_last_upload_bytes: u64,
    source_frame_last_upload_width: u32,
    source_frame_last_upload_height: u32,
    source_frame_last_upload_transport: String,
    source_frame_last_reject_reason: String,
    native_image_decodes: u64,
    native_image_decode_failures: u64,
    native_image_decode_bytes_uploaded: u64,
    native_image_decode_last_error: String,
    native_video_frame_decodes: u64,
    native_video_frame_decode_failures: u64,
    native_video_frame_decode_bytes_uploaded: u64,
    native_video_frame_decode_last_error: String,
    decode_jobs_submitted: u64,
    decode_jobs_completed: u64,
    decode_jobs_dropped: u64,
    decode_queue_peak: u64,
    native_video_frame_cache_hits: u64,
    native_video_frame_cache_misses: u64,
    native_video_frame_cache_evictions: u64,
    native_shader_renders: u64,
    native_instrument_frame_renders: u64,
    compute_graph_runs: u64,
    compute_graph_passes: u64,
    compute_graph_render_passes: u64,
    compute_graph_snapshot_renders: u64,
    compute_graph_source_frame_renders: u64,
    compute_graph_readbacks: u64,
    compute_graph_readback_bytes: u64,
    compute_graph_persistent_buffers: u64,
    render_clock_updates: u64,
    frame_snapshot_reads: u64,
    frame_snapshot_bytes_read: u64,
    frame_health_checks: u64,
    dark_frame_warnings: u64,
    shader_cache_entries: u64,
    pipeline_cache_entries: u64,
    precompiled_vertex_shaders: u64,
    precompiled_pixel_shaders: u64,
    last_render_cpu_ms: f64,
    avg_render_cpu_ms: f64,
    last_render_gpu_ms: f64,
    avg_render_gpu_ms: f64,
    max_render_gpu_ms: f64,
    gpu_timing_supported: bool,
    gpu_timing_samples: u64,
    gpu_timing_disjoint: u64,
    gpu_timing_resolve_misses: u64,
    swapchain_present_attempts: u64,
    swapchain_presented: u64,
    swapchain_present_failures: u64,
    swapchain_last_present_result: String,
    swapchain_last_present_error: String,
    swapchain_present_timeouts: u64,
    swapchain_present_occluded: u64,
    swapchain_present_outdated: u64,
    swapchain_present_lost: u64,
    swapchain_present_validation_errors: u64,
    swapchain_present_consecutive_failures: u32,
    swapchain_present_max_consecutive_failures: u32,
    swapchain_present_tearing_attempts: u64,
    swapchain_waitable_waits: u64,
    swapchain_waitable_timeouts: u64,
    frames_without_swapchain_present: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution: [f32; 2],
    time: f32,
    command_phase: f32,
    layer_count: f32,
    frame_count: f32,
    _pad0: [f32; 2],
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LayerGpu {
    p0: [f32; 4],
    p1: [f32; 4],
    color: [f32; 4],
    meta: [f32; 4],
    params0: [f32; 4],
    params1: [f32; 4],
    style: [f32; 4],
    uv0: [f32; 4],
    uv1: [f32; 4],
    shape: [f32; 4],
    effect0: [f32; 4],
    effect1: [f32; 4],
    effect2: [f32; 4],
    effect3: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct PreviewPixel {
    rgba: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct NativeShaderUniforms {
    resolution_time: [f32; 4],
    frame_seed_inputs: [f32; 4],
    date: [f32; 4],
    audio0: [f32; 4],
    audio1: [f32; 4],
    params0: [f32; 4],
    params1: [f32; 4],
    // Append-only extension so older hosted shaders keep the params0/params1 offsets.
    audio2: [f32; 4],
}

#[derive(Clone, Copy, Debug, Default)]
struct GhostAudioUniforms {
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
}

impl GhostAudioUniforms {
    fn from_command(command: &Value) -> Self {
        let active = bool_at(command, &["active"]).unwrap_or(false);
        Self {
            audio0: [
                audio_value_at(command, GHOST_AUDIO0_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[1]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[2]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[3]),
            ],
            audio1: [
                audio_value_at(command, GHOST_AUDIO1_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO1_FIELDS[1]),
                number_at(command, &[GHOST_AUDIO1_FIELDS[2]])
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0) as f32,
                number_at(command, &[GHOST_AUDIO1_FIELDS[3]])
                    .unwrap_or(0.0)
                    .clamp(0.0, 300.0) as f32,
            ],
            audio2: [
                audio_value_at(command, GHOST_AUDIO2_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO2_FIELDS[1]),
                audio_value_at(command, GHOST_AUDIO2_FIELDS[2]),
                if active { 1.0 } else { 0.0 },
            ],
        }
    }

    fn from_isf_command(command: &Value) -> Self {
        let audio0 = [
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[0], "audio_level"),
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[1], "audio_bass"),
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[2], "audio_mid"),
            if command_has_key(command, GHOST_AUDIO0_FIELDS[3])
                || command_has_key(command, "audio_treble")
            {
                audio_value_at_any(command, GHOST_AUDIO0_FIELDS[3], "audio_treble")
            } else if command_has_key(command, GHOST_AUDIO1_FIELDS[0]) {
                audio_value_at(command, GHOST_AUDIO1_FIELDS[0])
            } else {
                audio_value_at(command, "audio_high")
            },
        ];
        let audio1 = [
            audio_value_at_any(command, GHOST_AUDIO1_FIELDS[0], "audio_high"),
            audio_value_at_any(command, GHOST_AUDIO1_FIELDS[1], "audio_beat"),
            number_at_any(command, GHOST_AUDIO1_FIELDS[2], "audio_beat_phase")
                .unwrap_or(0.0)
                .clamp(0.0, 1.0) as f32,
            number_at_any(command, GHOST_AUDIO1_FIELDS[3], "audio_bpm")
                .unwrap_or(0.0)
                .clamp(0.0, 300.0) as f32,
        ];
        let active = bool_at(command, &["active"]).unwrap_or_else(|| {
            audio0.iter().chain(audio1.iter()).any(|value| *value > 0.0)
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[0], "audio_spectral_centroid")
                    > 0.0
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[1], "audio_kick") > 0.0
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[2], "audio_snare") > 0.0
        });
        Self {
            audio0,
            audio1,
            audio2: [
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[0], "audio_spectral_centroid"),
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[1], "audio_kick"),
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[2], "audio_snare"),
                if active { 1.0 } else { 0.0 },
            ],
        }
    }
}

#[derive(Clone, Debug)]
struct SourcePreview {
    slot: usize,
    seq: u64,
    pixels: Vec<PreviewPixel>,
}

#[derive(Clone, Debug)]
struct SourceFrame {
    seq: u64,
}

#[derive(Clone, Debug)]
struct NativeMediaSourceState {
    uri: String,
    source_type: String,
    playback_time_seconds: f64,
    playback_rate: f64,
    paused: bool,
    loop_enabled: bool,
    duration_seconds: Option<f64>,
    clock_time_seconds: f64,
    seq: u64,
}

impl NativeMediaSourceState {
    fn current_time_seconds(&self, render_clock_time: Option<f32>) -> f64 {
        let clock_delta = render_clock_time
            .map(|clock| clock as f64 - self.clock_time_seconds)
            .unwrap_or(0.0);
        let mut time = if self.paused {
            self.playback_time_seconds
        } else {
            self.playback_time_seconds + clock_delta * self.playback_rate
        };
        if let Some(duration) = self.duration_seconds.filter(|duration| *duration > 0.0) {
            if self.loop_enabled {
                time %= duration;
                if time < 0.0 {
                    time += duration;
                }
            } else {
                time = time.clamp(0.0, duration);
            }
        }
        time.clamp(0.0, 3600.0)
    }
}

struct NativeShaderPipeline {
    pipeline: wgpu::RenderPipeline,
}

struct NativeComputePipeline {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

struct NativeGraphRenderPipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Stage3DOverlayUniforms {
    resolution: [f32; 2],
    item_count: f32,
    time: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct Stage3DOverlayItemGpu {
    center: [f32; 2],
    half_size: [f32; 2],
    color: [f32; 4],
    meta: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Stage3DMeshUniforms {
    resolution: [f32; 2],
    item_count: f32,
    time: f32,
    camera_pos: [f32; 4],
    camera_target: [f32; 4],
    params: [f32; 4],
    lighting: [f32; 4],
    atmosphere: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct Stage3DMeshItemGpu {
    position: [f32; 4],
    scale: [f32; 4],
    rotation: [f32; 4],
    color: [f32; 4],
    material: [f32; 4],
    uv: [f32; 4],
}

#[derive(Clone, Debug)]
struct Stage3DMeshFrame {
    camera_pos: [f32; 3],
    camera_target: [f32; 3],
    fov_degrees: f32,
    lighting: [f32; 4],
    atmosphere: [f32; 4],
    items: Vec<Stage3DMeshItemGpu>,
}

#[cfg(target_os = "macos")]
struct NativeOutputExport {
    surface: objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    blitter: TextureBlitter,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    frame: u64,
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeBufferBindingKind {
    Uniform,
    StorageRead,
    StorageReadWrite,
}

impl NativeComputeBufferBindingKind {
    fn signature(self) -> &'static str {
        match self {
            Self::Uniform => "uniform",
            Self::StorageRead => "storage-read",
            Self::StorageReadWrite => "storage-rw",
        }
    }

    fn buffer_usage(self) -> wgpu::BufferUsages {
        match self {
            Self::Uniform => {
                wgpu::BufferUsages::UNIFORM
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST
            }
            Self::StorageRead | Self::StorageReadWrite => {
                wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST
            }
        }
    }

    fn binding_type(self) -> wgpu::BindingType {
        match self {
            Self::Uniform => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            Self::StorageRead => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: true },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            Self::StorageReadWrite => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: false },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct NativeComputeBindingLayoutSpec {
    binding: u32,
    kind: NativeComputeGraphBindingKind,
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphTextureDimension {
    D2,
    D2Array,
}

impl NativeComputeGraphTextureDimension {
    fn signature(self) -> &'static str {
        match self {
            Self::D2 => "texture-2d",
            Self::D2Array => "texture-2d-array",
        }
    }

    fn view_dimension(self) -> wgpu::TextureViewDimension {
        match self {
            Self::D2 => wgpu::TextureViewDimension::D2,
            Self::D2Array => wgpu::TextureViewDimension::D2Array,
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphBindingKind {
    Buffer(NativeComputeBufferBindingKind),
    SourceFrameTexture(NativeComputeGraphTextureDimension),
    SourceFrameSampler,
}

impl NativeComputeGraphBindingKind {
    fn signature(self) -> &'static str {
        match self {
            Self::Buffer(kind) => kind.signature(),
            Self::SourceFrameTexture(dimension) => dimension.signature(),
            Self::SourceFrameSampler => "source-frame-sampler",
        }
    }

    fn binding_type(self) -> wgpu::BindingType {
        match self {
            Self::Buffer(kind) => kind.binding_type(),
            Self::SourceFrameTexture(dimension) => wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: dimension.view_dimension(),
                multisampled: false,
            },
            Self::SourceFrameSampler => {
                wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)
            }
        }
    }
}

#[derive(Clone, Debug)]
struct NativeComputeGraphBufferSpec {
    id: String,
    byte_length: u64,
    kind: NativeComputeBufferBindingKind,
    initial_bytes: Vec<u8>,
    persistent: bool,
    clear: bool,
    indirect: bool,
}

struct NativeComputeGraphGpuBuffer {
    buffer: wgpu::Buffer,
    byte_length: u64,
    kind: NativeComputeBufferBindingKind,
    indirect: bool,
}

#[derive(Clone, Debug)]
struct NativeComputeGraphBindingSpec {
    binding: u32,
    resource_id: String,
    kind: NativeComputeGraphBindingKind,
    source_slot: Option<usize>,
}

#[derive(Clone, Debug)]
struct NativeComputeGraphPassPlan {
    name: String,
    cache_key: String,
    source: String,
    entry: String,
    dispatch: [u32; 3],
    bindings: Vec<NativeComputeGraphBindingSpec>,
}

#[derive(Clone, Debug)]
enum NativeComputeGraphRenderTarget {
    Snapshot,
    SourceFrame {
        source_id: String,
        slot: usize,
        seq: u64,
    },
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphRenderBlend {
    Replace,
    Alpha,
    Add,
}

impl NativeComputeGraphRenderBlend {
    fn signature(self) -> &'static str {
        match self {
            Self::Replace => "replace",
            Self::Alpha => "alpha",
            Self::Add => "add",
        }
    }

    fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "alpha" | "alpha-blend" | "premul" | "premultiplied-alpha" => Self::Alpha,
            "add" | "additive" | "plus" => Self::Add,
            _ => Self::Replace,
        }
    }

    fn blend_state(self) -> wgpu::BlendState {
        match self {
            Self::Replace => wgpu::BlendState::REPLACE,
            Self::Alpha => wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING,
            Self::Add => wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
            },
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphDepthCompare {
    Less,
    LessEqual,
    Always,
}

impl NativeComputeGraphDepthCompare {
    fn signature(self) -> &'static str {
        match self {
            Self::Less => "less",
            Self::LessEqual => "less-equal",
            Self::Always => "always",
        }
    }

    fn compare_function(self) -> wgpu::CompareFunction {
        match self {
            Self::Less => wgpu::CompareFunction::Less,
            Self::LessEqual => wgpu::CompareFunction::LessEqual,
            Self::Always => wgpu::CompareFunction::Always,
        }
    }

    fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "less-equal" | "less-or-equal" | "lequal" => Self::LessEqual,
            "always" | "off" | "none" => Self::Always,
            _ => Self::Less,
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphPrimitiveTopology {
    TriangleList,
    LineList,
}

impl NativeComputeGraphPrimitiveTopology {
    fn signature(self) -> &'static str {
        match self {
            Self::TriangleList => "triangle-list",
            Self::LineList => "line-list",
        }
    }

    fn topology(self) -> wgpu::PrimitiveTopology {
        match self {
            Self::TriangleList => wgpu::PrimitiveTopology::TriangleList,
            Self::LineList => wgpu::PrimitiveTopology::LineList,
        }
    }

    fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "line" | "lines" | "line-list" => Self::LineList,
            _ => Self::TriangleList,
        }
    }
}

#[derive(Clone, Debug)]
struct NativeComputeGraphRenderPlan {
    name: String,
    cache_key: String,
    source: String,
    vertex_entry: String,
    fragment_entry: String,
    clear: bool,
    include_snapshot: bool,
    target: NativeComputeGraphRenderTarget,
    blend: NativeComputeGraphRenderBlend,
    vertex_count: u32,
    instance_count: u32,
    indirect_buffer_id: Option<String>,
    indirect_offset: u64,
    clear_color: [f64; 4],
    primitive_topology: NativeComputeGraphPrimitiveTopology,
    depth_enabled: bool,
    depth_write: bool,
    depth_compare: NativeComputeGraphDepthCompare,
    bindings: Vec<NativeComputeGraphBindingSpec>,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ComputeProbeUniforms {
    element_count: u32,
    frame_index: u32,
    seed: u32,
    _pad0: u32,
}

struct ComputeProbeResult {
    byte_length: u64,
    checksum: u64,
    nonzero_words: u32,
    first_words: Vec<u32>,
}

#[derive(Clone, Debug, Serialize)]
struct IsfUniformState {
    shader_id: String,
    time: f32,
    time_delta: f32,
    frame_index: u64,
    render_width: f32,
    render_height: f32,
    date: [f32; 4],
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
    float_hash: u64,
    point_hash: u64,
    color_hash: u64,
    input_count: u32,
    seq: u64,
}

impl IsfUniformState {
    fn native_params(&self, shader_id: &str) -> [f32; 8] {
        let seed = unit_from_hash(stable_hash64(shader_id));
        let float_seed = unit_from_hash(self.float_hash);
        let point_seed = unit_from_hash(self.point_hash);
        let color_seed = unit_from_hash(self.color_hash);
        let level = self.audio0[0].clamp(0.0, 1.0);
        let bass = self.audio0[1].clamp(0.0, 1.0);
        let high = self.audio1[0].clamp(0.0, 1.0);
        let beat = self.audio1[1].clamp(0.0, 1.0);
        let bpm = self.audio1[3].clamp(0.0, 300.0);
        [
            (0.82 + level * 1.2 + beat * 0.35).clamp(0.0, 4.0),
            (0.52 + seed * 2.2 + float_seed * 0.8).clamp(0.18, 4.0),
            (0.24 + bass * 0.46 + point_seed * 0.30).clamp(0.0, 1.0),
            (0.16 + bpm / 180.0 + high * 0.45).clamp(0.0, 2.0),
            seed,
            (0.18 + color_seed * 0.72).clamp(0.0, 1.0),
            (0.20 + (self.input_count as f32 / 48.0) + float_seed * 0.24).clamp(0.0, 1.0),
            1.0,
        ]
    }
}

impl NativeShaderUniforms {
    fn from_isf(
        shader_id: &str,
        state: Option<&IsfUniformState>,
        fallback_width: u32,
        fallback_height: u32,
        params: [f32; 8],
        input_source_slot: usize,
    ) -> Self {
        let seed = unit_from_hash(stable_hash64(shader_id));
        let render_width = state
            .map(|state| state.render_width)
            .unwrap_or(fallback_width as f32)
            .max(1.0);
        let render_height = state
            .map(|state| state.render_height)
            .unwrap_or(fallback_height as f32)
            .max(1.0);
        let time = state.map(|state| state.time).unwrap_or(0.0);
        let time_delta = state.map(|state| state.time_delta).unwrap_or(1.0 / 60.0);
        let frame_index = state.map(|state| state.frame_index as f32).unwrap_or(0.0);
        let input_count = state.map(|state| state.input_count as f32).unwrap_or(0.0);
        let date = state.map(|state| state.date).unwrap_or([0.0; 4]);
        let audio0 = state.map(|state| state.audio0).unwrap_or([0.0; 4]);
        let audio1 = state.map(|state| state.audio1).unwrap_or([0.0; 4]);
        let audio2 = state.map(|state| state.audio2).unwrap_or([0.0; 4]);
        Self {
            resolution_time: [render_width, render_height, time, time_delta],
            frame_seed_inputs: [
                frame_index,
                seed,
                input_count,
                input_source_slot.min(MAX_SOURCE_FRAME_SLOTS - 1) as f32,
            ],
            date,
            audio0,
            audio1,
            params0: [params[0], params[1], params[2], params[3]],
            params1: [params[4], params[5], params[6], params[7]],
            audio2,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct ShaderRecord {
    shader_id: String,
    stage: String,
    entry: String,
    source_hash: u64,
    source_bytes: usize,
    entry_points: Vec<String>,
    compiled_at_ms: u64,
}

#[derive(Clone, Debug)]
struct SceneLayer {
    id: String,
    z_index: i32,
    vj_layer_index: Option<i32>,
    visible: bool,
    opacity: f32,
    source_kind: f32,
    source_id: Option<String>,
    shader_id: Option<String>,
    shader_rendered: bool,
    preview_slot: Option<usize>,
    frame_slot: Option<usize>,
    color: [f32; 4],
    corners: [[f32; 2]; 4],
    native_params: [f32; 8],
    blend_code: f32,
    uv0: [f32; 4],
    uv1: [f32; 4],
    shape: [f32; 4],
    effects: [[f32; 4]; 4],
    effect_count: f32,
}

impl SceneLayer {
    fn new(id: String, z_index: i32) -> Self {
        Self {
            color: stable_layer_color(&id, 1.0),
            id,
            z_index,
            vj_layer_index: None,
            visible: true,
            opacity: 1.0,
            source_kind: 0.0,
            source_id: None,
            shader_id: None,
            shader_rendered: false,
            preview_slot: None,
            frame_slot: None,
            corners: [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            native_params: default_native_params(),
            blend_code: 0.0,
            uv0: [0.0, 0.0, 1.0, 1.0],
            uv1: [0.0, 1.0, 0.0, 0.0],
            shape: [0.0, 0.0, 0.0, 1.0],
            effects: [[0.0; 4]; 4],
            effect_count: 0.0,
        }
    }

    fn gpu(&self) -> LayerGpu {
        LayerGpu {
            p0: [
                self.corners[0][0],
                self.corners[0][1],
                self.corners[1][0],
                self.corners[1][1],
            ],
            p1: [
                self.corners[2][0],
                self.corners[2][1],
                self.corners[3][0],
                self.corners[3][1],
            ],
            color: [
                self.color[0],
                self.color[1],
                self.color[2],
                self.opacity.clamp(0.0, 1.0) * self.color[3].clamp(0.0, 1.0),
            ],
            meta: [
                if self.visible { 1.0 } else { 0.0 },
                self.z_index as f32,
                if self.shader_rendered {
                    NATIVE_SHADER_SOURCE_KIND
                } else {
                    self.source_kind
                },
                self.frame_slot
                    .map(|slot| SOURCE_FRAME_SLOT_OFFSET + slot as f32 + 1.0)
                    .or_else(|| self.preview_slot.map(|slot| slot as f32 + 1.0))
                    .unwrap_or(0.0),
            ],
            params0: [
                self.native_params[0],
                self.native_params[1],
                self.native_params[2],
                self.native_params[3],
            ],
            params1: [
                self.native_params[4],
                self.native_params[5],
                self.native_params[6],
                self.native_params[7],
            ],
            style: [self.blend_code, self.effect_count, 0.0, 0.0],
            uv0: self.uv0,
            uv1: self.uv1,
            shape: self.shape,
            effect0: self.effects[0],
            effect1: self.effects[1],
            effect2: self.effects[2],
            effect3: self.effects[3],
        }
    }
}

struct GpuTimingState {
    query_set: wgpu::QuerySet,
    resolve_buffer: wgpu::Buffer,
    readback_buffer: wgpu::Buffer,
    timestamp_period_ns: f64,
    map_done_tx: Sender<Result<(), String>>,
    map_done_rx: Receiver<Result<(), String>>,
    map_pending: bool,
    last_render_gpu_ms: f64,
    avg_render_gpu_ms: f64,
    max_render_gpu_ms: f64,
    samples: u64,
    resolve_misses: u64,
}

impl GpuTimingState {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let query_set = device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Queries"),
            ty: wgpu::QueryType::Timestamp,
            count: 2,
        });
        let resolve_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Resolve"),
            size: wgpu::QUERY_RESOLVE_BUFFER_ALIGNMENT.max(GPU_TIMESTAMP_READ_BYTES),
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Readback"),
            size: GPU_TIMESTAMP_READ_BYTES,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let (map_done_tx, map_done_rx) = mpsc::channel();
        Self {
            query_set,
            resolve_buffer,
            readback_buffer,
            timestamp_period_ns: queue.get_timestamp_period() as f64,
            map_done_tx,
            map_done_rx,
            map_pending: false,
            last_render_gpu_ms: 0.0,
            avg_render_gpu_ms: 0.0,
            max_render_gpu_ms: 0.0,
            samples: 0,
            resolve_misses: 0,
        }
    }

    fn timestamp_writes(&self) -> wgpu::RenderPassTimestampWrites<'_> {
        wgpu::RenderPassTimestampWrites {
            query_set: &self.query_set,
            beginning_of_pass_write_index: Some(0),
            end_of_pass_write_index: Some(1),
        }
    }

    fn can_record(&self) -> bool {
        !self.map_pending
    }

    fn resolve_to_readback(&self, encoder: &mut wgpu::CommandEncoder) {
        encoder.resolve_query_set(&self.query_set, 0..2, &self.resolve_buffer, 0);
        encoder.copy_buffer_to_buffer(
            &self.resolve_buffer,
            0,
            &self.readback_buffer,
            0,
            GPU_TIMESTAMP_READ_BYTES,
        );
    }

    fn begin_readback(&mut self) {
        if self.map_pending {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        self.map_pending = true;
        let tx = self.map_done_tx.clone();
        self.readback_buffer
            .slice(0..GPU_TIMESTAMP_READ_BYTES)
            .map_async(wgpu::MapMode::Read, move |result| {
                let _ = tx.send(result.map_err(|err| err.to_string()));
            });
    }

    fn poll_readback(&mut self) {
        if !self.map_pending {
            return;
        }
        let Ok(result) = self.map_done_rx.try_recv() else {
            return;
        };
        self.map_pending = false;
        if result.is_err() {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }

        let slice = self.readback_buffer.slice(0..GPU_TIMESTAMP_READ_BYTES);
        let Ok(mapped) = slice.get_mapped_range() else {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            self.readback_buffer.unmap();
            return;
        };
        let mut start_bytes = [0_u8; 8];
        let mut end_bytes = [0_u8; 8];
        start_bytes.copy_from_slice(&mapped[0..8]);
        end_bytes.copy_from_slice(&mapped[8..16]);
        drop(mapped);
        self.readback_buffer.unmap();

        let start = u64::from_le_bytes(start_bytes);
        let end = u64::from_le_bytes(end_bytes);
        if end <= start {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        let gpu_ms = ((end - start) as f64 * self.timestamp_period_ns) / 1_000_000.0;
        if !gpu_ms.is_finite() || gpu_ms <= 0.0 {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        self.last_render_gpu_ms = gpu_ms;
        self.avg_render_gpu_ms = if self.avg_render_gpu_ms <= 0.0 {
            gpu_ms
        } else {
            self.avg_render_gpu_ms * 0.94 + gpu_ms * 0.06
        };
        self.max_render_gpu_ms = self.max_render_gpu_ms.max(gpu_ms);
        self.samples = self.samples.saturating_add(1);
    }
}

struct RenderState {
    window: &'static Window,
    adapter_name: String,
    native_caps: NativeGpuCaps,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    supported_present_modes: Vec<wgpu::PresentMode>,
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    native_shader_uniform_buffer: wgpu::Buffer,
    layer_buffer: wgpu::Buffer,
    source_preview_buffer: wgpu::Buffer,
    source_frame_texture: wgpu::Texture,
    source_frame_sampler: wgpu::Sampler,
    native_shader_input_texture: wgpu::Texture,
    source_frame_size: usize,
    source_frame_format: wgpu::TextureFormat,
    source_frame_mip_levels: u32,
    source_frame_blitter: TextureBlitter,
    native_shader_vertex_module: wgpu::ShaderModule,
    native_shader_bind_group_layout: wgpu::BindGroupLayout,
    native_shader_bind_group: wgpu::BindGroup,
    stage3d_overlay_pipeline: wgpu::RenderPipeline,
    stage3d_overlay_uniform_buffer: wgpu::Buffer,
    stage3d_overlay_item_buffer: wgpu::Buffer,
    stage3d_overlay_bind_group: wgpu::BindGroup,
    stage3d_mesh_pipeline: wgpu::RenderPipeline,
    stage3d_mesh_uniform_buffer: wgpu::Buffer,
    stage3d_mesh_item_buffer: wgpu::Buffer,
    stage3d_mesh_bind_group: wgpu::BindGroup,
    stage3d_mesh_depth_texture: wgpu::Texture,
    stage3d_mesh_depth_view: wgpu::TextureView,
    native_shader_pipelines: HashMap<String, NativeShaderPipeline>,
    native_compute_pipelines: HashMap<String, NativeComputePipeline>,
    native_graph_render_pipelines: HashMap<String, NativeGraphRenderPipeline>,
    native_compute_graph_buffers: HashMap<String, NativeComputeGraphGpuBuffer>,
    output_mirror_texture: wgpu::Texture,
    output_mirror_view: wgpu::TextureView,
    #[cfg(target_os = "macos")]
    output_export: Option<NativeOutputExport>,
    snapshot_texture: wgpu::Texture,
    snapshot_view: wgpu::TextureView,
    last_frame_metrics: Option<SnapshotMetrics>,
    bind_group: wgpu::BindGroup,
    start_time: Instant,
    gpu_timing: Option<GpuTimingState>,
    last_frame_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct NativeSceneBridgeSummary {
    schema_version: u32,
    scene_kind: String,
    scene_id: String,
    scene_name: String,
    source_schema_version: u32,
    payload_bytes: u64,
    updated_at_ms: u64,
    node_count: u32,
    screen_count: u32,
    primitive_count: u32,
    truss_count: u32,
    light_count: u32,
    laser_count: u32,
    fog_volume_count: u32,
    user_element_count: u32,
    scenery_override_count: u32,
    projector_count: u32,
    object_count: u32,
    model_count: u32,
    point_cloud_count: u32,
}

impl NativeSceneBridgeSummary {
    fn empty(scene_kind: &str) -> Self {
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

#[derive(Clone)]
struct NativeVideoFrameCacheEntry {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
    byte_length: usize,
}

struct App {
    response_tx: Sender<String>,
    event_proxy: EventLoopProxy<UserEvent>,
    renderer: Option<RenderState>,
    adapter_name: Option<String>,
    target_fps: u32,
    last_redraw: Instant,
    running: bool,
    pending_width: u32,
    pending_height: u32,
    present_mode: String,
    allow_tearing: bool,
    max_frame_latency: u32,
    use_waitable_object: bool,
    command_queue_capacity: u32,
    command_drain_limit: u32,
    auto_present_on_state_change: bool,
    decode_store_cpu_backup_frames: bool,
    decode_allow_synthetic_fallback: bool,
    media_queue_capacity: u32,
    decode_handoff_queue_capacity: u32,
    media_high_burst_limit: u32,
    prefetch_cache_max_entries: u32,
    prefetch_cache_prune_count: u32,
    media_drop_command_pressure_pct: u32,
    media_drop_decode_pressure_pct: u32,
    media_drop_io_pressure_pct: u32,
    media_drop_decode_priority_cutoff: u32,
    media_drop_io_priority_cutoff: u32,
    decode_preview_size: u32,
    decode_preview_cache_mb: u32,
    decode_use_output_resolution: bool,
    decode_upload_queue_cap_mb: u32,
    decode_handoff_byte_cap_mb: u32,
    decode_handoff_predecode_shed_pct: u32,
    decode_predecode_estimate_cache_cap_entries: u32,
    vram_budget_mb: u32,
    auto_present_requested: bool,
    output_window_attached: bool,
    layers_seen: u32,
    command_phase: f32,
    scene_layers: HashMap<String, SceneLayer>,
    source_previews: HashMap<String, SourcePreview>,
    source_preview_slots: HashMap<String, usize>,
    source_preview_dirty: bool,
    source_frames: HashMap<String, SourceFrame>,
    source_frame_slots: HashMap<String, usize>,
    source_frame_signatures: HashMap<String, String>,
    native_video_frame_signatures: HashMap<String, String>,
    native_video_frame_cache: HashMap<String, NativeVideoFrameCacheEntry>,
    native_video_frame_cache_order: VecDeque<String>,
    native_video_frame_cache_bytes: usize,
    media_sources: HashMap<String, NativeMediaSourceState>,
    native_video_decode_pending: HashSet<String>,
    native_video_decode_failed: HashSet<String>,
    stage3d_scene: Option<Value>,
    stage3d_scene_summary: NativeSceneBridgeSummary,
    projection_sim_scene: Option<Value>,
    projection_sim_scene_summary: NativeSceneBridgeSummary,
    render_clock_mode: String,
    render_clock_time: Option<f32>,
    render_clock_delta: f32,
    render_clock_frame_index: Option<u64>,
    isf_layer_bindings: HashMap<String, String>,
    isf_uniforms: HashMap<String, IsfUniformState>,
    shader_registry: HashMap<String, ShaderRecord>,
    shader_sources: HashMap<String, String>,
    shader_precompile_queue_cap: u32,
    shader_precompile_per_frame: u32,
    shader_metadata_cache_cap: u32,
    pipeline_metadata_cache_cap: u32,
    texture_pool_cap_mb: u32,
    last_shader_error: Option<String>,
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
    stats: CoreStats,
    render_cpu_ema_ms: f64,
    native_quality: NativeQualityState,
}

#[derive(Clone, Copy, Debug)]
enum SurfacePresentOutcome {
    Presented,
    SuboptimalPresented,
    Outdated,
    Timeout,
    Occluded,
}

impl SurfacePresentOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Presented => "presented",
            Self::SuboptimalPresented => "suboptimal-presented",
            Self::Outdated => "outdated",
            Self::Timeout => "timeout",
            Self::Occluded => "occluded",
        }
    }

    fn presented(self) -> bool {
        matches!(self, Self::Presented | Self::SuboptimalPresented)
    }
}

impl App {
    fn new(response_tx: Sender<String>, event_proxy: EventLoopProxy<UserEvent>) -> Self {
        Self {
            response_tx,
            event_proxy,
            renderer: None,
            adapter_name: None,
            target_fps: 60,
            last_redraw: Instant::now(),
            running: false,
            pending_width: 1280,
            pending_height: 720,
            present_mode: "vsync".to_string(),
            allow_tearing: false,
            max_frame_latency: 2,
            use_waitable_object: false,
            command_queue_capacity: DEFAULT_COMMAND_QUEUE_CAPACITY,
            command_drain_limit: DEFAULT_COMMAND_DRAIN_LIMIT,
            auto_present_on_state_change: true,
            decode_store_cpu_backup_frames: false,
            decode_allow_synthetic_fallback: false,
            media_queue_capacity: 2048,
            decode_handoff_queue_capacity: 4096,
            media_high_burst_limit: 7,
            prefetch_cache_max_entries: 4096,
            prefetch_cache_prune_count: 256,
            media_drop_command_pressure_pct: 90,
            media_drop_decode_pressure_pct: 90,
            media_drop_io_pressure_pct: 90,
            media_drop_decode_priority_cutoff: 180,
            media_drop_io_priority_cutoff: 128,
            decode_preview_size: 96,
            decode_preview_cache_mb: 128,
            decode_use_output_resolution: true,
            decode_upload_queue_cap_mb: 256,
            decode_handoff_byte_cap_mb: 128,
            decode_handoff_predecode_shed_pct: 90,
            decode_predecode_estimate_cache_cap_entries: 8192,
            vram_budget_mb: 4096,
            auto_present_requested: false,
            output_window_attached: true,
            layers_seen: 0,
            command_phase: 0.0,
            scene_layers: HashMap::new(),
            source_previews: HashMap::new(),
            source_preview_slots: HashMap::new(),
            source_preview_dirty: true,
            source_frames: HashMap::new(),
            source_frame_slots: HashMap::new(),
            source_frame_signatures: HashMap::new(),
            native_video_frame_signatures: HashMap::new(),
            native_video_frame_cache: HashMap::new(),
            native_video_frame_cache_order: VecDeque::new(),
            native_video_frame_cache_bytes: 0,
            media_sources: HashMap::new(),
            native_video_decode_pending: HashSet::new(),
            native_video_decode_failed: HashSet::new(),
            stage3d_scene: None,
            stage3d_scene_summary: NativeSceneBridgeSummary::empty("stage3d"),
            projection_sim_scene: None,
            projection_sim_scene_summary: NativeSceneBridgeSummary::empty("projection-sim"),
            render_clock_mode: "live".to_string(),
            render_clock_time: None,
            render_clock_delta: 1.0 / 60.0,
            render_clock_frame_index: None,
            isf_layer_bindings: HashMap::new(),
            isf_uniforms: HashMap::new(),
            shader_registry: HashMap::new(),
            shader_sources: HashMap::new(),
            shader_precompile_queue_cap: 4096,
            shader_precompile_per_frame: 4,
            shader_metadata_cache_cap: 16384,
            pipeline_metadata_cache_cap: 16384,
            texture_pool_cap_mb: 512,
            last_shader_error: None,
            audio0: [0.0; 4],
            audio1: [0.0; 4],
            audio2: [0.0; 4],
            stats: CoreStats::default(),
            render_cpu_ema_ms: 0.0,
            native_quality: NativeQualityState::default(),
        }
    }

    fn ensure_renderer(&mut self, event_loop: &ActiveEventLoop) -> Result<(), String> {
        if self.renderer.is_some() {
            return Ok(());
        }
        let attrs = WindowAttributes::default()
            .with_title("Ghost Render Core")
            .with_inner_size(LogicalSize::new(
                self.pending_width as f64,
                self.pending_height as f64,
            ))
            .with_resizable(true);
        let window = event_loop
            .create_window(attrs)
            .map_err(|err| err.to_string())?;
        let window: &'static Window = Box::leak(Box::new(window));
        let renderer = pollster::block_on(RenderState::new(
            window,
            self.pending_width.max(1),
            self.pending_height.max(1),
            &self.present_mode,
            self.allow_tearing,
            self.max_frame_latency,
        ))?;
        self.native_quality
            .rebase_to_caps(&renderer.native_caps.recommended_quality_tier);
        self.adapter_name = renderer.adapter_name();
        self.renderer = Some(renderer);
        Ok(())
    }

    fn capabilities(&self) -> Value {
        let shared_texture_media_transport = self.shared_texture_media_transport_ready();
        let features = json!({
            "separate_process_render_core": true,
            "managed_native_window": true,
            "audio_uniform_layout": true,
            "layer_compositor": true,
            "layer_corner_warp": true,
            "layer_uv_controls": true,
            "layer_shape_masks": true,
            "blend_modes": true,
            "effect_descriptors": true,
            "native_compositor_manifest": true,
            "render_clock": true,
            "frame_snapshot": true,
            "frame_snapshot_export": true,
            "native_frame_export": true,
            "native_frame_sequence_export": true,
            "frame_health": true,
            "gpu_timing": self.renderer.as_ref().is_some_and(|renderer| renderer.gpu_timing.is_some()),
            "shader_precompile": true,
            "fragment_wgsl_host": true,
            "native_instrument_proxies": false,
            "source_preview_upload": true,
            "source_frame_upload": true,
            "source_frame_file_handoff": true,
            "source_frame_mips": self.renderer.as_ref().is_some_and(|renderer| renderer.source_frame_mip_levels > 1),
            "source_frame_hdr": self.renderer.as_ref().is_some_and(|renderer| renderer.source_frame_format == SOURCE_FRAME_FORMAT_HDR),
            "native_static_image_decode": true,
            "native_static_image_prefetch": true,
            "native_video_frame_decode": true,
            "native_video_frame_prefetch": true,
            "native_video_frame_prefetch_window": true,
            "video_frame_prefetch": true,
            "native_media_source_playback_state": true,
            "native_video_decode_pump": true,
            "native_video_decode_pump_window": true,
            "decode_policy_controls": true,
            "decode_preview_cache_clear": true,
            "media_policy_controls": true,
            "vram_budget_policy": true,
            "vram_budget_enforcement": false,
            "runtime_cache_clear": true,
            "native_graph_buffer_prune": true,
            "compute_shader_host": true,
            "compute_graph_host": true,
            "compute_graph_render": true,
            "compute_graph_multi_render": true,
            "compute_graph_instanced_render": true,
            "compute_graph_indirect_render": true,
            "compute_graph_texture_sampling": true,
            "compute_graph_depth_render": true,
            "compute_graph_line_render": true,
            "compute_graph_clear_color": true,
            "compute_graph_source_frame_target": true,
            "persistent_compute_buffers": true,
            "native_planet_graph": true,
            "native_3d_smoke_graph": true,
            "native_particle_field_graph": true,
            "native_volumetric_spheres_graph": true,
            "native_smoke_riders_graph": true,
            "native_ink_cloud_graph": true,
            "native_flythrough_graph": true,
            "native_pixel_particles_graph": true,
            "native_point_cloud_fx_graph": true,
            "command_drain_policy": true,
            "auto_present_policy": true,
            "multi_pass_instruments": true,
            "storage_buffer_instruments": true,
            "shared_texture_source_frame_upload": cfg!(target_os = "macos"),
            "native_output_mirror_texture": true,
            "shared_texture_upload": shared_texture_media_transport,
            "shared_texture_output_export": self.renderer.as_ref().is_some_and(RenderState::output_export_ready),
            "native_texture_share_sender": false,
            "native_media_decode": true,
            "media_prefetch": true,
            "present_policy": true,
            "managed_output_attach": true,
            "managed_output_window_control": true,
            "native_stage3d_scene_ingest": true,
            "native_stage3d_overlay_preview": true,
            "native_stage3d_mesh_preview": true,
            "native_stage3d_textured_mesh_preview": true,
            "native_stage3d_primitive_meshes": true,
            "native_stage3d_xyz_mesh_transforms": true,
            "native_stage3d_lighting_preview": true,
            "native_stage3d_output_renderer": true,
            "native_projection_sim_scene_ingest": true,
            "native_projection_sim_overlay_preview": true,
            "native_projection_sim_mesh_preview": true,
            "native_projection_sim_textured_mesh_preview": true,
            "native_projection_sim_xyz_mesh_transforms": true,
            "native_projection_sim_output_renderer": true,
            "native_recording": false,
            "native_stage3d": true,
            "native_projection_sim": true
        });
        let limits = json!({
            "max_scene_layers": MAX_SCENE_LAYERS,
            "source_preview_size": SOURCE_PREVIEW_SIZE,
            "source_preview_slots": MAX_SOURCE_PREVIEWS,
            "source_frame_slots": MAX_SOURCE_FRAME_SLOTS,
            "source_frame_size": self.renderer.as_ref().map(|renderer| renderer.source_frame_size).unwrap_or(SOURCE_FRAME_SIZE_DEFAULT),
            "source_frame_mip_levels": self.renderer.as_ref().map(|renderer| renderer.source_frame_mip_levels).unwrap_or(1),
            "command_queue_capacity": self.command_queue_capacity,
            "command_drain_limit": self.command_drain_limit,
            "media_queue_capacity": self.media_queue_capacity,
            "decode_handoff_queue_capacity": self.decode_handoff_queue_capacity,
            "vram_budget_mb": self.vram_budget_mb
        });
        json!({
            "schema_version": 1,
            "core_version": env!("CARGO_PKG_VERSION"),
            "backend": native_backend_name(),
            "implemented_methods": CORE_RPC_METHODS,
            "implemented_command_types": CORE_COMMAND_TYPES,
            "native_compositor_blend_modes": native_compositor_blend_manifest(),
            "native_compositor_effect_descriptors": native_compositor_effect_manifest(),
            "native_graph_instruments": ["planet", "smoke-3d", "particle-field", "volumetric-spheres", "smoke-riders", "ink-cloud", "flythrough", "pixel-particles", "point-cloud-fx"],
            "native_graph_instrument_manifest": [
                {
                    "id": "planet",
                    "label": "Planet",
                    "source_uri_prefix": "native-graph://planet/",
                    "shader_ids": [
                        "planet/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "native_planet_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "single-pass-shared-wgsl"
                },
                {
                    "id": "smoke-3d",
                    "label": "3D Smoke",
                    "source_uri_prefix": "native-graph://smoke-3d/",
                    "shader_ids": ["smoke-3d"],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_multi_render",
                        "compute_graph_instanced_render",
                        "compute_graph_indirect_render",
                        "compute_graph_texture_sampling",
                        "compute_graph_depth_render",
                        "compute_graph_line_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_3d_smoke_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "fluid-sim-multipass-shared-wgsl"
                },
                {
                    "id": "particle-field",
                    "label": "Particle Field",
                    "source_uri_prefix": "native-graph://particle-field/",
                    "shader_ids": [
                        "particle-field/behavior",
                        "particle-field/fog",
                        "particle-field/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_multi_render",
                        "compute_graph_instanced_render",
                        "compute_graph_texture_sampling",
                        "compute_graph_depth_render",
                        "compute_graph_line_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_particle_field_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "behavior-render-edges-and-media-source-frame-routing"
                },
                {
                    "id": "volumetric-spheres",
                    "label": "Volumetric Spheres",
                    "source_uri_prefix": "native-graph://volumetric-spheres/",
                    "shader_ids": [
                        "volumetric-spheres/sim",
                        "volumetric-spheres/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_depth_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_volumetric_spheres_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "sim-render-shared-wgsl"
                },
                {
                    "id": "smoke-riders",
                    "label": "Smoke Riders",
                    "source_uri_prefix": "native-graph://smoke-riders/",
                    "shader_ids": [
                        "3d-smoke/splat",
                        "3d-smoke/advect-velocity",
                        "3d-smoke/divergence",
                        "3d-smoke/jacobi",
                        "3d-smoke/subtract-gradient",
                        "3d-smoke/advect-density",
                        "3d-smoke/render",
                        "volumetric-spheres/sim",
                        "volumetric-spheres/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_multi_render",
                        "compute_graph_instanced_render",
                        "compute_graph_depth_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_3d_smoke_graph",
                        "native_volumetric_spheres_graph",
                        "native_smoke_riders_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "composed-smoke-and-volumetric-spheres-shared-wgsl"
                },
                {
                    "id": "ink-cloud",
                    "label": "Ink Cloud",
                    "source_uri_prefix": "native-graph://ink-cloud/",
                    "shader_ids": [
                        "ink-cloud/sim",
                        "ink-cloud/render",
                        "ink-cloud/background"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_multi_render",
                        "compute_graph_instanced_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_ink_cloud_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "sim-background-render-shared-wgsl"
                },
                {
                    "id": "flythrough",
                    "label": "Flythrough",
                    "source_uri_prefix": "native-graph://flythrough/",
                    "shader_ids": [
                        "flythrough/compute",
                        "flythrough/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_texture_sampling",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_flythrough_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "compute-render-source-frame-shared-wgsl"
                },
                {
                    "id": "pixel-particles",
                    "label": "Pixel Particles",
                    "source_uri_prefix": "native-graph://pixel-particles/",
                    "shader_ids": [
                        "pixel-particles/compute",
                        "pixel-particles/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_texture_sampling",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_pixel_particles_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "compute-render-source-frame-shared-wgsl"
                },
                {
                    "id": "point-cloud-fx",
                    "label": "Point Cloud FX",
                    "source_uri_prefix": "native-graph://point-cloud-fx/",
                    "shader_ids": [
                        "point-cloud-fx/compute",
                        "point-cloud-fx/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_point_cloud_fx_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "compute-render-point-buffer-shared-wgsl"
                }
            ],
            "audio_uniform_layout": ghost_audio_uniform_layout(),
            "native_scene_bridge": {
                "stage3d": self.stage3d_scene_summary,
                "projection_sim": self.projection_sim_scene_summary,
            },
            "features": features,
            "limits": limits,
            "notes": [
                "Native graph instruments use shared WGSL for 3D Smoke, Particle Field, Volumetric Spheres, Ink Cloud, Flythrough, Pixel Particles, and Point Cloud FX; the legacy native lookalike proxy path is disabled.",
                "Canvas/base64 source-frame upload is a development fallback; macOS media transport can ingest IOSurfaceID source-frame handles; DXGI import remains pending for Windows.",
                "Native frame export is owned by the render core; MP4/JPEG sequence encoding is completed by the Electron bridge.",
                "Local video media decode is render-clock driven in the native core: visible video sources pump FFmpeg-decoded frame windows into native source-frame textures with adjacent-frame cache prefetch."
            ]
        })
    }

    fn shared_texture_media_transport_ready(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            self.renderer
                .as_ref()
                .is_some_and(RenderState::output_export_ready)
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }

    fn status(&self) -> CoreStatus {
        let last_frame_error = self
            .renderer
            .as_ref()
            .and_then(|r| r.last_frame_error.clone());
        let last_frame_metrics = self
            .renderer
            .as_ref()
            .and_then(|renderer| renderer.last_frame_metrics.as_ref());
        let (
            gpu_timing_supported,
            last_render_gpu_ms,
            avg_render_gpu_ms,
            max_render_gpu_ms,
            gpu_timing_samples,
            gpu_timing_resolve_misses,
        ) = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.gpu_timing_stats())
            .unwrap_or((false, 0.0, 0.0, 0.0, 0, 0));
        let native_instrument_proxy_layers = 0;
        let native_graph_source_frame_layers = self
            .scene_layers
            .values()
            .filter(|layer| {
                layer.visible
                    && !layer.shader_rendered
                    && layer.source_id.as_deref().is_some_and(|source_id| {
                        self.source_frame_slots.contains_key(source_id)
                            && self.source_frames.contains_key(source_id)
                    })
            })
            .count()
            .min(1024) as u32;
        let renderer_ready = self.renderer.is_some();
        let last_frame_ok = last_frame_error.is_none();
        let output_window_attached = self.output_window_attached && renderer_ready;
        let output_has_presented = self.stats.swapchain_presented > 0;
        let output_swapchain_ready =
            output_window_attached && last_frame_ok && output_has_presented;
        let output_present_healthy =
            output_swapchain_ready && self.stats.swapchain_present_consecutive_failures == 0;
        CoreStatus {
            running: self.running,
            backend: native_backend_name().to_string(),
            backend_ready: renderer_ready && last_frame_ok,
            adapter_name: self.adapter_name.clone(),
            native_caps: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.native_caps.clone())
                .unwrap_or_default(),
            native_quality: self.native_quality.clone(),
            width: self.pending_width,
            height: self.pending_height,
            target_fps: self.target_fps,
            present_mode: self.present_mode.clone(),
            surface_present_mode: self
                .renderer
                .as_ref()
                .map(RenderState::present_mode_label)
                .unwrap_or_else(|| "unconfigured".to_string()),
            allow_tearing: self.allow_tearing,
            max_frame_latency: self.max_frame_latency,
            use_waitable_object: false,
            command_queue_capacity: self.command_queue_capacity,
            command_drain_limit: self.command_drain_limit,
            auto_present_on_state_change: self.auto_present_on_state_change,
            decode_store_cpu_backup_frames: self.decode_store_cpu_backup_frames,
            decode_allow_synthetic_fallback: self.decode_allow_synthetic_fallback,
            media_queue_capacity: self.media_queue_capacity,
            decode_handoff_queue_capacity: self.decode_handoff_queue_capacity,
            media_high_burst_limit: self.media_high_burst_limit,
            prefetch_cache_max_entries: self.prefetch_cache_max_entries,
            prefetch_cache_prune_count: self.prefetch_cache_prune_count,
            media_drop_command_pressure_pct: self.media_drop_command_pressure_pct,
            media_drop_decode_pressure_pct: self.media_drop_decode_pressure_pct,
            media_drop_io_pressure_pct: self.media_drop_io_pressure_pct,
            media_drop_decode_priority_cutoff: self.media_drop_decode_priority_cutoff,
            media_drop_io_priority_cutoff: self.media_drop_io_priority_cutoff,
            decode_preview_size: self.decode_preview_size,
            decode_preview_cache_mb: self.decode_preview_cache_mb,
            decode_use_output_resolution: self.decode_use_output_resolution,
            decode_target_width: if self.decode_use_output_resolution {
                self.pending_width
            } else {
                self.decode_preview_size
            },
            decode_target_height: if self.decode_use_output_resolution {
                self.pending_height
            } else {
                self.decode_preview_size
            },
            decode_preview_cache_bypassed: false,
            decode_upload_queue_cap_mb: self.decode_upload_queue_cap_mb,
            decode_handoff_byte_cap_mb: self.decode_handoff_byte_cap_mb,
            decode_handoff_predecode_shed_pct: self.decode_handoff_predecode_shed_pct,
            decode_predecode_estimate_cache_entries: 0,
            decode_predecode_estimate_cache_cap_entries: self
                .decode_predecode_estimate_cache_cap_entries,
            decode_predecode_estimate_cache_backpressure_active: false,
            decode_backpressure_active: self.native_video_decode_pending.len()
                >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT,
            decode_jobs_submitted: self.stats.decode_jobs_submitted,
            decode_jobs_completed: self.stats.decode_jobs_completed,
            decode_jobs_dropped: self.stats.decode_jobs_dropped,
            decode_queue_peak: self.stats.decode_queue_peak,
            vram_budget_mb: self.vram_budget_mb,
            command_drain_limit_hits: self.stats.command_drain_limit_hits,
            queued_commands_after_drain: self.stats.queued_commands_after_drain,
            source_preview_size: SOURCE_PREVIEW_SIZE as u32,
            source_previews_active: self.source_previews.len().min(1024) as u32,
            source_preview_slots: MAX_SOURCE_PREVIEWS as u32,
            source_preview_dirty: self.source_preview_dirty,
            source_frame_size: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.source_frame_size as u32)
                .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT as u32),
            source_frame_format: self
                .renderer
                .as_ref()
                .map(|renderer| texture_format_label(renderer.source_frame_format).to_string())
                .unwrap_or_else(|| texture_format_label(SOURCE_FRAME_FORMAT_FALLBACK).to_string()),
            source_frame_hdr: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.source_frame_format == SOURCE_FRAME_FORMAT_HDR)
                .unwrap_or(false),
            source_frame_mip_levels: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.source_frame_mip_levels)
                .unwrap_or(1),
            source_frames_active: self.source_frames.len().min(1024) as u32,
            source_frame_slots: MAX_SOURCE_FRAME_SLOTS as u32,
            isf_shader_bindings: self.isf_layer_bindings.len().min(1024) as u32,
            isf_uniform_sets: self.isf_uniforms.len().min(1024) as u32,
            native_shader_layers: self
                .scene_layers
                .values()
                .filter(|layer| layer.shader_rendered)
                .count()
                .min(1024) as u32,
            native_procedural_layers: self
                .scene_layers
                .values()
                .filter(|layer| {
                    layer.visible
                        && layer.frame_slot.is_none()
                        && (layer.shader_rendered || layer.source_kind >= 9.0)
                })
                .count()
                .min(1024) as u32,
            native_instrument_layers: native_instrument_proxy_layers,
            native_instrument_proxy_layers,
            native_graph_source_frame_layers,
            shader_precompile_queue_cap: self.shader_precompile_queue_cap,
            shader_precompile_per_frame: self.shader_precompile_per_frame,
            shader_metadata_cache_cap: self.shader_metadata_cache_cap,
            pipeline_metadata_cache_cap: self.pipeline_metadata_cache_cap,
            texture_pool_cap_mb: self.texture_pool_cap_mb,
            shader_cache_entries: self.shader_registry.len().min(u32::MAX as usize) as u32,
            pipeline_cache_entries: self
                .renderer
                .as_ref()
                .map(RenderState::native_pipeline_cache_count)
                .unwrap_or(0),
            precompiled_vertex_shaders: self.precompiled_shader_count("vertex"),
            precompiled_pixel_shaders: self.precompiled_shader_count("pixel"),
            shader_precompile_queued: self.stats.shader_precompile_queued,
            shader_precompile_compiled: self.stats.shader_precompile_compiled,
            shader_precompile_failed: self.stats.shader_precompile_failed,
            shader_precompile_dropped: self.stats.shader_precompile_dropped,
            source_frame_uploads: self.stats.source_frame_uploads,
            source_frame_bytes_uploaded: self.stats.source_frame_bytes_uploaded,
            source_frame_cpu_fallback_uploads: self.stats.source_frame_cpu_fallback_uploads,
            source_frame_file_uploads: self.stats.source_frame_file_uploads,
            source_frame_base64_uploads: self.stats.source_frame_base64_uploads,
            source_frame_json_uploads: self.stats.source_frame_json_uploads,
            source_frame_shared_texture_uploads: self.stats.source_frame_shared_texture_uploads,
            source_frame_shared_texture_rejected_uploads: self
                .stats
                .source_frame_shared_texture_rejected_uploads,
            source_frame_rejected_uploads: self.stats.source_frame_rejected_uploads,
            source_frame_input_bytes_uploaded: self.stats.source_frame_input_bytes_uploaded,
            source_frame_resampled_bytes_uploaded: self.stats.source_frame_resampled_bytes_uploaded,
            source_frame_last_input_bytes: self.stats.source_frame_last_input_bytes,
            source_frame_last_upload_bytes: self.stats.source_frame_last_upload_bytes,
            source_frame_last_upload_width: self.stats.source_frame_last_upload_width,
            source_frame_last_upload_height: self.stats.source_frame_last_upload_height,
            source_frame_last_upload_transport: if self
                .stats
                .source_frame_last_upload_transport
                .is_empty()
            {
                "none".to_string()
            } else {
                self.stats.source_frame_last_upload_transport.clone()
            },
            source_frame_last_reject_reason: if self
                .stats
                .source_frame_last_reject_reason
                .is_empty()
            {
                "none".to_string()
            } else {
                self.stats.source_frame_last_reject_reason.clone()
            },
            native_image_decodes: self.stats.native_image_decodes,
            native_image_decode_failures: self.stats.native_image_decode_failures,
            native_image_decode_bytes_uploaded: self.stats.native_image_decode_bytes_uploaded,
            native_image_decode_last_error: if self.stats.native_image_decode_last_error.is_empty()
            {
                "none".to_string()
            } else {
                self.stats.native_image_decode_last_error.clone()
            },
            native_video_frame_decodes: self.stats.native_video_frame_decodes,
            native_video_frame_decode_failures: self.stats.native_video_frame_decode_failures,
            native_video_frame_decode_bytes_uploaded: self
                .stats
                .native_video_frame_decode_bytes_uploaded,
            native_video_frame_decode_last_error: if self
                .stats
                .native_video_frame_decode_last_error
                .is_empty()
            {
                "none".to_string()
            } else {
                self.stats.native_video_frame_decode_last_error.clone()
            },
            native_video_frame_cache_entries: self
                .native_video_frame_cache
                .len()
                .min(u32::MAX as usize) as u32,
            native_video_frame_cache_bytes: self.native_video_frame_cache_bytes as u64,
            native_video_frame_cache_hits: self.stats.native_video_frame_cache_hits,
            native_video_frame_cache_misses: self.stats.native_video_frame_cache_misses,
            native_video_frame_cache_evictions: self.stats.native_video_frame_cache_evictions,
            native_instrument_frame_renders: self.stats.native_instrument_frame_renders,
            compute_graph_runs: self.stats.compute_graph_runs,
            compute_graph_passes: self.stats.compute_graph_passes,
            compute_graph_render_passes: self.stats.compute_graph_render_passes,
            compute_graph_snapshot_renders: self.stats.compute_graph_snapshot_renders,
            compute_graph_source_frame_renders: self.stats.compute_graph_source_frame_renders,
            compute_graph_readbacks: self.stats.compute_graph_readbacks,
            compute_graph_readback_bytes: self.stats.compute_graph_readback_bytes,
            compute_graph_persistent_buffers: self
                .renderer
                .as_ref()
                .map(RenderState::native_compute_graph_buffer_count)
                .unwrap_or(0),
            render_clock_mode: self.render_clock_mode.clone(),
            render_clock_time: self.render_clock_time.unwrap_or(0.0),
            render_clock_frame_index: self
                .render_clock_frame_index
                .unwrap_or(self.stats.frames_presented),
            render_clock_updates: self.stats.render_clock_updates,
            frame_snapshot_reads: self.stats.frame_snapshot_reads,
            frame_snapshot_bytes_read: self.stats.frame_snapshot_bytes_read,
            frame_health_checks: self.stats.frame_health_checks,
            dark_frame_warnings: self.stats.dark_frame_warnings,
            last_frame_checksum: last_frame_metrics.map(|metrics| metrics.checksum.clone()),
            last_frame_nonzero_pixels: last_frame_metrics
                .map(|metrics| metrics.nonzero_pixels)
                .unwrap_or(0),
            last_frame_bright_pixels: last_frame_metrics
                .map(|metrics| metrics.bright_pixels)
                .unwrap_or(0),
            last_frame_average_luma: last_frame_metrics
                .map(|metrics| metrics.average_luma)
                .unwrap_or(0.0),
            last_frame_max_luma: last_frame_metrics
                .map(|metrics| metrics.max_luma)
                .unwrap_or(0.0),
            last_frame_dark: last_frame_metrics
                .map(|metrics| metrics.dark_frame)
                .unwrap_or(false),
            last_shader_error: self.last_shader_error.clone(),
            frames_presented: self.stats.frames_presented,
            commands_applied: self.stats.commands_applied,
            commands_dropped: self.stats.commands_dropped,
            layers_seen: self.layers_seen,
            output_width: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.config.width)
                .unwrap_or(self.pending_width),
            output_height: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.config.height)
                .unwrap_or(self.pending_height),
            output_format: self
                .renderer
                .as_ref()
                .map(|renderer| texture_format_label(renderer.config.format).to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            output_refresh_hz: self.target_fps,
            output_window_attached,
            output_swapchain_ready,
            output_tearing_active: self
                .renderer
                .as_ref()
                .is_some_and(RenderState::tearing_active),
            output_waitable_object_active: false,
            output_present_healthy,
            output_present_consecutive_failures: self.stats.swapchain_present_consecutive_failures,
            swapchain_present_attempts: self.stats.swapchain_present_attempts,
            swapchain_presented: self.stats.swapchain_presented,
            swapchain_present_failures: self.stats.swapchain_present_failures,
            swapchain_last_present_result: if self.stats.swapchain_last_present_result.is_empty() {
                "none".to_string()
            } else {
                self.stats.swapchain_last_present_result.clone()
            },
            swapchain_last_present_error: if self.stats.swapchain_last_present_error.is_empty() {
                "none".to_string()
            } else {
                self.stats.swapchain_last_present_error.clone()
            },
            swapchain_present_timeouts: self.stats.swapchain_present_timeouts,
            swapchain_present_occluded: self.stats.swapchain_present_occluded,
            swapchain_present_outdated: self.stats.swapchain_present_outdated,
            swapchain_present_lost: self.stats.swapchain_present_lost,
            swapchain_present_validation_errors: self.stats.swapchain_present_validation_errors,
            swapchain_present_max_consecutive_failures: self
                .stats
                .swapchain_present_max_consecutive_failures,
            swapchain_present_tearing_attempts: self.stats.swapchain_present_tearing_attempts,
            swapchain_waitable_waits: self.stats.swapchain_waitable_waits,
            swapchain_waitable_timeouts: self.stats.swapchain_waitable_timeouts,
            frames_without_swapchain_present: self.stats.frames_without_swapchain_present,
            supports_tearing: self
                .renderer
                .as_ref()
                .is_some_and(RenderState::supports_tearing),
            supports_waitable_object: false,
            gpu_timing_supported,
            avg_render_cpu_ms: self.render_cpu_ema_ms,
            last_render_gpu_ms,
            avg_render_gpu_ms,
            max_render_gpu_ms,
            gpu_timing_samples,
            gpu_timing_resolve_misses,
            last_frame_error,
        }
    }

    fn send_ok(&self, id: u64, result: Value) {
        let _ = self
            .response_tx
            .send(json!({ "id": id, "ok": true, "result": result }).to_string());
    }

    fn send_error(&self, id: u64, err: impl ToString) {
        let _ = self
            .response_tx
            .send(json!({ "id": id, "ok": false, "error": err.to_string() }).to_string());
    }

    fn handle_rpc(&mut self, event_loop: &ActiveEventLoop, req: RpcRequest) {
        let result = match req.method.as_str() {
            "start" => {
                self.apply_start_config(&req.params);
                self.running = true;
                let now = Instant::now();
                self.last_redraw = now.checked_sub(self.frame_duration()).unwrap_or(now);
                self.ensure_renderer(event_loop).map(|_| {
                    if let Some(renderer) = self.renderer.as_ref() {
                        renderer.window.request_redraw();
                    }
                    json!(self.status())
                })
            }
            "stop" => {
                self.running = false;
                Ok(json!(true))
            }
            "status" | "get_status" => Ok(json!(self.status())),
            "stats" | "get_stats" => {
                self.stats.avg_render_cpu_ms = self.render_cpu_ema_ms;
                if let Some(renderer) = self.renderer.as_ref() {
                    let (
                        gpu_timing_supported,
                        last_render_gpu_ms,
                        avg_render_gpu_ms,
                        max_render_gpu_ms,
                        gpu_timing_samples,
                        gpu_timing_resolve_misses,
                    ) = renderer.gpu_timing_stats();
                    self.stats.gpu_timing_supported = gpu_timing_supported;
                    self.stats.last_render_gpu_ms = last_render_gpu_ms;
                    self.stats.avg_render_gpu_ms = avg_render_gpu_ms;
                    self.stats.max_render_gpu_ms = max_render_gpu_ms;
                    self.stats.gpu_timing_samples = gpu_timing_samples;
                    self.stats.gpu_timing_resolve_misses = gpu_timing_resolve_misses;
                    self.stats.compute_graph_persistent_buffers =
                        renderer.native_compute_graph_buffer_count() as u64;
                }
                Ok(json!(self.stats.clone()))
            }
            "snapshot" | "get_snapshot" => Ok(json!({
                "timestamp_ms": epoch_ms(),
                "status": self.status(),
                "stats": self.stats,
                "shader_registry": self.shader_registry_snapshot(),
            })),
            "frame_snapshot" | "get_frame_snapshot" => self.frame_snapshot(&req.params),
            "export_frame_snapshot" => self.export_frame_snapshot(&req.params),
            "prefetch_media" => self.prefetch_media(&req.params),
            "clear_prefetch_cache" => Ok(self.clear_prefetch_cache()),
            "clear_decode_preview_cache" => Ok(self.clear_decode_preview_cache()),
            "decode_capabilities" | "get_decode_capabilities" => Ok(self.decode_capabilities()),
            "upload_source_gpu_shared_texture" => {
                self.upload_source_gpu_shared_texture(&req.params)
            }
            "output_shared_texture" | "get_output_shared_texture" => {
                Ok(self.output_shared_texture())
            }
            "set_stage3d_scene" => self.set_stage3d_scene(&req.params),
            "get_stage3d_scene_summary" => Ok(json!(self.stage3d_scene_summary.clone())),
            "set_projection_sim_scene" => self.set_projection_sim_scene(&req.params),
            "get_projection_sim_scene_summary" => {
                Ok(json!(self.projection_sim_scene_summary.clone()))
            }
            "capabilities" | "get_capabilities" => Ok(self.capabilities()),
            "compute_probe" | "run_compute_probe" => self.compute_probe(&req.params),
            "compute_graph" | "run_compute_graph" => {
                let result = self.compute_graph(&req.params);
                if result.is_ok() {
                    self.request_auto_present();
                }
                result
            }
            "readiness" | "get_readiness_report" => Ok(json!({
                "timestamp_ms": epoch_ms(),
                "overall_ready": self.renderer.is_some(),
                "blockers": if self.renderer.is_some() { Vec::<String>::new() } else { vec!["native renderer has not created a wgpu device".to_string()] },
                "capabilities": self.capabilities(),
                "checks": [
                    {
                        "id": "wgpu-device",
                        "label": "Native wgpu device",
                        "ok": self.renderer.is_some(),
                        "detail": self.adapter_name.clone().unwrap_or_else(|| "not initialized".to_string())
                    },
                    {
                        "id": "shared-texture-source-frame-upload",
                        "label": "Shared texture source-frame transport",
                        "ok": cfg!(target_os = "macos"),
                        "detail": if cfg!(target_os = "macos") { "implemented for IOSurfaceID source-frame handles" } else { "pending backend-specific shared texture import" }
                    },
                    {
                        "id": "shared-texture-upload",
                        "label": "Shared texture media transport",
                        "ok": self.shared_texture_media_transport_ready(),
                        "detail": if self.shared_texture_media_transport_ready() { "macOS IOSurfaceID media transport is active for source-frame handles; local video/still media bypasses canvas/base64 through native decode" } else { "full media shared texture transport is pending for this backend" }
                    },
                    {
                        "id": "native-output-mirror",
                        "label": "Native offscreen output mirror",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "composite renders into a native offscreen output texture before swapchain present" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "shared-texture-output-export",
                        "label": "Native output shared-texture export",
                        "ok": self.renderer.as_ref().is_some_and(RenderState::output_export_ready),
                        "detail": if self.renderer.as_ref().is_some_and(RenderState::output_export_ready) {
                            "native output mirror is exported as an IOSurface handle".to_string()
                        } else if cfg!(target_os = "macos") {
                            "native output IOSurface export target is unavailable".to_string()
                        } else {
                            "pending core-to-Electron DXGI output texture export".to_string()
                        }
                    },
                    {
                        "id": "native-texture-share-sender",
                        "label": if cfg!(target_os = "macos") { "Native Syphon sender" } else { "Native Spout sender" },
                        "ok": false,
                        "detail": "pending zero-copy texture-share sender from the native composite"
                    },
                    {
                        "id": "compute-instrument-host",
                        "label": "Native compute/multi-pass instrument host",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can run real WGSL graph instruments with persistent buffers and source-frame render targets" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-planet-graph",
                        "label": "Native Planet graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Planet into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-3d-smoke-graph",
                        "label": "Native 3D Smoke graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render 3D Smoke into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-frame-sequence-export",
                        "label": "Native frame sequence export",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "native output snapshots can be stepped by render clock and exported as raw frame files" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-frame-export",
                        "label": "Native frame export",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "render core can export deterministic raw frame snapshots for MP4/JPEG encoders" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-particle-field-graph",
                        "label": "Native Particle Field graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Particle Field behavior/render passes into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-volumetric-spheres-graph",
                        "label": "Native Volumetric Spheres graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Volumetric Spheres sim/render passes into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-smoke-riders-graph",
                        "label": "Native Smoke Riders graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can compose 3D Smoke and Volumetric Spheres into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-ink-cloud-graph",
                        "label": "Native Ink Cloud graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Ink Cloud sim/background/render passes into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-flythrough-graph",
                        "label": "Native Flythrough graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Flythrough source-sampled particles into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-pixel-particles-graph",
                        "label": "Native Pixel Particles graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render source-driven Pixel Particles into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-point-cloud-fx-graph",
                        "label": "Native Point Cloud FX graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render PLY/splat point-buffer effects into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "managed-output",
                        "label": "Managed output window",
                        "ok": self.status().output_present_healthy,
                        "detail": if !self.output_window_attached {
                            "native output window is detached/hidden".to_string()
                        } else if self.stats.swapchain_presented == 0 {
                            format!("waiting for first native swapchain present; last={}", if self.stats.swapchain_last_present_result.is_empty() { "none" } else { self.stats.swapchain_last_present_result.as_str() })
                        } else if self.stats.swapchain_present_consecutive_failures > 0 {
                            format!("native output present has {} consecutive failure(s); last={}", self.stats.swapchain_present_consecutive_failures, if self.stats.swapchain_last_present_result.is_empty() { "none" } else { self.stats.swapchain_last_present_result.as_str() })
                        } else {
                            format!("native output presented {} frame(s)", self.stats.swapchain_presented)
                        }
                    },
                    {
                        "id": "native-recording",
                        "label": "Native recording",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "render core provides raw frame export; desktop bridge owns MP4/JPEG encoder sessions" } else { "native renderer has not created a wgpu device" }
                    }
                ]
            })),
            "reset_stats" => {
                self.stats = CoreStats::default();
                self.render_cpu_ema_ms = 0.0;
                self.native_quality.cpu_ema_ms = 0.0;
                self.native_quality.overload_frames = 0;
                self.native_quality.recovery_frames = 0;
                self.native_quality.step_downs = 0;
                self.native_quality.step_ups = 0;
                Ok(json!(true))
            }
            "submit_batch" => {
                let summary = self.apply_batch(&req.params);
                self.request_auto_present();
                Ok(summary)
            }
            "submit_commands" => {
                let summary =
                    self.apply_commands(req.params.get("commands").unwrap_or(&req.params));
                self.request_auto_present();
                Ok(summary)
            }
            "set_output" => {
                self.apply_output_config(&req.params);
                Ok(json!(true))
            }
            "set_output_window" => {
                self.apply_output_window_config(&req.params);
                Ok(json!(self.status()))
            }
            "set_present_policy" => {
                self.apply_present_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_command_drain_policy" => {
                self.apply_command_drain_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_auto_present_policy" => {
                self.apply_auto_present_policy(&req.params);
                Ok(json!(self.status()))
            }
            "attach_output_window" => {
                self.apply_output_window_attached(true);
                Ok(json!(self.status()))
            }
            "detach_output_window" => {
                self.apply_output_window_attached(false);
                Ok(json!(self.status()))
            }
            "set_target_fps" => {
                self.target_fps = number_at(&req.params, &["config", "target_fps"])
                    .or_else(|| number_at(&req.params, &["target_fps"]))
                    .unwrap_or(self.target_fps as f64)
                    .round()
                    .clamp(1.0, 240.0) as u32;
                Ok(json!(true))
            }
            "set_native_quality_policy" => {
                self.apply_native_quality_policy(&req.params);
                Ok(json!(true))
            }
            "set_render_clock" => {
                self.apply_render_clock(&req.params);
                Ok(json!(true))
            }
            "set_shader_precompile_policy" => {
                self.apply_shader_precompile_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_texture_pool_cap" => {
                self.apply_texture_pool_cap(&req.params);
                Ok(json!(self.status()))
            }
            "set_vram_budget" => {
                self.apply_vram_budget(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_cpu_backup_policy" => {
                self.apply_decode_cpu_backup_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_synthetic_fallback_policy" => {
                self.apply_decode_synthetic_fallback_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_media_prefetch_policy" => {
                self.apply_media_prefetch_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_media_drop_policy" => {
                self.apply_media_drop_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_preview_policy" => {
                self.apply_decode_preview_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_target_policy" => {
                self.apply_decode_target_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_upload_policy" => {
                self.apply_decode_upload_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_handoff_policy" => {
                self.apply_decode_handoff_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_decode_estimate_cache_policy" => {
                self.apply_decode_estimate_cache_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_metadata_cache_caps" => {
                self.apply_metadata_cache_caps(&req.params);
                Ok(json!(self.status()))
            }
            "clear_runtime_caches" => Ok(self.clear_runtime_caches(&req.params)),
            "shutdown" => {
                self.running = false;
                event_loop.exit();
                Ok(json!(true))
            }
            _ => Err(format!(
                "unsupported native render-core RPC method `{}`",
                req.method
            )),
        };

        match result {
            Ok(value) => self.send_ok(req.id, value),
            Err(err) => self.send_error(req.id, err),
        }
    }

    fn apply_start_config(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.pending_width = number_at(config, &["width"])
            .unwrap_or(self.pending_width as f64)
            .round()
            .clamp(64.0, 16384.0) as u32;
        self.pending_height = number_at(config, &["height"])
            .unwrap_or(self.pending_height as f64)
            .round()
            .clamp(64.0, 16384.0) as u32;
        self.target_fps = number_at(config, &["target_fps"])
            .unwrap_or(self.target_fps as f64)
            .round()
            .clamp(1.0, 240.0) as u32;
        self.apply_present_policy(config);
        self.apply_command_drain_policy(config);
        self.apply_auto_present_policy(config);
        self.apply_native_quality_policy(config);
        self.apply_vram_budget(config);
        self.apply_decode_cpu_backup_policy(config);
        self.apply_decode_synthetic_fallback_policy(config);
        self.apply_media_prefetch_policy(config);
        self.apply_media_drop_policy(config);
        self.apply_decode_preview_policy(config);
        self.apply_decode_target_policy(config);
        self.apply_decode_upload_policy(config);
        self.apply_decode_handoff_policy(config);
        self.apply_decode_estimate_cache_policy(config);
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.resize(PhysicalSize::new(self.pending_width, self.pending_height));
        }
    }

    fn apply_output_config(&mut self, params: &Value) {
        let width = number_at(params, &["width"]).unwrap_or(self.pending_width as f64);
        let height = number_at(params, &["height"]).unwrap_or(self.pending_height as f64);
        self.pending_width = width.round().clamp(64.0, 16384.0) as u32;
        self.pending_height = height.round().clamp(64.0, 16384.0) as u32;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.resize(PhysicalSize::new(self.pending_width, self.pending_height));
        }
    }

    fn apply_present_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        if let Some(mode) = string_at(config, &["present_mode"]) {
            let normalized = mode.trim().to_ascii_lowercase();
            self.present_mode =
                if normalized == "immediate" || normalized == "no-vsync" || normalized == "novsync"
                {
                    "immediate".to_string()
                } else {
                    "vsync".to_string()
                };
        }
        self.allow_tearing = bool_at(config, &["allow_tearing"]).unwrap_or(self.allow_tearing);
        self.max_frame_latency = number_at(config, &["max_frame_latency"])
            .unwrap_or(self.max_frame_latency as f64)
            .round()
            .clamp(1.0, 8.0) as u32;
        self.use_waitable_object = false;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.set_present_policy(
                &self.present_mode,
                self.allow_tearing,
                self.max_frame_latency,
            );
        }
    }

    fn apply_command_drain_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.command_queue_capacity = number_at(config, &["command_queue_capacity"])
            .unwrap_or(self.command_queue_capacity as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.command_drain_limit = number_at(config, &["max_commands_per_tick"])
            .or_else(|| number_at(config, &["command_drain_limit"]))
            .unwrap_or(self.command_drain_limit as f64)
            .round()
            .clamp(1.0, self.command_queue_capacity.max(1) as f64)
            as u32;
    }

    fn apply_auto_present_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.auto_present_on_state_change = bool_at(config, &["auto_present_on_state_change"])
            .unwrap_or(self.auto_present_on_state_change);
    }

    fn apply_output_window_attached(&mut self, attached: bool) {
        self.output_window_attached = attached;
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.window.set_visible(attached);
            if attached {
                renderer.window.request_redraw();
            }
        }
    }

    fn apply_output_window_config(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        let attached = bool_at(config, &["attached"])
            .or_else(|| bool_at(config, &["visible"]))
            .or_else(|| bool_at(config, &["enabled"]));
        if let Some(attached) = attached {
            self.output_window_attached = attached;
        }

        let width = number_at(config, &["width"])
            .or_else(|| number_at(config, &["w"]))
            .map(|value| value.round().clamp(1.0, 32768.0) as u32);
        let height = number_at(config, &["height"])
            .or_else(|| number_at(config, &["h"]))
            .map(|value| value.round().clamp(1.0, 32768.0) as u32);
        if let (Some(width), Some(height)) = (width, height) {
            self.pending_width = width;
            self.pending_height = height;
        }

        let Some(renderer) = self.renderer.as_ref() else {
            return;
        };
        if let Some(title) = string_at(config, &["title"]).or_else(|| string_at(config, &["label"]))
        {
            renderer.window.set_title(&title);
        }
        if let Some(resizable) = bool_at(config, &["resizable"]) {
            renderer.window.set_resizable(resizable);
        }
        if let Some(decorations) =
            bool_at(config, &["decorations"]).or_else(|| bool_at(config, &["decorated"]))
        {
            renderer.window.set_decorations(decorations);
        }
        if let (Some(width), Some(height)) = (width, height) {
            let _ = renderer
                .window
                .request_inner_size(LogicalSize::new(width as f64, height as f64));
        }
        let x = number_at(config, &["x"]).or_else(|| number_at(config, &["left"]));
        let y = number_at(config, &["y"]).or_else(|| number_at(config, &["top"]));
        if let (Some(x), Some(y)) = (x, y) {
            renderer
                .window
                .set_outer_position(LogicalPosition::new(x, y));
        }
        if let Some(fullscreen) = bool_at(config, &["fullscreen"])
            .or_else(|| bool_at(config, &["full_screen"]))
            .or_else(|| bool_at(config, &["borderless"]))
        {
            renderer.window.set_fullscreen(if fullscreen {
                Some(Fullscreen::Borderless(None))
            } else {
                None
            });
        }
        renderer.window.set_visible(self.output_window_attached);
        if self.output_window_attached {
            renderer.window.request_redraw();
        }
    }

    fn request_auto_present(&mut self) {
        if !self.auto_present_on_state_change {
            return;
        }
        self.auto_present_requested = true;
        self.request_present();
    }

    fn request_present(&mut self) {
        if let Some(renderer) = self.renderer.as_ref() {
            self.last_redraw = Instant::now();
            renderer.window.request_redraw();
        }
    }

    fn apply_render_clock(&mut self, params: &Value) {
        let params = params.get("config").unwrap_or(params);
        let mode = string_at(params, &["mode"])
            .unwrap_or_else(|| "live".to_string())
            .trim()
            .to_ascii_lowercase();
        if mode == "reset" {
            self.render_clock_mode = "live".to_string();
            self.render_clock_time = None;
            self.render_clock_frame_index = None;
            self.render_clock_delta = 1.0 / self.target_fps.max(1) as f32;
            self.stats.render_clock_updates = self.stats.render_clock_updates.saturating_add(1);
            return;
        }
        self.render_clock_mode = if mode == "manual" {
            "manual".to_string()
        } else {
            "live".to_string()
        };
        self.render_clock_time = number_at(params, &["time"])
            .or_else(|| number_at(params, &["time_seconds"]))
            .or_else(|| number_at(params, &["clock_time"]))
            .map(|value| value.clamp(0.0, 1.0e9) as f32);
        self.render_clock_delta = number_at(params, &["time_delta"])
            .or_else(|| number_at(params, &["delta"]))
            .unwrap_or(1.0 / self.target_fps.max(1) as f64)
            .clamp(0.0, 10.0) as f32;
        self.render_clock_frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u64::MAX as f64) as u64);
        self.stats.render_clock_updates = self.stats.render_clock_updates.saturating_add(1);
    }

    fn apply_batch(&mut self, params: &Value) -> Value {
        let mut summary = if let Some(commands) = params
            .pointer("/batch/commands")
            .or_else(|| params.get("commands"))
        {
            self.apply_commands(commands)
        } else {
            json!({
                "total": 0,
                "applied": 0,
                "dropped": 0,
                "unknown_types": [],
                "invalid_payload": true,
                "command_drain_limit": self.command_drain_limit,
            })
        };
        self.stats.frames_submitted = self.stats.frames_submitted.saturating_add(1);
        if let Some(object) = summary.as_object_mut() {
            object.insert(
                "frames_submitted".to_string(),
                json!(self.stats.frames_submitted),
            );
        }
        summary
    }

    fn apply_commands(&mut self, commands: &Value) -> Value {
        let Some(commands) = commands.as_array() else {
            return json!({
                "total": 0,
                "applied": 0,
                "dropped": 0,
                "unknown_types": [],
                "invalid_payload": true,
                "command_drain_limit": self.command_drain_limit,
            });
        };
        let count = commands.len() as u64;
        let mut applied = 0u64;
        let mut dropped = 0u64;
        let mut unknown_types = Vec::<String>::new();
        self.stats.command_queue_peak = self.stats.command_queue_peak.max(count);
        if count > self.command_drain_limit as u64 {
            self.stats.command_drain_limit_hits =
                self.stats.command_drain_limit_hits.saturating_add(1);
            self.stats.queued_commands_after_drain = 0;
        }

        for command in commands {
            let command_type = command
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match command_type {
                "set_output" => self.apply_output_config(command),
                "upsert_layer" => self.apply_upsert_layer(command),
                "set_layer_visibility" => self.apply_layer_visibility(command),
                "set_layer_color" => self.apply_layer_color(command),
                "set_layer_native_params" => self.apply_layer_native_params(command),
                "set_effect_chain" => self.apply_effect_chain(command),
                "set_present_policy" => self.apply_present_policy(command),
                "set_command_drain_policy" | "set_command_drain_limit" => {
                    self.apply_command_drain_policy(command)
                }
                "set_auto_present_policy" => self.apply_auto_present_policy(command),
                "set_vram_budget" => self.apply_vram_budget(command),
                "set_decode_cpu_backup_policy" => self.apply_decode_cpu_backup_policy(command),
                "set_decode_synthetic_fallback_policy" => {
                    self.apply_decode_synthetic_fallback_policy(command)
                }
                "set_media_prefetch_policy" => self.apply_media_prefetch_policy(command),
                "set_media_drop_policy" => self.apply_media_drop_policy(command),
                "set_decode_preview_policy" => self.apply_decode_preview_policy(command),
                "set_decode_target_policy" => self.apply_decode_target_policy(command),
                "set_decode_upload_policy" => self.apply_decode_upload_policy(command),
                "set_decode_handoff_policy" => self.apply_decode_handoff_policy(command),
                "set_decode_estimate_cache_policy" => {
                    self.apply_decode_estimate_cache_policy(command)
                }
                "set_texture_pool_cap" => self.apply_texture_pool_cap(command),
                "set_shader_precompile_policy" => self.apply_shader_precompile_policy(command),
                "set_metadata_cache_caps" => self.apply_metadata_cache_caps(command),
                "set_native_quality_policy" => self.apply_native_quality_policy(command),
                "present" => self.request_present(),
                "set_audio_state" => self.apply_audio_state(command),
                "set_render_clock" => self.apply_render_clock(command),
                "set_media_source_playback" => self.apply_media_source_playback(command),
                "bind_media_source" => self.apply_media_source(command),
                "decode_media_source" => self.apply_decode_media_source(command),
                "set_stage3d_scene" => {
                    if self.set_stage3d_scene(command).is_err() {
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "set_projection_sim_scene" => {
                    if self.set_projection_sim_scene(command).is_err() {
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "upload_source_preview" => self.apply_source_preview(command),
                "upload_source_frame" | "upload_source_gpu_shared_texture" => {
                    self.apply_source_frame(command)
                }
                "precompile_shader" => self.apply_precompile_shader(command),
                "bind_isf_shader" => self.apply_bind_isf_shader(command),
                "update_isf_uniforms" => self.apply_isf_uniforms(command),
                "render_isf_to_layer" => self.apply_render_isf_to_layer(command),
                "remove_layer" => self.apply_remove_layer(command),
                _ => {
                    dropped = dropped.saturating_add(1);
                    if unknown_types.len() < 16 {
                        unknown_types.push(if command_type.is_empty() {
                            "<missing>".to_string()
                        } else {
                            command_type.to_string()
                        });
                    }
                    continue;
                }
            }
            applied = applied.saturating_add(1);
        }
        self.stats.commands_applied = self.stats.commands_applied.saturating_add(applied);
        self.stats.commands_dropped = self.stats.commands_dropped.saturating_add(dropped);
        self.command_phase = (self.command_phase + applied as f32 * 0.031).fract();
        self.layers_seen = self.scene_layers.len().min(1024) as u32;
        json!({
            "total": count,
            "applied": applied,
            "dropped": dropped,
            "unknown_types": unknown_types,
            "invalid_payload": false,
            "command_drain_limit": self.command_drain_limit,
            "command_queue_peak": self.stats.command_queue_peak,
        })
    }

    fn upload_source_gpu_shared_texture(&mut self, params: &Value) -> Result<Value, String> {
        if string_at(params, &["source_id"]).is_none() {
            return Err("native shared texture source-frame upload requires source_id".to_string());
        }
        self.apply_source_frame(params);
        Ok(json!(self.status()))
    }

    fn render(&mut self) {
        if !self.running {
            return;
        }
        let frame_index = self
            .render_clock_frame_index
            .unwrap_or(self.stats.frames_presented);
        let gpu_layers = self.gpu_layer_data();
        let source_preview_pixels = if self.source_preview_dirty {
            Some(self.source_preview_pixel_data())
        } else {
            None
        };
        let stage3d_mesh_frame = self.stage3d_mesh_frame();
        let scene_overlay_items = self.scene_overlay_items();
        let Some(renderer) = self.renderer.as_mut() else {
            return;
        };
        renderer.poll_gpu_timing();
        let started = Instant::now();
        self.stats.swapchain_present_attempts =
            self.stats.swapchain_present_attempts.saturating_add(1);
        match renderer.render(
            self.command_phase,
            gpu_layers.len() as u32,
            self.render_clock_time,
            frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            stage3d_mesh_frame.as_ref(),
            &scene_overlay_items,
            self.audio0,
            self.audio1,
            self.audio2,
        ) {
            Ok(outcome) if outcome.presented() => {
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.frames_presented = self.stats.frames_presented.saturating_add(1);
                self.stats.swapchain_presented = self.stats.swapchain_presented.saturating_add(1);
                self.stats.swapchain_present_consecutive_failures = 0;
                if self.auto_present_requested {
                    self.stats.frames_presented_auto =
                        self.stats.frames_presented_auto.saturating_add(1);
                    self.auto_present_requested = false;
                } else {
                    self.stats.frames_presented_explicit =
                        self.stats.frames_presented_explicit.saturating_add(1);
                }
                self.stats.draw_calls = self.stats.draw_calls.saturating_add(1);
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                self.stats.last_render_cpu_ms = ms;
                self.render_cpu_ema_ms = if self.render_cpu_ema_ms <= 0.0 {
                    ms
                } else {
                    self.render_cpu_ema_ms * 0.94 + ms * 0.06
                };
                let gpu_ms = renderer.last_render_gpu_ms();
                let (
                    gpu_timing_supported,
                    last_render_gpu_ms,
                    avg_render_gpu_ms,
                    max_render_gpu_ms,
                    gpu_timing_samples,
                    gpu_timing_resolve_misses,
                ) = renderer.gpu_timing_stats();
                self.stats.gpu_timing_supported = gpu_timing_supported;
                self.stats.last_render_gpu_ms = last_render_gpu_ms;
                self.stats.avg_render_gpu_ms = avg_render_gpu_ms;
                self.stats.max_render_gpu_ms = max_render_gpu_ms;
                self.stats.gpu_timing_samples = gpu_timing_samples;
                self.stats.gpu_timing_resolve_misses = gpu_timing_resolve_misses;
                self.native_quality
                    .observe_frame(ms, gpu_ms, self.target_fps, 0);
                if source_preview_pixels.is_some() {
                    self.source_preview_dirty = false;
                }
            }
            Ok(outcome) => {
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.swapchain_present_failures =
                    self.stats.swapchain_present_failures.saturating_add(1);
                match outcome {
                    SurfacePresentOutcome::Outdated => {
                        self.stats.swapchain_present_outdated =
                            self.stats.swapchain_present_outdated.saturating_add(1);
                    }
                    SurfacePresentOutcome::Timeout => {
                        self.stats.swapchain_present_timeouts =
                            self.stats.swapchain_present_timeouts.saturating_add(1);
                    }
                    SurfacePresentOutcome::Occluded => {
                        self.stats.swapchain_present_occluded =
                            self.stats.swapchain_present_occluded.saturating_add(1);
                    }
                    SurfacePresentOutcome::Presented
                    | SurfacePresentOutcome::SuboptimalPresented => {}
                }
                self.stats.swapchain_present_consecutive_failures = self
                    .stats
                    .swapchain_present_consecutive_failures
                    .saturating_add(1);
                self.stats.swapchain_present_max_consecutive_failures = self
                    .stats
                    .swapchain_present_max_consecutive_failures
                    .max(self.stats.swapchain_present_consecutive_failures);
                self.stats.frames_without_swapchain_present = self
                    .stats
                    .frames_without_swapchain_present
                    .saturating_add(1);
            }
            Err(err) => {
                self.stats.swapchain_last_present_result = if err.contains("surface lost") {
                    self.stats.swapchain_present_lost =
                        self.stats.swapchain_present_lost.saturating_add(1);
                    "lost".to_string()
                } else if err.contains("validation") {
                    self.stats.swapchain_present_validation_errors = self
                        .stats
                        .swapchain_present_validation_errors
                        .saturating_add(1);
                    "validation-error".to_string()
                } else {
                    "error".to_string()
                };
                self.stats.swapchain_last_present_error = err.clone();
                self.stats.swapchain_present_failures =
                    self.stats.swapchain_present_failures.saturating_add(1);
                self.stats.swapchain_present_consecutive_failures = self
                    .stats
                    .swapchain_present_consecutive_failures
                    .saturating_add(1);
                self.stats.swapchain_present_max_consecutive_failures = self
                    .stats
                    .swapchain_present_max_consecutive_failures
                    .max(self.stats.swapchain_present_consecutive_failures);
                self.stats.frames_without_swapchain_present = self
                    .stats
                    .frames_without_swapchain_present
                    .saturating_add(1);
                renderer.last_frame_error = Some(err);
            }
        }
    }

    fn snapshot_clock_from_params(&self, params: &Value) -> (Option<f32>, u64) {
        let snapshot_time = number_at(params, &["time"])
            .or_else(|| number_at(params, &["time_seconds"]))
            .or_else(|| number_at(params, &["clock_time"]))
            .map(|value| value.clamp(0.0, 1.0e9) as f32)
            .or(self.render_clock_time);
        let snapshot_frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u64::MAX as f64) as u64)
            .or(self.render_clock_frame_index)
            .unwrap_or(self.stats.frames_presented);
        (snapshot_time, snapshot_frame_index)
    }

    fn render_frame_snapshot_texture(
        &mut self,
        params: &Value,
    ) -> Result<(Option<f32>, u64), String> {
        let (snapshot_time, snapshot_frame_index) = self.snapshot_clock_from_params(params);
        let gpu_layers = self.gpu_layer_data();
        let source_preview_pixels = if self.source_preview_dirty {
            Some(self.source_preview_pixel_data())
        } else {
            None
        };
        let stage3d_mesh_frame = self.stage3d_mesh_frame();
        let scene_overlay_items = self.scene_overlay_items();
        let Some(renderer) = self.renderer.as_mut() else {
            return Err("native renderer has not created a wgpu device".to_string());
        };
        renderer.poll_gpu_timing();
        if let Err(err) = renderer.render_snapshot(
            self.command_phase,
            gpu_layers.len() as u32,
            snapshot_time,
            snapshot_frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            stage3d_mesh_frame.as_ref(),
            &scene_overlay_items,
            self.audio0,
            self.audio1,
            self.audio2,
        ) {
            renderer.last_frame_error = Some(err.clone());
            return Err(err);
        }
        if source_preview_pixels.is_some() {
            self.source_preview_dirty = false;
        }
        Ok((snapshot_time, snapshot_frame_index))
    }

    fn refresh_renderer_timing_stats(&mut self) {
        let Some(renderer) = self.renderer.as_ref() else {
            return;
        };
        let (
            gpu_timing_supported,
            last_render_gpu_ms,
            avg_render_gpu_ms,
            max_render_gpu_ms,
            gpu_timing_samples,
            gpu_timing_resolve_misses,
        ) = renderer.gpu_timing_stats();
        self.stats.gpu_timing_supported = gpu_timing_supported;
        self.stats.last_render_gpu_ms = last_render_gpu_ms;
        self.stats.avg_render_gpu_ms = avg_render_gpu_ms;
        self.stats.max_render_gpu_ms = max_render_gpu_ms;
        self.stats.gpu_timing_samples = gpu_timing_samples;
        self.stats.gpu_timing_resolve_misses = gpu_timing_resolve_misses;
    }

    fn note_frame_snapshot(&mut self, snapshot: &Value) {
        self.stats.frame_snapshot_reads = self.stats.frame_snapshot_reads.saturating_add(1);
        self.stats.frame_health_checks = self.stats.frame_health_checks.saturating_add(1);
        if bool_at(snapshot, &["dark_frame"]).unwrap_or(false) {
            self.stats.dark_frame_warnings = self.stats.dark_frame_warnings.saturating_add(1);
        }
        self.stats.frame_snapshot_bytes_read = self
            .stats
            .frame_snapshot_bytes_read
            .saturating_add(number_at(snapshot, &["byte_length"]).unwrap_or(0.0) as u64);
    }

    fn frame_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        let include_pixels = bool_at(params, &["include_pixels"]).unwrap_or(false);
        self.render_frame_snapshot_texture(params)?;
        let snapshot = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let snapshot = renderer.frame_snapshot(include_pixels)?;
            renderer.poll_gpu_timing();
            snapshot
        };
        self.refresh_renderer_timing_stats();
        self.note_frame_snapshot(&snapshot);
        Ok(snapshot)
    }

    fn export_frame_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        let output_path = string_at(params, &["path"])
            .or_else(|| string_at(params, &["file_path"]))
            .or_else(|| string_at(params, &["output_path"]))
            .ok_or_else(|| "export_frame_snapshot requires path".to_string())?;
        let storage_format = string_at(params, &["format"])
            .or_else(|| string_at(params, &["storage_format"]))
            .unwrap_or_else(|| "raw-texture".to_string())
            .to_ascii_lowercase();
        if !matches!(
            storage_format.as_str(),
            "raw" | "raw-texture" | "raw-rgba" | "raw-rgba8" | "rgba" | "rgba8"
        ) {
            return Err(format!(
                "unsupported frame snapshot export format '{storage_format}'; expected raw-texture"
            ));
        }
        let (snapshot_time, snapshot_frame_index) = self.render_frame_snapshot_texture(params)?;
        let (mut snapshot, pixels) = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let readback = renderer.read_frame_snapshot()?;
            let snapshot = readback.to_json(false);
            renderer.poll_gpu_timing();
            (snapshot, readback.pixels)
        };
        self.refresh_renderer_timing_stats();
        self.note_frame_snapshot(&snapshot);

        let path = Path::new(&output_path);
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::write(path, &pixels).map_err(|err| err.to_string())?;

        if let Some(object) = snapshot.as_object_mut() {
            object.insert("path".to_string(), Value::String(output_path));
            object.insert("bytes_written".to_string(), json!(pixels.len()));
            object.insert(
                "storage_format".to_string(),
                Value::String("raw-texture".to_string()),
            );
            object.insert("frame_index".to_string(), json!(snapshot_frame_index));
            object.insert(
                "time_seconds".to_string(),
                snapshot_time.map_or(Value::Null, |time| json!(time)),
            );
        }
        Ok(snapshot)
    }

    fn output_shared_texture(&self) -> Value {
        if let Some(renderer) = self.renderer.as_ref() {
            return renderer.output_export_metadata();
        }
        json!({
            "available": false,
            "platform": if cfg!(target_os = "macos") { "iosurface" } else if cfg!(target_os = "windows") { "dxgi" } else { "unsupported" },
            "reason": "native renderer has not created a wgpu device",
        })
    }

    fn compute_probe(&mut self, params: &Value) -> Result<Value, String> {
        let Some(shader_id) = string_at(params, &["shader_id"]) else {
            return Err("compute_probe requires shader_id".to_string());
        };
        let record = self
            .shader_registry
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| format!("compute shader `{shader_id}` has not been precompiled"))?;
        let source = self
            .shader_sources
            .get(&shader_id)
            .ok_or_else(|| format!("compute shader source missing for `{shader_id}`"))?;
        let entry = native_compute_entry(&record, source).ok_or_else(|| {
            format!("shader `{shader_id}` is not a supported native compute shader")
        })?;
        let element_count = number_at(params, &["element_count"])
            .or_else(|| number_at(params, &["count"]))
            .unwrap_or(256.0)
            .round()
            .clamp(1.0, 1_048_576.0) as u32;
        let frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u32::MAX as f64) as u32)
            .unwrap_or(self.stats.frames_presented.min(u32::MAX as u64) as u32);
        let seed = number_at(params, &["seed"])
            .map(|value| value.round().clamp(0.0, u32::MAX as f64) as u32)
            .unwrap_or_else(|| stable_hash64(&shader_id) as u32);
        let cache_key = format!("{}:{}:{:016x}", shader_id, entry, record.source_hash);
        let Some(renderer) = self.renderer.as_mut() else {
            return Err("native renderer has not created a wgpu device".to_string());
        };
        let probe = renderer.run_native_compute_probe(
            &cache_key,
            source,
            &entry,
            ComputeProbeUniforms {
                element_count,
                frame_index,
                seed,
                _pad0: 0,
            },
        )?;
        self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
        Ok(json!({
            "shader_id": shader_id,
            "entry": entry,
            "element_count": element_count,
            "frame_index": frame_index,
            "seed": seed,
            "byte_length": probe.byte_length,
            "checksum": format!("{:016x}", probe.checksum),
            "nonzero_words": probe.nonzero_words,
            "first_words": probe.first_words,
            "pipeline_cache_entries": renderer.native_pipeline_cache_count(),
        }))
    }

    fn clear_runtime_caches(&mut self, params: &Value) -> Value {
        let config = params.get("config").unwrap_or(params);
        let clear_precompiled_shaders = bool_at(config, &["clear_precompiled_shaders"])
            .or_else(|| bool_at(config, &["clearPrecompiledShaders"]))
            .unwrap_or(false);
        let clear_native_graph_buffers = bool_at(config, &["clear_native_graph_buffers"])
            .or_else(|| bool_at(config, &["clearNativeGraphBuffers"]))
            .or_else(|| bool_at(config, &["clear_graph_buffers"]))
            .or_else(|| bool_at(config, &["clearGraphBuffers"]))
            .unwrap_or(false);
        let graph_buffer_prefixes = string_array_at(config, &["native_graph_buffer_prefixes"])
            .or_else(|| string_array_at(config, &["nativeGraphBufferPrefixes"]))
            .or_else(|| string_array_at(config, &["graph_buffer_prefixes"]))
            .or_else(|| string_array_at(config, &["graphBufferPrefixes"]))
            .unwrap_or_default();

        let cleared_shader_records = if clear_precompiled_shaders {
            let count = self.shader_registry.len();
            self.shader_registry.clear();
            self.shader_sources.clear();
            count
        } else {
            0
        };

        let mut cleared_pipeline_entries = 0usize;
        let mut cleared_native_graph_buffers = 0usize;
        if let Some(renderer) = self.renderer.as_mut() {
            if clear_precompiled_shaders {
                cleared_pipeline_entries = renderer.clear_native_pipeline_caches();
            }
            if clear_native_graph_buffers || !graph_buffer_prefixes.is_empty() {
                cleared_native_graph_buffers = renderer.clear_native_compute_graph_buffers(
                    clear_native_graph_buffers,
                    &graph_buffer_prefixes,
                );
            }
            self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
        }
        self.stats.shader_cache_entries = self.shader_registry.len() as u64;
        self.stats.precompiled_vertex_shaders = self.precompiled_shader_count("vertex") as u64;
        self.stats.precompiled_pixel_shaders = self.precompiled_shader_count("pixel") as u64;
        let cleared_source_frame_signatures = self.source_frame_signatures.len();
        self.source_frame_signatures.clear();
        let cleared_native_video_frame_signatures = self.native_video_frame_signatures.len();
        self.native_video_frame_signatures.clear();
        let cleared_native_video_decode_failures = self.native_video_decode_failed.len();
        self.native_video_decode_failed.clear();
        let (cleared_native_video_frame_cache_entries, cleared_native_video_frame_cache_bytes) =
            self.clear_native_video_frame_cache();

        json!({
            "cleared_shader_records": cleared_shader_records,
            "cleared_pipeline_entries": cleared_pipeline_entries,
            "cleared_native_graph_buffers": cleared_native_graph_buffers,
            "cleared_source_frame_signatures": cleared_source_frame_signatures,
            "cleared_native_video_frame_signatures": cleared_native_video_frame_signatures,
            "cleared_native_video_decode_failures": cleared_native_video_decode_failures,
            "cleared_native_video_frame_cache_entries": cleared_native_video_frame_cache_entries,
            "cleared_native_video_frame_cache_bytes": cleared_native_video_frame_cache_bytes,
            "remaining_shader_records": self.shader_registry.len(),
            "remaining_pipeline_entries": self.renderer.as_ref().map(RenderState::native_pipeline_cache_count).unwrap_or(0),
            "remaining_native_graph_buffers": self.renderer.as_ref().map(RenderState::native_compute_graph_buffer_count).unwrap_or(0),
            "graph_buffer_prefixes": graph_buffer_prefixes,
        })
    }

    fn compute_graph(&mut self, params: &Value) -> Result<Value, String> {
        let Some(buffers_value) = params.get("buffers").and_then(Value::as_array) else {
            return Err("compute_graph requires buffers[]".to_string());
        };
        let Some(passes_value) = params.get("passes").and_then(Value::as_array) else {
            return Err("compute_graph requires passes[]".to_string());
        };
        let mut buffer_specs = Vec::with_capacity(buffers_value.len());
        for buffer in buffers_value {
            buffer_specs.push(parse_compute_graph_buffer(buffer)?);
        }
        let buffer_kinds = buffer_specs
            .iter()
            .map(|buffer| (buffer.id.clone(), buffer.kind))
            .collect::<HashMap<_, _>>();
        let mut pass_plans = Vec::with_capacity(passes_value.len());
        for (index, pass) in passes_value.iter().enumerate() {
            pass_plans.push(self.compute_graph_pass_plan(pass, index, &buffer_kinds)?);
        }
        let render_plans = self.compute_graph_render_plans(params, &buffer_kinds)?;
        let render_targets = render_plans
            .iter()
            .map(|render| render.target.clone())
            .collect::<Vec<_>>();
        let readbacks = compute_graph_readbacks(params, &buffer_specs);
        let readback_bytes = readbacks
            .iter()
            .filter_map(|id| {
                buffer_specs
                    .iter()
                    .find(|buffer| buffer.id == *id)
                    .map(|buffer| buffer.byte_length)
            })
            .fold(0u64, u64::saturating_add);
        let readback_count = readbacks.len() as u64;
        let pass_count = pass_plans.len() as u64;
        let render_pass_count = render_plans.len() as u64;
        let render_targets_for_stats = render_targets.clone();
        let render_targets_for_source_frames = render_targets;
        let result = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let result = renderer.run_native_compute_graph(
                buffer_specs,
                pass_plans,
                readbacks,
                render_plans,
            )?;
            self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
            result
        };
        self.stats.compute_graph_runs = self.stats.compute_graph_runs.saturating_add(1);
        self.stats.compute_graph_passes =
            self.stats.compute_graph_passes.saturating_add(pass_count);
        self.stats.compute_graph_readbacks = self
            .stats
            .compute_graph_readbacks
            .saturating_add(readback_count);
        self.stats.compute_graph_readback_bytes = self
            .stats
            .compute_graph_readback_bytes
            .saturating_add(readback_bytes);
        if render_pass_count > 0 {
            self.stats.compute_graph_render_passes = self
                .stats
                .compute_graph_render_passes
                .saturating_add(render_pass_count);
            for render_target in render_targets_for_stats {
                match render_target {
                    NativeComputeGraphRenderTarget::SourceFrame { .. } => {
                        self.stats.compute_graph_source_frame_renders = self
                            .stats
                            .compute_graph_source_frame_renders
                            .saturating_add(1);
                    }
                    NativeComputeGraphRenderTarget::Snapshot => {
                        self.stats.compute_graph_snapshot_renders =
                            self.stats.compute_graph_snapshot_renders.saturating_add(1);
                    }
                }
            }
        }
        for render_target in render_targets_for_source_frames {
            if let NativeComputeGraphRenderTarget::SourceFrame {
                source_id,
                slot,
                seq,
            } = render_target
            {
                self.source_frames
                    .insert(source_id.clone(), SourceFrame { seq });
                for layer in self.scene_layers.values_mut() {
                    if layer.source_id.as_deref() == Some(source_id.as_str()) {
                        layer.frame_slot = Some(slot);
                    }
                }
            }
        }
        Ok(result)
    }

    fn compute_graph_render_plans(
        &mut self,
        params: &Value,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<Vec<NativeComputeGraphRenderPlan>, String> {
        if let Some(renders_value) = params
            .get("render_passes")
            .or_else(|| params.get("renders"))
            .or_else(|| params.get("renderPlans"))
        {
            let Some(renders) = renders_value.as_array() else {
                return Err("compute_graph render_passes must be an array".to_string());
            };
            let mut plans = Vec::with_capacity(renders.len());
            for render in renders {
                plans.push(self.compute_graph_render_plan(render, buffer_kinds)?);
            }
            return Ok(plans);
        }

        params
            .get("render")
            .or_else(|| params.get("render_pass"))
            .map(|render| {
                self.compute_graph_render_plan(render, buffer_kinds)
                    .map(|plan| vec![plan])
            })
            .transpose()
            .map(|plans| plans.unwrap_or_default())
    }

    fn compute_graph_binding_spec(
        &self,
        binding: &Value,
        shader_id: &str,
        context: &str,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphBindingSpec, String> {
        let binding_number = number_at(binding, &["binding"])
            .ok_or_else(|| format!("compute_graph {context} `{shader_id}` binding missing number"))?
            .round()
            .clamp(0.0, u32::MAX as f64) as u32;
        let explicit_graph_kind = compute_graph_binding_kind_from_value(binding);
        match explicit_graph_kind {
            Some(NativeComputeGraphBindingKind::SourceFrameSampler) => {
                let resource_id = string_at(binding, &["resource"])
                    .or_else(|| string_at(binding, &["resource_id"]))
                    .unwrap_or_else(|| "source-frame-sampler".to_string());
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                    source_slot: None,
                })
            }
            Some(NativeComputeGraphBindingKind::SourceFrameTexture(dimension)) => {
                let is_array = matches!(dimension, NativeComputeGraphTextureDimension::D2Array);
                let allow_missing = bool_at(binding, &["allow_missing"])
                    .or_else(|| bool_at(binding, &["allowMissing"]))
                    .or_else(|| bool_at(binding, &["fallback"]))
                    .or_else(|| bool_at(binding, &["optional"]))
                    .unwrap_or(false);
                let resource_id = if is_array {
                    string_at(binding, &["resource"])
                        .or_else(|| string_at(binding, &["resource_id"]))
                        .or_else(|| string_at(binding, &["source_id"]))
                        .unwrap_or_else(|| "source-frames".to_string())
                } else {
                    let source_id = string_at(binding, &["source_id"])
                        .or_else(|| string_at(binding, &["sourceId"]))
                        .or_else(|| string_at(binding, &["source_frame_id"]))
                        .or_else(|| string_at(binding, &["sourceFrameId"]))
                        .or_else(|| string_at(binding, &["resource"]))
                        .or_else(|| string_at(binding, &["resource_id"]));
                    let Some(source_id) = source_id else {
                        if allow_missing {
                            return Ok(NativeComputeGraphBindingSpec {
                                binding: binding_number,
                                resource_id: "__source_frame_fallback__".to_string(),
                                kind: NativeComputeGraphBindingKind::SourceFrameTexture(dimension),
                                source_slot: Some(0),
                            });
                        }
                        return Err(format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} source-frame texture requires source_id"
                        ));
                    };
                    source_id
                };
                let source_slot = if is_array {
                    None
                } else {
                    Some(
                        self.source_frame_slots
                            .get(&resource_id)
                            .copied()
                            .or_else(|| allow_missing.then_some(0))
                            .ok_or_else(|| {
                                format!(
                                    "compute_graph {context} `{shader_id}` binding {binding_number} source-frame `{resource_id}` has no uploaded/generated frame"
                                )
                            })?,
                    )
                };
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::SourceFrameTexture(dimension),
                    source_slot,
                })
            }
            Some(NativeComputeGraphBindingKind::Buffer(kind)) => {
                let resource_id =
                    compute_graph_binding_resource_id(binding).ok_or_else(|| {
                        format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} missing resource"
                        )
                    })?;
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(kind),
                    source_slot: None,
                })
            }
            None => {
                let resource_id =
                    compute_graph_binding_resource_id(binding).ok_or_else(|| {
                        format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} missing resource"
                        )
                    })?;
                let default_kind = buffer_kinds
                    .get(&resource_id)
                    .copied()
                    .unwrap_or(NativeComputeBufferBindingKind::StorageReadWrite);
                let kind = compute_binding_kind_from_value(binding).unwrap_or(default_kind);
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(kind),
                    source_slot: None,
                })
            }
        }
    }

    fn compute_graph_pass_plan(
        &self,
        pass: &Value,
        index: usize,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphPassPlan, String> {
        let Some(shader_id) = string_at(pass, &["shader_id"]) else {
            return Err(format!("compute_graph pass {index} missing shader_id"));
        };
        let record = self.shader_registry.get(&shader_id).ok_or_else(|| {
            format!("compute graph shader `{shader_id}` has not been precompiled")
        })?;
        let source = self
            .shader_sources
            .get(&shader_id)
            .ok_or_else(|| format!("compute graph shader source missing for `{shader_id}`"))?;
        let explicit_entry = string_at(pass, &["entry"]);
        let entry = if let Some(entry) = explicit_entry {
            if record
                .entry_points
                .iter()
                .any(|candidate| candidate == &entry)
            {
                entry
            } else {
                return Err(format!(
                    "shader `{shader_id}` has no compute entry `{entry}`"
                ));
            }
        } else {
            native_compute_entry(record, source)
                .ok_or_else(|| format!("shader `{shader_id}` is not a supported compute shader"))?
        };
        let Some(bindings_value) = pass.get("bindings").and_then(Value::as_array) else {
            return Err(format!(
                "compute_graph pass `{shader_id}` requires bindings[]"
            ));
        };
        let mut bindings = Vec::with_capacity(bindings_value.len());
        for binding in bindings_value {
            bindings.push(self.compute_graph_binding_spec(
                binding,
                shader_id.as_str(),
                "pass",
                buffer_kinds,
            )?);
        }
        bindings.sort_by_key(|binding| binding.binding);
        let dispatch = dispatch_from_value(pass);
        let layout_sig = bindings
            .iter()
            .map(|binding| format!("{}:{}", binding.binding, binding.kind.signature()))
            .collect::<Vec<_>>()
            .join(",");
        let name =
            string_at(pass, &["name"]).unwrap_or_else(|| format!("{shader_id}:{entry}:{index}"));
        Ok(NativeComputeGraphPassPlan {
            name,
            cache_key: format!(
                "graph:{shader_id}:{}:{entry}:{layout_sig}",
                record.source_hash
            ),
            source: source.clone(),
            entry,
            dispatch,
            bindings,
        })
    }

    fn compute_graph_render_plan(
        &mut self,
        render: &Value,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphRenderPlan, String> {
        let Some(shader_id) = string_at(render, &["shader_id"]) else {
            return Err("compute_graph render pass missing shader_id".to_string());
        };
        let record = self.shader_registry.get(&shader_id).ok_or_else(|| {
            format!("compute graph render shader `{shader_id}` has not been precompiled")
        })?;
        let source_hash = record.source_hash;
        let default_fragment_entry = record.entry.clone();
        let entry_points = record.entry_points.clone();
        let source = self
            .shader_sources
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| {
                format!("compute graph render shader source missing for `{shader_id}`")
            })?;
        let vertex_entry =
            string_at(render, &["vertex_entry"]).unwrap_or_else(|| "vs_main".to_string());
        let fragment_entry = string_at(render, &["fragment_entry"])
            .or_else(|| string_at(render, &["entry"]))
            .unwrap_or(default_fragment_entry);
        if !entry_points.iter().any(|entry| entry == &vertex_entry) {
            return Err(format!(
                "shader `{shader_id}` has no graph render vertex entry `{vertex_entry}`"
            ));
        }
        if !entry_points.iter().any(|entry| entry == &fragment_entry) {
            return Err(format!(
                "shader `{shader_id}` has no graph render fragment entry `{fragment_entry}`"
            ));
        }
        let Some(bindings_value) = render.get("bindings").and_then(Value::as_array) else {
            return Err(format!(
                "compute_graph render pass `{shader_id}` requires bindings[]"
            ));
        };
        let mut bindings = Vec::with_capacity(bindings_value.len());
        for binding in bindings_value {
            bindings.push(self.compute_graph_binding_spec(
                binding,
                shader_id.as_str(),
                "render",
                buffer_kinds,
            )?);
        }
        bindings.sort_by_key(|binding| binding.binding);
        let layout_sig = bindings
            .iter()
            .map(|binding| format!("{}:{}", binding.binding, binding.kind.signature()))
            .collect::<Vec<_>>()
            .join(",");
        let name = string_at(render, &["name"]).unwrap_or_else(|| format!("{shader_id}:render"));
        let clear = bool_at(render, &["clear"]).unwrap_or(true);
        let include_snapshot = bool_at(render, &["include_snapshot"])
            .or_else(|| bool_at(render, &["snapshot"]))
            .unwrap_or(true);
        let blend = string_at(render, &["blend"])
            .or_else(|| string_at(render, &["blend_mode"]))
            .or_else(|| string_at(render, &["blendMode"]))
            .map(|label| NativeComputeGraphRenderBlend::from_label(&label))
            .unwrap_or(NativeComputeGraphRenderBlend::Replace);
        let vertex_count = number_at(render, &["vertex_count"])
            .or_else(|| number_at(render, &["vertices"]))
            .or_else(|| number_at(render, &["draw_vertices"]))
            .unwrap_or(3.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32;
        let instance_count = number_at(render, &["instance_count"])
            .or_else(|| number_at(render, &["instances"]))
            .or_else(|| number_at(render, &["draw_instances"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32;
        let indirect_buffer_id = string_at(render, &["draw_indirect_buffer"])
            .or_else(|| string_at(render, &["indirect_buffer"]))
            .or_else(|| string_at(render, &["indirect_buffer_id"]))
            .or_else(|| string_at(render, &["drawIndirectBuffer"]))
            .or_else(|| string_at(render, &["indirectBuffer"]));
        if let Some(indirect_buffer_id) = indirect_buffer_id.as_ref() {
            if !buffer_kinds.contains_key(indirect_buffer_id) {
                return Err(format!(
                    "compute_graph render `{shader_id}` indirect draw references missing buffer `{indirect_buffer_id}`"
                ));
            }
        }
        let indirect_offset = number_at(render, &["draw_indirect_offset"])
            .or_else(|| number_at(render, &["indirect_offset"]))
            .or_else(|| number_at(render, &["indirectOffset"]))
            .unwrap_or(0.0)
            .round()
            .max(0.0) as u64;
        let clear_color = vec4_path_at(render, &["clear_color"])
            .or_else(|| vec4_path_at(render, &["clearColor"]))
            .or_else(|| vec4_path_at(render, &["clear_value"]))
            .or_else(|| vec4_path_at(render, &["clearValue"]))
            .map(|rgba| {
                [
                    rgba[0].clamp(-64.0, 64.0) as f64,
                    rgba[1].clamp(-64.0, 64.0) as f64,
                    rgba[2].clamp(-64.0, 64.0) as f64,
                    rgba[3].clamp(0.0, 1.0) as f64,
                ]
            })
            .unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let depth_enabled = bool_at(render, &["depth"])
            .or_else(|| bool_at(render, &["depth_test"]))
            .or_else(|| bool_at(render, &["depthTest"]))
            .or_else(|| bool_at(render, &["depth_write"]))
            .or_else(|| bool_at(render, &["depthWrite"]))
            .unwrap_or(false);
        let depth_write = bool_at(render, &["depth_write"])
            .or_else(|| bool_at(render, &["depthWrite"]))
            .unwrap_or(depth_enabled);
        let depth_compare = string_at(render, &["depth_compare"])
            .or_else(|| string_at(render, &["depthCompare"]))
            .map(|label| NativeComputeGraphDepthCompare::from_label(&label))
            .unwrap_or(NativeComputeGraphDepthCompare::Less);
        let primitive_topology = string_at(render, &["primitive"])
            .or_else(|| string_at(render, &["topology"]))
            .or_else(|| string_at(render, &["primitive_topology"]))
            .or_else(|| string_at(render, &["primitiveTopology"]))
            .map(|label| NativeComputeGraphPrimitiveTopology::from_label(&label))
            .unwrap_or(NativeComputeGraphPrimitiveTopology::TriangleList);
        let target_label = string_at(render, &["target"])
            .or_else(|| string_at(render, &["target_type"]))
            .or_else(|| string_at(render, &["render_target"]))
            .unwrap_or_else(|| "snapshot".to_string());
        let target_key = target_label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-");
        let target = match target_key.as_str() {
            "snapshot" | "frame-snapshot" | "snapshot-texture" => {
                NativeComputeGraphRenderTarget::Snapshot
            }
            "source" | "source-frame" | "source-texture" | "layer-source" => {
                let Some(source_id) = string_at(render, &["source_id"])
                    .or_else(|| string_at(render, &["sourceId"]))
                    .or_else(|| string_at(render, &["target_source_id"]))
                    .or_else(|| string_at(render, &["targetSourceId"]))
                else {
                    return Err(
                        "compute_graph render target `source_frame` requires source_id".to_string(),
                    );
                };
                let slot = self.assign_source_frame_slot(&source_id);
                let seq = number_at(render, &["seq"])
                    .or_else(|| number_at(render, &["frame_index"]))
                    .unwrap_or_else(|| self.stats.commands_applied.saturating_add(1) as f64)
                    .round()
                    .max(0.0) as u64;
                NativeComputeGraphRenderTarget::SourceFrame {
                    source_id,
                    slot,
                    seq,
                }
            }
            _ => {
                return Err(format!(
                    "compute_graph render target `{target_label}` is unsupported"
                ));
            }
        };
        Ok(NativeComputeGraphRenderPlan {
            name,
            cache_key: format!(
                "graph-render:{shader_id}:{}:{vertex_entry}:{fragment_entry}:{}:{}:{}:{}:{}:{layout_sig}",
                source_hash,
                blend.signature(),
                primitive_topology.signature(),
                if depth_enabled { "depth" } else { "nodepth" },
                if depth_write { "write" } else { "read" },
                depth_compare.signature()
            ),
            source,
            vertex_entry,
            fragment_entry,
            clear,
            include_snapshot,
            target,
            blend,
            vertex_count,
            instance_count,
            indirect_buffer_id,
            indirect_offset,
            clear_color,
            primitive_topology,
            depth_enabled,
            depth_write,
            depth_compare,
            bindings,
        })
    }

    fn frame_duration(&self) -> Duration {
        Duration::from_secs_f64(1.0 / self.target_fps.max(1) as f64)
    }

    fn apply_native_quality_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        if let Some(policy) = string_at(config, &["native_quality_policy"])
            .or_else(|| string_at(config, &["quality_policy"]))
            .or_else(|| string_at(config, &["policy"]))
        {
            self.native_quality.set_policy(&policy);
        }
    }

    fn apply_shader_precompile_policy(&mut self, params: &Value) {
        self.shader_precompile_queue_cap =
            number_at(params, &["config", "shader_precompile_queue_cap"])
                .or_else(|| number_at(params, &["config", "queue_cap"]))
                .or_else(|| number_at(params, &["shader_precompile_queue_cap"]))
                .or_else(|| number_at(params, &["queue_cap"]))
                .unwrap_or(self.shader_precompile_queue_cap as f64)
                .round()
                .clamp(1.0, 65536.0) as u32;
        self.shader_precompile_per_frame =
            number_at(params, &["config", "shader_precompile_per_frame"])
                .or_else(|| number_at(params, &["config", "per_frame"]))
                .or_else(|| number_at(params, &["shader_precompile_per_frame"]))
                .or_else(|| number_at(params, &["per_frame"]))
                .unwrap_or(self.shader_precompile_per_frame as f64)
                .round()
                .clamp(1.0, 256.0) as u32;
    }

    fn apply_texture_pool_cap(&mut self, params: &Value) {
        self.texture_pool_cap_mb = number_at(params, &["config", "texture_pool_cap_mb"])
            .or_else(|| number_at(params, &["texture_pool_cap_mb"]))
            .unwrap_or(self.texture_pool_cap_mb as f64)
            .round()
            .clamp(16.0, 16384.0) as u32;
    }

    fn apply_vram_budget(&mut self, params: &Value) {
        self.vram_budget_mb = number_at(params, &["config", "vram_budget_mb"])
            .or_else(|| number_at(params, &["vram_budget_mb"]))
            .unwrap_or(self.vram_budget_mb as f64)
            .round()
            .clamp(64.0, 131_072.0) as u32;
    }

    fn apply_decode_cpu_backup_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_store_cpu_backup_frames = bool_at(config, &["decode_store_cpu_backup_frames"])
            .unwrap_or(self.decode_store_cpu_backup_frames);
    }

    fn apply_decode_synthetic_fallback_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_allow_synthetic_fallback =
            bool_at(config, &["decode_allow_synthetic_fallback"])
                .unwrap_or(self.decode_allow_synthetic_fallback);
    }

    fn apply_media_prefetch_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.media_queue_capacity = number_at(config, &["media_queue_capacity"])
            .unwrap_or(self.media_queue_capacity as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.decode_handoff_queue_capacity = number_at(config, &["decode_handoff_queue_capacity"])
            .unwrap_or(self.decode_handoff_queue_capacity as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.media_high_burst_limit = number_at(config, &["media_high_burst_limit"])
            .unwrap_or(self.media_high_burst_limit as f64)
            .round()
            .clamp(1.0, 255.0) as u32;
        self.prefetch_cache_max_entries = number_at(config, &["prefetch_cache_max_entries"])
            .unwrap_or(self.prefetch_cache_max_entries as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.prefetch_cache_prune_count = number_at(config, &["prefetch_cache_prune_count"])
            .unwrap_or(self.prefetch_cache_prune_count as f64)
            .round()
            .clamp(1.0, self.prefetch_cache_max_entries.max(1) as f64)
            as u32;
    }

    fn apply_media_drop_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.media_drop_command_pressure_pct = number_at(config, &["command_pressure_pct"])
            .or_else(|| number_at(config, &["media_drop_command_pressure_pct"]))
            .unwrap_or(self.media_drop_command_pressure_pct as f64)
            .round()
            .clamp(1.0, 100.0) as u32;
        self.media_drop_decode_pressure_pct = number_at(config, &["decode_queue_pressure_pct"])
            .or_else(|| number_at(config, &["media_drop_decode_pressure_pct"]))
            .unwrap_or(self.media_drop_decode_pressure_pct as f64)
            .round()
            .clamp(1.0, 100.0) as u32;
        self.media_drop_io_pressure_pct = number_at(config, &["io_queue_pressure_pct"])
            .or_else(|| number_at(config, &["media_drop_io_pressure_pct"]))
            .unwrap_or(self.media_drop_io_pressure_pct as f64)
            .round()
            .clamp(1.0, 100.0) as u32;
        self.media_drop_decode_priority_cutoff = number_at(config, &["decode_priority_cutoff"])
            .or_else(|| number_at(config, &["media_drop_decode_priority_cutoff"]))
            .unwrap_or(self.media_drop_decode_priority_cutoff as f64)
            .round()
            .clamp(0.0, 255.0) as u32;
        self.media_drop_io_priority_cutoff = number_at(config, &["io_priority_cutoff"])
            .or_else(|| number_at(config, &["media_drop_io_priority_cutoff"]))
            .unwrap_or(self.media_drop_io_priority_cutoff as f64)
            .round()
            .clamp(0.0, 255.0) as u32;
    }

    fn apply_decode_preview_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_preview_size = number_at(config, &["decode_preview_size"])
            .unwrap_or(self.decode_preview_size as f64)
            .round()
            .clamp(16.0, 4096.0) as u32;
        self.decode_preview_cache_mb = number_at(config, &["decode_preview_cache_mb"])
            .unwrap_or(self.decode_preview_cache_mb as f64)
            .round()
            .clamp(1.0, 65_536.0) as u32;
    }

    fn apply_decode_target_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_use_output_resolution = bool_at(config, &["decode_use_output_resolution"])
            .unwrap_or(self.decode_use_output_resolution);
    }

    fn apply_decode_upload_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_upload_queue_cap_mb = number_at(config, &["decode_upload_queue_cap_mb"])
            .unwrap_or(self.decode_upload_queue_cap_mb as f64)
            .round()
            .clamp(1.0, 65_536.0) as u32;
    }

    fn apply_decode_handoff_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_handoff_byte_cap_mb = number_at(config, &["decode_handoff_byte_cap_mb"])
            .unwrap_or(self.decode_handoff_byte_cap_mb as f64)
            .round()
            .clamp(1.0, 65_536.0) as u32;
        self.decode_handoff_predecode_shed_pct =
            number_at(config, &["decode_handoff_predecode_shed_pct"])
                .unwrap_or(self.decode_handoff_predecode_shed_pct as f64)
                .round()
                .clamp(1.0, 100.0) as u32;
    }

    fn apply_decode_estimate_cache_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_predecode_estimate_cache_cap_entries =
            number_at(config, &["decode_predecode_estimate_cache_cap_entries"])
                .unwrap_or(self.decode_predecode_estimate_cache_cap_entries as f64)
                .round()
                .clamp(1.0, 1_000_000.0) as u32;
    }

    fn apply_metadata_cache_caps(&mut self, params: &Value) {
        self.shader_metadata_cache_cap = number_at(params, &["config", "shader_metadata_cache_cap"])
            .or_else(|| number_at(params, &["config", "shader_cap"]))
            .or_else(|| number_at(params, &["shader_metadata_cache_cap"]))
            .or_else(|| number_at(params, &["shader_cap"]))
            .unwrap_or(self.shader_metadata_cache_cap as f64)
            .round()
            .clamp(1.0, 262_144.0) as u32;
        self.pipeline_metadata_cache_cap =
            number_at(params, &["config", "pipeline_metadata_cache_cap"])
                .or_else(|| number_at(params, &["config", "pipeline_cap"]))
                .or_else(|| number_at(params, &["pipeline_metadata_cache_cap"]))
                .or_else(|| number_at(params, &["pipeline_cap"]))
                .unwrap_or(self.pipeline_metadata_cache_cap as f64)
                .round()
                .clamp(1.0, 262_144.0) as u32;
    }

    fn apply_precompile_shader(&mut self, command: &Value) {
        self.stats.shader_precompile_queued = self.stats.shader_precompile_queued.saturating_add(1);
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            return;
        };
        let Some(source) = string_at(command, &["source"]) else {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            return;
        };
        let stage = string_at(command, &["stage"]).unwrap_or_else(|| "module".to_string());
        let entry = string_at(command, &["entry"]).unwrap_or_else(|| "main".to_string());

        if self.shader_registry.len() >= self.shader_precompile_queue_cap as usize
            && !self.shader_registry.contains_key(&shader_id)
        {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            self.last_shader_error =
                Some(format!("shader registry cap reached; dropped {shader_id}"));
            return;
        }

        if !looks_like_wgsl(&source) {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            return;
        }

        match naga::front::wgsl::parse_str(&source) {
            Ok(module) => {
                let entry_points = module
                    .entry_points
                    .iter()
                    .map(|entry| entry.name.clone())
                    .collect::<Vec<_>>();
                let record = ShaderRecord {
                    shader_id: shader_id.clone(),
                    stage,
                    entry,
                    source_hash: stable_hash64(&source),
                    source_bytes: source.len(),
                    entry_points,
                    compiled_at_ms: epoch_ms().min(u64::MAX as u128) as u64,
                };
                self.shader_registry.insert(shader_id.clone(), record);
                self.shader_sources.insert(shader_id, source);
                self.stats.shader_precompile_compiled =
                    self.stats.shader_precompile_compiled.saturating_add(1);
                self.stats.shader_cache_entries = self.shader_registry.len() as u64;
                self.stats.precompiled_vertex_shaders =
                    self.precompiled_shader_count("vertex") as u64;
                self.stats.precompiled_pixel_shaders =
                    self.precompiled_shader_count("pixel") as u64;
                self.last_shader_error = None;
            }
            Err(err) => {
                self.stats.shader_precompile_failed =
                    self.stats.shader_precompile_failed.saturating_add(1);
                self.last_shader_error = Some(format!("{shader_id}: {err}"));
            }
        }
    }

    fn precompiled_shader_count(&self, stage: &str) -> u32 {
        self.shader_registry
            .values()
            .filter(|record| record.stage.eq_ignore_ascii_case(stage))
            .count()
            .min(u32::MAX as usize) as u32
    }

    fn shader_registry_snapshot(&self) -> Vec<ShaderRecord> {
        let mut shaders = self.shader_registry.values().cloned().collect::<Vec<_>>();
        shaders.sort_by(|a, b| a.shader_id.cmp(&b.shader_id));
        shaders
    }

    fn apply_upsert_layer(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let z_index = number_at(command, &["z_index"])
            .unwrap_or(0.0)
            .round()
            .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, z_index));
        entry.z_index = z_index;
        if command_has_key(command, "vj_layer_index") || command_has_key(command, "vjLayerIndex") {
            entry.vj_layer_index = number_at_any(command, "vj_layer_index", "vjLayerIndex")
                .map(|value| value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32);
        }
        entry.opacity = number_at(command, &["opacity"])
            .unwrap_or(entry.opacity as f64)
            .clamp(0.0, 1.0) as f32;
        if let Some(blend_mode) = string_at(command, &["blend_mode"]) {
            entry.blend_code = blend_mode_code(&blend_mode);
        }
        if let Some(corners) = corners_at(command, &["corners"]) {
            entry.corners = corners;
        }
        if let Some(uv_transform) = vec4_path_at(command, &["uv_transform"]) {
            entry.uv0 = [
                uv_transform[0].clamp(-8.0, 8.0),
                uv_transform[1].clamp(-8.0, 8.0),
                uv_transform[2].clamp(-8.0, 8.0),
                uv_transform[3].clamp(-8.0, 8.0),
            ];
        }
        if let Some(uv_flags) = vec4_path_at(command, &["uv_flags"]) {
            entry.uv1 = [
                uv_flags[0].clamp(0.0, 2.0),
                uv_flags[1].clamp(0.001, 128.0),
                uv_flags[2].clamp(0.0, 1.0),
                uv_flags[3].clamp(0.0, 1.0),
            ];
        }
        if let Some(shape) = vec4_path_at(command, &["shape"]) {
            entry.shape = [
                shape[0].clamp(0.0, 2.0),
                shape[1].clamp(0.0, 1.0),
                shape[2].clamp(-std::f32::consts::TAU, std::f32::consts::TAU),
                shape[3].clamp(0.0001, 8.0),
            ];
        }
    }

    fn apply_layer_visibility(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let visible = bool_at(command, &["visible"]).unwrap_or(true);
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.visible = visible;
    }

    fn apply_layer_color(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(rgba) = rgba_at(command, &["rgba"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.color = rgba;
        entry.source_kind = 1.0;
    }

    fn apply_layer_native_params(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(params) = params8_at(command, &["params"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.native_params = params;
    }

    fn apply_bind_isf_shader(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            return;
        };
        self.isf_layer_bindings
            .insert(layer_id.clone(), shader_id.clone());
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.shader_id = Some(shader_id);
        entry.shader_rendered = false;
    }

    fn apply_isf_uniforms(&mut self, command: &Value) {
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            return;
        };
        let floats = command.get("float_inputs").unwrap_or(&Value::Null);
        let points = command.get("point_inputs").unwrap_or(&Value::Null);
        let colors = command.get("color_inputs").unwrap_or(&Value::Null);
        let input_count = json_object_len(floats)
            .saturating_add(json_object_len(points))
            .saturating_add(json_object_len(colors))
            .min(u32::MAX as usize) as u32;
        let audio = GhostAudioUniforms::from_isf_command(command);
        let state = IsfUniformState {
            shader_id: shader_id.clone(),
            time: number_at(command, &["time"])
                .unwrap_or(0.0)
                .clamp(0.0, 1.0e9) as f32,
            time_delta: number_at(command, &["time_delta"])
                .unwrap_or(1.0 / self.target_fps.max(1) as f64)
                .clamp(0.0, 10.0) as f32,
            frame_index: number_at(command, &["frame_index"])
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, u64::MAX as f64) as u64,
            render_width: number_at(command, &["render_width"])
                .unwrap_or(self.pending_width as f64)
                .clamp(1.0, 65536.0) as f32,
            render_height: number_at(command, &["render_height"])
                .unwrap_or(self.pending_height as f64)
                .clamp(1.0, 65536.0) as f32,
            date: vec4_at(command, "date"),
            audio0: audio.audio0,
            audio1: audio.audio1,
            audio2: audio.audio2,
            float_hash: stable_hash64(&floats.to_string()),
            point_hash: stable_hash64(&points.to_string()),
            color_hash: stable_hash64(&colors.to_string()),
            input_count,
            seq: self.stats.commands_applied,
        };
        self.isf_uniforms.insert(shader_id, state);
    }

    fn apply_render_isf_to_layer(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let shader_id = self.isf_layer_bindings.get(&layer_id).cloned().or_else(|| {
            self.scene_layers
                .get(&layer_id)
                .and_then(|layer| layer.shader_id.clone())
        });
        let Some(shader_id) = shader_id else {
            return;
        };
        let uniform_state = self.isf_uniforms.get(&shader_id).cloned();
        let params = uniform_state
            .as_ref()
            .map(|uniforms| uniforms.native_params(&shader_id))
            .unwrap_or_else(default_native_params);
        let input_source_slot = self
            .scene_layers
            .get(&layer_id)
            .and_then(|layer| {
                layer
                    .source_id
                    .as_deref()
                    .and_then(|source_id| self.source_frame_slots.get(source_id).copied())
                    .or(layer.frame_slot)
            })
            .unwrap_or(0);
        let shader_uniforms = NativeShaderUniforms::from_isf(
            &shader_id,
            uniform_state.as_ref(),
            self.pending_width,
            self.pending_height,
            params,
            input_source_slot,
        );
        let seq = uniform_state
            .as_ref()
            .map(|uniforms| uniforms.seq)
            .unwrap_or(self.stats.commands_applied);
        let native_shader = self.shader_registry.get(&shader_id).and_then(|record| {
            let source = self.shader_sources.get(&shader_id)?;
            native_fragment_entry(record, source).map(|entry| {
                let pipeline_key = native_shader_pipeline_key(record, &shader_id, &entry);
                (source.clone(), entry, record.source_hash, pipeline_key)
            })
        });
        let mut rendered_frame_slot = None;
        if let Some((source, fragment_entry, source_hash, pipeline_key)) = native_shader {
            let source_id = format!("native-shader:{layer_id}:{shader_id}:{source_hash:016x}");
            let slot = self.assign_source_frame_slot(&source_id);
            match self.renderer.as_mut() {
                Some(renderer) => {
                    match renderer.render_native_wgsl_shader_frame(
                        slot,
                        &pipeline_key,
                        &source,
                        &fragment_entry,
                        &shader_uniforms,
                    ) {
                        Ok(()) => {
                            self.source_frames.insert(source_id, SourceFrame { seq });
                            self.stats.pipeline_cache_entries =
                                renderer.native_shader_pipeline_count() as u64;
                            rendered_frame_slot = Some(slot);
                            self.last_shader_error = None;
                        }
                        Err(err) => {
                            self.last_shader_error = Some(format!("{shader_id}: {err}"));
                        }
                    }
                }
                None => {
                    self.last_shader_error = Some("native renderer is not ready".to_string());
                }
            }
        }
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.shader_id = Some(shader_id);
        entry.shader_rendered = true;
        entry.source_kind = NATIVE_SHADER_SOURCE_KIND;
        entry.frame_slot = rendered_frame_slot;
        entry.preview_slot = None;
        entry.native_params = params;
        if entry.color[3] <= 0.0 {
            entry.color = [0.45, 0.92, 1.0, 0.88];
        }
        self.stats.native_shader_renders = self.stats.native_shader_renders.saturating_add(1);
    }

    fn apply_effect_chain(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.effects = [[0.0; 4]; 4];
        entry.effect_count = 0.0;
        let Some(ids) = command.get("effect_ids").and_then(Value::as_array) else {
            return;
        };
        let mut write_index = 0usize;
        for value in ids.iter().filter_map(Value::as_str) {
            if write_index >= entry.effects.len() {
                break;
            }
            if let Some(effect) = effect_descriptor_code(value) {
                entry.effects[write_index] = effect;
                write_index += 1;
                entry.effect_count += 1.0;
            }
        }
    }

    fn apply_audio_state(&mut self, command: &Value) {
        let audio = GhostAudioUniforms::from_command(command);
        self.audio0 = audio.audio0;
        self.audio1 = audio.audio1;
        self.audio2 = audio.audio2;
    }

    fn apply_media_source(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let source_id = string_at(command, &["source_id"]);
        let source_id_for_decode = source_id.clone();
        let uri_for_decode = string_at(command, &["uri"]);
        let source_type =
            string_at(command, &["source_type"]).unwrap_or_else(|| "none".to_string());
        if let (Some(source_id), Some(uri)) = (source_id.as_deref(), uri_for_decode.as_deref()) {
            self.upsert_media_source_binding(source_id, uri, &source_type);
        }
        let preview_slot = source_id
            .as_ref()
            .and_then(|id| self.source_preview_slots.get(id))
            .copied();
        let frame_slot = source_id
            .as_ref()
            .and_then(|id| self.source_frame_slots.get(id))
            .copied();
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
        entry.source_kind = source_kind(&source_type);
        entry.source_id = source_id;
        entry.preview_slot = preview_slot;
        entry.frame_slot = frame_slot;
        entry.shader_rendered = false;
        if source_type != "none" && entry.color[3] <= 0.0 {
            entry.color = stable_layer_color(&layer_id, 1.0);
        }
        if source_type != "color" {
            entry.color = source_type_color(&source_type, &layer_id);
        }
        if source_type == "image" {
            if let (Some(source_id), Some(uri)) = (source_id_for_decode, uri_for_decode.as_deref())
            {
                self.decode_native_image_source(&source_id, uri);
            }
        }
    }

    fn upsert_media_source_binding(&mut self, source_id: &str, uri: &str, source_type: &str) {
        if source_id.trim().is_empty() || uri.trim().is_empty() || source_type == "none" {
            return;
        }
        let render_clock_time = self.render_clock_time.unwrap_or(0.0) as f64;
        self.media_sources
            .entry(source_id.to_string())
            .and_modify(|state| {
                state.uri = uri.to_string();
                state.source_type = source_type.to_string();
            })
            .or_insert_with(|| NativeMediaSourceState {
                uri: uri.to_string(),
                source_type: source_type.to_string(),
                playback_time_seconds: 0.0,
                playback_rate: 1.0,
                paused: true,
                loop_enabled: false,
                duration_seconds: None,
                clock_time_seconds: render_clock_time,
                seq: 0,
            });
    }

    fn apply_media_source_playback(&mut self, command: &Value) {
        let Some(source_id) = string_at(command, &["source_id"]) else {
            return;
        };
        let existing = self.media_sources.get(&source_id).cloned();
        let uri = string_at(command, &["uri"])
            .or_else(|| existing.as_ref().map(|state| state.uri.clone()))
            .unwrap_or_default();
        let source_type = string_at(command, &["source_type"])
            .or_else(|| existing.as_ref().map(|state| state.source_type.clone()))
            .unwrap_or_else(|| "video".to_string());
        if uri.trim().is_empty() || source_type == "none" {
            return;
        }
        let render_clock_time = self.render_clock_time.unwrap_or(0.0) as f64;
        let playback_time_seconds = number_at(command, &["time_seconds"])
            .or_else(|| number_at(command, &["time"]))
            .or_else(|| existing.as_ref().map(|state| state.playback_time_seconds))
            .unwrap_or(0.0)
            .clamp(0.0, 3600.0);
        let playback_rate = number_at(command, &["playback_rate"])
            .or_else(|| number_at(command, &["rate"]))
            .or_else(|| existing.as_ref().map(|state| state.playback_rate))
            .unwrap_or(1.0)
            .clamp(-16.0, 16.0);
        let duration_seconds = number_at(command, &["duration_seconds"])
            .or_else(|| number_at(command, &["duration"]))
            .filter(|duration| duration.is_finite() && *duration > 0.0)
            .or_else(|| existing.as_ref().and_then(|state| state.duration_seconds));
        let seq = number_at(command, &["seq"])
            .or_else(|| existing.as_ref().map(|state| state.seq as f64 + 1.0))
            .unwrap_or(1.0)
            .round()
            .max(0.0) as u64;
        self.media_sources.insert(
            source_id,
            NativeMediaSourceState {
                uri,
                source_type,
                playback_time_seconds,
                playback_rate,
                paused: bool_at(command, &["paused"]).unwrap_or_else(|| {
                    existing.as_ref().map(|state| state.paused).unwrap_or(false)
                }),
                loop_enabled: bool_at(command, &["loop_enabled"])
                    .or_else(|| bool_at(command, &["loop"]))
                    .unwrap_or_else(|| {
                        existing
                            .as_ref()
                            .map(|state| state.loop_enabled)
                            .unwrap_or(false)
                    }),
                duration_seconds,
                clock_time_seconds: number_at(command, &["clock_time_seconds"])
                    .or_else(|| number_at(command, &["clock_time"]))
                    .unwrap_or(render_clock_time)
                    .clamp(0.0, 1.0e9),
                seq,
            },
        );
    }

    fn apply_decode_media_source(&mut self, command: &Value) {
        let source_type =
            string_at(command, &["source_type"]).unwrap_or_else(|| "none".to_string());
        let (Some(source_id), Some(uri)) = (
            string_at(command, &["source_id"]),
            string_at(command, &["uri"]),
        ) else {
            return;
        };
        if source_type == "image" {
            self.decode_native_image_source(&source_id, &uri);
        } else if source_type == "video" {
            let width = number_at(command, &["decode_width"])
                .or_else(|| number_at(command, &["decodeWidth"]))
                .or_else(|| number_at(command, &["width"]))
                .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
                .round()
                .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                as usize;
            let height = number_at(command, &["decode_height"])
                .or_else(|| number_at(command, &["decodeHeight"]))
                .or_else(|| number_at(command, &["height"]))
                .unwrap_or(width as f64)
                .round()
                .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                as usize;
            let explicit_time_seconds = number_at(command, &["time_seconds"])
                .or_else(|| number_at(command, &["timeSeconds"]))
                .or_else(|| number_at(command, &["time"]));
            let time_seconds = explicit_time_seconds
                .or_else(|| {
                    self.media_sources
                        .get(&source_id)
                        .map(|state| state.current_time_seconds(self.render_clock_time))
                })
                .unwrap_or(0.0)
                .clamp(0.0, 3600.0);
            let seq = number_at(command, &["seq"])
                .unwrap_or((time_seconds * 1000.0).round())
                .round()
                .max(0.0) as u64;
            let prefetch_window_frames = number_at(command, &["prefetch_window_frames"])
                .or_else(|| number_at(command, &["prefetchWindowFrames"]))
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES as f64)
                as u32;
            let prefetch_fps = number_at(command, &["prefetch_fps"])
                .or_else(|| number_at(command, &["prefetchFps"]))
                .unwrap_or(NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS)
                .clamp(
                    NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS,
                    NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS,
                );
            self.decode_native_video_frame_source(
                &source_id,
                &uri,
                width,
                height,
                time_seconds,
                seq,
                prefetch_window_frames,
                prefetch_fps,
            );
        }
    }

    fn set_stage3d_scene(&mut self, params: &Value) -> Result<Value, String> {
        let scene = scene_payload(params, "stage3d")?;
        let summary = summarize_stage3d_scene(scene);
        self.stage3d_scene = Some(scene.clone());
        self.stage3d_scene_summary = summary.clone();
        Ok(json!(summary))
    }

    fn scene_overlay_items(&self) -> Vec<Stage3DOverlayItemGpu> {
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

    fn stage3d_mesh_frame(&self) -> Option<Stage3DMeshFrame> {
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

    fn stage3d_source_slot_for_text(&self, value: &str) -> Option<usize> {
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

    fn stage3d_source_slot_for_value(&self, value: Option<&Value>) -> Option<usize> {
        let value = value?;
        if let Some(text) = value.as_str() {
            return self.stage3d_source_slot_for_text(text);
        }
        value
            .as_i64()
            .and_then(|index| self.stage3d_source_slot_for_text(&index.to_string()))
    }

    fn scene_layer_source_slot(&self, layer_id: &str) -> Option<usize> {
        let layer = self.scene_layers.get(layer_id)?;
        layer.frame_slot.or_else(|| {
            layer
                .source_id
                .as_deref()
                .and_then(|source_id| self.source_frame_slots.get(source_id).copied())
        })
    }

    fn first_visible_source_frame_slot(&self) -> Option<usize> {
        self.scene_layers
            .values()
            .filter(|layer| layer.visible)
            .min_by_key(|layer| layer.z_index)
            .and_then(|layer| self.scene_layer_source_slot(&layer.id))
    }

    fn set_projection_sim_scene(&mut self, params: &Value) -> Result<Value, String> {
        let scene = scene_payload(params, "projection_sim")?;
        let summary = summarize_projection_sim_scene(scene);
        self.projection_sim_scene = Some(scene.clone());
        self.projection_sim_scene_summary = summary.clone();
        Ok(json!(summary))
    }

    fn prefetch_media(&mut self, params: &Value) -> Result<Value, String> {
        let source_type = string_at(params, &["source_type"]).unwrap_or_else(|| "none".to_string());
        let source_id = string_at(params, &["source_id"])
            .or_else(|| string_at(params, &["sourceId"]))
            .ok_or_else(|| "native media prefetch requires source_id".to_string())?;
        let uri = string_at(params, &["uri"])
            .or_else(|| string_at(params, &["src"]))
            .ok_or_else(|| "native media prefetch requires uri".to_string())?;
        if source_type == "image" {
            self.decode_native_image_source(&source_id, &uri);
        } else if source_type == "video" {
            let width = number_at(params, &["decode_width"])
                .or_else(|| number_at(params, &["decodeWidth"]))
                .or_else(|| number_at(params, &["width"]))
                .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
                .round()
                .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                as usize;
            let height = number_at(params, &["decode_height"])
                .or_else(|| number_at(params, &["decodeHeight"]))
                .or_else(|| number_at(params, &["height"]))
                .unwrap_or(width as f64)
                .round()
                .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                as usize;
            let explicit_time_seconds = number_at(params, &["time_seconds"])
                .or_else(|| number_at(params, &["timeSeconds"]))
                .or_else(|| number_at(params, &["time"]));
            let time_seconds = explicit_time_seconds
                .or_else(|| {
                    self.media_sources
                        .get(&source_id)
                        .map(|state| state.current_time_seconds(self.render_clock_time))
                })
                .unwrap_or(0.0)
                .clamp(0.0, 3600.0);
            let seq = number_at(params, &["seq"])
                .unwrap_or((time_seconds * 1000.0).round())
                .round()
                .max(0.0) as u64;
            let prefetch_window_frames = number_at(params, &["prefetch_window_frames"])
                .or_else(|| number_at(params, &["prefetchWindowFrames"]))
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES as f64)
                as u32;
            let prefetch_fps = number_at(params, &["prefetch_fps"])
                .or_else(|| number_at(params, &["prefetchFps"]))
                .unwrap_or(NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS)
                .clamp(
                    NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS,
                    NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS,
                );
            self.decode_native_video_frame_source(
                &source_id,
                &uri,
                width,
                height,
                time_seconds,
                seq,
                prefetch_window_frames,
                prefetch_fps,
            );
        } else {
            return Err(
                "native media prefetch currently supports local static images and timestamped local video frames".to_string(),
            );
        }
        Ok(json!(self.status()))
    }

    fn clear_prefetch_cache(&mut self) -> Value {
        let cleared_source_frame_signatures = self.source_frame_signatures.len();
        self.source_frame_signatures.clear();
        let cleared_native_video_frame_signatures = self.native_video_frame_signatures.len();
        self.native_video_frame_signatures.clear();
        let cleared_native_video_decode_failures = self.native_video_decode_failed.len();
        self.native_video_decode_failed.clear();
        let (cleared_native_video_frame_cache_entries, cleared_native_video_frame_cache_bytes) =
            self.clear_native_video_frame_cache();
        json!({
            "cleared_source_frame_signatures": cleared_source_frame_signatures,
            "cleared_native_video_frame_signatures": cleared_native_video_frame_signatures,
            "cleared_native_video_decode_failures": cleared_native_video_decode_failures,
            "cleared_native_video_frame_cache_entries": cleared_native_video_frame_cache_entries,
            "cleared_native_video_frame_cache_bytes": cleared_native_video_frame_cache_bytes,
            "note": "native image/video-frame prefetch signatures and decoded video-frame cache cleared; resident bound source frames are preserved"
        })
    }

    fn clear_decode_preview_cache(&mut self) -> Value {
        json!({
            "cleared_decode_preview_entries": 0,
            "cleared_decode_preview_bytes": 0,
            "note": "native video decode preview cache is not allocated yet; clear acknowledged for policy symmetry"
        })
    }

    fn decode_capabilities(&self) -> Value {
        json!({
            "schema_version": 1,
            "native_static_image_decode": true,
            "native_static_image_prefetch": true,
            "native_video_frame_decode": true,
            "native_video_frame_prefetch": true,
            "native_video_frame_prefetch_window": true,
            "video_frame_prefetch": true,
            "native_media_source_playback_state": true,
            "native_video_decode_pump": true,
            "native_video_decode_pump_window": true,
            "decode_policy_controls": true,
            "decode_preview_cache_clear": true,
            "media_policy_controls": true,
            "vram_budget_policy": true,
            "vram_budget_enforcement": false,
            "native_media_decode": true,
            "media_prefetch": true,
            "video_decode": true,
            "source_frame_fallback": true,
            "shared_texture_source_frame_upload": cfg!(target_os = "macos"),
            "shared_texture_upload": self.shared_texture_media_transport_ready(),
            "supported_source_types": ["image", "video"],
            "supported_static_image_extensions": [
                "avif",
                "bmp",
                "gif",
                "jpg",
                "jpeg",
                "png",
                "tga",
                "tif",
                "tiff",
                "webp"
            ],
            "supported_video_extensions": ["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"],
            "notes": [
                "Local still images can decode directly into native source-frame textures.",
                "Local videos can prefetch bounded timestamped frames and adjacent-frame windows into native source-frame textures via FFmpeg.",
                "Visible local video layers decode continuously from the native render/media clock through the decode pump; macOS shared media sources ingest IOSurfaceID handles, while DXGI import remains pending."
            ]
        })
    }

    fn apply_source_preview(&mut self, command: &Value) {
        let Some(source_id) = string_at(command, &["source_id"]) else {
            return;
        };
        let seq = number_at(command, &["seq"]).unwrap_or(0.0).round().max(0.0) as u64;
        if let Some(existing) = self.source_previews.get(&source_id) {
            if seq < existing.seq {
                return;
            }
        }
        let width = number_at(command, &["width"])
            .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
            .round()
            .clamp(1.0, 4096.0) as usize;
        let height = number_at(command, &["height"])
            .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
            .round()
            .clamp(1.0, 4096.0) as usize;
        let Some(rgba) = command.get("rgba").and_then(Value::as_array) else {
            return;
        };
        if rgba.len() < width.saturating_mul(height).saturating_mul(4) {
            return;
        }

        let slot = self.assign_source_preview_slot(&source_id);
        let mut pixels = vec![PreviewPixel::zeroed(); SOURCE_PREVIEW_PIXELS];
        let scale_x = width as f32 / SOURCE_PREVIEW_SIZE as f32;
        let scale_y = height as f32 / SOURCE_PREVIEW_SIZE as f32;
        for y in 0..SOURCE_PREVIEW_SIZE {
            let sy = ((y as f32 + 0.5) * scale_y - 0.5).clamp(0.0, (height - 1) as f32);
            for x in 0..SOURCE_PREVIEW_SIZE {
                let dst_index = y * SOURCE_PREVIEW_SIZE + x;
                let sx = ((x as f32 + 0.5) * scale_x - 0.5).clamp(0.0, (width - 1) as f32);
                pixels[dst_index] = resample_preview_pixel(rgba, width, height, sx, sy);
            }
        }

        self.source_previews
            .insert(source_id.clone(), SourcePreview { slot, seq, pixels });
        self.source_preview_dirty = true;
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.preview_slot = Some(slot);
            }
        }
    }

    fn decode_native_image_source(&mut self, source_id: &str, uri: &str) {
        let Some(path) = local_media_path_from_uri(uri) else {
            return;
        };
        let signature = match native_image_file_signature(&path) {
            Ok(signature) => signature,
            Err(err) => {
                self.stats.native_image_decode_failures =
                    self.stats.native_image_decode_failures.saturating_add(1);
                self.stats.native_image_decode_last_error = err;
                self.source_frame_signatures.remove(source_id);
                return;
            }
        };
        if self
            .source_frame_signatures
            .get(source_id)
            .is_some_and(|existing| existing == &signature)
            && self.source_frames.contains_key(source_id)
        {
            return;
        }
        let existing_seq = self
            .source_frames
            .get(source_id)
            .map(|frame| frame.seq)
            .unwrap_or(0);
        match decode_native_image_rgba(&path) {
            Ok((width, height, rgba)) => {
                let uploaded = self.upload_source_frame_pixels(
                    source_id.to_string(),
                    existing_seq.saturating_add(1),
                    width,
                    height,
                    &rgba,
                    "native-image",
                    false,
                );
                self.stats.native_image_decodes = self.stats.native_image_decodes.saturating_add(1);
                self.stats.native_image_decode_bytes_uploaded = self
                    .stats
                    .native_image_decode_bytes_uploaded
                    .saturating_add(uploaded as u64);
                self.stats.native_image_decode_last_error.clear();
                self.source_frame_signatures
                    .insert(source_id.to_string(), signature);
            }
            Err(err) => {
                self.stats.native_image_decode_failures =
                    self.stats.native_image_decode_failures.saturating_add(1);
                self.stats.native_image_decode_last_error = err;
                self.source_frame_signatures.remove(source_id);
            }
        }
    }

    fn cached_native_video_frame(&mut self, signature: &str) -> Option<(usize, usize, Vec<u8>)> {
        let entry = self.native_video_frame_cache.get(signature)?;
        let width = entry.width;
        let height = entry.height;
        let rgba = entry.rgba.clone();
        self.native_video_frame_cache_order
            .retain(|key| key != signature);
        self.native_video_frame_cache_order
            .push_back(signature.to_string());
        self.stats.native_video_frame_cache_hits =
            self.stats.native_video_frame_cache_hits.saturating_add(1);
        Some((width, height, rgba))
    }

    fn store_native_video_frame_cache(
        &mut self,
        signature: String,
        width: usize,
        height: usize,
        rgba: &[u8],
    ) {
        let byte_length = rgba.len();
        if byte_length == 0 || byte_length > NATIVE_VIDEO_FRAME_CACHE_MAX_BYTES {
            return;
        }
        if let Some(existing) = self.native_video_frame_cache.remove(&signature) {
            self.native_video_frame_cache_bytes = self
                .native_video_frame_cache_bytes
                .saturating_sub(existing.byte_length);
            self.native_video_frame_cache_order
                .retain(|key| key != &signature);
        }
        self.native_video_frame_cache.insert(
            signature.clone(),
            NativeVideoFrameCacheEntry {
                width,
                height,
                rgba: rgba.to_vec(),
                byte_length,
            },
        );
        self.native_video_frame_cache_order.push_back(signature);
        self.native_video_frame_cache_bytes = self
            .native_video_frame_cache_bytes
            .saturating_add(byte_length);
        while self.native_video_frame_cache_order.len() > NATIVE_VIDEO_FRAME_CACHE_MAX_ENTRIES
            || self.native_video_frame_cache_bytes > NATIVE_VIDEO_FRAME_CACHE_MAX_BYTES
        {
            let Some(oldest) = self.native_video_frame_cache_order.pop_front() else {
                break;
            };
            if let Some(entry) = self.native_video_frame_cache.remove(&oldest) {
                self.native_video_frame_cache_bytes = self
                    .native_video_frame_cache_bytes
                    .saturating_sub(entry.byte_length);
                self.stats.native_video_frame_cache_evictions = self
                    .stats
                    .native_video_frame_cache_evictions
                    .saturating_add(1);
            }
        }
    }

    fn clear_native_video_frame_cache(&mut self) -> (usize, usize) {
        let entries = self.native_video_frame_cache.len();
        let bytes = self.native_video_frame_cache_bytes;
        self.native_video_frame_cache.clear();
        self.native_video_frame_cache_order.clear();
        self.native_video_frame_cache_bytes = 0;
        (entries, bytes)
    }

    fn native_video_decode_dimensions(&self) -> (usize, usize) {
        let renderer_limit = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.source_frame_size)
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT);
        let target = if self.decode_use_output_resolution {
            self.pending_width.max(self.pending_height) as usize
        } else {
            self.decode_preview_size as usize
        };
        let size = target
            .max(64)
            .min(renderer_limit)
            .min(MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
        (size, size)
    }

    fn pump_native_video_decodes(&mut self) {
        if self.renderer.is_none()
            || self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT
        {
            return;
        }
        let (width, height) = self.native_video_decode_dimensions();
        let mut active_sources = Vec::new();
        for layer in self.scene_layers.values() {
            if !layer.visible {
                continue;
            }
            let Some(source_id) = layer.source_id.as_deref() else {
                continue;
            };
            if active_sources
                .iter()
                .any(|existing: &String| existing == source_id)
            {
                continue;
            }
            active_sources.push(source_id.to_string());
        }

        let mut queued = 0usize;
        for source_id in active_sources {
            if queued >= NATIVE_VIDEO_DECODE_PUMP_PER_TICK
                || self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT
            {
                break;
            }
            let Some(state) = self.media_sources.get(&source_id).cloned() else {
                continue;
            };
            if state.source_type != "video" {
                continue;
            }
            if state.seq == 0 {
                continue;
            }
            if self.queue_native_video_decode_for_state(&source_id, &state, width, height) {
                queued += 1;
            }
        }
    }

    fn queue_native_video_decode_for_state(
        &mut self,
        source_id: &str,
        state: &NativeMediaSourceState,
        width: usize,
        height: usize,
    ) -> bool {
        let Some(path) = local_media_path_from_uri(&state.uri) else {
            return false;
        };
        let time_seconds = state.current_time_seconds(self.render_clock_time);
        let frame_bucket = native_video_frame_bucket(time_seconds);
        let signature = match native_video_frame_file_signature(&path, width, height, frame_bucket)
        {
            Ok(signature) => signature,
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                return false;
            }
        };
        if self
            .native_video_frame_signatures
            .get(source_id)
            .is_some_and(|existing| existing == &signature)
            && self.source_frames.contains_key(source_id)
        {
            return false;
        }
        if self.native_video_decode_failed.contains(&signature) {
            return false;
        }
        let seq = self
            .render_clock_frame_index
            .unwrap_or(self.stats.frames_presented)
            .max(
                self.source_frames
                    .get(source_id)
                    .map(|frame| frame.seq.saturating_add(1))
                    .unwrap_or(1),
            );
        if let Some((decoded_width, decoded_height, rgba)) =
            self.cached_native_video_frame(&signature)
        {
            let uploaded = self.upload_source_frame_pixels(
                source_id.to_string(),
                seq,
                decoded_width,
                decoded_height,
                &rgba,
                "native-video-decode-pump-cache",
                false,
            );
            self.stats.native_video_frame_decode_bytes_uploaded = self
                .stats
                .native_video_frame_decode_bytes_uploaded
                .saturating_add(uploaded as u64);
            self.stats.native_video_frame_decode_last_error.clear();
            self.native_video_frame_signatures
                .insert(source_id.to_string(), signature);
            return false;
        }
        if self.native_video_decode_pending.contains(&signature) {
            return false;
        }
        if self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT {
            self.stats.decode_jobs_dropped = self.stats.decode_jobs_dropped.saturating_add(1);
            return false;
        }
        self.stats.native_video_frame_cache_misses =
            self.stats.native_video_frame_cache_misses.saturating_add(1);
        self.native_video_decode_pending.insert(signature.clone());
        self.stats.decode_jobs_submitted = self.stats.decode_jobs_submitted.saturating_add(1);
        self.stats.decode_queue_peak = self
            .stats
            .decode_queue_peak
            .max(self.native_video_decode_pending.len() as u64);
        spawn_native_video_frame_decode(
            self.event_proxy.clone(),
            NativeVideoFrameDecodeJob {
                source_id: source_id.to_string(),
                uri: state.uri.clone(),
                path,
                width,
                height,
                time_seconds,
                frame_bucket,
                signature,
                seq,
            },
        );
        true
    }

    fn apply_native_video_decode_result(&mut self, result: NativeVideoFrameDecodeResult) {
        self.native_video_decode_pending.remove(&result.signature);
        self.stats.decode_jobs_completed = self.stats.decode_jobs_completed.saturating_add(1);
        match result.result {
            Ok(frames) => {
                self.native_video_decode_failed.remove(&result.signature);
                self.stats.native_video_frame_decodes = self
                    .stats
                    .native_video_frame_decodes
                    .saturating_add(frames.len() as u64);
                self.stats.native_video_frame_decode_last_error.clear();
                let mut upload_frame = None;
                for frame in frames {
                    let should_upload = upload_frame.is_none()
                        && (frame.signature == result.signature
                            || frame.frame_bucket == result.frame_bucket);
                    self.store_native_video_frame_cache(
                        frame.signature.clone(),
                        frame.width,
                        frame.height,
                        &frame.rgba,
                    );
                    if should_upload {
                        upload_frame = Some(frame);
                    }
                }
                let source_still_bound = self
                    .media_sources
                    .get(&result.source_id)
                    .is_some_and(|state| state.uri == result.uri && state.source_type == "video");
                let source_needs_result =
                    self.media_sources
                        .get(&result.source_id)
                        .is_some_and(|state| {
                            native_video_frame_bucket(
                                state.current_time_seconds(self.render_clock_time),
                            ) == result.frame_bucket
                        });
                let source_has_no_frame = !self.source_frames.contains_key(&result.source_id);
                if source_still_bound && (source_needs_result || source_has_no_frame) {
                    let Some(frame) = upload_frame else {
                        return;
                    };
                    let uploaded = self.upload_source_frame_pixels(
                        result.source_id.clone(),
                        result.seq,
                        frame.width,
                        frame.height,
                        &frame.rgba,
                        "native-video-decode-pump",
                        false,
                    );
                    self.stats.native_video_frame_decode_bytes_uploaded = self
                        .stats
                        .native_video_frame_decode_bytes_uploaded
                        .saturating_add(uploaded as u64);
                    self.native_video_frame_signatures
                        .insert(result.source_id, frame.signature);
                    self.request_auto_present();
                }
            }
            Err(err) => {
                self.native_video_decode_failed.insert(result.signature);
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
            }
        }
    }

    fn prefetch_native_video_frame_window(
        &mut self,
        path: &Path,
        width: usize,
        height: usize,
        time_seconds: f64,
        prefetch_window_frames: u32,
        prefetch_fps: f64,
        primary_signature: &str,
    ) {
        let frame_count = prefetch_window_frames.min(NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES);
        if frame_count == 0 {
            return;
        }
        let frame_step = 1.0
            / prefetch_fps.clamp(
                NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS,
                NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS,
            );
        for frame_offset in 1..=frame_count {
            let prefetch_time =
                (time_seconds + frame_step * frame_offset as f64).clamp(0.0, 3600.0);
            let frame_bucket = native_video_frame_bucket(prefetch_time);
            let signature =
                match native_video_frame_file_signature(path, width, height, frame_bucket) {
                    Ok(signature) => signature,
                    Err(_) => continue,
                };
            if signature == primary_signature
                || self.native_video_frame_cache.contains_key(&signature)
            {
                continue;
            }
            self.stats.native_video_frame_cache_misses =
                self.stats.native_video_frame_cache_misses.saturating_add(1);
            let Ok((decoded_width, decoded_height, rgba)) =
                decode_native_video_frame_rgba(path, width, height, prefetch_time)
            else {
                break;
            };
            self.stats.native_video_frame_decodes =
                self.stats.native_video_frame_decodes.saturating_add(1);
            self.store_native_video_frame_cache(signature, decoded_width, decoded_height, &rgba);
        }
    }

    fn decode_native_video_frame_source(
        &mut self,
        source_id: &str,
        uri: &str,
        width: usize,
        height: usize,
        time_seconds: f64,
        seq: u64,
        prefetch_window_frames: u32,
        prefetch_fps: f64,
    ) {
        let Some(path) = local_media_path_from_uri(uri) else {
            return;
        };
        let frame_bucket = native_video_frame_bucket(time_seconds);
        let signature = match native_video_frame_file_signature(&path, width, height, frame_bucket)
        {
            Ok(signature) => signature,
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                self.native_video_frame_signatures.remove(source_id);
                return;
            }
        };
        if self
            .native_video_frame_signatures
            .get(source_id)
            .is_some_and(|existing| existing == &signature)
            && self.source_frames.contains_key(source_id)
        {
            self.prefetch_native_video_frame_window(
                &path,
                width,
                height,
                time_seconds,
                prefetch_window_frames,
                prefetch_fps,
                &signature,
            );
            return;
        }
        let existing_seq = self
            .source_frames
            .get(source_id)
            .map(|frame| frame.seq)
            .unwrap_or(0);
        let upload_seq = seq.max(existing_seq.saturating_add(1));
        if let Some((decoded_width, decoded_height, rgba)) =
            self.cached_native_video_frame(&signature)
        {
            let uploaded = self.upload_source_frame_pixels(
                source_id.to_string(),
                upload_seq,
                decoded_width,
                decoded_height,
                &rgba,
                "native-video-frame-cache",
                false,
            );
            self.stats.native_video_frame_decode_bytes_uploaded = self
                .stats
                .native_video_frame_decode_bytes_uploaded
                .saturating_add(uploaded as u64);
            self.stats.native_video_frame_decode_last_error.clear();
            self.native_video_frame_signatures
                .insert(source_id.to_string(), signature.clone());
            self.prefetch_native_video_frame_window(
                &path,
                width,
                height,
                time_seconds,
                prefetch_window_frames,
                prefetch_fps,
                &signature,
            );
            return;
        }
        self.stats.native_video_frame_cache_misses =
            self.stats.native_video_frame_cache_misses.saturating_add(1);
        match decode_native_video_frame_rgba(&path, width, height, time_seconds) {
            Ok((decoded_width, decoded_height, rgba)) => {
                let uploaded = self.upload_source_frame_pixels(
                    source_id.to_string(),
                    upload_seq,
                    decoded_width,
                    decoded_height,
                    &rgba,
                    "native-video-frame",
                    false,
                );
                self.stats.native_video_frame_decodes =
                    self.stats.native_video_frame_decodes.saturating_add(1);
                self.stats.native_video_frame_decode_bytes_uploaded = self
                    .stats
                    .native_video_frame_decode_bytes_uploaded
                    .saturating_add(uploaded as u64);
                self.stats.native_video_frame_decode_last_error.clear();
                self.store_native_video_frame_cache(
                    signature.clone(),
                    decoded_width,
                    decoded_height,
                    &rgba,
                );
                self.native_video_frame_signatures
                    .insert(source_id.to_string(), signature.clone());
                self.prefetch_native_video_frame_window(
                    &path,
                    width,
                    height,
                    time_seconds,
                    prefetch_window_frames,
                    prefetch_fps,
                    &signature,
                );
            }
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                self.native_video_frame_signatures.remove(source_id);
            }
        }
    }

    fn upload_source_frame_pixels(
        &mut self,
        source_id: String,
        seq: u64,
        width: usize,
        height: usize,
        rgba: &[u8],
        transport: &str,
        count_cpu_fallback: bool,
    ) -> usize {
        let input_byte_len = rgba.len() as u64;
        let slot = self.assign_source_frame_slot(&source_id);
        let dst_size = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.source_frame_size)
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT);
        let pixels = resample_frame_bytes(rgba, width, height, dst_size, dst_size);
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.write_source_frame(slot, &pixels);
        }
        self.stats.source_frame_uploads = self.stats.source_frame_uploads.saturating_add(1);
        self.stats.source_frame_bytes_uploaded = self
            .stats
            .source_frame_bytes_uploaded
            .saturating_add(pixels.len() as u64);
        self.stats.source_frame_input_bytes_uploaded = self
            .stats
            .source_frame_input_bytes_uploaded
            .saturating_add(input_byte_len);
        self.stats.source_frame_resampled_bytes_uploaded = self
            .stats
            .source_frame_resampled_bytes_uploaded
            .saturating_add(pixels.len() as u64);
        if count_cpu_fallback {
            self.stats.source_frame_cpu_fallback_uploads = self
                .stats
                .source_frame_cpu_fallback_uploads
                .saturating_add(1);
        }
        self.stats.source_frame_last_input_bytes = input_byte_len;
        self.stats.source_frame_last_upload_bytes = pixels.len() as u64;
        self.stats.source_frame_last_upload_width = width.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_height = height.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_transport = transport.to_string();
        self.stats.source_frame_last_reject_reason.clear();
        if transport != "native-image" {
            self.source_frame_signatures.remove(&source_id);
        }
        if transport != "native-video-frame" {
            self.native_video_frame_signatures.remove(&source_id);
        }
        self.source_frames
            .insert(source_id.clone(), SourceFrame { seq });
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        pixels.len()
    }

    fn apply_source_frame(&mut self, command: &Value) {
        let Some(source_id) = string_at(command, &["source_id"]) else {
            return;
        };
        let seq = number_at(command, &["seq"]).unwrap_or(0.0).round().max(0.0) as u64;
        if let Some(existing) = self.source_frames.get(&source_id) {
            if seq < existing.seq {
                return;
            }
        }
        let width = number_at(command, &["width"])
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT as f64)
            .round()
            .clamp(1.0, SOURCE_FRAME_SIZE_INSANE as f64) as usize;
        let height = number_at(command, &["height"])
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT as f64)
            .round()
            .clamp(1.0, SOURCE_FRAME_SIZE_INSANE as f64) as usize;
        let transport = source_frame_transport_from_command(command);
        if transport == SourceFrameTransport::SharedTexture {
            self.apply_shared_texture_source_frame(source_id, seq, command, width, height);
            return;
        }
        let Some(rgba) = rgba_bytes_from_command(command, width, height) else {
            self.reject_source_frame_upload(
                width,
                height,
                transport.as_str(),
                "missing or invalid source-frame pixel payload",
            );
            return;
        };
        self.upload_source_frame_pixels(
            source_id,
            seq,
            width,
            height,
            &rgba,
            transport.as_str(),
            transport.is_cpu_fallback(),
        );
        match transport {
            SourceFrameTransport::File => {
                self.stats.source_frame_file_uploads =
                    self.stats.source_frame_file_uploads.saturating_add(1);
            }
            SourceFrameTransport::Base64 => {
                self.stats.source_frame_base64_uploads =
                    self.stats.source_frame_base64_uploads.saturating_add(1);
            }
            SourceFrameTransport::Json => {
                self.stats.source_frame_json_uploads =
                    self.stats.source_frame_json_uploads.saturating_add(1);
            }
            SourceFrameTransport::SharedTexture => {
                self.stats.source_frame_shared_texture_uploads = self
                    .stats
                    .source_frame_shared_texture_uploads
                    .saturating_add(1);
            }
            SourceFrameTransport::Unknown => {}
        }
    }

    fn apply_shared_texture_source_frame(
        &mut self,
        source_id: String,
        seq: u64,
        command: &Value,
        width: usize,
        height: usize,
    ) {
        let Some(descriptor) =
            SharedTextureSourceFrameDescriptor::from_command(command, width, height)
        else {
            self.reject_shared_texture_source_frame(
                width,
                height,
                "shared texture source-frame upload is not implemented yet (missing shared texture handle)",
            );
            return;
        };

        if self.renderer.is_none() {
            let reason = format!(
                "{}; native renderer is not running",
                descriptor.unsupported_reason(native_backend_name())
            );
            self.reject_shared_texture_source_frame(width, height, &reason);
            return;
        }

        let slot = self.assign_source_frame_slot(&source_id);
        let renderer = self
            .renderer
            .as_ref()
            .expect("renderer checked before shared texture import");
        let uploaded_bytes = match renderer.import_shared_texture_source_frame(slot, &descriptor) {
            Ok(uploaded_bytes) => uploaded_bytes,
            Err(err) => {
                self.source_frame_slots.remove(&source_id);
                self.reject_shared_texture_source_frame(width, height, &err);
                return;
            }
        };

        self.stats.source_frame_uploads = self.stats.source_frame_uploads.saturating_add(1);
        self.stats.source_frame_shared_texture_uploads = self
            .stats
            .source_frame_shared_texture_uploads
            .saturating_add(1);
        self.stats.source_frame_bytes_uploaded = self
            .stats
            .source_frame_bytes_uploaded
            .saturating_add(uploaded_bytes);
        self.stats.source_frame_resampled_bytes_uploaded = self
            .stats
            .source_frame_resampled_bytes_uploaded
            .saturating_add(uploaded_bytes);
        self.stats.source_frame_last_input_bytes = descriptor.handle_byte_length.unwrap_or(0);
        self.stats.source_frame_last_upload_bytes = uploaded_bytes;
        self.stats.source_frame_last_upload_width = descriptor.width;
        self.stats.source_frame_last_upload_height = descriptor.height;
        self.stats.source_frame_last_upload_transport = "shared-texture".to_string();
        self.stats.source_frame_last_reject_reason.clear();
        self.source_frame_signatures.remove(&source_id);
        self.native_video_frame_signatures.remove(&source_id);
        self.source_frames
            .insert(source_id.clone(), SourceFrame { seq });
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
    }

    fn reject_shared_texture_source_frame(&mut self, width: usize, height: usize, reason: &str) {
        self.stats.source_frame_shared_texture_rejected_uploads = self
            .stats
            .source_frame_shared_texture_rejected_uploads
            .saturating_add(1);
        self.reject_source_frame_upload(width, height, "shared-texture-unsupported", reason);
    }

    fn reject_source_frame_upload(
        &mut self,
        width: usize,
        height: usize,
        transport: &str,
        reason: &str,
    ) {
        self.stats.source_frame_rejected_uploads =
            self.stats.source_frame_rejected_uploads.saturating_add(1);
        self.stats.source_frame_last_input_bytes = 0;
        self.stats.source_frame_last_upload_bytes = 0;
        self.stats.source_frame_last_upload_width = width.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_height = height.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_transport = transport.to_string();
        self.stats.source_frame_last_reject_reason = reason.to_string();
    }

    fn assign_source_preview_slot(&mut self, source_id: &str) -> usize {
        if let Some(slot) = self.source_preview_slots.get(source_id).copied() {
            return slot;
        }
        let used: std::collections::HashSet<usize> =
            self.source_preview_slots.values().copied().collect();
        let slot = (0..MAX_SOURCE_PREVIEWS)
            .find(|candidate| !used.contains(candidate))
            .unwrap_or_else(|| stable_slot(source_id, MAX_SOURCE_PREVIEWS));
        if let Some(old_source_id) =
            self.source_preview_slots
                .iter()
                .find_map(|(id, existing_slot)| {
                    if *existing_slot == slot && id != source_id {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
        {
            self.source_preview_slots.remove(&old_source_id);
            self.source_previews.remove(&old_source_id);
            for layer in self.scene_layers.values_mut() {
                if layer.source_id.as_deref() == Some(old_source_id.as_str()) {
                    layer.preview_slot = None;
                }
            }
        }
        self.source_preview_slots
            .insert(source_id.to_string(), slot);
        slot
    }

    fn assign_source_frame_slot(&mut self, source_id: &str) -> usize {
        if let Some(slot) = self.source_frame_slots.get(source_id).copied() {
            return slot;
        }
        let used: std::collections::HashSet<usize> =
            self.source_frame_slots.values().copied().collect();
        if let Some(slot) = (0..MAX_SOURCE_FRAME_SLOTS).find(|slot| !used.contains(slot)) {
            self.source_frame_slots.insert(source_id.to_string(), slot);
            return slot;
        }

        let slot = stable_slot(source_id, MAX_SOURCE_FRAME_SLOTS);
        if let Some(old_source_id) =
            self.source_frame_slots
                .iter()
                .find_map(|(id, existing_slot)| {
                    if *existing_slot == slot {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
        {
            self.source_frame_slots.remove(&old_source_id);
            self.source_frames.remove(&old_source_id);
            self.source_frame_signatures.remove(&old_source_id);
            self.native_video_frame_signatures.remove(&old_source_id);
            for layer in self.scene_layers.values_mut() {
                if layer.source_id.as_deref() == Some(old_source_id.as_str()) {
                    layer.frame_slot = None;
                }
            }
        }
        self.source_frame_slots.insert(source_id.to_string(), slot);
        slot
    }

    fn apply_remove_layer(&mut self, command: &Value) {
        if let Some(layer_id) = string_at(command, &["layer_id"]) {
            self.scene_layers.remove(&layer_id);
            self.isf_layer_bindings.remove(&layer_id);
        }
    }

    fn gpu_layer_data(&self) -> Vec<LayerGpu> {
        let mut layers: Vec<&SceneLayer> = self.scene_layers.values().collect();
        // Editor layer index 0 is visually top-most, so send larger z first
        // and let z=0 blend last.
        layers.sort_by(|a, b| b.z_index.cmp(&a.z_index).then_with(|| a.id.cmp(&b.id)));
        layers
            .into_iter()
            .take(MAX_SCENE_LAYERS)
            .map(SceneLayer::gpu)
            .collect()
    }

    fn source_preview_pixel_data(&self) -> Vec<PreviewPixel> {
        let mut pixels = vec![PreviewPixel::zeroed(); MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS];
        for preview in self.source_previews.values() {
            let slot = preview.slot.min(MAX_SOURCE_PREVIEWS - 1);
            let offset = slot * SOURCE_PREVIEW_PIXELS;
            let end = offset + SOURCE_PREVIEW_PIXELS;
            pixels[offset..end].copy_from_slice(&preview.pixels[..SOURCE_PREVIEW_PIXELS]);
        }
        pixels
    }
}

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::Wait);
        if let Err(err) = self.ensure_renderer(event_loop) {
            eprintln!("[GhostRenderCore] failed to initialize renderer: {err}");
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Rpc(req) => self.handle_rpc(event_loop, req),
            UserEvent::NativeVideoFrameDecoded(result) => {
                self.apply_native_video_decode_result(result)
            }
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        let Some(renderer) = self.renderer.as_mut() else {
            return;
        };
        if renderer.window.id() != window_id {
            return;
        }
        match event {
            WindowEvent::CloseRequested => {
                self.running = false;
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                renderer.resize(size);
                self.pending_width = size.width.max(1);
                self.pending_height = size.height.max(1);
            }
            WindowEvent::RedrawRequested => self.render(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if !self.running {
            event_loop.set_control_flow(ControlFlow::Wait);
            return;
        }

        let frame_duration = self.frame_duration();
        self.pump_native_video_decodes();
        let next_frame_at = self.last_redraw + frame_duration;
        let now = Instant::now();
        if now >= next_frame_at {
            if let Some(renderer) = self.renderer.as_ref() {
                renderer.window.request_redraw();
            }
            self.last_redraw = now;
            event_loop.set_control_flow(ControlFlow::WaitUntil(now + frame_duration));
        } else {
            event_loop.set_control_flow(ControlFlow::WaitUntil(next_frame_at));
        }
    }
}

impl RenderState {
    async fn new(
        window: &'static Window,
        width: u32,
        height: u32,
        present_mode: &str,
        allow_tearing: bool,
        max_frame_latency: u32,
    ) -> Result<Self, String> {
        let instance = wgpu::Instance::default();
        let surface = instance
            .create_surface(window)
            .map_err(|err| err.to_string())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
                apply_limit_buckets: false,
            })
            .await
            .map_err(|err| err.to_string())?;
        let adapter_info = adapter.get_info();
        let adapter_limits = adapter.limits();
        let adapter_features = adapter.features();
        let source_frame_format = choose_source_frame_format(&adapter);
        let source_frame_size =
            choose_source_frame_size(&adapter_limits, adapter_features, source_frame_format);
        let source_frame_mip_levels = source_frame_mip_levels(source_frame_size);
        let requested_features = adapter_features.intersection(native_optional_features());
        let native_caps = native_gpu_caps(
            &adapter_info,
            &adapter_limits,
            adapter_features,
            requested_features,
        );
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Ghost Render Core Device"),
                required_features: requested_features,
                required_limits: wgpu::Limits::default(),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|err| err.to_string())?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|format| format.is_srgb())
            .unwrap_or(caps.formats[0]);
        let supported_present_modes = caps.present_modes.clone();
        let present_mode =
            choose_present_mode(&supported_present_modes, present_mode, allow_tearing);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            width: width.max(1),
            height: height.max(1),
            present_mode,
            desired_maximum_frame_latency: max_frame_latency.clamp(1, 8),
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Render Core Heartbeat"),
            source: wgpu::ShaderSource::Wgsl(include_str!("heartbeat.wgsl").into()),
        });
        let native_shader_vertex_module =
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Shader Fullscreen Vertex"),
                source: wgpu::ShaderSource::Wgsl(NATIVE_SHADER_FULLSCREEN_VERTEX_WGSL.into()),
            });
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Uniforms"),
            contents: bytemuck::bytes_of(&Uniforms {
                resolution: [config.width as f32, config.height as f32],
                time: 0.0,
                command_phase: 0.0,
                layer_count: 0.0,
                frame_count: 0.0,
                _pad0: [0.0, 0.0],
                audio0: [0.0; 4],
                audio1: [0.0; 4],
                audio2: [0.0; 4],
            }),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let native_shader_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Native Shader Uniforms"),
                contents: bytemuck::bytes_of(&NativeShaderUniforms::zeroed()),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let empty_layers = vec![LayerGpu::zeroed(); MAX_SCENE_LAYERS];
        let layer_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Scene Layers"),
            contents: bytemuck::cast_slice(&empty_layers),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let empty_previews =
            vec![PreviewPixel::zeroed(); MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS];
        let source_preview_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Source Previews"),
            contents: bytemuck::cast_slice(&empty_previews),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let source_frame_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Source Frames"),
            size: wgpu::Extent3d {
                width: source_frame_size as u32,
                height: source_frame_size as u32,
                depth_or_array_layers: MAX_SOURCE_FRAME_SLOTS as u32,
            },
            mip_level_count: source_frame_mip_levels,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: source_frame_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let source_frame_view = source_frame_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Source Frame View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let source_frame_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Ghost Render Core Source Frame Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let source_frame_blitter = TextureBlitterBuilder::new(&device, source_frame_format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        let (output_mirror_texture, output_mirror_view) = Self::create_offscreen_target(
            &device,
            config.width,
            config.height,
            format,
            "Ghost Render Core Output Mirror",
        );
        #[cfg(target_os = "macos")]
        let output_export = Self::create_output_export_target(
            &device,
            config.width,
            config.height,
            native_output_export_format(format),
        )
        .ok();
        let (snapshot_texture, snapshot_view) = Self::create_offscreen_target(
            &device,
            config.width,
            config.height,
            format,
            "Ghost Render Core Snapshot Mirror",
        );
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Ghost Render Core Bind Group Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2Array,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Bind Group"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: layer_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: source_preview_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&source_frame_view),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::Sampler(&source_frame_sampler),
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Ghost Render Core Pipeline Layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Ghost Render Core Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });

        let stage3d_overlay_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Render Core Stage3D Overlay"),
            source: wgpu::ShaderSource::Wgsl(STAGE3D_OVERLAY_WGSL.into()),
        });
        let stage3d_overlay_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Uniforms"),
                contents: bytemuck::bytes_of(&Stage3DOverlayUniforms {
                    resolution: [config.width as f32, config.height as f32],
                    item_count: 0.0,
                    time: 0.0,
                }),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let empty_stage3d_items = vec![Stage3DOverlayItemGpu::zeroed(); MAX_STAGE3D_OVERLAY_ITEMS];
        let stage3d_overlay_item_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Items"),
                contents: bytemuck::cast_slice(&empty_stage3d_items),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            });
        let stage3d_overlay_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });
        let stage3d_overlay_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Stage3D Overlay Bind Group"),
            layout: &stage3d_overlay_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: stage3d_overlay_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: stage3d_overlay_item_buffer.as_entire_binding(),
                },
            ],
        });
        let stage3d_overlay_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Pipeline Layout"),
                bind_group_layouts: &[Some(&stage3d_overlay_bind_group_layout)],
                immediate_size: 0,
            });
        let stage3d_overlay_pipeline =
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Pipeline"),
                layout: Some(&stage3d_overlay_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &stage3d_overlay_shader,
                    entry_point: Some("vs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &stage3d_overlay_shader,
                    entry_point: Some("fs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });

        let stage3d_mesh_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Render Core Stage3D Mesh"),
            source: wgpu::ShaderSource::Wgsl(STAGE3D_MESH_WGSL.into()),
        });
        let stage3d_mesh_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Uniforms"),
                contents: bytemuck::bytes_of(&Stage3DMeshUniforms::zeroed()),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let empty_stage3d_mesh_items = vec![Stage3DMeshItemGpu::zeroed(); MAX_STAGE3D_MESH_ITEMS];
        let stage3d_mesh_item_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Items"),
                contents: bytemuck::cast_slice(&empty_stage3d_mesh_items),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            });
        let stage3d_mesh_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::VERTEX,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2Array,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 3,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let stage3d_mesh_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Stage3D Mesh Bind Group"),
            layout: &stage3d_mesh_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: stage3d_mesh_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: stage3d_mesh_item_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&source_frame_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&source_frame_sampler),
                },
            ],
        });
        let stage3d_mesh_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Pipeline Layout"),
                bind_group_layouts: &[Some(&stage3d_mesh_bind_group_layout)],
                immediate_size: 0,
            });
        let stage3d_mesh_pipeline =
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Pipeline"),
                layout: Some(&stage3d_mesh_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &stage3d_mesh_shader,
                    entry_point: Some("vs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState {
                    cull_mode: Some(wgpu::Face::Back),
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Less),
                    stencil: wgpu::StencilState::default(),
                    bias: wgpu::DepthBiasState::default(),
                }),
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &stage3d_mesh_shader,
                    entry_point: Some("fs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        let (stage3d_mesh_depth_texture, stage3d_mesh_depth_view) = Self::create_depth_target(
            &device,
            config.width,
            config.height,
            "Ghost Render Core Stage3D Mesh Depth",
        );

        let native_shader_input_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Native Shader Input Frames"),
            size: wgpu::Extent3d {
                width: source_frame_size as u32,
                height: source_frame_size as u32,
                depth_or_array_layers: MAX_SOURCE_FRAME_SLOTS as u32,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: source_frame_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let native_shader_input_view =
            native_shader_input_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Render Core Native Shader Input Frame View"),
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            });
        let native_shader_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Ghost Render Core Native Shader Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2Array,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let native_shader_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Native Shader Bind Group"),
            layout: &native_shader_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: native_shader_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&native_shader_input_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&source_frame_sampler),
                },
            ],
        });

        window.set_title(&format!("Ghost Render Core - {}", adapter_info.name));
        let gpu_timing = requested_features
            .contains(wgpu::Features::TIMESTAMP_QUERY)
            .then(|| GpuTimingState::new(&device, &queue));

        Ok(Self {
            window,
            adapter_name: adapter_info.name,
            native_caps,
            surface,
            device,
            queue,
            config,
            supported_present_modes,
            pipeline,
            uniform_buffer,
            native_shader_uniform_buffer,
            layer_buffer,
            source_preview_buffer,
            source_frame_texture,
            source_frame_sampler,
            native_shader_input_texture,
            source_frame_size,
            source_frame_format,
            source_frame_mip_levels,
            source_frame_blitter,
            native_shader_vertex_module,
            native_shader_bind_group_layout,
            native_shader_bind_group,
            stage3d_overlay_pipeline,
            stage3d_overlay_uniform_buffer,
            stage3d_overlay_item_buffer,
            stage3d_overlay_bind_group,
            stage3d_mesh_pipeline,
            stage3d_mesh_uniform_buffer,
            stage3d_mesh_item_buffer,
            stage3d_mesh_bind_group,
            stage3d_mesh_depth_texture,
            stage3d_mesh_depth_view,
            native_shader_pipelines: HashMap::new(),
            native_compute_pipelines: HashMap::new(),
            native_graph_render_pipelines: HashMap::new(),
            native_compute_graph_buffers: HashMap::new(),
            output_mirror_texture,
            output_mirror_view,
            #[cfg(target_os = "macos")]
            output_export,
            snapshot_texture,
            snapshot_view,
            last_frame_metrics: None,
            bind_group,
            start_time: Instant::now(),
            gpu_timing,
            last_frame_error: None,
        })
    }

    fn adapter_name(&self) -> Option<String> {
        Some(self.adapter_name.clone())
    }

    fn create_offscreen_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        label: &'static str,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some(label),
            ..Default::default()
        });
        (texture, view)
    }

    fn create_depth_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        label: &'static str,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some(label),
            ..Default::default()
        });
        (texture, view)
    }

    #[cfg(target_os = "macos")]
    fn create_output_export_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Result<NativeOutputExport, String> {
        use objc2_core_foundation::{CFDictionary, CFNumber, CFType};
        use objc2_io_surface::{
            IOSurfaceRef, kIOSurfaceBytesPerElement, kIOSurfaceHeight, kIOSurfacePixelFormat,
            kIOSurfaceWidth,
        };
        use objc2_metal::{
            MTLDevice, MTLStorageMode, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage,
        };
        use wgpu::hal::{self, api::Metal};

        let width = width.max(1);
        let height = height.max(1);
        let width_value = CFNumber::new_i32(width.min(i32::MAX as u32) as i32);
        let height_value = CFNumber::new_i32(height.min(i32::MAX as u32) as i32);
        let bytes_per_element_value = CFNumber::new_i32(4);
        let bgra_fourcc =
            (b'B' as i32) << 24 | (b'G' as i32) << 16 | (b'R' as i32) << 8 | b'A' as i32;
        let pixel_format_value = CFNumber::new_i32(bgra_fourcc);
        let keys: [&CFType; 4] = unsafe {
            [
                kIOSurfaceWidth.as_ref(),
                kIOSurfaceHeight.as_ref(),
                kIOSurfaceBytesPerElement.as_ref(),
                kIOSurfacePixelFormat.as_ref(),
            ]
        };
        let values: [&CFType; 4] = [
            width_value.as_ref(),
            height_value.as_ref(),
            bytes_per_element_value.as_ref(),
            pixel_format_value.as_ref(),
        ];
        let properties = CFDictionary::<CFType, CFType>::from_slices(&keys, &values);
        let surface = unsafe { IOSurfaceRef::new(properties.as_opaque()) }.ok_or_else(|| {
            format!("IOSurfaceCreate failed for native output export {width}x{height}")
        })?;

        let raw_device = unsafe { device.as_hal::<Metal>() }
            .ok_or_else(|| "native renderer is not running on the Metal backend".to_string())?;
        let metal_format = metal_texture_format_for_wgpu_output(format);
        let texture_descriptor = unsafe {
            MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                metal_format,
                width as usize,
                height as usize,
                false,
            )
        };
        texture_descriptor.setTextureType(MTLTextureType::Type2D);
        texture_descriptor.setStorageMode(MTLStorageMode::Shared);
        texture_descriptor.setUsage(MTLTextureUsage::ShaderRead | MTLTextureUsage::RenderTarget);
        let raw_texture = raw_device
            .raw_device()
            .newTextureWithDescriptor_iosurface_plane(&texture_descriptor, &surface, 0)
            .ok_or_else(|| {
                format!("Metal failed to create native output export texture {width}x{height}")
            })?;
        let hal_texture = unsafe {
            hal::metal::Device::texture_from_raw(
                raw_texture,
                format,
                MTLTextureType::Type2D,
                1,
                1,
                hal::CopyExtent {
                    width,
                    height,
                    depth: 1,
                },
                None,
            )
        };
        let texture = unsafe {
            device.create_texture_from_hal::<Metal>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("Ghost Render Core Output IOSurface Export"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING
                        | wgpu::TextureUsages::COPY_SRC,
                    view_formats: &[],
                },
                wgpu::TextureUses::COLOR_TARGET,
            )
        };
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Output IOSurface Export View"),
            format: Some(format),
            dimension: Some(wgpu::TextureViewDimension::D2),
            ..Default::default()
        });
        let blitter = TextureBlitterBuilder::new(device, format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        Ok(NativeOutputExport {
            surface,
            texture,
            view,
            blitter,
            width,
            height,
            format,
            frame: 0,
        })
    }

    #[cfg(target_os = "macos")]
    fn refresh_output_export(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if let Some(export) = self.output_export.as_mut() {
            let _keep_texture_alive = &export.texture;
            export.blitter.copy(
                &self.device,
                encoder,
                &self.output_mirror_view,
                &export.view,
            );
            export.frame = export.frame.saturating_add(1);
        }
    }

    fn poll_gpu_timing(&mut self) {
        if self.gpu_timing.is_none() {
            return;
        }
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(gpu_timing) = self.gpu_timing.as_mut() {
            gpu_timing.poll_readback();
        }
    }

    fn last_render_gpu_ms(&self) -> Option<f64> {
        self.gpu_timing.as_ref().and_then(|timing| {
            (timing.last_render_gpu_ms > 0.0).then_some(timing.last_render_gpu_ms)
        })
    }

    fn gpu_timing_stats(&self) -> (bool, f64, f64, f64, u64, u64) {
        self.gpu_timing
            .as_ref()
            .map(|timing| {
                (
                    true,
                    timing.last_render_gpu_ms,
                    timing.avg_render_gpu_ms,
                    timing.max_render_gpu_ms,
                    timing.samples,
                    timing.resolve_misses,
                )
            })
            .unwrap_or((false, 0.0, 0.0, 0.0, 0, 0))
    }

    fn native_shader_pipeline_count(&self) -> u32 {
        self.native_shader_pipelines.len().min(u32::MAX as usize) as u32
    }

    fn native_pipeline_cache_count(&self) -> u32 {
        self.native_shader_pipelines
            .len()
            .saturating_add(self.native_compute_pipelines.len())
            .saturating_add(self.native_graph_render_pipelines.len())
            .min(u32::MAX as usize) as u32
    }

    fn clear_native_pipeline_caches(&mut self) -> usize {
        let count = self
            .native_shader_pipelines
            .len()
            .saturating_add(self.native_compute_pipelines.len())
            .saturating_add(self.native_graph_render_pipelines.len());
        self.native_shader_pipelines.clear();
        self.native_compute_pipelines.clear();
        self.native_graph_render_pipelines.clear();
        count
    }

    fn present_mode_label(&self) -> String {
        present_mode_label(self.config.present_mode).to_string()
    }

    fn supports_tearing(&self) -> bool {
        self.supported_present_modes.iter().any(|mode| {
            matches!(
                mode,
                wgpu::PresentMode::Immediate | wgpu::PresentMode::FifoRelaxed
            )
        })
    }

    fn tearing_active(&self) -> bool {
        matches!(
            self.config.present_mode,
            wgpu::PresentMode::Immediate | wgpu::PresentMode::FifoRelaxed
        )
    }

    fn output_export_ready(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            self.output_export.is_some()
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }

    fn output_export_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            if let Some(export) = self.output_export.as_ref() {
                return json!({
                    "available": true,
                    "platform": "iosurface",
                    "handle": export.surface.id().to_string(),
                    "handle_encoding": "integer",
                    "handle_byte_length": 4,
                    "width": export.width,
                    "height": export.height,
                    "format": texture_format_label(export.format),
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        json!({
            "available": false,
            "platform": if cfg!(target_os = "macos") { "iosurface" } else if cfg!(target_os = "windows") { "dxgi" } else { "unsupported" },
            "reason": if cfg!(target_os = "macos") { "native output IOSurface export target is unavailable" } else { "native output shared texture export is pending for this backend" },
        })
    }

    fn set_present_policy(
        &mut self,
        present_mode: &str,
        allow_tearing: bool,
        max_frame_latency: u32,
    ) {
        self.config.present_mode =
            choose_present_mode(&self.supported_present_modes, present_mode, allow_tearing);
        self.config.desired_maximum_frame_latency = max_frame_latency.clamp(1, 8);
        self.surface.configure(&self.device, &self.config);
    }

    fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        let (output_mirror_texture, output_mirror_view) = Self::create_offscreen_target(
            &self.device,
            self.config.width,
            self.config.height,
            self.config.format,
            "Ghost Render Core Output Mirror",
        );
        self.output_mirror_texture = output_mirror_texture;
        self.output_mirror_view = output_mirror_view;
        #[cfg(target_os = "macos")]
        {
            self.output_export = Self::create_output_export_target(
                &self.device,
                self.config.width,
                self.config.height,
                native_output_export_format(self.config.format),
            )
            .ok();
        }
        let (snapshot_texture, snapshot_view) = Self::create_offscreen_target(
            &self.device,
            self.config.width,
            self.config.height,
            self.config.format,
            "Ghost Render Core Snapshot Mirror",
        );
        self.snapshot_texture = snapshot_texture;
        self.snapshot_view = snapshot_view;
        let (stage3d_mesh_depth_texture, stage3d_mesh_depth_view) = Self::create_depth_target(
            &self.device,
            self.config.width,
            self.config.height,
            "Ghost Render Core Stage3D Mesh Depth",
        );
        self.stage3d_mesh_depth_texture = stage3d_mesh_depth_texture;
        self.stage3d_mesh_depth_view = stage3d_mesh_depth_view;
    }

    fn ensure_native_shader_pipeline(
        &mut self,
        cache_key: &str,
        source: &str,
        fragment_entry: &str,
    ) -> Result<(), String> {
        if self.native_shader_pipelines.contains_key(cache_key) {
            return Ok(());
        }
        let error_scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Shader Fragment"),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Shader Pipeline Layout"),
                bind_group_layouts: &[Some(&self.native_shader_bind_group_layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Native Shader Pipeline"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &self.native_shader_vertex_module,
                    entry_point: Some("vs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(fragment_entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: self.source_frame_format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        let error_future = error_scope.pop();
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(err) = pollster::block_on(error_future) {
            return Err(err.to_string());
        }
        self.native_shader_pipelines
            .insert(cache_key.to_string(), NativeShaderPipeline { pipeline });
        Ok(())
    }

    fn ensure_native_compute_pipeline(
        &mut self,
        cache_key: &str,
        source: &str,
        compute_entry: &str,
        layout_specs: &[NativeComputeBindingLayoutSpec],
    ) -> Result<(), String> {
        if self.native_compute_pipelines.contains_key(cache_key) {
            return Ok(());
        }
        if layout_specs.is_empty() {
            return Err(format!(
                "native compute pipeline `{cache_key}` has no bindings"
            ));
        }
        let error_scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Compute Shader"),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
        let layout_entries = layout_specs
            .iter()
            .map(|spec| wgpu::BindGroupLayoutEntry {
                binding: spec.binding,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: spec.kind.binding_type(),
                count: None,
            })
            .collect::<Vec<_>>();
        let bind_group_layout =
            self.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("Ghost Render Core Native Compute Layout"),
                    entries: &layout_entries,
                });
        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pipeline Layout"),
                bind_group_layouts: &[Some(&bind_group_layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pipeline"),
                layout: Some(&pipeline_layout),
                module: &shader,
                entry_point: Some(compute_entry),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: None,
            });
        let error_future = error_scope.pop();
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(err) = pollster::block_on(error_future) {
            return Err(err.to_string());
        }
        self.native_compute_pipelines.insert(
            cache_key.to_string(),
            NativeComputePipeline {
                pipeline,
                bind_group_layout,
            },
        );
        Ok(())
    }

    fn run_native_compute_probe(
        &mut self,
        cache_key: &str,
        source: &str,
        compute_entry: &str,
        uniforms: ComputeProbeUniforms,
    ) -> Result<ComputeProbeResult, String> {
        self.ensure_native_compute_pipeline(
            cache_key,
            source,
            compute_entry,
            &[
                NativeComputeBindingLayoutSpec {
                    binding: 0,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                },
                NativeComputeBindingLayoutSpec {
                    binding: 1,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                },
            ],
        )?;
        let element_count = uniforms.element_count.max(1);
        let byte_length = element_count as u64 * std::mem::size_of::<u32>() as u64;
        let storage_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Storage"),
            size: byte_length,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let uniform_buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Uniforms"),
                contents: bytemuck::bytes_of(&uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let readback_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Readback"),
            size: byte_length,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let Some(cached) = self.native_compute_pipelines.get(cache_key) else {
            return Err(format!(
                "native compute pipeline missing after compile: {cache_key}"
            ));
        };
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Bind Group"),
            layout: &cached.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: storage_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: uniform_buffer.as_entire_binding(),
                },
            ],
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Encoder"),
            });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&cached.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(element_count.div_ceil(64), 1, 1);
        }
        encoder.copy_buffer_to_buffer(&storage_buffer, 0, &readback_buffer, 0, byte_length);
        self.queue.submit(Some(encoder.finish()));

        let slice = readback_buffer.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result.map_err(|err| err.to_string()));
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|err| err.to_string())?;
        rx.recv()
            .map_err(|err| err.to_string())?
            .map_err(|err| err.to_string())?;
        let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
        let mut checksum = 0xcbf29ce484222325u64;
        let mut nonzero_words = 0u32;
        let mut first_words = Vec::new();
        for chunk in mapped.chunks_exact(4) {
            let value = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value != 0 {
                nonzero_words = nonzero_words.saturating_add(1);
            }
            if first_words.len() < COMPUTE_READBACK_PREVIEW_WORDS {
                first_words.push(value);
            }
            checksum ^= value as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        drop(mapped);
        readback_buffer.unmap();
        self.last_frame_error = None;
        Ok(ComputeProbeResult {
            byte_length,
            checksum,
            nonzero_words,
            first_words,
        })
    }

    fn run_native_compute_graph(
        &mut self,
        buffers: Vec<NativeComputeGraphBufferSpec>,
        passes: Vec<NativeComputeGraphPassPlan>,
        readbacks: Vec<String>,
        render_plans: Vec<NativeComputeGraphRenderPlan>,
    ) -> Result<Value, String> {
        if buffers.is_empty() {
            return Err("native compute graph requires at least one buffer".to_string());
        }
        if passes.is_empty() && render_plans.is_empty() {
            return Err(
                "native compute graph requires at least one pass or render pass".to_string(),
            );
        }
        let mut transient_buffers = HashMap::<String, NativeComputeGraphGpuBuffer>::new();
        let mut persistent_buffer_count = 0usize;
        let mut transient_buffer_count = 0usize;
        for spec in buffers {
            if spec.persistent {
                self.upsert_native_compute_graph_buffer(&spec)?;
                persistent_buffer_count = persistent_buffer_count.saturating_add(1);
            } else {
                transient_buffer_count = transient_buffer_count.saturating_add(1);
                transient_buffers.insert(
                    spec.id.clone(),
                    self.create_native_compute_graph_buffer(&spec),
                );
            }
        }

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Native Compute Graph Encoder"),
            });
        let mut executed_passes = Vec::with_capacity(passes.len());
        for pass_plan in passes {
            let layout_specs = pass_plan
                .bindings
                .iter()
                .map(|binding| NativeComputeBindingLayoutSpec {
                    binding: binding.binding,
                    kind: binding.kind,
                })
                .collect::<Vec<_>>();
            self.ensure_native_compute_pipeline(
                &pass_plan.cache_key,
                &pass_plan.source,
                &pass_plan.entry,
                &layout_specs,
            )?;
            let Some(cached) = self.native_compute_pipelines.get(&pass_plan.cache_key) else {
                return Err(format!(
                    "native compute graph pipeline missing after compile: {}",
                    pass_plan.cache_key
                ));
            };
            let mut texture_views = Vec::new();
            let entries = self.compute_graph_bind_group_entries(
                &transient_buffers,
                &pass_plan.bindings,
                &format!("pass `{}`", pass_plan.name),
                &mut texture_views,
                None,
            )?;
            let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(&format!(
                    "Ghost Native Compute Graph Bind Group {}",
                    pass_plan.name
                )),
                layout: &cached.bind_group_layout,
                entries: &entries,
            });
            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(&format!(
                        "Ghost Native Compute Graph Pass {}",
                        pass_plan.name
                    )),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&cached.pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                pass.dispatch_workgroups(
                    pass_plan.dispatch[0].max(1),
                    pass_plan.dispatch[1].max(1),
                    pass_plan.dispatch[2].max(1),
                );
            }
            executed_passes.push(json!({
                "name": pass_plan.name,
                "entry": pass_plan.entry,
                "dispatch": pass_plan.dispatch,
            }));
        }

        let render_include_snapshot = render_plans.iter().any(|render| {
            render.include_snapshot
                && matches!(render.target, NativeComputeGraphRenderTarget::Snapshot)
        });
        let mut render_results = Vec::with_capacity(render_plans.len());
        for render in &render_plans {
            render_results.push(self.render_native_compute_graph(
                &mut encoder,
                &transient_buffers,
                render,
            )?);
        }

        let mut readback_buffers = Vec::new();
        for id in &readbacks {
            let Some(buffer) = self.compute_graph_buffer(&transient_buffers, id) else {
                return Err(format!(
                    "native compute graph readback missing buffer `{id}`"
                ));
            };
            let readback_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("Ghost Native Compute Graph Readback {id}")),
                size: buffer.byte_length,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            encoder.copy_buffer_to_buffer(
                &buffer.buffer,
                0,
                &readback_buffer,
                0,
                buffer.byte_length,
            );
            readback_buffers.push((id.clone(), readback_buffer, buffer.byte_length));
        }

        self.queue.submit(Some(encoder.finish()));

        let mut readback_json = serde_json::Map::new();
        for (id, readback_buffer, byte_length) in readback_buffers {
            let probe = self.readback_u32_buffer(&readback_buffer, byte_length)?;
            readback_json.insert(
                id,
                json!({
                    "byte_length": probe.byte_length,
                    "checksum": format!("{:016x}", probe.checksum),
                    "nonzero_words": probe.nonzero_words,
                    "first_words": probe.first_words,
                }),
            );
        }
        let render_snapshot = if render_include_snapshot {
            Some(self.frame_snapshot(false)?)
        } else {
            None
        };

        self.last_frame_error = None;
        let mut result = json!({
            "pass_count": executed_passes.len(),
            "passes": executed_passes,
            "readbacks": readback_json,
            "persistent_buffers": persistent_buffer_count,
            "transient_buffers": transient_buffer_count,
            "persistent_buffer_count": self.native_compute_graph_buffers.len(),
            "pipeline_cache_entries": self.native_pipeline_cache_count(),
        });
        if render_results.len() == 1 {
            if let Some(object) = result.as_object_mut() {
                object.insert("render".to_string(), render_results[0].clone());
            }
        }
        if !render_results.is_empty() {
            if let Some(object) = result.as_object_mut() {
                object.insert("renders".to_string(), Value::Array(render_results));
            }
        }
        if let Some(snapshot) = render_snapshot {
            if let Some(object) = result.as_object_mut() {
                object.insert("render_snapshot".to_string(), snapshot);
            }
        }
        Ok(result)
    }

    fn render_native_compute_graph(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        transient_buffers: &HashMap<String, NativeComputeGraphGpuBuffer>,
        render_plan: &NativeComputeGraphRenderPlan,
    ) -> Result<Value, String> {
        let (output_format, target_name, target_width, target_height, source_id, source_slot) =
            match &render_plan.target {
                NativeComputeGraphRenderTarget::Snapshot => (
                    self.config.format,
                    "snapshot",
                    self.config.width.max(1),
                    self.config.height.max(1),
                    None::<String>,
                    None::<usize>,
                ),
                NativeComputeGraphRenderTarget::SourceFrame {
                    source_id, slot, ..
                } => (
                    self.source_frame_format,
                    "source_frame",
                    self.source_frame_size.max(1) as u32,
                    self.source_frame_size.max(1) as u32,
                    Some(source_id.clone()),
                    Some((*slot).min(MAX_SOURCE_FRAME_SLOTS - 1)),
                ),
            };
        let pipeline_key = native_graph_render_pipeline_key(&render_plan.cache_key, output_format);
        let layout_specs = render_plan
            .bindings
            .iter()
            .map(|binding| NativeComputeBindingLayoutSpec {
                binding: binding.binding,
                kind: binding.kind,
            })
            .collect::<Vec<_>>();
        self.ensure_native_graph_render_pipeline(
            &pipeline_key,
            render_plan,
            &layout_specs,
            output_format,
        )?;
        let Some(cached) = self.native_graph_render_pipelines.get(&pipeline_key) else {
            return Err(format!(
                "native compute graph render pipeline missing after compile: {}",
                pipeline_key
            ));
        };
        let source_frame_sample_texture =
            self.source_frame_sample_copy_for_render(encoder, render_plan, source_slot.is_some());
        let mut texture_views = Vec::new();
        let entries = self.compute_graph_bind_group_entries(
            transient_buffers,
            &render_plan.bindings,
            &format!("render `{}`", render_plan.name),
            &mut texture_views,
            source_frame_sample_texture.as_ref(),
        )?;
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(&format!(
                "Ghost Native Compute Graph Render Bind Group {}",
                render_plan.name
            )),
            layout: &cached.bind_group_layout,
            entries: &entries,
        });
        let source_frame_target_view;
        let target_view = if let Some(slot) = source_slot {
            source_frame_target_view =
                self.source_frame_texture
                    .create_view(&wgpu::TextureViewDescriptor {
                        label: Some("Ghost Native Compute Graph Source Frame View"),
                        format: Some(self.source_frame_format),
                        dimension: Some(wgpu::TextureViewDimension::D2),
                        base_mip_level: 0,
                        mip_level_count: Some(1),
                        base_array_layer: slot as u32,
                        array_layer_count: Some(1),
                        ..Default::default()
                    });
            &source_frame_target_view
        } else {
            &self.snapshot_view
        };
        let depth_texture;
        let depth_view;
        let depth_stencil_attachment = if render_plan.depth_enabled {
            depth_texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Ghost Native Compute Graph Depth Texture"),
                size: wgpu::Extent3d {
                    width: target_width,
                    height: target_height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Depth24Plus,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            depth_view = depth_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Native Compute Graph Depth View"),
                ..Default::default()
            });
            Some(wgpu::RenderPassDepthStencilAttachment {
                view: &depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Discard,
                }),
                stencil_ops: None,
            })
        } else {
            None
        };
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(&format!(
                    "Ghost Native Compute Graph Render Pass {}",
                    render_plan.name
                )),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if render_plan.clear {
                            wgpu::LoadOp::Clear(wgpu::Color {
                                r: render_plan.clear_color[0],
                                g: render_plan.clear_color[1],
                                b: render_plan.clear_color[2],
                                a: render_plan.clear_color[3],
                            })
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&cached.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            if let Some(indirect_buffer_id) = render_plan.indirect_buffer_id.as_ref() {
                let Some(buffer) = self.compute_graph_buffer(transient_buffers, indirect_buffer_id)
                else {
                    return Err(format!(
                        "native compute graph render `{}` references missing indirect buffer `{}`",
                        render_plan.name, indirect_buffer_id
                    ));
                };
                if !buffer.indirect {
                    return Err(format!(
                        "native compute graph render `{}` indirect buffer `{}` was not created with indirect usage",
                        render_plan.name, indirect_buffer_id
                    ));
                }
                pass.draw_indirect(&buffer.buffer, render_plan.indirect_offset);
            } else {
                pass.draw(0..render_plan.vertex_count, 0..render_plan.instance_count);
            }
        }
        if let Some(slot) = source_slot {
            self.generate_source_frame_mips(encoder, slot);
        }
        let mut result = json!({
            "name": render_plan.name,
            "vertex_entry": render_plan.vertex_entry,
            "fragment_entry": render_plan.fragment_entry,
            "bindings": render_plan.bindings.len(),
            "target": target_name,
            "blend": render_plan.blend.signature(),
            "draw": if render_plan.indirect_buffer_id.is_some() { "indirect" } else { "direct" },
            "primitive": render_plan.primitive_topology.signature(),
            "vertex_count": render_plan.vertex_count,
            "instance_count": render_plan.instance_count,
            "depth": render_plan.depth_enabled,
            "depth_write": render_plan.depth_write,
            "depth_compare": render_plan.depth_compare.signature(),
            "format": texture_format_label(output_format),
            "include_snapshot": render_plan.include_snapshot,
            "clear_color": render_plan.clear_color,
        });
        if let Some(indirect_buffer_id) = render_plan.indirect_buffer_id.as_ref() {
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "indirect_buffer".to_string(),
                    Value::String(indirect_buffer_id.clone()),
                );
                object.insert(
                    "indirect_offset".to_string(),
                    Value::from(render_plan.indirect_offset),
                );
            }
        }
        if let Some(source_id) = source_id {
            if let Some(object) = result.as_object_mut() {
                object.insert("source_id".to_string(), json!(source_id));
                object.insert("source_slot".to_string(), json!(source_slot.unwrap_or(0)));
            }
        }
        Ok(result)
    }

    fn source_frame_sample_copy_for_render(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        render_plan: &NativeComputeGraphRenderPlan,
        targets_source_frame: bool,
    ) -> Option<wgpu::Texture> {
        if !targets_source_frame
            || !render_plan.bindings.iter().any(|binding| {
                matches!(
                    binding.kind,
                    NativeComputeGraphBindingKind::SourceFrameTexture(_)
                )
            })
        {
            return None;
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Native Compute Graph Source Frame Sample Copy"),
            size: wgpu::Extent3d {
                width: self.source_frame_size.max(1) as u32,
                height: self.source_frame_size.max(1) as u32,
                depth_or_array_layers: MAX_SOURCE_FRAME_SLOTS as u32,
            },
            mip_level_count: self.source_frame_mip_levels,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.source_frame_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        for mip_level in 0..self.source_frame_mip_levels {
            let width = ((self.source_frame_size as u32) >> mip_level).max(1);
            let height = ((self.source_frame_size as u32) >> mip_level).max(1);
            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.source_frame_texture,
                    mip_level,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: MAX_SOURCE_FRAME_SLOTS as u32,
                },
            );
        }
        Some(texture)
    }

    fn compute_graph_bind_group_entries<'a>(
        &'a self,
        transient_buffers: &'a HashMap<String, NativeComputeGraphGpuBuffer>,
        bindings: &'a [NativeComputeGraphBindingSpec],
        context: &str,
        texture_views: &'a mut Vec<wgpu::TextureView>,
        source_frame_texture_override: Option<&'a wgpu::Texture>,
    ) -> Result<Vec<wgpu::BindGroupEntry<'a>>, String> {
        enum PreparedBinding<'a> {
            Buffer(&'a wgpu::Buffer),
            TextureView(usize),
            Sampler,
        }

        let mut prepared = Vec::with_capacity(bindings.len());
        for binding in bindings {
            match binding.kind {
                NativeComputeGraphBindingKind::Buffer(_) => {
                    let Some(buffer) =
                        self.compute_graph_buffer(transient_buffers, &binding.resource_id)
                    else {
                        return Err(format!(
                            "native compute graph {context} references missing buffer `{}`",
                            binding.resource_id
                        ));
                    };
                    prepared.push(PreparedBinding::Buffer(&buffer.buffer));
                }
                NativeComputeGraphBindingKind::SourceFrameTexture(dimension) => {
                    let label = match dimension {
                        NativeComputeGraphTextureDimension::D2 => {
                            "Ghost Native Compute Graph Source Frame Texture View"
                        }
                        NativeComputeGraphTextureDimension::D2Array => {
                            "Ghost Native Compute Graph Source Frame Array View"
                        }
                    };
                    let slot = binding
                        .source_slot
                        .unwrap_or(0)
                        .min(MAX_SOURCE_FRAME_SLOTS - 1);
                    let source_frame_texture =
                        source_frame_texture_override.unwrap_or(&self.source_frame_texture);
                    texture_views.push(source_frame_texture.create_view(
                        &wgpu::TextureViewDescriptor {
                            label: Some(label),
                            format: Some(self.source_frame_format),
                            dimension: Some(dimension.view_dimension()),
                            base_mip_level: 0,
                            mip_level_count: Some(self.source_frame_mip_levels),
                            base_array_layer: if matches!(
                                dimension,
                                NativeComputeGraphTextureDimension::D2
                            ) {
                                slot as u32
                            } else {
                                0
                            },
                            array_layer_count: if matches!(
                                dimension,
                                NativeComputeGraphTextureDimension::D2
                            ) {
                                Some(1)
                            } else {
                                Some(MAX_SOURCE_FRAME_SLOTS as u32)
                            },
                            ..Default::default()
                        },
                    ));
                    prepared.push(PreparedBinding::TextureView(texture_views.len() - 1));
                }
                NativeComputeGraphBindingKind::SourceFrameSampler => {
                    prepared.push(PreparedBinding::Sampler);
                }
            }
        }

        Ok(bindings
            .iter()
            .zip(prepared.iter())
            .map(|(binding, prepared)| wgpu::BindGroupEntry {
                binding: binding.binding,
                resource: match prepared {
                    PreparedBinding::Buffer(buffer) => buffer.as_entire_binding(),
                    PreparedBinding::TextureView(index) => {
                        wgpu::BindingResource::TextureView(&texture_views[*index])
                    }
                    PreparedBinding::Sampler => {
                        wgpu::BindingResource::Sampler(&self.source_frame_sampler)
                    }
                },
            })
            .collect())
    }

    fn ensure_native_graph_render_pipeline(
        &mut self,
        pipeline_key: &str,
        render_plan: &NativeComputeGraphRenderPlan,
        layout_specs: &[NativeComputeBindingLayoutSpec],
        output_format: wgpu::TextureFormat,
    ) -> Result<(), String> {
        if self
            .native_graph_render_pipelines
            .contains_key(pipeline_key)
        {
            return Ok(());
        }
        if layout_specs.is_empty() {
            return Err(format!(
                "native graph render pipeline `{}` has no bindings",
                pipeline_key
            ));
        }
        let error_scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Graph Render Shader"),
                source: wgpu::ShaderSource::Wgsl(render_plan.source.clone().into()),
            });
        let layout_entries = layout_specs
            .iter()
            .map(|spec| wgpu::BindGroupLayoutEntry {
                binding: spec.binding,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: spec.kind.binding_type(),
                count: None,
            })
            .collect::<Vec<_>>();
        let bind_group_layout =
            self.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("Ghost Render Core Native Graph Render Layout"),
                    entries: &layout_entries,
                });
        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Graph Render Pipeline Layout"),
                bind_group_layouts: &[Some(&bind_group_layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Native Graph Render Pipeline"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some(&render_plan.vertex_entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState {
                    topology: render_plan.primitive_topology.topology(),
                    ..Default::default()
                },
                depth_stencil: if render_plan.depth_enabled {
                    Some(wgpu::DepthStencilState {
                        format: wgpu::TextureFormat::Depth24Plus,
                        depth_write_enabled: Some(render_plan.depth_write),
                        depth_compare: Some(render_plan.depth_compare.compare_function()),
                        stencil: wgpu::StencilState::default(),
                        bias: wgpu::DepthBiasState::default(),
                    })
                } else {
                    None
                },
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(&render_plan.fragment_entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: output_format,
                        blend: Some(render_plan.blend.blend_state()),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        let error_future = error_scope.pop();
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(err) = pollster::block_on(error_future) {
            return Err(err.to_string());
        }
        self.native_graph_render_pipelines.insert(
            pipeline_key.to_string(),
            NativeGraphRenderPipeline {
                pipeline,
                bind_group_layout,
            },
        );
        Ok(())
    }

    fn create_native_compute_graph_buffer(
        &self,
        spec: &NativeComputeGraphBufferSpec,
    ) -> NativeComputeGraphGpuBuffer {
        let mut usage = spec.kind.buffer_usage();
        if spec.indirect {
            usage |= wgpu::BufferUsages::INDIRECT;
        }
        let buffer = if spec.initial_bytes.is_empty() {
            self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("Ghost Native Compute Graph Buffer {}", spec.id)),
                size: spec.byte_length,
                usage,
                mapped_at_creation: false,
            })
        } else {
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some(&format!("Ghost Native Compute Graph Buffer {}", spec.id)),
                    contents: &spec.initial_bytes,
                    usage,
                })
        };
        NativeComputeGraphGpuBuffer {
            buffer,
            byte_length: spec.byte_length,
            kind: spec.kind,
            indirect: spec.indirect,
        }
    }

    fn upsert_native_compute_graph_buffer(
        &mut self,
        spec: &NativeComputeGraphBufferSpec,
    ) -> Result<(), String> {
        let recreate = spec.clear
            || self
                .native_compute_graph_buffers
                .get(&spec.id)
                .map(|existing| {
                    existing.byte_length != spec.byte_length
                        || existing.kind.signature() != spec.kind.signature()
                        || existing.indirect != spec.indirect
                })
                .unwrap_or(true);
        if recreate {
            let buffer = self.create_native_compute_graph_buffer(spec);
            self.native_compute_graph_buffers
                .insert(spec.id.clone(), buffer);
            return Ok(());
        }
        if !spec.initial_bytes.is_empty() {
            let Some(existing) = self.native_compute_graph_buffers.get(&spec.id) else {
                return Err(format!(
                    "persistent native compute graph buffer `{}` missing after lookup",
                    spec.id
                ));
            };
            self.queue
                .write_buffer(&existing.buffer, 0, &spec.initial_bytes);
        }
        Ok(())
    }

    fn compute_graph_buffer<'a>(
        &'a self,
        transient_buffers: &'a HashMap<String, NativeComputeGraphGpuBuffer>,
        id: &str,
    ) -> Option<&'a NativeComputeGraphGpuBuffer> {
        transient_buffers
            .get(id)
            .or_else(|| self.native_compute_graph_buffers.get(id))
    }

    fn native_compute_graph_buffer_count(&self) -> u32 {
        self.native_compute_graph_buffers
            .len()
            .min(u32::MAX as usize) as u32
    }

    fn clear_native_compute_graph_buffers(
        &mut self,
        clear_all: bool,
        prefixes: &[String],
    ) -> usize {
        if clear_all {
            let count = self.native_compute_graph_buffers.len();
            self.native_compute_graph_buffers.clear();
            return count;
        }
        let prefixes = prefixes
            .iter()
            .map(|prefix| prefix.trim())
            .filter(|prefix| !prefix.is_empty())
            .collect::<Vec<_>>();
        if prefixes.is_empty() {
            return 0;
        }
        let before = self.native_compute_graph_buffers.len();
        self.native_compute_graph_buffers
            .retain(|id, _| !prefixes.iter().any(|prefix| id.starts_with(prefix)));
        before.saturating_sub(self.native_compute_graph_buffers.len())
    }

    fn readback_u32_buffer(
        &self,
        readback_buffer: &wgpu::Buffer,
        byte_length: u64,
    ) -> Result<ComputeProbeResult, String> {
        let slice = readback_buffer.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result.map_err(|err| err.to_string()));
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|err| err.to_string())?;
        rx.recv()
            .map_err(|err| err.to_string())?
            .map_err(|err| err.to_string())?;
        let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
        let mut checksum = 0xcbf29ce484222325u64;
        let mut nonzero_words = 0u32;
        let mut first_words = Vec::new();
        for chunk in mapped.chunks_exact(4) {
            let value = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value != 0 {
                nonzero_words = nonzero_words.saturating_add(1);
            }
            if first_words.len() < COMPUTE_READBACK_PREVIEW_WORDS {
                first_words.push(value);
            }
            checksum ^= value as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        drop(mapped);
        readback_buffer.unmap();
        Ok(ComputeProbeResult {
            byte_length,
            checksum,
            nonzero_words,
            first_words,
        })
    }

    fn render_native_wgsl_shader_frame(
        &mut self,
        slot: usize,
        cache_key: &str,
        source: &str,
        fragment_entry: &str,
        uniforms: &NativeShaderUniforms,
    ) -> Result<(), String> {
        self.ensure_native_shader_pipeline(cache_key, source, fragment_entry)?;
        self.queue.write_buffer(
            &self.native_shader_uniform_buffer,
            0,
            bytemuck::bytes_of(uniforms),
        );
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        let view = self
            .source_frame_texture
            .create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Render Core Native Shader Source Frame View"),
                format: Some(self.source_frame_format),
                dimension: Some(wgpu::TextureViewDimension::D2),
                base_mip_level: 0,
                mip_level_count: Some(1),
                base_array_layer: safe_slot as u32,
                array_layer_count: Some(1),
                ..Default::default()
            });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Native Shader Encoder"),
            });
        let input_slot = uniforms.frame_seed_inputs[3]
            .round()
            .clamp(0.0, (MAX_SOURCE_FRAME_SLOTS - 1) as f32) as u32;
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.source_frame_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: input_slot,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &self.native_shader_input_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: input_slot,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: self.source_frame_size as u32,
                height: self.source_frame_size as u32,
                depth_or_array_layers: 1,
            },
        );
        {
            let Some(pipeline) = self.native_shader_pipelines.get(cache_key) else {
                return Err("native shader pipeline was not cached".to_string());
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Ghost Render Core Native Shader Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&pipeline.pipeline);
            pass.set_bind_group(0, &self.native_shader_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        self.queue.submit(Some(encoder.finish()));
        self.last_frame_error = None;
        Ok(())
    }

    fn write_source_frame(&self, slot: usize, rgba: &[u8]) {
        if rgba.len() < self.source_frame_size * self.source_frame_size * 4 {
            return;
        }
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        let (payload, bytes_per_row) =
            source_frame_upload_payload(rgba, self.source_frame_size, self.source_frame_format);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.source_frame_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: safe_slot as u32,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &payload,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(self.source_frame_size as u32),
            },
            wgpu::Extent3d {
                width: self.source_frame_size as u32,
                height: self.source_frame_size as u32,
                depth_or_array_layers: 1,
            },
        );
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Source Frame Mip Encoder"),
            });
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        self.queue.submit(Some(encoder.finish()));
    }

    fn import_shared_texture_source_frame(
        &self,
        slot: usize,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        #[cfg(target_os = "macos")]
        {
            self.import_iosurface_source_frame(slot, descriptor)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = slot;
            let _ = descriptor;
            Err(format!(
                "shared texture source-frame upload is not implemented yet for backend={}",
                native_backend_name()
            ))
        }
    }

    #[cfg(target_os = "macos")]
    fn import_iosurface_source_frame(
        &self,
        slot: usize,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        use objc2_io_surface::IOSurfaceRef;
        use objc2_metal::{
            MTLDevice, MTLStorageMode, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage,
        };
        use wgpu::hal::{self, api::Metal};

        if descriptor.platform != "iosurface" {
            return Err(format!(
                "shared texture platform `{}` is not supported by the Metal importer",
                descriptor.platform
            ));
        }

        let surface_id = descriptor.iosurface_id()?;
        let surface = IOSurfaceRef::lookup(surface_id)
            .ok_or_else(|| format!("IOSurfaceLookup({surface_id}) returned null"))?;
        let metal_format = metal_texture_format_for_shared_texture(descriptor);
        let wgpu_format = wgpu_texture_format_for_shared_texture(descriptor);
        let width = descriptor.width.max(1);
        let height = descriptor.height.max(1);
        let raw_device = unsafe { self.device.as_hal::<Metal>() }
            .ok_or_else(|| "native renderer is not running on the Metal backend".to_string())?;
        let texture_descriptor = unsafe {
            MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                metal_format,
                width as usize,
                height as usize,
                false,
            )
        };
        texture_descriptor.setTextureType(MTLTextureType::Type2D);
        texture_descriptor.setStorageMode(MTLStorageMode::Shared);
        texture_descriptor.setUsage(MTLTextureUsage::ShaderRead);
        let raw_texture = raw_device
            .raw_device()
            .newTextureWithDescriptor_iosurface_plane(&texture_descriptor, &surface, 0)
            .ok_or_else(|| {
                format!(
                    "Metal failed to create texture from IOSurfaceID={surface_id} format={} size={}x{}",
                    descriptor.format, width, height
                )
            })?;
        let hal_texture = unsafe {
            hal::metal::Device::texture_from_raw(
                raw_texture,
                wgpu_format,
                MTLTextureType::Type2D,
                1,
                1,
                hal::CopyExtent {
                    width,
                    height,
                    depth: 1,
                },
                None,
            )
        };
        let imported_texture = unsafe {
            self.device.create_texture_from_hal::<Metal>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("Ghost Render Core Imported IOSurface Source Frame"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu_format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
                wgpu::TextureUses::RESOURCE,
            )
        };
        let source_view = imported_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Imported IOSurface Source View"),
            format: Some(wgpu_format),
            dimension: Some(wgpu::TextureViewDimension::D2),
            ..Default::default()
        });
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        let target_view = self
            .source_frame_texture
            .create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Render Core Shared Texture Source Frame Target"),
                format: Some(self.source_frame_format),
                dimension: Some(wgpu::TextureViewDimension::D2),
                base_mip_level: 0,
                mip_level_count: Some(1),
                base_array_layer: safe_slot as u32,
                array_layer_count: Some(1),
                ..Default::default()
            });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Shared Texture Source Frame Encoder"),
            });
        self.source_frame_blitter
            .copy(&self.device, &mut encoder, &source_view, &target_view);
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        self.queue.submit(Some(encoder.finish()));
        Ok(self
            .source_frame_size
            .saturating_mul(self.source_frame_size)
            .saturating_mul(texture_format_bytes_per_texel(self.source_frame_format))
            .min(u64::MAX as usize) as u64)
    }

    fn generate_source_frame_mips(&self, encoder: &mut wgpu::CommandEncoder, slot: usize) {
        if self.source_frame_mip_levels <= 1 {
            return;
        }
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        for mip_level in 1..self.source_frame_mip_levels {
            let source_view = self
                .source_frame_texture
                .create_view(&wgpu::TextureViewDescriptor {
                    label: Some("Ghost Render Core Source Frame Mip Source"),
                    format: Some(self.source_frame_format),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_mip_level: mip_level - 1,
                    mip_level_count: Some(1),
                    base_array_layer: safe_slot as u32,
                    array_layer_count: Some(1),
                    ..Default::default()
                });
            let target_view = self
                .source_frame_texture
                .create_view(&wgpu::TextureViewDescriptor {
                    label: Some("Ghost Render Core Source Frame Mip Target"),
                    format: Some(self.source_frame_format),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_mip_level: mip_level,
                    mip_level_count: Some(1),
                    base_array_layer: safe_slot as u32,
                    array_layer_count: Some(1),
                    ..Default::default()
                });
            self.source_frame_blitter
                .copy(&self.device, encoder, &source_view, &target_view);
        }
    }

    fn read_frame_snapshot(&mut self) -> Result<FrameSnapshotReadback, String> {
        let width = self.config.width.max(1);
        let height = self.config.height.max(1);
        let bytes_per_pixel = 4_u32;
        let unpadded_bytes_per_row = width.saturating_mul(bytes_per_pixel);
        let padded_bytes_per_row =
            align_u32(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let padded_size = padded_bytes_per_row as u64 * height as u64;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Snapshot Readback"),
            size: padded_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Snapshot Readback Encoder"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.snapshot_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit(Some(encoder.finish()));

        let slice = buffer.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result.map_err(|err| err.to_string()));
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|err| err.to_string())?;
        rx.recv()
            .map_err(|err| err.to_string())?
            .map_err(|err| err.to_string())?;

        let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
        let mut compact = vec![0_u8; unpadded_bytes_per_row as usize * height as usize];
        for y in 0..height as usize {
            let src_start = y * padded_bytes_per_row as usize;
            let dst_start = y * unpadded_bytes_per_row as usize;
            compact[dst_start..dst_start + unpadded_bytes_per_row as usize]
                .copy_from_slice(&mapped[src_start..src_start + unpadded_bytes_per_row as usize]);
        }
        drop(mapped);
        buffer.unmap();

        let metrics = snapshot_metrics(&compact, self.config.format);
        self.last_frame_metrics = Some(metrics.clone());
        Ok(FrameSnapshotReadback {
            timestamp_ms: epoch_ms(),
            width,
            height,
            format: self.config.format,
            bytes_per_row: unpadded_bytes_per_row,
            padded_bytes_per_row,
            pixels: compact,
            metrics,
        })
    }

    fn frame_snapshot(&mut self, include_pixels: bool) -> Result<Value, String> {
        let readback = self.read_frame_snapshot()?;
        Ok(readback.to_json(include_pixels))
    }

    fn write_frame_inputs(
        &self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
    ) {
        let uniforms = Uniforms {
            resolution: [self.config.width as f32, self.config.height as f32],
            time: time_seconds.unwrap_or_else(|| self.start_time.elapsed().as_secs_f32()),
            command_phase,
            layer_count: layers_seen as f32,
            frame_count: frame_count as f32,
            _pad0: [0.0, 0.0],
            audio0,
            audio1,
            audio2,
        };
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        let mut gpu_layers = vec![LayerGpu::zeroed(); MAX_SCENE_LAYERS];
        for (index, layer) in scene_layers.iter().take(MAX_SCENE_LAYERS).enumerate() {
            gpu_layers[index] = *layer;
        }
        self.queue
            .write_buffer(&self.layer_buffer, 0, bytemuck::cast_slice(&gpu_layers));

        if let Some(source_previews) = source_previews {
            let mut gpu_previews =
                vec![PreviewPixel::zeroed(); MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS];
            for (index, pixel) in source_previews
                .iter()
                .take(MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS)
                .enumerate()
            {
                gpu_previews[index] = *pixel;
            }
            self.queue.write_buffer(
                &self.source_preview_buffer,
                0,
                bytemuck::cast_slice(&gpu_previews),
            );
        }
    }

    fn draw_fullscreen_to_view(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        label: &'static str,
        timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    fn draw_stage3d_overlay_to_view(
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
        self.queue.write_buffer(
            &self.stage3d_overlay_uniform_buffer,
            0,
            bytemuck::bytes_of(&Stage3DOverlayUniforms {
                resolution: [self.config.width as f32, self.config.height as f32],
                item_count: item_count as f32,
                time: time_seconds.unwrap_or_else(|| self.start_time.elapsed().as_secs_f32()),
            }),
        );
        self.queue.write_buffer(
            &self.stage3d_overlay_item_buffer,
            0,
            bytemuck::cast_slice(&overlay_items[..item_count]),
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
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.stage3d_overlay_pipeline);
        pass.set_bind_group(0, &self.stage3d_overlay_bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    fn draw_stage3d_mesh_to_view(
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
        self.queue.write_buffer(
            &self.stage3d_mesh_uniform_buffer,
            0,
            bytemuck::bytes_of(&Stage3DMeshUniforms {
                resolution: [self.config.width as f32, self.config.height as f32],
                item_count: item_count as f32,
                time: time_seconds.unwrap_or_else(|| self.start_time.elapsed().as_secs_f32()),
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
        self.queue.write_buffer(
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
        pass.draw(0..144, 0..item_count as u32);
    }

    fn render_snapshot(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        stage3d_mesh_frame: Option<&Stage3DMeshFrame>,
        stage3d_overlay_items: &[Stage3DOverlayItemGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
    ) -> Result<(), String> {
        self.write_frame_inputs(
            command_phase,
            layers_seen,
            time_seconds,
            frame_count,
            scene_layers,
            source_previews,
            audio0,
            audio1,
            audio2,
        );
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Snapshot Encoder"),
            });
        let should_record_timing = self
            .gpu_timing
            .as_ref()
            .is_some_and(GpuTimingState::can_record);
        let timestamp_writes = if should_record_timing {
            self.gpu_timing
                .as_ref()
                .map(GpuTimingState::timestamp_writes)
        } else {
            None
        };
        self.draw_fullscreen_to_view(
            &mut encoder,
            &self.snapshot_view,
            "Ghost Render Core Snapshot Pass",
            timestamp_writes,
        );
        self.draw_stage3d_mesh_to_view(
            &mut encoder,
            &self.snapshot_view,
            "Ghost Render Core Stage3D Mesh Snapshot Pass",
            time_seconds,
            stage3d_mesh_frame,
        );
        self.draw_stage3d_overlay_to_view(
            &mut encoder,
            &self.snapshot_view,
            "Ghost Render Core Stage3D Snapshot Overlay Pass",
            time_seconds,
            stage3d_overlay_items,
        );
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                gpu_timing.resolve_to_readback(&mut encoder);
            }
        }
        self.queue.submit(Some(encoder.finish()));
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_mut() {
                gpu_timing.begin_readback();
            }
        }
        self.last_frame_error = None;
        Ok(())
    }

    fn render(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        stage3d_mesh_frame: Option<&Stage3DMeshFrame>,
        stage3d_overlay_items: &[Stage3DOverlayItemGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
    ) -> Result<SurfacePresentOutcome, String> {
        self.write_frame_inputs(
            command_phase,
            layers_seen,
            time_seconds,
            frame_count,
            scene_layers,
            source_previews,
            audio0,
            audio1,
            audio2,
        );
        let mut mirror_encoder =
            self.device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Ghost Render Core Output Mirror Encoder"),
                });
        let should_record_timing = self
            .gpu_timing
            .as_ref()
            .is_some_and(GpuTimingState::can_record);
        let mirror_timestamp_writes = if should_record_timing {
            self.gpu_timing
                .as_ref()
                .map(GpuTimingState::timestamp_writes)
        } else {
            None
        };
        self.draw_fullscreen_to_view(
            &mut mirror_encoder,
            &self.output_mirror_view,
            "Ghost Render Core Output Mirror Pass",
            mirror_timestamp_writes,
        );
        self.draw_stage3d_mesh_to_view(
            &mut mirror_encoder,
            &self.output_mirror_view,
            "Ghost Render Core Stage3D Mesh Output Mirror Pass",
            time_seconds,
            stage3d_mesh_frame,
        );
        self.draw_stage3d_overlay_to_view(
            &mut mirror_encoder,
            &self.output_mirror_view,
            "Ghost Render Core Stage3D Output Mirror Overlay Pass",
            time_seconds,
            stage3d_overlay_items,
        );
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                gpu_timing.resolve_to_readback(&mut mirror_encoder);
            }
        }
        #[cfg(target_os = "macos")]
        self.refresh_output_export(&mut mirror_encoder);
        self.queue.submit(Some(mirror_encoder.finish()));
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_mut() {
                gpu_timing.begin_readback();
            }
        }

        let mut present_outcome = SurfacePresentOutcome::Presented;
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => frame,
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                self.surface.configure(&self.device, &self.config);
                present_outcome = SurfacePresentOutcome::SuboptimalPresented;
                frame
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                self.last_frame_error = None;
                return Ok(SurfacePresentOutcome::Outdated);
            }
            wgpu::CurrentSurfaceTexture::Timeout => {
                self.last_frame_error = None;
                return Ok(SurfacePresentOutcome::Timeout);
            }
            wgpu::CurrentSurfaceTexture::Occluded => {
                self.last_frame_error = None;
                return Ok(SurfacePresentOutcome::Occluded);
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                return Err("surface lost".to_string());
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err("surface validation error".to_string());
            }
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Encoder"),
            });
        self.draw_fullscreen_to_view(&mut encoder, &view, "Ghost Render Core Pass", None);
        self.draw_stage3d_mesh_to_view(
            &mut encoder,
            &view,
            "Ghost Render Core Stage3D Mesh Swapchain Pass",
            time_seconds,
            stage3d_mesh_frame,
        );
        self.draw_stage3d_overlay_to_view(
            &mut encoder,
            &view,
            "Ghost Render Core Stage3D Swapchain Overlay Pass",
            time_seconds,
            stage3d_overlay_items,
        );
        self.queue.submit(Some(encoder.finish()));
        self.queue.present(frame);
        self.last_frame_error = None;
        Ok(present_outcome)
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let event_loop = EventLoop::<UserEvent>::with_user_event().build()?;
    let proxy = event_loop.create_proxy();
    let (response_tx, response_rx) = mpsc::channel::<String>();
    spawn_stdout_writer(response_rx);
    spawn_stdin_reader(proxy.clone());

    let mut app = App::new(response_tx, proxy);
    event_loop.run_app(&mut app)?;
    Ok(())
}

fn spawn_stdout_writer(response_rx: Receiver<String>) {
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut lock = stdout.lock();
        while let Ok(line) = response_rx.recv() {
            let _ = writeln!(lock, "{line}");
            let _ = lock.flush();
        }
    });
}

fn spawn_stdin_reader(proxy: winit::event_loop::EventLoopProxy<UserEvent>) {
    thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            let Ok(line) = line else {
                break;
            };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<RpcRequest>(&line) {
                Ok(req) => {
                    let _ = proxy.send_event(UserEvent::Rpc(req));
                }
                Err(err) => {
                    eprintln!("[GhostRenderCore] bad rpc: {err}; line={line}");
                }
            }
        }
    });
}

fn spawn_native_video_frame_decode(
    proxy: EventLoopProxy<UserEvent>,
    job: NativeVideoFrameDecodeJob,
) {
    thread::spawn(move || {
        let result = decode_native_video_frame_window_rgba(
            &job.path,
            job.width,
            job.height,
            job.time_seconds,
            NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS,
            NATIVE_VIDEO_DECODE_PUMP_WINDOW_FRAMES.saturating_add(1),
        );
        let _ = proxy.send_event(UserEvent::NativeVideoFrameDecoded(
            NativeVideoFrameDecodeResult {
                source_id: job.source_id,
                uri: job.uri,
                frame_bucket: job.frame_bucket,
                signature: job.signature,
                seq: job.seq,
                result,
            },
        ));
    });
}

fn scene_payload<'a>(params: &'a Value, scene_key: &str) -> Result<&'a Value, String> {
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

fn scene_payload_bytes(scene: &Value) -> u64 {
    serde_json::to_vec(scene)
        .map(|bytes| bytes.len() as u64)
        .unwrap_or(0)
}

fn scene_bridge_epoch_ms() -> u64 {
    epoch_ms().min(u64::MAX as u128) as u64
}

fn summarize_stage3d_scene(scene: &Value) -> NativeSceneBridgeSummary {
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

fn count_stage3d_nodes(value: Option<&Value>, summary: &mut NativeSceneBridgeSummary) {
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

fn collect_stage3d_overlay_nodes(value: Option<&Value>, items: &mut Vec<Stage3DOverlayItemGpu>) {
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

fn collect_stage3d_user_overlay_items(
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

fn stage3d_overlay_item(
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

fn stage3d_project_position(position: [f32; 3]) -> [f32; 2] {
    [
        (position[0] / 18.0).clamp(-1.35, 1.35),
        ((position[1] - 1.8) / 8.0 - position[2] * 0.018).clamp(-1.35, 1.35),
    ]
}

fn collect_stage3d_mesh_nodes(
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

fn collect_stage3d_user_mesh_items(
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

fn stage3d_param_number(element: &Value, keys: &[&str], fallback: f32) -> f32 {
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

fn stage3d_user_mesh_spec(element: &Value, scalar: f32) -> ([f32; 3], f32, f32) {
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

fn stage3d_mesh_item(
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

fn stage3d_material(
    source_slot: Option<usize>,
    brightness: f32,
    uv_mode: f32,
    opacity: f32,
) -> [f32; 4] {
    [
        source_slot
            .map(|slot| (slot.min(MAX_SOURCE_FRAME_SLOTS - 1) + 1) as f32)
            .unwrap_or(0.0),
        brightness.clamp(0.0, 8.0),
        uv_mode,
        opacity.clamp(0.0, 1.0),
    ]
}

fn stage3d_default_lighting_uniform() -> [f32; 4] {
    [0.0, 1.0, 1.0, 1.0]
}

fn stage3d_default_atmosphere_uniform() -> [f32; 4] {
    [0.0, 0.0, 0.0, 0.0]
}

fn stage3d_scene_lighting_uniform(scene: &Value) -> ([f32; 4], [f32; 4]) {
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

fn stage3d_uv_mode(mode: &str) -> f32 {
    match mode.trim().to_ascii_lowercase().as_str() {
        "mirror" => 1.0,
        "radial" => 2.0,
        "dome" => 3.0,
        "wrap" => 4.0,
        _ => 0.0,
    }
}

fn stage3d_geometry_shape_code(geometry: &str) -> f32 {
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

fn collect_projection_sim_mesh_items(
    scene: &Value,
    items: &mut Vec<Stage3DMeshItemGpu>,
    app: &App,
) {
    let projection_source_slot = projection_sim_source_slot(scene, app);
    if let Some(objects) = scene.get("objects").and_then(Value::as_array) {
        for object in objects {
            if items.len() >= MAX_STAGE3D_MESH_ITEMS {
                return;
            }
            if !bool_at(object, &["visible"]).unwrap_or(true) {
                continue;
            }
            let position = vec3_path_or(object, &["position"], [0.0, 1.0, 0.0]);
            let rotation = vec3_path_or(object, &["rotation"], [0.0, 0.0, 0.0]);
            let scale = vec3_path_or(object, &["scale"], [1.0, 1.0, 1.0]);
            let object_type = string_at(object, &["type"]).unwrap_or_default();
            let primitive = string_at(object, &["primitive"]).unwrap_or_default();
            let color = color_path_or(object, &["color"]).unwrap_or(match object_type.as_str() {
                "model" => [0.72, 0.82, 1.0],
                "pointcloud" => [1.0, 0.62, 0.94],
                _ => [0.86, 0.82, 0.72],
            });
            let projection_alpha = if bool_at(object, &["receiveProjection"]).unwrap_or(true) {
                0.66
            } else {
                0.34
            };
            let receive_projection = bool_at(object, &["receiveProjection"]).unwrap_or(true);
            let material = if receive_projection {
                stage3d_material(projection_source_slot, 1.35, 4.0, projection_alpha)
            } else {
                stage3d_material(None, 1.0, 0.0, projection_alpha)
            };
            items.push(stage3d_mesh_item(
                position,
                projection_sim_mesh_scale(&primitive, scale),
                rotation,
                [color[0], color[1], color[2], projection_alpha],
                projection_sim_shape_code(&object_type, &primitive),
                material,
                [0.0, 0.0, 1.0, 0.0],
            ));
        }
    }

    if let Some(projectors) = scene.get("projectors").and_then(Value::as_array) {
        for projector in projectors {
            if items.len() >= MAX_STAGE3D_MESH_ITEMS {
                return;
            }
            if !bool_at(projector, &["enabled"]).unwrap_or(true) {
                continue;
            }
            let position = vec3_path_or(projector, &["position"], [-4.0, 4.0, 6.0]);
            let color = color_path_or(projector, &["color"]).unwrap_or([1.0, 1.0, 1.0]);
            let intensity = number_at(projector, &["intensity"])
                .unwrap_or(1.0)
                .clamp(0.1, 4.0) as f32;
            let size = (0.24 + intensity * 0.07).clamp(0.26, 0.62);
            items.push(stage3d_mesh_item(
                position,
                [size, size, size],
                [0.0, 0.0, 0.0],
                [color[0], color[1], color[2], 0.58],
                2.0,
                stage3d_material(None, 1.0, 0.0, 1.0),
                [0.0, 0.0, 1.0, 0.0],
            ));
        }
    }
}

fn projection_sim_source_slot(scene: &Value, app: &App) -> Option<usize> {
    let projectors = scene.get("projectors").and_then(Value::as_array)?;
    for projector in projectors {
        if !bool_at(projector, &["enabled"]).unwrap_or(true) {
            continue;
        }
        let source = string_at(projector, &["source"]).unwrap_or_else(|| "master".to_string());
        if source == "slice" {
            if let Some(slice_id) = string_at(projector, &["sliceId"]) {
                if let Some(slot) = app.stage3d_source_slot_for_text(&slice_id) {
                    return Some(slot);
                }
            }
        }
        if let Some(slot) = app.first_visible_source_frame_slot() {
            return Some(slot);
        }
    }
    None
}

fn projection_sim_shape_code(object_type: &str, primitive: &str) -> f32 {
    if object_type == "pointcloud" {
        return 2.0;
    }
    if object_type == "model" {
        return 1.0;
    }
    stage3d_geometry_shape_code(primitive)
}

fn projection_sim_mesh_scale(primitive: &str, scale: [f32; 3]) -> [f32; 3] {
    let safe = [
        scale[0].abs().max(0.08),
        scale[1].abs().max(0.08),
        scale[2].abs().max(0.08),
    ];
    match primitive.trim().to_ascii_lowercase().as_str() {
        "plane" | "panel" | "quad" => [safe[0], safe[1], 0.04],
        "sphere" | "ball" => {
            let diameter = safe[0].max(safe[1]).max(safe[2]);
            [diameter, diameter, diameter]
        }
        "cylinder" | "column" | "cone" | "pyramid" => [safe[0], safe[1], safe[0].max(safe[2])],
        _ => safe,
    }
}

fn collect_projection_sim_overlay_items(scene: &Value, items: &mut Vec<Stage3DOverlayItemGpu>) {
    if let Some(objects) = scene.get("objects").and_then(Value::as_array) {
        for object in objects {
            if items.len() >= MAX_STAGE3D_OVERLAY_ITEMS {
                return;
            }
            if !bool_at(object, &["visible"]).unwrap_or(true) {
                continue;
            }
            let position = vec3_path_or(object, &["position"], [0.0, 1.0, 0.0]);
            let rotation = vec3_path_or(object, &["rotation"], [0.0, 0.0, 0.0]);
            let scale = vec3_path_or(object, &["scale"], [1.0, 1.0, 1.0]);
            let object_type = string_at(object, &["type"]).unwrap_or_default();
            let primitive = string_at(object, &["primitive"]).unwrap_or_default();
            let color = color_path_or(object, &["color"]).unwrap_or(match object_type.as_str() {
                "model" => [0.72, 0.82, 1.0],
                "pointcloud" => [1.0, 0.62, 0.94],
                _ => [0.86, 0.82, 0.72],
            });
            let round = matches!(
                primitive.as_str(),
                "sphere" | "cylinder" | "cone" | "pyramid" | "column"
            ) || object_type == "pointcloud";
            let alpha = if bool_at(object, &["receiveProjection"]).unwrap_or(true) {
                0.38
            } else {
                0.22
            };
            items.push(stage3d_overlay_item(
                position,
                scale[0].abs().max(0.2),
                scale[1].abs().max(scale[2].abs()).max(0.2),
                [color[0], color[1], color[2], alpha],
                if round { 1.0 } else { 0.0 },
                rotation[2],
                1.0,
            ));
        }
    }

    if let Some(projectors) = scene.get("projectors").and_then(Value::as_array) {
        for projector in projectors {
            if items.len() >= MAX_STAGE3D_OVERLAY_ITEMS {
                return;
            }
            if !bool_at(projector, &["enabled"]).unwrap_or(true) {
                continue;
            }
            let position = vec3_path_or(projector, &["position"], [-4.0, 4.0, 6.0]);
            let target = vec3_path_or(projector, &["target"], [0.0, 2.0, 0.0]);
            let color = color_path_or(projector, &["color"]).unwrap_or([1.0, 1.0, 1.0]);
            let intensity = number_at(projector, &["intensity"])
                .unwrap_or(1.0)
                .clamp(0.1, 4.0) as f32;
            let opacity = number_at(projector, &["opacity"])
                .unwrap_or(1.0)
                .clamp(0.0, 1.0) as f32;
            items.push(stage3d_overlay_item(
                position,
                0.72,
                0.72,
                [color[0], color[1], color[2], 0.44 * opacity],
                1.0,
                0.0,
                intensity,
            ));
            if items.len() >= MAX_STAGE3D_OVERLAY_ITEMS {
                return;
            }
            let beam_center = [
                (position[0] + target[0]) * 0.5,
                (position[1] + target[1]) * 0.5,
                (position[2] + target[2]) * 0.5,
            ];
            let dx = target[0] - position[0];
            let dy = target[1] - position[1];
            let beam_len = (dx * dx + dy * dy).sqrt().max(1.0);
            items.push(stage3d_overlay_item(
                beam_center,
                beam_len,
                0.18,
                [color[0], color[1], color[2], 0.18 * opacity],
                0.0,
                dy.atan2(dx),
                intensity,
            ));
        }
    }
}

fn summarize_projection_sim_scene(scene: &Value) -> NativeSceneBridgeSummary {
    let mut summary = NativeSceneBridgeSummary::empty("projection-sim");
    summary.scene_id = string_at(scene, &["id"]).unwrap_or_default();
    summary.scene_name = string_at(scene, &["name"]).unwrap_or_default();
    summary.source_schema_version = number_at(scene, &["schemaVersion"])
        .unwrap_or(0.0)
        .round()
        .clamp(0.0, u32::MAX as f64) as u32;
    summary.payload_bytes = scene_payload_bytes(scene);
    summary.updated_at_ms = scene_bridge_epoch_ms();

    if let Some(projectors) = scene.get("projectors").and_then(Value::as_array) {
        summary.projector_count = projectors.len().min(u32::MAX as usize) as u32;
    }
    if let Some(objects) = scene.get("objects").and_then(Value::as_array) {
        summary.object_count = objects.len().min(u32::MAX as usize) as u32;
        for object in objects {
            match object
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "primitive" => summary.primitive_count = summary.primitive_count.saturating_add(1),
                "model" => summary.model_count = summary.model_count.saturating_add(1),
                "pointcloud" => {
                    summary.point_cloud_count = summary.point_cloud_count.saturating_add(1)
                }
                _ => {}
            }
        }
    }
    summary
}

fn number_at(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_f64()
}

fn bool_at(value: &Value, path: &[&str]) -> Option<bool> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_bool()
}

fn vec3_path_or(value: &Value, path: &[&str], fallback: [f32; 3]) -> [f32; 3] {
    let mut current = value;
    for key in path {
        let Some(next) = current.get(*key) else {
            return fallback;
        };
        current = next;
    }
    let Some(values) = current.as_array() else {
        return fallback;
    };
    let mut out = fallback;
    for (index, slot) in out.iter_mut().enumerate() {
        if let Some(value) = values.get(index).and_then(Value::as_f64) {
            *slot = value.clamp(-1.0e6, 1.0e6) as f32;
        }
    }
    out
}

fn color_path_or(value: &Value, path: &[&str]) -> Option<[f32; 3]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    if let Some(text) = current.as_str() {
        return parse_hex_color(text);
    }
    let values = current.as_array()?;
    Some([
        json_channel_to_unit(values.first()?),
        json_channel_to_unit(values.get(1)?),
        json_channel_to_unit(values.get(2)?),
    ])
}

fn parse_hex_color(text: &str) -> Option<[f32; 3]> {
    let hex = text.trim().trim_start_matches('#');
    if hex.len() == 3 {
        let mut out = [0.0_f32; 3];
        for (index, ch) in hex.chars().enumerate() {
            let value = ch.to_digit(16)? as f32 / 15.0;
            out[index] = value;
        }
        return Some(out);
    }
    if hex.len() == 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).ok()? as f32 / 255.0;
        let g = u8::from_str_radix(&hex[2..4], 16).ok()? as f32 / 255.0;
        let b = u8::from_str_radix(&hex[4..6], 16).ok()? as f32 / 255.0;
        return Some([r, g, b]);
    }
    None
}

fn vec4_at(value: &Value, key: &str) -> [f32; 4] {
    let Some(values) = value.get(key).and_then(Value::as_array) else {
        return [0.0; 4];
    };
    let mut out = [0.0; 4];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = values
            .get(index)
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .clamp(-1.0e9, 1.0e9) as f32;
    }
    out
}

fn vec4_path_at(value: &Value, path: &[&str]) -> Option<[f32; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 4 {
        return None;
    }
    let mut out = [0.0_f32; 4];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = values
            .get(index)
            .and_then(Value::as_f64)?
            .clamp(-1.0e9, 1.0e9) as f32;
    }
    Some(out)
}

fn json_object_len(value: &Value) -> usize {
    value.as_object().map(|object| object.len()).unwrap_or(0)
}

fn audio_value_at(value: &Value, key: &str) -> f32 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .clamp(0.0, 1.0) as f32
}

fn command_has_key(value: &Value, key: &str) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.contains_key(key))
}

fn audio_value_at_any(value: &Value, canonical_key: &str, legacy_key: &str) -> f32 {
    if command_has_key(value, canonical_key) {
        audio_value_at(value, canonical_key)
    } else {
        audio_value_at(value, legacy_key)
    }
}

fn number_at_any(value: &Value, canonical_key: &str, legacy_key: &str) -> Option<f64> {
    if command_has_key(value, canonical_key) {
        number_at(value, &[canonical_key])
    } else {
        number_at(value, &[legacy_key])
    }
}

fn unit_from_hash(hash: u64) -> f32 {
    ((hash & 0x00ff_ffff) as f32 / 0x00ff_ffff as f32).clamp(0.0, 1.0)
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToString::to_string)
}

fn string_array_at(value: &Value, path: &[&str]) -> Option<Vec<String>> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(
        current
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
    )
}

fn compute_binding_kind_from_value(value: &Value) -> Option<NativeComputeBufferBindingKind> {
    string_at(value, &["kind"])
        .or_else(|| string_at(value, &["type"]))
        .or_else(|| string_at(value, &["buffer_type"]))
        .and_then(|kind| compute_binding_kind_from_str(&kind))
}

fn compute_graph_binding_resource_id(value: &Value) -> Option<String> {
    string_at(value, &["resource"])
        .or_else(|| string_at(value, &["resource_id"]))
        .or_else(|| string_at(value, &["buffer"]))
}

fn compute_graph_binding_kind_from_value(value: &Value) -> Option<NativeComputeGraphBindingKind> {
    for label in [
        string_at(value, &["resource_kind"]),
        string_at(value, &["resource_type"]),
        string_at(value, &["binding_kind"]),
        string_at(value, &["kind"]),
        string_at(value, &["type"]),
        compute_graph_binding_resource_id(value),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(kind) = compute_graph_binding_kind_from_str(&label) {
            return Some(kind);
        }
    }
    None
}

fn compute_graph_binding_kind_from_str(kind: &str) -> Option<NativeComputeGraphBindingKind> {
    let kind = kind
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .replace(' ', "-");
    match kind.as_str() {
        "source-frame-texture"
        | "source-frame-texture-2d"
        | "source-texture"
        | "source-texture-2d"
        | "texture-2d" => Some(NativeComputeGraphBindingKind::SourceFrameTexture(
            NativeComputeGraphTextureDimension::D2,
        )),
        "source-frame-texture-array"
        | "source-frame-texture-2d-array"
        | "source-texture-array"
        | "source-texture-2d-array"
        | "texture-2d-array" => Some(NativeComputeGraphBindingKind::SourceFrameTexture(
            NativeComputeGraphTextureDimension::D2Array,
        )),
        "source-frame-sampler" | "source-sampler" => {
            Some(NativeComputeGraphBindingKind::SourceFrameSampler)
        }
        _ => compute_binding_kind_from_str(&kind).map(NativeComputeGraphBindingKind::Buffer),
    }
}

fn compute_binding_kind_from_str(kind: &str) -> Option<NativeComputeBufferBindingKind> {
    let kind = kind.trim().to_ascii_lowercase();
    match kind.as_str() {
        "uniform" | "uniform-buffer" | "uniform_buffer" => {
            Some(NativeComputeBufferBindingKind::Uniform)
        }
        "read" | "readonly" | "read-only" | "read_only" | "read-only-storage"
        | "read_only_storage" | "storage-read" | "storage_read" => {
            Some(NativeComputeBufferBindingKind::StorageRead)
        }
        "storage" | "readwrite" | "read-write" | "read_write" | "read_write_storage"
        | "read-write-storage" | "storage-rw" | "storage_rw" => {
            Some(NativeComputeBufferBindingKind::StorageReadWrite)
        }
        _ => None,
    }
}

fn parse_compute_graph_buffer(value: &Value) -> Result<NativeComputeGraphBufferSpec, String> {
    let Some(id) = string_at(value, &["id"])
        .or_else(|| string_at(value, &["name"]))
        .or_else(|| string_at(value, &["resource"]))
    else {
        return Err("compute_graph buffer missing id".to_string());
    };
    let kind = compute_binding_kind_from_value(value)
        .unwrap_or(NativeComputeBufferBindingKind::StorageReadWrite);
    let mut initial_bytes = compute_initial_bytes(value)?;
    let declared_size = number_at(value, &["byte_length"])
        .or_else(|| number_at(value, &["size"]))
        .or_else(|| number_at(value, &["bytes"]))
        .unwrap_or(initial_bytes.len().max(4) as f64)
        .round()
        .clamp(4.0, 512.0 * 1024.0 * 1024.0) as u64;
    let alignment = if matches!(kind, NativeComputeBufferBindingKind::Uniform) {
        16
    } else {
        4
    };
    let byte_length = align_u64(
        declared_size.max(initial_bytes.len() as u64).max(4),
        alignment,
    );
    if !initial_bytes.is_empty() {
        initial_bytes.resize(byte_length as usize, 0);
    }
    let persistent = bool_at(value, &["persistent"])
        .or_else(|| bool_at(value, &["persist"]))
        .or_else(|| bool_at(value, &["reuse"]))
        .unwrap_or(false);
    let clear = bool_at(value, &["clear"])
        .or_else(|| bool_at(value, &["reset"]))
        .unwrap_or(false);
    let indirect = bool_at(value, &["indirect"])
        .or_else(|| bool_at(value, &["draw_indirect"]))
        .or_else(|| bool_at(value, &["drawIndirect"]))
        .unwrap_or(false);
    Ok(NativeComputeGraphBufferSpec {
        id,
        byte_length,
        kind,
        initial_bytes,
        persistent,
        clear,
        indirect,
    })
}

fn compute_initial_bytes(value: &Value) -> Result<Vec<u8>, String> {
    if let Some(file_path) = string_at(value, &["initial_file"])
        .or_else(|| string_at(value, &["data_file"]))
        .or_else(|| string_at(value, &["bytes_file"]))
    {
        let bytes = fs::read(&file_path).map_err(|err| err.to_string())?;
        if bool_at(value, &["initial_file_delete"])
            .or_else(|| bool_at(value, &["data_file_delete"]))
            .or_else(|| bool_at(value, &["bytes_file_delete"]))
            .unwrap_or(false)
        {
            let _ = fs::remove_file(file_path);
        }
        let declared_len = number_at(value, &["initial_byte_length"])
            .or_else(|| number_at(value, &["data_byte_length"]))
            .or_else(|| number_at(value, &["bytes_byte_length"]))
            .unwrap_or(bytes.len() as f64)
            .round()
            .max(0.0) as usize;
        if bytes.len() < declared_len {
            return Err(format!(
                "compute_graph initial file payload is shorter than declared length: {} < {}",
                bytes.len(),
                declared_len
            ));
        }
        return Ok(bytes);
    }
    if let Some(encoded) = string_at(value, &["initial_b64"])
        .or_else(|| string_at(value, &["data_b64"]))
        .or_else(|| string_at(value, &["bytes_b64"]))
    {
        return base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|err| err.to_string());
    }
    if let Some(values) = value
        .get("initial_u32")
        .or_else(|| value.get("u32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value
                .as_f64()
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, u32::MAX as f64) as u32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    if let Some(values) = value
        .get("initial_i32")
        .or_else(|| value.get("i32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value
                .as_f64()
                .unwrap_or(0.0)
                .round()
                .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    if let Some(values) = value
        .get("initial_f32")
        .or_else(|| value.get("f32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value.as_f64().unwrap_or(0.0).clamp(-1.0e20, 1.0e20) as f32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    Ok(Vec::new())
}

fn dispatch_from_value(value: &Value) -> [u32; 3] {
    if let Some(values) = value.get("dispatch").and_then(Value::as_array) {
        return [
            values
                .first()
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
            values
                .get(1)
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
            values
                .get(2)
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
        ];
    }
    [
        number_at(value, &["dispatch_x"])
            .or_else(|| number_at(value, &["x"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
        number_at(value, &["dispatch_y"])
            .or_else(|| number_at(value, &["y"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
        number_at(value, &["dispatch_z"])
            .or_else(|| number_at(value, &["z"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
    ]
}

fn compute_graph_readbacks(
    params: &Value,
    buffers: &[NativeComputeGraphBufferSpec],
) -> Vec<String> {
    if let Some(values) = params.get("readbacks").and_then(Value::as_array) {
        let mut out = Vec::new();
        for value in values {
            if let Some(id) = value.as_str() {
                out.push(id.to_string());
            } else if let Some(id) =
                string_at(value, &["id"]).or_else(|| string_at(value, &["buffer"]))
            {
                out.push(id);
            }
        }
        return out;
    }
    buffers
        .iter()
        .filter(|buffer| !matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform))
        .last()
        .map(|buffer| vec![buffer.id.clone()])
        .unwrap_or_default()
}

fn rgba_at(value: &Value, path: &[&str]) -> Option<[f32; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 4 {
        return None;
    }
    Some([
        values[0].as_f64()?.clamp(0.0, 1.0) as f32,
        values[1].as_f64()?.clamp(0.0, 1.0) as f32,
        values[2].as_f64()?.clamp(0.0, 1.0) as f32,
        values[3].as_f64()?.clamp(0.0, 1.0) as f32,
    ])
}

fn params8_at(value: &Value, path: &[&str]) -> Option<[f32; 8]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 8 {
        return None;
    }
    let mut out = [0.0_f32; 8];
    for index in 0..8 {
        out[index] = values[index].as_f64()?.clamp(-16.0, 16.0) as f32;
    }
    Some(out)
}

fn corners_at(value: &Value, path: &[&str]) -> Option<[[f32; 2]; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some([
        point_at(current, "topLeft")?,
        point_at(current, "topRight")?,
        point_at(current, "bottomRight")?,
        point_at(current, "bottomLeft")?,
    ])
}

fn point_at(value: &Value, key: &str) -> Option<[f32; 2]> {
    let point = value.get(key)?;
    Some([
        point.get("x")?.as_f64()?.clamp(-8.0, 8.0) as f32,
        point.get("y")?.as_f64()?.clamp(-8.0, 8.0) as f32,
    ])
}

fn default_native_params() -> [f32; 8] {
    [1.0, 1.0, 0.5, 0.125, 0.0, 0.5, 0.25, 1.0]
}

fn blend_mode_code(mode: &str) -> f32 {
    match mode.trim().to_ascii_lowercase().as_str() {
        "add" | "plus" | "linear-dodge" | "linear_dodge" => 1.0,
        "multiply" => 2.0,
        "screen" => 3.0,
        "overlay" => 4.0,
        "subtract" | "minus" => 5.0,
        "difference" => 6.0,
        "lighten" => 7.0,
        "darken" => 8.0,
        "average" | "avg" => 9.0,
        "hardlight" | "hard-light" | "hard_light" => 10.0,
        "softlight" | "soft-light" | "soft_light" => 11.0,
        "exclusion" => 12.0,
        "color-dodge" | "color_dodge" | "colordodge" | "dodge" => 13.0,
        "color-burn" | "color_burn" | "colorburn" | "burn" => 14.0,
        "hue" => 15.0,
        "saturation" => 16.0,
        "color" => 17.0,
        "luminosity" | "luma" => 18.0,
        "divide" => 19.0,
        "negation" => 20.0,
        "phoenix" => 21.0,
        "linear-light" | "linear_light" | "linearlight" => 22.0,
        "hard-mix" | "hard_mix" | "hardmix" => 23.0,
        "vivid-light" | "vivid_light" | "vividlight" => 24.0,
        "pin-light" | "pin_light" | "pinlight" => 25.0,
        _ => 0.0,
    }
}

fn effect_descriptor_code(descriptor: &str) -> Option<[f32; 4]> {
    let descriptor = descriptor.trim().to_ascii_lowercase();
    if descriptor.is_empty() {
        return None;
    }
    let mut parts = descriptor.split(':');
    let name = parts.next().unwrap_or_default();
    let amount = parts
        .next()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(1.0);
    match name {
        "invert" => Some([1.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        "grayscale" | "greyscale" => Some([2.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        "brightness" => Some([3.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "contrast" => Some([4.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "gamma" => Some([5.0, amount.clamp(0.05, 8.0), 0.0, 0.0]),
        "saturation" => Some([6.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "hue" => Some([7.0, amount.clamp(-4.0, 4.0), 0.0, 0.0]),
        "posterize" => Some([8.0, amount.clamp(2.0, 64.0), 0.0, 0.0]),
        "noise" => Some([9.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        _ => None,
    }
}

fn native_compositor_blend_manifest() -> Value {
    json!([
        {"id": "normal", "code": 0},
        {"id": "add", "code": 1},
        {"id": "multiply", "code": 2},
        {"id": "screen", "code": 3},
        {"id": "overlay", "code": 4},
        {"id": "subtract", "code": 5},
        {"id": "difference", "code": 6},
        {"id": "lighten", "code": 7},
        {"id": "darken", "code": 8},
        {"id": "average", "code": 9},
        {"id": "hardlight", "code": 10},
        {"id": "softlight", "code": 11},
        {"id": "exclusion", "code": 12},
        {"id": "color-dodge", "code": 13},
        {"id": "color-burn", "code": 14},
        {"id": "hue", "code": 15},
        {"id": "saturation", "code": 16},
        {"id": "color", "code": 17},
        {"id": "luminosity", "code": 18},
        {"id": "divide", "code": 19},
        {"id": "negation", "code": 20},
        {"id": "phoenix", "code": 21},
        {"id": "linear-light", "code": 22},
        {"id": "hard-mix", "code": 23},
        {"id": "vivid-light", "code": 24},
        {"id": "pin-light", "code": 25}
    ])
}

fn native_compositor_effect_manifest() -> Value {
    json!([
        {"id": "invert", "code": 1, "amount_min": 0.0, "amount_max": 1.0},
        {"id": "grayscale", "aliases": ["greyscale"], "code": 2, "amount_min": 0.0, "amount_max": 1.0},
        {"id": "brightness", "code": 3, "amount_min": 0.0, "amount_max": 8.0},
        {"id": "contrast", "code": 4, "amount_min": 0.0, "amount_max": 8.0},
        {"id": "gamma", "code": 5, "amount_min": 0.05, "amount_max": 8.0},
        {"id": "saturation", "code": 6, "amount_min": 0.0, "amount_max": 8.0},
        {"id": "hue", "code": 7, "amount_min": -4.0, "amount_max": 4.0},
        {"id": "posterize", "code": 8, "amount_min": 2.0, "amount_max": 64.0},
        {"id": "noise", "code": 9, "amount_min": 0.0, "amount_max": 1.0}
    ])
}

fn stable_layer_color(id: &str, alpha: f32) -> [f32; 4] {
    let mut hash = 2166136261_u32;
    for byte in id.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    let hue = (hash % 360) as f32 / 360.0;
    let r = 0.5 + 0.5 * ((hue + 0.00) * std::f32::consts::TAU).cos();
    let g = 0.5 + 0.5 * ((hue + 0.33) * std::f32::consts::TAU).cos();
    let b = 0.5 + 0.5 * ((hue + 0.67) * std::f32::consts::TAU).cos();
    [r.max(0.18), g.max(0.18), b.max(0.18), alpha.clamp(0.0, 1.0)]
}

fn choose_source_frame_format(adapter: &wgpu::Adapter) -> wgpu::TextureFormat {
    let features = adapter.get_texture_format_features(SOURCE_FRAME_FORMAT_HDR);
    let required_usages = wgpu::TextureUsages::TEXTURE_BINDING
        | wgpu::TextureUsages::COPY_DST
        | wgpu::TextureUsages::RENDER_ATTACHMENT;
    if features.allowed_usages.contains(required_usages)
        && features
            .flags
            .contains(wgpu::TextureFormatFeatureFlags::FILTERABLE)
    {
        SOURCE_FRAME_FORMAT_HDR
    } else {
        SOURCE_FRAME_FORMAT_FALLBACK
    }
}

fn choose_source_frame_size(
    limits: &wgpu::Limits,
    features: wgpu::Features,
    format: wgpu::TextureFormat,
) -> usize {
    let tier = native_quality_tier(limits, features);
    let target = match normalize_native_tier(tier) {
        "insane" => SOURCE_FRAME_SIZE_INSANE,
        "ultra" => SOURCE_FRAME_SIZE_DEFAULT,
        "balanced" => SOURCE_FRAME_SIZE_BALANCED,
        "performance" => SOURCE_FRAME_SIZE_PERFORMANCE,
        _ => SOURCE_FRAME_SIZE_DEFAULT,
    };
    let max_dimension = limits.max_texture_dimension_2d as usize;
    let budget_bytes = source_frame_size_budget_bytes(tier);
    let bytes_per_texel = if format == SOURCE_FRAME_FORMAT_HDR {
        8usize
    } else {
        4usize
    };
    [
        SOURCE_FRAME_SIZE_INSANE,
        SOURCE_FRAME_SIZE_DEFAULT,
        SOURCE_FRAME_SIZE_BALANCED,
        SOURCE_FRAME_SIZE_PERFORMANCE,
    ]
    .into_iter()
    .filter(|size| *size <= target)
    .filter(|size| *size <= max_dimension)
    .find(|size| estimate_source_frame_texture_bytes(*size, bytes_per_texel) <= budget_bytes)
    .unwrap_or(SOURCE_FRAME_SIZE_PERFORMANCE.min(max_dimension.max(1)))
}

fn source_frame_mip_levels(size: usize) -> u32 {
    let mut levels = 1u32;
    let mut dimension = size.max(1) as u32;
    while dimension > 1 && levels < SOURCE_FRAME_MIP_LEVELS_MAX {
        dimension = (dimension / 2).max(1);
        levels += 1;
    }
    levels
}

fn source_frame_size_budget_bytes(tier: &str) -> usize {
    let mb = match normalize_native_tier(tier) {
        "insane" => 896usize,
        "ultra" => 384usize,
        "balanced" => 256usize,
        "performance" => 128usize,
        _ => 256usize,
    };
    mb * 1024 * 1024
}

fn estimate_source_frame_texture_bytes(size: usize, bytes_per_texel: usize) -> usize {
    size.saturating_mul(size)
        .saturating_mul(bytes_per_texel)
        .saturating_mul(MAX_SOURCE_FRAME_SLOTS)
}

fn texture_format_label(format: wgpu::TextureFormat) -> &'static str {
    match format {
        wgpu::TextureFormat::Rgba16Float => "rgba16float",
        wgpu::TextureFormat::Rgba8Unorm => "rgba8unorm",
        wgpu::TextureFormat::Rgba8UnormSrgb => "rgba8unorm-srgb",
        wgpu::TextureFormat::Bgra8Unorm => "bgra8unorm",
        wgpu::TextureFormat::Bgra8UnormSrgb => "bgra8unorm-srgb",
        _ => "unknown",
    }
}

fn texture_format_bytes_per_texel(format: wgpu::TextureFormat) -> usize {
    match format {
        wgpu::TextureFormat::Rgba16Float => 8,
        wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm => 4,
        _ => 4,
    }
}

fn native_output_export_format(output_format: wgpu::TextureFormat) -> wgpu::TextureFormat {
    if output_format.is_srgb() {
        wgpu::TextureFormat::Bgra8UnormSrgb
    } else {
        wgpu::TextureFormat::Bgra8Unorm
    }
}

fn wgpu_texture_format_for_shared_texture(
    descriptor: &SharedTextureSourceFrameDescriptor,
) -> wgpu::TextureFormat {
    match normalized_shared_texture_format(descriptor).as_str() {
        "rgba8unorm" | "70" => wgpu::TextureFormat::Rgba8Unorm,
        "bgra8unorm" | "80" | "87" => wgpu::TextureFormat::Bgra8Unorm,
        _ => wgpu::TextureFormat::Bgra8Unorm,
    }
}

#[cfg(target_os = "macos")]
fn metal_texture_format_for_wgpu_output(
    format: wgpu::TextureFormat,
) -> objc2_metal::MTLPixelFormat {
    match format {
        wgpu::TextureFormat::Bgra8UnormSrgb | wgpu::TextureFormat::Rgba8UnormSrgb => {
            objc2_metal::MTLPixelFormat::BGRA8Unorm_sRGB
        }
        _ => objc2_metal::MTLPixelFormat::BGRA8Unorm,
    }
}

#[cfg(target_os = "macos")]
fn metal_texture_format_for_shared_texture(
    descriptor: &SharedTextureSourceFrameDescriptor,
) -> objc2_metal::MTLPixelFormat {
    match normalized_shared_texture_format(descriptor).as_str() {
        "rgba8unorm" | "70" => objc2_metal::MTLPixelFormat::RGBA8Unorm,
        "bgra8unorm" | "80" | "87" => objc2_metal::MTLPixelFormat::BGRA8Unorm,
        _ => objc2_metal::MTLPixelFormat::BGRA8Unorm,
    }
}

fn normalized_shared_texture_format(descriptor: &SharedTextureSourceFrameDescriptor) -> String {
    descriptor
        .format
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_'], "")
}

fn source_frame_upload_payload<'a>(
    rgba: &'a [u8],
    frame_size: usize,
    format: wgpu::TextureFormat,
) -> (Cow<'a, [u8]>, u32) {
    if format != SOURCE_FRAME_FORMAT_HDR {
        return (Cow::Borrowed(rgba), (frame_size * 4) as u32);
    }

    let channel_count = frame_size * frame_size * 4;
    let mut payload = Vec::with_capacity(channel_count * 2);
    for channel in rgba.iter().take(channel_count) {
        payload.extend_from_slice(&unorm8_to_f16_bits(*channel).to_le_bytes());
    }
    (Cow::Owned(payload), (frame_size * 8) as u32)
}

fn unorm8_to_f16_bits(channel: u8) -> u16 {
    if channel == 0 {
        return 0;
    }
    f32_to_f16_bits(channel as f32 / 255.0)
}

fn f32_to_f16_bits(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    let mantissa = bits & 0x7f_ffff;

    if exponent <= 0 {
        if exponent < -10 {
            return sign;
        }
        let normalized = mantissa | 0x80_0000;
        let shift = (14 - exponent) as u32;
        let mut half = (normalized >> shift) as u16;
        if ((normalized >> (shift - 1)) & 1) != 0 {
            half = half.saturating_add(1);
        }
        sign | half
    } else if exponent >= 31 {
        sign | 0x7c00
    } else {
        let mut half = sign | ((exponent as u16) << 10) | ((mantissa >> 13) as u16);
        if (mantissa & 0x1000) != 0 {
            half = half.saturating_add(1);
        }
        half
    }
}

fn decode_native_image_rgba(path: &Path) -> Result<(usize, usize, Vec<u8>), String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native image decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native image decode rejected non-file path `{}`",
            path.display()
        ));
    }
    if metadata.len() > MAX_NATIVE_IMAGE_DECODE_BYTES {
        return Err(format!(
            "native image decode rejected `{}`: file is {} MB, cap is {} MB",
            path.display(),
            metadata.len() / (1024 * 1024),
            MAX_NATIVE_IMAGE_DECODE_BYTES / (1024 * 1024)
        ));
    }
    let (width, height) = image::image_dimensions(path).map_err(|err| {
        format!(
            "native image decode could not read dimensions for `{}`: {err}",
            path.display()
        )
    })?;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if width == 0 || height == 0 || pixels > MAX_NATIVE_IMAGE_DECODE_PIXELS {
        return Err(format!(
            "native image decode rejected `{}`: dimensions {}x{} exceed {} pixels",
            path.display(),
            width,
            height,
            MAX_NATIVE_IMAGE_DECODE_PIXELS
        ));
    }
    let image = image::ImageReader::open(path)
        .map_err(|err| {
            format!(
                "native image decode failed to open `{}`: {err}",
                path.display()
            )
        })?
        .with_guessed_format()
        .map_err(|err| {
            format!(
                "native image decode failed to sniff `{}`: {err}",
                path.display()
            )
        })?
        .decode()
        .map_err(|err| format!("native image decode failed for `{}`: {err}", path.display()))?
        .to_rgba8();
    Ok((
        image.width() as usize,
        image.height() as usize,
        image.into_raw(),
    ))
}

fn decode_native_video_frame_rgba(
    path: &Path,
    width: usize,
    height: usize,
    time_seconds: f64,
) -> Result<(usize, usize, Vec<u8>), String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let target_width = width.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let target_height = height.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let expected_bytes = target_width.saturating_mul(target_height).saturating_mul(4);
    let ffmpeg = std::env::var("GA_FFMPEG_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "ffmpeg.exe".to_string()
            } else {
                "ffmpeg".to_string()
            }
        });
    let scale =
        format!("scale={target_width}:{target_height}:force_original_aspect_ratio=decrease");
    let pad = format!("pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black");
    let output = Command::new(&ffmpeg)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-ss")
        .arg(format!("{:.3}", time_seconds.clamp(0.0, 3600.0)))
        .arg("-i")
        .arg(path)
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg(format!("{scale},{pad},format=rgba"))
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("rgba")
        .arg("pipe:1")
        .output()
        .map_err(|err| {
            format!(
                "native video frame decode failed to launch `{ffmpeg}` for `{}`: {err}",
                path.display()
            )
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame decode ffmpeg failed for `{}`: {}",
            path.display(),
            if detail.is_empty() {
                output.status.to_string()
            } else {
                detail
            }
        ));
    }
    if output.stdout.len() < expected_bytes {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame decode produced {}/{} bytes for `{}`{}",
            output.stdout.len(),
            expected_bytes,
            path.display(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }
    let mut rgba = output.stdout;
    rgba.truncate(expected_bytes);
    Ok((target_width, target_height, rgba))
}

fn decode_native_video_frame_window_rgba(
    path: &Path,
    width: usize,
    height: usize,
    time_seconds: f64,
    fps: f64,
    frame_count: u32,
) -> Result<Vec<NativeVideoFrameDecodeOutput>, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame window decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame window decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let target_width = width.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let target_height = height.clamp(16, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION);
    let expected_bytes = target_width.saturating_mul(target_height).saturating_mul(4);
    let count = frame_count
        .max(1)
        .min(NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES.saturating_add(1));
    let sample_fps = fps.clamp(
        NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS,
        NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS,
    );
    let ffmpeg = std::env::var("GA_FFMPEG_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "ffmpeg.exe".to_string()
            } else {
                "ffmpeg".to_string()
            }
        });
    let scale =
        format!("scale={target_width}:{target_height}:force_original_aspect_ratio=decrease");
    let pad = format!("pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black");
    let output = Command::new(&ffmpeg)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-ss")
        .arg(format!("{:.3}", time_seconds.clamp(0.0, 3600.0)))
        .arg("-i")
        .arg(path)
        .arg("-frames:v")
        .arg(count.to_string())
        .arg("-vf")
        .arg(format!("{scale},{pad},fps={sample_fps:.3},format=rgba"))
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("rgba")
        .arg("pipe:1")
        .output()
        .map_err(|err| {
            format!(
                "native video frame window decode failed to launch `{ffmpeg}` for `{}`: {err}",
                path.display()
            )
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame window decode ffmpeg failed for `{}`: {}",
            path.display(),
            if detail.is_empty() {
                output.status.to_string()
            } else {
                detail
            }
        ));
    }
    let decoded_count = output.stdout.len() / expected_bytes;
    if decoded_count == 0 {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "native video frame window decode produced {}/{} bytes for `{}`{}",
            output.stdout.len(),
            expected_bytes,
            path.display(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }
    let frame_step = 1.0 / sample_fps;
    let mut frames = Vec::with_capacity(decoded_count.min(count as usize));
    for frame_index in 0..decoded_count.min(count as usize) {
        let start = frame_index.saturating_mul(expected_bytes);
        let end = start.saturating_add(expected_bytes);
        let frame_time = (time_seconds + frame_step * frame_index as f64).clamp(0.0, 3600.0);
        let frame_bucket = native_video_frame_bucket(frame_time);
        let signature =
            native_video_frame_file_signature(path, target_width, target_height, frame_bucket)?;
        frames.push(NativeVideoFrameDecodeOutput {
            width: target_width,
            height: target_height,
            frame_bucket,
            signature,
            rgba: output.stdout[start..end].to_vec(),
        });
    }
    if frames.is_empty() {
        return Err(format!(
            "native video frame window decode produced no usable frames for `{}`",
            path.display()
        ));
    }
    Ok(frames)
}

fn native_video_frame_bucket(time_seconds: f64) -> u64 {
    (time_seconds * NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS)
        .round()
        .max(0.0) as u64
}

fn native_image_file_signature(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native image decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native image decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| format!("{}:{}", duration.as_secs(), duration.subsec_nanos()))
        .unwrap_or_else(|| "unknown".to_string());
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(format!(
        "{}:{}:{}",
        canonical.display(),
        metadata.len(),
        modified
    ))
}

fn native_video_frame_file_signature(
    path: &Path,
    width: usize,
    height: usize,
    frame_bucket: u64,
) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|err| {
        format!(
            "native video frame decode failed to stat `{}`: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "native video frame decode rejected non-file path `{}`",
            path.display()
        ));
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| format!("{}:{}", duration.as_secs(), duration.subsec_nanos()))
        .unwrap_or_else(|| "unknown".to_string());
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(format!(
        "{}:{}:{}:{}:{}:{}",
        canonical.display(),
        metadata.len(),
        modified,
        width,
        height,
        frame_bucket
    ))
}

fn local_media_path_from_uri(uri: &str) -> Option<PathBuf> {
    let trimmed = uri.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("blob:")
        || trimmed.starts_with("data:")
    {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("ghost-asset://") {
        return local_path_from_hierarchical_uri_rest(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("file://") {
        return local_path_from_hierarchical_uri_rest(rest);
    }
    absolute_path_from_uri_path(trimmed)
}

fn local_path_from_hierarchical_uri_rest(rest: &str) -> Option<PathBuf> {
    let path_part = if rest.starts_with('/') {
        rest
    } else {
        let slash = rest.find('/')?;
        &rest[slash..]
    };
    absolute_path_from_uri_path(path_part)
}

fn absolute_path_from_uri_path(path: &str) -> Option<PathBuf> {
    let decoded = percent_decode_uri_path(path)?;
    let normalized = if decoded.starts_with('/') && windows_drive_path(&decoded[1..]) {
        decoded[1..].to_string()
    } else {
        decoded
    };
    let path = PathBuf::from(&normalized);
    if path.is_absolute() || windows_drive_path(&normalized) {
        Some(path)
    } else {
        None
    }
}

fn percent_decode_uri_path(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hi = *bytes.get(index + 1)?;
            let lo = *bytes.get(index + 2)?;
            out.push(
                hex_value(hi)?
                    .saturating_mul(16)
                    .saturating_add(hex_value(lo)?),
            );
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
        && bytes[0].is_ascii_alphabetic()
}

fn source_kind(source_type: &str) -> f32 {
    if source_type.starts_with("gpu:") {
        return 9.0;
    }
    match source_type {
        "color" => 1.0,
        "shader" => 2.0,
        "video" => 3.0,
        "image" => 4.0,
        _ => 0.0,
    }
}

fn source_type_color(source_type: &str, id: &str) -> [f32; 4] {
    if source_type.starts_with("gpu:") {
        return match source_type {
            "gpu:planet" => [0.22, 0.62, 1.0, 0.86],
            "gpu:pixel-particles" | "gpu:flythrough" | "gpu:point-cloud-fx" => {
                [1.0, 0.35, 0.82, 0.82]
            }
            "gpu:particle-field" | "gpu:gravity-wells" => [0.25, 1.0, 0.78, 0.84],
            "gpu:volumetric-balls" => [0.78, 0.58, 1.0, 0.86],
            "gpu:smoke-riders" | "gpu:ink-cloud" | "gpu:smoke-3d" => [0.62, 0.82, 1.0, 0.80],
            _ => stable_layer_color(id, 0.76),
        };
    }
    match source_type {
        "shader" => [0.45, 0.92, 1.0, 0.74],
        "video" => [0.28, 1.0, 0.55, 0.70],
        "image" => [1.0, 0.62, 0.26, 0.70],
        "none" => [0.3, 0.34, 0.42, 0.35],
        _ => stable_layer_color(id, 0.66),
    }
}

#[derive(Clone, Debug)]
struct SnapshotMetrics {
    checksum: String,
    nonzero_pixels: u64,
    bright_pixels: u64,
    transparent_pixels: u64,
    average_luma: f64,
    max_luma: f64,
    mean_rgba: [f64; 4],
    dark_frame: bool,
}

struct FrameSnapshotReadback {
    timestamp_ms: u128,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    bytes_per_row: u32,
    padded_bytes_per_row: u32,
    pixels: Vec<u8>,
    metrics: SnapshotMetrics,
}

impl FrameSnapshotReadback {
    fn to_json(&self, include_pixels: bool) -> Value {
        let mut value = json!({
            "timestamp_ms": self.timestamp_ms,
            "width": self.width,
            "height": self.height,
            "format": format!("{:?}", self.format),
            "byte_length": self.pixels.len(),
            "bytes_per_row": self.bytes_per_row,
            "padded_bytes_per_row": self.padded_bytes_per_row,
            "checksum": self.metrics.checksum.clone(),
            "nonzero_pixels": self.metrics.nonzero_pixels,
            "bright_pixels": self.metrics.bright_pixels,
            "transparent_pixels": self.metrics.transparent_pixels,
            "average_luma": self.metrics.average_luma,
            "max_luma": self.metrics.max_luma,
            "mean_rgba": self.metrics.mean_rgba,
            "dark_frame": self.metrics.dark_frame,
            "includes_pixels": include_pixels,
        });
        if include_pixels {
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "rgba_b64".to_string(),
                    Value::String(base64::engine::general_purpose::STANDARD.encode(&self.pixels)),
                );
            }
        }
        value
    }
}

fn align_u32(value: u32, alignment: u32) -> u32 {
    if alignment == 0 {
        return value;
    }
    value.div_ceil(alignment).saturating_mul(alignment)
}

fn align_u64(value: u64, alignment: u64) -> u64 {
    if alignment == 0 {
        return value;
    }
    value.div_ceil(alignment).saturating_mul(alignment)
}

fn snapshot_metrics(bytes: &[u8], format: wgpu::TextureFormat) -> SnapshotMetrics {
    let bgra = matches!(
        format,
        wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb
    );
    let mut checksum = 0xcbf29ce484222325_u64;
    let mut nonzero_pixels = 0_u64;
    let mut bright_pixels = 0_u64;
    let mut transparent_pixels = 0_u64;
    let mut luma_sum = 0.0_f64;
    let mut max_luma = 0.0_f64;
    let mut rgba_sum = [0.0_f64; 4];
    let mut pixel_count = 0_u64;
    for pixel in bytes.chunks_exact(4) {
        for byte in pixel {
            checksum ^= *byte as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        let (r, g, b, a) = if bgra {
            (pixel[2], pixel[1], pixel[0], pixel[3])
        } else {
            (pixel[0], pixel[1], pixel[2], pixel[3])
        };
        let luma = 0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64;
        if a > 0 && luma > 2.0 {
            nonzero_pixels = nonzero_pixels.saturating_add(1);
        }
        if a > 0 && luma > 96.0 {
            bright_pixels = bright_pixels.saturating_add(1);
        }
        if a == 0 {
            transparent_pixels = transparent_pixels.saturating_add(1);
        }
        rgba_sum[0] += r as f64;
        rgba_sum[1] += g as f64;
        rgba_sum[2] += b as f64;
        rgba_sum[3] += a as f64;
        luma_sum += luma;
        max_luma = max_luma.max(luma);
        pixel_count = pixel_count.saturating_add(1);
    }
    let average_luma = if pixel_count == 0 {
        0.0
    } else {
        luma_sum / pixel_count as f64 / 255.0
    };
    let mean_rgba = if pixel_count == 0 {
        [0.0; 4]
    } else {
        [
            rgba_sum[0] / pixel_count as f64 / 255.0,
            rgba_sum[1] / pixel_count as f64 / 255.0,
            rgba_sum[2] / pixel_count as f64 / 255.0,
            rgba_sum[3] / pixel_count as f64 / 255.0,
        ]
    };
    SnapshotMetrics {
        checksum: format!("{checksum:016x}"),
        nonzero_pixels,
        bright_pixels,
        transparent_pixels,
        average_luma,
        max_luma: max_luma / 255.0,
        mean_rgba,
        dark_frame: nonzero_pixels < (pixel_count / 200).max(1) || average_luma < 0.006,
    }
}

fn looks_like_wgsl(source: &str) -> bool {
    let s = source.trim();
    s.contains("@vertex")
        || s.contains("@fragment")
        || s.contains("@compute")
        || s.contains("var<")
        || s.contains("vec2<")
        || s.contains("vec3<")
        || s.contains("vec4<")
        || (s.contains("fn ") && s.contains("->"))
}

fn native_fragment_entry(record: &ShaderRecord, source: &str) -> Option<String> {
    if !native_wgsl_fragment_supported(source) {
        return None;
    }
    let preferred = record.entry.trim();
    if !preferred.is_empty() && record.entry_points.iter().any(|entry| entry == preferred) {
        return Some(preferred.to_string());
    }
    ["fs_main", "main"].iter().find_map(|candidate| {
        record
            .entry_points
            .iter()
            .any(|entry| entry == candidate)
            .then(|| candidate.to_string())
    })
}

fn native_compute_entry(record: &ShaderRecord, source: &str) -> Option<String> {
    if !source.trim().contains("@compute") {
        return None;
    }
    let preferred = record.entry.trim();
    if !preferred.is_empty() && record.entry_points.iter().any(|entry| entry == preferred) {
        return Some(preferred.to_string());
    }
    ["cs_main", "main"].iter().find_map(|candidate| {
        record
            .entry_points
            .iter()
            .any(|entry| entry == candidate)
            .then(|| candidate.to_string())
    })
}

fn native_wgsl_fragment_supported(source: &str) -> bool {
    let source = source.trim();
    source.contains("@fragment") && native_wgsl_bindings_supported(source)
}

fn native_wgsl_bindings_supported(source: &str) -> bool {
    if !source.contains("@group") && !source.contains("@binding") {
        return true;
    }
    all_wgsl_attribute_indices_at_most(source, "@group", 0)
        && all_wgsl_attribute_indices_at_most(source, "@binding", 2)
}

fn all_wgsl_attribute_indices_at_most(source: &str, attribute: &str, max_supported: u32) -> bool {
    let mut rest = source;
    while let Some(index) = rest.find(attribute) {
        rest = &rest[index + attribute.len()..];
        let Some(open_index) = rest.find('(') else {
            return false;
        };
        rest = &rest[open_index + 1..];
        let trimmed = rest.trim_start();
        let digits = trimmed
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect::<String>();
        let Ok(value) = digits.parse::<u32>() else {
            return false;
        };
        if value > max_supported {
            return false;
        }
    }
    true
}

fn native_shader_pipeline_key(record: &ShaderRecord, shader_id: &str, entry: &str) -> String {
    format!("{shader_id}:{}:{entry}", record.source_hash)
}

fn native_graph_render_pipeline_key(base_key: &str, output_format: wgpu::TextureFormat) -> String {
    format!(
        "{base_key}:target-format:{}",
        texture_format_label(output_format)
    )
}

fn stable_hash64(input: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn json_channel_to_unit(value: &Value) -> f32 {
    let n = value.as_f64().unwrap_or(0.0);
    if n > 1.0 {
        (n / 255.0).clamp(0.0, 1.0) as f32
    } else {
        n.clamp(0.0, 1.0) as f32
    }
}

fn preview_rgba_at(rgba: &[Value], width: usize, height: usize, x: usize, y: usize) -> [f32; 4] {
    let sx = x.min(width.saturating_sub(1));
    let sy = y.min(height.saturating_sub(1));
    let index = (sy * width + sx) * 4;
    [
        json_channel_to_unit(&rgba[index]),
        json_channel_to_unit(&rgba[index + 1]),
        json_channel_to_unit(&rgba[index + 2]),
        json_channel_to_unit(&rgba[index + 3]),
    ]
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SourceFrameTransport {
    File,
    Base64,
    Json,
    SharedTexture,
    Unknown,
}

impl SourceFrameTransport {
    fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Base64 => "base64",
            Self::Json => "json",
            Self::SharedTexture => "shared-texture",
            Self::Unknown => "unknown",
        }
    }

    fn is_cpu_fallback(self) -> bool {
        matches!(self, Self::File | Self::Base64 | Self::Json)
    }
}

fn source_frame_transport_from_command(command: &Value) -> SourceFrameTransport {
    if command.get("shared_handle").is_some()
        || command.get("handle").is_some()
        || command.get("shared_texture").is_some()
    {
        return SourceFrameTransport::SharedTexture;
    }
    if command.get("rgba_file").is_some() {
        return SourceFrameTransport::File;
    }
    if command.get("rgba_b64").is_some() {
        return SourceFrameTransport::Base64;
    }
    if command.get("rgba").is_some() {
        return SourceFrameTransport::Json;
    }
    SourceFrameTransport::Unknown
}

fn rgba_bytes_from_command(command: &Value, width: usize, height: usize) -> Option<Vec<u8>> {
    let expected = width.saturating_mul(height).saturating_mul(4);
    if let Some(file_path) = command.get("rgba_file").and_then(Value::as_str) {
        let bytes = fs::read(file_path).ok()?;
        if command
            .get("rgba_file_delete")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let _ = fs::remove_file(file_path);
        }
        let declared_len = command
            .get("rgba_byte_length")
            .and_then(Value::as_u64)
            .unwrap_or(bytes.len() as u64) as usize;
        if bytes.len() < declared_len || bytes.len() < expected {
            return None;
        }
        return Some(bytes);
    }
    if let Some(encoded) = command.get("rgba_b64").and_then(Value::as_str) {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .ok()?;
        return (decoded.len() >= expected).then_some(decoded);
    }
    let rgba = command.get("rgba").and_then(Value::as_array)?;
    if rgba.len() < expected {
        return None;
    }
    let mut bytes = Vec::with_capacity(expected);
    for value in rgba.iter().take(expected) {
        let n = value.as_f64().unwrap_or(0.0);
        bytes.push(n.round().clamp(0.0, 255.0) as u8);
    }
    Some(bytes)
}

fn frame_rgba_at(rgba: &[u8], width: usize, height: usize, x: usize, y: usize) -> [f32; 4] {
    let sx = x.min(width.saturating_sub(1));
    let sy = y.min(height.saturating_sub(1));
    let index = (sy * width + sx) * 4;
    [
        rgba[index] as f32,
        rgba[index + 1] as f32,
        rgba[index + 2] as f32,
        rgba[index + 3] as f32,
    ]
}

fn resample_frame_bytes(
    rgba: &[u8],
    width: usize,
    height: usize,
    dst_width: usize,
    dst_height: usize,
) -> Vec<u8> {
    let mut out = vec![0u8; dst_width.saturating_mul(dst_height).saturating_mul(4)];
    let scale_x = width as f32 / dst_width.max(1) as f32;
    let scale_y = height as f32 / dst_height.max(1) as f32;
    for y in 0..dst_height {
        let source_y = ((y as f32 + 0.5) * scale_y - 0.5).clamp(0.0, (height - 1) as f32);
        let y0 = source_y.floor().max(0.0) as usize;
        let y1 = (y0 + 1).min(height.saturating_sub(1));
        let ty = (source_y - y0 as f32).clamp(0.0, 1.0);
        for x in 0..dst_width {
            let source_x = ((x as f32 + 0.5) * scale_x - 0.5).clamp(0.0, (width - 1) as f32);
            let x0 = source_x.floor().max(0.0) as usize;
            let x1 = (x0 + 1).min(width.saturating_sub(1));
            let tx = (source_x - x0 as f32).clamp(0.0, 1.0);
            let top = mix_rgba(
                frame_rgba_at(rgba, width, height, x0, y0),
                frame_rgba_at(rgba, width, height, x1, y0),
                tx,
            );
            let bottom = mix_rgba(
                frame_rgba_at(rgba, width, height, x0, y1),
                frame_rgba_at(rgba, width, height, x1, y1),
                tx,
            );
            let mixed = mix_rgba(top, bottom, ty);
            let dst = (y * dst_width + x) * 4;
            out[dst] = mixed[0].round().clamp(0.0, 255.0) as u8;
            out[dst + 1] = mixed[1].round().clamp(0.0, 255.0) as u8;
            out[dst + 2] = mixed[2].round().clamp(0.0, 255.0) as u8;
            out[dst + 3] = mixed[3].round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

fn mix_rgba(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    let mix = |x: f32, y: f32| x + (y - x) * t;
    [
        mix(a[0], b[0]),
        mix(a[1], b[1]),
        mix(a[2], b[2]),
        mix(a[3], b[3]),
    ]
}

fn resample_preview_pixel(
    rgba: &[Value],
    width: usize,
    height: usize,
    source_x: f32,
    source_y: f32,
) -> PreviewPixel {
    let x0 = source_x.floor().max(0.0) as usize;
    let y0 = source_y.floor().max(0.0) as usize;
    let x1 = (x0 + 1).min(width.saturating_sub(1));
    let y1 = (y0 + 1).min(height.saturating_sub(1));
    let tx = (source_x - x0 as f32).clamp(0.0, 1.0);
    let ty = (source_y - y0 as f32).clamp(0.0, 1.0);

    let top = mix_rgba(
        preview_rgba_at(rgba, width, height, x0, y0),
        preview_rgba_at(rgba, width, height, x1, y0),
        tx,
    );
    let bottom = mix_rgba(
        preview_rgba_at(rgba, width, height, x0, y1),
        preview_rgba_at(rgba, width, height, x1, y1),
        tx,
    );

    PreviewPixel {
        rgba: mix_rgba(top, bottom, ty),
    }
}

fn stable_slot(id: &str, slot_count: usize) -> usize {
    let mut hash = 2166136261_u32;
    for byte in id.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    (hash as usize) % slot_count.max(1)
}

fn epoch_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn native_backend_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "metal"
    } else if cfg!(target_os = "windows") {
        "d3d12"
    } else {
        "vulkan"
    }
}

fn choose_present_mode(
    supported: &[wgpu::PresentMode],
    requested: &str,
    allow_tearing: bool,
) -> wgpu::PresentMode {
    let wants_immediate = matches!(
        requested.trim().to_ascii_lowercase().as_str(),
        "immediate" | "no-vsync" | "novsync"
    );
    if wants_immediate {
        if allow_tearing && supported.contains(&wgpu::PresentMode::Immediate) {
            return wgpu::PresentMode::Immediate;
        }
        if supported.contains(&wgpu::PresentMode::Mailbox) {
            return wgpu::PresentMode::Mailbox;
        }
        if supported.contains(&wgpu::PresentMode::Immediate) {
            return wgpu::PresentMode::Immediate;
        }
        if supported.contains(&wgpu::PresentMode::AutoNoVsync) {
            return wgpu::PresentMode::AutoNoVsync;
        }
    }
    if supported.contains(&wgpu::PresentMode::Fifo) {
        return wgpu::PresentMode::Fifo;
    }
    if supported.contains(&wgpu::PresentMode::AutoVsync) {
        return wgpu::PresentMode::AutoVsync;
    }
    supported
        .first()
        .copied()
        .unwrap_or(wgpu::PresentMode::AutoVsync)
}

fn present_mode_label(mode: wgpu::PresentMode) -> &'static str {
    match mode {
        wgpu::PresentMode::AutoVsync => "auto-vsync",
        wgpu::PresentMode::AutoNoVsync => "auto-no-vsync",
        wgpu::PresentMode::Fifo => "fifo",
        wgpu::PresentMode::FifoRelaxed => "fifo-relaxed",
        wgpu::PresentMode::Immediate => "immediate",
        wgpu::PresentMode::Mailbox => "mailbox",
    }
}

fn native_optional_features() -> wgpu::Features {
    wgpu::Features::SHADER_F16
        | wgpu::Features::FLOAT32_FILTERABLE
        | wgpu::Features::TIMESTAMP_QUERY
        | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS
        | wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES
}

fn native_gpu_caps(
    adapter_info: &wgpu::AdapterInfo,
    limits: &wgpu::Limits,
    supported: wgpu::Features,
    requested: wgpu::Features,
) -> NativeGpuCaps {
    NativeGpuCaps {
        adapter_name: adapter_info.name.clone(),
        adapter_vendor: adapter_info.vendor,
        adapter_device: adapter_info.device,
        adapter_device_type: format!("{:?}", adapter_info.device_type),
        adapter_driver: adapter_info.driver.clone(),
        adapter_driver_info: adapter_info.driver_info.clone(),
        max_texture_dimension_2d: limits.max_texture_dimension_2d,
        max_texture_dimension_3d: limits.max_texture_dimension_3d,
        max_texture_array_layers: limits.max_texture_array_layers,
        max_bind_groups: limits.max_bind_groups,
        max_bindings_per_bind_group: limits.max_bindings_per_bind_group,
        max_sampled_textures_per_shader_stage: limits.max_sampled_textures_per_shader_stage,
        max_storage_buffers_per_shader_stage: limits.max_storage_buffers_per_shader_stage,
        max_storage_textures_per_shader_stage: limits.max_storage_textures_per_shader_stage,
        max_uniform_buffer_binding_size: limits.max_uniform_buffer_binding_size,
        max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
        max_buffer_size: limits.max_buffer_size,
        max_compute_workgroup_storage_size: limits.max_compute_workgroup_storage_size,
        max_compute_invocations_per_workgroup: limits.max_compute_invocations_per_workgroup,
        max_compute_workgroup_size_x: limits.max_compute_workgroup_size_x,
        max_compute_workgroup_size_y: limits.max_compute_workgroup_size_y,
        max_compute_workgroup_size_z: limits.max_compute_workgroup_size_z,
        max_compute_workgroups_per_dimension: limits.max_compute_workgroups_per_dimension,
        supports_shader_f16: supported.contains(wgpu::Features::SHADER_F16),
        supports_float32_filterable: supported.contains(wgpu::Features::FLOAT32_FILTERABLE),
        supports_timestamp_query: supported.contains(wgpu::Features::TIMESTAMP_QUERY),
        supports_timestamp_query_inside_encoders: supported
            .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
        supports_timestamp_query_inside_passes: supported
            .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
        supports_texture_binding_array: supported.contains(wgpu::Features::TEXTURE_BINDING_ARRAY),
        supports_buffer_binding_array: supported.contains(wgpu::Features::BUFFER_BINDING_ARRAY),
        supports_storage_resource_binding_array: supported
            .contains(wgpu::Features::STORAGE_RESOURCE_BINDING_ARRAY),
        supports_texture_adapter_specific_format_features: supported
            .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES),
        requested_shader_f16: requested.contains(wgpu::Features::SHADER_F16),
        requested_float32_filterable: requested.contains(wgpu::Features::FLOAT32_FILTERABLE),
        requested_timestamp_query: requested.contains(wgpu::Features::TIMESTAMP_QUERY),
        requested_timestamp_query_inside_encoders: requested
            .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
        requested_timestamp_query_inside_passes: requested
            .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
        recommended_quality_tier: native_quality_tier(limits, supported).to_string(),
    }
}

fn native_quality_tier(limits: &wgpu::Limits, features: wgpu::Features) -> &'static str {
    let storage_mb = limits.max_storage_buffer_binding_size / (1024 * 1024);
    let buffer_mb = limits.max_buffer_size / (1024 * 1024);
    let has_f16 = features.contains(wgpu::Features::SHADER_F16);
    let has_float_filter = features.contains(wgpu::Features::FLOAT32_FILTERABLE);
    let compute = limits.max_compute_invocations_per_workgroup;

    if has_f16
        && has_float_filter
        && limits.max_texture_dimension_3d >= 2048
        && storage_mb >= 512
        && buffer_mb >= 1024
        && compute >= 512
    {
        return "insane";
    }
    if has_f16
        && limits.max_texture_dimension_3d >= 1024
        && storage_mb >= 256
        && buffer_mb >= 512
        && compute >= 256
    {
        return "ultra";
    }
    if limits.max_texture_dimension_3d >= 512 && storage_mb >= 128 && buffer_mb >= 256 {
        return "balanced";
    }
    "performance"
}

fn normalize_native_tier(tier: &str) -> &'static str {
    match tier.trim().to_ascii_lowercase().as_str() {
        "insane" => "insane",
        "ultra" => "ultra",
        "balanced" | "balance" => "balanced",
        "performance" | "perf" | "low" => "performance",
        _ => "balanced",
    }
}

fn native_tier_index(tier: &str) -> i32 {
    match normalize_native_tier(tier) {
        "performance" => 0,
        "balanced" => 1,
        "ultra" => 2,
        "insane" => 3,
        _ => 1,
    }
}

fn native_tier_for_index(index: i32) -> &'static str {
    match index {
        0 => "performance",
        1 => "balanced",
        2 => "ultra",
        3 => "insane",
        _ if index < 0 => "performance",
        _ => "insane",
    }
}

fn tier_quality_scale(tier: &str) -> f32 {
    match normalize_native_tier(tier) {
        "performance" => 0.56,
        "balanced" => 0.72,
        "ultra" => 0.90,
        "insane" => 1.0,
        _ => 0.72,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ghost_audio_uniform_layout_documents_the_native_slots() {
        let layout = ghost_audio_uniform_layout();
        assert_eq!(layout["schema_version"], json!(1));
        assert_eq!(layout["audio0"], json!(["level", "bass", "mid", "treble"]));
        assert_eq!(
            layout["audio1"],
            json!(["high", "beat", "beat_phase", "bpm"])
        );
        assert_eq!(
            layout["audio2"],
            json!(["centroid", "kick", "snare", "active"])
        );
    }

    #[test]
    fn ghost_audio_uniforms_pack_and_clamp_command_fields() {
        let audio = GhostAudioUniforms::from_command(&json!({
            "active": true,
            "level": 1.2,
            "bass": 0.54,
            "mid": 0.35,
            "treble": 0.45,
            "high": 0.55,
            "beat": 0.65,
            "beat_phase": -1.0,
            "bpm": 900.0,
            "centroid": 0.42,
            "kick": 0.8,
            "snare": 0.15,
        }));

        assert_eq!(audio.audio0, [1.0, 0.54, 0.35, 0.45]);
        assert_eq!(audio.audio1, [0.55, 0.65, 0.0, 300.0]);
        assert_eq!(audio.audio2, [0.42, 0.8, 0.15, 1.0]);
    }

    #[test]
    fn isf_audio_uniforms_accept_canonical_and_legacy_fields() {
        let canonical = GhostAudioUniforms::from_isf_command(&json!({
            "active": true,
            "level": 0.1,
            "bass": 0.2,
            "mid": 0.3,
            "treble": 0.4,
            "high": 0.5,
            "beat": 0.6,
            "beat_phase": 0.7,
            "bpm": 128,
            "centroid": 0.8,
            "kick": 0.9,
            "snare": 1.2,
        }));
        assert_eq!(canonical.audio0, [0.1, 0.2, 0.3, 0.4]);
        assert_eq!(canonical.audio1, [0.5, 0.6, 0.7, 128.0]);
        assert_eq!(canonical.audio2, [0.8, 0.9, 1.0, 1.0]);

        let legacy = GhostAudioUniforms::from_isf_command(&json!({
            "audio_level": 0.11,
            "audio_bass": 0.22,
            "audio_mid": 0.33,
            "audio_high": 0.44,
            "audio_beat": 0.55,
            "audio_beat_phase": 0.66,
            "audio_bpm": 92,
            "audio_spectral_centroid": 0.77,
            "audio_kick": 0.88,
            "audio_snare": 0.99,
        }));
        assert_eq!(legacy.audio0, [0.11, 0.22, 0.33, 0.44]);
        assert_eq!(legacy.audio1, [0.44, 0.55, 0.66, 92.0]);
        assert_eq!(legacy.audio2, [0.77, 0.88, 0.99, 1.0]);
    }

    #[test]
    fn native_shader_uniforms_append_audio2_without_moving_params() {
        assert!(
            std::mem::offset_of!(NativeShaderUniforms, audio2)
                > std::mem::offset_of!(NativeShaderUniforms, params1)
        );

        let state = IsfUniformState {
            shader_id: "shader".to_string(),
            time: 1.25,
            time_delta: 1.0 / 30.0,
            frame_index: 7,
            render_width: 320.0,
            render_height: 180.0,
            date: [2026.0, 7.0, 3.0, 123.0],
            audio0: [0.1, 0.2, 0.3, 0.4],
            audio1: [0.5, 0.6, 0.7, 128.0],
            audio2: [0.8, 0.9, 1.0, 1.0],
            float_hash: 0,
            point_hash: 0,
            color_hash: 0,
            input_count: 0,
            seq: 1,
        };
        let uniforms =
            NativeShaderUniforms::from_isf("shader", Some(&state), 640, 360, [0.0; 8], 0);
        assert_eq!(uniforms.audio0, state.audio0);
        assert_eq!(uniforms.audio1, state.audio1);
        assert_eq!(uniforms.audio2, state.audio2);
        assert_eq!(uniforms.params0, [0.0; 4]);
        assert_eq!(uniforms.params1, [0.0; 4]);
    }
}
