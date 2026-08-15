#![recursion_limit = "512"]

mod audio;
mod capabilities;
mod compositor;
mod compute_graph;
mod media_decode;
mod native_graph_manifest;
mod native_quality;
mod shared_texture;

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet, VecDeque},
    ffi::c_void,
    fs,
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
    ptr::NonNull,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, Instant},
};

use audio::{GhostAudioUniforms, ghost_audio_uniform_layout};
use base64::Engine;
use bytemuck::{Pod, Zeroable};
use capabilities::{
    CORE_COMMAND_TYPES, CORE_RPC_METHODS, native_compute_host_readiness, native_effect_pass_manifest,
    native_graph_readiness_checks, output_shared_texture_export_readiness,
    shared_texture_media_transport_note, shared_texture_media_transport_ready_detail,
    source_frame_shared_texture_import_readiness, texture_share_sender_label,
    texture_share_sender_pending_detail, texture_share_sender_ready_detail,
};
use compositor::{
    blend_mode_code, effect_descriptor_code, native_compositor_blend_manifest,
    native_compositor_effect_manifest, stable_layer_color,
};
use compute_graph::{
    NativeComputeBindingLayoutSpec, NativeComputeBufferBindingKind, NativeComputeGraphBindingKind,
    NativeComputeGraphBindingSpec, NativeComputeGraphBufferSpec, NativeComputeGraphDepthCompare,
    NativeComputeGraphGpuBuffer, NativeComputeGraphPassPlan, NativeComputeGraphPrimitiveTopology,
    NativeComputeGraphReadbackSpec, NativeComputeGraphRenderBlend, NativeComputeGraphRenderPlan,
    NativeComputeGraphRenderTarget, NativeComputeGraphTextureDimension,
    compute_binding_kind_from_value, compute_graph_binding_kind_from_value,
    compute_graph_binding_resource_id, compute_graph_readbacks, dispatch_from_value,
    parse_compute_graph_buffer,
};
use media_decode::{
    MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION, NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS,
    NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS, NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES,
    NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS, NativeVideoFrameDecodeOutput, NativeVideoStream,
    decode_native_image_rgba, decode_native_video_frame_exact_rgba, decode_native_video_frame_rgba,
    decode_native_video_frame_window_rgba, local_media_path_from_uri, native_image_file_signature,
    native_video_frame_bucket, native_video_frame_file_signature, spawn_native_video_stream,
};
use native_graph_manifest::{
    native_graph_instrument_ids, native_graph_instrument_manifest, native_graph_instruments_note,
};
use native_quality::{
    NativeGpuCaps, NativeQualityState, native_gpu_caps, native_optional_features,
    native_quality_tier, normalize_native_tier,
};
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSApplication, NSApplicationPresentationOptions, NSView, NSWindow, NSWindowOrderingMode,
};
#[cfg(target_os = "macos")]
use objc2_foundation::MainThreadMarker;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared_texture::SharedTextureSourceFrameDescriptor;
use wgpu::util::{DeviceExt, TextureBlitter, TextureBlitterBuilder};
#[cfg(not(target_os = "macos"))]
use winit::window::Fullscreen;
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalPosition, LogicalSize, PhysicalSize},
    event::{ElementState, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    keyboard::{Key, NamedKey},
    raw_window_handle::{AppKitWindowHandle, HasWindowHandle, RawWindowHandle},
    window::{Window, WindowAttributes, WindowId, WindowLevel},
};

const MAX_SCENE_LAYERS: usize = 64;
const MAX_LAYER_MESH_SIDE: usize = 16;
const MAX_LAYER_MESH_POINTS: usize = MAX_LAYER_MESH_SIDE * MAX_LAYER_MESH_SIDE;
const MAX_LAYER_MESH_VEC4S: usize = MAX_LAYER_MESH_POINTS / 2;
const MAX_LAYER_MASK_POINTS: usize = 64;
const MAX_LAYER_EDGE_EFFECTS: usize = 4;
const LAYER_EDGE_EFFECT_VEC4S: usize = 7;
const MAX_SOURCE_PREVIEWS: usize = 16;
const SOURCE_PREVIEW_SIZE: usize = 256;
const SOURCE_PREVIEW_PIXELS: usize = SOURCE_PREVIEW_SIZE * SOURCE_PREVIEW_SIZE;
const MAX_SOURCE_FRAME_SLOTS: usize = 24;
const SOURCE_FRAME_SIZE_PERFORMANCE: usize = 1024;
const SOURCE_FRAME_SIZE_BALANCED: usize = 1536;
const SOURCE_FRAME_SIZE_DEFAULT: usize = 2048;
const SOURCE_FRAME_SIZE_INSANE: usize = 3072;
const SOURCE_FRAME_MIP_LEVELS_MAX: u32 = 5;
const NATIVE_VIDEO_FRAME_CACHE_MAX_ENTRIES: usize = 48;
const NATIVE_VIDEO_FRAME_CACHE_MAX_BYTES: usize = 192 * 1024 * 1024;
const NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT: usize = 2;
const NATIVE_VIDEO_DECODE_PUMP_PER_TICK: usize = 1;
const NATIVE_VIDEO_DECODE_PUMP_WINDOW_FRAMES: u32 = 12;
const NATIVE_VIDEO_SESSION_MAX_PLAYING: usize = 8;
const NATIVE_VIDEO_SESSION_MAX_ARMED: usize = 8;
const NATIVE_VIDEO_SESSION_PREROLL_MIN: usize = 6;
const NATIVE_VIDEO_FRAME_INTERVAL: Duration = Duration::from_nanos(16_666_667);
const SOURCE_FRAME_FORMAT_FALLBACK: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const SOURCE_FRAME_FORMAT_HDR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const NATIVE_GRAPH_DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const EMPTY_SOURCE_FRAME_ID: &str = "__ghost_native_empty_source_frame__";
const MAX_STAGE3D_OVERLAY_ITEMS: usize = 128;
const MAX_STAGE3D_MESH_ITEMS: usize = 128;
const DEFAULT_COMMAND_QUEUE_CAPACITY: u32 = 8192;
const DEFAULT_COMMAND_DRAIN_LIMIT: u32 = 1024;
const MAX_NATIVE_ISF_PARAM_FLOATS: usize = 64;
const NATIVE_ISF_PARAM_VEC4S: usize = MAX_NATIVE_ISF_PARAM_FLOATS / 4;
const NATIVE_ISF_EXTRA_PARAM_VEC4S: usize = NATIVE_ISF_PARAM_VEC4S - 2;

const SOURCE_FRAME_SLOT_OFFSET: f32 = 100.0;
const NATIVE_SHADER_SOURCE_KIND: f32 = 17.0;
const GPU_TIMESTAMP_READ_BYTES: u64 = 16;
const COMPUTE_READBACK_PREVIEW_WORDS: usize = 128;
const COMPUTE_READBACK_BYTES_MAX: u64 = 4 * 1024 * 1024;
const NATIVE_GRAPH_BUFFER_BUDGET_MIN_BYTES: u64 = 16 * 1024 * 1024;
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
const STAGE3D_MESH_WGSL: &str = concat!(
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
    let source_slot = i32(clamp(floor(in.material.x - 1.0 + 0.5), 0.0, 7.0));
    let tex = textureSampleLevel(source_frames, source_sampler, in.uv, source_slot, 0.0);
    rgb = mix(rgb, tex.rgb, clamp(opacity, 0.0, 1.0));
    alpha = clamp(in.color.a * opacity * tex.a, 0.0, 1.0);
  }
  rgb *= max(0.0, in.material.y) * light_mul;
  return vec4<f32>(rgb * shade * haze * alpha, alpha);
}
"#
);

#[derive(Debug)]
enum UserEvent {
    Rpc(RpcRequest),
    NativeVideoFrameDecoded(NativeVideoFrameDecodeResult),
    GpuFrameCompleted,
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
    pending_key: String,
    exact_preview: bool,
}

#[derive(Debug)]
struct NativeVideoFrameDecodeResult {
    source_id: String,
    uri: String,
    frame_bucket: u64,
    signature: String,
    seq: u64,
    pending_key: String,
    exact_preview: bool,
    result: Result<Vec<NativeVideoFrameDecodeOutput>, String>,
}

#[derive(Clone, Debug, Serialize)]
struct NativeVideoSessionStatus {
    source_id: String,
    state: String,
    signature: String,
    buffered_frames: u32,
    frames_presented: u64,
}

#[derive(Clone, Debug, Serialize)]
struct CoreStatus {
    running: bool,
    backend: String,
    backend_ready: bool,
    adapter_name: Option<String>,
    adapter_is_software: bool,
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
    native_graph_buffer_bytes: u64,
    native_graph_buffer_budget_bytes: u64,
    vram_evictions: u64,
    vram_evicted_bytes: u64,
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
    native_video_sessions: Vec<NativeVideoSessionStatus>,
    native_video_sessions_armed: u32,
    native_video_sessions_prerolled: u32,
    native_video_sessions_playing: u32,
    native_video_session_evictions: u64,
    media_sources_active: u32,
    media_source_orphan_releases: u64,
    video_oneshot_decodes_during_playback: u64,
    native_video_trigger_last_latency_us: u64,
    native_video_trigger_max_latency_us: u64,
    native_video_stream_underflows: u64,
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
    gpu_frames_submitted: u64,
    gpu_frames_completed: u64,
    gpu_backpressure_skips: u64,
    frames_presented: u64,
    commands_applied: u64,
    commands_dropped: u64,
    layers_seen: u32,
    scene_layers_active: u32,
    output_last_presented_layer_count: u32,
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

#[derive(Clone, Debug, Serialize, Default)]
struct CoreStats {
    frames_submitted: u64,
    gpu_frames_submitted: u64,
    gpu_frames_completed: u64,
    gpu_backpressure_skips: u64,
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
    native_video_session_evictions: u64,
    media_source_orphan_releases: u64,
    video_oneshot_decodes_during_playback: u64,
    native_video_trigger_last_latency_us: u64,
    native_video_trigger_max_latency_us: u64,
    native_video_stream_underflows: u64,
    native_shader_renders: u64,
    native_instrument_frame_renders: u64,
    vram_evictions: u64,
    vram_evicted_bytes: u64,
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
    output_last_presented_layer_count: u32,
    swapchain_present_tearing_attempts: u64,
    swapchain_waitable_waits: u64,
    swapchain_waitable_timeouts: u64,
    frames_without_swapchain_present: u64,
}

/// Output-stage settings shared by every render entry point. Identity here
/// means "no output transform", which is what deck monitors always want: they
/// are cue displays, not the projector.
#[derive(Clone, Copy)]
struct OutputStage {
    /// Crop rect (x, y, width, height) in source UV.
    out0: [f32; 4],
    /// (rotation quarter-turns, brightness, contrast, gamma).
    out1: [f32; 4],
    /// Edge-blend widths (left, right, top, bottom) as UV fractions.
    edge: [f32; 4],
    /// (dome enabled, mode, fov radians, rotation radians).
    dome0: [f32; 4],
    /// (tilt radians, offset x, offset y, curvature).
    dome1: [f32; 4],
    /// (truncation, edge-blend gamma, slice mode, _).
    dome2: [f32; 4],
    /// Per-edge blend gamma (left, right, top, bottom); slice mode only.
    edge_gamma: [f32; 4],
    /// Projector black-level lift (r, g, b, feather); slice mode only.
    black_level: [f32; 4],
    /// Per-slice screen warp: (mode, rows, cols, _) + corner quad.
    swarp: [f32; 4],
    swarp_c0: [f32; 4],
    swarp_c1: [f32; 4],
    /// Master warp: (enabled, rows, cols, _) + corner quad.
    mwarp: [f32; 4],
    mwarp_c0: [f32; 4],
    mwarp_c1: [f32; 4],
    /// Control points, two per vec4, row-major, up to 16x16.
    swarp_mesh: [[f32; 4]; 128],
    mwarp_mesh: [[f32; 4]; 128],
}

impl Default for OutputStage {
    fn default() -> Self {
        Self {
            out0: [0.0, 0.0, 1.0, 1.0],
            out1: [0.0, 1.0, 1.0, 1.0],
            edge: [0.0; 4],
            dome0: [0.0; 4],
            dome1: [0.0; 4],
            dome2: [1.0, 2.2, 0.0, 0.0],
            edge_gamma: [2.2; 4],
            black_level: [0.0; 4],
            swarp: [0.0; 4],
            swarp_c0: [0.0, 0.0, 1.0, 0.0],
            swarp_c1: [1.0, 1.0, 0.0, 1.0],
            mwarp: [0.0; 4],
            mwarp_c0: [0.0, 0.0, 1.0, 0.0],
            mwarp_c1: [1.0, 1.0, 0.0, 1.0],
            swarp_mesh: [[0.0; 4]; 128],
            mwarp_mesh: [[0.0; 4]; 128],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution: [f32; 2],
    time: f32,
    command_phase: f32,
    layer_count: f32,
    frame_count: f32,
    /// Master output gate: 1.0 normal, 0.0 blackout.
    output_gate: f32,
    /// Number of composite-stage effects in `post` (0..8).
    post_count: f32,
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
    /// Composition effects then macro bundles, applied after layer blending.
    post: [[f32; 4]; 8],
    /// Output stage: crop, rotation + color grade, edge blend, dome.
    out0: [f32; 4],
    out1: [f32; 4],
    edge: [f32; 4],
    dome0: [f32; 4],
    dome1: [f32; 4],
    dome2: [f32; 4],
    edge_gamma: [f32; 4],
    black_level: [f32; 4],
    swarp: [f32; 4],
    swarp_c0: [f32; 4],
    swarp_c1: [f32; 4],
    mwarp: [f32; 4],
    mwarp_c0: [f32; 4],
    mwarp_c1: [f32; 4],
    swarp_mesh: [[f32; 4]; 128],
    mwarp_mesh: [[f32; 4]; 128],
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
    shape2: [f32; 4],
    shape_meta: [f32; 4],
    shape_pts: [[f32; 4]; 32],
    effect0: [f32; 4],
    effect1: [f32; 4],
    effect2: [f32; 4],
    effect3: [f32; 4],
    edge_effects: [[[f32; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS],
    mask_info: [f32; 4],
    mask: [[f32; 4]; MAX_LAYER_MASK_POINTS],
    mesh: [[f32; 4]; MAX_LAYER_MESH_VEC4S],
    source_rect: [f32; 4],
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
    params_extra: [[f32; 4]; NATIVE_ISF_EXTRA_PARAM_VEC4S],
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
    source_rect: [f32; 4],
}

impl SourceFrame {
    fn full(seq: u64) -> Self {
        Self {
            seq,
            source_rect: [0.0, 0.0, 1.0, 1.0],
        }
    }

    fn with_rect(seq: u64, source_rect: [f32; 4]) -> Self {
        Self { seq, source_rect }
    }
}

#[derive(Clone, Debug)]
struct NativeMediaSourceState {
    uri: String,
    source_type: String,
    playback_time_seconds: f64,
    seek_generation: u64,
    playback_rate: f64,
    paused: bool,
    loop_enabled: bool,
    duration_seconds: Option<f64>,
    trim_start: f64,
    trim_end: f64,
    decode_width: Option<usize>,
    decode_height: Option<usize>,
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
            let range_start = duration * self.trim_start.clamp(0.0, 1.0);
            let range_end = duration * self.trim_end.clamp(self.trim_start, 1.0);
            let range_duration = (range_end - range_start).max(f64::EPSILON);
            if self.loop_enabled {
                time = range_start + (time - range_start) % range_duration;
                if time < range_start {
                    time += range_duration;
                }
            } else {
                time = time.clamp(range_start, range_end);
            }
        }
        time.clamp(0.0, 3600.0)
    }
}

fn effective_native_frame_index(
    render_clock_mode: &str,
    render_clock_frame_index: Option<u64>,
    gpu_frames_submitted: u64,
) -> u64 {
    if render_clock_mode == "manual" {
        render_clock_frame_index.unwrap_or(gpu_frames_submitted)
    } else {
        gpu_frames_submitted
    }
}

fn effective_native_frame_delta(
    render_clock_mode: &str,
    render_clock_delta: f32,
    target_fps: u32,
) -> f32 {
    if render_clock_mode == "manual" {
        render_clock_delta.max(0.0)
    } else {
        1.0 / target_fps.max(1) as f32
    }
}

struct NativeShaderPipeline {
    pipeline: wgpu::RenderPipeline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NativeIsfInputKind {
    Float,
    Bool,
    Long,
    Point2D,
    Color,
    Event,
    Image,
    Unsupported,
}

#[derive(Clone, Debug)]
struct NativeIsfInputBinding {
    name: String,
    kind: NativeIsfInputKind,
    offset: Option<usize>,
    components: usize,
    default_values: [f32; 4],
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

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct NativeOutputExport {
    #[cfg(target_os = "macos")]
    surface: objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>,
    #[cfg(target_os = "windows")]
    shared_handle: windows::Win32::Foundation::HANDLE,
    #[cfg(target_os = "windows")]
    shared_name: String,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    blitter: TextureBlitter,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    frame: u64,
}

#[cfg(target_os = "windows")]
impl Drop for NativeOutputExport {
    fn drop(&mut self) {
        if !self.shared_handle.is_invalid() {
            let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.shared_handle) };
        }
    }
}

/// One deck confidence monitor: the bank composite renders into
/// `render_view` (pipeline format) and blits into the shared-texture
/// `export` the presenter imports zero-copy.
#[cfg(any(target_os = "macos", target_os = "windows"))]
struct DeckMonitorTarget {
    _render_texture: wgpu::Texture,
    render_view: wgpu::TextureView,
    export: NativeOutputExport,
}

/// One multi-output slice presented on its own physical display. Same shape
/// as a deck monitor — an offscreen composite plus a shared-texture export —
/// but sized to the display and carrying the slice's own output transform, so
/// each projector gets a full-resolution native composite of its own region
/// instead of a second WebGL renderer cropping a downscaled master.
struct SliceOutputTarget {
    _render_texture: wgpu::Texture,
    render_view: wgpu::TextureView,
    export: NativeOutputExport,
}

/// Largest output-warp control grid the compositor stores, matching the
/// per-layer mesh cap. Larger grids from the editor are rejected rather than
/// silently truncated into a scrambled warp.
const WARP_MESH_MAX_DIM: usize = 16;

/// Read a `{x, y}` point, defaulting to the identity position given.
fn warp_point_at(value: Option<&Value>, fallback: [f32; 2]) -> [f32; 2] {
    let Some(point) = value else { return fallback };
    [
        number_at(point, &["x"]).unwrap_or(fallback[0] as f64) as f32,
        number_at(point, &["y"]).unwrap_or(fallback[1] as f64) as f32,
    ]
}

/// Corner quad packed for the shader as (TL.xy, TR.xy) and (BR.xy, BL.xy).
fn warp_corners_at(params: Option<&Value>) -> ([f32; 4], [f32; 4]) {
    let tl = warp_point_at(params.and_then(|v| v.get("topLeft")), [0.0, 0.0]);
    let tr = warp_point_at(params.and_then(|v| v.get("topRight")), [1.0, 0.0]);
    let br = warp_point_at(params.and_then(|v| v.get("bottomRight")), [1.0, 1.0]);
    let bl = warp_point_at(params.and_then(|v| v.get("bottomLeft")), [0.0, 1.0]);
    ([tl[0], tl[1], tr[0], tr[1]], [br[0], br[1], bl[0], bl[1]])
}

/// Flatten a `{rows, cols, points: [[{x,y}]]}` grid into the packed control
/// point array (two points per vec4, row-major). Returns (rows, cols, mesh)
/// with rows/cols zeroed when the grid is absent or unusable, which the
/// shader reads as "no mesh".
fn warp_mesh_at(params: Option<&Value>) -> (f32, f32, [[f32; 4]; 128]) {
    let mut mesh = [[0.0f32; 4]; 128];
    let Some(grid) = params else { return (0.0, 0.0, mesh) };
    let rows = number_at(grid, &["rows"]).unwrap_or(0.0) as usize;
    let cols = number_at(grid, &["cols"]).unwrap_or(0.0) as usize;
    if !(2..=WARP_MESH_MAX_DIM).contains(&rows) || !(2..=WARP_MESH_MAX_DIM).contains(&cols) {
        return (0.0, 0.0, mesh);
    }
    let Some(points) = grid.get("points").and_then(Value::as_array) else {
        return (0.0, 0.0, mesh);
    };
    for row in 0..rows {
        let Some(row_points) = points.get(row).and_then(Value::as_array) else {
            return (0.0, 0.0, mesh);
        };
        for col in 0..cols {
            // Identity fallback keeps a short row from folding the warp onto
            // itself; a malformed grid degrades to a flat pass-through cell.
            let fallback = [
                col as f32 / (cols - 1) as f32,
                row as f32 / (rows - 1) as f32,
            ];
            let point = warp_point_at(row_points.get(col), fallback);
            let index = row * cols + col;
            let slot = index / 2;
            if slot >= mesh.len() {
                break;
            }
            if index % 2 == 0 {
                mesh[slot][0] = point[0];
                mesh[slot][1] = point[1];
            } else {
                mesh[slot][2] = point[0];
                mesh[slot][3] = point[1];
            }
        }
    }
    (rows as f32, cols as f32, mesh)
}

/// Upper bound on simultaneously-presented slice displays. Each one costs a
/// full composite pass per frame, so this is a guardrail against a project
/// with dozens of configured screens stalling the render loop.
const MAX_SLICE_OUTPUTS: usize = 8;

/// Editor-side description of a slice output: where it presents and how the
/// master composition maps onto it.
#[derive(Clone)]
struct SliceOutputSpec {
    id: String,
    width: u32,
    height: u32,
    stage: OutputStage,
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
    bytes_b64: Option<String>,
}

#[derive(Clone, Debug)]
struct IsfUniformState {
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
    input_params: [f32; MAX_NATIVE_ISF_PARAM_FLOATS],
    /// (param offset, source id) for bound image inputs; resolved to live
    /// source-frame slots at render time, never at apply time.
    image_sources: Vec<(usize, String)>,
    seq: u64,
}

impl IsfUniformState {
    fn native_params(&self, shader_id: &str) -> [f32; MAX_NATIVE_ISF_PARAM_FLOATS] {
        let seed = unit_from_hash(stable_hash64(shader_id));
        let float_seed = unit_from_hash(self.float_hash);
        let point_seed = unit_from_hash(self.point_hash);
        let color_seed = unit_from_hash(self.color_hash);
        let level = self.audio0[0].clamp(0.0, 1.0);
        let bass = self.audio0[1].clamp(0.0, 1.0);
        let high = self.audio1[0].clamp(0.0, 1.0);
        let beat = self.audio1[1].clamp(0.0, 1.0);
        let bpm = self.audio1[3].clamp(0.0, 300.0);
        let mut params = [0.0; MAX_NATIVE_ISF_PARAM_FLOATS];
        params[..8].copy_from_slice(&[
            (0.82 + level * 1.2 + beat * 0.35).clamp(0.0, 4.0),
            (0.52 + seed * 2.2 + float_seed * 0.8).clamp(0.18, 4.0),
            (0.24 + bass * 0.46 + point_seed * 0.30).clamp(0.0, 1.0),
            (0.16 + bpm / 180.0 + high * 0.45).clamp(0.0, 2.0),
            seed,
            (0.18 + color_seed * 0.72).clamp(0.0, 1.0),
            (0.20 + (self.input_count as f32 / 48.0) + float_seed * 0.24).clamp(0.0, 1.0),
            1.0,
        ]);
        params
    }

    fn declared_input_params(&self) -> [f32; MAX_NATIVE_ISF_PARAM_FLOATS] {
        self.input_params
    }
}

impl NativeShaderUniforms {
    fn from_isf(
        shader_id: &str,
        state: Option<&IsfUniformState>,
        fallback_width: u32,
        fallback_height: u32,
        params: [f32; MAX_NATIVE_ISF_PARAM_FLOATS],
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
        let mut params_extra = [[0.0; 4]; NATIVE_ISF_EXTRA_PARAM_VEC4S];
        for (index, chunk) in params[8..].chunks_exact(4).enumerate() {
            params_extra[index].copy_from_slice(chunk);
        }
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
            params_extra,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct ShaderRecord {
    shader_id: String,
    stage: String,
    entry: String,
    source_kind: String,
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
    /// Slot holding this layer's core-rendered FS/ISF shader frame — kept
    /// separate from frame_slot so an effect chain can DISPLAY its output on
    /// the layer while still SAMPLING the raw shader render as input.
    shader_frame_slot: Option<usize>,
    color: [f32; 4],
    corners: [[f32; 2]; 4],
    native_params: [f32; 8],
    blend_code: f32,
    uv0: [f32; 4],
    uv1: [f32; 4],
    shape: [f32; 4],
    shape2: [f32; 4],
    shape_meta: [f32; 4],
    shape_pts: Vec<[f32; 4]>,
    effects: [[f32; 4]; 4],
    effect_count: f32,
    edge_effects: [[[f32; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS],
    mask_info: [f32; 4],
    mask_points: Vec<[f32; 4]>,
    mesh_rows: u32,
    mesh_cols: u32,
    mesh_points: Vec<[f32; 2]>,
    source_rect: [f32; 4],
    /// VJ deck-monitor tag: Some(0)=bank A, Some(1)=bank B. Tagged layers
    /// re-render into the deck confidence monitor targets at
    /// `deck_monitor_opacity` (their true pre-crossfader level).
    deck_monitor_bank: Option<u8>,
    deck_monitor_opacity: f32,
}

#[derive(Clone, Debug)]
struct PendingMediaBinding {
    source_id: String,
    source_type: String,
}

#[derive(Clone, Debug)]
struct NativePlanetGraphState {
    prev_frame_time: f32,
    accum_rotation: f32,
    cloud_phase: f32,
}

impl NativePlanetGraphState {
    fn new(time: f32) -> Self {
        Self {
            prev_frame_time: time,
            accum_rotation: 0.0,
            cloud_phase: 0.0,
        }
    }
}

const INK_CLOUD_PARTICLE_BYTES: u64 = 64;
const INK_CLOUD_DEFAULT_PARTICLES: u32 = 150_000;
const INK_CLOUD_MAX_PARTICLES: u32 = 600_000;
const INK_CLOUD_MAX_EMITTERS: usize = 8;
const VOLUMETRIC_SPHERES_STRIDE_FLOATS: usize = 12;
const VOLUMETRIC_SPHERES_MIN: u32 = 1;
const VOLUMETRIC_SPHERES_MAX: u32 = 1200;

#[derive(Clone, Debug)]
struct NativeInkCloudGraphState {
    particle_count: u32,
    seed_key: String,
    prev_frame_time: f32,
    auto_rot_x_phase: f32,
    auto_rot_y_phase: f32,
    auto_rot_z_phase: f32,
    burst_hold_timer: f32,
    prev_bass: f32,
}

impl NativeInkCloudGraphState {
    fn new(particle_count: u32, seed_key: String, time: f32) -> Self {
        Self {
            particle_count,
            seed_key,
            prev_frame_time: time,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
            burst_hold_timer: 0.0,
            prev_bass: 0.0,
        }
    }
}

const SMOKE_3D_MAX_EMITTERS: usize = 8;
const SMOKE_3D_PRESSURE_ITERATIONS: usize = 20;

#[derive(Clone, Debug)]
struct NativeSmoke3DGraphState {
    grid: u32,
    vel_flip: bool,
    den_flip: bool,
    prs_flip: bool,
    splat_timer: f32,
    prev_bass: f32,
    burst_hold_timer: f32,
    auto_rot_x_phase: f32,
    auto_rot_y_phase: f32,
    auto_rot_z_phase: f32,
    prev_frame_time: f32,
}

impl NativeSmoke3DGraphState {
    fn new(grid: u32, time: f32) -> Self {
        Self {
            grid,
            vel_flip: false,
            den_flip: false,
            prs_flip: false,
            splat_timer: 0.0,
            prev_bass: 0.0,
            burst_hold_timer: 0.0,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
            prev_frame_time: time,
        }
    }
}

/// Smoke Riders keeps ONE state block: the fluid ping-pong flags plus the
/// rider population identity. The old build carried two independent states
/// (a smoke state and a sphere state) because it was two instruments
/// stacked; the coupled instrument is a single simulation.
#[derive(Clone, Debug)]
struct NativeSmokeRidersGraphState {
    grid: u32,
    rider_count: u32,
    tile_count_x: u32,
    tile_count_y: u32,
    vel_flip: bool,
    den_flip: bool,
    prs_flip: bool,
    splat_timer: f32,
    prev_bass: f32,
    burst_hold_timer: f32,
    auto_rot_x_phase: f32,
    auto_rot_y_phase: f32,
    auto_rot_z_phase: f32,
    prev_frame_time: f32,
}

impl NativeSmokeRidersGraphState {
    fn new(grid: u32, rider_count: u32, tile_count_x: u32, tile_count_y: u32, time: f32) -> Self {
        Self {
            grid,
            rider_count,
            tile_count_x,
            tile_count_y,
            vel_flip: false,
            den_flip: false,
            prs_flip: false,
            splat_timer: 0.0,
            prev_bass: 0.0,
            burst_hold_timer: 0.0,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
            prev_frame_time: time,
        }
    }
}

impl Default for NativeSmokeRidersGraphState {
    fn default() -> Self {
        Self::new(48, 320, 120, 68, 0.0)
    }
}

#[derive(Clone, Debug)]
struct NativeVolumetricSpheresGraphState {
    layout_id: u32,
    sphere_count: u32,
    seed_key: String,
    prev_frame_time: f32,
    auto_rot_x_phase: f32,
    auto_rot_y_phase: f32,
    auto_rot_z_phase: f32,
}

impl NativeVolumetricSpheresGraphState {
    fn new(layout_id: u32, sphere_count: u32, seed_key: String, time: f32) -> Self {
        Self {
            layout_id,
            sphere_count,
            seed_key,
            prev_frame_time: time,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
        }
    }
}

#[derive(Clone, Debug)]
struct NativeParticleFieldGraphState {
    mode_id: u32,
    particle_count: u32,
    prev_frame_time: f32,
    burst_impulse: f32,
    prev_bass: f32,
    hue_shift_phase: f32,
    color_cycle_phase: f32,
    auto_rot_x_phase: f32,
    auto_rot_y_phase: f32,
    auto_rot_z_phase: f32,
}

#[derive(Clone, Debug)]
struct NativePixelParticlesGraphState {
    mode_id: u32,
    particle_count: u32,
    input_source_id: String,
    prev_frame_time: f32,
}

impl NativePixelParticlesGraphState {
    fn new(mode_id: u32, particle_count: u32, input_source_id: String, time: f32) -> Self {
        Self {
            mode_id,
            particle_count,
            input_source_id,
            prev_frame_time: time,
        }
    }
}

#[derive(Clone, Debug)]
struct NativeFlythroughGraphState {
    particle_count: u32,
    input_source_id: String,
    prev_frame_time: f32,
    fly_distance: f32,
}

#[derive(Clone, Debug)]
struct NativePointCloudGraphState {
    signature: String,
    point_count: u32,
    prev_frame_time: f32,
    hue_shift_phase: f32,
    color_cycle_phase: f32,
    burst_impulse: f32,
    prev_bass: f32,
    wave_time: f32,
    auto_rot_x_phase: f32,
    auto_rot_y_phase: f32,
    auto_rot_z_phase: f32,
}

impl NativePointCloudGraphState {
    fn new(signature: String, point_count: u32, time: f32) -> Self {
        Self {
            signature,
            point_count,
            prev_frame_time: time,
            hue_shift_phase: 0.0,
            color_cycle_phase: 0.0,
            burst_impulse: 0.0,
            prev_bass: 0.0,
            wave_time: 0.0,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
        }
    }
}

impl NativeFlythroughGraphState {
    fn new(particle_count: u32, input_source_id: String, time: f32) -> Self {
        Self {
            particle_count,
            input_source_id,
            prev_frame_time: time,
            fly_distance: 0.0,
        }
    }
}

impl NativeParticleFieldGraphState {
    fn new(mode_id: u32, particle_count: u32, time: f32) -> Self {
        Self {
            mode_id,
            particle_count,
            prev_frame_time: time,
            burst_impulse: 0.0,
            prev_bass: 0.0,
            hue_shift_phase: 0.0,
            color_cycle_phase: 0.0,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum NativeGraphLayerKind {
    Lines,
    Svg,
    LightPainting,
    Text,
    Splat,
    Model3D,
    Planet,
    InkCloud,
    Smoke3D,
    ParticleField,
    PixelParticles,
    Flythrough,
    PointCloudFx,
    SmokeRiders,
    FluidRiders,
    VolumetricSpheres,
    GhostFx,
    HandFx,
    PerformerWorld,
    VjCrossfade,
    VjMix,
    Unsupported(String),
}

impl NativeGraphLayerKind {
    fn from_label(label: &str) -> Self {
        match label.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "lines" => Self::Lines,
            "svg" => Self::Svg,
            "light-painting" | "lightpainting" => Self::LightPainting,
            "text" => Self::Text,
            "splat" => Self::Splat,
            "model3d" => Self::Model3D,
            "planet" => Self::Planet,
            "ink-cloud" => Self::InkCloud,
            "smoke-3d" | "3d-smoke" => Self::Smoke3D,
            "particle-field" | "gravity-wells" => Self::ParticleField,
            "pixel-particles" => Self::PixelParticles,
            "flythrough" => Self::Flythrough,
            "point-cloud-fx" => Self::PointCloudFx,
            "smoke-riders" => Self::SmokeRiders,
            "fluid-riders" => Self::FluidRiders,
            "volumetric-spheres" | "volumetric-balls" => Self::VolumetricSpheres,
            "ghostfx" => Self::GhostFx,
            "handfx" => Self::HandFx,
            "performer-world" => Self::PerformerWorld,
            "vj-crossfade" => Self::VjCrossfade,
            "vj-mix" => Self::VjMix,
            other => Self::Unsupported(other.to_string()),
        }
    }

    fn signature(&self) -> &str {
        match self {
            Self::Lines => "lines",
            Self::Svg => "svg",
            Self::LightPainting => "light-painting",
            Self::Text => "text",
            Self::Splat => "splat",
            Self::Model3D => "model3d",
            Self::Planet => "planet",
            Self::InkCloud => "ink-cloud",
            Self::Smoke3D => "smoke-3d",
            Self::ParticleField => "particle-field",
            Self::PixelParticles => "pixel-particles",
            Self::Flythrough => "flythrough",
            Self::PointCloudFx => "point-cloud-fx",
            Self::SmokeRiders => "smoke-riders",
            Self::FluidRiders => "fluid-riders",
            Self::VolumetricSpheres => "volumetric-spheres",
            Self::GhostFx => "ghostfx",
            Self::HandFx => "handfx",
            Self::PerformerWorld => "performer-world",
            Self::VjCrossfade => "vj-crossfade",
            Self::VjMix => "vj-mix",
            Self::Unsupported(label) => label.as_str(),
        }
    }

    fn is_supported(&self) -> bool {
        matches!(
            self,
            Self::Lines
                | Self::Svg
                | Self::LightPainting
                | Self::Text
                | Self::Splat
                | Self::Model3D
                | Self::Planet
                | Self::InkCloud
                | Self::Smoke3D
                | Self::ParticleField
                | Self::PixelParticles
                | Self::Flythrough
                | Self::PointCloudFx
                | Self::SmokeRiders
                | Self::FluidRiders
                | Self::VolumetricSpheres
                | Self::GhostFx
                | Self::HandFx
                | Self::PerformerWorld
                | Self::VjCrossfade
                | Self::VjMix
        )
    }
}

/// Per-layer running state for the GhostFX Liquid injection engine — beat
/// edge detection and the fractional bass-trickle accumulator survive across
/// frames so bursts fire on rising edges only and droplet rates stay smooth.
#[derive(Clone, Copy, Debug, Default)]
struct NativePluginLiquidState {
    prev_beat_pulse: f32,
    ambient_accumulator: f32,
}

/// Milkdrop-style smoothed audio for plugin uniforms: fast attack so hits
/// land, slow release so nothing strobes. Raw analyzer values are only used
/// for edge detection (beat bursts); everything the eye tracks continuously
/// (splat force, palette, emitter speed) reads these envelopes instead.
#[derive(Clone, Copy, Debug, Default)]
struct NativePluginAudioSmooth {
    bass: f32,
    mid: f32,
    treble: f32,
    energy: f32,
    beat_env: f32,
    last_frame: u64,
}

impl NativePluginAudioSmooth {
    fn follow(current: f32, target: f32, dt: f32, attack_tau: f32, release_tau: f32) -> f32 {
        let tau = if target > current {
            attack_tau
        } else {
            release_tau
        };
        current + (target - current) * (1.0 - (-dt / tau.max(1e-3)).exp())
    }

    fn update(
        &mut self,
        frame_index: u64,
        dt: f32,
        audio0: [f32; 4],
        audio1: [f32; 4],
        reactivity: f32,
    ) {
        if self.last_frame == frame_index && frame_index != 0 {
            return;
        }
        self.last_frame = frame_index;
        let dt = dt.clamp(0.0, 0.1);
        // Reactivity (0 = glacial, 1 = snappy) stretches the release taus and
        // caps the beat envelope peak, so the default sits well away from the
        // strobe zone while still letting VJs dial the punch back in.
        let smoothness = (1.0 - reactivity).clamp(0.0, 1.0);
        let rel = 1.0 + smoothness * 2.4;
        let atk = 1.0 + smoothness * 1.2;
        self.bass = Self::follow(self.bass, audio0[1], dt, 0.045 * atk, 0.30 * rel);
        self.mid = Self::follow(self.mid, audio0[2], dt, 0.045 * atk, 0.24 * rel);
        self.treble = Self::follow(self.treble, audio0[3], dt, 0.040 * atk, 0.18 * rel);
        self.energy = Self::follow(self.energy, audio0[0], dt, 0.050 * atk, 0.35 * rel);
        // Beat becomes an envelope: snaps up on the pulse, glides down.
        if audio1[1] > 0.5 {
            self.beat_env = self.beat_env.max(0.35 + 0.65 * reactivity.clamp(0.0, 1.0));
        }
        self.beat_env = Self::follow(self.beat_env, 0.0, dt, 0.02, 0.32 * rel);
    }
}

/// Minimal HSV→RGB for splat dye colors (h/s/v in 0..1).
fn hsv_to_rgb(h: f32, s: f32, v: f32) -> [f32; 3] {
    let h6 = (h.rem_euclid(1.0)) * 6.0;
    let sector = h6.floor() as i32 % 6;
    let f = h6 - h6.floor();
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    match sector {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}

#[derive(Clone, Debug)]
struct NativeGraphLayer {
    layer_id: String,
    source_id: String,
    input_source_id: String,
    kind: NativeGraphLayerKind,
    params: Value,
    effect_job_template: Option<NativeGraphFrameJob>,
    planet_state: NativePlanetGraphState,
    ink_cloud_state: NativeInkCloudGraphState,
    smoke_3d_state: NativeSmoke3DGraphState,
    particle_field_state: NativeParticleFieldGraphState,
    pixel_particles_state: NativePixelParticlesGraphState,
    flythrough_state: NativeFlythroughGraphState,
    point_cloud_state: NativePointCloudGraphState,
    volumetric_spheres_state: NativeVolumetricSpheresGraphState,
    smoke_riders_state: NativeSmokeRidersGraphState,
}

enum NativeGraphLayerState {
    Planet(NativePlanetGraphState),
    InkCloud(NativeInkCloudGraphState),
    Smoke3D(NativeSmoke3DGraphState),
    ParticleField(NativeParticleFieldGraphState),
    PixelParticles(NativePixelParticlesGraphState),
    Flythrough(NativeFlythroughGraphState),
    PointCloudFx(NativePointCloudGraphState),
    SmokeRiders(NativeSmokeRidersGraphState),
    VolumetricSpheres(NativeVolumetricSpheresGraphState),
}

#[derive(Clone, Debug)]
struct NativeGraphFrameJob {
    buffers: Vec<NativeComputeGraphBufferSpec>,
    pass_plans: Vec<NativeComputeGraphPassPlan>,
    render_plans: Vec<NativeComputeGraphRenderPlan>,
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
            shader_frame_slot: None,
            corners: [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            native_params: default_native_params(),
            blend_code: 0.0,
            uv0: [0.0, 0.0, 1.0, 1.0],
            uv1: [0.0, 1.0, 0.0, 0.0],
            shape: [0.0, 0.0, 0.0, 1.0],
            shape2: [1.0, 0.7, 6.0, 0.4],
            shape_meta: [0.0, 0.0, 0.0, 0.0],
            shape_pts: Vec::new(),
            effects: [[0.0; 4]; 4],
            effect_count: 0.0,
            edge_effects: [[[0.0; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS],
            mask_info: [0.0; 4],
            mask_points: Vec::new(),
            mesh_rows: 0,
            mesh_cols: 0,
            mesh_points: Vec::new(),
            source_rect: [0.0, 0.0, 1.0, 1.0],
            deck_monitor_bank: None,
            deck_monitor_opacity: 1.0,
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
            style: [
                self.blend_code,
                self.effect_count,
                self.mesh_rows as f32,
                self.mesh_cols as f32,
            ],
            uv0: self.uv0,
            uv1: self.uv1,
            shape: self.shape,
            shape2: self.shape2,
            shape_meta: self.shape_meta,
            shape_pts: self.shape_pts_gpu(),
            effect0: self.effects[0],
            effect1: self.effects[1],
            effect2: self.effects[2],
            effect3: self.effects[3],
            edge_effects: self.edge_effects,
            mask_info: self.mask_info,
            mask: self.mask_gpu(),
            mesh: self.mesh_gpu(),
            source_rect: self.source_rect,
        }
    }

    fn shape_pts_gpu(&self) -> [[f32; 4]; 32] {
        let mut packed = [[0.0; 4]; 32];
        for (index, point) in self.shape_pts.iter().take(32).enumerate() {
            packed[index] = *point;
        }
        packed
    }

    fn mask_gpu(&self) -> [[f32; 4]; MAX_LAYER_MASK_POINTS] {
        let mut packed = [[0.0; 4]; MAX_LAYER_MASK_POINTS];
        for (index, point) in self
            .mask_points
            .iter()
            .take(MAX_LAYER_MASK_POINTS)
            .enumerate()
        {
            packed[index] = *point;
        }
        packed
    }

    fn mesh_gpu(&self) -> [[f32; 4]; MAX_LAYER_MESH_VEC4S] {
        let mut packed = [[0.0; 4]; MAX_LAYER_MESH_VEC4S];
        for (index, point) in self
            .mesh_points
            .iter()
            .take(MAX_LAYER_MESH_POINTS)
            .enumerate()
        {
            let target = &mut packed[index / 2];
            let offset = (index % 2) * 2;
            target[offset] = point[0];
            // Layer mesh points use OpenGL-style y=1 at the top. The native
            // compositor's quad-local coordinate uses y=0 at the top.
            target[offset + 1] = 1.0 - point[1];
        }
        packed
    }
}

fn set_scene_layer_color(layer: &mut SceneLayer, rgba: [f32; 4]) {
    layer.color = rgba;
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
    inside_encoders: bool,
}

impl GpuTimingState {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue, inside_encoders: bool) -> Self {
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
            inside_encoders,
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
    /// True when wgpu selected a software rasterizer (WARP) rather than a
    /// real GPU — the compatibility fallback added for machines with no
    /// usable graphics adapter. Surfaced in status so the app can tell the
    /// operator they are in a degraded mode instead of leaving them to
    /// wonder why everything is slow.
    adapter_is_software: bool,
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
    native_graph_source_frame_sample_texture: wgpu::Texture,
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
    _native_graph_source_depth_texture: wgpu::Texture,
    native_graph_source_depth_view: wgpu::TextureView,
    native_shader_pipelines: HashMap<String, NativeShaderPipeline>,
    native_compute_pipelines: HashMap<String, NativeComputePipeline>,
    native_graph_render_pipelines: HashMap<String, NativeGraphRenderPipeline>,
    native_compute_graph_buffers: HashMap<String, NativeComputeGraphGpuBuffer>,
    output_mirror_texture: wgpu::Texture,
    output_mirror_view: wgpu::TextureView,
    surface_copy_dst_supported: bool,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    output_export: Option<NativeOutputExport>,
    /// Deck confidence monitors: two small shared-texture targets (bank A,
    /// bank B) the VJ panel presents beside Program. Created lazily on the
    /// first frame that carries deck-monitor-tagged layers.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    deck_monitor_targets: Option<[DeckMonitorTarget; 2]>,
    /// Per-slice display targets, keyed by the editor's slice id.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    slice_targets: HashMap<String, SliceOutputTarget>,
    snapshot_texture: wgpu::Texture,
    snapshot_view: wgpu::TextureView,
    /// Cached downscale target for preview-sized snapshot readbacks
    /// (composite mirror: projection sim, WLED sampling). Recreated only
    /// when the requested size changes.
    snapshot_preview: Option<(wgpu::Texture, TextureBlitter, u32, u32)>,
    last_frame_metrics: Option<SnapshotMetrics>,
    bind_group: wgpu::BindGroup,
    start_time: Instant,
    gpu_timing: Option<GpuTimingState>,
    gpu_frames_submitted: u64,
    gpu_frames_completed: Arc<AtomicU64>,
    gpu_completion_tx: Sender<wgpu::SubmissionIndex>,
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

struct NativeVideoStreamState {
    signature: String,
    stream: NativeVideoStream,
    seek_generation: u64,
    seq: u64,
    playing: bool,
    next_frame_at: Instant,
    last_used_frame: u64,
    frames_presented: u64,
    triggered_at: Option<Instant>,
}

#[derive(Clone)]
struct NativeVideoScrubRequest {
    seq: u64,
    frame_bucket: u64,
    uri: String,
    width: usize,
    height: usize,
    time_seconds: f64,
    hold_until: Instant,
}

#[derive(Clone, Debug)]
struct NativePointCloudAsset {
    signature: String,
    point_count: u32,
    sort_count: u32,
    depth_sort_enabled: bool,
    home_bytes: Vec<u8>,
    live_bytes: Vec<u8>,
    sort_bytes: Vec<u8>,
}

struct App {
    response_tx: Sender<String>,
    event_proxy: EventLoopProxy<UserEvent>,
    renderer: Option<RenderState>,
    adapter_name: Option<String>,
    adapter_is_software: bool,
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
    editor_parent_window_handle_hex: Option<String>,
    editor_parent_window_handle_platform: Option<String>,
    editor_preview_parented_window: bool,
    layers_seen: u32,
    output_last_presented_layer_count: u32,
    command_phase: f32,
    start_time: Instant,
    scene_layers: HashMap<String, SceneLayer>,
    pending_media_bindings: HashMap<String, PendingMediaBinding>,
    native_graph_layers: HashMap<String, NativeGraphLayer>,
    native_plugin_liquid_states: HashMap<String, NativePluginLiquidState>,
    native_plugin_templates_initialized: HashSet<String>,
    native_plugin_audio_smooth: NativePluginAudioSmooth,
    native_point_cloud_assets: HashMap<String, NativePointCloudAsset>,
    pending_native_graph_jobs: Vec<NativeGraphFrameJob>,
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
    native_video_streams: HashMap<String, NativeVideoStreamState>,
    native_video_scrub_requests: HashMap<String, NativeVideoScrubRequest>,
    stage3d_scene: Option<Value>,
    stage3d_scene_summary: NativeSceneBridgeSummary,
    projection_sim_scene: Option<Value>,
    projection_sim_scene_summary: NativeSceneBridgeSummary,
    /// Live output kill switch — blanks the composite the projector sees.
    output_blackout: bool,
    /// Holds the last presented frame instead of compositing new ones.
    output_frozen: bool,
    /// Composite-stage effect chain: composition effects, then macro effect
    /// bundles. Each slot is [op, amount, 0, mix] for the heartbeat
    /// compositor's shared effect evaluator.
    composite_effects: Vec<[f32; 4]>,
    /// Projector-only output transform: crop, rotation, colour grade, edge
    /// blend and dome reprojection.
    output_stage: OutputStage,
    /// Multi-output slices currently presenting on their own displays.
    slice_outputs: Vec<SliceOutputSpec>,
    render_clock_mode: String,
    render_clock_time: Option<f32>,
    render_clock_delta: f32,
    render_clock_frame_index: Option<u64>,
    isf_layer_bindings: HashMap<String, String>,
    isf_uniforms: HashMap<String, IsfUniformState>,
    shader_registry: HashMap<String, ShaderRecord>,
    shader_sources: HashMap<String, Arc<str>>,
    shader_isf_inputs: HashMap<String, Vec<NativeIsfInputBinding>>,
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
    Offscreen,
    Outdated,
    Timeout,
    Occluded,
}

impl SurfacePresentOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Presented => "presented",
            Self::SuboptimalPresented => "suboptimal-presented",
            Self::Offscreen => "offscreen",
            Self::Outdated => "outdated",
            Self::Timeout => "timeout",
            Self::Occluded => "occluded",
        }
    }

    fn presented(self) -> bool {
        matches!(self, Self::Presented | Self::SuboptimalPresented)
    }

    fn offscreen(self) -> bool {
        matches!(self, Self::Offscreen)
    }
}

fn decode_hex_pointer_le(hex: &str) -> Option<usize> {
    let clean = hex.trim();
    if clean.is_empty() || clean.len() % 2 != 0 {
        return None;
    }
    let mut value: usize = 0;
    let max_bytes = std::mem::size_of::<usize>();
    for (index, offset) in (0..clean.len()).step_by(2).take(max_bytes).enumerate() {
        let byte = u8::from_str_radix(&clean[offset..offset + 2], 16).ok()? as usize;
        value |= byte << (index * 8);
    }
    if value == 0 { None } else { Some(value) }
}

fn appkit_parent_window_handle(hex: &str) -> Option<RawWindowHandle> {
    let ptr = decode_hex_pointer_le(hex)? as *mut c_void;
    let ns_view = NonNull::new(ptr)?;
    Some(RawWindowHandle::AppKit(AppKitWindowHandle::new(ns_view)))
}

#[cfg(target_os = "macos")]
fn appkit_window_for_raw_handle(handle: RawWindowHandle) -> Option<Retained<NSWindow>> {
    let RawWindowHandle::AppKit(handle) = handle else {
        return None;
    };
    // SAFETY: The caller supplied a live AppKit NSView handle. We retain it
    // only long enough to ask AppKit for the owning NSWindow.
    let view: Retained<NSView> = unsafe { Retained::retain(handle.ns_view.as_ptr().cast()) }?;
    view.window()
}

#[cfg(target_os = "macos")]
fn promote_appkit_child_window_to_underlay(
    parent_handle: RawWindowHandle,
    child_window: &Window,
) -> bool {
    let Some(parent_window) = appkit_window_for_raw_handle(parent_handle) else {
        return false;
    };
    let Ok(child_handle) = child_window.window_handle() else {
        return false;
    };
    let Some(child_ns_window) = appkit_window_for_raw_handle(child_handle.as_raw()) else {
        return false;
    };

    // Winit creates AppKit child windows ordered above the parent. For the
    // editor preview, the render surface must live below Electron's transparent
    // content window so DOM controls, warp handles, modals, and hit-testing all
    // remain owned by the UI layer while the pixels come from the native core.
    unsafe {
        parent_window.removeChildWindow(&child_ns_window);
        parent_window.addChildWindow_ordered(&child_ns_window, NSWindowOrderingMode::NSWindowBelow);
    }
    child_ns_window.setIgnoresMouseEvents(true);
    true
}

#[cfg(target_os = "macos")]
fn activate_appkit_output_window(window: &Window) {
    let Ok(handle) = window.window_handle() else {
        return;
    };
    let Some(ns_window) = appkit_window_for_raw_handle(handle.as_raw()) else {
        return;
    };
    // SAFETY: native renderer window management runs on winit's macOS event
    // loop thread. The NSWindow is owned by winit for the process lifetime.
    unsafe {
        ns_window.orderFrontRegardless();
    }
    ns_window.makeKeyAndOrderFront(None);
    if let Some(marker) = MainThreadMarker::new() {
        let app = NSApplication::sharedApplication(marker);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
    }
}

#[cfg(not(target_os = "macos"))]
fn activate_appkit_output_window(_window: &Window) {}

#[cfg(target_os = "macos")]
fn set_managed_output_fullscreen(window: &Window, fullscreen: bool) {
    // Projector output must stay in the current macOS workspace. Winit's
    // Borderless fullscreen enters an asynchronous Space transition, which can
    // leave a renderer owned by a helper process occluded behind Electron. The
    // caller already supplies the target display's exact x/y/width/height, so a
    // borderless top-level window is the correct fullscreen primitive here.
    window.set_fullscreen(None);
    window.set_decorations(!fullscreen);
    set_appkit_projector_presentation(fullscreen);
}

#[cfg(not(target_os = "macos"))]
fn set_managed_output_fullscreen(window: &Window, fullscreen: bool) {
    window.set_fullscreen(if fullscreen {
        Some(Fullscreen::Borderless(None))
    } else {
        None
    });
}

#[cfg(target_os = "macos")]
fn set_appkit_projector_presentation(fullscreen: bool) {
    let Some(marker) = MainThreadMarker::new() else {
        return;
    };
    let app = NSApplication::sharedApplication(marker);
    let options = if fullscreen {
        NSApplicationPresentationOptions::NSApplicationPresentationHideDock
            | NSApplicationPresentationOptions::NSApplicationPresentationHideMenuBar
    } else {
        NSApplicationPresentationOptions::NSApplicationPresentationDefault
    };
    app.setPresentationOptions(options);
}

#[cfg(not(target_os = "macos"))]
fn set_appkit_projector_presentation(_fullscreen: bool) {}

#[cfg(not(target_os = "macos"))]
fn promote_appkit_child_window_to_underlay(
    _parent_handle: RawWindowHandle,
    _child_window: &Window,
) -> bool {
    false
}

impl App {
    fn new(response_tx: Sender<String>, event_proxy: EventLoopProxy<UserEvent>) -> Self {
        Self {
            response_tx,
            event_proxy,
            renderer: None,
            adapter_name: None,
            adapter_is_software: false,
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
            output_window_attached: false,
            editor_parent_window_handle_hex: None,
            editor_parent_window_handle_platform: None,
            editor_preview_parented_window: false,
            layers_seen: 0,
            output_last_presented_layer_count: 0,
            command_phase: 0.0,
            start_time: Instant::now(),
            scene_layers: HashMap::new(),
            pending_media_bindings: HashMap::new(),
            native_graph_layers: HashMap::new(),
            native_plugin_liquid_states: HashMap::new(),
            native_plugin_templates_initialized: HashSet::new(),
            native_plugin_audio_smooth: NativePluginAudioSmooth::default(),
            native_point_cloud_assets: HashMap::new(),
            pending_native_graph_jobs: Vec::new(),
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
            native_video_streams: HashMap::new(),
            native_video_scrub_requests: HashMap::new(),
            stage3d_scene: None,
            stage3d_scene_summary: NativeSceneBridgeSummary::empty("stage3d"),
            projection_sim_scene: None,
            projection_sim_scene_summary: NativeSceneBridgeSummary::empty("projection-sim"),
            output_blackout: false,
            output_frozen: false,
            composite_effects: Vec::new(),
            output_stage: OutputStage::default(),
            slice_outputs: Vec::new(),
            render_clock_mode: "live".to_string(),
            render_clock_time: None,
            render_clock_delta: 1.0 / 60.0,
            render_clock_frame_index: None,
            isf_layer_bindings: HashMap::new(),
            isf_uniforms: HashMap::new(),
            shader_registry: HashMap::new(),
            shader_sources: HashMap::new(),
            shader_isf_inputs: HashMap::new(),
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
        let mut attrs = WindowAttributes::default()
            .with_title("Ghost Render Core")
            .with_inner_size(LogicalSize::new(
                self.pending_width as f64,
                self.pending_height as f64,
            ))
            .with_resizable(true)
            .with_visible(self.output_window_attached);
        self.editor_preview_parented_window = false;
        let mut editor_parent_handle_for_underlay: Option<RawWindowHandle> = None;
        if cfg!(target_os = "macos") {
            if let Some(handle_hex) = self.editor_parent_window_handle_hex.as_deref() {
                if matches!(
                    self.editor_parent_window_handle_platform.as_deref(),
                    Some("appkit-nsview") | Some("darwin") | Some("macos") | None
                ) {
                    if let Some(parent_handle) = appkit_parent_window_handle(handle_hex) {
                        // SAFETY: Electron owns this NSView for the lifetime of the main window.
                        // If the handle is stale, winit returns a creation error instead of
                        // silently making an unparented preview.
                        attrs = unsafe { attrs.with_parent_window(Some(parent_handle)) };
                        self.editor_preview_parented_window = true;
                        editor_parent_handle_for_underlay = Some(parent_handle);
                    }
                }
            }
        }
        let window = event_loop
            .create_window(attrs)
            .map_err(|err| err.to_string())?;
        let window: &'static Window = Box::leak(Box::new(window));
        if let Some(parent_handle) = editor_parent_handle_for_underlay {
            self.editor_preview_parented_window =
                promote_appkit_child_window_to_underlay(parent_handle, window);
        }
        let renderer = pollster::block_on(RenderState::new(
            window,
            self.pending_width.max(1),
            self.pending_height.max(1),
            &self.present_mode,
            self.allow_tearing,
            self.max_frame_latency,
            &self.native_quality.policy,
            self.event_proxy.clone(),
        ))?;
        self.native_quality
            .rebase_to_caps(&renderer.native_caps.recommended_quality_tier);
        self.adapter_name = renderer.adapter_name();
        self.adapter_is_software = renderer.adapter_is_software;
        self.renderer = Some(renderer);
        Ok(())
    }

    fn capabilities(&self) -> Value {
        let shared_texture_media_transport = self.shared_texture_media_transport_ready();
        let source_frame_shared_texture_import = self.source_frame_shared_texture_import_contract();
        let output_shared_texture_export = self.output_shared_texture_export_contract();
        let source_frame_shared_texture_import_ready = source_frame_shared_texture_import
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let output_shared_texture_export_ready = output_shared_texture_export
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // The render core can publish the one true composite frame before the
        // editor has a production presenter for it. Do not treat the old
        // child-window/underlay probe as ready: on macOS it can be compositor
        // occluded and it still competes with DOM z-order. Full native waits for
        // the embedded shared-texture presenter.
        let native_editor_preview_frame_source_ready = output_shared_texture_export_ready;
        let native_editor_preview = json!({
            "available": false,
            "mode": if native_editor_preview_frame_source_ready {
                "embedded-presenter-pending"
            } else {
                "unavailable"
            },
            "presentation": if self.editor_preview_parented_window { "parented-underlay-probe" } else { "unavailable" },
            "needs_underlay_lock_in": true,
            "production_ready": false,
            "parented": self.editor_preview_parented_window,
            "source": if native_editor_preview_frame_source_ready { "core-output-composite" } else { "native-unavailable" },
            "single_render": native_editor_preview_frame_source_ready,
            "transport": if native_editor_preview_frame_source_ready {
                output_shared_texture_export
                    .get("platform")
                    .and_then(Value::as_str)
                    .unwrap_or("shared-texture")
            } else {
                "none"
            },
            "color_space": "srgb",
            "storage_format": "bgra8unorm",
            "storage_encoding": "srgb-encoded-bgra8unorm",
            "alpha_mode": "opaque",
            "premultiplied_alpha": false,
            "zero_conversions": true,
            "reason": if native_editor_preview_frame_source_ready {
                json!("native core-output composite is available; editor embedded shared-texture presenter is pending")
            } else {
                json!("native output shared-texture export is unavailable")
            },
        });
        let features = json!({
            "separate_process_render_core": true,
            "managed_native_window": true,
            "audio_uniform_layout": true,
            "layer_compositor": true,
            "layer_corner_warp": true,
            "layer_uv_controls": true,
            "layer_shape_masks": true,
            "layer_mesh_warp": true,
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
            "isf_glsl_parse_probe": true,
            "isf_glsl_host": true,
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
            "vram_budget_enforcement": true,
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
            "native_effect_pass_manifest": true,
            "persistent_compute_buffers": true,
            "native_planet_graph": true,
            "native_lines_graph": true,
            "native_svg_graph": true,
            "native_light_painting_graph": true,
            "native_text_graph": true,
            "native_splat_graph": true,
            "native_model3d_graph": true,
            "native_3d_smoke_graph": true,
            "native_particle_field_graph": true,
            "native_volumetric_spheres_graph": true,
            "native_smoke_riders_graph": true,
            "native_ink_cloud_graph": true,
            "native_flythrough_graph": true,
            "native_pixel_particles_graph": true,
            "native_point_cloud_fx_graph": true,
            "native_ghostfx_graph": true,
            "native_handfx_graph": true,
            "native_performer_world_graph": true,
            "native_vj_crossfade_graph": true,
            "native_vj_mix_graph": true,
            "command_drain_policy": true,
            "auto_present_policy": true,
            "multi_pass_instruments": true,
            "storage_buffer_instruments": true,
            "shared_texture_source_frame_upload": source_frame_shared_texture_import_ready,
            "native_output_mirror_texture": true,
            "shared_texture_upload": shared_texture_media_transport,
            "shared_texture_output_export": output_shared_texture_export_ready,
            "native_texture_share_sender": false,
            "native_editor_preview_frame_source": output_shared_texture_export_ready,
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
            "native_stage3d_recording_parity": true,
            "native_projection_sim_scene_ingest": true,
            "native_projection_sim_overlay_preview": true,
            "native_projection_sim_mesh_preview": true,
            "native_projection_sim_textured_mesh_preview": true,
            "native_projection_sim_xyz_mesh_transforms": true,
            "native_projection_sim_output_renderer": true,
            "native_projection_sim_recording_parity": true,
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
            "native_effect_pass_descriptors": native_effect_pass_manifest(),
            "native_graph_instruments": native_graph_instrument_ids(),
            "native_graph_instrument_manifest": native_graph_instrument_manifest(),
            "audio_uniform_layout": ghost_audio_uniform_layout(),
            "source_frame_shared_texture_import": source_frame_shared_texture_import,
            "output_shared_texture_export": output_shared_texture_export,
            "native_editor_preview": native_editor_preview,
            "native_scene_bridge": {
                "stage3d": self.stage3d_scene_summary,
                "projection_sim": self.projection_sim_scene_summary,
            },
            "features": features,
            "limits": limits,
            "notes": [
                native_graph_instruments_note(),
                shared_texture_media_transport_note(),
                "Native frame export is owned by the render core; MP4/JPEG sequence encoding is completed by the Electron bridge.",
                "Local video media decode is render-clock driven in the native core: visible video sources pump FFmpeg-decoded frame windows into native source-frame textures with adjacent-frame cache prefetch."
            ]
        })
    }

    fn source_frame_shared_texture_import_contract(&self) -> Value {
        let renderer_ready = self.renderer.is_some();
        #[cfg(target_os = "macos")]
        {
            json!({
                "available": renderer_ready,
                "backend": native_backend_name(),
                "platform": "iosurface",
                "importer": "metal-iosurface",
                "handle_scope": "global-id",
                "accepted_handle_encodings": ["integer", "base64", "hex", "opaque"],
                "accepted_formats": ["bgra8unorm", "rgba8unorm", "80", "87", "28", "70"],
                "reason": if renderer_ready { Value::Null } else { json!("native renderer is not running") },
            })
        }
        #[cfg(target_os = "windows")]
        {
            json!({
                "available": renderer_ready,
                "backend": native_backend_name(),
                "platform": "dxgi",
                "importer": "d3d12-open-shared-handle",
                "handle_scope": "process-handle",
                "accepted_handle_encodings": ["integer", "base64", "hex", "opaque"],
                "accepted_formats": ["bgra8unorm", "rgba8unorm", "80", "87", "28", "70"],
                "reason": if renderer_ready { Value::Null } else { json!("native renderer is not running") },
            })
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            json!({
                "available": false,
                "backend": native_backend_name(),
                "platform": "unsupported",
                "importer": "none",
                "handle_scope": "",
                "accepted_handle_encodings": [],
                "accepted_formats": [],
                "reason": "native source-frame shared texture import is only implemented for Metal IOSurface and D3D12 DXGI",
            })
        }
    }

    fn output_shared_texture_export_contract(&self) -> Value {
        let output_export_ready = self
            .renderer
            .as_ref()
            .is_some_and(RenderState::output_export_ready);
        #[cfg(target_os = "macos")]
        {
            json!({
                "available": output_export_ready,
                "backend": native_backend_name(),
                "platform": "iosurface",
                "exporter": "metal-iosurface",
                "handle_scope": "global-id",
                "preferred_transport": "handle",
                "handle_encoding": "integer",
                "handle_byte_length": 4,
                "exported_formats": ["bgra8unorm"],
                "color_space": "srgb",
                "storage_format": "bgra8unorm",
                "storage_encoding": "srgb-encoded-bgra8unorm",
                "alpha_mode": "opaque",
                "premultiplied_alpha": false,
                "single_render_source": "core-output-composite",
                "zero_conversions": true,
                "publisher": "SyphonOutput.publishIOSurface",
                "reason": if output_export_ready { Value::Null } else { json!("native output IOSurface export target is unavailable") },
            })
        }
        #[cfg(target_os = "windows")]
        {
            json!({
                "available": output_export_ready,
                "backend": native_backend_name(),
                "platform": "dxgi",
                "exporter": "d3d12-shared-resource-name",
                "handle_scope": "process-local",
                "preferred_transport": "shared_name",
                "handle_encoding": "integer",
                "handle_byte_length": 8,
                "name_scope": "local-session",
                "exported_formats": ["bgra8unorm"],
                "color_space": "srgb",
                "storage_format": "bgra8unorm",
                "storage_encoding": "srgb-encoded-bgra8unorm",
                "alpha_mode": "opaque",
                "premultiplied_alpha": false,
                "single_render_source": "core-output-composite",
                "zero_conversions": true,
                "publisher": "SpoutOutput.sendTextureByName",
                "reason": if output_export_ready { Value::Null } else { json!("native output DXGI export target is unavailable") },
            })
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            json!({
                "available": false,
                "backend": native_backend_name(),
                "platform": "unsupported",
                "exporter": "none",
                "handle_scope": "",
                "preferred_transport": "",
                "handle_encoding": "",
                "handle_byte_length": 0,
                "exported_formats": [],
                "color_space": "srgb",
                "storage_format": "bgra8unorm",
                "storage_encoding": "srgb-encoded-bgra8unorm",
                "alpha_mode": "opaque",
                "premultiplied_alpha": false,
                "single_render_source": "core-output-composite",
                "zero_conversions": true,
                "publisher": "none",
                "reason": "native output shared-texture export is only implemented for Metal IOSurface and D3D12 DXGI",
            })
        }
    }

    fn shared_texture_media_transport_ready(&self) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.renderer.is_some()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            false
        }
    }

    fn status(&self) -> CoreStatus {
        let gpu_frames_submitted = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.gpu_frames_submitted)
            .unwrap_or(self.stats.gpu_frames_submitted);
        let gpu_frames_completed = self
            .renderer
            .as_ref()
            .map(RenderState::gpu_frames_completed)
            .unwrap_or(self.stats.gpu_frames_completed);
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
        let scene_layers_active = self
            .scene_layers
            .values()
            .filter(|layer| layer.visible && layer.opacity > 0.0)
            .count()
            .min(1024) as u32;
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
        let native_video_sessions = self
            .native_video_streams
            .iter()
            .map(|(source_id, session)| {
                let buffered_frames =
                    session.stream.buffered_frames().min(u32::MAX as usize) as u32;
                NativeVideoSessionStatus {
                    source_id: source_id.clone(),
                    signature: session.signature.clone(),
                    state: if session.playing {
                        "playing".to_string()
                    } else if buffered_frames >= NATIVE_VIDEO_SESSION_PREROLL_MIN as u32 {
                        "prerolled".to_string()
                    } else {
                        "armed".to_string()
                    },
                    buffered_frames,
                    frames_presented: session.frames_presented,
                }
            })
            .collect::<Vec<_>>();
        let native_video_sessions_playing = native_video_sessions
            .iter()
            .filter(|session| session.state == "playing")
            .count()
            .min(u32::MAX as usize) as u32;
        let native_video_sessions_prerolled = native_video_sessions
            .iter()
            .filter(|session| session.state == "prerolled")
            .count()
            .min(u32::MAX as usize) as u32;
        let native_video_sessions_armed = native_video_sessions
            .len()
            .saturating_sub(native_video_sessions_playing as usize)
            .saturating_sub(native_video_sessions_prerolled as usize)
            .min(u32::MAX as usize) as u32;
        CoreStatus {
            running: self.running,
            backend: native_backend_name().to_string(),
            backend_ready: renderer_ready && last_frame_ok,
            adapter_name: self.adapter_name.clone(),
            adapter_is_software: self.adapter_is_software,
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
            native_graph_buffer_bytes: self
                .renderer
                .as_ref()
                .map(RenderState::native_compute_graph_buffer_bytes)
                .unwrap_or(0),
            native_graph_buffer_budget_bytes: self.native_graph_buffer_budget_bytes(),
            vram_evictions: self.stats.vram_evictions,
            vram_evicted_bytes: self.stats.vram_evicted_bytes,
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
            native_video_sessions,
            native_video_sessions_armed,
            native_video_sessions_prerolled,
            native_video_sessions_playing,
            native_video_session_evictions: self.stats.native_video_session_evictions,
            media_sources_active: self.media_sources.len().min(u32::MAX as usize) as u32,
            media_source_orphan_releases: self.stats.media_source_orphan_releases,
            video_oneshot_decodes_during_playback: self.stats.video_oneshot_decodes_during_playback,
            native_video_trigger_last_latency_us: self.stats.native_video_trigger_last_latency_us,
            native_video_trigger_max_latency_us: self.stats.native_video_trigger_max_latency_us,
            native_video_stream_underflows: self.stats.native_video_stream_underflows,
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
            render_clock_time: self.native_graph_time_seconds(),
            render_clock_frame_index: self.native_frame_index(),
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
            gpu_frames_submitted,
            gpu_frames_completed,
            gpu_backpressure_skips: self.stats.gpu_backpressure_skips,
            frames_presented: gpu_frames_completed,
            commands_applied: self.stats.commands_applied,
            commands_dropped: self.stats.commands_dropped,
            layers_seen: self.layers_seen,
            scene_layers_active,
            output_last_presented_layer_count: self.output_last_presented_layer_count,
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
        if id == 0 {
            return;
        }
        let _ = self
            .response_tx
            .send(json!({ "id": id, "ok": true, "result": result }).to_string());
    }

    fn send_error(&self, id: u64, err: impl ToString) {
        if id == 0 {
            return;
        }
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
                    if self.output_window_attached
                        && let Some(renderer) = self.renderer.as_ref()
                    {
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
            // Ground truth for the Electron-side scene reconciler: what
            // geometry the core is ACTUALLY compositing with, so a lost or
            // misapplied upsert_layer can be detected and repaired instead of
            // wedging the picture until the next unrelated edit.
            "layers_snapshot" | "get_layers_snapshot" => {
                let layers = self
                    .scene_layers
                    .values()
                    .map(|layer| {
                        json!({
                            "layer_id": layer.id,
                            "z_index": layer.z_index,
                            "visible": layer.visible,
                            "opacity": layer.opacity,
                            "blend_code": layer.blend_code,
                            "corners": layer.corners,
                            "uv0": layer.uv0,
                            "uv1": layer.uv1,
                            "source_id": layer.source_id,
                            "frame_slot": layer.frame_slot,
                            "shader_frame_slot": layer.shader_frame_slot,
                            "source_kind": layer.source_kind,
                            "shader_rendered": layer.shader_rendered,
                            "mesh_rows": layer.mesh_rows,
                            "mesh_cols": layer.mesh_cols,
                            "mask_info": layer.mask_info,
                            "mask_points_count": layer.mask_points.len(),
                        })
                    })
                    .collect::<Vec<_>>();
                Ok(json!({ "layers": layers }))
            }
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
            "output_shared_texture_snapshot" | "get_output_shared_texture_snapshot" => {
                self.output_shared_texture_snapshot(&req.params)
            }
            "deck_monitor_state" | "get_deck_monitor_state" => Ok(self
                .renderer
                .as_ref()
                .map(RenderState::deck_monitor_metadata)
                .unwrap_or_else(|| json!({ "available": false }))),
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
            "readiness" | "get_readiness_report" => {
                let capabilities = self.capabilities();
                let renderer_ready = self.renderer.is_some();
                let (compute_instrument_host_ok, compute_instrument_host_detail) =
                    native_compute_host_readiness(&capabilities, renderer_ready);
                let (
                    source_frame_shared_texture_import_ok,
                    source_frame_shared_texture_import_detail,
                ) = source_frame_shared_texture_import_readiness(&capabilities);
                let (output_shared_texture_export_ok, output_shared_texture_export_detail) =
                    output_shared_texture_export_readiness(&capabilities);
                let mut checks = vec![
                    json!({
                        "id": "wgpu-device",
                        "label": "Native wgpu device",
                        "ok": renderer_ready,
                        "detail": self.adapter_name.clone().unwrap_or_else(|| "not initialized".to_string())
                    }),
                    json!({
                        "id": "shared-texture-source-frame-upload",
                        "label": "Shared texture source-frame transport",
                        "ok": source_frame_shared_texture_import_ok,
                        "detail": source_frame_shared_texture_import_detail
                    }),
                    json!({
                        "id": "shared-texture-upload",
                        "label": "Shared texture media transport",
                        "ok": self.shared_texture_media_transport_ready(),
                        "detail": if self.shared_texture_media_transport_ready() {
                            shared_texture_media_transport_ready_detail()
                        } else { "full media shared texture transport is pending for this backend" }
                    }),
                    json!({
                        "id": "native-output-mirror",
                        "label": "Native offscreen output mirror",
                        "ok": renderer_ready,
                        "detail": if renderer_ready { "composite renders into a native offscreen output texture before swapchain present" } else { "native renderer has not created a wgpu device" }
                    }),
                    json!({
                        "id": "shared-texture-output-export",
                        "label": "Native output shared-texture export",
                        "ok": output_shared_texture_export_ok,
                        "detail": output_shared_texture_export_detail
                    }),
                    json!({
                        "id": "native-texture-share-sender",
                        "label": texture_share_sender_label(),
                        "ok": false,
                        "detail": if output_shared_texture_export_ok {
                            texture_share_sender_ready_detail()
                        } else {
                            texture_share_sender_pending_detail()
                        }
                    }),
                    json!({
                        "id": "compute-instrument-host",
                        "label": "Native compute/multi-pass instrument host",
                        "ok": compute_instrument_host_ok,
                        "detail": compute_instrument_host_detail
                    }),
                ];
                checks.extend(
                    native_graph_readiness_checks(&capabilities, renderer_ready)
                        .into_iter()
                        .map(|check| {
                            json!({
                                "id": check.id,
                                "label": check.label,
                                "ok": check.ok,
                                "detail": check.detail
                            })
                        }),
                );
                let status = self.status();
                let managed_output_has_scene =
                    status.scene_layers_active == 0 || status.output_last_presented_layer_count > 0;
                checks.extend([
                    json!({
                        "id": "native-frame-sequence-export",
                        "label": "Native frame sequence export",
                        "ok": renderer_ready,
                        "detail": if renderer_ready { "native output snapshots can be stepped by render clock and exported as raw frame files" } else { "native renderer has not created a wgpu device" }
                    }),
                    json!({
                        "id": "native-frame-export",
                        "label": "Native frame export",
                        "ok": renderer_ready,
                        "detail": if renderer_ready { "render core can export deterministic raw frame snapshots for MP4/JPEG encoders" } else { "native renderer has not created a wgpu device" }
                    }),
                    json!({
                        "id": "managed-output",
                        "label": "Managed output window",
                        "ok": status.output_present_healthy && managed_output_has_scene,
                        "detail": if !self.output_window_attached {
                            "native output window is detached/hidden".to_string()
                        } else if self.stats.swapchain_presented == 0 {
                            format!("waiting for first native swapchain present; last={}", if self.stats.swapchain_last_present_result.is_empty() { "none" } else { self.stats.swapchain_last_present_result.as_str() })
                        } else if status.scene_layers_active > 0 && status.output_last_presented_layer_count == 0 {
                            format!("native output is presenting, but the last presented frame had no scene layers (active scene layers={})", status.scene_layers_active)
                        } else if self.stats.swapchain_present_consecutive_failures > 0 {
                            format!("native output present has {} consecutive failure(s); last={}", self.stats.swapchain_present_consecutive_failures, if self.stats.swapchain_last_present_result.is_empty() { "none" } else { self.stats.swapchain_last_present_result.as_str() })
                        } else {
                            format!("native output presented {} frame(s), last layer count={}", self.stats.swapchain_presented, status.output_last_presented_layer_count)
                        }
                    }),
                    json!({
                        "id": "native-recording",
                        "label": "Native recording",
                        "ok": false,
                        "detail": if self.renderer.is_some() { "render core provides raw frame export only; query the Electron broker readiness for MP4/JPEG encoder sessions" } else { "native renderer has not created a wgpu device" }
                    }),
                ]);
                Ok(json!({
                "timestamp_ms": epoch_ms(),
                "overall_ready": renderer_ready,
                "blockers": if renderer_ready { Vec::<String>::new() } else { vec!["native renderer has not created a wgpu device".to_string()] },
                "capabilities": capabilities,
                "checks": checks
                }))
            }
            "reset_stats" => {
                self.stats = CoreStats::default();
                self.output_last_presented_layer_count = 0;
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
                let explicit_present = summary
                    .get("explicit_present_requested")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !explicit_present {
                    self.request_auto_present();
                }
                Ok(summary)
            }
            "submit_commands" => {
                let summary =
                    self.apply_commands(req.params.get("commands").unwrap_or(&req.params));
                let explicit_present = summary
                    .get("explicit_present_requested")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !explicit_present {
                    self.request_auto_present();
                }
                Ok(summary)
            }
            "set_layer_interaction" => {
                self.apply_layer_interaction(&req.params);
                self.request_auto_present();
                Ok(json!(true))
            }
            "set_output" => {
                self.apply_output_config(&req.params);
                Ok(json!(true))
            }
            "set_output_state" => self.apply_output_state(&req.params),
            "set_composite_effects" => self.apply_composite_effects(&req.params),
            "set_output_stage" => self.apply_output_stage(&req.params),
            "set_slice_outputs" => self.apply_slice_outputs(&req.params),
            "slice_output_state" | "get_slice_output_state" => Ok(self
                .renderer
                .as_ref()
                .map(RenderState::slice_output_metadata)
                .unwrap_or_else(|| json!({ "available": false }))),
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

        if req.id != 0 {
            match result {
                Ok(value) => self.send_ok(req.id, value),
                Err(err) => self.send_error(req.id, err),
            }
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
        self.editor_parent_window_handle_hex =
            string_at(config, &["editor_parent_window_handle_hex"])
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string());
        self.editor_parent_window_handle_platform =
            string_at(config, &["editor_parent_window_handle_platform"])
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string());
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.resize(PhysicalSize::new(self.pending_width, self.pending_height));
        }
    }

    /// Master output gate. Blackout is a live-performance kill switch, so it
    /// must act on the composite the projector sees — the editor's DOM
    /// overlay only ever covered the preview.
    fn output_gate(&self) -> f32 {
        if self.output_blackout { 0.0 } else { 1.0 }
    }

    /// Blackout / freeze state from the editor's output settings.
    fn apply_output_state(&mut self, params: &Value) -> Result<Value, String> {
        if let Some(blackout) = bool_at(params, &["blackout"]) {
            self.output_blackout = blackout;
        }
        if let Some(frozen) = bool_at(params, &["frozen"]) {
            self.output_frozen = frozen;
        }
        Ok(json!({
            "blackout": self.output_blackout,
            "frozen": self.output_frozen,
        }))
    }

    /// Stage for the editor preview / capture path. The WebGL build gated
    /// crop, rotation and colour grade behind output mode, so the editor
    /// canvas (and anything recorded from it) showed the untransformed
    /// composite; dome and edge blend were drawn in both. Mirror that.
    fn preview_output_stage(&self) -> OutputStage {
        OutputStage {
            out0: [0.0, 0.0, 1.0, 1.0],
            out1: [0.0, 1.0, 1.0, 1.0],
            ..self.output_stage
        }
    }

    /// Effects applied to the blended frame, capped at the uniform's 8 slots.
    fn composite_effect_slots(&self) -> Vec<[f32; 4]> {
        self.composite_effects.iter().copied().take(8).collect()
    }

    /// Composition effects + macro effect bundles. Each entry carries a
    /// compositor descriptor ("hue:0.25") and a `mix` wet/dry weight — the
    /// macro knob value for bundle effects, 1.0 for composition effects.
    fn apply_composite_effects(&mut self, params: &Value) -> Result<Value, String> {
        let mut slots: Vec<[f32; 4]> = Vec::new();
        let mut skipped: Vec<String> = Vec::new();
        if let Some(entries) = params.get("effects").and_then(Value::as_array) {
            for entry in entries {
                if slots.len() >= 8 {
                    break;
                }
                let Some(descriptor) = entry
                    .get("descriptor")
                    .and_then(Value::as_str)
                    .or_else(|| entry.as_str())
                else {
                    continue;
                };
                let Some(mut slot) = effect_descriptor_code(descriptor) else {
                    // Descriptors outside the compositor's in-shader op set
                    // (blur, colorama, …) need a real post pass; report them
                    // instead of silently dropping the operator's effect.
                    skipped.push(descriptor.to_string());
                    continue;
                };
                let mix = entry
                    .get("mix")
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0)
                    .clamp(0.0, 1.0) as f32;
                if mix <= 0.0005 {
                    continue;
                }
                slot[3] = mix;
                slots.push(slot);
            }
        }
        self.composite_effects = slots;
        Ok(json!({
            "applied": self.composite_effects.len(),
            "skipped": skipped,
        }))
    }

    /// Projector output transform from the editor's output settings.
    fn apply_output_stage(&mut self, params: &Value) -> Result<Value, String> {
        let read = |keys: &[&str], fallback: f64| number_at(params, keys).unwrap_or(fallback);
        let crop_x = read(&["cropX"], 0.0).clamp(0.0, 0.99) as f32;
        let crop_y = read(&["cropY"], 0.0).clamp(0.0, 0.99) as f32;
        let crop_w = read(&["cropWidth"], 1.0).clamp(0.01, 1.0 - crop_x as f64) as f32;
        let crop_h = read(&["cropHeight"], 1.0).clamp(0.01, 1.0 - crop_y as f64) as f32;
        let rotation = (((read(&["rotation"], 0.0) % 360.0) + 360.0) % 360.0 / 90.0).round();
        let dome_enabled = bool_at(params, &["domeEnabled"]).unwrap_or(false);
        // Master warp: destination-semantics quad plus an optional mesh that
        // deforms inside it. Only the mesh belonging to the declared mode is
        // read, so switching modes in the editor can't leave a stale grid on.
        let warp = params.get("masterWarp");
        let warp_enabled = warp
            .map(|value| bool_at(value, &["enabled"]).unwrap_or(false))
            .unwrap_or(false);
        let warp_mode = warp
            .and_then(|value| string_at(value, &["mode"]))
            .unwrap_or_else(|| "corners".to_string());
        let (master_c0, master_c1) = warp_corners_at(warp.and_then(|v| v.get("corners")));
        let (mesh_rows, mesh_cols, master_mesh) = if warp_enabled && warp_mode == "mesh" {
            warp_mesh_at(warp.and_then(|v| v.get("meshGrid")))
        } else {
            (0.0, 0.0, [[0.0f32; 4]; 128])
        };
        let master_warp = [
            if warp_enabled { 1.0 } else { 0.0 },
            mesh_rows,
            mesh_cols,
            0.0,
        ];
        self.output_stage = OutputStage {
            out0: [crop_x, crop_y, crop_w, crop_h],
            out1: [
                rotation.clamp(0.0, 3.0) as f32,
                read(&["brightness"], 1.0).max(0.0) as f32,
                read(&["contrast"], 1.0).max(0.0) as f32,
                read(&["gamma"], 1.0).max(0.001) as f32,
            ],
            edge: [
                read(&["edgeBlendLeft"], 0.0).clamp(0.0, 0.5) as f32,
                read(&["edgeBlendRight"], 0.0).clamp(0.0, 0.5) as f32,
                read(&["edgeBlendTop"], 0.0).clamp(0.0, 0.5) as f32,
                read(&["edgeBlendBottom"], 0.0).clamp(0.0, 0.5) as f32,
            ],
            dome0: [
                if dome_enabled { 1.0 } else { 0.0 },
                read(&["domeMode"], 0.0).clamp(0.0, 3.0) as f32,
                read(&["domeFOV"], 180.0).to_radians() as f32,
                read(&["domeRotation"], 0.0).to_radians() as f32,
            ],
            dome1: [
                read(&["domeTilt"], 0.0).to_radians() as f32,
                read(&["domeOffsetX"], 0.0) as f32,
                read(&["domeOffsetY"], 0.0) as f32,
                read(&["domeCurvature"], 1.0).clamp(0.0, 1.0) as f32,
            ],
            dome2: [
                read(&["domeTruncation"], 1.0).clamp(0.01, 2.0) as f32,
                read(&["edgeBlendGamma"], 2.2).clamp(0.05, 8.0) as f32,
                // Slice mode off: the main output uses the single-projector
                // grade, not blendRenderer's multi-projector one.
                0.0,
                // Alignment test pattern code (TestPatternType index).
                read(&["testPattern"], 0.0).clamp(0.0, 6.0) as f32,
            ],
            edge_gamma: [2.2; 4],
            black_level: [0.0; 4],
            // The main output never carries a per-slice screen warp; that is
            // a projector-alignment transform and belongs to the slice.
            swarp: [0.0; 4],
            swarp_c0: [0.0, 0.0, 1.0, 0.0],
            swarp_c1: [1.0, 1.0, 0.0, 1.0],
            mwarp: master_warp,
            mwarp_c0: master_c0,
            mwarp_c1: master_c1,
            swarp_mesh: [[0.0; 4]; 128],
            mwarp_mesh: master_mesh,
        };
        Ok(json!({ "domeEnabled": dome_enabled, "masterWarp": master_warp[0] > 0.5 }))
    }

    /// Multi-output slice displays. Each entry carries the slice's crop on
    /// the master composition plus its own projector grade, so the core can
    /// composite a full-resolution frame per display rather than having each
    /// slice window re-render the whole scene in WebGL and crop it.
    fn apply_slice_outputs(&mut self, params: &Value) -> Result<Value, String> {
        let mut specs: Vec<SliceOutputSpec> = Vec::new();
        if let Some(entries) = params.get("slices").and_then(Value::as_array) {
            for entry in entries {
                let Some(id) = string_at(entry, &["id"]).filter(|id| !id.trim().is_empty()) else {
                    continue;
                };
                let read = |keys: &[&str], fallback: f64| number_at(entry, keys).unwrap_or(fallback);
                let width = read(&["width"], 1920.0).clamp(16.0, 16384.0) as u32;
                let height = read(&["height"], 1080.0).clamp(16.0, 16384.0) as u32;
                let crop_x = read(&["cropX"], 0.0).clamp(0.0, 0.99) as f32;
                let crop_y = read(&["cropY"], 0.0).clamp(0.0, 0.99) as f32;
                let crop_w = read(&["cropW"], 1.0).clamp(0.01, 1.0 - crop_x as f64) as f32;
                let crop_h = read(&["cropH"], 1.0).clamp(0.01, 1.0 - crop_y as f64) as f32;
                let rotation = (((read(&["rotation"], 0.0) % 360.0) + 360.0) % 360.0 / 90.0).round();
                let blend_gamma = read(&["edgeBlendGamma"], 2.2);
                // Screen warp: 'corners' and 'mesh' control points are sample
                // positions on the master, so they replace the rect crop
                // rather than composing with it — same as blendRenderer.
                let warp_mode = string_at(entry, &["warpMode"])
                    .unwrap_or_else(|| "rect".to_string());
                let (slice_c0, slice_c1) = warp_corners_at(entry.get("corners"));
                let (slice_rows, slice_cols, slice_mesh) = if warp_mode == "mesh" {
                    warp_mesh_at(entry.get("meshGrid"))
                } else {
                    (0.0, 0.0, [[0.0f32; 4]; 128])
                };
                let warp_code = match warp_mode.as_str() {
                    "corners" => 1.0,
                    // A mesh that failed validation falls back to the rect
                    // crop instead of collapsing the screen to a point.
                    "mesh" if slice_rows >= 2.0 && slice_cols >= 2.0 => 2.0,
                    _ => 0.0,
                };
                // A slice inherits the master dome so a domed rig can still be
                // split across projectors, but overrides every flat transform.
                let stage = OutputStage {
                    out0: [crop_x, crop_y, crop_w, crop_h],
                    out1: [
                        rotation.clamp(0.0, 3.0) as f32,
                        read(&["brightness"], 1.0).max(0.0) as f32,
                        read(&["contrast"], 1.0).max(0.0) as f32,
                        read(&["gamma"], 1.0).max(0.001) as f32,
                    ],
                    edge: [
                        read(&["edgeBlendLeft"], 0.0).clamp(0.0, 0.5) as f32,
                        read(&["edgeBlendRight"], 0.0).clamp(0.0, 0.5) as f32,
                        read(&["edgeBlendTop"], 0.0).clamp(0.0, 0.5) as f32,
                        read(&["edgeBlendBottom"], 0.0).clamp(0.0, 0.5) as f32,
                    ],
                    dome0: self.output_stage.dome0,
                    dome1: self.output_stage.dome1,
                    dome2: [self.output_stage.dome2[0], blend_gamma as f32, 1.0, 0.0],
                    edge_gamma: [
                        read(&["edgeBlendLeftGamma"], blend_gamma).clamp(0.05, 8.0) as f32,
                        read(&["edgeBlendRightGamma"], blend_gamma).clamp(0.05, 8.0) as f32,
                        read(&["edgeBlendTopGamma"], blend_gamma).clamp(0.05, 8.0) as f32,
                        read(&["edgeBlendBottomGamma"], blend_gamma).clamp(0.05, 8.0) as f32,
                    ],
                    black_level: [
                        read(&["blackLevelR"], 0.0).clamp(0.0, 1.0) as f32,
                        read(&["blackLevelG"], 0.0).clamp(0.0, 1.0) as f32,
                        read(&["blackLevelB"], 0.0).clamp(0.0, 1.0) as f32,
                        read(&["blackLevelFeather"], 0.5).clamp(0.0, 1.0) as f32,
                    ],
                    swarp: [warp_code, slice_rows, slice_cols, 0.0],
                    swarp_c0: slice_c0,
                    swarp_c1: slice_c1,
                    // Slices sample the master-warped composite, so they
                    // inherit the master warp exactly as the WebGL two-pass
                    // path does (warp the master, then crop from it).
                    mwarp: self.output_stage.mwarp,
                    mwarp_c0: self.output_stage.mwarp_c0,
                    mwarp_c1: self.output_stage.mwarp_c1,
                    swarp_mesh: slice_mesh,
                    mwarp_mesh: self.output_stage.mwarp_mesh,
                };
                specs.push(SliceOutputSpec { id, width, height, stage });
            }
        }
        specs.truncate(MAX_SLICE_OUTPUTS);
        let ids: Vec<String> = specs.iter().map(|spec| spec.id.clone()).collect();
        self.slice_outputs = specs;
        Ok(json!({ "slices": ids }))
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
        if !attached {
            set_appkit_projector_presentation(false);
        }
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.window.set_visible(attached);
            if attached {
                // A newly shown winit window can remain entirely behind the
                // Electron editor on a single display. Metal then reports an
                // occluded swapchain and the UI cannot distinguish that from
                // a broken output. Raise it once on attach; normal window
                // ordering resumes as soon as the user focuses the editor.
                renderer.window.focus_window();
                activate_appkit_output_window(renderer.window);
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
        if let Some(cursor_hittest) =
            bool_at(config, &["cursor_hittest"]).or_else(|| bool_at(config, &["input_enabled"]))
        {
            let _ = renderer.window.set_cursor_hittest(cursor_hittest);
        }
        if let Some(input_transparent) =
            bool_at(config, &["input_transparent"]).or_else(|| bool_at(config, &["click_through"]))
        {
            let _ = renderer.window.set_cursor_hittest(!input_transparent);
        }
        if let Some(always_on_bottom) =
            bool_at(config, &["always_on_bottom"]).or_else(|| bool_at(config, &["underlay"]))
        {
            renderer.window.set_window_level(if always_on_bottom {
                WindowLevel::AlwaysOnBottom
            } else {
                WindowLevel::Normal
            });
        } else if let Some(always_on_top) = bool_at(config, &["always_on_top"]) {
            renderer.window.set_window_level(if always_on_top {
                WindowLevel::AlwaysOnTop
            } else {
                WindowLevel::Normal
            });
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
            renderer.window.set_window_level(if fullscreen {
                WindowLevel::AlwaysOnTop
            } else {
                WindowLevel::Normal
            });
            set_managed_output_fullscreen(renderer.window, fullscreen);
            renderer.window.set_cursor_visible(!fullscreen);
        }
        renderer.window.set_visible(self.output_window_attached);
        if self.output_window_attached {
            renderer.window.focus_window();
            activate_appkit_output_window(renderer.window);
            renderer.window.request_redraw();
        } else {
            set_appkit_projector_presentation(false);
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
        if !self.output_window_attached {
            self.last_redraw = Instant::now();
            self.render();
            return;
        }
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
        let mut explicit_present_requested = false;
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
                "set_output_state" => {
                    let _ = self.apply_output_state(command);
                }
                "set_composite_effects" => {
                    let _ = self.apply_composite_effects(command);
                }
                "set_output_stage" => {
                    let _ = self.apply_output_stage(command);
                }
                "set_slice_outputs" => {
                    let _ = self.apply_slice_outputs(command);
                }
                "upsert_layer" => self.apply_upsert_layer(command),
                "set_layer_visibility" => self.apply_layer_visibility(command),
                "set_layer_color" => self.apply_layer_color(command),
                "set_layer_native_params" => self.apply_layer_native_params(command),
                "set_layer_edge_effects" => self.apply_layer_edge_effects(command),
                "set_native_graph_layer" => self.apply_native_graph_layer(command),
                "update_native_graph_buffer" => {
                    if let Err(err) = self.apply_update_native_graph_buffer(command) {
                        self.last_shader_error = Some(err);
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "upload_native_point_cloud" => {
                    if self.apply_native_point_cloud(command).is_err() {
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
                "remove_native_graph_layer" => self.apply_remove_native_graph_layer(command),
                "queue_compute_graph" | "enqueue_compute_graph" => {
                    if let Err(err) = self.apply_queue_compute_graph(command) {
                        self.last_shader_error = Some(err);
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                }
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
                "present" => {
                    explicit_present_requested = true;
                    self.request_present();
                }
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
            "explicit_present_requested": explicit_present_requested,
        })
    }

    fn upload_source_gpu_shared_texture(&mut self, params: &Value) -> Result<Value, String> {
        if string_at(params, &["source_id"]).is_none() {
            return Err("native shared texture source-frame upload requires source_id".to_string());
        }
        let rejected_before = self.stats.source_frame_rejected_uploads;
        let uploaded_before = self.stats.source_frame_uploads;
        self.apply_source_frame(params);
        let rejected_after = self.stats.source_frame_rejected_uploads;
        let uploaded_after = self.stats.source_frame_uploads;
        if rejected_after > rejected_before && uploaded_after == uploaded_before {
            let reason = if self.stats.source_frame_last_reject_reason.is_empty() {
                "native shared texture source-frame upload was rejected".to_string()
            } else {
                self.stats.source_frame_last_reject_reason.clone()
            };
            return Err(reason);
        }
        Ok(json!(self.status()))
    }

    fn native_graph_time_seconds(&self) -> f32 {
        if self.render_clock_mode == "manual" {
            return self.render_clock_time.unwrap_or(0.0).max(0.0);
        }
        self.start_time.elapsed().as_secs_f32().max(0.0)
    }

    fn native_frame_index(&self) -> u64 {
        effective_native_frame_index(
            &self.render_clock_mode,
            self.render_clock_frame_index,
            self.stats.gpu_frames_submitted,
        )
    }

    fn native_frame_delta(&self) -> f32 {
        effective_native_frame_delta(
            &self.render_clock_mode,
            self.render_clock_delta,
            self.target_fps,
        )
    }

    fn run_native_graph_layers(&mut self) -> Vec<NativeGraphFrameJob> {
        if self.native_graph_layers.is_empty() {
            return Vec::new();
        }
        let mut jobs = Vec::new();
        let graph_layers = self
            .native_graph_layers
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for graph_layer in graph_layers {
            let layer_visible = self
                .scene_layers
                .get(&graph_layer.layer_id)
                .map(|layer| layer.visible)
                .unwrap_or(false);
            if !layer_visible {
                continue;
            }
            if matches!(
                graph_layer.kind,
                NativeGraphLayerKind::GhostFx
                    | NativeGraphLayerKind::HandFx
                    | NativeGraphLayerKind::PerformerWorld
                    | NativeGraphLayerKind::VjCrossfade
                    | NativeGraphLayerKind::VjMix
            ) {
                let Some(template) = graph_layer.effect_job_template.as_ref() else {
                    let message = format!(
                        "native plugin graph `{}` on layer `{}` has no installed template",
                        graph_layer.kind.signature(),
                        graph_layer.layer_id
                    );
                    // One stderr line per state change, not one per frame.
                    if self.last_shader_error.as_deref() != Some(message.as_str()) {
                        eprintln!("[GhostRenderCore] {message}");
                    }
                    self.last_shader_error = Some(message);
                    continue;
                };
                let job = self.native_plugin_graph_frame_job(&graph_layer, template);
                self.register_compute_graph_source_frame_targets(&job.render_plans);
                jobs.push(job);
                self.last_shader_error = None;
                continue;
            }
            let result = match graph_layer.kind.clone() {
                // Lines, SVG, Light Painting, and Text frame jobs are fully described
                // by the renderer sync layer and submitted through `queue_compute_graph`.
                // The retained native graph entry keeps their source attached to
                // the compositor without generating a second frame job here.
                NativeGraphLayerKind::Lines
                | NativeGraphLayerKind::Svg
                | NativeGraphLayerKind::LightPainting
                | NativeGraphLayerKind::Text
                | NativeGraphLayerKind::Splat
                | NativeGraphLayerKind::Model3D => continue,
                NativeGraphLayerKind::Planet => self.build_native_planet_graph_job(&graph_layer),
                NativeGraphLayerKind::InkCloud => {
                    self.build_native_ink_cloud_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::Smoke3D => self.build_native_smoke_3d_graph_job(&graph_layer),
                NativeGraphLayerKind::ParticleField => {
                    self.build_native_particle_field_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::PixelParticles => {
                    self.build_native_pixel_particles_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::Flythrough => {
                    self.build_native_flythrough_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::PointCloudFx => {
                    self.build_native_point_cloud_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::SmokeRiders => {
                    self.build_native_smoke_riders_graph_job(&graph_layer, "smoke-riders")
                }
                // Fluid Riders shares the whole solve + pass topology; only the
                // WGSL differs (opaque isosurface instead of a smoke march), so
                // it reuses this builder with its own shader-id prefix.
                NativeGraphLayerKind::FluidRiders => {
                    self.build_native_smoke_riders_graph_job(&graph_layer, "fluid-riders")
                }
                NativeGraphLayerKind::VolumetricSpheres => {
                    self.build_native_volumetric_spheres_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::GhostFx
                | NativeGraphLayerKind::HandFx
                | NativeGraphLayerKind::PerformerWorld
                | NativeGraphLayerKind::VjCrossfade
                | NativeGraphLayerKind::VjMix => unreachable!(),
                NativeGraphLayerKind::Unsupported(_) => continue,
            };
            match result {
                Ok((next_state, job)) => {
                    if let Some(entry) = self.native_graph_layers.get_mut(&graph_layer.layer_id) {
                        match next_state {
                            NativeGraphLayerState::Planet(state) => entry.planet_state = state,
                            NativeGraphLayerState::InkCloud(state) => entry.ink_cloud_state = state,
                            NativeGraphLayerState::Smoke3D(state) => entry.smoke_3d_state = state,
                            NativeGraphLayerState::ParticleField(state) => {
                                entry.particle_field_state = state
                            }
                            NativeGraphLayerState::PixelParticles(state) => {
                                entry.pixel_particles_state = state
                            }
                            NativeGraphLayerState::Flythrough(state) => {
                                entry.flythrough_state = state
                            }
                            NativeGraphLayerState::PointCloudFx(state) => {
                                entry.point_cloud_state = state
                            }
                            NativeGraphLayerState::SmokeRiders(state) => {
                                entry.smoke_riders_state = state
                            }
                            NativeGraphLayerState::VolumetricSpheres(state) => {
                                entry.volumetric_spheres_state = state
                            }
                        }
                    }
                    jobs.push(job);
                    if let Some(effect_template) = graph_layer.effect_job_template.as_ref() {
                        let effect_job = self.native_graph_effect_frame_job(effect_template);
                        self.register_compute_graph_source_frame_targets(&effect_job.render_plans);
                        jobs.push(effect_job);
                    }
                    self.last_shader_error = None;
                }
                Err(err) => {
                    self.last_shader_error = Some(format!(
                        "native graph `{}` on layer `{}` failed: {err}",
                        graph_layer.kind.signature(),
                        graph_layer.layer_id
                    ));
                }
            }
        }
        jobs
    }

    fn native_plugin_graph_frame_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        template: &NativeGraphFrameJob,
    ) -> NativeGraphFrameJob {
        let mut job = template.clone();
        // `layer-frame:` bindings must track the CURRENT frame slot of their
        // scene layer every replay — at install time a shader layer may not
        // have rendered yet (its binding would pin to the empty placeholder
        // forever), and video slots can move under pool pressure.
        let debug_resolution = self.native_frame_index() % 240 == 0;
        for plan in &mut job.render_plans {
            for binding in &mut plan.bindings {
                if let Some(layer_id) = binding.resource_id.strip_prefix("shader-frame:") {
                    if let Some(slot) = self
                        .scene_layers
                        .get(layer_id)
                        .and_then(|layer| layer.shader_frame_slot)
                    {
                        binding.source_slot = Some(slot);
                    }
                }
                if let Some(layer_id) = binding.resource_id.strip_prefix("layer-frame:") {
                    let resolved = self
                        .scene_layers
                        .get(layer_id)
                        .and_then(|layer| layer.frame_slot);
                    if let Some(slot) = resolved {
                        binding.source_slot = Some(slot);
                    }
                    if debug_resolution {
                        eprintln!(
                            "[GhostRenderCore] layer-frame resolve `{layer_id}` -> {:?} (template slot {:?}, layer known: {})",
                            resolved,
                            binding.source_slot,
                            self.scene_layers.contains_key(layer_id)
                        );
                    }
                }
            }
        }
        for plan in &mut job.pass_plans {
            for binding in &mut plan.bindings {
                if let Some(layer_id) = binding.resource_id.strip_prefix("layer-frame:") {
                    if let Some(slot) = self
                        .scene_layers
                        .get(layer_id)
                        .and_then(|layer| layer.frame_slot)
                    {
                        binding.source_slot = Some(slot);
                    }
                }
            }
        }
        let time = self.native_graph_time_seconds();
        let delta = self.native_frame_delta().clamp(0.0, 0.1);
        let frame_index = self.native_frame_index();
        let reactivity =
            native_graph_param_f32(&graph_layer.params, "ghostfxReactivity", 0.0, 1.0, 0.4);
        self.native_plugin_audio_smooth
            .update(frame_index, delta, self.audio0, self.audio1, reactivity);
        let smooth = self.native_plugin_audio_smooth;
        // The template is replayed every frame, but its `clear` flags describe
        // INSTALL-time intent only. Replaying clear=true wipes persistent
        // state (fluid fields, particle trails) every frame — the sim can
        // never accumulate. Honor clear on the first run after install, then
        // force it off.
        if self
            .native_plugin_templates_initialized
            .contains(&graph_layer.layer_id)
        {
            for buffer in &mut job.buffers {
                buffer.clear = false;
            }
        } else {
            self.native_plugin_templates_initialized
                .insert(graph_layer.layer_id.clone());
        }
        let mut liquid_splat_count: Option<u32> = None;
        // GhostFX Liquid: regenerate the injection (splats) every frame in
        // the core. The installed template only carries frame-zero splats;
        // replaying them verbatim was the "liquid barely shows anything"
        // defect — a static, near-invisible drip. See the 128-byte uniform
        // branch below for the matching layout.
        if graph_layer.kind == NativeGraphLayerKind::GhostFx {
            let is_liquid = job.buffers.iter().any(|buffer| {
                matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform)
                    && buffer.initial_bytes.len() == 128
            });
            if is_liquid {
                let state = self
                    .native_plugin_liquid_states
                    .entry(graph_layer.layer_id.clone())
                    .or_insert(NativePluginLiquidState {
                        prev_beat_pulse: 0.0,
                        ambient_accumulator: 0.0,
                    });
                let params = &graph_layer.params;
                let sensitivity =
                    native_graph_param_f32(params, "ghostfxSensitivity", 0.25, 4.0, 1.4);
                let hue_speed =
                    native_graph_param_f32(params, "ghostfxHueDriftSpeed", 0.0, 2.0, 0.15);
                let hue = (time * hue_speed).rem_euclid(1.0);
                let splat_radius =
                    native_graph_param_f32(params, "ghostfxLiquidSplatRadius", 0.01, 0.2, 0.08);
                let bass_rate =
                    native_graph_param_f32(params, "ghostfxLiquidBassRate", 0.0, 2.0, 1.0);
                let bass = (smooth.bass * sensitivity).clamp(0.0, 2.0);
                let mid = (smooth.mid * sensitivity).clamp(0.0, 2.0);
                let energy = (smooth.energy * sensitivity).clamp(0.0, 2.0);
                let beat_pulse = self.audio1[1];
                let beat_edge = beat_pulse > 0.5 && state.prev_beat_pulse < 0.3;
                state.prev_beat_pulse = beat_pulse;
                state.ambient_accumulator += delta.max(0.0) * (2.0 + bass * 14.0) * bass_rate;
                let mut splats: Vec<[f32; 8]> = Vec::with_capacity(16);
                // Deterministic per-frame randomness (layer + frame seeded).
                let mut seed = stable_hash64(&format!("{}:{frame_index}", graph_layer.layer_id));
                let mut rand01 = move || {
                    seed = seed
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    ((seed >> 33) as f64 / (u32::MAX as f64 + 1.0)) as f32
                };
                // 1) Three continuous Lissajous emitters with tangential
                //    swirl — the pool stays alive even in silence.
                for index in 0..3usize {
                    let phase = index as f32 / 3.0 * std::f32::consts::TAU;
                    let ax = 0.83 + index as f32 * 0.11;
                    let ay = 0.67 + index as f32 * 0.13;
                    let t = time * (0.35 + mid * 0.5);
                    let x = 0.5 + 0.36 * (t * ax + phase).cos();
                    let y = 0.5 + 0.33 * (t * ay + phase * 1.7).sin();
                    let dxdt = -0.36 * ax * (t * ax + phase).sin();
                    let dydt = 0.33 * ay * (t * ay + phase * 1.7).cos();
                    let len = (dxdt * dxdt + dydt * dydt).sqrt().max(1e-4);
                    let fx = dxdt / len;
                    let fy = dydt / len;
                    let speed = 0.55 + energy * 1.1;
                    let swirl = if index % 2 == 0 { 1.0 } else { -1.0 };
                    let color = hsv_to_rgb((hue + index as f32 * 0.31).rem_euclid(1.0), 0.88, 1.0);
                    splats.push([
                        x,
                        y,
                        (fx * 0.7 - fy * 0.7 * swirl) * speed,
                        (fy * 0.7 + fx * 0.7 * swirl) * speed,
                        color[0],
                        color[1],
                        color[2],
                        splat_radius * (0.55 + energy * 0.35),
                    ]);
                }
                // 2) Beat: vortex-ring burst — a ring of outward splats with
                //    a shared tangential twist reads as a liquid impact.
                if beat_edge {
                    let cx = 0.28 + rand01() * 0.44;
                    let cy = 0.28 + rand01() * 0.44;
                    let ring = if energy > 0.5 { 8 } else { 6 };
                    let ring_speed = 1.0 + energy * 1.6;
                    let twist = if rand01() < 0.5 { 0.8 } else { -0.8 };
                    let ring_hue = (hue + rand01() * 0.25).rem_euclid(1.0);
                    for index in 0..ring {
                        let angle = index as f32 / ring as f32 * std::f32::consts::TAU;
                        let dx = angle.cos();
                        let dy = angle.sin();
                        let color = hsv_to_rgb(
                            (ring_hue + index as f32 * 0.015).rem_euclid(1.0),
                            0.92,
                            1.0,
                        );
                        splats.push([
                            cx + dx * splat_radius * 1.6,
                            cy + dy * splat_radius * 1.6,
                            (dx - dy * twist) * ring_speed,
                            (dy + dx * twist) * ring_speed,
                            color[0],
                            color[1],
                            color[2],
                            splat_radius * 1.25,
                        ]);
                    }
                }
                // 3) Bass trickle: extra droplets while low end is present.
                while state.ambient_accumulator > 1.0 && splats.len() < 32 {
                    state.ambient_accumulator -= 1.0;
                    let angle = rand01() * std::f32::consts::TAU;
                    let speed = 0.25 + energy * 0.5;
                    let color = hsv_to_rgb((hue + rand01() * 0.6).rem_euclid(1.0), 0.75, 0.95);
                    splats.push([
                        rand01(),
                        rand01(),
                        angle.cos() * speed,
                        angle.sin() * speed,
                        color[0],
                        color[1],
                        color[2],
                        splat_radius * (0.5 + rand01() * 0.5),
                    ]);
                }
                splats.truncate(32);
                liquid_splat_count = Some(splats.len() as u32);
                for buffer in &mut job.buffers {
                    if !buffer.id.ends_with(":splats") || buffer.initial_bytes.len() < 1024 {
                        continue;
                    }
                    for (splat_index, splat) in splats.iter().enumerate() {
                        for (field_index, value) in splat.iter().enumerate() {
                            write_f32_le(
                                &mut buffer.initial_bytes,
                                splat_index * 8 + field_index,
                                *value,
                            );
                        }
                    }
                }
            }
        }
        for buffer in &mut job.buffers {
            if !matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform) {
                continue;
            }
            if graph_layer.kind == NativeGraphLayerKind::PerformerWorld
                && buffer.initial_bytes.len() == 80
            {
                // Performer worlds are a persistent native overlay. The
                // installed uniform owns world/space/XY parameters; only the
                // render clock and live audio envelope advance here.
                write_f32_le(&mut buffer.initial_bytes, 2, time);
                write_f32_le(&mut buffer.initial_bytes, 3, delta);
                write_f32_le(&mut buffer.initial_bytes, 10, smooth.energy);
                continue;
            }
            if matches!(
                graph_layer.kind,
                NativeGraphLayerKind::VjCrossfade | NativeGraphLayerKind::VjMix
            ) && buffer.initial_bytes.len() == 48
            {
                // VJ crossfade uniform (vjCrossfadeNative.ts): time at slot 3
                // animates glitch/liquid/strobe. Mix and transition are
                // updated in place by the renderer sync.
                write_f32_le(&mut buffer.initial_bytes, 3, time);
                continue;
            }
            if graph_layer.kind == NativeGraphLayerKind::GhostFx {
                if buffer.id.ends_with(":post-uniform") {
                    continue;
                }
                if buffer.initial_bytes.len() == 112 {
                    write_f32_le(&mut buffer.initial_bytes, 2, time);
                    write_f32_le(&mut buffer.initial_bytes, 3, delta);
                    let sensitivity = native_graph_param_f32(
                        &graph_layer.params,
                        "ghostfxSensitivity",
                        0.0,
                        4.0,
                        1.0,
                    );
                    write_f32_le(&mut buffer.initial_bytes, 4, smooth.bass * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 5, smooth.mid * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 6, smooth.treble * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 7, smooth.bass);
                    write_f32_le(&mut buffer.initial_bytes, 8, smooth.mid);
                    write_f32_le(&mut buffer.initial_bytes, 9, smooth.treble);
                    write_f32_le(&mut buffer.initial_bytes, 10, smooth.energy);
                    write_f32_le(&mut buffer.initial_bytes, 11, self.audio1[2]);
                    write_f32_le(&mut buffer.initial_bytes, 12, smooth.beat_env);
                    write_f32_le(&mut buffer.initial_bytes, 13, smooth.energy);
                    let hue_speed = native_graph_param_f32(
                        &graph_layer.params,
                        "ghostfxHueDriftSpeed",
                        -8.0,
                        8.0,
                        0.08,
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        14,
                        (time * hue_speed).rem_euclid(1.0),
                    );
                } else if buffer.initial_bytes.len() == 96 {
                    write_f32_le(&mut buffer.initial_bytes, 4, time);
                    write_f32_le(&mut buffer.initial_bytes, 5, delta);
                    write_f32_le(&mut buffer.initial_bytes, 6, self.audio0[1]);
                    write_f32_le(&mut buffer.initial_bytes, 7, self.audio0[2]);
                    write_f32_le(&mut buffer.initial_bytes, 8, self.audio0[3]);
                    write_f32_le(&mut buffer.initial_bytes, 9, self.audio0[0]);
                    write_f32_le(&mut buffer.initial_bytes, 10, self.audio1[2]);
                    write_f32_le(&mut buffer.initial_bytes, 11, self.audio1[1]);
                    let hue_speed = native_graph_param_f32(
                        &graph_layer.params,
                        "ghostfxHueDriftSpeed",
                        -8.0,
                        8.0,
                        0.08,
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        12,
                        (time * hue_speed).rem_euclid(1.0),
                    );
                    write_u32_le(&mut buffer.initial_bytes, 18, 1);
                } else if buffer.initial_bytes.len() == 128 {
                    // GhostFX Liquid uniform (see liquid.wgsl.ts): live audio
                    // + params refresh, matching the TS pack offsets exactly.
                    let params = &graph_layer.params;
                    let sensitivity =
                        native_graph_param_f32(params, "ghostfxSensitivity", 0.25, 4.0, 1.4);
                    let hue_speed =
                        native_graph_param_f32(params, "ghostfxHueDriftSpeed", 0.0, 2.0, 0.15);
                    write_f32_le(&mut buffer.initial_bytes, 4, time);
                    write_f32_le(&mut buffer.initial_bytes, 5, delta.min(1.0 / 15.0));
                    write_f32_le(&mut buffer.initial_bytes, 6, smooth.bass * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 7, smooth.mid * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 8, smooth.treble * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 9, smooth.energy * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 10, self.audio1[2]);
                    write_f32_le(&mut buffer.initial_bytes, 11, smooth.beat_env);
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        12,
                        (time * hue_speed).rem_euclid(1.0),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        13,
                        native_graph_param_f32(params, "ghostfxExposure", -1.0, 1.0, 0.1),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        14,
                        native_graph_param_f32(params, "ghostfxLiquidSplatForce", 0.2, 3.0, 1.0),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        15,
                        native_graph_param_f32(params, "ghostfxLiquidSplatRadius", 0.01, 0.2, 0.08),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        16,
                        native_graph_param_f32(params, "ghostfxLiquidDyeDecay", 0.985, 1.0, 0.995),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        17,
                        native_graph_param_f32(params, "ghostfxLiquidVelDecay", 0.95, 1.0, 0.996),
                    );
                    if let Some(count) = liquid_splat_count {
                        write_u32_le(&mut buffer.initial_bytes, 18, count);
                    }
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        19,
                        native_graph_param_f32(params, "ghostfxLiquidVorticity", 0.0, 3.0, 1.3),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        20,
                        native_graph_param_f32(params, "ghostfxLiquidGloss", 0.0, 1.0, 0.7),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        21,
                        native_graph_param_f32(params, "ghostfxAmbient", 0.0, 1.0, 0.3),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        22,
                        native_graph_param_f32(params, "ghostfxLiquidDepth", 0.02, 1.0, 0.35),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        23,
                        native_graph_param_f32(params, "ghostfxLiquidBubbles", 0.0, 2.0, 1.0),
                    );
                    let azimuth =
                        native_graph_param_f32(params, "ghostfxLightAzimuth", 0.0, 360.0, 35.0)
                            .to_radians();
                    let elevation =
                        native_graph_param_f32(params, "ghostfxLightElevation", -90.0, 90.0, 55.0)
                            .to_radians();
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        24,
                        elevation.cos() * azimuth.cos(),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        25,
                        elevation.cos() * azimuth.sin(),
                    );
                    write_f32_le(&mut buffer.initial_bytes, 26, elevation.sin().max(0.08));
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        27,
                        native_graph_param_f32(params, "ghostfxLightStrength", 0.0, 2.0, 0.9),
                    );
                }
            } else if buffer.initial_bytes.len() >= 16 {
                write_f32_le(&mut buffer.initial_bytes, 2, time);
                write_f32_le(&mut buffer.initial_bytes, 3, delta);
            }
        }
        if graph_layer.kind == NativeGraphLayerKind::GhostFx && liquid_splat_count.is_none() {
            // Non-liquid GhostFX scenes keep the original single animated
            // splat driver (drift/ribbons use it as an accent input).
            for buffer in &mut job.buffers {
                if !buffer.id.ends_with(":splats") || buffer.initial_bytes.len() < 32 {
                    continue;
                }
                let energy = smooth.energy.clamp(0.0, 1.0);
                let phase = time * (0.7 + smooth.bass * 1.5);
                write_f32_le(&mut buffer.initial_bytes, 0, 0.5 + phase.sin() * 0.28);
                write_f32_le(&mut buffer.initial_bytes, 1, 0.5 + phase.cos() * 0.24);
                write_f32_le(
                    &mut buffer.initial_bytes,
                    2,
                    phase.cos() * (0.15 + energy * 0.5),
                );
                write_f32_le(
                    &mut buffer.initial_bytes,
                    3,
                    -phase.sin() * (0.15 + energy * 0.5),
                );
                write_f32_le(&mut buffer.initial_bytes, 4, 0.25 + smooth.treble * 0.75);
                write_f32_le(&mut buffer.initial_bytes, 5, 0.35 + smooth.mid * 0.65);
                write_f32_le(&mut buffer.initial_bytes, 6, 0.8 + smooth.bass * 0.2);
                write_f32_le(&mut buffer.initial_bytes, 7, 0.025 + energy * 0.04);
            }
        }
        for render_plan in &mut job.render_plans {
            if let NativeComputeGraphRenderTarget::SourceFrame { seq, .. } = &mut render_plan.target
            {
                *seq = frame_index;
            }
        }
        job
    }

    fn native_graph_effect_frame_job(&self, template: &NativeGraphFrameJob) -> NativeGraphFrameJob {
        let mut job = template.clone();
        let time = self.native_graph_time_seconds();
        let delta = self.native_frame_delta();
        let frame_index = self.native_frame_index();
        for buffer in &mut job.buffers {
            if !matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform)
                || buffer.initial_bytes.len() < 32
            {
                continue;
            }
            buffer.initial_bytes[8..12].copy_from_slice(&time.to_le_bytes());
            buffer.initial_bytes[12..16].copy_from_slice(&delta.to_le_bytes());
            buffer.initial_bytes[28..32].copy_from_slice(&(frame_index as f32).to_le_bytes());
        }
        for render_plan in &mut job.render_plans {
            if let NativeComputeGraphRenderTarget::SourceFrame { seq, .. } = &mut render_plan.target
            {
                *seq = frame_index;
            }
        }
        job
    }

    fn build_native_planet_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let shader_id = "planet/render";
        let Some(record) = self.shader_registry.get(shader_id) else {
            return Err("planet/render shader has not been precompiled".to_string());
        };
        if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
            return Err(format!(
                "planet/render shader is {}, but native graph instruments require WGSL",
                record.source_kind
            ));
        }
        let source_hash = record.source_hash;
        let entry_points = record.entry_points.clone();
        let source = self
            .shader_sources
            .get(shader_id)
            .cloned()
            .ok_or_else(|| "planet/render shader source missing".to_string())?;
        let vertex_entry = "vs_full".to_string();
        let fragment_entry = "fs_planet".to_string();
        if !entry_points.iter().any(|entry| entry == &vertex_entry) {
            return Err("planet/render shader is missing vertex entry vs_full".to_string());
        }
        if !entry_points.iter().any(|entry| entry == &fragment_entry) {
            return Err("planet/render shader is missing fragment entry fs_planet".to_string());
        }
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.planet_state.clone();
        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 0.1);
        state.prev_frame_time = time;
        state.accum_rotation = (state.accum_rotation
            + native_graph_param_f32(&graph_layer.params, "rotationSpeed", -3600.0, 3600.0, 4.0)
                * dt)
            % 360.0;
        state.cloud_phase +=
            native_graph_param_f32(&graph_layer.params, "cloudSpeed", 0.0, 32.0, 0.7) * dt;

        let uniform = build_planet_native_uniform_bytes(
            &graph_layer.params,
            &state,
            self.pending_width,
            self.pending_height,
            time,
        );
        let source_id = graph_layer.source_id.clone();
        let slot = self.assign_source_frame_slot(&source_id);
        let uniform_id = format!("planet:{}:uniform", native_graph_buffer_safe_id(&source_id));
        let seq = self.native_frame_index();
        let buffer_spec = NativeComputeGraphBufferSpec {
            id: uniform_id.clone(),
            byte_length: 176,
            kind: NativeComputeBufferBindingKind::Uniform,
            initial_bytes: uniform,
            persistent: true,
            clear: false,
            indirect: false,
        };
        let binding = NativeComputeGraphBindingSpec {
            binding: 0,
            resource_id: uniform_id,
            kind: NativeComputeGraphBindingKind::Buffer(NativeComputeBufferBindingKind::Uniform),
            source_slot: None,
        };
        let blend = NativeComputeGraphRenderBlend::Alpha;
        let primitive_topology = NativeComputeGraphPrimitiveTopology::TriangleList;
        let depth_compare = NativeComputeGraphDepthCompare::Less;
        let layout_sig = format!("{}:{}", binding.binding, binding.kind.signature());
        let render_plan = NativeComputeGraphRenderPlan {
            name: "planet-render".to_string(),
            cache_key: format!(
                "graph-render:{shader_id}:{}:{vertex_entry}:{fragment_entry}:{}:{}:{}:{}:{}:{layout_sig}",
                source_hash,
                blend.signature(),
                primitive_topology.signature(),
                "nodepth",
                "read",
                depth_compare.signature()
            ),
            source,
            vertex_entry,
            fragment_entry,
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: source_id.clone(),
                slot,
                seq,
            },
            blend,
            vertex_count: 3,
            instance_count: 1,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            primitive_topology,
            depth_enabled: false,
            depth_write: false,
            depth_compare,
            bindings: vec![binding],
        };
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::Planet(state),
            NativeGraphFrameJob {
                buffers: vec![buffer_spec],
                pass_plans: Vec::new(),
                render_plans: vec![render_plan],
            },
        ))
    }

    fn build_native_ink_cloud_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_ink_cloud_native_params(&graph_layer.params);
        let seed_key = ink_cloud_seed_key(&params);
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.ink_cloud_state.clone();
        let mut reset_particles =
            state.particle_count != params.particle_count || state.seed_key != seed_key;
        if reset_particles {
            state = NativeInkCloudGraphState::new(params.particle_count, seed_key.clone(), time);
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 1.0 / 15.0);
        state.prev_frame_time = time;

        let bass = if params.audio_reactive {
            params.bass.max(self.audio0[1]).clamp(0.0, 2.0)
        } else {
            0.0
        };
        let treble = if params.audio_reactive {
            params.treble.max(self.audio0[3]).clamp(0.0, 2.0)
        } else {
            0.0
        };
        let bass_delta = (bass - state.prev_bass).max(0.0);
        if bass_delta > 0.05 {
            state.burst_hold_timer = state.burst_hold_timer.max(0.15);
        }
        state.burst_hold_timer = (state.burst_hold_timer - dt).max(0.0);
        state.prev_bass = bass;
        let audio_burst = if state.burst_hold_timer > 0.0 {
            params.audio_burst_strength
        } else {
            0.0
        };
        state.auto_rot_x_phase += params.auto_rotate_x * dt;
        state.auto_rot_y_phase += params.auto_rotate_y * dt;
        state.auto_rot_z_phase += params.auto_rotate_z * dt;

        let sim_shader_id = "ink-cloud/sim";
        let bg_shader_id = "ink-cloud/background";
        let render_shader_id = "ink-cloud/render";
        let (sim_hash, sim_source) = self.native_graph_shader_source(sim_shader_id, "cs_main")?;
        let (bg_hash, bg_source) = self.native_graph_shader_source(bg_shader_id, "fs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;

        let source_id = graph_layer.source_id.clone();
        let safe_source = native_graph_buffer_safe_id(&source_id);
        let prefix = format!("ink-cloud:{}:{}", safe_source, params.particle_count.max(1));
        let id = |name: &str| format!("{prefix}:{name}");
        let particle_id = id("particles");
        let sim_uniform_id = id("sim-uniform");
        let render_uniform_id = id("render-uniform");
        let bg_uniform_id = id("bg-uniform");
        let emitter_id = id("emitters");
        let particle_buffer_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&particle_id)
            })
            .unwrap_or(true);
        if particle_buffer_missing {
            reset_particles = true;
            state = NativeInkCloudGraphState::new(params.particle_count, seed_key.clone(), time);
            dt = 1.0 / self.target_fps.max(1) as f32;
        }
        let seq = self.native_frame_index();

        let buffers = vec![
            NativeComputeGraphBufferSpec {
                id: sim_uniform_id.clone(),
                byte_length: 192,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_ink_cloud_sim_uniform_bytes(
                    &params,
                    dt,
                    time,
                    bass,
                    treble,
                    audio_burst,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 128,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_ink_cloud_render_uniform_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                    time,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: bg_uniform_id.clone(),
                byte_length: 16,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_ink_cloud_background_uniform_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: emitter_id.clone(),
                byte_length: (INK_CLOUD_MAX_EMITTERS * 32) as u64,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: build_ink_cloud_emitter_buffer_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: particle_id.clone(),
                byte_length: u64::from(params.particle_count)
                    .saturating_mul(INK_CLOUD_PARTICLE_BYTES),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset_particles {
                    build_ink_cloud_initial_particle_buffer_bytes(&params)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset_particles,
                indirect: false,
            },
        ];

        let sim_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: sim_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 2,
                resource_id: emitter_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
        ];
        let sim_layout_sig = native_graph_binding_layout_signature(&sim_bindings);
        let pass_plans = vec![NativeComputeGraphPassPlan {
            name: "ink-cloud-sim".to_string(),
            cache_key: format!("graph:{sim_shader_id}:{sim_hash}:cs_main:{sim_layout_sig}"),
            source: sim_source,
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: sim_bindings,
        }];

        let slot = self.assign_source_frame_slot(&source_id);
        let target = NativeComputeGraphRenderTarget::SourceFrame {
            source_id: source_id.clone(),
            slot,
            seq,
        };
        let bg_bindings = vec![NativeComputeGraphBindingSpec {
            binding: 0,
            resource_id: bg_uniform_id,
            kind: NativeComputeGraphBindingKind::Buffer(NativeComputeBufferBindingKind::Uniform),
            source_slot: None,
        }];
        let bg_layout_sig = native_graph_binding_layout_signature(&bg_bindings);
        let render_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: render_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
        ];
        let render_layout_sig = native_graph_binding_layout_signature(&render_bindings);
        let render_plans = vec![
            NativeComputeGraphRenderPlan {
                name: "ink-cloud-background".to_string(),
                cache_key: format!(
                    "graph-render:{bg_shader_id}:{bg_hash}:vs_main:fs_main:{}:{}:{}:{}:{}:{bg_layout_sig}",
                    NativeComputeGraphRenderBlend::Alpha.signature(),
                    NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                    "nodepth",
                    "read",
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: bg_source,
                vertex_entry: "vs_main".to_string(),
                fragment_entry: "fs_main".to_string(),
                clear: true,
                include_snapshot: false,
                generate_mips: false,
                target: target.clone(),
                blend: NativeComputeGraphRenderBlend::Alpha,
                vertex_count: 3,
                instance_count: 1,
                indirect_buffer_id: None,
                indirect_offset: 0,
                clear_color: [0.0, 0.0, 0.0, 0.0],
                primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
                depth_enabled: false,
                depth_write: false,
                depth_compare: NativeComputeGraphDepthCompare::Less,
                bindings: bg_bindings,
            },
            NativeComputeGraphRenderPlan {
                name: "ink-cloud-render".to_string(),
                cache_key: format!(
                    "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:{}:{}:{}:{render_layout_sig}",
                    NativeComputeGraphRenderBlend::Alpha.signature(),
                    NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                    "nodepth",
                    "read",
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: render_source,
                vertex_entry: "vs_main".to_string(),
                fragment_entry: "fs_main".to_string(),
                clear: false,
                include_snapshot: false,
                generate_mips: false,
                target,
                blend: NativeComputeGraphRenderBlend::Alpha,
                vertex_count: 6,
                instance_count: params.particle_count.max(1),
                indirect_buffer_id: None,
                indirect_offset: 0,
                clear_color: [0.0, 0.0, 0.0, 0.0],
                primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
                depth_enabled: false,
                depth_write: false,
                depth_compare: NativeComputeGraphDepthCompare::Less,
                bindings: render_bindings,
            },
        ];
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::InkCloud(state),
            NativeGraphFrameJob {
                buffers,
                pass_plans,
                render_plans,
            },
        ))
    }

    fn build_native_smoke_3d_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_smoke_3d_native_params(&graph_layer.params);
        let time = self.native_graph_time_seconds();
        let source_id = graph_layer.source_id.clone();
        let safe_source = native_graph_buffer_safe_id(&source_id);
        let prefix = format!("3d-smoke:{}:{}", safe_source, params.grid_size);
        let id = |name: &str| format!("{prefix}:{name}");
        let persistent_ids = [
            id("velocity-a"),
            id("velocity-b"),
            id("density-a"),
            id("density-b"),
            id("divergence"),
            id("pressure-a"),
            id("pressure-b"),
        ];
        let buffers_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                persistent_ids.iter().any(|buffer_id| {
                    !renderer
                        .native_compute_graph_buffers
                        .contains_key(buffer_id)
                })
            })
            .unwrap_or(true);
        let mut state = graph_layer.smoke_3d_state.clone();
        let reset_buffers = state.grid != params.grid_size || buffers_missing;
        if reset_buffers {
            state = NativeSmoke3DGraphState::new(params.grid_size, time);
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 1.0 / 15.0);
        state.prev_frame_time = time;
        state.auto_rot_x_phase += params.auto_rotate_x * dt;
        state.auto_rot_y_phase += params.auto_rotate_y * dt;
        state.auto_rot_z_phase += params.auto_rotate_z * dt;

        let bass = params.bass.max(self.audio0[1]).clamp(0.0, 1.0);
        let bass_delta = (bass - state.prev_bass).max(0.0);
        if bass_delta > 0.05 {
            state.burst_hold_timer = state.burst_hold_timer.max(0.15);
        }
        state.burst_hold_timer = (state.burst_hold_timer - dt).max(0.0);
        state.prev_bass = bass;
        state.splat_timer += dt;
        let splat_period = 1.0 / params.splat_rate.max(0.1);
        let scheduled_fire = state.splat_timer >= splat_period;
        if scheduled_fire {
            state.splat_timer = 0.0;
        }
        let burst_active = state.burst_hold_timer > 0.0;
        let fire = scheduled_fire || burst_active || reset_buffers;
        let burst_mul = if burst_active {
            2.5 + params.audio_burst
        } else {
            1.0
        };

        let cell_count = u64::from(params.grid_size)
            .saturating_mul(u64::from(params.grid_size))
            .saturating_mul(u64::from(params.grid_size));
        let vec4_bytes = cell_count.saturating_mul(16);
        let f32_bytes = cell_count.saturating_mul(4);
        let sim_uniform_id = id("sim-uniform");
        let render_uniform_id = id("render-uniform");
        let emitters_id = id("emitters");
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: sim_uniform_id.clone(),
                byte_length: 96,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_3d_sim_uniform_bytes(&params, dt, time, fire, burst_mul),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 192,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_3d_render_uniform_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: emitters_id.clone(),
                byte_length: (SMOKE_3D_MAX_EMITTERS * 48) as u64,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: build_smoke_3d_emitters_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
        ];
        for buffer_id in persistent_ids.iter() {
            let byte_length = if buffer_id.ends_with("divergence")
                || buffer_id.ends_with("pressure-a")
                || buffer_id.ends_with("pressure-b")
            {
                f32_bytes
            } else {
                vec4_bytes
            };
            buffers.push(NativeComputeGraphBufferSpec {
                id: buffer_id.clone(),
                byte_length,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: Vec::new(),
                persistent: true,
                clear: reset_buffers,
                indirect: false,
            });
        }

        let dispatch = [params.grid_size.div_ceil(4).max(1); 3];
        let binding =
            |binding: u32, resource_id: String, buffer_kind: NativeComputeBufferBindingKind| {
                NativeComputeGraphBindingSpec {
                    binding,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(buffer_kind),
                    source_slot: None,
                }
            };
        let mut pass_plans = Vec::new();
        let mut add_pass = |name: String,
                            shader_id: &str,
                            entry: &str,
                            bindings: Vec<NativeComputeGraphBindingSpec>|
         -> Result<(), String> {
            let (hash, source) = self.native_graph_shader_source(shader_id, entry)?;
            let layout_sig = native_graph_binding_layout_signature(&bindings);
            pass_plans.push(NativeComputeGraphPassPlan {
                name,
                cache_key: format!("graph:{shader_id}:{hash}:{entry}:{layout_sig}"),
                source,
                entry: entry.to_string(),
                dispatch,
                bindings,
            });
            Ok(())
        };
        let ping = |flip: bool, a: &str, b: &str| if flip { id(b) } else { id(a) };
        let mut vel_flip = state.vel_flip;
        let mut den_flip = state.den_flip;
        let mut prs_flip = state.prs_flip;
        if fire {
            add_pass(
                "3d-smoke-splat".to_string(),
                "3d-smoke/splat",
                "cs_splat",
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        3,
                        emitters_id.clone(),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                ],
            )?;
        }
        add_pass(
            "3d-smoke-advect-velocity".to_string(),
            "3d-smoke/advect-velocity",
            "cs_advect_vel",
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    ping(!vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        vel_flip = !vel_flip;
        add_pass(
            "3d-smoke-divergence".to_string(),
            "3d-smoke/divergence",
            "cs_divergence",
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    id("divergence"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        for iteration in 0..SMOKE_3D_PRESSURE_ITERATIONS {
            add_pass(
                format!("3d-smoke-jacobi-{}", iteration + 1),
                "3d-smoke/jacobi",
                "cs_jacobi",
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        3,
                        id("divergence"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        4,
                        ping(prs_flip, "pressure-a", "pressure-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        5,
                        ping(!prs_flip, "pressure-a", "pressure-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ],
            )?;
            prs_flip = !prs_flip;
        }
        add_pass(
            "3d-smoke-subtract-gradient".to_string(),
            "3d-smoke/subtract-gradient",
            "cs_subtract_grad",
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    ping(prs_flip, "pressure-a", "pressure-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    4,
                    ping(!vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        vel_flip = !vel_flip;
        add_pass(
            "3d-smoke-advect-density".to_string(),
            "3d-smoke/advect-density",
            "cs_advect_den",
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    3,
                    ping(!den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        den_flip = !den_flip;

        state.grid = params.grid_size;
        state.vel_flip = vel_flip;
        state.den_flip = den_flip;
        state.prs_flip = prs_flip;

        let render_shader_id = "3d-smoke/render";
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let slot = self.assign_source_frame_slot(&source_id);
        let seq = self.native_frame_index();
        let render_bindings = vec![
            binding(
                0,
                render_uniform_id,
                NativeComputeBufferBindingKind::Uniform,
            ),
            binding(
                1,
                ping(den_flip, "density-a", "density-b"),
                NativeComputeBufferBindingKind::StorageRead,
            ),
        ];
        let render_layout_sig = native_graph_binding_layout_signature(&render_bindings);
        let render_plan = NativeComputeGraphRenderPlan {
            name: "3d-smoke-raymarch".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:{}:{}:{}:{render_layout_sig}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                "nodepth",
                "read",
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: source_id.clone(),
                slot,
                seq,
            },
            blend: NativeComputeGraphRenderBlend::Alpha,
            vertex_count: 3,
            instance_count: 1,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 0.0],
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: false,
            depth_write: false,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            bindings: render_bindings,
        };
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::Smoke3D(state),
            NativeGraphFrameJob {
                buffers,
                pass_plans,
                render_plans: vec![render_plan],
            },
        ))
    }

    fn build_native_particle_field_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_particle_field_native_params(&graph_layer.params);
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.particle_field_state.clone();
        let mut reset_particles =
            state.mode_id != params.mode_id || state.particle_count != params.particle_count;
        if reset_particles {
            state = NativeParticleFieldGraphState::new(params.mode_id, params.particle_count, time);
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 1.0 / 15.0);
        state.prev_frame_time = time;

        let bass = params.bass.max(self.audio0[1]).clamp(0.0, 4.0);
        let treble = params.treble.max(self.audio0[3]).clamp(0.0, 4.0);
        let bass_delta = (bass - state.prev_bass).max(0.0);
        if bass_delta > 0.04 {
            state.burst_impulse += bass_delta * params.burst_gain * 8.0;
        }
        state.burst_impulse =
            (state.burst_impulse - state.burst_impulse * params.burst_decay * dt).max(0.0);
        state.prev_bass = bass;
        state.hue_shift_phase =
            (state.hue_shift_phase + params.hue_shift_speed * dt).rem_euclid(1.0);
        state.color_cycle_phase =
            (state.color_cycle_phase + params.color_cycle_speed * dt).rem_euclid(1.0);
        state.auto_rot_x_phase += params.auto_rotate[0] * dt;
        state.auto_rot_y_phase += params.auto_rotate[1] * dt;
        state.auto_rot_z_phase += params.auto_rotate[2] * dt;

        let behavior_shader_id = "particle-field/behavior";
        let edge_shader_id = "particle-field/edges";
        let fog_shader_id = "particle-field/fog";
        let render_shader_id = "particle-field/render";
        let line_shader_id = "particle-field/lines";
        let (behavior_hash, behavior_source) =
            self.native_graph_shader_source(behavior_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let (fog_hash, fog_source) = self.native_graph_shader_source(fog_shader_id, "fs_main")?;
        self.native_graph_shader_source(fog_shader_id, "vs_main")?;
        let (edge_hash, edge_source) = if params.connect_enabled {
            let value = self.native_graph_shader_source(edge_shader_id, "cs_edges")?;
            (Some(value.0), Some(value.1))
        } else {
            (None, None)
        };
        let (line_hash, line_source) = if params.connect_enabled {
            let value = self.native_graph_shader_source(line_shader_id, "fs_main")?;
            self.native_graph_shader_source(line_shader_id, "vs_main")?;
            (Some(value.0), Some(value.1))
        } else {
            (None, None)
        };

        let source_id = graph_layer.source_id.clone();
        let prefix = format!(
            "particle-field:{}:{}:{}",
            native_graph_buffer_safe_id(&source_id),
            params.mode_label,
            params.particle_count
        );
        let id = |name: &str| format!("{prefix}:{name}");
        let behavior_uniform_id = id("behavior-uniform");
        let render_uniform_id = id("render-uniform");
        let fog_uniform_id = id("fog-uniform");
        let particle_id = id("particles");
        let edge_uniform_id = id("edge-uniform");
        let line_uniform_id = id("line-uniform");
        let indirect_id = id("indirect");
        let edges_id = id("edges");
        let particle_buffer_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&particle_id)
            })
            .unwrap_or(true);
        if particle_buffer_missing {
            reset_particles = true;
            state = NativeParticleFieldGraphState::new(params.mode_id, params.particle_count, time);
            dt = 1.0 / self.target_fps.max(1) as f32;
        }

        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: behavior_uniform_id.clone(),
                byte_length: 384,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_particle_field_behavior_uniform_bytes(
                    &params, &state, dt, time, bass, treble,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 192,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_particle_field_render_uniform_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: fog_uniform_id.clone(),
                byte_length: 16,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_particle_field_fog_uniform_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: particle_id.clone(),
                byte_length: u64::from(params.particle_count)
                    .saturating_mul(PARTICLE_FIELD_PARTICLE_BYTES),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset_particles {
                    build_particle_field_initial_bytes(&params)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset_particles,
                indirect: false,
            },
        ];
        if params.connect_enabled {
            let mut indirect_bytes = vec![0_u8; 16];
            write_u32_le(&mut indirect_bytes, 0, 2);
            buffers.extend([
                NativeComputeGraphBufferSpec {
                    id: edge_uniform_id.clone(),
                    byte_length: 64,
                    kind: NativeComputeBufferBindingKind::Uniform,
                    initial_bytes: {
                        let mut bytes = vec![0_u8; 64];
                        write_u32_le(&mut bytes, 0, params.particle_count);
                        write_u32_le(&mut bytes, 1, params.partner_count);
                        write_u32_le(&mut bytes, 2, PARTICLE_FIELD_MAX_EDGES);
                        write_f32_le(&mut bytes, 4, params.local_radius);
                        write_f32_le(&mut bytes, 5, params.bridge_radius);
                        bytes
                    },
                    persistent: true,
                    clear: false,
                    indirect: false,
                },
                NativeComputeGraphBufferSpec {
                    id: line_uniform_id.clone(),
                    byte_length: 160,
                    kind: NativeComputeBufferBindingKind::Uniform,
                    initial_bytes: build_particle_field_line_uniform_bytes(
                        &params,
                        &state,
                        self.pending_width,
                        self.pending_height,
                    ),
                    persistent: true,
                    clear: false,
                    indirect: false,
                },
                NativeComputeGraphBufferSpec {
                    id: indirect_id.clone(),
                    byte_length: 16,
                    kind: NativeComputeBufferBindingKind::StorageReadWrite,
                    initial_bytes: indirect_bytes,
                    persistent: true,
                    clear: false,
                    indirect: true,
                },
                NativeComputeGraphBufferSpec {
                    id: edges_id.clone(),
                    byte_length: u64::from(PARTICLE_FIELD_MAX_EDGES)
                        .saturating_mul(PARTICLE_FIELD_EDGE_BYTES),
                    kind: NativeComputeBufferBindingKind::StorageReadWrite,
                    initial_bytes: Vec::new(),
                    persistent: true,
                    clear: reset_particles,
                    indirect: false,
                },
            ]);
        }

        let empty_source_slot = self.ensure_empty_source_frame_slot();
        let behavior_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: behavior_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 2,
                resource_id: EMPTY_SOURCE_FRAME_ID.to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameTexture(
                    NativeComputeGraphTextureDimension::D2,
                ),
                source_slot: Some(empty_source_slot),
            },
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: "source-frame-sampler".to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                source_slot: None,
            },
        ];
        let behavior_layout = native_graph_binding_layout_signature(&behavior_bindings);
        let mut pass_plans = vec![NativeComputeGraphPassPlan {
            name: "particle-behavior".to_string(),
            cache_key: format!(
                "graph:{behavior_shader_id}:{behavior_hash}:cs_main:{behavior_layout}"
            ),
            source: behavior_source,
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: behavior_bindings,
        }];
        if params.connect_enabled {
            let edge_bindings = vec![
                NativeComputeGraphBindingSpec {
                    binding: 0,
                    resource_id: particle_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 1,
                    resource_id: edge_uniform_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 2,
                    resource_id: indirect_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 3,
                    resource_id: edges_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    source_slot: None,
                },
            ];
            let edge_layout = native_graph_binding_layout_signature(&edge_bindings);
            pass_plans.push(NativeComputeGraphPassPlan {
                name: "particle-edges".to_string(),
                cache_key: format!(
                    "graph:{edge_shader_id}:{}:cs_edges:{edge_layout}",
                    edge_hash.expect("edge shader hash")
                ),
                source: edge_source.expect("edge shader source"),
                entry: "cs_edges".to_string(),
                dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
                bindings: edge_bindings,
            });
        }

        let slot = self.assign_source_frame_slot(&source_id);
        let seq = self.native_frame_index();
        let target = NativeComputeGraphRenderTarget::SourceFrame {
            source_id: source_id.clone(),
            slot,
            seq,
        };
        let mut render_plans = Vec::new();
        if params.fog_opacity > 0.001 {
            let bindings = vec![NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: fog_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            }];
            let layout = native_graph_binding_layout_signature(&bindings);
            render_plans.push(NativeComputeGraphRenderPlan {
                name: "particle-fog".to_string(),
                cache_key: format!(
                    "graph-render:{fog_shader_id}:{fog_hash}:vs_main:fs_main:{}:{}:nodepth:read:{}:{layout}",
                    NativeComputeGraphRenderBlend::Alpha.signature(),
                    NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: fog_source,
                vertex_entry: "vs_main".to_string(),
                fragment_entry: "fs_main".to_string(),
                clear: true,
                include_snapshot: false,
                generate_mips: false,
                target: target.clone(),
                blend: NativeComputeGraphRenderBlend::Alpha,
                vertex_count: 3,
                instance_count: 1,
                indirect_buffer_id: None,
                indirect_offset: 0,
                clear_color: [0.0, 0.0, 0.0, 0.0],
                primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
                depth_enabled: false,
                depth_write: false,
                depth_compare: NativeComputeGraphDepthCompare::Less,
                bindings,
            });
        }
        let sphere_depth = matches!(params.topology_id, 3 | 4);
        let bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: render_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
        ];
        let layout = native_graph_binding_layout_signature(&bindings);
        render_plans.push(NativeComputeGraphRenderPlan {
            name: "particle-render".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:{}:write:{}:{layout}",
                if sphere_depth { NativeComputeGraphRenderBlend::Alpha.signature() } else { NativeComputeGraphRenderBlend::Add.signature() },
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                if sphere_depth { "depth" } else { "nodepth" },
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: render_plans.is_empty(),
            include_snapshot: false,
            generate_mips: false,
            target: target.clone(),
            blend: if sphere_depth {
                NativeComputeGraphRenderBlend::Alpha
            } else {
                NativeComputeGraphRenderBlend::Add
            },
            vertex_count: 6,
            instance_count: params.particle_count,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 0.0],
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: sphere_depth,
            depth_write: sphere_depth,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            bindings,
        });
        if params.connect_enabled {
            let bindings = vec![
                NativeComputeGraphBindingSpec {
                    binding: 0,
                    resource_id: particle_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 1,
                    resource_id: edges_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 2,
                    resource_id: line_uniform_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    source_slot: None,
                },
            ];
            let layout = native_graph_binding_layout_signature(&bindings);
            render_plans.push(NativeComputeGraphRenderPlan {
                name: "particle-lines".to_string(),
                cache_key: format!(
                    "graph-render:{line_shader_id}:{}:vs_main:fs_main:{}:{}:nodepth:read:{}:{layout}",
                    line_hash.expect("line shader hash"),
                    NativeComputeGraphRenderBlend::Alpha.signature(),
                    NativeComputeGraphPrimitiveTopology::LineList.signature(),
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: line_source.expect("line shader source"),
                vertex_entry: "vs_main".to_string(),
                fragment_entry: "fs_main".to_string(),
                clear: false,
                include_snapshot: false,
                generate_mips: false,
                target,
                blend: NativeComputeGraphRenderBlend::Alpha,
                vertex_count: 2,
                instance_count: 0,
                indirect_buffer_id: Some(indirect_id),
                indirect_offset: 0,
                clear_color: [0.0, 0.0, 0.0, 0.0],
                primitive_topology: NativeComputeGraphPrimitiveTopology::LineList,
                depth_enabled: false,
                depth_write: false,
                depth_compare: NativeComputeGraphDepthCompare::Less,
                bindings,
            });
        }
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::ParticleField(state),
            NativeGraphFrameJob {
                buffers,
                pass_plans,
                render_plans,
            },
        ))
    }

    fn build_native_pixel_particles_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_pixel_particles_native_params(&graph_layer.params);
        if graph_layer.input_source_id.is_empty() {
            return Err("pixel particles requires a native input source".to_string());
        }
        let input_slot = self
            .source_frame_slots
            .get(&graph_layer.input_source_id)
            .copied()
            .ok_or_else(|| {
                format!(
                    "pixel particles input `{}` is not ready",
                    graph_layer.input_source_id
                )
            })?;
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.pixel_particles_state.clone();
        let mut reset = state.mode_id != params.mode_id
            || state.particle_count != params.particle_count
            || state.input_source_id != graph_layer.input_source_id;
        if reset {
            state = NativePixelParticlesGraphState::new(
                params.mode_id,
                params.particle_count,
                graph_layer.input_source_id.clone(),
                time,
            );
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 0.05);
        state.prev_frame_time = time;

        let compute_shader_id = "pixel-particles/compute";
        let render_shader_id = "pixel-particles/render";
        let (compute_hash, compute_source) =
            self.native_graph_shader_source(compute_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;

        let source_id = graph_layer.source_id.clone();
        let prefix = format!(
            "pixel-particles:{}:{}:{}",
            native_graph_buffer_safe_id(&source_id),
            params.mode_id,
            params.particle_count
        );
        let id = |name: &str| format!("{prefix}:{name}");
        let globals_id = id("globals");
        let render_uniform_id = id("render-uniform");
        let particle_id = id("particles");
        let particle_buffer_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&particle_id)
            })
            .unwrap_or(true);
        reset |= particle_buffer_missing;
        let source_frame_size = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.source_frame_size.max(1) as f32)
            .unwrap_or_else(|| self.pending_width.max(self.pending_height).max(1) as f32);
        let buffers = vec![
            NativeComputeGraphBufferSpec {
                id: globals_id.clone(),
                byte_length: 176,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_pixel_particles_globals_bytes(
                    &params,
                    time,
                    dt,
                    self.pending_width,
                    self.pending_height,
                    source_frame_size,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 96,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_pixel_particles_render_bytes(
                    &params,
                    self.pending_width,
                    self.pending_height,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: particle_id.clone(),
                byte_length: u64::from(params.particle_count)
                    .saturating_mul(PIXEL_PARTICLES_PARTICLE_BYTES),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset {
                    build_pixel_particles_initial_bytes(params.particle_count)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
        ];
        let empty_slot = self.ensure_empty_source_frame_slot();
        let source_texture = NativeComputeGraphBindingSpec {
            binding: 2,
            resource_id: graph_layer.input_source_id.clone(),
            kind: NativeComputeGraphBindingKind::SourceFrameTexture(
                NativeComputeGraphTextureDimension::D2,
            ),
            source_slot: Some(input_slot),
        };
        let compute_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: globals_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            source_texture.clone(),
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: "source-frame-sampler".to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 4,
                resource_id: EMPTY_SOURCE_FRAME_ID.to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameTexture(
                    NativeComputeGraphTextureDimension::D2,
                ),
                source_slot: Some(empty_slot),
            },
        ];
        let compute_layout = native_graph_binding_layout_signature(&compute_bindings);
        let pass_plans = vec![NativeComputeGraphPassPlan {
            name: "pixel-particles-compute".to_string(),
            cache_key: format!("graph:{compute_shader_id}:{compute_hash}:cs_main:{compute_layout}"),
            source: compute_source,
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: compute_bindings,
        }];

        let output_slot = self.assign_source_frame_slot(&source_id);
        let seq = self.native_frame_index();
        let render_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: render_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            source_texture,
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: "source-frame-sampler".to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                source_slot: None,
            },
        ];
        let render_layout = native_graph_binding_layout_signature(&render_bindings);
        let render_plans = vec![NativeComputeGraphRenderPlan {
            name: "pixel-particles-render".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:nodepth:read:{}:{render_layout}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: source_id.clone(),
                slot: output_slot,
                seq,
            },
            blend: NativeComputeGraphRenderBlend::Alpha,
            vertex_count: 6,
            instance_count: params.particle_count,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 0.0],
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: false,
            depth_write: false,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            bindings: render_bindings,
        }];
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(output_slot);
            }
        }
        Ok((
            NativeGraphLayerState::PixelParticles(state),
            NativeGraphFrameJob {
                buffers,
                pass_plans,
                render_plans,
            },
        ))
    }

    fn build_native_flythrough_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_flythrough_native_params(&graph_layer.params);
        if graph_layer.input_source_id.is_empty() {
            return Err("flythrough requires a native input source".to_string());
        }
        let input_slot = self
            .source_frame_slots
            .get(&graph_layer.input_source_id)
            .copied()
            .ok_or_else(|| {
                format!(
                    "flythrough input `{}` is not ready",
                    graph_layer.input_source_id
                )
            })?;
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.flythrough_state.clone();
        let mut reset = state.particle_count != params.particle_count
            || state.input_source_id != graph_layer.input_source_id;
        if reset {
            state = NativeFlythroughGraphState::new(
                params.particle_count,
                graph_layer.input_source_id.clone(),
                time,
            );
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 1.0 / 15.0);
        state.prev_frame_time = time;
        let bass = self.audio0[1].clamp(0.0, 4.0);
        let treble = self.audio0[3].clamp(0.0, 4.0);
        state.fly_distance += params.fly_speed
            * if params.audio_reactive {
                1.0 + bass * 1.8
            } else {
                1.0
            }
            * dt;

        let compute_shader_id = "flythrough/compute";
        let render_shader_id = "flythrough/render";
        let (compute_hash, compute_source) =
            self.native_graph_shader_source(compute_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let source_id = graph_layer.source_id.clone();
        let prefix = format!(
            "flythrough:{}:{}",
            native_graph_buffer_safe_id(&source_id),
            params.particle_count
        );
        let id = |name: &str| format!("{prefix}:{name}");
        let compute_uniform_id = id("compute-uniform");
        let render_uniform_id = id("render-uniform");
        let particle_id = id("particles");
        let particle_buffer_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&particle_id)
            })
            .unwrap_or(true);
        reset |= particle_buffer_missing;
        let buffers = vec![
            NativeComputeGraphBufferSpec {
                id: compute_uniform_id.clone(),
                byte_length: 64,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_flythrough_compute_bytes(&params, &state, dt, time, treble),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 256,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_flythrough_render_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: particle_id.clone(),
                byte_length: u64::from(params.particle_count)
                    .saturating_mul(FLYTHROUGH_PARTICLE_BYTES),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset {
                    build_flythrough_initial_bytes(params.particle_count)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
        ];
        let source_texture = NativeComputeGraphBindingSpec {
            binding: 2,
            resource_id: graph_layer.input_source_id.clone(),
            kind: NativeComputeGraphBindingKind::SourceFrameTexture(
                NativeComputeGraphTextureDimension::D2,
            ),
            source_slot: Some(input_slot),
        };
        let compute_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: compute_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            source_texture.clone(),
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: "source-frame-sampler".to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                source_slot: None,
            },
        ];
        let compute_layout = native_graph_binding_layout_signature(&compute_bindings);
        let pass_plans = vec![NativeComputeGraphPassPlan {
            name: "flythrough-compute".to_string(),
            cache_key: format!("graph:{compute_shader_id}:{compute_hash}:cs_main:{compute_layout}"),
            source: compute_source,
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: compute_bindings,
        }];
        let output_slot = self.assign_source_frame_slot(&source_id);
        let seq = self.native_frame_index();
        let render_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: render_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            source_texture,
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: "source-frame-sampler".to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                source_slot: None,
            },
        ];
        let render_layout = native_graph_binding_layout_signature(&render_bindings);
        let render_plans = vec![NativeComputeGraphRenderPlan {
            name: "flythrough-render".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:nodepth:read:{}:{render_layout}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: source_id.clone(),
                slot: output_slot,
                seq,
            },
            blend: NativeComputeGraphRenderBlend::Alpha,
            vertex_count: 6,
            instance_count: params.slab_count.saturating_mul(params.particle_count),
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 0.0],
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: false,
            depth_write: false,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            bindings: render_bindings,
        }];
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(output_slot);
            }
        }
        Ok((
            NativeGraphLayerState::Flythrough(state),
            NativeGraphFrameJob {
                buffers,
                pass_plans,
                render_plans,
            },
        ))
    }

    fn build_native_point_cloud_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let asset = self
            .native_point_cloud_assets
            .get(&graph_layer.layer_id)
            .cloned()
            .ok_or_else(|| "point cloud native buffers are not uploaded yet".to_string())?;
        let params = normalize_point_cloud_native_params(&graph_layer.params);
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.point_cloud_state.clone();
        let mut reset =
            state.signature != asset.signature || state.point_count != asset.point_count;
        if reset {
            state =
                NativePointCloudGraphState::new(asset.signature.clone(), asset.point_count, time);
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 1.0 / 15.0);
        state.prev_frame_time = time;
        let bass = if params.audio_reactive {
            self.audio0[1].clamp(0.0, 4.0)
        } else {
            0.0
        };
        let treble = if params.audio_reactive {
            self.audio0[3].clamp(0.0, 4.0)
        } else {
            0.0
        };
        let bass_delta = (bass - state.prev_bass).max(0.0);
        if bass_delta > 0.04 {
            state.burst_impulse += bass_delta * params.burst_gain * 8.0;
        }
        state.burst_impulse =
            (state.burst_impulse - state.burst_impulse * params.burst_decay * dt).max(0.0);
        state.prev_bass = bass;
        state.hue_shift_phase =
            (state.hue_shift_phase + params.hue_shift_speed * dt).rem_euclid(1.0);
        state.color_cycle_phase =
            (state.color_cycle_phase + params.color_cycle_speed * dt).rem_euclid(1.0);
        state.wave_time += params.wave_speed * dt;
        state.auto_rot_x_phase += params.auto_rotate[0] * dt;
        state.auto_rot_y_phase += params.auto_rotate[1] * dt;
        state.auto_rot_z_phase += params.auto_rotate[2] * dt;

        let compute_shader_id = "point-cloud-fx/compute";
        let sort_fill_shader_id = "point-cloud-fx/sort-fill";
        let sort_step_shader_id = "point-cloud-fx/sort-step";
        let render_shader_id = "point-cloud-fx/render";
        let (compute_hash, compute_source) =
            self.native_graph_shader_source(compute_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let should_sort = asset.depth_sort_enabled && asset.sort_count > 1;
        let (sort_fill_hash, sort_fill_source, sort_step_hash, sort_step_source) = if should_sort {
            let fill = self.native_graph_shader_source(sort_fill_shader_id, "cs_main")?;
            let step = self.native_graph_shader_source(sort_step_shader_id, "cs_main")?;
            (Some(fill.0), Some(fill.1), Some(step.0), Some(step.1))
        } else {
            (None, None, None, None)
        };

        let prefix = format!("{}:point-cloud-fx", graph_layer.source_id);
        let id = |name: &str| format!("{prefix}:{name}");
        let home_id = id("home");
        let live_id = id("live");
        let sort_id = id("sort-pairs");
        let compute_uniform_id = id("compute-uniform");
        let render_uniform_id = id("render-uniform");
        let buffers_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer.native_compute_graph_buffers.contains_key(&home_id)
                    || !renderer.native_compute_graph_buffers.contains_key(&live_id)
                    || !renderer.native_compute_graph_buffers.contains_key(&sort_id)
            })
            .unwrap_or(true);
        reset |= buffers_missing;
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: home_id.clone(),
                byte_length: asset.home_bytes.len() as u64,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: if reset {
                    asset.home_bytes.clone()
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: live_id.clone(),
                byte_length: asset.live_bytes.len() as u64,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset {
                    asset.live_bytes.clone()
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: sort_id.clone(),
                byte_length: asset.sort_bytes.len() as u64,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset {
                    asset.sort_bytes.clone()
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: compute_uniform_id.clone(),
                byte_length: 288,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_point_cloud_compute_bytes(
                    &params, &state, dt, time, bass, treble,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 192,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_point_cloud_render_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
        ];
        let compute_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: home_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: live_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 2,
                resource_id: compute_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
        ];
        let compute_layout = native_graph_binding_layout_signature(&compute_bindings);
        let mut pass_plans = vec![NativeComputeGraphPassPlan {
            name: "point-cloud-fx/sim".to_string(),
            cache_key: format!("graph:{compute_shader_id}:{compute_hash}:cs_main:{compute_layout}"),
            source: compute_source,
            entry: "cs_main".to_string(),
            dispatch: [asset.point_count.div_ceil(64).max(1), 1, 1],
            bindings: compute_bindings,
        }];
        if should_sort {
            let fill_uniform_id = id("sort-fill-uniform");
            buffers.push(NativeComputeGraphBufferSpec {
                id: fill_uniform_id.clone(),
                byte_length: 80,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_point_cloud_sort_fill_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                    asset.sort_count,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            });
            let fill_bindings = vec![
                NativeComputeGraphBindingSpec {
                    binding: 0,
                    resource_id: live_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 1,
                    resource_id: sort_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 2,
                    resource_id: fill_uniform_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    source_slot: None,
                },
            ];
            let fill_layout = native_graph_binding_layout_signature(&fill_bindings);
            pass_plans.push(NativeComputeGraphPassPlan {
                name: "point-cloud-fx/sort-fill".to_string(),
                cache_key: format!(
                    "graph:{sort_fill_shader_id}:{}:cs_main:{fill_layout}",
                    sort_fill_hash.expect("sort fill hash")
                ),
                source: sort_fill_source.expect("sort fill source"),
                entry: "cs_main".to_string(),
                dispatch: [asset.sort_count.div_ceil(64).max(1), 1, 1],
                bindings: fill_bindings,
            });
            let mut pass_index = 0_u32;
            let mut sequence_size = 2_u32;
            while sequence_size <= asset.sort_count {
                let mut stride = sequence_size / 2;
                while stride >= 1 {
                    let uniform_id = id(&format!("sort-step-uniform-{pass_index}"));
                    let mut uniform = vec![0_u8; 16];
                    write_u32_le(&mut uniform, 0, asset.point_count);
                    write_u32_le(&mut uniform, 1, asset.sort_count);
                    write_u32_le(&mut uniform, 2, sequence_size);
                    write_u32_le(&mut uniform, 3, stride);
                    buffers.push(NativeComputeGraphBufferSpec {
                        id: uniform_id.clone(),
                        byte_length: 16,
                        kind: NativeComputeBufferBindingKind::Uniform,
                        initial_bytes: uniform,
                        persistent: true,
                        clear: false,
                        indirect: false,
                    });
                    let bindings = vec![
                        NativeComputeGraphBindingSpec {
                            binding: 0,
                            resource_id: sort_id.clone(),
                            kind: NativeComputeGraphBindingKind::Buffer(
                                NativeComputeBufferBindingKind::StorageReadWrite,
                            ),
                            source_slot: None,
                        },
                        NativeComputeGraphBindingSpec {
                            binding: 1,
                            resource_id: uniform_id,
                            kind: NativeComputeGraphBindingKind::Buffer(
                                NativeComputeBufferBindingKind::Uniform,
                            ),
                            source_slot: None,
                        },
                    ];
                    let layout = native_graph_binding_layout_signature(&bindings);
                    pass_plans.push(NativeComputeGraphPassPlan {
                        name: format!("point-cloud-fx/sort-step-{pass_index}"),
                        cache_key: format!(
                            "graph:{sort_step_shader_id}:{}:cs_main:{layout}",
                            sort_step_hash.expect("sort step hash")
                        ),
                        source: sort_step_source.clone().expect("sort step source"),
                        entry: "cs_main".to_string(),
                        dispatch: [asset.sort_count.div_ceil(64).max(1), 1, 1],
                        bindings,
                    });
                    pass_index += 1;
                    if stride == 1 {
                        break;
                    }
                    stride /= 2;
                }
                if sequence_size > asset.sort_count / 2 {
                    break;
                }
                sequence_size *= 2;
            }
        }

        let output_slot = self.assign_source_frame_slot(&graph_layer.source_id);
        let seq = self.native_frame_index();
        let render_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: home_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: live_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 2,
                resource_id: render_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: sort_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
        ];
        let render_layout = native_graph_binding_layout_signature(&render_bindings);
        let render_plans = vec![NativeComputeGraphRenderPlan {
            name: "point-cloud-fx/render".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:nodepth:read:{}:{render_layout}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: graph_layer.source_id.clone(),
                slot: output_slot,
                seq,
            },
            blend: NativeComputeGraphRenderBlend::Alpha,
            vertex_count: 6,
            instance_count: asset.point_count,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 0.0],
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: false,
            depth_write: false,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            bindings: render_bindings,
        }];
        self.source_frames
            .insert(graph_layer.source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(graph_layer.source_id.as_str()) {
                layer.frame_slot = Some(output_slot);
            }
        }
        Ok((
            NativeGraphLayerState::PointCloudFx(state),
            NativeGraphFrameJob {
                buffers,
                pass_plans,
                render_plans,
            },
        ))
    }

    /// Smoke Riders: ONE coupled instrument.
    ///
    /// splat -> advect-velocity -> VORTICITY -> divergence -> jacobi xN ->
    /// subtract-gradient -> advect-density -> RIDERS -> clear-tiles ->
    /// bin-riders -> one unified raymarch.
    ///
    /// The rider pass binds the SAME velocity/density buffers the fluid
    /// solve just produced, which is the whole point: the riders are moved
    /// by the fluid, not by a parallel noise field.
    fn build_native_smoke_riders_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        shader_prefix: &str,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_smoke_riders_native_params(
            &graph_layer.params,
            self.audio0[1].clamp(0.0, 4.0),
            self.audio0[3].clamp(0.0, 4.0),
            shader_prefix == "fluid-riders",
        );
        let time = self.native_graph_time_seconds();
        let width = self.pending_width.max(1);
        let height = self.pending_height.max(1);
        let (tile_count_x, tile_count_y) = smoke_riders_tile_counts(width, height);
        let tile_count = tile_count_x.saturating_mul(tile_count_y).max(1);
        let source_id = graph_layer.source_id.clone();
        let safe_source = native_graph_buffer_safe_id(&source_id);
        let prefix = format!("smoke-riders:{safe_source}");
        let grid_size = params.grid_size;
        let rider_count = params.rider_count;
        let uid = |name: &str| format!("{prefix}:{name}");
        let gid = |name: &str| format!("{prefix}:g{grid_size}:{name}");
        let rid = |name: &str| format!("{prefix}:r{rider_count}:{name}");
        let tid = |name: &str| format!("{prefix}:t{tile_count_x}x{tile_count_y}:{name}");

        let fluid_ids = [
            gid("velocity-a"),
            gid("velocity-b"),
            gid("density-a"),
            gid("density-b"),
            gid("divergence"),
            gid("pressure-a"),
            gid("pressure-b"),
            // One scratch field shared by both MacCormack advections:
            // velocity is corrected at the top of the frame and density
            // at the bottom, so the forward result never has to survive
            // across the two.
            gid("advect-tmp"),
        ];
        let riders_id = rid("riders");
        let tile_counts_id = tid("tile-counts");
        let tile_indices_id = tid("tile-indices");
        let buffers_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                fluid_ids
                    .iter()
                    .chain(std::iter::once(&riders_id))
                    .chain(std::iter::once(&tile_counts_id))
                    .chain(std::iter::once(&tile_indices_id))
                    .any(|buffer_id| {
                        !renderer
                            .native_compute_graph_buffers
                            .contains_key(buffer_id)
                    })
            })
            .unwrap_or(true);

        let mut state = graph_layer.smoke_riders_state.clone();
        let reset_buffers = state.grid != params.grid_size
            || state.rider_count != params.rider_count
            || state.tile_count_x != tile_count_x
            || state.tile_count_y != tile_count_y
            || buffers_missing;
        if reset_buffers {
            state = NativeSmokeRidersGraphState::new(
                params.grid_size,
                params.rider_count,
                tile_count_x,
                tile_count_y,
                time,
            );
        }

        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        // Master time scale — mirrors the TS builder so both paths agree.
        dt = dt.clamp(0.0, 1.0 / 15.0) * params.flow_speed;
        state.prev_frame_time = time;
        state.auto_rot_x_phase += params.auto_rotate_x * dt;
        state.auto_rot_y_phase += params.auto_rotate_y * dt;
        state.auto_rot_z_phase += params.auto_rotate_z * dt;

        let bass_delta = (params.bass - state.prev_bass).max(0.0);
        if bass_delta > 0.05 {
            state.burst_hold_timer = state.burst_hold_timer.max(0.15);
        }
        state.burst_hold_timer = (state.burst_hold_timer - dt).max(0.0);
        state.prev_bass = params.bass;
        let burst_active = state.burst_hold_timer > 0.0;
        state.splat_timer += dt;
        let splat_period = 1.0 / params.splat_rate.max(0.1);
        let scheduled_fire = state.splat_timer >= splat_period;
        if scheduled_fire {
            state.splat_timer = 0.0;
        }
        let fire = scheduled_fire || burst_active || reset_buffers;
        let burst_mul = if burst_active {
            2.5 + params.audio_burst
        } else {
            1.0
        };

        // Camera: projection * view * model. The model rotation is baked
        // into viewProj (the volume spins, the camera does not), so the
        // studio rig is rotated into object space when it is packed.
        let aspect = (width as f32 / height as f32).max(0.05);
        let proj = native_perspective(params.fov_deg, aspect, 0.01, 100.0);
        let view = native_translate(0.0, 0.0, -params.camera_z);
        let model = native_mat4_mul(
            native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
            native_mat4_mul(
                native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
                native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
            ),
        );
        let view_proj = native_mat4_mul(proj, native_mat4_mul(view, model));
        let inv_view_proj = native_mat4_invert(view_proj);

        let cell_count = u64::from(params.grid_size)
            .saturating_mul(u64::from(params.grid_size))
            .saturating_mul(u64::from(params.grid_size));
        let vec4_bytes = cell_count.saturating_mul(16);
        let f32_bytes = cell_count.saturating_mul(4);

        let sim_uniform_id = uid("sim-uniform");
        let vort_uniform_id = uid("vort-uniform");
        let surface_uniform_id = uid("surface-uniform");
        let rider_uniform_id = uid("rider-uniform");
        let bin_uniform_id = uid("bin-uniform");
        let render_uniform_id = uid("render-uniform");
        let emitters_id = uid("emitters");

        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: sim_uniform_id.clone(),
                byte_length: 96,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_sim_uniform_bytes(
                    &params, dt, time, fire, burst_mul,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: vort_uniform_id.clone(),
                byte_length: 32,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_vorticity_uniform_bytes(&params, dt),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: surface_uniform_id.clone(),
                byte_length: 32,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_surface_uniform_bytes(&params, dt),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: rider_uniform_id.clone(),
                byte_length: 128,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_rider_uniform_bytes(&params, dt, time),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: bin_uniform_id.clone(),
                byte_length: 96,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_bin_uniform_bytes(
                    &params,
                    view_proj,
                    tile_count_x,
                    tile_count_y,
                    aspect,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 384,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_render_uniform_bytes(
                    &params,
                    inv_view_proj,
                    model,
                    tile_count_x,
                    tile_count_y,
                    self.native_frame_index(),
                    time,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: emitters_id.clone(),
                byte_length: (SMOKE_3D_MAX_EMITTERS * 48) as u64,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: build_smoke_riders_emitter_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
        ];
        for buffer_id in fluid_ids.iter() {
            let byte_length = if buffer_id.ends_with("divergence")
                || buffer_id.ends_with("pressure-a")
                || buffer_id.ends_with("pressure-b")
            {
                f32_bytes
            } else {
                vec4_bytes
            };
            buffers.push(NativeComputeGraphBufferSpec {
                id: buffer_id.clone(),
                byte_length,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: Vec::new(),
                persistent: true,
                clear: reset_buffers,
                indirect: false,
            });
        }
        buffers.push(NativeComputeGraphBufferSpec {
            id: riders_id.clone(),
            byte_length: u64::from(params.rider_count)
                .saturating_mul(SMOKE_RIDERS_STRIDE_FLOATS as u64)
                .saturating_mul(4),
            kind: NativeComputeBufferBindingKind::StorageReadWrite,
            initial_bytes: if reset_buffers {
                build_smoke_riders_initial_rider_bytes(&params)
            } else {
                Vec::new()
            },
            persistent: true,
            clear: reset_buffers,
            indirect: false,
        });
        buffers.push(NativeComputeGraphBufferSpec {
            id: tile_counts_id.clone(),
            byte_length: u64::from(tile_count).saturating_mul(4),
            kind: NativeComputeBufferBindingKind::StorageReadWrite,
            initial_bytes: Vec::new(),
            persistent: true,
            clear: reset_buffers,
            indirect: false,
        });
        buffers.push(NativeComputeGraphBufferSpec {
            id: tile_indices_id.clone(),
            byte_length: u64::from(tile_count)
                .saturating_mul(SMOKE_RIDERS_TILE_CAP as u64)
                .saturating_mul(4),
            kind: NativeComputeBufferBindingKind::StorageReadWrite,
            initial_bytes: Vec::new(),
            persistent: true,
            clear: reset_buffers,
            indirect: false,
        });

        let grid_dispatch = [params.grid_size.div_ceil(4).max(1); 3];
        let rider_dispatch = [params.rider_count.div_ceil(64).max(1), 1, 1];
        let tile_dispatch = [tile_count.div_ceil(64).max(1), 1, 1];
        let binding =
            |binding: u32, resource_id: String, buffer_kind: NativeComputeBufferBindingKind| {
                NativeComputeGraphBindingSpec {
                    binding,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(buffer_kind),
                    source_slot: None,
                }
            };
        let mut pass_plans = Vec::new();
        let mut add_pass = |name: String,
                            shader_id: &str,
                            entry: &str,
                            dispatch: [u32; 3],
                            bindings: Vec<NativeComputeGraphBindingSpec>|
         -> Result<(), String> {
            let (hash, source) = self.native_graph_shader_source(shader_id, entry)?;
            let layout_sig = native_graph_binding_layout_signature(&bindings);
            pass_plans.push(NativeComputeGraphPassPlan {
                name,
                cache_key: format!("graph:{shader_id}:{hash}:{entry}:{layout_sig}"),
                source,
                entry: entry.to_string(),
                dispatch,
                bindings,
            });
            Ok(())
        };
        let ping = |flip: bool, a: &str, b: &str| if flip { gid(b) } else { gid(a) };
        let mut vel_flip = state.vel_flip;
        let mut den_flip = state.den_flip;
        let mut prs_flip = state.prs_flip;

        if fire {
            add_pass(
                "smoke-riders-splat".to_string(),
                "3d-smoke/splat",
                "cs_splat",
                grid_dispatch,
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        3,
                        emitters_id.clone(),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                ],
            )?;
        }
        if params.mac_cormack {
            // Forward advection into the scratch field, then the limited
            // correction. Both stages must see the same scratch buffer.
            let mac_bindings = || {
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        2,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        3,
                        gid("advect-tmp"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        4,
                        ping(!vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ]
            };
            add_pass(
                "smoke-riders-advect-velocity-fwd".to_string(),
                &format!("{shader_prefix}/advect"),
                "cs_advect_fwd",
                grid_dispatch,
                mac_bindings(),
            )?;
            add_pass(
                "smoke-riders-advect-velocity".to_string(),
                &format!("{shader_prefix}/advect"),
                "cs_advect_mc_vel",
                grid_dispatch,
                mac_bindings(),
            )?;
        } else {
            add_pass(
                "smoke-riders-advect-velocity".to_string(),
                "3d-smoke/advect-velocity",
                "cs_advect_vel",
                grid_dispatch,
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        3,
                        ping(!vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ],
            )?;
        }
        vel_flip = !vel_flip;
        // Vorticity confinement lands BEFORE the projection solve so the
        // injected swirl is made divergence-free with everything else.
        add_pass(
            "smoke-riders-vorticity".to_string(),
            &format!("{shader_prefix}/vorticity"),
            "cs_vorticity",
            grid_dispatch,
            vec![
                binding(
                    0,
                    vort_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(!vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        vel_flip = !vel_flip;
        // Surface tension + shear-thinning viscosity, also upstream of
        // the projection so the interface force comes out divergence-free.
        add_pass(
            "smoke-riders-surface-tension".to_string(),
            &format!("{shader_prefix}/surface"),
            "cs_surface_tension",
            grid_dispatch,
            vec![
                binding(
                    0,
                    surface_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    3,
                    ping(!vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        vel_flip = !vel_flip;
        add_pass(
            "smoke-riders-divergence".to_string(),
            "3d-smoke/divergence",
            "cs_divergence",
            grid_dispatch,
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    gid("divergence"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        // Warm start: scale last frame's pressure down instead of
        // restarting from it verbatim (or from zero). One bandwidth-bound
        // pass worth roughly triple the Jacobi sweeps it precedes.
        add_pass(
            "smoke-riders-pressure-warm".to_string(),
            &format!("{shader_prefix}/pressure"),
            "cs_pressure_warm",
            [(cell_count as u32).div_ceil(64).max(1), 1, 1],
            vec![
                binding(
                    0,
                    vort_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(prs_flip, "pressure-a", "pressure-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        for iteration in 0..params.pressure_iterations {
            add_pass(
                format!("smoke-riders-jacobi-{}", iteration + 1),
                "3d-smoke/jacobi",
                "cs_jacobi",
                grid_dispatch,
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        3,
                        gid("divergence"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        4,
                        ping(prs_flip, "pressure-a", "pressure-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        5,
                        ping(!prs_flip, "pressure-a", "pressure-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ],
            )?;
            prs_flip = !prs_flip;
        }
        add_pass(
            "smoke-riders-subtract-gradient".to_string(),
            "3d-smoke/subtract-gradient",
            "cs_subtract_grad",
            grid_dispatch,
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    ping(prs_flip, "pressure-a", "pressure-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    4,
                    ping(!vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        vel_flip = !vel_flip;
        if params.mac_cormack {
            let mac_bindings = || {
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        3,
                        gid("advect-tmp"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        4,
                        ping(!den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ]
            };
            add_pass(
                "smoke-riders-advect-density-fwd".to_string(),
                &format!("{shader_prefix}/advect"),
                "cs_advect_fwd",
                grid_dispatch,
                mac_bindings(),
            )?;
            add_pass(
                "smoke-riders-advect-density".to_string(),
                &format!("{shader_prefix}/advect"),
                "cs_advect_mc_den",
                grid_dispatch,
                mac_bindings(),
            )?;
        } else {
            add_pass(
                "smoke-riders-advect-density".to_string(),
                "3d-smoke/advect-density",
                "cs_advect_den",
                grid_dispatch,
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        3,
                        ping(!den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ],
            )?;
        }
        den_flip = !den_flip;

        // THE COUPLING: riders read the final divergence-free velocity,
        // the final density and the pressure field the projection solved.
        add_pass(
            "smoke-riders-riders".to_string(),
            &format!("{shader_prefix}/riders"),
            "cs_riders",
            rider_dispatch,
            vec![
                binding(
                    0,
                    rider_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    riders_id.clone(),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    2,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    3,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    4,
                    ping(prs_flip, "pressure-a", "pressure-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
            ],
        )?;
        let tile_bindings = || {
            vec![
                binding(
                    0,
                    bin_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    riders_id.clone(),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    tile_counts_id.clone(),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    tile_indices_id.clone(),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ]
        };
        add_pass(
            "smoke-riders-clear-tiles".to_string(),
            &format!("{shader_prefix}/tiles"),
            "cs_clear_tiles",
            tile_dispatch,
            tile_bindings(),
        )?;
        add_pass(
            "smoke-riders-bin-riders".to_string(),
            &format!("{shader_prefix}/tiles"),
            "cs_bin_riders",
            rider_dispatch,
            tile_bindings(),
        )?;

        state.grid = params.grid_size;
        state.rider_count = params.rider_count;
        state.tile_count_x = tile_count_x;
        state.tile_count_y = tile_count_y;
        state.vel_flip = vel_flip;
        state.den_flip = den_flip;
        state.prs_flip = prs_flip;

        let render_shader_id = &format!("{shader_prefix}/render");
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let slot = self.assign_source_frame_slot(&source_id);
        let seq = self.native_frame_index();
        let render_bindings = vec![
            binding(
                0,
                render_uniform_id,
                NativeComputeBufferBindingKind::Uniform,
            ),
            binding(
                1,
                ping(den_flip, "density-a", "density-b"),
                NativeComputeBufferBindingKind::StorageRead,
            ),
            binding(2, riders_id, NativeComputeBufferBindingKind::StorageRead),
            binding(
                3,
                tile_counts_id,
                NativeComputeBufferBindingKind::StorageRead,
            ),
            binding(
                4,
                tile_indices_id,
                NativeComputeBufferBindingKind::StorageRead,
            ),
        ];
        let render_layout_sig = native_graph_binding_layout_signature(&render_bindings);
        let render_plan = NativeComputeGraphRenderPlan {
            name: "smoke-riders-unified".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:nodepth:read:{}:{render_layout_sig}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: source_id.clone(),
                slot,
                seq,
            },
            blend: NativeComputeGraphRenderBlend::Alpha,
            vertex_count: 3,
            instance_count: 1,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 0.0],
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: false,
            depth_write: false,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            bindings: render_bindings,
        };
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::SmokeRiders(state),
            NativeGraphFrameJob {
                buffers,
                pass_plans,
                render_plans: vec![render_plan],
            },
        ))
    }

    fn build_native_volumetric_spheres_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_volumetric_spheres_native_params(&graph_layer.params);
        let seed_key = volumetric_spheres_seed_key(&params);
        let time = self.native_graph_time_seconds();
        let source_id = graph_layer.source_id.clone();
        let safe_source = native_graph_buffer_safe_id(&source_id);
        let prefix = format!(
            "volumetric-spheres:{}:{}",
            safe_source,
            params.sphere_count.max(1)
        );
        let id = |name: &str| format!("{prefix}:{name}");
        let spheres_id = id("spheres");
        let sim_uniform_id = id("sim-uniform");
        let render_uniform_id = id("render-uniform");

        let mut state = graph_layer.volumetric_spheres_state.clone();
        let sphere_buffer_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&spheres_id)
            })
            .unwrap_or(true);
        let reset_spheres = state.sphere_count != params.sphere_count
            || state.layout_id != params.layout_id
            || state.seed_key != seed_key
            || sphere_buffer_missing;
        if reset_spheres {
            state = NativeVolumetricSpheresGraphState::new(
                params.layout_id,
                params.sphere_count,
                seed_key.clone(),
                time,
            );
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.render_clock_delta
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 1.0 / 15.0);
        state.prev_frame_time = time;
        state.auto_rot_x_phase += params.auto_rotate_x * dt;
        state.auto_rot_y_phase += params.auto_rotate_y * dt;
        state.auto_rot_z_phase += params.auto_rotate_z * dt;

        let bass = if params.audio_reactive {
            (params.bass.max(self.audio0[1]).clamp(0.0, 2.0) * params.bass_pulse).min(2.0)
        } else {
            0.0
        };
        let treble = if params.audio_reactive {
            (params.treble.max(self.audio0[3]).clamp(0.0, 2.0) * params.treble_sparkle).min(2.0)
        } else {
            0.0
        };

        let sim_shader_id = "volumetric-spheres/sim";
        let render_shader_id = "volumetric-spheres/render";
        let (sim_hash, sim_source) = self.native_graph_shader_source(sim_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;

        let seq = self.native_frame_index();
        let slot = self.assign_source_frame_slot(&source_id);
        let sphere_bytes = u64::from(params.sphere_count)
            .saturating_mul(VOLUMETRIC_SPHERES_STRIDE_FLOATS as u64)
            .saturating_mul(4);
        let buffers = vec![
            NativeComputeGraphBufferSpec {
                id: sim_uniform_id.clone(),
                byte_length: 80,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_volumetric_spheres_sim_uniform_bytes(
                    &params, dt, time, bass, treble,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 320,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_volumetric_spheres_render_uniform_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                    time,
                    bass,
                    treble,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: spheres_id.clone(),
                byte_length: sphere_bytes,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset_spheres {
                    build_volumetric_spheres_initial_buffer_bytes(&params)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset_spheres,
                indirect: false,
            },
        ];

        let sim_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: spheres_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: sim_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
        ];
        let sim_layout_sig = native_graph_binding_layout_signature(&sim_bindings);
        let pass_plans = vec![NativeComputeGraphPassPlan {
            name: "volumetric-spheres-sim".to_string(),
            cache_key: format!("graph:{sim_shader_id}:{sim_hash}:cs_main:{sim_layout_sig}"),
            source: sim_source,
            entry: "cs_main".to_string(),
            dispatch: [params.sphere_count.div_ceil(64).max(1), 1, 1],
            bindings: sim_bindings,
        }];

        let render_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: spheres_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: render_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
        ];
        let render_layout_sig = native_graph_binding_layout_signature(&render_bindings);
        let render_plan = NativeComputeGraphRenderPlan {
            name: "volumetric-spheres-render".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:{}:{}:{}:{render_layout_sig}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                "depth",
                "write",
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: source_id.clone(),
                slot,
                seq,
            },
            blend: NativeComputeGraphRenderBlend::Alpha,
            vertex_count: 6,
            instance_count: params.sphere_count.max(1),
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: volumetric_spheres_clear_color(&params),
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: true,
            depth_write: true,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            bindings: render_bindings,
        };
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::VolumetricSpheres(state),
            NativeGraphFrameJob {
                buffers,
                pass_plans,
                render_plans: vec![render_plan],
            },
        ))
    }

    fn native_graph_shader_source(
        &self,
        shader_id: &str,
        required_entry: &str,
    ) -> Result<(u64, Arc<str>), String> {
        let Some(record) = self.shader_registry.get(shader_id) else {
            return Err(format!("{shader_id} shader has not been precompiled"));
        };
        if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
            return Err(format!(
                "{shader_id} shader is {}, but native graph instruments require WGSL",
                record.source_kind
            ));
        }
        if !record
            .entry_points
            .iter()
            .any(|entry| entry == required_entry)
        {
            return Err(format!(
                "{shader_id} shader is missing required entry `{required_entry}`"
            ));
        }
        let source = self
            .shader_sources
            .get(shader_id)
            .cloned()
            .ok_or_else(|| format!("{shader_id} shader source missing"))?;
        Ok((record.source_hash, source))
    }

    fn sync_gpu_frame_stats(&mut self) {
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.poll_gpu_timing();
            self.stats.gpu_frames_submitted = renderer.gpu_frames_submitted;
            self.stats.gpu_frames_completed = renderer.gpu_frames_completed();
            self.stats.frames_presented = self.stats.gpu_frames_completed;
        }
    }

    fn render(&mut self) {
        if !self.running {
            return;
        }
        self.sync_gpu_frame_stats();
        if self
            .renderer
            .as_ref()
            .is_some_and(RenderState::frame_in_flight)
        {
            self.stats.gpu_backpressure_skips = self.stats.gpu_backpressure_skips.saturating_add(1);
            return;
        }
        // Output freeze holds the last presented frame. Returning before any
        // compositing leaves the swapchain and the shared-texture export
        // untouched, so the projector keeps showing exactly what was on
        // screen when the operator hit freeze.
        if self.output_frozen {
            return;
        }
        self.render_bound_isf_layers();
        let mut native_graph_jobs = self.run_native_graph_layers();
        native_graph_jobs.append(&mut self.pending_native_graph_jobs);
        let render_time = if self.render_clock_mode == "manual" {
            self.render_clock_time
        } else {
            None
        };
        let frame_index = self.native_frame_index();
        let gpu_layers = self.gpu_layer_data();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let deck_monitor_a = self.deck_monitor_layer_data(0);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let deck_monitor_b = self.deck_monitor_layer_data(1);
        let source_preview_pixels = if self.source_preview_dirty {
            Some(self.source_preview_pixel_data())
        } else {
            None
        };
        let stage3d_mesh_frame = self.stage3d_mesh_frame();
        let scene_overlay_items = self.scene_overlay_items();
        let native_graph_buffer_budget_bytes = self.native_graph_buffer_budget_bytes();
        let native_graph_job_count = native_graph_jobs.len() as u64;
        let native_graph_compute_pass_count = native_graph_jobs
            .iter()
            .map(|job| job.pass_plans.len() as u64)
            .fold(0u64, u64::saturating_add);
        let native_graph_render_pass_count = native_graph_jobs
            .iter()
            .map(|job| job.render_plans.len() as u64)
            .fold(0u64, u64::saturating_add);
        let native_graph_source_frame_render_count = native_graph_jobs
            .iter()
            .flat_map(|job| job.render_plans.iter())
            .filter(|render| {
                matches!(
                    render.target,
                    NativeComputeGraphRenderTarget::SourceFrame { .. }
                )
            })
            .count() as u64;
        let native_task_count = gpu_layers
            .len()
            .saturating_add(native_graph_job_count.min(usize::MAX as u64) as usize)
            .saturating_add(native_graph_compute_pass_count.min(usize::MAX as u64) as usize)
            .saturating_add(native_graph_render_pass_count.min(usize::MAX as u64) as usize);
        // Read before borrowing the renderer mutably.
        let output_gate = self.output_gate();
        let post_effects = self.composite_effect_slots();
        let output_stage = self.output_stage;
        let slice_specs = self.slice_outputs.clone();
        let Some(renderer) = self.renderer.as_mut() else {
            return;
        };
        let started = Instant::now();
        let present_surface = self.output_window_attached;
        if present_surface {
            self.stats.swapchain_present_attempts =
                self.stats.swapchain_present_attempts.saturating_add(1);
        }
        let render_result = renderer.render(
            self.command_phase,
            gpu_layers.len() as u32,
            render_time,
            frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            stage3d_mesh_frame.as_ref(),
            &scene_overlay_items,
            &native_graph_jobs,
            self.audio0,
            self.audio1,
            self.audio2,
            present_surface,
            output_gate,
            &post_effects,
            output_stage,
        );
        // Deck confidence monitors ride the same frame: two small composite
        // passes over the bank-tagged layers, after the program render so
        // every source frame they sample is already current.
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if render_result.is_ok() && (!deck_monitor_a.is_empty() || !deck_monitor_b.is_empty()) {
            let monitor_width: u32 = 480;
            let monitor_height: u32 = ((u64::from(monitor_width)
                * u64::from(renderer.config.height))
                / u64::from(renderer.config.width.max(1)))
            .clamp(16, 1024) as u32;
            renderer.render_deck_monitors(
                self.command_phase,
                render_time,
                frame_index,
                &deck_monitor_a,
                &deck_monitor_b,
                self.audio0,
                self.audio1,
                self.audio2,
                monitor_width,
                monitor_height,
            );
        }
        // Slice displays ride the same frame for the same reason: every
        // source frame they sample is already current after the program
        // render, so a slice costs one composite pass and no extra decode.
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if render_result.is_ok() && !slice_specs.is_empty() {
            renderer.render_slice_outputs(
                self.command_phase,
                render_time,
                frame_index,
                &gpu_layers,
                self.audio0,
                self.audio1,
                self.audio2,
                output_gate,
                &post_effects,
                &slice_specs,
            );
        }
        if render_result.is_ok() && native_graph_job_count > 0 {
            self.stats.compute_graph_runs = self
                .stats
                .compute_graph_runs
                .saturating_add(native_graph_job_count);
            self.stats.compute_graph_passes = self
                .stats
                .compute_graph_passes
                .saturating_add(native_graph_compute_pass_count);
            self.stats.compute_graph_render_passes = self
                .stats
                .compute_graph_render_passes
                .saturating_add(native_graph_render_pass_count);
            self.stats.compute_graph_source_frame_renders = self
                .stats
                .compute_graph_source_frame_renders
                .saturating_add(native_graph_source_frame_render_count);
            let (evicted_buffers, evicted_bytes) = renderer
                .prune_native_compute_graph_buffers_to_budget(native_graph_buffer_budget_bytes);
            if evicted_buffers > 0 || evicted_bytes > 0 {
                self.stats.vram_evictions = self
                    .stats
                    .vram_evictions
                    .saturating_add(evicted_buffers as u64);
                self.stats.vram_evicted_bytes =
                    self.stats.vram_evicted_bytes.saturating_add(evicted_bytes);
            }
            self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
        }
        match render_result {
            Ok(outcome) if outcome.presented() => {
                self.output_last_presented_layer_count = gpu_layers.len().min(1024) as u32;
                self.stats.output_last_presented_layer_count =
                    self.output_last_presented_layer_count;
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.gpu_frames_submitted = renderer.gpu_frames_submitted;
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
                    .observe_frame(ms, gpu_ms, self.target_fps, native_task_count);
                if source_preview_pixels.is_some() {
                    self.source_preview_dirty = false;
                }
            }
            Ok(outcome) if outcome.offscreen() => {
                self.output_last_presented_layer_count = gpu_layers.len().min(1024) as u32;
                self.stats.output_last_presented_layer_count =
                    self.output_last_presented_layer_count;
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.swapchain_present_consecutive_failures = 0;
                self.stats.gpu_frames_submitted = renderer.gpu_frames_submitted;
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
                    .observe_frame(ms, gpu_ms, self.target_fps, native_task_count);
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
                    | SurfacePresentOutcome::Offscreen
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
            .unwrap_or_else(|| self.native_frame_index());
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
        let output_gate = self.output_gate();
        let post_effects = self.composite_effect_slots();
        let output_stage = self.preview_output_stage();
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
            output_gate,
            &post_effects,
            output_stage,
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
        let max_dim = number_at(params, &["max_dim"])
            .map(|value| value.round().clamp(0.0, 4096.0) as u32)
            .unwrap_or(0);
        self.render_frame_snapshot_texture(params)?;
        let snapshot = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let snapshot = renderer.frame_snapshot_scaled(include_pixels, max_dim)?;
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
        // source: "output" reads the ALREADY-RENDERED output export texture
        // instead of re-rendering the scene into the snapshot target — live
        // REC uses this so each captured frame costs one readback, not a
        // second full composite pass (which visibly dropped the live fps).
        let use_output_export = string_at(params, &["source"])
            .map(|value| value.eq_ignore_ascii_case("output"))
            .unwrap_or(false);
        let (snapshot_time, snapshot_frame_index) = if use_output_export {
            (self.render_clock_time, self.native_frame_index())
        } else {
            self.render_frame_snapshot_texture(params)?
        };
        let (mut snapshot, pixels) = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let readback = if use_output_export {
                renderer.read_output_export_frame()?
            } else {
                renderer.read_frame_snapshot()?
            };
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

    fn output_shared_texture_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        let include_pixels = bool_at(params, &["include_pixels"])
            .or_else(|| bool_at(params, &["pixels"]))
            .unwrap_or(false);
        let renderer = self
            .renderer
            .as_mut()
            .ok_or_else(|| "native renderer is not running".to_string())?;
        renderer.output_export_snapshot(include_pixels)
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
            self.shader_isf_inputs.clear();
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

    fn compute_graph_frame_job(&mut self, params: &Value) -> Result<NativeGraphFrameJob, String> {
        let params = params.get("config").unwrap_or(params);
        let Some(buffers_value) = params.get("buffers").and_then(Value::as_array) else {
            return Err("queued compute_graph requires buffers[]".to_string());
        };
        let Some(passes_value) = params.get("passes").and_then(Value::as_array) else {
            return Err("queued compute_graph requires passes[]".to_string());
        };
        let mut buffer_specs = Vec::with_capacity(buffers_value.len());
        for buffer in buffers_value {
            let mut spec = parse_compute_graph_buffer(buffer)?;
            if !spec.initial_bytes.is_empty() {
                spec.persistent = true;
            }
            buffer_specs.push(spec);
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
        if pass_plans.is_empty() && render_plans.is_empty() {
            return Err(
                "queued compute_graph requires at least one pass or render pass".to_string(),
            );
        }
        let readbacks = compute_graph_readbacks(params, &buffer_specs);
        if !readbacks.is_empty() {
            return Err(
                "queued compute_graph does not support readbacks; use run_compute_graph for probes"
                    .to_string(),
            );
        }
        Ok(NativeGraphFrameJob {
            buffers: buffer_specs,
            pass_plans,
            render_plans,
        })
    }

    fn register_compute_graph_source_frame_targets(
        &mut self,
        render_plans: &[NativeComputeGraphRenderPlan],
    ) {
        for render_plan in render_plans {
            if let NativeComputeGraphRenderTarget::SourceFrame {
                source_id,
                slot,
                seq,
            } = &render_plan.target
            {
                self.source_frames
                    .insert(source_id.clone(), SourceFrame::full(*seq));
                for layer in self.scene_layers.values_mut() {
                    if layer.source_id.as_deref() == Some(source_id.as_str()) {
                        layer.frame_slot = Some(*slot);
                    }
                }
            }
        }
    }

    fn apply_queue_compute_graph(&mut self, command: &Value) -> Result<(), String> {
        let job = self.compute_graph_frame_job(command)?;
        self.register_compute_graph_source_frame_targets(&job.render_plans);
        // Coalesce: a newer job rendering into the same source frame(s)
        // REPLACES any still-pending job for those targets. The render
        // loop executes every pending job per frame, so a submission
        // rate above the core's render rate would otherwise accumulate
        // stale jobs quadratically — renders slow, more jobs pile on,
        // presentation starves (observed as ~1fps splat playback with a
        // 60fps submitter), and the queue eventually kills the process.
        // Only the freshest time step per target matters.
        let new_targets: Vec<String> = job
            .render_plans
            .iter()
            .filter_map(|plan| match &plan.target {
                NativeComputeGraphRenderTarget::SourceFrame { source_id, .. } => {
                    Some(source_id.clone())
                }
                _ => None,
            })
            .collect();
        if !new_targets.is_empty() {
            self.pending_native_graph_jobs.retain(|pending| {
                !pending.render_plans.iter().any(|plan| match &plan.target {
                    NativeComputeGraphRenderTarget::SourceFrame { source_id, .. } => {
                        new_targets.iter().any(|target| target == source_id)
                    }
                    _ => false,
                })
            });
        }
        self.pending_native_graph_jobs.push(job);
        Ok(())
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
            .filter_map(|readback| {
                buffer_specs
                    .iter()
                    .find(|buffer| buffer.id == readback.id)
                    .map(|buffer| buffer.byte_length)
            })
            .fold(0u64, u64::saturating_add);
        let readback_count = readbacks.len() as u64;
        let pass_count = pass_plans.len() as u64;
        let render_pass_count = render_plans.len() as u64;
        let render_targets_for_stats = render_targets.clone();
        let render_targets_for_source_frames = render_targets;
        let native_graph_buffer_budget_bytes = self.native_graph_buffer_budget_bytes();
        let result = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let mut result = renderer.run_native_compute_graph(
                buffer_specs,
                pass_plans,
                readbacks,
                render_plans,
            )?;
            let (evicted_buffers, evicted_bytes) = renderer
                .prune_native_compute_graph_buffers_to_budget(native_graph_buffer_budget_bytes);
            if evicted_buffers > 0 || evicted_bytes > 0 {
                self.stats.vram_evictions = self
                    .stats
                    .vram_evictions
                    .saturating_add(evicted_buffers as u64);
                self.stats.vram_evicted_bytes =
                    self.stats.vram_evicted_bytes.saturating_add(evicted_bytes);
                if let Some(object) = result.as_object_mut() {
                    object.insert("vram_evicted_buffers".to_string(), json!(evicted_buffers));
                    object.insert("vram_evicted_bytes".to_string(), json!(evicted_bytes));
                }
            }
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "persistent_buffer_bytes".to_string(),
                    json!(renderer.native_compute_graph_buffer_bytes()),
                );
                object.insert(
                    "persistent_buffer_budget_bytes".to_string(),
                    json!(native_graph_buffer_budget_bytes),
                );
            }
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
                    .insert(source_id.clone(), SourceFrame::full(seq));
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
        &mut self,
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
                        let allow_missing = bool_at(binding, &["allow_missing"])
                            .or_else(|| bool_at(binding, &["allowMissing"]))
                            .or_else(|| bool_at(binding, &["optional"]))
                            .unwrap_or(false);
                        if allow_missing {
                            let slot = self.ensure_empty_source_frame_slot();
                            return Ok(NativeComputeGraphBindingSpec {
                                binding: binding_number,
                                resource_id: EMPTY_SOURCE_FRAME_ID.to_string(),
                                kind: NativeComputeGraphBindingKind::SourceFrameTexture(dimension),
                                source_slot: Some(slot),
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
                } else if let Some(layer_id) = resource_id.strip_prefix("shader-frame:") {
                    // Binds the layer's core-rendered shader frame explicitly,
                    // independent of what the layer currently DISPLAYS.
                    Some(
                        self.scene_layers
                            .get(layer_id)
                            .and_then(|layer| layer.shader_frame_slot)
                            .unwrap_or_else(|| self.ensure_empty_source_frame_slot()),
                    )
                } else if let Some(layer_id) = resource_id.strip_prefix("layer-frame:") {
                    // `layer-frame:<layer_id>` binds whatever frame that scene
                    // layer currently displays (video slot, rendered shader
                    // slot, …) without the sender knowing internal source ids.
                    // Used by the VJ crossfade to sample bank composites.
                    Some(
                        self.scene_layers
                            .get(layer_id)
                            .and_then(|layer| layer.frame_slot)
                            .unwrap_or_else(|| self.ensure_empty_source_frame_slot()),
                    )
                } else {
                    Some(match self.source_frame_slots.get(&resource_id).copied() {
                        Some(slot) => slot,
                        // Assign instead of failing: a missing slot here is
                        // either a frame produced later in this same job or a
                        // source that has not uploaded yet. Failing kills the
                        // whole template install (frozen layer, no retry);
                        // assigning binds the slot the frame will land in.
                        None => {
                            eprintln!(
                                "[GhostRenderCore] compute_graph {context} `{shader_id}` binding {binding_number} source-frame `{resource_id}` has no frame yet; assigning a slot"
                            );
                            self.assign_source_frame_slot(&resource_id)
                        }
                    })
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
        &mut self,
        pass: &Value,
        index: usize,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphPassPlan, String> {
        let Some(shader_id) = string_at(pass, &["shader_id"]) else {
            return Err(format!("compute_graph pass {index} missing shader_id"));
        };
        let record = self
            .shader_registry
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| {
                format!("compute graph shader `{shader_id}` has not been precompiled")
            })?;
        if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
            return Err(format!(
                "compute graph shader `{shader_id}` is {}, but compute graph passes require WGSL",
                record.source_kind
            ));
        }
        let source = self
            .shader_sources
            .get(&shader_id)
            .cloned()
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
            native_compute_entry(&record, source.as_ref())
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
        if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
            return Err(format!(
                "compute graph render shader `{shader_id}` is {}, but graph render passes require WGSL",
                record.source_kind
            ));
        }
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
        let generate_mips = bool_at(render, &["generate_mips"])
            .or_else(|| bool_at(render, &["generateMips"]))
            .or_else(|| bool_at(render, &["mips"]))
            // Default ON: sampling a scaled source frame without mips aliases
            // (and drifts from the WebGL/Three.js reference, which always mips).
            // Same-size blit passes opt out explicitly with generate_mips: false.
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
            generate_mips,
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

    fn native_graph_buffer_budget_bytes(&self) -> u64 {
        let vram_budget_bytes = u64::from(self.vram_budget_mb).saturating_mul(1024 * 1024);
        let texture_pool_bytes = u64::from(self.texture_pool_cap_mb).saturating_mul(1024 * 1024);
        let graph_slice = (vram_budget_bytes / 4).max(NATIVE_GRAPH_BUFFER_BUDGET_MIN_BYTES);
        graph_slice.min(texture_pool_bytes.max(NATIVE_GRAPH_BUFFER_BUDGET_MIN_BYTES))
    }

    fn apply_decode_cpu_backup_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_store_cpu_backup_frames = bool_at(config, &["decode_store_cpu_backup_frames"])
            .unwrap_or(self.decode_store_cpu_backup_frames);
    }

    fn apply_decode_synthetic_fallback_policy(&mut self, params: &Value) {
        let _config = params.get("config").unwrap_or(params);
        self.decode_allow_synthetic_fallback = false;
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

        let source_kind = classify_native_shader_source(&source);
        match source_kind {
            NativeShaderSourceKind::Wgsl => {}
            NativeShaderSourceKind::IsfGlsl | NativeShaderSourceKind::Glsl => {
                match probe_native_glsl_source(&source, native_glsl_stage_for_label(&stage)) {
                    Ok(probe) => {
                        let native_source =
                            native_glsl_probe_source(&source, probe.kind).into_owned();
                        let isf_inputs = matches!(probe.kind, NativeShaderSourceKind::IsfGlsl)
                            .then(|| parse_native_isf_inputs(&source))
                            .unwrap_or_default();
                        let record = ShaderRecord {
                            shader_id: shader_id.clone(),
                            stage,
                            entry,
                            source_kind: probe.kind.label().to_string(),
                            source_hash: stable_hash64(&source),
                            source_bytes: source.len(),
                            entry_points: probe.entry_points,
                            compiled_at_ms: epoch_ms().min(u64::MAX as u128) as u64,
                        };
                        self.shader_registry.insert(shader_id.clone(), record);
                        self.shader_sources
                            .insert(shader_id.clone(), Arc::<str>::from(native_source));
                        self.shader_isf_inputs.insert(shader_id, isf_inputs);
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
                        self.shader_isf_inputs.remove(&shader_id);
                        self.last_shader_error = Some(format!(
                            "{shader_id}: native GLSL/ISF parse probe failed: {err}; no browser fallback is allowed"
                        ));
                    }
                }
                return;
            }
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
                    source_kind: source_kind.label().to_string(),
                    source_hash: stable_hash64(&source),
                    source_bytes: source.len(),
                    entry_points,
                    compiled_at_ms: epoch_ms().min(u64::MAX as u128) as u64,
                };
                self.shader_registry.insert(shader_id.clone(), record);
                self.shader_sources
                    .insert(shader_id.clone(), Arc::<str>::from(source));
                self.shader_isf_inputs.remove(&shader_id);
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
                self.shader_isf_inputs.remove(&shader_id);
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
        if std::env::var("GHOST_DEBUG_LAYERS").is_ok() {
            eprintln!("[layer-debug] upsert {layer_id}: {command}");
        }
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
        // Deck confidence monitors: VJ bank layers composite at opacity 0 in
        // the program mix (the crossfade pass samples their frames), but the
        // monitor passes re-render them at their true pre-crossfader level.
        if command_has_key(command, "deck_monitor_bank") {
            entry.deck_monitor_bank = string_at(command, &["deck_monitor_bank"])
                .and_then(|bank| match bank.as_str() {
                    "a" | "A" => Some(0u8),
                    "b" | "B" => Some(1u8),
                    _ => None,
                });
            entry.deck_monitor_opacity = number_at(command, &["deck_monitor_opacity"])
                .unwrap_or(1.0)
                .clamp(0.0, 1.0) as f32;
        }
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
                shape[0].clamp(0.0, 6.0),
                shape[1].clamp(0.0, 1.0),
                shape[2].clamp(-std::f32::consts::TAU, std::f32::consts::TAU),
                shape[3].clamp(0.0001, 8.0),
            ];
        }
        if let Some(shape2) = vec4_path_at(command, &["shape2"]) {
            // Primitive shapes: [radiusX, radiusY, sides, innerRadius].
            // Custom polygons: bounding box [minX, minY, sizeX, sizeY].
            let custom = entry.shape[0] >= 5.5;
            entry.shape2 = if custom {
                [
                    shape2[0].clamp(0.0, 1.0),
                    shape2[1].clamp(0.0, 1.0),
                    shape2[2].clamp(0.0001, 1.0),
                    shape2[3].clamp(0.0001, 1.0),
                ]
            } else {
                [
                    shape2[0].clamp(0.01, 4.0),
                    shape2[1].clamp(0.01, 4.0),
                    shape2[2].clamp(3.0, 12.0),
                    shape2[3].clamp(0.05, 1.0),
                ]
            };
        }
        if let Some(shape_meta) = vec4_path_at(command, &["shape_meta"]) {
            entry.shape_meta = [
                shape_meta[0].clamp(0.0, 64.0),
                shape_meta[1].clamp(0.0, 1.0),
                shape_meta[2].clamp(0.0, 2.0),
                shape_meta[3].clamp(0.0, 3.0),
            ];
        }
        if command_has_key(command, "shape_points") {
            entry.shape_pts.clear();
            if let Some(points) = command.get("shape_points").and_then(Value::as_array) {
                for point in points.iter().take(32) {
                    let Some(values) = point.as_array() else {
                        continue;
                    };
                    if values.len() < 4 {
                        continue;
                    }
                    let (Some(x0), Some(y0), Some(x1), Some(y1)) = (
                        values[0].as_f64(),
                        values[1].as_f64(),
                        values[2].as_f64(),
                        values[3].as_f64(),
                    ) else {
                        continue;
                    };
                    entry.shape_pts.push([
                        (x0 as f32).clamp(-1.0, 2.0),
                        (y0 as f32).clamp(-1.0, 2.0),
                        (x1 as f32).clamp(-1.0, 2.0),
                        (y1 as f32).clamp(-1.0, 2.0),
                    ]);
                }
            }
        }
        if let Some(mask_info) = vec4_path_at(command, &["mask_info"]) {
            entry.mask_info = [
                mask_info[0].clamp(0.0, 1.0),
                mask_info[1].clamp(0.0, 1.0),
                mask_info[2].clamp(0.0, 1.0),
                mask_info[3].clamp(0.0, MAX_LAYER_MASK_POINTS as f32),
            ];
        }
        if command_has_key(command, "mask_points") {
            entry.mask_points.clear();
            if let Some(points) = command.get("mask_points").and_then(Value::as_array) {
                for point in points.iter().take(MAX_LAYER_MASK_POINTS) {
                    let Some(values) = point.as_array() else {
                        continue;
                    };
                    if values.len() < 4 {
                        continue;
                    }
                    let Some(x) = values[0].as_f64() else {
                        continue;
                    };
                    let Some(y) = values[1].as_f64() else {
                        continue;
                    };
                    let Some(next) = values[2].as_f64() else {
                        continue;
                    };
                    let Some(shape) = values[3].as_f64() else {
                        continue;
                    };
                    entry.mask_points.push([
                        x.clamp(-8.0, 8.0) as f32,
                        y.clamp(-8.0, 8.0) as f32,
                        next.clamp(0.0, (MAX_LAYER_MASK_POINTS - 1) as f64) as f32,
                        shape.clamp(0.0, 7.0) as f32,
                    ]);
                }
                entry.mask_info[3] = entry.mask_points.len() as f32;
            }
        }
        if command_has_key(command, "mesh_grid") {
            entry.mesh_rows = 0;
            entry.mesh_cols = 0;
            entry.mesh_points.clear();
            if let Some(mesh) = command.get("mesh_grid").and_then(Value::as_object) {
                let rows = mesh
                    .get("rows")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .clamp(0, MAX_LAYER_MESH_SIDE as u64) as u32;
                let cols = mesh
                    .get("cols")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .clamp(0, MAX_LAYER_MESH_SIDE as u64) as u32;
                let expected = rows.saturating_mul(cols) as usize;
                if rows >= 2 && cols >= 2 && expected <= MAX_LAYER_MESH_POINTS {
                    let mut points = Vec::with_capacity(expected);
                    if let Some(point_rows) = mesh.get("points").and_then(Value::as_array) {
                        for row in point_rows.iter().take(rows as usize) {
                            let Some(row_points) = row.as_array() else {
                                break;
                            };
                            for point in row_points.iter().take(cols as usize) {
                                let x = number_at(point, &["x"]);
                                let y = number_at(point, &["y"]);
                                let (Some(x), Some(y)) = (x, y) else { break };
                                points.push([x.clamp(-8.0, 8.0) as f32, y.clamp(-8.0, 8.0) as f32]);
                            }
                        }
                    }
                    if points.len() == expected {
                        entry.mesh_rows = rows;
                        entry.mesh_cols = cols;
                        entry.mesh_points = points;
                    }
                }
            }
        }
    }

    fn apply_layer_interaction(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(entry) = self.scene_layers.get_mut(&layer_id) else {
            return;
        };
        if let Some(corners) = corners_at(command, &["corners"]) {
            entry.corners = corners;
        }
        if command_has_key(command, "mesh_grid") {
            entry.mesh_rows = 0;
            entry.mesh_cols = 0;
            entry.mesh_points.clear();
            if let Some(mesh) = command.get("mesh_grid").and_then(Value::as_object) {
                let rows = mesh
                    .get("rows")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .clamp(0, MAX_LAYER_MESH_SIDE as u64) as u32;
                let cols = mesh
                    .get("cols")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .clamp(0, MAX_LAYER_MESH_SIDE as u64) as u32;
                let expected = rows.saturating_mul(cols) as usize;
                if rows >= 2 && cols >= 2 && expected <= MAX_LAYER_MESH_POINTS {
                    let mut points = Vec::with_capacity(expected);
                    if let Some(point_rows) = mesh.get("points").and_then(Value::as_array) {
                        for row in point_rows.iter().take(rows as usize) {
                            let Some(row_points) = row.as_array() else {
                                break;
                            };
                            for point in row_points.iter().take(cols as usize) {
                                let x = number_at(point, &["x"]);
                                let y = number_at(point, &["y"]);
                                let (Some(x), Some(y)) = (x, y) else { break };
                                points.push([x.clamp(-8.0, 8.0) as f32, y.clamp(-8.0, 8.0) as f32]);
                            }
                        }
                    }
                    if points.len() == expected {
                        entry.mesh_rows = rows;
                        entry.mesh_cols = cols;
                        entry.mesh_points = points;
                    }
                }
            }
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
        set_scene_layer_color(entry, rgba);
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
        entry.native_params.copy_from_slice(&params[..8]);
    }

    fn apply_layer_edge_effects(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.edge_effects = [[[0.0; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS];
        let Some(effects) = command.get("edge_effects").and_then(Value::as_array) else {
            return;
        };
        for (effect_index, effect) in effects.iter().take(MAX_LAYER_EDGE_EFFECTS).enumerate() {
            let Some(vectors) = effect.as_array() else {
                continue;
            };
            for (vector_index, vector) in vectors.iter().take(LAYER_EDGE_EFFECT_VEC4S).enumerate() {
                let Some(values) = vector.as_array() else {
                    continue;
                };
                for component in 0..4 {
                    entry.edge_effects[effect_index][vector_index][component] = values
                        .get(component)
                        .and_then(Value::as_f64)
                        .filter(|value| value.is_finite())
                        .unwrap_or(0.0)
                        .clamp(-4096.0, 4096.0)
                        as f32;
                }
            }
        }
    }

    fn apply_native_graph_layer(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let kind_label = string_at(command, &["kind"])
            .or_else(|| string_at(command, &["instrument"]))
            .or_else(|| string_at(command, &["graph"]))
            .unwrap_or_else(|| "unknown".to_string());
        let kind = NativeGraphLayerKind::from_label(&kind_label);
        let source_id = string_at(command, &["instrument_source_id"])
            .or_else(|| string_at(command, &["instrumentSourceId"]))
            .or_else(|| string_at(command, &["source_id"]))
            .or_else(|| string_at(command, &["sourceId"]))
            .unwrap_or_else(|| format!("native-graph:{}:{}", kind.signature(), layer_id));
        let composite_source_id = string_at(command, &["composite_source_id"])
            .or_else(|| string_at(command, &["compositeSourceId"]))
            .unwrap_or_else(|| source_id.clone());
        let input_source_id = string_at(command, &["input_source_id"])
            .or_else(|| string_at(command, &["inputSourceId"]))
            .unwrap_or_default();
        let effect_job_template = command
            .get("effect_graph")
            .or_else(|| command.get("effectGraph"))
            .filter(|value| !value.is_null())
            .and_then(|config| match self.compute_graph_frame_job(config) {
                Ok(job) => Some(job),
                Err(err) => {
                    // Loud on stderr: the broker forwards this to the app log,
                    // otherwise a bad template silently freezes the layer.
                    eprintln!(
                        "[GhostRenderCore] native graph effect template on layer `{layer_id}` failed: {err}"
                    );
                    self.last_shader_error = Some(format!(
                        "native graph effect template on layer `{layer_id}` failed: {err}"
                    ));
                    None
                }
            });
        // Re-arm the template's first-run clear when its IDENTITY changes
        // (scene switch produces different buffer id prefixes). Param tweaks
        // reuse the same ids and must NOT reset accumulated sim state.
        if let Some(new_template) = effect_job_template.as_ref() {
            let new_key = new_template
                .buffers
                .first()
                .map(|buffer| buffer.id.clone())
                .unwrap_or_default();
            let old_key = self
                .native_graph_layers
                .get(&layer_id)
                .and_then(|layer| layer.effect_job_template.as_ref())
                .and_then(|template| template.buffers.first())
                .map(|buffer| buffer.id.clone())
                .unwrap_or_default();
            if new_key != old_key {
                self.native_plugin_templates_initialized.remove(&layer_id);
            }
        }
        let params = command.get("params").cloned().unwrap_or(Value::Null);
        if !kind.is_supported() {
            self.native_graph_layers.remove(&layer_id);
            self.last_shader_error = Some(format!(
                "native graph layer `{}` requested unsupported instrument `{}`",
                layer_id,
                kind.signature()
            ));
            return;
        }
        let time = self.native_graph_time_seconds();
        let previous_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.planet_state.clone())
            .unwrap_or_else(|| NativePlanetGraphState::new(time));
        let ink_params = normalize_ink_cloud_native_params(&params);
        let ink_seed_key = ink_cloud_seed_key(&ink_params);
        let previous_ink_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.ink_cloud_state.clone())
            .filter(|state| {
                state.particle_count == ink_params.particle_count && state.seed_key == ink_seed_key
            })
            .unwrap_or_else(|| {
                NativeInkCloudGraphState::new(ink_params.particle_count, ink_seed_key.clone(), time)
            });
        let smoke_params = normalize_smoke_3d_native_params(&params);
        let previous_smoke_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.smoke_3d_state.clone())
            .filter(|state| state.grid == smoke_params.grid_size)
            .unwrap_or_else(|| NativeSmoke3DGraphState::new(smoke_params.grid_size, time));
        let particle_params = normalize_particle_field_native_params(&params);
        let previous_particle_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.particle_field_state.clone())
            .filter(|state| {
                state.mode_id == particle_params.mode_id
                    && state.particle_count == particle_params.particle_count
            })
            .unwrap_or_else(|| {
                NativeParticleFieldGraphState::new(
                    particle_params.mode_id,
                    particle_params.particle_count,
                    time,
                )
            });
        let pixel_params = normalize_pixel_particles_native_params(&params);
        let previous_pixel_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.pixel_particles_state.clone())
            .filter(|state| {
                state.mode_id == pixel_params.mode_id
                    && state.particle_count == pixel_params.particle_count
                    && state.input_source_id == input_source_id
            })
            .unwrap_or_else(|| {
                NativePixelParticlesGraphState::new(
                    pixel_params.mode_id,
                    pixel_params.particle_count,
                    input_source_id.clone(),
                    time,
                )
            });
        let flythrough_params = normalize_flythrough_native_params(&params);
        let previous_flythrough_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.flythrough_state.clone())
            .filter(|state| {
                state.particle_count == flythrough_params.particle_count
                    && state.input_source_id == input_source_id
            })
            .unwrap_or_else(|| {
                NativeFlythroughGraphState::new(
                    flythrough_params.particle_count,
                    input_source_id.clone(),
                    time,
                )
            });
        let point_asset = self.native_point_cloud_assets.get(&layer_id);
        let point_signature = point_asset
            .map(|asset| asset.signature.clone())
            .unwrap_or_default();
        let point_count = point_asset.map(|asset| asset.point_count).unwrap_or(1);
        let previous_point_cloud_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.point_cloud_state.clone())
            .filter(|state| state.signature == point_signature && state.point_count == point_count)
            .unwrap_or_else(|| NativePointCloudGraphState::new(point_signature, point_count, time));
        let sphere_params = normalize_volumetric_spheres_native_params(&params);
        let sphere_seed_key = volumetric_spheres_seed_key(&sphere_params);
        let previous_sphere_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.volumetric_spheres_state.clone())
            .filter(|state| {
                state.sphere_count == sphere_params.sphere_count
                    && state.layout_id == sphere_params.layout_id
                    && state.seed_key == sphere_seed_key
            })
            .unwrap_or_else(|| {
                NativeVolumetricSpheresGraphState::new(
                    sphere_params.layout_id,
                    sphere_params.sphere_count,
                    sphere_seed_key.clone(),
                    time,
                )
            });
        let riders_params = normalize_smoke_riders_native_params(
            &params,
            0.0,
            0.0,
            matches!(kind, NativeGraphLayerKind::FluidRiders),
        );
        let riders_tiles = smoke_riders_tile_counts(self.pending_width, self.pending_height);
        let previous_smoke_riders_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.smoke_riders_state.clone())
            .filter(|state| {
                state.grid == riders_params.grid_size
                    && state.rider_count == riders_params.rider_count
                    && state.tile_count_x == riders_tiles.0
                    && state.tile_count_y == riders_tiles.1
            })
            .unwrap_or_else(|| {
                NativeSmokeRidersGraphState::new(
                    riders_params.grid_size,
                    riders_params.rider_count,
                    riders_tiles.0,
                    riders_tiles.1,
                    time,
                )
            });
        self.native_graph_layers.insert(
            layer_id.clone(),
            NativeGraphLayer {
                layer_id: layer_id.clone(),
                source_id: source_id.clone(),
                input_source_id,
                kind: kind.clone(),
                params,
                effect_job_template,
                planet_state: previous_state,
                ink_cloud_state: previous_ink_state,
                smoke_3d_state: previous_smoke_state,
                particle_field_state: previous_particle_state,
                pixel_particles_state: previous_pixel_state,
                flythrough_state: previous_flythrough_state,
                point_cloud_state: previous_point_cloud_state,
                volumetric_spheres_state: previous_sphere_state,
                smoke_riders_state: previous_smoke_riders_state,
            },
        );
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.source_id = Some(composite_source_id.clone());
        entry.source_kind = source_kind(&format!("gpu:{}", kind.signature()));
        entry.shader_rendered = false;
        entry.preview_slot = None;
        entry.frame_slot = self.source_frame_slots.get(&composite_source_id).copied();
    }

    fn apply_update_native_graph_buffer(&mut self, command: &Value) -> Result<(), String> {
        let layer_id = string_at(command, &["layer_id"])
            .ok_or_else(|| "native graph buffer update requires layer_id".to_string())?;
        let buffer_id = string_at(command, &["buffer_id"])
            .ok_or_else(|| "native graph buffer update requires buffer_id".to_string())?;
        let initial_b64 = string_at(command, &["initial_b64"])
            .ok_or_else(|| "native graph buffer update requires initial_b64".to_string())?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(initial_b64.as_bytes())
            .map_err(|err| {
                format!("native graph buffer `{buffer_id}` base64 decode failed: {err}")
            })?;
        let layer = self
            .native_graph_layers
            .get_mut(&layer_id)
            .ok_or_else(|| format!("native graph layer `{layer_id}` is not installed"))?;
        let template = layer
            .effect_job_template
            .as_mut()
            .ok_or_else(|| format!("native graph layer `{layer_id}` has no graph template"))?;
        let buffer = template
            .buffers
            .iter_mut()
            .find(|buffer| buffer.id == buffer_id)
            .ok_or_else(|| {
                format!("native graph layer `{layer_id}` has no buffer `{buffer_id}`")
            })?;
        if bytes.len() as u64 != buffer.byte_length {
            return Err(format!(
                "native graph buffer `{buffer_id}` expected {} bytes, received {}",
                buffer.byte_length,
                bytes.len()
            ));
        }
        buffer.initial_bytes = bytes;
        Ok(())
    }

    fn apply_native_point_cloud(&mut self, command: &Value) -> Result<(), String> {
        let layer_id = string_at(command, &["layer_id"])
            .ok_or_else(|| "native point cloud upload requires layer_id".to_string())?;
        let signature = string_at(command, &["signature"])
            .ok_or_else(|| "native point cloud upload requires signature".to_string())?;
        let point_count = number_at(command, &["point_count"])
            .unwrap_or(0.0)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        let sort_count = number_at(command, &["sort_count"])
            .unwrap_or(point_count as f64)
            .round()
            .clamp(point_count as f64, 1_048_576.0) as u32;
        let decode = |key: &str| -> Result<Vec<u8>, String> {
            let encoded = command
                .get(key)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("native point cloud upload requires {key}"))?;
            base64::engine::general_purpose::STANDARD
                .decode(encoded.as_bytes())
                .map_err(|err| format!("native point cloud {key} decode failed: {err}"))
        };
        let home_bytes = decode("home_b64")?;
        let live_bytes = decode("live_b64")?;
        let sort_bytes = decode("sort_b64")?;
        let expected_home = point_count as usize * 112;
        let expected_live = point_count as usize * 48;
        let expected_sort = sort_count as usize * 8;
        if home_bytes.len() != expected_home
            || live_bytes.len() != expected_live
            || sort_bytes.len() != expected_sort
        {
            return Err(format!(
                "native point cloud buffer lengths do not match counts (home={}/{expected_home}, live={}/{expected_live}, sort={}/{expected_sort})",
                home_bytes.len(),
                live_bytes.len(),
                sort_bytes.len(),
            ));
        }
        self.native_point_cloud_assets.insert(
            layer_id,
            NativePointCloudAsset {
                signature,
                point_count,
                sort_count,
                depth_sort_enabled: bool_at(command, &["depth_sort_enabled"]).unwrap_or(false),
                home_bytes,
                live_bytes,
                sort_bytes,
            },
        );
        Ok(())
    }

    fn apply_remove_native_graph_layer(&mut self, command: &Value) {
        if let Some(layer_id) = string_at(command, &["layer_id"]) {
            self.native_graph_layers.remove(&layer_id);
            self.native_plugin_liquid_states.remove(&layer_id);
            self.native_plugin_templates_initialized.remove(&layer_id);
        }
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
        let input_source_id = string_at(command, &["input_source_id"])
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| EMPTY_SOURCE_FRAME_ID.to_string());
        let input_slot = if input_source_id == EMPTY_SOURCE_FRAME_ID {
            self.ensure_empty_source_frame_slot()
        } else {
            self.source_frame_slots
                .get(&input_source_id)
                .copied()
                .unwrap_or_else(|| self.ensure_empty_source_frame_slot())
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.shader_id = Some(shader_id);
        entry.shader_rendered = false;
        // `bind_isf_shader` describes the shader's INPUT, so it must not steal
        // the display binding when that display is a core-generated effect
        // chain output. Under an effect-pass route the layer displays
        // `effect-pass:<layer>` while the shader renders underneath as the
        // chain's input; resetting source_id to the empty frame here sent the
        // layer back to its raw shader frame, so every layer effect rendered
        // but was never shown. Narrow on purpose: a shader layer with no
        // effect route still rebinds exactly as before.
        let effect_output_displayed = entry
            .source_id
            .as_deref()
            .is_some_and(|source_id| source_id.starts_with("effect-pass:"));
        if input_source_id != EMPTY_SOURCE_FRAME_ID || !effect_output_displayed {
            entry.source_id = Some(input_source_id);
            entry.frame_slot = Some(input_slot);
        }
    }

    fn resolve_isf_image_source_slot(&self, source_id: &str) -> Option<usize> {
        let trimmed = source_id.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Some(layer_id) = trimmed.strip_prefix("layer-frame:") {
            return self
                .scene_layers
                .get(layer_id)
                .and_then(|layer| layer.frame_slot.or(layer.shader_frame_slot));
        }
        if let Some(layer_id) = trimmed.strip_prefix("shader-frame:") {
            return self
                .scene_layers
                .get(layer_id)
                .and_then(|layer| layer.shader_frame_slot.or(layer.frame_slot));
        }
        self.source_frame_slots.get(trimmed).copied()
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
        let input_bindings = self
            .shader_isf_inputs
            .get(&shader_id)
            .cloned()
            .unwrap_or_default();
        let input_params = native_isf_input_params(command, &input_bindings);
        // Image inputs arrive as source-id strings. Store (offset, id) pairs;
        // the render path resolves them to live source-frame slots so LRU
        // churn between the uniforms push and the render can't go stale.
        let image_inputs = command.get("image_inputs");
        let mut image_sources = Vec::new();
        for binding in &input_bindings {
            if !matches!(binding.kind, NativeIsfInputKind::Image) {
                continue;
            }
            let Some(offset) = binding.offset else {
                continue;
            };
            let Some(source_id) = image_inputs
                .and_then(|images| images.get(&binding.name))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            image_sources.push((offset, source_id.to_string()));
        }
        let state = IsfUniformState {
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
            input_count: input_count.max(input_bindings.len().min(u32::MAX as usize) as u32),
            input_params,
            image_sources,
            seq: self.stats.commands_applied,
        };
        self.isf_uniforms.insert(shader_id, state);
    }

    fn render_bound_isf_layers(&mut self) {
        if self.isf_layer_bindings.is_empty() {
            return;
        }
        let time = self.native_graph_time_seconds();
        let frame_index = self.native_frame_index();
        let frame_delta = self.native_frame_delta();
        let shader_ids = self
            .isf_layer_bindings
            .values()
            .cloned()
            .collect::<HashSet<_>>();
        for shader_id in shader_ids {
            if let Some(state) = self.isf_uniforms.get_mut(&shader_id) {
                state.time = time;
                state.time_delta = frame_delta;
                state.frame_index = frame_index;
                state.audio0 = self.audio0;
                state.audio1 = self.audio1;
                state.audio2 = self.audio2;
                state.seq = self.stats.gpu_frames_submitted;
            }
        }
        let layer_ids = self.isf_layer_bindings.keys().cloned().collect::<Vec<_>>();
        for layer_id in layer_ids {
            self.apply_render_isf_to_layer(&json!({ "layer_id": layer_id }));
        }
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
        let has_declared_isf_inputs = self
            .shader_isf_inputs
            .get(&shader_id)
            .map(|bindings| bindings.iter().any(|binding| binding.offset.is_some()))
            .unwrap_or(false);
        let mut params = uniform_state
            .as_ref()
            .map(|uniforms| {
                if has_declared_isf_inputs {
                    uniforms.declared_input_params()
                } else {
                    uniforms.native_params(&shader_id)
                }
            })
            .unwrap_or_else(default_native_isf_params);
        let mut image_input_slots: Vec<usize> = Vec::new();
        if let Some(uniforms) = uniform_state.as_ref() {
            for (offset, source_id) in &uniforms.image_sources {
                let resolved = self.resolve_isf_image_source_slot(source_id);
                if let Some(slot) = resolved
                    && !image_input_slots.contains(&slot)
                {
                    image_input_slots.push(slot);
                }
                let slot_value = resolved.map(|slot| (slot + 1) as f32).unwrap_or(0.0);
                if let Some(slot) = params.get_mut(*offset) {
                    *slot = slot_value;
                }
            }
        }
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
                (
                    source.clone(),
                    NativeShaderSourceKind::from_label(&record.source_kind),
                    entry,
                    record.source_hash,
                    pipeline_key,
                )
            })
        });
        let mut rendered_frame_slot = None;
        if let Some((source, source_kind, fragment_entry, source_hash, pipeline_key)) =
            native_shader
        {
            let source_id = format!("native-shader:{layer_id}:{shader_id}:{source_hash:016x}");
            let slot = self.assign_source_frame_slot(&source_id);
            match self.renderer.as_mut() {
                Some(renderer) => {
                    match renderer.render_native_wgsl_shader_frame(
                        slot,
                        &pipeline_key,
                        source_kind,
                        &source,
                        &fragment_entry,
                        &shader_uniforms,
                        &image_input_slots,
                    ) {
                        Ok(()) => {
                            self.source_frames.insert(source_id, SourceFrame::full(seq));
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
        entry.shader_rendered = rendered_frame_slot.is_some();
        entry.source_kind = if rendered_frame_slot.is_some() {
            NATIVE_SHADER_SOURCE_KIND
        } else {
            0.0
        };
        entry.shader_frame_slot = rendered_frame_slot;
        // Claim the display slot only when no other source owns it — a bound
        // effect-pass output (or any generated/media source with frames)
        // must keep displaying while the shader renders underneath as input.
        let display_claimed = entry
            .source_id
            .as_deref()
            .filter(|source_id| *source_id != EMPTY_SOURCE_FRAME_ID)
            .is_some_and(|source_id| self.source_frame_slots.contains_key(source_id));
        if !display_claimed {
            entry.frame_slot = rendered_frame_slot;
        }
        entry.preview_slot = None;
        entry.native_params.copy_from_slice(&params[..8]);
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
        self.pending_media_bindings.remove(&layer_id);
        if source_type == "video"
            && let Some(source_id) = source_id.as_deref()
            && !self.source_frames.contains_key(source_id)
        {
            self.prime_native_video_source(source_id);
        }
        let preview_slot = source_id
            .as_ref()
            .and_then(|id| self.source_preview_slots.get(id))
            .copied();
        let frame_slot = source_id
            .as_ref()
            .and_then(|id| self.source_frame_slots.get(id))
            .copied();
        let source_rect = source_id
            .as_ref()
            .and_then(|id| self.source_frames.get(id))
            .map(|frame| frame.source_rect)
            .unwrap_or([0.0, 0.0, 1.0, 1.0]);
        let effective_source_type = effective_scene_source_type(
            &source_type,
            uri_for_decode.as_deref(),
            frame_slot.is_some(),
        );
        if let (Some(source_id), Some(uri)) = (source_id.as_deref(), uri_for_decode.as_deref()) {
            self.upsert_media_source_binding(source_id, uri, &effective_source_type);
        }
        // Video source replacement is transactional. A decoder may be warm,
        // starting, or seeking, but the compositor never exposes a synthetic
        // placeholder between real frames. Retain the requested binding until
        // the decoder uploads its first frame, then commit it atomically.
        // A slot can exist before any pixel does (sessions allocate their slot
        // at spawn). Displaying such a slot shows the zero-filled video
        // texture — the "green first frame". Only commit when a REAL frame
        // has been delivered for this source.
        let has_delivered_frame = source_id
            .as_deref()
            .is_some_and(|id| self.source_frames.contains_key(id));
        if effective_source_type == "video" && (frame_slot.is_none() || !has_delivered_frame) {
            if let Some(source_id) = source_id {
                self.pending_media_bindings.insert(
                    layer_id,
                    PendingMediaBinding {
                        source_id,
                        source_type: effective_source_type,
                    },
                );
            }
            return;
        }
        // An effect-pass output displays ON the layer while the layer's bound
        // FS/ISF shader keeps rendering underneath as the chain's INPUT — the
        // shader binding must survive this display bind.
        let effect_pass_display = uri_for_decode
            .as_deref()
            .is_some_and(|uri| uri.starts_with("native-effect-pass://"));
        if effective_source_type != "shader" && !effect_pass_display {
            self.isf_layer_bindings.remove(&layer_id);
        }
        let new_source_id = source_id.clone();
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
        let previous_source_id = entry.source_id.clone();
        entry.source_kind = source_kind(&effective_source_type);
        entry.source_id = source_id;
        entry.preview_slot = preview_slot;
        entry.frame_slot = frame_slot;
        entry.source_rect = source_rect;
        if !effect_pass_display {
            entry.shader_rendered = false;
        }
        if effective_source_type != "shader" && !effect_pass_display {
            entry.shader_id = None;
        }
        if effective_source_type != "none" && entry.color[3] <= 0.0 {
            entry.color = stable_layer_color(&layer_id, 1.0);
        }
        if effective_source_type != "color" {
            entry.color = source_type_color(&effective_source_type, &layer_id);
        }
        if let Some(previous) = previous_source_id
            && new_source_id.as_deref() != Some(previous.as_str())
        {
            self.release_media_source_if_orphaned(&previous);
        }
        if effective_source_type == "image" {
            if let (Some(source_id), Some(uri)) = (source_id_for_decode, uri_for_decode.as_deref())
            {
                self.decode_native_image_source(&source_id, uri);
            }
        }
    }

    fn commit_pending_media_bindings_for_source(
        &mut self,
        source_id: &str,
        frame_slot: usize,
        source_rect: [f32; 4],
    ) {
        let ready_layers = self
            .pending_media_bindings
            .iter()
            .filter(|(_, binding)| binding.source_id == source_id)
            .map(|(layer_id, binding)| (layer_id.clone(), binding.clone()))
            .collect::<Vec<_>>();
        let mut replaced_sources = Vec::new();
        for (layer_id, binding) in ready_layers {
            self.pending_media_bindings.remove(&layer_id);
            self.isf_layer_bindings.remove(&layer_id);
            let entry = self
                .scene_layers
                .entry(layer_id.clone())
                .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
            if let Some(previous) = entry.source_id.clone()
                && previous != binding.source_id
            {
                replaced_sources.push(previous);
            }
            entry.source_kind = source_kind(&binding.source_type);
            entry.source_id = Some(binding.source_id);
            entry.preview_slot = None;
            entry.frame_slot = Some(frame_slot);
            entry.source_rect = source_rect;
            entry.shader_rendered = false;
            entry.shader_id = None;
            entry.color = source_type_color(&binding.source_type, &layer_id);
        }
        // The commit just unbound these sources from their layers; free their
        // sessions/slots unless something else still references them.
        for previous in replaced_sources {
            self.release_media_source_if_orphaned(&previous);
        }
    }

    fn media_source_is_referenced(&self, source_id: &str) -> bool {
        if source_id == EMPTY_SOURCE_FRAME_ID {
            return true;
        }
        self.scene_layers
            .values()
            .any(|layer| layer.source_id.as_deref() == Some(source_id))
            || self
                .pending_media_bindings
                .values()
                .any(|binding| binding.source_id == source_id)
            || self
                .native_graph_layers
                .values()
                .any(|layer| layer.input_source_id == source_id || layer.source_id == source_id)
    }

    /// Free every per-source resource for a media source that no layer,
    /// pending binding, or graph input references anymore. Without this,
    /// replaced sources accumulate until the armed-session cap and the
    /// source-frame slots fill; per-frame ensure() then refreshes every
    /// session's last_used_frame, LRU eviction degrades to effectively
    /// random churn, and the *incoming* source's session can be evicted
    /// before it pre-rolls — observed as "switching clips stops working
    /// after several swaps" with the layer stuck on PENDING.
    fn release_media_source_if_orphaned(&mut self, source_id: &str) {
        if source_id.is_empty()
            || source_id.starts_with("library:")
            || self.media_source_is_referenced(source_id)
        {
            return;
        }
        self.media_sources.remove(source_id);
        self.native_video_streams.remove(source_id);
        self.native_video_scrub_requests.remove(source_id);
        self.source_frame_slots.remove(source_id);
        self.source_frames.remove(source_id);
        self.source_frame_signatures.remove(source_id);
        self.native_video_frame_signatures.remove(source_id);
        self.stats.media_source_orphan_releases =
            self.stats.media_source_orphan_releases.saturating_add(1);
    }

    fn upsert_media_source_binding(&mut self, source_id: &str, uri: &str, source_type: &str) {
        if source_id.trim().is_empty() || uri.trim().is_empty() || source_type == "none" {
            return;
        }
        let render_clock_time = self.native_graph_time_seconds() as f64;
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
                seek_generation: 0,
                playback_rate: 1.0,
                paused: true,
                loop_enabled: false,
                duration_seconds: None,
                trim_start: 0.0,
                trim_end: 1.0,
                decode_width: None,
                decode_height: None,
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
        let render_clock_time = self.native_graph_time_seconds() as f64;
        let playback_time_seconds = number_at(command, &["time_seconds"])
            .or_else(|| number_at(command, &["time"]))
            .or_else(|| existing.as_ref().map(|state| state.playback_time_seconds))
            .unwrap_or(0.0)
            .clamp(0.0, 3600.0);
        let seek_generation = number_at(command, &["seek_generation"])
            .or_else(|| number_at(command, &["seekGeneration"]))
            .or_else(|| existing.as_ref().map(|state| state.seek_generation as f64))
            .unwrap_or(0.0)
            .round()
            .max(0.0) as u64;
        let playback_rate = number_at(command, &["playback_rate"])
            .or_else(|| number_at(command, &["rate"]))
            .or_else(|| existing.as_ref().map(|state| state.playback_rate))
            .unwrap_or(1.0)
            .clamp(-16.0, 16.0);
        let duration_seconds = number_at(command, &["duration_seconds"])
            .or_else(|| number_at(command, &["duration"]))
            .filter(|duration| duration.is_finite() && *duration > 0.0)
            .or_else(|| existing.as_ref().and_then(|state| state.duration_seconds));
        let trim_start = number_at(command, &["trim_start"])
            .or_else(|| number_at(command, &["trimStart"]))
            .or_else(|| existing.as_ref().map(|state| state.trim_start))
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let trim_end = number_at(command, &["trim_end"])
            .or_else(|| number_at(command, &["trimEnd"]))
            .or_else(|| existing.as_ref().map(|state| state.trim_end))
            .unwrap_or(1.0)
            .clamp(trim_start, 1.0);
        let decode_width = number_at(command, &["decode_width"])
            .or_else(|| number_at(command, &["decodeWidth"]))
            .map(|value| {
                value
                    .round()
                    .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                    as usize
            })
            .or_else(|| existing.as_ref().and_then(|state| state.decode_width));
        let decode_height = number_at(command, &["decode_height"])
            .or_else(|| number_at(command, &["decodeHeight"]))
            .map(|value| {
                value
                    .round()
                    .clamp(16.0, MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION as f64)
                    as usize
            })
            .or_else(|| existing.as_ref().and_then(|state| state.decode_height));
        let seq = number_at(command, &["seq"])
            .or_else(|| existing.as_ref().map(|state| state.seq as f64 + 1.0))
            .unwrap_or(1.0)
            .round()
            .max(0.0) as u64;
        let next_state = NativeMediaSourceState {
            uri,
            source_type,
            playback_time_seconds,
            seek_generation,
            playback_rate,
            paused: bool_at(command, &["paused"])
                .unwrap_or_else(|| existing.as_ref().map(|state| state.paused).unwrap_or(false)),
            loop_enabled: bool_at(command, &["loop_enabled"])
                .or_else(|| bool_at(command, &["loop"]))
                .unwrap_or_else(|| {
                    existing
                        .as_ref()
                        .map(|state| state.loop_enabled)
                        .unwrap_or(false)
                }),
            duration_seconds,
            trim_start,
            trim_end,
            decode_width,
            decode_height,
            clock_time_seconds: if self.render_clock_mode == "manual" {
                number_at(command, &["clock_time_seconds"])
                    .or_else(|| number_at(command, &["clock_time"]))
                    .unwrap_or(render_clock_time)
            } else {
                render_clock_time
            }
            .clamp(0.0, 1.0e9),
            seq,
        };
        self.media_sources
            .insert(source_id.clone(), next_state.clone());

        if self.render_clock_mode == "live" && next_state.source_type == "video" {
            let (width, height) = self.native_video_decode_dimensions();
            self.ensure_native_video_stream(
                &source_id,
                &next_state,
                width,
                height,
                !next_state.paused,
            );
            if !next_state.paused {
                self.drain_native_video_streams();
            }
        }
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
                    self.media_sources.get(&source_id).map(|state| {
                        state.current_time_seconds(Some(self.native_graph_time_seconds()))
                    })
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
            if bool_at(command, &["scrub_preview", "scrubPreview"]).unwrap_or(false) {
                self.queue_native_video_scrub_frame(
                    &source_id,
                    &uri,
                    width,
                    height,
                    time_seconds,
                    seq,
                );
            } else {
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
    }

    fn set_stage3d_scene(&mut self, params: &Value) -> Result<Value, String> {
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
        let scene_value = params
            .get("scene")
            .or_else(|| params.get("projection_sim"))
            .unwrap_or(params);
        if scene_value.is_null() {
            eprintln!("[ghost-core] projection-sim scene CLEARED");
            self.projection_sim_scene = None;
            self.projection_sim_scene_summary = NativeSceneBridgeSummary::empty("projection_sim");
            return Ok(json!(self.projection_sim_scene_summary.clone()));
        }
        let scene = scene_payload(params, "projection_sim")?;
        let summary = summarize_projection_sim_scene(scene);
        eprintln!("[ghost-core] projection-sim scene SET");
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
                    self.media_sources.get(&source_id).map(|state| {
                        state.current_time_seconds(Some(self.native_graph_time_seconds()))
                    })
                })
                .unwrap_or(0.0)
                .clamp(0.0, 3600.0);
            let seq = number_at(params, &["seq"])
                .unwrap_or((time_seconds * 1000.0).round())
                .round()
                .max(1.0) as u64;
            let render_clock_time = self.native_graph_time_seconds() as f64;
            let state = NativeMediaSourceState {
                uri: uri.clone(),
                source_type: "video".to_string(),
                playback_time_seconds: time_seconds,
                seek_generation: number_at(params, &["seek_generation"])
                    .or_else(|| number_at(params, &["seekGeneration"]))
                    .unwrap_or(0.0)
                    .round()
                    .max(0.0) as u64,
                playback_rate: number_at(params, &["playback_rate"])
                    .or_else(|| number_at(params, &["playbackRate"]))
                    .unwrap_or(1.0)
                    .clamp(0.01, 16.0),
                paused: true,
                loop_enabled: bool_at(params, &["loop_enabled"])
                    .or_else(|| bool_at(params, &["loop"]))
                    .unwrap_or(true),
                duration_seconds: number_at(params, &["duration_seconds"])
                    .or_else(|| number_at(params, &["duration"]))
                    .filter(|duration| duration.is_finite() && *duration > 0.0),
                trim_start: number_at(params, &["trim_start"])
                    .or_else(|| number_at(params, &["trimStart"]))
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0),
                trim_end: number_at(params, &["trim_end"])
                    .or_else(|| number_at(params, &["trimEnd"]))
                    .unwrap_or(1.0)
                    .clamp(0.0, 1.0),
                decode_width: Some(width),
                decode_height: Some(height),
                clock_time_seconds: render_clock_time,
                seq,
            };
            self.media_sources.insert(source_id.clone(), state.clone());
            self.ensure_native_video_stream(&source_id, &state, width, height, false);
            // Arming is enqueue-only. Pre-roll fills on the decoder thread and
            // prime_armed_native_video_sources() uploads the first frame the
            // moment it lands; readiness is reported via
            // status.native_video_sessions (state == "prerolled"). Blocking
            // here stalled the command loop — and therefore every layer and
            // every RPC — for up to 3 s per source, which is the cadence
            // collapse documented in NATIVE_VIDEO_HANDOFF_2026-07-14.
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
            "vram_budget_enforcement": true,
            "native_media_decode": true,
            "media_prefetch": true,
            "video_decode": true,
            "source_frame_fallback": false,
            "shared_texture_source_frame_upload": cfg!(any(target_os = "macos", target_os = "windows")),
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
                "Visible local video layers decode continuously from the native render/media clock through the decode pump; shared media sources ingest IOSurfaceID handles on macOS and DXGI HANDLEs on Windows."
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
        let output_width = self.pending_width.max(1) as usize;
        let output_height = self.pending_height.max(1) as usize;
        if output_width >= output_height {
            (size, (size * output_height / output_width).max(16))
        } else {
            ((size * output_width / output_height).max(16), size)
        }
    }

    fn drain_native_video_streams(&mut self) {
        let now = Instant::now();
        let source_ids = self
            .native_video_streams
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut ready = Vec::new();
        let mut errors = Vec::new();
        for source_id in source_ids {
            if self
                .native_video_scrub_requests
                .get(&source_id)
                .is_some_and(|request| request.hold_until > now)
            {
                continue;
            }
            let Some(state) = self.native_video_streams.get_mut(&source_id) else {
                continue;
            };
            if !state.playing || now < state.next_frame_at {
                continue;
            }
            match state.stream.try_pop() {
                Some(Ok(frame)) => {
                    if let Some(triggered_at) = state.triggered_at.take() {
                        let latency_us = now
                            .saturating_duration_since(triggered_at)
                            .as_micros()
                            .min(u64::MAX as u128) as u64;
                        self.stats.native_video_trigger_last_latency_us = latency_us;
                        self.stats.native_video_trigger_max_latency_us = self
                            .stats
                            .native_video_trigger_max_latency_us
                            .max(latency_us);
                    }
                    state.seq = state.seq.saturating_add(1);
                    state.frames_presented = state.frames_presented.saturating_add(1);
                    state.last_used_frame = self.stats.frames_presented;
                    state.next_frame_at = if now.saturating_duration_since(state.next_frame_at)
                        > NATIVE_VIDEO_FRAME_INTERVAL.saturating_mul(2)
                    {
                        now + NATIVE_VIDEO_FRAME_INTERVAL
                    } else {
                        state.next_frame_at + NATIVE_VIDEO_FRAME_INTERVAL
                    };
                    ready.push((source_id, state.seq, frame));
                }
                Some(Err(err)) => errors.push(err),
                None => {
                    if state.frames_presented == 0 {
                        state.next_frame_at = now + Duration::from_millis(2);
                    } else {
                        self.stats.native_video_stream_underflows =
                            self.stats.native_video_stream_underflows.saturating_add(1);
                        state.next_frame_at = now + NATIVE_VIDEO_FRAME_INTERVAL;
                    }
                }
            }
        }
        for err in errors {
            self.stats.native_video_frame_decode_failures = self
                .stats
                .native_video_frame_decode_failures
                .saturating_add(1);
            self.stats.native_video_frame_decode_last_error = err;
        }
        for (source_id, seq, frame) in ready {
            let uploaded = self.upload_source_frame_pixels(
                source_id.clone(),
                seq,
                frame.width,
                frame.height,
                &frame.rgba,
                "native-video-stream",
                false,
            );
            self.stats.native_video_frame_decodes =
                self.stats.native_video_frame_decodes.saturating_add(1);
            self.stats.native_video_frame_decode_bytes_uploaded = self
                .stats
                .native_video_frame_decode_bytes_uploaded
                .saturating_add(uploaded as u64);
            self.stats.native_video_frame_decode_last_error.clear();
        }
    }

    fn native_video_session_signature(
        state: &NativeMediaSourceState,
        width: usize,
        height: usize,
    ) -> String {
        let duration = state.duration_seconds.unwrap_or(0.0);
        format!(
            "{}:{width}x{height}:{:.6}:{:.6}:{:.6}:{:.6}:{}",
            state.uri,
            state.playback_rate,
            state.trim_start,
            state.trim_end,
            duration,
            state.loop_enabled,
        )
    }

    fn evict_native_video_session_for(&mut self, playing: bool) {
        let cap = if playing {
            NATIVE_VIDEO_SESSION_MAX_PLAYING
        } else {
            NATIVE_VIDEO_SESSION_MAX_ARMED
        };
        let count = self
            .native_video_streams
            .values()
            .filter(|state| state.playing == playing)
            .count();
        if count < cap {
            return;
        }
        if let Some(source_id) = self
            .native_video_streams
            .iter()
            .filter(|(source_id, state)| {
                state.playing == playing
                    // Never evict a session a pending binding is waiting on:
                    // the layer stays PENDING forever if its incoming source's
                    // pre-roll is churned out from under it. If every session
                    // is protected, briefly exceeding the cap is the lesser
                    // evil — GC on rebind keeps the pool bounded.
                    && !self
                        .pending_media_bindings
                        .values()
                        .any(|binding| binding.source_id == **source_id)
            })
            .min_by_key(|(_, state)| state.last_used_frame)
            .map(|(source_id, _)| source_id.clone())
        {
            self.native_video_streams.remove(&source_id);
            self.stats.native_video_session_evictions =
                self.stats.native_video_session_evictions.saturating_add(1);
        }
    }

    fn ensure_native_video_stream(
        &mut self,
        source_id: &str,
        state: &NativeMediaSourceState,
        fallback_width: usize,
        fallback_height: usize,
        playing: bool,
    ) {
        if state.playback_rate <= 0.0 {
            return;
        }
        let Some(path) = local_media_path_from_uri(&state.uri) else {
            self.native_video_streams.remove(source_id);
            return;
        };
        let width = state.decode_width.unwrap_or(fallback_width);
        let height = state.decode_height.unwrap_or(fallback_height);
        let signature = Self::native_video_session_signature(state, width, height);
        let existing_stream_state = self
            .native_video_streams
            .get(source_id)
            .filter(|stream_state| stream_state.signature == signature)
            .map(|stream_state| (stream_state.playing, stream_state.seek_generation));
        if let Some((was_playing, existing_seek_generation)) = existing_stream_state {
            if existing_seek_generation == state.seek_generation {
                if was_playing != playing {
                    self.evict_native_video_session_for(playing);
                }
                let Some(stream_state) = self.native_video_streams.get_mut(source_id) else {
                    return;
                };
                let was_playing = stream_state.playing;
                stream_state.playing = playing;
                stream_state.last_used_frame = self.stats.frames_presented;
                stream_state.stream.set_playing(playing);
                if playing && !was_playing {
                    stream_state.next_frame_at = Instant::now();
                    stream_state.triggered_at = Some(Instant::now());
                }
                return;
            }
        }
        self.native_video_streams.remove(source_id);

        // Arming under `library:<clip>:g<N>` supersedes every older
        // generation of the same clip. Without this reap, each trigger's
        // replenish stacked another live decoder (`g2`, `g3`, …) — observed
        // as frame rates collapsing the longer a VJ set ran.
        if let Some(base) = source_id
            .strip_prefix("library:")
            .and_then(|rest| rest.rsplit_once(":g").map(|(base, _)| base.to_string()))
        {
            let prefix = format!("library:{base}:g");
            let stale = self
                .native_video_streams
                .keys()
                .filter(|key| key.starts_with(&prefix) && key.as_str() != source_id)
                .cloned()
                .collect::<Vec<_>>();
            for key in stale {
                self.native_video_streams.remove(&key);
                self.media_sources.remove(&key);
                self.source_frame_slots.remove(&key);
                self.source_frames.remove(&key);
            }
        }
        // Hard cap on the armed pool: beyond it, paused decode sessions cost
        // more in pump time than a cold start would. Evict the least recently
        // touched armed session first.
        const NATIVE_LIBRARY_SESSION_CAP: usize = 6;
        if source_id.starts_with("library:") {
            let mut armed = self
                .native_video_streams
                .iter()
                .filter(|(key, session)| key.starts_with("library:") && !session.playing)
                .map(|(key, session)| (key.clone(), session.last_used_frame))
                .collect::<Vec<_>>();
            if armed.len() >= NATIVE_LIBRARY_SESSION_CAP {
                armed.sort_by_key(|(_, last_used)| *last_used);
                for (key, _) in armed.iter().take(armed.len() + 1 - NATIVE_LIBRARY_SESSION_CAP) {
                    self.native_video_streams.remove(key);
                    self.media_sources.remove(key);
                    self.source_frame_slots.remove(key);
                    self.source_frames.remove(key);
                }
            }
        }

        // Claim a compatible armed session (for example one warmed from the
        // media library) instead of spawning ffmpeg on the trigger path.
        if let Some(warm_source_id) = self
            .native_video_streams
            .iter()
            .filter(|(candidate_id, candidate)| {
                candidate_id.starts_with("library:")
                    && !candidate.playing
                    && candidate.signature == signature
                    && candidate.stream.buffered_frames() > 0
            })
            .max_by_key(|(_, candidate)| candidate.stream.buffered_frames())
            .map(|(candidate_id, _)| candidate_id.clone())
            && let Some(mut warm) = self.native_video_streams.remove(&warm_source_id)
        {
            warm.playing = playing;
            warm.seek_generation = state.seek_generation;
            warm.last_used_frame = self.stats.frames_presented;
            warm.next_frame_at = Instant::now();
            warm.triggered_at = playing.then(Instant::now);
            warm.stream.set_playing(playing);
            self.native_video_streams
                .insert(source_id.to_string(), warm);
            return;
        }

        self.evict_native_video_session_for(playing);
        let start_time = state.current_time_seconds(Some(self.native_graph_time_seconds()));
        let stream = spawn_native_video_stream(
            path,
            width,
            height,
            start_time,
            state.playback_rate,
            state.loop_enabled,
            state.duration_seconds,
            state.trim_start,
            state.trim_end,
        );
        self.native_video_streams.insert(
            source_id.to_string(),
            NativeVideoStreamState {
                signature,
                stream,
                seek_generation: state.seek_generation,
                seq: self
                    .source_frames
                    .get(source_id)
                    .map(|frame| frame.seq)
                    .unwrap_or(0),
                playing,
                next_frame_at: Instant::now(),
                last_used_frame: self.stats.frames_presented,
                frames_presented: 0,
                triggered_at: playing.then(Instant::now),
            },
        );
        if let Some(session) = self.native_video_streams.get(source_id) {
            session.stream.set_playing(playing);
        }
    }

    fn prime_native_video_source(&mut self, source_id: &str) -> bool {
        let Some(session) = self.native_video_streams.get_mut(source_id) else {
            return self.source_frames.contains_key(source_id);
        };
        let Some(result) = session.stream.try_pop() else {
            return self.source_frames.contains_key(source_id);
        };
        let frame = match result {
            Ok(frame) => frame,
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                return false;
            }
        };
        session.seq = session.seq.saturating_add(1);
        let seq = session.seq;
        let uploaded = self.upload_source_frame_pixels(
            source_id.to_string(),
            seq,
            frame.width,
            frame.height,
            &frame.rgba,
            "native-video-preroll",
            false,
        );
        self.stats.native_video_frame_decodes =
            self.stats.native_video_frame_decodes.saturating_add(1);
        self.stats.native_video_frame_decode_bytes_uploaded = self
            .stats
            .native_video_frame_decode_bytes_uploaded
            .saturating_add(uploaded as u64);
        true
    }

    fn prime_armed_native_video_sources(&mut self) {
        let pending_sources = self
            .pending_media_bindings
            .values()
            .map(|binding| binding.source_id.clone())
            .collect::<HashSet<_>>();
        let visible_sources = self
            .scene_layers
            .values()
            .filter(|layer| layer.visible)
            .filter_map(|layer| layer.source_id.clone())
            .collect::<HashSet<_>>();
        let source_ids = self
            .native_video_streams
            .iter()
            .filter(|(source_id, session)| {
                !session.playing
                    && !self.source_frames.contains_key(*source_id)
                    && (pending_sources.contains(*source_id)
                        || visible_sources.contains(*source_id))
                    && session.stream.buffered_frames() > NATIVE_VIDEO_SESSION_PREROLL_MIN
            })
            .map(|(source_id, _)| source_id.clone())
            .collect::<Vec<_>>();
        for source_id in source_ids {
            self.prime_native_video_source(&source_id);
        }
    }

    fn pump_native_video_decodes(&mut self) {
        if self.renderer.is_none() {
            return;
        }
        // An armed session is not ready until its first real frame is resident
        // in the GPU source texture. Keep at least the minimum pre-roll behind
        // it so triggering can immediately drain motion frames.
        self.prime_armed_native_video_sources();
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

        if self.render_clock_mode == "live" {
            let visible_sources = active_sources.iter().cloned().collect::<HashSet<_>>();
            let source_ids = self.media_sources.keys().cloned().collect::<Vec<_>>();
            for source_id in source_ids {
                let Some(state) = self.media_sources.get(&source_id).cloned() else {
                    continue;
                };
                if state.source_type == "video" && state.seq > 0 {
                    let playing = visible_sources.contains(&source_id) && !state.paused;
                    self.ensure_native_video_stream(&source_id, &state, width, height, playing);
                }
            }
            self.drain_native_video_streams();
            return;
        }
        self.native_video_streams.clear();
        if self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT {
            return;
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
            let decode_width = state.decode_width.unwrap_or(width);
            let decode_height = state.decode_height.unwrap_or(height);
            if self.queue_native_video_decode_for_state(
                &source_id,
                &state,
                decode_width,
                decode_height,
            ) {
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
        let time_seconds = state.current_time_seconds(Some(self.native_graph_time_seconds()));
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
        let seq = self.native_frame_index().max(
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
                pending_key: signature.clone(),
                signature,
                seq,
                exact_preview: false,
            },
        );
        true
    }

    fn queue_native_video_scrub_frame(
        &mut self,
        source_id: &str,
        uri: &str,
        width: usize,
        height: usize,
        time_seconds: f64,
        seq: u64,
    ) {
        self.native_video_scrub_requests.insert(
            source_id.to_string(),
            NativeVideoScrubRequest {
                seq,
                frame_bucket: native_video_frame_bucket(time_seconds),
                uri: uri.to_string(),
                width,
                height,
                time_seconds,
                hold_until: Instant::now() + Duration::from_millis(250),
            },
        );
        self.start_latest_native_video_scrub(source_id);
    }

    fn start_latest_native_video_scrub(&mut self, source_id: &str) {
        let pending_prefix = format!("scrub:{source_id}:");
        if self
            .native_video_decode_pending
            .iter()
            .any(|key| key.starts_with(&pending_prefix))
        {
            return;
        }
        let Some(request) = self.native_video_scrub_requests.get(source_id).cloned() else {
            return;
        };
        let Some(path) = local_media_path_from_uri(&request.uri) else {
            return;
        };
        let signature = match native_video_frame_file_signature(
            &path,
            request.width,
            request.height,
            request.frame_bucket,
        ) {
            Ok(signature) => signature,
            Err(err) => {
                self.stats.native_video_frame_decode_failures = self
                    .stats
                    .native_video_frame_decode_failures
                    .saturating_add(1);
                self.stats.native_video_frame_decode_last_error = err;
                return;
            }
        };
        let upload_seq = request.seq.max(
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
                upload_seq,
                decoded_width,
                decoded_height,
                &rgba,
                "native-video-scrub-cache",
                false,
            );
            self.stats.native_video_frame_decode_bytes_uploaded = self
                .stats
                .native_video_frame_decode_bytes_uploaded
                .saturating_add(uploaded as u64);
            self.native_video_frame_signatures
                .insert(source_id.to_string(), signature);
            self.request_auto_present();
            return;
        }
        let pending_key = format!("{pending_prefix}{}", request.frame_bucket);
        self.native_video_decode_pending.insert(pending_key.clone());
        self.stats.decode_jobs_submitted = self.stats.decode_jobs_submitted.saturating_add(1);
        self.stats.decode_queue_peak = self
            .stats
            .decode_queue_peak
            .max(self.native_video_decode_pending.len() as u64);
        spawn_native_video_frame_decode(
            self.event_proxy.clone(),
            NativeVideoFrameDecodeJob {
                source_id: source_id.to_string(),
                uri: request.uri,
                path,
                width: request.width,
                height: request.height,
                time_seconds: request.time_seconds,
                frame_bucket: request.frame_bucket,
                signature,
                seq: upload_seq,
                pending_key,
                exact_preview: true,
            },
        );
    }

    fn apply_native_video_decode_result(&mut self, result: NativeVideoFrameDecodeResult) {
        self.native_video_decode_pending.remove(&result.pending_key);
        self.stats.decode_jobs_completed = self.stats.decode_jobs_completed.saturating_add(1);
        let source_id = result.source_id.clone();
        let latest_scrub = result
            .exact_preview
            .then(|| self.native_video_scrub_requests.get(&source_id).cloned())
            .flatten();
        let scrub_result_is_current = latest_scrub
            .as_ref()
            .is_some_and(|request| request.frame_bucket == result.frame_bucket);
        let should_start_next_scrub = result.exact_preview
            && latest_scrub
                .as_ref()
                .is_some_and(|request| request.frame_bucket != result.frame_bucket);
        match result.result {
            Ok(frames) => {
                self.native_video_decode_failed.remove(&result.signature);
                self.stats.native_video_frame_decodes = self
                    .stats
                    .native_video_frame_decodes
                    .saturating_add(frames.len() as u64);
                self.stats.native_video_frame_decode_last_error.clear();
                let current_bucket = if result.exact_preview {
                    result.frame_bucket
                } else {
                    self.media_sources
                        .get(&result.source_id)
                        .map(|state| {
                            native_video_frame_bucket(
                                state.current_time_seconds(Some(self.native_graph_time_seconds())),
                            )
                        })
                        .unwrap_or(result.frame_bucket)
                };
                let mut upload_frame = None;
                let mut upload_distance = u64::MAX;
                for frame in frames {
                    let distance = frame.frame_bucket.abs_diff(current_bucket);
                    let should_upload = distance < upload_distance;
                    self.store_native_video_frame_cache(
                        frame.signature.clone(),
                        frame.width,
                        frame.height,
                        &frame.rgba,
                    );
                    if should_upload {
                        upload_frame = Some(frame);
                        upload_distance = distance;
                    }
                }
                let source_still_bound = self
                    .media_sources
                    .get(&result.source_id)
                    .is_some_and(|state| state.uri == result.uri && state.source_type == "video");
                if source_still_bound
                    && (!result.exact_preview || scrub_result_is_current)
                    && let Some(frame) = upload_frame
                {
                    let upload_seq = latest_scrub
                        .as_ref()
                        .map(|request| request.seq)
                        .unwrap_or(result.seq)
                        .max(
                            self.source_frames
                                .get(&result.source_id)
                                .map(|source_frame| source_frame.seq.saturating_add(1))
                                .unwrap_or(1),
                        );
                    let uploaded = self.upload_source_frame_pixels(
                        result.source_id.clone(),
                        upload_seq,
                        frame.width,
                        frame.height,
                        &frame.rgba,
                        if result.exact_preview {
                            "native-video-scrub"
                        } else {
                            "native-video-decode-pump"
                        },
                        false,
                    );
                    self.stats.native_video_frame_decode_bytes_uploaded = self
                        .stats
                        .native_video_frame_decode_bytes_uploaded
                        .saturating_add(uploaded as u64);
                    self.native_video_frame_signatures
                        .insert(result.source_id.clone(), frame.signature);
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
        if should_start_next_scrub {
            self.start_latest_native_video_scrub(&source_id);
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
        if self.render_clock_mode == "live"
            && self
                .media_sources
                .values()
                .any(|state| state.source_type == "video" && !state.paused)
        {
            self.stats.video_oneshot_decodes_during_playback = self
                .stats
                .video_oneshot_decodes_during_playback
                .saturating_add(1);
        }
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
        let is_native_video = transport.starts_with("native-video");
        let (uploaded_bytes, source_rect) = if is_native_video {
            let upload_width = width.min(dst_size);
            let upload_height = height.min(dst_size);
            let origin_x = (dst_size.saturating_sub(upload_width)) / 2;
            let origin_y = (dst_size.saturating_sub(upload_height)) / 2;
            let source_rect = [
                origin_x as f32 / dst_size.max(1) as f32,
                origin_y as f32 / dst_size.max(1) as f32,
                upload_width as f32 / dst_size.max(1) as f32,
                upload_height as f32 / dst_size.max(1) as f32,
            ];
            let uploaded = self
                .renderer
                .as_ref()
                .and_then(|renderer| {
                    renderer.write_video_source_frame(
                        slot,
                        rgba,
                        upload_width,
                        upload_height,
                        origin_x,
                        origin_y,
                    )
                })
                .unwrap_or(0);
            (uploaded, source_rect)
        } else {
            let pixels = resample_frame_bytes(rgba, width, height, dst_size, dst_size);
            if let Some(renderer) = self.renderer.as_ref() {
                renderer.write_source_frame(slot, &pixels);
            }
            (pixels.len(), [0.0, 0.0, 1.0, 1.0])
        };
        self.stats.source_frame_uploads = self.stats.source_frame_uploads.saturating_add(1);
        self.stats.source_frame_bytes_uploaded = self
            .stats
            .source_frame_bytes_uploaded
            .saturating_add(uploaded_bytes as u64);
        self.stats.source_frame_input_bytes_uploaded = self
            .stats
            .source_frame_input_bytes_uploaded
            .saturating_add(input_byte_len);
        self.stats.source_frame_resampled_bytes_uploaded = self
            .stats
            .source_frame_resampled_bytes_uploaded
            .saturating_add(if is_native_video {
                0
            } else {
                uploaded_bytes as u64
            });
        if count_cpu_fallback {
            self.stats.source_frame_cpu_fallback_uploads = self
                .stats
                .source_frame_cpu_fallback_uploads
                .saturating_add(1);
        }
        self.stats.source_frame_last_input_bytes = input_byte_len;
        self.stats.source_frame_last_upload_bytes = uploaded_bytes as u64;
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
            .insert(source_id.clone(), SourceFrame::with_rect(seq, source_rect));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
                layer.source_rect = source_rect;
            }
        }
        self.commit_pending_media_bindings_for_source(&source_id, slot, source_rect);
        uploaded_bytes
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
                "shared texture source-frame upload is missing a shared texture handle",
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
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        self.commit_pending_media_bindings_for_source(&source_id, slot, [0.0, 0.0, 1.0, 1.0]);
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

    fn ensure_empty_source_frame_slot(&mut self) -> usize {
        let slot = self.assign_source_frame_slot(EMPTY_SOURCE_FRAME_ID);
        if self.source_frames.contains_key(EMPTY_SOURCE_FRAME_ID) {
            return slot;
        }
        if let Some(renderer) = self.renderer.as_ref() {
            // The empty sentinel frame must be fully transparent: shader
            // layers bind it as their input, and any visible fill (the old
            // debug checkerboard) bleeds into the composite as ghost washes.
            let size = renderer.source_frame_size;
            let pixels = vec![0u8; size.saturating_mul(size).saturating_mul(4)];
            renderer.write_source_frame(slot, &pixels);
        }
        self.source_frames
            .insert(EMPTY_SOURCE_FRAME_ID.to_string(), SourceFrame::full(0));
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

        // All slots occupied: evict an occupant nothing references anymore.
        // The hash-slot fallback below can land on a source that is still
        // actively uploading, and the two sources then fight over the slot
        // every frame — the incoming one loses to whoever uploads faster.
        if let Some((old_source_id, slot)) = self
            .source_frame_slots
            .iter()
            .filter(|(id, _)| id.as_str() != source_id && !self.media_source_is_referenced(id))
            .min_by_key(|(_, slot)| **slot)
            .map(|(id, slot)| (id.clone(), *slot))
        {
            self.source_frame_slots.remove(&old_source_id);
            self.source_frames.remove(&old_source_id);
            self.source_frame_signatures.remove(&old_source_id);
            self.native_video_frame_signatures.remove(&old_source_id);
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
            let removed_source = self
                .scene_layers
                .remove(&layer_id)
                .and_then(|layer| layer.source_id);
            let pending_source = self
                .pending_media_bindings
                .remove(&layer_id)
                .map(|binding| binding.source_id);
            self.isf_layer_bindings.remove(&layer_id);
            self.native_graph_layers.remove(&layer_id);
            self.native_point_cloud_assets.remove(&layer_id);
            if let Some(source_id) = removed_source {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = pending_source {
                self.release_media_source_if_orphaned(&source_id);
            }
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

    /// Layer list for one deck confidence monitor: only the layers tagged for
    /// this bank, rendered at their true pre-crossfader opacity. Samples the
    /// same source frames the program mix uses — no extra source render or
    /// decode, just one more tiny composite pass.
    fn deck_monitor_layer_data(&self, bank: u8) -> Vec<LayerGpu> {
        let mut layers: Vec<&SceneLayer> = self
            .scene_layers
            .values()
            .filter(|layer| layer.deck_monitor_bank == Some(bank))
            .collect();
        layers.sort_by(|a, b| b.z_index.cmp(&a.z_index).then_with(|| a.id.cmp(&b.id)));
        layers
            .into_iter()
            .take(MAX_SCENE_LAYERS)
            .map(|layer| {
                let mut monitor_layer = layer.clone();
                monitor_layer.opacity = layer.deck_monitor_opacity;
                monitor_layer.gpu()
            })
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
            UserEvent::GpuFrameCompleted => {
                self.sync_gpu_frame_stats();
                if !self.running {
                    return;
                }
                let frame_duration = self.frame_duration();
                let next_frame_at = self.last_redraw + frame_duration;
                let now = Instant::now();
                if now >= next_frame_at {
                    if self.output_window_attached {
                        if let Some(renderer) = self.renderer.as_ref() {
                            renderer.window.request_redraw();
                        }
                    } else {
                        self.render();
                    }
                    self.last_redraw = now;
                    event_loop.set_control_flow(ControlFlow::WaitUntil(now + frame_duration));
                } else {
                    event_loop.set_control_flow(ControlFlow::WaitUntil(next_frame_at));
                }
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
                // In native-main-driver mode the wgpu process is the renderer service,
                // not just a disposable output window. Closing the visible native
                // window should detach presentation while keeping the core alive for
                // graph sync, recording, Syphon, and the next output attach.
                self.output_window_attached = false;
                set_appkit_projector_presentation(false);
                renderer.window.set_visible(false);
                renderer.window.set_fullscreen(None);
                self.stats.swapchain_last_present_result = "detached".to_string();
                self.stats.swapchain_last_present_error.clear();
                event_loop.set_control_flow(ControlFlow::Wait);
            }
            WindowEvent::KeyboardInput { event, .. }
                if event.state == ElementState::Pressed
                    && matches!(&event.logical_key, Key::Named(NamedKey::Escape)) =>
            {
                self.output_window_attached = false;
                set_appkit_projector_presentation(false);
                renderer.window.set_visible(false);
                renderer.window.set_fullscreen(None);
                renderer.window.set_cursor_visible(true);
                self.stats.swapchain_last_present_result = "detached".to_string();
                self.stats.swapchain_last_present_error.clear();
                event_loop.set_control_flow(ControlFlow::Wait);
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
        let has_offscreen_work = self.renderer.is_some()
            && (!self.scene_layers.is_empty()
                || !self.native_graph_layers.is_empty()
                || !self.pending_native_graph_jobs.is_empty()
                || self.source_preview_dirty
                || self.stage3d_scene.is_some()
                || self.projection_sim_scene.is_some());
        if !self.output_window_attached && !has_offscreen_work {
            event_loop.set_control_flow(ControlFlow::Wait);
            return;
        }
        let next_frame_at = self.last_redraw + frame_duration;
        let now = Instant::now();
        if now >= next_frame_at {
            if self.output_window_attached {
                if let Some(renderer) = self.renderer.as_ref() {
                    renderer.window.request_redraw();
                }
            } else {
                self.render();
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
        source_frame_quality_policy: &str,
        event_proxy: EventLoopProxy<UserEvent>,
    ) -> Result<Self, String> {
        // Pin the backend to the one `native_backend_name()` reports and the
        // shared-texture transports are written against. `Instance::default()`
        // enables Backends::all(), and on Windows wgpu will happily pick Vulkan
        // for an NVIDIA adapter — which makes every `as_hal::<Dx12>()` call
        // (output export, DXGI source import, slice export) return None while
        // the status line still claims `backend=d3d12`.
        let mut instance_descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
        #[cfg(target_os = "windows")]
        {
            instance_descriptor.backends = wgpu::Backends::DX12;
            // Use DXC rather than FXC. wgpu's default `Auto` only reaches DXC if
            // it is statically linked or already discoverable; otherwise it
            // silently falls back to FXC, which spends ~50s compiling the shader
            // warm-up set on every cold start. dxcompiler.dll (and dxil.dll, for
            // shader signing) are copied next to the executable at build time, so
            // the plain filename resolves via the standard DLL search order.
            instance_descriptor.backend_options.dx12.shader_compiler =
                wgpu::Dx12Compiler::default_dynamic_dxc();
        }
        #[cfg(target_os = "macos")]
        {
            instance_descriptor.backends = wgpu::Backends::METAL;
        }
        let instance = wgpu::Instance::new(instance_descriptor);
        let surface = instance
            .create_surface(window)
            .map_err(|err| err.to_string())?;
        // Prefer a real GPU, but never let adapter selection be the difference
        // between "runs slowly" and "does not run at all": the desktop app is
        // native-only, so a failure here leaves it with no renderer whatsoever.
        // The retry asks for the platform's software adapter (WARP on D3D12),
        // which is slow but crucially still the SAME backend — so the
        // shared-texture transports (Spout/Syphon out, source import, slice and
        // deck exports) keep working. Falling back to a different backend would
        // render faster and silently lose every texture-sharing feature, which
        // is the worse outcome for a tool whose job is getting pixels out.
        let adapter = match instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
                apply_limit_buckets: false,
            })
            .await
        {
            Ok(adapter) => adapter,
            Err(primary_err) => {
                eprintln!(
                    "[ghost-core] no hardware adapter for backend {} ({primary_err}); retrying with the software fallback adapter",
                    native_backend_name()
                );
                instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::LowPower,
                        force_fallback_adapter: true,
                        compatible_surface: Some(&surface),
                        apply_limit_buckets: false,
                    })
                    .await
                    .map_err(|fallback_err| {
                        format!(
                            "No compatible GPU found. Ghost Arcade needs a {} capable graphics adapter. \
                             Hardware adapter error: {primary_err}. Software fallback error: {fallback_err}.",
                            native_backend_name().to_uppercase()
                        )
                    })?
            }
        };
        let adapter_info = adapter.get_info();
        let adapter_is_software = adapter_info.device_type == wgpu::DeviceType::Cpu;
        if adapter_is_software {
            eprintln!(
                "[ghost-core] WARNING: running on a SOFTWARE adapter ({}). Expect very low frame rates; this is a compatibility fallback, not a supported configuration.",
                adapter_info.name
            );
        }
        eprintln!(
            "[ghost-core] adapter selected: name={} backend={:?} driver={} reported_backend_name={}",
            adapter_info.name,
            adapter_info.backend,
            adapter_info.driver,
            native_backend_name()
        );
        let adapter_limits = adapter.limits();
        let adapter_features = adapter.features();
        let source_frame_format = choose_source_frame_format(&adapter);
        let source_frame_size = choose_source_frame_size(
            &adapter_limits,
            adapter_features,
            source_frame_format,
            source_frame_quality_policy,
        );
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
        // Boundary contract: render linear internally, then store/publish
        // sRGB-encoded BGRA8 at every app-visible output boundary. Prefer the
        // exact storage format first and fall back only if the platform does
        // not expose it.
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|format| *format == wgpu::TextureFormat::Bgra8Unorm)
            .or_else(|| {
                caps.formats
                    .iter()
                    .copied()
                    .find(|format| !format.is_srgb())
            })
            .unwrap_or(caps.formats[0]);
        let supported_present_modes = caps.present_modes.clone();
        let present_mode =
            choose_present_mode(&supported_present_modes, present_mode, allow_tearing);
        let surface_copy_dst_supported = caps.usages.contains(wgpu::TextureUsages::COPY_DST);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | if surface_copy_dst_supported {
                    wgpu::TextureUsages::COPY_DST
                } else {
                    wgpu::TextureUsages::empty()
                },
            format,
            color_space: wgpu::SurfaceColorSpace::Srgb,
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
                output_gate: 1.0,
                post_count: 0.0,
                post: [[0.0; 4]; 8],
                out0: [0.0, 0.0, 1.0, 1.0],
                out1: [0.0, 1.0, 1.0, 1.0],
                edge: [0.0; 4],
                dome0: [0.0; 4],
                dome1: [0.0; 4],
                dome2: [1.0, 2.2, 0.0, 0.0],
                edge_gamma: [2.2; 4],
                black_level: [0.0; 4],
                swarp: [0.0; 4],
                swarp_c0: [0.0, 0.0, 1.0, 0.0],
                swarp_c1: [1.0, 1.0, 0.0, 1.0],
                mwarp: [0.0; 4],
                mwarp_c0: [0.0, 0.0, 1.0, 0.0],
                mwarp_c1: [1.0, 1.0, 0.0, 1.0],
                swarp_mesh: [[0.0; 4]; 128],
                mwarp_mesh: [[0.0; 4]; 128],
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
        let native_graph_source_frame_sample_texture =
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Ghost Native Graph Source Frame Sample Scratch"),
                size: wgpu::Extent3d {
                    width: source_frame_size as u32,
                    height: source_frame_size as u32,
                    depth_or_array_layers: MAX_SOURCE_FRAME_SLOTS as u32,
                },
                mip_level_count: source_frame_mip_levels,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: source_frame_format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
        let source_frame_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Ghost Render Core Source Frame Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            lod_min_clamp: 0.0,
            lod_max_clamp: 0.0,
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
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let output_export = Self::create_output_export_target(
            &device,
            config.width,
            config.height,
            native_output_export_format(format),
        )
        .map_err(|err| {
            eprintln!("[ghost-core] output export target failed at init: {err}");
            err
        })
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
        let (native_graph_source_depth_texture, native_graph_source_depth_view) =
            Self::create_depth_target(
                &device,
                source_frame_size as u32,
                source_frame_size as u32,
                "Ghost Native Graph Source Depth",
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
            .then(|| {
                GpuTimingState::new(
                    &device,
                    &queue,
                    requested_features.contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
                )
            });
        let gpu_frames_completed = Arc::new(AtomicU64::new(0));
        let (gpu_completion_tx, gpu_completion_rx) = mpsc::channel::<wgpu::SubmissionIndex>();
        let completion_device = device.clone();
        let completion_counter = Arc::clone(&gpu_frames_completed);
        thread::Builder::new()
            .name("ghost-gpu-completion".to_string())
            .spawn(move || {
                while let Ok(submission) = gpu_completion_rx.recv() {
                    let _ = completion_device.poll(wgpu::PollType::Wait {
                        submission_index: Some(submission),
                        timeout: None,
                    });
                    completion_counter.fetch_add(1, Ordering::Release);
                    let _ = event_proxy.send_event(UserEvent::GpuFrameCompleted);
                }
            })
            .map_err(|err| format!("failed to start GPU completion worker: {err}"))?;

        Ok(Self {
            window,
            adapter_name: adapter_info.name,
            adapter_is_software,
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
            native_graph_source_frame_sample_texture,
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
            _native_graph_source_depth_texture: native_graph_source_depth_texture,
            native_graph_source_depth_view,
            native_shader_pipelines: HashMap::new(),
            native_compute_pipelines: HashMap::new(),
            native_graph_render_pipelines: HashMap::new(),
            native_compute_graph_buffers: HashMap::new(),
            output_mirror_texture,
            output_mirror_view,
            surface_copy_dst_supported,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            output_export,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            deck_monitor_targets: None,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            slice_targets: HashMap::new(),
            snapshot_texture,
            snapshot_view,
            snapshot_preview: None,
            last_frame_metrics: None,
            bind_group,
            start_time: Instant::now(),
            gpu_timing,
            gpu_frames_submitted: 0,
            gpu_frames_completed,
            gpu_completion_tx,
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
            format: NATIVE_GRAPH_DEPTH_FORMAT,
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
        use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFType};
        use objc2_io_surface::{
            IOSurfaceRef, kIOSurfaceAllocSize, kIOSurfaceBytesPerElement, kIOSurfaceBytesPerRow,
            kIOSurfaceHeight, kIOSurfaceIsGlobal, kIOSurfacePixelFormat, kIOSurfaceWidth,
        };
        use objc2_metal::{
            MTLDevice, MTLStorageMode, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage,
        };
        use wgpu::hal::{self, api::Metal};

        let width = width.max(1);
        let height = height.max(1);
        let width_value = CFNumber::new_i32(width.min(i32::MAX as u32) as i32);
        let height_value = CFNumber::new_i32(height.min(i32::MAX as u32) as i32);
        let bytes_per_row = align_u64(u64::from(width) * 4, 16);
        let alloc_size = bytes_per_row * u64::from(height);
        let bytes_per_row_value = CFNumber::new_i64(bytes_per_row.min(i64::MAX as u64) as i64);
        let alloc_size_value = CFNumber::new_i64(alloc_size.min(i64::MAX as u64) as i64);
        let bytes_per_element_value = CFNumber::new_i32(4);
        let bgra_fourcc =
            (b'B' as i32) << 24 | (b'G' as i32) << 16 | (b'R' as i32) << 8 | b'A' as i32;
        let pixel_format_value = CFNumber::new_i32(bgra_fourcc);
        let is_global_value = CFBoolean::new(true);
        let keys: [&CFType; 7] = unsafe {
            [
                kIOSurfaceWidth.as_ref(),
                kIOSurfaceHeight.as_ref(),
                kIOSurfaceBytesPerRow.as_ref(),
                kIOSurfaceBytesPerElement.as_ref(),
                kIOSurfaceAllocSize.as_ref(),
                kIOSurfacePixelFormat.as_ref(),
                kIOSurfaceIsGlobal.as_ref(),
            ]
        };
        let values: [&CFType; 7] = [
            width_value.as_ref(),
            height_value.as_ref(),
            bytes_per_row_value.as_ref(),
            bytes_per_element_value.as_ref(),
            alloc_size_value.as_ref(),
            pixel_format_value.as_ref(),
            is_global_value.as_ref(),
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
        texture_descriptor.setStorageMode(iosurface_texture_storage_mode(
            raw_device.raw_device().hasUnifiedMemory(),
        ));
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

    #[cfg(target_os = "windows")]
    fn create_output_export_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Result<NativeOutputExport, String> {
        use wgpu::hal::{self, api::Dx12};
        use windows::Win32::Foundation::GENERIC_ALL;
        use windows::Win32::Graphics::Direct3D12::{
            D3D12_CLEAR_VALUE, D3D12_CLEAR_VALUE_0, D3D12_CPU_PAGE_PROPERTY_UNKNOWN,
            D3D12_HEAP_FLAG_SHARED, D3D12_HEAP_PROPERTIES, D3D12_HEAP_TYPE_DEFAULT,
            D3D12_MEMORY_POOL_UNKNOWN, D3D12_RESOURCE_DESC, D3D12_RESOURCE_DIMENSION_TEXTURE2D,
            D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET, D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS,
            D3D12_RESOURCE_STATE_RENDER_TARGET, D3D12_TEXTURE_LAYOUT_UNKNOWN, ID3D12Resource,
        };
        use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;

        let width = width.max(1);
        let height = height.max(1);
        let shared_name = format!(
            "Local\\GhostArcadeNativeOutput-{}-{}x{}-{}",
            std::process::id(),
            width,
            height,
            epoch_ms()
        );
        let shared_name_wide: Vec<u16> = shared_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let raw_device = unsafe { device.as_hal::<Dx12>() }
            .ok_or_else(|| "native renderer is not running on the D3D12 backend".to_string())?;
        let dxgi_format = dxgi_format_for_wgpu_output(format);
        let heap_properties = D3D12_HEAP_PROPERTIES {
            Type: D3D12_HEAP_TYPE_DEFAULT,
            CPUPageProperty: D3D12_CPU_PAGE_PROPERTY_UNKNOWN,
            MemoryPoolPreference: D3D12_MEMORY_POOL_UNKNOWN,
            CreationNodeMask: 0,
            VisibleNodeMask: 0,
        };
        let resource_desc = D3D12_RESOURCE_DESC {
            Dimension: D3D12_RESOURCE_DIMENSION_TEXTURE2D,
            Alignment: 0,
            Width: width as u64,
            Height: height,
            DepthOrArraySize: 1,
            MipLevels: 1,
            Format: dxgi_format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Layout: D3D12_TEXTURE_LAYOUT_UNKNOWN,
            Flags: D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET
                | D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS,
        };
        let clear_value = D3D12_CLEAR_VALUE {
            Format: dxgi_format,
            Anonymous: D3D12_CLEAR_VALUE_0 { Color: [0.0; 4] },
        };
        let mut raw_resource: Option<ID3D12Resource> = None;
        unsafe {
            raw_device
                .raw_device()
                .CreateCommittedResource(
                    &heap_properties,
                    D3D12_HEAP_FLAG_SHARED,
                    &resource_desc,
                    D3D12_RESOURCE_STATE_RENDER_TARGET,
                    Some(&clear_value),
                    &mut raw_resource,
                )
                .map_err(|err| {
                    format!(
                        "D3D12 failed to create native output shared texture {}x{} format={}: {err}",
                        width,
                        height,
                        texture_format_label(format)
                    )
                })?;
        }
        let raw_resource = raw_resource.ok_or_else(|| {
            format!("D3D12 returned no output export resource for {width}x{height}")
        })?;
        let shared_handle = unsafe {
            raw_device
                .raw_device()
                .CreateSharedHandle(
                    &raw_resource,
                    None,
                    GENERIC_ALL.0,
                    windows::core::PCWSTR::from_raw(shared_name_wide.as_ptr()),
                )
                .map_err(|err| {
                    format!(
                        "D3D12 failed to create native output shared HANDLE {}x{} format={}: {err}",
                        width,
                        height,
                        texture_format_label(format)
                    )
                })?
        };
        let hal_texture = unsafe {
            hal::dx12::Device::texture_from_raw(
                raw_resource,
                format,
                wgpu::TextureDimension::D2,
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                1,
                1,
            )
        };
        let texture = unsafe {
            device.create_texture_from_hal::<Dx12>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("Ghost Render Core Output DXGI Export"),
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
            label: Some("Ghost Render Core Output DXGI Export View"),
            format: Some(format),
            dimension: Some(wgpu::TextureViewDimension::D2),
            ..Default::default()
        });
        let blitter = TextureBlitterBuilder::new(device, format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        Ok(NativeOutputExport {
            shared_handle,
            shared_name,
            texture,
            view,
            blitter,
            width,
            height,
            format,
            frame: 0,
        })
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
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

    /// Lazily (re)create the two deck-monitor targets. Returns false when the
    /// platform cannot export shared textures (monitor presentation is then
    /// simply unavailable — never an error path for the main render).
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn ensure_deck_monitor_targets(&mut self, width: u32, height: u32) -> bool {
        let width = width.clamp(16, 1024);
        let height = height.clamp(16, 1024);
        if let Some(targets) = self.deck_monitor_targets.as_ref() {
            if targets[0].export.width == width && targets[0].export.height == height {
                return true;
            }
        }
        let labels: [&'static str; 2] = [
            "Ghost Deck Monitor A Render Target",
            "Ghost Deck Monitor B Render Target",
        ];
        let mut created: Vec<DeckMonitorTarget> = Vec::with_capacity(2);
        for label in labels {
            let (render_texture, render_view) = Self::create_offscreen_target(
                &self.device,
                width,
                height,
                self.config.format,
                label,
            );
            let export = match Self::create_output_export_target(
                &self.device,
                width,
                height,
                native_output_export_format(self.config.format),
            ) {
                Ok(export) => export,
                Err(err) => {
                    eprintln!("[ghost-core] deck monitor export target failed: {err}");
                    self.deck_monitor_targets = None;
                    return false;
                }
            };
            created.push(DeckMonitorTarget {
                _render_texture: render_texture,
                render_view,
                export,
            });
        }
        let bank_b = created.pop().expect("deck monitor target B");
        let bank_a = created.pop().expect("deck monitor target A");
        self.deck_monitor_targets = Some([bank_a, bank_b]);
        true
    }

    /// Render both deck confidence monitors. Each is one small fullscreen
    /// composite pass over the bank's tagged layers — it samples the same
    /// source frames the program mix uses (no extra source render, decode,
    /// or CPU readback) and blits into the bank's shared-texture export.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[allow(clippy::too_many_arguments)]
    fn render_deck_monitors(
        &mut self,
        command_phase: f32,
        time_seconds: Option<f32>,
        frame_count: u64,
        bank_a: &[LayerGpu],
        bank_b: &[LayerGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        width: u32,
        height: u32,
    ) -> bool {
        if !self.ensure_deck_monitor_targets(width, height) {
            return false;
        }
        for (index, layers) in [bank_a, bank_b].into_iter().enumerate() {
            self.write_frame_inputs(
                command_phase,
                layers.len() as u32,
                time_seconds,
                frame_count,
                layers,
                None,
                audio0,
                audio1,
                audio2,
                // Deck monitors are cue displays, never the live output:
                // blackout must not blank them.
                1.0,
                &[],
                OutputStage::default(),
            );
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Ghost Deck Monitor Encoder"),
                });
            {
                let Some(targets) = self.deck_monitor_targets.as_ref() else {
                    return false;
                };
                let target = &targets[index];
                self.draw_fullscreen_to_view(
                    &mut encoder,
                    &target.render_view,
                    "Ghost Deck Monitor Pass",
                    None,
                );
                target.export.blitter.copy(
                    &self.device,
                    &mut encoder,
                    &target.render_view,
                    &target.export.view,
                );
            }
            self.queue.submit(Some(encoder.finish()));
        }
        if let Some(targets) = self.deck_monitor_targets.as_mut() {
            for target in targets.iter_mut() {
                target.export.frame = target.export.frame.saturating_add(1);
            }
        }
        true
    }

    /// Create (or resize) one slice display's offscreen target and its
    /// shared-texture export.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn ensure_slice_target(&mut self, id: &str, width: u32, height: u32) -> bool {
        if let Some(existing) = self.slice_targets.get(id) {
            if existing.export.width == width && existing.export.height == height {
                return true;
            }
        }
        let (render_texture, render_view) = Self::create_offscreen_target(
            &self.device,
            width,
            height,
            self.config.format,
            "Ghost Slice Output Render Target",
        );
        let export = match Self::create_output_export_target(
            &self.device,
            width,
            height,
            native_output_export_format(self.config.format),
        ) {
            Ok(export) => export,
            Err(err) => {
                eprintln!("[ghost-core] slice output export target failed: {err}");
                self.slice_targets.remove(id);
                return false;
            }
        };
        self.slice_targets.insert(
            id.to_string(),
            SliceOutputTarget {
                _render_texture: render_texture,
                render_view,
                export,
            },
        );
        true
    }

    /// Composite one full frame per slice display. Each pass re-runs the
    /// compositor with that slice's output stage, so the projector gets its
    /// region rendered at the display's own resolution rather than a crop of
    /// a downscaled master — the reason this is a second composite rather
    /// than a blit.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[allow(clippy::too_many_arguments)]
    fn render_slice_outputs(
        &mut self,
        command_phase: f32,
        time_seconds: Option<f32>,
        frame_count: u64,
        layers: &[LayerGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        output_gate: f32,
        post_effects: &[[f32; 4]],
        specs: &[SliceOutputSpec],
    ) {
        // Drop targets for slices the editor has closed so their shared
        // textures (and the VRAM behind them) don't leak across a session.
        let live: std::collections::HashSet<&str> =
            specs.iter().map(|spec| spec.id.as_str()).collect();
        self.slice_targets.retain(|id, _| live.contains(id.as_str()));

        for spec in specs {
            if !self.ensure_slice_target(&spec.id, spec.width, spec.height) {
                continue;
            }
            self.write_frame_inputs(
                command_phase,
                layers.len() as u32,
                time_seconds,
                frame_count,
                layers,
                None,
                audio0,
                audio1,
                audio2,
                output_gate,
                post_effects,
                spec.stage,
            );
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Ghost Slice Output Encoder"),
                });
            {
                let Some(target) = self.slice_targets.get(&spec.id) else {
                    continue;
                };
                self.draw_fullscreen_to_view(
                    &mut encoder,
                    &target.render_view,
                    "Ghost Slice Output Pass",
                    None,
                );
                target.export.blitter.copy(
                    &self.device,
                    &mut encoder,
                    &target.render_view,
                    &target.export.view,
                );
            }
            self.queue.submit(Some(encoder.finish()));
            if let Some(target) = self.slice_targets.get_mut(&spec.id) {
                target.export.frame = target.export.frame.saturating_add(1);
            }
        }
    }

    /// Shared-texture metadata for every live slice display — same shape as
    /// the deck-monitor payload so the electron presenter reuses its import.
    fn slice_output_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            if !self.slice_targets.is_empty() {
                let slices: Vec<Value> = self
                    .slice_targets
                    .iter()
                    .map(|(id, target)| {
                        json!({
                            "id": id,
                            "handle": target.export.surface.id().to_string(),
                            "handle_encoding": "integer",
                            "width": target.export.width,
                            "height": target.export.height,
                            "frame": target.export.frame,
                        })
                    })
                    .collect();
                return json!({
                    "available": true,
                    "platform": "iosurface",
                    "slices": slices,
                });
            }
            return json!({ "available": true, "platform": "iosurface", "slices": [] });
        }
        #[cfg(not(target_os = "macos"))]
        {
            json!({
                "available": false,
                "reason": "native slice presentation is implemented on macOS IOSurface only",
            })
        }
    }

    /// Shared-texture metadata for both deck monitors — same shape the
    /// output export uses so the electron presenter pump can reuse its
    /// import path.
    fn deck_monitor_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            if let Some(targets) = self.deck_monitor_targets.as_ref() {
                let bank = |target: &DeckMonitorTarget, name: &str| {
                    json!({
                        "bank": name,
                        "handle": target.export.surface.id().to_string(),
                        "handle_encoding": "integer",
                        "width": target.export.width,
                        "height": target.export.height,
                        "frame": target.export.frame,
                    })
                };
                return json!({
                    "available": true,
                    "platform": "iosurface",
                    "banks": [bank(&targets[0], "a"), bank(&targets[1], "b")],
                });
            }
        }
        #[cfg(target_os = "windows")]
        {
            if self.deck_monitor_targets.is_some() {
                return json!({
                    "available": false,
                    "reason": "deck monitor shared-texture presentation is not yet implemented on DXGI",
                });
            }
        }
        json!({ "available": false })
    }

    fn poll_gpu_timing(&mut self) {
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(gpu_timing) = self.gpu_timing.as_mut() {
            gpu_timing.poll_readback();
        }
    }

    fn gpu_frames_completed(&self) -> u64 {
        self.gpu_frames_completed.load(Ordering::Acquire)
    }

    fn frame_in_flight(&self) -> bool {
        self.gpu_frames_submitted > self.gpu_frames_completed()
    }

    fn submit_frame(&mut self, encoder: wgpu::CommandEncoder) {
        let submission = self.queue.submit(Some(encoder.finish()));
        self.gpu_frames_submitted = self.gpu_frames_submitted.saturating_add(1);
        let _ = self.gpu_completion_tx.send(submission);
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
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.output_export.is_some()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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
                    "handle_scope": "global-id",
                    "preferred_transport": "handle",
                    "handle_byte_length": 4,
                    "width": export.width,
                    "height": export.height,
                    "format": texture_format_label(export.format),
                    "color_space": "srgb",
                    "storage_format": "bgra8unorm",
                    "storage_encoding": "srgb-encoded-bgra8unorm",
                    "alpha_mode": "opaque",
                    "premultiplied_alpha": false,
                    "single_render_source": "core-output-composite",
                    "zero_conversions": true,
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(export) = self.output_export.as_ref() {
                return json!({
                    "available": true,
                    "platform": "dxgi",
                    "handle": (export.shared_handle.0 as usize).to_string(),
                    "handle_encoding": "integer",
                    "handle_scope": "process-local",
                    "preferred_transport": "shared_name",
                    "handle_byte_length": 8,
                    "name": export.shared_name.clone(),
                    "shared_name": export.shared_name.clone(),
                    "width": export.width,
                    "height": export.height,
                    "format": texture_format_label(export.format),
                    "color_space": "srgb",
                    "storage_format": "bgra8unorm",
                    "storage_encoding": "srgb-encoded-bgra8unorm",
                    "alpha_mode": "opaque",
                    "premultiplied_alpha": false,
                    "single_render_source": "core-output-composite",
                    "zero_conversions": true,
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        json!({
            "available": false,
            "platform": if cfg!(target_os = "macos") { "iosurface" } else if cfg!(target_os = "windows") { "dxgi" } else { "unsupported" },
            "reason": if cfg!(target_os = "macos") {
                "native output IOSurface export target is unavailable"
            } else if cfg!(target_os = "windows") {
                "native output DXGI export target is unavailable"
            } else {
                "native output shared texture export is pending for this backend"
            },
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
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.output_export = Self::create_output_export_target(
                &self.device,
                self.config.width,
                self.config.height,
                native_output_export_format(self.config.format),
            )
            .map_err(|err| {
                eprintln!("[ghost-core] output export target failed on resize: {err}");
                err
            })
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
        source_kind: NativeShaderSourceKind,
        source: &str,
        fragment_entry: &str,
    ) -> Result<(), String> {
        if self.native_shader_pipelines.contains_key(cache_key) {
            return Ok(());
        }
        let error_scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader_source = match source_kind {
            NativeShaderSourceKind::Wgsl => wgpu::ShaderSource::Wgsl(source.into()),
            NativeShaderSourceKind::IsfGlsl | NativeShaderSourceKind::Glsl => {
                wgpu::ShaderSource::Glsl {
                    shader: source.into(),
                    stage: naga::ShaderStage::Fragment,
                    defines: &[],
                }
            }
        };
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Shader Fragment"),
                source: shader_source,
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
            // Name the pipeline: "validation error" without the cache key made
            // binding-layout mismatches undebuggable from the app logs.
            return Err(format!("native compute pipeline `{cache_key}`: {err}"));
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
            bytes_b64: None,
        })
    }

    fn run_native_compute_graph(
        &mut self,
        buffers: Vec<NativeComputeGraphBufferSpec>,
        passes: Vec<NativeComputeGraphPassPlan>,
        readbacks: Vec<NativeComputeGraphReadbackSpec>,
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
        for readback in &readbacks {
            let Some(buffer) = self.compute_graph_buffer(&transient_buffers, &readback.id) else {
                return Err(format!(
                    "native compute graph readback missing buffer `{}`",
                    readback.id
                ));
            };
            let readback_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!(
                    "Ghost Native Compute Graph Readback {}",
                    readback.id
                )),
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
            readback_buffers.push((readback.clone(), readback_buffer, buffer.byte_length));
        }

        self.queue.submit(Some(encoder.finish()));

        let mut readback_json = serde_json::Map::new();
        for (readback, readback_buffer, byte_length) in readback_buffers {
            let probe =
                self.readback_u32_buffer(&readback_buffer, byte_length, readback.include_bytes)?;
            let mut value = json!({
                "byte_length": probe.byte_length,
                "checksum": format!("{:016x}", probe.checksum),
                "nonzero_words": probe.nonzero_words,
                "first_words": probe.first_words,
            });
            if let Some(bytes_b64) = probe.bytes_b64 {
                if let Some(object) = value.as_object_mut() {
                    object.insert("bytes_b64".to_string(), Value::String(bytes_b64));
                }
            }
            readback_json.insert(readback.id, value);
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

    fn render_native_graph_frame_jobs(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        jobs: &[NativeGraphFrameJob],
    ) -> Result<(), String> {
        for job in jobs {
            let mut transient_buffers = HashMap::<String, NativeComputeGraphGpuBuffer>::new();
            for spec in &job.buffers {
                if spec.persistent {
                    self.upsert_native_compute_graph_buffer(spec)?;
                } else {
                    transient_buffers.insert(
                        spec.id.clone(),
                        self.create_native_compute_graph_buffer(spec),
                    );
                }
            }
            for pass_plan in &job.pass_plans {
                self.encode_native_compute_graph_pass(encoder, &transient_buffers, pass_plan)?;
            }
            for render_plan in &job.render_plans {
                self.render_native_compute_graph(encoder, &transient_buffers, render_plan)?;
            }
        }
        Ok(())
    }

    fn encode_native_compute_graph_pass(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        transient_buffers: &HashMap<String, NativeComputeGraphGpuBuffer>,
        pass_plan: &NativeComputeGraphPassPlan,
    ) -> Result<Value, String> {
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
            transient_buffers,
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
        Ok(json!({
            "name": pass_plan.name,
            "entry": pass_plan.entry,
            "dispatch": pass_plan.dispatch,
        }))
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
        let use_source_frame_sample_texture = self.prepare_source_frame_sample_for_render(
            encoder,
            render_plan,
            source_slot.is_some(),
        );
        let mut texture_views = Vec::new();
        let entries = self.compute_graph_bind_group_entries(
            transient_buffers,
            &render_plan.bindings,
            &format!("render `{}`", render_plan.name),
            &mut texture_views,
            use_source_frame_sample_texture
                .then_some(&self.native_graph_source_frame_sample_texture),
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
        let transient_depth_texture;
        let transient_depth_view;
        let depth_stencil_attachment = if render_plan.depth_enabled {
            let depth_view = if source_slot.is_some()
                && target_width == self.source_frame_size as u32
                && target_height == self.source_frame_size as u32
            {
                &self.native_graph_source_depth_view
            } else {
                transient_depth_texture = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Ghost Native Compute Graph Transient Depth Texture"),
                    size: wgpu::Extent3d {
                        width: target_width,
                        height: target_height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: NATIVE_GRAPH_DEPTH_FORMAT,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                });
                transient_depth_view =
                    transient_depth_texture.create_view(&wgpu::TextureViewDescriptor {
                        label: Some("Ghost Native Compute Graph Transient Depth View"),
                        ..Default::default()
                    });
                &transient_depth_view
            };
            Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth_view,
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
        if let Some(slot) = source_slot.filter(|_| render_plan.generate_mips) {
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
            "generate_mips": render_plan.generate_mips,
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

    fn prepare_source_frame_sample_for_render(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        render_plan: &NativeComputeGraphRenderPlan,
        targets_source_frame: bool,
    ) -> bool {
        if !targets_source_frame
            || !render_plan.bindings.iter().any(|binding| {
                matches!(
                    binding.kind,
                    NativeComputeGraphBindingKind::SourceFrameTexture(_)
                )
            })
        {
            return false;
        }

        let copy_all_slots = render_plan.bindings.iter().any(|binding| {
            matches!(
                binding.kind,
                NativeComputeGraphBindingKind::SourceFrameTexture(
                    NativeComputeGraphTextureDimension::D2Array
                )
            )
        });
        let mut slots = render_plan
            .bindings
            .iter()
            .filter_map(|binding| match binding.kind {
                NativeComputeGraphBindingKind::SourceFrameTexture(
                    NativeComputeGraphTextureDimension::D2,
                ) => Some(
                    binding
                        .source_slot
                        .unwrap_or(0)
                        .min(MAX_SOURCE_FRAME_SLOTS - 1),
                ),
                _ => None,
            })
            .collect::<Vec<_>>();
        if copy_all_slots {
            slots = (0..MAX_SOURCE_FRAME_SLOTS).collect();
        } else {
            slots.sort_unstable();
            slots.dedup();
        }
        for mip_level in 0..self.source_frame_mip_levels {
            let width = ((self.source_frame_size as u32) >> mip_level).max(1);
            let height = ((self.source_frame_size as u32) >> mip_level).max(1);
            for slot in slots.iter().copied() {
                let origin = wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: slot as u32,
                };
                encoder.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &self.source_frame_texture,
                        mip_level,
                        origin,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyTextureInfo {
                        texture: &self.native_graph_source_frame_sample_texture,
                        mip_level,
                        origin,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                );
            }
        }
        true
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
                source: wgpu::ShaderSource::Wgsl(render_plan.source.as_ref().into()),
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
                        format: NATIVE_GRAPH_DEPTH_FORMAT,
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

    fn native_compute_graph_buffer_bytes(&self) -> u64 {
        self.native_compute_graph_buffers
            .values()
            .map(|buffer| buffer.byte_length)
            .fold(0u64, u64::saturating_add)
    }

    fn prune_native_compute_graph_buffers_to_budget(&mut self, max_bytes: u64) -> (usize, u64) {
        let mut current_bytes = self.native_compute_graph_buffer_bytes();
        if current_bytes <= max_bytes {
            return (0, 0);
        }
        let mut entries = self
            .native_compute_graph_buffers
            .iter()
            .map(|(id, buffer)| (id.clone(), buffer.byte_length))
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.0.cmp(&right.0));

        let mut evicted = 0usize;
        let mut evicted_bytes = 0u64;
        for (id, byte_length) in entries {
            if current_bytes <= max_bytes {
                break;
            }
            if self.native_compute_graph_buffers.remove(&id).is_some() {
                evicted = evicted.saturating_add(1);
                evicted_bytes = evicted_bytes.saturating_add(byte_length);
                current_bytes = current_bytes.saturating_sub(byte_length);
            }
        }
        (evicted, evicted_bytes)
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
        include_bytes: bool,
    ) -> Result<ComputeProbeResult, String> {
        if include_bytes && byte_length > COMPUTE_READBACK_BYTES_MAX {
            return Err(format!(
                "compute graph readback bytes request is too large: {byte_length} > {COMPUTE_READBACK_BYTES_MAX}"
            ));
        }
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
        let bytes_b64 = if include_bytes {
            Some(base64::engine::general_purpose::STANDARD.encode(mapped.as_ref()))
        } else {
            None
        };
        drop(mapped);
        readback_buffer.unmap();
        Ok(ComputeProbeResult {
            byte_length,
            checksum,
            nonzero_words,
            first_words,
            bytes_b64,
        })
    }

    fn render_native_wgsl_shader_frame(
        &mut self,
        slot: usize,
        cache_key: &str,
        source_kind: NativeShaderSourceKind,
        source: &str,
        fragment_entry: &str,
        uniforms: &NativeShaderUniforms,
        image_input_slots: &[usize],
    ) -> Result<(), String> {
        self.ensure_native_shader_pipeline(cache_key, source_kind, source, fragment_entry)?;
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
        // The shader samples the SHADOW input array (it renders into the real
        // one, so it cannot read it). Refresh the layer's own input slot plus
        // every bound ISF image-input slot — anything not copied here samples
        // stale/black shadow content.
        let mut copy_slots = vec![input_slot];
        for slot in image_input_slots {
            let slot = (*slot).min(MAX_SOURCE_FRAME_SLOTS - 1) as u32;
            if !copy_slots.contains(&slot) {
                copy_slots.push(slot);
            }
        }
        for copy_slot in copy_slots {
            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.source_frame_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: copy_slot,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: &self.native_shader_input_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: copy_slot,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d {
                    width: self.source_frame_size as u32,
                    height: self.source_frame_size as u32,
                    depth_or_array_layers: 1,
                },
            );
        }
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

    fn write_source_frame_level_zero(&self, slot: usize, rgba: &[u8]) -> Option<usize> {
        if rgba.len() < self.source_frame_size * self.source_frame_size * 4 {
            return None;
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
        Some(safe_slot)
    }

    fn write_video_source_frame(
        &self,
        slot: usize,
        rgba: &[u8],
        width: usize,
        height: usize,
        origin_x: usize,
        origin_y: usize,
    ) -> Option<usize> {
        // Video frames are replaced every display tick. Generating a complete
        // mip chain per source per tick creates one command submission for
        // every active video and serializes the render loop. Upload the
        // decoder-sized image directly into its source rectangle as well:
        // resizing video on the render thread stalls every active session.
        if width == 0
            || height == 0
            || origin_x.saturating_add(width) > self.source_frame_size
            || origin_y.saturating_add(height) > self.source_frame_size
            || rgba.len() < width.saturating_mul(height).saturating_mul(4)
        {
            return None;
        }
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        let (payload, bytes_per_row) =
            source_frame_upload_payload_dimensions(rgba, width, height, self.source_frame_format);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.source_frame_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: origin_x as u32,
                    y: origin_y as u32,
                    z: safe_slot as u32,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &payload,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(height as u32),
            },
            wgpu::Extent3d {
                width: width as u32,
                height: height as u32,
                depth_or_array_layers: 1,
            },
        );
        Some(payload.len())
    }

    fn write_source_frame(&self, slot: usize, rgba: &[u8]) {
        let Some(safe_slot) = self.write_source_frame_level_zero(slot, rgba) else {
            return;
        };
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
        #[cfg(target_os = "windows")]
        {
            self.import_dxgi_source_frame(slot, descriptor)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = slot;
            match descriptor.platform.as_str() {
                "dxgi" => {
                    let _handle = descriptor.dxgi_shared_handle()?;
                    let wgpu_format = descriptor.wgpu_texture_format();
                    Err(format!(
                        "DXGI shared texture source-frame upload received a valid HANDLE for format={} mapped_format={} size={}x{}, but D3D11/D3D12 import is pending for backend={}",
                        descriptor.format,
                        texture_format_label(wgpu_format),
                        descriptor.width,
                        descriptor.height,
                        native_backend_name()
                    ))
                }
                "iosurface" => Err(format!(
                    "IOSurface source-frame import is only available in macOS Metal builds; {}",
                    descriptor.unsupported_reason(native_backend_name())
                )),
                _ => Err(descriptor.unsupported_reason(native_backend_name())),
            }
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
        let wgpu_format = descriptor.wgpu_texture_format();
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
        texture_descriptor.setStorageMode(iosurface_texture_storage_mode(
            raw_device.raw_device().hasUnifiedMemory(),
        ));
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

    #[cfg(target_os = "windows")]
    fn import_dxgi_source_frame(
        &self,
        slot: usize,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        use wgpu::hal::{self, api::Dx12};
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Graphics::Direct3D12::ID3D12Resource;

        if descriptor.platform != "dxgi" {
            return Err(format!(
                "shared texture platform `{}` is not supported by the D3D12 importer",
                descriptor.platform
            ));
        }

        let shared_handle = descriptor.dxgi_shared_handle()?;
        if shared_handle == 0 {
            return Err("DXGI shared texture HANDLE was zero".to_string());
        }

        let width = descriptor.width.max(1);
        let height = descriptor.height.max(1);
        let wgpu_format = descriptor.wgpu_texture_format();
        let raw_device = unsafe { self.device.as_hal::<Dx12>() }
            .ok_or_else(|| "native renderer is not running on the D3D12 backend".to_string())?;
        let mut raw_resource: Option<ID3D12Resource> = None;
        let os_handle = HANDLE(shared_handle as *mut core::ffi::c_void);
        let open_result = unsafe {
            raw_device
                .raw_device()
                .OpenSharedHandle(os_handle, &mut raw_resource)
        };
        if descriptor.close_handle_after_import {
            let _ = unsafe { CloseHandle(os_handle) };
        }
        open_result.map_err(|err| {
            format!(
                "D3D12 OpenSharedHandle failed for HANDLE=0x{shared_handle:x} format={} mapped_format={} size={}x{}: {err}",
                descriptor.format,
                texture_format_label(wgpu_format),
                width,
                height
            )
        })?;
        let raw_resource = raw_resource.ok_or_else(|| {
            format!(
                "D3D12 OpenSharedHandle returned no ID3D12Resource for HANDLE=0x{shared_handle:x}"
            )
        })?;
        let hal_texture = unsafe {
            hal::dx12::Device::texture_from_raw(
                raw_resource,
                wgpu_format,
                wgpu::TextureDimension::D2,
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                1,
                1,
            )
        };
        let imported_texture = unsafe {
            self.device.create_texture_from_hal::<Dx12>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("Ghost Render Core Imported DXGI Source Frame"),
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
        self.copy_imported_source_texture(slot, &imported_texture, descriptor)
    }

    #[cfg(target_os = "windows")]
    fn copy_imported_source_texture(
        &self,
        slot: usize,
        imported_texture: &wgpu::Texture,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        let wgpu_format = descriptor.wgpu_texture_format();
        let source_view = imported_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Imported Shared Source View"),
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

    /// Snapshot readback downscaled so the longest edge is `max_dim`.
    /// GPU-side blit before readback: a 1080p frame at max_dim=512 reads
    /// back ~590KB instead of ~8MB, which is what makes a continuous
    /// composite mirror affordable over the JSON transport.
    fn read_frame_snapshot_scaled(&mut self, max_dim: u32) -> Result<FrameSnapshotReadback, String> {
        let out_w = self.config.width.max(1);
        let out_h = self.config.height.max(1);
        if max_dim == 0 || (out_w <= max_dim && out_h <= max_dim) {
            return self.read_frame_snapshot();
        }
        let scale = max_dim as f32 / out_w.max(out_h) as f32;
        let w = ((out_w as f32 * scale).round() as u32).clamp(16, out_w);
        let h = ((out_h as f32 * scale).round() as u32).clamp(16, out_h);
        let needs_new = !matches!(&self.snapshot_preview, Some((_, _, pw, ph)) if *pw == w && *ph == h);
        if needs_new {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Ghost Snapshot Preview Target"),
                size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.config.format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let blitter = TextureBlitterBuilder::new(&self.device, self.config.format).build();
            self.snapshot_preview = Some((texture, blitter, w, h));
        }
        {
            let (texture, blitter, _, _) = self.snapshot_preview.as_ref().expect("snapshot preview just ensured");
            let src_view = self.snapshot_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let dst_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Snapshot Preview Blit"),
            });
            blitter.copy(&self.device, &mut encoder, &src_view, &dst_view);
            self.queue.submit(Some(encoder.finish()));
        }
        let (texture, _, w, h) = self.snapshot_preview.as_ref().expect("snapshot preview present");
        read_texture_to_frame(
            &self.device,
            &self.queue,
            texture,
            self.config.format,
            *w,
            *h,
            "Ghost Snapshot Preview",
        )
    }

    fn read_frame_snapshot(&mut self) -> Result<FrameSnapshotReadback, String> {
        let readback = read_texture_to_frame(
            &self.device,
            &self.queue,
            &self.snapshot_texture,
            self.config.format,
            self.config.width.max(1),
            self.config.height.max(1),
            "Ghost Render Core Snapshot",
        )?;
        self.last_frame_metrics = Some(readback.metrics.clone());
        Ok(readback)
    }

    /// Read the ALREADY-RENDERED output export texture (the frame the
    /// presenter/Syphon are showing) without re-compositing the scene —
    /// the cheap capture path for live recording.
    fn read_output_export_frame(&mut self) -> Result<FrameSnapshotReadback, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let Some(export) = self.output_export.as_ref() else {
                return Err(
                    "native output shared-texture export target is unavailable".to_string(),
                );
            };
            let readback = read_texture_to_frame(
                &self.device,
                &self.queue,
                &export.texture,
                export.format,
                export.width.max(1),
                export.height.max(1),
                "Ghost Render Core Output Export Frame",
            )?;
            self.last_frame_metrics = Some(readback.metrics.clone());
            return Ok(readback);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("output export capture is not available on this platform".to_string())
        }
    }

    fn frame_snapshot(&mut self, include_pixels: bool) -> Result<Value, String> {
        self.frame_snapshot_scaled(include_pixels, 0)
    }

    fn frame_snapshot_scaled(&mut self, include_pixels: bool, max_dim: u32) -> Result<Value, String> {
        let readback = self.read_frame_snapshot_scaled(max_dim)?;
        Ok(readback.to_json(include_pixels))
    }

    fn output_export_snapshot(&mut self, include_pixels: bool) -> Result<Value, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let Some(export) = self.output_export.as_ref() else {
                return Err("native output shared-texture export target is unavailable".to_string());
            };
            let mut value = read_texture_to_frame(
                &self.device,
                &self.queue,
                &export.texture,
                export.format,
                export.width.max(1),
                export.height.max(1),
                "Ghost Render Core Output Export",
            )?
            .to_json(include_pixels);
            if let Some(object) = value.as_object_mut() {
                object.insert("source".to_string(), json!("output-shared-texture-export"));
                object.insert("color_space".to_string(), json!("srgb"));
                object.insert("storage_format".to_string(), json!("bgra8unorm"));
                object.insert(
                    "storage_encoding".to_string(),
                    json!("srgb-encoded-bgra8unorm"),
                );
                object.insert("alpha_mode".to_string(), json!("opaque"));
                object.insert("premultiplied_alpha".to_string(), json!(false));
                object.insert(
                    "single_render_source".to_string(),
                    json!("core-output-composite"),
                );
                object.insert("zero_conversions".to_string(), json!(true));
                object.insert("export_frame".to_string(), json!(export.frame));
            }
            Ok(value)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = include_pixels;
            Err("native output shared-texture export is pending for this backend".to_string())
        }
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
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) {
        let uniforms = Uniforms {
            resolution: [self.config.width as f32, self.config.height as f32],
            time: time_seconds.unwrap_or_else(|| self.start_time.elapsed().as_secs_f32()),
            command_phase,
            layer_count: layers_seen as f32,
            frame_count: frame_count as f32,
            output_gate,
            post_count: post_effects.len().min(8) as f32,
            audio0,
            audio1,
            audio2,
            out0: stage.out0,
            out1: stage.out1,
            edge: stage.edge,
            dome0: stage.dome0,
            dome1: stage.dome1,
            dome2: stage.dome2,
            edge_gamma: stage.edge_gamma,
            black_level: stage.black_level,
            swarp: stage.swarp,
            swarp_c0: stage.swarp_c0,
            swarp_c1: stage.swarp_c1,
            mwarp: stage.mwarp,
            mwarp_c0: stage.mwarp_c0,
            mwarp_c1: stage.mwarp_c1,
            swarp_mesh: stage.swarp_mesh,
            mwarp_mesh: stage.mwarp_mesh,
            post: {
                let mut slots = [[0.0f32; 4]; 8];
                for (slot, value) in slots.iter_mut().zip(post_effects.iter().take(8)) {
                    *slot = *value;
                }
                slots
            },
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
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
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
            output_gate,
            post_effects,
            stage,
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
        native_graph_jobs: &[NativeGraphFrameJob],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        present_surface: bool,
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) -> Result<SurfacePresentOutcome, String> {
        let mut present_outcome = SurfacePresentOutcome::Offscreen;
        let surface_frame = if present_surface {
            match self.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(frame) => {
                    present_outcome = SurfacePresentOutcome::Presented;
                    Some(frame)
                }
                wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                    self.surface.configure(&self.device, &self.config);
                    present_outcome = SurfacePresentOutcome::SuboptimalPresented;
                    Some(frame)
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
            }
        } else {
            None
        };
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
            output_gate,
            post_effects,
            stage,
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
        let record_full_frame_timing = should_record_timing
            && self
                .gpu_timing
                .as_ref()
                .is_some_and(|timing| timing.inside_encoders);
        if record_full_frame_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                mirror_encoder.write_timestamp(&gpu_timing.query_set, 0);
            }
        }
        self.render_native_graph_frame_jobs(&mut mirror_encoder, native_graph_jobs)?;
        let mirror_timestamp_writes = if should_record_timing && !record_full_frame_timing {
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
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.refresh_output_export(&mut mirror_encoder);
        if let Some(frame) = surface_frame.as_ref() {
            if self.surface_copy_dst_supported {
                mirror_encoder.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &self.output_mirror_texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyTextureInfo {
                        texture: &frame.texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::Extent3d {
                        width: self.config.width,
                        height: self.config.height,
                        depth_or_array_layers: 1,
                    },
                );
            } else {
                let view = frame
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());
                self.draw_fullscreen_to_view(
                    &mut mirror_encoder,
                    &view,
                    "Ghost Render Core Swapchain Fallback Pass",
                    None,
                );
            }
        }
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                if record_full_frame_timing {
                    mirror_encoder.write_timestamp(&gpu_timing.query_set, 1);
                }
                gpu_timing.resolve_to_readback(&mut mirror_encoder);
            }
        }
        self.submit_frame(mirror_encoder);
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_mut() {
                gpu_timing.begin_readback();
            }
        }
        if let Some(frame) = surface_frame {
            self.queue.present(frame);
        }
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
        let result = if job.exact_preview {
            decode_native_video_frame_exact_rgba(&job.path, job.width, job.height, job.time_seconds)
                .map(|(width, height, rgba)| {
                    vec![NativeVideoFrameDecodeOutput {
                        width,
                        height,
                        frame_bucket: job.frame_bucket,
                        signature: job.signature.clone(),
                        rgba,
                    }]
                })
        } else {
            decode_native_video_frame_window_rgba(
                &job.path,
                job.width,
                job.height,
                job.time_seconds,
                NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS,
                NATIVE_VIDEO_DECODE_PUMP_WINDOW_FRAMES.saturating_add(1),
            )
        };
        let _ = proxy.send_event(UserEvent::NativeVideoFrameDecoded(
            NativeVideoFrameDecodeResult {
                source_id: job.source_id,
                uri: job.uri,
                frame_bucket: job.frame_bucket,
                signature: job.signature,
                seq: job.seq,
                pending_key: job.pending_key,
                exact_preview: job.exact_preview,
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

fn command_has_key(value: &Value, key: &str) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.contains_key(key))
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

fn default_native_isf_params() -> [f32; MAX_NATIVE_ISF_PARAM_FLOATS] {
    let mut params = [0.0; MAX_NATIVE_ISF_PARAM_FLOATS];
    params[..8].copy_from_slice(&default_native_params());
    params
}

fn native_graph_buffer_safe_id(value: &str) -> String {
    let mut out = String::with_capacity(value.len().min(160));
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == ':' || ch == '_' || ch == '-' {
            out.push(ch);
        } else {
            out.push('_');
        }
        if out.len() >= 160 {
            break;
        }
    }
    if out.is_empty() {
        "source".to_string()
    } else {
        out
    }
}

fn native_graph_param_f32(params: &Value, key: &str, min: f32, max: f32, fallback: f32) -> f32 {
    params
        .get(key)
        .and_then(Value::as_f64)
        .map(|value| value.clamp(min as f64, max as f64) as f32)
        .unwrap_or(fallback)
}

fn native_graph_param_rgb(params: &Value, key: &str, fallback: [f32; 3]) -> [f32; 3] {
    color_path_or(params, &[key]).unwrap_or(fallback)
}

fn native_planet_id(params: &Value) -> u32 {
    match params
        .get("planet")
        .and_then(Value::as_str)
        .unwrap_or("earth")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "mars" => 1,
        "jupiter" => 2,
        "saturn" => 3,
        _ => 0,
    }
}

fn write_f32_le(bytes: &mut [u8], index: usize, value: f32) {
    let offset = index.saturating_mul(4);
    if offset + 4 <= bytes.len() {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
}

fn write_u32_le(bytes: &mut [u8], index: usize, value: u32) {
    let offset = index.saturating_mul(4);
    if offset + 4 <= bytes.len() {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
}

fn build_planet_native_uniform_bytes(
    params: &Value,
    state: &NativePlanetGraphState,
    width: u32,
    height: u32,
    time: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 176];
    write_f32_le(&mut bytes, 0, width.max(1) as f32);
    write_f32_le(&mut bytes, 1, height.max(1) as f32);
    write_f32_le(&mut bytes, 2, time.max(0.0));
    write_u32_le(&mut bytes, 3, native_planet_id(params));
    write_f32_le(
        &mut bytes,
        4,
        native_graph_param_f32(params, "cameraDistance", 0.01, 128.0, 4.0),
    );
    write_f32_le(
        &mut bytes,
        5,
        native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
    );
    write_f32_le(
        &mut bytes,
        6,
        native_graph_param_f32(params, "cameraYaw", -3600.0, 3600.0, 0.0),
    );
    write_f32_le(
        &mut bytes,
        7,
        native_graph_param_f32(params, "cameraPitch", -3600.0, 3600.0, 0.0),
    );
    write_f32_le(
        &mut bytes,
        8,
        native_graph_param_f32(params, "rotationOffset", -3600.0, 3600.0, 0.0),
    );
    write_f32_le(&mut bytes, 9, state.accum_rotation);
    write_f32_le(
        &mut bytes,
        10,
        native_graph_param_f32(params, "sunYaw", -3600.0, 3600.0, -45.0),
    );
    write_f32_le(
        &mut bytes,
        11,
        native_graph_param_f32(params, "sunPitch", -3600.0, 3600.0, 15.0),
    );
    write_f32_le(
        &mut bytes,
        12,
        native_graph_param_f32(params, "cloudCoverage", 0.0, 4.0, 0.65),
    );
    write_f32_le(&mut bytes, 13, state.cloud_phase);
    write_f32_le(
        &mut bytes,
        14,
        native_graph_param_f32(params, "atmosphereHeight", 0.0, 4.0, 0.06),
    );
    write_f32_le(
        &mut bytes,
        15,
        native_graph_param_f32(params, "auroraStrength", 0.0, 8.0, 0.8),
    );
    write_f32_le(
        &mut bytes,
        16,
        native_graph_param_f32(params, "starDensity", 0.0, 8.0, 1.0),
    );
    write_f32_le(
        &mut bytes,
        17,
        native_graph_param_f32(params, "ringInner", 0.001, 16.0, 1.25),
    );
    write_f32_le(
        &mut bytes,
        18,
        native_graph_param_f32(params, "ringOuter", 0.001, 32.0, 2.3),
    );
    write_f32_le(
        &mut bytes,
        19,
        native_graph_param_f32(params, "ringOpacity", 0.0, 4.0, 0.95),
    );
    let cloud = native_graph_param_rgb(params, "cloudColor", [1.0, 1.0, 1.0]);
    write_f32_le(&mut bytes, 20, cloud[0]);
    write_f32_le(&mut bytes, 21, cloud[1]);
    write_f32_le(&mut bytes, 22, cloud[2]);
    write_f32_le(
        &mut bytes,
        23,
        native_graph_param_f32(params, "sunBrightness", 0.0, 16.0, 1.0),
    );
    write_f32_le(
        &mut bytes,
        24,
        native_graph_param_f32(params, "planetX", -32.0, 32.0, 0.0),
    );
    write_f32_le(
        &mut bytes,
        25,
        native_graph_param_f32(params, "planetY", -32.0, 32.0, 0.0),
    );
    write_f32_le(
        &mut bytes,
        26,
        native_graph_param_f32(params, "ringDetail", 0.0, 16.0, 1.0),
    );
    write_f32_le(
        &mut bytes,
        28,
        native_graph_param_f32(params, "emission", 0.0, 16.0, 0.35),
    );
    write_f32_le(
        &mut bytes,
        29,
        native_graph_param_f32(params, "outerGlow", 0.0, 16.0, 0.0),
    );
    let land = native_graph_param_rgb(
        params,
        "landColor",
        [110.0 / 255.0, 175.0 / 255.0, 70.0 / 255.0],
    );
    write_f32_le(&mut bytes, 32, land[0]);
    write_f32_le(&mut bytes, 33, land[1]);
    write_f32_le(&mut bytes, 34, land[2]);
    write_f32_le(
        &mut bytes,
        35,
        native_graph_param_f32(params, "shorelineIntensity", 0.0, 32.0, 1.6),
    );
    let shore = native_graph_param_rgb(
        params,
        "shorelineColor",
        [60.0 / 255.0, 230.0 / 255.0, 220.0 / 255.0],
    );
    write_f32_le(&mut bytes, 36, shore[0]);
    write_f32_le(&mut bytes, 37, shore[1]);
    write_f32_le(&mut bytes, 38, shore[2]);
    write_f32_le(
        &mut bytes,
        39,
        native_graph_param_f32(params, "shorelineWidth", 0.0, 4.0, 0.04),
    );
    write_f32_le(
        &mut bytes,
        40,
        native_graph_param_f32(params, "cloudThickness", 0.0, 16.0, 1.8),
    );
    bytes
}

const PARTICLE_FIELD_PARTICLE_BYTES: u64 = 64;
const PARTICLE_FIELD_EDGE_BYTES: u64 = 16;
const PARTICLE_FIELD_MAX_EDGES: u32 = 600_000;

#[derive(Clone, Debug)]
struct NativeParticleFieldParams {
    mode_id: u32,
    mode_label: String,
    particle_count: u32,
    base_size: f32,
    opacity: f32,
    wind_strength: f32,
    wind_scale: f32,
    anchor_pull: f32,
    damping: f32,
    bass: f32,
    treble: f32,
    shimmer_strength: f32,
    burst_gain: f32,
    burst_decay: f32,
    galaxy_arms: u32,
    galaxy_rotate_inner: f32,
    galaxy_rotate_outer: f32,
    galaxy_tilt: f32,
    atomic_nuclei: u32,
    atomic_shells: u32,
    atomic_shell_spacing: f32,
    atomic_orbit_speed: f32,
    swarm_cohesion: f32,
    swarm_separation: f32,
    swarm_alignment: f32,
    swarm_range: f32,
    lattice_size: u32,
    lattice_spacing: f32,
    lattice_vibration: f32,
    media_depth_amount: f32,
    media_sample_scale: f32,
    gravity_wells: u32,
    gravity_strength: f32,
    gravity_orbit: f32,
    gravity_core_size: f32,
    gravity_vortex: f32,
    gravity_max_velocity: f32,
    gravity_audio_drive: f32,
    gravity_chaos: f32,
    topology_id: u32,
    stroke_length: f32,
    stroke_width: f32,
    color_mode_id: u32,
    color_map_id: u32,
    color_mix: f32,
    color_map_scale: f32,
    color_map_offset: f32,
    color_cycle_speed: f32,
    random_sat: f32,
    random_val: f32,
    hue_shift_speed: f32,
    saturation: f32,
    brightness: f32,
    color_a: [f32; 3],
    color_b: [f32; 3],
    color_c: [f32; 3],
    color_d: [f32; 3],
    connect_enabled: bool,
    partner_count: u32,
    local_radius: f32,
    bridge_radius: f32,
    color_local: [f32; 3],
    color_bridge: [f32; 3],
    alpha_local: f32,
    alpha_bridge: f32,
    fog_density: f32,
    fog_opacity: f32,
    fog_color: [f32; 3],
    light: [f32; 3],
    light_strength: f32,
    material_ambient: f32,
    material_diffuse: f32,
    material_specular: f32,
    material_shininess: f32,
    material_reflection: f32,
    fov_deg: f32,
    camera_z: f32,
    rotate: [f32; 3],
    auto_rotate: [f32; 3],
}

fn native_particle_field_enum(params: &Value, key: &str, fallback: &str) -> String {
    params
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .trim()
        .to_ascii_lowercase()
}

fn normalize_particle_field_native_params(params: &Value) -> NativeParticleFieldParams {
    let mode_label = native_particle_field_enum(params, "mode", "galaxy");
    let mode_id = match mode_label.as_str() {
        "atomic" => 1,
        "swarm" => 2,
        "lattice" => 3,
        "field" => 4,
        "media" => 5,
        "gravity" => 6,
        _ => 0,
    };
    let topology_id = match native_particle_field_enum(params, "topology", "glow").as_str() {
        "points" => 0,
        "streaks" => 2,
        "sphere" => 3,
        "softsphere" | "soft-sphere" => 4,
        _ => 1,
    };
    let color_mode_id = match native_particle_field_enum(params, "colorMode", "palette4").as_str() {
        "solid" => 0,
        "gradient2" => 1,
        "gradient3" => 2,
        "rainbow" => 4,
        "random" => 5,
        "group" => 6,
        _ => 3,
    };
    let color_map_id = match native_particle_field_enum(params, "colorMap", "radial").as_str() {
        "index" => 0,
        "group" => 1,
        "y-axis" => 3,
        "speed" => 4,
        "depth-z" => 5,
        "noise" => 6,
        _ => 2,
    };
    NativeParticleFieldParams {
        mode_id,
        mode_label,
        particle_count: native_graph_param_u32(params, "particleCount", 1_024, 500_000, 80_000),
        base_size: native_graph_param_f32(params, "baseSize", 0.0001, 0.2, 0.006),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 4.0, 1.0),
        wind_strength: native_graph_param_f32(params, "windStrength", -8.0, 8.0, 0.2),
        wind_scale: native_graph_param_f32(params, "windScale", 0.001, 64.0, 2.0),
        anchor_pull: native_graph_param_f32(params, "anchorPull", -8.0, 8.0, 0.0),
        damping: native_graph_param_f32(params, "damping", 0.0, 16.0, 1.0),
        bass: native_graph_param_f32(params, "bass", 0.0, 4.0, 0.0),
        treble: native_graph_param_f32(params, "treble", 0.0, 4.0, 0.0),
        shimmer_strength: native_graph_param_f32(params, "shimmerStrength", 0.0, 4.0, 0.02),
        burst_gain: native_graph_param_f32(params, "burstGain", 0.0, 16.0, 0.6),
        burst_decay: native_graph_param_f32(params, "burstDecay", 0.0, 24.0, 2.5),
        galaxy_arms: native_graph_param_u32(params, "galaxyArms", 1, 16, 4),
        galaxy_rotate_inner: native_graph_param_f32(params, "galaxyRotateInner", -16.0, 16.0, 1.2),
        galaxy_rotate_outer: native_graph_param_f32(params, "galaxyRotateOuter", -16.0, 16.0, 0.3),
        galaxy_tilt: native_graph_param_f32(params, "galaxyTilt", -4.0, 4.0, 0.1),
        atomic_nuclei: native_graph_param_u32(params, "atomicNuclei", 1, 32, 5),
        atomic_shells: native_graph_param_u32(params, "atomicShells", 1, 16, 3),
        atomic_shell_spacing: native_graph_param_f32(
            params,
            "atomicShellSpacing",
            0.001,
            4.0,
            0.18,
        ),
        atomic_orbit_speed: native_graph_param_f32(params, "atomicOrbitSpeed", -16.0, 16.0, 0.8),
        swarm_cohesion: native_graph_param_f32(params, "swarmCohesion", -8.0, 8.0, 0.6),
        swarm_separation: native_graph_param_f32(params, "swarmSeparation", -8.0, 8.0, 0.05),
        swarm_alignment: native_graph_param_f32(params, "swarmAlignment", -8.0, 8.0, 0.8),
        swarm_range: native_graph_param_f32(params, "swarmRange", 0.001, 32.0, 1.5),
        lattice_size: native_graph_param_u32(params, "latticeSize", 2, 128, 16),
        lattice_spacing: native_graph_param_f32(params, "latticeSpacing", 0.001, 8.0, 1.6),
        lattice_vibration: native_graph_param_f32(params, "latticeVibration", 0.0, 4.0, 0.015),
        media_depth_amount: native_graph_param_f32(params, "mediaDepthAmount", -8.0, 8.0, 0.6),
        media_sample_scale: native_graph_param_f32(params, "mediaSampleScale", 0.001, 16.0, 1.0),
        gravity_wells: native_graph_param_u32(params, "gravityWells", 1, 8, 4),
        gravity_strength: native_graph_param_f32(params, "gravityStrength", -8.0, 8.0, 0.18),
        gravity_orbit: native_graph_param_f32(params, "gravityOrbit", -16.0, 16.0, 0.45),
        gravity_core_size: native_graph_param_f32(params, "gravityCoreSize", 0.001, 4.0, 0.09),
        gravity_vortex: native_graph_param_f32(params, "gravityVortex", -16.0, 16.0, 0.34),
        gravity_max_velocity: native_graph_param_f32(
            params,
            "gravityMaxVelocity",
            0.001,
            64.0,
            5.0,
        ),
        gravity_audio_drive: native_graph_param_f32(params, "gravityAudioDrive", 0.0, 16.0, 1.15),
        gravity_chaos: native_graph_param_f32(params, "gravityChaos", 0.0, 16.0, 0.18),
        topology_id,
        stroke_length: native_graph_param_f32(params, "strokeLength", 0.0, 4.0, 0.04),
        stroke_width: native_graph_param_f32(params, "strokeWidth", 0.0, 2.0, 0.004),
        color_mode_id,
        color_map_id,
        color_mix: native_graph_param_f32(params, "colorMix", 0.0, 1.0, 1.0),
        color_map_scale: native_graph_param_f32(params, "colorMapScale", -16.0, 16.0, 1.0),
        color_map_offset: native_graph_param_f32(params, "colorMapOffset", -16.0, 16.0, 0.0),
        color_cycle_speed: native_graph_param_f32(params, "colorCycleSpeed", -16.0, 16.0, 0.05),
        random_sat: native_graph_param_f32(params, "randomSat", 0.0, 2.0, 0.85),
        random_val: native_graph_param_f32(params, "randomVal", 0.0, 4.0, 1.0),
        hue_shift_speed: native_graph_param_f32(params, "hueShiftSpeed", -16.0, 16.0, 0.02),
        saturation: native_graph_param_f32(params, "saturation", 0.0, 4.0, 1.1),
        brightness: native_graph_param_f32(params, "brightness", 0.0, 8.0, 1.1),
        color_a: native_graph_param_rgb(params, "colorA", [0.18, 0.42, 1.0]),
        color_b: native_graph_param_rgb(params, "colorB", [0.95, 0.28, 0.65]),
        color_c: native_graph_param_rgb(params, "colorC", [1.0, 0.78, 0.2]),
        color_d: native_graph_param_rgb(params, "colorD", [0.2, 0.95, 0.85]),
        connect_enabled: native_graph_param_bool(params, "connectEnabled", true),
        partner_count: native_graph_param_u32(params, "partnerCount", 1, 32, 12),
        local_radius: native_graph_param_f32(params, "localRadius", 0.0, 8.0, 0.12),
        bridge_radius: native_graph_param_f32(params, "bridgeRadius", 0.0, 8.0, 0.4),
        color_local: native_graph_param_rgb(params, "colorLocal", [0.4, 1.0, 1.0]),
        color_bridge: native_graph_param_rgb(params, "colorBridge", [0.95, 0.3, 0.8]),
        alpha_local: native_graph_param_f32(params, "alphaLocal", 0.0, 1.0, 0.35),
        alpha_bridge: native_graph_param_f32(params, "alphaBridge", 0.0, 1.0, 0.12),
        fog_density: native_graph_param_f32(params, "fogDensity", 0.0, 16.0, 0.6),
        fog_opacity: native_graph_param_f32(params, "fogOpacity", 0.0, 1.0, 0.85),
        fog_color: native_graph_param_rgb(params, "fogColor", [0.02, 0.02, 0.06]),
        light: [
            native_graph_param_f32(params, "lightX", -8.0, 8.0, 0.4),
            native_graph_param_f32(params, "lightY", -8.0, 8.0, 0.6),
            native_graph_param_f32(params, "lightZ", -8.0, 8.0, 0.7),
        ],
        light_strength: native_graph_param_f32(params, "lightStrength", 0.0, 8.0, 0.6),
        material_ambient: native_graph_param_f32(params, "materialAmbient", 0.0, 4.0, 0.34),
        material_diffuse: native_graph_param_f32(params, "materialDiffuse", 0.0, 4.0, 0.92),
        material_specular: native_graph_param_f32(params, "materialSpecular", 0.0, 4.0, 0.58),
        material_shininess: native_graph_param_f32(params, "materialShininess", 1.0, 256.0, 56.0),
        material_reflection: native_graph_param_f32(params, "materialReflection", 0.0, 4.0, 0.18),
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.05, 100.0, 2.4),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate: [
            native_graph_param_f32(params, "autoRotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "autoRotateY", -3600.0, 3600.0, 6.0),
            native_graph_param_f32(params, "autoRotateZ", -3600.0, 3600.0, 0.0),
        ],
    }
}

fn particle_field_rand(seed: u32) -> f32 {
    let mut x = seed;
    x ^= x.wrapping_shl(13);
    x ^= x.wrapping_shr(17);
    x ^= x.wrapping_shl(5);
    (x as f64 / 4_294_967_296.0) as f32
}

fn build_particle_field_initial_bytes(params: &NativeParticleFieldParams) -> Vec<u8> {
    let count = params.particle_count.max(1_024);
    let mut bytes = vec![0_u8; count as usize * PARTICLE_FIELD_PARTICLE_BYTES as usize];
    for i in 0..count {
        let base = i as usize * 16;
        let r0 = particle_field_rand(i.wrapping_mul(747_796_405).wrapping_add(2_891_336_453));
        let r1 = particle_field_rand(i.wrapping_mul(2_891_336_453).wrapping_add(747_796_405));
        let r2 = particle_field_rand(i.wrapping_mul(1_597_334_677).wrapping_add(3_812_015_801));
        let r3 = particle_field_rand(i.wrapping_mul(3_812_015_801).wrapping_add(1_597_334_677));
        let (x, y, z, group, radius_var) = match params.mode_id {
            0 => {
                let group = i % params.galaxy_arms.max(1);
                let arm_phase = group as f32 / params.galaxy_arms.max(1) as f32;
                let radius = r0.sqrt() * 0.95;
                let theta = arm_phase * std::f32::consts::TAU + radius * 3.0 + (r1 - 0.5) * 0.4;
                (
                    theta.cos() * radius,
                    (r2 - 0.5) * 0.04 * (1.0 - radius),
                    theta.sin() * radius,
                    group,
                    0.72 + r3.powf(1.8) * 1.35,
                )
            }
            1 => {
                let nuclei = params.atomic_nuclei.max(1);
                let shells = params.atomic_shells.max(1);
                let nucleus = i % nuclei;
                let shell = (i / nuclei) % shells;
                let nucleus_t = nucleus as f32 / nuclei as f32 * std::f32::consts::TAU;
                let radius = (shell + 1) as f32 * params.atomic_shell_spacing;
                let phase = r0 * std::f32::consts::TAU;
                (
                    nucleus_t.cos() * 0.5 + phase.cos() * radius,
                    (r1 - 0.5) * radius * 0.5,
                    nucleus_t.sin() * 0.5 + phase.sin() * radius * 0.6,
                    nucleus + shell * nuclei,
                    0.72 + r3.powf(1.8) * 1.35,
                )
            }
            3 => {
                let size = params.lattice_size.max(2);
                let ix = i % size;
                let iy = (i / size) % size;
                let iz = (i / (size * size)) % size;
                (
                    ((ix as f32 / size as f32) - 0.5) * params.lattice_spacing,
                    ((iy as f32 / size as f32) - 0.5) * params.lattice_spacing,
                    ((iz as f32 / size as f32) - 0.5) * params.lattice_spacing,
                    i,
                    0.72 + r3.powf(1.8) * 1.35,
                )
            }
            6 => {
                let wells = params.gravity_wells.clamp(1, 8);
                let group = i % wells;
                let phase = group as f32 / wells as f32 * std::f32::consts::TAU;
                let shell = r0.powf(0.55) * 0.9 + 0.08;
                let theta = r1 * std::f32::consts::TAU;
                let phi = (r2 * 2.0 - 1.0).acos();
                let radius_var = if i % 233 == 0 {
                    4.2 + r3 * 2.4
                } else {
                    0.36 + r3.powf(2.35) * 2.8
                };
                (
                    phase.cos() * 0.45 + phi.sin() * theta.cos() * shell,
                    (r3 - 0.5) * 0.75 + phi.cos() * shell * 0.35,
                    phase.sin() * 0.45 + phi.sin() * theta.sin() * shell,
                    group,
                    radius_var,
                )
            }
            _ => {
                let theta = r0 * std::f32::consts::TAU;
                let phi = (r1 * 2.0 - 1.0).acos();
                let radius = r2.cbrt();
                (
                    phi.sin() * theta.cos() * radius,
                    phi.cos() * radius,
                    phi.sin() * theta.sin() * radius,
                    i & 15,
                    0.72 + r3.powf(1.8) * 1.35,
                )
            }
        };
        write_f32_le(&mut bytes, base, x);
        write_f32_le(&mut bytes, base + 1, y);
        write_f32_le(&mut bytes, base + 2, z);
        write_f32_le(&mut bytes, base + 3, 1.0);
        write_f32_le(&mut bytes, base + 7, params.base_size);
        write_f32_le(&mut bytes, base + 8, 0.6);
        write_f32_le(&mut bytes, base + 9, 0.7);
        write_f32_le(&mut bytes, base + 10, 0.95);
        write_f32_le(&mut bytes, base + 11, radius_var);
        write_u32_le(&mut bytes, base + 12, group);
    }
    bytes
}

fn build_particle_field_behavior_uniform_bytes(
    params: &NativeParticleFieldParams,
    state: &NativeParticleFieldGraphState,
    dt: f32,
    time: f32,
    bass: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 384];
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_u32_le(&mut bytes, 2, params.particle_count);
    write_f32_le(&mut bytes, 3, params.base_size);
    write_u32_le(&mut bytes, 4, params.mode_id);
    write_u32_le(&mut bytes, 5, params.topology_id);
    write_u32_le(&mut bytes, 6, u32::from(params.connect_enabled));
    write_f32_le(&mut bytes, 8, params.wind_strength);
    write_f32_le(&mut bytes, 9, params.wind_scale);
    write_f32_le(&mut bytes, 10, params.anchor_pull);
    write_f32_le(&mut bytes, 11, params.damping);
    write_f32_le(&mut bytes, 12, bass);
    write_f32_le(&mut bytes, 13, treble);
    write_f32_le(&mut bytes, 14, state.burst_impulse);
    write_f32_le(&mut bytes, 15, params.shimmer_strength);
    write_f32_le(&mut bytes, 16, params.galaxy_arms as f32);
    write_f32_le(&mut bytes, 17, params.galaxy_rotate_inner);
    write_f32_le(&mut bytes, 18, params.galaxy_rotate_outer);
    write_f32_le(&mut bytes, 19, params.galaxy_tilt);
    write_f32_le(&mut bytes, 20, params.atomic_nuclei as f32);
    write_f32_le(&mut bytes, 21, params.atomic_shells as f32);
    write_f32_le(&mut bytes, 22, params.atomic_shell_spacing);
    write_f32_le(&mut bytes, 23, params.atomic_orbit_speed);
    write_f32_le(&mut bytes, 24, params.swarm_cohesion);
    write_f32_le(&mut bytes, 25, params.swarm_separation);
    write_f32_le(&mut bytes, 26, params.swarm_alignment);
    write_f32_le(&mut bytes, 27, params.swarm_range);
    write_f32_le(&mut bytes, 28, params.lattice_size as f32);
    write_f32_le(&mut bytes, 29, params.lattice_spacing);
    write_f32_le(&mut bytes, 30, params.lattice_vibration);
    write_f32_le(&mut bytes, 32, params.media_depth_amount);
    write_f32_le(&mut bytes, 33, params.media_sample_scale);
    write_f32_le(&mut bytes, 36, params.fog_density);
    write_f32_le(&mut bytes, 37, params.light[0]);
    write_f32_le(&mut bytes, 38, params.light[1]);
    write_f32_le(&mut bytes, 39, params.light[2]);
    write_f32_le(&mut bytes, 40, params.saturation);
    write_f32_le(&mut bytes, 41, params.brightness);
    write_u32_le(&mut bytes, 42, params.color_mode_id);
    write_u32_le(&mut bytes, 43, params.color_map_id);
    write_f32_le(&mut bytes, 44, params.color_mix);
    write_f32_le(&mut bytes, 45, params.color_map_scale);
    write_f32_le(&mut bytes, 46, params.color_map_offset);
    write_f32_le(&mut bytes, 47, state.color_cycle_phase);
    write_f32_le(&mut bytes, 48, params.random_sat);
    write_f32_le(&mut bytes, 49, params.random_val);
    write_f32_le(&mut bytes, 50, state.hue_shift_phase);
    for (offset, color) in [
        (52, params.color_a),
        (56, params.color_b),
        (60, params.color_c),
        (64, params.color_d),
    ] {
        write_f32_le(&mut bytes, offset, color[0]);
        write_f32_le(&mut bytes, offset + 1, color[1]);
        write_f32_le(&mut bytes, offset + 2, color[2]);
    }
    write_f32_le(&mut bytes, 68, params.gravity_wells as f32);
    write_f32_le(&mut bytes, 69, params.gravity_strength);
    write_f32_le(&mut bytes, 70, params.gravity_orbit);
    write_f32_le(&mut bytes, 71, params.gravity_core_size);
    write_f32_le(&mut bytes, 72, params.gravity_vortex);
    write_f32_le(&mut bytes, 73, params.gravity_max_velocity);
    write_f32_le(&mut bytes, 74, params.gravity_audio_drive);
    write_f32_le(&mut bytes, 75, params.gravity_chaos);
    bytes
}

fn particle_field_view_proj(
    params: &NativeParticleFieldParams,
    state: &NativeParticleFieldGraphState,
    width: u32,
    height: u32,
) -> [f32; 16] {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let proj = native_perspective(params.fov_deg, aspect, 0.05, 100.0);
    let view = native_translate(0.0, 0.0, -params.camera_z);
    let model = native_mat4_mul(
        native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
        native_mat4_mul(
            native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
        ),
    );
    native_mat4_mul(proj, native_mat4_mul(view, model))
}

fn build_particle_field_render_uniform_bytes(
    params: &NativeParticleFieldParams,
    state: &NativeParticleFieldGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 192];
    for (index, value) in particle_field_view_proj(params, state, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, 1.0);
    write_f32_le(&mut bytes, 21, 1.0);
    write_f32_le(&mut bytes, 26, params.camera_z);
    write_u32_le(&mut bytes, 27, params.topology_id);
    write_f32_le(&mut bytes, 28, params.stroke_length);
    write_f32_le(&mut bytes, 29, params.stroke_width);
    write_f32_le(&mut bytes, 30, params.opacity);
    for index in 0..3 {
        write_f32_le(&mut bytes, 32 + index, params.fog_color[index]);
    }
    write_f32_le(&mut bytes, 35, params.fog_density);
    let len = (params.light[0] * params.light[0]
        + params.light[1] * params.light[1]
        + params.light[2] * params.light[2])
        .sqrt()
        .max(0.0001);
    for index in 0..3 {
        write_f32_le(&mut bytes, 36 + index, params.light[index] / len);
    }
    write_f32_le(&mut bytes, 39, params.light_strength);
    write_f32_le(&mut bytes, 40, params.material_ambient);
    write_f32_le(&mut bytes, 41, params.material_diffuse);
    write_f32_le(&mut bytes, 42, params.material_specular);
    write_f32_le(&mut bytes, 43, params.material_shininess);
    write_f32_le(&mut bytes, 44, params.material_reflection);
    bytes
}

fn build_particle_field_fog_uniform_bytes(params: &NativeParticleFieldParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; 16];
    for index in 0..3 {
        write_f32_le(&mut bytes, index, params.fog_color[index]);
    }
    write_f32_le(&mut bytes, 3, params.fog_opacity);
    bytes
}

fn build_particle_field_line_uniform_bytes(
    params: &NativeParticleFieldParams,
    state: &NativeParticleFieldGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 160];
    for (index, value) in particle_field_view_proj(params, state, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 18, params.camera_z);
    for index in 0..3 {
        write_f32_le(&mut bytes, 20 + index, params.color_local[index]);
    }
    write_f32_le(&mut bytes, 23, params.alpha_local);
    for index in 0..3 {
        write_f32_le(&mut bytes, 24 + index, params.color_bridge[index]);
    }
    write_f32_le(&mut bytes, 27, params.alpha_bridge);
    for index in 0..3 {
        write_f32_le(&mut bytes, 28 + index, params.fog_color[index]);
    }
    write_f32_le(&mut bytes, 31, params.fog_density);
    bytes
}

const PIXEL_PARTICLES_PARTICLE_BYTES: u64 = 32;
const PIXEL_PARTICLES_MAX: u32 = 1_000_000;

#[derive(Clone, Debug)]
struct NativePixelParticlesParams {
    particle_count: u32,
    mode_id: u32,
    knobs: [f32; 4],
    base_size: f32,
    opacity: f32,
    anchor_jitter: f32,
    fov_deg: f32,
    camera_z: f32,
    camera_yaw: f32,
    camera_pitch: f32,
    pan_x: f32,
    pan_y: f32,
    light_enabled: bool,
    light: [f32; 3],
    light_intensity: f32,
    light_ambient: f32,
    light_height_strength: f32,
    noise_amp_xy: f32,
    noise_amp_z: f32,
    noise_freq: f32,
    noise_speed: f32,
    depth_source_id: u32,
    depth_curve: f32,
    depth_contrast: f32,
    depth_smoothing: f32,
    depth_center: f32,
    depth_motion_id: u32,
    depth_motion_amount: f32,
    depth_motion_speed: f32,
    depth_motion_scale: f32,
    depth_motion_coupling: f32,
    depth_motion_phase: f32,
    mirror_x: bool,
}

fn normalize_pixel_particles_native_params(params: &Value) -> NativePixelParticlesParams {
    let mode = native_particle_field_enum(params, "mode", "depth-shift");
    let mode_id = match mode.as_str() {
        "identity" => 0,
        "sand-fall" => 2,
        "scatter" => 3,
        "halftone" => 4,
        "stipple-noise" => 5,
        "dissolve" => 6,
        _ => 1,
    };
    let knobs = match mode_id {
        1 => [
            native_graph_param_f32(params, "depthAmount", 0.0, 8.0, 0.6),
            0.0,
            native_graph_param_f32(params, "depthSpinSpeed", -16.0, 16.0, 0.0),
            native_graph_param_f32(params, "depthSpinAxis", 0.0, 1.0, 0.0),
        ],
        2 => [
            native_graph_param_f32(params, "sandFallSpeed", 0.001, 16.0, 0.4),
            native_graph_param_f32(params, "sandFloorY", -16.0, 16.0, -1.0),
            native_graph_param_f32(params, "sandDrift", 0.0, 8.0, 0.02),
            native_graph_param_f32(params, "sandDensity", 0.0, 1.0, 1.0),
        ],
        3 => [
            native_graph_param_f32(params, "scatterAmp", 0.0, 8.0, 0.04),
            native_graph_param_f32(params, "scatterRecovery", 0.0, 16.0, 1.5),
            native_graph_param_f32(params, "scatterFreq", 0.001, 128.0, 4.0),
            0.0,
        ],
        4 => [
            native_graph_param_f32(params, "halftoneCellSize", 0.0001, 1.0, 0.012),
            1.0,
            0.0,
            0.0,
        ],
        5 => [
            native_graph_param_f32(params, "stippleAmp", 0.0, 8.0, 0.008),
            native_graph_param_f32(params, "stippleFreq", 0.001, 256.0, 35.0),
            0.0,
            0.0,
        ],
        6 => [
            native_graph_param_f32(params, "dissolveSpread", 0.0, 16.0, 1.6),
            native_graph_param_f32(params, "dissolveSpeed", 0.001, 16.0, 0.6),
            native_graph_param_f32(params, "dissolveSwirl", -16.0, 16.0, 0.5),
            0.0,
        ],
        _ => [0.0; 4],
    };
    let depth_source_id =
        match native_particle_field_enum(params, "depthSource", "luminance").as_str() {
            "inverse-luminance" => 1,
            "edge-density" => 2,
            "saturation" => 3,
            "native-depth" => 4,
            _ => 0,
        };
    let depth_motion_id = match native_particle_field_enum(params, "depthMotion", "locked").as_str()
    {
        "drift" => 1,
        "orbit" => 2,
        "ripple" => 3,
        "swarm" => 4,
        "breathe" => 5,
        _ => 0,
    };
    NativePixelParticlesParams {
        particle_count: native_graph_param_u32(
            params,
            "particleCount",
            1_024,
            PIXEL_PARTICLES_MAX,
            250_000,
        ),
        mode_id,
        knobs,
        base_size: native_graph_param_f32(params, "baseSize", 0.0005, 0.05, 0.005),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 1.0, 1.0),
        anchor_jitter: native_graph_param_f32(params, "anchorJitter", 0.0, 1.0, 0.6),
        fov_deg: native_graph_param_f32(params, "fovDeg", 10.0, 120.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.5, 10.0, 2.2),
        camera_yaw: native_graph_param_f32(params, "cameraYaw", -3600.0, 3600.0, 0.0),
        camera_pitch: native_graph_param_f32(params, "cameraPitch", -3600.0, 3600.0, 0.0),
        pan_x: native_graph_param_f32(params, "panX", -16.0, 16.0, 0.0),
        pan_y: native_graph_param_f32(params, "panY", -16.0, 16.0, 0.0),
        light_enabled: params
            .get("lightEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        light: [
            native_graph_param_f32(params, "lightX", -16.0, 16.0, 1.0),
            native_graph_param_f32(params, "lightY", -16.0, 16.0, 1.0),
            native_graph_param_f32(params, "lightZ", -16.0, 16.0, 1.5),
        ],
        light_intensity: native_graph_param_f32(params, "lightIntensity", 0.0, 16.0, 1.5),
        light_ambient: native_graph_param_f32(params, "lightAmbient", 0.0, 4.0, 0.25),
        light_height_strength: native_graph_param_f32(
            params,
            "lightHeightStrength",
            0.0,
            16.0,
            1.5,
        ),
        noise_amp_xy: native_graph_param_f32(params, "noiseAmpXY", 0.0, 8.0, 0.0),
        noise_amp_z: native_graph_param_f32(params, "noiseAmpZ", 0.0, 16.0, 0.0),
        noise_freq: native_graph_param_f32(params, "noiseFreq", 0.001, 128.0, 4.0),
        noise_speed: native_graph_param_f32(params, "noiseSpeed", 0.0, 16.0, 0.5),
        depth_source_id: if depth_source_id == 4 {
            0
        } else {
            depth_source_id
        },
        depth_curve: native_graph_param_f32(params, "depthCurve", 0.05, 4.0, 1.0),
        depth_contrast: native_graph_param_f32(params, "depthContrast", 0.01, 4.0, 1.0),
        depth_smoothing: native_graph_param_f32(params, "depthSmoothing", 0.0, 1.0, 0.2),
        depth_center: native_graph_param_f32(params, "depthCenter", 0.0, 1.0, 0.5),
        depth_motion_id,
        depth_motion_amount: native_graph_param_f32(params, "depthMotionAmount", 0.0, 2.0, 0.08),
        depth_motion_speed: native_graph_param_f32(params, "depthMotionSpeed", 0.0, 4.0, 0.45),
        depth_motion_scale: native_graph_param_f32(params, "depthMotionScale", 0.1, 24.0, 3.5),
        depth_motion_coupling: native_graph_param_f32(params, "depthMotionCoupling", 0.0, 3.0, 0.7),
        depth_motion_phase: native_graph_param_f32(
            params,
            "depthMotionPhase",
            -100_000.0,
            100_000.0,
            0.0,
        ),
        mirror_x: params
            .get("mirrorX")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

fn build_pixel_particles_initial_bytes(count: u32) -> Vec<u8> {
    let mut bytes = vec![0_u8; count as usize * PIXEL_PARTICLES_PARTICLE_BYTES as usize];
    for index in 0..count as usize {
        write_f32_le(&mut bytes, index * 8 + 7, 1.0);
    }
    bytes
}

fn pixel_particles_view_proj(
    params: &NativePixelParticlesParams,
    width: u32,
    height: u32,
) -> [f32; 16] {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let near = 0.1;
    let far = 100.0;
    let f = 1.0 / (params.fov_deg.to_radians() * 0.5).tan();
    let mut proj = [0.0_f32; 16];
    proj[0] = f / aspect.max(0.0001);
    proj[5] = f;
    proj[10] = (far + near) / (near - far);
    proj[11] = -1.0;
    proj[14] = (2.0 * far * near) / (near - far);
    let yaw = params.camera_yaw.to_radians();
    let pitch = params.camera_pitch.to_radians();
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = pitch.sin_cos();
    let rot_y = [
        cy, 0.0, sy, 0.0, 0.0, 1.0, 0.0, 0.0, -sy, 0.0, cy, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let rot_x = [
        1.0, 0.0, 0.0, 0.0, 0.0, cp, sp, 0.0, 0.0, -sp, cp, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let trans = native_translate(params.pan_x, params.pan_y, -params.camera_z);
    native_mat4_mul(proj, native_mat4_mul(trans, native_mat4_mul(rot_x, rot_y)))
}

fn build_pixel_particles_globals_bytes(
    params: &NativePixelParticlesParams,
    time: f32,
    dt: f32,
    width: u32,
    height: u32,
    source_frame_size: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 176];
    write_f32_le(&mut bytes, 0, time);
    write_f32_le(&mut bytes, 1, dt);
    write_u32_le(&mut bytes, 2, params.particle_count);
    write_u32_le(&mut bytes, 3, params.mode_id);
    for (index, value) in params.knobs.iter().enumerate() {
        write_f32_le(&mut bytes, 4 + index, *value);
    }
    write_f32_le(&mut bytes, 8, source_frame_size);
    write_f32_le(&mut bytes, 9, source_frame_size);
    write_f32_le(&mut bytes, 10, params.anchor_jitter);
    write_f32_le(&mut bytes, 11, if params.light_enabled { 1.0 } else { 0.0 });
    for index in 0..3 {
        write_f32_le(&mut bytes, 12 + index, params.light[index]);
    }
    write_f32_le(&mut bytes, 15, params.light_intensity);
    write_f32_le(&mut bytes, 16, params.light_ambient);
    write_f32_le(&mut bytes, 17, params.light_height_strength);
    write_f32_le(&mut bytes, 20, params.noise_amp_xy);
    write_f32_le(&mut bytes, 21, params.noise_amp_z);
    write_f32_le(&mut bytes, 22, params.noise_freq);
    write_f32_le(&mut bytes, 23, params.noise_speed);
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let view_y = (params.fov_deg.to_radians() * 0.5).tan() * params.camera_z;
    write_f32_le(&mut bytes, 24, if params.mirror_x { 1.0 } else { 0.0 });
    write_f32_le(&mut bytes, 25, aspect);
    write_f32_le(&mut bytes, 26, view_y * aspect);
    write_f32_le(&mut bytes, 27, view_y);
    write_f32_le(&mut bytes, 28, params.depth_source_id as f32);
    write_f32_le(&mut bytes, 29, params.depth_curve);
    write_f32_le(&mut bytes, 30, params.depth_contrast);
    write_f32_le(&mut bytes, 31, params.depth_smoothing);
    write_f32_le(&mut bytes, 32, params.depth_motion_id as f32);
    write_f32_le(&mut bytes, 33, params.depth_motion_amount);
    write_f32_le(&mut bytes, 34, params.depth_motion_speed);
    write_f32_le(&mut bytes, 35, params.depth_motion_scale);
    write_f32_le(&mut bytes, 36, params.depth_center);
    write_f32_le(&mut bytes, 37, params.depth_motion_coupling);
    write_f32_le(&mut bytes, 38, params.depth_motion_phase);
    write_f32_le(&mut bytes, 42, 1.0);
    bytes
}

fn build_pixel_particles_render_bytes(
    params: &NativePixelParticlesParams,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 96];
    for (index, value) in pixel_particles_view_proj(params, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, width.max(1) as f32 / height.max(1) as f32);
    write_f32_le(&mut bytes, 17, params.base_size);
    write_f32_le(&mut bytes, 18, params.mode_id as f32);
    write_f32_le(&mut bytes, 19, params.opacity);
    write_f32_le(&mut bytes, 20, if params.mirror_x { 1.0 } else { 0.0 });
    write_f32_le(&mut bytes, 21, params.particle_count as f32);
    write_f32_le(&mut bytes, 22, params.anchor_jitter);
    bytes
}

const FLYTHROUGH_PARTICLE_BYTES: u64 = 48;
const FLYTHROUGH_MAX_PARTICLES: u32 = 1_000_000;

#[derive(Clone, Debug)]
struct NativeFlythroughParams {
    topology_id: u32,
    depth_source_id: u32,
    fly_speed: f32,
    tunnel_depth: f32,
    slab_count: u32,
    flow_strength: f32,
    flow_scale: f32,
    anchor_pull: f32,
    stroke_length: f32,
    stroke_width: f32,
    depth_strength: f32,
    base_size: f32,
    opacity: f32,
    fov_deg: f32,
    camera_yaw: f32,
    camera_pitch: f32,
    particle_count: u32,
    audio_reactive: bool,
}

fn normalize_flythrough_native_params(params: &Value) -> NativeFlythroughParams {
    NativeFlythroughParams {
        topology_id: if native_particle_field_enum(params, "topology", "strokes") == "points" {
            0
        } else {
            1
        },
        depth_source_id: match native_particle_field_enum(params, "depthSource", "luminance")
            .as_str()
        {
            "inverse-luminance" => 1,
            "edge-density" => 2,
            _ => 0,
        },
        fly_speed: native_graph_param_f32(params, "flySpeed", -16.0, 16.0, 0.8),
        tunnel_depth: native_graph_param_f32(params, "tunnelDepth", 0.05, 64.0, 2.0),
        slab_count: native_graph_param_u32(params, "slabCount", 1, 8, 4),
        flow_strength: native_graph_param_f32(params, "flowStrength", 0.0, 16.0, 0.4),
        flow_scale: native_graph_param_f32(params, "flowScale", 0.001, 64.0, 2.0),
        anchor_pull: native_graph_param_f32(params, "anchorPull", 0.0, 16.0, 1.2),
        stroke_length: native_graph_param_f32(params, "strokeLength", 0.0, 8.0, 0.08),
        stroke_width: native_graph_param_f32(params, "strokeWidth", 0.0001, 4.0, 0.006),
        depth_strength: native_graph_param_f32(params, "depthStrength", -8.0, 8.0, 0.5),
        base_size: native_graph_param_f32(params, "baseSize", 0.0001, 2.0, 0.005),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 4.0, 1.0),
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
        camera_yaw: native_graph_param_f32(params, "cameraYaw", -3600.0, 3600.0, 0.0),
        camera_pitch: native_graph_param_f32(params, "cameraPitch", -3600.0, 3600.0, 0.0),
        particle_count: native_graph_param_u32(
            params,
            "particleCount",
            1_024,
            FLYTHROUGH_MAX_PARTICLES,
            250_000,
        ),
        audio_reactive: params
            .get("audioReactive")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

fn reverse_bits_32(mut bits: u32) -> u32 {
    bits = ((bits >> 1) & 0x5555_5555) | ((bits & 0x5555_5555) << 1);
    bits = ((bits >> 2) & 0x3333_3333) | ((bits & 0x3333_3333) << 2);
    bits = ((bits >> 4) & 0x0f0f_0f0f) | ((bits & 0x0f0f_0f0f) << 4);
    bits = ((bits >> 8) & 0x00ff_00ff) | ((bits & 0x00ff_00ff) << 8);
    bits.rotate_left(16)
}

fn build_flythrough_initial_bytes(count: u32) -> Vec<u8> {
    let mut bytes = vec![0_u8; count as usize * FLYTHROUGH_PARTICLE_BYTES as usize];
    for i in 0..count {
        let u1 = (i as f32 + 0.5) / count.max(1) as f32;
        let u2 = reverse_bits_32(i) as f32 / 4_294_967_296.0;
        let ax = u1 * 2.0 - 1.0;
        let ay = u2 * 2.0 - 1.0;
        let base = i as usize * 12;
        write_f32_le(&mut bytes, base, ax);
        write_f32_le(&mut bytes, base + 1, ay);
        write_f32_le(&mut bytes, base + 3, 1.0);
        write_f32_le(
            &mut bytes,
            base + 7,
            (ax * 7.3 + ay * 11.1).sin() * 0.5 + 0.5,
        );
        write_f32_le(&mut bytes, base + 8, ax);
        write_f32_le(&mut bytes, base + 9, ay);
    }
    bytes
}

fn build_flythrough_compute_bytes(
    params: &NativeFlythroughParams,
    state: &NativeFlythroughGraphState,
    dt: f32,
    time: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 64];
    let flow_scale = if params.audio_reactive {
        1.0 + treble * 1.5
    } else {
        1.0
    };
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_f32_le(&mut bytes, 2, params.flow_strength * flow_scale);
    write_f32_le(&mut bytes, 3, params.flow_scale);
    write_f32_le(&mut bytes, 4, params.anchor_pull);
    write_f32_le(&mut bytes, 5, params.tunnel_depth);
    write_f32_le(&mut bytes, 6, params.depth_strength);
    write_u32_le(&mut bytes, 7, params.particle_count);
    write_u32_le(&mut bytes, 8, params.depth_source_id);
    write_f32_le(&mut bytes, 9, state.fly_distance);
    bytes
}

fn flythrough_view_proj(
    params: &NativeFlythroughParams,
    width: u32,
    height: u32,
) -> ([f32; 16], [f32; 16]) {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let near = 0.05;
    let far = 100.0;
    let f = 1.0 / (params.fov_deg.to_radians() * 0.5).tan();
    let mut proj = [0.0_f32; 16];
    proj[0] = f / aspect.max(0.0001);
    proj[5] = f;
    proj[10] = far / (far - near);
    proj[11] = 1.0;
    proj[14] = -(near * far) / (far - near);
    let (sy, cy) = params.camera_yaw.to_radians().sin_cos();
    let (sp, cp) = params.camera_pitch.to_radians().sin_cos();
    let ry = [
        cy, 0.0, sy, 0.0, 0.0, 1.0, 0.0, 0.0, -sy, 0.0, cy, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let rx = [
        1.0, 0.0, 0.0, 0.0, 0.0, cp, -sp, 0.0, 0.0, sp, cp, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let rot = native_mat4_mul(ry, rx);
    let view = native_mat4_mul(rot, native_translate(0.0, 0.0, -0.1));
    (native_mat4_mul(proj, view), rot)
}

fn build_flythrough_render_bytes(
    params: &NativeFlythroughParams,
    state: &NativeFlythroughGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 256];
    let (view_proj, rot) = flythrough_view_proj(params, width, height);
    for (index, value) in view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    for index in 0..3 {
        write_f32_le(&mut bytes, 16 + index, rot[index]);
    }
    for index in 0..3 {
        write_f32_le(&mut bytes, 20 + index, rot[4 + index]);
    }
    write_f32_le(&mut bytes, 24, params.base_size);
    write_f32_le(&mut bytes, 25, params.stroke_length);
    write_f32_le(&mut bytes, 26, params.stroke_width);
    write_u32_le(&mut bytes, 27, params.topology_id);
    write_u32_le(&mut bytes, 28, params.slab_count);
    write_f32_le(&mut bytes, 29, params.tunnel_depth);
    write_f32_le(&mut bytes, 30, state.fly_distance);
    write_u32_le(&mut bytes, 31, params.particle_count);
    write_f32_le(&mut bytes, 32, params.opacity);
    write_f32_le(&mut bytes, 33, 1.0);
    write_f32_le(&mut bytes, 34, 1.0);
    bytes
}

#[derive(Clone, Debug)]
struct NativePointCloudParams {
    topology_id: u32,
    point_size: f32,
    opacity: f32,
    wind_strength: f32,
    wind_scale: f32,
    anchor_pull: f32,
    damping: f32,
    twist_amount: f32,
    voxel_mix: f32,
    voxel_size: f32,
    shimmer_strength: f32,
    burst_gain: f32,
    burst_decay: f32,
    wave_enabled: bool,
    wave_speed: f32,
    wave_orbit_radius: f32,
    wave_radius: f32,
    wave_falloff: f32,
    wave_strength: f32,
    hue_shift_speed: f32,
    saturation: f32,
    brightness: f32,
    color_mode_id: u32,
    color_map_id: u32,
    color_mix: f32,
    color_map_scale: f32,
    color_map_offset: f32,
    color_cycle_speed: f32,
    random_sat: f32,
    random_val: f32,
    filter_mode_id: u32,
    filter_axis_id: u32,
    filter_amount: f32,
    filter_speed: f32,
    filter_phase: f32,
    filter_width: f32,
    filter_softness: f32,
    contour_bands: f32,
    fog_density: f32,
    fog_opacity: f32,
    fog_color: [f32; 3],
    colors: [[f32; 3]; 4],
    dissolve_radius: f32,
    dissolve_softness: f32,
    stroke_length: f32,
    stroke_width: f32,
    fov_deg: f32,
    camera_z: f32,
    rotate: [f32; 3],
    auto_rotate: [f32; 3],
    audio_reactive: bool,
}

fn normalize_point_cloud_native_params(params: &Value) -> NativePointCloudParams {
    let topology_id = match native_particle_field_enum(params, "topology", "points").as_str() {
        "billboards" => 1,
        "strokes" => 2,
        _ => 0,
    };
    let color_mode_id = match native_particle_field_enum(params, "colorMode", "source").as_str() {
        "solid" => 1,
        "gradient2" => 2,
        "gradient3" => 3,
        "palette4" => 4,
        "rainbow" => 5,
        "random" => 6,
        _ => 0,
    };
    let color_map_id = match native_particle_field_enum(params, "colorMap", "index").as_str() {
        "depth-z" => 1,
        "depth-cam" => 2,
        "radial" => 3,
        "y-axis" => 4,
        "luminance" => 5,
        "noise" => 6,
        _ => 0,
    };
    let filter_mode_id = match native_particle_field_enum(params, "filterMode", "none").as_str() {
        "drift" => 1,
        "swarm" => 2,
        "slice" => 3,
        "contour" => 4,
        "rift" => 5,
        "prism" => 6,
        "fog" => 7,
        _ => 0,
    };
    let filter_axis_id = match native_particle_field_enum(params, "filterAxis", "z").as_str() {
        "x" => 0,
        "y" => 1,
        "radial" => 3,
        _ => 2,
    };
    NativePointCloudParams {
        topology_id,
        point_size: native_graph_param_f32(params, "pointSize", 0.0001, 0.2, 0.006),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 1.0, 1.0),
        wind_strength: native_graph_param_f32(params, "windStrength", 0.0, 8.0, 0.05),
        wind_scale: native_graph_param_f32(params, "windScale", 0.01, 24.0, 1.0),
        anchor_pull: native_graph_param_f32(params, "anchorPull", 0.0, 16.0, 2.0),
        damping: native_graph_param_f32(params, "damping", 0.0, 8.0, 0.8),
        twist_amount: native_graph_param_f32(params, "twistAmount", -32.0, 32.0, 0.0),
        voxel_mix: native_graph_param_f32(params, "voxelMix", 0.0, 1.0, 0.0),
        voxel_size: native_graph_param_f32(params, "voxelSize", 0.001, 4.0, 0.1),
        shimmer_strength: native_graph_param_f32(params, "shimmerStrength", 0.0, 2.0, 0.02),
        burst_gain: native_graph_param_f32(params, "burstGain", 0.0, 8.0, 0.6),
        burst_decay: native_graph_param_f32(params, "burstDecay", 0.01, 24.0, 2.5),
        wave_enabled: params
            .get("waveEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        wave_speed: native_graph_param_f32(params, "waveSpeed", -64.0, 64.0, 0.6),
        wave_orbit_radius: native_graph_param_f32(params, "waveOrbitRadius", 0.0, 8.0, 0.8),
        wave_radius: native_graph_param_f32(params, "waveRadius", 0.001, 8.0, 0.3),
        wave_falloff: native_graph_param_f32(params, "waveFalloff", 0.001, 8.0, 0.2),
        wave_strength: native_graph_param_f32(params, "waveStrength", 0.0, 16.0, 0.8),
        hue_shift_speed: native_graph_param_f32(params, "hueShiftSpeed", -64.0, 64.0, 0.05),
        saturation: native_graph_param_f32(params, "saturation", 0.0, 8.0, 1.0),
        brightness: native_graph_param_f32(params, "brightness", 0.0, 8.0, 1.0),
        color_mode_id,
        color_map_id,
        color_mix: native_graph_param_f32(params, "colorMix", 0.0, 1.0, 1.0),
        color_map_scale: native_graph_param_f32(params, "colorMapScale", 0.001, 24.0, 1.0),
        color_map_offset: native_graph_param_f32(params, "colorMapOffset", -64.0, 64.0, 0.0),
        color_cycle_speed: native_graph_param_f32(params, "colorCycleSpeed", -64.0, 64.0, 0.0),
        random_sat: native_graph_param_f32(params, "randomSat", 0.0, 1.0, 0.85),
        random_val: native_graph_param_f32(params, "randomVal", 0.0, 8.0, 1.0),
        filter_mode_id,
        filter_axis_id,
        filter_amount: native_graph_param_f32(params, "filterAmount", 0.0, 8.0, 0.75),
        filter_speed: native_graph_param_f32(params, "filterSpeed", -64.0, 64.0, 0.2),
        filter_phase: native_graph_param_f32(params, "filterPhase", -100_000.0, 100_000.0, 0.0),
        filter_width: native_graph_param_f32(params, "filterWidth", 0.001, 8.0, 0.18),
        filter_softness: native_graph_param_f32(params, "filterSoftness", 0.001, 8.0, 0.08),
        contour_bands: native_graph_param_f32(params, "contourBands", 1.0, 128.0, 12.0),
        fog_density: native_graph_param_f32(params, "fogDensity", 0.0, 16.0, 0.0),
        fog_opacity: native_graph_param_f32(params, "fogOpacity", 0.0, 1.0, 0.0),
        fog_color: native_graph_param_rgb(params, "fogColor", [0.02, 0.025, 0.035]),
        colors: [
            native_graph_param_rgb(params, "colorA", [0.24, 0.39, 0.94]),
            native_graph_param_rgb(params, "colorB", [0.94, 0.24, 0.71]),
            native_graph_param_rgb(params, "colorC", [1.0, 0.78, 0.12]),
            native_graph_param_rgb(params, "colorD", [0.16, 0.86, 0.86]),
        ],
        dissolve_radius: native_graph_param_f32(params, "dissolveRadius", 0.0, 64.0, 10.0),
        dissolve_softness: native_graph_param_f32(params, "dissolveSoftness", 0.001, 8.0, 0.05),
        stroke_length: native_graph_param_f32(params, "strokeLength", 0.001, 4.0, 0.04),
        stroke_width: native_graph_param_f32(params, "strokeWidth", 0.0001, 2.0, 0.004),
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.05, 128.0, 2.5),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate: [
            native_graph_param_f32(params, "autoRotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "autoRotateY", -3600.0, 3600.0, 8.0),
            native_graph_param_f32(params, "autoRotateZ", -3600.0, 3600.0, 0.0),
        ],
        audio_reactive: params
            .get("audioReactive")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    }
}

fn point_cloud_view_proj(
    params: &NativePointCloudParams,
    state: &NativePointCloudGraphState,
    width: u32,
    height: u32,
) -> [f32; 16] {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let proj = native_perspective(params.fov_deg, aspect, 0.05, 100.0);
    let view = native_translate(0.0, 0.0, -params.camera_z);
    let object = native_mat4_mul(
        native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
        native_mat4_mul(
            native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
        ),
    );
    native_mat4_mul(proj, native_mat4_mul(view, object))
}

fn build_point_cloud_compute_bytes(
    params: &NativePointCloudParams,
    state: &NativePointCloudGraphState,
    dt: f32,
    time: f32,
    bass: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 288];
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_u32_le(&mut bytes, 2, state.point_count);
    write_f32_le(&mut bytes, 3, params.point_size);
    write_f32_le(&mut bytes, 4, params.wind_strength);
    write_f32_le(&mut bytes, 5, params.wind_scale);
    write_f32_le(&mut bytes, 6, params.anchor_pull);
    write_f32_le(&mut bytes, 7, params.damping);
    write_f32_le(&mut bytes, 8, bass);
    write_f32_le(&mut bytes, 9, treble);
    write_f32_le(&mut bytes, 10, state.burst_impulse);
    write_f32_le(&mut bytes, 11, params.shimmer_strength);
    let wave = if params.wave_enabled { 1.0 } else { 0.0 };
    write_f32_le(
        &mut bytes,
        12,
        wave * state.wave_time.cos() * params.wave_orbit_radius,
    );
    write_f32_le(
        &mut bytes,
        13,
        wave * state.wave_time.sin() * params.wave_orbit_radius * 0.6,
    );
    write_f32_le(
        &mut bytes,
        14,
        wave * (state.wave_time * 0.7).sin() * params.wave_orbit_radius * 0.4,
    );
    write_f32_le(&mut bytes, 15, params.wave_radius);
    write_f32_le(&mut bytes, 16, params.wave_strength * wave);
    write_f32_le(&mut bytes, 17, params.wave_falloff);
    write_f32_le(&mut bytes, 18, params.twist_amount);
    write_f32_le(&mut bytes, 19, params.voxel_size);
    write_f32_le(&mut bytes, 20, params.voxel_mix);
    write_f32_le(&mut bytes, 21, params.dissolve_radius);
    write_f32_le(&mut bytes, 22, params.dissolve_softness);
    write_f32_le(&mut bytes, 23, state.hue_shift_phase);
    write_f32_le(&mut bytes, 24, params.saturation);
    write_f32_le(&mut bytes, 25, params.brightness);
    write_u32_le(&mut bytes, 26, params.color_mode_id);
    write_u32_le(&mut bytes, 27, params.color_map_id);
    write_f32_le(&mut bytes, 28, params.color_mix);
    write_f32_le(&mut bytes, 29, params.color_map_scale);
    write_f32_le(&mut bytes, 30, params.color_map_offset);
    write_f32_le(&mut bytes, 31, state.color_cycle_phase);
    write_f32_le(&mut bytes, 32, params.random_sat);
    write_f32_le(&mut bytes, 33, params.random_val);
    write_u32_le(&mut bytes, 34, params.filter_mode_id);
    write_u32_le(&mut bytes, 35, params.filter_axis_id);
    for color_index in 0..4 {
        for component in 0..3 {
            write_f32_le(
                &mut bytes,
                36 + color_index * 4 + component,
                params.colors[color_index][component],
            );
        }
    }
    write_f32_le(&mut bytes, 52, params.filter_amount);
    write_f32_le(&mut bytes, 53, params.filter_speed);
    write_f32_le(&mut bytes, 54, params.filter_phase);
    write_f32_le(&mut bytes, 55, params.filter_width);
    write_f32_le(&mut bytes, 56, params.filter_softness);
    write_f32_le(&mut bytes, 57, params.contour_bands);
    write_f32_le(&mut bytes, 58, params.fog_density);
    write_f32_le(&mut bytes, 59, params.fog_opacity);
    for component in 0..3 {
        write_f32_le(&mut bytes, 60 + component, params.fog_color[component]);
    }
    bytes
}

fn build_point_cloud_render_bytes(
    params: &NativePointCloudParams,
    state: &NativePointCloudGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 192];
    for (index, value) in point_cloud_view_proj(params, state, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, 1.0);
    write_f32_le(&mut bytes, 19, params.camera_z);
    write_f32_le(&mut bytes, 21, 1.0);
    write_u32_le(&mut bytes, 24, params.topology_id);
    write_f32_le(&mut bytes, 25, params.stroke_length);
    write_f32_le(&mut bytes, 26, params.stroke_width);
    write_f32_le(&mut bytes, 27, params.opacity);
    write_u32_le(&mut bytes, 28, state.point_count);
    write_f32_le(&mut bytes, 29, width.max(1) as f32);
    write_f32_le(&mut bytes, 30, height.max(1) as f32);
    write_f32_le(&mut bytes, 31, 0.75);
    for component in 0..3 {
        write_f32_le(&mut bytes, 32 + component, params.fog_color[component]);
    }
    let fog_boost = if params.filter_mode_id == 7 {
        params.filter_amount
    } else {
        0.0
    };
    write_f32_le(&mut bytes, 35, params.fog_opacity.max(fog_boost * 0.65));
    write_f32_le(
        &mut bytes,
        36,
        params.fog_density.max(if fog_boost > 0.0 {
            0.45 + fog_boost * 1.4
        } else {
            0.0
        }),
    );
    bytes
}

fn build_point_cloud_sort_fill_bytes(
    params: &NativePointCloudParams,
    state: &NativePointCloudGraphState,
    width: u32,
    height: u32,
    sort_count: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 80];
    for (index, value) in point_cloud_view_proj(params, state, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_u32_le(&mut bytes, 16, state.point_count);
    write_u32_le(&mut bytes, 17, sort_count.max(1));
    bytes
}

/* ============================================================== */
/* SMOKE RIDERS — coupled fluid + rider instrument                 */
/* ============================================================== */
// Mirrors src/lib/renderer/shaders/webgpuSmokeRidersShader.ts. The WGSL
// itself ships from TS through `precompile_shader`; only the graph shape
// and the uniform packing live here, and both sides must agree byte for
// byte or the same shader would read different numbers depending on
// which builder installed the graph.

const SMOKE_RIDERS_TILE_SIZE: u32 = 16;
const SMOKE_RIDERS_TILE_CAP: u32 = 64;
const SMOKE_RIDERS_MIN_COUNT: u32 = 16;
const SMOKE_RIDERS_MAX_COUNT: u32 = 2048;
/// pos+radius, vel+tau, seed+tint+life+fade = 12 floats = 48 bytes.
/// Slot 7 used to be an arbitrary `mass`; it now carries the Stokes
/// relaxation time the integrator derived for that rider.
const SMOKE_RIDERS_STRIDE_FLOATS: u32 = 12;
/// Reference rider radius (world units) that "Weight" is quoted at.
/// τ ∝ r², so a rider twice this size lags four times as long.
const SMOKE_RIDERS_TAU_REF_RADIUS: f32 = 0.05;
/// Warm-start scale applied to the pressure field before the Jacobi
/// sweep. Mirrors SMOKE_RIDERS_PRESSURE_WARM in the TS builder.
const SMOKE_RIDERS_PRESSURE_WARM: f32 = 0.8;

fn smoke_riders_tile_counts(width: u32, height: u32) -> (u32, u32) {
    (
        width.max(1).div_ceil(SMOKE_RIDERS_TILE_SIZE).max(1),
        height.max(1).div_ceil(SMOKE_RIDERS_TILE_SIZE).max(1),
    )
}

#[derive(Clone, Copy, Debug)]
struct NativeSmokeRidersStyle {
    emitters: u32,
    spawn_y: f32,
    splat_radius: f32,
    splat_velocity: f32,
    density_decay: f32,
    wind: [f32; 3],
    turb_scale: f32,
    spin_x: f32,
    spin_z: f32,
    size_scale: f32,
    buoyancy_scale: f32,
    gravity_scale: f32,
}

fn smoke_riders_style_tuning(style: &str) -> NativeSmokeRidersStyle {
    match style {
        "ember" => NativeSmokeRidersStyle {
            emitters: 6,
            spawn_y: -0.68,
            splat_radius: 0.072,
            splat_velocity: 0.95,
            density_decay: 0.987,
            wind: [0.04, 0.5, -0.02],
            turb_scale: 3.4,
            spin_x: -0.25,
            spin_z: 0.2,
            size_scale: 0.72,
            buoyancy_scale: 1.6,
            gravity_scale: 0.4,
        },
        "pearl" => NativeSmokeRidersStyle {
            emitters: 4,
            spawn_y: -0.16,
            splat_radius: 0.13,
            splat_velocity: 0.42,
            density_decay: 0.995,
            wind: [-0.03, 0.08, 0.04],
            turb_scale: 1.8,
            spin_x: 0.1,
            spin_z: -0.12,
            size_scale: 1.3,
            buoyancy_scale: 0.55,
            gravity_scale: 0.25,
        },
        _ => NativeSmokeRidersStyle {
            emitters: 5,
            spawn_y: -0.52,
            splat_radius: 0.052,
            splat_velocity: 1.05,
            density_decay: 0.9865,
            wind: [0.0, 0.18, 0.0],
            turb_scale: 5.2,
            spin_x: -0.16,
            spin_z: 0.06,
            size_scale: 1.0,
            buoyancy_scale: 1.0,
            gravity_scale: 1.0,
        },
    }
}

#[derive(Clone, Debug)]
struct NativeSmokeRidersParams {
    grid_size: u32,
    pressure_iterations: usize,
    pressure_warm: f32,
    mac_cormack: bool,
    march_steps: u32,
    shadow_steps: u32,
    shadow_step_len: f32,
    rider_count: u32,
    // fluid
    emitter_count: u32,
    spread: f32,
    spawn_y: f32,
    splat_radius: f32,
    splat_strength: f32,
    splat_velocity_mag: f32,
    splat_rate: f32,
    velocity_decay: f32,
    density_decay: f32,
    wind: [f32; 3],
    turb_strength: f32,
    turb_scale: f32,
    vorticity: f32,
    surface_tension: f32,
    paint_thickness: f32,
    density: f32,
    emission: f32,
    // riders
    rider_size: f32,
    rider_size_variance: f32,
    /// τ in seconds for a rider at the reference radius.
    rider_weight: f32,
    /// τ spread in decades: 1 => [0.1×, 10×].
    weight_spread: f32,
    /// Precomputed (1 - ρ_f/ρ_p) so the shader does no division.
    gravity_factor: f32,
    flow_coupling: f32,
    buoyancy: f32,
    gravity: f32,
    vortex_pull: f32,
    /// Surface-seeking spring toward the iso shell (fluid-riders
    /// defaults 1.6; smoke-riders defaults 0).
    surface_stick: f32,
    rider_damping: f32,
    rider_life: f32,
    contain_strength: f32,
    // material
    roughness: f32,
    metalness: f32,
    clear_coat: f32,
    coat_roughness: f32,
    rider_opacity: f32,
    reflect_strength: f32,
    liquid_glass: f32,
    surface_detail: f32,
    detail_scale: f32,
    contact_ao: f32,
    // lighting
    anisotropy: f32,
    multi_scatter: f32,
    key_strength: f32,
    key_color: [f32; 3],
    fill_strength: f32,
    fill_color: [f32; 3],
    rim_strength: f32,
    rim_color: [f32; 3],
    ambient: f32,
    // palette
    color_a: [f32; 3],
    color_b: [f32; 3],
    color_c: [f32; 3],
    color_d: [f32; 3],
    smoke_color: [f32; 3],
    background_mode: f32,
    background_color: [f32; 3],
    background_opacity: f32,
    vignette: f32,
    exposure: f32,
    flow_speed: f32,
    iso_level: f32,
    /// Grazing-angle silhouette fade width (fluid-riders render).
    edge_softness: f32,
    viscosity: f32,
    color_follow: f32,
    /// 0 = AgX, 1 = ACES, 2 = Linear.
    tonemap: f32,
    // camera
    volume_scale_x: f32,
    volume_scale_z: f32,
    fov_deg: f32,
    camera_z: f32,
    rotate: [f32; 3],
    auto_rotate_x: f32,
    auto_rotate_y: f32,
    auto_rotate_z: f32,
    // audio
    bass: f32,
    treble: f32,
    audio_burst: f32,
}

/// `fluid` selects the fluid-riders defaults for the handful of knobs
/// whose out-of-the-box value differs between the two kinds (march
/// steps, flow coupling, surface stick). Everything else is shared.
fn normalize_smoke_riders_native_params(
    params: &Value,
    audio_bass: f32,
    audio_treble: f32,
    fluid: bool,
) -> NativeSmokeRidersParams {
    let quality = native_particle_field_enum(params, "quality", "balanced");
    let style = native_particle_field_enum(params, "style", "paint");
    let tuning = smoke_riders_style_tuning(style.as_str());
    let intensity = native_graph_param_f32(params, "intensity", 0.0, 2.0, 1.0);
    let reactive = native_graph_param_bool(params, "audioReactive", true);
    let bass_drive = native_graph_param_f32(params, "bassDrive", 0.0, 3.0, 1.2);
    let bass = if reactive {
        (audio_bass.clamp(0.0, 4.0) * bass_drive).min(1.8)
    } else {
        0.0
    };
    let treble = if reactive {
        audio_treble.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let treble_shimmer = native_graph_param_f32(params, "trebleShimmer", 0.0, 0.2, 0.025);

    let grid_size = match quality.as_str() {
        "ultra" => 64,
        "performance" => 32,
        _ => 48,
    };
    // Warm-starting the pressure field is what makes these counts
    // affordable — the floor is 20, below which the projection visibly
    // fails to close and the plume smears sideways.
    let pressure_iterations = if quality == "ultra" { 24 } else { 20 };
    // MacCormack doubles the advection cost. Performance keeps the plain
    // semi-Lagrangian chain; the other tiers honour the operator's choice.
    let mac_cormack = quality != "performance"
        && native_particle_field_enum(params, "advection", "maccormack") != "semi-lagrangian";
    let count_scale = match quality.as_str() {
        "ultra" => 1.35,
        "performance" => 0.5,
        _ => 1.0,
    };
    let march_scale = match quality.as_str() {
        "ultra" => 1.4,
        "performance" => 0.5,
        _ => 1.0,
    };
    let shadow_scale = if quality == "performance" { 0.6 } else { 1.0 };

    let rider_count = ((native_graph_param_f32(
        params,
        "riderCount",
        SMOKE_RIDERS_MIN_COUNT as f32,
        SMOKE_RIDERS_MAX_COUNT as f32,
        220.0,
    ) * count_scale)
        .round() as i64)
        .clamp(SMOKE_RIDERS_MIN_COUNT as i64, SMOKE_RIDERS_MAX_COUNT as i64) as u32;
    // The animated low-discrepancy march offset buys back roughly the
    // quality a tenth of the steps used to cost, so the base step count
    // dropped from 80 to 72 without a visible change. The liquid's
    // iso-surface hunt needs finer steps than a scatter integral, so
    // fluid-riders defaults higher.
    let march_default = if fluid { 96.0 } else { 72.0 };
    let march_steps = ((native_graph_param_f32(params, "marchSteps", 16.0, 160.0, march_default)
        * march_scale)
        .round() as i64)
        .clamp(16, 192) as u32;
    let shadow_steps = ((native_graph_param_f32(params, "shadowSteps", 0.0, 12.0, 5.0)
        * shadow_scale)
        .round() as i64)
        .clamp(0, 12) as u32;
    let rider_density = native_graph_param_f32(params, "riderDensity", 0.2, 4.0, 1.9);

    NativeSmokeRidersParams {
        grid_size,
        pressure_iterations,
        pressure_warm: SMOKE_RIDERS_PRESSURE_WARM,
        mac_cormack,
        march_steps,
        shadow_steps,
        shadow_step_len: 0.075,
        rider_count,

        emitter_count: native_graph_param_u32(
            params,
            "emitterCount",
            1,
            SMOKE_3D_MAX_EMITTERS as u32,
            tuning.emitters,
        ),
        spread: native_graph_param_f32(params, "smokeSpread", 0.0, 0.9, 0.38),
        spawn_y: tuning.spawn_y,
        splat_radius: tuning.splat_radius,
        splat_strength: (0.34 + bass * 0.26) * intensity.max(0.1),
        splat_velocity_mag: tuning.splat_velocity + bass * 0.4,
        splat_rate: 44.0 + bass * 20.0,
        velocity_decay: 0.984,
        density_decay: tuning.density_decay,
        wind: tuning.wind,
        turb_strength: native_graph_param_f32(params, "smokeTurbulence", 0.0, 4.0, 0.5)
            + bass * 0.45,
        turb_scale: tuning.turb_scale,
        vorticity: native_graph_param_f32(params, "vorticity", 0.0, 12.0, 3.8)
            * (1.0 + bass * 0.35),
        surface_tension: native_graph_param_f32(params, "surfaceTension", 0.0, 3.0, 0.6),
        paint_thickness: native_graph_param_f32(params, "paintThickness", 0.0, 2.0, 0.5),
        density: native_graph_param_f32(params, "smokeDensity", 0.0, 8.0, 3.0),
        emission: native_graph_param_f32(params, "smokeGlow", 0.0, 6.0, 1.35)
            * (0.85 + intensity * 0.35),

        rider_size: native_graph_param_f32(params, "riderSize", 0.01, 0.3, 0.042)
            * tuning.size_scale,
        rider_size_variance: native_graph_param_f32(params, "riderSizeVariance", 0.0, 1.0, 0.62),
        rider_weight: native_graph_param_f32(params, "riderWeight", 0.01, 1.2, 0.08),
        weight_spread: native_graph_param_f32(params, "weightSpread", 0.0, 1.0, 0.38),
        gravity_factor: 1.0 - 1.0 / rider_density,
        flow_coupling: native_graph_param_f32(
            params,
            "flowCoupling",
            0.0,
            3.0,
            if fluid { 1.35 } else { 1.05 },
        ),
        buoyancy: native_graph_param_f32(params, "buoyancy", 0.0, 4.0, 0.2)
            * tuning.buoyancy_scale
            * (1.0 + bass * 0.4),
        gravity: native_graph_param_f32(params, "gravity", 0.0, 4.0, 1.0) * tuning.gravity_scale,
        vortex_pull: native_graph_param_f32(params, "vortexPull", -1.0, 1.0, 0.0),
        surface_stick: native_graph_param_f32(
            params,
            "surfaceStick",
            0.0,
            4.0,
            if fluid { 1.6 } else { 0.0 },
        ),
        rider_damping: native_graph_param_f32(params, "riderDamping", 0.0, 4.0, 0.45),
        rider_life: native_graph_param_f32(params, "riderLife", 1.0, 60.0, 6.0),
        // Velocity gain, not a spring constant: the containment is folded
        // into the velocity the rider relaxes toward, so a heavy rider is
        // eased back into the box instead of being catapulted.
        contain_strength: 6.0,

        roughness: native_graph_param_f32(params, "roughness", 0.03, 1.0, 0.17),
        metalness: native_graph_param_f32(params, "metalness", 0.0, 1.0, 0.08),
        clear_coat: native_graph_param_f32(params, "clearCoat", 0.0, 1.0, 0.75),
        coat_roughness: native_graph_param_f32(params, "coatRoughness", 0.01, 1.0, 0.08),
        rider_opacity: native_graph_param_f32(params, "riderOpacity", 0.15, 1.0, 1.0),
        reflect_strength: native_graph_param_f32(params, "reflectStrength", 0.0, 3.0, 1.0),
        liquid_glass: native_graph_param_f32(params, "liquidGlass", 0.0, 1.0, 0.0),
        surface_detail: native_graph_param_f32(params, "surfaceDetail", 0.0, 1.0, 0.12),
        detail_scale: native_graph_param_f32(params, "detailScale", 1.0, 24.0, 8.0),
        contact_ao: native_graph_param_f32(params, "contactAO", 0.0, 4.0, 1.1),

        anisotropy: native_graph_param_f32(params, "anisotropy", -0.9, 0.9, 0.4),
        multi_scatter: native_graph_param_f32(params, "multiScatter", 0.0, 2.0, 0.35),
        key_strength: native_graph_param_f32(params, "keyStrength", 0.0, 8.0, 3.1)
            * (0.8 + intensity * 0.25),
        key_color: native_graph_param_rgb(params, "keyColor", [1.0, 0.933_333, 0.839_216]),
        fill_strength: native_graph_param_f32(params, "fillStrength", 0.0, 4.0, 0.6),
        fill_color: native_graph_param_rgb(params, "fillColor", [0.620, 0.722, 0.910]),
        rim_strength: native_graph_param_f32(params, "rimStrength", 0.0, 6.0, 1.15)
            * (1.0 + treble * treble_shimmer * 12.0),
        rim_color: native_graph_param_rgb(params, "rimColor", [1.0, 0.807_843, 0.658_824]),
        ambient: native_graph_param_f32(params, "ambient", 0.0, 2.0, 0.14),

        color_a: native_graph_param_rgb(params, "colorA", [1.0, 0.408, 0.039]),
        color_b: native_graph_param_rgb(params, "colorB", [0.910, 0.173, 0.024]),
        color_c: native_graph_param_rgb(params, "colorC", [1.0, 0.580, 0.149]),
        color_d: native_graph_param_rgb(params, "colorD", [0.659, 0.110, 0.016]),
        smoke_color: native_graph_param_rgb(params, "smokeColor", [1.0, 0.470, 0.118]),
        background_mode: match native_particle_field_enum(params, "backgroundMode", "studio")
            .as_str()
        {
            "transparent" => 0.0,
            "flat" => 1.0,
            _ => 2.0,
        },
        background_color: native_graph_param_rgb(
            params,
            "backgroundColor",
            [0.062_745, 0.058_824, 0.070_588],
        ),
        background_opacity: native_graph_param_f32(params, "backgroundOpacity", 0.0, 1.0, 1.0),
        vignette: native_graph_param_f32(params, "vignette", 0.0, 1.0, 0.45),
        exposure: native_graph_param_f32(params, "exposure", 0.1, 4.0, 1.5),
        flow_speed: native_graph_param_f32(params, "flowSpeed", 0.05, 2.0, 0.32),
        iso_level: native_graph_param_f32(params, "isoLevel", 0.02, 2.5, 0.42),
        edge_softness: native_graph_param_f32(params, "edgeSoftness", 0.0, 0.5, 0.18),
        viscosity: native_graph_param_f32(params, "viscosity", 0.0, 1.0, 0.72),
        color_follow: native_graph_param_f32(params, "colorFollow", 0.0, 10.0, 3.2),
        tonemap: match native_particle_field_enum(params, "tonemap", "agx").as_str() {
            "aces" => 1.0,
            "linear" => 2.0,
            _ => 0.0,
        },

        volume_scale_x: 1.72,
        volume_scale_z: 1.25,
        fov_deg: native_graph_param_f32(params, "fovDeg", 25.0, 95.0, 48.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 1.4, 7.0, 2.85),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate_x: tuning.spin_x,
        auto_rotate_y: native_graph_param_f32(params, "autoSpin", -24.0, 24.0, 1.4),
        auto_rotate_z: tuning.spin_z,

        bass,
        treble,
        audio_burst: bass_drive,
    }
}

/// Deterministic seed hash, mirrored in the TS builder so both graph
/// builders spawn the same rider population.
fn smoke_riders_hash(n: f32) -> f32 {
    let s = ((n * 127.1 + 311.7).sin()) * 43758.5453;
    s - s.floor()
}

/// Camera-space light direction -> volume object space. The model
/// rotation is baked into viewProj (the volume spins, not the camera),
/// so without this inverse the studio rig would orbit with the smoke.
fn smoke_riders_light_to_object(model: [f32; 16], dir: [f32; 3]) -> [f32; 3] {
    // Rotation-only model: inverse == transpose.
    let x = model[0] * dir[0] + model[1] * dir[1] + model[2] * dir[2];
    let y = model[4] * dir[0] + model[5] * dir[1] + model[6] * dir[2];
    let z = model[8] * dir[0] + model[9] * dir[1] + model[10] * dir[2];
    native_vec3_normalize([x, y, z], dir)
}

fn build_smoke_riders_sim_uniform_bytes(
    params: &NativeSmokeRidersParams,
    dt: f32,
    time: f32,
    fire: bool,
    burst_mul: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 96];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_u32_le(&mut bytes, 3, params.emitter_count);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, time);
    write_f32_le(&mut bytes, 6, if fire { burst_mul } else { 0.0 });
    write_f32_le(&mut bytes, 8, params.density_decay);
    write_f32_le(&mut bytes, 9, params.velocity_decay);
    write_f32_le(&mut bytes, 10, params.splat_radius);
    write_f32_le(&mut bytes, 12, params.wind[0]);
    write_f32_le(&mut bytes, 13, params.wind[1]);
    write_f32_le(&mut bytes, 14, params.wind[2]);
    write_f32_le(&mut bytes, 15, params.turb_strength);
    write_f32_le(&mut bytes, 16, params.turb_scale);
    bytes
}

fn build_smoke_riders_emitter_bytes(params: &NativeSmokeRidersParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; SMOKE_3D_MAX_EMITTERS * 48];
    let emitter_count = params.emitter_count.clamp(1, SMOKE_3D_MAX_EMITTERS as u32);
    let palette = [
        params.color_a,
        params.color_b,
        params.color_c,
        params.color_d,
    ];
    for index in 0..emitter_count as usize {
        let off = index * 12;
        let angle = if emitter_count > 1 {
            index as f32 / emitter_count as f32 * std::f32::consts::TAU
        } else {
            0.0
        };
        let color = palette[index % palette.len()];
        write_f32_le(&mut bytes, off, angle.cos() * params.spread * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 1, params.spawn_y * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 2, angle.sin() * params.spread * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 3, params.splat_radius);
        write_f32_le(&mut bytes, off + 4, color[0]);
        write_f32_le(&mut bytes, off + 5, color[1]);
        write_f32_le(&mut bytes, off + 6, color[2]);
        write_f32_le(&mut bytes, off + 7, params.splat_strength);
        write_f32_le(
            &mut bytes,
            off + 8,
            angle.cos() * params.splat_velocity_mag * 0.18,
        );
        write_f32_le(&mut bytes, off + 9, params.splat_velocity_mag);
        write_f32_le(
            &mut bytes,
            off + 10,
            angle.sin() * params.splat_velocity_mag * 0.18,
        );
    }
    bytes
}

fn build_smoke_riders_vorticity_uniform_bytes(
    params: &NativeSmokeRidersParams,
    dt: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 32];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, params.vorticity);
    write_f32_le(&mut bytes, 6, 1.0 / params.grid_size.max(1) as f32);
    write_f32_le(&mut bytes, 7, params.pressure_warm);
    bytes
}

fn build_smoke_riders_surface_uniform_bytes(
    params: &NativeSmokeRidersParams,
    dt: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 32];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, params.surface_tension);
    write_f32_le(&mut bytes, 6, params.paint_thickness);
    // CFL cap: no cell may be pushed more than a quarter of a cell width
    // (velocity is in uv/s, so a cell is 1/grid) by surface tension alone.
    write_f32_le(&mut bytes, 7, 0.25 / params.grid_size.max(1) as f32);
    bytes
}

fn build_smoke_riders_rider_uniform_bytes(
    params: &NativeSmokeRidersParams,
    dt: f32,
    time: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 128];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_u32_le(&mut bytes, 3, params.rider_count);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, time);
    write_f32_le(&mut bytes, 6, params.flow_coupling);
    write_f32_le(&mut bytes, 7, params.rider_weight);
    write_f32_le(&mut bytes, 8, params.buoyancy);
    write_f32_le(&mut bytes, 9, params.gravity);
    write_f32_le(&mut bytes, 10, params.vortex_pull);
    write_f32_le(&mut bytes, 11, params.rider_damping);
    write_f32_le(&mut bytes, 12, params.weight_spread);
    write_f32_le(&mut bytes, 13, params.gravity_factor);
    write_f32_le(&mut bytes, 14, 0.45);
    write_f32_le(&mut bytes, 15, 0.35 + params.rider_size_variance * 1.9);
    write_f32_le(&mut bytes, 16, params.volume_scale_x);
    write_f32_le(&mut bytes, 17, 1.0);
    write_f32_le(&mut bytes, 18, params.volume_scale_z);
    write_f32_le(&mut bytes, 19, params.contain_strength);
    write_f32_le(&mut bytes, 20, 0.0);
    write_f32_le(&mut bytes, 21, params.spawn_y);
    write_f32_le(&mut bytes, 22, 0.0);
    write_f32_le(
        &mut bytes,
        23,
        (params.spread * params.volume_scale_x + 0.2).max(0.15),
    );
    write_f32_le(&mut bytes, 24, params.rider_life);
    // Pressure-gradient gain: the solver's p lives on grid indices, so the
    // per-index difference becomes a world-space gradient by dividing by
    // the world cell size (extent/grid) — folded here as grid/extentY,
    // with extentY = 2 (the volume is 1 unit tall each way).
    write_f32_le(&mut bytes, 25, params.grid_size as f32 * 0.5);
    write_f32_le(&mut bytes, 26, params.bass);
    write_f32_le(&mut bytes, 27, params.treble);
    write_f32_le(&mut bytes, 28, params.rider_size);
    write_f32_le(&mut bytes, 29, SMOKE_RIDERS_TAU_REF_RADIUS);
    write_f32_le(&mut bytes, 30, params.surface_stick);
    write_f32_le(&mut bytes, 31, params.iso_level);
    bytes
}

fn build_smoke_riders_bin_uniform_bytes(
    params: &NativeSmokeRidersParams,
    view_proj: [f32; 16],
    tile_count_x: u32,
    tile_count_y: u32,
    aspect: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 96];
    for (index, value) in view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    write_u32_le(&mut bytes, 16, tile_count_x);
    write_u32_le(&mut bytes, 17, tile_count_y);
    write_u32_le(&mut bytes, 18, SMOKE_RIDERS_TILE_CAP);
    write_u32_le(&mut bytes, 19, params.rider_count);
    write_f32_le(
        &mut bytes,
        20,
        1.0 / (params.fov_deg.to_radians() * 0.5).tan(),
    );
    write_f32_le(&mut bytes, 21, aspect);
    write_f32_le(&mut bytes, 22, params.rider_size);
    bytes
}

fn build_smoke_riders_render_uniform_bytes(
    params: &NativeSmokeRidersParams,
    inv_view_proj: [f32; 16],
    model: [f32; 16],
    tile_count_x: u32,
    tile_count_y: u32,
    frame_index: u64,
    time: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 384];
    for (index, value) in inv_view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    let key = smoke_riders_light_to_object(model, [-0.42, 0.68, 0.62]);
    let fill = smoke_riders_light_to_object(model, [0.66, 0.12, 0.74]);
    let rim = smoke_riders_light_to_object(model, [0.18, 0.28, -0.94]);
    write_f32_le(&mut bytes, 16, params.smoke_color[0]);
    write_f32_le(&mut bytes, 17, params.smoke_color[1]);
    write_f32_le(&mut bytes, 18, params.smoke_color[2]);
    write_f32_le(&mut bytes, 19, params.exposure);
    write_f32_le(&mut bytes, 20, params.volume_scale_x);
    write_f32_le(&mut bytes, 21, 1.0);
    write_f32_le(&mut bytes, 22, params.volume_scale_z);
    write_f32_le(&mut bytes, 23, params.density);
    write_f32_le(&mut bytes, 24, params.background_color[0]);
    write_f32_le(&mut bytes, 25, params.background_color[1]);
    write_f32_le(&mut bytes, 26, params.background_color[2]);
    write_f32_le(&mut bytes, 27, params.background_opacity);
    write_u32_le(&mut bytes, 28, params.grid_size);
    write_u32_le(&mut bytes, 29, params.grid_size);
    write_u32_le(&mut bytes, 30, params.grid_size);
    write_u32_le(&mut bytes, 31, params.rider_count);
    write_f32_le(&mut bytes, 32, key[0]);
    write_f32_le(&mut bytes, 33, key[1]);
    write_f32_le(&mut bytes, 34, key[2]);
    write_f32_le(&mut bytes, 35, params.key_strength);
    write_f32_le(&mut bytes, 36, params.key_color[0]);
    write_f32_le(&mut bytes, 37, params.key_color[1]);
    write_f32_le(&mut bytes, 38, params.key_color[2]);
    write_f32_le(&mut bytes, 39, params.anisotropy);
    write_f32_le(&mut bytes, 40, fill[0]);
    write_f32_le(&mut bytes, 41, fill[1]);
    write_f32_le(&mut bytes, 42, fill[2]);
    write_f32_le(&mut bytes, 43, params.fill_strength);
    write_f32_le(&mut bytes, 44, params.fill_color[0]);
    write_f32_le(&mut bytes, 45, params.fill_color[1]);
    write_f32_le(&mut bytes, 46, params.fill_color[2]);
    write_f32_le(&mut bytes, 47, params.roughness);
    write_f32_le(&mut bytes, 48, rim[0]);
    write_f32_le(&mut bytes, 49, rim[1]);
    write_f32_le(&mut bytes, 50, rim[2]);
    write_f32_le(&mut bytes, 51, params.rim_strength);
    write_f32_le(&mut bytes, 52, params.rim_color[0]);
    write_f32_le(&mut bytes, 53, params.rim_color[1]);
    write_f32_le(&mut bytes, 54, params.rim_color[2]);
    write_f32_le(&mut bytes, 55, params.metalness);
    write_f32_le(&mut bytes, 56, params.color_a[0]);
    write_f32_le(&mut bytes, 57, params.color_a[1]);
    write_f32_le(&mut bytes, 58, params.color_a[2]);
    write_f32_le(&mut bytes, 59, params.emission);
    write_f32_le(&mut bytes, 60, params.color_b[0]);
    write_f32_le(&mut bytes, 61, params.color_b[1]);
    write_f32_le(&mut bytes, 62, params.color_b[2]);
    write_f32_le(&mut bytes, 63, params.multi_scatter);
    write_f32_le(&mut bytes, 64, params.color_c[0]);
    write_f32_le(&mut bytes, 65, params.color_c[1]);
    write_f32_le(&mut bytes, 66, params.color_c[2]);
    write_f32_le(&mut bytes, 67, params.shadow_step_len);
    write_f32_le(&mut bytes, 68, params.color_d[0]);
    write_f32_le(&mut bytes, 69, params.color_d[1]);
    write_f32_le(&mut bytes, 70, params.color_d[2]);
    write_f32_le(&mut bytes, 71, params.contact_ao);
    write_u32_le(&mut bytes, 72, params.shadow_steps);
    write_u32_le(&mut bytes, 73, params.march_steps);
    write_u32_le(&mut bytes, 74, tile_count_x);
    write_u32_le(&mut bytes, 75, tile_count_y);
    write_f32_le(&mut bytes, 76, params.rider_size);
    write_f32_le(&mut bytes, 77, params.ambient);
    write_f32_le(&mut bytes, 78, params.vignette);
    write_f32_le(&mut bytes, 79, params.background_mode);
    // Wrapped: the march offset only needs the frame's phase, and a u32
    // that has been counting for hours loses fp32 precision inside the
    // shader's f32(frameIndex).
    write_u32_le(&mut bytes, 80, (frame_index % 4096) as u32);
    write_f32_le(&mut bytes, 81, params.tonemap);
    write_f32_le(&mut bytes, 82, params.clear_coat);
    write_f32_le(&mut bytes, 83, params.coat_roughness);
    write_f32_le(&mut bytes, 84, params.iso_level);
    write_f32_le(&mut bytes, 85, params.paint_thickness);
    write_f32_le(&mut bytes, 86, params.color_follow);
    write_f32_le(&mut bytes, 87, params.edge_softness);
    write_f32_le(&mut bytes, 88, params.rider_opacity);
    write_f32_le(&mut bytes, 89, params.reflect_strength);
    write_f32_le(&mut bytes, 90, params.liquid_glass);
    write_f32_le(&mut bytes, 91, params.surface_detail);
    write_f32_le(&mut bytes, 92, params.detail_scale);
    write_f32_le(&mut bytes, 93, time);
    bytes
}

fn build_smoke_riders_initial_rider_bytes(params: &NativeSmokeRidersParams) -> Vec<u8> {
    let rider_count = params
        .rider_count
        .clamp(SMOKE_RIDERS_MIN_COUNT, SMOKE_RIDERS_MAX_COUNT);
    let stride = SMOKE_RIDERS_STRIDE_FLOATS as usize;
    let mut bytes = vec![0_u8; rider_count as usize * stride * 4];
    let bx = params.volume_scale_x;
    let bz = params.volume_scale_z;
    for index in 0..rider_count as usize {
        let seed = index as f32 * 0.618_034 + 0.137;
        let s1 = smoke_riders_hash(seed * 3.17 + 1.7);
        let s2 = smoke_riders_hash(seed * 7.31 + 4.1);
        let s3 = smoke_riders_hash(seed * 11.93 + 8.3);
        let s4 = smoke_riders_hash(seed * 23.1 + 3.3);
        let s5 = smoke_riders_hash(seed * 13.3 + 0.9);
        let angle = s1 * std::f32::consts::TAU;
        let z = s2 * 2.0 - 1.0;
        let planar = (1.0_f32 - z * z).max(0.0).sqrt();
        let r = s3.powf(0.4);
        let off = index * stride;
        write_f32_le(&mut bytes, off, angle.cos() * planar * r * bx * 0.34);
        write_f32_le(&mut bytes, off + 1, params.spawn_y + z * r * 0.3);
        write_f32_le(&mut bytes, off + 2, angle.sin() * planar * r * bz * 0.34);
        write_f32_le(
            &mut bytes,
            off + 3,
            0.45 + s4.powf(1.7) * (0.35 + params.rider_size_variance * 1.9),
        );
        // Slot 7 (τ) is derived from radius + seed by cs_riders on every
        // step, so the seeded value is only a placeholder. Leaving it
        // zero keeps this buffer byte-identical to the TS builder's with
        // no shared formula to drift.
        write_f32_le(&mut bytes, off + 8, seed);
        write_f32_le(&mut bytes, off + 9, s5);
        write_f32_le(&mut bytes, off + 10, params.rider_life * (0.2 + s2 * 1.1));
        // Seeded riders start fully faded IN; only recycled riders ramp.
        write_f32_le(&mut bytes, off + 11, 1.0);
    }
    bytes
}

#[derive(Clone, Debug)]
struct NativeSmoke3DParams {
    grid_size: u32,
    emission: f32,
    density: f32,
    velocity_decay: f32,
    density_decay: f32,
    emitter_count: u32,
    spread: f32,
    spawn_y: f32,
    splat_radius: f32,
    splat_strength: f32,
    splat_velocity_mag: f32,
    splat_rate: f32,
    bass: f32,
    audio_burst: f32,
    emitter_colors: [[f32; 3]; SMOKE_3D_MAX_EMITTERS],
    volume_scale_x: f32,
    volume_scale_z: f32,
    wind: [f32; 3],
    turb_strength: f32,
    turb_scale: f32,
    fov_deg: f32,
    camera_z: f32,
    rotate: [f32; 3],
    auto_rotate_x: f32,
    auto_rotate_y: f32,
    auto_rotate_z: f32,
    fog_color: [f32; 3],
    fog_opacity: f32,
    light_dir: [f32; 3],
    light_strength: f32,
    light_color: [f32; 3],
    ambient: f32,
    shadow_steps: u32,
    shadow_step_len: f32,
}

fn smoke_3d_default_emitter_colors() -> [[f32; 3]; SMOKE_3D_MAX_EMITTERS] {
    [
        [1.00, 0.40, 0.18],
        [0.18, 0.78, 1.00],
        [0.85, 0.20, 0.85],
        [0.20, 0.95, 0.55],
        [1.00, 0.85, 0.30],
        [0.50, 0.30, 1.00],
        [1.00, 0.30, 0.55],
        [0.30, 1.00, 0.95],
    ]
}

fn smoke_3d_grid_size(params: &Value) -> u32 {
    match native_graph_param_u32(params, "gridSize", 32, 64, 48) {
        32 => 32,
        64 => 64,
        _ => 48,
    }
}

fn normalize_smoke_3d_native_params(params: &Value) -> NativeSmoke3DParams {
    let defaults = smoke_3d_default_emitter_colors();
    let mut emitter_colors = defaults;
    for index in 0..SMOKE_3D_MAX_EMITTERS {
        emitter_colors[index] = native_graph_param_emitter_color(params, index, defaults[index]);
    }
    NativeSmoke3DParams {
        grid_size: smoke_3d_grid_size(params),
        emission: native_graph_param_f32(params, "emission", 0.0, 16.0, 2.5),
        density: native_graph_param_f32(params, "density", 0.0, 16.0, 3.0),
        velocity_decay: native_graph_param_f32(params, "velocityDecay", 0.0, 1.0, 0.985),
        density_decay: native_graph_param_f32(params, "densityDecay", 0.0, 1.0, 0.992),
        emitter_count: native_graph_param_u32(
            params,
            "emitterCount",
            1,
            SMOKE_3D_MAX_EMITTERS as u32,
            4,
        ),
        spread: native_graph_param_f32(params, "spread", 0.0, 1.0, 0.3),
        spawn_y: native_graph_param_f32(params, "spawnY", -1.0, 1.0, -0.5),
        splat_radius: native_graph_param_f32(params, "splatRadius", 0.001, 0.5, 0.10),
        splat_strength: native_graph_param_f32(params, "splatStrength", 0.0, 32.0, 3.0),
        splat_velocity_mag: native_graph_param_f32(params, "splatVelocityMag", -16.0, 16.0, 0.6),
        splat_rate: native_graph_param_f32(params, "splatRate", 0.1, 240.0, 60.0),
        bass: native_graph_param_f32(params, "bass", 0.0, 1.0, 0.0),
        audio_burst: native_graph_param_f32(params, "audioBurst", 0.0, 8.0, 0.5),
        emitter_colors,
        volume_scale_x: native_graph_param_f32(params, "volumeScaleX", 0.05, 8.0, 1.6),
        volume_scale_z: native_graph_param_f32(params, "volumeScaleZ", 0.05, 8.0, 1.0),
        wind: [
            native_graph_param_f32(params, "windX", -8.0, 8.0, 0.0),
            native_graph_param_f32(params, "windY", -8.0, 8.0, 0.0),
            native_graph_param_f32(params, "windZ", -8.0, 8.0, 0.0),
        ],
        turb_strength: native_graph_param_f32(params, "turbStrength", 0.0, 16.0, 0.5),
        turb_scale: native_graph_param_f32(params, "turbScale", 0.01, 64.0, 2.5),
        fov_deg: native_graph_param_f32(params, "fovDeg", 10.0, 140.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.1, 40.0, 2.7),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate_x: native_graph_param_f32(params, "autoRotateX", -720.0, 720.0, 0.0),
        auto_rotate_y: native_graph_param_f32(params, "autoRotateY", -720.0, 720.0, 0.0),
        auto_rotate_z: native_graph_param_f32(params, "autoRotateZ", -720.0, 720.0, 0.0),
        fog_color: native_graph_param_rgb(params, "fogColor", [0.08, 0.10, 0.18]),
        fog_opacity: native_graph_param_f32(params, "fogOpacity", 0.0, 1.0, 1.0),
        light_dir: [
            native_graph_param_f32(params, "lightDirX", -8.0, 8.0, 0.4),
            native_graph_param_f32(params, "lightDirY", -8.0, 8.0, 0.6),
            native_graph_param_f32(params, "lightDirZ", -8.0, 8.0, 0.7),
        ],
        light_strength: native_graph_param_f32(params, "lightStrength", 0.0, 16.0, 0.8),
        light_color: native_graph_param_rgb(params, "lightColor", [1.0, 0.95, 0.85]),
        ambient: native_graph_param_f32(params, "ambient", 0.0, 8.0, 0.25),
        shadow_steps: native_graph_param_u32(params, "shadowSteps", 0, 16, 4),
        shadow_step_len: native_graph_param_f32(params, "shadowStepLen", 0.0, 2.0, 0.06),
    }
}

fn build_smoke_3d_sim_uniform_bytes(
    params: &NativeSmoke3DParams,
    dt: f32,
    time: f32,
    fire: bool,
    burst_mul: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 96];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_u32_le(&mut bytes, 3, params.emitter_count);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, time);
    write_f32_le(&mut bytes, 6, if fire { burst_mul } else { 0.0 });
    write_f32_le(&mut bytes, 8, params.density_decay);
    write_f32_le(&mut bytes, 9, params.velocity_decay);
    write_f32_le(&mut bytes, 10, params.splat_radius);
    write_f32_le(&mut bytes, 12, params.wind[0]);
    write_f32_le(&mut bytes, 13, params.wind[1]);
    write_f32_le(&mut bytes, 14, params.wind[2]);
    write_f32_le(&mut bytes, 15, params.turb_strength);
    write_f32_le(&mut bytes, 16, params.turb_scale);
    bytes
}

fn build_smoke_3d_emitters_bytes(params: &NativeSmoke3DParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; SMOKE_3D_MAX_EMITTERS * 48];
    let emitter_count = params.emitter_count.clamp(1, SMOKE_3D_MAX_EMITTERS as u32) as f32;
    for index in 0..SMOKE_3D_MAX_EMITTERS {
        let off = index * 12;
        if index as f32 >= emitter_count {
            continue;
        }
        let angle = if emitter_count > 1.0 {
            index as f32 / emitter_count * std::f32::consts::TAU
        } else {
            0.0
        };
        let color = params.emitter_colors[index % params.emitter_colors.len()];
        write_f32_le(&mut bytes, off, angle.cos() * params.spread * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 1, params.spawn_y * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 2, angle.sin() * params.spread * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 3, params.splat_radius);
        write_f32_le(&mut bytes, off + 4, color[0]);
        write_f32_le(&mut bytes, off + 5, color[1]);
        write_f32_le(&mut bytes, off + 6, color[2]);
        write_f32_le(&mut bytes, off + 7, params.splat_strength);
        write_f32_le(
            &mut bytes,
            off + 8,
            angle.cos() * params.splat_velocity_mag * 0.3,
        );
        write_f32_le(&mut bytes, off + 9, params.splat_velocity_mag);
        write_f32_le(
            &mut bytes,
            off + 10,
            angle.sin() * params.splat_velocity_mag * 0.3,
        );
    }
    bytes
}

fn build_smoke_3d_render_uniform_bytes(
    params: &NativeSmoke3DParams,
    state: &NativeSmoke3DGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let proj = native_perspective(params.fov_deg, aspect, 0.01, 100.0);
    let view = native_translate(0.0, 0.0, -params.camera_z);
    let model = native_mat4_mul(
        native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
        native_mat4_mul(
            native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
        ),
    );
    let view_proj = native_mat4_mul(proj, native_mat4_mul(view, model));
    let inv_view_proj = native_mat4_invert(view_proj);
    let mut bytes = vec![0_u8; 192];
    for (index, value) in inv_view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, 0.0);
    write_f32_le(&mut bytes, 17, 0.0);
    write_f32_le(&mut bytes, 18, params.camera_z);
    write_f32_le(&mut bytes, 19, params.emission);
    write_f32_le(&mut bytes, 20, params.volume_scale_x);
    write_f32_le(&mut bytes, 21, 1.0);
    write_f32_le(&mut bytes, 22, params.volume_scale_z);
    write_f32_le(&mut bytes, 23, params.density);
    write_f32_le(&mut bytes, 24, params.fog_color[0]);
    write_f32_le(&mut bytes, 25, params.fog_color[1]);
    write_f32_le(&mut bytes, 26, params.fog_color[2]);
    write_f32_le(&mut bytes, 27, params.fog_opacity);
    write_u32_le(&mut bytes, 28, params.grid_size);
    write_u32_le(&mut bytes, 29, params.grid_size);
    write_u32_le(&mut bytes, 30, params.grid_size);
    let light = native_vec3_normalize(params.light_dir, [0.4, 0.6, 0.7]);
    write_f32_le(&mut bytes, 32, light[0]);
    write_f32_le(&mut bytes, 33, light[1]);
    write_f32_le(&mut bytes, 34, light[2]);
    write_f32_le(&mut bytes, 35, params.light_strength);
    write_f32_le(&mut bytes, 36, params.light_color[0]);
    write_f32_le(&mut bytes, 37, params.light_color[1]);
    write_f32_le(&mut bytes, 38, params.light_color[2]);
    write_f32_le(&mut bytes, 39, params.ambient);
    write_u32_le(&mut bytes, 40, params.shadow_steps);
    write_f32_le(&mut bytes, 41, params.shadow_step_len);
    bytes
}

#[derive(Clone, Debug)]
struct NativeVolumetricSpheresParams {
    sphere_count: u32,
    layout: String,
    layout_id: u32,
    radius_scale: f32,
    radius_variance: f32,
    spread: f32,
    depth: f32,
    motion: f32,
    swirl: f32,
    pull: f32,
    chaos: f32,
    damping: f32,
    opacity: f32,
    fog_density: f32,
    background_opacity: f32,
    fog_color: [f32; 3],
    color_a: [f32; 3],
    color_b: [f32; 3],
    color_c: [f32; 3],
    color_d: [f32; 3],
    color_cycle: f32,
    saturation: f32,
    brightness: f32,
    ambient: f32,
    diffuse: f32,
    specular: f32,
    shininess: f32,
    reflection: f32,
    rim: f32,
    light: [f32; 3],
    light_strength: f32,
    audio_reactive: bool,
    bass: f32,
    treble: f32,
    bass_pulse: f32,
    treble_sparkle: f32,
    fov_deg: f32,
    camera_z: f32,
    rotate: [f32; 3],
    auto_rotate_x: f32,
    auto_rotate_y: f32,
    auto_rotate_z: f32,
}

fn volumetric_spheres_layout_id(layout: &str) -> u32 {
    match layout.trim().to_ascii_lowercase().as_str() {
        "orbital" => 1,
        "column" => 2,
        "cavern" => 3,
        _ => 0,
    }
}

fn volumetric_spheres_layout_label(layout_id: u32) -> &'static str {
    match layout_id {
        1 => "orbital",
        2 => "column",
        3 => "cavern",
        _ => "cluster",
    }
}

fn normalize_volumetric_spheres_native_params(params: &Value) -> NativeVolumetricSpheresParams {
    let layout = params
        .get("layout")
        .and_then(Value::as_str)
        .unwrap_or("cluster")
        .trim()
        .to_ascii_lowercase();
    let layout_id = volumetric_spheres_layout_id(&layout);
    NativeVolumetricSpheresParams {
        sphere_count: native_graph_param_u32(
            params,
            "sphereCount",
            VOLUMETRIC_SPHERES_MIN,
            VOLUMETRIC_SPHERES_MAX,
            192,
        ),
        layout: volumetric_spheres_layout_label(layout_id).to_string(),
        layout_id,
        radius_scale: native_graph_param_f32(params, "radiusScale", 0.001, 2.0, 0.085),
        radius_variance: native_graph_param_f32(params, "radiusVariance", 0.0, 4.0, 0.72),
        spread: native_graph_param_f32(params, "spread", 0.01, 16.0, 1.08),
        depth: native_graph_param_f32(params, "depth", 0.01, 16.0, 1.35),
        motion: native_graph_param_f32(params, "motion", 0.0, 16.0, 0.72),
        swirl: native_graph_param_f32(params, "swirl", -16.0, 16.0, 0.58),
        pull: native_graph_param_f32(params, "pull", -16.0, 16.0, 0.28),
        chaos: native_graph_param_f32(params, "chaos", 0.0, 16.0, 0.34),
        damping: native_graph_param_f32(params, "damping", 0.0, 32.0, 1.7),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 4.0, 0.96),
        fog_density: native_graph_param_f32(params, "fogDensity", 0.0, 16.0, 0.38),
        background_opacity: native_graph_param_f32(params, "backgroundOpacity", 0.0, 1.0, 0.88),
        fog_color: native_graph_param_rgb(
            params,
            "fogColor",
            [8.0 / 255.0, 10.0 / 255.0, 20.0 / 255.0],
        ),
        color_a: native_graph_param_rgb(params, "colorA", [70.0 / 255.0, 170.0 / 255.0, 1.0]),
        color_b: native_graph_param_rgb(params, "colorB", [1.0, 78.0 / 255.0, 166.0 / 255.0]),
        color_c: native_graph_param_rgb(params, "colorC", [1.0, 218.0 / 255.0, 94.0 / 255.0]),
        color_d: native_graph_param_rgb(params, "colorD", [84.0 / 255.0, 1.0, 214.0 / 255.0]),
        color_cycle: native_graph_param_f32(params, "colorCycle", -16.0, 16.0, 0.018),
        saturation: native_graph_param_f32(params, "saturation", 0.0, 8.0, 1.08),
        brightness: native_graph_param_f32(params, "brightness", 0.0, 16.0, 1.12),
        ambient: native_graph_param_f32(params, "ambient", 0.0, 8.0, 0.24),
        diffuse: native_graph_param_f32(params, "diffuse", 0.0, 8.0, 1.08),
        specular: native_graph_param_f32(params, "specular", 0.0, 16.0, 0.9),
        shininess: native_graph_param_f32(params, "shininess", 1.0, 512.0, 78.0),
        reflection: native_graph_param_f32(params, "reflection", 0.0, 8.0, 0.22),
        rim: native_graph_param_f32(params, "rim", 0.0, 8.0, 0.46),
        light: [
            native_graph_param_f32(params, "lightX", -16.0, 16.0, -0.55),
            native_graph_param_f32(params, "lightY", -16.0, 16.0, 0.8),
            native_graph_param_f32(params, "lightZ", -16.0, 16.0, 1.0),
        ],
        light_strength: native_graph_param_f32(params, "lightStrength", 0.0, 16.0, 1.1),
        audio_reactive: native_graph_param_bool(params, "audioReactive", true),
        bass: native_graph_param_f32(params, "bass", 0.0, 2.0, 0.0),
        treble: native_graph_param_f32(params, "treble", 0.0, 2.0, 0.0),
        bass_pulse: native_graph_param_f32(params, "bassPulse", 0.0, 16.0, 1.15),
        treble_sparkle: native_graph_param_f32(params, "trebleSparkle", 0.0, 16.0, 0.32),
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 48.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.05, 100.0, 2.75),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, -4.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate_x: native_graph_param_f32(params, "autoRotateX", -3600.0, 3600.0, -0.3),
        auto_rotate_y: native_graph_param_f32(params, "autoRotateY", -3600.0, 3600.0, 4.4),
        auto_rotate_z: native_graph_param_f32(params, "autoRotateZ", -3600.0, 3600.0, 0.15),
    }
}

fn volumetric_spheres_seed_key(params: &NativeVolumetricSpheresParams) -> String {
    format!(
        "{}|{}|{:.6}|{:.6}|{:.6}|{:.6},{:.6},{:.6}|{:.6},{:.6},{:.6}|{:.6},{:.6},{:.6}|{:.6},{:.6},{:.6}",
        params.sphere_count,
        params.layout,
        params.radius_variance,
        params.spread,
        params.depth,
        params.color_a[0],
        params.color_a[1],
        params.color_a[2],
        params.color_b[0],
        params.color_b[1],
        params.color_b[2],
        params.color_c[0],
        params.color_c[1],
        params.color_c[2],
        params.color_d[0],
        params.color_d[1],
        params.color_d[2],
    )
}

fn volumetric_spheres_hash(value: f32) -> f32 {
    let x = (value as f64 * 12.9898).sin() * 43758.5453;
    (x - x.floor()) as f32
}

fn volumetric_spheres_random_unit(a: f32, b: f32, c: f32) -> [f32; 3] {
    let theta = a * std::f32::consts::TAU;
    let z = b * 2.0 - 1.0;
    let r = (1.0 - z * z).max(0.0).sqrt();
    let squash = 0.72 + c * 0.36;
    [theta.cos() * r, z * squash, theta.sin() * r]
}

fn build_volumetric_spheres_initial_buffer_bytes(
    params: &NativeVolumetricSpheresParams,
) -> Vec<u8> {
    let sphere_count = params
        .sphere_count
        .clamp(VOLUMETRIC_SPHERES_MIN, VOLUMETRIC_SPHERES_MAX) as usize;
    let mut bytes = vec![0_u8; sphere_count * VOLUMETRIC_SPHERES_STRIDE_FLOATS * 4];
    let colors = [
        params.color_a,
        params.color_b,
        params.color_c,
        params.color_d,
    ];
    for i in 0..sphere_count {
        let seed = volumetric_spheres_hash(i as f32 * 17.13 + 9.7);
        let seed2 = volumetric_spheres_hash(i as f32 * 43.91 + 2.3);
        let seed3 = volumetric_spheres_hash(i as f32 * 71.17 + 5.9);
        let (x, y, z) = match params.layout_id {
            1 => {
                let ring = (i % 5) as f32;
                let a = (i as f32 / sphere_count.max(1) as f32
                    * std::f32::consts::TAU
                    * (2.5 + ring * 0.23))
                    + seed * std::f32::consts::TAU;
                let r = 0.24 + ring * 0.17 + seed2 * 0.18;
                (
                    a.cos() * r,
                    (ring - 2.0) * 0.12 + (seed2 - 0.5) * 0.18,
                    a.sin() * r * (0.74 + seed3 * 0.32),
                )
            }
            2 => {
                let a = seed * std::f32::consts::TAU;
                let r = seed2.powf(0.65) * 0.52;
                (
                    a.cos() * r,
                    (i as f32 / sphere_count.saturating_sub(1).max(1) as f32 - 0.5) * 1.8
                        + (seed3 - 0.5) * 0.18,
                    a.sin() * r * 0.7,
                )
            }
            3 => {
                let dir = volumetric_spheres_random_unit(seed, seed2, seed3);
                let shell = 0.62 + seed.powf(2.0) * 0.3;
                (dir[0] * shell, dir[1] * shell * 0.72, dir[2] * shell)
            }
            _ => {
                let dir = volumetric_spheres_random_unit(seed, seed2, seed3);
                let r = volumetric_spheres_hash(i as f32 * 11.31 + 4.2).powf(0.42);
                (dir[0] * r, dir[1] * r * 0.76, dir[2] * r)
            }
        };
        let radius_jitter = 0.55
            + volumetric_spheres_hash(i as f32 * 29.71 + 1.1).powf(1.8)
                * (0.65 + params.radius_variance * 1.75);
        let color = colors[i % colors.len()];
        let off = i * VOLUMETRIC_SPHERES_STRIDE_FLOATS;
        write_f32_le(&mut bytes, off, x * params.spread);
        write_f32_le(&mut bytes, off + 1, y * params.spread);
        write_f32_le(&mut bytes, off + 2, z * params.depth);
        write_f32_le(&mut bytes, off + 3, radius_jitter);
        write_f32_le(&mut bytes, off + 4, (seed2 - 0.5) * 0.04);
        write_f32_le(&mut bytes, off + 5, (seed3 - 0.5) * 0.04);
        write_f32_le(&mut bytes, off + 6, (seed - 0.5) * 0.04);
        write_f32_le(&mut bytes, off + 7, seed);
        write_f32_le(&mut bytes, off + 8, color[0]);
        write_f32_le(&mut bytes, off + 9, color[1]);
        write_f32_le(&mut bytes, off + 10, color[2]);
        write_f32_le(&mut bytes, off + 11, (i % 16) as f32);
    }
    bytes
}

fn build_volumetric_spheres_sim_uniform_bytes(
    params: &NativeVolumetricSpheresParams,
    dt: f32,
    time: f32,
    bass: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 80];
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_u32_le(&mut bytes, 2, params.sphere_count);
    write_u32_le(&mut bytes, 3, params.layout_id);
    write_f32_le(&mut bytes, 4, (params.spread * 1.24).max(0.2));
    write_f32_le(&mut bytes, 5, (params.spread * 0.92).max(0.2));
    write_f32_le(&mut bytes, 6, (params.depth * 1.16).max(0.2));
    write_f32_le(&mut bytes, 7, params.motion);
    write_f32_le(&mut bytes, 8, params.swirl);
    write_f32_le(&mut bytes, 9, params.pull);
    write_f32_le(&mut bytes, 10, 0.65 + params.chaos * 0.75);
    write_f32_le(&mut bytes, 11, params.damping);
    write_f32_le(&mut bytes, 12, bass);
    write_f32_le(&mut bytes, 13, treble);
    write_f32_le(&mut bytes, 14, params.bass_pulse);
    write_f32_le(&mut bytes, 15, params.chaos);
    bytes
}

fn build_volumetric_spheres_render_uniform_bytes(
    params: &NativeVolumetricSpheresParams,
    state: &NativeVolumetricSpheresGraphState,
    width: u32,
    height: u32,
    time: f32,
    bass: f32,
    treble: f32,
) -> Vec<u8> {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let proj = native_perspective(params.fov_deg, aspect, 0.05, 100.0);
    let view = native_translate(0.0, 0.0, -params.camera_z);
    let model = native_mat4_mul(
        native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
        native_mat4_mul(
            native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
        ),
    );
    let view_proj = native_mat4_mul(proj, view);
    let light = native_vec3_normalize(params.light, [-0.55, 0.8, 1.0]);
    let mut bytes = vec![0_u8; 320];
    for (index, value) in view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    for (index, value) in model.iter().enumerate() {
        write_f32_le(&mut bytes, 16 + index, *value);
    }
    write_f32_le(&mut bytes, 32, 0.0);
    write_f32_le(&mut bytes, 33, 0.0);
    write_f32_le(&mut bytes, 34, params.camera_z);
    write_f32_le(&mut bytes, 35, params.radius_scale);
    write_f32_le(&mut bytes, 36, 1.0);
    write_f32_le(&mut bytes, 37, 0.0);
    write_f32_le(&mut bytes, 38, 0.0);
    write_f32_le(&mut bytes, 39, params.opacity);
    write_f32_le(&mut bytes, 40, 0.0);
    write_f32_le(&mut bytes, 41, 1.0);
    write_f32_le(&mut bytes, 42, 0.0);
    write_f32_le(&mut bytes, 43, time);
    write_f32_le(&mut bytes, 44, light[0]);
    write_f32_le(&mut bytes, 45, light[1]);
    write_f32_le(&mut bytes, 46, light[2]);
    write_f32_le(&mut bytes, 47, params.light_strength);
    write_f32_le(&mut bytes, 48, params.fog_color[0]);
    write_f32_le(&mut bytes, 49, params.fog_color[1]);
    write_f32_le(&mut bytes, 50, params.fog_color[2]);
    write_f32_le(&mut bytes, 51, params.fog_density);
    write_f32_le(&mut bytes, 52, params.ambient);
    write_f32_le(&mut bytes, 53, params.diffuse);
    write_f32_le(&mut bytes, 54, params.specular);
    write_f32_le(&mut bytes, 55, params.shininess);
    write_f32_le(&mut bytes, 56, params.reflection);
    write_f32_le(&mut bytes, 57, params.rim);
    write_f32_le(&mut bytes, 58, 1.0 + bass.max(0.0) * 0.08);
    write_f32_le(&mut bytes, 59, treble);
    write_f32_le(&mut bytes, 60, params.color_a[0]);
    write_f32_le(&mut bytes, 61, params.color_a[1]);
    write_f32_le(&mut bytes, 62, params.color_a[2]);
    write_f32_le(&mut bytes, 63, params.color_cycle);
    write_f32_le(&mut bytes, 64, params.color_b[0]);
    write_f32_le(&mut bytes, 65, params.color_b[1]);
    write_f32_le(&mut bytes, 66, params.color_b[2]);
    write_f32_le(&mut bytes, 67, params.saturation);
    write_f32_le(&mut bytes, 68, params.color_c[0]);
    write_f32_le(&mut bytes, 69, params.color_c[1]);
    write_f32_le(&mut bytes, 70, params.color_c[2]);
    write_f32_le(&mut bytes, 71, params.brightness);
    write_f32_le(&mut bytes, 72, params.color_d[0]);
    write_f32_le(&mut bytes, 73, params.color_d[1]);
    write_f32_le(&mut bytes, 74, params.color_d[2]);
    write_f32_le(&mut bytes, 75, bass);
    bytes
}

fn volumetric_spheres_clear_color(params: &NativeVolumetricSpheresParams) -> [f64; 4] {
    let opacity = params.background_opacity.clamp(0.0, 1.0);
    [
        (params.fog_color[0] * opacity) as f64,
        (params.fog_color[1] * opacity) as f64,
        (params.fog_color[2] * opacity) as f64,
        opacity as f64,
    ]
}

#[derive(Clone, Debug)]
struct NativeInkCloudParams {
    particle_count: u32,
    emitter_count: u32,
    spread: f32,
    spawn_y: f32,
    spawn_jitter: f32,
    avg_lifetime: f32,
    lifetime_var: f32,
    size_start: f32,
    size_end: f32,
    fade_color: [f32; 3],
    color_fade_amount: f32,
    buoyancy: f32,
    damping: f32,
    wind: [f32; 3],
    curl1_strength: f32,
    curl1_scale: f32,
    curl1_time_flow: f32,
    curl2_strength: f32,
    curl2_scale: f32,
    curl2_time_flow: f32,
    vortex_enabled: bool,
    vortex_strength: f32,
    vortex_radius: f32,
    vortex_axis: [f32; 3],
    bass: f32,
    treble: f32,
    audio_burst_strength: f32,
    shimmer_strength: f32,
    brightness: f32,
    alpha_scale: f32,
    density: f32,
    bg_color: [f32; 3],
    bg_opacity: f32,
    emitter_colors: [[f32; 3]; INK_CLOUD_MAX_EMITTERS],
    fov_deg: f32,
    camera_z: f32,
    rotate: [f32; 3],
    auto_rotate_x: f32,
    auto_rotate_y: f32,
    auto_rotate_z: f32,
    audio_reactive: bool,
}

fn native_graph_param_bool(params: &Value, key: &str, fallback: bool) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn native_graph_param_u32(params: &Value, key: &str, min: u32, max: u32, fallback: u32) -> u32 {
    params
        .get(key)
        .and_then(Value::as_f64)
        .map(|value| value.round().clamp(min as f64, max as f64) as u32)
        .unwrap_or(fallback)
        .clamp(min, max)
}

fn ink_cloud_default_emitter_colors() -> [[f32; 3]; INK_CLOUD_MAX_EMITTERS] {
    [
        [1.00, 0.40, 0.18],
        [0.18, 0.78, 1.00],
        [0.85, 0.20, 0.85],
        [0.20, 0.95, 0.55],
        [1.00, 0.85, 0.30],
        [0.50, 0.30, 1.00],
        [1.00, 0.30, 0.55],
        [0.30, 1.00, 0.95],
    ]
}

fn native_graph_param_emitter_color(params: &Value, index: usize, fallback: [f32; 3]) -> [f32; 3] {
    let keyed = format!("emitterColor{}", index + 1);
    if let Some(color) = color_path_or(params, &[keyed.as_str()]) {
        return color;
    }
    params
        .get("emitterColors")
        .and_then(Value::as_array)
        .and_then(|colors| colors.get(index))
        .and_then(|color| {
            if let Some(text) = color.as_str() {
                return parse_hex_color(text);
            }
            let values = color.as_array()?;
            Some([
                json_channel_to_unit(values.first()?),
                json_channel_to_unit(values.get(1)?),
                json_channel_to_unit(values.get(2)?),
            ])
        })
        .unwrap_or(fallback)
}

fn normalize_ink_cloud_native_params(params: &Value) -> NativeInkCloudParams {
    let defaults = ink_cloud_default_emitter_colors();
    let mut emitter_colors = defaults;
    for index in 0..INK_CLOUD_MAX_EMITTERS {
        emitter_colors[index] = native_graph_param_emitter_color(params, index, defaults[index]);
    }
    NativeInkCloudParams {
        particle_count: native_graph_param_u32(
            params,
            "particleCount",
            1024,
            INK_CLOUD_MAX_PARTICLES,
            INK_CLOUD_DEFAULT_PARTICLES,
        ),
        emitter_count: native_graph_param_u32(params, "emitterCount", 1, 8, 4),
        spread: native_graph_param_f32(params, "spread", 0.0, 16.0, 0.4),
        spawn_y: native_graph_param_f32(params, "spawnY", -16.0, 16.0, -0.4),
        spawn_jitter: native_graph_param_f32(params, "spawnJitter", 0.0, 4.0, 0.04),
        avg_lifetime: native_graph_param_f32(params, "avgLifetime", 0.05, 60.0, 3.0),
        lifetime_var: native_graph_param_f32(params, "lifetimeVar", 0.0, 4.0, 0.3),
        size_start: native_graph_param_f32(params, "sizeStart", 0.0001, 2.0, 0.008),
        size_end: native_graph_param_f32(params, "sizeEnd", 0.0001, 4.0, 0.05),
        fade_color: native_graph_param_rgb(params, "fadeColor", [0.04, 0.05, 0.10]),
        color_fade_amount: native_graph_param_f32(params, "colorFadeAmount", 0.0, 4.0, 1.0),
        buoyancy: native_graph_param_f32(params, "buoyancy", -16.0, 16.0, 0.18),
        damping: native_graph_param_f32(params, "damping", 0.0, 32.0, 0.6),
        wind: [
            native_graph_param_f32(params, "windX", -16.0, 16.0, 0.0),
            native_graph_param_f32(params, "windY", -16.0, 16.0, 0.0),
            native_graph_param_f32(params, "windZ", -16.0, 16.0, 0.0),
        ],
        curl1_strength: native_graph_param_f32(params, "curl1Strength", 0.0, 16.0, 0.3),
        curl1_scale: native_graph_param_f32(params, "curl1Scale", 0.01, 64.0, 1.6),
        curl1_time_flow: native_graph_param_f32(params, "curl1TimeFlow", 0.0, 16.0, 0.15),
        curl2_strength: native_graph_param_f32(params, "curl2Strength", 0.0, 16.0, 0.18),
        curl2_scale: native_graph_param_f32(params, "curl2Scale", 0.01, 128.0, 5.0),
        curl2_time_flow: native_graph_param_f32(params, "curl2TimeFlow", 0.0, 16.0, 0.4),
        vortex_enabled: native_graph_param_bool(params, "vortexEnabled", false),
        vortex_strength: native_graph_param_f32(params, "vortexStrength", 0.0, 32.0, 0.6),
        vortex_radius: native_graph_param_f32(params, "vortexRadius", 0.001, 32.0, 0.5),
        vortex_axis: [
            native_graph_param_f32(params, "vortexAxisX", -16.0, 16.0, 0.0),
            native_graph_param_f32(params, "vortexAxisY", -16.0, 16.0, 1.0),
            native_graph_param_f32(params, "vortexAxisZ", -16.0, 16.0, 0.0),
        ],
        bass: native_graph_param_f32(params, "bass", 0.0, 4.0, 0.0),
        treble: native_graph_param_f32(params, "treble", 0.0, 4.0, 0.0),
        audio_burst_strength: native_graph_param_f32(params, "audioBurstStrength", 0.0, 4.0, 0.3),
        shimmer_strength: native_graph_param_f32(params, "shimmerStrength", 0.0, 4.0, 0.04),
        brightness: native_graph_param_f32(params, "brightness", 0.0, 16.0, 1.2),
        alpha_scale: native_graph_param_f32(params, "alphaScale", 0.0, 8.0, 0.55),
        density: native_graph_param_f32(params, "density", 0.01, 64.0, 2.5),
        bg_color: native_graph_param_rgb(params, "bgColor", [0.04, 0.04, 0.08]),
        bg_opacity: native_graph_param_f32(params, "bgOpacity", 0.0, 1.0, 1.0),
        emitter_colors,
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.05, 100.0, 2.4),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate_x: native_graph_param_f32(params, "autoRotateX", -3600.0, 3600.0, 0.0),
        auto_rotate_y: native_graph_param_f32(params, "autoRotateY", -3600.0, 3600.0, 0.0),
        auto_rotate_z: native_graph_param_f32(params, "autoRotateZ", -3600.0, 3600.0, 0.0),
        audio_reactive: native_graph_param_bool(params, "audioReactive", true),
    }
}

fn ink_cloud_seed_key(params: &NativeInkCloudParams) -> String {
    format!(
        "{}|{}|{:.4}|{:.4}|{:.4}|{:.4}",
        params.particle_count,
        params.emitter_count,
        params.avg_lifetime,
        params.size_start,
        params.spread,
        params.spawn_y,
    )
}

fn ink_cloud_hash(value: f32) -> f32 {
    let x = (value as f64 * 12.9898).sin() * 43758.5453;
    (x - x.floor()) as f32
}

fn build_ink_cloud_initial_particle_buffer_bytes(params: &NativeInkCloudParams) -> Vec<u8> {
    let count = params.particle_count.max(1024).min(INK_CLOUD_MAX_PARTICLES) as usize;
    let mut bytes = vec![0_u8; count.saturating_mul(INK_CLOUD_PARTICLE_BYTES as usize)];
    let emitter_count = params.emitter_count.clamp(1, INK_CLOUD_MAX_EMITTERS as u32);
    for i in 0..count {
        let off = i * 16;
        let init_age = ink_cloud_hash(i as f32 * 17.13 + 4.7) * params.avg_lifetime;
        write_f32_le(&mut bytes, off + 3, init_age);
        write_f32_le(&mut bytes, off + 7, params.avg_lifetime);
        write_f32_le(&mut bytes, off + 11, params.size_start);
        write_u32_le(&mut bytes, off + 15, (i as u32) % emitter_count);
    }
    bytes
}

fn build_ink_cloud_emitter_buffer_bytes(params: &NativeInkCloudParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; INK_CLOUD_MAX_EMITTERS * 32];
    let emitter_count = params.emitter_count.clamp(1, INK_CLOUD_MAX_EMITTERS as u32) as f32;
    for index in 0..INK_CLOUD_MAX_EMITTERS {
        let off = index * 8;
        let angle = if emitter_count > 1.0 {
            index as f32 / emitter_count * std::f32::consts::TAU
        } else {
            0.0
        };
        let color = params.emitter_colors[index % params.emitter_colors.len()];
        write_f32_le(&mut bytes, off, angle.cos() * params.spread);
        write_f32_le(&mut bytes, off + 1, params.spawn_y);
        write_f32_le(&mut bytes, off + 2, angle.sin() * params.spread);
        write_f32_le(&mut bytes, off + 4, color[0]);
        write_f32_le(&mut bytes, off + 5, color[1]);
        write_f32_le(&mut bytes, off + 6, color[2]);
    }
    bytes
}

fn build_ink_cloud_sim_uniform_bytes(
    params: &NativeInkCloudParams,
    dt: f32,
    time: f32,
    bass: f32,
    treble: f32,
    audio_burst: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 192];
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_u32_le(&mut bytes, 2, params.particle_count);
    write_u32_le(
        &mut bytes,
        3,
        params.emitter_count.clamp(1, INK_CLOUD_MAX_EMITTERS as u32),
    );
    write_f32_le(&mut bytes, 4, params.avg_lifetime);
    write_f32_le(&mut bytes, 5, params.lifetime_var);
    write_f32_le(&mut bytes, 6, params.size_start);
    write_f32_le(&mut bytes, 7, params.size_end);
    write_f32_le(&mut bytes, 8, params.fade_color[0]);
    write_f32_le(&mut bytes, 9, params.fade_color[1]);
    write_f32_le(&mut bytes, 10, params.fade_color[2]);
    write_f32_le(&mut bytes, 11, params.color_fade_amount);
    write_f32_le(&mut bytes, 12, params.buoyancy);
    write_f32_le(&mut bytes, 13, params.damping);
    write_f32_le(&mut bytes, 14, params.spawn_jitter);
    write_f32_le(&mut bytes, 15, audio_burst);
    write_f32_le(&mut bytes, 16, params.wind[0]);
    write_f32_le(&mut bytes, 17, params.wind[1]);
    write_f32_le(&mut bytes, 18, params.wind[2]);
    write_f32_le(&mut bytes, 20, params.curl1_strength);
    write_f32_le(&mut bytes, 21, params.curl1_scale);
    write_f32_le(&mut bytes, 22, params.curl1_time_flow);
    write_f32_le(&mut bytes, 24, params.curl2_strength);
    write_f32_le(&mut bytes, 25, params.curl2_scale);
    write_f32_le(&mut bytes, 26, params.curl2_time_flow);
    let vortex_enabled = if params.vortex_enabled { 1.0 } else { 0.0 };
    write_f32_le(&mut bytes, 31, params.vortex_strength * vortex_enabled);
    write_f32_le(&mut bytes, 32, params.vortex_axis[0]);
    write_f32_le(&mut bytes, 33, params.vortex_axis[1]);
    write_f32_le(&mut bytes, 34, params.vortex_axis[2]);
    write_f32_le(&mut bytes, 35, params.vortex_radius);
    write_f32_le(&mut bytes, 36, bass);
    write_f32_le(&mut bytes, 37, treble);
    write_f32_le(&mut bytes, 38, params.shimmer_strength);
    bytes
}

fn native_mat4_mul(a: [f32; 16], b: [f32; 16]) -> [f32; 16] {
    let mut out = [0.0_f32; 16];
    for c in 0..4 {
        for r in 0..4 {
            let mut sum = 0.0_f32;
            for k in 0..4 {
                sum += a[k * 4 + r] * b[c * 4 + k];
            }
            out[c * 4 + r] = sum;
        }
    }
    out
}

fn native_mat4_identity() -> [f32; 16] {
    [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]
}

fn native_mat4_invert(m: [f32; 16]) -> [f32; 16] {
    let a00 = m[0];
    let a01 = m[1];
    let a02 = m[2];
    let a03 = m[3];
    let a10 = m[4];
    let a11 = m[5];
    let a12 = m[6];
    let a13 = m[7];
    let a20 = m[8];
    let a21 = m[9];
    let a22 = m[10];
    let a23 = m[11];
    let a30 = m[12];
    let a31 = m[13];
    let a32 = m[14];
    let a33 = m[15];
    let b00 = a00 * a11 - a01 * a10;
    let b01 = a00 * a12 - a02 * a10;
    let b02 = a00 * a13 - a03 * a10;
    let b03 = a01 * a12 - a02 * a11;
    let b04 = a01 * a13 - a03 * a11;
    let b05 = a02 * a13 - a03 * a12;
    let b06 = a20 * a31 - a21 * a30;
    let b07 = a20 * a32 - a22 * a30;
    let b08 = a20 * a33 - a23 * a30;
    let b09 = a21 * a32 - a22 * a31;
    let b10 = a21 * a33 - a23 * a31;
    let b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if det.abs() < 1.0e-12 {
        return native_mat4_identity();
    }
    let inv_det = 1.0 / det;
    [
        (a11 * b11 - a12 * b10 + a13 * b09) * inv_det,
        (a02 * b10 - a01 * b11 - a03 * b09) * inv_det,
        (a31 * b05 - a32 * b04 + a33 * b03) * inv_det,
        (a22 * b04 - a21 * b05 - a23 * b03) * inv_det,
        (a12 * b08 - a10 * b11 - a13 * b07) * inv_det,
        (a00 * b11 - a02 * b08 + a03 * b07) * inv_det,
        (a32 * b02 - a30 * b05 - a33 * b01) * inv_det,
        (a20 * b05 - a22 * b02 + a23 * b01) * inv_det,
        (a10 * b10 - a11 * b08 + a13 * b06) * inv_det,
        (a01 * b08 - a00 * b10 - a03 * b06) * inv_det,
        (a30 * b04 - a31 * b02 + a33 * b00) * inv_det,
        (a21 * b02 - a20 * b04 - a23 * b00) * inv_det,
        (a11 * b07 - a10 * b09 - a12 * b06) * inv_det,
        (a00 * b09 - a01 * b07 + a02 * b06) * inv_det,
        (a31 * b01 - a30 * b03 - a32 * b00) * inv_det,
        (a20 * b03 - a21 * b01 + a22 * b00) * inv_det,
    ]
}

fn native_vec3_normalize(value: [f32; 3], fallback: [f32; 3]) -> [f32; 3] {
    let len = (value[0] * value[0] + value[1] * value[1] + value[2] * value[2]).sqrt();
    if len > 1.0e-6 {
        [value[0] / len, value[1] / len, value[2] / len]
    } else {
        fallback
    }
}

fn native_perspective(fov_deg: f32, aspect: f32, near: f32, far: f32) -> [f32; 16] {
    let f = 1.0 / ((fov_deg.to_radians()) * 0.5).tan();
    let mut m = [0.0_f32; 16];
    m[0] = f / aspect.max(0.0001);
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1.0;
    m[14] = (near * far) / (near - far);
    m
}

fn native_translate(x: f32, y: f32, z: f32) -> [f32; 16] {
    let mut m = [0.0_f32; 16];
    m[0] = 1.0;
    m[5] = 1.0;
    m[10] = 1.0;
    m[15] = 1.0;
    m[12] = x;
    m[13] = y;
    m[14] = z;
    m
}

fn native_rotate_x(rad: f32) -> [f32; 16] {
    let c = rad.cos();
    let s = rad.sin();
    [
        1.0, 0.0, 0.0, 0.0, 0.0, c, s, 0.0, 0.0, -s, c, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]
}

fn native_rotate_y(rad: f32) -> [f32; 16] {
    let c = rad.cos();
    let s = rad.sin();
    [
        c, 0.0, -s, 0.0, 0.0, 1.0, 0.0, 0.0, s, 0.0, c, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]
}

fn native_rotate_z(rad: f32) -> [f32; 16] {
    let c = rad.cos();
    let s = rad.sin();
    [
        c, s, 0.0, 0.0, -s, c, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]
}

fn build_ink_cloud_render_uniform_bytes(
    params: &NativeInkCloudParams,
    state: &NativeInkCloudGraphState,
    width: u32,
    height: u32,
    time: f32,
) -> Vec<u8> {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let proj = native_perspective(params.fov_deg, aspect, 0.05, 100.0);
    let view = native_translate(0.0, 0.0, -params.camera_z);
    let model = native_mat4_mul(
        native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
        native_mat4_mul(
            native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
        ),
    );
    let view_proj = native_mat4_mul(proj, native_mat4_mul(view, model));
    let mut bytes = vec![0_u8; 128];
    for (index, value) in view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, 1.0);
    write_f32_le(&mut bytes, 17, 0.0);
    write_f32_le(&mut bytes, 18, 0.0);
    write_f32_le(&mut bytes, 20, 0.0);
    write_f32_le(&mut bytes, 21, 1.0);
    write_f32_le(&mut bytes, 22, 0.0);
    write_f32_le(&mut bytes, 24, params.brightness);
    write_f32_le(&mut bytes, 25, params.alpha_scale);
    write_f32_le(&mut bytes, 26, params.density);
    write_f32_le(&mut bytes, 27, time);
    bytes
}

fn build_ink_cloud_background_uniform_bytes(params: &NativeInkCloudParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; 16];
    write_f32_le(&mut bytes, 0, params.bg_color[0]);
    write_f32_le(&mut bytes, 1, params.bg_color[1]);
    write_f32_le(&mut bytes, 2, params.bg_color[2]);
    write_f32_le(&mut bytes, 3, params.bg_opacity);
    bytes
}

fn native_graph_binding_layout_signature(bindings: &[NativeComputeGraphBindingSpec]) -> String {
    bindings
        .iter()
        .map(|binding| format!("{}:{}", binding.binding, binding.kind.signature()))
        .collect::<Vec<_>>()
        .join(",")
}

fn choose_source_frame_format(adapter: &wgpu::Adapter) -> wgpu::TextureFormat {
    if !source_frame_hdr_requested() {
        return SOURCE_FRAME_FORMAT_FALLBACK;
    }
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

fn source_frame_hdr_requested() -> bool {
    std::env::var("GHOST_NATIVE_SOURCE_FRAME_HDR")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn choose_source_frame_size(
    limits: &wgpu::Limits,
    features: wgpu::Features,
    format: wgpu::TextureFormat,
    quality_policy: &str,
) -> usize {
    let caps_tier = native_quality_tier(limits, features);
    let tier = source_frame_tier_for_policy(quality_policy, caps_tier);
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

fn source_frame_tier_for_policy(policy: &str, caps_tier: &str) -> &'static str {
    let requested = policy.trim().to_ascii_lowercase();
    let requested_tier = if requested.is_empty() || requested == "auto" {
        // Native v2 is a live instrument first. Start at a real-time source
        // frame tier; explicit quality modes can opt into larger frame stores.
        "performance"
    } else {
        normalize_native_tier(&requested)
    };
    if native_tier_rank(requested_tier) <= native_tier_rank(caps_tier) {
        requested_tier
    } else {
        normalize_native_tier(caps_tier)
    }
}

fn native_tier_rank(tier: &str) -> u8 {
    match normalize_native_tier(tier) {
        "performance" => 0,
        "balanced" => 1,
        "ultra" => 2,
        "insane" => 3,
        _ => 1,
    }
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

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn texture_format_bytes_per_texel(format: wgpu::TextureFormat) -> usize {
    match format {
        wgpu::TextureFormat::Rgba16Float => 8,
        wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm => 4,
        _ => 4,
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn native_output_export_format(output_format: wgpu::TextureFormat) -> wgpu::TextureFormat {
    let _ = output_format;
    wgpu::TextureFormat::Bgra8Unorm
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

#[cfg(target_os = "windows")]
fn dxgi_format_for_wgpu_output(
    format: wgpu::TextureFormat,
) -> windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT {
    match format {
        wgpu::TextureFormat::Rgba8UnormSrgb => {
            windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM_SRGB
        }
        wgpu::TextureFormat::Rgba8Unorm => {
            windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM
        }
        wgpu::TextureFormat::Bgra8UnormSrgb => {
            windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM_SRGB
        }
        _ => windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
    }
}

#[cfg(target_os = "macos")]
/// Storage mode for an IOSurface-backed Metal texture.
///
/// Apple Silicon shares one memory pool between CPU and GPU, so `Shared` is
/// correct and cheapest there. Intel Macs with a discrete GPU have their own
/// VRAM and reject `Shared` for textures — the surface has to be `Managed`.
/// Hardcoding `Shared` therefore works on every Apple Silicon machine and
/// fails on exactly the hardware nobody tests on, with the same silent
/// no-frames symptom as a permission denial.
///
/// Intel Mac support is experimental and unverified on real hardware.
#[cfg(target_os = "macos")]
fn iosurface_texture_storage_mode(has_unified_memory: bool) -> objc2_metal::MTLStorageMode {
    if has_unified_memory {
        objc2_metal::MTLStorageMode::Shared
    } else {
        objc2_metal::MTLStorageMode::Managed
    }
}

#[cfg(target_os = "macos")]
fn metal_texture_format_for_shared_texture(
    descriptor: &SharedTextureSourceFrameDescriptor,
) -> objc2_metal::MTLPixelFormat {
    match descriptor.normalized_format().as_str() {
        "rgba8unorm" | "70" => objc2_metal::MTLPixelFormat::RGBA8Unorm,
        "bgra8unorm" | "80" | "87" => objc2_metal::MTLPixelFormat::BGRA8Unorm,
        _ => objc2_metal::MTLPixelFormat::BGRA8Unorm,
    }
}

fn source_frame_upload_payload<'a>(
    rgba: &'a [u8],
    frame_size: usize,
    format: wgpu::TextureFormat,
) -> (Cow<'a, [u8]>, u32) {
    source_frame_upload_payload_dimensions(rgba, frame_size, frame_size, format)
}

fn source_frame_upload_payload_dimensions<'a>(
    rgba: &'a [u8],
    width: usize,
    height: usize,
    format: wgpu::TextureFormat,
) -> (Cow<'a, [u8]>, u32) {
    if format != SOURCE_FRAME_FORMAT_HDR {
        return (
            Cow::Borrowed(&rgba[..width.saturating_mul(height).saturating_mul(4)]),
            (width * 4) as u32,
        );
    }

    let channel_count = width * height * 4;
    let mut payload = Vec::with_capacity(channel_count * 2);
    for channel in rgba.iter().take(channel_count) {
        payload.extend_from_slice(&unorm8_to_f16_bits(*channel).to_le_bytes());
    }
    (Cow::Owned(payload), (width * 8) as u32)
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

fn effective_scene_source_type(
    source_type: &str,
    uri: Option<&str>,
    _has_source_frame: bool,
) -> String {
    if source_type == "image"
        && uri.is_some_and(|value| is_native_generated_source_frame_uri(value))
    {
        return "gpu:native-graph".to_string();
    }
    source_type.to_string()
}

fn is_native_generated_source_frame_uri(uri: &str) -> bool {
    uri.starts_with("native-graph://")
        || uri.starts_with("native-graph-reactivity://")
        || uri.starts_with("native-graph-fixture://")
        || uri.starts_with("native-effect-pass://")
}

fn source_type_color(source_type: &str, id: &str) -> [f32; 4] {
    if source_type.starts_with("gpu:") {
        return match source_type {
            "gpu:planet" => [0.22, 0.62, 1.0, 1.0],
            "gpu:pixel-particles" | "gpu:flythrough" | "gpu:point-cloud-fx" => {
                [1.0, 0.35, 0.82, 1.0]
            }
            "gpu:particle-field" | "gpu:gravity-wells" => [0.25, 1.0, 0.78, 1.0],
            "gpu:volumetric-balls" => [0.78, 0.58, 1.0, 1.0],
            "gpu:smoke-riders" | "gpu:ink-cloud" | "gpu:smoke-3d" => [0.62, 0.82, 1.0, 1.0],
            _ => stable_layer_color(id, 1.0),
        };
    }
    match source_type {
        "shader" => [0.45, 0.92, 1.0, 1.0],
        "video" => [0.28, 1.0, 0.55, 1.0],
        "image" => [1.0, 0.62, 0.26, 1.0],
        "none" => [0.3, 0.34, 0.42, 0.35],
        _ => stable_layer_color(id, 1.0),
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

fn read_texture_to_frame(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    format: wgpu::TextureFormat,
    width: u32,
    height: u32,
    label: &str,
) -> Result<FrameSnapshotReadback, String> {
    let width = width.max(1);
    let height = height.max(1);
    let bytes_per_pixel = 4_u32;
    let unpadded_bytes_per_row = width.saturating_mul(bytes_per_pixel);
    let padded_bytes_per_row =
        align_u32(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let padded_size = padded_bytes_per_row as u64 * height as u64;
    let buffer_label = format!("{label} Readback");
    let encoder_label = format!("{label} Readback Encoder");
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(&buffer_label),
        size: padded_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some(&encoder_label),
    });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
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
    queue.submit(Some(encoder.finish()));

    let slice = buffer.slice(..);
    let (tx, rx) = mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = tx.send(result.map_err(|err| err.to_string()));
    });
    device
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

    let metrics = snapshot_metrics(&compact, format);
    Ok(FrameSnapshotReadback {
        timestamp_ms: epoch_ms(),
        width,
        height,
        format,
        bytes_per_row: unpadded_bytes_per_row,
        padded_bytes_per_row,
        pixels: compact,
        metrics,
    })
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NativeShaderSourceKind {
    Wgsl,
    IsfGlsl,
    Glsl,
}

impl NativeShaderSourceKind {
    fn label(self) -> &'static str {
        match self {
            NativeShaderSourceKind::Wgsl => "WGSL",
            NativeShaderSourceKind::IsfGlsl => "ISF/GLSL",
            NativeShaderSourceKind::Glsl => "GLSL",
        }
    }

    fn from_label(label: &str) -> Self {
        match label.trim().to_ascii_lowercase().as_str() {
            "isf/glsl" | "isf-glsl" | "isf" => NativeShaderSourceKind::IsfGlsl,
            "glsl" => NativeShaderSourceKind::Glsl,
            _ => NativeShaderSourceKind::Wgsl,
        }
    }
}

#[derive(Clone, Debug)]
struct NativeGlslParseProbe {
    kind: NativeShaderSourceKind,
    entry_points: Vec<String>,
}

fn classify_native_shader_source(source: &str) -> NativeShaderSourceKind {
    if looks_like_wgsl(source) {
        return NativeShaderSourceKind::Wgsl;
    }
    let (body, has_isf_header) = strip_isf_json_header(source);
    if has_isf_header || looks_like_isf_glsl(body) {
        NativeShaderSourceKind::IsfGlsl
    } else {
        NativeShaderSourceKind::Glsl
    }
}

fn looks_like_isf_glsl(source: &str) -> bool {
    let s = source;
    s.contains("RENDERSIZE")
        || s.contains("isf_FragNormCoord")
        || s.contains("IMG_NORM_PIXEL")
        || s.contains("IMG_PIXEL")
        || s.contains("PASSINDEX")
        || s.contains("gl_FragColor")
        || s.contains("gl_FragCoord")
}

fn looks_like_isf_metadata(comment: &str) -> bool {
    let trimmed = comment.trim();
    if !trimmed.starts_with('{') {
        return false;
    }
    trimmed.contains("\"ISFVSN\"")
        || trimmed.contains("\"INPUTS\"")
        || trimmed.contains("\"PASSES\"")
        || trimmed.contains("\"CATEGORIES\"")
}

fn isf_json_header(source: &str) -> Option<&str> {
    let trimmed = source.trim_start();
    let comment_body = trimmed.strip_prefix("/*")?;
    let end = comment_body.find("*/")?;
    let header = &comment_body[..end];
    looks_like_isf_metadata(header).then_some(header)
}

fn strip_isf_json_header(source: &str) -> (&str, bool) {
    let trimmed = source.trim_start();
    let Some(comment_body) = trimmed.strip_prefix("/*") else {
        return (source, false);
    };
    let Some(end) = comment_body.find("*/") else {
        return (source, false);
    };
    let header = &comment_body[..end];
    if !looks_like_isf_metadata(header) {
        return (source, false);
    }
    (&comment_body[end + 2..], true)
}

fn is_valid_glsl_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn native_isf_input_kind(input_type: &str) -> NativeIsfInputKind {
    match input_type.trim().to_ascii_lowercase().as_str() {
        "float" => NativeIsfInputKind::Float,
        "bool" => NativeIsfInputKind::Bool,
        "long" => NativeIsfInputKind::Long,
        "point2d" | "point" => NativeIsfInputKind::Point2D,
        "color" => NativeIsfInputKind::Color,
        "event" => NativeIsfInputKind::Event,
        "image" | "audio" | "audiofft" => NativeIsfInputKind::Image,
        _ => NativeIsfInputKind::Unsupported,
    }
}

fn native_isf_input_components(kind: NativeIsfInputKind) -> usize {
    match kind {
        NativeIsfInputKind::Point2D => 2,
        NativeIsfInputKind::Color => 4,
        // Image inputs carry one float: the source-frame array layer to
        // sample. -1 means unbound -> the shader falls back to its own
        // input frame, which is also the pre-image-input behavior.
        NativeIsfInputKind::Image => 1,
        NativeIsfInputKind::Unsupported => 0,
        NativeIsfInputKind::Float
        | NativeIsfInputKind::Bool
        | NativeIsfInputKind::Long
        | NativeIsfInputKind::Event => 1,
    }
}

fn default_values_for_isf_input(input: &Value, kind: NativeIsfInputKind) -> [f32; 4] {
    let default = input.get("DEFAULT");
    match kind {
        // 0 = unbound (biased slot+1 encoding): survives the zero-filled
        // default params a shader gets before its first uniforms push.
        NativeIsfInputKind::Image => [0.0, 0.0, 0.0, 0.0],
        NativeIsfInputKind::Bool => {
            let value = default
                .and_then(Value::as_bool)
                .map(|value| if value { 1.0 } else { 0.0 })
                .or_else(|| default.and_then(Value::as_f64).map(|value| value as f32))
                .unwrap_or(0.0);
            [value, 0.0, 0.0, 0.0]
        }
        NativeIsfInputKind::Long => {
            let value = default.and_then(Value::as_f64).unwrap_or(0.0).round() as f32;
            [value, 0.0, 0.0, 0.0]
        }
        NativeIsfInputKind::Point2D => {
            let values = default
                .and_then(Value::as_array)
                .map(|values| {
                    [
                        values.first().and_then(Value::as_f64).unwrap_or(0.5) as f32,
                        values.get(1).and_then(Value::as_f64).unwrap_or(0.5) as f32,
                        0.0,
                        0.0,
                    ]
                })
                .unwrap_or([0.5, 0.5, 0.0, 0.0]);
            values
        }
        NativeIsfInputKind::Color => default
            .and_then(Value::as_array)
            .map(|values| {
                [
                    values.first().and_then(Value::as_f64).unwrap_or(1.0) as f32,
                    values.get(1).and_then(Value::as_f64).unwrap_or(1.0) as f32,
                    values.get(2).and_then(Value::as_f64).unwrap_or(1.0) as f32,
                    values.get(3).and_then(Value::as_f64).unwrap_or(1.0) as f32,
                ]
            })
            .unwrap_or([1.0, 1.0, 1.0, 1.0]),
        NativeIsfInputKind::Float | NativeIsfInputKind::Event => {
            let value = default
                .and_then(Value::as_f64)
                .unwrap_or_else(|| input.get("MIN").and_then(Value::as_f64).unwrap_or(0.0))
                as f32;
            [value, 0.0, 0.0, 0.0]
        }
        NativeIsfInputKind::Unsupported => [0.0; 4],
    }
}

fn sanitize_isf_json_header(header: &str) -> String {
    let mut output = String::with_capacity(header.len());
    for line in header.lines() {
        let mut in_string = false;
        let mut escaped = false;
        let mut cut = line.len();
        for (index, ch) in line.char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' if in_string => escaped = true,
                '"' => in_string = !in_string,
                '/' if !in_string && line[index..].starts_with("//") => {
                    cut = index;
                    break;
                }
                _ => {}
            }
        }
        output.push_str(&line[..cut]);
        output.push('\n');
    }
    output
}

fn parse_native_isf_inputs(source: &str) -> Vec<NativeIsfInputBinding> {
    let Some(header) = isf_json_header(source) else {
        return Vec::new();
    };
    let sanitized_header = sanitize_isf_json_header(header);
    let Ok(metadata) = serde_json::from_str::<Value>(sanitized_header.trim()) else {
        return Vec::new();
    };
    let Some(inputs) = metadata.get("INPUTS").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut bindings = Vec::with_capacity(inputs.len());
    let mut cursor = 0usize;
    for input in inputs {
        let Some(name) = input.get("NAME").and_then(Value::as_str) else {
            continue;
        };
        if !is_valid_glsl_identifier(name) {
            continue;
        }
        let kind = input
            .get("TYPE")
            .and_then(Value::as_str)
            .map(native_isf_input_kind)
            .unwrap_or(NativeIsfInputKind::Unsupported);
        let components = native_isf_input_components(kind);
        let offset = if components > 0 && cursor + components <= MAX_NATIVE_ISF_PARAM_FLOATS {
            let offset = Some(cursor);
            cursor += components;
            offset
        } else {
            None
        };
        bindings.push(NativeIsfInputBinding {
            name: name.to_string(),
            kind,
            offset,
            components,
            default_values: default_values_for_isf_input(input, kind),
        });
    }
    bindings
}

fn native_param_component(offset: usize) -> Option<String> {
    if offset >= MAX_NATIVE_ISF_PARAM_FLOATS {
        return None;
    }
    let component = ["x", "y", "z", "w"][offset % 4];
    Some(format!("PARAMS{}.{}", offset / 4, component))
}

fn glsl_float_literal(value: f32) -> String {
    if value.is_finite() {
        format!("{value:.8}")
    } else {
        "0.0".to_string()
    }
}

fn native_isf_input_expr(binding: &NativeIsfInputBinding) -> Option<String> {
    let scalar_at = |component: usize| {
        binding
            .offset
            .and_then(|offset| native_param_component(offset + component))
            .unwrap_or_else(|| glsl_float_literal(binding.default_values[component]))
    };
    match binding.kind {
        NativeIsfInputKind::Float | NativeIsfInputKind::Event => Some(scalar_at(0)),
        NativeIsfInputKind::Bool => Some(format!("({} > 0.5)", scalar_at(0))),
        NativeIsfInputKind::Long => Some(format!("int(round({}))", scalar_at(0))),
        NativeIsfInputKind::Point2D => Some(format!("vec2({}, {})", scalar_at(0), scalar_at(1))),
        NativeIsfInputKind::Color => Some(format!(
            "vec4({}, {}, {}, {})",
            scalar_at(0),
            scalar_at(1),
            scalar_at(2),
            scalar_at(3)
        )),
        NativeIsfInputKind::Image => Some(format!(
            "(({0}) >= 0.5 ? ({0}) - 1.0 : frame_seed_inputs.w)",
            scalar_at(0)
        )),
        NativeIsfInputKind::Unsupported => None,
    }
}

fn uniform_declares_any_name(line: &str, names: &[String]) -> bool {
    let trimmed = line.trim();
    if !trimmed.starts_with("uniform ") || !trimmed.ends_with(';') {
        return false;
    }
    names.iter().any(|name| {
        let token = format!("{name};");
        trimmed.ends_with(&token) || trimmed.contains(&format!(" {name};"))
    })
}

fn native_fallback_uniform_declaration(line: &str) -> Option<String> {
    let declaration = line.trim().strip_prefix("uniform ")?.strip_suffix(';')?;
    let mut tokens = declaration.split_whitespace();
    let kind = tokens.next()?;
    let name = tokens.next()?;
    if tokens.next().is_some() || !is_valid_glsl_identifier(name) {
        return None;
    }
    let initializer = match kind {
        "float" => "1.0",
        "int" => "1",
        "bool" => "true",
        "vec2" => "vec2(1.0)",
        "vec3" => "vec3(1.0)",
        "vec4" => "vec4(1.0)",
        _ => return None,
    };
    Some(format!("{kind} {name} = {initializer};"))
}

fn maybe_global_initializer_macro(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let semicolon = trimmed.strip_suffix(';')?;
    let (kind, rest) = ["float", "vec2", "vec3", "vec4"].iter().find_map(|kind| {
        semicolon
            .strip_prefix(kind)
            .map(|rest| (*kind, rest.trim_start()))
    })?;
    let (name, expr) = rest.split_once('=')?;
    let name = name.trim();
    let expr = expr.trim();
    if !is_valid_glsl_identifier(name) {
        return None;
    }
    let depends_on_native_uniform = [
        "RENDERSIZE",
        "renderSize",
        "TIME",
        "TIMEDELTA",
        "FRAMEINDEX",
        "DATE",
        "audio",
        "PARAMS",
    ]
    .iter()
    .any(|needle| expr.contains(needle));
    if !depends_on_native_uniform {
        return None;
    }
    Some(format!(
        "#define {name} ({expr}) /* native lifted {kind} uniform initializer */"
    ))
}

fn replace_glsl_identifier(source: &str, from: &str, to: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut token = String::new();
    let flush_token = |out: &mut String, token: &mut String| {
        if token == from {
            out.push_str(to);
        } else {
            out.push_str(token);
        }
        token.clear();
    };
    for ch in source.chars() {
        if ch == '_' || ch.is_ascii_alphanumeric() {
            token.push(ch);
        } else {
            if !token.is_empty() {
                flush_token(&mut out, &mut token);
            }
            out.push(ch);
        }
    }
    if !token.is_empty() {
        flush_token(&mut out, &mut token);
    }
    out
}

fn has_glsl_define(source: &str, name: &str) -> bool {
    source.lines().any(|line| {
        let trimmed = line.trim_start();
        trimmed
            .strip_prefix("#define")
            .map(|rest| {
                let rest = rest.trim_start();
                rest == name
                    || rest
                        .strip_prefix(name)
                        .map(|tail| tail.starts_with(char::is_whitespace) || tail.starts_with('('))
                        .unwrap_or(false)
            })
            .unwrap_or(false)
    })
}

fn native_isf_shadertoy_alias_macros(body: &str) -> String {
    let aliases = [
        ("iResolution", "vec3(RENDERSIZE, 1.0)"),
        ("iTime", "TIME"),
        ("iGlobalTime", "TIME"),
        ("iFrame", "FRAMEINDEX"),
    ];
    let mut output = String::new();
    for (name, expr) in aliases {
        if body.contains(name) && !has_glsl_define(body, name) {
            output.push_str(&format!("#define {name} ({expr})\n"));
        }
    }
    output
}

fn native_isf_audio_alias_macros(input_bindings: &[NativeIsfInputBinding]) -> String {
    let aliases = [
        ("audioLevel", "AUDIO0.x"),
        ("audioBass", "AUDIO0.y"),
        ("audioMid", "AUDIO0.z"),
        ("audioHigh", "AUDIO1.x"),
        ("audioBeat", "AUDIO1.y"),
        ("audioBeatPhase", "AUDIO1.z"),
        ("audioBPM", "AUDIO1.w"),
        ("audioSpectralCentroid", "AUDIO2.x"),
    ];
    let declared_inputs = input_bindings
        .iter()
        .map(|binding| binding.name.as_str())
        .collect::<HashSet<_>>();
    aliases
        .iter()
        .filter(|(name, _)| !declared_inputs.contains(name))
        .map(|(name, expr)| format!("#define {name} {expr}\n"))
        .collect()
}

fn native_isf_input_glsl_type(kind: NativeIsfInputKind) -> Option<&'static str> {
    match kind {
        NativeIsfInputKind::Float | NativeIsfInputKind::Event => Some("float"),
        NativeIsfInputKind::Bool => Some("bool"),
        NativeIsfInputKind::Long => Some("int"),
        NativeIsfInputKind::Point2D => Some("vec2"),
        NativeIsfInputKind::Color => Some("vec4"),
        NativeIsfInputKind::Image => Some("float"),
        NativeIsfInputKind::Unsupported => None,
    }
}

fn inject_native_isf_input_state(source: &str, input_bindings: &[NativeIsfInputBinding]) -> String {
    let active = input_bindings
        .iter()
        .filter_map(|binding| {
            Some((
                binding,
                native_isf_input_glsl_type(binding.kind)?,
                native_isf_input_expr(binding)?,
            ))
        })
        .collect::<Vec<_>>();
    if active.is_empty() {
        return source.to_string();
    }
    let mut globals = String::new();
    let mut assignments = String::new();
    for (binding, kind, expr) in active {
        globals.push_str(&format!("{kind} {};\n", binding.name));
        assignments.push_str(&format!("\n  {} = {expr};", binding.name));
    }
    let Some(main_start) = source.find("void main") else {
        return format!("{globals}\n{source}");
    };
    let Some(relative_brace) = source[main_start..].find('{') else {
        return format!("{globals}\n{source}");
    };
    let brace = main_start + relative_brace;
    let mut output = String::with_capacity(globals.len() + source.len() + assignments.len() + 2);
    output.push_str(&globals);
    output.push('\n');
    output.push_str(&source[..=brace]);
    output.push_str(&assignments);
    output.push_str(&source[brace + 1..]);
    output
}

fn collect_isf_image_arg_names(body: &str) -> Vec<String> {
    let mut names = Vec::new();
    for marker in ["IMG_NORM_PIXEL(", "IMG_PIXEL(", "IMG_SIZE(", "texture2D("] {
        let mut search = 0usize;
        while let Some(found) = body[search..].find(marker) {
            let arg_start = search + found + marker.len();
            search = arg_start;
            let rest = &body[arg_start..];
            let end = rest
                .find(|c: char| c == ',' || c == ')')
                .unwrap_or(rest.len());
            let candidate = rest[..end].trim();
            if is_valid_glsl_identifier(candidate) && !names.iter().any(|n| n == candidate) {
                names.push(candidate.to_string());
            }
        }
    }
    names
}

fn preprocess_native_isf_glsl_body(body: &str, input_bindings: &[NativeIsfInputBinding]) -> String {
    let input_names = input_bindings
        .iter()
        .map(|binding| binding.name.clone())
        .collect::<Vec<_>>();
    let mut reserved_names = vec![
        "RENDERSIZE".to_string(),
        "renderSize".to_string(),
        "TIME".to_string(),
        "TIMEDELTA".to_string(),
        "FRAMEINDEX".to_string(),
        "DATE".to_string(),
        "audioFFT".to_string(),
        "audioWaveform".to_string(),
        "audioLevel".to_string(),
        "audioBass".to_string(),
        "audioMid".to_string(),
        "audioHigh".to_string(),
        "audioBeat".to_string(),
        "audioBeatPhase".to_string(),
        "audioBPM".to_string(),
        "audioSpectralCentroid".to_string(),
        "iResolution".to_string(),
        "iTime".to_string(),
        "iGlobalTime".to_string(),
        "iFrame".to_string(),
    ];
    reserved_names.extend(input_names.iter().cloned());
    let mut output = String::with_capacity(body.len());
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            continue;
        }
        if trimmed.starts_with("precision ") && trimmed.ends_with(';') {
            continue;
        }
        if trimmed.starts_with("#version") {
            continue;
        }
        if trimmed.starts_with("varying ") && trimmed.ends_with(';') {
            continue;
        }
        if trimmed.starts_with("attribute ") && trimmed.ends_with(';') {
            continue;
        }
        if uniform_declares_any_name(trimmed, &reserved_names) {
            continue;
        }
        if trimmed.starts_with("uniform ") && trimmed.ends_with(';') {
            if let Some(declaration) = native_fallback_uniform_declaration(trimmed) {
                output.push_str(&declaration);
                output.push('\n');
            }
            continue;
        }
        if line.trim_start() == line
            && let Some(macro_line) = maybe_global_initializer_macro(trimmed)
        {
            output.push_str(&macro_line);
            output.push('\n');
            continue;
        }
        output.push_str(line);
        output.push('\n');
    }
    let output = replace_glsl_identifier(&output, "centroid", "ghost_centroid");
    let output = replace_glsl_identifier(&output, "gl_FragCoord", "ghost_FragCoord");
    let mut all_bindings = input_bindings.to_vec();
    for name in collect_isf_image_arg_names(body) {
        let already_bound = all_bindings.iter().any(|binding| binding.name == name);
        if already_bound || has_glsl_define(body, &name) {
            continue;
        }
        // Unbound synthetic image binding: offset None packs nothing, and the
        // -1 default makes the GLSL expression fall back to the layer's own
        // input frame.
        all_bindings.push(NativeIsfInputBinding {
            name,
            kind: NativeIsfInputKind::Image,
            offset: None,
            components: 0,
            default_values: [0.0, 0.0, 0.0, 0.0],
        });
    }
    inject_native_isf_input_state(&output, &all_bindings)
}

fn value_as_native_f32(value: Option<&Value>, fallback: f32) -> f32 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(fallback as f64) as f32,
        Some(Value::Bool(value)) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::String(value)) => value.parse::<f32>().unwrap_or(fallback),
        _ => fallback,
    }
}

fn array_value_as_native_f32(value: Option<&Value>, index: usize, fallback: f32) -> f32 {
    value
        .and_then(Value::as_array)
        .and_then(|values| values.get(index))
        .map(|value| value_as_native_f32(Some(value), fallback))
        .unwrap_or(fallback)
}

fn object_xy_value_as_native_f32(value: Option<&Value>, key: &str, fallback: f32) -> f32 {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get(key))
        .map(|value| value_as_native_f32(Some(value), fallback))
        .unwrap_or(fallback)
}

fn native_isf_binding_values(command: &Value, binding: &NativeIsfInputBinding) -> [f32; 4] {
    let floats = command.get("float_inputs").unwrap_or(&Value::Null);
    let points = command.get("point_inputs").unwrap_or(&Value::Null);
    let colors = command.get("color_inputs").unwrap_or(&Value::Null);
    match binding.kind {
        NativeIsfInputKind::Float | NativeIsfInputKind::Event => [
            value_as_native_f32(floats.get(&binding.name), binding.default_values[0]),
            0.0,
            0.0,
            0.0,
        ],
        NativeIsfInputKind::Bool | NativeIsfInputKind::Long => [
            value_as_native_f32(floats.get(&binding.name), binding.default_values[0]),
            0.0,
            0.0,
            0.0,
        ],
        NativeIsfInputKind::Point2D => {
            let value = points
                .get(&binding.name)
                .or_else(|| floats.get(&binding.name));
            [
                array_value_as_native_f32(
                    value,
                    0,
                    object_xy_value_as_native_f32(value, "x", binding.default_values[0]),
                ),
                array_value_as_native_f32(
                    value,
                    1,
                    object_xy_value_as_native_f32(value, "y", binding.default_values[1]),
                ),
                0.0,
                0.0,
            ]
        }
        NativeIsfInputKind::Color => {
            let value = colors
                .get(&binding.name)
                .or_else(|| floats.get(&binding.name));
            [
                array_value_as_native_f32(value, 0, binding.default_values[0]),
                array_value_as_native_f32(value, 1, binding.default_values[1]),
                array_value_as_native_f32(value, 2, binding.default_values[2]),
                array_value_as_native_f32(value, 3, binding.default_values[3]),
            ]
        }
        NativeIsfInputKind::Image | NativeIsfInputKind::Unsupported => binding.default_values,
    }
}

fn native_isf_input_params(
    command: &Value,
    bindings: &[NativeIsfInputBinding],
) -> [f32; MAX_NATIVE_ISF_PARAM_FLOATS] {
    let mut params = [0.0; MAX_NATIVE_ISF_PARAM_FLOATS];
    for binding in bindings {
        let Some(offset) = binding.offset else {
            continue;
        };
        let values = native_isf_binding_values(command, binding);
        for i in 0..binding.components.min(4) {
            if let Some(slot) = params.get_mut(offset + i) {
                *slot = values[i];
            }
        }
    }
    params
}

fn native_glsl_stage_for_label(stage: &str) -> naga::ShaderStage {
    match stage.trim().to_ascii_lowercase().as_str() {
        "vertex" | "vs" => naga::ShaderStage::Vertex,
        "compute" | "cs" => naga::ShaderStage::Compute,
        _ => naga::ShaderStage::Fragment,
    }
}

fn native_glsl_probe_source(source: &str, kind: NativeShaderSourceKind) -> Cow<'_, str> {
    let (body, _) = strip_isf_json_header(source);
    let input_bindings = parse_native_isf_inputs(source);
    let owned_body;
    let body = if matches!(kind, NativeShaderSourceKind::IsfGlsl) {
        owned_body = preprocess_native_isf_glsl_body(body, &input_bindings);
        owned_body.trim_start()
    } else {
        body.trim_start()
    };
    if body.starts_with("#version") && !matches!(kind, NativeShaderSourceKind::IsfGlsl) {
        return Cow::Owned(body.to_string());
    }
    let prelude = match kind {
        NativeShaderSourceKind::IsfGlsl => {
            let shadertoy_alias_macros = native_isf_shadertoy_alias_macros(body);
            let audio_alias_macros = native_isf_audio_alias_macros(&input_bindings);
            let mut prelude = r#"#version 450 core
layout(location = 0) in vec2 isf_FragNormCoord;
layout(location = 0) out vec4 gl_FragColor;
layout(set = 0, binding = 0) uniform GhostNativeShaderUniforms {
  vec4 resolution_time;
  vec4 frame_seed_inputs;
  vec4 DATE;
  vec4 AUDIO0;
  vec4 AUDIO1;
  vec4 PARAMS0;
  vec4 PARAMS1;
  vec4 AUDIO2;
  vec4 PARAMS2;
  vec4 PARAMS3;
  vec4 PARAMS4;
  vec4 PARAMS5;
  vec4 PARAMS6;
  vec4 PARAMS7;
  vec4 PARAMS8;
  vec4 PARAMS9;
  vec4 PARAMS10;
  vec4 PARAMS11;
  vec4 PARAMS12;
  vec4 PARAMS13;
  vec4 PARAMS14;
  vec4 PARAMS15;
};
layout(set = 0, binding = 1) uniform texture2DArray ghost_source_frames;
layout(set = 0, binding = 2) uniform sampler ghost_source_sampler;
#define RENDERSIZE resolution_time.xy
#define renderSize RENDERSIZE
#define TIME resolution_time.z
#define TIMEDELTA resolution_time.w
#define FRAMEINDEX int(round(frame_seed_inputs.x))
#define PASSINDEX 0
#define vUv isf_FragNormCoord
#define texCoord isf_FragNormCoord
#define ghost_FragCoord vec4(isf_FragNormCoord * RENDERSIZE, 0.0, 1.0)
#define texture2D(img, coord) texture(sampler2DArray(ghost_source_frames, ghost_source_sampler), vec3((coord), (img)))
#define IMG_NORM_PIXEL(img, coord) texture(sampler2DArray(ghost_source_frames, ghost_source_sampler), vec3((coord), (img)))
#define IMG_PIXEL(img, coord) IMG_NORM_PIXEL(img, (coord) / RENDERSIZE)
#define IMG_SIZE(img) RENDERSIZE
float sampleFFT(float u) {
  return mix(AUDIO0.y, AUDIO1.x, clamp(u, 0.0, 1.0));
}
float sampleWaveform(float u) {
  return sin((clamp(u, 0.0, 1.0) + TIME * 0.1) * 6.28318530718) * max(AUDIO0.x, 0.001);
}
"#
            .to_string();
            prelude.push_str(&shadertoy_alias_macros);
            prelude.push_str(&audio_alias_macros);
            prelude
        }
        NativeShaderSourceKind::Glsl => r#"#version 450 core
layout(location = 0) out vec4 gl_FragColor;
"#
        .to_string(),
        NativeShaderSourceKind::Wgsl => "".to_string(),
    };
    Cow::Owned(format!("{prelude}\n{body}"))
}

fn probe_native_glsl_source_with_stage(
    source: &str,
    kind: NativeShaderSourceKind,
    stage: naga::ShaderStage,
) -> Result<NativeGlslParseProbe, String> {
    let source = native_glsl_probe_source(source, kind);
    let mut frontend = naga::front::glsl::Frontend::default();
    let options = naga::front::glsl::Options::from(stage);
    match frontend.parse(&options, source.as_ref()) {
        Ok(module) => Ok(NativeGlslParseProbe {
            kind,
            entry_points: module
                .entry_points
                .iter()
                .map(|entry| entry.name.clone())
                .collect(),
        }),
        Err(err) => Err(err.to_string()),
    }
}

fn probe_native_glsl_source(
    source: &str,
    stage: naga::ShaderStage,
) -> Result<NativeGlslParseProbe, String> {
    let kind = classify_native_shader_source(source);
    probe_native_glsl_source_with_stage(source, kind, stage)
}

fn native_fragment_entry(record: &ShaderRecord, source: &str) -> Option<String> {
    let kind = NativeShaderSourceKind::from_label(&record.source_kind);
    let preferred = record.entry.trim();
    match kind {
        NativeShaderSourceKind::Wgsl => {
            if !native_wgsl_fragment_supported(source) {
                return None;
            }
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
        NativeShaderSourceKind::IsfGlsl | NativeShaderSourceKind::Glsl => {
            if !preferred.is_empty() && record.entry_points.iter().any(|entry| entry == preferred) {
                return Some(preferred.to_string());
            }
            ["main", "fs_main"].iter().find_map(|candidate| {
                record
                    .entry_points
                    .iter()
                    .any(|entry| entry == candidate)
                    .then(|| candidate.to_string())
            })
        }
    }
}

fn native_compute_entry(record: &ShaderRecord, source: &str) -> Option<String> {
    if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
        return None;
    }
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
    format!(
        "{shader_id}:{}:{}:{entry}",
        record.source_kind, record.source_hash
    )
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
    if width == dst_width
        && height == dst_height
        && rgba.len() >= width.saturating_mul(height).saturating_mul(4)
    {
        return rgba[..width * height * 4].to_vec();
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compositor_allows_fully_opaque_layers() {
        assert!(
            STAGE3D_MESH_WGSL.contains("clamp(in.color.a * opacity, 0.0, 1.0)"),
            "solid native layers must be able to reach full opacity"
        );
        assert!(
            STAGE3D_MESH_WGSL.contains("clamp(in.color.a * opacity * tex.a, 0.0, 1.0)"),
            "textured native layers must be able to reach full opacity"
        );
        assert!(
            !STAGE3D_MESH_WGSL.contains("clamp(in.color.a * opacity, 0.0, 0.96)")
                && !STAGE3D_MESH_WGSL
                    .contains("clamp(in.color.a * opacity * tex.a, 0.0, 0.96)"),
            "the old 96% opacity ceiling must not return"
        );
    }

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
    fn source_frame_auto_policy_uses_realtime_tier() {
        assert_eq!(
            source_frame_tier_for_policy("auto", "insane"),
            "performance"
        );
        assert_eq!(source_frame_tier_for_policy("", "ultra"), "performance");
        assert_eq!(source_frame_tier_for_policy("insane", "ultra"), "ultra");
        assert_eq!(
            source_frame_tier_for_policy("performance", "insane"),
            "performance"
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
            input_params: [0.0; MAX_NATIVE_ISF_PARAM_FLOATS],
            image_sources: Vec::new(),
            seq: 1,
        };
        let uniforms = NativeShaderUniforms::from_isf(
            "shader",
            Some(&state),
            640,
            360,
            [0.0; MAX_NATIVE_ISF_PARAM_FLOATS],
            0,
        );
        assert_eq!(uniforms.audio0, state.audio0);
        assert_eq!(uniforms.audio1, state.audio1);
        assert_eq!(uniforms.audio2, state.audio2);
        assert_eq!(uniforms.params0, [0.0; 4]);
        assert_eq!(uniforms.params1, [0.0; 4]);
        assert_eq!(
            uniforms.params_extra,
            [[0.0; 4]; NATIVE_ISF_EXTRA_PARAM_VEC4S]
        );
    }

    #[test]
    fn native_shader_source_classifier_separates_wgsl_isf_and_glsl() {
        assert_eq!(
            classify_native_shader_source(
                "@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }"
            ),
            NativeShaderSourceKind::Wgsl
        );
        assert_eq!(
            classify_native_shader_source(
                r#"/*{"ISFVSN":"2","INPUTS":[]}*/ void main(){ gl_FragColor = vec4(TIME); }"#
            ),
            NativeShaderSourceKind::IsfGlsl
        );
        assert_eq!(
            classify_native_shader_source("#version 450 core\nvoid main(){}"),
            NativeShaderSourceKind::Glsl
        );
    }

    #[test]
    fn live_native_cadence_ignores_external_browser_clock_values() {
        assert_eq!(effective_native_frame_index("live", Some(7), 42), 42);
        assert_eq!(effective_native_frame_delta("live", 0.5, 60), 1.0 / 60.0);
    }

    #[test]
    fn manual_native_cadence_honors_external_render_clock_values() {
        assert_eq!(effective_native_frame_index("manual", Some(7), 42), 7);
        assert_eq!(effective_native_frame_delta("manual", 0.5, 60), 0.5);
    }

    #[test]
    fn native_video_clock_loops_and_clamps_inside_trim_bounds() {
        let mut state = NativeMediaSourceState {
            uri: "/tmp/clip.mp4".to_string(),
            source_type: "video".to_string(),
            playback_time_seconds: 2.0,
            seek_generation: 0,
            playback_rate: 1.0,
            paused: false,
            loop_enabled: true,
            duration_seconds: Some(10.0),
            trim_start: 0.2,
            trim_end: 0.6,
            decode_width: Some(1024),
            decode_height: Some(576),
            clock_time_seconds: 0.0,
            seq: 1,
        };
        assert!((state.current_time_seconds(Some(5.0)) - 3.0).abs() < 0.0001);

        state.loop_enabled = false;
        assert!((state.current_time_seconds(Some(20.0)) - 6.0).abs() < 0.0001);
    }

    #[test]
    fn native_glsl_probe_strips_isf_header_and_parses_fragment() {
        let probe = probe_native_glsl_source(
            r#"/*{"ISFVSN":"2","INPUTS":[]}*/
void main() {
  gl_FragColor = vec4(isf_FragNormCoord, TIME, 1.0);
}"#,
            naga::ShaderStage::Fragment,
        )
        .expect("minimal ISF-style GLSL should parse through the native probe");

        assert_eq!(probe.kind, NativeShaderSourceKind::IsfGlsl);
        assert!(probe.entry_points.iter().any(|entry| entry == "main"));
    }

    #[test]
    fn native_glsl_probe_maps_declared_isf_inputs_to_native_params() {
        let source = r#"/*{
  "ISFVSN": "2",
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.5 },
    { "NAME": "scale", "TYPE": "float", "DEFAULT": 2.0 },
    { "NAME": "enabled", "TYPE": "bool", "DEFAULT": true },
    { "NAME": "origin", "TYPE": "point2D", "DEFAULT": [0.25, 0.75] }
  ]
}*/
void main() {
  vec2 uv = isf_FragNormCoord * scale + origin;
  float pulse = enabled ? sin(TIME * speed) : 0.0;
  gl_FragColor = vec4(uv, pulse, 1.0);
}"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("bool enabled;"));
        assert!(native_source.contains("enabled = (PARAMS0.z > 0.5);"));
        let probe = probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("ISF input macros should let raw controls parse natively");
        assert_eq!(probe.kind, NativeShaderSourceKind::IsfGlsl);

        let bindings = parse_native_isf_inputs(source);
        assert_eq!(bindings.len(), 4);
        assert_eq!(bindings[0].offset, Some(0));
        assert_eq!(bindings[3].offset, Some(3));
        let params = native_isf_input_params(
            &json!({
                "float_inputs": {
                    "speed": 1.25,
                    "scale": 3.5,
                    "enabled": false
                },
                "point_inputs": {
                    "origin": [0.1, 0.9]
                }
            }),
            &bindings,
        );
        assert_eq!(params[0], 1.25);
        assert_eq!(params[1], 3.5);
        assert_eq!(params[2], 0.0);
        assert_eq!(params[3], 0.1);
        assert_eq!(params[4], 0.9);
    }

    #[test]
    fn native_isf_inputs_extend_beyond_the_legacy_eight_float_block() {
        let inputs = (0..20)
            .map(|index| {
                json!({
                    "NAME": format!("control{index}"),
                    "TYPE": "float",
                    "DEFAULT": index as f32 / 10.0,
                })
            })
            .collect::<Vec<_>>();
        let source = format!(
            "/*{}*/\nvoid main() {{ gl_FragColor = vec4(control19); }}",
            json!({ "ISFVSN": "2", "INPUTS": inputs })
        );
        let bindings = parse_native_isf_inputs(&source);
        assert_eq!(bindings.len(), 20);
        assert_eq!(bindings[19].offset, Some(19));
        let native_source =
            native_glsl_probe_source(&source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("PARAMS4.w"));
        probe_native_glsl_source(&source, naga::ShaderStage::Fragment)
            .expect("extended ISF parameter block should compile natively");
    }

    #[test]
    fn native_isf_inputs_preserve_legal_local_shadowing() {
        let source = r#"/*{
  "ISFVSN": "2",
  "INPUTS": [{ "NAME": "scale", "TYPE": "float", "DEFAULT": 2.0 }]
}*/
float localScale(vec2 p) {
  float scale = length(p);
  return scale;
}
void main() {
  gl_FragColor = vec4(localScale(isf_FragNormCoord) * scale);
}"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("float scale = length(p);"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("local variables may shadow ISF input globals");
    }

    #[test]
    fn native_isf_declared_audio_controls_override_builtin_audio_aliases() {
        let source = r#"/*{
  "ISFVSN": "2",
  "INPUTS": [{ "NAME": "audioBass", "TYPE": "float", "DEFAULT": 0.25 }]
}*/
void main() {
  gl_FragColor = vec4(audioBass);
}"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("float audioBass;"));
        assert!(!native_source.contains("#define audioBass AUDIO0.y"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("declared audio-named controls should remain ordinary ISF inputs");
    }

    #[test]
    fn native_glsl_host_lifts_unbound_scalar_uniforms_from_generic_fs_exports() {
        let source = r#"```glsl
uniform vec2 iResolution;
uniform float iTime;
uniform float gain;
void main() {
  gl_FragColor = vec4(gl_FragCoord.xy / iResolution, gain + iTime * 0.0, 1.0);
}
```"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();
        assert!(native_source.contains("float gain = 1.0;"));
        assert!(!native_source.contains("uniform float gain"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("generic fullscreen GLSL uniforms should be hosted without user conversion");
    }

    #[test]
    fn native_glsl_host_centers_fragment_coordinates_in_the_virtual_render_size() {
        let source = r#"/*{"ISFVSN":"2","INPUTS":[]}*/
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  gl_FragColor = vec4(uv, 0.0, 1.0);
}"#;
        let native_source =
            native_glsl_probe_source(source, NativeShaderSourceKind::IsfGlsl).into_owned();

        assert!(
            native_source
                .contains("#define ghost_FragCoord vec4(isf_FragNormCoord * RENDERSIZE, 0.0, 1.0)")
        );
        assert!(native_source.contains("ghost_FragCoord.xy / RENDERSIZE"));
        assert!(!native_source.contains("vec2 uv = gl_FragCoord.xy"));
        probe_native_glsl_source(source, naga::ShaderStage::Fragment)
            .expect("virtual fragment coordinates should compile through the native host");
    }

    #[test]
    fn native_isf_metadata_allows_line_comments_in_input_defaults() {
        let bindings = parse_native_isf_inputs(
            r#"/*{
  "ISFVSN": "2",
  "INPUTS": [
    { "NAME": "fractalDepth", "TYPE": "float", "DEFAULT": 4.0 // AI-exported label comment
    }
  ]
}*/
void main() { gl_FragColor = vec4(fractalDepth); }"#,
        );

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "fractalDepth");
        assert_eq!(bindings[0].default_values[0], 4.0);
    }

    #[test]
    fn native_glsl_probe_reports_invalid_source_without_browser_fallback() {
        let error = probe_native_glsl_source("void main( {", naga::ShaderStage::Fragment)
            .expect_err("invalid GLSL should stay a native parse error");

        assert!(!error.is_empty());
    }

    #[test]
    fn native_glsl_shader_records_resolve_fragment_but_not_compute() {
        let record = ShaderRecord {
            shader_id: "isf".to_string(),
            stage: "pixel".to_string(),
            entry: "main".to_string(),
            source_kind: NativeShaderSourceKind::IsfGlsl.label().to_string(),
            source_hash: 123,
            source_bytes: 42,
            entry_points: vec!["main".to_string()],
            compiled_at_ms: 1,
        };

        assert_eq!(
            native_fragment_entry(&record, "#version 450 core\nvoid main(){}"),
            Some("main".to_string())
        );
        assert_eq!(
            native_compute_entry(&record, "#version 450 core\nvoid main(){}"),
            None
        );
        assert!(native_shader_pipeline_key(&record, "isf", "main").contains("ISF/GLSL"));
    }

    #[test]
    fn layer_color_updates_do_not_reclassify_source_kind() {
        let mut layer = SceneLayer::new("gpu-layer".to_string(), 0);
        layer.source_kind = source_kind("gpu:ink-cloud");

        set_scene_layer_color(&mut layer, [0.25, 0.5, 0.75, 0.8]);

        assert_eq!(layer.color, [0.25, 0.5, 0.75, 0.8]);
        assert_eq!(layer.source_kind, source_kind("gpu:ink-cloud"));
    }

    #[test]
    fn native_generated_sources_are_gpu_backed_before_first_frame() {
        for uri in [
            "native-graph://planet/layer-a",
            "native-graph-reactivity://smoke/layer-a",
            "native-graph-fixture://probe",
            "native-effect-pass://layer-a",
        ] {
            assert_eq!(
                effective_scene_source_type("image", Some(uri), false),
                "gpu:native-graph"
            );
        }

        assert_eq!(
            effective_scene_source_type("image", Some("file:///tmp/still.png"), false),
            "image"
        );
        assert_eq!(
            effective_scene_source_type("video", Some("native-effect-pass://layer-a"), false),
            "video"
        );
    }

    #[test]
    fn scene_layer_gpu_packs_mesh_points_in_compositor_coordinates() {
        let mut layer = SceneLayer::new("mesh-layer".to_string(), 0);
        layer.mesh_rows = 2;
        layer.mesh_cols = 2;
        layer.mesh_points = vec![[0.0, 1.0], [1.0, 1.0], [0.1, 0.0], [0.9, 0.0]];

        let gpu = layer.gpu();
        assert_eq!(gpu.style[2], 2.0);
        assert_eq!(gpu.style[3], 2.0);
        assert_eq!(gpu.mesh[0], [0.0, 0.0, 1.0, 0.0]);
        assert_eq!(gpu.mesh[1], [0.1, 1.0, 0.9, 1.0]);
    }
}
