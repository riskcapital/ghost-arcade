#![recursion_limit = "512"]

mod video_phase;
mod launch_scheduler;
mod transition_clock;
mod clip_audio;
mod audio_priority;
mod audio;
mod audio_visuals;
mod capabilities;
mod compositor;
mod compute_graph;
mod graph_textures;
mod graph_readbacks;
mod ipc_frames;
mod scene_frame;
mod core_frame_counter;
mod churn_probe;
mod gpu_object_cache;
mod pass_timing;
mod pipeline_cache;
mod frames_in_flight;
mod present_pacing;
mod display_pacing;
mod effect_specialize;
mod media_decode;
mod media_orphans;
mod autorelease_pool;
mod hap_video;
mod hap_texture;
mod isf_passes;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod hardware_video;
#[cfg(target_os = "windows")]
mod windows_display_rate;
#[cfg(target_os = "windows")]
mod windows_media_foundation;
#[cfg(target_os = "windows")]
mod windows_video_decoder;
#[cfg(target_os = "windows")]
mod windows_video_encoder;
#[cfg(target_os = "windows")]
mod windows_video_texture;
#[cfg(target_os = "macos")]
mod mac_video_decoder;
#[cfg(target_os = "macos")]
mod mac_video_recorder;
#[cfg(target_os = "macos")]
mod mac_syphon;
mod texture_share;
#[cfg(target_os = "windows")]
mod win_spout;
#[cfg(target_os = "macos")]
mod video_texture;
mod native_graph_manifest;
mod native_quality;
mod output_present;
mod output_window_plan;
mod slice_presentation;
mod paint_mask;
mod particle_director;
mod projector_view;
mod shared_texture;
mod source_frames;

// -- split modules --
mod ipc;
mod status;
mod gpu;
mod visuals;
mod isf_host;
mod compute_runner;

use ipc::*;
use status::*;
use gpu::*;
use visuals::*;
use isf_host::*;
use compute_runner::*;
// -- end split modules --

use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    ffi::c_void,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    ptr::NonNull,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, Instant},
};

use audio::{GhostAudioUniforms, ghost_audio_uniform_layout};
use isf_passes::{
    IsfAudioKind, IsfAudioSpectrum, IsfPassPlan, ISF_AUDIO_DEFAULT_WIDTH, MAX_ISF_PASS_TARGETS,
    fill_isf_audio_row, fill_isf_audio_row_from_bands, isf_audio_width, isf_pass_target_image_code,
    isf_physical_target_size, isf_target_fixed_sides, parse_isf_pass_plan, resolve_isf_target_size,
};
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
    NativeComputeGraphTextureSpec, NativeGraphTextureFormat,
    compute_binding_kind_from_value, compute_graph_binding_kind_from_value,
    compute_graph_binding_resource_id, compute_graph_readbacks, dispatch_from_value,
    parse_compute_graph_buffer, parse_compute_graph_texture,
};
use media_decode::{
    MAX_NATIVE_VIDEO_FRAME_DECODE_DIMENSION, NATIVE_VIDEO_PREFETCH_WINDOW_DEFAULT_FPS,
    NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FPS, NATIVE_VIDEO_PREFETCH_WINDOW_MAX_FRAMES,
    NATIVE_VIDEO_PREFETCH_WINDOW_MIN_FPS, NativeVideoFrameDecodeOutput, NativeVideoStream, NativeVideoStreamFrame,
    NativeVideoMemoryBudget, NativeVideoMemoryLease,
    decode_native_image_rgba, decode_native_video_frame_exact_rgba, decode_native_video_frame_rgba,
    decode_native_video_frame_window_rgba, local_media_path_from_uri, native_image_file_signature,
    fit_video_long_edge, native_video_frame_bucket, native_video_frame_file_signature, spawn_native_video_stream,
};
use particle_director::{DirectorCamera, DirectorParams, DirectorState, points_of_interest_from_grid};
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
    NSApplication, NSView, NSWindow, NSWindowOrderingMode,
    NSWindowCollectionBehavior, NSStatusWindowLevel, NSNormalWindowLevel,
};
#[cfg(target_os = "macos")]
use objc2_foundation::MainThreadMarker;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared_texture::SharedTextureSourceFrameDescriptor;
use source_frames::{SlotRef, SourceFrameMode, SourceFrameStore};
use wgpu::util::{DeviceExt, TextureBlitter, TextureBlitterBuilder};
#[cfg(not(target_os = "macos"))]
use winit::window::Fullscreen;
use output_window_plan::{
    LevelPlan, MonitorInfo, OutputWindowRequest, OutputWindowState, OutputWindowStep,
    plan_output_window,
};
use winit::monitor::MonitorHandle;
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize},
    event::{ElementState, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    keyboard::{Key, NamedKey},
    raw_window_handle::{AppKitWindowHandle, HasWindowHandle, RawWindowHandle},
    window::{Window, WindowAttributes, WindowId, WindowLevel},
};

// Layers the compositor draws. The composite loop in heartbeat.wgsl has the
// same bound and stops at the live layer count, so only scenes that use the
// extra slots pay for them (Map Sim auto-map builds one layer per face).
// Each layer is tested against its cull bounds first, so a large count costs
// little when most layers miss most pixels.
const MAX_SCENE_LAYERS: usize = 1024;
// Tile bins for the composite. The canvas is cut into LAYER_TILES x
// LAYER_TILES tiles, and each tile lists, bottom to top, the layers whose
// cull bounds reach it, so a pixel visits those layers instead of testing
// every layer in the scene. With a few hundred small slices that was most of
// the composite's time, and every Screen's own composite paid it again.
// Layout (u32): [tiles_x, tiles_y, enabled, total], then one start offset per
// tile plus the end, then the layer indices. Past LAYER_TILE_INDEX_CAP
// entries binning is switched off and every pixel walks every layer again.
const LAYER_TILES: usize = 32;
const LAYER_TILE_CELLS: usize = LAYER_TILES * LAYER_TILES;
const LAYER_TILE_HEADER: usize = 4;
const LAYER_TILE_INDEX_CAP: usize = 262_144;
const LAYER_TILE_BUFFER_WORDS: usize = LAYER_TILE_HEADER + LAYER_TILE_CELLS + 1 + LAYER_TILE_INDEX_CAP;
// Mesh cell bounds, in the same buffer after the tile bins (heartbeat.wgsl
// MESH_CELL_BOUNDS_BASE). A mesh search rejects a cell by the box around
// it before building the cell; the shader worked that box out again for
// every cell it tried, per pixel (twelve reads and a dozen control points
// for a Bezier cell). These are the same boxes, worked out once, padded a
// little further, so a cell they reject is one the shader rejects too.
// Layout (u32): one word per layer slot (where its boxes start, 0 = none),
// then each meshed layer's cells row by row, (min.xy, max.xy) as f32 bits.
// Past MESH_CELL_BOUNDS_LAYERS full meshes the rest search as before.
const MESH_CELL_BOUNDS_BASE: usize = LAYER_TILE_BUFFER_WORDS;
const MESH_CELL_BOUNDS_LAYERS: usize = 256;
const MESH_CELL_WORDS_PER_LAYER: usize = (MAX_LAYER_MESH_SIDE - 1) * (MAX_LAYER_MESH_SIDE - 1) * 4;
const MESH_CELL_BOUNDS_WORDS: usize = MAX_SCENE_LAYERS + MESH_CELL_BOUNDS_LAYERS * MESH_CELL_WORDS_PER_LAYER;
/// Extra pad on the stored boxes over the shader's own (scaled by the size
/// of the coordinates), so float rounding on either side can never make a
/// stored box the smaller one.
const MESH_CELL_BOUNDS_SLACK: f64 = 1e-5;
const MAX_LAYER_MESH_SIDE: usize = 16;
const MAX_LAYER_MESH_POINTS: usize = MAX_LAYER_MESH_SIDE * MAX_LAYER_MESH_SIDE;
const MAX_LAYER_MESH_VEC4S: usize = MAX_LAYER_MESH_POINTS / 2;
/// Bezier mesh tangents: two vec4 per point, (right.xy, down.xy) then
/// (left.xy, up.xy), as offsets from the point in quad-local coordinates.
const MAX_LAYER_MESH_TANGENT_VEC4S: usize = MAX_LAYER_MESH_POINTS * 2;
const MAX_LAYER_MASK_POINTS: usize = 64;
/// Edge Effects per layer. Matches EDGE_EFFECT_LIMIT in
/// src/lib/drawing/edgeEffects.ts; the UI warns past it.
const MAX_LAYER_EDGE_EFFECTS: usize = 16;
/// Resolved values per edge effect (heartbeat.wgsl documents the layout).
const LAYER_EDGE_EFFECT_VEC4S: usize = 22;
/// Stroke centerline points in output px: (x, y, arc length, surface scale).
/// Matches EDGE_MAX_SEGMENTS in src/lib/drawing/edgeEffectGeometry.ts.
const MAX_LAYER_EDGE_POINTS: usize = 512;
/// Segments per culling chunk; the compositor skips whole chunks.
const LAYER_EDGE_CHUNK: usize = 16;
const MAX_LAYER_EDGE_CHUNKS: usize = MAX_LAYER_EDGE_POINTS / LAYER_EDGE_CHUNK;
const MAX_LAYER_EDGE_CORNERS: usize = 64;
const MAX_LAYER_EDGE_DIAGONALS: usize = 64;
const MAX_SOURCE_PREVIEWS: usize = 16;
const SOURCE_PREVIEW_SIZE: usize = 256;
const SOURCE_PREVIEW_PIXELS: usize = SOURCE_PREVIEW_SIZE * SOURCE_PREVIEW_SIZE;
// Picture slots allocated up front (source_frames.rs). The store grows past
// this on demand: the shared array by doubling up to the device's layer limit
// and the memory budget, per-source slots up to the compositor's binding array.
const INITIAL_SOURCE_FRAME_SLOTS: usize = 48;
/// Compositor binding-array length when each slot has its own texture: the
/// per-source slot ceiling.
const PER_SOURCE_SLOT_BINDINGS: usize = 1024;
/// Longest edge a per-source picture is stored at.
const PER_SOURCE_MAX_DIMENSION: u32 = 4096;
/// Shader inputs (the layer's own input plus bound images) packed per draw
/// into the shader-input array.
const NATIVE_SHADER_INPUT_LAYERS: usize = 16;
/// Features a per-source store needs: an array of textures, indexed by a
/// value read from the layer records.
const PER_SOURCE_SLOT_FEATURES: wgpu::Features = wgpu::Features::TEXTURE_BINDING_ARRAY
    .union(wgpu::Features::SAMPLED_TEXTURE_AND_STORAGE_BUFFER_ARRAY_NON_UNIFORM_INDEXING);
/// Ping-pong layers for the full-resolution composite used by composition FX.
/// Two is all an effect chain needs: read one, write the other, swap.
const COMPOSITE_FRAME_SLOTS: usize = 2;
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
// One playing decoder per deck row: a full deck (MAX_VJ_LAYERS in the app)
// plays every row at once. Admission is also bounded by the shared decoder
// byte budget, which is the real guard on memory; hardware decoders on a
// particular GPU may reach their throughput limit sooner.
const NATIVE_VIDEO_SESSION_MAX_PLAYING: usize = 32;
// A full four-row/four-column grid needs sixteen preparations, in addition
// to paused on-stage sources. The shared byte budget still bounds residency.
const NATIVE_LIBRARY_SESSION_CAP: usize = 16;
/// Compiled render and compute pipelines kept for shaders no layer shows
/// right now, so going back to one does not compile it again. Each costs about
/// a quarter of a megabyte of driver memory on Apple GPUs (measured: 229
/// pipelines held 118 MB of malloc, and evicting down to 32 gave back 52 MB).
/// At 512 a long session that keeps loading new shaders grew the core by
/// ~130 MB before the cache was full; 128 bounds it near 32 MB and still holds
/// every shader a large deck shows at once. Shows and editors can raise it
/// with `set_metadata_cache_caps`.
const NATIVE_PIPELINE_CACHE_CAP: u32 = 128;
const NATIVE_VIDEO_SESSION_MAX_ARMED: usize = NATIVE_VIDEO_SESSION_MAX_PLAYING + NATIVE_LIBRARY_SESSION_CAP;
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
/// First binding after (uniforms, source array, sampler): ISF pass targets
/// then the audioFFT and audio waveform rows.
const NATIVE_ISF_FIRST_EXTRA_BINDING: u32 = 3;
const NATIVE_ISF_AUDIO_FFT_BINDING: u32 = NATIVE_ISF_FIRST_EXTRA_BINDING + MAX_ISF_PASS_TARGETS as u32;
const NATIVE_ISF_AUDIO_WAVEFORM_BINDING: u32 = NATIVE_ISF_AUDIO_FFT_BINDING + 1;
const NATIVE_ISF_EXTRA_TEXTURE_BINDINGS: u32 = MAX_ISF_PASS_TARGETS as u32 + 2;
const COMPUTE_READBACK_PREVIEW_WORDS: usize = 128;
const COMPUTE_READBACK_BYTES_MAX: u64 = 4 * 1024 * 1024;
const NATIVE_GRAPH_BUFFER_BUDGET_MIN_BYTES: u64 = 16 * 1024 * 1024;
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

#[derive(Debug)]
struct VideoPrefetchResult {
    id: u64, source_id: String, signature: String, seq: u64, reserved_bytes: u64,
    deadline: Instant, frames: Result<Vec<NativeVideoFrameDecodeOutput>, String>,
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
    /// How the canvas lies on the dome: (kind 0 flat view / 1 panorama /
    /// 2 domemaster, panorama bottom and top elevation, panorama span),
    /// radians. See dome_source_uv in heartbeat.wgsl.
    dome3: [f32; 4],
    /// (flat view width or domemaster canvas angle radians, dome grid
    /// strength, _, _).
    dome4: [f32; 4],
    /// Layers placed on the dome: (drawn by the dome pass, lens, dome
    /// angle radians, _). Set per frame by `sync_dome_layers`.
    dlayer: [f32; 4],
    /// The editor's view from inside the dome: (on, look azimuth, look
    /// elevation, tangent of half the vertical field of view), radians.
    /// Only the dome view target sets it (`render_dome_view`).
    dview: [f32; 4],
    dview1: [f32; 4],
    /// This Screen as one projector of a dome rig: (on, its index, rig
    /// size, blend width), (blend gamma, _, _, _), and the rig's projectors,
    /// four vec4 each. See `Uniforms.dproj0` in heartbeat.wgsl.
    dproj0: [f32; 4],
    dproj1: [f32; 4],
    dprojs: [[f32; 4]; 32],
    /// Per-edge blend gamma (left, right, top, bottom); slice mode only.
    edge_gamma: [f32; 4],
    /// Projector black-level lift (r, g, b, feather); slice mode only.
    black_level: [f32; 4],
    /// Per-slice screen warp: (mode, rows, cols, _) + corner quad.
    projector_calibration: [[f32; 4]; 5],
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
    /// Bezier tangents of those meshes, read only while swarp.w / mwarp.w
    /// is 1. See WarpMesh.
    swarp_tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
    mwarp_tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
    /// Per-screen masks: (mask count, keep count, _, _), one info vec4 per
    /// mask and the packed vertices; slice mode only. See screen_masks_at.
    smask: [f32; 4],
    smask_info: [[f32; 4]; MAX_SCREEN_MASKS],
    smask_bounds: [[f32; 4]; MAX_SCREEN_MASKS],
    smask_pts: [[f32; 4]; MAX_SCREEN_MASK_VEC4S],
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
            dome3: [0.0, 0.0, std::f32::consts::FRAC_PI_2, std::f32::consts::TAU],
            dome4: [std::f32::consts::FRAC_PI_2, 0.0, 0.0, 0.0],
            dlayer: [0.0; 4],
            dview: [0.0; 4],
            dview1: [0.0; 4],
            dproj0: [0.0; 4],
            dproj1: [0.0; 4],
            dprojs: [[0.0; 4]; 32],
            edge_gamma: [2.2; 4],
            black_level: [0.0; 4],
            projector_calibration: [[0.0; 4]; 5],
            swarp: [0.0; 4],
            swarp_c0: [0.0, 0.0, 1.0, 0.0],
            swarp_c1: [1.0, 1.0, 0.0, 1.0],
            mwarp: [0.0; 4],
            mwarp_c0: [0.0, 0.0, 1.0, 0.0],
            mwarp_c1: [1.0, 1.0, 0.0, 1.0],
            swarp_mesh: [[0.0; 4]; 128],
            mwarp_mesh: [[0.0; 4]; 128],
            swarp_tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
            mwarp_tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
            smask: [0.0; 4],
            smask_info: [[0.0; 4]; MAX_SCREEN_MASKS],
            smask_bounds: [[0.0; 4]; MAX_SCREEN_MASKS],
            smask_pts: [[0.0; 4]; MAX_SCREEN_MASK_VEC4S],
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
    projector_calibration: [[f32; 4]; 5],
    swarp: [f32; 4],
    swarp_c0: [f32; 4],
    swarp_c1: [f32; 4],
    mwarp: [f32; 4],
    mwarp_c0: [f32; 4],
    mwarp_c1: [f32; 4],
    swarp_mesh: [[f32; 4]; 128],
    mwarp_mesh: [[f32; 4]; 128],
    smask: [f32; 4],
    smask_info: [[f32; 4]; MAX_SCREEN_MASKS],
    smask_bounds: [[f32; 4]; MAX_SCREEN_MASKS],
    smask_pts: [[f32; 4]; MAX_SCREEN_MASK_VEC4S],
    swarp_tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
    mwarp_tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
    /// Beat clock: (beat position, bpm, _, _). See `BeatClock`.
    clock: [f32; 4],
    /// Flux from a paired phone: see `Uniforms.flux0` in heartbeat.wgsl.
    flux0: [f32; 4],
    flux1: [f32; 4],
    /// Each screen's box for Flux: see `Uniforms.flux_regions` in heartbeat.wgsl.
    flux_regions: [[f32; 4]; MAX_FLUX_REGIONS],
    /// Dome canvas, dome grid and dome-placed layers: see `Uniforms.dome3`
    /// in heartbeat.wgsl.
    dome3: [f32; 4],
    dome4: [f32; 4],
    dlayer: [f32; 4],
    dview: [f32; 4],
    dview1: [f32; 4],
    dproj0: [f32; 4],
    dproj1: [f32; 4],
    dprojs: [[f32; 4]; 32],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LayerGpu {
    /// Conservative canvas-UV rectangle (min x, min y, max x, max y) outside
    /// which the layer cannot change a pixel. Filled at upload by
    /// `layer_cull_bounds`; the compositor tests it before anything else, so
    /// a layer that misses a pixel costs one read instead of several reads
    /// spread over its large record.
    cull: [f32; 4],
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
    /// (centerline points, effects, corners, diagonals)
    edge_info: [f32; 4],
    /// (centroid x px, centroid y px, perimeter px, inradius px)
    edge_geom: [f32; 4],
    /// (seed, _, _, _)
    edge_extra: [f32; 4],
    /// Centerline bounding box, px.
    edge_extra2: [f32; 4],
    /// Output-UV rectangle (min x, min y, max x, max y) the stack can touch.
    edge_bounds: [f32; 4],
    edge_chunks: [[f32; 4]; MAX_LAYER_EDGE_CHUNKS],
    edge_corners: [[f32; 4]; MAX_LAYER_EDGE_CORNERS],
    edge_diags: [[f32; 4]; MAX_LAYER_EDGE_DIAGONALS / 2],
    edge_pts: [[f32; 4]; MAX_LAYER_EDGE_POINTS],
    mask_info: [f32; 4],
    mask: [[f32; 4]; MAX_LAYER_MASK_POINTS],
    mesh: [[f32; 4]; MAX_LAYER_MESH_VEC4S],
    /// Where each mesh point rests on the layer, packed like `mesh`: the
    /// layer position a cell shows. The even lattice unless the mesh was
    /// fitted to a Custom Shape, whose mesh rests on the shape.
    mesh_rest: [[f32; 4]; MAX_LAYER_MESH_VEC4S],
    mesh_tangents: [[f32; 4]; MAX_LAYER_MESH_TANGENT_VEC4S],
    /// Quad-local (y-down) rectangle (min u, min v, max u, max v) that holds
    /// a Bezier mesh's whole surface, bulges past the corner quad included.
    /// Zero, and never read, for a straight mesh.
    mesh_bounds: [f32; 4],
    source_rect: [f32; 4],
    fast_flags: [u32; 4],
    /// Colour multiplier (r, g, b) applied to the layer's finished colour,
    /// edge effects included (Screen FX colour chases drive it), and in w
    /// the content alpha folded into `color`, so edge effects on a
    /// source-less layer are not dimmed with its placeholder.
    tint: [f32; 4],
    /// Placed on the dome (fast_flags[2]): azimuth, elevation, tangent of
    /// half the angular width, roll; radians. See `set_layer_dome`.
    dome: [f32; 4],
}

/// What the compositor reads of every layer: `LayerGpu` without the data
/// only some layers use, which `pack_layer_pools` moves into pool records
/// (heartbeat.wgsl LayerData and layer_pool). 240 bytes against ~30 KB.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LayerCoreGpu {
    cull: [f32; 4],
    p0: [f32; 4],
    p1: [f32; 4],
    color: [f32; 4],
    meta: [f32; 4],
    style: [f32; 4],
    uv0: [f32; 4],
    uv1: [f32; 4],
    source_rect: [f32; 4],
    fast_flags: [u32; 4],
    tint: [f32; 4],
    dome: [f32; 4],
    edge_extra: [f32; 4],
    /// Record starts in the pool (vec4 index): shape, effects, mask, mesh.
    pool: [u32; 4],
    /// Edge Effects record start, then unused.
    pool2: [u32; 4],
}

// Pool record layouts, in vec4s; heartbeat.wgsl's POOL_* constants match
// (layer_pool_layout_matches_the_shader).
const POOL_SHAPE_PTS: usize = 3;
const POOL_SHAPE_LEN: usize = POOL_SHAPE_PTS + 32;
const POOL_FX_LEN: usize = 6;
const POOL_MASK_PTS: usize = 1;
const POOL_MASK_LEN: usize = POOL_MASK_PTS + MAX_LAYER_MASK_POINTS;
const POOL_MESH_POINTS: usize = 1;
const POOL_MESH_REST: usize = POOL_MESH_POINTS + MAX_LAYER_MESH_VEC4S;
const POOL_MESH_TANGENTS: usize = POOL_MESH_REST + MAX_LAYER_MESH_VEC4S;
const POOL_MESH_LEN: usize = POOL_MESH_TANGENTS + MAX_LAYER_MESH_TANGENT_VEC4S;
const POOL_EDGE_EFFECTS: usize = 4;
const POOL_EDGE_CHUNKS: usize = POOL_EDGE_EFFECTS + MAX_LAYER_EDGE_EFFECTS * LAYER_EDGE_EFFECT_VEC4S;
const POOL_EDGE_CORNERS: usize = POOL_EDGE_CHUNKS + MAX_LAYER_EDGE_CHUNKS;
const POOL_EDGE_DIAGS: usize = POOL_EDGE_CORNERS + MAX_LAYER_EDGE_CORNERS;
const POOL_EDGE_PTS: usize = POOL_EDGE_DIAGS + MAX_LAYER_EDGE_DIAGONALS / 2;
const POOL_EDGE_LEN: usize = POOL_EDGE_PTS + MAX_LAYER_EDGE_POINTS;
/// The all-zero record at the start of every pool: as long as the longest record.
const POOL_ZERO_LEN: usize = POOL_EDGE_LEN;
/// A pool buffer's first size, in vec4s (grown in powers of two).
const POOL_MIN_CAPACITY: usize = 4096;

/// GA_CORE_LAYER_UPLOAD=full: every layer gets every pool record and a
/// buffer that changed is re-sent whole (close to the old upload, for
/// comparing). Default: absent records share the zero record and only the
/// changed ranges are sent.
fn layer_upload_full() -> bool {
    static FULL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FULL.get_or_init(|| std::env::var("GA_CORE_LAYER_UPLOAD").is_ok_and(|value| value.trim() == "full"))
}

/// Split `layers` into core records and pool records. A record whose data
/// is all zero points at the zero record (unless `full`), so the shader
/// reads the same zeros it read from the old full-size layer.
fn pack_layer_pools(layers: &[LayerGpu], full: bool, cores: &mut Vec<LayerCoreGpu>, pool: &mut Vec<[f32; 4]>) {
    cores.clear();
    pool.clear();
    pool.resize(POOL_ZERO_LEN, [0.0; 4]);
    fn record(pool: &mut Vec<[f32; 4]>, full: bool, len: usize, parts: &[&[[f32; 4]]]) -> u32 {
        debug_assert_eq!(parts.iter().map(|part| part.len()).sum::<usize>(), len);
        let empty = parts.iter().all(|part| bytemuck::cast_slice::<[f32; 4], u8>(part).iter().all(|byte| *byte == 0));
        if empty && !full {
            return 0;
        }
        let start = pool.len() as u32;
        for part in parts {
            pool.extend_from_slice(part);
        }
        start
    }
    for layer in layers {
        let shape = record(pool, full, POOL_SHAPE_LEN, &[&[layer.shape, layer.shape2, layer.shape_meta], &layer.shape_pts]);
        let fx = record(pool, full, POOL_FX_LEN, &[&[layer.params0, layer.params1, layer.effect0, layer.effect1, layer.effect2, layer.effect3]]);
        let mask = record(pool, full, POOL_MASK_LEN, &[&[layer.mask_info], &layer.mask]);
        let mesh = record(pool, full, POOL_MESH_LEN, &[&[layer.mesh_bounds], &layer.mesh, &layer.mesh_rest, &layer.mesh_tangents]);
        let edge = record(pool, full, POOL_EDGE_LEN, &[
            &[layer.edge_info, layer.edge_geom, layer.edge_extra2, layer.edge_bounds],
            bytemuck::cast_slice(&layer.edge_effects),
            &layer.edge_chunks, &layer.edge_corners, &layer.edge_diags, &layer.edge_pts,
        ]);
        cores.push(LayerCoreGpu {
            cull: layer.cull,
            p0: layer.p0,
            p1: layer.p1,
            color: layer.color,
            meta: layer.meta,
            style: layer.style,
            uv0: layer.uv0,
            uv1: layer.uv1,
            source_rect: layer.source_rect,
            fast_flags: layer.fast_flags,
            tint: layer.tint,
            dome: layer.dome,
            edge_extra: layer.edge_extra,
            pool: [shape, fx, mask, mesh],
            pool2: [edge, 0, 0, 0],
        });
    }
}

/// Send `new` to `buffer`, which holds `last`: only the `chunk`-byte blocks
/// that differ (neighbours merged into one write), then anything past the
/// end of `last`. `full` sends everything when anything changed. Returns
/// the bytes sent.
fn write_changed_ranges(queue: &wgpu::Queue, buffer: &wgpu::Buffer, new: &[u8], last: &mut Vec<u8>, chunk: usize, full: bool) -> usize {
    if new == last.as_slice() {
        return 0;
    }
    let mut sent = 0;
    if full {
        churn_probe::write_buffer(queue, buffer, 0, new);
        sent = new.len();
    } else {
        for (start, end) in changed_ranges(new, last, chunk) {
            churn_probe::write_buffer(queue, buffer, start as u64, &new[start..end]);
            sent += end - start;
        }
    }
    last.clear();
    last.extend_from_slice(new);
    sent
}

/// The byte ranges of `new` to send over a buffer holding `last`: runs of
/// differing `chunk`-byte blocks, then whatever lies past `last`'s end.
fn changed_ranges(new: &[u8], last: &[u8], chunk: usize) -> Vec<(usize, usize)> {
    let common = new.len().min(last.len()) / chunk * chunk;
    let mut ranges = Vec::new();
    let mut at = 0;
    while at < common {
        if new[at..at + chunk] == last[at..at + chunk] {
            at += chunk;
            continue;
        }
        let start = at;
        while at < common && new[at..at + chunk] != last[at..at + chunk] {
            at += chunk;
        }
        ranges.push((start, at));
    }
    if new.len() > common {
        ranges.push((common, new.len()));
    }
    ranges
}

/// Some layer reads its picture's mips (the compositor build with source
/// mips draws them).
fn layers_want_mips(layers: &[LayerGpu]) -> bool {
    layers.iter().any(|layer| layer.fast_flags[3] & 4 != 0)
}

/// A pool buffer of `capacity` vec4s.
fn create_layer_pool_buffer(device: &wgpu::Device, capacity: usize, label: &str) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: (capacity * std::mem::size_of::<[f32; 4]>()) as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

/// The share of the composite a layer covers, as (width, height) in 0..1
/// units: the bounding box of its corners, stretched by a mesh warp that
/// reaches past them.
fn layer_composite_extent(layer: &SceneLayer) -> (f32, f32) {
    let bounds = |points: &mut dyn Iterator<Item = [f32; 2]>| {
        let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for [x, y] in points {
            x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y);
        }
        if x1 < x0 { (1.0, 1.0) } else { ((x1 - x0).max(0.0), (y1 - y0).max(0.0)) }
    };
    let (mut width, mut height) = bounds(&mut layer.corners.iter().copied());
    if !layer.mesh_points.is_empty() {
        let (mesh_w, mesh_h) = bounds(&mut layer.mesh_points.iter().copied());
        width *= mesh_w.max(1.0);
        height *= mesh_h.max(1.0);
    }
    (width, height)
}

/// Whether `layer` can show its picture (`texels` wide and high, before
/// its crop) smaller than its size somewhere on a `composite` pixel canvas:
/// the picture's longest side against the layer's shortest edge on screen,
/// with room for a mesh to squeeze its cells and for the dome to shrink
/// what it places. Conservative: a no only skips mip reads the picture
/// could not use.
fn layer_may_minify(layer: &SceneLayer, texels: [f32; 2], composite: [f32; 2]) -> bool {
    let (span_x, span_y) = layer_source_span(layer);
    let shown = (texels[0] * span_x).max(texels[1] * span_y);
    let c = layer.corners;
    let edge = |a: [f32; 2], b: [f32; 2]| ((a[0] - b[0]) * composite[0]).hypot((a[1] - b[1]) * composite[1]);
    let shortest = edge(c[0], c[1]).min(edge(c[1], c[2])).min(edge(c[2], c[3])).min(edge(c[3], c[0]));
    let squeeze = if !layer.mesh_points.is_empty() || layer.dome.is_some() { 0.5 } else { 0.9 };
    !(shortest.is_finite() && shown.is_finite()) || shown > shortest * squeeze
}

/// See `App::layer_render_footprint`. A layer showing part of its picture (a
/// crop: a piece's share of a picture spread across the stage) needs the
/// whole picture at the detail it shows its part: its extent divided by
/// that part.
fn layer_render_footprint_for(layer: &SceneLayer, composite_w: u32, composite_h: u32, max_edge: u32) -> (u32, u32) {
    let (width, height) = layer_composite_extent(layer);
    let (span_x, span_y) = layer_source_span(layer);
    let (width, height) = (width / span_x, height / span_y);
    let edge = |extent: f32, composite: u32| -> u32 {
        if !extent.is_finite() {
            return max_edge;
        }
        let pixels = (extent * composite.max(1) as f32 * 1.25).ceil().max(1.0) as u32;
        pixels.div_ceil(128).saturating_mul(128).clamp(256.min(max_edge), max_edge)
    };
    (edge(width, composite_w), edge(height, composite_h))
}

/// Key of a group of layers sharing one single-pass shader render (see
/// `isf_shared_footprints`).
fn isf_share_key_for(shader_id: &str, source_hash: u64, input_source_slot: usize, quality: f32) -> String {
    format!("{shader_id}:{source_hash:016x}:{input_source_slot}:{:08x}", quality.to_bits())
}

/// The share of its source (width, height) a layer shows: its crop (the
/// `uv_transform` scale), narrowed further on the long side by Fill.
fn layer_source_span(layer: &SceneLayer) -> (f32, f32) {
    let mut span_x = layer.uv0[2].abs();
    let mut span_y = layer.uv0[3].abs();
    if (layer.uv1[0] + 0.5).floor() as i32 == 1 {
        let ratio = layer.uv1[1].max(0.0001);
        if ratio > 1.0 {
            span_x /= ratio;
        } else {
            span_y *= ratio;
        }
    }
    let span = |value: f32| if value.is_finite() { value.clamp(1.0 / 64.0, 1.0) } else { 1.0 };
    (span(span_x), span(span_y))
}

/// How much of the full decode size a video needs for the layers showing it
/// (see `video_decode_scale`). A layer showing part of the clip (a video wall
/// tile, a crop) needs its on-screen size divided by that part: a quarter-
/// width tile showing a quarter of the clip needs the full width.
fn video_decode_scale_for_layers<'a>(layers: impl Iterator<Item = &'a SceneLayer>) -> f32 {
    let mut needed = 0.0f32;
    let mut shown = false;
    for layer in layers {
        shown = true;
        let (width, height) = layer_composite_extent(layer);
        let (span_x, span_y) = layer_source_span(layer);
        needed = needed.max((width / span_x).max(height / span_y) * 1.25);
    }
    if !shown || !needed.is_finite() {
        return 1.0;
    }
    [0.25, 0.375, 0.5, 0.75].into_iter().find(|step| needed <= *step).unwrap_or(1.0)
}

/// Fill `out` with the tile bins for these cull bounds (see LAYER_TILES).
/// Pixels outside the 0..1 canvas (a dome, an output warp) are not binned
/// and walk every layer, so a layer that only reaches there is left out.
/// Layer slots the upload scratch keeps even for an empty scene, so a set
/// that adds and removes a few layers never reallocates.
const LAYER_UPLOAD_SCRATCH_MIN_SLOTS: usize = 16;

/// Sizes the layer upload scratch to `upload_len` slots: it grows to what the
/// scene uploads and gives memory back once the scene has shrunk to under a
/// quarter of what it holds (down to LAYER_UPLOAD_SCRATCH_MIN_SLOTS), so one
/// big scene earlier in a set does not keep its size for the rest of it.
fn fit_layer_upload_scratch(scratch: &mut Vec<LayerGpu>, upload_len: usize) {
    let upload_len = upload_len.min(MAX_SCENE_LAYERS);
    if scratch.len() < upload_len {
        scratch.resize(upload_len, LayerGpu::zeroed());
        return;
    }
    let keep = upload_len.max(LAYER_UPLOAD_SCRATCH_MIN_SLOTS);
    if scratch.capacity() > keep.saturating_mul(4) {
        scratch.truncate(keep);
        scratch.shrink_to(keep);
    }
}

/// The same rule for a byte buffer that mirrors the last upload.
fn fit_byte_scratch(scratch: &mut Vec<u8>, bytes: usize) {
    let keep = bytes.max(LAYER_UPLOAD_SCRATCH_MIN_SLOTS * std::mem::size_of::<LayerGpu>());
    if scratch.capacity() > keep.saturating_mul(4) {
        scratch.truncate(keep.min(scratch.len()));
        scratch.shrink_to(keep);
    }
}

/// Composite view keys of the two deck monitors and the record target.
const DECK_MONITOR_VIEWS: [&str; 2] = ["deck:a", "deck:b"];
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
const RECORD_TARGET_VIEW: &str = "record";

/// Frames a composite view (see `CompositeView`) is kept after it was last drawn.
const COMPOSITE_VIEW_KEEP_FRAMES: u64 = 120;

/// Compositor inputs of one view drawn after the program in the same frame:
/// a deck monitor, the record target or a full-detail Screen. They used to
/// share the program's uniform and layer buffers, so every view overwrote
/// the program's layers and the unchanged-upload check never matched.
struct CompositeView {
    uniform_buffer: wgpu::Buffer,
    /// The view's own layers, or None when it draws the program's.
    layers: Option<CompositeViewLayers>,
    /// Scene bind group 0 over this view's buffers.
    bind_group: wgpu::BindGroup,
    /// Its own layers read a minified picture's mips.
    wants_mips: bool,
    scene_bindings_generation: u64,
    used_epoch: u64,
}

struct CompositeViewLayers {
    layer_buffer: wgpu::Buffer,
    /// LayerCoreGpu slots `layer_buffer` holds.
    slots: usize,
    pool: LayerPoolState,
    tile_buffer: wgpu::Buffer,
    layer_last: Vec<u8>,
    mesh_cell_bounds_last: Vec<u32>,
    tile_last: Vec<u32>,
}

/// One composite's pool buffer (see `pack_layer_pools`) and what it and the
/// core records hold now.
struct LayerPoolState {
    buffer: wgpu::Buffer,
    /// vec4s `buffer` holds.
    capacity: usize,
    core_last: Vec<u8>,
    pool_last: Vec<u8>,
}

impl LayerPoolState {
    fn new(device: &wgpu::Device, label: &str) -> Self {
        Self {
            buffer: create_layer_pool_buffer(device, POOL_MIN_CAPACITY, label),
            capacity: POOL_MIN_CAPACITY,
            core_last: Vec::new(),
            pool_last: Vec::new(),
        }
    }
}

/// Scratch the packed layers are built in, reused frame to frame.
#[derive(Default)]
struct LayerPackScratch {
    cores: Vec<LayerCoreGpu>,
    pool: Vec<[f32; 4]>,
}

/// Where one composite's layers go, and what was sent there last.
struct CompositeLayerState<'a> {
    layer_buffer: &'a wgpu::Buffer,
    pool: &'a mut LayerPoolState,
    tile_buffer: &'a wgpu::Buffer,
    layer_last: &'a mut Vec<u8>,
    mesh_cell_bounds_last: &'a mut Vec<u32>,
    tile_last: &'a mut Vec<u32>,
}

/// Send `staged` (the first `filled` of them real layers) to `state`'s
/// buffers, skipping whatever is unchanged since the last upload there.
/// True when the pool buffer had to grow: bind groups over it are stale.
#[allow(clippy::too_many_arguments)]
fn upload_composite_layers(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    staged: &[LayerGpu],
    filled: usize,
    state: CompositeLayerState<'_>,
    pack: &mut LayerPackScratch,
    mesh_cell_bounds_scratch: &mut Vec<u32>,
    tile_scratch: &mut Vec<u32>,
) -> bool {
    let mut grown = false;
    fit_byte_scratch(state.layer_last, std::mem::size_of_val(staged));
    let layer_bytes: &[u8] = bytemuck::cast_slice(staged);
    if state.layer_last.as_slice() != layer_bytes {
        build_mesh_cell_bounds(&staged[..filled], mesh_cell_bounds_scratch);
        if *state.mesh_cell_bounds_last != *mesh_cell_bounds_scratch {
            churn_probe::write_buffer(queue,
                state.tile_buffer,
                (MESH_CELL_BOUNDS_BASE * std::mem::size_of::<u32>()) as u64,
                bytemuck::cast_slice(mesh_cell_bounds_scratch),
            );
            churn_probe::layer_bytes(mesh_cell_bounds_scratch.len() * 4);
            std::mem::swap(state.mesh_cell_bounds_last, mesh_cell_bounds_scratch);
        }
        let full = layer_upload_full();
        pack_layer_pools(staged, full, &mut pack.cores, &mut pack.pool);
        let pool = state.pool;
        if pack.pool.len() > pool.capacity {
            pool.capacity = pack.pool.len().next_power_of_two().max(POOL_MIN_CAPACITY);
            pool.buffer = create_layer_pool_buffer(device, pool.capacity, "Ghost Render Core Layer Pool");
            pool.pool_last.clear();
            grown = true;
        }
        let sent = write_changed_ranges(queue, state.layer_buffer, bytemuck::cast_slice(&pack.cores),
            &mut pool.core_last, std::mem::size_of::<LayerCoreGpu>(), full)
            + write_changed_ranges(queue, &pool.buffer, bytemuck::cast_slice(&pack.pool),
                &mut pool.pool_last, 256, full);
        churn_probe::layer_bytes(sent);
        state.layer_last.clear();
        state.layer_last.extend_from_slice(layer_bytes);
    }
    let culls = staged[..filled].iter().map(|layer| layer.cull).collect::<Vec<_>>();
    build_layer_tiles(&culls, tile_scratch);
    if *state.tile_last != *tile_scratch {
        churn_probe::write_buffer(queue, state.tile_buffer, 0, bytemuck::cast_slice(tile_scratch));
        churn_probe::layer_bytes(tile_scratch.len() * 4);
        std::mem::swap(state.tile_last, tile_scratch);
    }
    grown
}

fn build_layer_tiles(culls: &[[f32; 4]], out: &mut Vec<u32>) {
    out.clear();
    out.resize(LAYER_TILE_HEADER + LAYER_TILE_CELLS + 1, 0);
    out[0] = LAYER_TILES as u32;
    out[1] = LAYER_TILES as u32;
    let tile = |v: f32| ((v.clamp(0.0, 1.0) * LAYER_TILES as f32) as usize).min(LAYER_TILES - 1);
    let ranges = culls
        .iter()
        .map(|c| {
            let empty = !(c[0] <= c[2] && c[1] <= c[3]);
            let off_canvas = c[2] < 0.0 || c[3] < 0.0 || c[0] > 1.0 || c[1] > 1.0;
            (!empty && !off_canvas).then(|| (tile(c[0]), tile(c[1]), tile(c[2]), tile(c[3])))
        })
        .collect::<Vec<_>>();
    let mut counts = [0u32; LAYER_TILE_CELLS];
    let mut total = 0usize;
    for (x0, y0, x1, y1) in ranges.iter().flatten() {
        for ty in *y0..=*y1 {
            for tx in *x0..=*x1 {
                counts[ty * LAYER_TILES + tx] += 1;
            }
        }
        total += (x1 - x0 + 1) * (y1 - y0 + 1);
    }
    if total > LAYER_TILE_INDEX_CAP {
        return; // enabled stays 0
    }
    let mut cursor = [0u32; LAYER_TILE_CELLS];
    let mut running = 0u32;
    for cell in 0..LAYER_TILE_CELLS {
        out[LAYER_TILE_HEADER + cell] = running;
        cursor[cell] = running;
        running += counts[cell];
    }
    out[LAYER_TILE_HEADER + LAYER_TILE_CELLS] = running;
    let base = out.len();
    out.resize(base + total, 0);
    for (index, range) in ranges.iter().enumerate() {
        let Some((x0, y0, x1, y1)) = range else { continue };
        for ty in *y0..=*y1 {
            for tx in *x0..=*x1 {
                let cell = ty * LAYER_TILES + tx;
                out[base + cursor[cell] as usize] = index as u32;
                cursor[cell] += 1;
            }
        }
    }
    out[2] = 1;
    out[3] = total as u32;
}

/// Fill `out` with the mesh cell bounds for these layers (see
/// MESH_CELL_BOUNDS_BASE): the boxes `layer_mesh_straight_cell` and
/// `layer_mesh_bezier_cell` in heartbeat.wgsl test, from the same packed
/// points and tangents, padded by MESH_CELL_BOUNDS_SLACK more.
fn build_mesh_cell_bounds(layers: &[LayerGpu], out: &mut Vec<u32>) {
    out.clear();
    out.resize(MAX_SCENE_LAYERS, 0);
    let mut budget = MESH_CELL_BOUNDS_LAYERS * MESH_CELL_WORDS_PER_LAYER;
    for (index, layer) in layers.iter().enumerate().take(MAX_SCENE_LAYERS) {
        // Same rounding as layer_mesh_uv.
        let side = |v: f32| (v + 0.5).floor().clamp(0.0, 16.0) as usize;
        let rows = side(layer.style[2]);
        let cols = side(layer.style[3]);
        if rows < 2 || cols < 2 {
            continue;
        }
        let words = (rows - 1) * (cols - 1) * 4;
        if words > budget {
            continue;
        }
        budget -= words;
        out[index] = (MESH_CELL_BOUNDS_BASE + out.len()) as u32;
        let bezier = layer.fast_flags[1] == 1;
        let point = |i: usize| -> [f64; 2] {
            let packed = layer.mesh[i / 2];
            if i % 2 == 0 { [packed[0] as f64, packed[1] as f64] } else { [packed[2] as f64, packed[3] as f64] }
        };
        // layer_mesh_tangent: side 0 right, 1 down, 2 left, 3 up.
        let tangent = |i: usize, side: usize| -> [f64; 2] {
            let packed = layer.mesh_tangents[i * 2 + (side >> 1)];
            if side & 1 == 0 { [packed[0] as f64, packed[1] as f64] } else { [packed[2] as f64, packed[3] as f64] }
        };
        let add = |p: [f64; 2], t: [f64; 2]| [p[0] + t[0], p[1] + t[1]];
        let mix = |a: [f64; 2], b: [f64; 2], t: f64| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for row in 0..rows - 1 {
            for col in 0..cols - 1 {
                let ia = row * cols + col;
                let ib = ia + 1;
                let id = ia + cols;
                let ic = id + 1;
                let (a, b, c, d) = (point(ia), point(ib), point(ic), point(id));
                let mut pts = vec![a, b, c, d];
                let pad = if bezier {
                    // mesh_patch_build, then mesh_patch_contains_bounds.
                    let ab1 = add(a, tangent(ia, 0));
                    let ab2 = add(b, tangent(ib, 2));
                    let dc1 = add(d, tangent(id, 0));
                    let dc2 = add(c, tangent(ic, 2));
                    let ad1 = add(a, tangent(ia, 1));
                    let ad2 = add(d, tangent(id, 3));
                    let bc1 = add(b, tangent(ib, 1));
                    let bc2 = add(c, tangent(ic, 3));
                    pts.extend([ab1, ab2, dc1, dc2, ad1, ad2, bc1, bc2]);
                    for j in 1..=2usize {
                        for i in 1..=2usize {
                            let (fu, fv) = (i as f64 / 3.0, j as f64 / 3.0);
                            let top = if i == 1 { ab1 } else { ab2 };
                            let bottom = if i == 1 { dc1 } else { dc2 };
                            let left = if j == 1 { ad1 } else { ad2 };
                            let right = if j == 1 { bc1 } else { bc2 };
                            let sheet = mix(mix(a, b, fu), mix(d, c, fu), fv);
                            let tb = mix(top, bottom, fv);
                            let lr = mix(left, right, fu);
                            pts.push([tb[0] + lr[0] - sheet[0], tb[1] + lr[1] - sheet[1]]);
                        }
                    }
                    0.002
                } else {
                    0.000001
                };
                let mut lo = [f64::INFINITY; 2];
                let mut hi = [f64::NEG_INFINITY; 2];
                for p in &pts {
                    for k in 0..2 {
                        lo[k] = lo[k].min(p[k]);
                        hi[k] = hi[k].max(p[k]);
                    }
                }
                let reach = lo.iter().chain(hi.iter()).fold(0.0f64, |m, v| m.max(v.abs()));
                let grow = pad + MESH_CELL_BOUNDS_SLACK * (1.0 + reach);
                let mut cell = [(lo[0] - grow) as f32, (lo[1] - grow) as f32, (hi[0] + grow) as f32, (hi[1] + grow) as f32];
                // A point the shader could not bound (NaN, infinite) keeps
                // the whole plane: the shader's own test decides there.
                if cell.iter().any(|v| !v.is_finite()) {
                    cell = [f32::MIN, f32::MIN, f32::MAX, f32::MAX];
                }
                out.extend(cell.iter().map(|v| v.to_bits()));
            }
        }
    }
}

/// See `LayerGpu::cull`. Mirrors the compositor's own reject in
/// heartbeat.wgsl: hierarchy masks touch every pixel; hidden and fully
/// transparent layers touch none; everything else is bounded by its quad
/// (or a Bezier mesh's reach) plus the area its edge effects can glow into.
fn layer_cull_bounds(layer: &LayerGpu) -> [f32; 4] {
    const ALL: [f32; 4] = [-1.0e9, -1.0e9, 1.0e9, 1.0e9];
    const NONE: [f32; 4] = [1.0e9, 1.0e9, -1.0e9, -1.0e9];
    if layer.meta[0] < 0.5 {
        return NONE;
    }
    let blend = layer.style[0];
    if (25.5..26.5).contains(&blend) {
        return ALL;
    }
    if layer.color[3] <= 0.001 {
        return NONE;
    }
    let tl = [layer.p0[0], layer.p0[1]];
    let tr = [layer.p0[2], layer.p0[3]];
    let br = [layer.p1[0], layer.p1[1]];
    let bl = [layer.p1[2], layer.p1[3]];
    let mut corners = vec![tl, tr, br, bl];
    if layer.fast_flags[1] == 1 {
        // quad_reach_bounds: the mesh reach in quad-local UV, at least 0..1.
        let reach = layer.mesh_bounds;
        let lo = [reach[0].min(0.0), reach[1].min(0.0)];
        let hi = [reach[2].max(1.0), reach[3].max(1.0)];
        let at = |u: f32, v: f32| {
            let top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
            let bottom = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
            [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v]
        };
        corners.extend([at(lo[0], lo[1]), at(hi[0], lo[1]), at(hi[0], hi[1]), at(lo[0], hi[1])]);
    }
    if corners.iter().any(|c| !c[0].is_finite() || !c[1].is_finite()) {
        return ALL;
    }
    let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for c in &corners {
        b[0] = b[0].min(c[0]);
        b[1] = b[1].min(c[1]);
        b[2] = b[2].max(c[0]);
        b[3] = b[3].max(c[1]);
    }
    // Same padding as the shader's reject, doubled to stay conservative.
    let pad = (b[2] - b[0]).max(b[3] - b[1]).max(1.0) * 0.002;
    b = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
    if layer.edge_info[1] > 0.5 && layer.edge_info[0] > 2.5 {
        let e = layer.edge_bounds;
        b = [b[0].min(e[0]), b[1].min(e[1]), b[2].max(e[2]), b[3].max(e[3])];
    }
    b
}

/// Screens Flux plays inside separately (see `set_output_flux`).
const MAX_FLUX_REGIONS: usize = 16;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct PreviewPixel {
    rgba: [f32; 4],
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
    bounce_enabled: bool,
    duration_seconds: Option<f64>,
    trim_start: f64,
    trim_end: f64,
    decode_width: Option<usize>,
    decode_height: Option<usize>,
    clock_time_seconds: f64,
    seq: u64,
}

impl NativeMediaSourceState {
    fn current_playback_rate(&self, render_clock_time: Option<f64>) -> f64 {
        if !self.bounce_enabled || self.paused { return self.playback_rate; }
        let Some(duration) = self.duration_seconds.filter(|duration| *duration > 0.0) else {
            return self.playback_rate;
        };
        let lo = duration * self.trim_start;
        let span = (duration * self.trim_end - lo).max(f64::EPSILON);
        let elapsed = render_clock_time.map_or(0.0, |clock| (clock - self.clock_time_seconds).max(0.0));
        let phase = (self.playback_time_seconds + elapsed * self.playback_rate - lo).rem_euclid(2.0 * span);
        if phase.abs() < 1e-9 { self.playback_rate.abs() }
        else if (phase - span).abs() < 1e-9 { -self.playback_rate.abs() }
        else if phase < span { self.playback_rate } else { -self.playback_rate }
    }

    fn current_time_seconds(&self, render_clock_time: Option<f64>) -> f64 {
        let clock_delta = render_clock_time
            .map(|clock| clock - self.clock_time_seconds)
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
            if self.bounce_enabled {
                let phase = (time - range_start).rem_euclid(2.0 * range_duration);
                time = range_start + if phase <= range_duration { phase } else { 2.0 * range_duration - phase };
            } else if self.loop_enabled && !(self.playback_rate < 0.0 && (time - range_end).abs() < 1e-9) {
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

/// One video in a manual-clock snapshot: the media time and frame it shows,
/// and whether its playback should be moving it (playing, at a rate, and not
/// held at the far end of a clip that does not loop). A render fails when a
/// moving one stops changing frame.
fn manual_video_report_entry(id: &str, state: &NativeMediaSourceState, clock: f64, time: f64, fps: Option<f64>) -> Value {
    let rate = state.current_playback_rate(Some(clock));
    let mut moving = !state.paused && rate.abs() > 1e-9;
    if moving && !state.loop_enabled && !state.bounce_enabled
        && let Some(duration) = state.duration_seconds.filter(|d| *d > 0.0)
    {
        let lo = duration * state.trim_start.clamp(0.0, 1.0);
        let hi = duration * state.trim_end.clamp(state.trim_start, 1.0);
        let last = hi - fps.filter(|f| *f > 0.0).map_or(1.0e-3, |f| 1.0 / f);
        moving = if rate > 0.0 { time < last } else { time > lo };
    }
    // A loop shorter than two of its frames may show one frame throughout.
    if moving && (state.loop_enabled || state.bounce_enabled)
        && let (Some(duration), Some(fps)) = (state.duration_seconds.filter(|d| *d > 0.0), fps.filter(|f| *f > 0.0))
        && duration * (state.trim_end - state.trim_start).max(0.0) * fps < 2.0
    {
        moving = false;
    }
    json!({
        "id": id,
        "uri": state.uri,
        "time": time,
        "frame": fps.filter(|f| *f > 0.0).map(|f| (time * f + 1.0e-6).floor() as i64),
        "fps": fps,
        "rate": rate,
        "moving": moving,
        "paused": state.paused,
        "anchor_time": state.playback_time_seconds,
        "anchor_clock": state.clock_time_seconds,
        "seek_generation": state.seek_generation,
    })
}

/// The start of the source frame showing at media time `time_seconds`:
/// frame `floor(t * fps)` (with a hair for float error), or the time itself
/// when the rate is unknown.
fn manual_video_frame_time(time_seconds: f64, source_fps: Option<f64>) -> f64 {
    match source_fps.filter(|fps| fps.is_finite() && *fps > 0.0) {
        Some(fps) => ((time_seconds.max(0.0) * fps + 1.0e-6).floor()) / fps,
        None => time_seconds,
    }
}

/// Cache key for a manual-clock (offline export) video frame: the file,
/// decode size and the exact timestamp in microseconds, so frames closer
/// together than the live prefetch's 1/30 s buckets never alias.
fn manual_video_frame_signature(path: &Path, width: usize, height: usize, time_seconds: f64) -> Result<String, String> {
    let micros = (time_seconds.max(0.0) * 1_000_000.0).round() as u64;
    native_video_frame_file_signature(path, width, height, micros).map(|base| format!("manual-us:{base}"))
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
/// `render_view` (pipeline format). On macOS and Windows it then blits into
/// the shared-texture `export` the presenter imports zero-copy. Linux has no
/// shared-texture path, so there the panel reads `render_texture` back.
struct DeckMonitorTarget {
    render_texture: wgpu::Texture,
    render_view: wgpu::TextureView,
    width: u32,
    height: u32,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    export: NativeOutputExport,
}

/// One multi-output slice presented on its own physical display. Same shape
/// as a deck monitor — an offscreen composite plus a shared-texture export —
/// but sized to the display and carrying the slice's own output transform, so
/// each projector gets a full-resolution native composite of its own region
/// instead of a second WebGL renderer cropping a downscaled master.
///
/// One Screen's own composite. On macOS and Windows it is handed to Electron
/// as a shared texture (`export`) that a native layer in the Screen window
/// presents. Linux has no shared-texture path, so there the core presents it
/// itself into a child window parented inside the Screen window
/// (`LinuxSliceWindow`), and the target only tracks its size and frame.
struct SliceOutputTarget {
    _render_texture: wgpu::Texture,
    render_view: wgpu::TextureView,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    export: NativeOutputExport,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    width: u32,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    height: u32,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    frame: u64,
    /// Map Sim projector view feeding this slice's output stage, when the
    /// Screen's source is a Map Sim projector: (texture, view, presenter
    /// input bind group).
    projector_view_source: Option<(wgpu::Texture, wgpu::TextureView, wgpu::BindGroup)>,
}

impl SliceOutputTarget {
    fn size(&self) -> (u32, u32) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        { (self.export.width, self.export.height) }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        { (self.width, self.height) }
    }

    fn bump_frame(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        { self.export.frame = self.export.frame.saturating_add(1); }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        { self.frame = self.frame.saturating_add(1); }
    }
}

/// Linux: a Screen presented by the core itself. The window is an X11 child
/// of the Electron Screen window, so Electron still owns which display the
/// Screen is on and whether it is fullscreen; this only fills it.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
struct LinuxSliceWindow {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    blitter: TextureBlitter,
}

/// The recording target: one extra composite pass over the layers being
/// recorded (a single layer, a VJ row, or the whole composition with its
/// transparency), at composition size, exported as a shared texture the
/// main-process recorder reads like the output export. Same shape as a deck
/// monitor.
#[cfg(any(target_os = "macos", target_os = "windows"))]
struct RecordOutputTarget {
    _render_texture: wgpu::Texture,
    render_view: wgpu::TextureView,
    export: NativeOutputExport,
    alpha: bool,
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

/// Bezier tangents of an output-stage mesh: two vec4 per point, (right.xy,
/// down.xy) then (left.xy, up.xy), packed exactly like a layer mesh's.
const WARP_MESH_TANGENT_VEC4S: usize = WARP_MESH_MAX_DIM * WARP_MESH_MAX_DIM * 2;

/// An output-stage warp mesh (a screen's or the Master Warp's) packed for
/// the uniforms. `rows`/`cols` are zero when the grid is absent or unusable,
/// which the shader reads as "no mesh". `bezier` is set only when the grid
/// carries tangents; everything else stays on the straight bilinear path.
#[derive(Clone, Copy)]
struct WarpMesh {
    rows: f32,
    cols: f32,
    points: [[f32; 4]; 128],
    bezier: bool,
    tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
}

impl WarpMesh {
    fn none() -> Self {
        Self {
            rows: 0.0,
            cols: 0.0,
            points: [[0.0; 4]; 128],
            bezier: false,
            tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
        }
    }
}

/// Flatten a `{rows, cols, points: [[{x,y}]], bezier?, tangents?}` grid into
/// the packed control point array (two points per vec4, row-major) and, for
/// a Bezier grid, the resolved tangent of every point. Tangents resolve with
/// the layer mesh rules (parse_layer_mesh_tangents); the editor has already
/// moved them into the core's y-up frame along with the points.
fn warp_mesh_at(params: Option<&Value>) -> WarpMesh {
    let mut out = WarpMesh::none();
    let Some(grid) = params else { return out };
    let rows = number_at(grid, &["rows"]).unwrap_or(0.0) as usize;
    let cols = number_at(grid, &["cols"]).unwrap_or(0.0) as usize;
    if !(2..=WARP_MESH_MAX_DIM).contains(&rows) || !(2..=WARP_MESH_MAX_DIM).contains(&cols) {
        return out;
    }
    let Some(points) = grid.get("points").and_then(Value::as_array) else {
        return out;
    };
    let mut resolved_points = Vec::with_capacity(rows * cols);
    for row in 0..rows {
        let Some(row_points) = points.get(row).and_then(Value::as_array) else {
            return WarpMesh::none();
        };
        for col in 0..cols {
            // Identity fallback keeps a short row from folding the warp onto
            // itself; a malformed grid degrades to a flat pass-through cell.
            let fallback = [
                col as f32 / (cols - 1) as f32,
                row as f32 / (rows - 1) as f32,
            ];
            let point = warp_point_at(row_points.get(col), fallback);
            resolved_points.push(point);
            let index = row * cols + col;
            let slot = index / 2;
            if slot >= out.points.len() {
                break;
            }
            if index % 2 == 0 {
                out.points[slot][0] = point[0];
                out.points[slot][1] = point[1];
            } else {
                out.points[slot][2] = point[0];
                out.points[slot][3] = point[1];
            }
        }
    }
    out.rows = rows as f32;
    out.cols = cols as f32;
    if bool_at(grid, &["bezier"]) != Some(false) && resolved_points.len() == rows * cols {
        let tangents = parse_layer_mesh_tangents(grid.get("tangents"), rows, cols, &resolved_points);
        if tangents.len() == rows * cols {
            for (index, [right, down, left, up]) in tangents.into_iter().enumerate() {
                out.tangents[index * 2] = [right[0], right[1], down[0], down[1]];
                out.tangents[index * 2 + 1] = [left[0], left[1], up[0], up[1]];
            }
            out.bezier = true;
        }
    }
    out
}

/// Per-screen polygon masks, packed like the layer mask: up to 8 masks per
/// screen, 32 anchor points each, two points per vec4. Masks past the cap
/// are dropped whole rather than truncated into a different shape. A curved
/// edge is cut as a polyline (flatten_screen_mask), so one mask can use up
/// to SCREEN_MASK_FLAT_POINTS vertices in the uniforms.
const MAX_SCREEN_MASKS: usize = 8;
const SCREEN_MASK_POINTS_PER_MASK: usize = 32;
const SCREEN_MASK_FLAT_POINTS: usize = 128;
const MAX_SCREEN_MASK_POINTS: usize = MAX_SCREEN_MASKS * SCREEN_MASK_FLAT_POINTS;
const MAX_SCREEN_MASK_VEC4S: usize = MAX_SCREEN_MASK_POINTS / 2;
/// A flattened curve stays within this distance of the true cubic, in
/// screen UV: under half a pixel on a 4K projector. The editor preview
/// (flattenScreenMask in screenMaskGeometry.ts) uses the identical rule.
const SCREEN_MASK_CURVE_TOLERANCE: f64 = 1.0 / 8192.0;
const SCREEN_MASK_CURVE_MAX_SEGMENTS: f64 = 64.0;
/// Slack around a mask's bounds before a pixel skips the polygon test: far
/// above rounding, far below a pixel, so the reject never changes a pixel.
const SCREEN_MASK_BOUNDS_PAD: f32 = 1e-3;

/// One mask vertex with its optional curve handles (absolute positions).
#[derive(Clone, Copy)]
struct ScreenMaskAnchor {
    point: [f64; 2],
    cp_in: Option<[f64; 2]>,
    cp_out: Option<[f64; 2]>,
}

fn screen_mask_curve_segments(a: [f64; 2], c1: [f64; 2], c2: [f64; 2], b: [f64; 2], tolerance: f64) -> usize {
    // A cubic strays from its chord polyline by at most 3/4 of its largest
    // second difference over n^2.
    let d1 = [a[0] - 2.0 * c1[0] + c2[0], a[1] - 2.0 * c1[1] + c2[1]];
    let d2 = [c1[0] - 2.0 * c2[0] + b[0], c1[1] - 2.0 * c2[1] + b[1]];
    let dd = (d1[0] * d1[0] + d1[1] * d1[1]).sqrt().max((d2[0] * d2[0] + d2[1] * d2[1]).sqrt());
    let n = ((0.75 * dd) / tolerance).sqrt().ceil();
    if n.is_finite() { n.clamp(1.0, SCREEN_MASK_CURVE_MAX_SEGMENTS) as usize } else { 1 }
}

/// A mask outline as the polygon the shader cuts: the anchors, with each
/// curved edge (the anchor it leaves has cp_out, or the one it reaches has
/// cp_in) replaced by points along its cubic spaced to stay within
/// SCREEN_MASK_CURVE_TOLERANCE. When that needs more than
/// SCREEN_MASK_FLAT_POINTS vertices the tolerance doubles until it fits. A
/// mask without handles comes back as exactly its vertex list.
fn flatten_screen_mask(anchors: &[ScreenMaskAnchor]) -> Vec<[f32; 2]> {
    let count = anchors.len();
    let plain = |a: &ScreenMaskAnchor| [a.point[0] as f32, a.point[1] as f32];
    if count < 3 {
        return anchors.iter().map(plain).collect();
    }
    let edges: Vec<Option<[[f64; 2]; 4]>> = (0..count)
        .map(|i| {
            let a = anchors[i];
            let b = anchors[(i + 1) % count];
            if a.cp_out.is_none() && b.cp_in.is_none() {
                return None;
            }
            Some([a.point, a.cp_out.unwrap_or(a.point), b.cp_in.unwrap_or(b.point), b.point])
        })
        .collect();
    let segments_for = |tolerance: f64| -> Vec<usize> {
        edges
            .iter()
            .map(|edge| edge.map_or(1, |[a, c1, c2, b]| screen_mask_curve_segments(a, c1, c2, b, tolerance)))
            .collect()
    };
    let mut tolerance = SCREEN_MASK_CURVE_TOLERANCE;
    let mut segments = segments_for(tolerance);
    for _ in 0..40 {
        if segments.iter().sum::<usize>() <= SCREEN_MASK_FLAT_POINTS {
            break;
        }
        tolerance *= 2.0;
        segments = segments_for(tolerance);
    }
    let mut out = Vec::with_capacity(segments.iter().sum());
    for (i, anchor) in anchors.iter().enumerate() {
        out.push(plain(anchor));
        let Some([a, c1, c2, b]) = edges[i] else { continue };
        let n = segments[i];
        for k in 1..n {
            let t = k as f64 / n as f64;
            let mt = 1.0 - t;
            let (w0, w1, w2, w3) = (mt * mt * mt, 3.0 * mt * mt * t, 3.0 * mt * t * t, t * t * t);
            out.push([
                (w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0]) as f32,
                (w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1]) as f32,
            ]);
        }
    }
    out
}

/// Screen mask block for the uniforms: header (mask count, keep count), one
/// info vec4 per mask (point start, point count, feather, invert), padded
/// bounds per mask (x0, y0, x1, y1) and the packed vertex list. Points
/// arrive already in the core's y-up screen UV; the editor flips them (and
/// their curve handles) once at the sync boundary, as it does the warp
/// corners. A disabled mask or one with fewer than 3 usable points is
/// skipped so it can never black out the screen.
fn screen_masks_at(
    params: Option<&Value>,
) -> (
    [f32; 4],
    [[f32; 4]; MAX_SCREEN_MASKS],
    [[f32; 4]; MAX_SCREEN_MASKS],
    [[f32; 4]; MAX_SCREEN_MASK_VEC4S],
) {
    let mut info = [[0.0f32; 4]; MAX_SCREEN_MASKS];
    let mut bounds = [[0.0f32; 4]; MAX_SCREEN_MASKS];
    let mut points = [[0.0f32; 4]; MAX_SCREEN_MASK_VEC4S];
    let mut mask_count = 0usize;
    let mut keep_count = 0usize;
    let mut cursor = 0usize;
    let Some(entries) = params.and_then(Value::as_array) else {
        return ([0.0; 4], info, bounds, points);
    };
    // A vertex may sit outside the screen so a mask can run off its edge;
    // only nonsense values are rejected.
    let position = |value: Option<&Value>| -> Option<[f64; 2]> {
        let value = value?;
        let x = number_at(value, &["x"])?;
        let y = number_at(value, &["y"])?;
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        Some([x.clamp(-4.0, 5.0), y.clamp(-4.0, 5.0)])
    };
    for entry in entries {
        if mask_count >= MAX_SCREEN_MASKS {
            break;
        }
        if !bool_at(entry, &["enabled"]).unwrap_or(true) {
            continue;
        }
        let Some(vertices) = entry.get("points").and_then(Value::as_array) else {
            continue;
        };
        let anchors: Vec<ScreenMaskAnchor> = vertices
            .iter()
            .filter_map(|point| {
                Some(ScreenMaskAnchor {
                    point: position(Some(point))?,
                    cp_in: position(point.get("cpIn")),
                    cp_out: position(point.get("cpOut")),
                })
            })
            .take(SCREEN_MASK_POINTS_PER_MASK)
            .collect();
        if anchors.len() < 3 {
            continue;
        }
        let vertices = flatten_screen_mask(&anchors);
        if cursor + vertices.len() > MAX_SCREEN_MASK_POINTS {
            continue;
        }
        let invert = bool_at(entry, &["invert"]).unwrap_or(false);
        let feather = number_at(entry, &["feather"]).unwrap_or(0.0).clamp(0.0, 1.0) as f32;
        info[mask_count] = [
            cursor as f32,
            vertices.len() as f32,
            feather,
            if invert { 1.0 } else { 0.0 },
        ];
        let mut lo = [f32::INFINITY; 2];
        let mut hi = [f32::NEG_INFINITY; 2];
        for vertex in &vertices {
            lo = [lo[0].min(vertex[0]), lo[1].min(vertex[1])];
            hi = [hi[0].max(vertex[0]), hi[1].max(vertex[1])];
            let slot = cursor / 2;
            if cursor % 2 == 0 {
                points[slot][0] = vertex[0];
                points[slot][1] = vertex[1];
            } else {
                points[slot][2] = vertex[0];
                points[slot][3] = vertex[1];
            }
            cursor += 1;
        }
        bounds[mask_count] = [
            lo[0] - SCREEN_MASK_BOUNDS_PAD,
            lo[1] - SCREEN_MASK_BOUNDS_PAD,
            hi[0] + SCREEN_MASK_BOUNDS_PAD,
            hi[1] + SCREEN_MASK_BOUNDS_PAD,
        ];
        if !invert {
            keep_count += 1;
        }
        mask_count += 1;
    }
    ([mask_count as f32, keep_count as f32, 0.0, 0.0], info, bounds, points)
}

/// Upper bound on simultaneously-presented slice displays. Each one costs a
/// full composite pass per frame, so this is a guardrail against a project
/// with dozens of configured screens stalling the render loop.
const MAX_SLICE_OUTPUTS: usize = 32;
const MAX_SLICE_TEXTURE_BYTES: u64 = 512 * 1024 * 1024;

fn validate_slice_outputs(params: &Value) -> Result<(), String> {
    let entries = params.get("slices").and_then(Value::as_array)
        .ok_or_else(|| "screen outputs must be an array".to_string())?;
    if entries.len() > MAX_SLICE_OUTPUTS {
        return Err(format!("At most {MAX_SLICE_OUTPUTS} screen outputs can be open at once."));
    }
    let mut ids = HashSet::new();
    let mut bytes = 0u64;
    for entry in entries {
        let id = entry.get("id").and_then(Value::as_str).filter(|id| !id.trim().is_empty())
            .ok_or_else(|| "Every screen output needs an ID.".to_string())?;
        if !ids.insert(id) { return Err(format!("Duplicate screen output: {id}")); }
        let width = number_at(entry, &["width"]).unwrap_or(1920.0).clamp(16.0, 16384.0) as u64;
        let height = number_at(entry, &["height"]).unwrap_or(1080.0).clamp(16.0, 16384.0) as u64;
        bytes = bytes.saturating_add(width * height * 8);
    }
    if bytes > MAX_SLICE_TEXTURE_BYTES {
        return Err("Screen outputs exceed the 512 MiB texture budget. Close an output or lower its display resolution.".to_string());
    }
    Ok(())
}

/// A mirror dome warp mesh (Paul Bourke's format; see
/// src/lib/output/mirrorMesh.ts), ready to draw: each vertex's place on the
/// projector's image (x across -aspect..aspect, y -1..1), the fisheye
/// (domemaster) point it shows (u, v, 0..1, v up) and its brightness, and
/// two triangles for every grid cell whose four corners are in use.
#[derive(Debug)]
struct MirrorMesh {
    id: String,
    vertices: Vec<[f32; 5]>,
    indices: Vec<u32>,
}

impl MirrorMesh {
    fn from_command(command: &Value) -> Result<Self, String> {
        let id = string_at(command, &["mesh_id"])
            .filter(|id| !id.is_empty())
            .ok_or("set_mirror_mesh needs a mesh_id")?;
        let count = |key: &str| command.get(key).and_then(Value::as_u64).unwrap_or(0) as usize;
        let (cols, rows) = (count("cols"), count("rows"));
        if cols < 2 || rows < 2 || cols * rows > 512 * 512 {
            return Err(format!("mirror mesh {id}: a {cols} by {rows} grid is not one this core draws"));
        }
        let nodes: Vec<f32> = command
            .get("nodes")
            .and_then(Value::as_array)
            .map(|values| values.iter().map(|v| v.as_f64().unwrap_or(f64::NAN) as f32).collect())
            .unwrap_or_default();
        if nodes.len() < cols * rows * 5 {
            return Err(format!("mirror mesh {id}: {} values for a {cols} by {rows} grid", nodes.len()));
        }
        let vertices: Vec<[f32; 5]> = (0..cols * rows)
            .map(|k| [nodes[k * 5], nodes[k * 5 + 1], nodes[k * 5 + 2], nodes[k * 5 + 3], nodes[k * 5 + 4]])
            .collect();
        // A node is unused when it is not drawn (brightness below 0) or
        // shows no point of the fisheye (u or v outside 0..1).
        let used = |k: usize| {
            let [x, y, u, v, i] = vertices[k];
            [x, y, u, v, i].iter().all(|value| value.is_finite())
                && i >= 0.0 && (0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&v)
        };
        // A polar mesh (type 1) wraps its columns round.
        let wrap = command.get("mesh_type").and_then(Value::as_u64) == Some(1);
        let across = if wrap { cols } else { cols - 1 };
        let mut indices = Vec::new();
        for r in 0..rows - 1 {
            for c in 0..across {
                let c1 = (c + 1) % cols;
                let corners = [r * cols + c, r * cols + c1, (r + 1) * cols + c1, (r + 1) * cols + c];
                if corners.iter().all(|&k| used(k)) {
                    let [a, b, e, d] = corners.map(|k| k as u32);
                    indices.extend_from_slice(&[a, b, e, a, e, d]);
                }
            }
        }
        if indices.is_empty() {
            return Err(format!("mirror mesh {id}: no cell of it is drawn"));
        }
        Ok(Self { id, vertices, indices })
    }
}

/// Every projector of a dome rig (`set_slice_outputs`' domeRig): ids in
/// rig order and their frusta packed as `OutputStage::dprojs`. A Screen
/// that is one of them blends against all of them, whether or not their
/// own outputs are open.
struct DomeRig {
    ids: Vec<String>,
    frusta: [[f32; 4]; 32],
    blend_width: f32,
    blend_gamma: f32,
}

impl DomeRig {
    fn from_params(rig: Option<&Value>) -> Self {
        let mut out = Self { ids: Vec::new(), frusta: [[0.0; 4]; 32], blend_width: 0.25, blend_gamma: 2.2 };
        let Some(rig) = rig else { return out };
        out.blend_width = number_at(rig, &["blendWidth"]).filter(|v| v.is_finite()).unwrap_or(0.25).clamp(0.0, 1.0) as f32;
        out.blend_gamma = number_at(rig, &["blendGamma"]).filter(|v| v.is_finite()).unwrap_or(2.2).clamp(0.1, 4.0) as f32;
        for projector in rig.get("projectors").and_then(Value::as_array).into_iter().flatten().take(8) {
            let Some(id) = string_at(projector, &["id"]) else { continue };
            let values: Vec<f32> = projector
                .get("frustum")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_f64).map(|v| v as f32).collect())
                .unwrap_or_default();
            if values.len() < 16 || values.iter().any(|v| !v.is_finite()) {
                continue;
            }
            let slot = out.ids.len() * 4;
            for row in 0..4 {
                out.frusta[slot + row] = [values[row * 4], values[row * 4 + 1], values[row * 4 + 2], values[row * 4 + 3]];
            }
            out.ids.push(id);
        }
        out
    }
}

/// The square domemaster a mirror dome Screen is drawn from: Paul Bourke
/// suggests 2048 for HD projectors.
const MIRROR_MASTER_SIZE: u32 = 2048;

const MIRROR_MESH_WGSL: &str = r#"
struct MirrorUniforms { aspect: vec4<f32> };
@group(0) @binding(0) var dome_master: texture_2d<f32>;
@group(0) @binding(1) var dome_sampler: sampler;
@group(0) @binding(2) var<uniform> mu: MirrorUniforms;

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) intensity: f32,
};

@vertex
fn vs_mirror(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>, @location(2) intensity: f32) -> VsOut {
  var out: VsOut;
  // The mesh spans -aspect..aspect across, -1..1 up: the projector's frame.
  out.position = vec4<f32>(pos.x / max(mu.aspect.x, 0.01), pos.y, 0.0, 1.0);
  out.uv = uv;
  out.intensity = intensity;
  return out;
}

@fragment
fn fs_mirror(in: VsOut) -> @location(0) vec4<f32> {
  // v is up; the texture's rows run down.
  let color = textureSample(dome_master, dome_sampler, vec2<f32>(in.uv.x, 1.0 - in.uv.y)).rgb;
  return vec4<f32>(color * clamp(in.intensity, 0.0, 1.0), 1.0);
}
"#;

struct MirrorMeshGpu {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    count: u32,
}

struct MirrorRenderer {
    pipeline: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    _master: wgpu::Texture,
    master_view: wgpu::TextureView,
    meshes: HashMap<String, MirrorMeshGpu>,
}

impl MirrorRenderer {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        Self::build(device, format, MIRROR_MASTER_SIZE)
    }

    /// Build the pipeline once and let it go (the master at one texel), so
    /// the driver's shader cache holds it before the first mirror dome
    /// Screen needs it. Any thread.
    fn prewarm(device: &wgpu::Device, format: wgpu::TextureFormat) {
        let _ = Self::build(device, format, 1);
    }

    fn build(device: &wgpu::Device, format: wgpu::TextureFormat, master_size: u32) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Mirror dome mesh"),
            source: wgpu::ShaderSource::Wgsl(MIRROR_MESH_WGSL.into()),
        });
        let master = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Mirror dome master"),
            size: wgpu::Extent3d { width: master_size, height: master_size, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let master_view = master.create_view(&Default::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Mirror dome master"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Mirror dome mesh uniforms"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Mirror dome mesh"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Mirror dome mesh"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&master_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) },
                wgpu::BindGroupEntry { binding: 2, resource: uniform.as_entire_binding() },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Mirror dome mesh"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Mirror dome mesh"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_mirror"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 20,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Float32],
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_mirror"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: pipeline_cache::for_device(device).as_ref(),
        });
        Self { pipeline, uniform, bind_group, _master: master, master_view, meshes: HashMap::new() }
    }
}

/// Editor-side description of a slice output: where it presents and how the
/// master composition maps onto it.
#[derive(Clone)]
struct SliceOutputSpec {
    id: String,
    width: u32,
    height: u32,
    stage: OutputStage,
    /// Map Sim projector whose view this slice shows instead of a crop of
    /// the master.
    projector_view: Option<String>,
    /// A mirror dome: the Screen shows the dome picture through this warp
    /// mesh instead of a crop of the master (`draw_mirror_dome`). The id
    /// stays when the mesh has not arrived yet, so it attaches when it does.
    mirror_mesh_id: Option<String>,
    mirror_mesh: Option<Arc<MirrorMesh>>,
}

/// Which layers the recording target renders.
#[derive(Clone, Debug, PartialEq)]
enum RecordTargetSource {
    /// Every layer, with composition effects: the composition itself, kept
    /// transparent where nothing is drawn.
    Composition,
    /// Mapping layers by id (a VJ clip transition can briefly add a second).
    Layers(Vec<String>),
    /// Every layer on one VJ row, including both sides of a clip transition.
    VjLayer(i32),
}

/// Editor request for a recording of one source, before or instead of the
/// program composite.
#[derive(Clone, Debug, PartialEq)]
struct RecordTargetSpec {
    source: RecordTargetSource,
    /// Straight alpha out (transparent background). Off: the layer over black.
    alpha: bool,
}

impl RecordTargetSpec {
    fn kind(&self) -> &'static str {
        match self.source {
            RecordTargetSource::Composition => "composition",
            RecordTargetSource::Layers(_) => "layer",
            RecordTargetSource::VjLayer(_) => "vj_layer",
        }
    }

    fn includes(&self, layer: &SceneLayer) -> bool {
        match &self.source {
            RecordTargetSource::Composition => true,
            RecordTargetSource::Layers(ids) => ids.iter().any(|id| *id == layer.id),
            RecordTargetSource::VjLayer(index) => layer.vj_layer_index == Some(*index),
        }
    }
}

/// `set_record_target` params. `kind: "none"` (or no kind) clears it.
fn parse_record_target(params: &Value) -> Result<Option<RecordTargetSpec>, String> {
    let kind = string_at(params, &["kind"]).unwrap_or_default().to_ascii_lowercase();
    let alpha = bool_at(params, &["alpha"]).unwrap_or(false);
    let source = match kind.as_str() {
        "" | "none" | "off" => return Ok(None),
        "composition" => RecordTargetSource::Composition,
        "layer" => {
            let mut ids: Vec<String> = params
                .get("layer_ids")
                .and_then(Value::as_array)
                .map(|ids| ids.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            if let Some(id) = string_at(params, &["layer_id"]) {
                ids.push(id);
            }
            ids.retain(|id| !id.trim().is_empty());
            ids.dedup();
            if ids.is_empty() {
                return Err("record target layer needs layer_id".to_string());
            }
            RecordTargetSource::Layers(ids)
        }
        "vj_layer" => {
            let index = number_at(params, &["vj_layer_index"])
                .filter(|value| value.is_finite() && *value >= 0.0 && *value < 1024.0)
                .ok_or("record target vj_layer needs vj_layer_index")?;
            RecordTargetSource::VjLayer(index.round() as i32)
        }
        other => return Err(format!("unknown record target kind: {other}")),
    };
    Ok(Some(RecordTargetSpec { source, alpha }))
}

/// `export_frame_snapshot` sources served from an already-rendered shared
/// texture rather than by re-rendering the scene.
fn live_capture_export_source(source: &str) -> bool {
    source.eq_ignore_ascii_case("output") || source == "record_target" || source.starts_with("slice:")
}

/// Output stage for the recording pass: the untransformed composition, with
/// the compositor's straight-alpha output switched on when asked.
/// A dome placement in degrees as the compositor reads it: azimuth,
/// elevation, the tangent of half the angular width, roll, in radians.
/// The width stays short of 180 degrees, where a flat canvas has no edge.
fn dome_place_gpu(azimuth: f64, elevation: f64, size: f64, roll: f64) -> [f32; 4] {
    let finite = |v: f64, fallback: f64| if v.is_finite() { v } else { fallback };
    let half = (finite(size, 60.0).clamp(1.0, 170.0) * 0.5).to_radians();
    [
        finite(azimuth, 0.0).to_radians() as f32,
        finite(elevation, 90.0).clamp(-90.0, 90.0).to_radians() as f32,
        half.tan() as f32,
        finite(roll, 0.0).to_radians() as f32,
    ]
}

fn record_target_output_stage(alpha: bool) -> OutputStage {
    let mut stage = OutputStage::default();
    stage.smask[2] = if alpha { 1.0 } else { 0.0 };
    stage
}

/// Output stage for a slice fed by a Map Sim projector view. The view is
/// already the projector's whole image, so the master crop, screen warp,
/// master warp and dome (all sampling positions on the master) are
/// identity; rotation, colour grade, edge blend, black level and masks
/// still apply as for any Screen.
fn projector_view_output_stage(stage: OutputStage) -> OutputStage {
    OutputStage {
        out0: [0.0, 0.0, 1.0, 1.0],
        dome0: [0.0; 4],
        dlayer: [0.0; 4],
        projector_calibration: [[0.0; 4]; 5],
        swarp: [0.0; 4],
        swarp_c0: [0.0, 0.0, 1.0, 0.0],
        swarp_c1: [1.0, 1.0, 0.0, 1.0],
        mwarp: [0.0; 4],
        mwarp_c0: [0.0, 0.0, 1.0, 0.0],
        mwarp_c1: [1.0, 1.0, 0.0, 1.0],
        ..stage
    }
}

/// What the slice pass needs to draw Map Sim projector views.
struct ProjectorViewInputs<'a> {
    scene: Option<&'a projector_view::ProjectorViewScene>,
    meshes: &'a HashMap<String, Arc<projector_view::ProjectorViewMeshData>>,
    overlays: &'a HashMap<String, projector_view::ProjectorViewOverlay>,
}

/// The picture a layer showed before its source changed. It stays on screen
/// until the new source delivers a picture of its own, so switching a layer
/// to a page, shader or image that is still starting never flashes the
/// loading fill or the layers underneath.
#[derive(Clone, Debug)]
struct HeldPicture {
    source_id: String,
    slot: usize,
    rect: [f32; 4],
    kind: f32,
    since: Instant,
}

/// How long a layer may hold its outgoing picture. A source that has not
/// delivered by then (a page that failed to load, a broken file) shows its
/// loading state instead of leaving the old content up.
const LAYER_HOLD_MAX: Duration = Duration::from_millis(1500);

#[derive(Clone, Debug)]
struct SceneLayer {
    id: String,
    z_index: i32,
    vj_layer_index: Option<i32>,
    visible: bool,
    opacity: f32,
    source_kind: f32,
    source_id: Option<String>,
    /// Raw media retained while the layer displays its processed effect output.
    effect_input_source_id: Option<String>,
    shader_id: Option<String>,
    shader_rendered: bool,
    /// Per-layer override for the global quality tier's render scale. None
    /// means inherit. A layer carrying one heavy raymarcher can be dropped on
    /// its own without softening everything else on the wall.
    render_quality: Option<f32>,
    preview_slot: Option<usize>,
    frame_slot: Option<usize>,
    /// Slot holding this layer's core-rendered FS/ISF shader frame — kept
    /// separate from frame_slot so an effect chain can DISPLAY its output on
    /// the layer while still SAMPLING the raw shader render as input.
    shader_frame_slot: Option<usize>,
    /// Source id that owns shader_frame_slot. A shader's output is not the
    /// layer's source_id (that is the shader's INPUT), so without this the
    /// slot looks unreferenced and the pool hands it to another layer.
    shader_source_id: Option<String>,
    color: [f32; 4],
    /// The colour was set by the editor (a colour layer), so it IS the
    /// content and draws at full strength. Otherwise `color` is the hashed
    /// placeholder an empty layer shows, which the shader deliberately dims.
    explicit_color: bool,
    corners: [[f32; 2]; 4],
    /// The corner pin is a true perspective (homography) instead of the
    /// bilinear map: a flat face seen at a slant, measured by the phone.
    /// Off by default so existing corner warps draw exactly as before.
    corner_perspective: bool,
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
    edge: Box<LayerEdgeEffects>,
    mask_info: [f32; 4],
    mask_points: Vec<[f32; 4]>,
    mesh_rows: u32,
    mesh_cols: u32,
    mesh_points: Vec<[f32; 2]>,
    /// Rest position of each mesh point on the layer (y up, like
    /// `mesh_points`). Empty for the even lattice over the whole layer.
    mesh_rest: Vec<[f32; 2]>,
    /// Resolved Bezier tangents per mesh point (right, down, left, up), in
    /// the same y-up layer coordinates as `mesh_points`. Empty for a
    /// straight-edged mesh, which keeps the original bilinear cell path.
    mesh_tangents: Vec<[[f32; 2]; 4]>,
    source_rect: [f32; 4],
    /// VJ deck-monitor tag: Some(0)=bank A, Some(1)=bank B. Tagged layers
    /// re-render into the deck confidence monitor targets at
    /// `deck_monitor_opacity` (their true pre-crossfader level).
    deck_monitor_bank: Option<u8>,
    deck_monitor_opacity: f32,
    /// Colour multiplier from `set_layer_tint`; white leaves the layer as is.
    tint: [f32; 4],
    /// Where the layer sits on the dome, from `set_layer_dome`, packed as
    /// `LayerGpu::dome`. None composites it on the canvas like any layer.
    dome: Option<[f32; 4]>,
    /// The outgoing picture, shown until the new source has one.
    held: Option<HeldPicture>,
}

#[derive(Clone, Debug)]
struct PendingMediaBinding {
    source_id: String,
    source_type: String,
}

fn is_clip_snapshot_source_id(source_id: &str) -> bool {
    source_id.strip_prefix("vj-clip-snapshot-")
        .and_then(|suffix| suffix.split_once('-'))
        .is_some_and(|(deck, row)| matches!(deck, "A" | "B")
            && row.parse::<u8>().is_ok_and(|index| index < 32 && row == index.to_string()))
}

#[derive(Default)]
struct SourceFrameGpuReadiness {
    epoch: AtomicU64,
    submitted_epoch: AtomicU64,
    completed_epoch: AtomicU64,
}

impl SourceFrameGpuReadiness {
    fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
    }

    fn ready(&self) -> bool {
        let epoch = self.epoch.load(Ordering::Acquire);
        epoch > 0 && self.completed_epoch.load(Ordering::Acquire) == epoch
    }

    fn submitted(&self) -> bool {
        let epoch = self.epoch.load(Ordering::Acquire);
        epoch > 0 && self.submitted_epoch.load(Ordering::Acquire) == epoch
    }
}

impl SceneLayer {
    fn new(id: String, z_index: i32) -> Self {
        Self {
            color: stable_layer_color(&id, 1.0),
            explicit_color: false,
            id,
            z_index,
            vj_layer_index: None,
            visible: true,
            opacity: 1.0,
            source_kind: 0.0,
            source_id: None,
            effect_input_source_id: None,
            shader_id: None,
            shader_rendered: false,
            render_quality: None,
            preview_slot: None,
            frame_slot: None,
            shader_frame_slot: None,
            shader_source_id: None,
            corners: [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            corner_perspective: false,
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
            edge: Box::default(),
            mask_info: [0.0; 4],
            mask_points: Vec::new(),
            mesh_rows: 0,
            mesh_cols: 0,
            mesh_points: Vec::new(),
            mesh_rest: Vec::new(),
            mesh_tangents: Vec::new(),
            source_rect: [0.0, 0.0, 1.0, 1.0],
            deck_monitor_bank: None,
            deck_monitor_opacity: 1.0,
            tint: [1.0; 4],
            dome: None,
            held: None,
        }
    }

    fn gpu(&self) -> LayerGpu {
        let [tl, tr, br, bl] = self.corners;
        let held = self.held.as_ref();
        // Missing media pixels are not a solid-colour source. This also
        // covers a video whose texture was evicted under pool pressure.
        let waiting_for_video = held.is_none()
            && self.source_kind == source_kind("video")
            && self.frame_slot.is_none();
        // Likewise a shader whose pipeline is still building on the worker
        // thread: it shows nothing until its first frame, not a colour block.
        let waiting_for_shader = held.is_none()
            && self.shader_id.is_some()
            && !self.shader_rendered
            && !self.explicit_color
            && !self.source_id.as_deref().is_some_and(|id| id.starts_with("effect-pass:"));
        // An empty layer (nothing bound, no colour of its own) draws the
        // alignment card instead of a flat fill, so it takes the full path.
        let empty_card = held.is_none() && self.shows_empty_card();
        let plain_fill = held.is_none() && !empty_card && !self.shader_rendered && self.source_kind < 9.0
            && self.frame_slot.is_none() && self.preview_slot.is_none()
            && self.effect_count < 0.5 && self.mesh_rows < 2 && self.mesh_cols < 2
            && self.shape == [0.0, 0.0, 0.0, 1.0] && self.shape2 == [1.0, 0.7, 6.0, 0.4]
            && self.shape_meta == [0.0; 4] && self.mask_info[0] < 0.5
            && !(25.5..26.5).contains(&self.blend_code)
            && !self.has_edge_effects()
            && tl[1] == tr[1] && bl[1] == br[1] && tl[0] == bl[0] && tr[0] == br[0]
            && (br[0] - tl[0]).abs() > 0.000001 && (br[1] - tl[1]).abs() > 0.000001;
        LayerGpu {
            cull: [0.0; 4],
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
                if waiting_for_video || waiting_for_shader { 0.0 } else {
                    self.opacity.clamp(0.0, 1.0) * self.color[3].clamp(0.0, 1.0)
                },
            ],
            meta: [
                if self.visible { 1.0 } else { 0.0 },
                self.z_index as f32,
                if let Some(held) = held {
                    held.kind
                } else if self.shader_rendered {
                    NATIVE_SHADER_SOURCE_KIND
                } else {
                    self.source_kind
                },
                if let Some(held) = held {
                    SOURCE_FRAME_SLOT_OFFSET + held.slot as f32 + 1.0
                } else {
                    self.frame_slot
                        .map(|slot| SOURCE_FRAME_SLOT_OFFSET + slot as f32 + 1.0)
                        .or_else(|| self.preview_slot.map(|slot| slot as f32 + 1.0))
                        .unwrap_or(0.0)
                },
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
            edge_effects: self.edge.effects_gpu(),
            edge_info: self.edge.info_gpu(),
            edge_geom: self.edge.geometry,
            edge_extra: [self.edge.seed, self.sourceless_content_alpha(), if empty_card { 1.0 } else { 0.0 }, 0.0],
            edge_extra2: self.edge.bbox_gpu(),
            edge_bounds: self.edge.bounds,
            edge_chunks: self.edge.chunks_gpu(),
            edge_corners: self.edge.corners_gpu(),
            edge_diags: self.edge.diagonals_gpu(),
            edge_pts: self.edge.points_gpu(),
            mask_info: self.mask_info,
            mask: self.mask_gpu(),
            mesh: self.mesh_gpu(),
            mesh_rest: self.mesh_rest_gpu(),
            mesh_tangents: self.mesh_tangents_gpu(),
            mesh_bounds: self.mesh_bounds_gpu(),
            source_rect: held.map_or(self.source_rect, |held| held.rect),
            // w bit 1: perspective corner pin (bit 0 is the painted mask's inversion).
            fast_flags: [u32::from(plain_fill), u32::from(self.mesh_is_bezier()), u32::from(self.dome.is_some()), u32::from(self.corner_perspective) << 1],
            tint: [self.tint[0], self.tint[1], self.tint[2], self.color[3].clamp(0.0, 1.0)],
            dome: self.dome.unwrap_or([0.0; 4]),
        }
    }

    /// How strongly a layer with no source draws its own colour.
    ///
    /// An empty layer shows a dimmed placeholder so it reads as "nothing
    /// loaded yet" rather than as content. A colour layer has no source
    /// either -- its colour is its content -- and the shader applied the same
    /// 0.56 to both, so every solid colour went to output at 56%: pure white
    /// arrived as 143/255, on the editor, the output window, Spout and in
    /// recordings alike. Media is unaffected; it takes the sourced path.
    /// True for a layer with nothing bound and no colour of its own: it
    /// shows the alignment card. A layer whose media is still loading keeps
    /// its source kind and does not, so the card never flashes during a load.
    fn shows_empty_card(&self) -> bool {
        !self.explicit_color && !self.shader_rendered && self.source_kind < 0.5
            && self.frame_slot.is_none() && self.preview_slot.is_none()
    }

    fn sourceless_content_alpha(&self) -> f32 {
        if self.explicit_color { 1.0 } else { SOURCELESS_PLACEHOLDER_ALPHA }
    }

    /// A mesh renders as Bezier patches only when it carries a tangent for
    /// every point. Anything else takes the bilinear cell path unchanged.
    fn mesh_is_bezier(&self) -> bool {
        self.mesh_rows >= 2
            && self.mesh_cols >= 2
            && self.mesh_tangents.len() == (self.mesh_rows * self.mesh_cols) as usize
    }

    fn mesh_tangents_gpu(&self) -> [[f32; 4]; MAX_LAYER_MESH_TANGENT_VEC4S] {
        let mut packed = [[0.0; 4]; MAX_LAYER_MESH_TANGENT_VEC4S];
        if !self.mesh_is_bezier() {
            return packed;
        }
        for (index, tangents) in self
            .mesh_tangents
            .iter()
            .take(MAX_LAYER_MESH_POINTS)
            .enumerate()
        {
            let [right, down, left, up] = *tangents;
            // Offsets flip with the points: y-up layer space to the
            // compositor's y-down quad-local space.
            packed[index * 2] = [right[0], -right[1], down[0], -down[1]];
            packed[index * 2 + 1] = [left[0], -left[1], up[0], -up[1]];
        }
        packed
    }

    /// The quad-local rectangle a Bezier mesh's surface can reach. Each cell
    /// is a bicubic patch inside the hull of its 16 control points: the
    /// corners, the eight edge handles and the four inner points of its
    /// Bezier form (the same ones mesh_patch_inner in heartbeat.wgsl builds).
    /// The shader bounds a Bezier layer's pixels by this instead of the
    /// corner quad, so a bulge past the quad keeps its content.
    fn mesh_bounds_gpu(&self) -> [f32; 4] {
        if !self.mesh_is_bezier() {
            return [0.0; 4];
        }
        let rows = self.mesh_rows as usize;
        let cols = self.mesh_cols as usize;
        // Same flip as mesh_gpu / mesh_tangents_gpu: y-up layer space to
        // the compositor's y-down quad-local space.
        let point = |row: usize, col: usize| {
            let p = self.mesh_points[row * cols + col];
            [p[0], 1.0 - p[1]]
        };
        let handle = |row: usize, col: usize, side: usize| {
            let p = point(row, col);
            let t = self.mesh_tangents[row * cols + col][side];
            [p[0] + t[0], p[1] - t[1]]
        };
        let mut lo = [f32::INFINITY; 2];
        let mut hi = [f32::NEG_INFINITY; 2];
        let mut grow = |q: [f32; 2]| {
            lo = [lo[0].min(q[0]), lo[1].min(q[1])];
            hi = [hi[0].max(q[0]), hi[1].max(q[1])];
        };
        let mix = |a: [f32; 2], b: [f32; 2], t: f32| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const RIGHT: usize = 0;
        const DOWN: usize = 1;
        const LEFT: usize = 2;
        const UP: usize = 3;
        for row in 0..rows - 1 {
            for col in 0..cols - 1 {
                let (a, b) = (point(row, col), point(row, col + 1));
                let (c, d) = (point(row + 1, col + 1), point(row + 1, col));
                let top = [handle(row, col, RIGHT), handle(row, col + 1, LEFT)];
                let bottom = [handle(row + 1, col, RIGHT), handle(row + 1, col + 1, LEFT)];
                // Layer-space "down" is the next row, which is further down
                // in quad-local space too once y is flipped.
                let left = [handle(row, col, DOWN), handle(row + 1, col, UP)];
                let right = [handle(row, col + 1, DOWN), handle(row + 1, col + 1, UP)];
                for q in [a, b, c, d, top[0], top[1], bottom[0], bottom[1], left[0], left[1], right[0], right[1]] {
                    grow(q);
                }
                for j in 1..=2usize {
                    for i in 1..=2usize {
                        let (fu, fv) = (i as f32 / 3.0, j as f32 / 3.0);
                        let tb = mix(top[i - 1], bottom[i - 1], fv);
                        let lr = mix(left[j - 1], right[j - 1], fu);
                        let sheet = mix(mix(a, b, fu), mix(d, c, fu), fv);
                        grow([tb[0] + lr[0] - sheet[0], tb[1] + lr[1] - sheet[1]]);
                    }
                }
            }
        }
        [lo[0], lo[1], hi[0], hi[1]]
    }

    fn has_edge_effects(&self) -> bool {
        self.edge.active()
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

    /// The rest lattice in the compositor's y-down layer space: the grid's
    /// own when it was fitted to a shape, the even lattice otherwise.
    fn mesh_rest_gpu(&self) -> [[f32; 4]; MAX_LAYER_MESH_VEC4S] {
        let mut packed = [[0.0; 4]; MAX_LAYER_MESH_VEC4S];
        let rows = self.mesh_rows as usize;
        let cols = self.mesh_cols as usize;
        if rows < 2 || cols < 2 {
            return packed;
        }
        let fitted = self.mesh_rest.len() == rows * cols;
        for index in 0..(rows * cols).min(MAX_LAYER_MESH_POINTS) {
            let (x, y) = if fitted {
                let p = self.mesh_rest[index];
                (p[0], 1.0 - p[1])
            } else {
                ((index % cols) as f32 / (cols - 1) as f32, (index / cols) as f32 / (rows - 1) as f32)
            };
            let target = &mut packed[index / 2];
            let offset = (index % 2) * 2;
            target[offset] = x;
            target[offset + 1] = y;
        }
        packed
    }
}

/// Parse a `mesh_grid` command value onto a layer: the control points and,
/// for a Bezier mesh, the resolved tangent of every point. A grid the
/// compositor cannot take clears the mesh rather than drawing a partial one.
fn apply_layer_mesh_grid(entry: &mut SceneLayer, mesh: Option<&Value>) {
    entry.mesh_rows = 0;
    entry.mesh_cols = 0;
    entry.mesh_points.clear();
    entry.mesh_rest.clear();
    entry.mesh_tangents.clear();
    let Some(mesh) = mesh.and_then(Value::as_object) else { return };
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
    if rows < 2 || cols < 2 || expected > MAX_LAYER_MESH_POINTS {
        return;
    }
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
    if points.len() != expected {
        return;
    }
    entry.mesh_rows = rows;
    entry.mesh_cols = cols;
    entry.mesh_tangents = parse_layer_mesh_tangents(mesh.get("tangents"), rows as usize, cols as usize, &points);
    entry.mesh_points = points;
    entry.mesh_rest = parse_layer_mesh_rest(mesh.get("rest"), rows as usize, cols as usize);
}

/// A mesh fitted to a Custom Shape carries `rest`: where each point sits on
/// the layer while unwarped (`[row][col]` of `{x, y}`, y up). Anything short
/// of a full grid is the even lattice, returned as an empty vec.
fn parse_layer_mesh_rest(rest: Option<&Value>, rows: usize, cols: usize) -> Vec<[f32; 2]> {
    let Some(rest_rows) = rest.and_then(Value::as_array) else { return Vec::new() };
    if rest_rows.len() != rows {
        return Vec::new();
    }
    let mut points = Vec::with_capacity(rows * cols);
    for row in rest_rows {
        let Some(row_points) = row.as_array() else { return Vec::new() };
        if row_points.len() != cols {
            return Vec::new();
        }
        for point in row_points {
            let (Some(x), Some(y)) = (number_at(point, &["x"]), number_at(point, &["y"])) else {
                return Vec::new();
            };
            if !x.is_finite() || !y.is_finite() {
                return Vec::new();
            }
            points.push([x.clamp(-8.0, 8.0) as f32, y.clamp(-8.0, 8.0) as f32]);
        }
    }
    points
}

/// Resolve the editor's sparse `tangents` grid (`[row][col]` of
/// `{right, down, left, up}` offsets or null) into an explicit tangent for
/// every point, with the same rules as resolveMeshTangents in
/// src/lib/utils/meshWarp.ts: a stored side wins, a missing side mirrors a
/// stored opposite (linked handles), and an axis with nothing stored keeps a
/// straight edge, i.e. a control point one third along the chord to the
/// neighbour. Returns an empty vec, meaning "not a Bezier mesh", when no
/// point carries a tangent, so a tangent-free grid renders exactly as before.
fn parse_layer_mesh_tangents(
    tangents: Option<&Value>,
    rows: usize,
    cols: usize,
    points: &[[f32; 2]],
) -> Vec<[[f32; 2]; 4]> {
    let Some(tangent_rows) = tangents.and_then(Value::as_array) else { return Vec::new() };
    let stored_at = |row: usize, col: usize, side: &str| -> Option<[f32; 2]> {
        let entry = tangent_rows.get(row)?.as_array()?.get(col)?;
        let side = entry.get(side)?;
        let x = number_at(side, &["x"])?;
        let y = number_at(side, &["y"])?;
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        Some([x.clamp(-8.0, 8.0) as f32, y.clamp(-8.0, 8.0) as f32])
    };
    let mut any = false;
    let mut resolved = Vec::with_capacity(rows * cols);
    for row in 0..rows {
        for col in 0..cols {
            let point = points[row * cols + col];
            let chord = |r: isize, c: isize| -> [f32; 2] {
                if r < 0 || c < 0 || r as usize >= rows || c as usize >= cols {
                    return [0.0, 0.0];
                }
                let next = points[r as usize * cols + c as usize];
                [(next[0] - point[0]) / 3.0, (next[1] - point[1]) / 3.0]
            };
            let neg = |t: [f32; 2]| [-t[0], -t[1]];
            let right = stored_at(row, col, "right");
            let left = stored_at(row, col, "left");
            let down = stored_at(row, col, "down");
            let up = stored_at(row, col, "up");
            any |= right.is_some() || left.is_some() || down.is_some() || up.is_some();
            let (r, c) = (row as isize, col as isize);
            resolved.push([
                right.or_else(|| left.map(neg)).unwrap_or_else(|| chord(r, c + 1)),
                down.or_else(|| up.map(neg)).unwrap_or_else(|| chord(r + 1, c)),
                left.or_else(|| right.map(neg)).unwrap_or_else(|| chord(r, c - 1)),
                up.or_else(|| down.map(neg)).unwrap_or_else(|| chord(r - 1, c)),
            ]);
        }
    }
    if any { resolved } else { Vec::new() }
}

fn set_scene_layer_color(layer: &mut SceneLayer, rgba: [f32; 4]) {
    layer.color = rgba;
    // The editor only sends this for colour layers, and for media layers
    // that carry a fill colour until they get content (layerRgba returns
    // null for every other type): either way the colour is meant to be seen,
    // not a placeholder card. Bound content replaces it.
    layer.explicit_color = true;
}

/// Beats wrap here so the f32 the shader reads keeps sub-beat precision for
/// days. 65520 divides evenly by every group size 1-10 and 12-16, so a beat
/// step chase does not skip a member when the count wraps.
const BEAT_CLOCK_WRAP: f64 = 65520.0;

/// Shader time wraps here (2^15 s, about 9 h 6 min). Uniforms carry time as
/// an f32, whose step grows with the value: 2 ms at 9 h, 4 ms at 12 h,
/// 62 ms after a week, so animation micro-stuttered on long installs and
/// ran at ~16 fps after a week. Below the wrap shader time is exactly the
/// live clock (nothing changes in a show shorter than that); past it time
/// restarts from 0, so the f32 step never exceeds 2 ms (the precision the
/// beat clock above already settles for). A power of two keeps whole-second
/// and dyadic periods (fract(t), t * 0.5, clock ticks) seamless across the
/// wrap. Bookkeeping that needs the real clock (video anchors, the beat
/// clock, manual export seeks) keeps the unwrapped f64. The editor wraps the
/// shader time it packs at the same value (NATIVE_SHADER_CLOCK_WRAP_SECONDS).
const SHADER_CLOCK_WRAP_SECONDS: f64 = 32768.0;

fn shader_clock_seconds(clock_seconds: f64) -> f32 {
    if !clock_seconds.is_finite() || clock_seconds <= 0.0 { return 0.0; }
    if clock_seconds < SHADER_CLOCK_WRAP_SECONDS { clock_seconds as f32 } else { clock_seconds.rem_euclid(SHADER_CLOCK_WRAP_SECONDS) as f32 }
}

/// Strength of an empty layer's placeholder colour. Colour layers draw at 1.0.
const SOURCELESS_PLACEHOLDER_ALPHA: f32 = 0.56;

/// The editor's launch clock at one moment: `beat` is the continuous beat
/// position at render time `time` (None: the next frame drawn).
#[derive(Clone, Copy, Debug, PartialEq)]
struct BeatClockAnchor {
    beat: f64,
    bpm: f32,
    time: Option<f64>,
}

impl BeatClockAnchor {
    fn from_command(command: &Value) -> Option<Self> {
        let beat = number_at(command, &["beat"]).filter(|value| value.is_finite())?;
        let bpm = number_at(command, &["bpm"]).filter(|value| value.is_finite() && *value > 0.0)?;
        let time = number_at(command, &["time"]).filter(|value| value.is_finite());
        Some(Self { beat, bpm: (bpm as f32).clamp(20.0, 400.0), time })
    }
}

/// Beat position for beat-synced Edge Effects (Looks). The editor anchors it
/// with `set_beat_clock` whenever its launch clock (tapped/typed tempo, audio
/// beats or Link) moves; between anchors it runs on the render clock at the
/// anchored tempo, so it keeps time between editor updates.
#[derive(Clone, Copy, Debug)]
struct BeatClock {
    anchor_time: Option<f64>,
    anchor_beat: f64,
    bpm: f32,
    pending: Option<BeatClockAnchor>,
}

impl Default for BeatClock {
    fn default() -> Self {
        Self { anchor_time: None, anchor_beat: 0.0, bpm: 120.0, pending: None }
    }
}

impl BeatClock {
    fn rebase(&mut self, anchor: BeatClockAnchor) {
        self.pending = Some(anchor);
    }

    /// (beat position, bpm, _, _) at render time `time`.
    fn uniform(&mut self, time: f64) -> [f32; 4] {
        if let Some(anchor) = self.pending.take() {
            self.anchor_time = Some(anchor.time.unwrap_or(time));
            self.anchor_beat = anchor.beat;
            self.bpm = anchor.bpm;
        }
        let anchor_time = *self.anchor_time.get_or_insert(time);
        let beat = self.anchor_beat + (time - anchor_time) * f64::from(self.bpm) / 60.0;
        [beat.rem_euclid(BEAT_CLOCK_WRAP) as f32, self.bpm, 0.0, 0.0]
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Default)]
struct NativeHapUploadBatch {
    encoder: Option<wgpu::CommandEncoder>,
    frames: Vec<(hardware_video::GpuVideoFrame, Option<media_decode::NativeVideoGpuLease>)>,
    slots: Vec<usize>,
}

struct RenderState {
    window: Arc<Window>,
    adapter_name: String,
    /// Windows: the shared-memory name of the completed-frame counter
    /// (core_frame_counter), for the presenters.
    frame_counter_name: Option<String>,
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
    /// The compositor built with source mips (see `heartbeat_wgsl`), once
    /// its worker has made it.
    mips_pipeline: Arc<std::sync::OnceLock<wgpu::RenderPipeline>>,
    /// Some program layer reads a minified picture's mips (fast_flags.w bit 2).
    program_wants_mips: bool,
    uniform_buffer: wgpu::Buffer,
    native_shader_uniform_buffer: wgpu::Buffer,
    layer_buffer: wgpu::Buffer,
    source_preview_buffer: wgpu::Buffer,
    /// Reused staging for the per-frame layer upload. `write_frame_inputs` used
    /// to allocate a fresh full-size array every frame and upload every slot no
    /// matter how many layers the scene had. Every `write_buffer` also costs a
    /// fresh Metal staging buffer, which is an IOKit kernel round-trip, so the
    /// redundant upload was the single largest CPU item in the render encode
    /// path. Sized to the slots the scene uploads (`fit_layer_upload_scratch`),
    /// not to MAX_SCENE_LAYERS: a LayerGpu is ~30 KB, so the full array would
    /// hold 30 MB for a scene of a handful of layers.
    layer_upload_scratch: Vec<LayerGpu>,
    /// Bytes of the last layer-buffer upload. An identical re-upload is skipped:
    /// buffer contents persist, and the compositor only reads slots below
    /// `layer_count`, so skipping is observationally identical.
    layer_upload_last: Vec<u8>,
    /// The program's layer pool (see `pack_layer_pools`).
    layer_pool: LayerPoolState,
    layer_pack_scratch: LayerPackScratch,
    /// Tile bins for the composite (see LAYER_TILES), rebuilt with the layer
    /// upload and sent only when they change.
    layer_tile_buffer: wgpu::Buffer,
    layer_tile_scratch: Vec<u32>,
    layer_tile_last: Vec<u32>,
    /// Mesh cell bounds (MESH_CELL_BOUNDS_BASE), rebuilt when the layers change.
    mesh_cell_bounds_scratch: Vec<u32>,
    mesh_cell_bounds_last: Vec<u32>,
    /// Deck monitors, the record target and full-detail Screens, each with
    /// its own compositor inputs (see `CompositeView`), keyed by view.
    composite_views: HashMap<String, CompositeView>,
    /// Outputs drawn after the program this frame (see take_outputs_encoder).
    outputs_encoder: Option<wgpu::CommandEncoder>,
    /// The frame's latest submit so far; finish_frame fences on it.
    frame_submission: Option<wgpu::SubmissionIndex>,
    /// Linux Screens drawn into the outputs encoder, presented after its submit.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pending_slice_presents: Vec<wgpu::SurfaceTexture>,
    /// Picture slots (source_frames.rs): one shared array, or a texture per slot.
    slots: SourceFrameStore,
    /// Compositor binding-array length (PerSource), the per-source slot ceiling.
    source_frame_bindings: usize,
    /// Store generation the compositor and Stage3D bind groups were built at.
    source_frame_bind_generation: u64,
    source_frame_gpu_readiness: std::cell::RefCell<Vec<Arc<SourceFrameGpuReadiness>>>,
    /// Copies of pictures a graph pass samples while rendering into the same
    /// texture (any slot in the shared array; its own slot when per-source).
    graph_sample_scratch: std::cell::RefCell<Vec<SlotRef>>,
    source_frame_sampler: wgpu::Sampler,
    /// The compositor's picture sampler: as `source_frame_sampler`, but its
    /// mip levels reachable, for minified pictures (GA_CORE_SOURCE_MIPS).
    compositor_sampler: wgpu::Sampler,
    /// Shader inputs packed per draw: layer k holds the k-th input.
    native_shader_input_texture: wgpu::Texture,
    source_frame_size: usize,
    source_frame_format: wgpu::TextureFormat,
    source_frame_mip_levels: u32,
    source_frame_blitter: TextureBlitter,
    /// Builds the picture slots' mip chains (box filter).
    source_frame_mips: graph_textures::BoxMips,
    hap_converter: hap_texture::HapTextureConverter,
    /// Shared textures opened per source slot, so a camera's texture is
    /// opened once per session instead of every frame.
    #[cfg(target_os = "windows")]
    dxgi_import_cache: Mutex<shared_texture::SharedTextureImportCache<wgpu::Texture>>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    hap_upload_batch: Mutex<Option<NativeHapUploadBatch>>,
    #[cfg(target_os = "macos")]
    video_converter: video_texture::GpuVideoConverter,
    #[cfg(target_os = "windows")]
    video_converter: windows_video_texture::GpuVideoConverter,
    #[cfg(target_os = "windows")]
    video_device: Result<windows_video_texture::WindowsVideoDevice, String>,
    composite_frame_blitter: TextureBlitter,
    output_presenter: output_present::OutputPresenter,
    /// `OutputStage::dlayer` for this frame: whether layers placed on the
    /// dome get their own pass (see `sync_dome_layers`).
    dome_layer_pass: [f32; 4],
    creative_frame_index: usize,
    frame_epoch: u64,
    pipeline_cap: usize,
    pipeline_used: HashMap<String, u64>,
    graph_budget_bytes: u64,
    pinned_buffers: HashSet<String>,
    frame_uniform_pool: Vec<NativeComputeGraphGpuBuffer>,
    frame_uniform_cursor: usize,
    allow_async_compile: bool,
    /// On only while the frame renders its bound shader layers: their new
    /// pipelines build on a worker thread. A render a command asks for
    /// builds at once.
    shader_async_compile: bool,
    pipeline_work: HashMap<String, Receiver<Result<CompiledPipeline, String>>>,
    pipeline_failures: HashMap<String, String>,
    /// Off-screen target for reduced-resolution ISF rendering. Allocated lazily
    /// and only when a quality tier below native is actually in use, so the full
    /// quality path costs nothing extra.
    native_shader_scale_texture: Option<wgpu::Texture>,
    native_shader_scale_size: u32,
    native_shader_vertex_module: wgpu::ShaderModule,
    native_shader_bind_group_layout: wgpu::BindGroupLayout,
    native_shader_bind_group: wgpu::BindGroup,
    native_shader_ring: Option<NativeShaderUniformRing>,
    native_shader_batch: Option<NativeShaderBatch>,
    /// D2Array view of the shadow input frames, for per-pass ISF bind groups.
    native_shader_input_view: wgpu::TextureView,
    /// 1x1 placeholder bound in unused ISF pass/audio slots.
    isf_dummy_texture_view: wgpu::TextureView,
    /// ISF audio rows keyed by (kind, width): one texture per distinct MAX.
    isf_audio_rows: HashMap<(IsfAudioKind, u32), NativeIsfAudioRow>,
    /// Reused RGBA staging for audio row uploads (no per-frame allocation).
    isf_audio_scratch: Vec<u8>,
    /// Multi-pass ISF buffers per layer: targets (ping-pong) + pass uniforms.
    isf_pass_states: HashMap<String, NativeIsfPassState>,
    stage3d_overlay_pipeline: wgpu::RenderPipeline,
    stage3d_overlay_uniform_buffer: wgpu::Buffer,
    stage3d_overlay_item_buffer: wgpu::Buffer,
    stage3d_overlay_bind_group: wgpu::BindGroup,
    stage3d_mesh_pipeline: wgpu::RenderPipeline,
    stage3d_mesh_uniform_buffer: wgpu::Buffer,
    stage3d_mesh_item_buffer: wgpu::Buffer,
    stage3d_mesh_bind_group: wgpu::BindGroup,
    /// Group 1 of the compositor and Stage3D pipelines: the picture slots.
    source_frames_bind_group_layout: wgpu::BindGroupLayout,
    source_frames_bind_group: wgpu::BindGroup,
    stage3d_mesh_depth_texture: wgpu::Texture,
    stage3d_mesh_depth_view: wgpu::TextureView,
    _native_graph_source_depth_texture: wgpu::Texture,
    native_graph_source_depth_view: wgpu::TextureView,
    native_shader_pipelines: HashMap<String, NativeShaderPipeline>,
    native_compute_pipelines: HashMap<String, NativeComputePipeline>,
    native_graph_render_pipelines: HashMap<String, NativeGraphRenderPipeline>,
    native_compute_graph_buffers: HashMap<String, NativeComputeGraphGpuBuffer>,
    /// Textures graphs declared in `textures[]`, by id.
    /// Graph textures (graph_textures.rs): kept by id, freed when unused.
    native_graph_textures: graph_textures::GraphTexturePool,
    /// Copies of graph buffers on their way back to the CPU. See
    /// NativeGraphFrameJob::readback_buffer_ids.
    pending_graph_readbacks: Vec<PendingGraphReadback>,
    /// Finished readbacks by buffer id, taken by whoever asked for them.
    graph_readback_results: HashMap<String, Vec<u8>>,
    /// Which readbacks are wanted, and each one's staging buffer (graph_readbacks.rs).
    graph_live_readbacks: graph_readbacks::LiveReadbacks<wgpu::Buffer>,
    output_mirror_texture: wgpu::Texture,
    /// Two full-resolution textures that composition FX ping-pong between.
    /// Deliberately separate textures rather than one two-layer array: wgpu
    /// treats a texture as a single usage scope inside a pass, so reading
    /// layer 0 while writing layer 1 of the same texture is a validation
    /// error (COLOR_TARGET is exclusive).
    composite_frame_textures: [wgpu::Texture; COMPOSITE_FRAME_SLOTS],
    output_mirror_view: wgpu::TextureView,
    surface_copy_dst_supported: bool,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    output_export: Option<NativeOutputExport>,
    /// In-core GPU recording session. Reads the same shared texture the
    /// preview and Spout consume, so a take is exactly what went to screen.
    #[cfg(target_os = "windows")]
    native_recorder: Option<windows_video_encoder::WindowsVideoEncoder>,
    #[cfg(target_os = "macos")]
    native_recorder: Option<mac_video_recorder::MacVideoRecorder>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    native_recorder_error: Option<String>,
    /// Syphon / Spout sender published by the core itself (texture_share.rs).
    texture_share: texture_share::TextureShare,
    /// Deck confidence monitors: two small targets (bank A, bank B) the VJ
    /// panel shows beside Program. Created lazily on the first frame that
    /// carries deck-monitor-tagged layers.
    deck_monitor_targets: Option<[DeckMonitorTarget; 2]>,
    /// The editor's Inside view of the dome (`render_dome_view`): drawn from
    /// the program's master like a Screen, and handed to the editor
    /// preview in place of the program output while it is on.
    dome_view_target: Option<DeckMonitorTarget>,
    /// Mirror dome Screens: the dome picture as a square domemaster, the
    /// pass that draws it through a warp mesh, and the meshes' buffers.
    mirror: Option<MirrorRenderer>,
    /// Per-slice display targets, keyed by the editor's slice id.
    slice_targets: HashMap<String, SliceOutputTarget>,
    /// Linux Screen presenters, keyed by slice id. Kept apart from
    /// `slice_targets` because Electron attaches a Screen window before the
    /// editor has sent that Screen's first frame.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    linux_slice_windows: HashMap<String, LinuxSliceWindow>,
    /// Linux: creates the Screen presenters' surfaces after start-up.
    /// Everywhere: the resource counts in `memory_stats`.
    wgpu_instance: wgpu::Instance,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    wgpu_adapter: wgpu::Adapter,
    /// Recording target (single layer / VJ row / transparent composition),
    /// created while a recording of such a source runs.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    record_target: Option<RecordOutputTarget>,
    /// Map Sim projector-view renderer, created on first use.
    projector_view: Option<projector_view::ProjectorViewRenderer>,
    snapshot_texture: wgpu::Texture,
    snapshot_view: wgpu::TextureView,
    /// Cached downscale target for preview-sized snapshot readbacks
    /// (composite mirror: projection sim, WLED sampling). Recreated only
    /// when the requested size changes.
    snapshot_preview: Option<(wgpu::Texture, TextureBlitter, u32, u32)>,
    source_crop_preview: Option<(wgpu::Texture, wgpu::Texture, TextureBlitter, u32, u32, u32, u32)>,
    last_frame_metrics: Option<SnapshotMetrics>,
    bind_group: wgpu::BindGroup,
    /// Layout of `bind_group`, kept so the group can be rebuilt when the
    /// paint-mask texture or the layer pool grows.
    scene_bind_group_layout: wgpu::BindGroupLayout,
    paint_mask_texture: wgpu::Texture,
    paint_mask_view: wgpu::TextureView,
    /// Bumped when the program's scene bind group is rebuilt (the paint-mask
    /// texture was remade or the layer pool grew), so views rebind too.
    scene_bindings_generation: u64,
    /// Compiled pipelines kept on disk (Vulkan; see pipeline_cache.rs).
    disk_pipeline_cache: Option<pipeline_cache::DiskPipelineCache>,
    paint_mask_size: u32,
    paint_mask_layers: u32,
    start_time: Instant,
    beat_clock: BeatClock,
    /// Flux played from a paired phone, applied by the output stage (zero = off).
    output_flux: [[f32; 4]; 2],
    output_flux_regions: [[f32; 4]; MAX_FLUX_REGIONS],
    gpu_timing: Option<GpuTimingState>,
    gpu_frames_submitted: u64,
    gpu_frames_completed: Arc<AtomicU64>,
    gpu_fault: bool,
    /// Test hook (GA_CORE_TEST_DEVICE_LOSS=N): destroy the device after N
    /// frames, reported like a real device loss. None outside tests.
    test_device_loss: Option<TestDeviceLoss>,
    gpu_completion_tx: Sender<(wgpu::SubmissionIndex, Instant, Instant)>,
    frames_in_flight: frames_in_flight::AdaptiveGate,
    gpu_frame_latency: Arc<frames_in_flight::FrameLatency>,
    /// How evenly the program output's frames start and present.
    pacing: present_pacing::PacingProbe,
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

/// Longest edge a video needs on the slice it is shown on, or None when the
/// slice fills the output (or more) and the full requested size is right.
///
/// 2.1.10 computed this size but only used it when the editor sent no decode
/// size, which it always does, and the hardware decoders ignored it: a 4K clip
/// on a small slice still decoded and held 4K frames, used up the video memory
/// budget and stalled the other decoders.
fn native_video_slice_edge_cap(output: (usize, usize), scale: f32) -> Option<usize> {
    if !scale.is_finite() || scale >= 1.0 || scale <= 0.0 {
        return None;
    }
    let scaled = |edge: usize| (((edge as f32 * scale) as usize) / 2 * 2).max(64);
    Some(scaled(output.0).max(scaled(output.1)))
}

/// Whether a running session's decode size no longer suits its slice.
///
/// It restarts when its slice grows past what it decodes, and when the slice
/// needs half the pixels per edge or fewer: a session usually starts before
/// its layer is bound (at full size), and must still come down to the slice
/// size. The gap between the two thresholds keeps a slice resized back and
/// forth from restarting its decoder at every step. A session handed over
/// warm from a VJ library preroll never shrinks: that would cost the instant
/// trigger it was prepared for.
fn native_video_decode_cap_needs_restart(
    current: Option<usize>,
    wanted: Option<usize>,
    full_edge: usize,
    allow_shrink: bool,
) -> bool {
    let full_edge = full_edge.max(1);
    let current_edge = current.unwrap_or(full_edge).min(full_edge);
    let wanted_edge = wanted.unwrap_or(full_edge).min(full_edge);
    wanted_edge > current_edge || (allow_shrink && wanted_edge.saturating_mul(2) <= current_edge)
}

struct NativeVideoStreamState {
    start_reverse: bool,
    phase_until: Option<Instant>,
    phase_error_seconds: Option<f64>,
    signature: String,
    transport_rate: f64,
    start_time_seconds: f64,
    stream: NativeVideoStream,
    seek_generation: u64,
    seq: u64,
    playing: bool,
    next_frame_at: Instant,
    last_used_frame: u64,
    frames_presented: u64,
    triggered_at: Option<Instant>,
    fallback_counted: bool,
    /// Longest edge this session decodes at, set by the slice it is shown on
    /// (None = the full requested size). See native_video_slice_edge_cap.
    decode_max_edge: Option<usize>,
    /// False for a session adopted warm from a library preroll.
    decode_may_shrink: bool,
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

/// Audio follower of one clip voice across picture transitions (see
/// `refresh_clip_audio`). The fade angle is the state; `ghost` is the last
/// transport seen, so a voice whose source was replaced by a transition
/// snapshot can finish fading out.
struct ClipAudioFade { theta: f64, role: clip_audio::FadeRole, row: String, at: Instant, ghost: Option<ClipAudioGhost> }
struct ClipAudioGhost { uri: String, time: f64, rate: f64, lo: f64, hi: f64, looping: bool, bounce: bool, gain: f32, pan: f32, at: Instant }

struct App {
    response_tx: Sender<String>,
    /// Shared with the stdin reader thread so read-only queries can be answered
    /// without waking this loop. See `RpcFastPath` for the ordering contract.
    fast_path: Arc<RpcFastPath>,
    event_proxy: EventLoopProxy<UserEvent>,
    renderer: Option<RenderState>,
    adapter_name: Option<String>,
    adapter_is_software: bool,
    adapter_luid: Option<String>,
    frame_counter_name: Option<String>,
    target_fps: u32,
    last_redraw: Instant,
    /// When the output window was asked for a redraw that has not arrived
    /// yet (see `drive_frame`).
    redraw_requested_at: Option<Instant>,
    /// A `present` arrived while frames were being drawn on schedule anyway;
    /// the next scheduled frame draws it (see `request_present`).
    present_pending: bool,
    /// Refresh rate of the display the attached output window is on, which
    /// paces the frames while it is attached (see `paced_frame_rate`).
    output_refresh_hz: Option<f64>,
    /// The display `output_refresh_hz` was read from. Moving the window
    /// re-reads the rate only when this changes: on Windows the read is a
    /// display-configuration query, and a drag sends a move event per step.
    output_refresh_monitor: Option<MonitorHandle>,
    /// Frames follow the output display's refreshes while it is shown
    /// (display_pacing.rs); false with GA_CORE_DISPLAY_PACING=0 and on Linux.
    display_pacing_enabled: bool,
    /// The refresh clock of the display the output window is on.
    display_clock: Option<display_pacing::DisplayClock>,
    display_clock_error: Option<String>,
    /// The refresh the last paced frame was drawn on.
    last_paced_refresh: Option<u64>,
    /// Paced frames drawn one or more refreshes later than due: the frame
    /// loop was busy when the refresh came.
    late_paced_frames: u64,
    /// Where in the refresh paced frames start (display_pacing.rs).
    phase_lock: display_pacing::PhaseLock,
    /// The refresh the latest paced frame was drawn for, and when that frame
    /// is to start (a little after the refresh, see `PhaseLock`).
    paced_refresh_at: Option<Instant>,
    paced_frame_at: Option<Instant>,
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
    video_memory_budget: Arc<NativeVideoMemoryBudget>,
    /// The GPU's memory as the platform reports it (Metal's recommended
    /// working set; a D3D12 adapter's own memory). None where unknown.
    gpu_memory_bytes: Option<u64>,
    decode_handoff_predecode_shed_pct: u32,
    decode_predecode_estimate_cache_cap_entries: u32,
    vram_budget_mb: u32,
    auto_present_requested: bool,
    /// A render was asked for but could not be drawn yet (a GPU frame was
    /// still in flight). The request is NOT dropped: `about_to_wait` keeps
    /// pumping until one frame actually lands.
    ///
    /// This exists because the last render of a scene teardown has no
    /// follow-up. The editor stops its RAF as soon as no layer needs
    /// continuous sync, and `about_to_wait`'s idle gate goes quiet once the
    /// scene is empty — so a clearing present lost to GPU backpressure left
    /// the previous frame resident in the output export texture (Syphon /
    /// NDI / Spout, the embedded editor presenter, the projection-sim
    /// mirror) and on every slice window, forever. That is the "ghost of the
    /// last layer" the operator sees after clearing the scene.
    pending_render_retry: bool,
    /// The last frame drew at least one deck-tagged layer into a confidence
    /// monitor. Buys exactly one clearing monitor pass when both banks empty.
    deck_monitors_lit: bool,
    /// Width of the deck confidence monitors' textures. 480 suits the small
    /// deck panes; a Preview monitor on its own display asks for more.
    deck_monitor_width: u32,
    /// The editor's Inside view camera (`OutputStage::dview`, `dview1`), while it is on.
    dome_view: Option<[[f32; 4]; 2]>,
    /// Mirror dome warp meshes by content id (`set_mirror_mesh`).
    mirror_meshes: HashMap<String, Arc<MirrorMesh>>,
    output_window_attached: bool,
    /// The composite size set by the project (set_output). While a
    /// fullscreen output window shows it, the window's own size no longer
    /// resizes the composite: opening fullscreen used to rebuild every
    /// output texture at the display's size and then back at the project's.
    output_size_configured: bool,
    output_window_fullscreen: bool,
    /// Whether the window itself is fullscreen now, and on which monitor.
    /// `output_window_fullscreen` above is what was asked for and decides the
    /// composite size; this is what the window is, so a detach, an Esc or a
    /// move to another display can undo it in the right order.
    output_window_placement: OutputWindowState,
    editor_parent_window_handle_hex: Option<String>,
    editor_parent_window_handle_platform: Option<String>,
    editor_preview_parented_window: bool,
    layers_seen: u32,
    output_last_presented_layer_count: u32,
    command_phase: f32,
    start_time: Instant,
    /// `set_beat_clock` waiting for the renderer's next frame.
    beat_clock_request: Option<BeatClockAnchor>,
    scene_layers: HashMap<String, SceneLayer>,
    /// Painted masks (strokes + their rasters), keyed by layer id.
    paint_masks: paint_mask::PaintMaskStore,
    pending_media_bindings: HashMap<String, PendingMediaBinding>,
    native_graph_layers: HashMap<String, NativeGraphLayer>,
    /// Resolved per-instrument workload numbers for the most recent frame,
    /// keyed by layer id. Written by the graph-job builders AFTER the core
    /// has normalised the incoming params, so this is the ground truth for
    /// "what quality tier actually reached the core" — the TS side can only
    /// report what it *sent*. Surfaced in `status.native_graph_workload`.
    native_graph_workload: BTreeMap<String, Value>,
    native_plugin_liquid_states: HashMap<String, NativePluginLiquidState>,
    native_plugin_templates_initialized: HashSet<String>,
    native_plugin_audio_smooth: HashMap<String, NativePluginAudioSmooth>,
    /// Beat count and bar position for the scene frame block.
    scene_clock: scene_frame::SceneClock,
    native_point_cloud_assets: HashMap<String, NativePointCloudAsset>,
    pending_native_graph_jobs: Vec<NativeGraphFrameJob>,
    /// Graph jobs that must run AFTER the compositor has drawn every layer:
    /// composition FX, which act on the finished image rather than on any one
    /// source. Kept separate because the pre-composite list is encoded before
    /// the composite pass and these have to land after it.
    pending_composite_graph_jobs: Arc<Vec<NativeGraphFrameJob>>,
    /// Which composite ping-pong layer the queued chain finishes on, so the
    /// blit back to the mirror reads the right one.
    pending_composite_output_index: usize,
    ready_composite_graph_jobs: Arc<Vec<NativeGraphFrameJob>>,
    ready_composite_output_index: usize,
    source_previews: HashMap<String, SourcePreview>,
    source_preview_slots: HashMap<String, usize>,
    source_preview_dirty: bool,
    source_frames: HashMap<String, SourceFrame>,
    source_frame_slots: HashMap<String, usize>,
    captured_graph_holds: HashSet<String>,
    source_frame_signatures: HashMap<String, String>,
    image_decode_queue: VecDeque<(String, String, PathBuf)>,
    image_decode_active: usize,
    video_prefetch_active: usize,
    video_prefetch_bytes: u64,
    video_prefetch_versions: HashMap<String, u64>,
    image_prefetch_waiters: HashMap<(String, String), Vec<(u64, Instant)>>,
    submitted_intervals_ms: IntervalWindow,
    /// Status and stats last built for the fast path, when, and the
    /// `rpc_snapshot_watch_key` at the time.
    rpc_snapshot_cache: Option<(Arc<Value>, Arc<Value>, Instant, u64)>,
    last_submission_at: Option<Instant>,
    media_pump_ms: f64,
    /// When launches and video sessions last advanced (see pump_frame_media).
    last_frame_service: Instant,
    native_video_frame_signatures: HashMap<String, String>,
    native_video_frame_cache: HashMap<String, NativeVideoFrameCacheEntry>,
    native_video_frame_cache_order: VecDeque<String>,
    native_video_frame_cache_bytes: usize,
    media_sources: HashMap<String, NativeMediaSourceState>,
    /// Live transport state of every media source at the moment an offline
    /// (manual clock) export took over; restored when the live clock returns.
    manual_clock_media_stash: Option<HashMap<String, NativeMediaSourceState>>,
    clip_audio: Option<clip_audio::ClipAudio>,
    clip_audio_mix: Value,
    clip_audio_fades: HashMap<String, ClipAudioFade>,
    scheduled_transition_tokens: HashMap<String, u64>,
    transition_clocks: HashMap<String, Option<transition_clock::TransitionClock>>,
    launch_scheduler: launch_scheduler::Scheduler,
    scheduled_binding_guards: HashMap<String, (String, String, Option<u64>)>,
    prepared_launch_sources: HashMap<String, Instant>,
    link_clock: Option<(f64, f64, Instant)>,
    link_phase_anchors: HashMap<String, Value>,
    deferred_source_releases: HashSet<String>,
    /// Plain media sources nothing has referenced for a while (media_orphans.rs).
    orphan_sweep: media_orphans::OrphanSweep,
    /// Sources that lost a layer during the command batch being applied.
    /// A row reorder rebinds every row in one batch, so a source can be
    /// without a layer for a moment before a later command gives it one.
    batch_orphan_candidates: Option<Vec<String>>,
    native_video_decode_pending: HashSet<String>,
    native_video_decode_failed: HashSet<String>,
    native_video_streams: HashMap<String, NativeVideoStreamState>,
    native_video_scrub_requests: HashMap<String, NativeVideoScrubRequest>,
    stage3d_scene: Option<Value>,
    stage3d_scene_summary: NativeSceneBridgeSummary,
    projection_sim_scene: Option<Value>,
    projection_sim_scene_summary: NativeSceneBridgeSummary,
    /// Map Sim projector views: the scene each physical projector renders
    /// (see projector_view.rs), its geometry, and calibration overlays.
    projection_sim_view: Option<projector_view::ProjectorViewScene>,
    projection_sim_meshes: HashMap<String, Arc<projector_view::ProjectorViewMeshData>>,
    projection_sim_overlays: HashMap<String, projector_view::ProjectorViewOverlay>,
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
    /// Shared, so the frame's copy of the list is a reference count, not a deep copy.
    slice_outputs: Arc<Vec<SliceOutputSpec>>,
    /// Source the recorder asked for besides the program output, if any.
    record_target: Option<RecordTargetSpec>,
    render_clock_mode: String,
    render_clock_time: Option<f64>,
    render_clock_delta: f32,
    render_clock_frame_index: Option<u64>,
    /// Manual-clock (offline render) simulation lock. Every native graph
    /// steps by `render_clock_delta` once per `render()`, but `render()` is
    /// ALSO driven by this core's own `about_to_wait` pacing loop — so a
    /// slow export (readback + IPC + encode per frame) let 1-3 extra
    /// renders slip between captured frames and each one re-applied the
    /// full frame delta. Measured 1.9x-3.8x over-stepping at 20-60ms of
    /// per-frame host cost, which is exactly the "exports play fast" bug.
    /// Remembering the clock value the graphs last advanced on makes
    /// repeated renders at the same virtual time idempotent: the world
    /// clock and the render clock advance together, one step per frame.
    last_native_graph_step_clock: Option<f64>,
    /// The delta `run_native_graph_layers` claimed for the render in
    /// flight — `render_clock_delta` on the first render of a virtual
    /// frame, 0 on every repeat of it. Every graph builder reads this
    /// instead of `render_clock_delta` directly.
    native_graph_step_delta_this_render: f32,
    /// Manual clock (offline render): true only while a frame snapshot steps
    /// the world itself. The core's own paced renders in between re-run the
    /// graphs with no step, so a frame is stepped exactly once, after its
    /// videos are settled, whatever the wall clock does.
    manual_snapshot_stepping: bool,
    /// Source frame rate of each video file an offline render decodes, so a
    /// frame is picked by index (floor), as live playback shows it.
    video_source_fps: HashMap<PathBuf, Option<f64>>,
    /// Offline render: one ffmpeg per playing video source, read forward
    /// frame by frame (instead of one ffmpeg per frame).
    manual_video_readers: HashMap<String, media_decode::SequentialVideoReader>,
    /// What each video showed in the last manual-clock snapshot (the render
    /// checks a playing one keeps moving).
    manual_video_report: Vec<Value>,
    isf_layer_bindings: HashMap<String, String>,
    /// Shader outputs rendered this frame, by output source id, with the
    /// frame they were rendered on. Layers bound to the same shader with the
    /// same inputs (a group's children all take the group's shader) share
    /// one render and one source-frame slot instead of taking a slot each,
    /// which ran out of slots and left faces blank.
    isf_frame_outputs: HashMap<String, (usize, u64)>,
    /// This frame's render size for each group of layers that show the same
    /// single-pass shader with the same input and quality (`isf_share_key`):
    /// the largest footprint among them. They all draw it at that one size,
    /// so the group is one render instead of one per size class (eighty cube
    /// faces of a few sizes were six renders of every shader).
    isf_shared_footprints: HashMap<String, (u32, u32)>,
    isf_uniforms: HashMap<String, IsfUniformState>,
    /// Shaders whose TIME follows an anchor (`set_isf_time_anchor`) instead
    /// of the render clock, by shader id.
    isf_time_anchors: HashMap<String, IsfTimeAnchor>,
    shader_registry: HashMap<String, ShaderRecord>,
    shader_sources: HashMap<String, Arc<str>>,
    shader_isf_inputs: HashMap<String, Vec<NativeIsfInputBinding>>,
    /// Pass plan + audio rows for ISF shaders that need the pass-aware host,
    /// with the precompile generation (a reload resets persistent buffers).
    shader_isf_hosts: HashMap<String, (Arc<NativeIsfHostInfo>, u64)>,
    /// Per shader source: whether it samples any image (see
    /// native_shader_reads_inputs). Checked once per source.
    shader_reads_inputs: HashMap<u64, bool>,
    /// When each shader was last bound to a layer or rendered for one. Only
    /// these are dropped at the registry cap; graph and stdlib shaders are
    /// sent once and kept.
    isf_shader_last_used: HashMap<String, u64>,
    /// The frame each bound ISF shader first rendered on. FRAMEINDEX counts
    /// from it (ISF semantics: frames this shader has rendered), so a shader
    /// bound mid-session still sees FRAMEINDEX 0 on its first frame and can
    /// initialise its persistent buffers.
    isf_shader_first_frame: HashMap<String, IsfFrameOrigin>,
    /// Whether the frames in `isf_shader_first_frame` were counted on the
    /// manual (export) clock. The live and export clocks count from different
    /// places, so a switch starts every shader's count again.
    isf_first_frame_manual_clock: bool,
    isf_shader_use_tick: u64,
    /// Hashed ids of shaders dropped at the cap. A layer bound to one is
    /// reported in `layers_snapshot` so the editor sends the source again.
    evicted_shader_ids: HashSet<u64>,
    isf_shader_generation: u64,
    /// Latest analyser spectrum for ISF audio / audioFFT inputs.
    isf_audio_spectrum: IsfAudioSpectrum,
    /// Spectrum, waveform, onset envelopes and recent hits for the
    /// audio-reactive instruments (`set_audio_spectrum.visual_b64`).
    audio_visual: audio_visuals::audio_data::AudioVisualData,
    /// One packet per sound an instrument follows (`set_audio_spectrum.visual_sources`,
    /// keyed like the layer's `audioSource` param); a layer without one reads `audio_visual`.
    audio_visual_sources: HashMap<String, audio_visuals::audio_data::AudioVisualData>,
    isf_multipass_renders: u64,
    isf_audio_decode_scratch: Vec<u8>,
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
fn set_managed_output_fullscreen(window: &Window, fullscreen: bool, _monitor: Option<MonitorHandle>) {
    // Projector output must stay in the current macOS workspace. Winit's
    // Borderless fullscreen enters an asynchronous Space transition, which can
    // leave a renderer owned by a helper process occluded behind Electron. The
    // caller already supplies the target display's exact x/y/width/height, so a
    // borderless top-level window is the correct fullscreen primitive here.
    window.set_fullscreen(None);
    window.set_decorations(!fullscreen);
    if let Ok(handle) = window.window_handle() {
        if let Some(ns_window) = appkit_window_for_raw_handle(handle.as_raw()) {
            // Presentation options stop hiding system chrome when the editor (or
            // another application) becomes active. Keep the dedicated projector
            // above both the menu (24) and its status items (25), without raising
            // the editor or entering a separate fullscreen Space.
            ns_window.setLevel(if fullscreen { NSStatusWindowLevel + 1 } else { NSNormalWindowLevel });
            // SAFETY: all managed output changes run on the AppKit event thread.
            unsafe {
                ns_window.setHidesOnDeactivate(false);
                ns_window.setCollectionBehavior(if fullscreen {
                    NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::Stationary
                        | NSWindowCollectionBehavior::IgnoresCycle
                        | NSWindowCollectionBehavior::FullScreenAuxiliary
                } else {
                    NSWindowCollectionBehavior::Default
                });
            }
            if fullscreen {
                if let Some(screen) = ns_window.screen() {
                    // AppKit's full frame includes the menu/Dock area. Using the
                    // visible frame here would leave a strip of desktop exposed.
                    ns_window.setFrame_display(screen.frame(), true);
                }
            }
        }
    }
    // No NSApplication presentation options: hiding the Dock and menu bar
    // took them away from the main screen too whenever this process was
    // active. The window level above covers both on the projector's own
    // display.
}

#[cfg(not(target_os = "macos"))]
fn set_managed_output_fullscreen(window: &Window, fullscreen: bool, monitor: Option<MonitorHandle>) {
    // An explicit monitor: `None` means the one the window is on right now,
    // and a move on Windows has not necessarily landed yet.
    window.set_fullscreen(if fullscreen {
        Some(Fullscreen::Borderless(monitor))
    } else {
        None
    });
}

/// The monitors winit knows, with the physical rects the placement plan
/// matches requests against.
fn output_window_monitors(window: &Window) -> (Vec<MonitorHandle>, Vec<MonitorInfo>) {
    let handles: Vec<MonitorHandle> = window.available_monitors().collect();
    let infos = handles
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            MonitorInfo {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale: monitor.scale_factor(),
            }
        })
        .collect();
    (handles, infos)
}

fn apply_output_window_steps(window: &Window, steps: &[OutputWindowStep], monitors: &[MonitorHandle]) {
    use output_window_plan::CoordinateSpace;
    for step in steps {
        match *step {
            OutputWindowStep::LeaveFullscreen => set_managed_output_fullscreen(window, false, None),
            OutputWindowStep::SetLevel(level) => window.set_window_level(match level {
                LevelPlan::Normal => WindowLevel::Normal,
                LevelPlan::AlwaysOnTop => WindowLevel::AlwaysOnTop,
                LevelPlan::AlwaysOnBottom => WindowLevel::AlwaysOnBottom,
            }),
            OutputWindowStep::SetSize { width, height, space } => {
                let _ = match space {
                    CoordinateSpace::Physical => window.request_inner_size(PhysicalSize::new(width, height)),
                    CoordinateSpace::Logical => {
                        window.request_inner_size(LogicalSize::new(width as f64, height as f64))
                    }
                };
            }
            OutputWindowStep::SetPosition { x, y, space } => match space {
                CoordinateSpace::Physical => window
                    .set_outer_position(PhysicalPosition::new(x.round() as i32, y.round() as i32)),
                CoordinateSpace::Logical => window.set_outer_position(LogicalPosition::new(x, y)),
            },
            OutputWindowStep::EnterFullscreen { monitor } => set_managed_output_fullscreen(
                window,
                true,
                monitor.and_then(|index| monitors.get(index).cloned()),
            ),
            OutputWindowStep::SetCursorVisible(visible) => window.set_cursor_visible(visible),
            OutputWindowStep::Show => {
                window.set_visible(true);
                window.focus_window();
                activate_appkit_output_window(window);
                window.request_redraw();
            }
            OutputWindowStep::Hide => window.set_visible(false),
        }
    }
}

/// Esc, the close button and a detach from the editor all end the same way.
fn detach_managed_output_window(window: &Window, placement: &OutputWindowState) -> OutputWindowState {
    let plan = plan_output_window(&OutputWindowRequest::detach(), placement, &[]);
    apply_output_window_steps(window, &plan.steps, &[]);
    plan.state
}

#[cfg(not(target_os = "macos"))]
fn promote_appkit_child_window_to_underlay(
    _parent_handle: RawWindowHandle,
    _child_window: &Window,
) -> bool {
    false
}

impl App {
    fn new(
        response_tx: Sender<String>,
        event_proxy: EventLoopProxy<UserEvent>,
        fast_path: Arc<RpcFastPath>,
    ) -> Self {
        Self {
            response_tx,
            fast_path,
            event_proxy,
            renderer: None,
            adapter_name: None,
            adapter_is_software: false,
            adapter_luid: None,
            frame_counter_name: None,
            target_fps: 60,
            last_redraw: Instant::now(),
            redraw_requested_at: None,
            present_pending: false,
            output_refresh_hz: None,
            output_refresh_monitor: None,
            display_pacing_enabled: display_pacing::enabled(),
            display_clock: None,
            display_clock_error: None,
            last_paced_refresh: None,
            late_paced_frames: 0,
            phase_lock: display_pacing::PhaseLock::default(),
            paced_refresh_at: None,
            paced_frame_at: None,
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
            // 0 = sized to the GPU (video_memory_budget_bytes).
            decode_handoff_byte_cap_mb: 0,
            video_memory_budget: Arc::new(NativeVideoMemoryBudget::new(512 * 1024 * 1024)),
            gpu_memory_bytes: None,
            decode_handoff_predecode_shed_pct: 90,
            decode_predecode_estimate_cache_cap_entries: 8192,
            vram_budget_mb: 4096,
            auto_present_requested: false,
            pending_render_retry: false,
            deck_monitors_lit: false,
            deck_monitor_width: 480,
            dome_view: None,
            mirror_meshes: HashMap::new(),
            output_window_attached: false,
            output_size_configured: false,
            output_window_fullscreen: false,
            output_window_placement: OutputWindowState::default(),
            editor_parent_window_handle_hex: None,
            editor_parent_window_handle_platform: None,
            editor_preview_parented_window: false,
            layers_seen: 0,
            output_last_presented_layer_count: 0,
            command_phase: 0.0,
            start_time: Instant::now(),
            beat_clock_request: None,
            scene_layers: HashMap::new(),
            paint_masks: paint_mask::PaintMaskStore::new(2048),
            pending_media_bindings: HashMap::new(),
            native_graph_layers: HashMap::new(),
            native_graph_workload: BTreeMap::new(),
            native_plugin_liquid_states: HashMap::new(),
            native_plugin_templates_initialized: HashSet::new(),
            native_plugin_audio_smooth: HashMap::new(),
            scene_clock: scene_frame::SceneClock::default(),
            native_point_cloud_assets: HashMap::new(),
            pending_native_graph_jobs: Vec::new(),
            pending_composite_graph_jobs: Arc::new(Vec::new()),
            pending_composite_output_index: 0,
            ready_composite_graph_jobs: Arc::new(Vec::new()),
            ready_composite_output_index: 0,
            source_previews: HashMap::new(),
            source_preview_slots: HashMap::new(),
            source_preview_dirty: true,
            source_frames: HashMap::new(),
            source_frame_slots: HashMap::from([(EMPTY_SOURCE_FRAME_ID.to_string(), 0)]),
            captured_graph_holds: HashSet::new(),
            source_frame_signatures: HashMap::new(),
            image_decode_queue: VecDeque::new(),
            image_decode_active: 0,
            video_prefetch_active: 0,
            video_prefetch_bytes: 0,
            video_prefetch_versions: HashMap::new(),
            image_prefetch_waiters: HashMap::new(),
            submitted_intervals_ms: IntervalWindow::default(),
            rpc_snapshot_cache: None,
            last_submission_at: None,
            media_pump_ms: 0.0,
            last_frame_service: Instant::now(),
            native_video_frame_signatures: HashMap::new(),
            native_video_frame_cache: HashMap::new(),
            native_video_frame_cache_order: VecDeque::new(),
            native_video_frame_cache_bytes: 0,
            media_sources: HashMap::new(),
            manual_clock_media_stash: None,
            clip_audio: None,
            clip_audio_mix: json!([]),
            clip_audio_fades: HashMap::new(),
            scheduled_transition_tokens: HashMap::new(),
            transition_clocks: HashMap::new(),
            launch_scheduler: launch_scheduler::Scheduler::default(),
            scheduled_binding_guards: HashMap::new(),
            prepared_launch_sources: HashMap::new(),
            link_clock: None,
            link_phase_anchors: HashMap::new(),
            deferred_source_releases: HashSet::new(),
            orphan_sweep: media_orphans::OrphanSweep::default(),
            batch_orphan_candidates: None,
            native_video_decode_pending: HashSet::new(),
            native_video_decode_failed: HashSet::new(),
            native_video_streams: HashMap::new(),
            native_video_scrub_requests: HashMap::new(),
            stage3d_scene: None,
            stage3d_scene_summary: NativeSceneBridgeSummary::empty("stage3d"),
            projection_sim_scene: None,
            projection_sim_scene_summary: NativeSceneBridgeSummary::empty("projection-sim"),
            projection_sim_view: None,
            projection_sim_meshes: HashMap::new(),
            projection_sim_overlays: HashMap::new(),
            output_blackout: false,
            output_frozen: false,
            composite_effects: Vec::new(),
            output_stage: OutputStage::default(),
            slice_outputs: Arc::new(Vec::new()),
            record_target: None,
            render_clock_mode: "live".to_string(),
            render_clock_time: None,
            render_clock_delta: 1.0 / 60.0,
            render_clock_frame_index: None,
            last_native_graph_step_clock: None,
            native_graph_step_delta_this_render: 1.0 / 60.0,
            manual_snapshot_stepping: false,
            video_source_fps: HashMap::new(),
            manual_video_readers: HashMap::new(),
            manual_video_report: Vec::new(),
            isf_layer_bindings: HashMap::new(),
            isf_frame_outputs: HashMap::new(),
            isf_shared_footprints: HashMap::new(),
            isf_uniforms: HashMap::new(),
            isf_time_anchors: HashMap::new(),
            shader_registry: HashMap::new(),
            shader_sources: HashMap::new(),
            shader_isf_inputs: HashMap::new(),
            shader_isf_hosts: HashMap::new(),
            shader_reads_inputs: HashMap::new(),
            isf_shader_last_used: HashMap::new(),
            isf_shader_first_frame: HashMap::new(),
            isf_first_frame_manual_clock: false,
            isf_shader_use_tick: 0,
            evicted_shader_ids: HashSet::new(),
            isf_shader_generation: 0,
            isf_audio_spectrum: IsfAudioSpectrum::default(),
            audio_visual: audio_visuals::audio_data::AudioVisualData::default(),
            audio_visual_sources: HashMap::new(),
            isf_multipass_renders: 0,
            isf_audio_decode_scratch: Vec::new(),
            shader_precompile_queue_cap: 4096,
            shader_precompile_per_frame: 4,
            shader_metadata_cache_cap: 16384,
            pipeline_metadata_cache_cap: NATIVE_PIPELINE_CACHE_CAP,
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
        // A phone's auto map stripe frame on the main output: (frame, planned width, planned height).
        let structured_light = params.get("structuredLight").and_then(|v| v.as_f64()).filter(|f| f.is_finite() && *f >= 0.0 && *f < 500.0).map(|frame| {
            (frame.round() as f32, read(&["structuredLightWidth"], 0.0).clamp(0.0, 16384.0) as f32, read(&["structuredLightHeight"], 0.0).clamp(0.0, 16384.0) as f32)
        });
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
        let master_mesh = if warp_enabled && warp_mode == "mesh" {
            warp_mesh_at(warp.and_then(|v| v.get("meshGrid")))
        } else {
            WarpMesh::none()
        };
        let master_warp = [
            if warp_enabled { 1.0 } else { 0.0 },
            master_mesh.rows,
            master_mesh.cols,
            // Bezier cells are inverted as Coons patches (mwarp_mesh_uv_bezier).
            if master_mesh.bezier { 1.0 } else { 0.0 },
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
                // Alignment test pattern code (TestPatternType index), or 9
                // while a phone's auto map shows its stripes on the main output.
                if structured_light.is_some() { 9.0 } else { read(&["testPattern"], 0.0).clamp(0.0, 6.0) as f32 },
            ],
            dome3: [
                read(&["domeSource"], 0.0).round().clamp(0.0, 2.0) as f32,
                read(&["domePanoBottom"], 0.0).clamp(-90.0, 89.0).to_radians() as f32,
                read(&["domePanoTop"], 90.0).clamp(-89.0, 90.0).to_radians() as f32,
                read(&["domePanoSpan"], 360.0).clamp(10.0, 360.0).to_radians() as f32,
            ],
            dome4: [
                read(&["domeSourceAngle"], 90.0).clamp(10.0, 360.0).to_radians() as f32,
                read(&["domeGrid"], 0.0).clamp(0.0, 1.0) as f32,
                read(&["domePanoSeam"], 0.0).clamp(0.0, 0.3) as f32,
                0.0,
            ],
            dlayer: [0.0; 4],
            dview: [0.0; 4],
            dview1: [0.0; 4],
            dproj0: [0.0; 4],
            dproj1: [0.0; 4],
            dprojs: [[0.0; 4]; 32],
            edge_gamma: [2.2; 4],
            black_level: [0.0; 4],
            // The main output never carries a per-slice screen warp; that is
            // a projector-alignment transform and belongs to the slice. While
            // a phone maps the main output, row 0 names the raster size it
            // planned for and row 4 w the stripe frame (calibration stays off).
            projector_calibration: match structured_light {
                Some((frame, width, height)) => [[width, height, 0.0, 0.0], [0.0; 4], [0.0; 4], [0.0; 4], [0.0, 0.0, 0.0, frame]],
                None => [[0.0; 4]; 5],
            },
            swarp: [0.0; 4],
            swarp_c0: [0.0, 0.0, 1.0, 0.0],
            swarp_c1: [1.0, 1.0, 0.0, 1.0],
            mwarp: master_warp,
            mwarp_c0: master_c0,
            mwarp_c1: master_c1,
            swarp_mesh: [[0.0; 4]; 128],
            mwarp_mesh: master_mesh.points,
            swarp_tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
            mwarp_tangents: master_mesh.tangents,
            // Masks are cut per screen, so the main output carries none.
            smask: [0.0; 4],
            smask_info: [[0.0; 4]; MAX_SCREEN_MASKS],
            smask_bounds: [[0.0; 4]; MAX_SCREEN_MASKS],
            smask_pts: [[0.0; 4]; MAX_SCREEN_MASK_VEC4S],
        };
        self.refresh_slice_master_stage();
        Ok(json!({ "domeEnabled": dome_enabled, "masterWarp": master_warp[0] > 0.5 }))
    }

    /// Slices sample the master-warped composite, and copy the master's
    /// dome and warp out of the output stage when their list is applied.
    /// The editor resends that list only when a screen changes, so carry a
    /// later Master Warp or dome edit into the open slices here; otherwise a
    /// screen window keeps the old master warp while the preview moves.
    fn refresh_slice_master_stage(&mut self) {
        let master = self.output_stage;
        for spec in Arc::make_mut(&mut self.slice_outputs).iter_mut() {
            // Map Sim projector views draw without the master warp or dome.
            if spec.projector_view.is_some() {
                continue;
            }
            let stage = &mut spec.stage;
            stage.dome0 = master.dome0;
            stage.dome1 = master.dome1;
            stage.dome2[0] = master.dome2[0];
            stage.dome3 = master.dome3;
            stage.dome4 = master.dome4;
            stage.mwarp = master.mwarp;
            stage.mwarp_c0 = master.mwarp_c0;
            stage.mwarp_c1 = master.mwarp_c1;
            stage.mwarp_mesh = master.mwarp_mesh;
            stage.mwarp_tangents = master.mwarp_tangents;
        }
    }

    /// Multi-output slice displays. Each entry carries the slice's crop on
    /// the master composition plus its own projector grade, so the core can
    /// composite a full-resolution frame per display rather than having each
    /// slice window re-render the whole scene in WebGL and crop it.
    fn apply_slice_outputs(&mut self, params: &Value) -> Result<Value, String> {
        validate_slice_outputs(params)?;
        let rig = DomeRig::from_params(params.get("domeRig"));
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
                let slice_mesh = if warp_mode == "mesh" {
                    warp_mesh_at(entry.get("meshGrid"))
                } else {
                    WarpMesh::none()
                };
                let warp_code = match warp_mode.as_str() {
                    "corners" => 1.0,
                    // A mesh that failed validation falls back to the rect
                    // crop instead of collapsing the screen to a point.
                    "mesh" if slice_mesh.rows >= 2.0 && slice_mesh.cols >= 2.0 => 2.0,
                    _ => 0.0,
                };
                let slice_bezier = if warp_code == 2.0 && slice_mesh.bezier { 1.0 } else { 0.0 };
                // Masks are evaluated in the screen's own UV after the crop
                // and warp have been resolved, so they stay put on the
                // projector when the screen is re-pinned.
                let (mask_header, mask_info, mask_bounds, mask_points) = screen_masks_at(entry.get("masks"));
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
                    dome3: self.output_stage.dome3,
                    dome4: self.output_stage.dome4,
                    // The renderer sets this per frame (sync_dome_layers).
                    dlayer: [0.0; 4],
                    dview: [0.0; 4],
                    dview1: [0.0; 4],
                    // Filled from the dome rig below, for a projector Screen.
                    dproj0: [0.0; 4],
                    dproj1: [0.0; 4],
                    dprojs: [[0.0; 4]; 32],
                    // w: Screen alignment aid (7 numbered grid, 8 identify, 9 auto-map stripes);
                    // the main output's test patterns never reach a Screen.
                    dome2: [self.output_stage.dome2[0], blend_gamma as f32, 1.0, match read(&["alignmentAid"], 0.0).round() as i32 { 1 => 7.0, 2 => 8.0, 3 => 9.0, _ => 0.0 }],
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
                    projector_calibration: std::array::from_fn(|r| std::array::from_fn(|c| entry.get("projectorCalibration").and_then(|v| v.get(r)).and_then(|v| v.get(c)).and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(0.0) as f32)),
                    swarp: [warp_code, slice_mesh.rows, slice_mesh.cols, slice_bezier],
                    swarp_c0: slice_c0,
                    swarp_c1: slice_c1,
                    // Slices sample the master-warped composite, so they
                    // inherit the master warp exactly as the WebGL two-pass
                    // path does (warp the master, then crop from it).
                    mwarp: self.output_stage.mwarp,
                    mwarp_c0: self.output_stage.mwarp_c0,
                    mwarp_c1: self.output_stage.mwarp_c1,
                    swarp_mesh: slice_mesh.points,
                    mwarp_mesh: self.output_stage.mwarp_mesh,
                    swarp_tangents: slice_mesh.tangents,
                    mwarp_tangents: self.output_stage.mwarp_tangents,
                    smask: mask_header,
                    smask_info: mask_info,
                    smask_bounds: mask_bounds,
                    smask_pts: mask_points,
                };
                let projector_view = string_at(entry, &["mapSimProjectorId"])
                    .filter(|projector| !projector.trim().is_empty());
                let mut stage = if projector_view.is_some() { projector_view_output_stage(stage) } else { stage };
                if bool_at(entry, &["domeProjector"]).unwrap_or(false) {
                    if let Some(index) = rig.ids.iter().position(|rig_id| *rig_id == id) {
                        stage.dproj0 = [1.0, index as f32, rig.ids.len() as f32, rig.blend_width];
                        stage.dproj1 = [rig.blend_gamma, 0.0, 0.0, 0.0];
                        stage.dprojs = rig.frusta;
                    }
                }
                let mirror_mesh_id = string_at(entry, &["mirrorMeshId"]).filter(|id| !id.is_empty());
                let mirror_mesh = mirror_mesh_id.as_ref().and_then(|id| self.mirror_meshes.get(id).cloned());
                specs.push(SliceOutputSpec { id, width, height, stage, projector_view, mirror_mesh_id, mirror_mesh });
            }
        }
        let ids: Vec<String> = specs.iter().map(|spec| spec.id.clone()).collect();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.slice_targets.retain(|id, _| ids.contains(id));
        }
        self.slice_outputs = Arc::new(specs);
        Ok(json!({ "slices": ids }))
    }

    fn apply_output_config(&mut self, params: &Value) {
        if number_at(params, &["width"]).is_some() && number_at(params, &["height"]).is_some() {
            self.output_size_configured = true;
        }
        let width = number_at(params, &["width"]).unwrap_or(self.pending_width as f64);
        let height = number_at(params, &["height"]).unwrap_or(self.pending_height as f64);
        self.pending_width = width.round().clamp(64.0, 16384.0) as u32;
        self.pending_height = height.round().clamp(64.0, 16384.0) as u32;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.resize(PhysicalSize::new(self.pending_width, self.pending_height));
            self.pending_width = renderer.config.width;
            self.pending_height = renderer.config.height;
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
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.pacing.reset();
        }
        if !attached {
            if let Some(renderer) = self.renderer.as_ref() {
                self.output_window_placement =
                    detach_managed_output_window(&renderer.window, &self.output_window_placement);
            }
            return;
        }
        self.output_window_placement.attached = true;
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.window.set_visible(attached);
            if attached {
                // A newly shown winit window can remain entirely behind the
                // Electron editor on a single display. Metal then reports an
                // occluded swapchain and the UI cannot distinguish that from
                // a broken output. Raise it once on attach; normal window
                // ordering resumes as soon as the user focuses the editor.
                renderer.window.focus_window();
                activate_appkit_output_window(&renderer.window);
                renderer.window.request_redraw();
            }
        }
        self.refresh_output_display_rate();
    }

    fn apply_output_window_config(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        let request = OutputWindowRequest::from_config(config);
        if let Some(attached) = request.attached {
            self.output_window_attached = attached;
        }
        if let Some(fullscreen) = request.fullscreen {
            self.output_window_fullscreen = fullscreen;
        }
        // A fullscreen output shows the project's composite at the display's
        // size; the composite itself stays the project's.
        let keep_project_size = self.output_size_configured && self.output_window_fullscreen;
        if let (Some(width), Some(height)) = (request.width, request.height)
            && !keep_project_size
        {
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
        // Level, fullscreen, size, position and visibility, in the order that
        // survives winit: see output_window_plan.
        let (monitor_handles, monitors) = output_window_monitors(&renderer.window);
        let current = OutputWindowState {
            attached: self.output_window_attached,
            ..self.output_window_placement
        };
        let plan = plan_output_window(&request, &current, &monitors);
        apply_output_window_steps(&renderer.window, &plan.steps, &monitor_handles);
        self.output_window_placement = plan.state;
        self.refresh_output_display_rate();
    }

    fn request_auto_present(&mut self) {
        if !self.auto_present_on_state_change {
            return;
        }
        self.auto_present_requested = true;
        self.request_present();
    }

    /// The editor flushed a change. Every flush used to draw at once and
    /// restart the frame clock from that moment, so while frames were being
    /// drawn on schedule their timing followed the editor's flushes and their
    /// jitter. Now an idle core draws at once, as before; one already drawing
    /// on schedule draws the change with its next frame, or now if that frame
    /// is due, without moving the schedule.
    fn request_present(&mut self) {
        if self.display_paced() {
            self.present_pending = true;
            return;
        }
        let now = Instant::now();
        let period = self.frame_duration();
        match present_action(self.frames_scheduled(), self.last_redraw, now, period) {
            PresentAction::RenderNow { next_redraw } => {
                self.last_redraw = next_redraw;
                self.drive_frame(now);
            }
            PresentAction::WithNextFrame => self.present_pending = true,
        }
    }

    /// Draw the next frame. With the output window attached that used to be a
    /// redraw request only, answered by RedrawRequested. Windows sends none to
    /// a minimised window, and since this one frame also feeds the editor
    /// preview, the Screens and texture sharing, minimising the Live Output
    /// stopped all of them. A minimised window, or a redraw that has not
    /// arrived within two frames, is drawn directly instead.
    fn drive_frame(&mut self, now: Instant) {
        if !self.output_window_attached {
            self.render();
            return;
        }
        let Some(renderer) = self.renderer.as_ref() else {
            return;
        };
        let minimized = renderer.window.is_minimized().unwrap_or(false);
        if !minimized {
            renderer.window.request_redraw();
        }
        let requested_at = *self.redraw_requested_at.get_or_insert(now);
        if output_redraw_stalled(minimized, requested_at, now, self.frame_duration()) {
            self.render();
        }
    }

    fn apply_render_clock(&mut self, params: &Value) {
        let params = params.get("config").unwrap_or(params);
        let mode = string_at(params, &["mode"])
            .unwrap_or_else(|| "live".to_string())
            .trim()
            .to_ascii_lowercase();
        if mode == "reset" {
            self.launch_scheduler.clear(); self.scheduled_binding_guards.clear();
            if self.render_clock_mode == "manual" { self.leave_manual_clock_media(); }
            self.render_clock_mode = "live".to_string();
            self.render_clock_time = None;
            self.render_clock_frame_index = None;
            self.render_clock_delta = 1.0 / self.target_fps.max(1) as f32;
            self.last_native_graph_step_clock = None;
            self.stats.render_clock_updates = self.stats.render_clock_updates.saturating_add(1);
            return;
        }
        let next_mode = if mode == "manual" { "manual" } else { "live" };
        if next_mode == "manual" { self.launch_scheduler.clear(); self.scheduled_binding_guards.clear(); }
        if next_mode != self.render_clock_mode {
            // Leaving or entering manual export: forget the last stepped
            // virtual frame so the next manual run always steps.
            self.last_native_graph_step_clock = None;
            if next_mode == "manual" {
                self.enter_manual_clock_media();
                self.reset_native_graph_simulations();
            } else {
                self.leave_manual_clock_media();
            }
        }
        self.render_clock_mode = next_mode.to_string();
        self.render_clock_time = number_at(params, &["time"])
            .or_else(|| number_at(params, &["time_seconds"]))
            .or_else(|| number_at(params, &["clock_time"]))
            .map(|value| value.clamp(0.0, 1.0e9));
        self.render_clock_delta = number_at(params, &["time_delta"])
            .or_else(|| number_at(params, &["delta"]))
            .unwrap_or(1.0 / self.target_fps.max(1) as f64)
            .clamp(0.0, 10.0) as f32;
        self.render_clock_frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u64::MAX as f64) as u64);
        self.stats.render_clock_updates = self.stats.render_clock_updates.saturating_add(1);
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

    /// The render clock in seconds, unwrapped and in f64: video anchors and
    /// other bookkeeping. Shaders get native_graph_time_seconds().
    fn native_clock_seconds(&self) -> f64 {
        if self.render_clock_mode == "manual" {
            return self.render_clock_time.unwrap_or(0.0).max(0.0);
        }
        self.start_time.elapsed().as_secs_f64().max(0.0)
    }

    /// Shader time: the render clock wrapped at SHADER_CLOCK_WRAP_SECONDS.
    fn native_graph_time_seconds(&self) -> f32 {
        shader_clock_seconds(self.native_clock_seconds())
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
            // Manual clock: the step this render actually claimed, which is
            // 0 when the frame has already been advanced once. See
            // claim_native_graph_step().
            self.native_graph_step_delta_this_render,
            self.target_fps,
        )
    }

    fn sync_gpu_frame_stats(&mut self) {
        let budget = self.frame_duration();
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.poll_gpu_timing();
            renderer.update_frames_in_flight(budget);
            self.stats.gpu_frames_submitted = renderer.gpu_frames_submitted;
            self.stats.gpu_frames_completed = renderer.gpu_frames_completed();
            self.stats.frames_presented = self.stats.gpu_frames_completed;
            // Graph textures no graph used for a while are freed.
            renderer.native_graph_textures.end_frame();
        }
    }

    fn prepared_transition_ready(&self, command: &Value) -> bool {
        if !self.running || self.render_clock_mode != "live" { return false; }
        let Some(id) = command["layer_id"].as_str() else { return false; };
        let Some(graph) = self.native_graph_layers.get(id) else { return false; };
        let Some(token) = command["token"].as_u64().filter(|token| *token > 0) else { return false; };
        if graph.kind != NativeGraphLayerKind::VjCrossfade || graph.params["vjclipTransition"] != true
            || Some(token) != graph.params["vjclipClockToken"].as_u64()
            || graph.params["vjclipClockRunning"] == true
            || graph.params["vjclipClockDuration"].as_f64().is_none_or(|d| !d.is_finite() || d <= 0.0 || d > 10.0) { return false; }
        if !self.source_frame_readiness(&json!({"source_id":graph.source_id})).ok()
            .is_some_and(|ready| ready["ready"] == true) { return false; }
        let Some(template) = graph.effect_job_template.as_ref() else { return false; };
        if !template.buffers.iter().any(|buffer| buffer.initial_bytes.len() == 224) { return false; }
        let Some(sources) = command["sources"].as_array().filter(|s| s.len() == 2) else { return false; };
        sources.iter().enumerate().all(|(index, expected)| {
            let Some(source_id) = expected["source_id"].as_str() else { return false; };
            let binding = template.render_plans.iter().flat_map(|plan| plan.bindings.iter())
                .find(|binding| binding.binding == (index + 2) as u32);
            let Some(binding) = binding else { return false; };
            let actual = if let Some(layer) = binding.resource_id.strip_prefix("layer-frame:") {
                self.scene_layers.get(layer).and_then(|layer| layer.source_id.as_deref())
            } else { Some(binding.resource_id.as_str()) };
            if actual != Some(source_id) { return false; }
            if let Some(media) = self.media_sources.get(source_id) {
                if media.source_type == "video" && expected["seek_generation"].as_u64() != Some(media.seek_generation) { return false; }
            }
            self.source_frame_readiness(expected).ok().is_some_and(|ready| ready["ready"] == true)
        })
    }

    fn start_prepared_transition(&mut self, command: &Value) {
        let id = command["layer_id"].as_str().unwrap();
        let token = command["token"].as_u64().unwrap();
        let graph = self.native_graph_layers.get_mut(id).unwrap();
        let duration = graph.params["vjclipClockDuration"].as_f64().unwrap();
        graph.params["vjclipClockRunning"] = json!(true);
        graph.params["vjxfadeMix"] = json!(0);
        let mut clock = None;
        transition_clock::TransitionClock::sample(&mut clock, token, 0.0, duration, Instant::now());
        self.transition_clocks.insert(id.to_string(), clock);
        self.scheduled_transition_tokens.insert(id.to_string(), token);
    }

    fn pump_scheduled_launches(&mut self) {
        if !self.running || self.render_clock_mode != "live" { self.scheduled_transition_tokens.clear(); self.transition_clocks.clear(); self.launch_scheduler.clear(); self.scheduled_binding_guards.clear(); return; }
        let now = Instant::now();
        let beat = self.link_clock.filter(|(_, _, at)| at.elapsed() <= Duration::from_millis(500))
            .map(|(beat, tempo, at)| beat + at.elapsed().as_secs_f64() * tempo / 60.0);
        for launch in self.launch_scheduler.take_due(now, beat) {
            // Validate the whole transaction before mutating any participating row.
            let guards_valid = launch.expected_sources.as_object().is_none_or(|guards| guards.iter().all(|(layer, expected)| {
                self.scene_layers.get(layer).and_then(|l| l.source_id.as_deref()) == expected["source_id"].as_str()
                    && expected["seek_generation"].as_u64().is_none_or(|generation|
                        expected["source_id"].as_str().and_then(|id| self.media_sources.get(id)).is_some_and(|m| m.seek_generation == generation))
            }));
            let valid = guards_valid && launch.commands.as_array().unwrap().iter().all(|command| {
                let kind = command["type"].as_str().unwrap_or("");
                if kind != "set_media_source_playback" && !self.scene_layers.contains_key(command["layer_id"].as_str().unwrap_or("")) { return false; }
                if kind == "start_prepared_transition" {
                    if !self.prepared_transition_ready(command) { return false; }
                    let graph = &self.native_graph_layers[command["layer_id"].as_str().unwrap()];
                    // A cut on another row is safe. Rebinding this carrier or
                    // one of its prepared inputs would invalidate the readiness
                    // check, so reject the entire transaction before mutations.
                    return !launch.commands.as_array().unwrap().iter().any(|other| {
                        if other["type"] != "bind_media_source" { return false; }
                        let layer = other["layer_id"].as_str().unwrap_or("");
                        layer == graph.layer_id || graph.effect_job_template.as_ref().is_some_and(|template|
                            template.render_plans.iter().flat_map(|plan| plan.bindings.iter()).any(|binding|
                                binding.resource_id.strip_prefix("layer-frame:") == Some(layer)))
                    });
                }
                if matches!(kind, "bind_media_source" | "set_media_source_playback") {
                    let id = command["source_id"].as_str().unwrap_or("");
                    let Some(media) = self.media_sources.get(id) else { return false; };
                    if command["uri"].as_str().is_some_and(|uri| uri != media.uri) { return false; }
                    if command["source_type"].as_str().is_some_and(|kind| kind != media.source_type) { return false; }
                    // A ready texture may belong to a newer seek than the
                    // frame prepared for this launch. Never rewind that intent.
                    if command["seek_generation"].as_u64().is_some_and(|generation| generation != media.seek_generation) { return false; }
                    return self.source_frame_readiness(&json!({"source_id":id,"seek_generation":media.seek_generation})).ok()
                        .is_some_and(|value| value["ready"] == true);
                }
                true
            });
            if !valid { self.launch_scheduler.reject(&launch, "prepared layer/source is no longer ready"); continue; }
            let lateness_ms = now.saturating_duration_since(launch.due).as_secs_f64() * 1000.0;
            let summary = self.apply_commands(&launch.commands);
            if let Some(guards) = launch.expected_sources.as_object() {
                for (layer, expected) in guards {
                    if let Some(previous) = expected["source_id"].as_str() {
                        if self.scene_layers.get(layer).and_then(|l| l.source_id.as_deref()) != Some(previous) {
                            self.scheduled_binding_guards.insert(layer.clone(), (previous.to_string(), launch.lane.clone(), expected["seek_generation"].as_u64()));
                        }
                    }
                }
            }
            self.pending_render_retry = true;
            self.launch_scheduler.complete(&launch, json!({"summary":summary,"estimated_deadline_lateness_ms":lateness_ms}));
        }
    }

    fn render(&mut self) {
        let started = Instant::now();
        if !self.running {
            return;
        }
        self.pump_scheduled_launches();
        self.expire_layer_holds();
        self.sync_gpu_frame_stats();
        if self
            .renderer
            .as_ref()
            .is_some_and(RenderState::frame_in_flight)
        {
            self.stats.gpu_backpressure_skips = self.stats.gpu_backpressure_skips.saturating_add(1);
            // Do NOT drop the request. Skipping a mid-stream frame is
            // harmless because another one follows 16ms later, but the
            // final frame of a scene teardown has no successor: the editor
            // has already torn down its RAF and an empty scene puts
            // `about_to_wait` to sleep. Losing that one frame is what left
            // a removed layer's picture stuck in the output export texture,
            // the slice windows and the swapchain.
            self.pending_render_retry = true;
            return;
        }
        self.present_pending = false;
        let graph_budget = self.native_graph_buffer_budget_bytes();
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.allow_async_compile = self.render_clock_mode != "manual";
            renderer.frame_epoch = renderer.frame_epoch.wrapping_add(1);
            gpu_object_cache::begin_frame();
            pass_timing::begin_frame(renderer.gpu_idle_for_frame());
            renderer.pipeline_cap = self.pipeline_metadata_cache_cap.max(1) as usize;
            renderer.graph_budget_bytes = graph_budget;
        }
        let mut native_graph_jobs = Vec::new();
        let mut generated_graph_jobs = 0;
        if !self.output_frozen && self.output_gate() > 0.0 {
            self.claim_native_graph_step();
            self.render_bound_isf_layers();
            native_graph_jobs = self.run_native_graph_layers();
            generated_graph_jobs = native_graph_jobs.len();
            native_graph_jobs.append(&mut self.pending_native_graph_jobs);
        }
        // Sharing the immutable chain avoids cloning its buffers each frame.
        let composite_graph_jobs =
            self.pending_composite_graph_jobs.clone();
        let composite_output_index = self.pending_composite_output_index;
        let render_time = if self.render_clock_mode == "manual" {
            self.render_clock_time.map(shader_clock_seconds)
        } else {
            None
        };
        let frame_index = self.native_frame_index();
        self.sync_paint_masks_to_gpu();
        let gpu_layers = self.gpu_layer_data();
        let deck_monitor_a = self.deck_monitor_layer_data(0);
        let deck_monitor_b = self.deck_monitor_layer_data(1);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let record_target = self.record_target.as_ref().map(|spec| {
            let post = if spec.source == RecordTargetSource::Composition {
                self.composite_effect_slots()
            } else {
                Vec::new()
            };
            (self.record_target_layer_data(spec), post, spec.alpha)
        });
        let source_preview_pixels = if self.source_preview_dirty {
            Some(self.source_preview_pixel_data())
        } else {
            None
        };
        let stage3d_mesh_frame = self.stage3d_mesh_frame();
        let scene_overlay_items = self.scene_overlay_items();
        let native_graph_buffer_budget_bytes = self.native_graph_buffer_budget_bytes();
        let native_graph_job_count = (native_graph_jobs.len() + composite_graph_jobs.len()) as u64;
        let native_graph_compute_pass_count = native_graph_jobs
            .iter().chain(composite_graph_jobs.iter())
            .map(|job| job.pass_plans.len() as u64)
            .fold(0u64, u64::saturating_add);
        let native_graph_render_pass_count = native_graph_jobs
            .iter().chain(composite_graph_jobs.iter())
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
        let slice_specs = Arc::clone(&self.slice_outputs);
        let deck_monitors_have_content = !deck_monitor_a.is_empty() || !deck_monitor_b.is_empty();
        let deck_monitors_were_lit = self.deck_monitors_lit;
        let mut deck_monitors_rendered = false;
        if self.renderer.is_none() {
            // Renderer not created yet; keep the retry armed so the frame
            // lands as soon as `ensure_renderer` succeeds.
            return;
        }
        // Past every early-out: this frame is being drawn, so whatever was
        // waiting on a retry is served by it.
        self.pending_render_retry = false;
        let Some(renderer) = self.renderer.as_mut() else {
            return;
        };
        if let Some(anchor) = self.beat_clock_request.take() {
            renderer.beat_clock.rebase(anchor);
        }
        let present_surface = self.output_window_attached;
        if present_surface {
            renderer.pacing.frame_started(started);
            self.stats.swapchain_present_attempts =
                self.stats.swapchain_present_attempts.saturating_add(1);
        }
        let mut render_result = renderer.render(
            self.command_phase,
            gpu_layers.len() as u32,
            render_time,
            frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            stage3d_mesh_frame.as_ref(),
            &scene_overlay_items,
            &native_graph_jobs,
            &composite_graph_jobs,
            composite_output_index,
            self.audio0,
            self.audio1,
            self.audio2,
            present_surface,
            self.output_frozen,
            output_gate,
            &post_effects,
            output_stage,
        );
        let pipeline_warming = render_result.as_ref().err().is_some_and(|error| error.starts_with("native pipeline is warming"));
        if pipeline_warming {
            // Keep unrelated live sources, transforms and output controls moving
            // while a new graph warms. A graph that has rendered before keeps its
            // cached source frame; a new one composites as transparent, because
            // its slot was cleared when it was assigned. Composition uses the
            // most recent chain that actually rendered.
            self.pending_native_graph_jobs.extend(native_graph_jobs.split_off(generated_graph_jobs));
            // No immediate retry: a retry runs "as soon as the GPU is free",
            // which for a warming pipeline is a hot loop of a thousand-plus
            // frames a second. On D3D12 that starved the worker compiling the
            // pipeline, so it never finished and the effect never appeared.
            // The pending jobs keep the loop alive (has_offscreen_work), and
            // the next frame slot picks the pipeline up once it is built.
            render_result = renderer.render(
                self.command_phase, gpu_layers.len() as u32, render_time, frame_index,
                &gpu_layers, source_preview_pixels.as_deref(), stage3d_mesh_frame.as_ref(),
                &scene_overlay_items, &[], &self.ready_composite_graph_jobs,
                self.ready_composite_output_index, self.audio0, self.audio1, self.audio2,
                present_surface, self.output_frozen, output_gate, &post_effects, output_stage,
            );
        } else if render_result.is_ok() {
            // The master is rendered even if the swapchain has no drawable.
            self.ready_composite_graph_jobs = composite_graph_jobs.clone();
            self.ready_composite_output_index = composite_output_index;
        }
        // Deck confidence monitors ride the same frame: two small composite
        // passes over the bank-tagged layers, after the program render so
        // every source frame they sample is already current.
        //
        // Both banks going empty is exactly when the monitors MUST still be
        // drawn once: skipping the pass leaves the deleted clip's last frame
        // resident in the monitors' own textures. `deck_monitors_lit` buys
        // that one clearing pass and then lets the monitors idle again.
        if render_result.is_ok() && (deck_monitors_have_content || deck_monitors_were_lit) {
            let (monitor_width, monitor_height) = deck_monitor_size(
                self.deck_monitor_width,
                (renderer.config.width, renderer.config.height),
            );
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
            deck_monitors_rendered = true;
        }
        // Slice displays ride the same frame for the same reason: every
        // source frame they sample is already current after the program
        // render, so a slice costs one composite pass and no extra decode.
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
                composite_graph_jobs.is_empty() && stage3d_mesh_frame.is_none() && scene_overlay_items.is_empty() && !self.output_frozen && output_gate > 0.0,
                &ProjectorViewInputs {
                    scene: self.projection_sim_view.as_ref(),
                    meshes: &self.projection_sim_meshes,
                    overlays: &self.projection_sim_overlays,
                },
            );
        }
        // The editor's Inside view of the dome rides the frame too: one more
        // output-stage pass over the master the program render just made.
        if render_result.is_ok() {
            let view = self.dome_view.filter(|_| self.output_stage.dome0[0] > 0.5);
            renderer.render_dome_view(
                view.map(|[dview, dview1]| OutputStage {
                    out0: [0.0, 0.0, 1.0, 1.0],
                    out1: [0.0, 1.0, 1.0, 1.0],
                    dview,
                    dview1,
                    ..self.output_stage
                }),
                output_gate,
                render_time,
            );
        }
        // The recording target rides the same frame, after the program render,
        // for the same reason: it samples the source frames just made current.
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if render_result.is_ok() {
            if let Some((layers, post, alpha)) = record_target.as_ref() {
                renderer.render_record_target(
                    self.command_phase,
                    render_time,
                    frame_index,
                    layers,
                    self.audio0,
                    self.audio1,
                    self.audio2,
                    post,
                    *alpha,
                );
            }
        }
        if render_result.is_ok() && !pipeline_warming {
            for plan in native_graph_jobs.iter().flat_map(|job| job.render_plans.iter()) {
                let NativeComputeGraphRenderTarget::SourceFrame { source_id, slot, .. } = &plan.target else { continue; };
                if !source_id.starts_with("effect-pass:") { continue; }
                for layer in self.scene_layers.values_mut() {
                    if layer.source_id.as_deref() == Some(source_id.as_str()) {
                        layer.frame_slot = Some(*slot);
                        layer.source_rect = [0.0, 0.0, 1.0, 1.0];
                        layer.source_kind = source_kind("image");
                    }
                }
            }
        }
        if render_result.is_ok() {
            renderer.finish_frame(started);
            let now = Instant::now();
            if let Some(previous) = self.last_submission_at.replace(now) {
                self.submitted_intervals_ms.push(now.duration_since(previous).as_secs_f64() * 1000.0);
            }
        }
        if render_result.is_ok() && !pipeline_warming && native_graph_job_count > 0 {
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
                // An offline render takes as long as it takes: its slow frames
                // must not lower the quality tier part way through the file.
                if self.render_clock_mode != "manual" {
                    self.native_quality
                        .observe_frame(ms + self.media_pump_ms, gpu_ms, self.target_fps, if self.output_frozen || output_gate <= 0.0 { 0 } else { native_task_count });
                }
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
            Err(err) if err.starts_with("native pipeline is warming") => {
                if !pipeline_warming {
                    self.pending_native_graph_jobs.extend(native_graph_jobs.split_off(generated_graph_jobs));
                }
                // Wait for the next frame slot rather than spinning; see the
                // warming branch above.
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
        if deck_monitors_rendered {
            self.deck_monitors_lit = deck_monitors_have_content;
        }
        // Refresh what the reader thread serves. The output-export frame counter
        // in particular only changes here, and it is what the editor's preview
        // display-link watches to decide the core is still alive.
        if self.fast_path.wants_publish() {
            self.refresh_rpc_snapshot();
        }
    }

    fn snapshot_clock_from_params(&self, params: &Value) -> (Option<f64>, u64) {
        let snapshot_time = number_at(params, &["time"])
            .or_else(|| number_at(params, &["time_seconds"]))
            .or_else(|| number_at(params, &["clock_time"]))
            .map(|value| value.clamp(0.0, 1.0e9))
            .or(self.render_clock_time);
        let snapshot_frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u64::MAX as f64) as u64)
            .unwrap_or_else(|| self.native_frame_index());
        (snapshot_time, snapshot_frame_index)
    }

    /// Manual clock (offline render) with `step_seconds`: advance every graph,
    /// simulation and bound shader to this frame's time by exactly one step,
    /// here, after the videos are settled and before the snapshot reads the
    /// composite. Without it the snapshot showed whatever the core's own
    /// timer-paced render last produced, which depended on how fast the
    /// export ran. A repeat snapshot of the same frame does not step again.
    fn step_manual_snapshot_frame(&mut self, params: &Value, clock: Option<f64>, frame: u64) -> Result<(), String> {
        if self.render_clock_mode != "manual" {
            return Ok(());
        }
        let Some(step) = number_at(params, &["step_seconds"]).filter(|s| s.is_finite() && *s > 0.0) else {
            return Ok(());
        };
        let Some(time) = clock else { return Ok(()); };
        self.render_clock_time = Some(time);
        self.render_clock_frame_index = Some(frame);
        self.render_clock_delta = step.clamp(0.0, 1.0) as f32;
        if self.last_native_graph_step_clock == Some(time) {
            return Ok(());
        }
        // render() skips a frame while the GPU has no room for another
        // (frames_in_flight.rs): wait for room (an export has all the time it
        // needs, a stall is a fault).
        let waited = Instant::now();
        while self.renderer.as_ref().is_some_and(RenderState::frame_in_flight) {
            if let Some(renderer) = self.renderer.as_mut() {
                let _ = renderer.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: Some(Duration::from_millis(50)) });
            }
            if waited.elapsed() > Duration::from_secs(60) {
                return Err("the GPU did not finish the previous frame for the render".to_string());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        self.manual_snapshot_stepping = true;
        self.render();
        self.manual_snapshot_stepping = false;
        if self.last_native_graph_step_clock != Some(time) && !self.output_frozen && self.output_gate() > 0.0 {
            return Err("the render core could not step this frame".to_string());
        }
        Ok(())
    }

    fn render_frame_snapshot_texture(
        &mut self,
        params: &Value,
    ) -> Result<(Option<f64>, u64), String> {
        let (snapshot_time, snapshot_frame_index) = self.snapshot_clock_from_params(params);
        self.sync_paint_masks_to_gpu();
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
        // `slice_id` reads one screen's output (its crop, warp, grade, blend
        // and masks) through the same presenter pass a slice display uses,
        // instead of the editor preview's master stage.
        let (output_stage, mirror_mesh) = match string_at(params, &["slice_id"]) {
            Some(slice_id) => self
                .slice_outputs
                .iter()
                .find(|spec| spec.id == slice_id)
                .map(|spec| (spec.stage, spec.mirror_mesh.clone()))
                .ok_or_else(|| format!("unknown screen output: {slice_id}"))?,
            None => (self.preview_output_stage(), None),
        };
        let Some(renderer) = self.renderer.as_mut() else {
            return Err("native renderer has not created a wgpu device".to_string());
        };
        renderer.poll_gpu_timing();
        if let Err(err) = renderer.render_snapshot(
            self.command_phase,
            gpu_layers.len() as u32,
            snapshot_time.map(shader_clock_seconds),
            snapshot_frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            stage3d_mesh_frame.as_ref(),
            &scene_overlay_items,
            self.audio0,
            self.audio1,
            self.audio2,
            self.output_frozen,
            output_gate,
            &post_effects,
            &self.pending_composite_graph_jobs,
            self.pending_composite_output_index,
            output_stage,
            mirror_mesh,
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

    /// A UI mirror reads the last program frame, without advancing simulations
    /// or blocking the event loop while the GPU maps the readback buffer.
    fn start_composite_preview(&mut self, req: &RpcRequest) -> Result<(), String> {
        if LIVE_PREVIEW_BUSY.swap(true, Ordering::AcqRel) {
            return Err("composite preview busy; drop this preview frame".to_string());
        }
        let permit = LiveCapturePermit(&LIVE_PREVIEW_BUSY);
        let max_dim = number_at(&req.params, &["max_dim"]).unwrap_or(512.0).round().clamp(16.0, 2048.0) as u32;
        let include_pixels = bool_at(&req.params, &["include_pixels"]).unwrap_or(false);
        // `encoding: "jpeg"` sends a JPEG about a twentieth of the raw size.
        // A live mirror at 30 fps moved ~150 MB/s of base64 through the
        // broker and slowed every window; as JPEG it is a few MB/s.
        let jpeg_quality = string_at(&req.params, &["encoding"])
            .is_some_and(|value| value.eq_ignore_ascii_case("jpeg"))
            .then(|| number_at(&req.params, &["quality"]).unwrap_or(80.0).clamp(30.0, 95.0) as u8);
        let renderer = self.renderer.as_mut().ok_or("native renderer unavailable")?;
        let pending = renderer.prepare_frame_snapshot_scaled(max_dim, true)?;
        let frame_index = renderer.creative_frame_index as u64;
        let response_tx = self.response_tx.clone();
        let id = req.id;
        thread::spawn(move || {
            let _permit = permit;
            let result = pending.finish().and_then(|frame| {
                let mut value = match jpeg_quality.filter(|_| include_pixels) {
                    Some(quality) => SourcePreviewRequest {
                        width: None, height: None, max_dim, jpeg_quality: Some(quality), include_pixels: true,
                    }.encode(&frame)?,
                    None => frame.to_json(include_pixels),
                };
                value["frame_index"] = json!(frame_index);
                value["render_source"] = json!("core-output-mirror");
                Ok(value)
            });
            drop(_permit);
            if id != 0 {
                let reply = match result { Ok(result) => json!({"id":id,"ok":true,"result":result}),
                    Err(error) => json!({"id":id,"ok":false,"error":error}) };
                let _ = response_tx.send(reply.to_string());
            }
        });
        Ok(())
    }

    /// A deck confidence monitor read back for a panel with no presenter to
    /// show it (`deck_monitor`: "a" or "b"). Like the composite preview it
    /// reads what the last frame drew and maps the buffer off the event loop.
    fn start_deck_monitor_preview(&mut self, req: &RpcRequest) -> Result<(), String> {
        let bank = match string_at(&req.params, &["deck_monitor"]).as_deref() {
            Some("a") | Some("A") => 0,
            Some("b") | Some("B") => 1,
            // The dome's Inside view rides the same readback, for a panel or
            // test with no presenter to show it.
            Some("dome") => 2,
            _ => return Err("deck_monitor must be \"a\", \"b\" or \"dome\"".to_string()),
        };
        let busy = &LIVE_DECK_PREVIEW_BUSY[bank];
        if busy.swap(true, Ordering::AcqRel) {
            return Err("deck monitor preview busy; drop this preview frame".to_string());
        }
        let permit = LiveCapturePermit(busy);
        let include_pixels = bool_at(&req.params, &["include_pixels"]).unwrap_or(false);
        let renderer = self.renderer.as_ref().ok_or("native renderer unavailable")?;
        // No deck has drawn since the core started: answer with no pixels
        // rather than an error, so a panel polling an empty deck stays quiet.
        let Some(pending) = renderer.prepare_deck_monitor_readback(bank)? else {
            self.send_ok(req.id, json!({
                "render_source": "core-deck-monitor",
                "includes_pixels": false,
            }));
            return Ok(());
        };
        let response_tx = self.response_tx.clone();
        let id = req.id;
        thread::spawn(move || {
            let _permit = permit;
            let result = pending.finish().map(|frame| {
                let mut value = frame.to_json(include_pixels);
                value["render_source"] = json!("core-deck-monitor");
                value
            });
            drop(_permit);
            if id != 0 {
                let reply = match result { Ok(result) => json!({"id":id,"ok":true,"result":result}),
                    Err(error) => json!({"id":id,"ok":false,"error":error}) };
                let _ = response_tx.send(reply.to_string());
            }
        });
        Ok(())
    }

    fn frame_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        if params.get("source_id").is_some() || params.get("layer_id").is_some() {
            let request = SourcePreviewRequest::from_params(params);
            let pending = self.prepare_source_preview(params, &request)?;
            return request.encode(&pending.finish()?);
        }
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

    /// Queue the GPU copy of one layer's source for an editor preview.
    fn prepare_source_preview(&mut self, params: &Value, request: &SourcePreviewRequest) -> Result<PendingFrameReadback, String> {
        let layer = string_at(params, &["layer_id"]).and_then(|id| self.scene_layers.get(&id));
        let source_id = layer.and_then(|layer| layer.shader_source_id.clone())
            .or_else(|| string_at(params, &["source_id"]))
            .or_else(|| layer.and_then(|layer| layer.source_id.clone()))
            .ok_or("Source preview is not ready")?;
        let slot = *self.source_frame_slots.get(&source_id).ok_or("Source preview is not ready")?;
        let rect = self.source_frames.get(&source_id).ok_or("Source preview is not ready")?.source_rect;
        let renderer = self.renderer.as_mut().ok_or("Native renderer is unavailable")?;
        let pending = renderer.prepare_source_crop_readback(slot, rect, request)?;
        self.stats.frame_snapshot_reads = self.stats.frame_snapshot_reads.saturating_add(1);
        self.stats.frame_health_checks = self.stats.frame_health_checks.saturating_add(1);
        self.stats.frame_snapshot_bytes_read = self.stats.frame_snapshot_bytes_read
            .saturating_add(pending.width as u64 * pending.height as u64 * 4);
        Ok(pending)
    }

    /// Editor preview of a layer's source. Only the copy is queued on the
    /// render thread; waiting for the GPU, measuring and encoding the pixels
    /// happen on a worker, so a preview refresh never holds up an output frame.
    fn start_source_preview(&mut self, req: &RpcRequest) -> Result<(), String> {
        let request = SourcePreviewRequest::from_params(&req.params);
        let pending = self.prepare_source_preview(&req.params, &request)?;
        let response_tx = self.response_tx.clone();
        let id = req.id;
        thread::spawn(move || {
            let result = pending.finish().and_then(|frame| request.encode(&frame));
            if id != 0 {
                let reply = match result { Ok(result) => json!({"id":id,"ok":true,"result":result}),
                    Err(error) => json!({"id":id,"ok":false,"error":error}) };
                let _ = response_tx.send(reply.to_string());
            }
        });
        Ok(())
    }

    // Compiled everywhere. It used to be macOS/Windows only because it read
    // the shared-texture export, so on Linux stream_output_frame did not
    // exist, every recording's encoder job was cancelled on its first frame,
    // and REC left a 261-byte MP4 with no frames in it. The readback itself is
    // plain wgpu; only the texture it reads differs by platform.
    fn start_live_capture(&mut self, req: &RpcRequest) -> Result<(), String> {
        let path = if req.method == "export_frame_snapshot" {
            Some(string_at(&req.params, &["path"]).or_else(|| string_at(&req.params, &["file_path"]))
                .or_else(|| string_at(&req.params, &["output_path"]))
                .ok_or_else(|| "export_frame_snapshot requires path".to_string())?)
        } else { None };
        let sink = if req.method == "stream_output_frame" {
            let port = req.params.get("port").and_then(Value::as_u64).filter(|p| *p > 0 && *p <= 65535).ok_or("invalid frame stream port")? as u16;
            let token = req.params.get("token").and_then(Value::as_str).filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())).ok_or("invalid frame stream token")?.to_string();
            let copies = req.params.get("copies").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= 120).ok_or("invalid frame repetition count")?;
            Some((port, token, copies))
        } else { None };
        let include_pixels = path.is_none() && bool_at(&req.params, &["include_pixels"])
            .or_else(|| bool_at(&req.params, &["pixels"])).unwrap_or(false);
        let format = string_at(&req.params, &["format"]).or_else(|| string_at(&req.params, &["storage_format"]))
            .unwrap_or_else(|| "raw-texture".to_string()).to_ascii_lowercase();
        if !matches!(format.as_str(), "raw" | "raw-texture" | "raw-rgba" | "raw-rgba8" | "rgba" | "rgba8") {
            return Err("unsupported frame snapshot export format".to_string());
        }
        // Diagnostic polling must not take the recording/export slot.
        let busy = if path.is_some() || sink.is_some() { &LIVE_CAPTURE_BUSY } else { &LIVE_DIAGNOSTIC_BUSY };
        if busy.swap(true, Ordering::AcqRel) { return Err("live readback busy; drop this capture frame".to_string()); }
        let permit = LiveCapturePermit(busy);
        let renderer = self.renderer.as_ref().ok_or_else(|| "native renderer unavailable".to_string())?;
        // Which shared texture to read: the program output (default), the
        // recording target (one layer / transparent composition) or one
        // Screen's slice output. export_frame_snapshot names it in `source`,
        // stream_output_frame in `capture_source`.
        let capture_source = if req.method == "export_frame_snapshot" {
            string_at(&req.params, &["source"])
        } else {
            string_at(&req.params, &["capture_source"])
        }.unwrap_or_else(|| "output".to_string());
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let (texture, format, width, height, export_frame, alpha_mode, render_source) = {
            let (export, alpha_mode, render_source) = match capture_source.as_str() {
                "record_target" => {
                    let target = renderer.record_target.as_ref().ok_or_else(|| "record target is not rendering".to_string())?;
                    (&target.export, if target.alpha { "straight" } else { "opaque" }, "core-record-target")
                }
                source if source.starts_with("slice:") => {
                    let id = &source["slice:".len()..];
                    let target = renderer.slice_targets.get(id).ok_or_else(|| format!("screen output {id} is not rendering"))?;
                    (&target.export, "opaque", "core-slice-output")
                }
                _ => (renderer.output_export.as_ref().ok_or_else(|| "output export unavailable".to_string())?, "opaque", "core-output-composite"),
            };
            (&export.texture, export.format, export.width, export.height, export.frame, alpha_mode, render_source)
        };
        // No shared-texture export here, but the export on the other platforms
        // is only a blit of this very texture (refresh_output_export), so read
        // the composite directly. Layer and Screen targets are built on the
        // export, so only the program output is recordable on this platform.
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let (texture, format, width, height, export_frame, alpha_mode, render_source) = {
            if let Some(id) = capture_source.strip_prefix("slice:") {
                let target = renderer.slice_targets.get(id).ok_or_else(|| format!("screen output {id} is not rendering"))?;
                (&target._render_texture, renderer.config.format, target.width, target.height,
                    target.frame, "opaque", "core-slice-output")
            } else if capture_source.eq_ignore_ascii_case("output") {
                (&renderer.output_mirror_texture, renderer.config.format, renderer.config.width, renderer.config.height,
                    renderer.creative_frame_index as u64, "opaque", "core-output-mirror")
            } else {
                return Err(format!("recording `{capture_source}` needs a shared-texture export, which this platform does not have"));
            }
        };
        if sink.is_some() && (req.params.get("width").and_then(Value::as_u64) != Some(width as u64)
            || req.params.get("height").and_then(Value::as_u64) != Some(height as u64)) {
            return Err("recording dimensions differ from native output".to_string());
        }
        // The encoder is told the pipe carries BGRA. The export is always
        // BGRA, but the composite is the swapchain format, which some drivers
        // make RGBA; red and blue would trade places in the file.
        let swizzle_to_bgra = matches!(format, wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Rgba8UnormSrgb);
        // Copy is enqueued now, preserving the requested frame while mapping,
        // metrics and storage execute away from the presentation loop.
        let pending = prepare_texture_readback(&renderer.device, &renderer.queue, texture,
            format, width, height, "Live capture")?;
        let response_tx = self.response_tx.clone();
        let id = req.id;
        let frame_index = self.native_frame_index();
        let time = self.render_clock_time;
        thread::spawn(move || {
            let _permit = permit;
            let result = (|| -> Result<Value, String> {
                let mut frame = pending.finish()?;
                if swizzle_to_bgra {
                    for px in frame.pixels.chunks_exact_mut(4) { px.swap(0, 2); }
                }
                let mut value = frame.to_json(include_pixels);
                // A straight-alpha target may be transparent on purpose.
                value["alpha_mode"] = json!(alpha_mode);
                if let Some((port, token, copies)) = sink {
                    send_to_frame_stream(port, &token, &frame.pixels, copies)?;
                    value["bytes_written"] = json!(frame.pixels.len());
                    value["storage_format"] = json!("raw-texture");
                    value["transport"] = json!("native-binary-stream");
                } else if let Some(path) = path {
                    let target = Path::new(&path);
                    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::write(target, &frame.pixels).map_err(|e| e.to_string())?;
                    value["path"] = json!(path);
                    value["bytes_written"] = json!(frame.pixels.len());
                    value["storage_format"] = json!("raw-texture");
                    value["frame_index"] = json!(frame_index);
                    value["time_seconds"] = json!(time);
                } else {
                    value["source"] = json!("output-shared-texture-export");
                    value["color_space"] = json!("srgb");
                    value["storage_format"] = json!("bgra8unorm");
                    value["storage_encoding"] = json!("srgb-encoded-bgra8unorm");
                    value["alpha_mode"] = json!(alpha_mode);
                    value["premultiplied_alpha"] = json!(false);
                    value["single_render_source"] = json!(render_source);
                    value["zero_conversions"] = json!(true);
                    value["export_frame"] = json!(export_frame);
                }
                Ok(value)
            })();
            drop(_permit);
            if id != 0 {
                let reply = match result { Ok(result) => json!({"id":id,"ok":true,"result":result}),
                    Err(error) => json!({"id":id,"ok":false,"error":error}) };
                let _ = response_tx.send(reply.to_string());
            }
        });
        Ok(())
    }

    fn export_frame_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        // An offline render's frame goes straight to the encoder through the
        // main process's frame sink; otherwise it is written to `path`.
        let stream = frame_stream_params(params)?;
        let output_path = string_at(params, &["path"])
            .or_else(|| string_at(params, &["file_path"]))
            .or_else(|| string_at(params, &["output_path"]));
        if stream.is_none() && output_path.is_none() {
            return Err("export_frame_snapshot requires path".to_string());
        }
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
            let (clock, frame) = self.snapshot_clock_from_params(params);
            self.settle_manual_video_frames(clock)?;
            self.step_manual_snapshot_frame(params, clock, frame)?;
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

        if let Some((port, token)) = stream.as_ref() {
            // The sink takes exactly one frame of the encoder's size: a frame
            // of any other size is refused before a byte is sent.
            if let Some(expected) = params.get("stream_bytes").and_then(Value::as_u64)
                && expected != pixels.len() as u64
            {
                return Err(format!("frame has {} bytes; the encoder takes {expected}", pixels.len()));
            }
            send_to_frame_stream(*port, token, &pixels, 1)?;
        } else if let Some(output_path) = output_path.as_ref() {
            let path = Path::new(output_path);
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
            {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::write(path, &pixels).map_err(|err| err.to_string())?;
        }

        if let Some(object) = snapshot.as_object_mut() {
            match (stream.is_some(), output_path) {
                (true, _) => { object.insert("transport".to_string(), json!("native-binary-stream")); }
                (false, Some(path)) => { object.insert("path".to_string(), Value::String(path)); }
                (false, None) => {}
            }
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
            // What the render checks a frame by, instead of how dark it is (a
            // show may be black on purpose): the core drew this frame itself
            // (an opaque output, never transparent), on which clock, from how
            // many layers.
            object.insert("drawn".to_string(), json!(!use_output_export));
            object.insert("alpha_mode".to_string(), json!("opaque"));
            object.insert("render_clock".to_string(), json!(self.render_clock_mode));
            object.insert("layers".to_string(), json!(self.scene_layers.len()));
            if !use_output_export && self.render_clock_mode == "manual" {
                object.insert("videos".to_string(), Value::Array(self.manual_video_report.clone()));
            }
        }
        Ok(snapshot)
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn start_native_recording_rpc(&mut self, params: &Value) -> Result<Value, String> {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "start_native_recording needs a path".to_string())?;
        let fps = params.get("fps").and_then(Value::as_u64).unwrap_or(30) as u32;
        let quality = params
            .get("quality")
            .and_then(Value::as_str)
            .unwrap_or("high");
        let renderer = self
            .renderer
            .as_mut()
            .ok_or_else(|| "native renderer has not created a wgpu device".to_string())?;
        let (width, height) =
            renderer.start_native_recording(std::path::Path::new(path), fps, quality)?;
        Ok(json!({ "started": true, "width": width, "height": height, "fps": fps }))
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn stop_native_recording_rpc(&mut self) -> Result<Value, String> {
        let renderer = self
            .renderer
            .as_mut()
            .ok_or_else(|| "native renderer has not created a wgpu device".to_string())?;
        let (frames, duration_seconds) = renderer.stop_native_recording()?;
        Ok(json!({ "stopped": true, "frames": frames, "duration_seconds": duration_seconds }))
    }

    /// Shared-texture metadata tagged with what a presenter in another
    /// process needs besides the texture: the adapter the textures live on,
    /// so it opens them on the same GPU, and where the completed-frame count
    /// is published, so it copies only new frames.
    fn tag_presenter_info(&self, mut value: Value) -> Value {
        if let Some(map) = value.as_object_mut() {
            if let Some(luid) = self.adapter_luid.as_ref() {
                map.insert("adapter_luid".to_string(), json!(luid));
            }
            if let Some(name) = self.frame_counter_name.as_ref() {
                map.insert("frame_counter_name".to_string(), json!(name));
            }
        }
        value
    }

    fn output_shared_texture(&self) -> Value {
        if let Some(renderer) = self.renderer.as_ref() {
            return self.tag_presenter_info(renderer.output_export_metadata());
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
            self.shader_isf_hosts.clear();
            // Same key space as the three above: uniform state for a shader
            // whose record is gone can never be read again. It was the one
            // shader-keyed map with no removal path anywhere, so clearing the
            // caches to reclaim memory left it behind.
            self.isf_uniforms.clear();
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

    fn output_pacing_report(&self) -> present_pacing::PacingReport {
        let frame_ms = self.frame_duration().as_secs_f64() * 1000.0;
        let refresh_ms = self.paced_refresh_hz().filter(|hz| *hz > 0.0).map(|hz| 1000.0 / hz);
        self.renderer.as_ref().map(|renderer| renderer.pacing.report(frame_ms, refresh_ms)).unwrap_or_default()
    }

    fn frame_duration(&self) -> Duration {
        let refresh = if self.output_window_attached { self.paced_refresh_hz() } else { None };
        Duration::from_secs_f64(1.0 / paced_frame_rate(self.target_fps, refresh))
    }

    /// The output display's refresh rate: the display clock's own period
    /// while it paces the frames, else the rate the display reports.
    fn paced_refresh_hz(&self) -> Option<f64> {
        self.display_clock.as_ref()
            .filter(|clock| clock.ticking(Instant::now()))
            .and_then(display_pacing::DisplayClock::refresh_hz)
            .or(self.output_refresh_hz)
    }

    /// Re-read the refresh rate of the display the output window is on.
    fn refresh_output_display_rate(&mut self) {
        let monitor = self.renderer.as_ref().and_then(|renderer| renderer.window.current_monitor());
        self.output_refresh_hz = monitor.as_ref().and_then(monitor_refresh_hz);
        self.output_refresh_monitor = monitor;
        self.sync_display_clock();
    }

    /// Run a refresh clock on the output window's display while the window
    /// is shown, following it to another display; none otherwise.
    fn sync_display_clock(&mut self) {
        self.phase_lock.reset();
        self.paced_refresh_at = None;
        self.paced_frame_at = None;
        let monitor = self.output_refresh_monitor.clone()
            .filter(|_| self.display_pacing_enabled && self.output_window_attached && self.renderer.is_some());
        let Some(monitor) = monitor else {
            self.display_clock = None;
            self.last_paced_refresh = None;
            return;
        };
        let result = match self.display_clock.as_mut() {
            Some(clock) => clock.follow(&monitor),
            None => {
                let proxy = std::sync::Mutex::new(self.event_proxy.clone());
                display_pacing::DisplayClock::start(&monitor, Box::new(move || {
                    if let Ok(proxy) = proxy.lock() {
                        let _ = proxy.send_event(UserEvent::DisplayRefresh);
                    }
                }))
                .map(|clock| self.display_clock = Some(clock))
            }
        };
        if let Err(error) = result {
            eprintln!("[GhostRenderCore] display pacing unavailable, using the frame timer: {error}");
            self.display_clock = None;
            self.display_clock_error = Some(error);
        } else {
            self.display_clock_error = None;
        }
    }

    /// Frames are paced by the output display's refreshes right now (not
    /// by the timer): the window is shown and its refreshes are arriving.
    fn display_paced(&self) -> bool {
        self.output_window_attached
            && self.display_clock.as_ref().is_some_and(|clock| clock.ticking(Instant::now()))
    }

    /// The output display refreshed: draw if a frame is due on this refresh.
    fn on_display_refresh(&mut self) {
        let Some(refresh) = self.display_clock.as_ref().map(display_pacing::DisplayClock::take_refresh) else {
            return;
        };
        if !self.output_window_attached {
            // Detached by closing the window: stop the clock.
            self.sync_display_clock();
            return;
        }
        if !self.running {
            return;
        }
        self.pump_frame_media();
        if !self.frames_scheduled() {
            return;
        }
        let hz = self.paced_refresh_hz();
        let period = hz.map_or(Duration::from_micros(16_667), |hz| Duration::from_secs_f64(1.0 / hz));
        self.observe_paced_phase(period);
        let now = Instant::now();
        if self.paced_frame_at.is_some() {
            // The last refresh's frame never got its turn: draw it now.
            self.draw_paced_frame(now);
        }
        let divisor = hz.map_or(1, |hz| display_pacing::refresh_divisor(self.target_fps, hz));
        // A frame skipped for backpressure is normally drawn when the GPU
        // frees up (GpuFrameCompleted); if that has not happened, now.
        if display_pacing::refresh_due(refresh, self.last_paced_refresh, divisor) || self.pending_render_retry {
            if self.last_paced_refresh.is_some_and(|last| refresh.wrapping_sub(last) > divisor) {
                self.late_paced_frames = self.late_paced_frames.saturating_add(1);
            }
            self.last_paced_refresh = Some(refresh);
            let refresh_at = self.display_clock.as_ref()
                .and_then(display_pacing::DisplayClock::last_refresh_at)
                .unwrap_or(now)
                .min(now);
            self.paced_refresh_at = Some(refresh_at);
            let start_at = refresh_at + self.phase_lock.offset();
            if self.pending_render_retry || start_at <= now + Duration::from_micros(500) {
                self.draw_paced_frame(now);
            } else {
                self.paced_frame_at = Some(start_at);
            }
        }
    }

    /// Draw the paced frame that is due.
    fn draw_paced_frame(&mut self, now: Instant) {
        self.paced_frame_at = None;
        self.last_redraw = now;
        self.drive_frame(now);
    }

    /// The paced frame's start is here (RPCs keep the loop busy, so this is
    /// checked between them as well as when the loop goes idle).
    fn paced_frame_ready(&self, now: Instant) -> bool {
        self.paced_frame_at.is_some_and(|at| now >= at)
    }

    /// Learn from the last paced frame when its drawable came.
    fn observe_paced_phase(&mut self, period: Duration) {
        let Some(times) = self.renderer.as_mut().and_then(|renderer| renderer.pacing.take_frame_times()) else {
            return;
        };
        if let Some(refresh_at) = self.paced_refresh_at {
            self.phase_lock.observe(refresh_at, times.started, times.acquire_started, times.acquired, period);
        }
    }

    fn display_pacing_report(&self) -> Value {
        let clock = self.display_clock.as_ref();
        json!({
            "enabled": self.display_pacing_enabled,
            "active": self.display_paced(),
            "source": if self.display_paced() { clock.map_or("timer", display_pacing::DisplayClock::source) } else { "timer" },
            "clock_refresh_hz": clock.and_then(display_pacing::DisplayClock::refresh_hz),
            "display_refresh_hz": self.output_refresh_hz,
            "refreshes": clock.map_or(0, display_pacing::DisplayClock::refreshes),
            "late_frames": self.late_paced_frames,
            "phase_offset_ms": self.phase_lock.offset_ms(),
            "frame_interval_ms": self.frame_duration().as_secs_f64() * 1000.0,
            "error": self.display_clock_error,
        })
    }

    /// Frames are wanted on a clock right now: the output window is shown,
    /// or there is something to draw for the other outputs.
    fn frames_scheduled(&self) -> bool {
        self.output_window_attached
            || (self.renderer.is_some()
                && (
                    // A requested frame that has not been drawn yet outranks the
                    // idle gate. Without this an empty scene goes to sleep still
                    // owing one clear-and-present, and the last picture stays
                    // resident in every output surface.
                    self.pending_render_retry
                        || self.present_pending
                        || self.launch_scheduler.has_pending()
                        || !self.scene_layers.is_empty()
                        || !self.native_graph_layers.is_empty()
                        || !self.pending_native_graph_jobs.is_empty()
                        || self.source_preview_dirty
                        || self.stage3d_scene.is_some()
                        || self.projection_sim_scene.is_some()
                ))
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

    /// Memory the playing videos' decoded frames may hold. 0 MB from the
    /// editor means automatic: a quarter of the GPU's memory, between 512 MB
    /// and 8 GB, so a machine with a large GPU can play many more videos at
    /// once than the old fixed 512 MB allowed. Any other value is the
    /// user's own choice and is used as given.
    fn video_memory_budget_bytes(&self) -> u64 {
        const MIB: u64 = 1024 * 1024;
        if self.decode_handoff_byte_cap_mb > 0 {
            return u64::from(self.decode_handoff_byte_cap_mb) * MIB;
        }
        self.gpu_memory_bytes
            .map(|bytes| (bytes / 4).clamp(512 * MIB, 8192 * MIB))
            .unwrap_or(1024 * MIB)
    }

    fn apply_video_memory_budget(&mut self) {
        self.video_memory_budget.set_limit(self.video_memory_budget_bytes());
    }

    fn apply_decode_handoff_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_handoff_byte_cap_mb = number_at(config, &["decode_handoff_byte_cap_mb"])
            .unwrap_or(self.decode_handoff_byte_cap_mb as f64)
            .round()
            .clamp(0.0, 65_536.0) as u32;
        self.apply_video_memory_budget();
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
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.pipeline_cap = self.pipeline_metadata_cache_cap.max(1) as usize;
        }
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
        /* Absent means "leave as is", explicit null means "back to inherit" --
           the same contract as the other optional layer fields above. */
        if command_has_key(command, "render_quality") {
            entry.render_quality = number_at(command, &["render_quality"])
                .map(|value| (value as f32).clamp(0.2, 1.0));
        }
        if let Some(blend_mode) = string_at(command, &["blend_mode"]) {
            entry.blend_code = blend_mode_code(&blend_mode);
        }
        if let Some(corners) = corners_at(command, &["corners"]) {
            entry.corners = corners;
        }
        if let Some(perspective) = command.get("corner_perspective").and_then(|v| v.as_bool()) {
            entry.corner_perspective = perspective;
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
            apply_layer_mesh_grid(entry, command.get("mesh_grid"));
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
            apply_layer_mesh_grid(entry, command.get("mesh_grid"));
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

    fn apply_layer_tint(&mut self, command: &Value) {
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
        entry.tint = [rgba[0].clamp(0.0, 1.0), rgba[1].clamp(0.0, 1.0), rgba[2].clamp(0.0, 1.0), 1.0];
    }

    /// Keeps a mirror dome warp mesh and attaches it to the Screens that
    /// name it. Meshes are few and kept by content, so a re-sent one is
    /// the same mesh.
    fn apply_mirror_mesh(&mut self, command: &Value) -> Result<(), String> {
        let mesh = Arc::new(MirrorMesh::from_command(command)?);
        for spec in Arc::make_mut(&mut self.slice_outputs).iter_mut() {
            if spec.mirror_mesh_id.as_deref() == Some(mesh.id.as_str()) {
                spec.mirror_mesh = Some(Arc::clone(&mesh));
            }
        }
        if self.mirror_meshes.len() >= 16 {
            let named: Vec<String> = self.slice_outputs.iter().filter_map(|spec| spec.mirror_mesh_id.clone()).collect();
            self.mirror_meshes.retain(|id, _| named.contains(id));
        }
        self.mirror_meshes.insert(mesh.id.clone(), mesh);
        Ok(())
    }

    /// The editor's view from inside the dome: on or off, where it looks
    /// (azimuth and elevation, degrees) and how wide (vertical, degrees).
    fn apply_dome_view(&mut self, command: &Value) {
        let enabled = bool_at(command, &["enabled"]).unwrap_or(false);
        let read = |key: &str, fallback: f64| number_at(command, &[key]).filter(|v| v.is_finite()).unwrap_or(fallback);
        self.dome_view = enabled.then(|| {
            [
                [
                    1.0,
                    read("azimuth", 0.0).to_radians() as f32,
                    read("elevation", 30.0).clamp(-89.0, 89.0).to_radians() as f32,
                    (read("fov", 80.0).clamp(10.0, 160.0) * 0.5).to_radians().tan() as f32,
                ],
                [
                    // Where the eye sits: 0 the dome's center, 1 the back
                    // of the room (in dome radii, along the look's back).
                    read("back", 0.0).clamp(0.0, 1.0) as f32,
                    if bool_at(command, &["room"]).unwrap_or(true) { 1.0 } else { 0.0 },
                    0.0,
                    0.0,
                ],
            ]
        });
    }

    /// Places a layer on the dome, or back on the canvas. Degrees in;
    /// stored as `LayerGpu::dome` (radians, half width as a tangent).
    fn apply_layer_dome(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let enabled = bool_at(command, &["enabled"]).unwrap_or(false);
        let read = |key: &str, fallback: f64| number_at(command, &[key]).unwrap_or(fallback);
        let place = enabled.then(|| dome_place_gpu(read("azimuth", 0.0), read("elevation", 90.0), read("size", 60.0), read("roll", 0.0)));
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.dome = place;
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
        entry.edge = Box::new(parse_layer_edge_effects(command));
    }

    /// Live analyser rows for ISF `audioFFT` / `audio` inputs:
    /// `{ active, fft_b64?, waveform_b64? }` as bytes (0..255 = 0..1), or
    /// `{ fft: [..], waveform: [..] }` as numbers in 0..1. Decoded into
    /// reused buffers; the GPU rows upload lazily at the next ISF render.
    fn apply_audio_spectrum(&mut self, command: &Value) {
        let active = bool_at(command, &["active"]).unwrap_or(true);
        let spectrum = &mut self.isf_audio_spectrum;
        for (key_b64, key_numbers, is_fft) in [("fft_b64", "fft", true), ("waveform_b64", "waveform", false)] {
            let target = if is_fft { &mut spectrum.fft } else { &mut spectrum.waveform };
            if let Some(encoded) = command.get(key_b64).and_then(Value::as_str) {
                let scratch = &mut self.isf_audio_decode_scratch;
                scratch.clear();
                if base64::engine::general_purpose::STANDARD.decode_vec(encoded, scratch).is_ok() {
                    IsfAudioSpectrum::set_from_bytes(target, scratch);
                }
            } else if let Some(values) = command.get(key_numbers).and_then(Value::as_array) {
                IsfAudioSpectrum::set_from_numbers(target, values);
            }
        }
        spectrum.active = active;
        spectrum.seq = spectrum.seq.wrapping_add(1);
        spectrum.received_at = Some(Instant::now());
        // Audio-reactive instruments: one fixed-size packet, only while a
        // layer that reads it is showing (the editor decides). Independent of
        // the ISF rows above: either can be live without the other.
        if bool_at(command, &["visual_active"]) == Some(false) {
            self.audio_visual.set_inactive();
            self.audio_visual_sources.clear();
        } else if let Some(encoded) = command.get("visual_b64").and_then(Value::as_str) {
            let scratch = &mut self.isf_audio_decode_scratch;
            scratch.clear();
            if base64::engine::general_purpose::STANDARD.decode_vec(encoded, scratch).is_ok()
                && let Err(err) = self.audio_visual.set_from_bytes(scratch)
                && self.last_shader_error.as_deref() != Some(err.as_str())
            {
                self.last_shader_error = Some(err);
            }
        }
        if bool_at(command, &["visual_active"]) != Some(false) {
            self.apply_audio_visual_sources(command);
        }
    }

    /// Per-source packets: every key sent is decoded into its own packet;
    /// keys no longer sent are dropped (nothing follows them any more).
    fn apply_audio_visual_sources(&mut self, command: &Value) {
        let Some(sources) = command.get("visual_sources").and_then(Value::as_object) else { return };
        self.audio_visual_sources.retain(|key, _| sources.contains_key(key));
        for (key, encoded) in sources.iter().take(64) {
            let Some(encoded) = encoded.as_str() else { continue };
            let scratch = &mut self.isf_audio_decode_scratch;
            scratch.clear();
            if base64::engine::general_purpose::STANDARD.decode_vec(encoded, scratch).is_err() {
                continue;
            }
            let packet = self.audio_visual_sources.entry(key.clone()).or_default();
            if let Err(err) = packet.set_from_bytes(scratch)
                && self.last_shader_error.as_deref() != Some(err.as_str())
            {
                self.last_shader_error = Some(err);
            }
        }
    }

    /// The packet an instrument layer reads: its own source's when it follows one.
    pub(crate) fn audio_visual_for(&self, params: &Value) -> &audio_visuals::audio_data::AudioVisualData {
        audio_visual_packet_for(&self.audio_visual, &self.audio_visual_sources, params)
    }

    fn apply_audio_state(&mut self, command: &Value) {
        let audio = GhostAudioUniforms::from_command(command);
        self.audio0 = audio.audio0;
        self.audio1 = audio.audio1;
        self.audio2 = audio.audio2;
        // Optional, for the scene frame block: where the app is in the bar.
        self.scene_clock.bar_phase_hint = number_at(command, &["bar_phase"]).map(|v| v as f32);
        if let Some(beats) = number_at(command, &["beats_per_bar"]).filter(|v| v.is_finite() && *v >= 1.0) {
            self.scene_clock.beats_per_bar = beats.min(32.0) as u32;
        }
    }

    fn apply_media_source(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let source_id = string_at(command, &["source_id"]);
        if self.scheduled_binding_guards.get(&layer_id).is_some_and(|(previous, _, generation)| {
            source_id.as_ref() == Some(previous) && generation.is_none_or(|expected|
                self.media_sources.get(previous).is_none_or(|media| media.seek_generation == expected))
        }) {
            return; // The editor has not yet acknowledged the scheduled handoff.
        }
        self.scheduled_binding_guards.remove(&layer_id);
        let outgoing_picture = self.layer_displayed_picture(&layer_id);
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
            let entry = self.scene_layers.entry(layer_id.clone())
                .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
            if entry.source_id.is_none() && !entry.shader_rendered {
                // No outgoing picture exists on a new row. Mark it as
                // waiting media so gpu() cannot paint its debug fill.
                entry.source_kind = source_kind("video");
            }
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
        // The shader's output is let go below, once any hold on it is set.
        let release_shader_output = effective_source_type != "shader" && !effect_pass_display;
        if release_shader_output {
            self.isf_layer_bindings.remove(&layer_id);
        }
        let new_source_id = source_id.clone();
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
        let previous_source_id = entry.source_id.clone();
        let previous_effect_input = entry.effect_input_source_id.take();
        entry.effect_input_source_id = if effect_pass_display {
            string_at(command, &["effect_input_source_id"])
        } else { None };
        // An effect output may have a slot before the first graph pass has
        // rendered, or may still contain the previous clip after an input
        // switch. Keep showing the raw, resident input until the new pass has
        // actually been submitted. Otherwise the operator sees black or a
        // ghost frame while the pipeline warms.
        let effect_input_changed = previous_effect_input != entry.effect_input_source_id;
        let raw_input_slot = entry.effect_input_source_id.as_ref().and_then(|id| {
            if self.source_frames.contains_key(id) {
                self.source_frame_slots.get(id).copied()
            } else { None }
        }).or(entry.shader_frame_slot);
        let raw_input_rect = entry.effect_input_source_id.as_ref()
            .and_then(|id| self.source_frames.get(id).map(|frame| frame.source_rect));
        let hold_effect_input = effect_pass_display &&
            (effect_input_changed || !self.source_frames.contains_key(new_source_id.as_deref().unwrap_or("")));
        let held_slot = if hold_effect_input { raw_input_slot.or(entry.frame_slot) } else { frame_slot };
        let held_rect = if hold_effect_input { raw_input_rect.unwrap_or(entry.source_rect) } else { source_rect };
        let held_kind = if hold_effect_input && held_slot.is_some() {
            entry.effect_input_source_id.as_ref()
                .and_then(|id| self.media_sources.get(id))
                .map(|state| source_kind(&state.source_type))
                .unwrap_or_else(|| if entry.shader_frame_slot == held_slot && entry.shader_rendered {
                    NATIVE_SHADER_SOURCE_KIND
                } else { entry.source_kind })
        } else { source_kind(&effective_source_type) };
        entry.source_kind = held_kind;
        entry.source_id = source_id;
        entry.preview_slot = preview_slot;
        entry.frame_slot = held_slot;
        entry.source_rect = held_rect;
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
        // A page, shader or image that has no picture yet keeps the layer's
        // outgoing picture on screen until its first frame (see HeldPicture).
        let source_changed = new_source_id.as_deref() != previous_source_id.as_deref();
        let waits_for_picture = match effective_source_type.as_str() {
            "image" => entry.frame_slot.is_none(),
            "shader" => true,
            _ => false,
        };
        let mut dropped_hold = None;
        if source_changed && waits_for_picture && !effect_pass_display {
            if let Some(picture) = outgoing_picture {
                if entry.held.as_ref().is_some_and(|held| held.source_id != picture.source_id) {
                    dropped_hold = entry.held.take().map(|held| held.source_id);
                }
                entry.held = Some(picture);
            }
        } else if source_changed || !waits_for_picture {
            dropped_hold = entry.held.take().map(|held| held.source_id);
        }
        if release_shader_output {
            self.release_layer_shader_output(&layer_id, None);
        }
        if let Some(previous) = dropped_hold {
            self.release_replaced_media_source(previous);
        }
        if let Some(previous) = previous_source_id
            && new_source_id.as_deref() != Some(previous.as_str())
        {
            self.release_replaced_media_source(previous);
        }
        if let Some(previous) = previous_effect_input {
            self.release_replaced_media_source(previous);
        }
        if effective_source_type == "image" {
            if let (Some(source_id), Some(uri)) = (source_id_for_decode, uri_for_decode.as_deref())
            {
                self.decode_native_image_source(&source_id, uri);
            }
        }
    }

    /// The real picture a layer is showing now, if any: a held picture, a
    /// rendered shader frame, or a delivered media frame. Placeholders and
    /// the empty input frame do not count.
    fn layer_displayed_picture(&self, layer_id: &str) -> Option<HeldPicture> {
        let layer = self.scene_layers.get(layer_id)?;
        if let Some(held) = &layer.held {
            return Some(held.clone());
        }
        if layer.shader_rendered
            && let (Some(slot), Some(source_id)) = (layer.shader_frame_slot, layer.shader_source_id.as_ref())
            && layer.frame_slot == Some(slot)
        {
            return Some(HeldPicture {
                source_id: source_id.clone(),
                slot,
                rect: [0.0, 0.0, 1.0, 1.0],
                kind: NATIVE_SHADER_SOURCE_KIND,
                since: Instant::now(),
            });
        }
        let source_id = layer.source_id.as_ref()?;
        let slot = layer.frame_slot?;
        if source_id == EMPTY_SOURCE_FRAME_ID
            || source_id.starts_with("effect-pass:")
            || layer.source_kind < 0.5
            || !self.source_frames.contains_key(source_id)
            || self.source_frame_slots.get(source_id) != Some(&slot)
        {
            return None;
        }
        Some(HeldPicture {
            source_id: source_id.clone(),
            slot,
            rect: layer.source_rect,
            kind: if layer.shader_rendered { NATIVE_SHADER_SOURCE_KIND } else { layer.source_kind },
            since: Instant::now(),
        })
    }

    /// The layer has its own picture now: stop showing the held one.
    fn end_layer_hold(&mut self, layer_id: &str) {
        let held = self.scene_layers.get_mut(layer_id).and_then(|layer| layer.held.take());
        if let Some(held) = held {
            self.release_replaced_media_source(held.source_id);
        }
    }

    /// Give up holds that have waited too long for their new source.
    fn expire_layer_holds(&mut self) {
        let expired = self.scene_layers.values()
            .filter(|layer| layer.held.as_ref().is_some_and(|held| held.since.elapsed() >= LAYER_HOLD_MAX))
            .map(|layer| layer.id.clone())
            .collect::<Vec<_>>();
        for layer_id in expired {
            self.end_layer_hold(&layer_id);
        }
    }

    fn commit_pending_media_bindings_for_source(
        &mut self,
        source_id: &str,
        frame_slot: usize,
        source_rect: [f32; 4],
    ) {
        // Layers already bound to this source have their picture now.
        let delivered = self.scene_layers.values()
            .filter(|layer| layer.held.is_some() && layer.source_id.as_deref() == Some(source_id))
            .map(|layer| layer.id.clone())
            .collect::<Vec<_>>();
        for layer_id in delivered {
            self.end_layer_hold(&layer_id);
        }
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
            self.release_layer_shader_output(&layer_id, None);
            let entry = self
                .scene_layers
                .entry(layer_id.clone())
                .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
            if let Some(previous) = entry.source_id.clone()
                && previous != binding.source_id
            {
                replaced_sources.push(previous);
            }
            if let Some(previous_input) = entry.effect_input_source_id.take() {
                replaced_sources.push(previous_input);
            }
            entry.source_kind = source_kind(&binding.source_type);
            entry.source_id = Some(binding.source_id);
            entry.preview_slot = None;
            entry.frame_slot = Some(frame_slot);
            entry.source_rect = source_rect;
            entry.shader_rendered = false;
            entry.shader_id = None;
            entry.color = source_type_color(&binding.source_type, &layer_id);
            if let Some(held) = entry.held.take() {
                replaced_sources.push(held.source_id);
            }
        }
        // The commit just unbound these sources from their layers; free their
        // sessions/slots unless something else still references them.
        for previous in replaced_sources {
            self.release_media_source_if_orphaned(&previous);
        }
    }

    /// What keeps a media source referenced, by name (empty when nothing
    /// does): the same checks as `media_source_is_referenced`.
    fn media_source_holders(&self, source_id: &str) -> Vec<&'static str> {
        let mut holders = Vec::new();
        if self.launch_scheduler.references_source(source_id) { holders.push("launch_scheduler"); }
        if self.scene_layers.values().any(|layer| layer.source_id.as_deref() == Some(source_id)) { holders.push("layer_source"); }
        if self.scene_layers.values().any(|layer| layer.effect_input_source_id.as_deref() == Some(source_id)
            || layer.shader_source_id.as_deref() == Some(source_id)) { holders.push("layer_effect_or_shader"); }
        if self.scene_layers.values().any(|layer| layer.held.as_ref().is_some_and(|held| held.source_id == source_id)) { holders.push("layer_held"); }
        if self.pending_media_bindings.values().any(|binding| binding.source_id == source_id) { holders.push("pending_binding"); }
        if self.native_graph_layers.values().any(|layer| layer.input_source_id == source_id || layer.source_id == source_id
            || layer.effect_job_template.as_ref().is_some_and(|job| graph_job_references_source(job, source_id))) { holders.push("graph_layer"); }
        if self.pending_native_graph_jobs.iter().any(|job| graph_job_references_source(job, source_id)) { holders.push("pending_graph_job"); }
        if self.prepared_launch_sources.contains_key(source_id) { holders.push("prepared_launch"); }
        if self.native_video_streams.contains_key(source_id) { holders.push("has_session"); }
        if self.source_frames.contains_key(source_id) { holders.push("has_frame"); }
        holders
    }

    fn media_source_is_referenced(&self, source_id: &str) -> bool {
        if source_id == EMPTY_SOURCE_FRAME_ID {
            return true;
        }
        self.launch_scheduler.references_source(source_id) || self.scene_layers.values().any(|layer| {
            layer.source_id.as_deref() == Some(source_id)
                || layer.effect_input_source_id.as_deref() == Some(source_id)
                || layer.shader_source_id.as_deref() == Some(source_id)
                || layer.held.as_ref().is_some_and(|held| held.source_id == source_id)
        })
            || self
                .pending_media_bindings
                .values()
                .any(|binding| binding.source_id == source_id)
            || self
                .native_graph_layers
                .values()
                .any(|layer| layer.input_source_id == source_id || layer.source_id == source_id
                    || layer.effect_job_template.as_ref().is_some_and(|job| graph_job_references_source(job, source_id)))
            || self.pending_native_graph_jobs.iter().any(|job| graph_job_references_source(job, source_id))
    }

    /// Let go of the frame a shader layer rendered, unless it is `keep`.
    /// Every shader (and every edit of one) renders under its own
    /// `native-shader:` id, so each clip switch or content swap would
    /// otherwise strand a slot until the pool is full.
    fn release_layer_shader_output(&mut self, layer_id: &str, keep: Option<&str>) {
        let Some(layer) = self.scene_layers.get_mut(layer_id) else {
            return;
        };
        let Some(previous) = layer.shader_source_id.clone() else {
            return;
        };
        if keep == Some(previous.as_str()) {
            return;
        }
        layer.shader_source_id = None;
        let previous_slot = self.source_frame_slots.get(&previous).copied();
        if previous_slot.is_some() && layer.shader_frame_slot == previous_slot {
            layer.shader_frame_slot = None;
        }
        self.release_media_source_if_orphaned(&previous);
    }

    /// Free every per-source resource for a media source that no layer,
    /// pending binding, or graph input references anymore. Without this,
    /// replaced sources accumulate until the armed-session cap and the
    /// source-frame slots fill; per-frame ensure() then refreshes every
    /// session's last_used_frame, LRU eviction degrades to effectively
    /// random churn, and the *incoming* source's session can be evicted
    /// before it pre-rolls — observed as "switching clips stops working
    /// after several swaps" with the layer stuck on PENDING.
    fn release_source_frame_slot(&mut self, source_id: &str) {
        if let Some(slot) = self.source_frame_slots.remove(source_id) {
            if let Some(renderer) = &self.renderer {
                renderer.hap_converter.release(slot);
                renderer.release_shared_texture_import(slot);
                // A per-source slot gives its texture back.
                renderer.slots.release(slot);
            }
        }
    }

    /// Release a source a layer just let go of. Inside a command batch the
    /// check waits for the end of the batch, where a later bind may have
    /// given the source a new layer.
    fn release_replaced_media_source(&mut self, source_id: String) {
        match self.batch_orphan_candidates.as_mut() {
            Some(candidates) => candidates.push(source_id),
            None => self.release_media_source_if_orphaned(&source_id),
        }
    }

    /// Release plain media sources nothing has referenced for
    /// `media_orphans::ORPHAN_GRACE` (at most once a second).
    fn sweep_orphan_media_sources(&mut self, now: Instant) {
        if !self.orphan_sweep.due(now) {
            return;
        }
        let sources = self.media_sources.keys()
            .map(|id| (id.clone(), self.media_source_is_referenced(id)
                || self.prepared_launch_sources.get(id).is_some_and(|expires| *expires > now)))
            .collect::<Vec<_>>();
        let release = self.orphan_sweep.pass(
            sources.iter().map(|(id, referenced)| (id.as_str(), *referenced)), EMPTY_SOURCE_FRAME_ID, now);
        for id in release {
            self.release_media_source_if_orphaned(&id);
        }
    }

    fn release_media_source_if_orphaned(&mut self, source_id: &str) {
        if source_id.is_empty()
            || source_id.starts_with("library:")
            || self.media_source_is_referenced(source_id)
        {
            return;
        }
        self.drop_media_source(source_id);
        self.stats.media_source_orphan_releases =
            self.stats.media_source_orphan_releases.saturating_add(1);
    }

    /// Every per-source record and resource of one media source.
    fn drop_media_source(&mut self, source_id: &str) {
        self.media_sources.remove(source_id);
        self.link_phase_anchors.remove(source_id);
        self.deferred_source_releases.remove(source_id);
        self.native_video_streams.remove(source_id);
        self.native_video_scrub_requests.remove(source_id);
        self.release_source_frame_slot(source_id);
        self.source_frames.remove(source_id);
        self.source_frame_signatures.remove(source_id);
        self.native_video_frame_signatures.remove(source_id);
    }

    /// File > New and opening a project: the media tray's pre-rolled videos
    /// (`library:` sources, up to `NATIVE_LIBRARY_SESSION_CAP`, ~100 MB of
    /// decoded frames) belong to the project that was open. Release every one
    /// no layer is playing or using; the tray arms them again on hover.
    fn release_library_prerolls(&mut self) -> Value {
        let ids = self.media_sources.keys().chain(self.native_video_streams.keys())
            .map(|id| id.as_str())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .map(|id| media_orphans::LibraryPreroll {
                id,
                playing: self.native_video_streams.get(id).is_some_and(|session| session.playing),
                referenced: self.media_source_is_referenced(id),
            })
            .collect::<Vec<_>>();
        let release = media_orphans::library_prerolls_to_release(&ids);
        for id in &release {
            self.drop_media_source(id);
        }
        let kept = self.native_video_streams.keys().filter(|id| id.starts_with("library:")).count();
        json!({ "released": release.len(), "kept": kept })
    }

    fn source_frame_readiness(&self, params: &Value) -> Result<Value, String> {
        let source_id = string_at(params, &["source_id"])
            .ok_or_else(|| "get_source_frame_readiness requires source_id".to_string())?;
        let expected_generation = params.get("seek_generation").and_then(Value::as_u64);
        let slot = self.source_frame_slots.get(&source_id).copied();
        let frame = self.source_frames.get(&source_id);
        let session = self.native_video_streams.get(&source_id);
        let generation = session.map(|session| session.seek_generation)
            .or_else(|| self.media_sources.get(&source_id).map(|state| state.seek_generation));
        let gpu_ready = self.renderer.as_ref().is_some_and(|renderer| {
            let _ = renderer.device.poll(wgpu::PollType::Poll);
            slot.is_some_and(|slot| renderer.slot_readiness(slot).ready())
        });
        let ready = frame.is_some() && gpu_ready
            && expected_generation.is_none_or(|expected| generation == Some(expected))
            && session.is_none_or(|session| session.frames_presented > 0);
        Ok(json!({ "source_id": source_id, "ready": ready, "gpu_ready": gpu_ready,
            "source_slot": slot, "frame_sequence": frame.map(|frame| frame.seq),
            "seek_generation": generation, "frames_presented": session.map(|session| session.frames_presented) }))
    }

    fn layer_source_readiness(&self, params: &Value) -> Result<Value, String> {
        let layer_id = string_at(params, &["layer_id"])
            .ok_or_else(|| "get_layer_source_readiness requires layer_id".to_string())?;
        let expected_source = string_at(params, &["source_id"]);
        let expected_generation = params.get("seek_generation").and_then(Value::as_u64);
        let layer = self.scene_layers.get(&layer_id);
        let actual_source = layer.and_then(|layer| {
            if layer.shader_rendered && layer.frame_slot == layer.shader_frame_slot {
                layer.shader_source_id.as_deref()
            } else { layer.source_id.as_deref() }
        });
        let pending = self.pending_media_bindings.get(&layer_id);
        let slot = layer.and_then(|layer| layer.frame_slot);
        let source_frame = actual_source.and_then(|source| self.source_frames.get(source));
        let session = actual_source.and_then(|source| self.native_video_streams.get(source));
        let media = actual_source.and_then(|source| self.media_sources.get(source));
        let seek_generation = session.map(|session| session.seek_generation)
            .or_else(|| media.map(|state| state.seek_generation));
        let gpu_ready = self.renderer.as_ref().is_some_and(|renderer| {
            let _ = renderer.device.poll(wgpu::PollType::Poll);
            slot.is_some_and(|slot| renderer.slot_readiness(slot).ready())
        });
        let ready = pending.is_none() && source_frame.is_some() && gpu_ready
            && expected_source.as_deref().is_none_or(|expected| actual_source == Some(expected))
            && expected_generation.is_none_or(|expected| seek_generation == Some(expected))
            && session.is_none_or(|session| session.frames_presented > 0);
        Ok(json!({
            "layer_id": layer_id, "ready": ready,
            "actual_source_id": actual_source,
            "requested_source_id": pending.map(|binding| binding.source_id.as_str()).or(expected_source.as_deref()),
            "pending": pending.is_some(), "gpu_ready": gpu_ready,
            "source_slot": slot, "source_rect": layer.map(|layer| layer.source_rect),
            "frame_sequence": source_frame.map(|frame| frame.seq),
            "seek_generation": seek_generation,
            "frames_presented": session.map(|session| session.frames_presented),
        }))
    }

    fn capture_layer_source_frame(&mut self, params: &Value) -> Result<Value, String> {
        let layer_id = string_at(params, &["layer_id"])
            .ok_or_else(|| "capture_layer_source_frame requires layer_id".to_string())?;
        let source_id = string_at(params, &["source_id"])
            .filter(|source| is_clip_snapshot_source_id(source))
            .ok_or_else(|| "capture_layer_source_frame requires a bounded vj-clip-snapshot-{A|B}-{0..31} source_id".to_string())?;
        let readiness = self.layer_source_readiness(&json!({"layer_id": layer_id}))?;
        if readiness["ready"] != true {
            return Err(format!("layer `{layer_id}` has no completed source frame to capture"));
        }
        let layer = self.scene_layers.get(&layer_id).expect("ready layer exists");
        let input_slot = layer.frame_slot.expect("ready layer has a slot");
        let source_rect = layer.source_rect;
        let seq = readiness["frame_sequence"].as_u64().unwrap_or(0);
        let output_slot = if let Some(slot) = self.source_frame_slots.get(&source_id) {
            *slot
        } else {
            // A transition must never evict the incoming or outgoing live
            // picture to make room for its optional interruption snapshot.
            let slot = self.free_source_frame_slot()
                .ok_or_else(|| "no free GPU source slot for clip transition snapshot".to_string())?;
            self.source_frame_slots.insert(source_id.clone(), slot);
            self.clear_new_source_frame_slot(slot);
            slot
        };
        if input_slot == output_slot {
            return Err("cannot capture a snapshot into its own source slot".to_string());
        }
        self.renderer.as_ref().ok_or_else(|| "renderer unavailable".to_string())?
            .copy_source_frame_slot(input_slot, output_slot);
        // Reusing a row's snapshot can overwrite an input of its old fade.
        // Freeze that carrier's last output until the host installs the new
        // fade, or a native tick in the RPC gap would blend the picture twice.
        if self.native_graph_layers.contains_key(&layer_id) {
            self.captured_graph_holds.insert(layer_id.clone());
        }
        self.source_frames.insert(source_id.clone(), SourceFrame::with_rect(seq, source_rect));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(&source_id) {
                layer.frame_slot = Some(output_slot);
                layer.source_rect = source_rect;
            }
        }
        Ok(json!({ "captured": true, "layer_id": layer_id, "source_id": source_id,
            "source_slot": output_slot, "source_rect": source_rect, "frame_sequence": seq,
            "transport": "gpu-copy" }))
    }

    fn release_source_frame(&mut self, params: &Value) -> Result<Value, String> {
        let source_id = string_at(params, &["source_id"])
            .filter(|source| is_clip_snapshot_source_id(source) || source.starts_with("native-splat-video-"))
            .ok_or_else(|| "release_source_frame requires an owned temporary source_id".to_string())?;
        if self.media_source_is_referenced(&source_id) {
            if source_id.starts_with("native-splat-video-") { self.deferred_source_releases.insert(source_id.clone()); }
            return Ok(json!({ "released": false, "referenced": true, "source_id": source_id, "reason": "source is still referenced" }));
        }
        self.release_media_source_if_orphaned(&source_id);
        Ok(json!({ "released": true, "referenced": false, "source_id": source_id }))
    }

    fn upsert_media_source_binding(&mut self, source_id: &str, uri: &str, source_type: &str) {
        if source_id.trim().is_empty() || uri.trim().is_empty() || source_type == "none" {
            return;
        }
        let render_clock_time = self.native_clock_seconds();
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
                bounce_enabled: false,
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
        if bool_at(command, &["prepare_for_launch"]) == Some(true) && self.prepared_launch_sources.len() < 64 {
            self.prepared_launch_sources.insert(source_id.clone(), Instant::now() + Duration::from_secs(2));
        }
        let existing = self.media_sources.get(&source_id).cloned();
        // Prepared scene snapshots can arrive after a scheduled fade started.
        // Only ignore preparation writes for that exact running generation;
        // deliberate transport changes and newer preparations remain valid.
        if command["prepare_for_launch"] == true && existing.as_ref().is_some_and(|media|
            command["seek_generation"].as_u64() == Some(media.seek_generation)
                && command["uri"].as_str().is_none_or(|uri| uri == media.uri))
            && self.scheduled_transition_tokens.iter().any(|(layer_id, token)| {
                self.native_graph_layers.get(layer_id).is_some_and(|graph|
                    graph.params["vjclipClockToken"].as_u64() == Some(*token)
                    && graph.effect_job_template.as_ref().is_some_and(|template|
                        template.render_plans.iter().flat_map(|plan| plan.bindings.iter()).any(|binding| {
                            if binding.binding != 3 { return false; }
                            if let Some(input) = binding.resource_id.strip_prefix("layer-frame:") {
                                self.scene_layers.get(input).and_then(|layer| layer.source_id.as_deref()) == Some(source_id.as_str())
                            } else { binding.resource_id == source_id }
                        })))
            }) { return; }

        let uri = string_at(command, &["uri"])
            .or_else(|| existing.as_ref().map(|state| state.uri.clone()))
            .unwrap_or_default();
        let source_type = string_at(command, &["source_type"])
            .or_else(|| existing.as_ref().map(|state| state.source_type.clone()))
            .unwrap_or_else(|| "video".to_string());
        if uri.trim().is_empty() || source_type == "none" {
            return;
        }
        let render_clock_time = self.native_clock_seconds();
        let mut playback_time_seconds = number_at(command, &["time_seconds"])
            .or_else(|| number_at(command, &["time"]))
            .or_else(|| existing.as_ref().map(|state| state.current_time_seconds(Some(render_clock_time))))
            .unwrap_or(0.0)
            .clamp(0.0, 3600.0);
        let mut seek_generation = number_at(command, &["seek_generation"])
            .or_else(|| number_at(command, &["seekGeneration"]))
            .or_else(|| existing.as_ref().map(|state| state.seek_generation as f64))
            .unwrap_or(0.0)
            .round()
            .max(0.0) as u64;
        let playback_rate = number_at(command, &["playback_rate"])
            .or_else(|| number_at(command, &["rate"]))
            .or_else(|| existing.as_ref().map(|state| state.current_playback_rate(Some(render_clock_time))))
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
        let frame_step = number_at(command, &["frame_step"]);
        if frame_step.is_some_and(|step| step != -1.0 && step != 1.0)
            || (command.get("frame_step").is_some_and(|value| !value.is_null()) && frame_step.is_none())
        {
            self.stats.native_video_frame_decode_last_error = "Native video frame_step must be -1 or +1".into();
            return;
        }
        if frame_step.is_some() && (self.render_clock_mode != "live" || source_type != "video") {
            self.stats.native_video_frame_decode_last_error = "Native frame stepping requires a live video source".into();
            return;
        }
        let mut exact_step_reference = None;
        if let Some(direction) = frame_step {
            let session = self.native_video_streams.get(&source_id);
            let timing = session.map(|session| session.stream.source_timing());
            let reference = timing.and_then(|timing| timing.0).unwrap_or(playback_time_seconds);
            if session.is_some_and(|session| session.stream.frame_step_exact()) {
                exact_step_reference = Some(reference);
                playback_time_seconds = reference;
            } else if let Some(fps) = timing.and_then(|timing| timing.2) {
                // Compatibility decoding advertises estimated stepping. The
                // input FPS is separate from its capped/rate-adjusted output.
                let duration = timing.and_then(|timing| timing.3).or(duration_seconds);
                let start = duration.map_or(0.0, |duration| duration * trim_start);
                let end = duration.map_or(3600.0, |duration| (duration * trim_end - 1.0 / fps).max(start));
                playback_time_seconds = (reference + direction / fps).clamp(start, end);
            } else {
                self.stats.native_video_frame_decode_last_error = "Native video frame timing is unavailable; wait for the source to prepare before stepping".into();
                return;
            }
            seek_generation = seek_generation.max(existing.as_ref().map_or(1, |state| state.seek_generation.saturating_add(1)));
        }
        let next_state = NativeMediaSourceState {
            uri,
            source_type,
            playback_time_seconds,
            seek_generation,
            playback_rate,
            paused: frame_step.is_some() || bool_at(command, &["paused"])
                .unwrap_or_else(|| existing.as_ref().map(|state| state.paused).unwrap_or(false)),
            loop_enabled: bool_at(command, &["loop_enabled"])
                .or_else(|| bool_at(command, &["loop"]))
                .unwrap_or_else(|| {
                    existing
                        .as_ref()
                        .map(|state| state.loop_enabled)
                        .unwrap_or(false)
                }),
            bounce_enabled: bool_at(command, &["bounce_enabled"])
                .unwrap_or_else(|| existing.as_ref().is_some_and(|state| state.bounce_enabled)),
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
        if existing.as_ref().is_some_and(|state| state.seek_generation != next_state.seek_generation)
            && let Some(slot) = self.source_frame_slots.get(&source_id).copied()
            && let Some(renderer) = self.renderer.as_ref()
        {
            // A completed frame from the previous seek is still a valid
            // held picture, but cannot satisfy readiness for the new seek.
            renderer.slot_readiness(slot).invalidate();
        }
        if self.render_clock_mode == "live" && next_state.source_type == "video" {
            let (width, height) = self.native_video_decode_dimensions();
            if let (Some(direction), Some(reference)) = (frame_step, exact_step_reference) {
                let signature = Self::native_video_session_signature(&next_state,
                    next_state.decode_width.unwrap_or(width), next_state.decode_height.unwrap_or(height));
                if let Some(session) = self.native_video_streams.get_mut(&source_id)
                    .filter(|session| session.signature == signature)
                    && session.stream.step_frame(reference, direction as i32, next_state.playback_rate)
                {
                    session.start_time_seconds = reference;
                    session.start_reverse = next_state.playback_rate < 0.0;
                    session.stream.retime_hardware_clock(next_state.playback_rate);
                    session.phase_until = None;
                    session.phase_error_seconds = None;
                    session.seek_generation = seek_generation;
                    session.playing = false;
                    session.frames_presented = 0;
                    session.next_frame_at = Instant::now();
                    session.triggered_at = None;
                    self.media_sources.insert(source_id.clone(), next_state);
                    self.stats.native_video_frame_decode_last_error.clear();
                    return;
                }
                self.stats.native_video_frame_decode_last_error = "Native video session changed before the frame step; prepare it again".into();
                return;
            }
        }
        self.media_sources.insert(source_id.clone(), next_state.clone());
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
                        state.current_time_seconds(Some(self.native_clock_seconds()))
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

    /// Map Sim geometry for projector views: upserts meshes by key, then
    /// drops any key not in `retain` (when given).
    fn set_projection_sim_meshes(&mut self, params: &Value) -> Result<Value, String> {
        let batch = projector_view::parse_projector_view_meshes(params)?;
        if let Some(retain) = batch.retain {
            let keep: HashSet<String> = retain.into_iter().collect();
            self.projection_sim_meshes.retain(|key, _| keep.contains(key));
        }
        let uploaded = batch.upserts.len();
        for (key, mesh) in batch.upserts {
            self.projection_sim_meshes.insert(key, mesh);
        }
        Ok(json!({ "meshes": self.projection_sim_meshes.len(), "uploaded": uploaded }))
    }

    fn set_projection_sim_view(&mut self, params: &Value) -> Result<Value, String> {
        self.projection_sim_view = projector_view::parse_projector_view_scene(params)?;
        let (objects, projectors) = self
            .projection_sim_view
            .as_ref()
            .map(|view| (view.objects.len(), view.cameras.len()))
            .unwrap_or((0, 0));
        let missing: Vec<&str> = self
            .projection_sim_view
            .as_ref()
            .map(|view| {
                view.objects
                    .iter()
                    .filter(|object| !self.projection_sim_meshes.contains_key(&object.mesh))
                    .map(|object| object.mesh.as_str())
                    .collect()
            })
            .unwrap_or_default();
        Ok(json!({ "objects": objects, "projectors": projectors, "missing_meshes": missing }))
    }

    fn set_projection_sim_overlay(&mut self, params: &Value) -> Result<Value, String> {
        let (projector_id, overlay) = projector_view::parse_projector_view_overlay(params)?;
        match overlay {
            Some(overlay) => {
                self.projection_sim_overlays.insert(projector_id, overlay);
            }
            None => {
                self.projection_sim_overlays.remove(&projector_id);
            }
        }
        Ok(json!({ "overlays": self.projection_sim_overlays.len() }))
    }

    /// Render and read back one Map Sim projector view:
    /// `{ projector_id, width?, height?, include_pixels? }`.
    fn projection_sim_view_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        let projector_id = string_at(params, &["projector_id"])
            .ok_or_else(|| "projection_sim_view_snapshot requires projector_id".to_string())?;
        let width = number_at(params, &["width"]).unwrap_or(640.0).round().clamp(16.0, 4096.0) as u32;
        let height = number_at(params, &["height"]).unwrap_or(360.0).round().clamp(16.0, 4096.0) as u32;
        let include_pixels = bool_at(params, &["include_pixels"]).unwrap_or(false);
        let inputs = ProjectorViewInputs {
            scene: self.projection_sim_view.as_ref(),
            meshes: &self.projection_sim_meshes,
            overlays: &self.projection_sim_overlays,
        };
        let renderer = self.renderer.as_mut().ok_or_else(|| "native renderer has not created a wgpu device".to_string())?;
        let readback = renderer.projector_view_snapshot(&inputs, &projector_id, width, height)?;
        let mut value = readback.to_json(include_pixels);
        if let Some(object) = value.as_object_mut() {
            object.insert("source".to_string(), json!("map-sim-projector-view"));
            object.insert("projector_id".to_string(), json!(projector_id));
        }
        Ok(value)
    }

    fn start_timed_video_prefetch(&mut self, req: &RpcRequest) -> Result<(), String> {
        let params = &req.params;
        let source_id = string_at(params, &["source_id"]).or_else(|| string_at(params, &["sourceId"]))
            .ok_or_else(|| "video prefetch requires source_id".to_string())?;
        let uri = string_at(params, &["uri"]).or_else(|| string_at(params, &["src"]))
            .ok_or_else(|| "video prefetch requires uri".to_string())?;
        let path = local_media_path_from_uri(&uri).ok_or_else(|| "video prefetch requires a local file".to_string())?;
        let width = number_at(params, &["decode_width"]).or_else(|| number_at(params, &["decodeWidth"])).or_else(|| number_at(params, &["width"]))
            .unwrap_or(256.0).clamp(16.0, 4096.0) as usize;
        let height = number_at(params, &["decode_height"]).or_else(|| number_at(params, &["decodeHeight"])).or_else(|| number_at(params, &["height"]))
            .unwrap_or(width as f64).clamp(16.0, 4096.0) as usize;
        let explicit = number_at(params, &["time_seconds"]).or_else(|| number_at(params, &["timeSeconds"])).or_else(|| number_at(params, &["time"]));
        let time = explicit.or_else(|| self.media_sources.get(&source_id).map(|state| state.current_time_seconds(Some(self.native_clock_seconds()))))
            .unwrap_or(0.0).clamp(0.0, 3600.0);
        let seq = number_at(params, &["seq"]).unwrap_or(req.id as f64).max(1.0) as u64;
        let extra = number_at(params, &["prefetch_window_frames"]).unwrap_or(0.0).clamp(0.0, 4.0) as u32;
        let fps = number_at(params, &["prefetch_fps"]).unwrap_or(30.0).clamp(1.0, 120.0);
        let signature = native_video_frame_file_signature(&path, width, height, native_video_frame_bucket(time))?;
        // A timestamped preview must not race a stream that is still playing.
        if explicit.is_some() && self.render_clock_mode == "live" {
            self.native_video_streams.remove(&source_id);
            if let Some(state) = self.media_sources.get_mut(&source_id) {
                state.paused = true; state.playback_time_seconds = time; state.seq = 0;
            }
        }
        let mut work = Vec::new();
        for offset in 0..=extra {
            let frame_time = (time + offset as f64 / fps).min(3600.0);
            let bucket = native_video_frame_bucket(frame_time);
            let key = native_video_frame_file_signature(&path, width, height, bucket)?;
            if !self.native_video_frame_cache.contains_key(&key) { work.push((frame_time, bucket, key)); }
        }
        if work.is_empty() {
            self.video_prefetch_versions.remove(&source_id);
            if self.native_video_frame_signatures.get(&source_id) != Some(&signature) || !self.source_frames.contains_key(&source_id) {
                if let Some((w, h, rgba)) = self.cached_native_video_frame(&signature) {
                    let uploaded = self.upload_source_frame_pixels(source_id.clone(), seq, w, h, &rgba, "native-video-frame-cache", false);
                    self.stats.native_video_frame_decode_bytes_uploaded = self.stats.native_video_frame_decode_bytes_uploaded.saturating_add(uploaded as u64);
                    self.native_video_frame_signatures.insert(source_id, signature);
                    self.request_auto_present();
                }
            }
            if req.id != 0 { self.send_ok(req.id, json!(self.status())); }
            return Ok(());
        }
        let reserved_bytes = width as u64 * height as u64 * 4 * (work.len() as u64 + 2);
        if self.video_prefetch_active >= 2 || self.video_prefetch_bytes.saturating_add(reserved_bytes) > 256 * 1024 * 1024 {
            return Err("timestamped video prefetch budget exceeded".to_string());
        }
        self.video_prefetch_active += 1;
        self.video_prefetch_bytes += reserved_bytes;
        self.video_prefetch_versions.insert(source_id.clone(), req.id);
        let proxy = self.event_proxy.clone();
        let id = req.id;
        let deadline = Instant::now() + Duration::from_secs(5);
        thread::spawn(move || {
            let frames = (|| -> Result<Vec<NativeVideoFrameDecodeOutput>, String> {
                let mut frames = Vec::new();
                for (time, bucket, key) in work {
                    if Instant::now() >= deadline { return Err("timestamped video prefetch deadline exceeded".to_string()); }
                    let (width, height, rgba) = decode_native_video_frame_rgba(&path, width, height, time)?;
                    frames.push(NativeVideoFrameDecodeOutput { width, height, rgba, signature: key, frame_bucket: bucket });
                }
                Ok(frames)
            })();
            let _ = proxy.send_event(UserEvent::VideoPrefetched(VideoPrefetchResult { id, source_id, signature, seq, reserved_bytes, deadline, frames }));
        });
        Ok(())
    }

    fn finish_timed_video_prefetch(&mut self, result: VideoPrefetchResult) {
        self.video_prefetch_active = self.video_prefetch_active.saturating_sub(1);
        self.video_prefetch_bytes = self.video_prefetch_bytes.saturating_sub(result.reserved_bytes);
        let current = self.video_prefetch_versions.get(&result.source_id) == Some(&result.id);
        if current { self.video_prefetch_versions.remove(&result.source_id); }
        if !current || Instant::now() >= result.deadline {
            if result.id != 0 { self.send_error(result.id, "timestamped video prefetch expired or superseded".to_string()); }
            return;
        }
        match result.frames {
            Ok(frames) => {
                self.stats.native_video_frame_decodes = self.stats.native_video_frame_decodes.saturating_add(frames.len() as u64);
                for frame in frames { self.store_native_video_frame_cache(frame.signature, frame.width, frame.height, &frame.rgba); }
                if self.native_video_frame_signatures.get(&result.source_id) != Some(&result.signature) {
                    if let Some((w, h, rgba)) = self.cached_native_video_frame(&result.signature) {
                        let uploaded = self.upload_source_frame_pixels(result.source_id.clone(), result.seq, w, h, &rgba, "native-video-frame", false);
                        self.stats.native_video_frame_decode_bytes_uploaded = self.stats.native_video_frame_decode_bytes_uploaded.saturating_add(uploaded as u64);
                        self.native_video_frame_signatures.insert(result.source_id, result.signature);
                        self.request_auto_present();
                    }
                }
                if result.id != 0 { self.send_ok(result.id, json!(self.status())); }
            }
            Err(error) => {
                self.stats.native_video_frame_decode_failures = self.stats.native_video_frame_decode_failures.saturating_add(1);
                self.stats.native_video_frame_decode_last_error = error.clone();
                if result.id != 0 { self.send_error(result.id, error); }
            }
        }
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
            // Prefetch is advisory. A delayed scene warm-up must never
            // overwrite a transport command or replace its live decoder.
            if self.native_video_streams.get(&source_id).is_some_and(|s| s.playing)
                || (self.media_sources.get(&source_id).is_some_and(|s| s.seq > 0)
                    && self.media_source_is_referenced(&source_id))
            {
                return Ok(json!(self.status()));
            }
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
                        state.current_time_seconds(Some(self.native_clock_seconds()))
                    })
                })
                .unwrap_or(0.0)
                .clamp(0.0, 3600.0);
            let seq = number_at(params, &["seq"])
                .unwrap_or((time_seconds * 1000.0).round())
                .round()
                .max(1.0) as u64;
            let render_clock_time = self.native_clock_seconds();
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
                    .clamp(-16.0, 16.0),
                paused: true,
                loop_enabled: bool_at(params, &["loop_enabled"])
                    .or_else(|| bool_at(params, &["loop"]))
                    .unwrap_or(true),
                bounce_enabled: bool_at(params, &["bounce_enabled"]).unwrap_or(false),
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
        let pending_signature = format!("pending:{signature}");
        if self.source_frame_signatures.get(source_id) == Some(&pending_signature) { return; }
        if self.image_decode_queue.len() >= 64 {
            self.stats.native_image_decode_last_error = "image decode queue is full".to_string();
            return;
        }
        self.source_frame_signatures.insert(source_id.to_string(), pending_signature);
        if self.render_clock_mode == "manual" {
            self.image_decode_active += 1;
            self.finish_image_decode(source_id, signature, decode_native_image_rgba(&path));
            return;
        }
        self.image_decode_queue.push_back((source_id.to_string(), signature, path));
        self.pump_image_decodes();
    }

    fn pump_image_decodes(&mut self) {
        while self.image_decode_active < 2 {
            let Some((source_id, signature, path)) = self.image_decode_queue.pop_front() else { break; };
            if self.source_frame_signatures.get(&source_id) != Some(&format!("pending:{signature}")) { continue; }
            self.image_decode_active += 1;
            let proxy = self.event_proxy.clone();
            thread::spawn(move || {
                let result = decode_native_image_rgba(&path);
                let _ = proxy.send_event(UserEvent::NativeImageDecoded(source_id, signature, result));
            });
        }
    }

    fn finish_image_decode(&mut self, source_id: &str, signature: String, result: Result<(usize, usize, Vec<u8>), String>) {
        self.image_decode_active = self.image_decode_active.saturating_sub(1);
        self.pump_image_decodes();
        let waiters = self.image_prefetch_waiters.remove(&(source_id.to_string(), signature.clone())).unwrap_or_default();
        if self.source_frame_signatures.get(source_id) != Some(&format!("pending:{signature}")) {
            for (id, _) in waiters { self.send_error(id, "image prefetch superseded".to_string()); }
            return;
        }
        let decode_error = result.as_ref().err().cloned();
        let existing_seq = self.source_frames.get(source_id).map_or(0, |frame| frame.seq);
        match result {
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
        for (id, _) in waiters {
            if let Some(error) = decode_error.as_ref() { self.send_error(id, error.clone()); }
            else { self.send_ok(id, json!(self.status())); }
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
        // A shared slot caps the frame at its edge; a per-source slot holds
        // the frame at its own size up to the per-source limit.
        let renderer_limit = self
            .renderer
            .as_ref()
            .map(|renderer| match renderer.slots.mode() {
                SourceFrameMode::Shared => renderer.source_frame_size,
                SourceFrameMode::PerSource => renderer.slots.max_dimension() as usize,
            })
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

    fn record_native_video_presentation(&mut self, source_id: &str, source_time: Option<f64>, source_duration: Option<f64>) {
        if let Some(session) = self.native_video_streams.get_mut(source_id) {
            session.stream.record_presented(source_time, source_duration);
            session.frames_presented += 1;
            if let Some(triggered_at) = session.triggered_at.take() {
                let latency = triggered_at.elapsed().as_micros().min(u64::MAX as u128) as u64;
                self.stats.native_video_trigger_last_latency_us = latency;
                self.stats.native_video_trigger_max_latency_us = self.stats.native_video_trigger_max_latency_us.max(latency);
            }
        }
        if let Some(state) = self.media_sources.get_mut(source_id)
            && state.paused
            && let Some(source_time) = source_time
        {
            state.playback_time_seconds = source_time;
        }
    }

    fn present_native_video_frame(&mut self, source_id: &str, seq: u64,
        frame: NativeVideoStreamFrame, transport: &str) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(gpu) = frame.gpu {
            let slot = match self.assign_source_frame_slot(source_id) {
                Ok(slot) => slot,
                Err(error) => { self.stats.native_video_frame_decode_last_error = error; return false; }
            };
            self.stats.native_video_last_pixel_format = String::from_utf8_lossy(&gpu.pixel_format.to_be_bytes()).into_owned();
            let hap_bytes = match &gpu.storage { hardware_video::FrameStorage::Hap(hap) => hap.blocks.len() as u64, _ => 0 };
            let result = self.renderer.as_ref().ok_or_else(|| "Renderer unavailable".to_string())
                .and_then(|renderer| renderer.import_native_video_frame(slot, gpu, frame.memory_lease));
            let source_rect = match result {
                Ok(rect) => rect,
                Err(error) => {
                    self.stats.native_video_frame_decode_failures += 1;
                    self.stats.native_video_frame_decode_last_error = error;
                    return false;
                }
            };
            self.record_native_video_presentation(source_id, frame.source_time_seconds, frame.source_frame_duration_seconds);
            if hap_bytes > 0 { self.stats.native_video_hap_frames += 1; } else { self.stats.native_video_hardware_frames += 1; }
            self.stats.native_video_frame_decodes += 1;
            self.stats.source_frame_uploads += 1;
            if hap_bytes == 0 { self.stats.source_frame_shared_texture_uploads += 1; }
            self.stats.source_frame_bytes_uploaded = self.stats.source_frame_bytes_uploaded.saturating_add(hap_bytes);
            self.stats.source_frame_input_bytes_uploaded = self.stats.source_frame_input_bytes_uploaded.saturating_add(hap_bytes);
            self.stats.source_frame_last_input_bytes = hap_bytes;
            self.stats.source_frame_last_upload_bytes = hap_bytes;
            self.stats.source_frame_last_upload_width = frame.width as u32;
            self.stats.source_frame_last_upload_height = frame.height as u32;
            self.stats.source_frame_last_upload_transport = if hap_bytes > 0 { "native-video-hap-bc" } else { hardware_video::TRANSPORT }.into();
            self.stats.source_frame_last_reject_reason.clear();
            self.stats.native_video_frame_decode_last_error.clear();
            self.source_frame_signatures.remove(source_id);
            self.native_video_frame_signatures.remove(source_id);
            self.source_frames.insert(source_id.to_string(), SourceFrame::with_rect(seq, source_rect));
            for layer in self.scene_layers.values_mut() {
                if layer.source_id.as_deref() == Some(source_id) {
                    layer.frame_slot = Some(slot);
                    layer.source_rect = source_rect;
                }
            }
            self.commit_pending_media_bindings_for_source(source_id, slot, source_rect);
            return true;
        }
        let uploaded = self.upload_source_frame_pixels(source_id.to_string(), seq,
            frame.width, frame.height, &frame.rgba, transport, false);
        if let Some(session) = self.native_video_streams.get(source_id) { session.stream.recycle(frame.rgba); }
        if uploaded > 0 { self.record_native_video_presentation(source_id, frame.source_time_seconds, frame.source_frame_duration_seconds); }
        self.stats.native_video_software_frames += 1;
        self.stats.native_video_frame_decodes += 1;
        self.stats.native_video_frame_decode_bytes_uploaded += uploaded as u64;
        self.stats.native_video_frame_decode_last_error.clear();
        uploaded > 0
    }

    fn apply_media_source_phase(&mut self, command: &Value) {
        let Some(id) = string_at(command, &["source_id"]) else { return; };
        if bool_at(command, &["enabled"]) == Some(false) { self.link_phase_anchors.remove(&id); return; }
        if self.render_clock_mode != "live" { return; }
        let Some(media) = self.media_sources.get(&id) else { return; };
        if !bool_at(command, &["native_tick"]).unwrap_or(false) {
            if string_at(command, &["clock"]).as_deref() == Some("link") {
                self.link_phase_anchors.insert(id.clone(), command.clone());
            } else { self.link_phase_anchors.remove(&id); }
        }
        if media.paused || !media.loop_enabled || media.source_type != "video"
            || string_at(command, &["uri"]).as_deref() != Some(media.uri.as_str())
            || number_at(command, &["seek_generation"]) != Some(media.seek_generation as f64) { return; }
        let Some(duration) = media.duration_seconds else { return; };
        let span = duration * (media.trim_end - media.trim_start);
        if span <= 0.0 { return; }
        let Some(target_time) = number_at(command, &["time_seconds"]).filter(|n| n.is_finite()) else { return; };
        let Some(session) = self.native_video_streams.get_mut(&id) else { return; };
        if !session.playing || session.seek_generation != media.seek_generation { return; }
        let Some(elapsed) = session.stream.elapsed_source_seconds() else { return; };
        let lo = duration * media.trim_start;
        let cycle = span * if media.bounce_enabled { 2.0 } else { 1.0 };
        let actual = video_phase::phase_position(session.start_time_seconds, lo, span,
            session.start_reverse, media.bounce_enabled) + elapsed;
        let target = video_phase::phase_position(target_time, lo, span,
            bool_at(command, &["reverse"]).unwrap_or(media.playback_rate < 0.0), media.bounce_enabled);
        let error = video_phase::phase_error(target, actual, cycle);
        let rate = media.playback_rate * video_phase::correction(error, media.playback_rate);
        if session.stream.retime_hardware_clock(rate) {
            session.phase_until = Some(Instant::now() + Duration::from_millis(500));
            session.phase_error_seconds = Some(error);
        }
    }

    /// Recompute Link phase on the native pump even while the frontend is busy.
    fn refresh_link_phase(&mut self) {
        if self.render_clock_mode != "live" { return; }
        let Some((beat, tempo, at)) = self.link_clock else { return; };
        if at.elapsed() > Duration::from_millis(500) { return; }
        let beat = beat + at.elapsed().as_secs_f64() * tempo / 60.0;
        let anchors: Vec<_> = self.link_phase_anchors.iter().map(|(id, v)| (id.clone(), v.clone())).collect();
        for (id, anchor) in anchors {
            let Some(media) = self.media_sources.get_mut(&id) else { self.link_phase_anchors.remove(&id); continue; };
            if media.paused || !media.loop_enabled || number_at(&anchor, &["seek_generation"]) != Some(media.seek_generation as f64)
                || string_at(&anchor, &["uri"]).as_deref() != Some(media.uri.as_str()) { self.link_phase_anchors.remove(&id); continue; }
            let (Some(duration), Some(anchor_beat), Some(beats), Some(time)) = (media.duration_seconds,
                number_at(&anchor, &["beat_position"]), number_at(&anchor, &["beats_per_cycle"]), number_at(&anchor, &["time_seconds"])) else { continue; };
            let lo = duration * media.trim_start;
            let span = duration * (media.trim_end - media.trim_start);
            let cycle = span * if media.bounce_enabled { 2.0 } else { 1.0 };
            if span <= 0.0 || beats <= 0.0 { continue; }
            let rate = cycle * tempo / (60.0 * beats);
            if !(0.05..=8.0).contains(&rate) { continue; }
            let reverse = media.playback_rate < 0.0;
            let phase = (video_phase::phase_position(time, lo, span, bool_at(&anchor, &["reverse"]).unwrap_or(reverse), media.bounce_enabled)
                + (beat - anchor_beat) * cycle / beats).rem_euclid(cycle);
            let returning = if media.bounce_enabled { phase >= span } else { reverse };
            media.playback_rate = rate * if reverse { -1.0 } else { 1.0 };
            if let Some(session) = self.native_video_streams.get_mut(&id) { session.transport_rate = media.playback_rate; }
            let command = json!({ "source_id": id, "uri": media.uri, "seek_generation": media.seek_generation,
                "time_seconds": lo + if returning { cycle - phase } else { phase }, "reverse": returning, "native_tick": true });
            self.apply_media_source_phase(&command);
        }
    }

    /// Picture-side state of the transition a voice config points at: the
    /// core's own clock when it exists (exact for scheduled launches), else
    /// the frontend's running flag.
    fn clip_transition_state(clocks: &HashMap<String, Option<transition_clock::TransitionClock>>, transition: &Value, now: Instant) -> (clip_audio::FadeRole, f64, bool, Option<f64>) {
        let role = if string_at(transition, &["role"]).as_deref() == Some("out") { clip_audio::FadeRole::Out } else { clip_audio::FadeRole::In };
        let duration = number_at(transition, &["duration"]).filter(|d| d.is_finite()).unwrap_or(0.0).clamp(0.0, 10.0);
        let progress = transition.get("token").and_then(Value::as_u64)
            .and_then(|token| clocks.values().flatten().find(|clock| clock.token() == token).map(|clock| clock.progress(now)));
        (role, duration, progress.is_some() || bool_at(transition, &["running"]).unwrap_or(false), progress)
    }

    fn refresh_clip_audio(&mut self) {
        if self.clip_audio.is_none() { return; }
        let now = Instant::now();
        let mut voices = Vec::new();
        let mut keep: HashSet<String> = HashSet::new();
        // Rows mid-transition, with the running state and duration their audio follows.
        let mut rows: HashMap<String, (bool, f64)> = HashMap::new();
        if self.running && self.render_clock_mode == "live" {
            for config in self.clip_audio_mix.as_array().into_iter().flatten().take(32) {
                let Some(source_id) = string_at(config, &["source_id"]) else { continue; };
                let id = string_at(config, &["id"]).unwrap_or_else(|| source_id.clone());
                let row = string_at(config, &["row"]).unwrap_or_default();
                let transition = config.get("transition").filter(|t| t.is_object())
                    .map(|transition| Self::clip_transition_state(&self.transition_clocks, transition, now));
                if let Some((_, fade_duration, running, _)) = transition { rows.insert(row.clone(), (running, fade_duration)); }
                // A listed voice without a live source is left to the ghost pass
                // below (its picture may already be a transition snapshot).
                let Some(media) = self.media_sources.get(&source_id) else { continue; };
                let Some(duration) = media.duration_seconds else { continue; };
                let Some(session) = self.native_video_streams.get(&source_id) else { continue; };
                let Some(elapsed) = session.stream.elapsed_source_seconds() else { continue; };
                let lo = duration * media.trim_start;
                let hi = duration * media.trim_end;
                let span = hi - lo;
                if span <= 0.0 { continue; }
                let cycle = span * if media.bounce_enabled { 2.0 } else { 1.0 };
                let origin = video_phase::phase_position(session.start_time_seconds, lo, span, session.start_reverse, media.bounce_enabled);
                let phase = if media.loop_enabled { (origin + elapsed).rem_euclid(cycle) } else { origin + elapsed };
                let reverse = if media.bounce_enabled { phase >= span } else { media.playback_rate < 0.0 };
                let time = lo + if reverse { cycle - phase } else { phase };
                let rate = session.stream.effective_rate().abs() * if reverse { -1.0 } else { 1.0 };
                let gain = number_at(config, &["gain"]).unwrap_or(1.0).clamp(0.0, 1.0) as f32;
                let pan = number_at(config, &["pan"]).unwrap_or(0.0).clamp(-1.0, 1.0) as f32;
                // Audio follows the picture transition: equal-power in/out from
                // the voice's current level, held while the picture waits.
                let level = match transition {
                    Some((role, fade_duration, running, progress)) => {
                        let fade = self.clip_audio_fades.entry(id.clone()).or_insert_with(|| ClipAudioFade {
                            theta: clip_audio::fade_start(role, progress), role, row: row.clone(), at: now, ghost: None });
                        fade.theta = clip_audio::advance_fade(fade.theta, role, fade_duration, running, now.duration_since(fade.at).as_secs_f64());
                        fade.role = role; fade.row = row.clone(); fade.at = now;
                        fade.ghost = Some(ClipAudioGhost { uri: media.uri.clone(), time, rate, lo, hi, looping: media.loop_enabled, bounce: media.bounce_enabled, gain, pan, at: now });
                        keep.insert(id.clone());
                        clip_audio::fade_level(fade.theta)
                    }
                    None => { self.clip_audio_fades.remove(&id); 1.0 }
                };
                voices.push(clip_audio::Voice { id, uri: media.uri.clone(), time, rate, lo, hi,
                    looping: media.loop_enabled, bounce: media.bounce_enabled, gain: gain * level, pan,
                    playing: session.playing && !media.paused });
            }
            // An interrupted fade replaces the outgoing picture with a snapshot
            // and releases its source. Its sound keeps fading out with the row's
            // new transition instead of cutting: a ghost voice on extrapolated time.
            for (id, fade) in self.clip_audio_fades.iter_mut() {
                if keep.contains(id) || fade.role != clip_audio::FadeRole::Out { continue; }
                let (Some(&(running, fade_duration)), Some(ghost)) = (rows.get(&fade.row), fade.ghost.as_ref()) else { continue; };
                fade.theta = clip_audio::advance_fade(fade.theta, clip_audio::FadeRole::Out, fade_duration, running, now.duration_since(fade.at).as_secs_f64());
                fade.at = now;
                let level = clip_audio::fade_level(fade.theta);
                if level <= 0.0001 || now.duration_since(ghost.at).as_secs_f64() > 10.0 { continue; }
                keep.insert(id.clone());
                voices.push(clip_audio::Voice { id: id.clone(), uri: ghost.uri.clone(), time: ghost.time + now.duration_since(ghost.at).as_secs_f64() * ghost.rate,
                    rate: ghost.rate, lo: ghost.lo, hi: ghost.hi, looping: ghost.looping, bounce: ghost.bounce, gain: ghost.gain * level, pan: ghost.pan, playing: true });
            }
        }
        self.clip_audio_fades.retain(|id, _| keep.contains(id));
        if let Some(audio) = self.clip_audio.as_mut() { audio.update(voices); }
    }

    fn drain_native_video_streams(&mut self) {
        for id in self.deferred_source_releases.iter().cloned().collect::<Vec<_>>() {
            self.release_media_source_if_orphaned(&id);
        }
        self.sweep_orphan_media_sources(Instant::now());
        self.refresh_link_phase();
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
            if state.phase_until.is_some_and(|deadline| now >= deadline) {
                state.stream.retime_hardware_clock(state.transport_rate);
                state.phase_until = None;
                state.phase_error_seconds = None;
            }
            if state.stream.hardware_fallback() && !state.fallback_counted {
                state.fallback_counted = true;
                self.stats.native_video_hardware_fallbacks += 1;
            }
            if !state.playing || now < state.next_frame_at {
                continue;
            }
            match state.stream.try_pop() {
                Some(Ok(frame)) => {
                    state.seq = state.seq.saturating_add(1);

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
                    if state.frames_presented == 0 || state.stream.buffered_frames() > 0 {
                        // A queued frame ahead of the media clock is not starvation.
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
        // Each source occurs once in this drain. Its compressed texture can
        // therefore be written now and all HAP conversions submitted together.
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(renderer) = &self.renderer {
            *renderer.hap_upload_batch.lock().unwrap() = Some(NativeHapUploadBatch::default());
        }
        for (source_id, seq, frame) in ready {
            self.present_native_video_frame(&source_id, seq, frame, "native-video-stream");
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(renderer) = &self.renderer { renderer.flush_hap_upload_batch(); }
        self.refresh_clip_audio();
    }

    fn native_video_session_signature(
        state: &NativeMediaSourceState,
        width: usize,
        height: usize,
    ) -> String {
        let duration = state.duration_seconds.unwrap_or(0.0);
        format!(
            "{}:{width}x{height}:{:.6}:{:.6}:{:.6}:{:.6}:{}:{}",
            state.uri,
            if state.bounce_enabled { state.playback_rate.abs() } else { state.playback_rate },
            state.trim_start,
            state.trim_end,
            duration,
            state.loop_enabled,
            state.bounce_enabled,
        )
    }

    fn evict_native_video_session_for(&mut self, playing: bool) -> bool {
        let cap = if playing {
            // A clip fade retains its outgoing decoder until the new picture
            // is ready. Reserve bounded overlap without relaxing the shared
            // decoder memory budget or consuming the armed-session allowance.
            NATIVE_VIDEO_SESSION_MAX_PLAYING + self.native_graph_layers.values()
                .filter(|layer| layer.kind == NativeGraphLayerKind::VjCrossfade
                    && bool_at(&layer.params, &["vjclipTransitionActive"]).unwrap_or(false))
                .count().min(NATIVE_VIDEO_SESSION_MAX_PLAYING)
        } else {
            NATIVE_VIDEO_SESSION_MAX_ARMED
        };
        let count = self
            .native_video_streams
            .values()
            .filter(|state| state.playing == playing)
            .count();
        if count < cap {
            return true;
        }
        if let Some(source_id) = self
            .native_video_streams
            .iter()
            .filter(|(source_id, state)| {
                state.playing == playing
                    && !self.media_source_is_referenced(source_id)
                    && !self.prepared_launch_sources.get(*source_id).is_some_and(|expires| *expires > Instant::now())
            })
            .min_by_key(|(_, state)| state.last_used_frame)
            .map(|(source_id, _)| source_id.clone())
        {
            self.native_video_streams.remove(&source_id);
            // Retiring only the decoder leaves an active transport record.
            // The decode pump walks those records every frame and would
            // immediately recreate this session, evicting another preroll.
            // This churn is especially expensive for Media Foundation.
            self.media_sources.remove(&source_id);
            self.release_source_frame_slot(&source_id);
            self.source_frames.remove(&source_id);
            self.stats.native_video_session_evictions =
                self.stats.native_video_session_evictions.saturating_add(1);
            return true;
        }
        false
    }

    fn ensure_native_video_stream(
        &mut self,
        source_id: &str,
        state: &NativeMediaSourceState,
        fallback_width: usize,
        fallback_height: usize,
        playing: bool,
    ) {
        if state.playback_rate == 0.0 {
            return;
        }
        let Some(path) = local_media_path_from_uri(&state.uri) else {
            self.native_video_streams.remove(source_id);
            return;
        };
        let width = state.decode_width.unwrap_or(fallback_width);
        let height = state.decode_height.unwrap_or(fallback_height);
        let signature = Self::native_video_session_signature(state, width, height);
        // A video on a small slice decodes small. The cap comes from the
        // output size and the slice, the same for every caller, so a session
        // only restarts when its slice grows past what it decodes.
        let full_decode = self.native_video_decode_dimensions();
        let full_edge = full_decode.0.max(full_decode.1);
        let decode_max_edge = native_video_slice_edge_cap(full_decode, self.video_decode_scale(source_id));
        if let Some(session) = self.native_video_streams.get_mut(source_id) {
            if session.signature != signature && session.seek_generation == state.seek_generation {
                let mut previous_rate_state = state.clone();
                previous_rate_state.playback_rate = session.transport_rate;
                if Self::native_video_session_signature(&previous_rate_state, width, height) == session.signature
                    && session.stream.retime_hardware_clock(state.playback_rate) {
                    session.signature = signature.clone();
                    session.transport_rate = state.playback_rate;
                }
            }
        }
        let existing_stream_state = self
            .native_video_streams
            .get(source_id)
            .filter(|stream_state| stream_state.signature == signature
                && !native_video_decode_cap_needs_restart(stream_state.decode_max_edge, decode_max_edge,
                    full_edge, stream_state.decode_may_shrink))
            .map(|stream_state| (stream_state.playing, stream_state.seek_generation));
        // Prefer prepared frames to seeking a running decoder on a retrigger.
        // A column must not wait for three independent hardware seeks when
        // its next generations are already buffered. Unchanged transports
        // retain their current session; cold preparations retain their work.
        if let Some(warm_source_id) = self
            .native_video_streams
            .iter()
            .filter(|(candidate_id, candidate)| {
                existing_stream_state.map_or(true, |(_, generation)| generation != state.seek_generation)
                    && !source_id.starts_with("library:")
                    && candidate_id.starts_with("library:")
                    && !candidate.playing
                    && candidate.signature == signature
                    && !native_video_decode_cap_needs_restart(candidate.decode_max_edge, decode_max_edge, full_edge, false)
                    && (existing_stream_state.is_none() || candidate.stream.buffered_frames() > 0)
                    && (candidate.start_time_seconds - state.playback_time_seconds).abs() < 0.001
            })
            .max_by_key(|(_, candidate)| candidate.stream.buffered_frames())
            .map(|(candidate_id, _)| candidate_id.clone())
            && let Some(mut warm) = self.native_video_streams.remove(&warm_source_id)
        {
            if playing && existing_stream_state.map_or(true, |(was_playing, _)| !was_playing)
                && !self.evict_native_video_session_for(true) {
                self.native_video_streams.insert(warm_source_id, warm);
                self.stats.native_video_frame_decode_last_error = "playing video session limit reached".to_string();
                return;
            }
            warm.playing = playing;
            warm.decode_may_shrink = false;
            warm.seek_generation = state.seek_generation;
            warm.last_used_frame = self.stats.frames_presented;
            warm.next_frame_at = Instant::now();
            warm.triggered_at = playing.then(Instant::now);
            warm.stream.set_playing(playing);
            // Removing only the decoder leaves its library transport record
            // behind; the next pump would resurrect that consumed session.
            self.media_sources.remove(&warm_source_id);
            self.native_video_streams
                .insert(source_id.to_string(), warm);
            return;
        }


        if let Some((was_playing, existing_seek_generation)) = existing_stream_state {
            if existing_seek_generation != state.seek_generation {
                if let Some(session) = self.native_video_streams.get_mut(source_id) {
                    if session.stream.retrigger_with_rate(state.playback_time_seconds, !playing, state.playback_rate) {
                        session.start_time_seconds = state.playback_time_seconds;
                        session.start_reverse = state.playback_rate < 0.0;
                        session.stream.retime_hardware_clock(state.playback_rate);
                        session.phase_until = None;
                        session.phase_error_seconds = None;
                        session.seek_generation = state.seek_generation;
                        session.playing = playing;
                        session.frames_presented = 0;
                        session.next_frame_at = Instant::now();
                        session.triggered_at = playing.then(Instant::now);
                        session.stream.set_playing(playing);
                        return;
                    }
                }
            }
            if existing_seek_generation == state.seek_generation {
                if was_playing != playing {
                    if !self.evict_native_video_session_for(playing) { return; }
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
                self.release_source_frame_slot(&key);
                self.source_frames.remove(&key);
            }
        }
        // Hard cap on the armed pool: beyond it, paused decode sessions cost
        // more in pump time than a cold start would. Evict the least recently
        // touched armed session first.
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
                    self.release_source_frame_slot(key);
                    self.source_frames.remove(key);
                }
            }
        }


        if !self.evict_native_video_session_for(playing) {
            self.stats.native_video_frame_decode_last_error = "video session limit reached; active sessions preserved".to_string();
            return;
        }
        let start_time = state.current_time_seconds(Some(self.native_clock_seconds()));
        // Optional scratch history can yield to this decoder. Estimate only
        // mandatory resident bytes here, so history cannot reject a session
        // before its worker registers the required admission request. The
        // shared atomic budget still charges every retained GPU surface.
        let mut resident: usize = self.native_video_streams.values()
            .map(|s| s.stream.memory_bytes().saturating_sub(s.stream.optional_memory_bytes() as usize)).sum();
        // The budget in force: sized to the GPU unless the user chose one.
        let budget = self.video_memory_budget.limit_bytes() as usize;
        let (decode_width, decode_height) = fit_video_long_edge(
            width.min(u32::MAX as usize) as u32, height.min(u32::MAX as usize) as u32,
            decode_max_edge.map(|edge| edge.min(u32::MAX as usize) as u32));
        let (decode_width, decode_height) = (decode_width as usize, decode_height as usize);
        let frame_bytes = decode_width.clamp(16, 4096).saturating_mul(decode_height.clamp(16, 4096)).saturating_mul(4);
        // Speculative library preroll must never prevent an on-stage clip
        // from starting. Reclaim unused prepared sessions until the new
        // decoder has room for its minimum ring plus producer/consumer.
        while resident.saturating_add(frame_bytes.saturating_mul(4)) > budget {
            let victim = self.native_video_streams.iter()
                .filter(|(id, session)| id.starts_with("library:") && !session.playing
                    && !self.media_source_is_referenced(id))
                .min_by_key(|(_, session)| session.last_used_frame)
                .map(|(id, _)| id.clone());
            let Some(victim) = victim else { break; };
            if let Some(session) = self.native_video_streams.remove(&victim) {
                resident = resident.saturating_sub(session.stream.memory_bytes()
                    .saturating_sub(session.stream.optional_memory_bytes() as usize));
            }
            self.media_sources.remove(&victim);
            self.release_source_frame_slot(&victim);
            self.source_frames.remove(&victim);
            self.stats.native_video_session_evictions =
                self.stats.native_video_session_evictions.saturating_add(1);
        }
        // A shorter preroll ring leaves room to prepare the next hit for
        // every live row. Eight buffered RGBA frames per library entry
        // exhausted the default budget with only a few HD clips. Claimed
        // sessions keep this ring and refill continuously during playback.
        let target_capacity = if playing { 8 } else { 4 };
        let capacity = budget.saturating_sub(resident).checked_div(frame_bytes).unwrap_or(0).saturating_sub(2).min(target_capacity);
        if capacity < 2 {
            self.stats.native_video_frame_decode_last_error = "decoded video session budget exceeded".to_string();
            return;
        }
        let stream = spawn_native_video_stream(
            path,
            decode_width,
            decode_height,
            start_time,
            state.current_playback_rate(Some(self.native_clock_seconds())),
            state.loop_enabled,
            state.bounce_enabled,
            state.duration_seconds,
            state.trim_start,
            state.trim_end,
            capacity,
            self.video_memory_budget.clone(),
            self.renderer.as_ref().is_some_and(|r| r.device.features().contains(wgpu::Features::TEXTURE_COMPRESSION_BC)),
            decode_max_edge.map(|edge| edge.min(u32::MAX as usize) as u32),
            #[cfg(target_os = "windows")]
            self.renderer.as_ref().ok_or_else(|| "Renderer unavailable for hardware video".to_string())
                .and_then(|renderer| renderer.video_device.clone()),
        );
        stream.set_playing(playing);
        self.native_video_streams.insert(
            source_id.to_string(),
            NativeVideoStreamState {
                signature,
                transport_rate: state.playback_rate,
                start_reverse: state.current_playback_rate(Some(self.native_clock_seconds())) < 0.0,
                phase_until: None,
                phase_error_seconds: None,
                start_time_seconds: start_time,
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
                fallback_counted: false,
                decode_max_edge,
                decode_may_shrink: !source_id.starts_with("library:"),
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
        self.present_native_video_frame(source_id, seq, frame, "native-video-preroll")
    }

    fn prime_armed_native_video_sources(&mut self) {
        self.prepared_launch_sources.retain(|_, expires| *expires > Instant::now());
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
                    && (!self.source_frames.contains_key(*source_id) || session.frames_presented == 0)
                    && (pending_sources.contains(*source_id)
                        || visible_sources.contains(*source_id)
                        || self.prepared_launch_sources.contains_key(*source_id)
                        || self.launch_scheduler.references_source(source_id))
                    && session.stream.buffered_frames() > 0
            })
            .map(|(source_id, _)| source_id.clone())
            .collect::<Vec<_>>();
        for source_id in source_ids {
            self.prime_native_video_source(&source_id);
        }
    }

    fn reclaim_hardware_video_memory(&mut self) {
        let required_waiting = self.native_video_streams.values()
            .any(|session| session.stream.memory_waiting_bytes() > session.stream.memory_bytes() as u64);
        // Only actual admission pressure interrupts scratch history; a
        // library preload that fits available headroom need not discard it.
        let reclaim_optional = required_waiting || self.video_memory_budget.is_over_limit();
        self.video_memory_budget.set_optional_cache_allowed(!reclaim_optional);
        if reclaim_optional && self.native_video_streams.values()
            .any(|session| session.stream.optional_memory_bytes() > 0)
        {
            // Worker loops first release optional scratch history and unused
            // driver surfaces. Do not evict a prepared clip for those bytes.
            return;
        }
        let waiting: u64 = self.native_video_streams.values()
            .filter(|session| session.playing)
            .map(|session| session.stream.memory_waiting_bytes()
                .saturating_sub(session.stream.memory_bytes() as u64))
            .sum();
        if waiting == 0 { return; }
        // Retired workers/GPU submissions remain atomically charged until
        // completion. Their eventual release is already excluded from this
        // map, so do not evict extra library clips while that release is pending.
        let mut resident: u64 = self.native_video_streams.values()
            .map(|session| session.stream.memory_bytes() as u64).sum();
        while resident.saturating_add(waiting) > self.video_memory_budget.limit_bytes() {
            let victim = self.native_video_streams.iter()
                .filter(|(source_id, session)| source_id.starts_with("library:")
                    && !session.playing && !self.media_source_is_referenced(source_id))
                .min_by_key(|(_, session)| session.last_used_frame)
                .map(|(source_id, _)| source_id.clone());
            let Some(source_id) = victim else { break; };
            if let Some(session) = self.native_video_streams.remove(&source_id) {
                resident = resident.saturating_sub(session.stream.memory_bytes() as u64);
            }
            self.media_sources.remove(&source_id);
            self.release_source_frame_slot(&source_id);
            self.source_frames.remove(&source_id);
            self.stats.native_video_session_evictions = self.stats.native_video_session_evictions.saturating_add(1);
        }
    }

    /// Every media source a visible layer (or a visible graph's input, or a
    /// pending binding) is waiting on — the set the video decode pump admits.
    fn active_video_source_ids(&self) -> Vec<String> {
        let mut active_sources = Vec::new();
        for layer in self.scene_layers.values() {
            if !layer.visible {
                continue;
            }
            // A processed layer displays the effect texture, but its raw
            // video input still needs an advancing decoder. Retaining that
            // source prevents eviction; admitting it here prevents the live
            // pump from demoting it to a paused/prerolled session.
            for source_id in [layer.source_id.as_ref(), layer.effect_input_source_id.as_ref()]
                .into_iter().flatten()
            {
                if !active_sources.contains(source_id) {
                    active_sources.push(source_id.clone());
                }
            }
        }

        // Source-driven GPU shaders display their own graph output, so their
        // input video never appears as a scene layer's source_id. Admit that
        // input to the decode pump while the graph's layer is visible.
        // Otherwise still images work (they upload once), but video sources
        // remain permanently prerolled and the graph samples a frozen frame.
        for graph in self.native_graph_layers.values() {
            if graph.input_source_id.is_empty()
                || !self.scene_layers.get(&graph.layer_id).is_some_and(|layer| layer.visible)
            {
                continue;
            }
            if !active_sources.contains(&graph.input_source_id) {
                active_sources.push(graph.input_source_id.clone());
            }
        }

        // Pending bindings preserve the old visible source until this one is ready.
        // They must participate in decode admission or manual-clock first frames never arrive.
        for binding in self.pending_media_bindings.values() {
            if !active_sources.contains(&binding.source_id) { active_sources.push(binding.source_id.clone()); }
        }
        active_sources
    }

    /// Offline export takes the world clock: every playing video restarts
    /// from its launch point at virtual time 0, so frame N of an export
    /// always shows the clip at N/fps and two renders of the same project
    /// match. The live transport is stashed and handed back on exit.
    fn enter_manual_clock_media(&mut self) {
        self.manual_video_readers.clear();
        self.manual_clock_media_stash = Some(self.media_sources.clone());
        for state in self.media_sources.values_mut() {
            if state.source_type != "video" || state.paused { continue; }
            let duration = state.duration_seconds.filter(|duration| *duration > 0.0);
            state.playback_time_seconds = match duration {
                Some(duration) if state.playback_rate < 0.0 => duration * state.trim_end.clamp(0.0, 1.0),
                Some(duration) => duration * state.trim_start.clamp(0.0, 1.0),
                None => 0.0,
            };
            state.clock_time_seconds = 0.0;
        }
    }

    fn leave_manual_clock_media(&mut self) {
        // The render's decoders end with it.
        self.manual_video_readers.clear();
        let Some(stash) = self.manual_clock_media_stash.take() else { return; };
        for (source_id, state) in stash {
            if let Some(current) = self.media_sources.get_mut(&source_id)
                && current.uri == state.uri
            {
                *current = state;
            }
        }
    }

    /// Manual clock only: make every active video source hold the exact
    /// frame for this virtual time before a snapshot reads the composite.
    /// Decodes synchronously (each decode is bounded by the ffmpeg job's
    /// 10 s limit) and caches by exact timestamp, so the export waits for
    /// the right picture instead of capturing whatever the async pump last
    /// uploaded. A frame that cannot be decoded fails the export loudly.
    fn settle_manual_video_frames(&mut self, clock_seconds: Option<f64>) -> Result<u32, String> {
        if self.render_clock_mode != "manual" || self.renderer.is_none() { return Ok(0); }
        let clock = clock_seconds.unwrap_or_else(|| self.native_clock_seconds());
        let (width, height) = self.native_video_decode_dimensions();
        let mut settled = 0u32;
        self.manual_video_report.clear();
        for source_id in self.active_video_source_ids() {
            let Some(state) = self.media_sources.get(&source_id).cloned() else { continue; };
            if state.source_type != "video" || state.seq == 0 { continue; }
            let Some(path) = local_media_path_from_uri(&state.uri) else { continue; };
            let (decode_width, decode_height) =
                (state.decode_width.unwrap_or(width), state.decode_height.unwrap_or(height));
            // The frame live playback would show at this time: the last one
            // that started by then (floor), never the next one.
            let source_fps = self.video_source_fps_for(&path);
            let time_seconds = manual_video_frame_time(state.current_time_seconds(Some(clock)), source_fps);
            self.manual_video_report.push(manual_video_report_entry(&source_id, &state, clock, time_seconds, source_fps));
            let signature = manual_video_frame_signature(&path, decode_width, decode_height, time_seconds)?;
            if self.native_video_frame_signatures.get(&source_id) == Some(&signature)
                && self.source_frames.contains_key(&source_id)
            {
                continue;
            }
            let (frame_width, frame_height, rgba) = match self.cached_native_video_frame(&signature) {
                Some(frame) => frame,
                None => {
                    let frame = match self.read_manual_video_frame(&source_id, &path, decode_width, decode_height, time_seconds) {
                        Some(frame) => frame,
                        None => {
                            // ffmpeg's input seek returns the first frame at or after
                            // the requested time; back off a hair so float rounding
                            // of an exact frame boundary cannot skip to the next one.
                            let seek = (time_seconds - 1.0e-4).max(0.0);
                            self.stats.manual_video_decoder_starts = self.stats.manual_video_decoder_starts.saturating_add(1);
                            decode_native_video_frame_rgba(&path, decode_width, decode_height, seek)
                                .map_err(|err| format!("video frame at {time_seconds:.3}s could not be decoded for export: {err}"))?
                        }
                    };
                    self.stats.native_video_frame_decodes = self.stats.native_video_frame_decodes.saturating_add(1);
                    self.store_native_video_frame_cache(signature.clone(), frame.0, frame.1, &frame.2);
                    frame
                }
            };
            let seq = self.native_frame_index().max(
                self.source_frames.get(&source_id).map_or(1, |frame| frame.seq.saturating_add(1)),
            );
            let uploaded = self.upload_source_frame_pixels(
                source_id.clone(), seq, frame_width, frame_height, &rgba, "native-video-manual-clock", false,
            );
            self.stats.native_video_frame_decode_bytes_uploaded =
                self.stats.native_video_frame_decode_bytes_uploaded.saturating_add(uploaded as u64);
            self.native_video_frame_signatures.insert(source_id, signature);
            settled += 1;
        }
        // A video that stopped playing gives its decoder back.
        if !self.manual_video_readers.is_empty() {
            let active = self.active_video_source_ids();
            self.manual_video_readers.retain(|id, _| active.contains(id));
        }
        Ok(settled)
    }

    /// The frame at `time_seconds` from this source's long-running decoder
    /// (started, or started again at this time, when it cannot get there by
    /// reading on). None: fall back to a one-frame decode (the reader could
    /// not start, or the file ended before this time).
    fn read_manual_video_frame(
        &mut self,
        source_id: &str,
        path: &Path,
        width: usize,
        height: usize,
        time_seconds: f64,
    ) -> Option<(usize, usize, Vec<u8>)> {
        const MAX_READERS: usize = 8;
        let reusable = self
            .manual_video_readers
            .get(source_id)
            .is_some_and(|reader| reader.matches(path, width, height) && reader.can_reach(time_seconds));
        if !reusable {
            self.manual_video_readers.remove(source_id);
            if self.manual_video_readers.len() >= MAX_READERS {
                let victim = self.manual_video_readers.keys().next().cloned();
                if let Some(victim) = victim { self.manual_video_readers.remove(&victim); }
            }
            let seek = (time_seconds - 1.0e-4).max(0.0);
            self.stats.manual_video_decoder_starts = self.stats.manual_video_decoder_starts.saturating_add(1);
            match media_decode::SequentialVideoReader::open(path, width, height, seek) {
                Ok(reader) => { self.manual_video_readers.insert(source_id.to_string(), reader); }
                Err(err) => {
                    self.stats.native_video_frame_decode_last_error = err;
                    return None;
                }
            }
        }
        let reader = self.manual_video_readers.get_mut(source_id)?;
        match reader.frame_at(time_seconds) {
            Ok(Some(frame)) => Some(frame),
            Ok(None) => { self.manual_video_readers.remove(source_id); None }
            Err(err) => {
                self.stats.native_video_frame_decode_last_error = err;
                self.manual_video_readers.remove(source_id);
                None
            }
        }
    }

    fn video_source_fps_for(&mut self, path: &Path) -> Option<f64> {
        if let Some(fps) = self.video_source_fps.get(path) {
            return *fps;
        }
        let fps = media_decode::probe_video_source_fps(path);
        if self.video_source_fps.len() >= 256 {
            self.video_source_fps.clear();
        }
        self.video_source_fps.insert(path.to_path_buf(), fps);
        fps
    }

    fn pump_native_video_decodes(&mut self) {
        if self.renderer.is_none() {
            return;
        }
        self.reclaim_hardware_video_memory();
        // An armed session is not ready until its first real frame is resident
        // in the GPU source texture. Keep at least the minimum pre-roll behind
        // it so triggering can immediately drain motion frames.
        self.prime_armed_native_video_sources();
        let (width, height) = self.native_video_decode_dimensions();
        let active_sources = self.active_video_source_ids();
        if self.render_clock_mode == "live" {
            let visible_sources = active_sources.iter().cloned().collect::<HashSet<_>>();
            let source_ids = self.media_sources.keys().cloned().collect::<Vec<_>>();
            for source_id in source_ids {
                let Some(state) = self.media_sources.get(&source_id).cloned() else {
                    continue;
                };
                if state.source_type == "video" && state.seq > 0 {
                    // Splat textures are owned auxiliary sources, not scene-layer bindings.
                    // Their owner explicitly releases them when the texture changes.
                    let playing = (visible_sources.contains(&source_id)
                        || source_id.starts_with("native-splat-video-")) && !state.paused;
                    // The slice's own size is applied inside, to every caller alike.
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
        let time_seconds = state.current_time_seconds(Some(self.native_clock_seconds()));
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
        if self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT { return; }
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
        if self.native_video_frame_signatures.get(source_id) == Some(&signature) && self.source_frames.contains_key(source_id) { return; }
        if self.native_video_decode_failed.contains(&signature) { return; }
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
                                state.current_time_seconds(Some(self.native_clock_seconds())),
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
        for pending_source in self.native_video_scrub_requests.keys().cloned().collect::<Vec<_>>() {
            if self.native_video_decode_pending.len() >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT { break; }
            self.start_latest_native_video_scrub(&pending_source);
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
        let slot = match self.assign_source_frame_slot(&source_id) {
            Ok(slot) => slot,
            Err(error) => { self.reject_source_frame_upload(width, height, transport, &error); return 0; }
        };
        if let Some(renderer) = &self.renderer { renderer.hap_converter.release(slot); }
        let dst_size = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.source_frame_size)
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT);
        let is_native_video = transport.starts_with("native-video");
        // Rect placement only applies when the frame fits the slot as sent;
        // a larger frame still has to be resampled down or it would clip.
        let is_rect_placement =
            transport.ends_with("-rect") && width <= dst_size && height <= dst_size;
        let per_source = self.renderer.as_ref()
            .is_some_and(|renderer| renderer.slots.mode() == SourceFrameMode::PerSource);
        let (uploaded_bytes, source_rect) = if per_source {
            // Each slot is its own texture: the picture keeps its size (up to
            // the per-source limit) and fills the slot.
            let renderer = self.renderer.as_ref().expect("per-source renderer");
            let (fit_width, fit_height) = renderer.slots.fitted_size(width as u32, height as u32);
            let (fit_width, fit_height) = (fit_width as usize, fit_height as usize);
            let resampled;
            let pixels = if (fit_width, fit_height) == (width, height) {
                rgba
            } else {
                resampled = resample_frame_bytes(rgba, width, height, fit_width, fit_height);
                resampled.as_slice()
            };
            let uploaded = renderer
                .write_slot_pixels(slot, pixels, fit_width, fit_height, !is_native_video)
                .unwrap_or(0);
            (uploaded, [0.0, 0.0, 1.0, 1.0])
        } else if is_native_video || is_rect_placement {
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
            .saturating_add(if per_source || is_native_video || is_rect_placement {
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
        let Some(mut rgba) = rgba_bytes_from_command(command, width, height) else {
            self.reject_source_frame_upload(
                width,
                height,
                transport.as_str(),
                "missing or invalid source-frame pixel payload",
            );
            return;
        };
        // Pages captured offscreen (three.js / p5 sources) arrive in the
        // compositor's BGRA order. Swap here: doing it in the Electron main
        // process would be a per-frame JS loop over megabytes, on the thread
        // that answers every editor IPC call.
        // Offscreen pages also arrive premultiplied (Chromium paints that
        // way); the compositor expects straight alpha, so a transparent
        // page's soft edges and glows would come out too dark. Opaque
        // pixels (alpha 255) are left as they are.
        let bgra = string_at(command, &["pixel_format"]).as_deref() == Some("bgra");
        let premultiplied = command.get("premultiplied").and_then(Value::as_bool).unwrap_or(false);
        if bgra || premultiplied {
            for pixel in rgba.chunks_exact_mut(4) {
                if bgra {
                    pixel.swap(0, 2);
                }
                if premultiplied {
                    let alpha = pixel[3] as u32;
                    if alpha > 0 && alpha < 255 {
                        for channel in &mut pixel[..3] {
                            *channel = ((*channel as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
                        }
                    }
                }
            }
        }
        // `placement: "rect"` writes the frame into its slot as sent, the way
        // decoded video is, instead of resampling it to the square slot and
        // rebuilding the mip chain. Continuous sources need this: the
        // resample runs on the render thread and grows with frame size.
        let rect_transport;
        let transport_label = if string_at(command, &["placement"]).as_deref() == Some("rect") {
            rect_transport = format!("{}-rect", transport.as_str());
            rect_transport.as_str()
        } else {
            transport.as_str()
        };
        self.upload_source_frame_pixels(
            source_id,
            seq,
            width,
            height,
            &rgba,
            transport_label,
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

        let slot = match self.assign_source_frame_slot(&source_id) {
            Ok(slot) => slot,
            Err(error) => { self.reject_shared_texture_source_frame(width, height, &error); return; }
        };
        let renderer = self
            .renderer
            .as_ref()
            .expect("renderer checked before shared texture import");
        let uploaded_bytes = match renderer.import_shared_texture_source_frame(slot, &descriptor) {
            Ok(uploaded_bytes) => uploaded_bytes,
            Err(err) => {
                self.release_source_frame_slot(&source_id);
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

    /// A slot handed to a new source still holds its previous owner's last
    /// image. Graph sources count as having a frame the moment their job is
    /// queued, and while a cold pipeline warms the compositor samples the slot
    /// anyway, so a deleted Lines layer showed through a new Light Painting
    /// layer for several frames. Every new assignment starts transparent.
    fn clear_new_source_frame_slot(&self, slot: usize) {
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.clear_source_frame_slot(slot);
        }
    }

    fn ensure_empty_source_frame_slot(&mut self) -> usize {
        // Slot zero is reserved at App construction and never released.
        let slot = self.source_frame_slots[EMPTY_SOURCE_FRAME_ID];
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

    fn assign_source_frame_slot(&mut self, source_id: &str) -> Result<usize, String> {
        if let Some(slot) = self.source_frame_slots.get(source_id).copied() {
            return Ok(slot);
        }
        if let Some(slot) = self.unused_source_frame_slot() {
            self.source_frame_slots.insert(source_id.to_string(), slot);
            self.clear_new_source_frame_slot(slot);
            return Ok(slot);
        }

        // All slots occupied: evict an occupant nothing references anymore.
        // Live sources and explicit transition snapshots are never displaced.
        // A caller that cannot acquire a slot must retain its prior picture.
        if let Some((old_source_id, slot)) = self
            .source_frame_slots
            .iter()
            .filter(|(id, _)| id.as_str() != source_id && !is_clip_snapshot_source_id(id) && !self.media_source_is_referenced(id))
            .min_by_key(|(_, slot)| **slot)
            .map(|(id, slot)| (id.clone(), *slot))
        {
            self.release_source_frame_slot(&old_source_id);
            self.source_frames.remove(&old_source_id);
            self.source_frame_signatures.remove(&old_source_id);
            self.native_video_frame_signatures.remove(&old_source_id);
            self.source_frame_slots.insert(source_id.to_string(), slot);
            self.clear_new_source_frame_slot(slot);
            return Ok(slot);
        }

        // Nothing to evict: add slots.
        if let Some(slot) = self.free_source_frame_slot() {
            self.source_frame_slots.insert(source_id.to_string(), slot);
            self.clear_new_source_frame_slot(slot);
            return Ok(slot);
        }

        Err(format!("GPU source-frame capacity reached ({} slots); retaining existing live pictures",
            self.source_frame_capacity()))
    }

    fn source_frame_capacity(&self) -> usize {
        self.renderer.as_ref().map(|renderer| renderer.slots.capacity()).unwrap_or(INITIAL_SOURCE_FRAME_SLOTS)
    }

    /// The lowest slot no source holds, within the current capacity.
    fn unused_source_frame_slot(&self) -> Option<usize> {
        let used: HashSet<usize> = self.source_frame_slots.values().copied().collect();
        (0..self.source_frame_capacity()).find(|slot| !used.contains(slot))
    }

    /// An unused slot, growing the store when every slot is taken.
    fn free_source_frame_slot(&mut self) -> Option<usize> {
        if let Some(slot) = self.unused_source_frame_slot() {
            return Some(slot);
        }
        let next = self.source_frame_capacity();
        let renderer = self.renderer.as_ref()?;
        renderer.ensure_slot_capacity(next).then_some(next)
    }

    fn apply_remove_layer(&mut self, command: &Value) {
        if let Some(layer_id) = string_at(command, &["layer_id"]) {
            self.scheduled_binding_guards.remove(&layer_id);
            self.captured_graph_holds.remove(&layer_id);
            self.paint_masks.remove_layer(&layer_id);
            let (removed_source, removed_shader_output, removed_effect_input, removed_held) = self
                .scene_layers
                .remove(&layer_id)
                .map(|layer| (layer.source_id, layer.shader_source_id, layer.effect_input_source_id,
                    layer.held.map(|held| held.source_id)))
                .unwrap_or((None, None, None, None));
            let pending_source = self
                .pending_media_bindings
                .remove(&layer_id)
                .map(|binding| binding.source_id);
            self.isf_layer_bindings.remove(&layer_id);
            let graph_sources = self.release_native_graph_layer_state(&layer_id);
            self.native_point_cloud_assets.remove(&layer_id);
            let effect_output_id = format!("effect-pass:{layer_id}");
            let effect_prefix = format!("{effect_output_id}:");
            let gpu_prefix = format!("gpu:{layer_id}:");
            let plugin_prefix = format!("plugin:{layer_id}:");
            let owned_by_removed_layer = |id: &str| {
                id == effect_output_id || id.starts_with(&effect_prefix)
                    || id.starts_with(&gpu_prefix) || id.starts_with(&plugin_prefix)
            };
            // Externally queued effect chains have no NativeGraphLayer entry.
            // A still-pending chain otherwise keeps both its old media input
            // and output slots referenced after the layer has been deleted.
            self.pending_native_graph_jobs.retain(|job| {
                !job.render_plans.iter().any(|plan| match &plan.target {
                    NativeComputeGraphRenderTarget::SourceFrame { source_id, .. } =>
                        owned_by_removed_layer(source_id),
                    _ => false,
                })
            });
            if let Some(source_id) = removed_source {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = removed_effect_input {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = removed_shader_output {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = removed_held {
                self.release_media_source_if_orphaned(&source_id);
            }
            if let Some(source_id) = pending_source {
                self.release_media_source_if_orphaned(&source_id);
            }
            // A GPU instrument's own instrument/input source frames are not
            // the layer's composite binding, so they survive the two calls
            // above. Left resident they are still sampleable by anything
            // that binds `layer-frame:<id>` (VJ crossfade/mix rows, ISF
            // image inputs) after the layer is gone.
            for source_id in graph_sources {
                self.release_media_source_if_orphaned(&source_id);
            }
            let owned_slots = self.source_frame_slots.keys()
                .filter(|id| owned_by_removed_layer(id))
                .cloned().collect::<Vec<_>>();
            for source_id in owned_slots {
                self.release_media_source_if_orphaned(&source_id);
            }
            // Removing a layer changes what the output should show, and this
            // may have been the last one. Arm a frame so the composite,
            // export texture, slices and swapchain are all repainted even if
            // the host never sends another present.
            self.pending_render_retry = true;
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
            .map(|layer| self.with_source_mips(layer, self.with_paint_mask(layer, layer.gpu())))
            .collect()
    }

    /// fast_flags.w bit 2: the layer's picture slot has a current mip chain,
    /// so the compositor reads minified pixels from the level they need
    /// (heartbeat.wgsl layer_source_lod). Never for live video, whose slot
    /// holds level zero only. Without GA_CORE_SOURCE_MIPS=1 every read stays at
    /// level zero. Only for a layer that can show its picture minified
    /// (`layer_may_minify`): the per-pixel level costs time, and a picture
    /// drawn at or above its size reads level zero anyway.
    fn with_source_mips(&self, layer: &SceneLayer, mut gpu: LayerGpu) -> LayerGpu {
        let code = gpu.meta[3];
        let live_video = gpu.meta[2] > 2.5 && gpu.meta[2] < 3.5;
        if !source_mips_enabled() || live_video || code < SOURCE_FRAME_SLOT_OFFSET + 1.0 {
            return gpu;
        }
        let Some(renderer) = self.renderer.as_ref() else { return gpu };
        let slot = (code - SOURCE_FRAME_SLOT_OFFSET - 1.0).floor().max(0.0) as usize;
        if !renderer.slots.mips_current(slot) {
            return gpu;
        }
        let stored = renderer.slots.slot(slot);
        let texels = [stored.width as f32 * gpu.source_rect[2], stored.height as f32 * gpu.source_rect[3]];
        if layer_may_minify(layer, texels, [renderer.config.width as f32, renderer.config.height as f32]) {
            gpu.fast_flags[3] |= 4;
        }
        gpu
    }

    /// Point a layer at its painted mask: fast_flags.z = texture array
    /// slot + 1 (0 = none), fast_flags.w bit 0 = inverted. A painted layer
    /// is never a plain rectangle fill.
    fn with_paint_mask(&self, layer: &SceneLayer, mut gpu: LayerGpu) -> LayerGpu {
        let (slot, flags) = self.paint_masks.gpu_flags(&layer.id);
        if slot != 0 {
            gpu.fast_flags[0] = 0;
            gpu.fast_flags[2] = slot;
            gpu.fast_flags[3] = flags | (gpu.fast_flags[3] & 2);
        }
        gpu
    }

    /// Bring the GPU paint-mask texture up to date: resolution for the
    /// current output, enough array layers, and the texels that changed.
    fn sync_paint_masks_to_gpu(&mut self) {
        let Some(renderer) = self.renderer.as_mut() else { return };
        let want = paint_mask::paint_mask_size_for_output(renderer.config.width, renderer.config.height);
        self.paint_masks.set_size(want);
        let needed = self.paint_masks.slots_needed();
        if needed == 0 {
            return;
        }
        if renderer.ensure_paint_mask_capacity(self.paint_masks.size(), needed) {
            self.paint_masks.mark_all_dirty();
        }
        for upload in self.paint_masks.drain_uploads() {
            renderer.write_paint_mask(&upload);
        }
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
                self.with_source_mips(layer, self.with_paint_mask(layer, monitor_layer.gpu()))
            })
            .collect()
    }

    /// Layer list for the recording target. A layer or VJ row renders on its
    /// own, pre-composite and pre-fader: its blend mode and opacity say how it
    /// meets the layers below, and there are none here, so it records as
    /// Normal at full opacity (hierarchy masks keep their code — they clip
    /// the recorded layers under them). Pre-fader matters for VJ rows: in MIX
    /// the row's carrier layer sits at opacity 0 and the VJ Mix graph applies
    /// the row fader, so a post-fader take of a row would always be empty.
    fn record_target_layer_data(&self, spec: &RecordTargetSpec) -> Vec<LayerGpu> {
        if spec.source == RecordTargetSource::Composition {
            return self.gpu_layer_data();
        }
        let mut layers: Vec<&SceneLayer> = self
            .scene_layers
            .values()
            .filter(|layer| spec.includes(layer))
            .collect();
        layers.sort_by(|a, b| b.z_index.cmp(&a.z_index).then_with(|| a.id.cmp(&b.id)));
        layers
            .into_iter()
            .take(MAX_SCENE_LAYERS)
            .map(|layer| {
                let mut solo = layer.clone();
                solo.opacity = 1.0;
                let mut gpu = solo.gpu();
                if gpu.style[0] != blend_mode_code("hierarchy-mask") {
                    gpu.style[0] = blend_mode_code("normal");
                }
                gpu
            })
            .collect()
    }

    fn apply_record_target(&mut self, params: &Value) -> Result<Value, String> {
        let spec = parse_record_target(params)?;
        if spec.is_some() && !cfg!(any(target_os = "macos", target_os = "windows")) {
            return Err("recording a single source needs the macOS or Windows shared-texture path".to_string());
        }
        self.record_target = spec;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if self.record_target.is_none() {
            // Release the target's VRAM as soon as the recording ends.
            if let Some(renderer) = self.renderer.as_mut() {
                renderer.record_target = None;
            }
        }
        self.pending_render_retry = true;
        Ok(self.record_target_state())
    }

    fn record_target_state(&self) -> Value {
        let mut state = self
            .renderer
            .as_ref()
            .map(RenderState::record_target_metadata)
            .unwrap_or_else(|| json!({ "available": false }));
        if let Some(spec) = self.record_target.as_ref() {
            state["kind"] = json!(spec.kind());
            state["alpha"] = json!(spec.alpha);
            state["layer_count"] = json!(self.scene_layers.values().filter(|layer| spec.includes(layer)).count());
        } else {
            state["kind"] = json!("none");
        }
        state
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
            UserEvent::OwnerDisconnected => {
                self.running = false;
                self.clip_audio = None;
                event_loop.exit();
            }
            UserEvent::Rpc(req) => {
                self.handle_rpc(event_loop, req);
                // winit calls about_to_wait, where frames and video advance,
                // only once its queue is empty. On a slow machine the editor's
                // steady RPCs kept it busy, and a playing clip froze on its
                // first frame. Turn the frame clock between RPCs too.
                if self.running && self.last_frame_service.elapsed() >= self.frame_duration() {
                    if self.output_window_attached {
                        // The window is drawn just below; only media here.
                        self.pump_frame_media();
                    } else {
                        let _ = self.service_frame();
                    }
                }
                // A stream of RPCs must not indefinitely postpone the window redraw event.
                // Service output between bounded transactions, after all their mutations.
                // Paced by the display, the refreshes interleave with the
                // RPCs and draw the frames themselves.
                if self.running && self.display_paced() && self.paced_frame_ready(Instant::now()) {
                    self.draw_paced_frame(Instant::now());
                }
                if self.running && self.output_window_attached && !self.display_paced()
                    && self.last_submission_at.is_none_or(|last| last.elapsed() >= self.frame_duration()) {
                    self.render();
                }
            }
            UserEvent::NativeImageDecoded(source_id, signature, result) => {
                self.finish_image_decode(&source_id, signature, result);
                self.pending_render_retry = true;
                self.render();
            }
            UserEvent::VideoPrefetched(result) => self.finish_timed_video_prefetch(result),
            UserEvent::NativeVideoFrameDecoded(result) => {
                self.apply_native_video_decode_result(result)
            }
            UserEvent::DisplayRefresh => self.on_display_refresh(),
            UserEvent::RepublishRpcSnapshot => {
                self.fast_path.release_republish();
                self.refresh_rpc_snapshot();
            }
            UserEvent::GpuFrameFailed(error) => {
                self.running = false;
                self.pending_render_retry = false;
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.gpu_fault = true;
                    renderer.last_frame_error = Some(error.clone());
                }
                self.stats.swapchain_last_present_error = error;
                self.stats.swapchain_last_present_result = "gpu-fault".to_string();
                self.publish_rpc_snapshot();
            }
            UserEvent::GpuFrameCompleted => {
                self.sync_gpu_frame_stats();
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.drain_native_recording();
                    renderer.drain_texture_share();
                }
                if !self.running {
                    return;
                }
                if self.display_paced() {
                    // The next refresh draws the next frame. A frame skipped
                    // because the GPU was still busy is drawn now, before
                    // that refresh, so it is not lost.
                    if self.pending_render_retry {
                        self.drive_frame(Instant::now());
                    }
                    return;
                }
                let frame_duration = self.frame_duration();
                let next_frame_at = self.last_redraw + frame_duration;
                let now = Instant::now();
                if let Some(scheduled) = completed_gpu_frame_schedule(self.last_redraw, now, frame_duration, self.pending_render_retry) {
                    self.drive_frame(now);
                    self.last_redraw = scheduled;
                    event_loop.set_control_flow(ControlFlow::WaitUntil(self.last_redraw + frame_duration));
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
        // With the Output Window attached, its frame renders here
        // (RedrawRequested): one pool per frame, like about_to_wait.
        let _pool = autorelease_pool::IterationPool::new();
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
                self.output_window_placement =
                    detach_managed_output_window(&renderer.window, &self.output_window_placement);
                self.stats.swapchain_last_present_result = "detached".to_string();
                self.stats.swapchain_last_present_error.clear();
                event_loop.set_control_flow(ControlFlow::Wait);
            }
            WindowEvent::KeyboardInput { event, .. }
                if event.state == ElementState::Pressed
                    && matches!(&event.logical_key, Key::Named(NamedKey::Escape)) =>
            {
                self.output_window_attached = false;
                self.output_window_placement =
                    detach_managed_output_window(&renderer.window, &self.output_window_placement);
                self.stats.swapchain_last_present_result = "detached".to_string();
                self.stats.swapchain_last_present_error.clear();
                event_loop.set_control_flow(ControlFlow::Wait);
            }
            WindowEvent::Resized(size) => {
                // See output_size_configured: a fullscreen output keeps the
                // project's composite and the window scales it.
                if !(self.output_size_configured && self.output_window_fullscreen) {
                    renderer.resize(size);
                    self.pending_width = renderer.config.width;
                    self.pending_height = renderer.config.height;
                }
            }
            WindowEvent::RedrawRequested => {
                self.redraw_requested_at = None;
                self.render();
            }
            // On another display now, possibly at another refresh rate. A
            // move within the same display keeps the rate already read.
            WindowEvent::Moved(_) => {
                let monitor = renderer.window.current_monitor();
                if monitor != self.output_refresh_monitor {
                    self.output_refresh_hz = monitor.as_ref().and_then(monitor_refresh_hz);
                    self.output_refresh_monitor = monitor;
                    self.sync_display_clock();
                }
            }
            WindowEvent::ScaleFactorChanged { .. } => {
                let monitor = renderer.window.current_monitor();
                self.output_refresh_hz = monitor.as_ref().and_then(monitor_refresh_hz);
                self.output_refresh_monitor = monitor;
                self.sync_display_clock();
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        // A frame's autoreleased Metal objects go when the frame is done, not
        // whenever the run loop next drains.
        let _pool = autorelease_pool::IterationPool::new();
        let now = Instant::now();
        let mut expired = Vec::new();
        self.image_prefetch_waiters.retain(|_, waiters| {
            waiters.retain(|(id, deadline)| { if *deadline <= now { expired.push(*id); false } else { true } });
            !waiters.is_empty()
        });
        for id in expired { self.send_error(id, "image prefetch timed out".to_string()); }
        let idle_flow = if self.image_prefetch_waiters.is_empty() { ControlFlow::Wait }
            else { ControlFlow::WaitUntil(now + Duration::from_millis(100)) };
        if !self.running {
            event_loop.set_control_flow(idle_flow);
            return;
        }

        match self.service_frame() {
            Some(wake_at) => event_loop.set_control_flow(ControlFlow::WaitUntil(wake_at)),
            None => event_loop.set_control_flow(idle_flow),
        }
    }
}

impl App {
    /// Scheduled launches and video sessions advance with the frame clock.
    fn pump_frame_media(&mut self) {
        self.last_frame_service = Instant::now();
        self.pump_scheduled_launches();
        let pump_started = Instant::now();
        self.pump_native_video_decodes();
        self.media_pump_ms = pump_started.elapsed().as_secs_f64() * 1000.0;
    }

    /// One turn of the frame clock: media, then the frame when it is due.
    /// Returns when the next frame is due, or None when nothing is scheduled.
    fn service_frame(&mut self) -> Option<Instant> {
        let frame_duration = self.frame_duration();
        self.pump_frame_media();
        if !self.frames_scheduled() {
            return None;
        }
        if self.display_paced() {
            // The refreshes draw the frames; wake for a frame starting a
            // little after its refresh, or to fall back to the timer if the
            // refreshes stop.
            let now = Instant::now();
            if self.paced_frame_ready(now) {
                self.draw_paced_frame(now);
            }
            let stall = self.display_clock.as_ref().map(|clock| clock.stall_deadline(now));
            return match (self.paced_frame_at, stall) {
                (Some(at), Some(stall)) => Some(at.min(stall)),
                (at, stall) => at.or(stall),
            };
        }
        let next_frame_at = self.last_redraw + frame_duration;
        let now = Instant::now();
        if now >= next_frame_at {
            self.drive_frame(now);
            self.last_redraw = scheduled_frame_start(next_frame_at, now, frame_duration);
            Some(self.last_redraw + frame_duration)
        } else {
            Some(next_frame_at)
        }
    }
}

impl RenderState {

    /// Full-resolution ping-pong target for composition FX.
    ///
    /// Deliberately NOT part of the source-frame array: that array is square
    /// and quality-tier sized (1024-3072), so pushing a 1920x1080 composite
    /// through it would resample every pixel on screen the moment a
    /// composition effect was switched on. This matches the swapchain's size
    /// and format instead, so the composite goes in and comes back untouched
    /// apart from the effects themselves.
    fn create_composite_frame_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Composite Frame"),
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
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
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

    /// A global BGRA IOSurface imported into wgpu as a texture.
    #[cfg(target_os = "macos")]
    fn create_iosurface_texture(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        label: &str,
        usage: wgpu::TextureUsages,
        initial_use: wgpu::TextureUses,
    ) -> Result<(objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>, wgpu::Texture), String> {
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
            format!("IOSurfaceCreate failed for {label} {width}x{height}")
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
                format!("Metal failed to create {label} texture {width}x{height}")
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
                    label: Some(label),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                },
                initial_use,
            )
        };
        Ok((surface, texture))
    }

    #[cfg(target_os = "macos")]
    fn create_output_export_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Result<NativeOutputExport, String> {
        let (surface, texture) = Self::create_iosurface_texture(
            device,
            width,
            height,
            format,
            "Ghost Render Core Output IOSurface Export",
            wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            wgpu::TextureUses::COLOR_TARGET,
        )?;
        let width = width.max(1);
        let height = height.max(1);
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

    /// Start encoding the composite in-core, straight off the output shared
    /// texture. No readback: the recorder opens the same surface the preview
    /// and Spout already read.
    #[cfg(target_os = "windows")]
    fn start_native_recording(
        &mut self,
        path: &std::path::Path,
        fps: u32,
        quality: &str,
    ) -> Result<(u32, u32), String> {
        if self.native_recorder.is_some() {
            return Err("a native recording is already running".into());
        }
        let export = self
            .output_export
            .as_ref()
            .ok_or_else(|| "native recording needs the output shared texture".to_string())?;
        let (width, height) = (export.width, export.height);
        // The encoder needs a D3D11 device on the renderer's own adapter, or
        // Media Foundation picks a software transform and the whole point is
        // lost. WindowsVideoDevice already builds exactly that.
        let worker_device = windows_video_texture::WindowsVideoDevice::new(&self.device)?;
        let worker = worker_device.create_worker()?;
        let encoder = windows_video_encoder::WindowsVideoEncoder::new(
            worker.device(),
            &self.device,
            path,
            width,
            height,
            fps,
            quality,
        )?;
        self.native_recorder = Some(encoder);
        self.native_recorder_error = None;
        Ok((width, height))
    }

    #[cfg(target_os = "windows")]
    fn encode_native_recording_frame(&mut self) {
        let Some(shared_name) = self
            .output_export
            .as_ref()
            .map(|export| export.shared_name.clone())
        else {
            return;
        };
        let Some(recorder) = self.native_recorder.as_mut() else {
            return;
        };
        if let Err(err) = recorder.encode_shared_texture(&shared_name) {
            // Keep rendering: a recording that fails must not take the show
            // down. Stop the session and report it through status.
            self.native_recorder_error = Some(err);
            self.native_recorder = None;
        }
    }

    /// Finalize the MP4 and report how many frames it holds.
    #[cfg(target_os = "windows")]
    fn stop_native_recording(&mut self) -> Result<(u64, f64), String> {
        let mut recorder = self
            .native_recorder
            .take()
            .ok_or_else(|| "no native recording is running".to_string())?;
        // The encoder thread writes what is still queued before finalizing,
        // so the count is only final afterwards.
        recorder.finish()?;
        Ok((recorder.frames_encoded(), recorder.duration_seconds()))
    }

    #[cfg(target_os = "macos")]
    fn start_native_recording(
        &mut self,
        path: &std::path::Path,
        fps: u32,
        quality: &str,
    ) -> Result<(u32, u32), String> {
        if self.native_recorder.is_some() {
            return Err("a native recording is already running".into());
        }
        let export = self
            .output_export
            .as_ref()
            .ok_or_else(|| "native recording needs the output shared texture".to_string())?;
        let (width, height, format) = (export.width, export.height, export.format);
        // A few surfaces so the encoder can still be reading one frame while
        // the GPU fills the next; a frame finding none free is dropped.
        const CAPTURE_SURFACES: usize = 4;
        let slots = (0..CAPTURE_SURFACES)
            .map(|_| {
                Self::create_iosurface_texture(
                    &self.device,
                    width,
                    height,
                    format,
                    "Ghost Render Core Recording Capture",
                    wgpu::TextureUsages::COPY_DST,
                    wgpu::TextureUses::COPY_DST,
                )
                .map(|(surface, texture)| mac_video_recorder::CaptureSlot { surface, texture })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let recorder =
            mac_video_recorder::MacVideoRecorder::new(path, width, height, fps, quality, slots)?;
        self.native_recorder = Some(recorder);
        self.native_recorder_error = None;
        Ok((width, height))
    }

    /// Inside the frame's encoder, after the export has been written: copy
    /// the composite into a capture surface the encoder will own.
    #[cfg(target_os = "macos")]
    fn capture_native_recording_frame(&mut self, encoder: &mut wgpu::CommandEncoder) {
        let (Some(recorder), Some(export)) =
            (self.native_recorder.as_mut(), self.output_export.as_ref())
        else {
            return;
        };
        recorder.capture(encoder, &export.texture, export.width, export.height);
    }

    #[cfg(target_os = "macos")]
    fn encode_native_recording_frame(&mut self) {
        if let Some(recorder) = self.native_recorder.as_mut() {
            recorder.submitted(&self.queue);
        }
        self.drain_native_recording();
    }

    /// Append captures whose GPU work has completed. Runs after each frame
    /// and when a GPU completion arrives, so a take does not wait for the
    /// next render when the scene goes static.
    #[cfg(target_os = "macos")]
    fn drain_native_recording(&mut self) {
        let Some(recorder) = self.native_recorder.as_mut() else {
            return;
        };
        if let Err(err) = recorder.drain_completed() {
            // Keep rendering: a failed recording must not take the show down.
            self.native_recorder_error = Some(err);
            self.native_recorder = None;
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn drain_native_recording(&mut self) {}

    #[cfg(target_os = "macos")]
    fn stop_native_recording(&mut self) -> Result<(u64, f64), String> {
        if self.native_recorder.as_ref().is_some_and(|r| r.has_pending()) {
            // The last captures belong in the take: let the GPU finish them.
            let _ = self.device.poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(Duration::from_secs(2)),
            });
            self.drain_native_recording();
        }
        let mut recorder = self
            .native_recorder
            .take()
            .ok_or_else(|| "no native recording is running".to_string())?;
        let frames = recorder.frames_encoded();
        let duration = recorder.duration_seconds();
        recorder.finish()?;
        Ok((frames, duration))
    }

    #[cfg(target_os = "macos")]
    fn native_recording_state(&self) -> Value {
        json!({
            "available": true,
            "active": self.native_recorder.is_some(),
            "frames": self.native_recorder.as_ref().map(|r| r.frames_encoded()).unwrap_or(0),
            "transport": "iosurface",
            "encoder": "videotoolbox-h264",
            "last_error": self.native_recorder_error.clone(),
        })
    }

    #[cfg(target_os = "windows")]
    fn native_recording_state(&self) -> Value {
        json!({
            "available": true,
            "active": self.native_recorder.is_some(),
            "frames": self.native_recorder.as_ref().map(|r| r.frames_encoded()).unwrap_or(0),
            "transport": "d3d11-shared-texture",
            "encoder": "media-foundation-h264",
            // Frames skipped because the encoder still held every texture,
            // and what recording costs the render thread per frame.
            "dropped": self.native_recorder.as_ref().map(|r| r.frames_dropped()).unwrap_or(0),
            "render_thread_us": self.native_recorder.as_ref().map(|r| {
                let (mean, max) = r.render_thread_us();
                json!({ "mean": mean, "max": max })
            }),
            "last_error": self.native_recorder_error.clone(),
        })
    }

    /// Lazily (re)create the two deck-monitor targets. Returns false when a
    /// shared-texture export cannot be made where the platform has one
    /// (monitor presentation is then simply unavailable — never an error
    /// path for the main render).
    fn ensure_deck_monitor_targets(&mut self, width: u32, height: u32) -> bool {
        let width = width.clamp(16, 1024);
        let height = height.clamp(16, 1024);
        if let Some(targets) = self.deck_monitor_targets.as_ref() {
            if targets[0].width == width && targets[0].height == height {
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
            #[cfg(any(target_os = "macos", target_os = "windows"))]
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
                render_texture,
                render_view,
                width,
                height,
                #[cfg(any(target_os = "macos", target_os = "windows"))]
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
    /// source frames the program mix uses (no extra source render or decode)
    /// and, where there is one, blits into the bank's shared-texture export.
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
            let key = DECK_MONITOR_VIEWS[index];
            self.write_view_inputs(
                key,
                true,
                command_phase,
                layers.len() as u32,
                time_seconds,
                frame_count,
                layers,
                audio0,
                audio1,
                audio2,
                // Deck monitors are cue displays, never the live output:
                // blackout must not blank them.
                1.0,
                &[],
                OutputStage::default(),
            );
            let mut encoder = self.take_outputs_encoder();
            if let Some(target) = self.deck_monitor_targets.as_ref().map(|targets| &targets[index]) {
                self.draw_composite_view(
                    &mut encoder,
                    key,
                    &target.render_view,
                    "Ghost Deck Monitor Pass",
                );
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                target.export.blitter.copy(
                    &self.device,
                    &mut encoder,
                    &target.render_view,
                    &target.export.view,
                );
            }
            self.outputs_encoder = Some(encoder);
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(targets) = self.deck_monitor_targets.as_mut() {
            for target in targets.iter_mut() {
                target.export.frame = target.export.frame.saturating_add(1);
            }
        }
        true
    }

    /// Queue a readback of one deck monitor (0 = bank A, 1 = bank B) for a
    /// panel that cannot import its shared texture. Returns as soon as the
    /// copy is queued; `finish()` waits for it. `None` until the monitors
    /// have been drawn once.
    fn prepare_deck_monitor_readback(&self, bank: usize) -> Result<Option<PendingFrameReadback>, String> {
        let target = if bank == 2 {
            self.dome_view_target.as_ref()
        } else {
            self.deck_monitor_targets.as_ref().and_then(|targets| targets.get(bank))
        };
        let Some(target) = target else {
            return Ok(None);
        };
        prepare_texture_readback(&self.device, &self.queue, &target.render_texture,
            self.config.format, target.width, target.height, "Ghost Deck Monitor Preview").map(Some)
    }

    /// Create (or resize) the recording target and its shared-texture export.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn ensure_record_target(&mut self, width: u32, height: u32, alpha: bool) -> bool {
        if let Some(existing) = self.record_target.as_mut() {
            if existing.export.width == width && existing.export.height == height {
                existing.alpha = alpha;
                return true;
            }
        }
        let (render_texture, render_view) = Self::create_offscreen_target(
            &self.device,
            width,
            height,
            self.config.format,
            "Ghost Record Target Render Target",
        );
        let export = match Self::create_output_export_target(
            &self.device,
            width,
            height,
            native_output_export_format(self.config.format),
        ) {
            Ok(export) => export,
            Err(err) => {
                eprintln!("[ghost-core] record target export failed: {err}");
                self.record_target = None;
                return false;
            }
        };
        self.record_target = Some(RecordOutputTarget {
            _render_texture: render_texture,
            render_view,
            export,
            alpha,
        });
        true
    }

    /// Render the recording target: one fullscreen composite pass over just
    /// the recorded layers, after the program render so every source frame
    /// it samples is already current (no extra decode or source render).
    /// With `alpha` the compositor returns straight colour plus coverage;
    /// without it the layers land over black exactly as a solo would look.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[allow(clippy::too_many_arguments)]
    fn render_record_target(
        &mut self,
        command_phase: f32,
        time_seconds: Option<f32>,
        frame_count: u64,
        layers: &[LayerGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        post_effects: &[[f32; 4]],
        alpha: bool,
    ) -> bool {
        let (width, height) = (self.config.width, self.config.height);
        if !self.ensure_record_target(width, height, alpha) {
            return false;
        }
        self.write_view_inputs(
            RECORD_TARGET_VIEW,
            true,
            command_phase,
            layers.len() as u32,
            time_seconds,
            frame_count,
            layers,
            audio0,
            audio1,
            audio2,
            // A recording of a source is not the live output: blackout is
            // the projector kill switch and must not blank the take.
            1.0,
            post_effects,
            record_target_output_stage(alpha),
        );
        let mut encoder = self.take_outputs_encoder();
        if let Some(target) = self.record_target.as_ref() {
            self.draw_composite_view(&mut encoder, RECORD_TARGET_VIEW, &target.render_view, "Ghost Record Target Pass");
            target.export.blitter.copy(&self.device, &mut encoder, &target.render_view, &target.export.view);
        }
        self.outputs_encoder = Some(encoder);
        if let Some(target) = self.record_target.as_mut() {
            target.export.frame = target.export.frame.saturating_add(1);
        }
        true
    }

    /// Create (or resize) one slice display's offscreen target and, where the
    /// platform has one, its shared-texture export.
    fn ensure_slice_target(&mut self, id: &str, width: u32, height: u32) -> bool {
        if let Some(existing) = self.slice_targets.get(id) {
            if existing.size() == (width, height) {
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
        #[cfg(any(target_os = "macos", target_os = "windows"))]
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
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                export,
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                width,
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                height,
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                frame: 0,
                projector_view_source: None,
            },
        );
        true
    }

    /// Composite one full frame per slice display. Each pass re-runs the
    /// compositor with that slice's output stage, so the projector gets its
    /// region rendered at the display's own resolution rather than a crop of
    /// a downscaled master — the reason this is a second composite rather
    /// than a blit.
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
        allow_direct: bool,
        projector_views: &ProjectorViewInputs<'_>,
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
            if let Some(projector_id) = spec.projector_view.as_deref() {
                self.render_projector_view_slice(spec, projector_id, projector_views, output_gate, time_seconds);
                continue;
            }
            let needs_detail = spec.width as f32 > self.config.width as f32 * spec.stage.out0[2]
                || spec.height as f32 > self.config.height as f32 * spec.stage.out0[3]
                || spec.stage.swarp[0] > 0.5 || spec.stage.mwarp[0] > 0.5;
            // Flux resamples the finished picture, so a Screen must take the shared master while it plays.
            // So must every Screen of a dome with layers placed on it: they are
            // laid over the dome by the output stage.
            let direct = allow_direct && needs_detail && self.output_flux[0][3] <= 0.0005
                && self.dome_layer_pass[0] < 0.5 && spec.mirror_mesh.is_none()
                && spec.stage.dproj0[0] < 0.5;
            if let Some(mesh) = spec.mirror_mesh.as_ref() {
                self.prepare_mirror_mesh(mesh);
            }
            // A full-detail Screen composites the program's layers (already
            // uploaded this frame) with its own output stage.
            let view_key = format!("slice:{}", spec.id);
            if direct {
                self.write_view_inputs(&view_key, false, command_phase, layers.len() as u32, time_seconds, frame_count,
                    layers, audio0, audio1, audio2, output_gate, post_effects, spec.stage);
            }
            let mut encoder = self.take_outputs_encoder();
            if let Some(target) = self.slice_targets.get(&spec.id) {
                if let Some(mesh) = spec.mirror_mesh.as_ref() {
                    self.draw_mirror_dome(&mut encoder, &target.render_view, spec.width, spec.height,
                        output_gate, OutputStage { dlayer: self.dome_layer_pass, ..spec.stage },
                        time_seconds.unwrap_or(0.0), &mesh.id);
                } else if direct {
                    self.draw_composite_view(&mut encoder, &view_key, &target.render_view, "Full-detail slice");
                } else {
                self.output_presenter.draw(&self.queue, &mut encoder, &target.render_view,
                    self.creative_frame_index, spec.width, spec.height,
                    output_gate, OutputStage { dlayer: self.dome_layer_pass, ..spec.stage }, time_seconds.unwrap_or(0.0));
                }
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                target.export.blitter.copy(
                    &self.device,
                    &mut encoder,
                    &target.render_view,
                    &target.export.view,
                );
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                if let Some(frame) = Self::blit_to_linux_slice_window(
                    &self.device, &self.wgpu_adapter, &mut self.linux_slice_windows, &spec.id, &mut encoder, &target.render_view)
                {
                    self.pending_slice_presents.push(frame);
                }
            }
            self.outputs_encoder = Some(encoder);
            // The mirror pass has one uniform for every mirror Screen: send
            // this one before the next mirror Screen rewrites it.
            if spec.mirror_mesh.is_some() {
                self.submit_outputs();
            }
            if let Some(target) = self.slice_targets.get_mut(&spec.id) {
                target.bump_frame();
            }
        }
    }

    /// Linux: create the child window that presents one Screen, parented to
    /// the Electron Screen window's X11 id, and a Vulkan surface on it.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn attach_linux_slice_window(
        &mut self,
        event_loop: &ActiveEventLoop,
        id: &str,
        x11_window: u64,
        width: u32,
        height: u32,
    ) -> Result<Value, String> {
        use winit::dpi::PhysicalPosition;
        use winit::raw_window_handle::XlibWindowHandle;
        if !linux_x11_presentation() {
            return Err("native Screens need X11 or XWayland".to_string());
        }
        if x11_window == 0 {
            return Err("Screen window has no X11 id".to_string());
        }
        // Re-attaching replaces the previous presenter (a reopened Screen).
        self.linux_slice_windows.remove(id);
        let (width, height) = (width.max(1), height.max(1));
        let parent = RawWindowHandle::Xlib(XlibWindowHandle::new(x11_window as std::ffi::c_ulong));
        let attrs = WindowAttributes::default()
            .with_title("Ghost Arcade Screen")
            .with_decorations(false)
            .with_resizable(false)
            .with_inner_size(PhysicalSize::new(width, height))
            .with_position(PhysicalPosition::new(0, 0))
            .with_visible(true);
        // SAFETY: Electron owns the parent window for as long as the Screen is
        // open and detaches this presenter before it closes the window.
        let attrs = unsafe { attrs.with_parent_window(Some(parent)) };
        let window = Arc::new(
            event_loop
                .create_window(attrs)
                .map_err(|err| format!("could not create the Screen child window: {err}"))?,
        );
        // The child only shows the picture. With an empty input shape, clicks
        // and keys over it reach the Screen window underneath, so Esc and
        // double-click there keep working once the core is presenting.
        let _ = window.set_cursor_hittest(false);
        let surface = self
            .wgpu_instance
            .create_surface(Arc::clone(&window))
            .map_err(|err| format!("could not create the Screen surface: {err}"))?;
        let caps = surface.get_capabilities(&self.wgpu_adapter);
        if caps.formats.is_empty() {
            return Err("the Screen surface reports no formats".to_string());
        }
        // Same boundary contract as the output window: non-sRGB BGRA8.
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|format| *format == wgpu::TextureFormat::Bgra8Unorm)
            .or_else(|| caps.formats.iter().copied().find(|format| !format.is_srgb()))
            .unwrap_or(caps.formats[0]);
        let present_mode = linux_slice_present_mode(&caps.present_modes);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Srgb,
            width,
            height,
            present_mode,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&self.device, &config);
        let blitter = TextureBlitterBuilder::new(&self.device, format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        self.linux_slice_windows.insert(id.to_string(), LinuxSliceWindow { window, surface, config, blitter });
        Ok(json!({ "attached": true, "slice_id": id, "width": width, "height": height, "format": format!("{format:?}"), "present_mode": present_mode_label(present_mode) }))
    }

    /// Linux: follow the Electron Screen window when it resizes or goes
    /// fullscreen.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn resize_linux_slice_window(&mut self, id: &str, width: u32, height: u32) -> Result<Value, String> {
        let window = self
            .linux_slice_windows
            .get_mut(id)
            .ok_or_else(|| format!("Screen {id} has no presenter"))?;
        let (width, height) = (width.max(1), height.max(1));
        if (window.config.width, window.config.height) != (width, height) {
            window.config.width = width;
            window.config.height = height;
            window.surface.configure(&self.device, &window.config);
            let _ = window.window.request_inner_size(PhysicalSize::new(width, height));
        }
        Ok(json!({ "resized": true, "slice_id": id, "width": width, "height": height }))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn detach_linux_slice_window(&mut self, id: &str) -> Value {
        json!({ "detached": self.linux_slice_windows.remove(id).is_some(), "slice_id": id })
    }

    /// Linux: draw a Screen's composite into its child window, if Electron has
    /// attached one. Returns the frame to present after the encoder submits.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn blit_to_linux_slice_window(
        device: &wgpu::Device,
        adapter: &wgpu::Adapter,
        windows: &mut HashMap<String, LinuxSliceWindow>,
        id: &str,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::TextureView,
    ) -> Option<wgpu::SurfaceTexture> {
        let window = windows.get_mut(id)?;
        let usable = match window.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => {
                let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
                window.blitter.copy(device, encoder, source, &view);
                return Some(frame);
            }
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                // A resize can leave an acquired drawable suboptimal. It still
                // owns the swapchain: release it before configuring a new one.
                drop(frame);
                Self::reconfigure_linux_slice_surface(device, adapter, window)
            }
            // Outdated or lost after a resize or a display change: put the
            // surface back and draw this Screen on the next frame. A timeout
            // or an occluded window just skips one.
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                Self::reconfigure_linux_slice_surface(device, adapter, window)
            }
            _ => true,
        };
        if !usable {
            eprintln!("[ghost-core] Screen {id}: its window is gone; presenter released");
            windows.remove(id);
        }
        None
    }

    /// Configure a Screen's surface again, unless its window no longer exists.
    /// Electron can close the Screen window before the detach request reaches
    /// a busy core; configuring a surface whose X11 window is gone is a wgpu
    /// validation error, which would take the whole core down.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn reconfigure_linux_slice_surface(device: &wgpu::Device, adapter: &wgpu::Adapter, window: &LinuxSliceWindow) -> bool {
        if window.surface.get_capabilities(adapter).formats.is_empty() {
            return false;
        }
        window.surface.configure(device, &window.config);
        true
    }

    fn ensure_projector_view_renderer(&mut self) -> &mut projector_view::ProjectorViewRenderer {
        if self.projector_view.as_ref().is_none_or(|renderer| renderer.format() != self.config.format) {
            self.projector_view = Some(projector_view::ProjectorViewRenderer::new(&self.device, &self.queue, self.config.format));
        }
        self.projector_view.as_mut().expect("projector view renderer created above")
    }

    /// One slice fed by a Map Sim projector view: render the projector's
    /// image, then run it through the Screen's output stage (rotation,
    /// grade, blend, masks) into the slice's shared texture.
    fn render_projector_view_slice(
        &mut self,
        spec: &SliceOutputSpec,
        projector_id: &str,
        inputs: &ProjectorViewInputs<'_>,
        output_gate: f32,
        time_seconds: Option<f32>,
    ) {
        let format = self.config.format;
        let stale = self.slice_targets.get(&spec.id).is_some_and(|target| {
            target
                .projector_view_source
                .as_ref()
                .is_none_or(|(texture, ..)| texture.width() != spec.width || texture.height() != spec.height)
        });
        if stale {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Map Sim projector view slice source"),
                size: wgpu::Extent3d { width: spec.width, height: spec.height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let bind_group = self.output_presenter.input_bind_group(&self.device, &view);
            if let Some(target) = self.slice_targets.get_mut(&spec.id) {
                target.projector_view_source = Some((texture, view, bind_group));
            }
        }
        self.ensure_projector_view_renderer();
        let content_view = gpu_object_cache::view(&self.composite_frame_textures[self.creative_frame_index], &Default::default());
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let mut presented: Option<wgpu::SurfaceTexture> = None;
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Map Sim projector view slice encoder"),
        });
        {
            let Some(target) = self.slice_targets.get(&spec.id) else {
                return;
            };
            let Some((_, source_view, source_input)) = target.projector_view_source.as_ref() else {
                return;
            };
            let renderer = self.projector_view.as_mut().expect("projector view renderer ensured");
            renderer.sync_meshes(&self.device, inputs.meshes);
            let empty = projector_view::ProjectorViewScene::default();
            renderer.render(
                &self.device,
                &self.queue,
                &mut encoder,
                source_view,
                &projector_view::ProjectorViewRequest {
                    scene: inputs.scene.unwrap_or(&empty),
                    projector_id,
                    content: Some(&content_view),
                    overlay: inputs.overlays.get(projector_id),
                    width: spec.width,
                    height: spec.height,
                },
            );
            self.output_presenter.draw_input(
                &self.queue,
                &mut encoder,
                &target.render_view,
                source_input,
                spec.width,
                spec.height,
                output_gate,
                spec.stage,
                time_seconds.unwrap_or(0.0),
            );
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            target.export.blitter.copy(&self.device, &mut encoder, &target.render_view, &target.export.view);
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                presented = Self::blit_to_linux_slice_window(
                    &self.device, &self.wgpu_adapter, &mut self.linux_slice_windows, &spec.id, &mut encoder, &target.render_view);
            }
        }
        // Its own submit: the projector view renderer has one set of
        // uniforms. Nothing in the outputs encoder reads what it draws.
        self.frame_submission = Some(churn_probe::submit(&self.queue, Some(encoder.finish())));
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        if let Some(frame) = presented.take() {
            self.queue.present(frame);
        }
        if let Some(target) = self.slice_targets.get_mut(&spec.id) {
            target.bump_frame();
        }
    }

    /// Read back one Map Sim projector view, rendered from the last
    /// composited master. Diagnostics and the calibration preview use it.
    fn projector_view_snapshot(
        &mut self,
        inputs: &ProjectorViewInputs<'_>,
        projector_id: &str,
        width: u32,
        height: u32,
    ) -> Result<FrameSnapshotReadback, String> {
        let scene = inputs.scene.ok_or_else(|| "Map Sim projector views have not been sent to the core".to_string())?;
        if scene.camera(projector_id).is_none() {
            return Err(format!("Map Sim projector {projector_id} is not in the projector view scene"));
        }
        let format = self.config.format;
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Map Sim projector view snapshot"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let content_view = self.composite_frame_textures[self.creative_frame_index].create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Map Sim projector view snapshot encoder"),
        });
        self.ensure_projector_view_renderer();
        let renderer = self.projector_view.as_mut().expect("projector view renderer ensured");
        renderer.sync_meshes(&self.device, inputs.meshes);
        renderer.render(
            &self.device,
            &self.queue,
            &mut encoder,
            &view,
            &projector_view::ProjectorViewRequest {
                scene,
                projector_id,
                content: Some(&content_view),
                overlay: inputs.overlays.get(projector_id),
                width,
                height,
            },
        );
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        read_texture_to_frame(&self.device, &self.queue, &texture, format, width, height, "Map Sim projector view")
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
                return slice_presentation::metadata("iosurface", slices);
            }
            return slice_presentation::metadata("iosurface", vec![]);
        }
        // Electron's DXGI monitor presenter consumes these named textures.
        // Availability must be true even before the first slice is opened:
        // Electron probes it before choosing the output-window transport.
        #[cfg(target_os = "windows")]
        {
            let slices: Vec<Value> = self
                .slice_targets
                .iter()
                .map(|(id, target)| {
                    json!({
                        "id": id,
                        "shared_name": target.export.shared_name,
                        "width": target.export.width,
                        "height": target.export.height,
                        "frame": target.export.frame,
                    })
                })
                .collect();
            slice_presentation::metadata("dxgi", slices)
        }
        // Linux: the core presents each Screen into an X11 child window of the
        // Electron Screen window. Available only while the event loop is on
        // X11 (see main()); on native Wayland there is nothing to parent into.
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            if let Some(reason) = linux_x11_unavailable_reason() {
                return json!({
                    "available": false,
                    "platform": "wayland",
                    "reason": reason,
                });
            }
            let slices: Vec<Value> = self
                .slice_targets
                .iter()
                .map(|(id, target)| {
                    json!({
                        "id": id,
                        "width": target.width,
                        "height": target.height,
                        "frame": target.frame,
                        "presented": self.linux_slice_windows.contains_key(id),
                    })
                })
                .collect();
            slice_presentation::metadata("x11", slices)
        }
    }

    /// Shared-texture metadata for both deck monitors — same shape the
    /// output export uses so the electron presenter pump can reuse its
    /// import path.
    /// Gets a mirror mesh's buffers (and the mirror pass itself) ready to
    /// draw. Before the encoder, so drawing needs no mutable borrow.
    fn prepare_mirror_mesh(&mut self, mesh: &MirrorMesh) {
        if self.mirror.is_none() {
            self.mirror = Some(MirrorRenderer::new(&self.device, self.config.format));
        }
        let Some(mirror) = self.mirror.as_mut() else { return };
        if !mirror.meshes.contains_key(&mesh.id) {
            if mirror.meshes.len() >= 8 {
                mirror.meshes.clear();
            }
            let vertices = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Mirror mesh vertices"),
                contents: bytemuck::cast_slice(&mesh.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let indices = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Mirror mesh indices"),
                contents: bytemuck::cast_slice(&mesh.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
            mirror.meshes.insert(mesh.id.clone(), MirrorMeshGpu { vertices, indices, count: mesh.indices.len() as u32 });
        }
    }

    /// A mirror dome Screen: the dome picture is drawn as a square
    /// domemaster (the output stage with the Screen's dome, grade and dome
    /// layers, but none of its flat crop, warp, blend or masks), then
    /// through the warp mesh as geometry, each vertex taking its fisheye
    /// point and brightness, as Paul Bourke's players do.
    #[allow(clippy::too_many_arguments)]
    fn draw_mirror_dome(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        width: u32,
        height: u32,
        output_gate: f32,
        stage: OutputStage,
        time: f32,
        mesh_id: &str,
    ) {
        let Some(mirror) = self.mirror.as_ref() else { return };
        let Some(mesh) = mirror.meshes.get(mesh_id) else { return };
        let master_stage = OutputStage {
            out0: [0.0, 0.0, 1.0, 1.0],
            out1: [0.0, stage.out1[1], stage.out1[2], stage.out1[3]],
            edge: [0.0; 4],
            dome1: [stage.dome1[0], 0.0, 0.0, stage.dome1[3]],
            dome2: [stage.dome2[0], 2.2, 0.0, 0.0],
            ..OutputStage {
                dome0: stage.dome0,
                dome1: stage.dome1,
                dome3: stage.dome3,
                dome4: stage.dome4,
                dlayer: stage.dlayer,
                ..OutputStage::default()
            }
        };
        self.output_presenter.draw(&self.queue, encoder, &mirror.master_view, self.creative_frame_index,
            MIRROR_MASTER_SIZE, MIRROR_MASTER_SIZE, output_gate, master_stage, time);
        let aspect = width.max(1) as f32 / height.max(1) as f32;
        churn_probe::write_buffer(&self.queue, &mirror.uniform, 0, bytemuck::cast_slice(&[aspect, 0.0f32, 0.0, 0.0]));
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Mirror dome mesh"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&mirror.pipeline);
        pass.set_bind_group(0, &mirror.bind_group, &[]);
        pass.set_vertex_buffer(0, mesh.vertices.slice(..));
        pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..mesh.count, 0, 0..1);
    }

    /// The Inside view's texture, described like the program output's
    /// (output_export_metadata) so the editor preview can show either.
    fn dome_view_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            if let Some(target) = self.dome_view_target.as_ref() {
                let export = &target.export;
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
                    "alpha_mode": "opaque",
                    "single_render_source": "core-dome-view",
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(target) = self.dome_view_target.as_ref() {
                let export = &target.export;
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
                    "alpha_mode": "opaque",
                    "single_render_source": "core-dome-view",
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        json!({ "available": false })
    }

    /// Draws the editor's Inside view of the dome (`stage.dview`), or drops
    /// its target when the view is off. Same pass as a Screen's, from the
    /// same master, at the composition's size so it fills the editor canvas.
    fn render_dome_view(&mut self, stage: Option<OutputStage>, output_gate: f32, time_seconds: Option<f32>) {
        let Some(stage) = stage else {
            self.dome_view_target = None;
            return;
        };
        let width = self.config.width.clamp(16, 4096);
        let height = self.config.height.clamp(16, 4096);
        if self.dome_view_target.as_ref().map(|target| (target.width, target.height)) != Some((width, height)) {
            let (render_texture, render_view) = Self::create_offscreen_target(
                &self.device,
                width,
                height,
                self.config.format,
                "Ghost Dome View Render Target",
            );
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            let export = match Self::create_output_export_target(
                &self.device,
                width,
                height,
                native_output_export_format(self.config.format),
            ) {
                Ok(export) => export,
                Err(err) => {
                    eprintln!("[ghost-core] dome view export target failed: {err}");
                    self.dome_view_target = None;
                    return;
                }
            };
            self.dome_view_target = Some(DeckMonitorTarget {
                render_texture,
                render_view,
                width,
                height,
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                export,
            });
        }
        let stage = OutputStage { dlayer: self.dome_layer_pass, ..stage };
        let mut encoder = self.take_outputs_encoder();
        if let Some(target) = self.dome_view_target.as_ref() {
            self.output_presenter.draw(&self.queue, &mut encoder, &target.render_view,
                self.creative_frame_index, width, height, output_gate, stage, time_seconds.unwrap_or(0.0));
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            target.export.blitter.copy(&self.device, &mut encoder, &target.render_view, &target.export.view);
        }
        self.outputs_encoder = Some(encoder);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(target) = self.dome_view_target.as_mut() {
            target.export.frame = target.export.frame.saturating_add(1);
        }
    }

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
            if let Some(targets) = self.deck_monitor_targets.as_ref() {
                let bank = |target: &DeckMonitorTarget, name: &str| {
                    json!({
                        "bank": name,
                        "shared_name": target.export.shared_name,
                        "width": target.export.width,
                        "height": target.export.height,
                        "frame": target.export.frame,
                    })
                };
                return json!({
                    "available": true,
                    "platform": "dxgi",
                    "banks": [bank(&targets[0], "a"), bank(&targets[1], "b")],
                });
            }
        }
        json!({ "available": false })
    }

    /// Shared-texture metadata for the recording target, in the output
    /// export's shape so the main-process recorder reads it the same way.
    fn record_target_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        if let Some(target) = self.record_target.as_ref() {
            return json!({
                "available": true,
                "platform": "iosurface",
                "handle": target.export.surface.id().to_string(),
                "handle_encoding": "integer",
                "width": target.export.width,
                "height": target.export.height,
                "frame": target.export.frame,
                "alpha": target.alpha,
            });
        }
        #[cfg(target_os = "windows")]
        if let Some(target) = self.record_target.as_ref() {
            return json!({
                "available": true,
                "platform": "dxgi",
                "shared_name": target.export.shared_name,
                "width": target.export.width,
                "height": target.export.height,
                "frame": target.export.frame,
                "alpha": target.alpha,
            });
        }
        json!({ "available": false })
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

    fn mark_source_frame_slots_submitted(&self, slots: impl IntoIterator<Item = usize>) {
        let states = slots.into_iter().collect::<HashSet<_>>().into_iter().map(|slot| {
            let state = self.slot_readiness(slot);
            let epoch = state.epoch.load(Ordering::Acquire);
            state.submitted_epoch.store(epoch, Ordering::Release);
            (state, epoch)
        }).collect::<Vec<_>>();
        if !states.is_empty() {
            self.queue.on_submitted_work_done(move || {
                for (state, epoch) in states {
                    // Slot reuse invalidates old in-flight callbacks. An old
                    // completion must not make a new, still blank owner ready.
                    if state.epoch.load(Ordering::Acquire) == epoch {
                        // Polling can dispatch callbacks on another thread.
                        // A delayed older callback must not regress a newer
                        // completion after this epoch check races with reuse.
                        state.completed_epoch.fetch_max(epoch, Ordering::AcqRel);
                    }
                }
            });
        }
    }

    fn mark_graph_frames_submitted(&self, plans: impl Iterator<Item = usize>) {
        self.mark_source_frame_slots_submitted(plans);
    }

    /// Readiness of `slot`'s picture on the GPU; slots past the first ones
    /// get their tracker on first use.
    fn slot_readiness(&self, slot: usize) -> Arc<SourceFrameGpuReadiness> {
        let mut list = self.source_frame_gpu_readiness.borrow_mut();
        if slot >= list.len() {
            list.resize_with(slot + 1, || Arc::new(SourceFrameGpuReadiness::default()));
        }
        Arc::clone(&list[slot])
    }

    /// Size a generated picture (graph output, crossfade, mix) is rendered at:
    /// the shared slot edge, or the output resolution when slots have their
    /// own textures.
    fn generated_frame_size(&self) -> (u32, u32) {
        match self.slots.mode() {
            SourceFrameMode::Shared => (self.source_frame_size as u32, self.source_frame_size as u32),
            SourceFrameMode::PerSource => self.slots.fitted_size(self.config.width.max(1), self.config.height.max(1)),
        }
    }

    /// Size an imported GPU picture is stored at.
    fn imported_frame_size(&self, width: u32, height: u32) -> (u32, u32) {
        match self.slots.mode() {
            SourceFrameMode::Shared => (self.source_frame_size as u32, self.source_frame_size as u32),
            SourceFrameMode::PerSource => self.slots.fitted_size(width, height),
        }
    }

    /// Room for slot `slot`: grows the store when it is past the end.
    fn ensure_slot_capacity(&self, slot: usize) -> bool {
        slot < self.slots.capacity() || self.slots.grow(&self.queue, slot + 1).is_some_and(|cap| slot < cap)
    }

    /// Rebuild the compositor and Stage3D bind groups after the store
    /// replaced a backing texture.
    fn refresh_source_frame_bind_groups(&mut self) {
        let generation = self.slots.generation();
        if generation == self.source_frame_bind_generation {
            return;
        }
        self.source_frames_bind_group = build_source_frames_bind_group(
            &self.device, &self.source_frames_bind_group_layout, &self.slots, self.source_frame_bindings);
        self.source_frame_bind_generation = generation;
    }

    fn copy_source_frame_slot(&self, input_slot: usize, output_slot: usize) {
        self.slot_readiness(output_slot).invalidate();
        let source = self.slots.slot(input_slot);
        let target = self.slots.ensure(output_slot, source.width, source.height, source.mips > 1);
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Clip transition GPU source snapshot"),
        });
        for mip_level in 0..source.mips.min(target.mips) {
            let (width, height) = source.mip_size(mip_level);
            encoder.copy_texture_to_texture(
                source.copy_info(mip_level),
                target.copy_info(mip_level),
                wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            );
        }
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        // Every level came across: the copy's chain is as current as the original's.
        self.slots.set_mips_current(output_slot, source.mips <= target.mips && self.slots.mips_current(input_slot));
        self.mark_source_frame_slots_submitted([output_slot]);
    }

    fn write_source_frame_level_zero(&self, slot: usize, rgba: &[u8]) -> Option<usize> {
        let edge = self.source_frame_size;
        if rgba.len() < edge * edge * 4 {
            return None;
        }
        let safe_slot = self.slots.clamp_slot(slot);
        let target = self.slots.ensure(safe_slot, edge as u32, edge as u32, true);
        let (payload, bytes_per_row) =
            source_frame_upload_payload(rgba, edge, self.source_frame_format);
        self.queue.write_texture(
            target.copy_info(0),
            &payload,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(edge as u32),
            },
            wgpu::Extent3d { width: edge as u32, height: edge as u32, depth_or_array_layers: 1 },
        );
        Some(safe_slot)
    }

    /// Per-source store: a `width` x `height` picture becomes the slot's own
    /// texture at exactly that size. Live video skips the mip chain (it is
    /// sampled at level zero); stills build it.
    fn write_slot_pixels(&self, slot: usize, rgba: &[u8], width: usize, height: usize, with_mips: bool) -> Option<usize> {
        if width == 0 || height == 0 || rgba.len() < width.saturating_mul(height).saturating_mul(4) {
            return None;
        }
        let safe_slot = self.slots.clamp_slot(slot);
        let target = self.slots.ensure(safe_slot, width as u32, height as u32, with_mips);
        let (payload, bytes_per_row) =
            source_frame_upload_payload_dimensions(rgba, width, height, self.source_frame_format);
        self.queue.write_texture(
            target.copy_info(0),
            &payload,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(height as u32),
            },
            wgpu::Extent3d { width: width as u32, height: height as u32, depth_or_array_layers: 1 },
        );
        if with_mips && target.mips > 1 {
            let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Source Frame Mip Encoder"),
            });
            self.generate_source_frame_mips(&mut encoder, safe_slot);
            churn_probe::submit(&self.queue, Some(encoder.finish()));
        } else {
            churn_probe::submit(&self.queue, std::iter::empty());
        }
        self.mark_source_frame_slots_submitted([safe_slot]);
        Some(payload.len())
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
        let edge = self.source_frame_size;
        if width == 0
            || height == 0
            || origin_x.saturating_add(width) > edge
            || origin_y.saturating_add(height) > edge
            || rgba.len() < width.saturating_mul(height).saturating_mul(4)
        {
            return None;
        }
        let safe_slot = self.slots.clamp_slot(slot);
        let target = self.slots.ensure(safe_slot, edge as u32, edge as u32, true);
        let (payload, bytes_per_row) =
            source_frame_upload_payload_dimensions(rgba, width, height, self.source_frame_format);
        self.queue.write_texture(
            target.copy_info_at(0, origin_x as u32, origin_y as u32),
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
        churn_probe::submit(&self.queue, std::iter::empty());
        self.mark_source_frame_slots_submitted([safe_slot]);
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
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted([safe_slot]);
    }

    /// Erase one source frame slot, every mip level, to transparent. A
    /// per-source slot simply lets its texture go: an empty slot reads as the
    /// transparent placeholder.
    fn clear_source_frame_slot(&self, slot: usize) {
        self.release_shared_texture_import(slot);
        self.slot_readiness(slot).invalidate();
        if self.slots.mode() == SourceFrameMode::PerSource {
            self.slots.release(slot);
            return;
        }
        let target = self.slots.slot(slot);
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Source Frame Slot Clear"),
            });
        for mip_level in 0..target.mips.max(1) {
            let view = target.target_view("Ghost Render Core Source Frame Slot Clear View", mip_level);
            // A pass with no draws is just its clear.
            drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Ghost Render Core Source Frame Slot Clear"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            }));
        }
        churn_probe::submit(&self.queue, Some(encoder.finish()));
    }

    /// Let go of the shared texture a slot kept open (the slot was released
    /// or is being given to another source).
    fn release_shared_texture_import(&self, slot: usize) {
        #[cfg(target_os = "windows")]
        if let Ok(mut cache) = self.dxgi_import_cache.lock() {
            cache.release(slot);
        }
        #[cfg(not(target_os = "windows"))]
        let _ = slot;
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
        let safe_slot = self.slots.clamp_slot(slot);
        let (target_width, target_height) = self.imported_frame_size(descriptor.width, descriptor.height);
        let target = self.slots.ensure(safe_slot, target_width, target_height, true);
        let target_view = target.target_view("Ghost Render Core Shared Texture Source Frame Target", 0);
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Shared Texture Source Frame Encoder"),
            });
        self.source_frame_blitter
            .copy(&self.device, &mut encoder, &source_view, &target_view);
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted([safe_slot]);
        Ok((target.width as usize)
            .saturating_mul(target.height as usize)
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

        // The handle is a fresh duplicate on every upload, but a camera's
        // texture behind it lasts the session: reuse the one already opened
        // and only close the duplicate.
        let import_key = shared_texture::SharedTextureImportKey::for_descriptor(descriptor);
        if let Some(key) = import_key.as_ref() {
            let cached = self.dxgi_import_cache.lock().ok().and_then(|cache| cache.get(slot, key));
            if let Some(texture) = cached {
                if descriptor.close_handle_after_import {
                    let _ = unsafe { CloseHandle(HANDLE(shared_handle as *mut core::ffi::c_void)) };
                }
                return self.copy_imported_source_texture(slot, &texture, descriptor);
            }
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
        let uploaded = self.copy_imported_source_texture(slot, &imported_texture, descriptor)?;
        if let Some(key) = import_key {
            if let Ok(mut cache) = self.dxgi_import_cache.lock() {
                cache.insert(slot, key, imported_texture);
            }
        }
        Ok(uploaded)
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
        let safe_slot = self.slots.clamp_slot(slot);
        let (target_width, target_height) = self.imported_frame_size(descriptor.width, descriptor.height);
        let target = self.slots.ensure(safe_slot, target_width, target_height, true);
        let target_view = target.target_view("Ghost Render Core Shared Texture Source Frame Target", 0);
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Shared Texture Source Frame Encoder"),
            });
        self.source_frame_blitter
            .copy(&self.device, &mut encoder, &source_view, &target_view);
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted([safe_slot]);
        Ok((target.width as usize)
            .saturating_mul(target.height as usize)
            .saturating_mul(texture_format_bytes_per_texel(self.source_frame_format))
            .min(u64::MAX as usize) as u64)
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn import_native_video_frame(&self, slot: usize, frame: hardware_video::GpuVideoFrame,
        memory_lease: Option<Arc<NativeVideoMemoryLease>>) -> Result<[f32; 4], String> {
        let safe_slot = self.slots.clamp_slot(slot);
        // Shared slots hold the frame centred at up to the slot edge; a
        // per-source slot is the frame, at its decoded size.
        let (slot_ref, viewport, source_rect) = if self.slots.mode() == SourceFrameMode::PerSource {
            let (width, height) = self.slots.fitted_size(frame.width, frame.height);
            let slot_ref = self.slots.ensure(safe_slot, width, height, false);
            (slot_ref, [0.0, 0.0, width as f32, height as f32], [0.0, 0.0, 1.0, 1.0])
        } else {
            let size = self.source_frame_size as f32;
            let scale = (size / frame.width.max(1) as f32).min(size / frame.height.max(1) as f32).min(1.0);
            let width = (frame.width as f32 * scale).round().max(1.0);
            let height = (frame.height as f32 * scale).round().max(1.0);
            let viewport = [((size - width) * 0.5).floor(), ((size - height) * 0.5).floor(), width, height];
            // Level zero only: the slot's mip chain no longer matches it.
            self.slots.set_mips_current(safe_slot, false);
            (self.slots.slot(safe_slot), viewport,
                [viewport[0] / size, viewport[1] / size, width / size, height / size])
        };
        let target = slot_ref.target_view("Native hardware video target", 0);
        let is_hap = matches!(&frame.storage, hardware_video::FrameStorage::Hap(_));
        // Inside a stream drain every frame, HAP or not, joins the drain's
        // one encoder and submit: each source occurs once per drain, so no
        // two frames write the same slot. A hardware frame's conversion
        // writes nothing through the queue, so it batches as is.
        let mut batch_guard = self.hap_upload_batch.lock().unwrap();
        let mut encoder = batch_guard.as_mut().and_then(|batch| batch.encoder.take())
            .unwrap_or_else(|| self.device.create_command_encoder(
                &wgpu::CommandEncoderDescriptor { label: Some("Native video conversion batch") }));
        match &frame.storage {
            hardware_video::FrameStorage::Hap(hap) => self.hap_converter.encode(&self.device, &mut encoder, safe_slot, hap, &target, viewport)?,
            hardware_video::FrameStorage::Native(native) => {
                self.hap_converter.release(safe_slot);
                #[cfg(target_os = "macos")]
                self.video_converter.encode(&self.device, &mut encoder, native, &target, viewport)?;
                #[cfg(target_os = "windows")]
                self.video_converter.encode(&self.device, &self.queue, &mut encoder, native, &target, viewport)?;
            }
        }
        // Live-source sampling is explicitly clamped to level zero (as on
        // the software-video path). Building four unused mip levels for
        // every decoded frame multiplies render-pass/driver work for no
        // visible benefit; static sources still generate their mip chain.
        let gpu_lease = memory_lease.as_ref().map(|lease| lease.begin_gpu_work());
        if let Some(batch) = batch_guard.as_mut() {
            batch.encoder = Some(encoder);
            batch.frames.push((frame, gpu_lease));
            batch.slots.push(safe_slot);
            return Ok(source_rect);
        }
        if is_hap {
            self.hap_converter.finish_uploads(&encoder);
        }
        drop(batch_guard);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted([safe_slot]);
        // The decoder/bridge may recycle this surface only after rendering
        // has completed. Submission alone does not establish lifetime.
        self.queue.on_submitted_work_done(move || { drop(frame); drop(gpu_lease); });
        Ok(source_rect)
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn flush_hap_upload_batch(&self) {
        let Some(batch) = self.hap_upload_batch.lock().unwrap().take() else { return; };
        let Some(encoder) = batch.encoder else { return; };
        self.hap_converter.finish_uploads(&encoder);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted(batch.slots);
        self.queue.on_submitted_work_done(move || drop(batch.frames));
    }

    fn generate_source_frame_mips(&self, encoder: &mut wgpu::CommandEncoder, slot: usize) {
        let target = self.slots.slot(slot);
        for mip_level in 1..target.mips {
            let source_view = target.target_view("Ghost Render Core Source Frame Mip Source", mip_level - 1);
            let target_view = target.target_view("Ghost Render Core Source Frame Mip Target", mip_level);
            self.source_frame_mips.encode(&self.device, encoder, &source_view, &target_view);
        }
        self.slots.set_mips_current(slot, true);
    }

    /// Snapshot readback downscaled so the longest edge is `max_dim`.
    /// GPU-side blit before readback: a 1080p frame at max_dim=512 reads
    /// back ~590KB instead of ~8MB, which is what makes a continuous
    /// composite mirror affordable over the JSON transport.
    fn read_frame_snapshot_scaled(&mut self, max_dim: u32) -> Result<FrameSnapshotReadback, String> {
        // At full size the plain read also records the frame metrics.
        if max_dim == 0 || (self.config.width.max(1) <= max_dim && self.config.height.max(1) <= max_dim) {
            return self.read_frame_snapshot();
        }
        self.prepare_frame_snapshot_scaled(max_dim, false)?.finish()
    }

    fn prepare_frame_snapshot_scaled(&mut self, max_dim: u32, live_output: bool) -> Result<PendingFrameReadback, String> {
        let out_w = self.config.width.max(1);
        let out_h = self.config.height.max(1);
        if max_dim == 0 || (out_w <= max_dim && out_h <= max_dim) {
            let texture = if live_output { &self.output_mirror_texture } else { &self.snapshot_texture };
            return prepare_texture_readback(&self.device, &self.queue, texture,
                self.config.format, out_w, out_h, "Ghost Composite Preview");
        }
        let scale = max_dim as f32 / out_w.max(out_h) as f32;
        let w = ((out_w as f32 * scale).round() as u32).clamp(1, out_w);
        let h = ((out_h as f32 * scale).round() as u32).clamp(1, out_h);
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
            let source = if live_output { &self.output_mirror_texture } else { &self.snapshot_texture };
            let src_view = source.create_view(&wgpu::TextureViewDescriptor::default());
            let dst_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Snapshot Preview Blit"),
            });
            blitter.copy(&self.device, &mut encoder, &src_view, &dst_view);
            churn_probe::submit(&self.queue, Some(encoder.finish()));
        }
        let (texture, _, w, h) = self.snapshot_preview.as_ref().expect("snapshot preview present");
        prepare_texture_readback(
            &self.device,
            &self.queue,
            texture,
            self.config.format,
            *w,
            *h,
            "Ghost Snapshot Preview",
        )
    }

    // Read only the raw source, before layer crop/warp/FX. Reuse bounded
    // GPU targets and downsample before the modal's occasional readback.
    /// Copy one source frame slot, scaled to the preview size, into a readback
    /// buffer. Returns as soon as the copy is queued; `finish()` waits for it.
    fn prepare_source_crop_readback(&mut self, slot: usize, rect: [f32; 4], request: &SourcePreviewRequest) -> Result<PendingFrameReadback, String> {
        let source = self.slots.slot(slot);
        let (size_x, size_y) = (source.width, source.height);
        let x = ((rect[0] * size_x as f32).round().max(0.0) as u32).min(size_x - 1);
        let y = ((rect[1] * size_y as f32).round().max(0.0) as u32).min(size_y - 1);
        let width = ((rect[2] * size_x as f32).round() as u32).clamp(1, size_x - x);
        let height = ((rect[3] * size_y as f32).round() as u32).clamp(1, size_y - y);
        let (w, h) = request.target_size(width, height);
        if !matches!(&self.source_crop_preview, Some((raw, _, _, sw, sh, pw, ph)) if (*sw,*sh,*pw,*ph)==(width,height,w,h) && raw.format() == self.source_frame_format) {
            let make = |label, width, height, format, usage| self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label), size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
                format, usage, view_formats: &[],
            });
            let raw = make("Crop source", width, height, self.source_frame_format,
                wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING);
            let target = make("Crop preview", w, h, wgpu::TextureFormat::Rgba8Unorm,
                wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC);
            // The preview is smaller than the source: filter, do not point-sample.
            let blitter = TextureBlitterBuilder::new(&self.device, wgpu::TextureFormat::Rgba8Unorm)
                .sample_type(wgpu::FilterMode::Linear).build();
            self.source_crop_preview = Some((raw, target, blitter, width, height, w, h));
        }
        let (raw, target, blitter, _, _, _, _) = self.source_crop_preview.as_ref().unwrap();
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("Crop preview") });
        encoder.copy_texture_to_texture(
            source.copy_info_at(0, x, y),
            raw.as_image_copy(), wgpu::Extent3d { width, height, depth_or_array_layers: 1 });
        blitter.copy(&self.device, &mut encoder, &raw.create_view(&Default::default()), &target.create_view(&Default::default()));
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        prepare_texture_readback(&self.device, &self.queue, target, wgpu::TextureFormat::Rgba8Unorm, w, h, "Crop preview")
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

    /// The compositor uniforms for one view of this frame. Also hands the
    /// output presenter the clock and Flux every output plays.
    #[allow(clippy::too_many_arguments)]
    fn frame_uniforms(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) -> Uniforms {
        // The beat clock runs on the unwrapped clock; shaders get it wrapped
        // (see SHADER_CLOCK_WRAP_SECONDS). A manual clock arrives wrapped.
        let clock_seconds = time_seconds.map(f64::from).unwrap_or_else(|| self.start_time.elapsed().as_secs_f64());
        let time = shader_clock_seconds(clock_seconds);
        let clock = self.beat_clock.uniform(clock_seconds);
        self.output_presenter.clock = clock;
        self.output_presenter.live_time = time;
        self.output_presenter.flux = self.output_flux;
        self.output_presenter.flux_regions = self.output_flux_regions;
        Uniforms {
            resolution: [self.config.width as f32, self.config.height as f32],
            time,
            clock,
            flux0: self.output_flux[0],
            flux1: self.output_flux[1],
            flux_regions: self.output_flux_regions,
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
            dome3: stage.dome3,
            dome4: stage.dome4,
            dlayer: stage.dlayer,
            dview: stage.dview,
            dview1: stage.dview1,
            dproj0: stage.dproj0,
            dproj1: stage.dproj1,
            dprojs: stage.dprojs,
            edge_gamma: stage.edge_gamma,
            black_level: stage.black_level,
            projector_calibration: stage.projector_calibration,
            swarp: stage.swarp,
            swarp_c0: stage.swarp_c0,
            swarp_c1: stage.swarp_c1,
            mwarp: stage.mwarp,
            mwarp_c0: stage.mwarp_c0,
            mwarp_c1: stage.mwarp_c1,
            swarp_mesh: stage.swarp_mesh,
            mwarp_mesh: stage.mwarp_mesh,
            smask: stage.smask,
            smask_info: stage.smask_info,
            smask_bounds: stage.smask_bounds,
            smask_pts: stage.smask_pts,
            swarp_tangents: stage.swarp_tangents,
            mwarp_tangents: stage.mwarp_tangents,
            post: {
                let mut slots = [[0.0f32; 4]; 8];
                for (slot, value) in slots.iter_mut().zip(post_effects.iter().take(8)) {
                    *slot = *value;
                }
                slots
            },
        }
    }

    /// Uniforms and layers for the program composite (`self.bind_group`).
    #[allow(clippy::too_many_arguments)]
    fn write_frame_inputs(
        &mut self,
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
        let uniforms = self.frame_uniforms(command_phase, layers_seen, time_seconds, frame_count,
            audio0, audio1, audio2, output_gate, post_effects, stage);
        churn_probe::write_buffer(&self.queue, &self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        let (filled, upload_len) = self.stage_layer_upload(scene_layers, layers_seen);
        self.program_wants_mips = layers_want_mips(&self.layer_upload_scratch[..filled]);
        let grown = upload_composite_layers(
            &self.device,
            &self.queue,
            &self.layer_upload_scratch[..upload_len],
            filled,
            CompositeLayerState {
                layer_buffer: &self.layer_buffer,
                pool: &mut self.layer_pool,
                tile_buffer: &self.layer_tile_buffer,
                layer_last: &mut self.layer_upload_last,
                mesh_cell_bounds_last: &mut self.mesh_cell_bounds_last,
                tile_last: &mut self.layer_tile_last,
            },
            &mut self.layer_pack_scratch,
            &mut self.mesh_cell_bounds_scratch,
            &mut self.layer_tile_scratch,
        );
        if grown {
            self.rebind_program_scene();
        }

        if let Some(source_previews) = source_previews {
            // `source_preview_pixel_data` already hands us an exactly-sized,
            // zero-filled array, so the old staging copy through a second
            // 16 MB `vec!` was pure duplication. Upload the caller's slice.
            let preview_len = source_previews
                .len()
                .min(MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS);
            churn_probe::write_buffer(&self.queue, 
                &self.source_preview_buffer,
                0,
                bytemuck::cast_slice(&source_previews[..preview_len]),
            );
        }
    }

    /// Uniforms (and, with `own_layers`, layers) for a view composited after
    /// the program in the same frame: a deck monitor, the record target or a
    /// full-detail Screen. Each view has its own buffers, so it no longer
    /// overwrites the program's and every view's unchanged layers stay
    /// uploaded from one frame to the next. A view without its own layers
    /// draws the program's (a Screen shows the program's layers).
    #[allow(clippy::too_many_arguments)]
    fn write_view_inputs(
        &mut self,
        key: &str,
        own_layers: bool,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) {
        let uniforms = self.frame_uniforms(command_phase, layers_seen, time_seconds, frame_count,
            audio0, audio1, audio2, output_gate, post_effects, stage);
        let (filled, upload_len) = if own_layers {
            self.stage_layer_upload(scene_layers, layers_seen)
        } else {
            (0, 0)
        };
        self.ensure_composite_view(key, own_layers, upload_len);
        let Some(view) = self.composite_views.get_mut(key) else { return; };
        churn_probe::write_buffer(&self.queue, &view.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        let Some(layers) = view.layers.as_mut() else { return; };
        view.wants_mips = layers_want_mips(&self.layer_upload_scratch[..filled]);
        let grown = upload_composite_layers(
            &self.device,
            &self.queue,
            &self.layer_upload_scratch[..upload_len],
            filled,
            CompositeLayerState {
                layer_buffer: &layers.layer_buffer,
                pool: &mut layers.pool,
                tile_buffer: &layers.tile_buffer,
                layer_last: &mut layers.layer_last,
                mesh_cell_bounds_last: &mut layers.mesh_cell_bounds_last,
                tile_last: &mut layers.tile_last,
            },
            &mut self.layer_pack_scratch,
            &mut self.mesh_cell_bounds_scratch,
            &mut self.layer_tile_scratch,
        );
        if grown {
            view.bind_group = build_scene_bind_group(
                &self.device,
                &self.scene_bind_group_layout,
                &view.uniform_buffer,
                &layers.layer_buffer,
                &layers.pool.buffer,
                &self.source_preview_buffer,
                &self.compositor_sampler,
                &self.paint_mask_view,
                &layers.tile_buffer,
            );
        }
    }

    /// Copy `scene_layers` into the upload scratch as the compositor reads
    /// them. Returns (layers filled, slots to upload).
    fn stage_layer_upload(&mut self, scene_layers: &[LayerGpu], layers_seen: u32) -> (usize, usize) {
        // Only the slots the compositor will actually read need to reach the
        // GPU: `heartbeat.wgsl` walks `for i in 0..64 { if f32(i) >= layer_count
        // { break } ... }`, so anything at or beyond `layer_count` is dead.
        // Write `layers_seen` slots (and at least as many as the caller handed
        // us), zero-filling any tail inside that prefix exactly as the old
        // full-array upload did.
        let filled = scene_layers.len().min(MAX_SCENE_LAYERS);
        let upload_len = (layers_seen as usize).max(filled).min(MAX_SCENE_LAYERS);
        fit_layer_upload_scratch(&mut self.layer_upload_scratch, upload_len);
        for (slot, layer) in self.layer_upload_scratch[..filled]
            .iter_mut()
            .zip(scene_layers.iter())
        {
            *slot = *layer;
            slot.cull = layer_cull_bounds(layer);
        }
        for slot in &mut self.layer_upload_scratch[filled..upload_len] {
            *slot = LayerGpu::zeroed();
        }
        (filled, upload_len)
    }

    /// Make (or refit) the buffers and bind group of composite view `key`.
    fn ensure_composite_view(&mut self, key: &str, own_layers: bool, upload_len: usize) {
        let epoch = self.frame_epoch;
        let slots_needed = upload_len.max(1);
        let rebuild = match self.composite_views.get_mut(key) {
            Some(view) if view.layers.is_some() == own_layers => {
                view.used_epoch = epoch;
                let grow = view.layers.as_ref().is_some_and(|layers| layers.slots < slots_needed);
                grow || view.scene_bindings_generation != self.scene_bindings_generation
            }
            _ => {
                self.composite_views.remove(key);
                true
            }
        };
        if !rebuild {
            return;
        }
        let existing = self.composite_views.remove(key);
        let uniform_buffer = existing.as_ref().map(|view| view.uniform_buffer.clone()).unwrap_or_else(|| {
            self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Ghost Render Core View Uniforms"),
                size: std::mem::size_of::<Uniforms>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        let layers = own_layers.then(|| {
            match existing.and_then(|view| view.layers) {
                Some(layers) if layers.slots >= slots_needed => layers,
                previous => {
                    // Grown in powers of two, so a scene that adds layers
                    // one by one reallocates a handful of times.
                    let slots = slots_needed.next_power_of_two().min(MAX_SCENE_LAYERS);
                    let layer_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("Ghost Render Core View Layers"),
                        size: (slots * std::mem::size_of::<LayerCoreGpu>()) as u64,
                        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                        mapped_at_creation: false,
                    });
                    // Tiles and mesh bounds keep their contents: only the
                    // layer array is new and has to be sent again.
                    match previous {
                        Some(previous) => CompositeViewLayers {
                            layer_buffer,
                            slots,
                            layer_last: Vec::new(),
                            pool: LayerPoolState { core_last: Vec::new(), ..previous.pool },
                            ..previous
                        },
                        None => CompositeViewLayers {
                            layer_buffer,
                            slots,
                            pool: LayerPoolState::new(&self.device, "Ghost Render Core View Layer Pool"),
                            // Zeroed like the program's: binning off and
                            // no mesh boxes until the first upload.
                            tile_buffer: self.device.create_buffer(&wgpu::BufferDescriptor {
                                label: Some("Ghost Render Core View Layer Tiles"),
                                size: ((LAYER_TILE_BUFFER_WORDS + MESH_CELL_BOUNDS_WORDS) * std::mem::size_of::<u32>()) as u64,
                                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                                mapped_at_creation: false,
                            }),
                            layer_last: Vec::new(),
                            mesh_cell_bounds_last: Vec::new(),
                            tile_last: Vec::new(),
                        },
                    }
                }
            }
        });
        let (layer_buffer, pool_buffer, tile_buffer) = match layers.as_ref() {
            Some(layers) => (&layers.layer_buffer, &layers.pool.buffer, &layers.tile_buffer),
            None => (&self.layer_buffer, &self.layer_pool.buffer, &self.layer_tile_buffer),
        };
        let bind_group = build_scene_bind_group(
            &self.device,
            &self.scene_bind_group_layout,
            &uniform_buffer,
            layer_buffer,
            pool_buffer,
            &self.source_preview_buffer,
            &self.compositor_sampler,
            &self.paint_mask_view,
            tile_buffer,
        );
        self.composite_views.insert(key.to_string(), CompositeView {
            uniform_buffer,
            layers,
            bind_group,
            wants_mips: false,
            scene_bindings_generation: self.scene_bindings_generation,
            used_epoch: epoch,
        });
    }

    /// Let go of views not drawn for a while (a closed Screen, a finished
    /// recording, deck monitors gone idle).
    fn prune_composite_views(&mut self) {
        let epoch = self.frame_epoch;
        self.composite_views.retain(|_, view| epoch.wrapping_sub(view.used_epoch) <= COMPOSITE_VIEW_KEEP_FRAMES);
    }

    fn create_paint_mask_texture(device: &wgpu::Device, size: u32, layers: u32) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Paint Masks"),
            size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: layers },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    }

    /// Make the paint-mask array `size`² with room for `slots` layers
    /// (grown in powers of two). True when the texture was recreated and
    /// every mask has to be uploaded again.
    fn ensure_paint_mask_capacity(&mut self, size: u32, slots: usize) -> bool {
        let slots = (slots.max(1) as u32).next_power_of_two().min(paint_mask::PAINT_MASK_MAX_SLOTS as u32);
        if self.paint_mask_size == size && self.paint_mask_layers >= slots {
            return false;
        }
        let layers = if self.paint_mask_size == size { slots.max(self.paint_mask_layers) } else { slots };
        self.paint_mask_texture = Self::create_paint_mask_texture(&self.device, size, layers);
        self.paint_mask_size = size;
        self.paint_mask_layers = layers;
        let paint_mask_view = self.paint_mask_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Paint Mask View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        self.paint_mask_view = paint_mask_view;
        self.rebind_program_scene();
        true
    }

    /// Rebuild the program's scene bind group (a buffer or view in it was
    /// replaced) and have every composite view rebuild its own.
    fn rebind_program_scene(&mut self) {
        self.bind_group = build_scene_bind_group(
            &self.device,
            &self.scene_bind_group_layout,
            &self.uniform_buffer,
            &self.layer_buffer,
            &self.layer_pool.buffer,
            &self.source_preview_buffer,
            &self.compositor_sampler,
            &self.paint_mask_view,
            &self.layer_tile_buffer,
        );
        self.scene_bindings_generation = self.scene_bindings_generation.wrapping_add(1);
    }

    fn write_paint_mask(&self, upload: &paint_mask::PaintMaskUpload) {
        if upload.slot as u32 >= self.paint_mask_layers
            || upload.rect.x1 > self.paint_mask_size
            || upload.rect.y1 > self.paint_mask_size
            || upload.bytes.len() != (upload.rect.width() * upload.rect.height()) as usize
        {
            return;
        }
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.paint_mask_texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: upload.rect.x0, y: upload.rect.y0, z: upload.slot as u32 },
                aspect: wgpu::TextureAspect::All,
            },
            &upload.bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(upload.rect.width()),
                rows_per_image: Some(upload.rect.height()),
            },
            wgpu::Extent3d { width: upload.rect.width(), height: upload.rect.height(), depth_or_array_layers: 1 },
        );
    }

    /// Layers placed on the dome get their own pass while a dome output is
    /// on: route them there (dlayer, which also tells the canvas composite
    /// to skip them) and keep the output presenter's dome picture sized to
    /// the composition's long side.
    fn sync_dome_layers(&mut self, stage: &OutputStage, scene_layers: &[LayerGpu]) {
        let dome = stage.dome0;
        let routed = dome[0] > 0.5 && scene_layers.iter().any(|layer| layer.fast_flags[2] == 1);
        self.dome_layer_pass = if routed { [1.0, dome[1], dome[2], 0.0] } else { [0.0; 4] };
        let size = routed.then(|| self.config.width.max(self.config.height).clamp(1024, 4096));
        self.output_presenter.set_dome_layers(&self.device, &self.composite_frame_textures, size);
    }

    /// The compositor's dome pass (draw instance 1, see fs_main).
    fn draw_dome_layers(&self, encoder: &mut wgpu::CommandEncoder) {
        if self.dome_layer_pass[0] < 0.5 {
            return;
        }
        let Some(view) = self.output_presenter.dome_layers_view() else {
            return;
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Ghost Render Core Dome Layers Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(self.compositor_pipeline_for(self.program_wants_mips));
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_bind_group(1, &self.source_frames_bind_group, &[]);
        pass.draw(0..3, 1..2);
    }

    /// The compositor build to draw with: with source mips when the layers
    /// want them and that build is ready, otherwise the lean one.
    fn compositor_pipeline_for(&self, source_mips: bool) -> &wgpu::RenderPipeline {
        if source_mips {
            if let Some(pipeline) = self.mips_pipeline.get() {
                return pipeline;
            }
        }
        &self.pipeline
    }

    fn draw_fullscreen_to_view(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        label: &'static str,
        timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        self.draw_composite(encoder, &self.bind_group, self.program_wants_mips, view, label, timestamp_writes);
    }

    /// Composite view `key` (written by `write_view_inputs`) into `view`.
    fn draw_composite_view(&self, encoder: &mut wgpu::CommandEncoder, key: &str, view: &wgpu::TextureView, label: &'static str) {
        if let Some(composite) = self.composite_views.get(key) {
            let mips = if composite.layers.is_some() { composite.wants_mips } else { self.program_wants_mips };
            self.draw_composite(encoder, &composite.bind_group, mips, view, label, None);
        }
    }

    fn draw_composite(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        bind_group: &wgpu::BindGroup,
        source_mips: bool,
        view: &wgpu::TextureView,
        label: &'static str,
        timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        // The frame timer (gpu_timing) owns this pass when it times it.
        let pass_time = if timestamp_writes.is_none() { pass_timing::slot(label) } else { None };
        let timestamp_writes = timestamp_writes.or_else(|| pass_timing::render_writes(&pass_time));
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
        pass.set_pipeline(self.compositor_pipeline_for(source_mips));
        pass.set_bind_group(0, bind_group, &[]);
        pass.set_bind_group(1, &self.source_frames_bind_group, &[]);
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

    fn encode_composition_effects(&mut self, encoder: &mut wgpu::CommandEncoder,
        jobs: &[NativeGraphFrameJob], output_index: usize) -> Result<(), String> {
        self.render_native_graph_frame_jobs(encoder, jobs)?;
        self.creative_frame_index = if jobs.is_empty() { 0 } else { output_index.min(COMPOSITE_FRAME_SLOTS - 1) };
        Ok(())
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
        frozen: bool,
        output_gate: f32,
        post_effects: &[[f32; 4]],
        composite_graph_jobs: &[NativeGraphFrameJob],
        composite_output_index: usize,
        stage: OutputStage,
        mirror_mesh: Option<Arc<MirrorMesh>>,
    ) -> Result<(), String> {
        if let Some(mesh) = mirror_mesh.as_ref() {
            self.prepare_mirror_mesh(mesh);
        }
        self.refresh_source_frame_bind_groups();
        self.sync_dome_layers(&stage, scene_layers);
        let stage = OutputStage { dlayer: self.dome_layer_pass, ..stage };
        self.allow_async_compile = false;
        self.frame_uniform_cursor = 0;
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
            1.0,
            post_effects,
            OutputStage { dlayer: self.dome_layer_pass, ..OutputStage::default() },
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
        if !frozen && output_gate > 0.0 {
        self.draw_fullscreen_to_view(
            &mut encoder,
            &gpu_object_cache::view(&self.composite_frame_textures[0], &Default::default()),
            "Ghost Render Core Snapshot Pass",
            timestamp_writes,
        );
        self.encode_composition_effects(&mut encoder, composite_graph_jobs, composite_output_index)?;
        let creative_view = gpu_object_cache::view(&self.composite_frame_textures[self.creative_frame_index], &Default::default());
        self.draw_stage3d_mesh_to_view(
            &mut encoder,
            &creative_view,
            "Ghost Render Core Stage3D Mesh Snapshot Pass",
            time_seconds,
            stage3d_mesh_frame,
        );
        self.draw_stage3d_overlay_to_view(
            &mut encoder,
            &creative_view,
            "Ghost Render Core Stage3D Snapshot Overlay Pass",
            time_seconds,
            stage3d_overlay_items,
        );
        self.draw_dome_layers(&mut encoder);
        }
        if let Some(mesh) = mirror_mesh.as_ref() {
            self.draw_mirror_dome(&mut encoder, &self.snapshot_view, self.config.width, self.config.height,
                output_gate, stage, time_seconds.unwrap_or(0.0), &mesh.id);
        } else {
            self.output_presenter.draw(&self.queue, &mut encoder, &self.snapshot_view,
                self.creative_frame_index, self.config.width, self.config.height,
                output_gate, stage, time_seconds.unwrap_or(0.0));
        }
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                gpu_timing.resolve_to_readback(&mut encoder);
            }
        }
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.begin_graph_readbacks();
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
        composite_graph_jobs: &[NativeGraphFrameJob],
        composite_output_index: usize,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        present_surface: bool,
        frozen: bool,
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) -> Result<SurfacePresentOutcome, String> {
        // Outputs recorded after the last frame's program (none, normally:
        // finish_frame sends them) go first; then the presenter's uniform
        // slots are free to reuse.
        self.submit_outputs();
        self.output_presenter.begin_frame();
        self.refresh_source_frame_bind_groups();
        self.sync_dome_layers(&stage, scene_layers);
        let stage = OutputStage { dlayer: self.dome_layer_pass, ..stage };
        let mut present_outcome = SurfacePresentOutcome::Offscreen;
        let surface_frame = if present_surface {
            let acquire_started = Instant::now();
            let acquired = self.surface.get_current_texture();
            self.pacing.acquired(acquire_started, Instant::now());
            match acquired {
                wgpu::CurrentSurfaceTexture::Success(frame) => {
                    present_outcome = SurfacePresentOutcome::Presented;
                    Some(frame)
                }
                wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                    // Present this valid frame first; configuring while it is
                    // acquired panics on Vulkan after resize/fullscreen changes.
                    present_outcome = SurfacePresentOutcome::SuboptimalPresented;
                    Some(frame)
                }
                wgpu::CurrentSurfaceTexture::Outdated => {
                    self.surface.configure(&self.device, &self.config);
                    present_outcome = SurfacePresentOutcome::Outdated;
                    None
                }
                wgpu::CurrentSurfaceTexture::Timeout => {
                    present_outcome = SurfacePresentOutcome::Timeout;
                    None
                }
                wgpu::CurrentSurfaceTexture::Occluded => {
                    // Shared output must keep advancing even when the native
                    // window is covered/minimized or cannot acquire a drawable.
                    present_outcome = SurfacePresentOutcome::Occluded;
                    None
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
            1.0,
            post_effects,
            OutputStage { dlayer: self.dome_layer_pass, ..OutputStage::default() },
        );
        let mut mirror_encoder =
            self.device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Ghost Render Core Output Mirror Encoder"),
                });
        // Time only frames that start on an idle GPU. A frame queued behind
        // another one has its first timestamp taken while that one is still
        // drawing, which read about twice the real GPU time and would make
        // the quality policy see a different number for the same work. At
        // one frame in flight every frame starts on an idle GPU, as before.
        let should_record_timing = self.gpu_idle_for_frame()
            && self
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
        if !frozen && output_gate > 0.0 {
        // Check the whole frame before any graph mutates simulation state.
        self.frame_uniform_cursor = 0;
        if !frozen && output_gate > 0.0 { self.admit_graph_jobs(native_graph_jobs.iter().chain(composite_graph_jobs.iter()))?; }
        self.render_native_graph_frame_jobs(&mut mirror_encoder, native_graph_jobs)?;
        // A graph that renders into a slot for the first time creates that
        // slot's texture while encoding (per-source store). Rebind before
        // compositing, or this frame reads the empty placeholder (a black
        // flash on a Screen that just switched to a crossfade copy).
        self.refresh_source_frame_bind_groups();
        let mirror_timestamp_writes = if should_record_timing && !record_full_frame_timing {
            self.gpu_timing
                .as_ref()
                .map(GpuTimingState::timestamp_writes)
        } else {
            None
        };
        self.draw_fullscreen_to_view(
            &mut mirror_encoder,
            &gpu_object_cache::view(&self.composite_frame_textures[0], &Default::default()),
            "Ghost Render Core Output Mirror Pass",
            mirror_timestamp_writes,
        );
        self.encode_composition_effects(&mut mirror_encoder, composite_graph_jobs, composite_output_index)?;
        let creative_view = gpu_object_cache::view(&self.composite_frame_textures[self.creative_frame_index], &Default::default());
        self.draw_stage3d_mesh_to_view(
            &mut mirror_encoder,
            &creative_view,
            "Ghost Render Core Stage3D Mesh Output Mirror Pass",
            time_seconds,
            stage3d_mesh_frame,
        );
        self.draw_stage3d_overlay_to_view(
            &mut mirror_encoder,
            &creative_view,
            "Ghost Render Core Stage3D Output Mirror Overlay Pass",
            time_seconds,
            stage3d_overlay_items,
        );
        self.draw_dome_layers(&mut mirror_encoder);
        }
        self.output_presenter.draw(&self.queue, &mut mirror_encoder, &self.output_mirror_view,
            self.creative_frame_index, self.config.width, self.config.height,
            output_gate, stage, time_seconds.unwrap_or(0.0));
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.refresh_output_export(&mut mirror_encoder);
        #[cfg(target_os = "macos")]
        self.capture_native_recording_frame(&mut mirror_encoder);
        self.capture_texture_share_frame(&mut mirror_encoder);
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
                self.composite_frame_blitter.copy(&self.device, &mut mirror_encoder,
                    &self.output_mirror_view, &view);
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
        pass_timing::resolve(&mut mirror_encoder);
        self.submit_frame(mirror_encoder);
        pass_timing::after_submit();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.encode_native_recording_frame();
        self.texture_share_submitted();
        if !frozen && output_gate > 0.0 {
            self.mark_graph_frames_submitted(native_graph_jobs.iter().flat_map(|job| job.render_plans.iter()).filter_map(|plan| match plan.target {
                NativeComputeGraphRenderTarget::SourceFrame { slot, .. } => Some(slot), _ => None,
            }));
        }
        self.begin_graph_readbacks();
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_mut() {
                gpu_timing.begin_readback();
            }
        }
        if let Some(frame) = surface_frame {
            self.queue.present(frame);
            self.pacing.presented(Instant::now());
            if matches!(present_outcome, SurfacePresentOutcome::SuboptimalPresented) {
                self.surface.configure(&self.device, &self.config);
            }
        }
        self.last_frame_error = None;
        Ok(present_outcome)
    }
}

/// The deck monitors' texture width a caller may ask for: even, and between a
/// small pane's 240 and a full-HD tile's 1920.
fn deck_monitor_width(requested: u64) -> u32 {
    (requested.clamp(240, 1920) as u32) & !1
}

/// The deck monitors' texture size for the requested width on an output of
/// this shape: the output's aspect at that width, scaled down as a whole when
/// it would be more than 1024 tall (a portrait project), never squashed.
fn deck_monitor_size(width: u32, output: (u32, u32)) -> (u32, u32) {
    const MAX_HEIGHT: u64 = 1024;
    let (out_w, out_h) = (u64::from(output.0.max(1)), u64::from(output.1.max(1)));
    let width = u64::from(width);
    let height = width * out_h / out_w;
    let (width, height) = if height > MAX_HEIGHT {
        ((MAX_HEIGHT * out_w / out_h) & !1, MAX_HEIGHT)
    } else {
        (width, height)
    };
    (width.max(16) as u32, height.max(16) as u32)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    churn_probe::init();
    let mut builder = EventLoop::<UserEvent>::with_user_event();
    #[cfg(target_os = "macos")]
    {
        use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
        builder.with_activation_policy(ActivationPolicy::Accessory)
            .with_default_menu(false).with_activate_ignoring_other_apps(false);
    }
    // Linux: run on X11 (XWayland under a Wayland session). Screens are
    // presented as X11 children of Electron's Screen windows, which only works
    // when both processes speak X11; winit would otherwise pick Wayland
    // whenever WAYLAND_DISPLAY is set. GA_LINUX_WAYLAND=1 opts out, at the
    // cost of native Screens.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    if linux_x11_presentation() {
        use winit::platform::x11::EventLoopBuilderExtX11;
        builder.with_x11();
    }
    let event_loop = builder.build()?;
    let proxy = event_loop.create_proxy();
    let (response_tx, response_rx) = mpsc::channel::<String>();
    let fast_path = Arc::new(RpcFastPath::new());
    spawn_stdout_writer(response_rx);
    spawn_stdin_reader(proxy.clone(), response_tx.clone(), Arc::clone(&fast_path));

    // Decoded clip audio left behind by cores that were killed.
    thread::spawn(|| {
        clip_audio::sweep_stale_temp_dirs(&std::env::temp_dir(), std::time::SystemTime::now(),
            clip_audio::STALE_AFTER, clip_audio::process_alive);
    });
    let mut app = App::new(response_tx, proxy, fast_path);
    event_loop.run_app(&mut app)?;
    Ok(())
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
            .map(|slot| (slot + 1) as f32)
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

/// A layer's Edge Effects as the compositor reads them: resolved effect
/// values, the stroke centerline in output px and the per-shape data the
/// structural types use.
#[derive(Clone, Debug, Default)]
struct LayerEdgeEffects {
    effects: Vec<[[f32; 4]; LAYER_EDGE_EFFECT_VEC4S]>,
    /// (x px, y px, arc length px, surface scale)
    points: Vec<[f32; 4]>,
    /// (x px, y px, arc length px, point index)
    corners: Vec<[f32; 4]>,
    diagonals: Vec<[f32; 2]>,
    /// (centroid x, centroid y, perimeter, inradius), px
    geometry: [f32; 4],
    seed: f32,
    /// Output UV rectangle the stack can touch.
    bounds: [f32; 4],
}

impl LayerEdgeEffects {
    fn active(&self) -> bool {
        !self.effects.is_empty() && self.points.len() >= 3
    }

    fn effects_gpu(&self) -> [[[f32; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS] {
        let mut packed = [[[0.0; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS];
        if self.active() {
            for (slot, effect) in packed.iter_mut().zip(self.effects.iter()) {
                *slot = *effect;
            }
        }
        packed
    }

    fn info_gpu(&self) -> [f32; 4] {
        if !self.active() {
            return [0.0; 4];
        }
        [
            self.points.len() as f32,
            self.effects.len() as f32,
            self.corners.len() as f32,
            self.diagonals.len() as f32,
        ]
    }

    fn bbox_gpu(&self) -> [f32; 4] {
        let mut bbox = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for point in &self.points {
            bbox[0] = bbox[0].min(point[0]);
            bbox[1] = bbox[1].min(point[1]);
            bbox[2] = bbox[2].max(point[0]);
            bbox[3] = bbox[3].max(point[1]);
        }
        if self.points.is_empty() { [0.0; 4] } else { bbox }
    }

    /// Bounds of each run of 16 segments (segment i joins point i to i + 1,
    /// the last one closes the outline).
    fn chunks_gpu(&self) -> [[f32; 4]; MAX_LAYER_EDGE_CHUNKS] {
        let mut chunks = [[0.0; 4]; MAX_LAYER_EDGE_CHUNKS];
        let count = self.points.len();
        if count < 3 {
            return chunks;
        }
        for (chunk_index, chunk) in chunks.iter_mut().enumerate() {
            let start = chunk_index * LAYER_EDGE_CHUNK;
            if start >= count {
                break;
            }
            let mut bbox = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
            for index in start..(start + LAYER_EDGE_CHUNK).min(count) {
                for point in [self.points[index], self.points[(index + 1) % count]] {
                    bbox[0] = bbox[0].min(point[0]);
                    bbox[1] = bbox[1].min(point[1]);
                    bbox[2] = bbox[2].max(point[0]);
                    bbox[3] = bbox[3].max(point[1]);
                }
            }
            *chunk = bbox;
        }
        chunks
    }

    fn corners_gpu(&self) -> [[f32; 4]; MAX_LAYER_EDGE_CORNERS] {
        let mut packed = [[0.0; 4]; MAX_LAYER_EDGE_CORNERS];
        for (slot, corner) in packed.iter_mut().zip(self.corners.iter()) {
            *slot = *corner;
        }
        packed
    }

    fn diagonals_gpu(&self) -> [[f32; 4]; MAX_LAYER_EDGE_DIAGONALS / 2] {
        let mut packed = [[0.0; 4]; MAX_LAYER_EDGE_DIAGONALS / 2];
        for (index, pair) in self.diagonals.iter().enumerate() {
            packed[index / 2][(index % 2) * 2] = pair[0];
            packed[index / 2][(index % 2) * 2 + 1] = pair[1];
        }
        packed
    }

    fn points_gpu(&self) -> [[f32; 4]; MAX_LAYER_EDGE_POINTS] {
        let mut packed = [[0.0; 4]; MAX_LAYER_EDGE_POINTS];
        for (slot, point) in packed.iter_mut().zip(self.points.iter()) {
            *slot = *point;
        }
        packed
    }
}

/// `set_layer_edge_effects`: up to 16 effects of 22 resolved vec4s each and
/// the stroke centerline they are drawn on (output px, y up, up to 512
/// points with arc length and surface scale), its corners and inner
/// diagonals, (centroid, perimeter, inradius), a seed, and the output UV
/// rectangle the stack can touch. Without a centerline nothing renders:
/// there is no edge to draw on.
fn parse_layer_edge_effects(command: &Value) -> LayerEdgeEffects {
    let mut parsed = LayerEdgeEffects::default();
    let finite = |value: Option<&Value>, limit: f64| {
        value
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .unwrap_or(0.0)
            .clamp(-limit, limit) as f32
    };
    let vec4_at = |value: &Value, limit: f64| -> [f32; 4] {
        let mut out = [0.0f32; 4];
        if let Some(values) = value.as_array() {
            for (component, slot) in out.iter_mut().enumerate() {
                *slot = finite(values.get(component), limit);
            }
        }
        out
    };
    if let Some(effects) = command.get("edge_effects").and_then(Value::as_array) {
        for effect in effects.iter() {
            if parsed.effects.len() >= MAX_LAYER_EDGE_EFFECTS {
                break;
            }
            let Some(vectors) = effect.as_array() else {
                continue;
            };
            let mut packed = [[0.0f32; 4]; LAYER_EDGE_EFFECT_VEC4S];
            for (vector_index, vector) in vectors.iter().take(LAYER_EDGE_EFFECT_VEC4S).enumerate() {
                packed[vector_index] = vec4_at(vector, 1.0e6);
            }
            if packed[0][0] < 0.5 {
                continue;
            }
            parsed.effects.push(packed);
        }
    }
    if let Some(points) = command.get("edge_outline").and_then(Value::as_array) {
        for point in points.iter().take(MAX_LAYER_EDGE_POINTS) {
            let mut value = vec4_at(point, 1.0e6);
            if point.as_array().map(|values| values.len() < 4).unwrap_or(true) {
                value[3] = 1.0;
            }
            parsed.points.push(value);
        }
    }
    let count = parsed.points.len();
    if let Some(corners) = command.get("edge_corners").and_then(Value::as_array) {
        for corner in corners.iter().take(MAX_LAYER_EDGE_CORNERS) {
            parsed.corners.push(vec4_at(corner, 1.0e6));
        }
    }
    if let Some(diagonals) = command.get("edge_diagonals").and_then(Value::as_array) {
        let corners = parsed.corners.len() as f32;
        for pair in diagonals.iter().take(MAX_LAYER_EDGE_DIAGONALS) {
            let value = vec4_at(pair, 1.0e6);
            let (a, b) = (value[0].round(), value[1].round());
            if a >= 0.0 && b >= 0.0 && a < corners && b < corners {
                parsed.diagonals.push([a, b]);
            }
        }
    }
    if let Some(geometry) = command.get("edge_geometry") {
        parsed.geometry = vec4_at(geometry, 1.0e6);
    }
    parsed.seed = finite(command.get("edge_seed"), 1.0e6);
    if let Some(bounds) = command.get("edge_bounds") {
        let bounds = vec4_at(bounds, 5.0);
        parsed.bounds = [bounds[0].max(-4.0), bounds[1].max(-4.0), bounds[2], bounds[3]];
    }
    if count < 3 {
        parsed.effects.clear();
        parsed.points.clear();
        parsed.corners.clear();
        parsed.diagonals.clear();
    }
    parsed
}

/* ============================================================== */
/* SMOKE RIDERS — coupled fluid + rider instrument                 */
/* ============================================================== */
// Mirrors src/lib/renderer/shaders/webgpuSmokeRidersShader.ts. The WGSL
// itself ships from TS through `precompile_shader`; only the graph shape
// and the uniform packing live here, and both sides must agree byte for
// byte or the same shader would read different numbers depending on
// which builder installed the graph.

/* ── shadow volume geometry (shared by BOTH rider kinds) ────────── */
// Mirrors `ridersShadowDim` / `ridersSpotCos` / `ridersSpotBlend` /
// `ridersShadowFrame` / `ridersShadowExtinction` in
// src/lib/renderer/shaders/webgpuSmokeRidersShader.ts. The two packers
// must stay byte-identical, so these must stay value-identical.

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

/// Which picture-slot store this device gets. `GA_SOURCE_FRAMES=shared`
/// forces the shared array (to exercise the fallback on capable GPUs).
fn choose_source_frame_mode(features: wgpu::Features, bindings: usize) -> SourceFrameMode {
    let forced_shared = std::env::var("GA_SOURCE_FRAMES")
        .is_ok_and(|value| value.trim().eq_ignore_ascii_case("shared"));
    if !forced_shared && features.contains(PER_SOURCE_SLOT_FEATURES) && bindings >= INITIAL_SOURCE_FRAME_SLOTS {
        SourceFrameMode::PerSource
    } else {
        SourceFrameMode::Shared
    }
}

/// Most layers the shared array may grow to: the device's array-layer limit,
/// and twice the tier's slot budget at this slot size.
fn shared_source_frame_slot_ceiling(
    limits: &wgpu::Limits,
    size: usize,
    format: wgpu::TextureFormat,
    quality_policy: &str,
    features: wgpu::Features,
) -> usize {
    let tier = source_frame_tier_for_policy(quality_policy, native_quality_tier(limits, features));
    let texel = if format == SOURCE_FRAME_FORMAT_HDR { 8 } else { 4 };
    let per_slot = source_frame_slot_bytes(size, texel).max(1);
    let by_budget = source_frame_size_budget_bytes(tier).saturating_mul(2) / per_slot;
    by_budget
        .min(limits.max_texture_array_layers as usize)
        .max(INITIAL_SOURCE_FRAME_SLOTS)
}

/// The compositor shader with the picture-slot readers for this store.
/// The compositor shader for a picture store. `source_mips` builds in the
/// per-pixel mip level of minified pictures (heartbeat.wgsl SOURCE_MIPS);
/// without it that code is compiled out, so frames that need no mips pay
/// nothing for it.
fn heartbeat_wgsl(mode: SourceFrameMode, bindings: usize, source_mips: bool) -> String {
    let body = include_str!("heartbeat.wgsl").replace(
        "//#SOURCE_FRAMES",
        &source_frames::compositor_source_frames_wgsl(mode, 1, 0, bindings),
    );
    format!("{}const SOURCE_MIPS: bool = {source_mips};\n{body}", source_frames::source_frames_enable(mode))
}

/// The compositor pipeline over `shader`'s fs_main.
fn compositor_pipeline(device: &wgpu::Device, layout: &wgpu::PipelineLayout, shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat, label: &str) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: pipeline_cache::for_device(device).as_ref(),
    })
}

fn stage3d_mesh_wgsl(mode: SourceFrameMode, bindings: usize) -> String {
    let body = STAGE3D_MESH_WGSL.replace(
        "//#SOURCE_FRAMES",
        &source_frames::compositor_source_frames_wgsl(mode, 1, 0, bindings),
    );
    format!("{}{body}", source_frames::source_frames_enable(mode))
}

/// The resource behind a `source_frames` binding: the shared array view, or
/// one view per slot. `views` keeps the per-slot views alive for the call.
fn source_frames_views(store: &SourceFrameStore, bindings: usize) -> Vec<wgpu::TextureView> {
    match store.mode() {
        SourceFrameMode::Shared => vec![store.shared_array_view().expect("shared source-frame array")],
        SourceFrameMode::PerSource => store.binding_array_views(bindings),
    }
}

fn source_frames_resource<'a>(
    mode: SourceFrameMode,
    views: &'a [wgpu::TextureView],
    refs: &'a [&'a wgpu::TextureView],
) -> wgpu::BindingResource<'a> {
    match mode {
        SourceFrameMode::Shared => wgpu::BindingResource::TextureView(&views[0]),
        SourceFrameMode::PerSource => wgpu::BindingResource::TextureViewArray(refs),
    }
}

fn build_source_frames_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    store: &SourceFrameStore,
    bindings: usize,
) -> wgpu::BindGroup {
    let views = source_frames_views(store, bindings);
    let refs = views.iter().collect::<Vec<_>>();
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Ghost Render Core Source Frames"),
        layout,
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: source_frames_resource(store.mode(), &views, &refs) }],
    })
}

fn build_scene_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    layer_buffer: &wgpu::Buffer,
    layer_pool_buffer: &wgpu::Buffer,
    source_preview_buffer: &wgpu::Buffer,
    sampler: &wgpu::Sampler,
    paint_mask_view: &wgpu::TextureView,
    layer_tile_buffer: &wgpu::Buffer,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Ghost Render Core Bind Group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: layer_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 2, resource: source_preview_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::Sampler(sampler) },
            wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::TextureView(paint_mask_view) },
            wgpu::BindGroupEntry { binding: 6, resource: layer_tile_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 7, resource: layer_pool_buffer.as_entire_binding() },
        ],
    })
}

fn build_stage3d_mesh_bind_group(
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
        512,
        256,
        128,
    ]
    .into_iter()
    .filter(|size| *size <= target)
    .filter(|size| *size <= max_dimension)
    .find(|size| estimate_source_frame_texture_bytes(*size, bytes_per_texel) <= budget_bytes)
    .unwrap_or(128.min(max_dimension.max(1)))
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

/// GA_CORE_SOURCE_MIPS=1 turns on mip reads of minified pictures. Off by
/// default: they soften shimmer but cost frame time while a minified picture
/// is on screen, so they stay opt-in until judged on real shows.
fn source_mips_enabled() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| {
        std::env::var("GA_CORE_SOURCE_MIPS")
            .map_or(false, |value| matches!(value.trim(), "1" | "on" | "true" | "yes"))
    })
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
        "ultra" => 768usize,
        // The sizing estimate (the first 48 shared slots with mips, plus two
        // stores of the same depth) is ~704 MiB at 1024 RGBA8; retain SDR
        // resolution during clip fades.
        "balanced" => 768usize,
        "performance" => 768usize,
        _ => 256usize,
    };
    mb * 1024 * 1024
}

/// One shared-array slot: every mip level.
fn source_frame_slot_bytes(size: usize, bytes_per_texel: usize) -> usize {
    (0..source_frame_mip_levels(size))
        .map(|level| (size >> level).max(1).pow(2))
        .sum::<usize>()
        .saturating_mul(bytes_per_texel)
}

/// Slot sizing budget: the shared array at its starting size with mips, and
/// room for two more stores of the same depth. The scratch stores are now
/// smaller, but keeping the original estimate keeps the slot edge (and so the
/// cost of every generated picture) where it was.
fn estimate_source_frame_texture_bytes(size: usize, bytes_per_texel: usize) -> usize {
    let base = size.saturating_mul(size).saturating_mul(bytes_per_texel).saturating_mul(INITIAL_SOURCE_FRAME_SLOTS);
    let mip_pixels: usize = (0..source_frame_mip_levels(size)).map(|level| (size >> level).max(1).pow(2)).sum();
    base.saturating_add(mip_pixels.saturating_mul(bytes_per_texel).saturating_mul(INITIAL_SOURCE_FRAME_SLOTS).saturating_mul(2))
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
    // Effect passes preserve straight RGBA (including decoded HAP alpha).
    // GPU instruments use premultiplied coverage; treating effect output as
    // one of those divides RGB by alpha a second time and washes it out.
    if source_type == "image" && uri.is_some_and(|value| value.starts_with("native-effect-pass://")) {
        return "image".to_string();
    }
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

/// What an editor preview asked for: how big, and how to send it.
///
/// `width`/`height` give the size on screen, so a 16:9 preview is not read
/// back as the square source texture; without them `max_dim` scales the crop
/// uniformly as before. `encoding: "jpeg"` sends a JPEG a twentieth the size
/// of the raw pixels (no alpha: the frame as it looks over black).
#[derive(Clone, Debug, PartialEq)]
struct SourcePreviewRequest {
    width: Option<u32>,
    height: Option<u32>,
    max_dim: u32,
    jpeg_quality: Option<u8>,
    include_pixels: bool,
}

impl SourcePreviewRequest {
    fn from_params(params: &Value) -> Self {
        let dimension = |key: &str| number_at(params, &[key])
            .filter(|value| value.is_finite() && *value >= 1.0)
            .map(|value| value.round().clamp(16.0, 1024.0) as u32);
        let jpeg = string_at(params, &["encoding"]).is_some_and(|value| value.eq_ignore_ascii_case("jpeg"));
        Self {
            width: dimension("width"),
            height: dimension("height"),
            max_dim: number_at(params, &["max_dim"]).unwrap_or(640.0).clamp(64.0, 1024.0) as u32,
            jpeg_quality: jpeg.then(|| number_at(params, &["quality"]).unwrap_or(82.0).clamp(30.0, 95.0) as u8),
            include_pixels: bool_at(params, &["include_pixels"]).unwrap_or(true),
        }
    }

    /// Size to render for a source crop of `width` x `height`. Never larger
    /// than the crop itself.
    fn target_size(&self, width: u32, height: u32) -> (u32, u32) {
        if let (Some(w), Some(h)) = (self.width, self.height) {
            return (w.min(width).max(1), h.min(height).max(1));
        }
        let scale = (self.max_dim as f32 / width.max(height) as f32).min(1.0);
        ((width as f32 * scale).round().max(1.0) as u32, (height as f32 * scale).round().max(1.0) as u32)
    }

    fn encode(&self, frame: &FrameSnapshotReadback) -> Result<Value, String> {
        let Some(quality) = self.jpeg_quality.filter(|_| self.include_pixels) else {
            return Ok(frame.to_json(self.include_pixels));
        };
        let bgra = matches!(frame.format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb);
        let mut rgb = Vec::with_capacity(frame.pixels.len() / 4 * 3);
        for px in frame.pixels.chunks_exact(4) {
            if bgra { rgb.extend_from_slice(&[px[2], px[1], px[0]]); } else { rgb.extend_from_slice(&px[..3]); }
        }
        let mut jpeg = Vec::with_capacity(rgb.len() / 8);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, quality)
            .encode(&rgb, frame.width, frame.height, image::ExtendedColorType::Rgb8)
            .map_err(|err| format!("preview JPEG encode failed: {err}"))?;
        let mut value = frame.to_json(false);
        value["encoding"] = json!("jpeg");
        value["jpeg_bytes"] = json!(jpeg.len());
        value["jpeg_b64"] = json!(base64::engine::general_purpose::STANDARD.encode(&jpeg));
        Ok(value)
    }
}

static LIVE_FRAME_STREAM: Mutex<Option<(u16, String, std::net::TcpStream)>> = Mutex::new(None);

/// Send a frame (`copies` times) to the main process's frame sink over the
/// loopback connection kept for it, and wait for the sink's "OK": the sink
/// answers once the encoder has taken the bytes, so a slow encoder slows the
/// sender instead of piling frames up.
fn send_to_frame_stream(port: u16, token: &str, pixels: &[u8], copies: u64) -> Result<(), String> {
    use std::io::{Read, Write};
    let mut cached = LIVE_FRAME_STREAM.lock().map_err(|_| "frame stream lock poisoned")?;
    if cached.as_ref().is_none_or(|(p, t, _)| *p != port || t != token) {
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        let mut stream = std::net::TcpStream::connect_timeout(&address, Duration::from_secs(2)).map_err(|e| e.to_string())?;
        stream.set_write_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
        stream.set_read_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
        stream.set_nodelay(true).map_err(|e| e.to_string())?;
        stream.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
        *cached = Some((port, token.to_string(), stream));
    }
    let result = (|| -> Result<(), String> {
        let stream = &mut cached.as_mut().unwrap().2;
        for _ in 0..copies { stream.write_all(pixels).map_err(|e| e.to_string())?; }
        let mut ack = [0u8; 2]; stream.read_exact(&mut ack).map_err(|e| e.to_string())?;
        if &ack != b"OK" { return Err("encoder did not accept frame".to_string()); }
        Ok(())
    })();
    if result.is_err() { *cached = None; }
    result
}

/// A frame sink named in an RPC's params: `stream_port` + `stream_token`
/// (from the main process, never the editor: the broker strips them).
fn frame_stream_params(params: &Value) -> Result<Option<(u16, String)>, String> {
    let Some(port) = params.get("stream_port") else { return Ok(None) };
    let port = port.as_u64().filter(|p| *p > 0 && *p <= 65535).ok_or("invalid frame stream port")? as u16;
    let token = params.get("stream_token").and_then(Value::as_str)
        .filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("invalid frame stream token")?.to_string();
    Ok(Some((port, token)))
}
static LIVE_CAPTURE_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static LIVE_DIAGNOSTIC_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static LIVE_PREVIEW_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// One in-flight readback per deck monitor (bank A, bank B) and for the
/// dome's Inside view.
static LIVE_DECK_PREVIEW_BUSY: [std::sync::atomic::AtomicBool; 3] = [
    std::sync::atomic::AtomicBool::new(false),
    std::sync::atomic::AtomicBool::new(false),
    std::sync::atomic::AtomicBool::new(false),
];
struct LiveCapturePermit(&'static std::sync::atomic::AtomicBool);
impl Drop for LiveCapturePermit {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
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

// Preserve the clock phase across ordinary wake-up / media-pump jitter.
// Rebase after a whole missed interval, so a stall never causes catch-up bursts.
fn scheduled_frame_start(deadline: Instant, now: Instant, period: Duration) -> Instant {
    if now.saturating_duration_since(deadline) < period { deadline } else { now }
}

/// A display's refresh rate in Hz. On Windows winit's figure is a whole
/// number (a 59.94 Hz display reads as 59), so the exact one is asked for
/// first; macOS and Linux already report fractional rates.
fn monitor_refresh_hz(monitor: &MonitorHandle) -> Option<f64> {
    #[cfg(target_os = "windows")]
    {
        use winit::platform::windows::MonitorHandleExtWindows;
        if let Some(hz) = windows_display_rate::exact_refresh_hz(&monitor.native_id()) {
            return Some(hz);
        }
    }
    monitor.refresh_rate_millihertz().map(|millihertz| millihertz as f64 / 1000.0)
}

/// The frame rate to draw at for a display: the whole fraction of its refresh
/// rate nearest the target, so every frame stays on screen for the same number
/// of refreshes. A fixed 60 dropped every sixth frame on a 50Hz projector and
/// held frames for alternately two and three refreshes at 144Hz -- both read
/// as stutter however fast the core is.
fn paced_frame_rate(target_fps: u32, refresh_hz: Option<f64>) -> f64 {
    let target = target_fps.max(1) as f64;
    let Some(refresh) = refresh_hz.filter(|hz| hz.is_finite() && *hz >= 20.0 && *hz <= 500.0) else {
        return target;
    };
    let mut best = target;
    let mut best_error = f64::MAX;
    for divisor in 1..=8 {
        let rate = refresh / divisor as f64;
        if rate < 20.0 {
            break;
        }
        let error = (rate - target).abs();
        if error < best_error - 1e-9 {
            best = rate;
            best_error = error;
        }
    }
    best
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum PresentAction {
    RenderNow { next_redraw: Instant },
    WithNextFrame,
}

fn present_action(frames_scheduled: bool, last_redraw: Instant, now: Instant, period: Duration) -> PresentAction {
    if !frames_scheduled {
        return PresentAction::RenderNow { next_redraw: now };
    }
    let due = last_redraw + period;
    if now >= due {
        PresentAction::RenderNow { next_redraw: scheduled_frame_start(due, now, period) }
    } else {
        PresentAction::WithNextFrame
    }
}

/// Draw directly rather than wait on the window: it is minimised (Windows
/// sends it no redraws), or the redraw asked for has not come for two frames.
fn output_redraw_stalled(minimized: bool, requested_at: Instant, now: Instant, period: Duration) -> bool {
    minimized || now.saturating_duration_since(requested_at) >= period * 2
}

#[cfg(test)]
mod manual_video_frame_tests {
    use super::manual_video_frame_time;

    /// At 120 fps a 30 fps clip shows each of its frames on exactly four
    /// render frames, starting when the frame starts (floor), never early.
    #[test]
    fn a_30_fps_clip_at_120_fps_repeats_each_frame_four_times() {
        let mut counts = std::collections::BTreeMap::new();
        for i in 0..1200u32 {
            let t = f64::from(i) / 120.0;
            let shown = (manual_video_frame_time(t, Some(30.0)) * 30.0).round() as i64;
            assert!(f64::from(shown as i32) / 30.0 <= t + 1e-9, "frame {shown} shown early at {t}");
            *counts.entry(shown).or_insert(0) += 1;
        }
        assert!(counts.values().all(|&n| n == 4), "{counts:?}");
        assert_eq!(counts.len(), 300);
    }

    #[test]
    fn ntsc_and_odd_ratios_never_skip_or_go_back() {
        let src = 30000.0 / 1001.0;
        let mut last = -1i64;
        for i in 0..6000u32 {
            let t = f64::from(i) * 1001.0 / 60000.0; // 59.94 render
            let k = (manual_video_frame_time(t, Some(src)) * src).round() as i64;
            assert!(k == last || k == last + 1, "jump {last} -> {k} at frame {i}");
            last = k;
        }
        // 25 fps clip at 120: 4.8 render frames per source frame, 4 or 5 each.
        let mut counts = std::collections::BTreeMap::new();
        for i in 0..1200u32 {
            let k = (manual_video_frame_time(f64::from(i) / 120.0, Some(25.0)) * 25.0).round() as i64;
            *counts.entry(k).or_insert(0) += 1;
        }
        assert!(counts.values().all(|&n| n == 4 || n == 5), "{counts:?}");
        assert_eq!(manual_video_frame_time(1.234, None), 1.234);
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn layer_pools_hold_only_what_layers_use() {
        use super::*;
        let plain = LayerGpu::zeroed();
        let mut masked = LayerGpu::zeroed();
        masked.mask_info = [1.0, 0.0, 0.0, 3.0];
        masked.mask[2] = [0.5, 0.25, 0.0, 0.0];
        let mut cores = Vec::new();
        let mut pool = Vec::new();
        pack_layer_pools(&[plain, masked], false, &mut cores, &mut pool);
        assert_eq!(cores[0].pool, [0; 4]);
        assert_eq!(cores[0].pool2, [0; 4]);
        // Only the mask record follows the shared zero record.
        assert_eq!(pool.len(), POOL_ZERO_LEN + POOL_MASK_LEN);
        let base = cores[1].pool[2] as usize;
        assert_eq!(base, POOL_ZERO_LEN);
        assert_eq!(pool[base], masked.mask_info);
        assert_eq!(pool[base + POOL_MASK_PTS + 2], masked.mask[2]);
        assert!(pool[..POOL_ZERO_LEN].iter().all(|v| *v == [0.0; 4]));
        // Full: every layer carries every record.
        pack_layer_pools(&[plain, masked], true, &mut cores, &mut pool);
        let per_layer = POOL_SHAPE_LEN + POOL_FX_LEN + POOL_MASK_LEN + POOL_MESH_LEN + POOL_EDGE_LEN;
        assert_eq!(pool.len(), POOL_ZERO_LEN + 2 * per_layer);
    }

    #[test]
    fn changed_ranges_send_only_what_differs() {
        use super::changed_ranges;
        let last = vec![0u8; 64];
        let mut new = last.clone();
        assert!(changed_ranges(&new, &last, 16).is_empty());
        new[17] = 1;
        new[40] = 1;
        new[63] = 1;
        assert_eq!(changed_ranges(&new, &last, 16), vec![(16, 64)]);
        new[40] = 0;
        assert_eq!(changed_ranges(&new, &last, 16), vec![(16, 32), (48, 64)]);
        // Longer than before: the tail goes too; shorter: nothing past it.
        new.extend_from_slice(&[7; 8]);
        new[17] = 0;
        new[63] = 0;
        assert_eq!(changed_ranges(&new, &last, 16), vec![(64, 72)]);
        assert!(changed_ranges(&last[..32], &last, 16).is_empty());
    }

    #[test]
    fn layer_upload_scratch_follows_the_scene_not_the_layer_limit() {
        use super::{fit_byte_scratch, fit_layer_upload_scratch, LayerGpu, LAYER_UPLOAD_SCRATCH_MIN_SLOTS, MAX_SCENE_LAYERS};

        let slot = std::mem::size_of::<LayerGpu>();
        let mut scratch = Vec::new();
        // A new render state holds nothing; a five-layer scene holds five slots.
        fit_layer_upload_scratch(&mut scratch, 5);
        assert_eq!(scratch.len(), 5);
        assert!(scratch.capacity() * slot < MAX_SCENE_LAYERS * slot / 8, "scratch must not be sized to the layer limit");
        // Growing and staying: no reallocation for small changes.
        fit_layer_upload_scratch(&mut scratch, 200);
        assert_eq!(scratch.len(), 200);
        fit_layer_upload_scratch(&mut scratch, 120);
        assert_eq!(scratch.len(), 200, "a scene a little smaller keeps the slots");
        // Shrunk to under a quarter: memory goes back, down to the floor.
        fit_layer_upload_scratch(&mut scratch, 3);
        assert_eq!(scratch.len(), LAYER_UPLOAD_SCRATCH_MIN_SLOTS);
        assert!(scratch.capacity() <= LAYER_UPLOAD_SCRATCH_MIN_SLOTS * 2);
        // Never past the layer limit.
        fit_layer_upload_scratch(&mut scratch, MAX_SCENE_LAYERS + 50);
        assert_eq!(scratch.len(), MAX_SCENE_LAYERS);
        let mut bytes = vec![1u8; 300 * slot];
        fit_byte_scratch(&mut bytes, 2 * slot);
        assert!(bytes.capacity() <= LAYER_UPLOAD_SCRATCH_MIN_SLOTS * slot * 2);
        assert!(bytes.iter().all(|b| *b == 1), "what is kept is a prefix of the last upload");
    }

    #[test]
    fn deck_monitor_width_is_even_and_bounded() {
        assert_eq!(super::deck_monitor_width(480), 480);
        assert_eq!(super::deck_monitor_width(961), 960);
        assert_eq!(super::deck_monitor_width(10), 240);
        assert_eq!(super::deck_monitor_width(8000), 1920);
    }

    #[test]
    fn deck_monitors_keep_the_output_shape() {
        use super::deck_monitor_size as size;
        assert_eq!(size(960, (1920, 1080)), (960, 540));
        assert_eq!(size(480, (1920, 1080)), (480, 270));
        // Portrait: 960 wide would be 1706 tall, so both come down together.
        assert_eq!(size(960, (1080, 1920)), (576, 1024));
        assert_eq!(size(480, (1080, 1920)), (480, 853));
        // Square at the height limit and an extreme strip stay sane.
        assert_eq!(size(1920, (1000, 1000)), (1024, 1024));
        assert_eq!(size(1920, (100, 4000)), (24, 1024));
        assert_eq!(size(240, (4000, 100)), (240, 16));
    }

    #[test]
    fn frames_are_paced_to_a_whole_fraction_of_the_output_display() {
        use super::paced_frame_rate as rate;
        assert_eq!(rate(60, None), 60.0);
        assert_eq!(rate(60, Some(60.0)), 60.0);
        assert_eq!(rate(60, Some(50.0)), 50.0); // PAL projector
        assert!((rate(60, Some(59.94)) - 59.94).abs() < 1e-9);
        assert_eq!(rate(60, Some(120.0)), 60.0);
        assert_eq!(rate(60, Some(144.0)), 72.0); // every frame shown twice
        assert_eq!(rate(60, Some(165.0)), 55.0);
        assert_eq!(rate(60, Some(240.0)), 60.0);
        assert_eq!(rate(30, Some(60.0)), 30.0);
        // A nonsense report keeps the target.
        assert_eq!(rate(60, Some(0.0)), 60.0);
        assert_eq!(rate(60, Some(f64::NAN)), 60.0);
    }

    #[test]
    fn an_editor_present_does_not_move_the_frame_clock() {
        use super::{PresentAction, present_action};
        use std::time::{Duration, Instant};
        let period = Duration::from_millis(16);
        let last = Instant::now();
        // Idle core: draw now.
        assert_eq!(present_action(false, last, last + Duration::from_millis(3), period),
            PresentAction::RenderNow { next_redraw: last + Duration::from_millis(3) });
        // Drawing on schedule, next frame not due: it carries the change.
        assert_eq!(present_action(true, last, last + Duration::from_millis(3), period), PresentAction::WithNextFrame);
        // Due: draw now, on the existing schedule rather than from now.
        assert_eq!(present_action(true, last, last + Duration::from_millis(18), period),
            PresentAction::RenderNow { next_redraw: last + period });
    }

    #[test]
    fn a_minimised_or_silent_output_window_does_not_stop_the_core() {
        use std::time::{Duration, Instant};
        let period = Duration::from_millis(16);
        let asked = Instant::now();
        // A visible window that answers within a frame is waited for.
        assert!(!super::output_redraw_stalled(false, asked, asked + Duration::from_millis(15), period));
        // Minimised: Windows sends no redraw, so draw now.
        assert!(super::output_redraw_stalled(true, asked, asked, period));
        // Two frames without the redraw arriving: draw now, and keep doing so.
        assert!(super::output_redraw_stalled(false, asked, asked + period * 2, period));
        assert!(super::output_redraw_stalled(false, asked, asked + period * 5, period));
    }

    #[test]
    fn videos_on_small_slices_decode_at_the_slice_size() {
        use super::{fit_video_long_edge, native_video_slice_edge_cap};
        // A full-frame slice keeps the editor's requested size.
        assert_eq!(native_video_slice_edge_cap((1920, 1080), 1.0), None);
        assert_eq!(native_video_slice_edge_cap((1920, 1080), f32::NAN), None);
        // A quarter-size slice of a 1080p output needs a 480-pixel edge.
        let cap = native_video_slice_edge_cap((1920, 1080), 0.25);
        assert_eq!(cap, Some(480));
        // The decode size is the smaller of what the editor asked for and
        // what the slice needs: a 2048x1152 request on that slice is 480x270.
        assert_eq!(fit_video_long_edge(2048, 1152, cap.map(|edge| edge as u32)), (480, 270));
        // A portrait clip keeps its shape and even sizes.
        assert_eq!(fit_video_long_edge(1080, 1920, Some(480)), (270, 480));
        assert_eq!(fit_video_long_edge(1001, 563, Some(500)), (500, 280));
        // A request already inside the cap is unchanged.
        assert_eq!(fit_video_long_edge(320, 180, Some(480)), (320, 180));
        // Never a degenerate size.
        assert_eq!(fit_video_long_edge(4096, 16, Some(64)), (64, 16));
        // The floor keeps tiny slices decodable.
        assert_eq!(native_video_slice_edge_cap((1920, 1080), 0.01), Some(64));
    }

    #[test]
    fn a_cropped_video_tile_decodes_at_the_size_of_the_part_it_shows() {
        use super::{SceneLayer, native_video_slice_edge_cap, video_decode_scale_for_layers};
        let tile = |crop: [f32; 4]| {
            let mut layer = SceneLayer::new("tile".to_string(), 0);
            // A quarter of a 1920x1080 output each way.
            layer.corners = [[0.0, 0.0], [0.25, 0.0], [0.25, 0.25], [0.0, 0.25]];
            layer.uv0 = crop;
            layer
        };
        // Uncropped, a quarter-size tile decodes small (480 on the long edge).
        let whole = tile([0.0, 0.0, 1.0, 1.0]);
        let scale = video_decode_scale_for_layers(std::iter::once(&whole));
        assert_eq!(native_video_slice_edge_cap((1920, 1080), scale), Some(720));
        // One tile of a 4x4 wall shows a sixteenth of the clip over a
        // sixteenth of the output: it needs the full decode, not 720.
        let wall = tile([0.25, 0.5, 0.25, 0.25]);
        let scale = video_decode_scale_for_layers(std::iter::once(&wall));
        assert_eq!(native_video_slice_edge_cap((1920, 1080), scale), None);
        // Half the clip on that tile needs half again as much as uncropped.
        let half = tile([0.0, 0.0, 0.5, 0.5]);
        let scale = video_decode_scale_for_layers(std::iter::once(&half));
        assert_eq!(native_video_slice_edge_cap((1920, 1080), scale), Some(1440));
        // Fill on a wide clip crops its sides: the shown width counts.
        let mut filled = tile([0.0, 0.0, 1.0, 1.0]);
        filled.uv1 = [1.0, 4.0, 0.0, 0.0];
        let scale = video_decode_scale_for_layers(std::iter::once(&filled));
        assert_eq!(native_video_slice_edge_cap((1920, 1080), scale), None);
        // A video no layer shows decodes in full.
        assert_eq!(video_decode_scale_for_layers(std::iter::empty()), 1.0);
    }

    #[test]
    fn a_session_restarts_when_its_slice_grows_or_halves_but_not_on_small_changes() {
        use super::native_video_decode_cap_needs_restart as restart;
        let full = 1920;
        assert!(!restart(None, None, full, true));
        assert!(restart(Some(480), None, full, true), "a slice grown to full frame needs the full size");
        assert!(restart(Some(480), Some(720), full, true));
        assert!(!restart(Some(480), Some(480), full, true));
        // Started before its layer was bound: comes down to a quarter slice.
        assert!(restart(None, Some(480), full, true));
        // Small reductions keep the running decoder (no churn while dragging).
        assert!(!restart(None, Some(1440), full, true));
        assert!(!restart(Some(960), Some(720), full, true));
        assert!(restart(Some(960), Some(480), full, true));
        // A warm library session handed to a layer never shrinks.
        assert!(!restart(None, Some(480), full, false));
        assert!(restart(Some(480), None, full, false));
    }

    #[test]
    fn heartbeat_slot_bounds_match_the_core() {
        let wgsl = include_str!("heartbeat.wgsl");
        let constant = |name: &str| -> usize {
            let line = wgsl.lines().find(|line| line.starts_with(&format!("const {name}:")))
                .unwrap_or_else(|| panic!("{name} in heartbeat.wgsl"));
            line.split('=').nth(1).unwrap().trim().trim_end_matches(';').parse().unwrap()
        };
        assert_eq!(constant("MAX_SOURCE_PREVIEW_SLOTS"), MAX_SOURCE_PREVIEWS);
        assert!(wgsl.contains(&format!("layer_index >= {MAX_SCENE_LAYERS}u")), "composite loop bound must equal MAX_SCENE_LAYERS");
        assert!(wgsl.contains(&format!("clamp(u.layer_count, 0.0, {MAX_SCENE_LAYERS}.0)")), "composite loop bound must equal MAX_SCENE_LAYERS");
        // Slots are bounded by the store itself (textureNumLayers or the
        // binding-array length), never by a constant of their own.
        assert!(!wgsl.contains("MAX_SOURCE_FRAME_SLOTS"));
        assert!(wgsl.contains("//#SOURCE_FRAMES"));
    }

    #[test]
    fn layer_tiles_list_each_tiles_layers_bottom_to_top() {
        const NONE: [f32; 4] = [1.0e9, 1.0e9, -1.0e9, -1.0e9];
        const ALL: [f32; 4] = [-1.0e9, -1.0e9, 1.0e9, 1.0e9];
        let culls = [
            [0.0, 0.0, 1.0, 1.0],        // 0: the whole canvas
            [0.0, 0.0, 0.02, 0.02],      // 1: the bottom-left tile only
            NONE,                        // 2: hidden
            [0.5, 0.5, 0.52, 0.52],      // 3: one tile in the middle
            [1.5, 1.5, 2.0, 2.0],        // 4: only off the canvas
            ALL,                         // 5: a hierarchy mask
        ];
        let mut out = Vec::new();
        build_layer_tiles(&culls, &mut out);
        assert_eq!(&out[..3], &[LAYER_TILES as u32, LAYER_TILES as u32, 1]);
        let tile = |tx: usize, ty: usize| {
            let cell = LAYER_TILE_HEADER + ty * LAYER_TILES + tx;
            let base = LAYER_TILE_HEADER + LAYER_TILE_CELLS + 1;
            out[base + out[cell] as usize..base + out[cell + 1] as usize].to_vec()
        };
        assert_eq!(tile(0, 0), vec![0, 1, 5]);
        assert_eq!(tile(16, 16), vec![0, 3, 5]);
        assert_eq!(tile(31, 31), vec![0, 5]);
        // Too many entries: binning off, every pixel walks every layer.
        let crowd = vec![[0.0, 0.0, 1.0, 1.0]; LAYER_TILE_INDEX_CAP / LAYER_TILE_CELLS + 1];
        build_layer_tiles(&crowd, &mut out);
        assert_eq!(out[2], 0);
    }

    #[test]
    fn mesh_cell_bounds_hold_the_boxes_the_compositor_tests() {
        let wgsl = include_str!("heartbeat.wgsl");
        assert!(wgsl.contains(&format!("const MESH_CELL_BOUNDS_BASE: u32 = {MESH_CELL_BOUNDS_BASE}u;")));
        // A 4 x 3 Bezier mesh with bent tangents, and a straight 2 x 2 one.
        let mut bezier = LayerGpu::zeroed();
        bezier.style[2] = 4.0;
        bezier.style[3] = 3.0;
        bezier.fast_flags[1] = 1;
        let (rows, cols) = (4usize, 3usize);
        let mut seed = 11u32;
        let mut rnd = || { seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223); (seed >> 8) as f32 / 16_777_216.0 - 0.5 };
        let mut pts = vec![[0.0f32; 2]; rows * cols];
        for r in 0..rows {
            for c in 0..cols {
                pts[r * cols + c] = [c as f32 / 2.0 + rnd() * 0.1, 1.0 - r as f32 / 3.0 + rnd() * 0.1];
            }
        }
        for (i, p) in pts.iter().enumerate() {
            let slot = &mut bezier.mesh[i / 2];
            let o = (i % 2) * 2;
            slot[o] = p[0];
            slot[o + 1] = p[1];
            for half in 0..2 {
                bezier.mesh_tangents[i * 2 + half] = [rnd() * 0.2, rnd() * 0.2, rnd() * 0.2, rnd() * 0.2];
            }
        }
        let mut straight = LayerGpu::zeroed();
        straight.style[2] = 2.0;
        straight.style[3] = 2.0;
        straight.mesh[0] = [0.0, 1.0, 1.1, 0.9];
        straight.mesh[1] = [0.1, -0.05, 1.0, 0.0];
        let plain = LayerGpu::zeroed();
        let mut out = Vec::new();
        build_mesh_cell_bounds(&[plain, bezier, straight], &mut out);
        assert_eq!(out[0], 0, "a layer without a mesh has no boxes");
        let boxes = |layer: usize, cell: usize| -> [f32; 4] {
            let at = out[layer] as usize - MESH_CELL_BOUNDS_BASE + cell * 4;
            [f32::from_bits(out[at]), f32::from_bits(out[at + 1]), f32::from_bits(out[at + 2]), f32::from_bits(out[at + 3])]
        };
        // The shader's own box (f32, as heartbeat.wgsl works it out) must sit
        // inside the stored one, by the slack.
        let pt = |l: &LayerGpu, i: usize| { let p = l.mesh[i / 2]; if i % 2 == 0 { [p[0], p[1]] } else { [p[2], p[3]] } };
        let tan = |l: &LayerGpu, i: usize, side: usize| { let p = l.mesh_tangents[i * 2 + (side >> 1)]; if side & 1 == 0 { [p[0], p[1]] } else { [p[2], p[3]] } };
        let add = |a: [f32; 2], b: [f32; 2]| [a[0] + b[0], a[1] + b[1]];
        let mix = |a: [f32; 2], b: [f32; 2], t: f32| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for row in 0..rows - 1 {
            for col in 0..cols - 1 {
                let ia = row * cols + col;
                let (ib, id) = (ia + 1, ia + cols);
                let ic = id + 1;
                let (a, b, c, d) = (pt(&bezier, ia), pt(&bezier, ib), pt(&bezier, ic), pt(&bezier, id));
                let (ab1, ab2) = (add(a, tan(&bezier, ia, 0)), add(b, tan(&bezier, ib, 2)));
                let (dc1, dc2) = (add(d, tan(&bezier, id, 0)), add(c, tan(&bezier, ic, 2)));
                let (ad1, ad2) = (add(a, tan(&bezier, ia, 1)), add(d, tan(&bezier, id, 3)));
                let (bc1, bc2) = (add(b, tan(&bezier, ib, 1)), add(c, tan(&bezier, ic, 3)));
                let mut all = vec![a, b, c, d, ab1, ab2, dc1, dc2, ad1, ad2, bc1, bc2];
                for j in 1..=2 {
                    for i in 1..=2 {
                        let (fu, fv) = (i as f32 / 3.0, j as f32 / 3.0);
                        let sheet = mix(mix(a, b, fu), mix(d, c, fu), fv);
                        let tb = mix(if i == 1 { ab1 } else { ab2 }, if i == 1 { dc1 } else { dc2 }, fv);
                        let lr = mix(if j == 1 { ad1 } else { ad2 }, if j == 1 { bc1 } else { bc2 }, fu);
                        all.push([tb[0] + lr[0] - sheet[0], tb[1] + lr[1] - sheet[1]]);
                    }
                }
                let stored = boxes(1, row * (cols - 1) + col);
                for k in 0..2 {
                    let lo = all.iter().map(|p| p[k]).fold(f32::INFINITY, f32::min) - 0.002;
                    let hi = all.iter().map(|p| p[k]).fold(f32::NEG_INFINITY, f32::max) + 0.002;
                    assert!(stored[k] < lo - 5e-6 && stored[k] > lo - 1e-4, "cell {row},{col} axis {k}: {} vs {lo}", stored[k]);
                    assert!(stored[k + 2] > hi + 5e-6 && stored[k + 2] < hi + 1e-4, "cell {row},{col} axis {k}: {} vs {hi}", stored[k + 2]);
                }
            }
        }
        let cell = boxes(2, 0);
        assert!(cell[0] < 0.0 - 1e-6 && cell[1] < -0.05 - 1e-6 && cell[2] > 1.1 + 1e-6 && cell[3] > 1.0 + 1e-6);
        // Directory entries point past the directory, one after the other.
        assert_eq!(out[1] as usize, MESH_CELL_BOUNDS_BASE + MAX_SCENE_LAYERS);
        assert_eq!(out[2] as usize, out[1] as usize + (rows - 1) * (cols - 1) * 4);
        assert_eq!(out.len(), MAX_SCENE_LAYERS + ((rows - 1) * (cols - 1) + 1) * 4);
    }

    #[test]
    fn compositor_and_stage3d_shaders_validate_for_both_slot_stores() {
        for mode in [SourceFrameMode::Shared, SourceFrameMode::PerSource] {
            for (name, source) in [
                ("heartbeat", heartbeat_wgsl(mode, 64, false)),
                ("heartbeat with source mips", heartbeat_wgsl(mode, 64, true)),
                ("stage3d", stage3d_mesh_wgsl(mode, 64)),
            ] {
                let module = naga::front::wgsl::parse_str(&source)
                    .unwrap_or_else(|error| panic!("{name} {mode:?} parse: {}", error.emit_to_string(&source)));
                let capabilities = match mode {
                    SourceFrameMode::Shared => naga::valid::Capabilities::empty(),
                    SourceFrameMode::PerSource => naga::valid::Capabilities::TEXTURE_AND_SAMPLER_BINDING_ARRAY
                        | naga::valid::Capabilities::TEXTURE_AND_SAMPLER_BINDING_ARRAY_NON_UNIFORM_INDEXING,
                };
                naga::valid::Validator::new(naga::valid::ValidationFlags::all(), capabilities)
                    .validate(&module)
                    .unwrap_or_else(|error| panic!("{name} {mode:?} validation: {error:?}"));
            }
        }
    }

    #[test]
    fn mirror_mesh_draws_only_the_cells_it_uses() {
        // 3 by 2 nodes, the top-right one unused: of the two cells only the left one draws.
        let nodes: Vec<f64> = vec![
            -1.0, -1.0, 0.0, 0.0, 1.0,   0.0, -1.0, 0.5, 0.0, 1.0,   1.0, -1.0, 1.0, 0.0, 1.0,
            -1.0, 1.0, 0.0, 1.0, 1.0,    0.0, 1.0, 0.5, 1.0, 0.8,    1.0, 1.0, 1.0, 1.0, -1.0,
        ];
        let mesh = MirrorMesh::from_command(&json!({ "mesh_id": "m", "cols": 3, "rows": 2, "nodes": nodes })).unwrap();
        assert_eq!(mesh.vertices.len(), 6);
        assert_eq!(mesh.indices, vec![0, 1, 4, 0, 4, 3]);
        // A polar mesh wraps its last column round to the first.
        let polar = MirrorMesh::from_command(&json!({ "mesh_id": "p", "mesh_type": 1, "cols": 3, "rows": 2,
            "nodes": nodes.iter().enumerate().map(|(k, v)| if k == 29 { 1.0 } else { *v }).collect::<Vec<_>>() })).unwrap();
        assert_eq!(polar.indices.len(), 18);
        assert!(MirrorMesh::from_command(&json!({ "mesh_id": "x", "cols": 3, "rows": 2, "nodes": [0.0] })).is_err());
    }

    #[test]
    fn dome_rig_reads_its_projectors_in_order() {
        let frustum: Vec<f64> = (0..16).map(|v| v as f64).collect();
        let rig = DomeRig::from_params(Some(&json!({ "blendWidth": 0.3, "blendGamma": 2.0,
            "projectors": [{ "id": "a", "frustum": frustum }, { "id": "bad", "frustum": [1.0] }, { "id": "b", "frustum": frustum }] })));
        assert_eq!(rig.ids, vec!["a", "b"]);
        assert_eq!(rig.frusta[4], [0.0, 1.0, 2.0, 3.0]);
        assert_eq!(rig.frusta[7], [12.0, 13.0, 14.0, 15.0]);
        assert!((rig.blend_width - 0.3).abs() < 1e-6);
        assert!(DomeRig::from_params(None).ids.is_empty());
    }

    #[test]
    fn mirror_mesh_shader_validates() {
        let module = naga::front::wgsl::parse_str(MIRROR_MESH_WGSL)
            .unwrap_or_else(|error| panic!("mirror mesh parse: {}", error.emit_to_string(MIRROR_MESH_WGSL)));
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap_or_else(|error| panic!("mirror mesh validation: {error:?}"));
    }

    #[test]
    fn heartbeat_compositor_wgsl_validates_with_the_edge_effect_layout() {
        let module = naga::front::wgsl::parse_str(&heartbeat_wgsl(SourceFrameMode::Shared, 1, true))
            .unwrap_or_else(|error| panic!("heartbeat.wgsl parse: {error}"));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .unwrap_or_else(|error| panic!("heartbeat.wgsl validation: {error:?}"));
        // The storage struct must stay byte-compatible with LayerCoreGpu.
        let layer_data = module
            .types
            .iter()
            .find(|(_, ty)| ty.name.as_deref() == Some("LayerData"))
            .expect("LayerData struct");
        let naga::TypeInner::Struct { span, .. } = layer_data.1.inner else {
            panic!("LayerData is a struct");
        };
        assert_eq!(span as usize, std::mem::size_of::<LayerCoreGpu>());
        assert!(std::mem::size_of::<LayerCoreGpu>() <= 256);
        // The pool record offsets the shader reads by.
        let source = heartbeat_wgsl(SourceFrameMode::Shared, 1, true);
        for (name, value) in [
            ("POOL_SHAPE_PTS", POOL_SHAPE_PTS), ("POOL_MASK_PTS", POOL_MASK_PTS),
            ("POOL_MESH_POINTS", POOL_MESH_POINTS), ("POOL_MESH_REST", POOL_MESH_REST),
            ("POOL_MESH_TANGENTS", POOL_MESH_TANGENTS), ("POOL_EDGE_EFFECTS", POOL_EDGE_EFFECTS),
            ("POOL_EDGE_CHUNKS", POOL_EDGE_CHUNKS), ("POOL_EDGE_CORNERS", POOL_EDGE_CORNERS),
            ("POOL_EDGE_DIAGS", POOL_EDGE_DIAGS), ("POOL_EDGE_PTS", POOL_EDGE_PTS),
        ] {
            assert!(source.contains(&format!("const {name}: u32 = {value}u;")), "{name} = {value} in heartbeat.wgsl");
        }
        // And the uniform block with Uniforms, dome fields at the tail included.
        let uniforms = module
            .types
            .iter()
            .find(|(_, ty)| ty.name.as_deref() == Some("Uniforms"))
            .expect("Uniforms struct");
        let naga::TypeInner::Struct { span, .. } = uniforms.1.inner else {
            panic!("Uniforms is a struct");
        };
        assert_eq!(span as usize, std::mem::size_of::<Uniforms>());
    }

    #[test]
    fn beat_clock_runs_on_the_render_clock_between_anchors() {
        let mut clock = BeatClock::default();
        // Unanchored: 120 BPM from the first frame.
        assert_eq!(clock.uniform(10.0), [0.0, 120.0, 0.0, 0.0]);
        assert!((clock.uniform(10.5)[0] - 1.0).abs() < 1e-4);
        // An anchor without a time lands on the next frame drawn.
        clock.rebase(BeatClockAnchor { beat: 64.25, bpm: 90.0, time: None });
        assert!((clock.uniform(20.0)[0] - 64.25).abs() < 1e-3);
        assert!((clock.uniform(22.0)[0] - 67.25).abs() < 1e-3);
        // A timed anchor is exact, and positions wrap without going negative.
        clock.rebase(BeatClockAnchor { beat: BEAT_CLOCK_WRAP - 0.5, bpm: 60.0, time: Some(5.0) });
        assert!((clock.uniform(6.0)[0] - 0.5).abs() < 1e-3);
        assert!(clock.uniform(4.0)[0] >= 0.0);
        let parsed = BeatClockAnchor::from_command(&json!({ "beat": 3.5, "bpm": 1000.0 })).unwrap();
        assert_eq!((parsed.beat, parsed.bpm, parsed.time), (3.5, 400.0, None));
        assert!(BeatClockAnchor::from_command(&json!({ "beat": 1.0 })).is_none());
    }

    #[test]
    fn shader_clock_is_the_live_clock_in_a_show_and_stays_fine_grained_for_weeks() {
        // Below the wrap, exactly the old f32 clock: nothing changes in a show.
        for t in [0.0, 1.0 / 60.0, 10.0, 3600.25, 4.0 * 3600.0 + 0.1, 9.0 * 3600.0] {
            assert_eq!(shader_clock_seconds(t), t as f32, "{t}");
        }
        assert_eq!(shader_clock_seconds(-1.0), 0.0);
        assert_eq!(shader_clock_seconds(f64::NAN), 0.0);
        // Past it, consecutive 60 fps frames (and 120 fps frames) always
        // step forward by close to a frame. With the old f32 clock a frame at
        // 12 h stepped 0 or 2 f32 ulps (3.9 ms each) and after a week
        // 62.5 ms, so most 60 fps frames repeated the last time.
        for hours in [12.0_f64, 24.0, 7.0 * 24.0, 30.0 * 24.0, 365.0 * 24.0] {
            for fps in [60.0_f64, 120.0] {
                let start = hours * 3600.0 + 0.123;
                let mut worst = 0.0_f64;
                let mut moves = 0;
                for frame in 0..240 {
                    let a = start + frame as f64 / fps;
                    let b = a + 1.0 / fps;
                    let step = shader_clock_seconds(b) as f64 - shader_clock_seconds(a) as f64;
                    if step < 0.0 { continue; } // the one wrap moment
                    moves += 1;
                    worst = worst.max((step - 1.0 / fps).abs());
                }
                assert!(moves >= 239, "{hours} h {fps} fps");
                assert!(worst <= 0.002, "{hours} h at {fps} fps: frame step off by {worst} s");
                let old_step = (start + 1.0 / fps) as f32 - start as f32;
                if hours >= 24.0 * 7.0 { assert!((old_step as f64 - 1.0 / fps).abs() > 0.004, "the old clock was coarse"); }
            }
        }
        // Whole and dyadic periods are seamless across the wrap.
        let before = SHADER_CLOCK_WRAP_SECONDS - 0.25;
        let after = SHADER_CLOCK_WRAP_SECONDS + 0.25;
        assert_eq!(shader_clock_seconds(after), 0.25);
        assert_eq!((shader_clock_seconds(before) * 2.0).fract(), (shader_clock_seconds(after) * 2.0).fract());
    }

    #[test]
    fn beat_clock_and_video_time_keep_the_unwrapped_clock() {
        // The beat clock is fed the unwrapped f64 clock: across the shader
        // wrap it keeps counting.
        let mut clock = BeatClock::default();
        let t0 = SHADER_CLOCK_WRAP_SECONDS - 1.0;
        clock.rebase(BeatClockAnchor { beat: 8.0, bpm: 120.0, time: Some(t0) });
        assert!((clock.uniform(t0 + 2.0)[0] - 12.0).abs() < 1e-3);
        // A week in, video time still moves by the frame step.
        let state = NativeMediaSourceState {
            uri: "week://clip".to_string(), source_type: "video".to_string(),
            playback_time_seconds: 1.0, seek_generation: 0, playback_rate: 1.0,
            paused: false, loop_enabled: true, bounce_enabled: false,
            duration_seconds: Some(10.0), trim_start: 0.0, trim_end: 1.0,
            decode_width: None, decode_height: None,
            clock_time_seconds: 7.0 * 86400.0, seq: 0,
        };
        let a = state.current_time_seconds(Some(7.0 * 86400.0 + 0.5));
        let b = state.current_time_seconds(Some(7.0 * 86400.0 + 0.5 + 1.0 / 60.0));
        assert!((a - 1.5).abs() < 1e-6 && (b - a - 1.0 / 60.0).abs() < 1e-6, "{a} {b}");
    }

    #[test]
    fn layer_tint_carries_the_content_alpha_for_edge_effects() {
        let mut layer = SceneLayer::new("tinted".to_string(), 0);
        set_scene_layer_color(&mut layer, [0.3, 0.34, 0.42, 0.35]);
        layer.tint = [0.0, 1.0, 0.5, 1.0];
        let gpu = layer.gpu();
        assert_eq!(gpu.tint, [0.0, 1.0, 0.5, 0.35]);
        assert!((gpu.color[3] - 0.35).abs() < 1e-6);
    }

    #[test]
    fn edge_effect_payload_keeps_sixteen_active_effects_and_their_outline() {
        let effect = |active: f32, tag: f32| {
            let mut vectors = vec![vec![active, 1.0, 0.0, 2.0]];
            for index in 1..LAYER_EDGE_EFFECT_VEC4S {
                vectors.push(vec![tag, index as f32, 0.0, 0.0]);
            }
            vectors
        };
        let mut effects = Vec::new();
        for index in 0..20 {
            // Every fifth one is inactive and must not take a slot.
            effects.push(effect(if index % 5 == 4 { 0.0 } else { 1.0 }, index as f32));
        }
        // A 40-point outline: three chunks of up to 16 segments.
        let outline: Vec<Vec<f64>> = (0..40)
            .map(|i| {
                let a = i as f64 / 40.0 * std::f64::consts::TAU;
                vec![100.0 + 50.0 * a.cos(), 80.0 + 50.0 * a.sin(), i as f64 * 7.8, 1.0]
            })
            .collect();
        let command = json!({
            "layer_id": "edge",
            "edge_effects": effects,
            "edge_outline": outline,
            "edge_corners": [[150.0, 80.0, 0.0, 0.0], [100.0, 130.0, 78.0, 10.0], [50.0, 80.0, 156.0, 20.0]],
            "edge_diagonals": [[0, 2], [1, 9]],
            "edge_geometry": [100.0, 80.0, 312.0, 45.0],
            "edge_seed": 7.0,
            "edge_bounds": [0.0, 0.0, 1.0, 1.0],
        });
        let parsed = parse_layer_edge_effects(&command);
        assert_eq!(parsed.effects.len(), 16);
        // Effects 4, 9 and 14 are skipped, so slot 15 holds effect 18.
        assert_eq!(parsed.effects[15][1][0], 18.0);
        assert_eq!(parsed.effects[4][1][0], 5.0);
        assert_eq!(parsed.effects[3][21][1], 21.0);
        assert_eq!(parsed.points.len(), 40);
        assert_eq!(parsed.diagonals, vec![[0.0, 2.0]], "a pair naming a missing corner is dropped");

        let mut layer = SceneLayer::new("edge".to_string(), 0);
        layer.edge = Box::new(parsed);
        let gpu = layer.gpu();
        assert_eq!(gpu.edge_info, [40.0, 16.0, 3.0, 1.0]);
        assert_eq!(gpu.edge_geom, [100.0, 80.0, 312.0, 45.0]);
        assert_eq!(gpu.edge_extra[0], 7.0);
        // The third chunk holds segments 32..39, the last closing back to point 0.
        let chunk = gpu.edge_chunks[2];
        assert!(chunk[2] >= 150.0 - 1e-3, "closing segment reaches point 0 at x = 150");
        assert_eq!(gpu.edge_chunks[3], [0.0; 4]);
        assert_eq!(gpu.fast_flags[0], 0, "a layer with edge effects never takes the plain-fill path");

        let no_outline = parse_layer_edge_effects(&json!({ "layer_id": "edge", "edge_effects": [effect(1.0, 0.0)] }));
        assert!(!no_outline.active(), "effects without an outline have nothing to draw on");
    }

    #[test]
    fn record_target_parses_sources_and_selects_their_layers() {
        use super::{RecordTargetSource, parse_record_target, record_target_output_stage};
        assert_eq!(parse_record_target(&json!({})).unwrap(), None);
        assert_eq!(parse_record_target(&json!({ "kind": "none", "alpha": true })).unwrap(), None);
        let layer = parse_record_target(&json!({ "kind": "layer", "layer_id": "a", "layer_ids": ["b", "b"], "alpha": true }))
            .unwrap()
            .unwrap();
        assert_eq!(layer.source, RecordTargetSource::Layers(vec!["b".to_string(), "a".to_string()]));
        assert!(layer.alpha);
        assert!(parse_record_target(&json!({ "kind": "layer", "layer_ids": [" "] })).is_err());
        assert!(parse_record_target(&json!({ "kind": "vj_layer" })).is_err());
        assert!(parse_record_target(&json!({ "kind": "vj_layer", "vj_layer_index": -1 })).is_err());
        assert!(parse_record_target(&json!({ "kind": "screen" })).is_err());

        let row = parse_record_target(&json!({ "kind": "vj_layer", "vj_layer_index": 3 })).unwrap().unwrap();
        assert!(!row.alpha, "alpha is opt-in");
        let mut on_row = SceneLayer::new("clip-1".to_string(), 0);
        on_row.vj_layer_index = Some(3);
        let mut other_row = SceneLayer::new("clip-2".to_string(), 1);
        other_row.vj_layer_index = Some(1);
        assert!(row.includes(&on_row));
        assert!(!row.includes(&other_row));
        assert!(layer.includes(&SceneLayer::new("a".to_string(), 0)));
        assert!(!layer.includes(&on_row));
        let composition = parse_record_target(&json!({ "kind": "composition", "alpha": true })).unwrap().unwrap();
        assert!(composition.includes(&on_row) && composition.includes(&other_row));

        // Only the alpha pass flips the compositor's straight-alpha switch;
        // everything else is the untransformed composition.
        assert_eq!(record_target_output_stage(true).smask, [0.0, 0.0, 1.0, 0.0]);
        assert_eq!(record_target_output_stage(false).smask, [0.0; 4]);
        assert_eq!(record_target_output_stage(true).out0, [0.0, 0.0, 1.0, 1.0]);
        assert!(super::live_capture_export_source("record_target"));
        assert!(super::live_capture_export_source("slice:screen-2"));
        assert!(!super::live_capture_export_source("scene"));
    }

    #[test]
    fn screen_output_admission_is_bounded_by_count_and_memory() {
        use serde_json::json;
        let screens = |count: usize, width: u32, height: u32| json!({ "slices": (0..count)
            .map(|i| json!({ "id": format!("screen-{i}"), "width": width, "height": height })).collect::<Vec<_>>() });
        assert!(super::validate_slice_outputs(&screens(32, 1920, 1080)).is_ok());
        assert!(super::validate_slice_outputs(&screens(33, 64, 64)).is_err());
        assert!(super::validate_slice_outputs(&screens(9, 3840, 2160)).is_err());
        assert!(super::validate_slice_outputs(&screens(8, 3840, 2160)).is_ok());
        assert!(super::validate_slice_outputs(&screens(0, 64, 64)).is_ok());
        assert!(super::validate_slice_outputs(&json!({})).is_err());
        assert!(super::validate_slice_outputs(&json!({ "slices": [{"id":"a"}, {"id":"a"}] })).is_err());
        assert!(super::validate_slice_outputs(&json!({ "slices": [{"id":" "}] })).is_err());
    }

    /// Screen and Master Warp meshes take the layer mesh's tangent rules
    /// and packing. A grid without tangents, or with Bezier switched off,
    /// must stay off the Bezier path so it renders exactly as before.
    #[test]
    fn output_warp_meshes_pack_bezier_tangents_only_when_curved() {
        use serde_json::json;
        let points = json!([
            [{ "x": 0.0, "y": 0.0 }, { "x": 0.5, "y": 0.0 }, { "x": 1.0, "y": 0.0 }],
            [{ "x": 0.0, "y": 1.0 }, { "x": 0.5, "y": 1.0 }, { "x": 1.0, "y": 1.0 }],
        ]);
        let straight = super::warp_mesh_at(Some(&json!({ "rows": 2, "cols": 3, "points": points })));
        assert_eq!((straight.rows, straight.cols, straight.bezier), (2.0, 3.0, false));
        assert_eq!(straight.points[0], [0.0, 0.0, 0.5, 0.0]);
        assert!(straight.tangents.iter().all(|v| *v == [0.0; 4]));

        let curved_json = json!({ "rows": 2, "cols": 3, "points": points, "bezier": true,
            "tangents": [[null, { "right": { "x": 0.1, "y": -0.2 } }, null], [null, null, null]] });
        let curved = super::warp_mesh_at(Some(&curved_json));
        assert!(curved.bezier);
        // Top-middle: right stored, left mirrors it, down is a chord third.
        assert_eq!(curved.tangents[2], [0.1, -0.2, 0.0, 1.0 / 3.0]);
        assert_eq!(curved.tangents[3], [-0.1, 0.2, 0.0, 0.0]);
        assert_eq!(curved.points, straight.points);

        let mut off = curved_json.clone();
        off["bezier"] = json!(false);
        assert!(!super::warp_mesh_at(Some(&off)).bezier);
        let mut empty = curved_json;
        empty["tangents"] = json!([[null, null, null], [null, {}, null]]);
        assert!(!super::warp_mesh_at(Some(&empty)).bezier);
        assert_eq!(super::warp_mesh_at(Some(&json!({ "rows": 1, "cols": 3, "points": [] }))).rows, 0.0);
    }

    #[test]
    fn screen_masks_pack_enabled_polygons_and_skip_unusable_ones() {
        use serde_json::json;
        let masks = json!([
            { "enabled": true, "invert": false, "feather": 0.3,
              "points": [{ "x": 0.1, "y": 0.1 }, { "x": 0.9, "y": 0.1 }, { "x": 0.5, "y": 0.9 }] },
            // Disabled, and too few points: neither may reach the shader.
            { "enabled": false, "points": [{ "x": 0.0, "y": 0.0 }, { "x": 1.0, "y": 0.0 }, { "x": 1.0, "y": 1.0 }] },
            { "points": [{ "x": 0.0, "y": 0.0 }, { "x": 1.0, "y": 0.0 }] },
            { "invert": true, "feather": 4.0,
              "points": [{ "x": 0.4, "y": 0.4 }, { "x": 0.6, "y": 0.4 }, { "x": 0.6, "y": 0.6 }, { "x": 0.4, "y": "nope" }] },
        ]);
        let (header, info, bounds, points) = super::screen_masks_at(Some(&masks));
        assert_eq!(header, [2.0, 1.0, 0.0, 0.0]);
        let pad = super::SCREEN_MASK_BOUNDS_PAD;
        assert_eq!(bounds[0], [0.1 - pad, 0.1 - pad, 0.9 + pad, 0.9 + pad]);
        assert_eq!(info[0], [0.0, 3.0, 0.3, 0.0]);
        // The inverted mask starts after the first mask's 3 vertices, drops
        // its unusable vertex and clamps feather into range.
        assert_eq!(info[1], [3.0, 3.0, 1.0, 1.0]);
        assert_eq!(points[0], [0.1, 0.1, 0.9, 0.1]);
        assert_eq!(points[1], [0.5, 0.9, 0.4, 0.4]);
        assert_eq!(points[2], [0.6, 0.4, 0.6, 0.6]);
        assert_eq!(super::screen_masks_at(None).0, [0.0; 4]);
        assert_eq!(super::screen_masks_at(Some(&json!("x"))).0, [0.0; 4]);
        // Past the per-screen cap, extra masks are dropped whole.
        let many = json!((0..12).map(|_| json!({ "points": [{ "x": 0.0, "y": 0.0 }, { "x": 1.0, "y": 0.0 }, { "x": 1.0, "y": 1.0 }] })).collect::<Vec<_>>());
        assert_eq!(super::screen_masks_at(Some(&many)).0[0], super::MAX_SCREEN_MASKS as f32);
    }

    /// Curved mask edges are cut as polylines that stay within the
    /// flattening tolerance of their cubic; straight edges and masks
    /// without handles pack exactly as before; a mask whose curves would
    /// overflow its vertex budget coarsens rather than being dropped.
    #[test]
    fn screen_masks_flatten_curved_edges_within_tolerance() {
        use serde_json::json;
        let a = [0.2, 0.2];
        let c1 = [0.5, -0.1];
        let c2 = [0.7, 0.0];
        let b = [0.8, 0.2];
        let masks = json!([{ "points": [
            { "x": a[0], "y": a[1], "cpOut": { "x": c1[0], "y": c1[1] } },
            { "x": b[0], "y": b[1], "cpIn": { "x": c2[0], "y": c2[1] } },
            { "x": 0.5, "y": 0.8 },
        ] }]);
        let (header, info, bounds, points) = super::screen_masks_at(Some(&masks));
        assert_eq!(header[0], 1.0);
        let count = info[0][1] as usize;
        assert!(count > 12, "a strong curve needs many segments, got {count}");
        let flat: Vec<[f32; 2]> = (0..count)
            .map(|i| { let v = points[i / 2]; if i % 2 == 0 { [v[0], v[1]] } else { [v[2], v[3]] } })
            .collect();
        assert_eq!(flat[0], [0.2, 0.2]);
        assert_eq!(flat[count - 2], [0.8, 0.2]);
        assert_eq!(flat[count - 1], [0.5, 0.8]);
        // Every chord of the flattened curve stays within tolerance of the
        // cubic (checked densely against its midpoints).
        let cubic = |t: f64| {
            let mt = 1.0 - t;
            [
                mt * mt * mt * a[0] + 3.0 * mt * mt * t * c1[0] + 3.0 * mt * t * t * c2[0] + t * t * t * b[0],
                mt * mt * mt * a[1] + 3.0 * mt * mt * t * c1[1] + 3.0 * mt * t * t * c2[1] + t * t * t * b[1],
            ]
        };
        let n = count - 2;
        for k in 0..n {
            let (p, q) = (flat[k], flat[k + 1]);
            let mid = cubic((k as f64 + 0.5) / n as f64);
            let (dx, dy) = ((q[0] - p[0]) as f64, (q[1] - p[1]) as f64);
            let len = (dx * dx + dy * dy).sqrt();
            let dist = ((mid[0] - p[0] as f64) * dy - (mid[1] - p[1] as f64) * dx).abs() / len;
            assert!(dist <= super::SCREEN_MASK_CURVE_TOLERANCE * 1.01, "segment {k} strays {dist}");
        }
        // The bounds cover the bulge (down to y ~ 0.01, below both anchors).
        assert!(bounds[0][1] < 0.02);

        // 32 wildly curved anchors cannot all get full detail: the mask
        // still packs, within its budget, with every anchor kept.
        let wild = json!([{ "points": (0..32).map(|i| {
            let t = i as f64 / 32.0 * std::f64::consts::TAU;
            json!({ "x": 0.5 + 0.4 * t.cos(), "y": 0.5 + 0.4 * t.sin(),
                "cpIn": { "x": 0.5, "y": 2.0 }, "cpOut": { "x": 0.5, "y": -1.0 } })
        }).collect::<Vec<_>>() }]);
        let (header, info, _, _) = super::screen_masks_at(Some(&wild));
        assert_eq!(header[0], 1.0);
        assert!(info[0][1] as usize <= super::SCREEN_MASK_FLAT_POINTS && info[0][1] as usize >= 32);
    }

    #[test]
    fn presentation_deadline_keeps_phase_but_does_not_catch_up_after_stalls() {
        let start = std::time::Instant::now();
        let period = std::time::Duration::from_millis(16);
        let mut scheduled = start;
        for frame in 1..=120 {
            let deadline = scheduled + period;
            scheduled = super::scheduled_frame_start(deadline, deadline + std::time::Duration::from_millis(3), period);
            assert_eq!(scheduled, start + period * frame);
        }
        let late = scheduled + period * 10;
        assert_eq!(super::scheduled_frame_start(scheduled + period, late, period), late);
    }
    use super::*;

    #[test]
    fn source_preview_request_follows_the_size_on_screen() {
        // A 16:9 preview is not read back as the square source texture.
        let sized = SourcePreviewRequest::from_params(&json!({"layer_id":"a","width":864,"height":486,"encoding":"jpeg"}));
        assert_eq!(sized.target_size(2048, 2048), (864, 486));
        assert_eq!(sized.jpeg_quality, Some(82));
        assert!(sized.include_pixels);
        // Never larger than the crop it reads, and never absurd.
        assert_eq!(sized.target_size(320, 180), (320, 180));
        let huge = SourcePreviewRequest::from_params(&json!({"width":90000,"height":2}));
        assert_eq!(huge.target_size(4096, 4096), (1024, 16));
        // Older callers send only max_dim and get the uniform scale and raw pixels.
        let legacy = SourcePreviewRequest::from_params(&json!({"layer_id":"a","max_dim":960}));
        assert_eq!(legacy.target_size(2048, 2048), (960, 960));
        assert_eq!(legacy.target_size(2048, 1024), (960, 480));
        assert_eq!(legacy.jpeg_quality, None);
        assert_eq!(SourcePreviewRequest::from_params(&json!({})).max_dim, 640);
        assert_eq!(SourcePreviewRequest::from_params(&json!({"encoding":"JPEG","quality":500})).jpeg_quality, Some(95));
    }

    #[test]
    fn source_preview_encodes_a_jpeg_without_alpha() {
        let width = 32u32;
        let height = 18u32;
        // Premultiplied frame: half-covered orange, so colour over black is (128, 64, 0).
        let pixels: Vec<u8> = (0..width * height).flat_map(|_| [128u8, 64, 0, 128]).collect();
        let frame = FrameSnapshotReadback {
            timestamp_ms: 0, width, height, format: wgpu::TextureFormat::Rgba8Unorm,
            bytes_per_row: width * 4, padded_bytes_per_row: 256,
            metrics: snapshot_metrics(&pixels, wgpu::TextureFormat::Rgba8Unorm), pixels,
        };
        let jpeg = SourcePreviewRequest::from_params(&json!({"encoding":"jpeg"})).encode(&frame).unwrap();
        assert!(jpeg.get("rgba_b64").is_none());
        let bytes = base64::engine::general_purpose::STANDARD.decode(jpeg["jpeg_b64"].as_str().unwrap()).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap().to_rgb8();
        assert_eq!((decoded.width(), decoded.height()), (width, height));
        let px = decoded.get_pixel(16, 9);
        assert!((px[0] as i32 - 128).abs() <= 4 && (px[1] as i32 - 64).abs() <= 4 && px[2] <= 6, "{px:?}");
        // The metrics still describe the real frame, alpha included.
        assert!((jpeg["mean_rgba"][3].as_f64().unwrap() - 128.0 / 255.0).abs() < 0.01);
        // Without the encoding the raw pixels are returned as before.
        let raw = SourcePreviewRequest::from_params(&json!({})).encode(&frame).unwrap();
        assert!(raw["rgba_b64"].as_str().is_some() && raw.get("jpeg_b64").is_none());
    }

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
    fn native_video_clock_loops_and_clamps_inside_trim_bounds() {
        let mut state = NativeMediaSourceState {
            uri: "/tmp/clip.mp4".to_string(),
            source_type: "video".to_string(),
            playback_time_seconds: 2.0,
            seek_generation: 0,
            playback_rate: 1.0,
            paused: false,
            loop_enabled: true,
            bounce_enabled: false,
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
        state.playback_rate = -1.0;
        state.playback_time_seconds = 6.0;
        state.loop_enabled = true;
        assert_eq!(state.current_time_seconds(Some(0.0)), 6.0);
        assert_eq!(state.current_time_seconds(Some(1.0)), 5.0);
        assert_eq!(state.current_time_seconds(Some(5.0)), 5.0);
        state.loop_enabled = false;
        assert_eq!(state.current_time_seconds(Some(20.0)), 2.0);

        state.bounce_enabled = true;
        state.playback_rate = 1.0;
        state.playback_time_seconds = 2.0;
        for (clock, time, direction) in [(0.0, 2.0, 1.0), (4.0, 6.0, -1.0), (5.0, 5.0, -1.0), (8.0, 2.0, 1.0), (600.0, 2.0, 1.0)] {
            assert_eq!(state.current_time_seconds(Some(clock)), time);
            assert_eq!(state.current_playback_rate(Some(clock)), direction);
        }
        state.playback_time_seconds = state.current_time_seconds(Some(5.0));
        state.playback_rate = -1.0;
        state.clock_time_seconds = 5.0;
        state.paused = true;
        assert_eq!(state.current_time_seconds(Some(50.0)), 5.0);
        assert_eq!(state.current_playback_rate(Some(50.0)), -1.0);
        state.paused = false;
        state.clock_time_seconds = 50.0;
        assert_eq!(state.current_time_seconds(Some(51.0)), 4.0);
        assert_eq!(state.current_time_seconds(Some(54.0)), 3.0);
        assert_eq!(state.current_playback_rate(Some(54.0)), 1.0);

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
        ] {
            assert_eq!(
                effective_scene_source_type("image", Some(uri), false),
                "gpu:native-graph"
            );
        }

        assert_eq!(
            effective_scene_source_type("image", Some("native-effect-pass://layer-a"), false),
            "image"
        );
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
        // No tangents: not a Bezier mesh, so the shader keeps the bilinear path.
        assert_eq!(gpu.fast_flags[1], 0);
        assert!(gpu.mesh_tangents.iter().all(|v| *v == [0.0; 4]));
        // No rest of its own: cells show an even share of the whole layer.
        assert_eq!(gpu.mesh_rest[0], [0.0, 0.0, 1.0, 0.0]);
        assert_eq!(gpu.mesh_rest[1], [0.0, 1.0, 1.0, 1.0]);
    }

    /// A mesh fitted to a Custom Shape carries `rest`, where each point sits
    /// on the layer: the compositor's cells show that part of the layer
    /// (y flipped like the points). A partial or malformed rest is the even
    /// lattice, so an odd grid never shows a scrambled picture.
    #[test]
    fn scene_layer_mesh_rest_packs_the_fitted_lattice() {
        let mut layer = SceneLayer::new("fitted-layer".to_string(), 0);
        let grid = serde_json::json!({
            "rows": 2, "cols": 3,
            "points": [
                [{"x": 0.2, "y": 0.8}, {"x": 0.4, "y": 0.8}, {"x": 0.6, "y": 0.8}],
                [{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.3}, {"x": 0.6, "y": 0.3}],
            ],
            "rest": [
                [{"x": 0.2, "y": 0.8}, {"x": 0.4, "y": 0.8}, {"x": 0.6, "y": 0.8}],
                [{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.3}, {"x": 0.6, "y": 0.3}],
            ],
        });
        apply_layer_mesh_grid(&mut layer, Some(&grid));
        assert_eq!(layer.mesh_rest.len(), 6);
        let gpu = layer.gpu();
        let close = |a: [f32; 4], b: [f32; 4]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6);
        assert!(close(gpu.mesh_rest[0], [0.2, 0.2, 0.4, 0.2]), "{:?}", gpu.mesh_rest[0]);
        assert!(close(gpu.mesh_rest[1], [0.6, 0.2, 0.2, 0.7]), "{:?}", gpu.mesh_rest[1]);
        assert!(close(gpu.mesh_rest[2], [0.4, 0.7, 0.6, 0.7]), "{:?}", gpu.mesh_rest[2]);

        let partial = serde_json::json!({
            "rows": 2, "cols": 2,
            "points": [[{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 1.0}], [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}]],
            "rest": [[{"x": 0.2, "y": 0.8}, {"x": 0.6, "y": 0.8}]],
        });
        apply_layer_mesh_grid(&mut layer, Some(&partial));
        assert!(layer.mesh_rest.is_empty());
        assert_eq!(layer.gpu().mesh_rest[1], [0.0, 1.0, 1.0, 1.0]);
    }

    /// Sparse editor tangents resolve like resolveMeshTangents in
    /// meshWarp.ts: stored sides win, a missing opposite mirrors (linked
    /// handles), and untouched axes fall back to a straight edge. The
    /// packed offsets flip y with the points. A grid whose `tangents` carry
    /// nothing must stay a plain mesh so old projects render unchanged.
    #[test]
    fn scene_layer_mesh_tangents_resolve_and_pack_for_the_bezier_path() {
        let mut layer = SceneLayer::new("bezier-layer".to_string(), 0);
        let grid = serde_json::json!({
            "rows": 2, "cols": 3,
            "points": [
                [{"x": 0.0, "y": 1.0}, {"x": 0.5, "y": 1.0}, {"x": 1.0, "y": 1.0}],
                [{"x": 0.0, "y": 0.0}, {"x": 0.5, "y": 0.0}, {"x": 1.0, "y": 0.0}],
            ],
            "tangents": [
                [null, {"right": {"x": 0.1, "y": 0.2}}, null],
                [null, {"right": {"x": 0.1, "y": 0.0}, "left": {"x": -0.05, "y": 0.3}, "up": {"x": 0.0, "y": 0.25}}, null],
            ],
        });
        apply_layer_mesh_grid(&mut layer, Some(&grid));
        assert_eq!((layer.mesh_rows, layer.mesh_cols), (2, 3));
        assert_eq!(layer.mesh_tangents.len(), 6);
        // Top-middle: right stored, left mirrors it, down/up are chord thirds.
        assert_eq!(layer.mesh_tangents[1], [[0.1, 0.2], [0.0, -1.0 / 3.0], [-0.1, -0.2], [0.0, 0.0]]);
        // Bottom-middle: unlinked left, stored up mirrored into down.
        assert_eq!(layer.mesh_tangents[4], [[0.1, 0.0], [0.0, -0.25], [-0.05, 0.3], [0.0, 0.25]]);
        // Top-left corner: nothing stored, straight edges toward its neighbours.
        assert_eq!(layer.mesh_tangents[0], [[0.5 / 3.0, 0.0], [0.0, -1.0 / 3.0], [0.0, 0.0], [0.0, 0.0]]);

        let gpu = layer.gpu();
        assert_eq!(gpu.fast_flags[1], 1);
        assert_eq!(gpu.mesh_tangents[2], [0.1, -0.2, 0.0, 1.0 / 3.0]);
        assert_eq!(gpu.mesh_tangents[3], [-0.1, 0.2, 0.0, 0.0]);

        let empty = serde_json::json!({
            "rows": 2, "cols": 2,
            "points": [[{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 1.0}], [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}]],
            "tangents": [[null, null], [null, {}]],
        });
        apply_layer_mesh_grid(&mut layer, Some(&empty));
        assert_eq!((layer.mesh_rows, layer.mesh_cols), (2, 2));
        assert!(layer.mesh_tangents.is_empty());
        assert_eq!(layer.gpu().fast_flags[1], 0);
    }

    /// A Bezier mesh whose top edge bulges above the corner quad has to hand
    /// the shader a reach that holds the bulge, or the compositor clips the
    /// content at the quad while the Edge Effect outline follows the curve.
    #[test]
    fn scene_layer_bezier_mesh_bounds_hold_a_bulge_past_the_corner_quad() {
        let mut layer = SceneLayer::new("bulge-layer".to_string(), 0);
        let grid = serde_json::json!({
            "rows": 2, "cols": 2,
            "points": [[{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 1.0}], [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}]],
            "tangents": [
                [{"right": {"x": 0.3, "y": 0.3}}, {"left": {"x": -0.3, "y": 0.3}}],
                [null, null],
            ],
        });
        apply_layer_mesh_grid(&mut layer, Some(&grid));
        let gpu = layer.gpu();
        assert_eq!(gpu.fast_flags[1], 1);
        let [min_u, min_v, max_u, max_v] = gpu.mesh_bounds;
        // Layer y-up +0.3 is quad-local y-down -0.3: the handles lift the top
        // edge above v = 0, and nothing reaches past the other three sides.
        assert!((min_v + 0.3).abs() < 1e-6, "min v {min_v}");
        assert!(min_u.abs() < 1e-6 && (max_u - 1.0).abs() < 1e-6 && (max_v - 1.0).abs() < 1e-6, "{:?}", gpu.mesh_bounds);

        // A straight mesh keeps the corner quad and never reads the bounds.
        let straight = serde_json::json!({
            "rows": 2, "cols": 2,
            "points": [[{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 1.0}], [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}]],
        });
        apply_layer_mesh_grid(&mut layer, Some(&straight));
        assert_eq!(layer.gpu().mesh_bounds, [0.0; 4]);
    }

}

fn output_dimensions_admitted(width: u32, height: u32) -> bool {
    // Mirror, two creative ping-pong targets, snapshot, depth, and export.
    width > 0 && height > 0 && width <= 8192 && height <= 8192
        && (width as u64).saturating_mul(height as u64).saturating_mul(24) <= 512 * 1024 * 1024
}

/// A layer's `audioSource` packet, or the master packet when it follows none
/// (or its source has not been sent yet).
pub(crate) fn audio_visual_packet_for<'a>(
    master: &'a audio_visuals::audio_data::AudioVisualData,
    sources: &'a HashMap<String, audio_visuals::audio_data::AudioVisualData>,
    params: &Value,
) -> &'a audio_visuals::audio_data::AudioVisualData {
    params
        .get("audioSource")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
        .and_then(|key| sources.get(key))
        .unwrap_or(master)
}

#[cfg(test)]
mod audio_visual_source_tests {
    use super::*;
    use audio_visuals::audio_data::AudioVisualData;

    #[test]
    fn a_layer_reads_its_own_source_packet_or_the_master() {
        let master = AudioVisualData::default();
        let mut kick = AudioVisualData::default();
        kick.seq = 42;
        let mut sources = HashMap::new();
        sources.insert("kick".to_string(), kick);
        let pick = |p: Value| audio_visual_packet_for(&master, &sources, &p).seq;
        assert_eq!(pick(json!({ "audioSource": "kick" })), 42);
        assert_eq!(pick(json!({ "audioSource": "bass" })), master.seq, "unsent source falls back");
        assert_eq!(pick(json!({})), master.seq);
    }
}

