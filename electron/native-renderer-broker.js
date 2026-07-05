import { spawn } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const COMMAND_PREFIX = 'native_renderer_';
const SOURCE_FRAME_FILE_HANDOFF_B64_THRESHOLD = 512 * 1024;
const VIDEO_FRAME_PREFETCH_TIMEOUT_MS = 8000;
const VIDEO_FRAME_PREFETCH_CACHE_MAX_ENTRIES = 24;
const VIDEO_FRAME_PREFETCH_CACHE_FPS = 30;
const STATIC_IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.jpg',
  '.jpeg',
  '.png',
  '.tga',
  '.tif',
  '.tiff',
  '.webp',
]);
const VIDEO_EXTENSIONS = new Set([
  '.avi',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogv',
  '.webm',
]);
const REQUIRED_NATIVE_GRAPH_INSTRUMENTS = [
  ['planet', 'Native Planet graph', 'native_planet_graph'],
  ['smoke-3d', 'Native 3D Smoke graph', 'native_3d_smoke_graph'],
  ['particle-field', 'Native Particle Field graph', 'native_particle_field_graph'],
  ['volumetric-spheres', 'Native Volumetric Spheres graph', 'native_volumetric_spheres_graph'],
  ['smoke-riders', 'Native Smoke Riders graph', 'native_smoke_riders_graph'],
  ['ink-cloud', 'Native Ink Cloud graph', 'native_ink_cloud_graph'],
  ['flythrough', 'Native Flythrough graph', 'native_flythrough_graph'],
  ['pixel-particles', 'Native Pixel Particles graph', 'native_pixel_particles_graph'],
  ['point-cloud-fx', 'Native Point Cloud FX graph', 'native_point_cloud_fx_graph'],
];

function nativeGraphReadinessId(id) {
  return id === 'smoke-3d' ? 'native-3d-smoke-graph' : `native-${id}-graph`;
}

function looksLikeStaticImageUri(uri) {
  const clean = String(uri || '').split('#')[0].split('?')[0].toLowerCase();
  if (!clean) return false;
  return STATIC_IMAGE_EXTENSIONS.has(path.extname(clean));
}

function looksLikeVideoUri(uri) {
  const clean = String(uri || '').split('#')[0].split('?')[0].toLowerCase();
  if (!clean) return false;
  return VIDEO_EXTENSIONS.has(path.extname(clean));
}

const RENDERER_COMMANDS = [
  'native_renderer_start',
  'native_renderer_stop',
  'native_renderer_submit_batch',
  'native_renderer_submit_commands',
  'native_renderer_run_compute_graph',
  'native_renderer_upload_source_gpu_shared_texture',
  'native_renderer_prefetch_media',
  'native_renderer_clear_prefetch_cache',
  'native_renderer_clear_decode_preview_cache',
  'native_renderer_clear_runtime_caches',
  'native_renderer_set_vram_budget',
  'native_renderer_set_target_fps',
  'native_renderer_set_render_clock',
  'native_renderer_set_command_drain_policy',
  'native_renderer_set_auto_present_policy',
  'native_renderer_set_decode_cpu_backup_policy',
  'native_renderer_set_decode_synthetic_fallback_policy',
  'native_renderer_set_texture_pool_cap',
  'native_renderer_set_native_quality_policy',
  'native_renderer_set_shader_precompile_policy',
  'native_renderer_set_media_prefetch_policy',
  'native_renderer_set_media_drop_policy',
  'native_renderer_set_decode_preview_policy',
  'native_renderer_set_decode_target_policy',
  'native_renderer_set_decode_upload_policy',
  'native_renderer_set_decode_handoff_policy',
  'native_renderer_set_decode_estimate_cache_policy',
  'native_renderer_set_present_policy',
  'native_renderer_set_metadata_cache_caps',
  'native_renderer_attach_output_window',
  'native_renderer_detach_output_window',
  'native_renderer_get_status',
  'native_renderer_get_stats',
  'native_renderer_get_snapshot',
  'native_renderer_get_frame_snapshot',
  'native_renderer_export_frame_snapshot',
  'native_renderer_get_output_shared_texture',
  'native_renderer_set_stage3d_scene',
  'native_renderer_get_stage3d_scene_summary',
  'native_renderer_set_projection_sim_scene',
  'native_renderer_get_projection_sim_scene_summary',
  'native_renderer_get_capabilities',
  'native_renderer_get_readiness_report',
  'native_renderer_export_snapshot_json',
  'native_renderer_reset_stats',
  // Legacy aliases kept so older renderer bundles don't explode.
  'native_renderer_set_decode_policy',
  'native_renderer_set_prefetch_policy',
  'native_renderer_get_decode_capabilities',
  'native_renderer_set_output_window',
];

const BROKER_UNSUPPORTED_COMMANDS = new Map([
  ['native_renderer_set_decode_policy', 'legacy decode policy API is not implemented by this core'],
  ['native_renderer_set_prefetch_policy', 'legacy prefetch policy API is not implemented by this core'],
]);

function normalizeSourceFrameBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  return null;
}

function resolveLocalMediaPath(uri) {
  const value = String(uri || '').trim();
  if (!value) return null;
  if (/^file:/i.test(value)) {
    try {
      return fileURLToPath(value);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return path.resolve(value);
}

function resolveFfmpegPath(env = process.env, platform = process.platform) {
  const envPath = env?.GA_FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  try {
    const staticPath = require('ffmpeg-static');
    if (typeof staticPath === 'string' && staticPath) {
      const unpackedPath = staticPath.replace('app.asar', 'app.asar.unpacked');
      const candidate = fs.existsSync(unpackedPath) ? unpackedPath : staticPath;
      if (fs.existsSync(candidate)) {
        if (platform !== 'win32') {
          try { fs.chmodSync(candidate, 0o755); } catch {}
        }
        return candidate;
      }
    }
  } catch {
    // Fall through to PATH lookup; decode will report the real spawn error.
  }

  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function videoFramePrefetchStatus(env = process.env, platform = process.platform) {
  const ffmpegPath = resolveFfmpegPath(env, platform);
  if (!ffmpegPath) {
    return {
      available: false,
      ffmpegPath: null,
      reason: 'ffmpeg-static/PATH ffmpeg was not resolved',
    };
  }
  return {
    available: true,
    ffmpegPath,
    reason: null,
  };
}

function decodeVideoFrameToRgba({
  uri,
  width,
  height,
  timeSeconds = 0,
  env = process.env,
  platform = process.platform,
}) {
  const localPath = resolveLocalMediaPath(uri);
  if (!localPath) {
    return Promise.reject(new Error('native video frame prefetch currently supports local video files only'));
  }
  let stat = null;
  try {
    stat = fs.statSync(localPath);
  } catch (err) {
    return Promise.reject(new Error(`native video frame prefetch cannot read ${localPath}: ${err?.message || err}`));
  }
  if (!stat.isFile()) {
    return Promise.reject(new Error(`native video frame prefetch expected a file: ${localPath}`));
  }

  const targetWidth = Math.max(16, Math.min(4096, Math.round(Number(width) || 256)));
  const targetHeight = Math.max(16, Math.min(4096, Math.round(Number(height) || targetWidth)));
  const expectedBytes = targetWidth * targetHeight * 4;
  const ffmpegPath = resolveFfmpegPath(env, platform);
  const seconds = Math.max(0, Math.min(3600, Number(timeSeconds) || 0));
  const scale = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`;
  const pad = `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-ss',
    seconds.toFixed(3),
    '-i',
    localPath,
    '-frames:v',
    '1',
    '-vf',
    `${scale},${pad},format=rgba`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    const chunks = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timer = null;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(result);
    };

    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish(new Error(`native video frame prefetch timed out after ${VIDEO_FRAME_PREFETCH_TIMEOUT_MS}ms`));
    }, VIDEO_FRAME_PREFETCH_TIMEOUT_MS);
    timer.unref?.();

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > expectedBytes + 4096) {
        try { child.kill('SIGKILL'); } catch {}
        finish(new Error(`native video frame prefetch produced too much data (${outputBytes} bytes)`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr.push(Buffer.from(chunk));
    });
    child.on('error', (err) => {
      finish(new Error(`native video frame prefetch failed to launch ffmpeg: ${err?.message || err}`));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      const output = Buffer.concat(chunks, outputBytes);
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        finish(new Error(`native video frame prefetch ffmpeg failed (${code ?? signal ?? 'unknown'}): ${detail}`));
        return;
      }
      if (output.length < expectedBytes) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        finish(new Error(`native video frame prefetch decoded ${output.length}/${expectedBytes} bytes${detail ? `: ${detail}` : ''}`));
        return;
      }
      finish(null, {
        rgba: output.length === expectedBytes ? output : output.subarray(0, expectedBytes),
        width: targetWidth,
        height: targetHeight,
        localPath,
        byteLength: expectedBytes,
      });
    });
  });
}

export function nativeRendererCommandNames() {
  return RENDERER_COMMANDS.slice();
}

export function createNativeRendererBroker({
  appRoot,
  resourcesPath,
  isPackaged,
  platform,
  env = process.env,
  textureShareStatusProvider = null,
  nativeFrameEncoderStatusProvider = null,
}) {
  return new NativeRendererBroker({
    appRoot,
    resourcesPath,
    isPackaged,
    platform,
    env,
    textureShareStatusProvider,
    nativeFrameEncoderStatusProvider,
  });
}

class NativeRendererBroker {
  constructor({ appRoot, resourcesPath, isPackaged, platform, env, textureShareStatusProvider, nativeFrameEncoderStatusProvider }) {
    this.appRoot = appRoot;
    this.resourcesPath = resourcesPath;
    this.isPackaged = isPackaged;
    this.platform = platform;
    this.env = env;
    this.textureShareStatusProvider =
      typeof textureShareStatusProvider === 'function' ? textureShareStatusProvider : null;
    this.nativeFrameEncoderStatusProvider =
      typeof nativeFrameEncoderStatusProvider === 'function' ? nativeFrameEncoderStatusProvider : null;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.tempFrameDir = null;
    this.tempFrameSerial = 1;
    this.lastStatus = makeDefaultStatus({
      backend: platform === 'darwin' ? 'metal' : platform === 'win32' ? 'd3d12' : 'vulkan',
      last_frame_error: 'Native render core has not started',
    });
    this.stats = makeDefaultStats();
    this.videoFramePrefetchCache = new Map();
    this.videoFramePrefetchCacheMaxEntries = VIDEO_FRAME_PREFETCH_CACHE_MAX_ENTRIES;
    this.capabilities = makeDefaultCapabilities({
      backend: this.lastStatus.backend,
      running: false,
    });
    this.coreCapabilitiesConfirmed = false;
    this.coreCapabilitiesError = 'Native render core has not started';
  }

  async invoke(command, args = {}) {
    if (this.env.GA_DISABLE_NATIVE_RENDERER === '1') {
      if (command === 'native_renderer_start') {
        this.lastStatus = makeDefaultStatus({
          backend: null,
          last_frame_error: 'Native renderer disabled by GA_DISABLE_NATIVE_RENDERER=1',
        });
        return this.lastStatus;
      }
      if (command === 'native_renderer_get_status') return this.lastStatus;
      if (command === 'native_renderer_get_stats') return this.stats;
      if (command === 'native_renderer_get_snapshot') return this.snapshot();
      if (command === 'native_renderer_get_frame_snapshot') return null;
      if (command === 'native_renderer_export_frame_snapshot') return null;
      if (command === 'native_renderer_get_output_shared_texture') {
        return makeDefaultOutputSharedTexture(this.platform);
      }
      if (command === 'native_renderer_get_capabilities') return this.capabilities;
      if (command === 'native_renderer_get_decode_capabilities') return this.withBrokerDecodeCapabilities(this.decodeCapabilities());
      if (command === 'native_renderer_get_readiness_report') return this.readinessReport();
      if (command === 'native_renderer_export_snapshot_json') return this.exportSnapshotJson(args);
      return null;
    }

    switch (command) {
      case 'native_renderer_start':
        return this.start(args);
      case 'native_renderer_stop':
        return this.stop();
      case 'native_renderer_get_status':
        return this.getStatus();
      case 'native_renderer_get_stats':
        return this.getStats();
      case 'native_renderer_get_snapshot':
        return this.snapshot();
      case 'native_renderer_get_frame_snapshot':
        return this.sendIfRunning('frame_snapshot', args, { fallback: null, timeoutMs: 5000 });
      case 'native_renderer_export_frame_snapshot':
        return this.sendIfRunning('export_frame_snapshot', args, { fallback: null, timeoutMs: 30000 });
      case 'native_renderer_get_output_shared_texture':
        return this.sendIfRunning('output_shared_texture', args, {
          fallback: makeDefaultOutputSharedTexture(this.platform),
          timeoutMs: 2500,
        });
      case 'native_renderer_set_stage3d_scene':
        return this.sendIfRunning('set_stage3d_scene', args, { fallback: null, timeoutMs: 2500 });
      case 'native_renderer_get_stage3d_scene_summary':
        return this.sendIfRunning('get_stage3d_scene_summary', args, { fallback: null, timeoutMs: 2500 });
      case 'native_renderer_set_projection_sim_scene':
        return this.sendIfRunning('set_projection_sim_scene', args, { fallback: null, timeoutMs: 2500 });
      case 'native_renderer_get_projection_sim_scene_summary':
        return this.sendIfRunning('get_projection_sim_scene_summary', args, { fallback: null, timeoutMs: 2500 });
      case 'native_renderer_get_capabilities':
        return this.getCapabilities();
      case 'native_renderer_get_decode_capabilities':
        return this.getDecodeCapabilities();
      case 'native_renderer_get_readiness_report':
        return this.readinessReport();
      case 'native_renderer_export_snapshot_json':
        return this.exportSnapshotJson(args);
      case 'native_renderer_reset_stats':
        this.stats = makeDefaultStats();
        this.lastStatus = {
          ...this.lastStatus,
          ...this.videoFramePrefetchCacheStats(),
        };
        return this.sendIfRunning('reset_stats', args, { fallback: null });
      case 'native_renderer_submit_batch':
        return this.sendNativeCommandPayloadIfRunning('submit_batch', args, { fallback: null, timeoutMs: 2500 });
      case 'native_renderer_submit_commands':
        return this.sendNativeCommandPayloadIfRunning('submit_commands', args, { fallback: null, timeoutMs: 2500 });
      case 'native_renderer_run_compute_graph':
        return this.sendNativeComputeGraphPayloadIfRunning('compute_graph', args, { fallback: null, timeoutMs: 10000 });
      case 'native_renderer_upload_source_gpu_shared_texture':
        return this.uploadSourceGpuSharedTexture(args);
      case 'native_renderer_prefetch_media':
        return this.prefetchMedia(args);
      case 'native_renderer_clear_prefetch_cache':
        return this.clearPrefetchCache();
      case 'native_renderer_set_target_fps':
        return this.sendIfRunning('set_target_fps', args, { fallback: null });
      case 'native_renderer_set_present_policy':
        return this.sendIfRunning('set_present_policy', args, { fallback: null });
      case 'native_renderer_set_command_drain_policy':
        return this.sendIfRunning('set_command_drain_policy', args, { fallback: null });
      case 'native_renderer_set_auto_present_policy':
        return this.sendIfRunning('set_auto_present_policy', args, { fallback: null });
      case 'native_renderer_attach_output_window':
        return this.sendIfRunning('attach_output_window', args, { fallback: null });
      case 'native_renderer_detach_output_window':
        return this.sendIfRunning('detach_output_window', args, { fallback: null });
      case 'native_renderer_set_output_window':
        return this.sendIfRunning('set_output_window', args, { fallback: null });
      default:
        if (BROKER_UNSUPPORTED_COMMANDS.has(command)) {
          return Promise.reject(this.unsupportedError(command));
        }
        return this.sendAdvertisedCoreMethod(command, args);
    }
  }

  async start(args = {}) {
    const executable = this.findExecutable();
    if (!executable) {
      this.lastStatus = makeDefaultStatus({
        backend: this.platform === 'darwin' ? 'metal' : this.platform === 'win32' ? 'd3d12' : 'vulkan',
        last_frame_error:
          'Native render core binary missing. Run `npm run native:build` to build ghost-render-core.',
      });
      return this.lastStatus;
    }
    this.ensureProcess(executable);
    const result = await this.send('start', args, { timeoutMs: 8000 });
    this.lastStatus = normalizeStatus(result, this.lastStatus);
    try {
      await this.refreshCapabilities({ requireCore: true });
    } catch (err) {
      this.lastStatus = {
        ...this.lastStatus,
        backend_ready: false,
        last_frame_error: `Native render core capabilities handshake failed: ${err?.message || String(err)}`,
      };
    }
    return this.lastStatus;
  }

  async uploadSourceGpuSharedTexture(args = {}) {
    const sourceId = String(args.source_id ?? args.sourceId ?? '').trim();
    if (!sourceId) {
      return Promise.reject(new Error('native shared texture source-frame upload requires source_id'));
    }
    const payload = {
      source_id: sourceId,
      width: Number(args.width ?? 0),
      height: Number(args.height ?? 0),
      shared_handle: args.shared_handle ?? args.handle ?? '',
      shared_texture_platform: args.shared_texture_platform ?? args.platform,
      shared_texture_format: args.shared_texture_format ?? args.format,
      shared_texture_handle_encoding:
        args.shared_texture_handle_encoding ?? args.handle_encoding ?? args.handleEncoding,
      shared_texture_handle_byte_length:
        args.shared_texture_handle_byte_length ?? args.handle_byte_length ?? args.handleByteLength,
      shared_texture_frame: args.shared_texture_frame ?? args.frame,
      shared_texture_sender_name:
        args.shared_texture_sender_name ?? args.sender_name ?? args.senderName,
      seq: Number(args.seq ?? args.frame ?? 0),
    };
    if ((this.capabilities?.implemented_methods ?? []).includes('upload_source_gpu_shared_texture')) {
      try {
        const result = await this.send('upload_source_gpu_shared_texture', payload, { timeoutMs: 2500 });
        this.lastStatus = normalizeStatus(result, this.lastStatus);
        return this.lastStatus;
      } catch (err) {
        if (!String(err?.message || err).includes('unsupported native render-core RPC method')) {
          throw err;
        }
      }
    }
    const command = {
      type: 'upload_source_frame',
      ...payload,
    };
    await this.sendNativeCommandPayloadIfRunning('submit_commands', { commands: [command] }, {
      fallback: null,
      timeoutMs: 2500,
    });
    return this.getStatus();
  }

  async prefetchMedia(args = {}) {
    const sourceId = String(args.source_id ?? args.sourceId ?? '').trim();
    const uri = String(args.uri ?? args.src ?? '').trim();
    if (!sourceId) {
      throw new Error('native media prefetch requires source_id');
    }
    if (!uri) {
      throw new Error('native media prefetch requires uri');
    }
    const sourceType = String(args.source_type ?? args.sourceType ?? '').trim().toLowerCase();
    const imageSource = sourceType === 'image' || (!sourceType && looksLikeStaticImageUri(uri));
    const videoSource = sourceType === 'video' || (!sourceType && looksLikeVideoUri(uri));
    if (videoSource) {
      const features = this.capabilities?.features && typeof this.capabilities.features === 'object'
        ? this.capabilities.features
        : {};
      if (
        features.native_video_frame_decode &&
        (this.capabilities?.implemented_methods ?? []).includes('prefetch_media') &&
        this.env.GA_FORCE_BROKER_VIDEO_PREFETCH !== '1' &&
        this.child &&
        !this.child.killed
      ) {
        try {
          const result = await this.send(
            'prefetch_media',
            {
              source_id: sourceId,
              uri,
              source_type: 'video',
              priority: Number(args.priority ?? 1),
              decode_width: args.decode_width ?? args.decodeWidth ?? args.width ?? args.decode_size ?? args.decodeSize,
              decode_height: args.decode_height ?? args.decodeHeight ?? args.height ?? args.decode_size ?? args.decodeSize,
              time_seconds: args.time_seconds ?? args.timeSeconds ?? args.time,
              prefetch_window_frames:
                args.prefetch_window_frames ?? args.prefetchWindowFrames ?? args.window_frames ?? args.windowFrames,
              prefetch_fps: args.prefetch_fps ?? args.prefetchFps ?? args.fps,
              seq: args.seq,
            },
            { timeoutMs: VIDEO_FRAME_PREFETCH_TIMEOUT_MS + 2500 },
          );
          this.lastStatus = normalizeStatus(result, this.lastStatus);
          return this.lastStatus;
        } catch (err) {
          if (!String(err?.message || err).includes('unsupported native render-core RPC method')) {
            throw err;
          }
        }
      }
      return this.prefetchVideoFrame({
        ...args,
        source_id: sourceId,
        sourceId,
        uri,
      });
    }
    if (!imageSource) {
      throw new Error(
        'Unsupported native renderer command native_renderer_prefetch_media: native prefetch currently supports local static images and timestamped local video frames only',
      );
    }
    const payload = {
      source_id: sourceId,
      uri,
      source_type: 'image',
      priority: Number(args.priority ?? 1),
    };
    if ((this.capabilities?.implemented_methods ?? []).includes('prefetch_media')) {
      const result = await this.sendIfRunning('prefetch_media', payload, { fallback: null, timeoutMs: 5000 });
      if (result) {
        this.lastStatus = normalizeStatus(result, this.lastStatus);
        return this.lastStatus;
      }
    }
    await this.sendNativeCommandPayloadIfRunning(
      'submit_commands',
      {
        commands: [
          {
            type: 'decode_media_source',
            source_id: payload.source_id,
            uri: payload.uri,
            source_type: 'image',
          },
        ],
      },
      { fallback: null, timeoutMs: 5000 },
    );
    return this.getStatus();
  }

  async prefetchVideoFrame(args = {}) {
    const sourceId = String(args.source_id ?? args.sourceId ?? '').trim();
    const uri = String(args.uri ?? args.src ?? '').trim();
    if (!sourceId) {
      throw new Error('native video frame prefetch requires source_id');
    }
    if (!uri) {
      throw new Error('native video frame prefetch requires uri');
    }
    const width = Number(
      args.decode_width ?? args.decodeWidth ?? args.width ?? args.decode_size ?? args.decodeSize ?? 256,
    );
    const height = Number(
      args.decode_height ?? args.decodeHeight ?? args.height ?? args.decode_size ?? args.decodeSize ?? width,
    );
    const request = this.videoFramePrefetchRequest(
      uri,
      width,
      height,
      Number(args.time_seconds ?? args.timeSeconds ?? args.time ?? 0),
    );
    const prefetchWindowFrames = Math.max(
      0,
      Math.min(
        4,
        Math.round(
          Number(args.prefetch_window_frames ?? args.prefetchWindowFrames ?? args.window_frames ?? args.windowFrames ?? 0),
        ),
      ),
    );
    const prefetchFps = Math.max(
      1,
      Math.min(120, Number(args.prefetch_fps ?? args.prefetchFps ?? args.fps ?? 30)),
    );
    let frame = this.getCachedVideoFramePrefetch(request);
    if (!frame) {
      this.stats.video_frame_prefetch_cache_misses =
        Number(this.stats.video_frame_prefetch_cache_misses ?? 0) + 1;
      this.stats.ffmpeg_decode_spawns = Number(this.stats.ffmpeg_decode_spawns ?? 0) + 1;
      try {
        frame = await decodeVideoFrameToRgba({
          uri: request.localPath,
          width: request.width,
          height: request.height,
          timeSeconds: request.seconds,
          env: this.env,
          platform: this.platform,
        });
        this.stats.ffmpeg_decode_successes = Number(this.stats.ffmpeg_decode_successes ?? 0) + 1;
        this.storeVideoFramePrefetch(request, frame);
      } catch (err) {
        this.stats.ffmpeg_decode_failures = Number(this.stats.ffmpeg_decode_failures ?? 0) + 1;
        throw err;
      }
    }
    await this.prefetchVideoFrameWindow({
      uri,
      width: request.width,
      height: request.height,
      timeSeconds: request.seconds,
      prefetchWindowFrames,
      prefetchFps,
    });
    const submitResult = await this.sendNativeCommandPayloadIfRunning(
      'submit_commands',
      {
        commands: [
          {
            type: 'upload_source_frame',
            source_id: sourceId,
            width: frame.width,
            height: frame.height,
            rgba_buffer: frame.rgba,
            seq: Number(args.seq ?? Date.now()),
          },
        ],
      },
      { fallback: null, timeoutMs: VIDEO_FRAME_PREFETCH_TIMEOUT_MS + 2500 },
    );
    if (!submitResult) {
      throw new Error('native video frame prefetch decoded a frame, but the native core did not accept the source-frame upload');
    }
    return this.withBrokerVideoFramePrefetchStats(await this.getStatus());
  }

  async prefetchVideoFrameWindow({
    uri,
    width,
    height,
    timeSeconds,
    prefetchWindowFrames = 0,
    prefetchFps = 30,
  } = {}) {
    if (!prefetchWindowFrames) return;
    const frameStep = 1 / Math.max(1, Math.min(120, Number(prefetchFps) || 30));
    for (let frameOffset = 1; frameOffset <= prefetchWindowFrames; frameOffset += 1) {
      const request = this.videoFramePrefetchRequest(
        uri,
        width,
        height,
        Math.max(0, Number(timeSeconds ?? 0) + frameStep * frameOffset),
      );
      if (this.videoFramePrefetchCache.has(request.key)) continue;
      this.stats.video_frame_prefetch_cache_misses =
        Number(this.stats.video_frame_prefetch_cache_misses ?? 0) + 1;
      this.stats.ffmpeg_decode_spawns = Number(this.stats.ffmpeg_decode_spawns ?? 0) + 1;
      try {
        const frame = await decodeVideoFrameToRgba({
          uri: request.localPath,
          width: request.width,
          height: request.height,
          timeSeconds: request.seconds,
          env: this.env,
          platform: this.platform,
        });
        this.stats.ffmpeg_decode_successes = Number(this.stats.ffmpeg_decode_successes ?? 0) + 1;
        this.storeVideoFramePrefetch(request, frame);
      } catch (err) {
        this.stats.ffmpeg_decode_failures = Number(this.stats.ffmpeg_decode_failures ?? 0) + 1;
        break;
      }
    }
  }

  async clearPrefetchCache() {
    const clearedVideoFramePrefetchEntries = this.clearBrokerVideoFramePrefetchCache();
    if ((this.capabilities?.implemented_methods ?? []).includes('clear_prefetch_cache')) {
      const result = await this.sendIfRunning('clear_prefetch_cache', {}, { fallback: null, timeoutMs: 1000 });
      if (result) {
        return {
          ...result,
          cleared_video_frame_prefetch_entries: clearedVideoFramePrefetchEntries,
          ...this.videoFramePrefetchCacheStats(),
        };
      }
    }
    const result = await this.sendIfRunning(
      'clear_runtime_caches',
      {
        config: {
          clear_precompiled_shaders: false,
          clear_texture_pool: false,
          clear_metadata_caches: false,
          clear_prefetch_cache: true,
        },
      },
      { fallback: { cleared_source_frame_signatures: 0 }, timeoutMs: 1000 },
    );
    return {
      ...(result ?? {}),
      cleared_video_frame_prefetch_entries: clearedVideoFramePrefetchEntries,
      ...this.videoFramePrefetchCacheStats(),
    };
  }

  async getDecodeCapabilities() {
    if ((this.capabilities?.implemented_methods ?? []).includes('get_decode_capabilities')) {
      const result = await this.sendIfRunning('get_decode_capabilities', {}, { fallback: null, timeoutMs: 1000 });
      if (result) return this.withBrokerDecodeCapabilities(result);
    }
    return this.withBrokerDecodeCapabilities(this.decodeCapabilities());
  }

  decodeCapabilities() {
    const features = this.capabilities?.features && typeof this.capabilities.features === 'object'
      ? this.capabilities.features
      : {};
    return {
      schema_version: 1,
      native_static_image_decode: !!features.native_static_image_decode,
      native_static_image_prefetch: !!features.native_static_image_prefetch,
      native_media_decode: !!features.native_media_decode,
      media_prefetch: !!features.media_prefetch,
      video_decode: !!features.native_media_decode,
      source_frame_fallback: !!features.source_frame_upload,
      shared_texture_source_frame_upload: !!features.shared_texture_source_frame_upload,
      shared_texture_upload: !!features.shared_texture_upload,
      supported_source_types: features.native_static_image_decode ? ['image'] : [],
      supported_static_image_extensions: Array.from(STATIC_IMAGE_EXTENSIONS).map((ext) => ext.slice(1)),
      notes: features.native_static_image_decode
        ? [
            'Local still images can decode directly into native source-frame textures.',
            'Video and full media prefetch still use source-frame/shared-texture fallback paths.',
          ]
        : ['Native render core is not running or does not advertise static image decode.'],
    };
  }

  withBrokerDecodeCapabilities(caps = {}) {
    const videoFramePrefetch = this.videoFramePrefetchStatus();
    const supportedSourceTypes = new Set(
      Array.isArray(caps.supported_source_types) ? caps.supported_source_types.map(String) : [],
    );
    if (videoFramePrefetch.available) supportedSourceTypes.add('video');
    const notes = Array.isArray(caps.notes) ? caps.notes.map(String) : [];
    if (
      videoFramePrefetch.available &&
      !notes.some((note) => note.includes('Local video files can prefetch bounded FFmpeg-decoded frames'))
    ) {
      notes.push(
        'Local video files can prefetch bounded FFmpeg-decoded frames and adjacent-frame windows into native source-frame textures; continuous in-core native video decode is still pending.',
      );
    }
    return {
      ...caps,
      native_video_frame_prefetch: !!videoFramePrefetch.available,
      native_video_frame_prefetch_window: !!videoFramePrefetch.available,
      video_frame_prefetch: !!videoFramePrefetch.available,
      video_frame_prefetch_encoder: videoFramePrefetch.available ? 'ffmpeg' : null,
      video_frame_prefetch_path: videoFramePrefetch.ffmpegPath ?? null,
      supported_source_types: Array.from(supportedSourceTypes),
      supported_video_extensions: Array.from(VIDEO_EXTENSIONS).map((ext) => ext.slice(1)),
      notes,
    };
  }

  async stop() {
    try {
      await this.sendIfRunning('stop', {}, { fallback: null, timeoutMs: 1000 });
    } finally {
      this.killProcess();
      this.lastStatus = makeDefaultStatus({
        backend: this.platform === 'darwin' ? 'metal' : this.platform === 'win32' ? 'd3d12' : 'vulkan',
        last_frame_error: 'Native render core stopped',
      });
      this.capabilities = makeDefaultCapabilities({
        backend: this.lastStatus.backend,
        running: false,
      });
      this.coreCapabilitiesConfirmed = false;
      this.coreCapabilitiesError = 'Native render core stopped';
    }
    return null;
  }

  shutdownSync() {
    this.killProcess();
    this.cleanupTempFrameDir();
  }

  async getStatus() {
    const result = await this.sendIfRunning('status', {}, { fallback: this.lastStatus, timeoutMs: 1000 });
    this.lastStatus = normalizeStatus(result, this.lastStatus);
    return this.lastStatus;
  }

  async getStats() {
    const result = await this.sendIfRunning('stats', {}, { fallback: this.stats, timeoutMs: 1000 });
    this.stats = normalizeStats(result, this.stats);
    return this.stats;
  }

  async getCapabilities() {
    if (!this.child || this.child.killed) return this.capabilities;
    await this.refreshCapabilities();
    return this.capabilities;
  }

  async refreshCapabilities({ requireCore = false } = {}) {
    const fallback = this.capabilities;
    if (!this.child || this.child.killed) {
      if (requireCore) {
        throw new Error('Native render core process is not running');
      }
      return fallback;
    }
    let result;
    try {
      result = await this.send('get_capabilities', {}, { timeoutMs: 1000 });
      this.coreCapabilitiesConfirmed = true;
      this.coreCapabilitiesError = null;
    } catch (err) {
      this.coreCapabilitiesConfirmed = false;
      this.coreCapabilitiesError = err?.message || String(err);
      this.capabilities = makeDefaultCapabilities({
        backend: fallback?.backend ?? this.lastStatus?.backend ?? null,
        running: !!(this.child && !this.child.killed),
        core_capabilities_confirmed: false,
        core_capabilities_error: this.coreCapabilitiesError,
        notes: [`Native render core capabilities handshake failed: ${this.coreCapabilitiesError}`],
      });
      this.lastStatus = {
        ...this.lastStatus,
        backend_ready: false,
        last_frame_error: this.capabilities.notes[0],
      };
      if (requireCore) throw err;
      return this.capabilities;
    }
    this.capabilities = applyBrokerCapabilityOverlay(
      {
        ...normalizeCapabilities(result, fallback),
        core_capabilities_confirmed: true,
        core_capabilities_error: null,
      },
      this.textureShareStatus(),
      this.nativeFrameEncoderStatus(),
      this.videoFramePrefetchStatus(),
    );
    return this.capabilities;
  }

  snapshot() {
    return {
      timestamp_ms: Date.now(),
      status: this.lastStatus,
      stats: this.stats,
      capabilities: this.capabilities,
    };
  }

  async exportSnapshotJson(args = {}) {
    const outPath = typeof args === 'string'
      ? args
      : args?.path || args?.file_path || args?.output_path;
    if (!outPath || typeof outPath !== 'string') {
      throw new Error('native snapshot export requires a target path');
    }
    if (this.child && !this.child.killed) {
      await this.getStatus();
      await this.getStats();
      await this.refreshCapabilities();
    }
    const payload = this.snapshot();
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, body, 'utf8');
    return {
      path: outPath,
      bytes: Buffer.byteLength(body),
      timestamp_ms: payload.timestamp_ms,
    };
  }

  readinessReport() {
    const binary = this.findExecutable();
    const blockers = [];
    if (!binary) blockers.push('native render-core binary is missing');
    if (!this.lastStatus.backend_ready) blockers.push(this.lastStatus.last_frame_error || 'native render-core is not ready');
    if (this.child && !this.child.killed && !this.capabilities?.core_capabilities_confirmed) {
      blockers.push(this.capabilities?.core_capabilities_error || 'native render-core capabilities have not been confirmed');
    }
    const features = this.capabilities?.features || {};
    const textureShare = this.textureShareStatus();
    const nativeFrameEncoder = this.nativeFrameEncoderStatus();
    const videoFramePrefetch = this.videoFramePrefetchStatus();
    const graphInstruments = nativeGraphInstrumentSet(this.capabilities);
    const computeGraphHostReady = !!(
      features.compute_shader_host &&
      features.compute_graph_host &&
      features.compute_graph_render &&
      features.compute_graph_source_frame_target &&
      features.persistent_compute_buffers
    );
    const graphChecks = REQUIRED_NATIVE_GRAPH_INSTRUMENTS.map(([id, label, feature]) => {
      const ok = computeGraphHostReady && !!features[feature] && graphInstruments.has(id);
      return [
        nativeGraphReadinessId(id),
        label,
        ok,
        ok
          ? 'implemented via compute_graph source-frame route'
          : `missing ${feature} or ${id} manifest entry`,
      ];
    });
    const allGraphInstrumentsReady = graphChecks.every(([, , ok]) => ok);
    const textureShareName = textureShare?.label || textureShare?.platform || 'Texture share';
    const textureShareDetail = textureShare
      ? [
          `${textureShareName} ${textureShare.available ? 'available' : 'unavailable'}`,
          textureShare.senderMode ? `mode=${textureShare.senderMode}` : null,
          textureShare.error ? `error=${textureShare.error}` : null,
        ].filter(Boolean).join(' ')
      : 'not connected to Electron texture-share status';
    const managedOutputOk = !!(
      features.managed_output_attach &&
      this.lastStatus.output_window_attached &&
      this.lastStatus.output_swapchain_ready &&
      this.lastStatus.output_present_healthy &&
      Number(this.lastStatus.frames_presented ?? 0) > 0
    );
    const managedOutputDetail = !features.managed_output_attach
      ? 'managed output attach is not implemented'
      : !this.lastStatus.output_window_attached
        ? 'native output window is detached/hidden'
        : Number(this.lastStatus.frames_presented ?? 0) <= 0
          ? `waiting for first native swapchain present; last=${this.lastStatus.swapchain_last_present_result || 'none'}`
          : this.lastStatus.output_present_consecutive_failures > 0
            ? `native output present has ${this.lastStatus.output_present_consecutive_failures} consecutive failure(s); last=${this.lastStatus.swapchain_last_present_result || 'none'}`
            : `presented ${this.lastStatus.frames_presented} native frame(s)`;
    const nativeTextureShareSenderOk = !!(
      features.shared_texture_output_export &&
      textureShare?.available &&
      (textureShare.nativeOutputCapable || textureShare.nativeOutputActive) &&
      !textureShare.nativeOutputWaitingForFrame
    );
    const nativeTextureShareSenderDetail = !features.shared_texture_output_export
      ? 'native output shared-texture export is unavailable'
      : !textureShare
        ? 'not connected to Electron texture-share status'
        : !textureShare.available
          ? `${textureShareName} native addon unavailable${textureShare.error ? `: ${textureShare.error}` : ''}`
          : textureShare.nativeOutputPendingPromotion
            ? `publishing through OSR while waiting to promote to native IOSurface (${textureShare.nativeOutputPromotionAttempts ?? 0} check(s))`
          : textureShare.nativeOutputWaitingForFrame
            ? 'native output IOSurface pump is waiting for the first rendered frame'
          : textureShare.nativeOutputActive
            ? 'native output IOSurface is actively publishing through Syphon'
            : textureShare.nativeOutputCapable
              ? 'native output IOSurface can publish through Syphon when the sender is started'
              : `${textureShareName} addon does not expose native output IOSurface publish`;
    const nativeFrameExportOk = hasNativeFrameExport(this.capabilities);
    const nativeMp4FrameEncoderOk = !!features.native_mp4_frame_encoder && !!nativeFrameEncoder.available;
    const nativeRecordingOk = !!features.native_recording && nativeFrameExportOk && nativeMp4FrameEncoderOk;
    const nativeRecordingDetail = nativeRecordingOk
      ? 'native frame snapshots can stream into the desktop MP4/JPEG encoders'
      : !nativeFrameExportOk
        ? 'native frame snapshot export is unavailable'
        : !nativeMp4FrameEncoderOk
          ? (nativeFrameEncoder.reason || 'desktop FFmpeg raw-frame pipe is unavailable')
          : 'native recording paths are unavailable';
    const shadowModeOk = !!(
      this.lastStatus.backend_ready &&
      features.layer_compositor &&
      features.render_clock &&
      computeGraphHostReady
    );
    const nativeOutputDriverOk = !!(
      this.lastStatus.backend_ready &&
      features.native_output_mirror_texture &&
      features.managed_output_attach &&
      features.managed_output_window_control &&
      computeGraphHostReady &&
      allGraphInstrumentsReady &&
      features.native_static_image_decode &&
      features.native_static_image_prefetch
    );
    const nativeOutputDriverDetail = nativeOutputDriverOk
      ? 'native core can drive the managed output path; open an Output Window to make it active'
      : !this.lastStatus.backend_ready
        ? (this.lastStatus.last_frame_error || 'native render-core backend is not ready')
        : !features.native_output_mirror_texture
          ? 'native offscreen output mirror is unavailable'
          : !features.managed_output_attach || !features.managed_output_window_control
            ? 'managed native output window control is unavailable'
            : !computeGraphHostReady || !allGraphInstrumentsReady
              ? 'native compute graph instrument routes are incomplete'
              : !features.native_static_image_decode || !features.native_static_image_prefetch
                ? 'native still-image decode/prefetch is incomplete'
                : 'native output driver prerequisites are incomplete';
    const fullNativeV2Blockers = [
      nativeOutputDriverOk ? null : 'native output driver is not ready',
      features.shared_texture_upload ? null : 'full shared-texture media transport is pending',
      features.native_media_decode && features.media_prefetch ? null : 'continuous native video decode and full media prefetch are pending',
      nativeTextureShareSenderOk ? null : `${this.platform === 'darwin' ? 'Syphon' : 'Spout'} native texture-share sender is not active-ready`,
      nativeRecordingOk ? null : 'native recording/MP4 frame path is not fully ready',
      features.native_stage3d ? null : 'native Stage3D renderer is pending',
      features.native_projection_sim ? null : 'native projection simulator is pending',
    ].filter(Boolean);
    const fullNativeV2Ok = fullNativeV2Blockers.length === 0;
    const unsupported = [
      [
        'shared-texture-source-frame-upload',
        'Shared texture source-frame transport',
        !!features.shared_texture_source_frame_upload,
      ],
      ['shared-texture-upload', 'Shared texture media transport', !!features.shared_texture_upload],
      [
        'native-output-mirror',
        'Native offscreen output mirror',
        !!features.native_output_mirror_texture,
        'native output mirror texture is not available',
      ],
      [
        'shared-texture-output-export',
        'Native output shared-texture export',
        !!features.shared_texture_output_export,
        'pending core-to-Electron IOSurface/DXGI output texture export',
      ],
      [
        'native-texture-share-sender',
        this.platform === 'darwin' ? 'Native Syphon sender' : 'Native Spout sender',
        nativeTextureShareSenderOk,
        nativeTextureShareSenderDetail,
      ],
      [
        'native-frame-sequence-export',
        'Native frame sequence export',
        !!features.native_frame_sequence_export && !!features.frame_snapshot_export,
        'native frame snapshots can feed the desktop JPEG sequence encoder',
      ],
      [
        'native-static-image-decode',
        'Native still-image decode',
        !!features.native_static_image_decode,
        'local PNG/JPEG/WebP stills should decode into native source-frame textures',
      ],
      [
        'native-static-image-prefetch',
        'Native still-image prefetch',
        !!features.native_static_image_prefetch,
        'local still-image prefetch should warm native source-frame textures before bind',
      ],
      [
        'native-video-frame-prefetch',
        'Native local video frame prefetch',
        !!features.native_video_frame_prefetch && !!videoFramePrefetch.available,
        videoFramePrefetch.available
          ? `local videos can prefetch a bounded FFmpeg-decoded timestamped frame via ${videoFramePrefetch.ffmpegPath}`
          : (videoFramePrefetch.reason || 'desktop FFmpeg video frame prefetch is unavailable'),
      ],
      [
        'native-video-decode-pump',
        'Native render-clock video decode pump',
        !!features.native_video_decode_pump && !!features.native_video_frame_decode,
        'visible video layers should schedule bounded native frame decodes from the render/media clocks',
      ],
      [
        'native-mp4-frame-encoder',
        'Native MP4 frame encoder',
        !!features.native_mp4_frame_encoder && !!nativeFrameEncoder.available,
        nativeFrameEncoder.available
          ? `desktop FFmpeg raw-frame pipe available; active sessions=${nativeFrameEncoder.activeSessions}`
          : (nativeFrameEncoder.reason || 'desktop FFmpeg raw-frame pipe is unavailable'),
      ],
      ['native-media-decode', 'Native continuous media decode/prefetch', !!features.native_media_decode && !!features.media_prefetch],
      ['native-stage3d-scene-ingest', 'Native Stage3D scene ingest', !!features.native_stage3d_scene_ingest],
      [
        'native-stage3d-overlay-preview',
        'Native Stage3D overlay preview',
        !!features.native_stage3d_overlay_preview,
        features.native_stage3d_overlay_preview
          ? 'ingested Stage3D scenes can affect native-rendered frame pixels'
          : 'Stage3D scene data is not yet rendered by the native core',
      ],
      [
        'native-stage3d-mesh-preview',
        'Native Stage3D mesh preview',
        !!features.native_stage3d_mesh_preview,
        features.native_stage3d_mesh_preview
          ? 'ingested Stage3D screens/primitives render through a native camera/depth mesh pass'
          : 'Stage3D scene data is not yet rendered as native meshes',
      ],
      [
        'native-stage3d-textured-mesh-preview',
        'Native Stage3D textured mesh preview',
        !!features.native_stage3d_textured_mesh_preview,
        features.native_stage3d_textured_mesh_preview
          ? 'Stage3D visual elements can sample native source-frame textures'
          : 'Stage3D mesh preview cannot sample VJ/source-frame textures yet',
      ],
      [
        'native-stage3d-primitive-meshes',
        'Native Stage3D primitive meshes',
        !!features.native_stage3d_primitive_meshes,
        features.native_stage3d_primitive_meshes
          ? 'Stage3D visual boxes, spheres, domes, pyramids, cones, and cylinders have native mesh previews'
          : 'Stage3D visual primitives collapse to generic native preview meshes',
      ],
      [
        'native-stage3d-xyz-mesh-transforms',
        'Native Stage3D XYZ mesh transforms',
        !!features.native_stage3d_xyz_mesh_transforms,
        features.native_stage3d_xyz_mesh_transforms
          ? 'Stage3D native meshes honor scene X/Y/Z rotation vectors'
          : 'Stage3D native meshes only partially honor scene transforms',
      ],
      [
        'native-stage3d-lighting-preview',
        'Native Stage3D lighting preview',
        !!features.native_stage3d_lighting_preview,
        features.native_stage3d_lighting_preview
          ? 'Stage3D native preview applies room darkness, screen boost, exposure, and haze uniforms'
          : 'Stage3D native preview ignores scene lighting controls',
      ],
      [
        'native-stage3d-output-renderer',
        'Native Stage3D output renderer',
        !!features.native_stage3d,
        features.native_stage3d
          ? 'Stage3D scenes render through the native output/frame-snapshot path'
          : 'Stage3D scenes are not yet promoted to native output rendering',
      ],
      ['native-projection-sim-scene-ingest', 'Native Projection Sim scene ingest', !!features.native_projection_sim_scene_ingest],
      [
        'native-projection-sim-overlay-preview',
        'Native Projection Sim overlay preview',
        !!features.native_projection_sim_overlay_preview,
        features.native_projection_sim_overlay_preview
          ? 'ingested projection-sim scenes can affect native-rendered frame pixels'
          : 'Projection Sim scene data is not yet rendered by the native core',
      ],
      [
        'native-projection-sim-mesh-preview',
        'Native Projection Sim mesh preview',
        !!features.native_projection_sim_mesh_preview,
        features.native_projection_sim_mesh_preview
          ? 'Projection Sim objects/projectors render through the native camera/depth mesh pass'
          : 'Projection Sim scene data is not yet rendered as native meshes',
      ],
      [
        'native-projection-sim-textured-mesh-preview',
        'Native Projection Sim textured mesh preview',
        !!features.native_projection_sim_textured_mesh_preview,
        features.native_projection_sim_textured_mesh_preview
          ? 'Projection Sim receiving surfaces can sample native VJ/source-frame textures'
          : 'Projection Sim native meshes cannot sample projected source textures yet',
      ],
      [
        'native-projection-sim-xyz-mesh-transforms',
        'Native Projection Sim XYZ mesh transforms',
        !!features.native_projection_sim_xyz_mesh_transforms,
        features.native_projection_sim_xyz_mesh_transforms
          ? 'Projection Sim native objects honor scene X/Y/Z rotation vectors'
          : 'Projection Sim native objects only partially honor scene transforms',
      ],
      [
        'native-projection-sim-output-renderer',
        'Native Projection Sim output renderer',
        !!features.native_projection_sim,
        features.native_projection_sim
          ? 'Projection Sim scenes render through the native output/frame-snapshot path'
          : 'Projection Sim scenes are not yet promoted to native output rendering',
      ],
      ['compute-graph-host', 'Native buffer compute graph host', !!features.compute_graph_host],
      [
        'compute-instrument-host',
        'Native compute/multi-pass instrument host',
        computeGraphHostReady && allGraphInstrumentsReady,
        computeGraphHostReady
          ? `implemented graph routes=${graphChecks.filter(([, , ok]) => ok).length}/${REQUIRED_NATIVE_GRAPH_INSTRUMENTS.length}`
          : 'compute graph host/source-frame target is not ready',
      ],
      ...graphChecks,
      ['native-output-driver', 'Native output driver', nativeOutputDriverOk, nativeOutputDriverDetail],
      ['managed-output', 'Managed native output window', managedOutputOk, managedOutputDetail],
      [
        'native-recording',
        'Native recording',
        nativeRecordingOk,
        nativeRecordingDetail,
      ],
    ];
    return {
      timestamp_ms: Date.now(),
      overall_ready: blockers.length === 0,
      blockers,
      modes: {
        shadow: {
          ok: shadowModeOk,
          detail: shadowModeOk
            ? 'native core is receiving the app scene/clock and can mirror it for validation'
            : 'native shadow sync requires a ready backend, compositor, render clock, and compute graph host',
        },
        output_driver: {
          ok: nativeOutputDriverOk,
          detail: nativeOutputDriverDetail,
        },
        output_active: {
          ok: managedOutputOk,
          detail: managedOutputDetail,
        },
        full_v2: {
          ok: fullNativeV2Ok,
          detail: fullNativeV2Ok
            ? 'all tracked native-renderer v2 gates are ready'
            : `${fullNativeV2Blockers.length} tracked native-renderer v2 gate(s) remain`,
          blockers: fullNativeV2Blockers,
        },
      },
      capabilities: this.capabilities,
      texture_share: textureShare,
      native_frame_encoder: nativeFrameEncoder,
      native_video_frame_prefetch: videoFramePrefetch,
      checks: [
        {
          id: 'core-capabilities',
          label: 'Core capabilities handshake',
          ok: !!this.capabilities?.core_capabilities_confirmed,
          detail: this.capabilities?.core_capabilities_confirmed
            ? `native core ${this.capabilities.core_version || 'unknown'} confirmed ${this.capabilities.implemented_methods?.length ?? 0} RPC method(s)`
            : (this.capabilities?.core_capabilities_error || 'native render-core capabilities have not been confirmed'),
        },
        {
          id: 'binary',
          label: 'ghost-render-core binary',
          ok: !!binary,
          detail: binary || 'Run `npm run native:build`',
        },
        {
          id: 'process',
          label: 'render-core process',
          ok: !!this.child,
          detail: this.child ? `pid ${this.child.pid}` : 'not running',
        },
        {
          id: 'backend',
          label: 'native GPU backend',
          ok: !!this.lastStatus.backend_ready,
          detail: this.lastStatus.adapter_name || this.lastStatus.last_frame_error || 'not initialized',
        },
        {
          id: 'texture-share-bridge',
          label: 'Electron shared-texture bridge',
          ok: !!textureShare?.available,
          detail: textureShareDetail,
        },
        ...unsupported.map(([id, label, ok, detail]) => ({
          id,
          label,
          ok,
          detail: ok ? detail || 'implemented' : detail || 'not implemented in the current native render core',
        })),
      ],
    };
  }

  textureShareStatus() {
    if (!this.textureShareStatusProvider) return null;
    try {
      return this.textureShareStatusProvider() || null;
    } catch (err) {
      return {
        platform: this.platform === 'darwin' ? 'syphon' : 'spout',
        label: this.platform === 'darwin' ? 'Syphon' : 'Spout',
        available: false,
        error: err?.message || String(err),
      };
    }
  }

  nativeFrameEncoderStatus() {
    if (!this.nativeFrameEncoderStatusProvider) {
      return {
        available: false,
        activeSessions: 0,
        mp4ActiveSessions: 0,
        jpegActiveSessions: 0,
        encoder: 'ffmpeg',
        reason: 'not connected to Electron native frame encoder status',
      };
    }
    try {
      const status = this.nativeFrameEncoderStatusProvider() || {};
      return {
        available: !!status.available,
        activeSessions: Number(status.activeSessions ?? 0),
        mp4ActiveSessions: Number(status.mp4ActiveSessions ?? status.activeSessions ?? 0),
        jpegActiveSessions: Number(status.jpegActiveSessions ?? 0),
        encoder: status.encoder || 'ffmpeg',
        reason: status.reason ? String(status.reason) : null,
      };
    } catch (err) {
      return {
        available: false,
        activeSessions: 0,
        mp4ActiveSessions: 0,
        jpegActiveSessions: 0,
        encoder: 'ffmpeg',
        reason: err?.message || String(err),
      };
    }
  }

  videoFramePrefetchStatus() {
    return videoFramePrefetchStatus(this.env, this.platform);
  }

  videoFramePrefetchRequest(uri, width, height, timeSeconds = 0) {
    const localPath = resolveLocalMediaPath(uri);
    if (!localPath) {
      throw new Error('native video frame prefetch currently supports local video files only');
    }
    let stat = null;
    try {
      stat = fs.statSync(localPath);
    } catch (err) {
      throw new Error(`native video frame prefetch cannot read ${localPath}: ${err?.message || err}`);
    }
    if (!stat.isFile()) {
      throw new Error(`native video frame prefetch expected a file: ${localPath}`);
    }
    const targetWidth = Math.max(16, Math.min(4096, Math.round(Number(width) || 256)));
    const targetHeight = Math.max(16, Math.min(4096, Math.round(Number(height) || targetWidth)));
    const seconds = Math.max(0, Math.min(3600, Number(timeSeconds) || 0));
    const frameBucket = Math.max(0, Math.round(seconds * VIDEO_FRAME_PREFETCH_CACHE_FPS));
    const key = [
      localPath,
      Number(stat.size) || 0,
      Math.round(Number(stat.mtimeMs) || 0),
      targetWidth,
      targetHeight,
      frameBucket,
    ].join('|');
    return { key, localPath, width: targetWidth, height: targetHeight, seconds, frameBucket };
  }

  videoFramePrefetchCacheStats() {
    let bytes = 0;
    for (const entry of this.videoFramePrefetchCache.values()) {
      bytes += Number(entry?.byteLength ?? entry?.rgba?.length ?? 0);
    }
    return {
      video_frame_prefetch_cache_entries: this.videoFramePrefetchCache.size,
      video_frame_prefetch_cache_bytes: bytes,
      video_frame_prefetch_cache_hits: Number(this.stats.video_frame_prefetch_cache_hits ?? 0),
      video_frame_prefetch_cache_misses: Number(this.stats.video_frame_prefetch_cache_misses ?? 0),
      video_frame_prefetch_cache_clears: Number(this.stats.video_frame_prefetch_cache_clears ?? 0),
      video_frame_prefetch_cache_max_entries: this.videoFramePrefetchCacheMaxEntries,
    };
  }

  withBrokerVideoFramePrefetchStats(status = this.lastStatus) {
    const normalized = normalizeStatus(status, this.lastStatus);
    this.lastStatus = {
      ...normalized,
      ...this.videoFramePrefetchCacheStats(),
    };
    return this.lastStatus;
  }

  getCachedVideoFramePrefetch(request) {
    const entry = this.videoFramePrefetchCache.get(request.key);
    if (!entry) return null;
    this.videoFramePrefetchCache.delete(request.key);
    this.videoFramePrefetchCache.set(request.key, entry);
    this.stats.video_frame_prefetch_cache_hits =
      Number(this.stats.video_frame_prefetch_cache_hits ?? 0) + 1;
    return {
      rgba: Buffer.from(entry.rgba),
      width: entry.width,
      height: entry.height,
      localPath: request.localPath,
      byteLength: entry.byteLength,
    };
  }

  storeVideoFramePrefetch(request, frame) {
    const byteLength = Number(frame.byteLength ?? frame.rgba?.length ?? request.width * request.height * 4);
    this.videoFramePrefetchCache.set(request.key, {
      rgba: Buffer.from(frame.rgba),
      width: Number(frame.width ?? request.width),
      height: Number(frame.height ?? request.height),
      byteLength,
      frameBucket: request.frameBucket,
    });
    while (this.videoFramePrefetchCache.size > this.videoFramePrefetchCacheMaxEntries) {
      const oldestKey = this.videoFramePrefetchCache.keys().next().value;
      if (!oldestKey) break;
      this.videoFramePrefetchCache.delete(oldestKey);
    }
  }

  clearBrokerVideoFramePrefetchCache() {
    const cleared = this.videoFramePrefetchCache.size;
    if (cleared > 0) this.videoFramePrefetchCache.clear();
    this.stats.video_frame_prefetch_cache_clears =
      Number(this.stats.video_frame_prefetch_cache_clears ?? 0) + 1;
    this.lastStatus = {
      ...this.lastStatus,
      ...this.videoFramePrefetchCacheStats(),
    };
    return cleared;
  }

  unsupportedError(command) {
    const reason = BROKER_UNSUPPORTED_COMMANDS.get(command) || 'not implemented by this native render core';
    return new Error(`Unsupported native renderer command ${command}: ${reason}`);
  }

  supportsAdvertisedCoreMethod(method) {
    return (this.capabilities?.implemented_methods ?? []).includes(method);
  }

  async sendAdvertisedCoreMethod(command, args = {}) {
    const method = commandToMethod(command);
    if (this.child && !this.child.killed && !this.supportsAdvertisedCoreMethod(method)) {
      return Promise.reject(new Error(
        `Unsupported native renderer command ${command}: native render core does not advertise RPC method \`${method}\``,
      ));
    }
    return this.sendIfRunning(method, args, { fallback: null });
  }

  async sendIfRunning(method, params, { fallback = null, timeoutMs = 2500 } = {}) {
    if (!this.child || this.child.killed) return fallback;
    return this.send(method, params, { timeoutMs }).catch((err) => {
      this.lastStatus = {
        ...this.lastStatus,
        backend_ready: false,
        last_frame_error: err?.message || String(err),
      };
      return fallback;
    });
  }

  async sendNativeCommandPayloadIfRunning(method, params, { fallback = null, timeoutMs = 2500 } = {}) {
    if (!this.child || this.child.killed) return fallback;
    let prepared = params;
    try {
      prepared = this.prepareNativeCommandPayload(params);
    } catch (err) {
      console.warn('[NativeRenderer] native command file handoff failed; falling back to JSON payload', err);
    }
    return this.send(method, prepared, { timeoutMs }).catch((err) => {
      this.lastStatus = {
        ...this.lastStatus,
        backend_ready: false,
        last_frame_error: err?.message || String(err),
      };
      return fallback;
    });
  }

  async sendNativeComputeGraphPayloadIfRunning(method, params, { fallback = null, timeoutMs = 10000 } = {}) {
    if (!this.child || this.child.killed) return fallback;
    let prepared = params;
    try {
      prepared = this.prepareNativeComputeGraphPayload(params);
    } catch (err) {
      console.warn('[NativeRenderer] native compute graph file handoff failed; falling back to JSON payload', err);
    }
    return this.send(method, prepared, { timeoutMs }).catch((err) => {
      this.lastStatus = {
        ...this.lastStatus,
        backend_ready: false,
        last_frame_error: err?.message || String(err),
      };
      return fallback;
    });
  }

  send(method, params = {}, { timeoutMs = 2500 } = {}) {
    if (!this.child || !this.child.stdin?.writable) {
      return Promise.reject(new Error('Native render core process is not running'));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native render core timed out handling ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${payload}\n`, (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  prepareNativeCommandPayload(params) {
    if (!params || typeof params !== 'object') return params;
    if (Array.isArray(params.commands)) {
      return {
        ...params,
        commands: params.commands.map((command) => this.prepareNativeCommand(command)),
      };
    }
    if (params.batch && Array.isArray(params.batch.commands)) {
      return {
        ...params,
        batch: {
          ...params.batch,
          commands: params.batch.commands.map((command) => this.prepareNativeCommand(command)),
        },
      };
    }
    return params;
  }

  prepareNativeComputeGraphPayload(params) {
    if (!params || typeof params !== 'object' || !Array.isArray(params.buffers)) return params;
    return {
      ...params,
      buffers: params.buffers.map((buffer) => this.prepareNativeComputeGraphBuffer(buffer)),
    };
  }

  prepareNativeComputeGraphBuffer(buffer) {
    if (!buffer || typeof buffer !== 'object') return buffer;
    const rawBuffer = normalizeSourceFrameBuffer(
      buffer.initial_buffer ?? buffer.initial_bytes ?? buffer.initial_data,
    );
    if (!rawBuffer) return buffer;
    const {
      initial_buffer: _discardedBuffer,
      initial_bytes: _discardedBytes,
      initial_data: _discardedData,
      initial_b64: _discardedInitialB64,
      data_b64: _discardedDataB64,
      bytes_b64: _discardedBytesB64,
      ...rest
    } = buffer;
    if (rawBuffer.length <= 0) return rest;
    const initialFile = this.writeNativePayloadTempFile(rawBuffer, 'graph-buffer');
    return {
      ...rest,
      initial_file: initialFile,
      initial_byte_length: rawBuffer.length,
      initial_file_delete: true,
    };
  }

  prepareNativeCommand(command) {
    if (!command || command.type !== 'upload_source_frame') return command;
    const rawBuffer = normalizeSourceFrameBuffer(command.rgba_buffer ?? command.rgba_bytes);
    if (rawBuffer) {
      const width = Number(command.width ?? 0);
      const height = Number(command.height ?? 0);
      const expected = Math.max(0, Math.floor(width)) * Math.max(0, Math.floor(height)) * 4;
      const { rgba_buffer: _discardedBuffer, rgba_bytes: _discardedBytes, rgba_b64: _discardedB64, ...rest } = command;
      if (expected <= 0 || rawBuffer.length < expected) return rest;
      const rgbaFile = this.writeSourceFrameTempFile(rawBuffer);
      return {
        ...rest,
        rgba_file: rgbaFile,
        rgba_byte_length: rawBuffer.length,
        rgba_file_delete: true,
      };
    }
    const encoded = command.rgba_b64;
    if (typeof encoded !== 'string' || encoded.length < SOURCE_FRAME_FILE_HANDOFF_B64_THRESHOLD) {
      return command;
    }
    const width = Number(command.width ?? 0);
    const height = Number(command.height ?? 0);
    const expected = Math.max(0, Math.floor(width)) * Math.max(0, Math.floor(height)) * 4;
    const raw = Buffer.from(encoded, 'base64');
    if (expected <= 0 || raw.length < expected) return command;
    const rgbaFile = this.writeSourceFrameTempFile(raw);
    const { rgba_b64: _discarded, ...rest } = command;
    return {
      ...rest,
      rgba_file: rgbaFile,
      rgba_byte_length: raw.length,
      rgba_file_delete: true,
    };
  }

  writeSourceFrameTempFile(bytes) {
    return this.writeNativePayloadTempFile(bytes, 'frame');
  }

  writeNativePayloadTempFile(bytes, prefix) {
    if (!this.tempFrameDir) {
      this.tempFrameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-render-core-frames-'));
    }
    const safePrefix = String(prefix || 'payload').replace(/[^a-z0-9_-]/gi, '-').slice(0, 32) || 'payload';
    const name = `${safePrefix}-${process.pid}-${Date.now()}-${this.tempFrameSerial++}.rgba`;
    const filePath = path.join(this.tempFrameDir, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
  }

  ensureProcess(executable) {
    if (this.child && !this.child.killed) return;
    console.log(`[NativeRenderer] launching ${executable}`);
    const childEnv = { ...this.env, RUST_BACKTRACE: this.env.RUST_BACKTRACE || '1' };
    if (!childEnv.GA_FFMPEG_PATH) {
      childEnv.GA_FFMPEG_PATH = resolveFfmpegPath(this.env, this.platform);
    }
    this.child = spawn(executable, [], {
      cwd: this.appRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      String(chunk).split(/\r?\n/).filter(Boolean).forEach((line) => {
        console.log(`[NativeRenderer] ${line}`);
      });
    });
    this.child.on('exit', (code, signal) => {
      console.log(`[NativeRenderer] exited code=${code} signal=${signal}`);
      this.child = null;
      this.rejectPending(new Error(`Native render core exited (${code ?? signal ?? 'unknown'})`));
      this.lastStatus = {
        ...this.lastStatus,
        running: false,
        backend_ready: false,
        last_frame_error: `Native render core exited (${code ?? signal ?? 'unknown'})`,
      };
    });
    this.child.on('error', (err) => {
      this.rejectPending(err);
      this.lastStatus = {
        ...this.lastStatus,
        running: false,
        backend_ready: false,
        last_frame_error: err?.message || String(err),
      };
    });
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    let index = this.stdoutBuffer.indexOf('\n');
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      this.handleLine(line);
      index = this.stdoutBuffer.indexOf('\n');
    }
  }

  handleLine(line) {
    if (!line) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.log(`[NativeRenderer] ${line}`);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || 'Native render core command failed'));
  }

  rejectPending(err) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  killProcess() {
    if (!this.child) {
      this.cleanupTempFrameDir();
      return;
    }
    try { this.child.kill('SIGTERM'); } catch {}
    this.child = null;
    this.rejectPending(new Error('Native render core stopped'));
    this.cleanupTempFrameDir();
  }

  findExecutable() {
    if (this.env.GA_NATIVE_RENDER_CORE_PATH && fs.existsSync(this.env.GA_NATIVE_RENDER_CORE_PATH)) {
      return this.env.GA_NATIVE_RENDER_CORE_PATH;
    }
    const bin = this.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core';
    const candidates = [
      path.join(this.appRoot, 'native-renderer', 'target', 'release', bin),
      path.join(this.appRoot, 'native-renderer', 'target', 'debug', bin),
    ];
    if (this.isPackaged && this.resourcesPath) {
      candidates.unshift(path.join(this.resourcesPath, 'native-renderer', bin));
    }
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  cleanupTempFrameDir() {
    if (!this.tempFrameDir) return;
    try { fs.rmSync(this.tempFrameDir, { recursive: true, force: true }); } catch {}
    this.tempFrameDir = null;
  }
}

function commandToMethod(command) {
  return String(command || '').startsWith(COMMAND_PREFIX)
    ? String(command).slice(COMMAND_PREFIX.length)
    : command;
}

function nativeGraphInstrumentSet(capabilities) {
  const ids = new Set();
  for (const id of capabilities?.native_graph_instruments ?? []) {
    const normalized = String(id || '').trim().toLowerCase();
    if (normalized) ids.add(normalized);
  }
  for (const entry of capabilities?.native_graph_instrument_manifest ?? []) {
    const normalized = String(entry?.id || '').trim().toLowerCase();
    if (normalized) ids.add(normalized);
  }
  return ids;
}

function normalizeCapabilities(capabilities, previous = makeDefaultCapabilities()) {
  const source = capabilities && typeof capabilities === 'object' ? capabilities : {};
  const prevFeatures = previous.features && typeof previous.features === 'object' ? previous.features : {};
  const nextFeatures = source.features && typeof source.features === 'object' ? source.features : {};
  const prevLimits = previous.limits && typeof previous.limits === 'object' ? previous.limits : {};
  const nextLimits = source.limits && typeof source.limits === 'object' ? source.limits : {};
  return {
    ...makeDefaultCapabilities({ backend: source.backend ?? previous.backend }),
    ...previous,
    ...source,
    schema_version: Number(source.schema_version ?? previous.schema_version ?? 1),
    backend: source.backend ?? previous.backend ?? null,
    core_capabilities_confirmed: !!(source.core_capabilities_confirmed ?? previous.core_capabilities_confirmed ?? false),
    core_capabilities_error: source.core_capabilities_error ?? previous.core_capabilities_error ?? null,
    implemented_methods: Array.isArray(source.implemented_methods)
      ? source.implemented_methods.map(String)
      : previous.implemented_methods ?? [],
    implemented_command_types: Array.isArray(source.implemented_command_types)
      ? source.implemented_command_types.map(String)
      : previous.implemented_command_types ?? [],
    native_graph_instruments: Array.isArray(source.native_graph_instruments)
      ? source.native_graph_instruments.map(String)
      : previous.native_graph_instruments ?? [],
    native_compositor_blend_modes: Array.isArray(source.native_compositor_blend_modes)
      ? source.native_compositor_blend_modes
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => ({
            ...entry,
            id: String(entry.id ?? ''),
            code: Number(entry.code ?? 0),
          }))
          .filter((entry) => entry.id)
      : previous.native_compositor_blend_modes ?? [],
    native_compositor_effect_descriptors: Array.isArray(source.native_compositor_effect_descriptors)
      ? source.native_compositor_effect_descriptors
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => ({
            ...entry,
            id: String(entry.id ?? ''),
            code: Number(entry.code ?? 0),
            aliases: Array.isArray(entry.aliases) ? entry.aliases.map(String) : [],
            amount_min: Number(entry.amount_min ?? 0),
            amount_max: Number(entry.amount_max ?? 0),
          }))
          .filter((entry) => entry.id)
      : previous.native_compositor_effect_descriptors ?? [],
    native_graph_instrument_manifest: Array.isArray(source.native_graph_instrument_manifest)
      ? source.native_graph_instrument_manifest
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => ({
            ...entry,
            id: String(entry.id ?? ''),
            label: String(entry.label ?? entry.id ?? ''),
            source_uri_prefix: String(entry.source_uri_prefix ?? ''),
            shader_ids: Array.isArray(entry.shader_ids) ? entry.shader_ids.map(String) : [],
            features: Array.isArray(entry.features) ? entry.features.map(String) : [],
            render_target: String(entry.render_target ?? ''),
          }))
          .filter((entry) => entry.id)
      : previous.native_graph_instrument_manifest ?? [],
    features: {
      ...prevFeatures,
      ...nextFeatures,
    },
    limits: {
      ...prevLimits,
      ...nextLimits,
    },
    notes: Array.isArray(source.notes)
      ? source.notes.map(String)
      : previous.notes ?? [],
  };
}

function applyBrokerCapabilityOverlay(capabilities, textureShare, nativeFrameEncoder = null, videoFramePrefetch = null) {
  const features = capabilities?.features && typeof capabilities.features === 'object'
    ? { ...capabilities.features }
    : {};
  const nativeFrameExportReady = hasNativeFrameExport(capabilities);
  const nativeTextureShareSenderReady = !!(
    features.shared_texture_output_export &&
    textureShare?.available &&
    (textureShare.nativeOutputCapable || textureShare.nativeOutputActive)
  );
  features.native_texture_share_sender = !!(
    features.native_texture_share_sender ||
    nativeTextureShareSenderReady
  );
  features.native_mp4_frame_encoder = !!(
    features.native_mp4_frame_encoder ||
    nativeFrameEncoder?.available
  );
  features.native_recording = !!(
    nativeFrameExportReady &&
    (features.native_recording || features.native_mp4_frame_encoder)
  );
  features.native_video_frame_prefetch = !!(
    features.native_video_frame_prefetch ||
    videoFramePrefetch?.available
  );
  features.video_frame_prefetch = !!(
    features.video_frame_prefetch ||
    features.native_video_frame_prefetch
  );

  const notes = Array.isArray(capabilities?.notes) ? [...capabilities.notes] : [];
  if (
    nativeTextureShareSenderReady &&
    !notes.some((note) => String(note).includes('Electron texture-share bridge can publish native output IOSurfaces'))
  ) {
    notes.push('Electron texture-share bridge can publish native output IOSurfaces through Syphon when the sender is started.');
  }
  if (
    nativeFrameEncoder?.available &&
    !notes.some((note) => String(note).includes('Electron native MP4 frame encoder'))
  ) {
    notes.push('Electron native MP4 frame encoder can stream raw RGBA/BGRA frames into FFmpeg for offline, reel, and live recordings.');
  }
  if (
    videoFramePrefetch?.available &&
    !notes.some((note) => String(note).includes('Electron video frame prefetch bridge'))
  ) {
    notes.push('Electron video frame prefetch bridge can decode bounded local-video frames at requested timestamps into native source-frame textures.');
  }

  return {
    ...capabilities,
    features,
    notes,
  };
}

function hasNativeFrameExport(capabilities) {
  const features = capabilities?.features && typeof capabilities.features === 'object'
    ? capabilities.features
    : {};
  const methods = Array.isArray(capabilities?.implemented_methods)
    ? capabilities.implemented_methods
    : [];
  return !!(
    features.frame_snapshot_export &&
    features.native_frame_sequence_export &&
    methods.includes('export_frame_snapshot')
  );
}

function normalizeStatus(status, previous = makeDefaultStatus()) {
  if (!status || typeof status !== 'object') return previous;
  const backend = status.backend || previous.backend || null;
  return {
    ...makeDefaultStatus({ backend }),
    ...previous,
    running: !!status.running,
    backend,
    backend_ready: !!status.backend_ready,
    adapter_name: status.adapter_name ?? previous.adapter_name ?? null,
    native_caps: normalizeNativeCaps(status.native_caps, previous.native_caps),
    native_quality: normalizeNativeQuality(status.native_quality, previous.native_quality),
    source_preview_size: Number(status.source_preview_size ?? previous.source_preview_size ?? 256),
    source_previews_active: Number(status.source_previews_active ?? previous.source_previews_active ?? 0),
    source_preview_slots: Number(status.source_preview_slots ?? previous.source_preview_slots ?? 16),
    source_preview_dirty: !!(status.source_preview_dirty ?? previous.source_preview_dirty ?? false),
    source_frame_size: Number(status.source_frame_size ?? previous.source_frame_size ?? 2048),
    source_frame_format: String(status.source_frame_format ?? previous.source_frame_format ?? 'rgba8unorm'),
    source_frame_hdr: !!(status.source_frame_hdr ?? previous.source_frame_hdr ?? false),
    source_frame_mip_levels: Number(status.source_frame_mip_levels ?? previous.source_frame_mip_levels ?? 1),
    source_frames_active: Number(status.source_frames_active ?? previous.source_frames_active ?? 0),
    source_frame_slots: Number(status.source_frame_slots ?? previous.source_frame_slots ?? 8),
    isf_shader_bindings: Number(status.isf_shader_bindings ?? previous.isf_shader_bindings ?? 0),
    isf_uniform_sets: Number(status.isf_uniform_sets ?? previous.isf_uniform_sets ?? 0),
    native_shader_layers: Number(status.native_shader_layers ?? previous.native_shader_layers ?? 0),
    native_procedural_layers: Number(status.native_procedural_layers ?? previous.native_procedural_layers ?? 0),
    native_instrument_layers: Number(status.native_instrument_layers ?? previous.native_instrument_layers ?? 0),
    native_instrument_proxy_layers: Number(
      status.native_instrument_proxy_layers ??
        previous.native_instrument_proxy_layers ??
        status.native_instrument_layers ??
        previous.native_instrument_layers ??
        0,
    ),
    native_graph_source_frame_layers: Number(
      status.native_graph_source_frame_layers ?? previous.native_graph_source_frame_layers ?? 0,
    ),
    source_frame_uploads: Number(status.source_frame_uploads ?? previous.source_frame_uploads ?? 0),
    source_frame_bytes_uploaded: Number(status.source_frame_bytes_uploaded ?? previous.source_frame_bytes_uploaded ?? 0),
    source_frame_cpu_fallback_uploads: Number(
      status.source_frame_cpu_fallback_uploads ?? previous.source_frame_cpu_fallback_uploads ?? 0,
    ),
    source_frame_file_uploads: Number(status.source_frame_file_uploads ?? previous.source_frame_file_uploads ?? 0),
    source_frame_base64_uploads: Number(status.source_frame_base64_uploads ?? previous.source_frame_base64_uploads ?? 0),
    source_frame_json_uploads: Number(status.source_frame_json_uploads ?? previous.source_frame_json_uploads ?? 0),
    source_frame_shared_texture_uploads: Number(
      status.source_frame_shared_texture_uploads ?? previous.source_frame_shared_texture_uploads ?? 0,
    ),
    source_frame_shared_texture_rejected_uploads: Number(
      status.source_frame_shared_texture_rejected_uploads ??
        previous.source_frame_shared_texture_rejected_uploads ??
        0,
    ),
    source_frame_rejected_uploads: Number(
      status.source_frame_rejected_uploads ?? previous.source_frame_rejected_uploads ?? 0,
    ),
    source_frame_input_bytes_uploaded: Number(
      status.source_frame_input_bytes_uploaded ?? previous.source_frame_input_bytes_uploaded ?? 0,
    ),
    source_frame_resampled_bytes_uploaded: Number(
      status.source_frame_resampled_bytes_uploaded ?? previous.source_frame_resampled_bytes_uploaded ?? 0,
    ),
    source_frame_last_input_bytes: Number(
      status.source_frame_last_input_bytes ?? previous.source_frame_last_input_bytes ?? 0,
    ),
    source_frame_last_upload_bytes: Number(
      status.source_frame_last_upload_bytes ?? previous.source_frame_last_upload_bytes ?? 0,
    ),
    source_frame_last_upload_width: Number(
      status.source_frame_last_upload_width ?? previous.source_frame_last_upload_width ?? 0,
    ),
    source_frame_last_upload_height: Number(
      status.source_frame_last_upload_height ?? previous.source_frame_last_upload_height ?? 0,
    ),
    source_frame_last_upload_transport: String(
      status.source_frame_last_upload_transport ?? previous.source_frame_last_upload_transport ?? 'none',
    ),
    source_frame_last_reject_reason: String(
      status.source_frame_last_reject_reason ?? previous.source_frame_last_reject_reason ?? 'none',
    ),
    native_image_decodes: Number(status.native_image_decodes ?? previous.native_image_decodes ?? 0),
    native_image_decode_failures: Number(
      status.native_image_decode_failures ?? previous.native_image_decode_failures ?? 0,
    ),
    native_image_decode_bytes_uploaded: Number(
      status.native_image_decode_bytes_uploaded ?? previous.native_image_decode_bytes_uploaded ?? 0,
    ),
    native_image_decode_last_error: String(
      status.native_image_decode_last_error ?? previous.native_image_decode_last_error ?? 'none',
    ),
    native_video_frame_decodes: Number(
      status.native_video_frame_decodes ?? previous.native_video_frame_decodes ?? 0,
    ),
    native_video_frame_decode_failures: Number(
      status.native_video_frame_decode_failures ?? previous.native_video_frame_decode_failures ?? 0,
    ),
    native_video_frame_decode_bytes_uploaded: Number(
      status.native_video_frame_decode_bytes_uploaded ??
        previous.native_video_frame_decode_bytes_uploaded ??
        0,
    ),
    native_video_frame_decode_last_error: String(
      status.native_video_frame_decode_last_error ??
        previous.native_video_frame_decode_last_error ??
        'none',
    ),
    native_video_frame_cache_entries: Number(
      status.native_video_frame_cache_entries ?? previous.native_video_frame_cache_entries ?? 0,
    ),
    native_video_frame_cache_bytes: Number(
      status.native_video_frame_cache_bytes ?? previous.native_video_frame_cache_bytes ?? 0,
    ),
    native_video_frame_cache_hits: Number(
      status.native_video_frame_cache_hits ?? previous.native_video_frame_cache_hits ?? 0,
    ),
    native_video_frame_cache_misses: Number(
      status.native_video_frame_cache_misses ?? previous.native_video_frame_cache_misses ?? 0,
    ),
    native_video_frame_cache_evictions: Number(
      status.native_video_frame_cache_evictions ?? previous.native_video_frame_cache_evictions ?? 0,
    ),
    native_instrument_frame_renders: Number(status.native_instrument_frame_renders ?? previous.native_instrument_frame_renders ?? 0),
    compute_graph_runs: Number(status.compute_graph_runs ?? previous.compute_graph_runs ?? 0),
    compute_graph_passes: Number(status.compute_graph_passes ?? previous.compute_graph_passes ?? 0),
    compute_graph_render_passes: Number(
      status.compute_graph_render_passes ?? previous.compute_graph_render_passes ?? 0,
    ),
    compute_graph_snapshot_renders: Number(
      status.compute_graph_snapshot_renders ?? previous.compute_graph_snapshot_renders ?? 0,
    ),
    compute_graph_source_frame_renders: Number(
      status.compute_graph_source_frame_renders ?? previous.compute_graph_source_frame_renders ?? 0,
    ),
    compute_graph_readbacks: Number(status.compute_graph_readbacks ?? previous.compute_graph_readbacks ?? 0),
    compute_graph_readback_bytes: Number(
      status.compute_graph_readback_bytes ?? previous.compute_graph_readback_bytes ?? 0,
    ),
    compute_graph_persistent_buffers: Number(
      status.compute_graph_persistent_buffers ?? previous.compute_graph_persistent_buffers ?? 0,
    ),
    frame_snapshot_reads: Number(status.frame_snapshot_reads ?? previous.frame_snapshot_reads ?? 0),
    frame_snapshot_bytes_read: Number(status.frame_snapshot_bytes_read ?? previous.frame_snapshot_bytes_read ?? 0),
    frame_health_checks: Number(status.frame_health_checks ?? previous.frame_health_checks ?? 0),
    dark_frame_warnings: Number(status.dark_frame_warnings ?? previous.dark_frame_warnings ?? 0),
    last_frame_checksum: status.last_frame_checksum ?? previous.last_frame_checksum ?? null,
    last_frame_nonzero_pixels: Number(status.last_frame_nonzero_pixels ?? previous.last_frame_nonzero_pixels ?? 0),
    last_frame_bright_pixels: Number(status.last_frame_bright_pixels ?? previous.last_frame_bright_pixels ?? 0),
    last_frame_average_luma: Number(status.last_frame_average_luma ?? previous.last_frame_average_luma ?? 0),
    last_frame_max_luma: Number(status.last_frame_max_luma ?? previous.last_frame_max_luma ?? 0),
    last_frame_dark: !!(status.last_frame_dark ?? previous.last_frame_dark ?? false),
    render_clock_mode: status.render_clock_mode || previous.render_clock_mode || 'live',
    render_clock_time: Number(status.render_clock_time ?? previous.render_clock_time ?? 0),
    render_clock_frame_index: Number(status.render_clock_frame_index ?? previous.render_clock_frame_index ?? 0),
    render_clock_updates: Number(status.render_clock_updates ?? previous.render_clock_updates ?? 0),
    decode_backend: status.decode_backend || previous.decode_backend || 'synthetic',
    output_width: Number(status.output_width ?? status.width ?? previous.output_width ?? 1920),
    output_height: Number(status.output_height ?? status.height ?? previous.output_height ?? 1080),
    output_format: String(status.output_format ?? previous.output_format ?? 'unknown'),
    target_fps: Number(status.target_fps ?? previous.target_fps ?? 60),
    present_mode: status.present_mode || previous.present_mode || 'vsync',
    surface_present_mode: status.surface_present_mode || previous.surface_present_mode || 'unconfigured',
    allow_tearing: !!(status.allow_tearing ?? previous.allow_tearing ?? false),
    max_frame_latency: Number(status.max_frame_latency ?? previous.max_frame_latency ?? 2),
    use_waitable_object: !!(status.use_waitable_object ?? previous.use_waitable_object ?? false),
    command_queue_capacity: Number(status.command_queue_capacity ?? previous.command_queue_capacity ?? 8192),
    command_drain_limit: Number(status.command_drain_limit ?? previous.command_drain_limit ?? 1024),
    auto_present_on_state_change: !!(
      status.auto_present_on_state_change ?? previous.auto_present_on_state_change ?? true
    ),
    decode_store_cpu_backup_frames: !!(
      status.decode_store_cpu_backup_frames ?? previous.decode_store_cpu_backup_frames ?? false
    ),
    decode_allow_synthetic_fallback: !!(
      status.decode_allow_synthetic_fallback ?? previous.decode_allow_synthetic_fallback ?? false
    ),
    media_queue_capacity: Number(status.media_queue_capacity ?? previous.media_queue_capacity ?? 2048),
    decode_handoff_queue_capacity: Number(
      status.decode_handoff_queue_capacity ?? previous.decode_handoff_queue_capacity ?? 4096,
    ),
    media_high_burst_limit: Number(status.media_high_burst_limit ?? previous.media_high_burst_limit ?? 7),
    prefetch_cache_max_entries: Number(
      status.prefetch_cache_max_entries ?? previous.prefetch_cache_max_entries ?? 4096,
    ),
    prefetch_cache_prune_count: Number(
      status.prefetch_cache_prune_count ?? previous.prefetch_cache_prune_count ?? 256,
    ),
    video_frame_prefetch_cache_entries: Number(
      status.video_frame_prefetch_cache_entries ?? previous.video_frame_prefetch_cache_entries ?? 0,
    ),
    video_frame_prefetch_cache_bytes: Number(
      status.video_frame_prefetch_cache_bytes ?? previous.video_frame_prefetch_cache_bytes ?? 0,
    ),
    video_frame_prefetch_cache_hits: Number(
      status.video_frame_prefetch_cache_hits ?? previous.video_frame_prefetch_cache_hits ?? 0,
    ),
    video_frame_prefetch_cache_misses: Number(
      status.video_frame_prefetch_cache_misses ?? previous.video_frame_prefetch_cache_misses ?? 0,
    ),
    video_frame_prefetch_cache_clears: Number(
      status.video_frame_prefetch_cache_clears ?? previous.video_frame_prefetch_cache_clears ?? 0,
    ),
    video_frame_prefetch_cache_max_entries: Number(
      status.video_frame_prefetch_cache_max_entries ??
        previous.video_frame_prefetch_cache_max_entries ??
        VIDEO_FRAME_PREFETCH_CACHE_MAX_ENTRIES,
    ),
    media_drop_command_pressure_pct: Number(
      status.media_drop_command_pressure_pct ?? previous.media_drop_command_pressure_pct ?? 90,
    ),
    media_drop_decode_pressure_pct: Number(
      status.media_drop_decode_pressure_pct ?? previous.media_drop_decode_pressure_pct ?? 90,
    ),
    media_drop_io_pressure_pct: Number(
      status.media_drop_io_pressure_pct ?? previous.media_drop_io_pressure_pct ?? 90,
    ),
    media_drop_decode_priority_cutoff: Number(
      status.media_drop_decode_priority_cutoff ?? previous.media_drop_decode_priority_cutoff ?? 180,
    ),
    media_drop_io_priority_cutoff: Number(
      status.media_drop_io_priority_cutoff ?? previous.media_drop_io_priority_cutoff ?? 128,
    ),
    decode_preview_size: Number(status.decode_preview_size ?? previous.decode_preview_size ?? 96),
    decode_preview_cache_mb: Number(
      status.decode_preview_cache_mb ?? previous.decode_preview_cache_mb ?? 128,
    ),
    decode_use_output_resolution: !!(
      status.decode_use_output_resolution ?? previous.decode_use_output_resolution ?? true
    ),
    decode_target_width: Number(status.decode_target_width ?? previous.decode_target_width ?? status.width ?? 1920),
    decode_target_height: Number(status.decode_target_height ?? previous.decode_target_height ?? status.height ?? 1080),
    decode_preview_cache_bypassed: !!(
      status.decode_preview_cache_bypassed ?? previous.decode_preview_cache_bypassed ?? false
    ),
    decode_upload_queue_cap_mb: Number(
      status.decode_upload_queue_cap_mb ?? previous.decode_upload_queue_cap_mb ?? 256,
    ),
    decode_handoff_byte_cap_mb: Number(
      status.decode_handoff_byte_cap_mb ?? previous.decode_handoff_byte_cap_mb ?? 128,
    ),
    decode_handoff_predecode_shed_pct: Number(
      status.decode_handoff_predecode_shed_pct ?? previous.decode_handoff_predecode_shed_pct ?? 90,
    ),
    decode_predecode_estimate_cache_entries: Number(
      status.decode_predecode_estimate_cache_entries ??
        previous.decode_predecode_estimate_cache_entries ??
        0,
    ),
    decode_predecode_estimate_cache_cap_entries: Number(
      status.decode_predecode_estimate_cache_cap_entries ??
        previous.decode_predecode_estimate_cache_cap_entries ??
        8192,
    ),
    decode_predecode_estimate_cache_backpressure_active: !!(
      status.decode_predecode_estimate_cache_backpressure_active ??
        previous.decode_predecode_estimate_cache_backpressure_active ??
        false
    ),
    decode_backpressure_active: !!(
      status.decode_backpressure_active ?? previous.decode_backpressure_active ?? false
    ),
    decode_jobs_submitted: Number(status.decode_jobs_submitted ?? previous.decode_jobs_submitted ?? 0),
    decode_jobs_completed: Number(status.decode_jobs_completed ?? previous.decode_jobs_completed ?? 0),
    decode_jobs_dropped: Number(status.decode_jobs_dropped ?? previous.decode_jobs_dropped ?? 0),
    decode_queue_peak: Number(status.decode_queue_peak ?? previous.decode_queue_peak ?? 0),
    vram_budget_mb: Number(status.vram_budget_mb ?? previous.vram_budget_mb ?? 4096),
    command_drain_limit_hits: Number(
      status.command_drain_limit_hits ?? previous.command_drain_limit_hits ?? 0,
    ),
    queued_commands_after_drain: Number(
      status.queued_commands_after_drain ?? previous.queued_commands_after_drain ?? 0,
    ),
    output_refresh_hz: Number(status.output_refresh_hz ?? previous.output_refresh_hz ?? status.target_fps ?? 60),
    output_window_attached: !!(status.output_window_attached ?? previous.output_window_attached ?? false),
    output_swapchain_ready: !!(status.output_swapchain_ready ?? previous.output_swapchain_ready ?? false),
    output_tearing_active: !!(status.output_tearing_active ?? previous.output_tearing_active ?? false),
    output_waitable_object_active: !!(
      status.output_waitable_object_active ?? previous.output_waitable_object_active ?? false
    ),
    output_present_healthy: !!(status.output_present_healthy ?? previous.output_present_healthy ?? false),
    output_present_consecutive_failures: Number(
      status.output_present_consecutive_failures ?? previous.output_present_consecutive_failures ?? 0,
    ),
    swapchain_present_attempts: Number(
      status.swapchain_present_attempts ?? previous.swapchain_present_attempts ?? 0,
    ),
    swapchain_presented: Number(status.swapchain_presented ?? previous.swapchain_presented ?? 0),
    swapchain_present_failures: Number(
      status.swapchain_present_failures ?? previous.swapchain_present_failures ?? 0,
    ),
    swapchain_last_present_result: String(
      status.swapchain_last_present_result ?? previous.swapchain_last_present_result ?? 'none',
    ),
    swapchain_last_present_error: String(
      status.swapchain_last_present_error ?? previous.swapchain_last_present_error ?? 'none',
    ),
    swapchain_present_timeouts: Number(
      status.swapchain_present_timeouts ?? previous.swapchain_present_timeouts ?? 0,
    ),
    swapchain_present_occluded: Number(
      status.swapchain_present_occluded ?? previous.swapchain_present_occluded ?? 0,
    ),
    swapchain_present_outdated: Number(
      status.swapchain_present_outdated ?? previous.swapchain_present_outdated ?? 0,
    ),
    swapchain_present_lost: Number(
      status.swapchain_present_lost ?? previous.swapchain_present_lost ?? 0,
    ),
    swapchain_present_validation_errors: Number(
      status.swapchain_present_validation_errors ?? previous.swapchain_present_validation_errors ?? 0,
    ),
    swapchain_present_max_consecutive_failures: Number(
      status.swapchain_present_max_consecutive_failures ??
        previous.swapchain_present_max_consecutive_failures ??
        0,
    ),
    swapchain_present_tearing_attempts: Number(
      status.swapchain_present_tearing_attempts ?? previous.swapchain_present_tearing_attempts ?? 0,
    ),
    swapchain_waitable_waits: Number(
      status.swapchain_waitable_waits ?? previous.swapchain_waitable_waits ?? 0,
    ),
    swapchain_waitable_timeouts: Number(
      status.swapchain_waitable_timeouts ?? previous.swapchain_waitable_timeouts ?? 0,
    ),
    frames_without_swapchain_present: Number(
      status.frames_without_swapchain_present ?? previous.frames_without_swapchain_present ?? 0,
    ),
    supports_tearing: !!(status.supports_tearing ?? previous.supports_tearing ?? false),
    supports_waitable_object: !!(status.supports_waitable_object ?? previous.supports_waitable_object ?? false),
    shader_precompile_queue_cap: Number(status.shader_precompile_queue_cap ?? previous.shader_precompile_queue_cap ?? 4096),
    shader_precompile_per_frame: Number(status.shader_precompile_per_frame ?? previous.shader_precompile_per_frame ?? 4),
    shader_metadata_cache_cap: Number(status.shader_metadata_cache_cap ?? previous.shader_metadata_cache_cap ?? 16384),
    pipeline_metadata_cache_cap: Number(status.pipeline_metadata_cache_cap ?? previous.pipeline_metadata_cache_cap ?? 16384),
    texture_pool_cap_mb: Number(status.texture_pool_cap_mb ?? previous.texture_pool_cap_mb ?? 512),
    shader_cache_entries: Number(status.shader_cache_entries ?? previous.shader_cache_entries ?? 0),
    pipeline_cache_entries: Number(status.pipeline_cache_entries ?? previous.pipeline_cache_entries ?? 0),
    precompiled_vertex_shaders: Number(status.precompiled_vertex_shaders ?? previous.precompiled_vertex_shaders ?? 0),
    precompiled_pixel_shaders: Number(status.precompiled_pixel_shaders ?? previous.precompiled_pixel_shaders ?? 0),
    shader_precompile_queued: Number(status.shader_precompile_queued ?? previous.shader_precompile_queued ?? 0),
    shader_precompile_compiled: Number(status.shader_precompile_compiled ?? previous.shader_precompile_compiled ?? 0),
    shader_precompile_failed: Number(status.shader_precompile_failed ?? previous.shader_precompile_failed ?? 0),
    shader_precompile_dropped: Number(status.shader_precompile_dropped ?? previous.shader_precompile_dropped ?? 0),
    layers_seen: Number(status.layers_seen ?? previous.layers_seen ?? 0),
    frames_presented: Number(status.frames_presented ?? previous.frames_presented ?? 0),
    commands_applied: Number(status.commands_applied ?? previous.commands_applied ?? 0),
    gpu_timing_supported: !!(status.gpu_timing_supported ?? previous.gpu_timing_supported ?? false),
    avg_render_cpu_ms: Number(status.avg_render_cpu_ms ?? previous.avg_render_cpu_ms ?? 0),
    last_render_gpu_ms: Number(status.last_render_gpu_ms ?? previous.last_render_gpu_ms ?? 0),
    avg_render_gpu_ms: Number(status.avg_render_gpu_ms ?? previous.avg_render_gpu_ms ?? 0),
    max_render_gpu_ms: Number(status.max_render_gpu_ms ?? previous.max_render_gpu_ms ?? 0),
    gpu_timing_samples: Number(status.gpu_timing_samples ?? previous.gpu_timing_samples ?? 0),
    gpu_timing_resolve_misses: Number(
      status.gpu_timing_resolve_misses ?? previous.gpu_timing_resolve_misses ?? 0,
    ),
    last_frame_error: status.last_frame_error ?? null,
    last_shader_error: status.last_shader_error ?? previous.last_shader_error ?? null,
  };
}

function normalizeStats(stats, previous = makeDefaultStats()) {
  if (!stats || typeof stats !== 'object') return previous;
  return {
    ...makeDefaultStats(),
    ...previous,
    ...stats,
    frames_submitted: Number(stats.frames_submitted ?? previous.frames_submitted ?? 0),
    frames_presented: Number(stats.frames_presented ?? previous.frames_presented ?? 0),
    frames_presented_explicit: Number(stats.frames_presented_explicit ?? previous.frames_presented_explicit ?? 0),
    frames_presented_auto: Number(stats.frames_presented_auto ?? previous.frames_presented_auto ?? 0),
    commands_applied: Number(stats.commands_applied ?? previous.commands_applied ?? 0),
    commands_dropped: Number(stats.commands_dropped ?? previous.commands_dropped ?? 0),
    batch_commands_coalesced: Number(stats.batch_commands_coalesced ?? previous.batch_commands_coalesced ?? 0),
    command_queue_peak: Number(stats.command_queue_peak ?? previous.command_queue_peak ?? 0),
    command_drain_limit_hits: Number(
      stats.command_drain_limit_hits ?? previous.command_drain_limit_hits ?? 0,
    ),
    queued_commands_after_drain: Number(
      stats.queued_commands_after_drain ?? previous.queued_commands_after_drain ?? 0,
    ),
    source_frame_uploads: Number(stats.source_frame_uploads ?? previous.source_frame_uploads ?? 0),
    source_frame_bytes_uploaded: Number(
      stats.source_frame_bytes_uploaded ?? previous.source_frame_bytes_uploaded ?? 0,
    ),
    native_instrument_frame_renders: Number(stats.native_instrument_frame_renders ?? previous.native_instrument_frame_renders ?? 0),
    compute_graph_runs: Number(stats.compute_graph_runs ?? previous.compute_graph_runs ?? 0),
    compute_graph_passes: Number(stats.compute_graph_passes ?? previous.compute_graph_passes ?? 0),
    compute_graph_render_passes: Number(
      stats.compute_graph_render_passes ?? previous.compute_graph_render_passes ?? 0,
    ),
    compute_graph_snapshot_renders: Number(
      stats.compute_graph_snapshot_renders ?? previous.compute_graph_snapshot_renders ?? 0,
    ),
    compute_graph_source_frame_renders: Number(
      stats.compute_graph_source_frame_renders ?? previous.compute_graph_source_frame_renders ?? 0,
    ),
    compute_graph_readbacks: Number(stats.compute_graph_readbacks ?? previous.compute_graph_readbacks ?? 0),
    compute_graph_readback_bytes: Number(
      stats.compute_graph_readback_bytes ?? previous.compute_graph_readback_bytes ?? 0,
    ),
    compute_graph_persistent_buffers: Number(
      stats.compute_graph_persistent_buffers ?? previous.compute_graph_persistent_buffers ?? 0,
    ),
    source_frame_cpu_fallback_uploads: Number(
      stats.source_frame_cpu_fallback_uploads ?? previous.source_frame_cpu_fallback_uploads ?? 0,
    ),
    source_frame_file_uploads: Number(stats.source_frame_file_uploads ?? previous.source_frame_file_uploads ?? 0),
    source_frame_base64_uploads: Number(stats.source_frame_base64_uploads ?? previous.source_frame_base64_uploads ?? 0),
    source_frame_json_uploads: Number(stats.source_frame_json_uploads ?? previous.source_frame_json_uploads ?? 0),
    source_frame_shared_texture_uploads: Number(
      stats.source_frame_shared_texture_uploads ?? previous.source_frame_shared_texture_uploads ?? 0,
    ),
    source_frame_shared_texture_rejected_uploads: Number(
      stats.source_frame_shared_texture_rejected_uploads ??
        previous.source_frame_shared_texture_rejected_uploads ??
        0,
    ),
    source_frame_rejected_uploads: Number(
      stats.source_frame_rejected_uploads ?? previous.source_frame_rejected_uploads ?? 0,
    ),
    source_frame_input_bytes_uploaded: Number(
      stats.source_frame_input_bytes_uploaded ?? previous.source_frame_input_bytes_uploaded ?? 0,
    ),
    source_frame_resampled_bytes_uploaded: Number(
      stats.source_frame_resampled_bytes_uploaded ?? previous.source_frame_resampled_bytes_uploaded ?? 0,
    ),
    source_frame_last_input_bytes: Number(
      stats.source_frame_last_input_bytes ?? previous.source_frame_last_input_bytes ?? 0,
    ),
    source_frame_last_upload_bytes: Number(
      stats.source_frame_last_upload_bytes ?? previous.source_frame_last_upload_bytes ?? 0,
    ),
    source_frame_last_upload_width: Number(
      stats.source_frame_last_upload_width ?? previous.source_frame_last_upload_width ?? 0,
    ),
    source_frame_last_upload_height: Number(
      stats.source_frame_last_upload_height ?? previous.source_frame_last_upload_height ?? 0,
    ),
    source_frame_last_upload_transport: String(
      stats.source_frame_last_upload_transport ?? previous.source_frame_last_upload_transport ?? 'none',
    ),
    source_frame_last_reject_reason: String(
      stats.source_frame_last_reject_reason ?? previous.source_frame_last_reject_reason ?? 'none',
    ),
    native_image_decodes: Number(stats.native_image_decodes ?? previous.native_image_decodes ?? 0),
    native_image_decode_failures: Number(
      stats.native_image_decode_failures ?? previous.native_image_decode_failures ?? 0,
    ),
    native_image_decode_bytes_uploaded: Number(
      stats.native_image_decode_bytes_uploaded ?? previous.native_image_decode_bytes_uploaded ?? 0,
    ),
    native_image_decode_last_error: String(
      stats.native_image_decode_last_error ?? previous.native_image_decode_last_error ?? 'none',
    ),
    native_video_frame_decodes: Number(
      stats.native_video_frame_decodes ?? previous.native_video_frame_decodes ?? 0,
    ),
    native_video_frame_decode_failures: Number(
      stats.native_video_frame_decode_failures ?? previous.native_video_frame_decode_failures ?? 0,
    ),
    native_video_frame_decode_bytes_uploaded: Number(
      stats.native_video_frame_decode_bytes_uploaded ??
        previous.native_video_frame_decode_bytes_uploaded ??
        0,
    ),
    native_video_frame_decode_last_error: String(
      stats.native_video_frame_decode_last_error ??
        previous.native_video_frame_decode_last_error ??
        'none',
    ),
    native_video_frame_cache_entries: Number(
      stats.native_video_frame_cache_entries ?? previous.native_video_frame_cache_entries ?? 0,
    ),
    native_video_frame_cache_bytes: Number(
      stats.native_video_frame_cache_bytes ?? previous.native_video_frame_cache_bytes ?? 0,
    ),
    native_video_frame_cache_hits: Number(
      stats.native_video_frame_cache_hits ?? previous.native_video_frame_cache_hits ?? 0,
    ),
    native_video_frame_cache_misses: Number(
      stats.native_video_frame_cache_misses ?? previous.native_video_frame_cache_misses ?? 0,
    ),
    native_video_frame_cache_evictions: Number(
      stats.native_video_frame_cache_evictions ?? previous.native_video_frame_cache_evictions ?? 0,
    ),
    avg_render_cpu_ms: Number(stats.avg_render_cpu_ms ?? previous.avg_render_cpu_ms ?? 0),
    gpu_timing_supported: !!(stats.gpu_timing_supported ?? previous.gpu_timing_supported ?? false),
    last_render_gpu_ms: Number(stats.last_render_gpu_ms ?? previous.last_render_gpu_ms ?? 0),
    avg_render_gpu_ms: Number(stats.avg_render_gpu_ms ?? previous.avg_render_gpu_ms ?? 0),
    max_render_gpu_ms: Number(stats.max_render_gpu_ms ?? previous.max_render_gpu_ms ?? 0),
    gpu_timing_samples: Number(stats.gpu_timing_samples ?? previous.gpu_timing_samples ?? 0),
    gpu_timing_resolve_misses: Number(
      stats.gpu_timing_resolve_misses ?? previous.gpu_timing_resolve_misses ?? 0,
    ),
    swapchain_present_attempts: Number(
      stats.swapchain_present_attempts ?? previous.swapchain_present_attempts ?? 0,
    ),
    swapchain_presented: Number(stats.swapchain_presented ?? previous.swapchain_presented ?? 0),
    swapchain_present_failures: Number(
      stats.swapchain_present_failures ?? previous.swapchain_present_failures ?? 0,
    ),
    swapchain_last_present_result: String(
      stats.swapchain_last_present_result ?? previous.swapchain_last_present_result ?? 'none',
    ),
    swapchain_last_present_error: String(
      stats.swapchain_last_present_error ?? previous.swapchain_last_present_error ?? 'none',
    ),
    swapchain_present_timeouts: Number(
      stats.swapchain_present_timeouts ?? previous.swapchain_present_timeouts ?? 0,
    ),
    swapchain_present_occluded: Number(
      stats.swapchain_present_occluded ?? previous.swapchain_present_occluded ?? 0,
    ),
    swapchain_present_outdated: Number(
      stats.swapchain_present_outdated ?? previous.swapchain_present_outdated ?? 0,
    ),
    swapchain_present_lost: Number(
      stats.swapchain_present_lost ?? previous.swapchain_present_lost ?? 0,
    ),
    swapchain_present_validation_errors: Number(
      stats.swapchain_present_validation_errors ?? previous.swapchain_present_validation_errors ?? 0,
    ),
    swapchain_present_consecutive_failures: Number(
      stats.swapchain_present_consecutive_failures ??
        previous.swapchain_present_consecutive_failures ??
        0,
    ),
    swapchain_present_max_consecutive_failures: Number(
      stats.swapchain_present_max_consecutive_failures ??
        previous.swapchain_present_max_consecutive_failures ??
        0,
    ),
    swapchain_present_tearing_attempts: Number(
      stats.swapchain_present_tearing_attempts ??
        previous.swapchain_present_tearing_attempts ??
        0,
    ),
    swapchain_waitable_waits: Number(
      stats.swapchain_waitable_waits ?? previous.swapchain_waitable_waits ?? 0,
    ),
    swapchain_waitable_timeouts: Number(
      stats.swapchain_waitable_timeouts ?? previous.swapchain_waitable_timeouts ?? 0,
    ),
    frames_without_swapchain_present: Number(
      stats.frames_without_swapchain_present ?? previous.frames_without_swapchain_present ?? 0,
    ),
  };
}

function makeDefaultCapabilities(overrides = {}) {
  return {
    schema_version: 1,
    core_version: null,
    backend: overrides.backend ?? null,
    core_capabilities_confirmed: !!overrides.core_capabilities_confirmed,
    core_capabilities_error: overrides.core_capabilities_error ?? null,
    implemented_methods: [],
    implemented_command_types: [],
    native_graph_instruments: [],
    native_graph_instrument_manifest: [],
    native_compositor_blend_modes: [],
    native_compositor_effect_descriptors: [],
    features: {
      separate_process_render_core: false,
      managed_native_window: false,
      audio_uniform_layout: false,
      layer_compositor: false,
      layer_corner_warp: false,
      layer_uv_controls: false,
      layer_shape_masks: false,
      blend_modes: false,
      effect_descriptors: false,
      native_compositor_manifest: false,
      render_clock: false,
      frame_snapshot: false,
      frame_snapshot_export: false,
      native_frame_sequence_export: false,
      frame_health: false,
      gpu_timing: false,
      shader_precompile: false,
      fragment_wgsl_host: false,
      native_instrument_proxies: false,
      source_preview_upload: false,
      source_frame_upload: false,
      source_frame_file_handoff: false,
      source_frame_mips: false,
      source_frame_hdr: false,
      native_static_image_decode: false,
      native_static_image_prefetch: false,
      runtime_cache_clear: false,
      native_graph_buffer_prune: false,
      compute_shader_host: false,
      compute_graph_host: false,
      compute_graph_render: false,
      compute_graph_multi_render: false,
      compute_graph_instanced_render: false,
      compute_graph_indirect_render: false,
      compute_graph_texture_sampling: false,
      compute_graph_depth_render: false,
      compute_graph_line_render: false,
      compute_graph_source_frame_target: false,
      persistent_compute_buffers: false,
      native_planet_graph: false,
      native_3d_smoke_graph: false,
      native_particle_field_graph: false,
      native_volumetric_spheres_graph: false,
      native_smoke_riders_graph: false,
      native_ink_cloud_graph: false,
      native_flythrough_graph: false,
      native_pixel_particles_graph: false,
      native_point_cloud_fx_graph: false,
      command_drain_policy: false,
      auto_present_policy: false,
      multi_pass_instruments: false,
      storage_buffer_instruments: false,
      shared_texture_source_frame_upload: false,
      native_output_mirror_texture: false,
      shared_texture_upload: false,
      shared_texture_output_export: false,
      native_texture_share_sender: false,
      native_mp4_frame_encoder: false,
      native_media_decode: false,
      media_prefetch: false,
      native_video_frame_decode: false,
      native_video_frame_prefetch: false,
      native_video_frame_prefetch_window: false,
      native_video_decode_pump: false,
      native_video_decode_pump_window: false,
      native_media_source_playback_state: false,
      video_frame_prefetch: false,
      present_policy: false,
      managed_output_attach: false,
      managed_output_window_control: false,
      native_stage3d_scene_ingest: false,
      native_stage3d_overlay_preview: false,
      native_stage3d_mesh_preview: false,
      native_stage3d_textured_mesh_preview: false,
      native_stage3d_primitive_meshes: false,
      native_stage3d_xyz_mesh_transforms: false,
      native_stage3d_lighting_preview: false,
      native_stage3d_output_renderer: false,
      native_projection_sim_scene_ingest: false,
      native_projection_sim_overlay_preview: false,
      native_projection_sim_mesh_preview: false,
      native_projection_sim_textured_mesh_preview: false,
      native_projection_sim_xyz_mesh_transforms: false,
      native_projection_sim_output_renderer: false,
      native_recording: false,
      native_stage3d: false,
      native_projection_sim: false,
    },
    limits: {
      max_scene_layers: 0,
      source_preview_size: 0,
      source_preview_slots: 0,
      source_frame_slots: 0,
      source_frame_size: 0,
      source_frame_mip_levels: 1,
      command_queue_capacity: 0,
      command_drain_limit: 0,
    },
    audio_uniform_layout: {
      schema_version: 1,
      audio0: ['level', 'bass', 'mid', 'treble'],
      audio1: ['high', 'beat', 'beat_phase', 'bpm'],
      audio2: ['centroid', 'kick', 'snare', 'active'],
    },
    notes: overrides.running === false
      ? ['Native render core is not running; capabilities are the broker fallback shape.']
      : [],
    ...overrides,
  };
}

function makeDefaultOutputSharedTexture(platform = process.platform) {
  return {
    available: false,
    platform: platform === 'darwin' ? 'iosurface' : platform === 'win32' ? 'dxgi' : 'unsupported',
    reason: 'native output shared texture export is unavailable',
  };
}

function makeDefaultStatus(overrides = {}) {
  const outputWidth = overrides.output_width || overrides.width || 1920;
  const outputHeight = overrides.output_height || overrides.height || 1080;
  return {
    running: false,
    backend: overrides.backend ?? null,
    backend_ready: false,
    adapter_name: null,
    native_caps: normalizeNativeCaps(overrides.native_caps),
    native_quality: normalizeNativeQuality(overrides.native_quality),
    source_preview_size: 256,
    source_previews_active: 0,
    source_preview_slots: 16,
    source_preview_dirty: false,
    source_frame_size: 2048,
    source_frame_format: 'rgba8unorm',
    source_frame_hdr: false,
    source_frame_mip_levels: 1,
    source_frames_active: 0,
    source_frame_slots: 8,
    isf_shader_bindings: 0,
    isf_uniform_sets: 0,
    native_shader_layers: 0,
    native_procedural_layers: 0,
    native_instrument_layers: 0,
    native_instrument_proxy_layers: 0,
    native_graph_source_frame_layers: 0,
    source_frame_uploads: 0,
    source_frame_bytes_uploaded: 0,
    source_frame_cpu_fallback_uploads: 0,
    source_frame_file_uploads: 0,
    source_frame_base64_uploads: 0,
    source_frame_json_uploads: 0,
    source_frame_shared_texture_uploads: 0,
    source_frame_shared_texture_rejected_uploads: 0,
    source_frame_rejected_uploads: 0,
    source_frame_input_bytes_uploaded: 0,
    source_frame_resampled_bytes_uploaded: 0,
    source_frame_last_input_bytes: 0,
    source_frame_last_upload_bytes: 0,
    source_frame_last_upload_width: 0,
    source_frame_last_upload_height: 0,
    source_frame_last_upload_transport: 'none',
    source_frame_last_reject_reason: 'none',
    native_image_decodes: 0,
    native_image_decode_failures: 0,
    native_image_decode_bytes_uploaded: 0,
    native_image_decode_last_error: 'none',
    native_video_frame_decodes: 0,
    native_video_frame_decode_failures: 0,
    native_video_frame_decode_bytes_uploaded: 0,
    native_video_frame_decode_last_error: 'none',
    native_video_frame_cache_entries: 0,
    native_video_frame_cache_bytes: 0,
    native_video_frame_cache_hits: 0,
    native_video_frame_cache_misses: 0,
    native_video_frame_cache_evictions: 0,
    native_instrument_frame_renders: 0,
    compute_graph_runs: 0,
    compute_graph_passes: 0,
    compute_graph_render_passes: 0,
    compute_graph_snapshot_renders: 0,
    compute_graph_source_frame_renders: 0,
    compute_graph_readbacks: 0,
    compute_graph_readback_bytes: 0,
    compute_graph_persistent_buffers: 0,
    decode_backend: 'synthetic',
    decode_preview_size: 96,
    decode_preview_cache_mb: 128,
    decode_use_output_resolution: true,
    decode_gpu_surface_path: false,
    decode_target_width: outputWidth,
    decode_target_height: outputHeight,
    decode_preview_cache_bypassed: false,
    decode_upload_queue_cap_mb: 256,
    decode_handoff_byte_cap_mb: 128,
    decode_handoff_predecode_shed_pct: 90,
    shader_precompile_queue_cap: 4096,
    shader_precompile_per_frame: 4,
    shader_metadata_cache_cap: 16384,
    pipeline_metadata_cache_cap: 16384,
    decode_backend_ready: true,
    decode_backend_last_error: null,
    last_frame_error: overrides.last_frame_error ?? null,
    ffmpeg_active_video_sessions: 0,
    decode_hw_frames: 0,
    decode_predecode_estimate_cache_entries: 0,
    decode_predecode_estimate_cache_cap_entries: 8192,
    decode_predecode_estimate_cache_backpressure_active: false,
    shader_cache_entries: 0,
    pipeline_cache_entries: 0,
    precompiled_vertex_shaders: 0,
    precompiled_pixel_shaders: 0,
    shader_precompile_queued: 0,
    shader_precompile_compiled: 0,
    shader_precompile_failed: 0,
    shader_precompile_dropped: 0,
    source_frame_uploads: 0,
    source_frame_bytes_uploaded: 0,
    source_frame_cpu_fallback_uploads: 0,
    source_frame_file_uploads: 0,
    source_frame_base64_uploads: 0,
    source_frame_json_uploads: 0,
    source_frame_shared_texture_uploads: 0,
    source_frame_shared_texture_rejected_uploads: 0,
    source_frame_rejected_uploads: 0,
    source_frame_input_bytes_uploaded: 0,
    source_frame_resampled_bytes_uploaded: 0,
    source_frame_last_input_bytes: 0,
    source_frame_last_upload_bytes: 0,
    source_frame_last_upload_width: 0,
    source_frame_last_upload_height: 0,
    source_frame_last_upload_transport: 'none',
    source_frame_last_reject_reason: 'none',
    native_image_decodes: 0,
    native_image_decode_failures: 0,
    native_image_decode_bytes_uploaded: 0,
    native_image_decode_last_error: 'none',
    native_video_frame_decodes: 0,
    native_video_frame_decode_failures: 0,
    native_video_frame_decode_bytes_uploaded: 0,
    native_video_frame_decode_last_error: 'none',
    native_video_frame_cache_entries: 0,
    native_video_frame_cache_bytes: 0,
    native_video_frame_cache_hits: 0,
    native_video_frame_cache_misses: 0,
    native_video_frame_cache_evictions: 0,
    native_shader_renders: 0,
    native_instrument_frame_renders: 0,
    render_clock_mode: 'live',
    render_clock_time: 0,
    render_clock_frame_index: 0,
    render_clock_updates: 0,
    frame_snapshot_reads: 0,
    frame_snapshot_bytes_read: 0,
    frame_health_checks: 0,
    dark_frame_warnings: 0,
    last_frame_checksum: null,
    last_frame_nonzero_pixels: 0,
    last_frame_bright_pixels: 0,
    last_frame_average_luma: 0,
    last_frame_max_luma: 0,
    last_frame_dark: false,
    last_shader_error: null,
    layers_seen: 0,
    target_fps: 60,
    present_mode: 'vsync',
    surface_present_mode: 'unconfigured',
    allow_tearing: false,
    max_frame_latency: 2,
    use_waitable_object: false,
    command_queue_capacity: 8192,
    command_drain_limit: 1024,
    auto_present_on_state_change: true,
    decode_store_cpu_backup_frames: false,
    decode_allow_synthetic_fallback: false,
    command_drain_limit_hits: 0,
    queued_commands_after_drain: 0,
    media_queue_capacity: 2048,
    decode_handoff_queue_capacity: 4096,
    media_high_burst_limit: 7,
    prefetch_cache_max_entries: 4096,
    prefetch_cache_prune_count: 256,
    video_frame_prefetch_cache_entries: 0,
    video_frame_prefetch_cache_bytes: 0,
    video_frame_prefetch_cache_hits: 0,
    video_frame_prefetch_cache_misses: 0,
    video_frame_prefetch_cache_clears: 0,
    video_frame_prefetch_cache_max_entries: VIDEO_FRAME_PREFETCH_CACHE_MAX_ENTRIES,
    media_drop_command_pressure_pct: 90,
    media_drop_decode_pressure_pct: 90,
    media_drop_io_pressure_pct: 90,
    media_drop_decode_priority_cutoff: 180,
    media_drop_io_priority_cutoff: 128,
    output_width: outputWidth,
    output_height: outputHeight,
    output_format: overrides.output_format || 'unknown',
    output_refresh_hz: 60,
    output_window_attached: !!overrides.output_window_attached,
    output_swapchain_ready: !!overrides.output_swapchain_ready,
    output_tearing_active: false,
    output_waitable_object_active: false,
    output_present_healthy: !!overrides.output_present_healthy,
    output_present_consecutive_failures: 0,
    swapchain_present_attempts: 0,
    swapchain_presented: 0,
    swapchain_present_failures: 0,
    swapchain_last_present_result: 'none',
    swapchain_last_present_error: 'none',
    swapchain_present_timeouts: 0,
    swapchain_present_occluded: 0,
    swapchain_present_outdated: 0,
    swapchain_present_lost: 0,
    swapchain_present_validation_errors: 0,
    swapchain_present_max_consecutive_failures: 0,
    swapchain_present_tearing_attempts: 0,
    swapchain_waitable_waits: 0,
    swapchain_waitable_timeouts: 0,
    frame_graph_violations: 0,
    frames_without_swapchain_present: 0,
    last_frame_pass_mask: 0,
    last_frame_pass_expected_mask: 0,
    device_recovery_attempts: 0,
    device_recovery_successes: 0,
    device_recovery_failures: 0,
    device_recovery_rehydrate_jobs_submitted: 0,
    device_recovery_rehydrate_jobs_dropped: 0,
    supports_tearing: false,
    supports_waitable_object: false,
    gpu_timing_supported: false,
    avg_render_cpu_ms: 0,
    max_render_cpu_ms: 0,
    render_cpu_p95_ms: 0,
    render_cpu_p99_ms: 0,
    last_render_gpu_ms: 0,
    avg_render_gpu_ms: 0,
    max_render_gpu_ms: 0,
    render_gpu_p95_ms: 0,
    render_gpu_p99_ms: 0,
    frame_budget_overruns: 0,
    consecutive_budget_overruns: 0,
    max_consecutive_budget_overruns: 0,
    queued_commands: 0,
    queued_decode_jobs: 0,
    queued_io_jobs: 0,
    pending_decode_keys: 0,
    queued_decode_handoff_bytes: 0,
    decode_handoff_queue_bytes_peak: 0,
    decode_handoff_capacity_bytes: 128 * 1024 * 1024,
    decode_handoff_utilization_pct: 0,
    decode_pending_upload_count: 0,
    decode_pending_upload_bytes: 0,
    decode_pending_upload_bytes_peak: 0,
    decode_pending_upload_capacity_bytes: 256 * 1024 * 1024,
    decode_pending_upload_utilization_pct: 0,
    decode_pending_upload_backpressure_active: false,
    decode_frame_pool_buffers: 0,
    decode_frame_pool_bytes: 0,
    decode_frame_pool_capacity_buffers: 0,
    decode_frame_pool_capacity_bytes: 0,
    decode_frame_pool_utilization_pct: 0,
    decode_frame_pool_backpressure_active: false,
    command_backpressure_active: false,
    decode_backpressure_active: false,
    decode_jobs_submitted: 0,
    decode_jobs_completed: 0,
    decode_jobs_dropped: 0,
    decode_queue_peak: 0,
    io_backpressure_active: false,
    decode_handoff_backpressure_active: false,
    degraded_mode_active: false,
    prefetched_sources: 0,
    vram_budget_mb: 4096,
    vram_used_mb: 0,
    vertex_shader_cache_cap: 512,
    pixel_shader_cache_cap: 1024,
    texture_pool_cap_mb: 512,
    texture_pool_mb: 0,
    dropped_commands: 0,
    stale_preview_drops: 0,
    ...overrides,
  };
}

function normalizeNativeCaps(caps, previous = null) {
  const base = {
    adapter_name: '',
    adapter_vendor: 0,
    adapter_device: 0,
    adapter_device_type: '',
    adapter_driver: '',
    adapter_driver_info: '',
    max_texture_dimension_2d: 0,
    max_texture_dimension_3d: 0,
    max_texture_array_layers: 0,
    max_bind_groups: 0,
    max_bindings_per_bind_group: 0,
    max_sampled_textures_per_shader_stage: 0,
    max_storage_buffers_per_shader_stage: 0,
    max_storage_textures_per_shader_stage: 0,
    max_uniform_buffer_binding_size: 0,
    max_storage_buffer_binding_size: 0,
    max_buffer_size: 0,
    max_compute_workgroup_storage_size: 0,
    max_compute_invocations_per_workgroup: 0,
    max_compute_workgroup_size_x: 0,
    max_compute_workgroup_size_y: 0,
    max_compute_workgroup_size_z: 0,
    max_compute_workgroups_per_dimension: 0,
    supports_shader_f16: false,
    supports_float32_filterable: false,
    supports_timestamp_query: false,
    supports_timestamp_query_inside_encoders: false,
    supports_timestamp_query_inside_passes: false,
    supports_texture_binding_array: false,
    supports_buffer_binding_array: false,
    supports_storage_resource_binding_array: false,
    supports_texture_adapter_specific_format_features: false,
    requested_shader_f16: false,
    requested_float32_filterable: false,
    requested_timestamp_query: false,
    requested_timestamp_query_inside_encoders: false,
    requested_timestamp_query_inside_passes: false,
    recommended_quality_tier: 'unknown',
  };
  const source = caps && typeof caps === 'object' ? caps : {};
  return {
    ...base,
    ...(previous && typeof previous === 'object' ? previous : {}),
    ...source,
  };
}

function normalizeNativeQuality(quality, previous = null) {
  const base = {
    policy: 'auto',
    caps_tier: 'balanced',
    active_tier: 'balanced',
    quality_scale: 0.72,
    target_frame_ms: 16.67,
    cpu_ema_ms: 0,
    gpu_ema_ms: 0,
    overload_frames: 0,
    recovery_frames: 0,
    step_downs: 0,
    step_ups: 0,
  };
  const source = quality && typeof quality === 'object' ? quality : {};
  return {
    ...base,
    ...(previous && typeof previous === 'object' ? previous : {}),
    ...source,
    quality_scale: Number(source.quality_scale ?? previous?.quality_scale ?? base.quality_scale),
    target_frame_ms: Number(source.target_frame_ms ?? previous?.target_frame_ms ?? base.target_frame_ms),
    cpu_ema_ms: Number(source.cpu_ema_ms ?? previous?.cpu_ema_ms ?? base.cpu_ema_ms),
    gpu_ema_ms: Number(source.gpu_ema_ms ?? previous?.gpu_ema_ms ?? base.gpu_ema_ms),
    overload_frames: Number(source.overload_frames ?? previous?.overload_frames ?? base.overload_frames),
    recovery_frames: Number(source.recovery_frames ?? previous?.recovery_frames ?? base.recovery_frames),
    step_downs: Number(source.step_downs ?? previous?.step_downs ?? base.step_downs),
    step_ups: Number(source.step_ups ?? previous?.step_ups ?? base.step_ups),
  };
}

function makeDefaultStats() {
  const stats = {
    frames_submitted: 0,
    frames_presented: 0,
    frames_presented_explicit: 0,
    frames_presented_auto: 0,
    commands_applied: 0,
    commands_dropped: 0,
    batch_commands_coalesced: 0,
    command_queue_peak: 0,
    command_drain_limit_hits: 0,
    queued_commands_after_drain: 0,
    draw_calls: 0,
    pipeline_switches: 0,
    batched_draws: 0,
    decode_jobs_submitted: 0,
    decode_jobs_completed: 0,
    decode_jobs_dropped: 0,
    decode_jobs_stale_dropped: 0,
    decode_jobs_cache_skipped: 0,
    decode_jobs_pending_skipped: 0,
    decode_pending_key_forced_clears: 0,
    decode_forced_cache_hits: 0,
    decode_jobs_policy_dropped: 0,
    decode_jobs_forced: 0,
    decode_hw_frames: 0,
    decode_hard_failures: 0,
    decode_predecode_estimate_hits: 0,
    decode_predecode_estimate_misses: 0,
    decode_predecode_estimate_cache_forced_clears: 0,
    decode_predecode_estimate_cache_entries_peak: 0,
    decode_queue_peak: 0,
    decode_backend_init_attempts: 0,
    decode_backend_init_failures: 0,
    decode_backend_fallbacks: 0,
    shader_precompile_queued: 0,
    shader_precompile_compiled: 0,
    shader_precompile_failed: 0,
    shader_precompile_dropped: 0,
    source_frame_uploads: 0,
    source_frame_bytes_uploaded: 0,
    source_frame_cpu_fallback_uploads: 0,
    source_frame_file_uploads: 0,
    source_frame_base64_uploads: 0,
    source_frame_json_uploads: 0,
    source_frame_shared_texture_uploads: 0,
    source_frame_shared_texture_rejected_uploads: 0,
    source_frame_rejected_uploads: 0,
    source_frame_input_bytes_uploaded: 0,
    source_frame_resampled_bytes_uploaded: 0,
    source_frame_last_input_bytes: 0,
    source_frame_last_upload_bytes: 0,
    source_frame_last_upload_width: 0,
    source_frame_last_upload_height: 0,
    source_frame_last_upload_transport: 'none',
    source_frame_last_reject_reason: 'none',
    native_image_decodes: 0,
    native_image_decode_failures: 0,
    native_image_decode_bytes_uploaded: 0,
    native_image_decode_last_error: 'none',
    native_video_frame_decodes: 0,
    native_video_frame_decode_failures: 0,
    native_video_frame_decode_bytes_uploaded: 0,
    native_video_frame_decode_last_error: 'none',
    native_video_frame_cache_entries: 0,
    native_video_frame_cache_bytes: 0,
    native_video_frame_cache_hits: 0,
    native_video_frame_cache_misses: 0,
    native_video_frame_cache_evictions: 0,
    native_shader_renders: 0,
    native_instrument_frame_renders: 0,
    render_clock_updates: 0,
    frame_snapshot_reads: 0,
    frame_snapshot_bytes_read: 0,
    frame_health_checks: 0,
    dark_frame_warnings: 0,
    shader_cache_entries: 0,
    pipeline_cache_entries: 0,
    shader_cache_evictions: 0,
    pipeline_cache_evictions: 0,
    cache_clear_requests: 0,
    metadata_cache_clears: 0,
    precompiled_shader_cache_clears: 0,
    texture_pool_clears: 0,
    precompiled_vertex_shaders: 0,
    precompiled_pixel_shaders: 0,
    precompiled_shader_evictions: 0,
    decode_preview_cache_hits: 0,
    decode_preview_cache_misses: 0,
    decode_preview_cache_clears: 0,
    decode_preview_cache_entries: 0,
    decode_preview_cache_bytes: 0,
    ffmpeg_decode_spawns: 0,
    ffmpeg_decode_successes: 0,
    ffmpeg_decode_failures: 0,
    decode_software_fallback_frames: 0,
    decode_synthetic_fallback_frames: 0,
    ffmpeg_active_video_sessions: 0,
    ffmpeg_persistent_session_starts: 0,
    ffmpeg_persistent_session_restarts: 0,
    prefetch_cache_hits: 0,
    prefetch_cache_misses: 0,
    prefetch_cache_clears: 0,
    video_frame_prefetch_cache_hits: 0,
    video_frame_prefetch_cache_misses: 0,
    video_frame_prefetch_cache_clears: 0,
    image_resources: 0,
    image_previews_uploaded: 0,
    image_preview_bytes: 0,
    image_texture_creates: 0,
    image_texture_updates: 0,
    image_copy_ops: 0,
    preview_commands_coalesced: 0,
    layer_commands_coalesced: 0,
    vram_evictions: 0,
    vram_evicted_bytes: 0,
    stale_preview_drops: 0,
    decode_preview_commits: 0,
    decode_unbound_commit_drops: 0,
    decode_direct_texture_uploads: 0,
    decode_pending_upload_replacements: 0,
    decode_pending_upload_policy_drops: 0,
    decode_pending_upload_policy_trim_passes: 0,
    decode_pending_upload_policy_trimmed_bytes: 0,
    decode_pending_upload_count: 0,
    decode_pending_upload_bytes: 0,
    decode_pending_upload_peak: 0,
    decode_pending_upload_bytes_peak: 0,
    decode_cpu_backup_frames_stored: 0,
    decode_cpu_backup_frames_skipped: 0,
    decode_handoff_drops: 0,
    decode_handoff_policy_drops: 0,
    decode_handoff_predecode_policy_drops: 0,
    decode_handoff_predecode_projected_drops: 0,
    decode_handoff_predecode_saturation_drops: 0,
    decode_handoff_bytes_enqueued: 0,
    decode_handoff_bytes_dropped: 0,
    decode_handoff_queue_bytes_peak: 0,
    io_jobs_submitted: 0,
    io_jobs_completed: 0,
    io_jobs_dropped: 0,
    io_jobs_cache_skipped: 0,
    io_jobs_policy_dropped: 0,
    io_queue_peak: 0,
    last_render_cpu_ms: 0,
    avg_render_cpu_ms: 0,
    max_render_cpu_ms: 0,
    render_cpu_p95_ms: 0,
    render_cpu_p99_ms: 0,
    last_upload_cpu_ms: 0,
    last_composite_cpu_ms: 0,
    last_present_cpu_ms: 0,
    last_render_gpu_ms: 0,
    avg_render_gpu_ms: 0,
    max_render_gpu_ms: 0,
    render_gpu_p95_ms: 0,
    render_gpu_p99_ms: 0,
    gpu_timing_supported: false,
    gpu_timing_samples: 0,
    gpu_timing_disjoint: 0,
    gpu_timing_resolve_misses: 0,
    compute_graph_runs: 0,
    compute_graph_passes: 0,
    compute_graph_render_passes: 0,
    compute_graph_snapshot_renders: 0,
    compute_graph_source_frame_renders: 0,
    compute_graph_readbacks: 0,
    compute_graph_readback_bytes: 0,
    compute_graph_persistent_buffers: 0,
    frame_budget_overruns: 0,
    consecutive_budget_overruns: 0,
    max_consecutive_budget_overruns: 0,
    last_render_wait_ms: 0,
    last_frame_budget_ms: 16.66,
    effective_target_fps: 60,
    swapchain_present_attempts: 0,
    swapchain_presented: 0,
    swapchain_present_failures: 0,
    swapchain_last_present_result: 'none',
    swapchain_last_present_error: 'none',
    swapchain_present_timeouts: 0,
    swapchain_present_occluded: 0,
    swapchain_present_outdated: 0,
    swapchain_present_lost: 0,
    swapchain_present_validation_errors: 0,
    swapchain_present_consecutive_failures: 0,
    swapchain_present_max_consecutive_failures: 0,
    swapchain_present_tearing_attempts: 0,
    swapchain_waitable_waits: 0,
    swapchain_waitable_timeouts: 0,
    frame_graph_violations: 0,
    frames_without_swapchain_present: 0,
    last_frame_pass_mask: 0,
    last_frame_pass_expected_mask: 0,
    device_recovery_attempts: 0,
    device_recovery_successes: 0,
    device_recovery_failures: 0,
    device_recovery_rehydrate_jobs_submitted: 0,
    device_recovery_rehydrate_jobs_dropped: 0,
  };
  return stats;
}
