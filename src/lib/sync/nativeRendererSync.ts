import { get } from 'svelte/store';
import type { Layer } from '$lib/types';
import { project } from '$lib/stores/layers';
import {
  attachNativeRendererOutputWindow,
  clearNativeRendererDecodePreviewCache,
  clearNativeRendererRuntimeCaches,
  detachNativeRendererOutputWindow,
  getNativeRendererStatus,
  prefetchNativeRendererMedia,
  resetNativeRendererStats,
  setNativeRendererDecodeCpuBackupPolicy,
  setNativeRendererDecodeSyntheticFallbackPolicy,
  setNativeRendererDecodePreviewPolicy,
  setNativeRendererDecodeTargetPolicy,
  setNativeRendererDecodeUploadPolicy,
  setNativeRendererDecodeHandoffPolicy,
  setNativeRendererDecodeEstimateCachePolicy,
  setNativeRendererAutoPresentPolicy,
  setNativeRendererCommandDrainPolicy,
  setNativeRendererMediaDropPolicy,
  setNativeRendererMediaPrefetchPolicy,
  setNativeRendererPresentPolicy,
  setNativeRendererShaderPrecompilePolicy,
  setNativeRendererTargetFps,
  setNativeRendererTexturePoolCap,
  startNativeRenderer,
  stopNativeRenderer,
  submitNativeRendererBatch,
  type RendererStatus,
  type CommandBatch,
  type RendererCommand,
  type PresentPolicyConfig,
} from '$lib/api/native-renderer';

type LayerSnapshot = {
  id: string;
  z: number;
  visible: boolean;
  blend: string;
  opacity: number;
  sourceSig: string;
  effectsSig: string;
  colorSig: string;
};

export type PresentPolicyProfile = 'vsync-live' | 'low-latency-safe' | 'low-latency-aggressive';

function canonicalBlendMode(mode: string): string {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'plus' || m === 'linear_dodge' || m === 'linear-dodge' || m === 'lineardodge') return 'add';
  if (m === 'minus' || m === 'linear_burn' || m === 'linear-burn' || m === 'linearburn') return 'subtract';
  if (m === 'hard_light' || m === 'hard-light') return 'hardlight';
  if (m === 'soft_light' || m === 'soft-light') return 'softlight';
  if (m === 'pin_light' || m === 'pin-light') return 'pin-light';
  if (m === 'vivid_light' || m === 'vivid-light') return 'vivid-light';
  if (m === 'linearlight' || m === 'linear_light') return 'linear-light';
  if (m === 'hardmix' || m === 'hard_mix') return 'hard-mix';
  if (m === 'avg') return 'average';
  if (m === 'color_dodge' || m === 'colordodge' || m === 'dodge') return 'color-dodge';
  if (m === 'color_burn' || m === 'colorburn' || m === 'burn') return 'color-burn';
  if (m === 'luma') return 'luminosity';
  return m || 'normal';
}

function hashString(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function sourceSignature(layer: Layer): string {
  const s = layer.source;
  if (!s) return 'none';
  return `${s.type}:${s.id}:${s.src}:${s.name}:${s.shaderCode ? hashString(s.shaderCode) : 'no-shader'}`;
}

function nativeEffectDescriptors(layer: Layer): string[] {
  const effects = layer.effects || [];
  if (!effects.length) return [];
  return effects
    .filter((e: any) => e && e.enabled !== false)
    .map((e: any) => effectToNativeDescriptor(e))
    .filter((d: string | null): d is string => !!d);
}

function normalizeSignedUnitToMultiplier(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= -1 && value <= 1) return Math.max(0.001, 1 + value);
  return Math.max(0.001, value);
}

function normalizeNonNegative(value: unknown, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0.001, value);
}

function normalizeHueCycle(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= -1 && value <= 1) return value;
  return value / 360;
}

function effectToNativeDescriptor(effect: any): string | null {
  if (!effect || effect.enabled === false) return null;
  const type = String(effect.type || '').toLowerCase();
  const params = effect.params || {};
  if (!type) return null;

  if (type === 'invert') return 'invert';
  if (type === 'grayscale' || type === 'greyscale') return 'grayscale';
  if (type === 'brightness') {
    const p = normalizeSignedUnitToMultiplier(params.brightnessAmount)
      ?? normalizeSignedUnitToMultiplier(params.amount)
      ?? normalizeNonNegative(params.brightness, 1);
    return `brightness:${p.toFixed(4)}`;
  }
  if (type === 'contrast') {
    const p = normalizeSignedUnitToMultiplier(params.contrastAmount)
      ?? normalizeSignedUnitToMultiplier(params.amount)
      ?? normalizeNonNegative(params.contrast, 1);
    return `contrast:${p.toFixed(4)}`;
  }
  if (type === 'gamma') {
    const p = normalizeNonNegative(params.gamma ?? params.amount, 1);
    return `gamma:${p.toFixed(4)}`;
  }
  if (type === 'saturation') {
    const p = normalizeSignedUnitToMultiplier(params.saturationAmount)
      ?? normalizeSignedUnitToMultiplier(params.amount)
      ?? normalizeNonNegative(params.saturation, 1);
    return `saturation:${p.toFixed(4)}`;
  }
  if (type === 'hue') {
    const cycle = normalizeHueCycle(params.hueShift)
      ?? normalizeHueCycle(params.shift)
      ?? normalizeHueCycle(params.amount)
      ?? 0;
    return `hue:${cycle.toFixed(4)}`;
  }
  if (type === 'posterize') {
    const levelsRaw =
      (typeof params.posterizeLevels === 'number' && Number.isFinite(params.posterizeLevels) ? params.posterizeLevels : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 8;
    const levels = Math.max(2, Math.min(64, Math.round(levelsRaw)));
    return `posterize:${levels.toFixed(0)}`;
  }
  if (type === 'noise') {
    const amountRaw =
      (typeof params.noiseAmount === 'number' && Number.isFinite(params.noiseAmount) ? params.noiseAmount : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 0.25;
    const amount = Math.max(0, Math.min(1, amountRaw));
    return `noise:${amount.toFixed(4)}`;
  }

  // Keep explicit descriptor IDs compatible with native descriptor parser.
  const effectId = typeof effect.id === 'string' ? effect.id.trim() : '';
  if (effectId.includes(':')) return effectId.toLowerCase();
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s / 100));
  const ll = Math.max(0, Math.min(1, l / 100));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c; g = x; b = 0;
  } else if (hh < 120) {
    r = x; g = c; b = 0;
  } else if (hh < 180) {
    r = 0; g = c; b = x;
  } else if (hh < 240) {
    r = 0; g = x; b = c;
  } else if (hh < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  return [r + m, g + m, b + m];
}

function layerRgba(layer: Layer): [number, number, number, number] | null {
  if (layer.type !== 'color' || !layer.colorContent) return null;
  const c = layer.colorContent;
  const [r, g, b] = hslToRgb(c.hue, c.saturation, c.lightness);
  const a = Math.max(0, Math.min(1, c.alpha));
  return [r, g, b, a];
}

function colorSignature(layer: Layer): string {
  const rgba = layerRgba(layer);
  if (!rgba) return 'none';
  return `${rgba[0].toFixed(4)}:${rgba[1].toFixed(4)}:${rgba[2].toFixed(4)}:${rgba[3].toFixed(4)}`;
}

function toSourceType(layer: Layer): string {
  const src = layer.source;
  if (!src) return 'none';
  if (isSharedTextureUri(src.src)) return 'video';
  const t = src.type || '';
  if (!t) return 'none';
  return t;
}

function isSharedTextureUri(uri: string | undefined | null): boolean {
  if (!uri) return false;
  const u = String(uri).trim().toLowerCase();
  return u.startsWith('sharedtex:') || u.startsWith('sharedtex://');
}

export class NativeRendererSync {
  private running = false;
  private frameId = 0;
  private pendingSync = false;
  private desiredWidth = 0;
  private desiredHeight = 0;
  private latestLayers: Layer[] = [];
  // RAF id for the shader uniform-animation loop. Previously a setInterval
  // which kept firing even when the page was hidden or minimised — RAF
  // auto-pauses on tab visibility and lines up with the compositor so uniform
  // uploads aren't done just to be thrown away.
  private shaderAnimationRaf: number | null = null;
  private sentWidth = 0;
  private sentHeight = 0;
  private lastLayers = new Map<string, LayerSnapshot>();
  private precompiledShaders = new Set<string>();
  private prefetchedSources = new Set<string>();
  private videoRefreshAt = new Map<string, number>();
  private presentProfile: PresentPolicyProfile = 'low-latency-safe';
  private targetFps = 60;
  private commandDrainLimit = 1024;
  private autoPresentOnStateChange = true;
  private decodeStoreCpuBackupFrames = false;
  private decodeAllowSyntheticFallback = false;
  private texturePoolCapMb = 512;
  private shaderPrecompileQueueCap = 4096;
  private shaderPrecompilePerFrame = 4;
  private mediaHighBurstLimit = 7;
  private prefetchCacheMaxEntries = 4096;
  private prefetchCachePruneCount = 256;
  private decodePreviewSize = 96;
  private decodePreviewCacheMb = 128;
  private decodeUseOutputResolution = true;
  private decodeUploadQueueCapMb = 256;
  private decodeHandoffByteCapMb = 128;
  private decodeHandoffPredecodeShedPct = 90;
  private decodePredecodeEstimateCacheCapEntries = 8192;
  private mediaDropCommandPressurePct = 90;
  private mediaDropDecodePressurePct = 90;
  private mediaDropIoPressurePct = 90;
  private mediaDropDecodePriorityCutoff = 180;
  private mediaDropIoPriorityCutoff = 128;
  private adaptiveOverloadPrefetchState: boolean | null = null;
  private adaptiveOverloadHandoffState: boolean | null = null;
  private adaptiveOverloadEstimateCacheState: boolean | null = null;
  private nextStatusPollAt = 0;
  private degradedModeActive = false;
  private decodeBackpressureActive = false;
  private decodeHandoffBackpressureActive = false;
  private decodeHandoffUtilizationPct = 0;
  private decodePendingUploadBackpressureActive = false;
  private decodePendingUploadUtilizationPct = 0;
  private decodeFramePoolBackpressureActive = false;
  private decodeFramePoolUtilizationPct = 0;
  private decodeEstimateCacheBackpressureActive = false;
  private commandBackpressureActive = false;
  private decodeGpuBridgePath: string | undefined =
    (import.meta as any)?.env?.VITE_DECODE_GPU_BRIDGE_PATH || undefined;

  private assertD3D11Ready(status: RendererStatus | null) {
    if (!status) {
      throw new Error('Native renderer status unavailable after startup');
    }
    if (status.backend !== 'd3d11') {
      throw new Error(`Native renderer backend is '${status.backend}', expected 'd3d11'`);
    }
    if (!status.backend_ready) {
      throw new Error('Native D3D11 backend reported not ready');
    }
  }

  private sourceCacheKey(sourceId: string, uri: string): string {
    return `${sourceId}::${uri}`;
  }

  async start(width: number, height: number) {
    if (this.running) return;
    await startNativeRenderer({
      backend: 'd3d11',
      decode_backend: 'ffmpeg_d3d11va',
      width,
      height,
      target_fps: 60,
      present_mode: 'immediate',
      allow_tearing: false,
      max_frame_latency: 2,
      use_waitable_object: true,
      shader_metadata_cache_cap: 16384,
      pipeline_metadata_cache_cap: 16384,
      vram_budget_mb: 4096,
      decode_upload_queue_cap_mb: this.decodeUploadQueueCapMb,
      decode_handoff_byte_cap_mb: this.decodeHandoffByteCapMb,
      decode_handoff_predecode_shed_pct: this.decodeHandoffPredecodeShedPct,
      decode_predecode_estimate_cache_cap_entries:
        this.decodePredecodeEstimateCacheCapEntries,
      decode_use_output_resolution: this.decodeUseOutputResolution,
      decode_gpu_bridge_path: this.decodeGpuBridgePath,
    });
    const startupStatus = await getNativeRendererStatus().catch(() => null);
    this.assertD3D11Ready(startupStatus);
    console.log(
      `[NativeRendererSync] GPU pipeline active: backend=${startupStatus?.backend}, adapter=${startupStatus?.adapter_name ?? 'unknown'}`
    );
    this.running = true;
    await resetNativeRendererStats().catch(() => {});
    // Prefer dedicated output window if present; fallback to main window.
    await attachNativeRendererOutputWindow('output')
      .catch(() => attachNativeRendererOutputWindow('main'))
      .catch(() => {});
    await this.applyPresentPolicyProfile(this.presentProfile).catch(() => {});
    await this.setTargetFps(this.targetFps).catch(() => {});
    await this.setCommandDrainPolicy(this.commandDrainLimit).catch(() => {});
    await this.setAutoPresentPolicy(this.autoPresentOnStateChange).catch(() => {});
    await this.setDecodeCpuBackupPolicy(this.decodeStoreCpuBackupFrames).catch(() => {});
    await this.setDecodeSyntheticFallbackPolicy(this.decodeAllowSyntheticFallback).catch(() => {});
    await this.setTexturePoolCapMb(this.texturePoolCapMb).catch(() => {});
    await this.setShaderPrecompilePolicy(
      this.shaderPrecompileQueueCap,
      this.shaderPrecompilePerFrame,
    ).catch(() => {});
    await this.setMediaPrefetchPolicy(
      this.mediaHighBurstLimit,
      this.prefetchCacheMaxEntries,
      this.prefetchCachePruneCount,
    ).catch(() => {});
    await this.setDecodePreviewPolicy(
      this.decodePreviewSize,
      this.decodePreviewCacheMb,
    ).catch(() => {});
    await this.setDecodeTargetPolicy(this.decodeUseOutputResolution).catch(() => {});
    await this.setDecodeUploadPolicy(this.decodeUploadQueueCapMb).catch(() => {});
    await this.setDecodeHandoffPolicy(
      this.decodeHandoffByteCapMb,
      this.decodeHandoffPredecodeShedPct,
    ).catch(() => {});
    await this.setDecodeEstimateCachePolicy(
      this.decodePredecodeEstimateCacheCapEntries,
    ).catch(() => {});
    await this.setMediaDropPolicy(
      this.mediaDropCommandPressurePct,
      this.mediaDropDecodePressurePct,
      this.mediaDropIoPressurePct,
      this.mediaDropDecodePriorityCutoff,
      this.mediaDropIoPriorityCutoff,
    ).catch(() => {});
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.sentWidth = 0;
    this.sentHeight = 0;
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this.stopShaderAnimation();
    this.lastLayers.clear();
    this.latestLayers = [];
    this.precompiledShaders.clear();
    this.prefetchedSources.clear();
    this.videoRefreshAt.clear();
    await clearNativeRendererDecodePreviewCache().catch(() => {});
    await this.clearRuntimeCaches({
      clear_precompiled_shaders: false,
      clear_texture_pool: false,
      clear_metadata_caches: false,
      clear_prefetch_cache: true,
    }).catch(() => {});
    await detachNativeRendererOutputWindow().catch(() => {});
    await stopNativeRenderer().catch(() => {});
  }

  scheduleSync(width: number, height: number, layers: Layer[]) {
    if (!this.running) return;
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.latestLayers = layers;

    // Start continuous animation loop if any shader layers exist
    const hasShaderLayers = layers.some(
      (l) => l.visible && l.source?.type === 'shader' && l.source?.shaderCode
    );
    if (hasShaderLayers && this.shaderAnimationRaf === null) {
      const loop = () => {
        if (!this.running) {
          this.stopShaderAnimation();
          return;
        }
        void this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
        this.shaderAnimationRaf = requestAnimationFrame(loop);
      };
      this.shaderAnimationRaf = requestAnimationFrame(loop);
    } else if (!hasShaderLayers && this.shaderAnimationRaf !== null) {
      this.stopShaderAnimation();
    }

    if (this.pendingSync) return;
    this.pendingSync = true;
    setTimeout(() => {
      this.pendingSync = false;
      void this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
    }, 16);
  }

  private stopShaderAnimation() {
    if (this.shaderAnimationRaf !== null) {
      cancelAnimationFrame(this.shaderAnimationRaf);
      this.shaderAnimationRaf = null;
    }
  }

  async flush(width: number, height: number, layers: Layer[]) {
    if (!this.running) return;

    const commands: RendererCommand[] = [];
    const current = new Map<string, LayerSnapshot>();
    const activeVideoKeys = new Set<string>();

    if (width !== this.sentWidth || height !== this.sentHeight) {
      commands.push({
        type: 'set_output',
        width,
        height,
        refresh_hz: 60,
      });
      this.sentWidth = width;
      this.sentHeight = height;
    }

    const now = Date.now();
    if (now >= this.nextStatusPollAt) {
      this.nextStatusPollAt = now + 500;
      const status = await getNativeRendererStatus().catch(() => null);
      if (status) {
        this.degradedModeActive = !!status.degraded_mode_active;
        this.decodeBackpressureActive = !!status.decode_backpressure_active;
        this.decodeHandoffBackpressureActive = !!status.decode_handoff_backpressure_active;
        this.decodeHandoffUtilizationPct = Math.max(
          0,
          Math.min(100, Math.round(status.decode_handoff_utilization_pct ?? 0)),
        );
        this.decodePendingUploadBackpressureActive =
          !!status.decode_pending_upload_backpressure_active;
        this.decodePendingUploadUtilizationPct = Math.max(
          0,
          Math.min(100, Math.round(status.decode_pending_upload_utilization_pct ?? 0)),
        );
        this.decodeFramePoolBackpressureActive =
          !!status.decode_frame_pool_backpressure_active;
        this.decodeFramePoolUtilizationPct = Math.max(
          0,
          Math.min(100, Math.round(status.decode_frame_pool_utilization_pct ?? 0)),
        );
        this.decodeEstimateCacheBackpressureActive =
          !!status.decode_predecode_estimate_cache_backpressure_active;
        this.commandBackpressureActive = !!status.command_backpressure_active;
      }
    }
    const overloadActive =
      this.degradedModeActive ||
      this.decodeBackpressureActive ||
      this.decodeHandoffBackpressureActive ||
      this.decodeHandoffUtilizationPct >= 85 ||
      this.decodePendingUploadBackpressureActive ||
      this.decodePendingUploadUtilizationPct >= 85 ||
      this.decodeFramePoolBackpressureActive ||
      this.decodeFramePoolUtilizationPct >= 85 ||
      this.decodeEstimateCacheBackpressureActive ||
      this.commandBackpressureActive;
    if (this.adaptiveOverloadPrefetchState !== overloadActive) {
      this.adaptiveOverloadPrefetchState = overloadActive;
      const overloadBurst = Math.max(1, Math.floor(this.mediaHighBurstLimit / 2));
      const overloadPrune = Math.min(
        16384,
        Math.max(this.prefetchCachePruneCount, Math.floor(this.prefetchCacheMaxEntries / 8)),
      );
      void setNativeRendererMediaPrefetchPolicy({
        media_high_burst_limit: overloadActive ? overloadBurst : this.mediaHighBurstLimit,
        prefetch_cache_max_entries: this.prefetchCacheMaxEntries,
        prefetch_cache_prune_count: overloadActive ? overloadPrune : this.prefetchCachePruneCount,
      }).catch(() => {});
    }
    if (this.adaptiveOverloadHandoffState !== overloadActive) {
      this.adaptiveOverloadHandoffState = overloadActive;
      const overloadShedPct = Math.max(50, Math.min(99, this.decodeHandoffPredecodeShedPct - 10));
      void this.setDecodeHandoffPolicy(
        this.decodeHandoffByteCapMb,
        overloadActive ? overloadShedPct : this.decodeHandoffPredecodeShedPct,
      ).catch(() => {});
    }
    if (this.adaptiveOverloadEstimateCacheState !== overloadActive) {
      this.adaptiveOverloadEstimateCacheState = overloadActive;
      const overloadEstimateCap = Math.max(
        256,
        Math.floor(this.decodePredecodeEstimateCacheCapEntries / 2),
      );
      void this.setDecodeEstimateCachePolicy(
        overloadActive ? overloadEstimateCap : this.decodePredecodeEstimateCacheCapEntries,
      ).catch(() => {});
    }
    const videoRefreshMs = overloadActive ? 160 : 80;
    const videoPrefetchPriority = overloadActive ? 140 : 180;
    const mediaPrefetchPriority = overloadActive ? 72 : 96;
    layers.forEach((layer, index) => {
      const sourceType = toSourceType(layer);
      const effectIds = nativeEffectDescriptors(layer);
      const effectsSig = effectIds.length ? effectIds.join('|') : 'none';
      const snap: LayerSnapshot = {
        id: layer.id,
        z: index,
        visible: layer.visible,
        blend: canonicalBlendMode(layer.blendMode),
        opacity: layer.opacity,
        sourceSig: sourceSignature(layer),
        effectsSig,
        colorSig: colorSignature(layer),
      };
      current.set(layer.id, snap);
      const prev = this.lastLayers.get(layer.id);

      if (!prev || prev.z !== snap.z || prev.visible !== snap.visible || prev.blend !== snap.blend || prev.opacity !== snap.opacity) {
        commands.push({
          type: 'upsert_layer',
          layer_id: layer.id,
          z_index: index,
          blend_mode: canonicalBlendMode(layer.blendMode),
          opacity: layer.opacity,
        });
        commands.push({
          type: 'set_layer_visibility',
          layer_id: layer.id,
          visible: layer.visible,
        });
      }

      if (!prev || prev.sourceSig !== snap.sourceSig) {
        const src = layer.source;
        if (src) {
          commands.push({
            type: 'bind_media_source',
            layer_id: layer.id,
            source_id: src.id,
            uri: src.src,
            source_type: sourceType,
          });
          const sourceKey = this.sourceCacheKey(src.id, src.src);
          const sharedTextureSource = isSharedTextureUri(src.src);
          if (!sharedTextureSource && !this.prefetchedSources.has(sourceKey)) {
            this.prefetchedSources.add(sourceKey);
            const priority = sourceType === 'video' ? videoPrefetchPriority : mediaPrefetchPriority;
            void prefetchNativeRendererMedia(src.id, src.src, priority).catch(() => {});
          }
          if (sourceType === 'video') {
            this.videoRefreshAt.set(sourceKey, now + videoRefreshMs);
          } else {
            this.videoRefreshAt.delete(sourceKey);
          }
          if (src.shaderCode) {
            const shaderId = `${src.id}:${hashString(src.shaderCode)}`;
            if (!this.precompiledShaders.has(shaderId)) {
              this.precompiledShaders.add(shaderId);
              commands.push({
                type: 'precompile_shader',
                shader_id: shaderId,
                stage: 'pixel',
                source: src.shaderCode,
                entry: 'main',
              });
            }
            // Bind ISF shader to layer (sent when source changes)
            commands.push({
              type: 'bind_isf_shader',
              layer_id: layer.id,
              shader_id: shaderId,
            });
          }
        } else {
          commands.push({
            type: 'bind_media_source',
            layer_id: layer.id,
            source_id: `none:${layer.id}`,
            uri: '',
            source_type: 'none',
          });
        }
      }

      const src = layer.source;
      if (src && sourceType === 'video') {
        const sourceKey = this.sourceCacheKey(src.id, src.src);
        activeVideoKeys.add(sourceKey);
        const dueAt = this.videoRefreshAt.get(sourceKey) ?? 0;
        const sharedTextureSource = isSharedTextureUri(src.src);
        if (!sharedTextureSource && now >= dueAt) {
          this.videoRefreshAt.set(sourceKey, now + videoRefreshMs);
          void prefetchNativeRendererMedia(src.id, src.src, videoPrefetchPriority).catch(() => {});
        }
      }

      if (!prev || prev.colorSig !== snap.colorSig) {
        const rgba = layerRgba(layer);
        if (rgba) {
          commands.push({
            type: 'set_layer_color',
            layer_id: layer.id,
            rgba,
          });
        }
      }

      if (!prev || prev.effectsSig !== snap.effectsSig) {
        commands.push({
          type: 'set_effect_chain',
          layer_id: layer.id,
          effect_ids: effectIds,
        });
      }

      // ── ISF shader: send uniforms + render every frame ──
      const src2 = layer.source;
      if (src2?.shaderCode && layer.visible) {
        const shaderId = `${src2.id}:${hashString(src2.shaderCode)}`;
        const nowDate = new Date();
        const secsSinceMidnight =
          nowDate.getHours() * 3600 + nowDate.getMinutes() * 60 + nowDate.getSeconds() + nowDate.getMilliseconds() / 1000;

        // Collect user shader input values
        const floatInputs: Record<string, number> = {};
        const pointInputs: Record<string, [number, number]> = {};
        const colorInputs: Record<string, [number, number, number, number]> = {};
        if (src2.shaderValues) {
          for (const [key, val] of Object.entries(src2.shaderValues)) {
            if (typeof val === 'number') {
              floatInputs[key] = val;
            } else if (typeof val === 'boolean') {
              floatInputs[key] = val ? 1.0 : 0.0;
            } else if (Array.isArray(val)) {
              if (val.length === 2) {
                pointInputs[key] = [val[0], val[1]];
              } else if (val.length >= 4) {
                colorInputs[key] = [val[0], val[1], val[2], val[3]];
              }
            }
          }
        }

        commands.push({
          type: 'update_isf_uniforms',
          shader_id: shaderId,
          time: now / 1000, // performance.now() → seconds
          time_delta: 1.0 / this.targetFps,
          frame_index: this.frameId,
          render_width: this.desiredWidth || 1920,
          render_height: this.desiredHeight || 1080,
          date: [nowDate.getFullYear(), nowDate.getMonth() + 1, nowDate.getDate(), secsSinceMidnight],
          audio_level: 0, // TODO: wire audio analyzer
          audio_bass: 0,
          audio_mid: 0,
          audio_high: 0,
          audio_beat: 0,
          audio_beat_phase: 0,
          audio_bpm: 0,
          audio_spectral_centroid: 0,
          float_inputs: floatInputs,
          point_inputs: pointInputs,
          color_inputs: colorInputs,
        });

        commands.push({
          type: 'render_isf_to_layer',
          layer_id: layer.id,
        });
      }
    });

    this.lastLayers.forEach((_snap, id) => {
      if (!current.has(id)) {
        commands.push({
          type: 'remove_layer',
          layer_id: id,
        });
      }
    });
    this.videoRefreshAt.forEach((_due, key) => {
      if (!activeVideoKeys.has(key)) this.videoRefreshAt.delete(key);
    });

    if (!commands.length) return;

    commands.push({ type: 'present' });

    const batch: CommandBatch = {
      frame_id: ++this.frameId,
      commands,
    };

    await submitNativeRendererBatch(batch);
    this.lastLayers = current;
  }

  async logStatus() {
    if (!this.running) return;
    const status = await getNativeRendererStatus().catch(() => null);
    if (status) {
      console.log('[NativeRendererSync] status', status);
    }
  }

  async applyPresentPolicyProfile(profile: PresentPolicyProfile = this.presentProfile) {
    if (!this.running) return;
    this.presentProfile = profile;
    const status = await getNativeRendererStatus().catch(() => null);
    if (!status) return;

    const supportsTearing = !!status.supports_tearing;
    const supportsWaitable = !!status.supports_waitable_object;

    let policy: PresentPolicyConfig;
    if (profile === 'vsync-live') {
      policy = {
        present_mode: 'vsync',
        allow_tearing: false,
        max_frame_latency: 2,
        use_waitable_object: false,
      };
    } else if (profile === 'low-latency-aggressive') {
      policy = {
        present_mode: 'immediate',
        allow_tearing: supportsTearing,
        max_frame_latency: 1,
        use_waitable_object: supportsWaitable,
      };
    } else {
      policy = {
        present_mode: 'immediate',
        allow_tearing: false,
        max_frame_latency: 2,
        use_waitable_object: supportsWaitable,
      };
    }

    await setNativeRendererPresentPolicy(policy).catch(() => {});
  }

  async setTargetFps(targetFps: number) {
    const clamped = Math.max(1, Math.min(480, Math.round(targetFps)));
    this.targetFps = clamped;
    if (!this.running) return;
    await setNativeRendererTargetFps({ target_fps: clamped }).catch(() => {});
  }

  async setCommandDrainPolicy(maxCommandsPerTick: number) {
    const clamped = Math.max(64, Math.min(16384, Math.round(maxCommandsPerTick)));
    this.commandDrainLimit = clamped;
    if (!this.running) return;
    await setNativeRendererCommandDrainPolicy({
      max_commands_per_tick: clamped,
    }).catch(() => {});
  }

  async setAutoPresentPolicy(autoPresentOnStateChange: boolean) {
    this.autoPresentOnStateChange = !!autoPresentOnStateChange;
    if (!this.running) return;
    await setNativeRendererAutoPresentPolicy({
      auto_present_on_state_change: this.autoPresentOnStateChange,
    }).catch(() => {});
  }

  async setDecodeCpuBackupPolicy(decodeStoreCpuBackupFrames: boolean) {
    this.decodeStoreCpuBackupFrames = !!decodeStoreCpuBackupFrames;
    if (!this.running) return;
    await setNativeRendererDecodeCpuBackupPolicy({
      decode_store_cpu_backup_frames: this.decodeStoreCpuBackupFrames,
    }).catch(() => {});
  }

  async setDecodeSyntheticFallbackPolicy(decodeAllowSyntheticFallback: boolean) {
    this.decodeAllowSyntheticFallback = !!decodeAllowSyntheticFallback;
    if (!this.running) return;
    await setNativeRendererDecodeSyntheticFallbackPolicy({
      decode_allow_synthetic_fallback: this.decodeAllowSyntheticFallback,
    }).catch(() => {});
  }

  async setTexturePoolCapMb(texturePoolCapMb: number) {
    const clamped = Math.max(64, Math.min(16384, Math.round(texturePoolCapMb)));
    this.texturePoolCapMb = clamped;
    if (!this.running) return;
    await setNativeRendererTexturePoolCap({ texture_pool_cap_mb: clamped }).catch(() => {});
  }

  async setShaderPrecompilePolicy(queueCap: number, perFrame: number) {
    const clampedQueueCap = Math.max(64, Math.min(65536, Math.round(queueCap)));
    const clampedPerFrame = Math.max(1, Math.min(128, Math.round(perFrame)));
    this.shaderPrecompileQueueCap = clampedQueueCap;
    this.shaderPrecompilePerFrame = clampedPerFrame;
    if (!this.running) return;
    await setNativeRendererShaderPrecompilePolicy({
      shader_precompile_queue_cap: clampedQueueCap,
      shader_precompile_per_frame: clampedPerFrame,
    }).catch(() => {});
  }

  async setMediaPrefetchPolicy(
    mediaHighBurstLimit: number,
    prefetchCacheMaxEntries: number,
    prefetchCachePruneCount: number,
  ) {
    const clampedBurst = Math.max(1, Math.min(255, Math.round(mediaHighBurstLimit)));
    const clampedMax = Math.max(256, Math.min(262144, Math.round(prefetchCacheMaxEntries)));
    const clampedPrune = Math.max(16, Math.min(16384, Math.round(prefetchCachePruneCount)));
    this.mediaHighBurstLimit = clampedBurst;
    this.prefetchCacheMaxEntries = clampedMax;
    this.prefetchCachePruneCount = clampedPrune;
    this.adaptiveOverloadPrefetchState = null;
    if (!this.running) return;
    await setNativeRendererMediaPrefetchPolicy({
      media_high_burst_limit: clampedBurst,
      prefetch_cache_max_entries: clampedMax,
      prefetch_cache_prune_count: clampedPrune,
    }).catch(() => {});
  }

  async setDecodePreviewPolicy(previewSize: number, previewCacheMb: number) {
    const clampedSize = Math.max(16, Math.min(4096, Math.round(previewSize)));
    const clampedCacheMb = Math.max(16, Math.min(1024, Math.round(previewCacheMb)));
    this.decodePreviewSize = clampedSize;
    this.decodePreviewCacheMb = clampedCacheMb;
    if (!this.running) return;
    await setNativeRendererDecodePreviewPolicy({
      decode_preview_size: clampedSize,
      decode_preview_cache_mb: clampedCacheMb,
    }).catch(() => {});
  }

  async setDecodeTargetPolicy(useOutputResolution: boolean) {
    this.decodeUseOutputResolution = !!useOutputResolution;
    if (!this.running) return;
    await setNativeRendererDecodeTargetPolicy({
      decode_use_output_resolution: this.decodeUseOutputResolution,
    }).catch(() => {});
  }

  async setDecodeUploadPolicy(decodeUploadQueueCapMb: number) {
    const clampedCapMb = Math.max(16, Math.min(1024, Math.round(decodeUploadQueueCapMb)));
    this.decodeUploadQueueCapMb = clampedCapMb;
    if (!this.running) return;
    await setNativeRendererDecodeUploadPolicy({
      decode_upload_queue_cap_mb: clampedCapMb,
    }).catch(() => {});
  }

  async setDecodeHandoffPolicy(
    decodeHandoffByteCapMb: number,
    decodeHandoffPredecodeShedPct: number,
  ) {
    const clampedCapMb = Math.max(16, Math.min(1024, Math.round(decodeHandoffByteCapMb)));
    const clampedShedPct = Math.max(50, Math.min(99, Math.round(decodeHandoffPredecodeShedPct)));
    this.decodeHandoffByteCapMb = clampedCapMb;
    this.decodeHandoffPredecodeShedPct = clampedShedPct;
    if (!this.running) return;
    await setNativeRendererDecodeHandoffPolicy({
      decode_handoff_byte_cap_mb: clampedCapMb,
      decode_handoff_predecode_shed_pct: clampedShedPct,
    }).catch(() => {});
  }

  async setDecodeEstimateCachePolicy(decodePredecodeEstimateCacheCapEntries: number) {
    const clampedCap = Math.max(
      256,
      Math.min(262144, Math.round(decodePredecodeEstimateCacheCapEntries)),
    );
    this.decodePredecodeEstimateCacheCapEntries = clampedCap;
    if (!this.running) return;
    await setNativeRendererDecodeEstimateCachePolicy({
      decode_predecode_estimate_cache_cap_entries: clampedCap,
    }).catch(() => {});
  }

  setDecodeGpuBridgePath(path?: string) {
    const next = (path || '').trim();
    this.decodeGpuBridgePath = next.length ? next : undefined;
  }

  async clearRuntimeCaches(config: {
    clear_precompiled_shaders: boolean;
    clear_texture_pool: boolean;
    clear_metadata_caches: boolean;
    clear_prefetch_cache: boolean;
  }) {
    await clearNativeRendererRuntimeCaches(config).catch(() => {});
  }

  async setMediaDropPolicy(
    commandPressurePct: number,
    decodeQueuePressurePct: number,
    ioQueuePressurePct: number,
    decodePriorityCutoff: number,
    ioPriorityCutoff: number,
  ) {
    const commandPct = Math.max(50, Math.min(99, Math.round(commandPressurePct)));
    const decodePct = Math.max(50, Math.min(99, Math.round(decodeQueuePressurePct)));
    const ioPct = Math.max(50, Math.min(99, Math.round(ioQueuePressurePct)));
    const decodeCutoff = Math.max(0, Math.min(255, Math.round(decodePriorityCutoff)));
    const ioCutoff = Math.max(0, Math.min(255, Math.round(ioPriorityCutoff)));
    this.mediaDropCommandPressurePct = commandPct;
    this.mediaDropDecodePressurePct = decodePct;
    this.mediaDropIoPressurePct = ioPct;
    this.mediaDropDecodePriorityCutoff = decodeCutoff;
    this.mediaDropIoPriorityCutoff = ioCutoff;
    if (!this.running) return;
    await setNativeRendererMediaDropPolicy({
      command_pressure_pct: commandPct,
      decode_queue_pressure_pct: decodePct,
      io_queue_pressure_pct: ioPct,
      decode_priority_cutoff: decodeCutoff,
      io_priority_cutoff: ioCutoff,
    }).catch(() => {});
  }
}

export function getProjectOutputSize() {
  const p = get(project) as any;
  return {
    width: p.width || 1920,
    height: p.height || 1080,
  };
}
