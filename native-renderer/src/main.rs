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
mod frame_loop;
mod pacing;
mod policy;
mod snapshots;
mod source_previews;
mod audio_host;
mod util;

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
use pacing::*;
use snapshots::*;
use source_previews::*;
use util::*;
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
