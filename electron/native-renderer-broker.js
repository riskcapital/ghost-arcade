import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const COMMAND_PREFIX = 'native_renderer_';
const SOURCE_FRAME_FILE_HANDOFF_B64_THRESHOLD = 512 * 1024;

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
  ['native_renderer_upload_source_gpu_shared_texture', 'shared texture media transport is not implemented yet'],
  ['native_renderer_prefetch_media', 'native media prefetch/decode is not implemented yet'],
  ['native_renderer_clear_prefetch_cache', 'native media prefetch cache is not implemented yet'],
  ['native_renderer_clear_decode_preview_cache', 'native decode preview cache is not implemented yet'],
  ['native_renderer_clear_runtime_caches', 'native runtime cache clearing is not implemented yet'],
  ['native_renderer_set_vram_budget', 'native VRAM budget enforcement is not implemented yet'],
  ['native_renderer_set_command_drain_policy', 'native command-drain policy is not implemented yet'],
  ['native_renderer_set_auto_present_policy', 'native auto-present policy is not implemented yet'],
  ['native_renderer_set_decode_cpu_backup_policy', 'native decode CPU backup is not implemented yet'],
  ['native_renderer_set_decode_synthetic_fallback_policy', 'native decode fallback policy is not implemented yet'],
  ['native_renderer_set_media_prefetch_policy', 'native media prefetch policy is not implemented yet'],
  ['native_renderer_set_media_drop_policy', 'native media drop policy is not implemented yet'],
  ['native_renderer_set_decode_preview_policy', 'native decode preview policy is not implemented yet'],
  ['native_renderer_set_decode_target_policy', 'native decode target policy is not implemented yet'],
  ['native_renderer_set_decode_upload_policy', 'native decode upload policy is not implemented yet'],
  ['native_renderer_set_decode_handoff_policy', 'native decode handoff policy is not implemented yet'],
  ['native_renderer_set_decode_estimate_cache_policy', 'native decode estimate cache is not implemented yet'],
  ['native_renderer_export_snapshot_json', 'native snapshot export is not implemented yet'],
  ['native_renderer_set_decode_policy', 'legacy decode policy API is not implemented by this core'],
  ['native_renderer_set_prefetch_policy', 'legacy prefetch policy API is not implemented by this core'],
  ['native_renderer_get_decode_capabilities', 'native decode capabilities are not implemented yet'],
  ['native_renderer_set_output_window', 'legacy output window API is not implemented by this core'],
]);

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
}) {
  return new NativeRendererBroker({
    appRoot,
    resourcesPath,
    isPackaged,
    platform,
    env,
    textureShareStatusProvider,
  });
}

class NativeRendererBroker {
  constructor({ appRoot, resourcesPath, isPackaged, platform, env, textureShareStatusProvider }) {
    this.appRoot = appRoot;
    this.resourcesPath = resourcesPath;
    this.isPackaged = isPackaged;
    this.platform = platform;
    this.env = env;
    this.textureShareStatusProvider =
      typeof textureShareStatusProvider === 'function' ? textureShareStatusProvider : null;
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
    this.capabilities = makeDefaultCapabilities({
      backend: this.lastStatus.backend,
      running: false,
    });
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
      if (command === 'native_renderer_get_capabilities') return this.capabilities;
      if (command === 'native_renderer_get_readiness_report') return this.readinessReport();
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
      case 'native_renderer_get_capabilities':
        return this.getCapabilities();
      case 'native_renderer_get_readiness_report':
        return this.readinessReport();
      case 'native_renderer_reset_stats':
        this.stats = makeDefaultStats();
        return this.sendIfRunning('reset_stats', args, { fallback: null });
      case 'native_renderer_submit_batch':
        return this.sendNativeCommandPayloadIfRunning('submit_batch', args, { fallback: null, timeoutMs: 2500 });
      case 'native_renderer_submit_commands':
        return this.sendNativeCommandPayloadIfRunning('submit_commands', args, { fallback: null, timeoutMs: 2500 });
      case 'native_renderer_run_compute_graph':
        return this.sendIfRunning('compute_graph', args, { fallback: null, timeoutMs: 10000 });
      case 'native_renderer_set_target_fps':
        return this.sendIfRunning('set_target_fps', args, { fallback: null });
      case 'native_renderer_set_present_policy':
        return this.sendIfRunning('set_present_policy', args, { fallback: null });
      case 'native_renderer_attach_output_window':
        return this.sendIfRunning('attach_output_window', args, { fallback: null });
      case 'native_renderer_detach_output_window':
        return this.sendIfRunning('detach_output_window', args, { fallback: null });
      default:
        if (BROKER_UNSUPPORTED_COMMANDS.has(command)) {
          return Promise.reject(this.unsupportedError(command));
        }
        return this.sendIfRunning(commandToMethod(command), args, { fallback: null });
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
    await this.refreshCapabilities();
    return this.lastStatus;
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

  async refreshCapabilities() {
    const fallback = this.capabilities;
    const result = await this.sendIfRunning('capabilities', {}, { fallback, timeoutMs: 1000 });
    this.capabilities = normalizeCapabilities(result, fallback);
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

  readinessReport() {
    const binary = this.findExecutable();
    const blockers = [];
    if (!binary) blockers.push('native render-core binary is missing');
    if (!this.lastStatus.backend_ready) blockers.push(this.lastStatus.last_frame_error || 'native render-core is not ready');
    const features = this.capabilities?.features || {};
    const textureShare = this.textureShareStatus();
    const textureShareName = textureShare?.label || textureShare?.platform || 'Texture share';
    const textureShareDetail = textureShare
      ? [
          `${textureShareName} ${textureShare.available ? 'available' : 'unavailable'}`,
          textureShare.senderMode ? `mode=${textureShare.senderMode}` : null,
          textureShare.error ? `error=${textureShare.error}` : null,
        ].filter(Boolean).join(' ')
      : 'not connected to Electron texture-share status';
    const unsupported = [
      ['shared-texture-upload', 'Shared texture media transport', !!features.shared_texture_upload],
      ['native-media-decode', 'Native media decode/prefetch', !!features.native_media_decode && !!features.media_prefetch],
      ['compute-graph-host', 'Native buffer compute graph host', !!features.compute_graph_host],
      ['compute-instrument-host', 'Native compute/multi-pass instrument host', !!features.compute_shader_host && !!features.multi_pass_instruments],
      ['managed-output', 'Managed native output window', !!features.managed_output_attach],
      ['native-recording', 'Native recording', !!features.native_recording],
    ];
    return {
      timestamp_ms: Date.now(),
      overall_ready: blockers.length === 0,
      blockers,
      capabilities: this.capabilities,
      texture_share: textureShare,
      checks: [
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
        ...unsupported.map(([id, label, ok]) => ({
          id,
          label,
          ok,
          detail: ok ? 'implemented' : 'not implemented in the current native render core',
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

  unsupportedError(command) {
    const reason = BROKER_UNSUPPORTED_COMMANDS.get(command) || 'not implemented by this native render core';
    return new Error(`Unsupported native renderer command ${command}: ${reason}`);
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
      console.warn('[NativeRenderer] source-frame file handoff failed; falling back to JSON payload', err);
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

  prepareNativeCommand(command) {
    if (!command || command.type !== 'upload_source_frame') return command;
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
    if (!this.tempFrameDir) {
      this.tempFrameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-render-core-frames-'));
    }
    const name = `frame-${process.pid}-${Date.now()}-${this.tempFrameSerial++}.rgba`;
    const filePath = path.join(this.tempFrameDir, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
  }

  ensureProcess(executable) {
    if (this.child && !this.child.killed) return;
    console.log(`[NativeRenderer] launching ${executable}`);
    this.child = spawn(executable, [], {
      cwd: this.appRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...this.env, RUST_BACKTRACE: this.env.RUST_BACKTRACE || '1' },
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
    implemented_methods: Array.isArray(source.implemented_methods)
      ? source.implemented_methods.map(String)
      : previous.implemented_methods ?? [],
    implemented_command_types: Array.isArray(source.implemented_command_types)
      ? source.implemented_command_types.map(String)
      : previous.implemented_command_types ?? [],
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
    source_frame_uploads: Number(status.source_frame_uploads ?? previous.source_frame_uploads ?? 0),
    source_frame_bytes_uploaded: Number(status.source_frame_bytes_uploaded ?? previous.source_frame_bytes_uploaded ?? 0),
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
    target_fps: Number(status.target_fps ?? previous.target_fps ?? 60),
    present_mode: status.present_mode || previous.present_mode || 'vsync',
    surface_present_mode: status.surface_present_mode || previous.surface_present_mode || 'unconfigured',
    allow_tearing: !!(status.allow_tearing ?? previous.allow_tearing ?? false),
    max_frame_latency: Number(status.max_frame_latency ?? previous.max_frame_latency ?? 2),
    use_waitable_object: !!(status.use_waitable_object ?? previous.use_waitable_object ?? false),
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
    commands_applied: Number(stats.commands_applied ?? previous.commands_applied ?? 0),
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
    avg_render_cpu_ms: Number(stats.avg_render_cpu_ms ?? previous.avg_render_cpu_ms ?? 0),
    gpu_timing_supported: !!(stats.gpu_timing_supported ?? previous.gpu_timing_supported ?? false),
    last_render_gpu_ms: Number(stats.last_render_gpu_ms ?? previous.last_render_gpu_ms ?? 0),
    avg_render_gpu_ms: Number(stats.avg_render_gpu_ms ?? previous.avg_render_gpu_ms ?? 0),
    max_render_gpu_ms: Number(stats.max_render_gpu_ms ?? previous.max_render_gpu_ms ?? 0),
    gpu_timing_samples: Number(stats.gpu_timing_samples ?? previous.gpu_timing_samples ?? 0),
    gpu_timing_resolve_misses: Number(
      stats.gpu_timing_resolve_misses ?? previous.gpu_timing_resolve_misses ?? 0,
    ),
  };
}

function makeDefaultCapabilities(overrides = {}) {
  return {
    schema_version: 1,
    core_version: null,
    backend: overrides.backend ?? null,
    implemented_methods: [],
    implemented_command_types: [],
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
      render_clock: false,
      frame_snapshot: false,
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
      compute_shader_host: false,
      compute_graph_host: false,
      compute_graph_render: false,
      compute_graph_source_frame_target: false,
      persistent_compute_buffers: false,
      multi_pass_instruments: false,
      storage_buffer_instruments: false,
      shared_texture_upload: false,
      native_media_decode: false,
      media_prefetch: false,
      present_policy: false,
      managed_output_attach: false,
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
    source_frame_uploads: 0,
    source_frame_bytes_uploaded: 0,
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
    media_drop_command_pressure_pct: 90,
    media_drop_decode_pressure_pct: 90,
    media_drop_io_pressure_pct: 90,
    media_drop_decode_priority_cutoff: 180,
    media_drop_io_priority_cutoff: 128,
    output_width: outputWidth,
    output_height: outputHeight,
    output_refresh_hz: 60,
    output_window_attached: true,
    output_swapchain_ready: !!overrides.backend_ready,
    output_tearing_active: false,
    output_waitable_object_active: false,
    output_present_healthy: true,
    output_present_consecutive_failures: 0,
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
