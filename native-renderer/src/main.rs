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
mod source_ingest;
mod outputs;

use ipc::*;
use status::*;
use gpu::*;
use visuals::*;
use isf_host::*;
use compute_runner::*;
use source_ingest::*;
use outputs::*;
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

    fn frame_snapshot(&mut self, include_pixels: bool) -> Result<Value, String> {
        self.frame_snapshot_scaled(include_pixels, 0)
    }

    fn frame_snapshot_scaled(&mut self, include_pixels: bool, max_dim: u32) -> Result<Value, String> {
        let readback = self.read_frame_snapshot_scaled(max_dim)?;
        Ok(readback.to_json(include_pixels))
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
    fn layer_color_updates_do_not_reclassify_source_kind() {
        let mut layer = SceneLayer::new("gpu-layer".to_string(), 0);
        layer.source_kind = source_kind("gpu:ink-cloud");

        set_scene_layer_color(&mut layer, [0.25, 0.5, 0.75, 0.8]);

        assert_eq!(layer.color, [0.25, 0.5, 0.75, 0.8]);
        assert_eq!(layer.source_kind, source_kind("gpu:ink-cloud"));
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

