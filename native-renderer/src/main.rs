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
mod stage3d;
mod projection_sim;
mod clock;

use ipc::*;
use status::*;
use gpu::*;
use visuals::*;
use isf_host::*;
use compute_runner::*;
use source_ingest::*;
use outputs::*;
use compositor::*;
use stage3d::*;
use projection_sim::*;
use clock::*;
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

