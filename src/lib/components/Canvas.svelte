<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { RenderEngine, loadImageTexture, createVideoTexture, getThreeJSIframeContext, createThreeJSIframeContext, getJSAnimationContext, createJSAnimationContext } from '../renderer/engine';
  import { project, layers } from '../stores/layers';
  import { mediaLibrary } from '../stores/media';
  import { vjOutputLayers, vjClipLauncher } from '../stores/vjClipLauncher';
  import { macros } from '../stores/macros';
  import { layerSequencer } from '../stores/layerSequencer';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import type { Layer } from '../types';
  import * as THREE from 'three';
  import { createISFShader, updateISFShader, setISFInputValue, setISFInputTexture, type ISFShaderInstance } from '../isf/renderer';
  import { LinesRenderer } from '../lines/renderer';
  import { DrawingRenderer } from '../drawing/renderer';
  import { SVGLayerRenderer } from '../svg/renderer';
  import { LightPaintingRenderer } from '../lightpainting/renderer';
  import { TextRenderer } from '../text/renderer';
  import { SplatRenderer } from '../splat/SplatRenderer';
  import { loadPLY, loadSplatFromUrl } from '../splat';
  import { Model3DRenderer } from '../model3d/Model3DRenderer';
  import { GpuLayerRenderer } from '$lib/renderer/gpuLayerRenderer';
  import { ensureWebGPUDevice, isWebGPUReady, getWebGPUDevice, getPreferredCanvasFormat } from '$lib/renderer/webgpuShared';
  import { getShaderDef } from '$lib/renderer/gpuShaderCatalog';
  import { settings, outputFrozen, SHADER_QUALITY_MULTIPLIERS } from '../stores/settings';
  import { showToast } from '../stores/errorToast';
  import { invoke, isDesktopApp, isOsrMode, isOutputMode } from '$lib/bridge';
  import { drawTestPattern, type TestPatternType } from '../utils/testPatterns';
  import { applyEdgeBlending } from '../output/outputPostProcess';
  import { FluidSimulation, type FluidMode } from '../effects/fluidSimulation';
  import { ParticleSystem3D } from '../effects/particleSystem3D';
  // ParticleSystem removed — Particles3D runs as standalone Bevy app via Spout
  import { audioStore, getLastRawAnalysis, audioBands } from '../stores/audio';
  import { audioTextures } from '../audio/audioTextures';
  import { initStateBroadcast, destroyStateBroadcast } from '$lib/sync/stateBroadcast';
  import { startOutputPixelBroadcast, stopOutputPixelBroadcast } from '$lib/sync/outputPixelBroadcast';
  import {
    registerEditorCanvas,
    stopOutputSharedTexturePresenter,
  } from '$lib/sync/outputSharedTexturePresenter';
  // Note: zero-copy presenter is NOT auto-started by the reconcile.
  // Unlike WebRTC (which broadcasts to anyone listening on the
  // BroadcastChannel), the zero-copy path requires a target Window
  // reference — established when OutputWindow.svelte calls
  // window.open() and then attachOutputWindow(target, canvas). The
  // reconcile here only handles the LEGACY WebRTC path; zero-copy
  // start is triggered by user action in OutputWindow.openPopup().
  // We DO call stop on teardown to be safe.
  import { NativeRendererSync, getProjectOutputSize } from '$lib/sync/nativeRendererSync';
  // hasWatermark removed — OSS build has no watermark.
  import { fpsStore } from '$lib/stores/fps';
  import type { OutputSlice } from '$lib/stores/settings';
  // S4 pilot. Imported as types/refs only at module load — the
  // actual `three/webgpu` chunk is fetched dynamically inside
  // WebGPUPilot.create(), so the WebGPU bundle stays out of the
  // main Canvas chunk for users who never enable the pilot.
  import type { WebGPUPilot } from '$lib/renderer/webgpuPilot';
  import { probeWebGPU, getWebGPUInfo, isWebGPUSupported, isPilotEffectivelyEnabled } from '$lib/renderer/webgpuCapability';
  import { webgpuPilotMetrics, resetWebgpuPilotMetrics } from '$lib/stores/webgpuPilotStore';

  // FPS tracking
  let fpsFrameCount = 0;
  let fpsLastTime = performance.now();
  let _fpsLogCount = 0; // throttles the [GPU] FPS log to every ~5s

  // Spout output state
  const isTauri = isDesktopApp || (typeof window !== 'undefined' && !!window.__ELECTRON__); // Backwards compat alias — works on both Tauri and Electron
  const isElectron = typeof window !== 'undefined' && !!(window as any).__ELECTRON__;
  let spoutOutputActive = false;
  let spoutSendInFlight = false; // prevent overlapping sends
  let spoutSendPixels: Uint8Array | null = null; // pre-allocated readPixels buffer
  let spoutSendW = 0;
  let spoutSendH = 0;
  let osrSpoutActive = false; // True when OSR zero-copy is handling Spout output
  let spoutFrameSkip = 0;     // Counter for frame skipping on CPU send path
  let spoutSendLogCount = 0; // Limit console spam from send errors
  const isTauriRuntime = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

  // Multi-output slice state
  let sliceSendInFlight = new Set<string>(); // Track in-flight per-slice sends
  let sliceCanvas: HTMLCanvasElement | null = null; // Reusable 2D canvas for crop extraction
  let sliceCtx: CanvasRenderingContext2D | null = null;
  let sliceBlendCanvas: HTMLCanvasElement | null = null; // For per-slice edge blending
  let sliceBlendCtx: CanvasRenderingContext2D | null = null;
  // Full-frame ImageData cache (reused each frame to avoid re-creating from readPixels buffer)
  let fullFrameCanvas: HTMLCanvasElement | null = null;
  let fullFrameCtx: CanvasRenderingContext2D | null = null;
  // Spout send: offscreen 2D canvas for downscaling WebGL → Spout resolution
  let spoutScaleCanvas: HTMLCanvasElement | null = null;
  let spoutScaleCtx: CanvasRenderingContext2D | null = null;
  let spoutTargetW = 0;
  let spoutTargetH = 0;
  let nativeRendererSync: NativeRendererSync | null = null;
  let nativeRendererStatusTimer: ReturnType<typeof setInterval> | null = null;
  let nativeLayersUnsub: (() => void) | null = null;
  let nativeProjectUnsub: (() => void) | null = null;

  // Spout receive state for plugin layers — uses WebSocket binary push for zero-copy frames
  interface SpoutReceiverContext {
    senderName: string;
    texture: THREE.DataTexture;
    frameWs: WebSocket | null;     // Dedicated WS for binary frame push
    width: number;
    height: number;
  }
  const spoutReceivers = new Map<string, SpoutReceiverContext>();

  let canvas: HTMLCanvasElement;
  let engine: RenderEngine | null = null;
  let animationId: number;
  let containerEl: HTMLDivElement;
  let wrapperEl: HTMLDivElement;
  let outputOverlayCanvas: HTMLCanvasElement;

  // S4 pilot state. The pilot, if active, owns its own canvas and
  // WebGPURenderer instance — see webgpuPilot.ts. We track:
  //   - the live pilot ref (null when disabled / unsupported / failed)
  //   - a WebGL2 texture used as the handoff target for measuring
  //     gl.texImage2D(canvas, ...) cost. Allocated on first use, kept
  //     alive across frames so the per-frame cost is steady-state
  //     (no allocation bias)
  //   - ema-smoothed handoff timing
  // All pilot code paths are gated on `$settings.experimental.webgpuPilot`
  // AND `isWebGPUSupported()`. Either off → pilot stays null and the
  // animate loop skips the integration entirely.
  let webgpuPilot: WebGPUPilot | null = null;
  let webgpuPilotInitInFlight = false;
  let webgpuHandoffTexture: WebGLTexture | null = null;
  let webgpuHandoffMsEma = 0;
  /** Unsubscribe handle for the settings.experimental.webgpuPilot reactive
   *  subscription. Lifted to module scope so onDestroy can call it. */
  let webgpuPilotUnsub: (() => void) | null = null;
  /** Unsubscribe handle for the settings.experimental.outputWebRTC reactive
   *  subscription that drives startOutputPixelBroadcast / stop. */
  let outputWebRTCUnsub: (() => void) | null = null;

  // Output-window transforms are applied in the final WebGL pass. Keeping them
  // out of CSS avoids compositor resampling of the live projection canvas.

  // Redraw overlay when test pattern / edge blend settings change
  $: if (outputOverlayCanvas) {
    updateOutputOverlay(
      $settings.output.testPattern as TestPatternType,
      $settings.output.edgeBlendLeft,
      $settings.output.edgeBlendRight,
      $settings.output.edgeBlendTop,
      $settings.output.edgeBlendBottom,
      $settings.output.edgeBlendGamma,
    );
  }

  function updateOutputOverlay(
    testPattern: TestPatternType,
    blendL: number, blendR: number, blendT: number, blendB: number,
    blendGamma: number,
  ) {
    if (!outputOverlayCanvas) return;
    const w = outputOverlayCanvas.parentElement?.clientWidth || 1920;
    const h = outputOverlayCanvas.parentElement?.clientHeight || 1080;
    const ratio = isOutputMode ? (window.devicePixelRatio || 1) : 1;
    const backingW = Math.max(1, Math.round(w * ratio));
    const backingH = Math.max(1, Math.round(h * ratio));
    if (outputOverlayCanvas.width !== backingW) outputOverlayCanvas.width = backingW;
    if (outputOverlayCanvas.height !== backingH) outputOverlayCanvas.height = backingH;
    const ctx = outputOverlayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Draw test pattern if active
    if (testPattern && testPattern !== 'none') {
      drawTestPattern(ctx, w, h, testPattern);
    }

    // Draw edge blending overlay
    if (blendL > 0 || blendR > 0 || blendT > 0 || blendB > 0) {
      applyEdgeBlending(ctx, w, h, {
        edgeBlendLeft: blendL,
        edgeBlendRight: blendR,
        edgeBlendTop: blendT,
        edgeBlendBottom: blendB,
        edgeBlendGamma: blendGamma,
      });
    }
  }

  // Mouse tracking for splat layer interactions
  let mouseNormalizedX = 0;
  let mouseNormalizedY = 0;
  let mouseOnCanvas = false;
  // Raw screen-space UV (0..1): mouseRawU = 0 left, 1 right; mouseRawV = 0 top, 1 bottom
  let mouseRawU = 0.5;
  let mouseRawV = 0.5;

  // Track loaded textures (with LRU eviction)
  const textureCache = new Map<string, THREE.Texture>();
  const TEXTURE_CACHE_MAX = 64;
  // Expose for DevTools debugging:
  //   __textureCache.size                    — entry count
  //   [...__textureCache.keys()]             — keys, oldest first (LRU order)
  //   __textureCache.get(key)?.image?.src    — what backs each entry
  //   __VIDEO_DEBUG__ = true                 — turn on per-frame video state logging
  if (typeof window !== 'undefined') {
    (window as any).__textureCache = textureCache;
    (window as any).__loadingTextures = null; // assigned below
  }
  // Track textures being loaded to avoid duplicate async loads
  const loadingTextures = new Set<string>();
  if (typeof window !== 'undefined') (window as any).__loadingTextures = loadingTextures;
  // Track texture loads that hard-failed (missing video file, CORS error, bad
  // shader compile) so we don't retry them on every frame. Without this, a
  // single VJ clip pointing at a deleted file or expired blob URL floods the
  // console with 'Failed to load texture: Error: Video failed to load' at
  // render-loop rate — which in turn drags fps to its knees because each
  // rejected promise microtask contends with the animate() frame budget. Key
  // is the same cacheKey used for loadingTextures.
  const failedTextures = new Set<string>();
  const FAILED_TEXTURE_LOG_LIMIT = 3; // only log each bad key a few times
  const failedTextureLogCount = new Map<string, number>();

  /** Bump a textureCache entry to the most-recent position so true-LRU
   *  eviction won't drop it. Map iteration order is insertion order, so
   *  delete + re-set moves the entry to the end. Called on every cache
   *  hit + every fresh insert. */
  function touchTextureCacheEntry(key: string): void {
    const tex = textureCache.get(key);
    if (!tex) return;
    textureCache.delete(key);
    textureCache.set(key, tex);
  }

  /** Evict least-recently-used entries from textureCache, but NEVER
   *  evict a texture that's currently referenced by an active layer.
   *
   *  Pre-fix: simple FIFO eviction disposed the texture for the FIRST
   *  clip the user added once the cache hit 64 entries — but if that
   *  clip was still mapped on a layer ("left it playing for a bit"),
   *  its now-disposed VideoTexture stayed assigned and visually froze
   *  on whatever frame the GPU last sampled. Subsequent clip switches
   *  also returned disposed cached textures. That's the "all rest
   *  frozen when I launched them" symptom.
   *
   *  Pinned-set accounting: walks $layers + $vjOutputLayers and
   *  collects every textureCacheKey currently in use. Eviction skips
   *  pinned keys entirely; if every entry is pinned the cache simply
   *  grows past TEXTURE_CACHE_MAX (logged so we can diagnose runaway). */
  function evictTextureCache(): void {
    if (textureCache.size <= TEXTURE_CACHE_MAX) return;

    // Build set of textureCacheKeys currently in use by ANY active layer.
    // Mirror the lookupKey derivation in updateTexturesSync exactly so
    // the pinned set matches the keys textureCache actually uses.
    const pinned = new Set<string>();
    const collectFrom = (layerList: Layer[] | null | undefined) => {
      if (!layerList) return;
      for (const layer of layerList) {
        if (!layer?.source) continue;
        const isAIGenerated = layer.source.src === 'ai-generated' || layer.source.src === 'js-animation';
        const isSynthVision =
          layer.source.type === 'synthvision' ||
          (!layer.source.src && (layer.source as any).synthVisionCanvas) ||
          (layer.source.type === 'threejs' && (layer.source as any).threejsCanvas && !layer.source.src);
        const isVJVideoLayer =
          layer.source.type === 'video' &&
          typeof layer.id === 'string' && layer.id.startsWith('vj-layer-');
        const textureCacheKey =
          (isAIGenerated || isSynthVision) ? layer.source.id
          : isVJVideoLayer ? `${layer.id}:${layer.source.src}`
          : layer.source.src;
        const isShader = layer.source.type === 'shader';
        const lookupKey = isShader ? `${layer.id}:${textureCacheKey}` : textureCacheKey;
        if (lookupKey) pinned.add(lookupKey);
      }
    };
    collectFrom(get(layers));
    collectFrom(get(vjOutputLayers));

    const targetCount = Math.max(TEXTURE_CACHE_MAX, pinned.size);
    if (textureCache.size <= targetCount) return;

    const keysToDelete: string[] = [];
    for (const key of textureCache.keys()) {
      if (textureCache.size - keysToDelete.length <= targetCount) break;
      if (pinned.has(key)) continue;
      keysToDelete.push(key);
    }

    if ((window as any).__VIDEO_DEBUG__ && keysToDelete.length > 0) {
      console.log('[textureCache] evicting', keysToDelete.length, 'of', textureCache.size,
        '— pinned:', pinned.size, 'keys:', keysToDelete);
    }

    for (const key of keysToDelete) {
      const tex = textureCache.get(key);
      if (tex) tex.dispose();
      textureCache.delete(key);
    }

    if (textureCache.size > targetCount && (window as any).__VIDEO_DEBUG__) {
      console.warn('[textureCache] cache size', textureCache.size,
        'exceeds target', targetCount, '— all entries pinned, allowing growth');
    }
  }

  // ISF shader instances and their render targets
  const shaderInstances = new Map<string, ISFShaderInstance>();
  const shaderRenderTargets = new Map<string, THREE.WebGLRenderTarget>();
  const shaderRenderTargetQualities = new Map<string, number>(); // Track quality per target

  // ── Keyframe phase integration ──
  // For shader params that act as time multipliers (speed/rate/tempo), we accumulate
  // a phase by integrating `keyframe_value * playback_delta` per frame. When a layer
  // has an active keyframe on a time-multiplier param during playback, we override
  // the shader's TIME uniform with this phase and set the param uniform to 1.0, so
  // `TIME * speed` inside the shader becomes `phase * 1.0 = phase` (correct phase
  // accumulation instead of the naive `growing_TIME * changing_speed` jumpiness).
  const shaderPhases = new Map<string, { phase: number; lastPlaybackTime: number }>();
  const TIME_MULTIPLIER_PARAM_REGEX = /(^|_)(speed|rate|tempo|timescale)(_|$)/i;

  // Default gradient texture for ISF shaders that require inputImage but have none configured
  let isfDefaultInputTexture: THREE.DataTexture | null = null;
  function getISFDefaultInputTexture(): THREE.DataTexture {
    if (!isfDefaultInputTexture) {
      const size = 64;
      const data = new Uint8Array(size * size * 4);
      // Use a colorful checkerboard pattern so it's clearly visible as a placeholder
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const checker = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) === 0;
          if (checker) {
            data[i]     = 180; // R
            data[i + 1] = 100; // G
            data[i + 2] = 220; // B
          } else {
            data[i]     = 60;
            data[i + 1] = 160;
            data[i + 2] = 200;
          }
          data[i + 3] = 255;
        }
      }
      isfDefaultInputTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      isfDefaultInputTexture.needsUpdate = true;
    }
    return isfDefaultInputTexture;
  }

  // Cache for shader image input textures (persists across store updates)
  const imageInputTextureCache = new Map<string, THREE.Texture>();

  // Shader render scene (for rendering ISF to texture)
  let shaderScene: THREE.Scene;
  let shaderCamera: THREE.OrthographicCamera;
  let shaderQuad: THREE.Mesh;

  // Lines renderer (for lines layers)
  let linesRenderer: LinesRenderer | null = null;
  // Handler for resetting line animation timers (defined here for cleanup access)
  const handleLinesResetAnimations = () => {
    if (linesRenderer) linesRenderer.resetAnimationTimes();
  };

  // Cache for lines layer render targets
  const linesRenderTargets = new Map<string, THREE.WebGLRenderTarget>();

  // SVG layer renderers and their render targets
  const svgRenderers = new Map<string, SVGLayerRenderer>();
  const svgRenderTargets = new Map<string, THREE.WebGLRenderTarget>();
  let lastSVGUpdateTime = 0;

  // Light painting renderers (per layer)
  const lightPaintingRenderers = new Map<string, LightPaintingRenderer>();
  let lastLPUpdateTime = 0;

  // Text renderers (per layer)
  const textRenderers = new Map<string, TextRenderer>();
  let lastTextUpdateTime = 0;

  // Splat renderers (per layer) - Point Cloud / Gaussian Splat
  // Uses WebGLRenderTarget on the main engine's renderer to avoid cross-context issues
  interface SplatRendererContext {
    renderer: SplatRenderer;
    renderTarget: THREE.WebGLRenderTarget;
    plyUrl: string | null;
    loadingPly: boolean;
  }
  const splatRenderers = new Map<string, SplatRendererContext>();
  // ── GPU layer renderers ──
  // One per gpu-layer, plus its CanvasTexture wrapper. The renderer
  // owns a canvas with a webgpu context; the CanvasTexture exposes
  // that canvas to the Three.js engine. Engine treats the result
  // like any other texture-backed layer (warp/blend/effects work).
  const gpuLayerRenderers = new Map<string, GpuLayerRenderer>();
  const gpuLayerTextures = new Map<string, THREE.CanvasTexture>();
  // Latch — try to init WebGPU once; subsequent gpu layers just
  // pull the existing device.
  let _gpuLayerWebGpuTried = false;
  function ensureWebGPUForGpuLayers(): void {
    if (_gpuLayerWebGpuTried) return;
    _gpuLayerWebGpuTried = true;
    void ensureWebGPUDevice().catch((e: any) => console.warn('[Canvas] gpu-layer: WebGPU init failed', e?.message || e));
  }

  // Model3D renderers (per layer) - 3D Model rendering
  // Uses WebGLRenderTarget on the main engine's renderer to avoid cross-context issues
  interface Model3DRendererContext {
    renderer: Model3DRenderer;
    renderTarget: THREE.WebGLRenderTarget;
    modelUrl: string | null;
    loadingModel: boolean;
  }
  const model3dRenderers = new Map<string, Model3DRendererContext>();

  // Integrated effects (FluidSimulation, ParticleSystem3D)
  interface IntegratedEffectContext {
    type: 'fluid' | 'particles';
    fluid?: FluidSimulation;
    particles?: ParticleSystem3D;
    renderTarget: THREE.WebGLRenderTarget;
    simulationWidth: number;
    simulationHeight: number;
    lastUpdateTime: number;
    mouseX: number;
    mouseY: number;
    lastMouseX: number;
    lastMouseY: number;
    // Camera feed for fluid
    cameraRequested?: boolean;
    cameraStream?: MediaStream;
    cameraVideoEl?: HTMLVideoElement;
    cameraTexture?: THREE.VideoTexture;
    prevCameraTarget?: THREE.WebGLRenderTarget;
    prevCameraCopied?: boolean;
    // Reusable params objects for setParams — mutated in place each frame
    // instead of allocating fresh literals (previously ~32 keys + 5 arrays
    // per layer per frame). The underlying sim already has change-detection
    // so passing the same mutated object repeatedly is fine.
    _particleParams?: any;
    _fluidSimParams?: any;
    _fluidRenderParams?: any;
    _camCopyScene?: THREE.Scene;
    _camCopyMat?: THREE.MeshBasicMaterial;
    _camCopyMesh?: THREE.Mesh;
    _camCopyCam?: THREE.OrthographicCamera;
  }
  const integratedEffects = new Map<string, IntegratedEffectContext>();
  let lastEffectUpdateTime = 0;
  const FLUID_QUALITY_PRESETS = {
    live: { scale: 0.65, minSize: 256, pressureIterations: 10 },
    balanced: { scale: 0.78, minSize: 256, pressureIterations: 14 },
    quality: { scale: 1.0, minSize: 384, pressureIterations: 20 },
  } as const;
  let fluidQualityPreset: typeof FLUID_QUALITY_PRESETS[keyof typeof FLUID_QUALITY_PRESETS] = FLUID_QUALITY_PRESETS.live;
  $: fluidQualityPreset = FLUID_QUALITY_PRESETS[$settings.ui.fluidQuality ?? 'live'];

  function getFluidSimulationSize(width: number, height: number) {
    return {
      width: Math.max(fluidQualityPreset.minSize, Math.round(width * fluidQualityPreset.scale)),
      height: Math.max(fluidQualityPreset.minSize, Math.round(height * fluidQualityPreset.scale)),
    };
  }

  // Track if context was lost
  let contextLost = false;

  /** Calculate the largest rectangle matching projectAspect that fits within parentW × parentH */
  function calcContainerSize(parentW: number, parentH: number, projW: number, projH: number) {
    const projAspect = projW / projH;
    const parentAspect = parentW / parentH;
    if (parentAspect > projAspect) {
      // Parent is wider → height-limited
      return { w: Math.round(parentH * projAspect), h: Math.round(parentH) };
    } else {
      // Parent is taller → width-limited
      return { w: Math.round(parentW), h: Math.round(parentW / projAspect) };
    }
  }

  /** Set the container's display dimensions to match the project aspect ratio */
  function sizeContainer(parentW: number, parentH: number) {
    const pW = $project.width || 1920;
    const pH = $project.height || 1080;
    if (isOsrMode || isOutputMode) {
      containerEl.style.width = '100%';
      containerEl.style.height = '100%';
    } else {
      const { w, h } = calcContainerSize(parentW, parentH, pW, pH);
      containerEl.style.width = w + 'px';
      containerEl.style.height = h + 'px';
      // Explicitly set canvas CSS size to prevent the WebGL backing store
      // from overflowing the container in Electron's Chromium compositor
      if (canvas) {
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      }
    }
  }

  /** Get wrapper layout dimensions (before CSS transforms like viewport zoom).
   *  offsetWidth/offsetHeight are NOT affected by parent transforms, unlike getBoundingClientRect(). */
  function getWrapperLayoutSize() {
    return { w: wrapperEl.offsetWidth, h: wrapperEl.offsetHeight };
  }

  onMount(() => {
    const { w: wrapW, h: wrapH } = getWrapperLayoutSize();
    const projW = $project.width || 1920;
    const projH = $project.height || 1080;
    // preserveDrawingBuffer false unconditionally — was previously true
    // for the editor to support one-shot canvas.toBlob/toDataURL
    // thumbnails, but the cost was paid on every paint. Any thumbnail
    // path that needed it can do an explicit one-shot render to a
    // dedicated render target.
    engine = new RenderEngine(canvas, projW, projH, { preserveDrawingBuffer: false });
    // Set initial container size from wrapper layout dimensions
    sizeContainer(wrapW, wrapH);

    // Watermark sync removed — no watermark in OSS build.
    const unsubWatermark = () => {};

    // Sync dome projection settings
    const unsubDome = settings.subscribe(s => {
      if (!engine) return;
      engine.setDomeEnabled(s.output.domeEnabled);
      engine.setDomeSettings({
        mode: s.output.domeMode,
        fov: s.output.domeFOV,
        rotation: s.output.domeRotation,
        tilt: s.output.domeTilt,
        offsetX: s.output.domeOffsetX,
        offsetY: s.output.domeOffsetY,
        curvature: s.output.domeCurvature,
        truncation: s.output.domeTruncation,
      });
      engine.setOutputTransform({
        rotation: isOutputMode ? (s.output.outputRotation ?? 0) : 0,
        cropX: isOutputMode ? (s.output.outputCropX ?? 0) : 0,
        cropY: isOutputMode ? (s.output.outputCropY ?? 0) : 0,
        cropWidth: isOutputMode ? (s.output.outputCropWidth ?? 1) : 1,
        cropHeight: isOutputMode ? (s.output.outputCropHeight ?? 1) : 1,
        brightness: isOutputMode ? (s.output.brightness ?? 1) : 1,
        contrast: isOutputMode ? (s.output.contrast ?? 1) : 1,
        gamma: isOutputMode ? (s.output.gamma ?? 1) : 1,
      });
    });

    // Initialize BroadcastChannel state sync (sender in main window only)
    // Output window and OSR window are receivers — they get state from main
    if (!isOsrMode && !isOutputMode) {
      initStateBroadcast('sender');
    }

    // Register the editor canvas with the zero-copy presenter so that
    // when the user opens the output window via window.open(), the
    // pump can start without OutputWindow.svelte needing a canvas
    // reference of its own. This is a no-op in OSR / output modes.
    if (!isOsrMode && !isOutputMode && canvas) {
      registerEditorCanvas(canvas, 60);
    }

    // Legacy WebRTC output transport reconcile. The zero-copy path
    // (experimental.outputZeroCopy) is NOT started here — see top-of-
    // file note. Only the WebRTC fallback runs under reconcile-control
    // because it broadcasts blindly to a BroadcastChannel and doesn't
    // need a target window reference.
    //
    //   outputZeroCopy true                    → no-op here; OutputWindow
    //                                            calls attachOutputWindow
    //                                            on user click
    //   outputZeroCopy false, outputWebRTC true → start WebRTC presenter
    //   both false                              → no editor broadcast
    //
    // Both transports are no-ops in OSR / output modes.
    {
      let webrtcStarted = false;
      const reconcileTransport = (zeroCopy: boolean, webrtc: boolean) => {
        const eligible = !isOsrMode && !isOutputMode && !!canvas;
        const wantWebRTC = eligible && !zeroCopy && webrtc;
        if (wantWebRTC && !webrtcStarted) {
          // Read perf knobs from Settings → Performance so users on weak
          // hardware can dial down framerate / bitrate / codec.
          const _perf = get(settings)?.performance;
          startOutputPixelBroadcast(canvas, _perf?.outputFrameRate ?? 60, {
            maxBitrate: _perf?.outputMaxBitrate,
            degradationPreference: _perf?.outputDegradationPreference,
            codecPreference: _perf?.outputCodecPreference,
          });
          webrtcStarted = true;
          console.log('[Canvas] legacy WebRTC output transport started');
        } else if (!wantWebRTC && webrtcStarted) {
          stopOutputPixelBroadcast();
          webrtcStarted = false;
          console.log('[Canvas] legacy WebRTC output transport stopped');
        }
      };
      outputWebRTCUnsub = settings.subscribe((s) => {
        reconcileTransport(
          !!s.experimental?.outputZeroCopy,
          !!s.experimental?.outputWebRTC,
        );
      });
    }

    // S4 pilot: kick off the WebGPU capability probe in parallel with the
    // rest of editor init. The probe runs even when the pilot flag is off
    // so the dev preferences panel can show "WebGPU available: yes /
    // Adapter: ..." before the user opts in.
    void probeWebGPU().then(() => {
      const info = getWebGPUInfo();
      webgpuPilotMetrics.update((m) => ({
        ...m,
        adapter: info.description || `${info.vendor ?? '?'}/${info.architecture ?? '?'}`,
        inactiveReason: info.supported
          ? (m.inactiveReason || 'pilot disabled in settings')
          : `WebGPU not supported (${info.failReason || 'reason unknown'})`,
        updatedAt: Date.now(),
      }));
    });

    // S4 pilot lifecycle subscription. Brings the pilot up when the user
    // toggles `experimental.webgpuPilot` true AND the capability probe
    // says yes; tears it down on toggle false. Race-safe via
    // `webgpuPilotInitInFlight` — a rapid on/off doesn't leak a
    // half-initialized pilot.
    //
    // HARD-GATED to the editor window. The pilot is a dev-only diagnostic
    // experiment; running it in the output/Spout/OSR renderers would
    // (a) waste their GPU budget on a test pattern they never composite,
    // and (b) — more importantly — pollute the WebGL state cache that
    // those windows' video-texture path leans on. The settings store is
    // shared via state-sync, so without this gate, toggling the flag in
    // the editor would silently spin up a pilot in the output window too.
    // `?webgpu-disable=1` on the output window's load URL is the
    // belt-and-suspenders defense (see electron/main.js).
    webgpuPilotUnsub = settings.subscribe(async (s) => {
      const wantPilot =
        !isOutputMode &&
        !isOsrMode &&
        isPilotEffectivelyEnabled(!!s.experimental?.webgpuPilot);
      if (wantPilot && !webgpuPilot && !webgpuPilotInitInFlight) {
        webgpuPilotInitInFlight = true;
        try {
          const { WebGPUPilot } = await import('$lib/renderer/webgpuPilot');
          // If the user toggled OFF while we awaited the import, bail
          // before instantiating.
          if (!isPilotEffectivelyEnabled(!!get(settings).experimental?.webgpuPilot)) {
            webgpuPilotInitInFlight = false;
            return;
          }
          webgpuPilot = await WebGPUPilot.create({ width: 512, height: 512 });
          if (webgpuPilot) {
            const info = getWebGPUInfo();
            webgpuPilotMetrics.update((m) => ({
              ...m,
              active: true,
              inactiveReason: '',
              adapter: info.description || `${info.vendor ?? '?'}/${info.architecture ?? '?'}`,
              pilotDims: `${webgpuPilot!.metrics.outputWidth}×${webgpuPilot!.metrics.outputHeight}`,
              updatedAt: Date.now(),
            }));
          }
        } catch (e: any) {
          webgpuPilotMetrics.update((m) => ({
            ...m,
            active: false,
            inactiveReason: `pilot create failed: ${e?.message ?? e}`,
            updatedAt: Date.now(),
          }));
        } finally {
          webgpuPilotInitInFlight = false;
        }
      } else if (!wantPilot && webgpuPilot) {
        const dying = webgpuPilot;
        webgpuPilot = null;
        // Clean up the handoff texture so a re-enable doesn't reuse a
        // stale binding (different gl context if the canvas was
        // re-created mid-session).
        if (webgpuHandoffTexture) {
          const gl2 = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
          try { gl2?.deleteTexture(webgpuHandoffTexture); } catch { /* */ }
          webgpuHandoffTexture = null;
        }
        webgpuHandoffMsEma = 0;
        await dying.dispose();
        resetWebgpuPilotMetrics();
      }
    });

    // Start native renderer command-stream synchronization on Tauri runtime.
    // Electron path continues using existing WebGL/OSR flow until migrated.
    if (isTauriRuntime && !isOsrMode && !isOutputMode) {
      nativeRendererSync = new NativeRendererSync();
      const size = getProjectOutputSize();
      void nativeRendererSync.start(size.width, size.height).then(() => {
        nativeRendererStatusTimer = setInterval(() => {
          void nativeRendererSync?.logStatus();
        }, 10000);
      }).catch((err) => {
        console.warn('[NativeRendererSync] failed to start native renderer:', err);
      });

      nativeLayersUnsub = layers.subscribe(($layers) => {
        const p = get(project);
        nativeRendererSync?.scheduleSync(p.width || 1920, p.height || 1080, $layers);
      });

      nativeProjectUnsub = project.subscribe(($project) => {
        nativeRendererSync?.scheduleSync(
          $project.width || 1920,
          $project.height || 1080,
          $project.layers || []
        );
      });
    }

    // Listen for OSR zero-copy status from main process
    if (window.electronOSR?.onOsrStatus) {
      window.electronOSR.onOsrStatus((status) => {
        osrSpoutActive = status.active;
        if (status.active) {
          console.log('[Canvas] OSR zero-copy active — disabling readPixels send');
        } else {
          console.log('[Canvas] OSR inactive (reason:', status.reason, ') — re-enabling CPU send path');
        }
      });
    }

    // Expose canvas to window for VJ preview
    (window as any).__ghostarcadeOutputCanvas = canvas;

    // Setup shader rendering scene
    shaderScene = new THREE.Scene();
    shaderCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    shaderCamera.position.z = 1;
    const shaderGeometry = new THREE.PlaneGeometry(2, 2);
    shaderQuad = new THREE.Mesh(shaderGeometry);
    shaderScene.add(shaderQuad);

    // Initialize lines renderer
    const renderer = engine.getRenderer();
    linesRenderer = new LinesRenderer(renderer, projW, projH);
    // Share lines renderer with engine for edge effects (stroke-only fallback)
    engine.setDrawingRenderer(linesRenderer);
    // Initialize drawing renderer for edge effects with full fill/animation/stroke support
    const drawingRenderer = new DrawingRenderer(renderer, projW, projH);
    engine.setShapeRenderer(drawingRenderer);

    // Listen for animation reset events from LinesPanel
    window.addEventListener('lines-reset-animations', handleLinesResetAnimations);

    // Add WebGL context loss/restore handlers
    const glCanvas = renderer.domElement;
    glCanvas.addEventListener('webglcontextlost', handleContextLost, false);
    glCanvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    // Add mouse tracking for splat layer interactions
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseleave', handleCanvasMouseLeave);
    canvas.addEventListener('mouseenter', handleCanvasMouseEnter);


    /** Run all texture update passes for a given layer list */
    function updateAllTextures(layerList: Layer[], normalOnly: Layer[] | null) {
      // If normalOnly is null, this is the stage-mode second pass where
      // layerList is a narrower subset (just screens). Skip the cleanup loop
      // that otherwise disposes any "missing" layer — in that pass every
      // VJ layer is "missing" from layerList but very much alive upstream.
      const cleanupStale = normalOnly !== null || !(get(vjClipLauncher).stageMode && get(vjClipLauncher).isLive);
      try { updateTexturesSync(layerList, cleanupStale); } catch (e) { console.error('[Canvas] Media texture error:', e); }
      try { updateShaderTextures(layerList); } catch (e) { console.error('[Canvas] Shader update error:', e); }
      try { updateIntegratedEffectTextures(layerList); } catch (e) { console.error('[Canvas] Integrated effect error:', e); }
      // These only apply to normal layers (not VJ)
      const target = normalOnly || layerList;
      try { updateLinesLayerTextures(target); } catch (e) { console.error('[Canvas] Lines update error:', e); }
      try { updateSVGLayerTextures(target); } catch (e) { console.error('[Canvas] SVG update error:', e); }
      try { updateLightPaintingLayerTextures(target); } catch (e) { console.error('[Canvas] Light painting error:', e); }
      try { updateTextLayerTextures(target); } catch (e) { console.error('[Canvas] Text update error:', e); }
      try { updateSplatLayerTextures(target); } catch (e) { console.error('[Canvas] Splat update error:', e); }
      try { updateModel3DTextures(target); } catch (e) { console.error('[Canvas] Model3D update error:', e); }
      try { updateGpuLayerTextures(target); } catch (e) { console.error('[Canvas] GPU layer update error:', e); }
    }

    // Start render loop
    //
    // The entire frame body is wrapped in try/catch so a single exception
    // (a corrupt layer, a dead video element, a malformed keyframe, a shader
    // hiccup on context restore) can't permanently stop the render loop.
    // Before the guard, any unhandled throw anywhere in animate() would skip
    // the `requestAnimationFrame(animate)` at the bottom → black canvas for
    // the rest of the session with no indication to the user. With the guard,
    // bad frames are logged and skipped, next frame still schedules.
    let _consecutiveFrameErrors = 0;
    // Editor render-rate cap. rAF on a high-refresh display runs at
    // 120/144/165Hz — the editor renders at that rate, but the projector
    // is almost always 60Hz so anything above 60 is wasted work. Users
    // dial this from Settings → Performance: 0 = uncapped (default).
    let _lastEditorRenderTime = 0;
    function animate() {
      // Unconditional first-3-frames log. No gate, no store lookup. If THIS
      // doesn't appear in the terminal, animate() isn't being called at all
      // (which means the FPS log that's firing is coming from somewhere else,
      // or HMR is serving a cached Canvas.svelte and none of our diag edits
      // are actually live). If it DOES appear but the other [syphon-*] logs
      // don't, something between the try { and the inner gate is short-
      // circuiting the send path.
      if (!(window as any).__animTick) (window as any).__animTick = 0;
      if ((window as any).__animTick < 3) {
        (window as any).__animTick++;
        console.log('[animate-tick] frame', (window as any).__animTick,
          '— engine=', !!engine, 'contextLost=', contextLost, 'outputFrozen=', $outputFrozen,
          'spoutOutputActive=', spoutOutputActive, 'outputWindowOpen=', $settings?.output?.outputWindowOpen,
          'glCanvas=', !!glCanvas);
      }

      // Render-rate gate. Reschedule rAF unconditionally so input
      // handlers stay responsive; bypass render body when early.
      const _editorFpsCap = ($settings as any)?.performance?.editorMaxFps ?? 0;
      if (_editorFpsCap > 0) {
        const now = performance.now();
        const interval = 1000 / _editorFpsCap;
        if (now - _lastEditorRenderTime < interval) {
          animationId = requestAnimationFrame(animate);
          return;
        }
        _lastEditorRenderTime = now;
      }

      try {
      if (engine && !contextLost && !$outputFrozen) {
        // Use reactive $ subscriptions (persistent, no per-frame subscribe/unsubscribe)
        const vjLayers = $vjOutputLayers;
        const normalLayers = $layers;
        const vjState = $vjClipLauncher;

        let layersToRender: Layer[];
        let compEffects: import('../types').Effect[] | undefined;
        let didStageTexturePrepass = false;

        // VJ Stop All — render nothing (black output) until a clip is triggered
        if (vjState.stoppedAll && vjState.isLive) {
          layersToRender = [];
          compEffects = undefined;
        } else if (vjState.stageMode && vjState.isLive) {
          // ── STAGE MODE: VJ layers feed into mapping layers ──

          // 1. Build combined layer list
          const allManagedLayers: Layer[] = [...(vjLayers || []), ...normalLayers];

          // 2. Update all textures in one batch
          updateAllTextures(allManagedLayers, normalLayers);
          didStageTexturePrepass = true;

          // 3. Build VJ source lookup, A/B-aware.
          //
          // When the A/B crossfader is ON, vjOutputLayers emits TWO entries
          // per VJ layer (one per bank, IDs `vj-layer-N-A` / `vj-layer-N-B`).
          // For stage mode we want each mapped Screen to see the SAME live
          // crossfade between A and B that the user dialled with the fader,
          // applied PER VJ LAYER INDEX (so different screens can show
          // different VJ layers, each independently mixing A↔B).
          //
          // We bucket layers by VJ index, then for any index that has both
          // banks active we ask the engine to render a per-layer crossfade
          // FBO and use that as the canonical texture. Single-bank indices
          // pass through unchanged (cheap path).
          //
          // Helper: resolve the actual GPU texture for a VJ layer entry —
          // shader VJ layers come from shaderRenderTargets, everything else
          // (video / threejs / synthvision / spout) carries its texture on
          // the source object directly.
          const resolveVjTexture = (vjLayer: Layer): THREE.Texture | null => {
            if (!vjLayer?.source) return null;
            if (vjLayer.source.type === 'shader' && vjLayer.source.src) {
              const rtKey = `${vjLayer.id}:${vjLayer.source.src}`;
              const rt = shaderRenderTargets.get(rtKey);
              if (rt) return rt.texture;
            }
            return (vjLayer.source.texture as THREE.Texture | null | undefined) ?? null;
          };

          // Bucket per VJ layer index → { A?, B?, single? }. `single` is set
          // for entries with no bank tag (crossfader off — only Bank A).
          type VjBucket = { a?: Layer; b?: Layer; single?: Layer };
          const vjByIndex = new Map<number, VjBucket>();
          if (vjLayers) {
            for (const vjLayer of vjLayers) {
              const m = vjLayer.id.match(/^vj-layer-(\d+)(?:-([AB]))?$/);
              if (!m) continue;
              const idx = parseInt(m[1]);
              const bank = m[2] as 'A' | 'B' | undefined;
              const slot = vjByIndex.get(idx) ?? {};
              if (bank === 'A') slot.a = vjLayer;
              else if (bank === 'B') slot.b = vjLayer;
              else slot.single = vjLayer;
              vjByIndex.set(idx, slot);
            }
          }

          // Pre-render per-VJ-layer crossfades for indices that have both
          // banks. Engine reuses the chosen transition shader + fader value.
          // Resolves to a Map<idx, { layer: Layer, texture: Texture }> for
          // the injection step below.
          const vjResolved = new Map<number, { layer: Layer; texture: THREE.Texture }>();
          for (const [idx, slot] of vjByIndex.entries()) {
            // Single-bank or crossfader-off — fast path: use whichever side
            // exists, no merge.
            if (slot.single) {
              const tex = resolveVjTexture(slot.single);
              if (tex) vjResolved.set(idx, { layer: slot.single, texture: tex });
              continue;
            }
            if (slot.a && !slot.b) {
              const tex = resolveVjTexture(slot.a);
              if (tex) vjResolved.set(idx, { layer: slot.a, texture: tex });
              continue;
            }
            if (slot.b && !slot.a) {
              const tex = resolveVjTexture(slot.b);
              if (tex) vjResolved.set(idx, { layer: slot.b, texture: tex });
              continue;
            }
            // Both banks present — run per-layer crossfade.
            if (slot.a && slot.b) {
              const texA = resolveVjTexture(slot.a);
              const texB = resolveVjTexture(slot.b);
              if (!texA && !texB) continue;
              const target = engine.getOrCreateVJCrossfadeTarget(idx);
              engine.renderVJCrossfadeToTarget(target, texA, texB);
              // Use Bank A's layer envelope as the carrier (effects stack +
              // source meta). The texture override below is what actually
              // reaches the screen. Bank A's effects win — stage-mode VJ
              // effects on top of the crossfade are A's choice; Bank B's
              // per-layer effects already baked into texB before the merge.
              vjResolved.set(idx, { layer: slot.a, texture: target.texture });
            }
          }

          // 4. Inject VJ sources into Screen / Group layers.
          //
          //    Rebuild every frame — VJ textures change each frame
          //    (synthvision canvas, shaders, crossfade mix) and caching
          //    causes stale texture references when clips swap.
          //
          //    The clone keeps source.type UNCHANGED (shader/video/threejs/…).
          //    We tag with __vjStage so updateTexturesSync /
          //    updateShaderTextures short-circuit on the second pass —
          //    the VJ deck (and any A/B merge) already produced the texture,
          //    Screens just sample from it.
          const cachedStageLayers = normalLayers.map(layer => {
            if (layer.vjLayerIndex !== undefined) {
              const resolved = vjResolved.get(layer.vjLayerIndex);
              if (resolved) {
                const injectedSource: any = {
                  ...resolved.layer.source,
                  texture: resolved.texture,
                  __vjStage: true,
                };
                if (layer.type === 'group') {
                  // Group layers distribute the injected texture to children
                  // via renderGroupToTexture — no type change needed.
                  return { ...layer, source: injectedSource };
                }
                return {
                  ...layer,
                  source: injectedSource,
                  // Keep layer.type = 'screen'. engine.ts treats 'screen'
                  // and 'media' identically in the render pipeline.
                  effects: [...(resolved.layer.effects || []), ...layer.effects],
                };
              }
            }
            return layer;
          });

          layersToRender = cachedStageLayers;
          compEffects = vjState.compositionEffects;
        } else if (vjLayers) {
          // ── PURE VJ MODE: VJ layers replace mapping layers ──
          layersToRender = vjLayers;
          compEffects = vjState.compositionEffects;
        } else {
          // ── NORMAL MAPPING MODE ──
          layersToRender = normalLayers;
          compEffects = undefined;
        }

        // ── Keyframe timeline overrides (applied only during playback so sliders work freely when paused) ──
        const kfState = get(keyframeTimeline);
        const kfOverrides = kfState.config.isPlaying ? kfState.activeOverrides : {};
        const kfStash: Array<{ layer: any; key: string; orig: any; target: any; prop: string }> = [];

        // Debug: log once per second during playback
        if (kfState.config.isPlaying && Object.keys(kfOverrides).length > 0) {
          const now = performance.now();
          if (!(window as any)._kfCanvasLogTime || now - (window as any)._kfCanvasLogTime > 1000) {
            (window as any)._kfCanvasLogTime = now;
            console.log('[KF Canvas] applying overrides:', JSON.stringify(kfOverrides), 'layers:', layersToRender.map(l => l.id));
          }
        }

        for (let i = 0; i < layersToRender.length; i++) {
          const layer = layersToRender[i] as any;
          // For VJ layers, overrides are keyed by clip ID (vj-${clipId}) not layer.id
          const isVJLayer = layer.id?.startsWith('vj-layer-');
          const overrideKey = isVJLayer && layer.source?.id ? `vj-${layer.source.id}` : layer.id;
          const overrides = kfOverrides[overrideKey];
          if (!overrides) continue;

          for (const [key, value] of Object.entries(overrides)) {
            if (key === 'layer:opacity') {
              kfStash.push({ layer, key, orig: layer.opacity, target: layer, prop: 'opacity' });
              layer.opacity = value as number;
            } else if (key.startsWith('shader:') && layer.source?.shaderValues) {
              const param = key.slice(7);
              kfStash.push({ layer, key, orig: layer.source.shaderValues[param], target: layer.source.shaderValues, prop: param });
              layer.source.shaderValues[param] = value;
            } else if (key.startsWith('fx:')) {
              const parts = key.split(':');
              const fxId = parts[1];
              const prop = parts[2];
              const effect = layer.effects?.find((e: any) => e.id === fxId);
              if (effect) {
                if (prop === 'enabled') {
                  kfStash.push({ layer, key, orig: effect.enabled, target: effect, prop: 'enabled' });
                  effect.enabled = value as boolean;
                } else if (prop === 'opacity') {
                  kfStash.push({ layer, key, orig: effect.opacity, target: effect, prop: 'opacity' });
                  effect.opacity = value as number;
                } else {
                  kfStash.push({ layer, key, orig: effect.params?.[prop], target: effect.params, prop });
                  if (effect.params) effect.params[prop] = value;
                }
              }
            } else if (key.startsWith('edge:')) {
              const parts = key.split(':');
              const edgeId = parts[1];
              const prop = parts[2];
              const edge = layer.edgeEffects?.effects?.find((e: any) => e.id === edgeId);
              if (edge) {
                if (prop === 'enabled') {
                  kfStash.push({ layer, key, orig: edge.enabled, target: edge, prop: 'enabled' });
                  edge.enabled = value as boolean;
                } else if (prop === 'opacity') {
                  kfStash.push({ layer, key, orig: edge.opacity, target: edge, prop: 'opacity' });
                  edge.opacity = value as number;
                }
              }
            } else if (key.startsWith('model3d:') && layer.model3dContent) {
              // Dot-path support: model3d:echo.count → layer.model3dContent.echo.count
              const path = key.slice('model3d:'.length).split('.');
              const last = path.pop()!;
              let target: any = layer.model3dContent;
              for (const p of path) {
                if (target?.[p] == null) { target = null; break; }
                target = target[p];
              }
              if (target) {
                kfStash.push({ layer, key, orig: target[last], target, prop: last });
                target[last] = value;
              }
            } else if (key.startsWith('gpu:') && layer.gpuLayerContent) {
              // GPU-shader param keyframes — `gpu:${paramKey}` writes
              // into layer.gpuLayerContent.params[paramKey]. Works
              // for any shader in the catalog because params are a
              // free-form record. The renderer reads params each
              // frame so the override surfaces immediately.
              const paramKey = key.slice('gpu:'.length);
              const params = layer.gpuLayerContent.params || (layer.gpuLayerContent.params = {});
              kfStash.push({ layer, key, orig: params[paramKey], target: params, prop: paramKey });
              params[paramKey] = value;
            }
          }
        }

        // ── Update all textures AFTER keyframe overrides so shader uniforms reflect new values ──
        const hasKeyframeOverrides = Object.keys(kfOverrides).length > 0;
        if (!didStageTexturePrepass || hasKeyframeOverrides) {
          updateAllTextures(layersToRender, null);
        }

        // Phase integration now happens inside updateShaderTextures (per-layer, right before each shader renders)
        // We just need to clear phase state when playback stops
        if (!kfState.config.isPlaying) {
          shaderPhases.clear();
        }

        // ── Sequencer opacity overrides (non-destructive: stash & restore per frame) ──
        const seqState = get(layerSequencer);
        const seqOverrides = (seqState.isPlaying || Object.keys(seqState.opacityOverrides).length > 0) ? seqState.opacityOverrides : null;

        if (seqOverrides) {
          for (let i = 0; i < layersToRender.length; i++) {
            const layer = layersToRender[i];
            const mult = seqOverrides[layer.id];
            if (mult !== undefined && mult < 1) {
              (layer as any)._seqOrigOpacity = layer.opacity;
              layer.opacity = layer.opacity * mult;
            }
          }
        }

        try {
          // Wire VJ A/B crossfader state into the engine each frame.
          // engine.setCrossfade is cheap (just three field assignments
          // + a curve calc). When crossfaderEnabled is false it puts the
          // engine on the single-bank (default) render path.
          const cfEnabled = $vjClipLauncher.crossfaderEnabled === true && $vjClipLauncher.isLive;
          engine.setCrossfade(
            cfEnabled,
            $vjClipLauncher.crossfaderValue ?? 0,
            $vjClipLauncher.crossfaderTransition || 'dissolve',
            $vjClipLauncher.crossfaderCurve || 'constant-power',
            $vjClipLauncher.crossfaderBlendMode || 'normal'
          );
          // Macro bundles: post-composition effect chains scaled by
          // each macro's wet/dry value. Stored as a thin shape (id,
          // value, effects) so the renderer doesn't pull in the whole
          // macros store API. Skipped at the call site when no macro
          // is open or has effects so we don't pay the array build
          // cost on every frame of a typical session.
          const macroState = $macros;
          let macroBundles: { id: string; value: number; effects: typeof macroState.macros[0]['effects'] }[] | undefined;
          for (const m of macroState.macros) {
            if (m.value > 0.001 && m.effects.length > 0) {
              if (!macroBundles) macroBundles = [];
              macroBundles.push({ id: m.id, value: m.value, effects: m.effects });
            }
          }
          // S4 pilot: tick the pilot before the main render so the pilot's
          // canvas has a fresh frame when a future compositor migration
          // wants to sample it. Hard-gated to !output && !osr (the
          // settings-store sub already enforces this on creation, but
          // defense-in-depth — even a stale pilot ref leaking past a
          // window-mode flip stays inert here).
          if (webgpuPilot && !isOutputMode && !isOsrMode) {
            webgpuPilot.tick();
            // Push the latest metrics into the diagnostics store so the
            // pilot panel updates without subscribing to the pilot directly.
            webgpuPilotMetrics.update((m) => ({
              ...m,
              webgpuRenderMs: Math.round(webgpuPilot!.metrics.webgpuRenderMs * 100) / 100,
              pilotFramesRendered: webgpuPilot!.metrics.framesRendered,
              pilotFramesFailed: webgpuPilot!.metrics.framesFailed,
              lastError: webgpuPilot!.metrics.lastError,
              updatedAt: Date.now(),
            }));
          }
          engine.render(layersToRender, null, compEffects, macroBundles);
        } catch (e) {
          console.error('[Canvas] Render error:', e);
        }

        // Restore keyframe stashed values
        for (const entry of kfStash) {
          if (entry.orig === undefined) delete entry.target[entry.prop];
          else entry.target[entry.prop] = entry.orig;
        }

        // Shader uniforms are restored inside updateShaderTextures now (no-op here)

        // Restore sequencer original opacities after render
        if (seqOverrides) {
          for (let i = 0; i < layersToRender.length; i++) {
            const layer = layersToRender[i];
            if ((layer as any)._seqOrigOpacity !== undefined) {
              layer.opacity = (layer as any)._seqOrigOpacity;
              delete (layer as any)._seqOrigOpacity;
            }
          }
        }

        // Send rendered frame to Spout output / output window
        // readPixels → send to native Spout sender (CPU fallback path)
        // Skip when: OSR zero-copy is active OR running inside OSR window
        const outputWindowOpen = $settings?.output?.outputWindowOpen ?? false;
        const allSlices = $settings?.output?.slices ?? [];
        const activeSlices = allSlices.filter((s: OutputSlice) => s.enabled);

        // Inner-gate diagnostic: outer gate is passing (animate-dbg is silent)
        // but the send block isn't firing either. Log once/sec which of the
        // inner-gate flags is blocking. Remove once the flow is confirmed.
        // Spout-send gate: skip without logging unless the user explicitly
        // opted into the diagnostic via `?spout-debug=1`. The legacy
        // per-second log was useful when bringing up the OSR Spout pipeline
        // but in steady state it's pure noise — fires every tick on output
        // and OSR renderers (which legitimately never send), and clutters
        // the console for every actual debugging task. Gate it.
        // CPU Spout-send gate. Pre-fix this fired when EITHER spoutOutputActive
        // OR outputWindowOpen was true — meaning just opening the visible output
        // window made the editor do a 1920×1080 RGBA readback (8 MB) every other
        // frame even when Spout output was off and the output window had its
        // own renderer. That single coupling has been the "editor slow when
        // output is open" symptom we've chased all session. The visible output
        // window already presents itself; the editor has zero reason to read
        // back pixels for it.
        //
        // Correct gate: ONLY run the CPU send path for actual user-explicit
        // Spout output (spoutOutputActive) when zero-copy OSR isn't already
        // handling it (osrSpoutActive). Output-window state is window state,
        // not a CPU-readback trigger.
        const __syphonGateSkipped =
          !spoutOutputActive || !glCanvas || osrSpoutActive || isOsrMode || isOutputMode;
        if (__syphonGateSkipped && (window as any).__SPOUT_DEBUG__) {
          const __now2 = Date.now();
          if (!(window as any).__spoutInnerDbgLast || __now2 - (window as any).__spoutInnerDbgLast > 1000) {
            (window as any).__spoutInnerDbgLast = __now2;
            console.log('[syphon-gate] send skipped — spoutOutputActive=', spoutOutputActive,
              'outputWindowOpen=', outputWindowOpen,
              'glCanvas=', !!glCanvas,
              'osrSpoutActive=', osrSpoutActive,
              'isOsrMode=', isOsrMode,
              'isOutputMode=', isOutputMode);
          }
        }

        if (spoutOutputActive && glCanvas && !osrSpoutActive && !isOsrMode && !isOutputMode) {
          // Checkpoint A: we're past the inner gate. Log 3 times so we know
          // this branch is actually entered.
          if (!(window as any).__sendCpA) (window as any).__sendCpA = 0;
          if ((window as any).__sendCpA < 3) {
            (window as any).__sendCpA++;
            console.log('[syphon-path] A: gate open, entering send block');
          }
          // Skip every other frame on the CPU path — getImageData is expensive
          // (~15-30ms for 1080p). This halves the readback overhead while still
          // delivering 30fps output at 60fps render rate.
          spoutFrameSkip++;
          if (spoutFrameSkip % 2 !== 0 && !spoutSendInFlight) {
            // Skip this frame — let the render loop continue at full speed
          } else {
          // Checkpoint B: past frame-skip, entering actual send path
          if (!(window as any).__sendCpB) (window as any).__sendCpB = 0;
          if ((window as any).__sendCpB < 3) {
            (window as any).__sendCpB++;
            console.log('[syphon-path] B: past frame-skip (inFlight=', spoutSendInFlight, ')');
          }
          // Determine Spout output resolution from settings
          const spoutRes = $settings?.output?.spoutResolution || 'match';
          let targetW = 1920, targetH = 1080;
          if (spoutRes === '4K') { targetW = 3840; targetH = 2160; }
          else if (spoutRes === '720p') { targetW = 1280; targetH = 720; }
          else if (spoutRes === 'WXGA') { targetW = 1280; targetH = 800; }
          else if (spoutRes === 'WUXGA') { targetW = 1920; targetH = 1200; }
          else if (spoutRes === 'custom') { targetW = $settings?.output?.customWidth || 1920; targetH = $settings?.output?.customHeight || 1080; }
          else if (spoutRes === 'output' && _detectedOutputRes) { targetW = _detectedOutputRes.width; targetH = _detectedOutputRes.height; }
          else if (spoutRes === 'match') { targetW = glCanvas.width; targetH = glCanvas.height; }
          else { targetW = 1920; targetH = 1080; }

          // Use 2D canvas to grab the WebGL frame and downscale if needed
          // This avoids readPixels (which blocks the GL pipeline) and uses the
          // browser's GPU-accelerated 2D canvas compositing for the copy+scale.
          const canvasW = glCanvas.width;
          const canvasH = glCanvas.height;
          const needsScale = targetW !== canvasW || targetH !== canvasH;

          if (!spoutScaleCanvas || spoutTargetW !== targetW || spoutTargetH !== targetH) {
            spoutScaleCanvas = document.createElement('canvas');
            spoutScaleCanvas.width = targetW;
            spoutScaleCanvas.height = targetH;
            spoutScaleCtx = spoutScaleCanvas.getContext('2d', { willReadFrequently: true });
            spoutTargetW = targetW;
            spoutTargetH = targetH;
          }

          // Draw WebGL canvas → 2D canvas (GPU-accelerated, handles Y-flip)
          spoutScaleCtx!.save();
          spoutScaleCtx!.scale(1, -1); // Flip Y (WebGL is bottom-up)
          spoutScaleCtx!.drawImage(glCanvas, 0, -targetH, targetW, targetH);
          spoutScaleCtx!.restore();

          // getImageData is the CPU readback — but at the target resolution, not canvas resolution
          const imgData = spoutScaleCtx!.getImageData(0, 0, targetW, targetH);
          const w = targetW;
          const h = targetH;
          // Reuse the Uint8Array wrapper if same size to reduce GC pressure.
          // Note: `new Uint8Array(imgData.data.buffer)` is a *view* over the same
          // ArrayBuffer (no copy) — the single .set() below is the only memcpy.
          // Previously this code allocated the Uint8Array wrapper, copied bytes
          // in, and allocated a second wrapper — this version avoids the
          // redundant wrapper allocation each frame.
          const expectedBytes = w * h * 4;
          if (!spoutSendPixels || spoutSendPixels.byteLength !== expectedBytes) {
            spoutSendPixels = new Uint8Array(expectedBytes);
          }
          spoutSendPixels.set(new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength));
          spoutSendW = w;
          spoutSendH = h;

          {
            // Checkpoint B2: which branch are we taking?
            if (!(window as any).__sendCpB2) (window as any).__sendCpB2 = 0;
            if ((window as any).__sendCpB2 < 3) {
              (window as any).__sendCpB2++;
              console.log('[syphon-path] B2: post-readback, activeSlices=', activeSlices.length, 'inFlight=', spoutSendInFlight);
            }
            if (activeSlices.length > 0) {
              // ── Multi-output slice path ──────────────────────────────────
              // spoutScaleCanvas already has the frame right-side-up at Spout resolution
              // Use it directly as the source for slice cropping
              fullFrameCanvas = spoutScaleCanvas;
              fullFrameCtx = spoutScaleCtx;

              for (const slice of activeSlices) {
                if (sliceSendInFlight.has(slice.id)) continue; // Backpressure per-slice

                // Compute pixel crop from normalized coords
                const sx = Math.round(slice.cropX * w);
                const sy = Math.round(slice.cropY * h);
                const sw = Math.round(slice.cropW * w);
                const sh = Math.round(slice.cropH * h);
                if (sw <= 0 || sh <= 0) continue;

                // Create/resize slice extraction canvas
                if (!sliceCanvas || sliceCanvas.width !== sw || sliceCanvas.height !== sh) {
                  sliceCanvas = document.createElement('canvas');
                  sliceCanvas.width = sw;
                  sliceCanvas.height = sh;
                  sliceCtx = sliceCanvas.getContext('2d');
                }
                if (sliceCanvas.width !== sw || sliceCanvas.height !== sh) {
                  sliceCanvas.width = sw;
                  sliceCanvas.height = sh;
                }
                sliceCtx!.clearRect(0, 0, sw, sh);

                // Handle rotation
                if (slice.rotation === 0) {
                  sliceCtx!.drawImage(fullFrameCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
                } else {
                  sliceCtx!.save();
                  const cx = sw / 2, cy = sh / 2;
                  sliceCtx!.translate(cx, cy);
                  sliceCtx!.rotate((slice.rotation * Math.PI) / 180);
                  if (slice.rotation === 90 || slice.rotation === 270) {
                    sliceCtx!.drawImage(fullFrameCanvas, sx, sy, sw, sh, -sh / 2, -sw / 2, sh, sw);
                  } else {
                    sliceCtx!.drawImage(fullFrameCanvas, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
                  }
                  sliceCtx!.restore();
                }

                // Apply per-slice color correction via CSS filter on a secondary canvas
                const hasBlend = slice.edgeBlendLeft > 0 || slice.edgeBlendRight > 0 || slice.edgeBlendTop > 0 || slice.edgeBlendBottom > 0;
                const hasColor = slice.brightness !== 1 || slice.contrast !== 1 || slice.gamma !== 1;

                let sendCanvas = sliceCanvas;

                if (hasBlend) {
                  // Apply per-slice edge blending
                  if (!sliceBlendCanvas || sliceBlendCanvas.width !== sw || sliceBlendCanvas.height !== sh) {
                    sliceBlendCanvas = document.createElement('canvas');
                    sliceBlendCanvas.width = sw;
                    sliceBlendCanvas.height = sh;
                    sliceBlendCtx = sliceBlendCanvas.getContext('2d');
                  }
                  if (sliceBlendCanvas.width !== sw || sliceBlendCanvas.height !== sh) {
                    sliceBlendCanvas.width = sw;
                    sliceBlendCanvas.height = sh;
                  }
                  sliceBlendCtx!.clearRect(0, 0, sw, sh);
                  sliceBlendCtx!.drawImage(sliceCanvas, 0, 0);
                  applyEdgeBlending(sliceBlendCtx!, sw, sh, {
                    edgeBlendLeft: slice.edgeBlendLeft,
                    edgeBlendRight: slice.edgeBlendRight,
                    edgeBlendTop: slice.edgeBlendTop,
                    edgeBlendBottom: slice.edgeBlendBottom,
                    edgeBlendGamma: slice.edgeBlendGamma,
                  });
                  sendCanvas = sliceBlendCanvas;
                }

                // Extract pixel data from the final slice canvas
                const slicePixels = (hasBlend ? sliceBlendCtx! : sliceCtx!).getImageData(0, 0, sw, sh).data;

                sliceSendInFlight.add(slice.id);
                const senderName = slice.spoutName || `ghostArcade-${slice.name}`;

                if (isElectron) {
                  invoke('spout_send_image', { data: new Uint8Array(slicePixels), width: sw, height: sh, senderName })
                    .catch(() => {}).finally(() => { sliceSendInFlight.delete(slice.id); });
                } else {
                  fetch(`http://127.0.0.1:9002/spout/send?width=${sw}&height=${sh}&sender=${encodeURIComponent(senderName)}`, {
                    method: 'POST',
                    body: new Uint8Array(slicePixels),
                  }).catch(() => {}).finally(() => { sliceSendInFlight.delete(slice.id); });
                }
              }
            } else if (!spoutSendInFlight) {
              // ── Legacy single-output path ────────────────────────────────
              // Checkpoint C: about to invoke IPC (single path)
              if (!(window as any).__sendCpC) (window as any).__sendCpC = 0;
              if ((window as any).__sendCpC < 3) {
                (window as any).__sendCpC++;
                console.log('[syphon-path] C: invoking spout_send_image (single path)', w, 'x', h, 'bytes=', spoutSendPixels.byteLength, 'isElectron=', isElectron);
              }
              spoutSendInFlight = true;
              if (isElectron) {
                invoke('spout_send_image', { data: spoutSendPixels, width: w, height: h })
                  .catch(() => {}).finally(() => { spoutSendInFlight = false; });
              } else {
                // Tauri / browser: HTTP binary POST to sidecar on port 9002
                fetch(`http://127.0.0.1:9002/spout/send?width=${w}&height=${h}`, {
                  method: 'POST',
                  body: spoutSendPixels as BodyInit,
                }).then(resp => {
                  if (!resp.ok && spoutSendLogCount < 5) {
                    spoutSendLogCount++;
                    console.warn(`Spout send HTTP ${resp.status}: ${resp.statusText}`);
                  }
                }).catch((e) => {
                  if (spoutSendLogCount < 5) {
                    spoutSendLogCount++;
                    console.warn('Spout send fetch error:', e);
                  }
                }).finally(() => { spoutSendInFlight = false; });
              }
            }
          }
        } // end else (not skipped frame)
        }
      }
      // FPS tracking — smooth average every 500ms
      fpsFrameCount++;
      const fpsNow = performance.now();
      const fpsElapsed = fpsNow - fpsLastTime;
      if (fpsElapsed >= 500) {
        const fpsValue = Math.round((fpsFrameCount * 1000) / fpsElapsed);
        fpsStore.set(fpsValue);
        fpsFrameCount = 0;
        fpsLastTime = fpsNow;

        // Periodic FPS log to the main-process log file. Prefix `[GPU]` is
        // whitelisted in the console-message forwarder. Log every ~5s so it's
        // useful without being spammy — and only when something is rendering.
        if (!((_fpsLogCount++ ) % 10)) {
          const layerCount = ($project?.layers?.length ?? 0);
          const dpr = window.devicePixelRatio || 1;
          const displayW = canvas.clientWidth;
          const displayH = canvas.clientHeight;
          console.log(`[GPU] mode=${isOutputMode ? 'output' : 'main'} FPS=${fpsValue}  layers=${layerCount}  drawingBuffer=${canvas.width}x${canvas.height}  display=${displayW}x${displayH}  dpr=${dpr}`);
          if (isOutputMode && (Math.abs(canvas.width - Math.round(displayW * dpr)) > 1 || Math.abs(canvas.height - Math.round(displayH * dpr)) > 1)) {
            console.warn(`[Output] Canvas backing store ${canvas.width}x${canvas.height} does not match display ${displayW}x${displayH} @ DPR ${dpr}. Use fullscreen output or Match Output Display to avoid compositor scaling.`);
          }
        }
      }

      _consecutiveFrameErrors = 0; // successful frame — reset the error streak
      } catch (err) {
        _consecutiveFrameErrors++;
        // Always log so errorReporter picks it up.
        console.error(`[Canvas] animate() frame error #${_consecutiveFrameErrors}:`, err);
        // If the same frame keeps throwing back-to-back, something is truly
        // wrong (dead GL context, corrupt state). Slow down to once a second
        // so we don't flood the log and burn CPU re-hitting the same bug.
        if (_consecutiveFrameErrors > 5) {
          animationId = setTimeout(animate, 1000) as unknown as number;
          return;
        }
      }
      animationId = requestAnimationFrame(animate);
    }
    animate();

    // Handle resize — observe the WRAPPER (parent) for size changes.
    // Use offsetWidth/offsetHeight (layout dimensions BEFORE CSS transforms like viewport zoom)
    // so the container matches App.svelte's canvasWidth/canvasHeight calculations.
    const resizeObserver = new ResizeObserver(() => {
      const { w: parentW, h: parentH } = getWrapperLayoutSize();
      if (engine && parentW > 0 && parentH > 0) {
          const pW = $project.width || 1920;
          const pH = $project.height || 1080;
          // Resize the container to fit the project aspect ratio within the wrapper
          sizeContainer(parentW, parentH);
          // Resize the engine drawing buffer to project resolution
          engine.resize(pW, pH);
          if (linesRenderer) {
            linesRenderer.resize(pW, pH);
          }
          // Resize SVG renderers
          for (const svgRenderer of svgRenderers.values()) {
            svgRenderer.resize(pW, pH);
          }
          // Resize SVG render targets
          for (const rt of svgRenderTargets.values()) {
            rt.setSize(pW, pH);
          }
          // Resize shader render targets (scale by per-layer quality)
          for (const [key, rt] of shaderRenderTargets.entries()) {
            const quality = shaderRenderTargetQualities.get(key) ?? 1.0;
            const rtW = Math.max(64, Math.round(pW * quality));
            const rtH = Math.max(64, Math.round(pH * quality));
            rt.setSize(rtW, rtH);
          }
      }
    });
    resizeObserver.observe(wrapperEl);

    return () => {
      unsubWatermark();
      unsubDome();
      resizeObserver.disconnect();
      glCanvas.removeEventListener('webglcontextlost', handleContextLost);
      glCanvas.removeEventListener('webglcontextrestored', handleContextRestored);
      canvas.removeEventListener('mousemove', handleCanvasMouseMove);
      canvas.removeEventListener('mouseleave', handleCanvasMouseLeave);
      canvas.removeEventListener('mouseenter', handleCanvasMouseEnter);
    };
  });

  // ── Engine layer cleanup ──────────────────────────────────────────────────
  // The engine accumulates a per-layer GPU resource bundle (RT, geometry,
  // material) in its `layerObjects` Map. Nothing was telling the engine
  // when a layer disappeared from the project (delete, undo-add, redo-delete),
  // so resources leaked. Worse: after an undo/redo round-trip a stale
  // layerObject for a removed layer could still get touched by the render
  // path (because Map iteration order doesn't follow project.layers), which
  // matched the user-reported "redo bricks the app" symptom on light-painting
  // layers. This reactive sweep walks the engine's known layer IDs each
  // project tick and tears down any that are no longer present.
  let _knownLayerIds = new Set<string>();
  $: if (engine && $project) {
    const liveIds = new Set($project.layers.map(l => l.id));
    for (const id of _knownLayerIds) {
      if (!liveIds.has(id)) {
        try { engine.removeLayer(id); } catch (e) { console.warn('[Canvas] engine.removeLayer failed for', id, e); }
      }
    }
    _knownLayerIds = liveIds;
  }

  // Re-resize engine when project dimensions change. Pre-guard the
  // reactive `$:` fired on ANY project store change (layer adds,
  // name edits, slider tweaks) and reallocated every shader/SVG RT,
  // stalling weak GPUs. Cache last-applied dims and bail unchanged.
  let _lastResizeW: number | null = null;
  let _lastResizeH: number | null = null;
  $: if (engine && $project.width && $project.height) {
    const pW = $project.width || 1920;
    const pH = $project.height || 1080;
    if (pW !== _lastResizeW || pH !== _lastResizeH) {
      // Re-calculate container size from wrapper layout dimensions (not affected by zoom transform)
      if (wrapperEl && wrapperEl.offsetWidth > 0 && wrapperEl.offsetHeight > 0) {
        _lastResizeW = pW;
        _lastResizeH = pH;
        sizeContainer(wrapperEl.offsetWidth, wrapperEl.offsetHeight);
        engine.resize(pW, pH);
        if (linesRenderer) linesRenderer.resize(pW, pH);
        for (const svgRenderer of svgRenderers.values()) svgRenderer.resize(pW, pH);
        for (const rt of svgRenderTargets.values()) rt.setSize(pW, pH);
        // Resize shader render targets (scale by per-layer quality)
        for (const [key, rt] of shaderRenderTargets.entries()) {
          const quality = shaderRenderTargetQualities.get(key) ?? 1.0;
          const rtW = Math.max(64, Math.round(pW * quality));
          const rtH = Math.max(64, Math.round(pH * quality));
          rt.setSize(rtW, rtH);
        }
      }
    }
  }

  // Mouse event handlers for splat layer interactions
  function handleCanvasMouseMove(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    mouseNormalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNormalizedY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    // Raw screen UV — (0,0) top-left, (1,1) bottom-right
    mouseRawU = (event.clientX - rect.left) / rect.width;
    mouseRawV = (event.clientY - rect.top) / rect.height;
    mouseOnCanvas = true;
  }

  function handleCanvasMouseLeave() {
    mouseOnCanvas = false;
  }

  function handleCanvasMouseEnter() {
    mouseOnCanvas = true;
  }

  // Detect output display resolution for "Match Output Display" setting
  let _detectedOutputRes: { width: number; height: number } | null = null;
  invoke('get_displays').then((displays: any) => {
    if (Array.isArray(displays) && displays.length > 0) {
      const external = displays.find((d: any) => !(d.isPrimary ?? d.primary));
      const target = external || displays[0];
      const bounds = target?.bounds || target;
      if (bounds) _detectedOutputRes = { width: bounds.width, height: bounds.height };
    }
  }).catch(() => {});

  // Reactive Spout output: start/stop sender when spoutEnabled changes.
  // Extract only the boolean to avoid re-triggering on every $settings change.
  // OSR window must NOT create a Spout sender — the main process handles it via paint events.
  let spoutEnabled = false;
  $: spoutEnabled = isTauri && !isOsrMode && !!$settings?.output?.spoutEnabled;
  let spoutStarting = false; // Prevent concurrent start calls

  $: if (spoutEnabled && !spoutOutputActive && !spoutStarting) {
    spoutStarting = true;
    const s = $settings?.output;
    const resSetting = s?.spoutResolution || 'match';
    let spoutW = 1920;
    let spoutH = 1080;
    if (resSetting === '4K') { spoutW = 3840; spoutH = 2160; }
    else if (resSetting === '720p') { spoutW = 1280; spoutH = 720; }
    else if (resSetting === 'WXGA') { spoutW = 1280; spoutH = 800; }
    else if (resSetting === 'WUXGA') { spoutW = 1920; spoutH = 1200; }
    else if (resSetting === 'custom') { spoutW = s?.customWidth || 1920; spoutH = s?.customHeight || 1080; }
    else if (resSetting === 'output') {
      // Use detected output display resolution (cached from startup)
      if (_detectedOutputRes) { spoutW = _detectedOutputRes.width; spoutH = _detectedOutputRes.height; }
    }
    else if (resSetting === 'match' && canvas) { spoutW = canvas.width; spoutH = canvas.height; }
    invoke('spout_start_sender', {
      name: s?.spoutName || 'ghostArcade',
      width: spoutW,
      height: spoutH,
    }).then((result: any) => {
      spoutOutputActive = true;
      spoutStarting = false;
      spoutSendLogCount = 0;
      const mode = result?.mode || 'unknown';
      console.log(`Spout output started: ${s?.spoutName} (${mode})`);
      showToast(`Spout started: ${s?.spoutName} ${spoutW}x${spoutH}`, 'info');
    }).catch((e: any) => {
      console.warn('Failed to start Spout sender:', e);
      showToast(`Spout failed: ${e?.message || e}`, 'error');
      spoutStarting = false;
    });
  } else if (!spoutEnabled && spoutOutputActive) {
    invoke('spout_stop_sender').catch(() => {});
    spoutOutputActive = false;
    console.log('Spout output stopped');
  }

  // Handle WebGL context loss
  function handleContextLost(event: Event) {
    event.preventDefault();
    console.warn('[Canvas] WebGL context lost - disposing GPU resources and pausing');
    // Dispose integrated effects immediately to release GPU memory
    // Wrap each in try/catch so one failure doesn't stop cleanup of the rest
    for (const effect of integratedEffects.values()) {
      try { effect.fluid?.dispose(); } catch (e) { console.warn('[Canvas] fluid dispose error:', e); }
      try { effect.particles?.dispose(); } catch (e) { console.warn('[Canvas] particles dispose error:', e); }
      try { if (effect.cameraTexture) { effect.cameraTexture.dispose(); effect.cameraTexture = undefined as any; } } catch {}
      try { if (effect.prevCameraTarget) { effect.prevCameraTarget.dispose(); effect.prevCameraTarget = undefined as any; } } catch {}
      try { effect.cameraStream?.getTracks().forEach(t => t.stop()); } catch {}
      try { effect.renderTarget.dispose(); } catch {}
    }
    integratedEffects.clear();
    contextLost = true;
  }

  // Handle WebGL context restoration
  function handleContextRestored() {
    console.log('[Canvas] WebGL context restored - clearing caches and resuming');
    contextLost = false;

    // Rebuild the engine's internal render targets + blend materials. Before
    // this call, the handles still pointed at freed GPU resources — draws
    // would fail silently and the user would see a black canvas until a
    // full resize forced setSize(). Not recreating these was the biggest
    // hole in the context-restore path.
    try { engine?.reinitAfterContextRestore?.(); } catch (e) { console.warn('[Canvas] engine reinit error:', e); }

    // Clear all caches so resources get recreated
    for (const texture of textureCache.values()) {
      texture.dispose();
    }
    textureCache.clear();
    loadingTextures.clear();

    // Clear shader instances
    for (const shader of shaderInstances.values()) {
      shader.material.dispose();
    }
    shaderInstances.clear();

    for (const rt of shaderRenderTargets.values()) {
      rt.dispose();
    }
    shaderRenderTargets.clear();

    // Clear lines render targets
    for (const rt of linesRenderTargets.values()) {
      rt.dispose();
    }
    linesRenderTargets.clear();

    // Clear SVG renderers
    for (const svgRenderer of svgRenderers.values()) {
      svgRenderer.dispose();
    }
    svgRenderers.clear();

    for (const rt of svgRenderTargets.values()) {
      rt.dispose();
    }
    svgRenderTargets.clear();

    // Clear integrated effects
    for (const effect of integratedEffects.values()) {
      effect.fluid?.dispose();
      effect.particles?.dispose();
      effect.renderTarget.dispose();
    }
    integratedEffects.clear();

    // Clear splat renderers
    for (const splatCtx of splatRenderers.values()) {
      splatCtx.renderer.dispose();
      splatCtx.renderTarget.dispose();
    }
    splatRenderers.clear();

    // Clear model3d renderers
    for (const model3dCtx of model3dRenderers.values()) {
      model3dCtx.renderer.dispose();
      model3dCtx.renderTarget.dispose();
    }
    model3dRenderers.clear();
  }

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    engine?.dispose();

    // S4 pilot teardown — unsubscribe from the settings reactive and
    // dispose the pilot if active. Synchronous fire-and-forget on the
    // dispose Promise: the WebGPURenderer's queued work resolves
    // asynchronously but the renderer itself tears down its device
    // synchronously enough that we don't need to await here.
    if (webgpuPilotUnsub) {
      try { webgpuPilotUnsub(); } catch { /* */ }
      webgpuPilotUnsub = null;
    }
    if (webgpuPilot) {
      const dying = webgpuPilot;
      webgpuPilot = null;
      void dying.dispose();
      resetWebgpuPilotMetrics();
    }
    if (webgpuHandoffTexture) {
      const gl2 = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
      try { gl2?.deleteTexture(webgpuHandoffTexture); } catch { /* */ }
      webgpuHandoffTexture = null;
    }

    // Experimental WebRTC output transport teardown — unsubscribe from
    // the flag reactive and tear down any active peer. Fire-and-forget;
    // the BroadcastChannel close + RTCPeerConnection close are both
    // synchronous enough that we don't need to await.
    if (outputWebRTCUnsub) {
      try { outputWebRTCUnsub(); } catch { /* */ }
      outputWebRTCUnsub = null;
    }
    stopOutputPixelBroadcast();
    stopOutputSharedTexturePresenter();

    if (nativeRendererStatusTimer) {
      clearInterval(nativeRendererStatusTimer);
      nativeRendererStatusTimer = null;
    }
    if (nativeLayersUnsub) {
      nativeLayersUnsub();
      nativeLayersUnsub = null;
    }
    if (nativeProjectUnsub) {
      nativeProjectUnsub();
      nativeProjectUnsub = null;
    }
    if (nativeRendererSync) {
      void nativeRendererSync.stop();
      nativeRendererSync = null;
    }

    destroyStateBroadcast();

    // Dispose textures
    for (const texture of textureCache.values()) {
      texture.dispose();
    }
    textureCache.clear();

    // Dispose shader resources
    for (const shader of shaderInstances.values()) {
      shader.material.dispose();
    }
    shaderInstances.clear();

    for (const rt of shaderRenderTargets.values()) {
      rt.dispose();
    }
    shaderRenderTargets.clear();

    // Dispose lines renderer
    if (linesRenderer) {
      linesRenderer.dispose();
    }
    window.removeEventListener('lines-reset-animations', handleLinesResetAnimations);

    // Dispose lines render targets
    for (const rt of linesRenderTargets.values()) {
      rt.dispose();
    }
    linesRenderTargets.clear();

    // Dispose SVG renderers and render targets
    for (const svgRenderer of svgRenderers.values()) {
      svgRenderer.dispose();
    }
    svgRenderers.clear();

    for (const rt of svgRenderTargets.values()) {
      rt.dispose();
    }
    svgRenderTargets.clear();

    // Dispose integrated effects
    for (const effect of integratedEffects.values()) {
      effect.fluid?.dispose();
      effect.particles?.dispose();
      effect.renderTarget.dispose();
    }
    integratedEffects.clear();

    // Dispose splat renderers
    for (const splatCtx of splatRenderers.values()) {
      splatCtx.renderer.dispose();
      splatCtx.renderTarget.dispose();
    }
    splatRenderers.clear();

    // Dispose model3d renderers
    for (const model3dCtx of model3dRenderers.values()) {
      model3dCtx.renderer.dispose();
      model3dCtx.renderTarget.dispose();
    }
    model3dRenderers.clear();

    // Dispose Spout receivers
    for (const receiver of spoutReceivers.values()) {
      // Stop polling (Electron IPC path)
      if ((receiver as any)._stopPolling) {
        (receiver as any)._stopPolling();
      }
      // Close WebSocket (Tauri WS path)
      if (receiver.frameWs) {
        try { receiver.frameWs.send(JSON.stringify({ type: 'unsubscribe_spout' })); } catch {}
        receiver.frameWs.close();
      }
      receiver.texture.dispose();
      // Stop the receiver via IPC
      invoke('spout_stop_receiver', { senderName: receiver.senderName }).catch(() => {});
    }
    spoutReceivers.clear();
  });

  // Track active layer sources to detect changes
  const activeLayerSources = new Map<string, string>();

  // Synchronous texture update - kicks off async loads but doesn't block.
  //
  // `cleanupStale` controls whether the end-of-function pass disposes
  // shader instances / render targets for layers that aren't in `layerList`.
  // In stage mode, animate() calls updateAllTextures twice per frame:
  //   1) with [...vjLayers, ...normalLayers]  — the full universe
  //   2) with cachedStageLayers (screens only) — the subset actually rendered
  // If the second call cleans up "stale" layers, it disposes every VJ shader's
  // instance and render target every frame (because vj-layer-N isn't in
  // cachedStageLayers). Then the next frame rebuilds them. That's what was
  // recreating the VJ shader RT each frame and leaving the stage-injected
  // screens sampling a freshly-allocated, never-rendered texture.
  function updateTexturesSync(layerList: Layer[], cleanupStale: boolean = true) {
    // Track which layers are currently active
    const currentLayerIds = new Set<string>();

    for (const layer of layerList) {
      currentLayerIds.add(layer.id);

      if (!layer.source) {
        // If layer no longer has a source, clean up its old resources
        const oldSrc = activeLayerSources.get(layer.id);
        if (oldSrc) {
          cleanupLayerShader(layer.id, oldSrc);
          activeLayerSources.delete(layer.id);
        }
        continue;
      }

      // Stage-mode injected sources: the VJ deck pass that ran earlier in
      // this frame already loaded the texture and marked it on source.texture.
      // Running through the full cache-key / loadTextureAsync / videoTexture
      // needsUpdate pipeline on the Screen clone does nothing useful and can
      // null out the injected texture (loadTextureAsync for an unknown pseudo-
      // type returns without setting anything; a cache lookup under a
      // different key may overwrite). Just leave the injection alone.
      if ((layer.source as any).__vjStage) continue;

      // Use source.src as the primary cache key for SHARED texture lookup
      // This allows VJ layers (which have different IDs) to reuse loaded textures
      // EXCEPTION: AI-generated content uses source.id because source.src is always
      // 'ai-generated' or 'js-animation', which would cause all AI items to share a texture
      // EXCEPTION: SynthVision clips use empty src which collides across mounts — use unique ID
      const isAIGenerated = layer.source.src === 'ai-generated' || layer.source.src === 'js-animation';
      // Performer clips flow through the VJ deck as type:'threejs' with a
      // threejsCanvas and an empty src — without tagging them as
      // synth-vision-like here, two stages pointing at different performers
      // both hash to textureCacheKey='' and steal each other's cache entry
      // on every frame, which is what the "performer flickers when another
      // stage has video" report was showing.
      const isSynthVision =
        layer.source.type === 'synthvision' ||
        (!layer.source.src && (layer.source as any).synthVisionCanvas) ||
        (layer.source.type === 'threejs' && (layer.source as any).threejsCanvas && !layer.source.src);
      // VJ video layers need their own cache namespace because each VJ
      // clip has its own private HTMLVideoElement (built by
      // vjClipLauncher.prepareClipVideo, keyed per-clip), separate from
      // any element the same URL has in the mapping-mode media library.
      // If we shared a URL-keyed cache between the two, VJ layers would
      // get back a texture wrapping mapping-mode's videoElement —
      // visible as a frozen frame from whatever the mapping clip last
      // sampled. Namespacing by layer.id + src keeps them isolated.
      const isVJVideoLayer =
        layer.source.type === 'video' &&
        typeof layer.id === 'string' && layer.id.startsWith('vj-layer-');
      const textureCacheKey =
        (isAIGenerated || isSynthVision) ? layer.source.id
        : isVJVideoLayer ? `${layer.id}:${layer.source.src}`
        : layer.source.src;
      // Layer-specific cache key for shader instances (which may have per-layer state)
      const shaderCacheKey = `${layer.id}:${textureCacheKey}`;

      // Check if source changed for this layer - if so, cleanup old resources
      // Use textureCacheKey for comparison to properly detect AI-generated content changes
      const oldCacheKey = activeLayerSources.get(layer.id);
      if (oldCacheKey && oldCacheKey !== textureCacheKey) {
        cleanupLayerShader(layer.id, oldCacheKey);
      }
      activeLayerSources.set(layer.id, textureCacheKey);

      // If texture exists in cache, ALWAYS assign it to the source object
      // This handles cases where the store creates new source objects
      // For shaders, use the full shaderCacheKey; for other media, use textureCacheKey
      const isShader = layer.source.type === 'shader';
      const lookupKey = isShader ? shaderCacheKey : textureCacheKey;

      if (textureCache.has(lookupKey)) {
        const cachedTexture = textureCache.get(lookupKey)!;
        // For SynthVision/canvas sources: if the underlying canvas element changed
        // (e.g., component was destroyed and remounted), invalidate the stale texture
        // and create a fresh one from the new canvas
        if (isSynthVision && layer.source.threejsCanvas &&
            (cachedTexture as THREE.CanvasTexture).image !== layer.source.threejsCanvas) {
          console.log('[Canvas] SynthVision canvas changed, invalidating stale texture for:', lookupKey);
          cachedTexture.dispose();
          textureCache.delete(lookupKey);
          loadingTextures.delete(lookupKey);
          // Fall through to create new texture below
        } else {
          // Always assign - the source object reference may have changed due to store updates
          layer.source.texture = cachedTexture;
          // Bump this entry to most-recent so true-LRU eviction won't
          // drop a texture that's actively in use. Without this, the
          // first-inserted texture gets evicted even when it's still
          // mapped on a layer ("clip frozen after playing for a bit").
          touchTextureCacheEntry(lookupKey);
        }
      }
      // If not loading yet, start async load — skip entirely if a previous
      // attempt permanently failed (see failedTextures).
      if (!textureCache.has(lookupKey) && !loadingTextures.has(lookupKey) && !failedTextures.has(lookupKey)) {
        loadingTextures.add(lookupKey);
        // Pass layer.id instead of layer reference to avoid stale closure
        // For shaders, pass the full shaderCacheKey so instances are stored correctly
        loadTextureAsync(layer.id, layer.source, lookupKey);
      }

      // Video textures need to be marked for update every frame so the
      // GPU resamples each decoded frame — but ONLY when the video has
      // actual frame data. Setting `needsUpdate=true` while the element
      // is still loading (readyState < 2 OR videoWidth === 0) makes
      // three.js call `texImage2D(..., video)` on an empty source, which
      // returns `WebGL: INVALID_VALUE: texImage2D: no video` and leaves
      // the texture in an undefined state. On Electron 42 / three.js
      // 0.184 that broken texture is what shows up as the horizontal
      // lines / black bars on the output window after rapid clip
      // switching.
      if (layer.source.type === 'video') {
        const vEl = layer.source.videoElement;
        const ready = !!vEl && vEl.readyState >= 2 /* HAVE_CURRENT_DATA */ && vEl.videoWidth > 0 && vEl.videoHeight > 0;
        if (layer.source.texture && ready) {
          (layer.source.texture as THREE.VideoTexture).needsUpdate = true;
        }

        // Video health watchdog — gated behind window.__VIDEO_DEBUG__ so
        // it doesn't spam in normal sessions. Logs once per state change
        // per layer. Set `__VIDEO_DEBUG__ = true` in DevTools to enable.
        if ((window as any).__VIDEO_DEBUG__) {
          const tex = layer.source.texture as THREE.VideoTexture | null | undefined;
          const dbgKey = `__vidDbg_${layer.id}`;
          const elIdHandle = vEl as any;
          if (vEl && !elIdHandle.__gaElId) {
            elIdHandle.__gaElId = `el#${Math.floor(Math.random() * 0xffff).toString(16)}`;
          }
          const cur = {
            ready,
            paused: !!vEl?.paused,
            readyState: vEl?.readyState ?? -1,
            videoWidth: vEl?.videoWidth ?? 0,
            videoHeight: vEl?.videoHeight ?? 0,
            currentTime: vEl?.currentTime?.toFixed(2) ?? 'n/a',
            duration: vEl?.duration?.toFixed(2) ?? 'n/a',
            srcShort: (vEl?.src || '').slice(-50),
            hasTexture: !!tex,
            textureImageMatchesElement: tex?.image === vEl,
            elId: elIdHandle?.__gaElId ?? 'n/a',                     // identifies WHICH HTMLVideoElement
            textureImageElId: (tex?.image as any)?.__gaElId ?? 'n/a', // and which one the texture wraps
          };
          const prev = (window as any)[dbgKey];
          const changed = !prev ||
            prev.ready !== cur.ready ||
            prev.paused !== cur.paused ||
            prev.readyState !== cur.readyState ||
            prev.hasTexture !== cur.hasTexture ||
            prev.textureImageMatchesElement !== cur.textureImageMatchesElement ||
            prev.srcShort !== cur.srcShort ||
            prev.elId !== cur.elId ||
            prev.textureImageElId !== cur.textureImageElId;
          if (changed) {
            (window as any)[dbgKey] = cur;
            const matchTag = cur.textureImageMatchesElement ? 'OK' : 'MISMATCH';
            console.log(
              `[VIDEO] layer=${layer.id.slice(0, 8)}`,
              `el=${cur.elId}`,
              `texEl=${cur.textureImageElId}`,
              `match=${matchTag}`,
              `tex=${cur.hasTexture}`,
              `rs=${cur.readyState}`,
              `dim=${cur.videoWidth}x${cur.videoHeight}`,
              `t=${cur.currentTime}`,
              `paused=${cur.paused}`,
              `src=${cur.srcShort}`,
            );
          }
        }

        const video = layer.source.videoElement;
        if (video && isFinite(video.duration) && video.duration > 0) {
          const source = layer.source;
          const mode = source.playbackMode || 'loop';
          const rate = source.playbackRate ?? 1.0;
          const trimS = source.trimStart ?? 0;
          const trimE = source.trimEnd ?? 1;
          const trimStartTime = trimS * video.duration;
          const trimEndTime = trimE * video.duration;
          // Whether the user wants the video playing (UI toggle)
          const wantsPlaying = source.isPlaying !== false;

          // Always disable native loop — we manage looping manually for trim
          video.loop = false;

          // Set playback rate for forward-playing modes
          if (mode !== 'timelapse') {
            if (Math.abs(video.playbackRate - rate) > 0.01) {
              video.playbackRate = rate;
            }
          }

          // Handle playback modes
          if (mode === 'timelapse') {
            // Timelapse: video is paused, frame stepping is driven by a timer in MediaTray
            if (!video.paused) video.pause();

          } else if (mode === 'loop') {
            // Loop with trim support — only auto-play if user hasn't paused
            if (video.paused && wantsPlaying) {
              video.play().catch(() => {});
            }
            // Reached trim end? Loop back to trim start
            if (video.currentTime >= trimEndTime - 0.05) {
              video.currentTime = trimStartTime;
            }

          } else if (mode === 'once') {
            // Play once within trim region
            if (video.currentTime >= trimEndTime - 0.08) {
              // Reached end — pause
              if (!video.paused) {
                video.pause();
                source.isPlaying = false;
              }
            } else if (video.paused && wantsPlaying) {
              video.play().catch(() => {});
            }
          }

          // Gentle trim start clamping — only jump if video is significantly before trim start
          // (avoids fighting with seeks and dragging trim handles)
          if (mode !== 'timelapse' && video.currentTime < trimStartTime - 0.15) {
            video.currentTime = trimStartTime;
          }
        }
      }

      // Three.js iframe sources need their canvas texture updated each frame
      if (layer.source.type === 'threejs' && !layer.source.jsAnimation) {
        // SynthVision sources have threejsCanvas set directly (no iframe context)
        if (layer.source.threejsCanvas && !getThreeJSIframeContext(layer.source.id)) {
          // Direct canvas source (e.g., SynthVision) - just mark texture dirty
          if (layer.source.texture) {
            (layer.source.texture as THREE.CanvasTexture).needsUpdate = true;
          }
        } else {
          // Get the iframe context and update the canvas capture (built-in threejs)
          const iframeContext = getThreeJSIframeContext(layer.source.id);
          if (iframeContext) {
            iframeContext.updateTexture();
            // Mark the texture as needing update
            if (layer.source.texture) {
              (layer.source.texture as THREE.CanvasTexture).needsUpdate = true;
            }
          }
        }
      }

      // AI-generated JS animations (threejs or p5js with jsAnimation) need texture updates
      if ((layer.source.type === 'threejs' || layer.source.type === 'p5js') && layer.source.jsAnimation) {
        const jsContext = getJSAnimationContext(layer.source.id);
        if (jsContext) {
          jsContext.updateTexture();
          if (layer.source.texture) {
            (layer.source.texture as THREE.CanvasTexture).needsUpdate = true;
          }
        }
      }
    }

    // Cleanup resources for layers that no longer exist.
    // Skip when the caller passed only a subset of layers (stage-mode second
    // pass) — otherwise we'd dispose the upstream VJ layer's resources every
    // frame, forcing a fresh RT allocation each frame and leaving the Screen
    // layers sampling a never-rendered texture.
    if (!cleanupStale) return;
    for (const [layerId, src] of activeLayerSources.entries()) {
      if (!currentLayerIds.has(layerId)) {
        cleanupLayerShader(layerId, src);
        activeLayerSources.delete(layerId);
      }
    }
  }

  // Cleanup shader resources for a layer
  function cleanupLayerShader(layerId: string, src: string) {
    const cacheKey = `${layerId}:${src}`;

    // Dispose shader instance
    const shader = shaderInstances.get(cacheKey);
    if (shader) {
      shader.material.dispose();
      for (const texture of shader.inputTextures.values()) {
        texture.dispose();
      }
      shaderInstances.delete(cacheKey);
      console.log('[Canvas] Disposed shader instance:', cacheKey);
    }

    // Dispose render target
    const rt = shaderRenderTargets.get(cacheKey);
    if (rt) {
      rt.dispose();
      shaderRenderTargets.delete(cacheKey);
    }

    // Dispose texture from cache (shader key format: layerId:src)
    const texture = textureCache.get(cacheKey);
    if (texture) {
      texture.dispose();
      textureCache.delete(cacheKey);
    }

    // Also check non-shader key format (used by SynthVision, AI-generated, etc.)
    // The src IS the source.id for these types
    const altTexture = textureCache.get(src);
    if (altTexture) {
      altTexture.dispose();
      textureCache.delete(src);
      console.log('[Canvas] Disposed stale texture for source:', src);
    }
    loadingTextures.delete(src);
  }

  // Async texture loading
  // Takes layerId and source snapshot to avoid stale closure issues
  async function loadTextureAsync(layerId: string, source: import('../types').MediaSource, cacheKey: string) {
    try {
      let texture: THREE.Texture | null = null;

      if (source.type === 'image') {
        texture = await loadImageTexture(source.src);
      } else if (source.type === 'video') {
        // Get video element - either from source or create a new one
        let video = source.videoElement;

        // If no video element exists, create one
        if (!video) {
          video = document.createElement('video');
          // Only set crossOrigin for remote URLs, not blob: URLs
          if (!source.src.startsWith('blob:')) {
            video.crossOrigin = 'anonymous';
          }
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.src = source.src;

          // Wait for video to load. The src setter SHOULD auto-trigger
          // the resource selection algorithm but for custom protocol URLs
          // on Chromium 130 (Electron 42), the auto-trigger sometimes
          // never fires loadeddata — so we kick `.load()` explicitly.
          // SAFE on a fresh element (no concurrent ops to abort). For
          // REUSED elements (VJ rapid clip switch), do NOT call load() —
          // it races any in-flight load + pending play() and throws
          // AbortError on Chromium 130.
          await new Promise<void>((resolve, reject) => {
            const v = video!;
            const onLoaded = () => { cleanup(); resolve(); };
            const onError = () => { cleanup(); reject(new Error('Video failed to load')); };
            const cleanup = () => {
              v.removeEventListener('loadeddata', onLoaded);
              v.removeEventListener('error', onError);
            };
            v.addEventListener('loadeddata', onLoaded, { once: true });
            v.addEventListener('error', onError, { once: true });
            v.load();  // Fresh element only — see big comment above.
          });

          // Store reference on the layer's source
          const currentLayers = $layers;
          const layer = currentLayers.find(l => l.id === layerId);
          if (layer?.source) {
            layer.source.videoElement = video;
          }
        }

        // Wait for video to have actual frame data
        if (video.readyState < 2) { // HAVE_CURRENT_DATA
          await new Promise<void>((resolve) => {
            const checkReady = () => {
              if (video!.readyState >= 2) {
                resolve();
              } else {
                requestAnimationFrame(checkReady);
              }
            };
            video!.oncanplay = () => resolve();
            checkReady();
          });
        }

        // Ensure video is playing
        if (video.paused) {
          try {
            await video.play();
          } catch (e) {
            console.warn('Video play failed:', e);
          }
        }

        // Wait one more frame to ensure video has rendered
        await new Promise(resolve => requestAnimationFrame(resolve));

        texture = createVideoTexture(video);
        source.isPlaying = !video.paused;
      } else if (source.type === 'shader' && source.shaderCode) {
        // Create ISF shader instance
        console.log('Creating ISF shader for layer:', layerId, 'shader:', source.name);
        const shaderInstance = createISFShader(
          source.id,
          source.name,
          source.shaderCode
        );

        if (shaderInstance) {
          console.log('Shader instance created successfully for:', source.name);
          shaderInstances.set(cacheKey, shaderInstance);

          // Create render target at project resolution (scaled by renderQuality)
          // renderQuality < 1.0 renders at lower resolution for heavy shaders (e.g. raymarchers)
          // LinearFilter upscales smoothly to the final output
          const projectData = get(project);
          const baseWidth = projectData.width || 1920;
          const baseHeight = projectData.height || 1080;
          const currentLayer = get(layers).find(l => l.id === layerId);
          const quality = currentLayer?.renderQuality ?? SHADER_QUALITY_MULTIPLIERS[get(settings).ui.shaderQuality] ?? 1.0;
          const rtWidth = Math.max(64, Math.round(baseWidth * quality));
          const rtHeight = Math.max(64, Math.round(baseHeight * quality));
          console.log(`Creating shader render target: ${rtWidth}x${rtHeight} (quality: ${quality})`);
          const renderTarget = new THREE.WebGLRenderTarget(rtWidth, rtHeight, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
          });
          shaderRenderTargets.set(cacheKey, renderTarget);
          // Store quality so we can detect changes and resize
          shaderRenderTargetQualities.set(cacheKey, quality);

          // Apply initial parameter values from layer source
          if (source.shaderValues) {
            for (const [name, value] of Object.entries(source.shaderValues)) {
              setISFInputValue(shaderInstance, name, value as number | boolean | number[]);
            }
          }

          // Use the render target's texture
          texture = renderTarget.texture;
          console.log('Shader render target texture assigned:', texture);

          // No force-resize needed — render targets use project dimensions directly,
          // and the canvas CSS (width: 100%; height: 100%) handles display sizing.
          // Calling engine.resize() here was causing dimension race conditions.
        } else {
          // Fallback to magenta if shader failed to compile
          console.error('Shader creation failed, using fallback magenta texture');
          showToast('Shader compilation failed for: ' + (source.name || 'unknown'));
          const data = new Uint8Array([255, 0, 170, 255]);
          texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
          texture.needsUpdate = true;
        }
      } else if (source.type === 'threejs' && !source.jsAnimation && source.threejsCanvas && !getThreeJSIframeContext(source.id)) {
        // Direct canvas source (e.g., SynthVision) - create CanvasTexture directly
        const canvasTex = new THREE.CanvasTexture(source.threejsCanvas);
        canvasTex.minFilter = THREE.LinearFilter;
        canvasTex.magFilter = THREE.LinearFilter;
        canvasTex.format = THREE.RGBAFormat;
        texture = canvasTex;
        console.log('Direct canvas texture assigned for:', source.name);
      } else if (source.type === 'threejs' && !source.jsAnimation) {
        // Built-in Three.js items (from /threejs folder)
        // Get or create the iframe context and use its canvas texture
        let iframeContext = getThreeJSIframeContext(source.id);
        if (!iframeContext && source.src) {
          // Create iframe context if it doesn't exist
          console.log('Creating ThreeJS iframe context for:', source.name, source.src);
          iframeContext = createThreeJSIframeContext(source.id, source.src);
        }
        if (iframeContext) {
          // Wait for iframe to load (give it a moment to initialize)
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Update once to capture initial frame
          iframeContext.updateTexture();
          texture = iframeContext.texture;
          console.log('ThreeJS iframe texture assigned for:', source.name);
        } else {
          // Fallback to a colored texture if iframe context doesn't exist
          console.warn('ThreeJS iframe context not found for:', source.id);
          const data = new Uint8Array([255, 165, 0, 255]); // Orange fallback
          texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
          texture.needsUpdate = true;
        }
      } else if ((source.type === 'threejs' || source.type === 'p5js') && source.jsAnimation) {
        // AI-generated or uploaded JavaScript animations
        let jsContext = getJSAnimationContext(source.id);
        if (!jsContext && source.jsAnimation) {
          // Create JS animation context from the HTML code
          console.log('Creating JS animation context for:', source.name, source.type);
          jsContext = createJSAnimationContext(source.id, source.jsAnimation);
        }
        if (jsContext) {
          // Wait for iframe to load (give it a moment to initialize)
          await new Promise(resolve => setTimeout(resolve, 1500));
          // Update once to capture initial frame
          jsContext.updateTexture();
          texture = jsContext.texture;
          console.log('JS animation texture assigned for:', source.name, source.jsAnimation?.animationType);
        } else {
          // Fallback to a colored texture if context doesn't exist
          console.warn('JS animation context not found for:', source.id);
          const data = new Uint8Array([255, 100, 150, 255]); // Pink fallback for JS
          texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
          texture.needsUpdate = true;
        }
      } else if (source.type === 'spout' && source.spoutSource && isTauri && !isOsrMode) {
        // Spout source — receives frames from a Spout sender.
        // In Electron: uses IPC to poll the native addon's ReceiveImage (RGBA pixels).
        // In Tauri: uses WebSocket binary push from the Rust backend.
        // Disabled in OSR mode — the OSR window only renders, doesn't receive Spout.
        const senderName = source.spoutSource.senderName;
        console.log('[Spout] Creating receiver for:', senderName);

        let receiver = spoutReceivers.get(cacheKey);
        if (!receiver) {
          try {
            console.log('[Spout] Calling spout_start_receiver for:', senderName);
            const info = await invoke<{ name: string; width: number; height: number; connected: boolean }>('spout_start_receiver', { senderName });
            console.log('[Spout] Receiver started, info:', info);

            const width = info.width || source.spoutSource.width || 1920;
            const height = info.height || source.spoutSource.height || 1080;

            // Create DataTexture with initial purple test pattern
            const pixelData = new Uint8Array(width * height * 4);
            for (let i = 0; i < pixelData.length; i += 4) {
              pixelData[i] = 128; pixelData[i+1] = 0; pixelData[i+2] = 128; pixelData[i+3] = 255;
            }
            const dataTexture = new THREE.DataTexture(pixelData, width, height, THREE.RGBAFormat);
            dataTexture.minFilter = THREE.LinearFilter;
            dataTexture.magFilter = THREE.LinearFilter;
            dataTexture.needsUpdate = true;

            receiver = {
              senderName,
              texture: dataTexture,
              frameWs: null,
              width,
              height,
            };
            spoutReceivers.set(cacheKey, receiver);

            if (isElectron) {
              // Electron path: poll frames via IPC from the native Spout addon.
              // The addon receives GPU textures from Spout, reads them back to RGBA,
              // and returns the pixel buffer via IPC.
              let recvActive = true;
              let recvFrameCount = 0;
              const recvCacheKey = cacheKey;

              let recvNullCount = 0;
              let recvLastDiag = Date.now();
              let recvRafId: number | null = null;
              let recvInFlight = false; // Prevent overlapping IPC calls
              let recvReuseBuf: Uint8Array | null = null; // Reuse buffer to reduce GC

              const pollFrame = () => {
                if (!recvActive) return;
                const recv = spoutReceivers.get(recvCacheKey);
                if (!recv) {
                  console.log('[Spout] Polling stopped: receiver removed from cache for', senderName);
                  recvActive = false;
                  return;
                }
                // Don't fire another IPC call if the previous one hasn't returned yet
                if (recvInFlight) {
                  recvRafId = requestAnimationFrame(pollFrame);
                  return;
                }
                recvInFlight = true;

                invoke<{ data: ArrayBuffer; width: number; height: number } | null>('spout_receive_frame')
                  .then((frame) => {
                    recvInFlight = false;
                    if (!recvActive) return;

                    if (frame && frame.data) {
                      const w = frame.width;
                      const h = frame.height;
                      const expectedSize = w * h * 4;

                      // Reuse the Uint8Array wrapper to reduce GC pressure
                      if (!recvReuseBuf || recvReuseBuf.byteLength !== expectedSize) {
                        recvReuseBuf = new Uint8Array(frame.data);
                      } else {
                        recvReuseBuf.set(new Uint8Array(frame.data));
                      }
                      const frameData = recvReuseBuf;

                      recvFrameCount++;
                      if (recvFrameCount <= 3) {
                        let nonZero = 0;
                        const checkLen = Math.min(frameData.length, 4000);
                        for (let i = 0; i < checkLen; i++) {
                          if (frameData[i] !== 0) nonZero++;
                        }
                        console.log(`[Spout] IPC frame #${recvFrameCount} for:`, senderName, w, 'x', h, 'bytes:', frameData.length, 'nonZero:', nonZero + '/' + checkLen);
                      }

                      if (frameData.length !== expectedSize) {
                        // Size mismatch — skip this frame
                        return;
                      }

                      const tex = recv.texture;

                      // Handle dimension change
                      if (tex.image.width !== w || tex.image.height !== h) {
                        console.log('[Spout] Resizing texture to:', w, 'x', h);
                        const newData = new Uint8Array(frameData);
                        const newTex = new THREE.DataTexture(newData, w, h, THREE.RGBAFormat);
                        newTex.minFilter = THREE.LinearFilter;
                        newTex.magFilter = THREE.LinearFilter;
                        newTex.needsUpdate = true;
                        recv.texture = newTex;
                        recv.width = w;
                        recv.height = h;
                        tex.dispose();
                        textureCache.set(recvCacheKey, newTex);
                        evictTextureCache();
                      } else if (tex.image.data) {
                        // Update via THREE's own upload path. Earlier revisions
                        // cached the underlying WebGLTexture handle and called
                        // gl.bindTexture + gl.texSubImage2D directly to skip
                        // THREE's per-frame bookkeeping. That handle routinely
                        // went stale (THREE recreates the GL texture on cache
                        // eviction, renderer resize, material rebuild, etc.),
                        // and the next bindTexture triggered INVALID_OPERATION:
                        // attempt to use a deleted object — once per poll, for
                        // the rest of the session. The resulting error spam
                        // dominated the console and wedged the renderer. Going
                        // through tex.image.data.set + needsUpdate lets THREE
                        // revalidate the GL texture each frame; the saving of
                        // a single texSubImage2D is not worth the breakage.
                        tex.image.data.set(frameData);
                        tex.needsUpdate = true;
                      }
                      recvNullCount = 0;
                    } else {
                      recvNullCount++;
                      const now = Date.now();
                      if (now - recvLastDiag > 5000) {
                        console.log(`[Spout] Recv poll: ${recvFrameCount} frames, ${recvNullCount} nulls, active=${recvActive}`, senderName);
                        recvLastDiag = now;
                      }
                    }
                  })
                  .catch((err: any) => {
                    recvInFlight = false;
                    console.error('[Spout] Recv poll error:', err?.message || err);
                  });

                // Schedule next frame — rAF syncs with display refresh and avoids
                // wasting CPU/IPC cycles polling faster than the monitor can show
                if (recvActive) {
                  recvRafId = requestAnimationFrame(pollFrame);
                }
              };

              // Start polling on next animation frame
              recvRafId = requestAnimationFrame(pollFrame);

              // Store cleanup function
              (receiver as any)._stopPolling = () => {
                recvActive = false;
                if (recvRafId !== null) {
                  cancelAnimationFrame(recvRafId);
                  recvRafId = null;
                }
              };

            } else {
              // Tauri path: HTTP polling for Spout receive frames.
              // The Rust worker thread receives frames via DX11 and stores them in a HashMap.
              // We poll via HTTP GET /spout/receive/{senderName} for the latest frame.
              const recvCacheKey = cacheKey;
              let httpRecvActive = true;
              let httpRecvCount = 0;
              let httpRecvInFlight = false;

              const pollHttpFrame = async () => {
                if (!httpRecvActive) return;
                const recv = spoutReceivers.get(recvCacheKey);
                if (!recv) { httpRecvActive = false; return; }
                if (httpRecvInFlight) { requestAnimationFrame(pollHttpFrame); return; }

                httpRecvInFlight = true;
                try {
                  const resp = await fetch(`http://127.0.0.1:9002/spout/receive/${encodeURIComponent(senderName)}`);
                  if (resp.status === 204 || !resp.ok) {
                    // No frame available yet
                    httpRecvInFlight = false;
                    if (httpRecvActive) requestAnimationFrame(pollHttpFrame);
                    return;
                  }

                  const buf = await resp.arrayBuffer();
                  const frameData = new Uint8Array(buf);
                  const w = recv.width;
                  const h = recv.height;
                  const expectedSize = w * h * 4;

                  httpRecvCount++;
                  if (httpRecvCount <= 3) {
                    console.log(`[Spout] HTTP recv #${httpRecvCount}:`, senderName, w, 'x', h, 'bytes:', frameData.length);
                  }

                  if (frameData.length === expectedSize) {
                    const tex = recv.texture;
                    // See comment in the Electron receive poll above — the
                    // cached-glTexture fast path was removed because its handle
                    // went stale and caused INVALID_OPERATION spam. Go through
                    // THREE's normal upload path instead.
                    if (tex.image.data) {
                      tex.image.data.set(frameData);
                      tex.needsUpdate = true;
                    }
                  }
                } catch (e) {
                  if (httpRecvCount < 3) {
                    console.warn('[Spout] HTTP recv error:', e);
                  }
                }
                httpRecvInFlight = false;
                if (httpRecvActive) requestAnimationFrame(pollHttpFrame);
              };

              requestAnimationFrame(pollHttpFrame);

              // Store cleanup hook
              (receiver as any)._stopPolling = () => {
                httpRecvActive = false;
              };
            }

            console.log('[Spout] Receiver created for:', senderName, 'resolution:', width, 'x', height, isElectron ? '(IPC)' : '(WS)');
          } catch (err) {
            console.error('[Spout] Failed to start receiver:', err);
            const data = new Uint8Array([0, 255, 255, 255]);
            texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
            texture.needsUpdate = true;
          }
        }

        if (receiver) {
          texture = receiver.texture;
        }
      }

      if (texture) {
        textureCache.set(cacheKey, texture);
        evictTextureCache();
        console.log('Texture loaded for layer:', layerId, 'type:', source.type);
        // Force a store update to trigger reactivity - this makes the texture appear
        // The updateTexturesSync will pick up the cached texture on next frame
        project.updateLayer(layerId, {});
      }
    } catch (err) {
      // Permanent failure — mark this cacheKey as poisoned so updateTexturesSync
      // stops re-triggering the load every frame. Previously a single missing
      // video file (stale blob URL, deleted project media, bad path) produced
      // 60+ "Failed to load texture: Error: Video failed to load" per second.
      failedTextures.add(cacheKey);
      const n = (failedTextureLogCount.get(cacheKey) ?? 0) + 1;
      failedTextureLogCount.set(cacheKey, n);
      if (n <= FAILED_TEXTURE_LOG_LIMIT) {
        console.error(`Failed to load texture (${cacheKey}):`, err, n === FAILED_TEXTURE_LOG_LIMIT ? '— further retries suppressed' : '');
      }
    } finally {
      loadingTextures.delete(cacheKey);
    }
  }

  // Get texture for an image input reference
  function getImageInputTexture(ref: import('../types').ImageInputRef, layerList: Layer[]): THREE.Texture | null {
    if (ref.type === 'layer') {
      // Get texture from another layer
      const sourceLayer = layerList.find(l => l.id === ref.id);
      if (sourceLayer?.source?.texture) {
        return sourceLayer.source.texture;
      }
    } else if (ref.type === 'media') {
      // Check local persistent cache first (survives store updates)
      const localCacheKey = `media-input:${ref.id}`;
      const cachedTex = imageInputTextureCache.get(localCacheKey);
      if (cachedTex) {
        // Update video texture if needed
        if (cachedTex instanceof THREE.VideoTexture) {
          cachedTex.needsUpdate = true;
        }
        return cachedTex;
      }

      // Get texture from media library store
      const mediaItems = $mediaLibrary;
      const mediaItem = mediaItems.find(m => m.id === ref.id);
      if (mediaItem) {
        // If we already have a texture cached for this media item, use it
        if (mediaItem.texture) {
          // Update video texture if needed — only when the underlying
          // <video> has decoded a frame, otherwise the GPU upload throws
          // INVALID_VALUE on Electron 42 / three.js 0.184.
          if (mediaItem.type === 'video' && mediaItem.texture instanceof THREE.VideoTexture) {
            const mv = mediaItem.videoElement;
            if (mv && mv.readyState >= 2 && mv.videoWidth > 0 && mv.videoHeight > 0) {
              mediaItem.texture.needsUpdate = true;
            }
          }
          // Also cache locally for fast access
          imageInputTextureCache.set(localCacheKey, mediaItem.texture);
          return mediaItem.texture;
        }

        // Otherwise, need to create the texture (async but we'll cache it).
        // Skip if a previous attempt poisoned the cache key.
        const cacheKey = `media:${mediaItem.id}`;
        if (!loadingTextures.has(cacheKey) && !failedTextures.has(cacheKey)) {
          loadingTextures.add(cacheKey);
          console.log('[ISF Image Input] Loading texture for media item:', mediaItem.name, mediaItem.src);
          loadMediaTexture(mediaItem, cacheKey).then(() => {
            // After load, also put in local cache
            const updated = get(mediaLibrary).find(m => m.id === ref.id);
            if (updated?.texture) {
              imageInputTextureCache.set(localCacheKey, updated.texture);
              console.log('[ISF Image Input] Texture loaded and cached for:', mediaItem.name);
            }
          });
        }
      } else {
        console.warn('[ISF Image Input] Media item not found for ref:', ref.id, ref.name);
      }
    }
    return null;
  }

  // Load texture for a media library item
  async function loadMediaTexture(mediaItem: import('../stores/media').MediaItem, cacheKey: string) {
    try {
      let texture: THREE.Texture | null = null;

      if (mediaItem.type === 'image') {
        console.log('[Media Texture] Loading image texture:', mediaItem.name, mediaItem.src?.substring(0, 50));
        texture = await loadImageTexture(mediaItem.src);
      } else if (mediaItem.type === 'video' && mediaItem.videoElement) {
        const video = mediaItem.videoElement;
        // Ensure video is ready
        if (video.readyState < 2) {
          await new Promise<void>((resolve) => {
            const checkReady = () => {
              if (video.readyState >= 2) resolve();
              else requestAnimationFrame(checkReady);
            };
            video.oncanplay = () => resolve();
            checkReady();
          });
        }
        // Start playing if not already
        if (video.paused) {
          try {
            await video.play();
          } catch (e) {
            console.warn('Media video play failed:', e);
          }
        }
        texture = createVideoTexture(video);
      }

      if (texture) {
        // Update the media store with the texture
        console.log('[Media Texture] Successfully loaded texture for:', mediaItem.name, 'size:', (texture.image as any)?.width, 'x', (texture.image as any)?.height);
        mediaLibrary.setTexture(mediaItem.id, texture);
      } else {
        console.warn('[Media Texture] No texture created for:', mediaItem.name, 'type:', mediaItem.type);
      }
    } catch (err) {
      // Same pattern as loadTextureAsync — poison the key so the caller
      // (getImageInputTexture and any future shader-input plumbing) stops
      // re-requesting a media item that can't be loaded.
      failedTextures.add(cacheKey);
      const n = (failedTextureLogCount.get(cacheKey) ?? 0) + 1;
      failedTextureLogCount.set(cacheKey, n);
      if (n <= FAILED_TEXTURE_LOG_LIMIT) {
        console.error('[Media Texture] Failed to load media texture:', mediaItem.name, mediaItem.src, err, n === FAILED_TEXTURE_LOG_LIMIT ? '— further retries suppressed' : '');
      }
    } finally {
      loadingTextures.delete(cacheKey);
    }
  }

  // Update ISF shaders each frame - renders them to their textures
  function updateShaderTextures(layerList: Layer[]) {
    if (!engine) return;
    const renderer = engine.getRenderer();
    // Use project resolution (not viewport size) so shaders don't shift on zoom
    const projectData = $project;
    const width = projectData.width || 1920;
    const height = projectData.height || 1080;

    // Update audio textures once per frame (for all ISF shaders to use)
    const audioState = $audioStore;
    const rawAnalysis = getLastRawAnalysis();
    if (rawAnalysis && audioState.isActive) {
      audioTextures.update(rawAnalysis);
    }

    for (const layer of layerList) {
      if (!layer.source || layer.source.type !== 'shader') continue;
      // Stage-mode injected sources share their RT with the VJ deck's own
      // pass that already ran above; re-rendering under a Screen-layer
      // cache key creates a second orphan instance and consumes the shared
      // RT's GL slot mid-frame. Skip — engine.render samples the same RT
      // via source.texture.
      if ((layer.source as any).__vjStage) continue;

      // Use the same cache key logic as updateTexturesSync
      // AI-generated content uses source.id, regular content uses source.src
      const isAIGenerated = layer.source.src === 'ai-generated' || layer.source.src === 'js-animation';
      const textureCacheKey = isAIGenerated ? layer.source.id : layer.source.src;
      const layerCacheKey = `${layer.id}:${textureCacheKey}`;

      let shaderInstance = shaderInstances.get(layerCacheKey);
      let renderTarget = shaderRenderTargets.get(layerCacheKey);

      // Fallback to source-only key (for VJ layers sharing with original layers)
      if (!shaderInstance || !renderTarget) {
        // Look for any shader instance with this source
        for (const [key, inst] of shaderInstances.entries()) {
          if (key.endsWith(`:${textureCacheKey}`) || key === textureCacheKey) {
            shaderInstance = inst;
            renderTarget = shaderRenderTargets.get(key);
            break;
          }
        }
      }

      if (!shaderInstance || !renderTarget) continue;

      // Dynamic render quality resize — if the layer's renderQuality changed,
      // resize the render target on the fly (avoids needing to recreate the shader)
      const quality = layer.renderQuality ?? SHADER_QUALITY_MULTIPLIERS[get(settings).ui.shaderQuality] ?? 1.0;
      const storedQuality = shaderRenderTargetQualities.get(layerCacheKey) ?? 1.0;
      if (Math.abs(quality - storedQuality) > 0.01) {
        const rtWidth = Math.max(64, Math.round(width * quality));
        const rtHeight = Math.max(64, Math.round(height * quality));
        renderTarget.setSize(rtWidth, rtHeight);
        shaderRenderTargetQualities.set(layerCacheKey, quality);
        console.log(`[ISF] Resized render target to ${rtWidth}x${rtHeight} (quality: ${quality})`);
      }

      // Update shader parameter values from layer source (in case they changed via UI)
      if (layer.source.shaderValues) {
        for (const [name, value] of Object.entries(layer.source.shaderValues)) {
          setISFInputValue(shaderInstance, name, value as number | boolean | number[]);
        }
      }

      // Update image input textures from layer source
      if (layer.source.shaderImageInputs && Object.keys(layer.source.shaderImageInputs).length > 0) {
        for (const [inputName, ref] of Object.entries(layer.source.shaderImageInputs)) {
          const inputTexture = getImageInputTexture(ref, layerList);
          if (inputTexture) {
            // Check if texture actually changed to avoid spamming logs
            const current = shaderInstance.inputTextures.get(inputName);
            if (current !== inputTexture) {
              console.log('[ISF Image Input] Binding texture for', inputName, 'from', ref.type, ref.name);
            }
            setISFInputTexture(shaderInstance, inputName, inputTexture);
          }
        }
      }

      // Auto-bind default texture for any image inputs that aren't manually configured
      // This prevents image-processing ISF shaders (84-88 etc.) from rendering black
      for (const input of shaderInstance.metadata.INPUTS) {
        if (input.TYPE === 'image' && !shaderInstance.inputTextures.has(input.NAME)) {
          console.log('[ISF Image Input] Auto-binding default texture for', input.NAME, 'in', layer.source.name);
          setISFInputTexture(shaderInstance, input.NAME, getISFDefaultInputTexture());
        }
      }

      // Update TIME, audio, and other built-in uniforms
      // Pass the actual render target size (may be scaled down by renderQuality)
      const rtW = renderTarget.width;
      const rtH = renderTarget.height;
      updateISFShader(shaderInstance, rtW, rtH, undefined, audioState);

      // ── Phase integration for time-multiplier params with active keyframes ──
      // After updateISFShader set TIME from performance.now(), override it with
      // integrated phase so `TIME * speed` becomes a smoothly accumulated phase.
      const _kfState = get(keyframeTimeline);
      let _phaseStash: { origTime: number; origParam: number; paramName: string } | null = null;
      if (_kfState.config.isPlaying) {
        // VJ layers key their overrides by clip ID
        const _isVJ = (layer.id as string)?.startsWith('vj-layer-');
        const _overrideKey = _isVJ && layer.source?.id ? `vj-${layer.source.id}` : layer.id;
        const _overrides = _kfState.activeOverrides[_overrideKey];
        if (_overrides) {
          for (const [ovKey, ovValue] of Object.entries(_overrides)) {
            if (!ovKey.startsWith('shader:')) continue;
            const ovParam = ovKey.slice(7);
            if (!TIME_MULTIPLIER_PARAM_REGEX.test(ovParam)) continue;
            if (typeof ovValue !== 'number') continue;
            if (!shaderInstance.uniforms?.TIME) continue;

            const pbTime = _kfState.config.currentTime;
            const phaseKey = `${layer.id}:${ovParam}`;
            let state = shaderPhases.get(phaseKey);
            if (!state) {
              state = { phase: 0, lastPlaybackTime: pbTime };
              shaderPhases.set(phaseKey, state);
            }
            const dt = pbTime - state.lastPlaybackTime;
            if (dt < 0 || dt > 1.0) {
              state.phase = 0; // reset on loop/seek
            } else {
              state.phase += dt * ovValue;
            }
            state.lastPlaybackTime = pbTime;

            // Stash and override (restored after render below)
            _phaseStash = {
              origTime: shaderInstance.uniforms.TIME.value as number,
              origParam: (shaderInstance.uniforms[ovParam]?.value ?? 1) as number,
              paramName: ovParam,
            };
            shaderInstance.uniforms.TIME.value = state.phase;
            if (shaderInstance.uniforms[ovParam]) {
              shaderInstance.uniforms[ovParam].value = 1.0;
            }
            break; // only handle first time-multiplier param per layer
          }
        }
      }

      // Render shader to its render target
      shaderQuad.material = shaderInstance.material;
      renderer.setRenderTarget(renderTarget);
      renderer.clear();
      renderer.render(shaderScene, shaderCamera);
      renderer.setRenderTarget(null);

      // Restore phase-overridden uniforms
      if (_phaseStash) {
        shaderInstance.uniforms.TIME.value = _phaseStash.origTime;
        if (shaderInstance.uniforms[_phaseStash.paramName]) {
          shaderInstance.uniforms[_phaseStash.paramName].value = _phaseStash.origParam;
        }
      }
    }
  }

  // Render lines layer content to textures
  function updateLinesLayerTextures(layerList: Layer[]) {
    if (!engine || !linesRenderer) return;
    engine.getRenderer(); // ensure renderer is initialized
    // Use project resolution (not viewport size) so content doesn't shift on zoom
    const projectData = $project;
    const width = projectData.width || 1920;
    const height = projectData.height || 1080;

    for (const layer of layerList) {
      // Only process lines layers with content
      if (layer.type !== 'lines' || !layer.linesContent) continue;

      // Get or create render target for this lines layer
      let renderTarget = linesRenderTargets.get(layer.id);
      if (!renderTarget) {
        renderTarget = new THREE.WebGLRenderTarget(width, height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
        });
        linesRenderTargets.set(layer.id, renderTarget);
      }

      // Resolve shared shader texture if mask mode is active
      let sharedTexture: THREE.Texture | null = null;
      if (layer.linesContent.sharedShaderMode && layer.linesContent.sharedShaderSourceId) {
        const sourceId = layer.linesContent.sharedShaderSourceId;
        // Search all layers for a shader layer matching the sourceId
        for (const otherLayer of layerList) {
          if (!otherLayer.source || otherLayer.id === layer.id) continue;
          const src = otherLayer.source.src;
          const isMatch = src === sourceId || otherLayer.source.id === sourceId || otherLayer.source.name === sourceId;
          if (isMatch) {
            // Try shader render target first (ISF shaders)
            const isAI = src === 'ai-generated' || src === 'js-animation';
            const texKey = isAI ? otherLayer.source.id : src;
            const cacheKey = `${otherLayer.id}:${texKey}`;
            const shaderRT = shaderRenderTargets.get(cacheKey);
            if (shaderRT) {
              sharedTexture = shaderRT.texture;
              break;
            }
            // Try texture cache (images, videos)
            const cachedTex = textureCache.get(texKey);
            if (cachedTex) {
              sharedTexture = cachedTex;
              break;
            }
          }
        }
      }

      // Render the line elements to the texture
      const elements = layer.linesContent.elements;
      if (elements.length > 0) {
        // Use linesRenderer to render the elements with layer-level animation params
        const texture = linesRenderer.renderElements(
          elements,
          renderTarget,
          layer.linesContent.globalDrawSpeed,
          layer.linesContent.staggerMode,
          layer.linesContent.staggerDelay,
          sharedTexture,
          layer.linesContent.waveWindowSize ?? 3
        );

        // Store texture on layer for engine to pick up
        if (!layer.source) {
          (layer as any)._linesTexture = texture;
        }
      }
    }
  }

  // Render SVG layer content to textures
  function updateSVGLayerTextures(layerList: Layer[]) {
    if (!engine) return;
    // Use project output dimensions, not visible canvas size
    // This ensures SVG fills the full layer bounds regardless of UI panel layout
    const projectData = $project;
    const width = projectData.width || 1920;
    const height = projectData.height || 1080;

    // Calculate delta time for animation
    const currentTime = performance.now() / 1000;
    const deltaTime = currentTime - lastSVGUpdateTime;
    lastSVGUpdateTime = currentTime;

    for (const layer of layerList) {
      // Only process SVG layers with content
      if (layer.type !== 'svg' || !layer.svgContent) continue;

      // Get or create SVG renderer for this layer
      let svgRenderer = svgRenderers.get(layer.id);
      if (!svgRenderer) {
        // Pass the main renderer to avoid creating multiple WebGL contexts
        const mainRenderer = engine.getRenderer();
        svgRenderer = new SVGLayerRenderer(width, height, mainRenderer);
        svgRenderers.set(layer.id, svgRenderer);

        // Parse SVG source if provided
        if (layer.svgContent.svgSource) {
          svgRenderer.parseSVG(layer.svgContent.svgSource);
          svgRenderer.buildScene(layer.svgContent);
        }
      } else {
        // Ensure SVG renderer dimensions are in sync with container
        // This handles cases where the renderer was created with different dimensions
        svgRenderer.resize(width, height);
      }

      // Check if SVG source changed or if dimensions changed (needs rebuild)
      const currentSvgSource = layer.svgContent.svgSource;
      const cachedSvgSource = (svgRenderer as any)._lastSvgSource || '';
      const needsRebuild = svgRenderer.needsRebuild();
      if (currentSvgSource !== cachedSvgSource || needsRebuild) {
        (svgRenderer as any)._lastSvgSource = currentSvgSource;
        if (currentSvgSource) {
          svgRenderer.parseSVG(currentSvgSource);
          svgRenderer.buildScene(layer.svgContent);
        }
      }

      // Check if effect toggles changed - rebuild scene if needed
      const effectsKey = [
        layer.svgContent.fillMode,
        layer.svgContent.colorMode,
        layer.svgContent.liquidEnabled,
        layer.svgContent.particlesEnabled,
        layer.svgContent.energyEnabled,
        layer.svgContent.connectionsEnabled,
        layer.svgContent.glowEnabled,
        layer.svgContent.ripplesEnabled,
        layer.svgContent.lightningEnabled,
        layer.svgContent.edgeFlowEnabled,
        layer.svgContent.innerGlowEnabled,
        layer.svgContent.nebulaEnabled,
        layer.svgContent.heartbeatEnabled,
        layer.svgContent.plasmaEnabled,
        layer.svgContent.particleLinksEnabled,
        layer.svgContent.particleLinkMaxLinks, // Rebuild if max links changes (creates new line pool)
        layer.svgContent.echoEnabled,
        layer.svgContent.arcBridgesEnabled,
      ].join(',');
      const cachedEffectsKey = (svgRenderer as any)._lastEffectsKey || '';
      if (effectsKey !== cachedEffectsKey && currentSvgSource) {
        (svgRenderer as any)._lastEffectsKey = effectsKey;
        svgRenderer.buildScene(layer.svgContent);
      }

      // Animate and render
      if (layer.svgContent.svgSource) {
        // Update animation
        svgRenderer.animate(Math.min(deltaTime, 0.1), layer.svgContent);

        // Render to texture
        const texture = svgRenderer.render();

        // Store the texture on the layer for the engine to use
        (layer as any)._svgTexture = texture;
      }
    }
  }

  // Render light painting layer content to textures
  function updateLightPaintingLayerTextures(layerList: Layer[]) {
    if (!engine) return;
    const projectData = $project;
    const width = projectData.width || 1920;
    const height = projectData.height || 1080;

    // Calculate delta time
    const currentTime = performance.now() / 1000;
    const deltaTime = currentTime - lastLPUpdateTime;
    lastLPUpdateTime = currentTime;

    for (const layer of layerList) {
      if (layer.type !== 'lightpainting' || !layer.lightPaintingContent) continue;

      // Get or create renderer for this layer
      let lpRenderer = lightPaintingRenderers.get(layer.id);
      if (!lpRenderer) {
        lpRenderer = new LightPaintingRenderer(width, height);
        lightPaintingRenderers.set(layer.id, lpRenderer);
      } else {
        lpRenderer.resize(width, height);
      }

      // Render and get texture
      const texture = lpRenderer.render(layer.lightPaintingContent, Math.min(deltaTime, 0.1));

      // Store texture on layer for engine to pick up (same pattern as SVG/lines)
      (layer as any)._lightPaintingTexture = texture;
    }

    // Clean up renderers for removed layers
    for (const [layerId, renderer] of lightPaintingRenderers) {
      if (!layerList.find(l => l.id === layerId && l.type === 'lightpainting')) {
        renderer.dispose();
        lightPaintingRenderers.delete(layerId);
      }
    }
  }

  // Render text layer content to textures
  function updateTextLayerTextures(layerList: Layer[]) {
    if (!engine) return;
    const projectData = $project;
    const width = projectData.width || 1920;
    const height = projectData.height || 1080;

    // Calculate delta time
    const currentTime = performance.now() / 1000;
    const deltaTime = currentTime - lastTextUpdateTime;
    lastTextUpdateTime = currentTime;

    for (const layer of layerList) {
      if (layer.type !== 'text' || !layer.textContent) continue;

      // Get or create renderer for this layer
      let textRenderer = textRenderers.get(layer.id);
      if (!textRenderer) {
        textRenderer = new TextRenderer(width, height);
        textRenderers.set(layer.id, textRenderer);
      } else {
        textRenderer.resize(width, height);
      }

      // Render and get texture
      const texture = textRenderer.render(layer.textContent, Math.min(deltaTime, 0.1));

      // Store texture on layer for engine to pick up
      (layer as any)._textTexture = texture;
    }

    // Clean up renderers for removed layers
    for (const [layerId, renderer] of textRenderers) {
      if (!layerList.find(l => l.id === layerId && l.type === 'text')) {
        renderer.dispose();
        textRenderers.delete(layerId);
      }
    }
  }

  // Render splat layer content (point cloud / gaussian splat) to textures
  // Uses WebGLRenderTarget on the main engine's renderer to avoid cross-context issues
  function updateSplatLayerTextures(layerList: Layer[]) {
    if (!engine) return;
    const projectData = $project;
    const width = projectData.width || 1920;
    const height = projectData.height || 1080;
    const mainRenderer = engine.getRenderer();

    // Get audio level for audio-reactive effects
    const audioState = get(audioStore);
    const audioLevel = audioState?.amplitude || 0;

    for (const layer of layerList) {
      if (layer.type !== 'splat' || !layer.splatContent) continue;

      // Get or create splat renderer for this layer
      let splatCtx = splatRenderers.get(layer.id);

      if (!splatCtx) {
        // Create in shared-renderer mode — no own WebGL context.
        // Rendering happens via renderTo() using the main engine's renderer.
        const splatRenderer = new SplatRenderer(width, height);

        // Create WebGLRenderTarget — renders into the main engine's GL context
        const renderTarget = new THREE.WebGLRenderTarget(width, height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
        });

        splatCtx = {
          renderer: splatRenderer,
          renderTarget,
          plyUrl: null,
          loadingPly: false,
        };
        splatRenderers.set(layer.id, splatCtx);
        console.log('[Canvas] Created splat renderer for layer:', layer.id, '(WebGLRenderTarget)');
      }

      // Check if splat file changed and needs to be loaded (supports both .ply and .splat)
      const currentPlyUrl = layer.splatContent.filePath || null;
      if (currentPlyUrl && currentPlyUrl !== splatCtx.plyUrl && !splatCtx.loadingPly) {
        splatCtx.loadingPly = true;
        splatCtx.plyUrl = currentPlyUrl;

        // Detect .splat format by original filename or URL pattern
        const originalFileName = (layer.splatContent as any)._originalFileName || '';
        const isSplatFormat = originalFileName.toLowerCase().endsWith('.splat');

        if (isSplatFormat) {
          console.log('[Canvas] Loading .splat file:', originalFileName);
          const layerId = layer.id;
          loadSplatFromUrl(currentPlyUrl)
            .then((splatData) => {
              console.log('[Canvas] .splat loaded:', splatData.vertices.length, 'splats');
              const ctx = splatRenderers.get(layerId);
              if (ctx) {
                ctx.renderer.loadData(splatData);
                ctx.loadingPly = false;
                project.updateSplatContent(layerId, { pointCount: splatData.vertices.length });
              }
            })
            .catch((err) => {
              console.error('[Canvas] Failed to load .splat:', err);
              showToast('Failed to load .splat file: ' + (err instanceof Error ? err.message : String(err)));
              const ctx = splatRenderers.get(layerId);
              if (ctx) { ctx.loadingPly = false; ctx.plyUrl = null; } // Reset URL so retry works
            });
        } else {
          console.log('[Canvas] Loading PLY file:', currentPlyUrl);
          const layerId = layer.id;
          loadPLY(currentPlyUrl)
            .then((plyData) => {
              console.log('[Canvas] PLY loaded:', plyData.vertices.length, 'vertices');
              const ctx = splatRenderers.get(layerId);
              if (ctx) {
                ctx.renderer.loadData(plyData);
                ctx.loadingPly = false;
                project.updateSplatContent(layerId, { pointCount: plyData.vertices.length });
              }
            })
            .catch((err) => {
              console.error('[Canvas] Failed to load PLY:', err);
              showToast('Failed to load PLY file: ' + (err instanceof Error ? err.message : String(err)));
              const ctx = splatRenderers.get(layerId);
              if (ctx) { ctx.loadingPly = false; ctx.plyUrl = null; } // Reset URL so retry works
            });
        }
      }

      // Resize render target if project dimensions changed
      if (splatCtx.renderTarget.width !== width || splatCtx.renderTarget.height !== height) {
        splatCtx.renderTarget.setSize(width, height);
        splatCtx.renderer.resize(width, height);
      }

      // Pass mouse position to splat renderer for mouse interactions
      if (mouseOnCanvas) {
        splatCtx.renderer.setMouseNormalized(mouseNormalizedX, mouseNormalizedY);
      } else {
        splatCtx.renderer.clearMousePosition();
      }

      // Update texture if enabled
      if (layer.splatContent.textureEnabled && layer.splatContent.texturePath) {
        splatCtx.renderer.setTexture(
          layer.splatContent.texturePath,
          layer.splatContent.textureType || 'image'
        );
      } else if (!layer.splatContent.textureEnabled) {
        splatCtx.renderer.setTexture('');
      }

      // Update and render splat to the shared render target
      const splatBand = layer.splatContent.audioBand || 'all';
      const splatBandLevel = splatBand === 'all' ? audioLevel : (audioState?.bands?.[splatBand] || 0);
      const splatSensitivity = layer.splatContent.audioSensitivity || 1;
      splatCtx.renderer.update(layer.splatContent, splatBandLevel * splatSensitivity, audioState);

      // Render to the engine's WebGLRenderTarget (same GL context = no cross-context issues)
      // Save and restore the engine's clear color
      const prevClearColor = mainRenderer.getClearColor(new THREE.Color());
      const prevClearAlpha = mainRenderer.getClearAlpha();
      splatCtx.renderer.renderTo(mainRenderer, splatCtx.renderTarget);
      mainRenderer.setClearColor(prevClearColor, prevClearAlpha);

      // Store render target texture on layer for engine to pick up
      (layer as any)._splatTexture = splatCtx.renderTarget.texture;
    }

    // Clean up renderers for removed layers
    for (const [layerId, ctx] of splatRenderers) {
      if (!layerList.find(l => l.id === layerId && l.type === 'splat')) {
        ctx.renderer.dispose();
        ctx.renderTarget.dispose();
        splatRenderers.delete(layerId);
        console.log('[Canvas] Disposed splat renderer for layer:', layerId);
      }
    }
  }

  // ── GPU layer textures ──
  // Per-frame: ensure a renderer exists for each visible gpu layer,
  // run the active shader (planet, particle, etc.) into the
  // renderer's canvas, then expose the canvas to the engine via a
  // THREE.CanvasTexture stamped on the layer as `_gpuLayerTexture`.
  // The engine's getLayerTexture() picks it up; warp/mesh/blend/
  // per-layer effects all apply normally because the engine just
  // sees a texture.
  function updateGpuLayerTextures(layerList: Layer[]) {
    if (!engine) return;
    ensureWebGPUForGpuLayers();
    if (!isWebGPUReady()) return;
    const device = getWebGPUDevice();
    const presentFormat = getPreferredCanvasFormat();
    if (!device) return;

    const projectData = $project;
    const width = projectData?.width || 1920;
    const height = projectData?.height || 1080;
    const liveIds = new Set<string>();

    for (const layer of layerList) {
      if (layer.type !== 'gpu' || !layer.gpuLayerContent || !layer.visible) continue;
      liveIds.add(layer.id);
      const c = layer.gpuLayerContent;

      // Lazy-create renderer.
      let renderer = gpuLayerRenderers.get(layer.id);
      if (!renderer) {
        try {
          renderer = new GpuLayerRenderer(device, presentFormat, width, height);
          gpuLayerRenderers.set(layer.id, renderer);
        } catch (err: any) {
          console.warn('[Canvas] gpu-layer: failed to create renderer for', layer.id, err?.message || err);
          continue;
        }
      }

      // Resolve params with shader defaults so newly-added layers
      // render meaningfully even before the panel touches anything.
      const def = getShaderDef(c.shaderId);
      const mergedParams = def ? { ...def.defaultParams, ...c.params } : c.params;

      // Render the active shader to the layer's canvas. Pass the
      // source context so source-driven shaders (pixel-particles)
      // can resolve their media-source param into an actual element.
      try {
        const sourceCtx = {
          layers: projectData?.layers ?? [],
          mediaItems: get(mediaLibrary),
        };
        // Audio bands for shaders that opt into reactivity (e.g.
        // flythrough audioReactive toggle). audioBands is a derived
        // store; get() is O(1) and the per-frame cost is negligible.
        const bandsSnap = get(audioBands);
        renderer.renderFrame(c.shaderId, mergedParams, width, height, sourceCtx, {
          bass: bandsSnap.bass ?? 0,
          mid: bandsSnap.mid ?? 0,
          treble: bandsSnap.treble ?? 0,
        });
      } catch (err: any) {
        console.warn('[Canvas] gpu-layer: render failed', err?.message || err);
        continue;
      }

      // Lazy-create the Three.js wrapper texture.
      let tex = gpuLayerTextures.get(layer.id);
      if (!tex) {
        tex = new THREE.CanvasTexture(renderer.canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        // The renderer writes top-down; Three.js samples bottom-up.
        // flipY = true flips on upload so the texture reads upright.
        tex.flipY = true;
        gpuLayerTextures.set(layer.id, tex);
      }
      tex.needsUpdate = true;
      (layer as any)._gpuLayerTexture = tex;
    }

    // Reap renderers for removed/hidden layers.
    for (const [id, r] of gpuLayerRenderers) {
      if (!liveIds.has(id)) {
        try { r.dispose(); } catch { /* */ }
        gpuLayerRenderers.delete(id);
        const t = gpuLayerTextures.get(id);
        try { t?.dispose(); } catch { /* */ }
        gpuLayerTextures.delete(id);
      }
    }
  }

  // Update Model3D layer textures (3D Models with materials/animations/effects)
  // Uses WebGLRenderTarget on the main engine's renderer to avoid cross-context issues
  function updateModel3DTextures(layerList: Layer[]) {
    if (!engine) return;

    const projectData = $project;
    const width = projectData.width || 1920;
    const height = projectData.height || 1080;
    const mainRenderer = engine.getRenderer();

    // Get audio level for audio-reactive effects
    const audioState = get(audioStore);
    const audioLevel = audioState?.amplitude || 0;

    for (const layer of layerList) {
      if (layer.type !== 'model3d' || !layer.model3dContent) continue;

      // Get or create model3d renderer for this layer
      let model3dCtx = model3dRenderers.get(layer.id);

      if (!model3dCtx) {
        // Create in standalone mode with its OWN WebGL context + offscreen
        // canvas at HALF resolution to reduce GPU load and texture upload cost.
        const modelW = Math.round(width / 2);
        const modelH = Math.round(height / 2);
        const offCanvas = document.createElement('canvas');
        offCanvas.width = modelW;
        offCanvas.height = modelH;
        offCanvas.style.display = 'none';
        document.body.appendChild(offCanvas);

        const model3dRenderer = new Model3DRenderer(offCanvas, modelH);

        // CanvasTexture reads from the offscreen canvas each frame — no
        // render target switch on the main renderer at all.
        const canvasTex = new THREE.CanvasTexture(offCanvas);
        canvasTex.minFilter = THREE.LinearFilter;
        canvasTex.magFilter = THREE.LinearFilter;

        // Keep a dummy render target for API compat (dispose, resize checks)
        const renderTarget = { width, height, texture: canvasTex, setSize(w: number, h: number) { this.width = w; this.height = h; }, dispose() { canvasTex.dispose(); } } as any;

        model3dCtx = {
          renderer: model3dRenderer,
          renderTarget,
          modelUrl: null,
          loadingModel: false,
        };
        (model3dCtx as any)._offCanvas = offCanvas;
        (model3dCtx as any)._canvasTex = canvasTex;
        model3dRenderers.set(layer.id, model3dCtx);
        console.log('[Canvas] Created model3d renderer for layer:', layer.id, '(separate WebGL context)');
      }

      // Check if model data changed and needs to be loaded.
      // The _failedUrl guard prevents infinite retry loops when a URL fails (e.g. stale blob from a previous session).
      const currentModelUrl = layer.model3dContent.modelData || null;
      const failedUrl = (model3dCtx as any)._failedUrl;

      if (currentModelUrl && currentModelUrl !== model3dCtx.modelUrl && currentModelUrl !== failedUrl && !model3dCtx.loadingModel) {
        model3dCtx.loadingModel = true;
        model3dCtx.modelUrl = currentModelUrl;
        console.log('[Canvas] Loading 3D model:', layer.model3dContent.modelName);

        const ctx = model3dCtx;
        ctx.renderer.loadModel(currentModelUrl, layer.model3dContent.modelFormat)
          .then((result) => {
            const { vertexCount, faceCount } = result;
            const hasAnimations = (result as any).hasAnimations ?? false;
            console.log('[Canvas] Model loaded:', vertexCount, 'vertices,', faceCount, 'faces', hasAnimations ? `(${hasAnimations} animations)` : '');
            project.updateModel3DContent(layer.id, { vertexCount, faceCount, hasFileAnimations: hasAnimations });
            ctx.loadingModel = false;
            (ctx as any)._failedUrl = null;
          })
          .catch((err) => {
            console.error('[Canvas] Failed to load model:', err);
            showToast('3D model could not be loaded. Re-add the model file to this layer.');
            ctx.loadingModel = false;
            // Mark this URL as failed so we DON'T retry every frame
            (ctx as any)._failedUrl = currentModelUrl;
            ctx.modelUrl = currentModelUrl; // Set to match so condition doesn't re-trigger
          });
      }

      // Resize offscreen canvas if project dimensions changed
      if (model3dCtx.renderTarget.width !== width || model3dCtx.renderTarget.height !== height) {
        model3dCtx.renderTarget.setSize(width, height);
        const offCanvas = (model3dCtx as any)._offCanvas as HTMLCanvasElement;
        if (offCanvas) { offCanvas.width = width; offCanvas.height = height; }
        model3dCtx.renderer.resize(width, height);
      }

      // Update and render model to its own offscreen canvas (separate GL context)
      const content = layer.model3dContent;
      const modelBand = content.audio?.audioBand || 'all';
      const modelBandLevel = modelBand === 'all' ? audioLevel : (audioState?.bands?.[modelBand] || 0);
      model3dCtx.renderer.update(content, modelBandLevel, audioState);
      model3dCtx.renderer.render();

      // Mark CanvasTexture as needing upload so Three.js picks up the new frame
      const canvasTex = (model3dCtx as any)._canvasTex as THREE.CanvasTexture;
      if (canvasTex) canvasTex.needsUpdate = true;

      // Store texture on layer for engine to pick up
      (layer as any)._model3dTexture = canvasTex || model3dCtx.renderTarget.texture;
    }

    // Clean up renderers for removed layers
    for (const [layerId, ctx] of model3dRenderers) {
      if (!layerList.find(l => l.id === layerId && l.type === 'model3d')) {
        ctx.renderer.dispose();
        ctx.renderTarget.dispose();
        // Remove offscreen canvas from DOM
        const offCanvas = (ctx as any)._offCanvas as HTMLCanvasElement;
        if (offCanvas?.parentElement) offCanvas.remove();
        model3dRenderers.delete(layerId);
        console.log('[Canvas] Disposed model3d renderer for layer:', layerId);
      }
    }
  }

  // Render integrated effect textures (FluidSimulation, ParticleSystem)
  function updateIntegratedEffectTextures(layerList: Layer[]) {
    if (!engine) return;
    const renderer = engine.getRenderer();
    const projectData = $project;
    const width = projectData.width || 1920;
    const height = projectData.height || 1080;

    // Calculate delta time
    const currentTime = performance.now() / 1000;
    const deltaTime = Math.min(currentTime - lastEffectUpdateTime, 0.1);
    lastEffectUpdateTime = currentTime;

    // Get audio level for reactivity
    const audioState = get(audioStore);
    const audioLevel = audioState?.amplitude || 0;

    // Track active effect sources
    const _activeEffectIds = new Set<string>();
    const _effectSources = new Map<string, { effectSource: any; layers: Layer[] }>();

    for (const layer of layerList) {
      if (!layer.source || layer.source.type !== 'effect' || !layer.source.effectSource) continue;

      const effectSource = layer.source.effectSource;
      const cacheKey = layer.source.id;
      _activeEffectIds.add(cacheKey);
      const existing = _effectSources.get(cacheKey);
      if (existing) {
        existing.layers.push(layer);
      } else {
        _effectSources.set(cacheKey, { effectSource, layers: [layer] });
      }
    }

    for (const [cacheKey, effectGroup] of _effectSources) {
      const { effectSource, layers: groupedLayers } = effectGroup;

      // Get or create effect context
      let effectCtx = integratedEffects.get(cacheKey);
      // Only handle integrated effect types
      if (effectSource.effectType !== 'fluid' && effectSource.effectType !== 'particles') continue;

      if (effectCtx && effectCtx.type !== effectSource.effectType) {
        // Flipping from fluid → particles (or back) must clean up webcam
        // resources from the previous effect. Without this, the MediaStream
        // tracks stayed live and the video/texture leaked GPU memory every
        // time the user changed effect type on a webcam-enabled layer.
        try { effectCtx.cameraStream?.getTracks().forEach(t => t.stop()); } catch {}
        try { effectCtx.cameraVideoEl?.remove(); } catch {}
        try { effectCtx.cameraTexture?.dispose(); } catch {}
        try { effectCtx.prevCameraTarget?.dispose(); } catch {}
        effectCtx.fluid?.dispose();
        effectCtx.particles?.dispose();
        effectCtx.renderTarget.dispose();
        integratedEffects.delete(cacheKey);
        effectCtx = undefined;
      }

      if (!effectCtx) {
        // Create new effect context
        const renderTarget = new THREE.WebGLRenderTarget(width, height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
        });

        effectCtx = {
          type: effectSource.effectType as 'fluid' | 'particles',
          renderTarget,
          simulationWidth: width,
          simulationHeight: height,
          lastUpdateTime: currentTime,
          mouseX: 0.5,
          mouseY: 0.5,
          lastMouseX: 0.5,
          lastMouseY: 0.5,
        };

        if (effectSource.effectType === 'fluid') {
          const simSize = getFluidSimulationSize(width, height);
          const fluid = new FluidSimulation(simSize.width, simSize.height);
          fluid.init(renderer);
          if (effectSource.fluidMode !== undefined) {
            fluid.setMode(effectSource.fluidMode as FluidMode);
          }
          effectCtx.fluid = fluid;
          effectCtx.simulationWidth = simSize.width;
          effectCtx.simulationHeight = simSize.height;
        } else if (effectSource.effectType === 'particles') {
          const ps = new ParticleSystem3D(width, height);
          ps.init(renderer);
          ps.setParams({
            mode: (effectSource.particleMode ?? 0) as any,
            count: effectSource.particleCount ?? 3000,
            size: effectSource.particleSize ?? 0.8,
            speed: effectSource.particleSpeed ?? 2.0,
            gravity: effectSource.particleGravity ?? -0.5,
            turbulence: effectSource.particleTurbulence ?? 2.0,
            vortex: effectSource.particleVortex ?? 1.0,
            drag: effectSource.particleDrag ?? 0.98,
            mouseForce: effectSource.particleMouseForce ?? 50,
            mouseRadius: effectSource.particleMouseRadius ?? 15,
            emission: effectSource.particleEmission ?? 2.0,
            bloom: effectSource.particleBloom ?? 0.6,
            bloomThreshold: effectSource.particleBloomThreshold ?? 0.35,
            material: effectSource.particleMaterial ?? 0,
            colorA: effectSource.particleColorA ?? [0.2, 0.5, 1.0],
            colorB: effectSource.particleColorB ?? [1.0, 0.3, 0.8],
            colorC: effectSource.particleColorC ?? [0.3, 1.0, 0.5],
            colorMode: effectSource.particleColorMode ?? 0,
            connectors: effectSource.particleConnectors ?? false,
            connectorDist: effectSource.particleConnectorDist ?? 5,
            connectorOpacity: effectSource.particleConnectorOpacity ?? 0.4,
            textureUrl: effectSource.particleTextureUrl ?? '',
            lightCount: effectSource.particleLightCount ?? 3,
            lightIntensity: effectSource.particleLightIntensity ?? 4.0,
            lightOrbitSpeed: effectSource.particleLightOrbitSpeed ?? 0.5,
            lightColorA: effectSource.particleLightColorA ?? [0.3, 0.5, 1.0],
            lightColorB: effectSource.particleLightColorB ?? [1.0, 0.3, 0.6],
            lightConeAngle: effectSource.particleLightConeAngle ?? 0.6,
            ambient: effectSource.particleAmbient ?? 0.35,
            autoRotate: effectSource.particleAutoRotate ?? true,
            rotationSpeed: effectSource.particleRotationSpeed ?? 0.15,
          });
          effectCtx.particles = ps;
        }

        integratedEffects.set(cacheKey, effectCtx);
        console.log('[Canvas] Created integrated effect:', effectSource.effectType, 'for', cacheKey);
      }

      if (
        effectCtx.renderTarget.width !== width ||
        effectCtx.renderTarget.height !== height
      ) {
        effectCtx.renderTarget.setSize(width, height);
      }

      // ── Fluid path ──────────────────────────────────────────────────────
      if (effectCtx.fluid && effectSource.effectType === 'fluid') {
        const simSize = getFluidSimulationSize(width, height);
        if (
          effectCtx.simulationWidth !== simSize.width ||
          effectCtx.simulationHeight !== simSize.height
        ) {
          effectCtx.fluid.resize(simSize.width, simSize.height);
          effectCtx.simulationWidth = simSize.width;
          effectCtx.simulationHeight = simSize.height;
        }

        if (effectSource.fluidMode !== undefined) {
          effectCtx.fluid.setMode(effectSource.fluidMode as FluidMode);
        }
        // Mutate cached param objects in place; fluid's setParams has change
        // detection so passing the same object repeatedly is a no-op.
        if (!effectCtx._fluidRenderParams) {
          effectCtx._fluidRenderParams = {
            intensity: 1.0, contrast: 1.0, saturation: 1.0,
            hueShift: 0.0, glow: 0.5, bgColor: [0, 0, 0],
          };
        }
        const frp = effectCtx._fluidRenderParams;
        frp.intensity  = effectSource.fluidIntensity ?? 1.0;
        frp.contrast   = effectSource.fluidContrast ?? 1.0;
        frp.saturation = effectSource.fluidSaturation ?? 1.0;
        frp.hueShift   = effectSource.fluidHueShift ?? 0.0;
        frp.glow       = effectSource.fluidGlow ?? 0.5;
        frp.bgColor    = effectSource.fluidBgColor ?? frp.bgColor;
        effectCtx.fluid.setRenderParams(frp);

        if (!effectCtx._fluidSimParams) {
          effectCtx._fluidSimParams = {
            viscosity: 0.0001, vorticity: 30.0, dissipation: 1.0,
            velocityDissipation: 0.5, pressureIterations: 14,
          };
        }
        const fsp = effectCtx._fluidSimParams;
        fsp.viscosity           = effectSource.fluidViscosity ?? 0.0001;
        fsp.vorticity           = effectSource.fluidVorticity ?? 30.0;
        fsp.dissipation         = effectSource.fluidDissipation ?? 1.0;
        fsp.velocityDissipation = effectSource.fluidVelDissipation ?? 0.5;
        fsp.pressureIterations  = effectSource.fluidPressureIters ?? fluidQualityPreset.pressureIterations;
        effectCtx.fluid.setParams(fsp);

      // --- Camera feed management for fluid ---
      //
      // Helper that tears down a webcam-backed effect context. Called both on
      // explicit disable and on hotplug (USB webcam yanked mid-set).
      function _teardownFluidWebcam(ctx: IntegratedEffectContext) {
        try { ctx.cameraStream?.getTracks().forEach(t => t.stop()); } catch {}
        try { ctx.cameraVideoEl?.remove(); } catch {}
        try { ctx.cameraTexture?.dispose(); } catch {}
        try { ctx.prevCameraTarget?.dispose(); } catch {}
        ctx.cameraStream = undefined;
        ctx.cameraVideoEl = undefined;
        ctx.cameraTexture = undefined;
        ctx.prevCameraTarget = undefined;
        ctx.cameraRequested = false;
        ctx.prevCameraCopied = false;
      }

      if (effectCtx.fluid && effectSource.cameraEnabled && !effectCtx.cameraStream && !effectCtx.cameraRequested) {
        effectCtx.cameraRequested = true;
        const thisKey = cacheKey; // capture for async closure
        console.log('[Canvas] Requesting webcam for fluid camera feed...');
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
          .then(stream => {
            const ctx = integratedEffects.get(thisKey);
            if (!ctx) { stream.getTracks().forEach(t => t.stop()); return; }
            const videoEl = document.createElement('video');
            videoEl.srcObject = stream;
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.autoplay = true;
            videoEl.play();
            const tex = new THREE.VideoTexture(videoEl);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            const prevTarget = new THREE.WebGLRenderTarget(640, 480, {
              minFilter: THREE.LinearFilter,
              magFilter: THREE.LinearFilter,
              format: THREE.RGBAFormat,
            });
            ctx.cameraStream = stream;
            ctx.cameraVideoEl = videoEl;
            ctx.cameraTexture = tex;
            ctx.prevCameraTarget = prevTarget;
            ctx.prevCameraCopied = false;

            // Hotplug resilience: if the user yanks the USB webcam mid-set,
            // the video track emits `ended`. Without this listener the fluid
            // effect stays "readyState>=2 from last frame" forever and the
            // user sees a frozen motion input until the app is restarted.
            // On end we tear everything down and clear `cameraRequested` so
            // the auto-retry path above can re-acquire if the webcam comes
            // back (e.g., replug).
            stream.getVideoTracks().forEach(track => {
              track.onended = () => {
                console.warn('[Canvas] Webcam track ended (device unplugged?) — tearing down fluid camera feed');
                const c = integratedEffects.get(thisKey);
                if (c) _teardownFluidWebcam(c);
              };
            });

            console.log('[Canvas] Webcam started for fluid camera feed');
          })
          .catch(err => {
            console.error('[Canvas] Webcam access denied or failed:', err);
            const ctx = integratedEffects.get(thisKey);
            if (ctx) ctx.cameraRequested = false; // allow retry
          });
      }
      if (effectCtx.fluid && !effectSource.cameraEnabled && effectCtx.cameraStream) {
        // Stop webcam (user-disabled path — shares the teardown helper)
        _teardownFluidWebcam(effectCtx);
        console.log('[Canvas] Webcam stopped (user-disabled)');
      }

      // Run simulation step and render
        // Inject camera motion into fluid if webcam is active
        if (effectCtx.cameraTexture && effectCtx.prevCameraTarget && (effectCtx.cameraVideoEl?.readyState ?? 0) >= 2) {
          if (effectCtx.prevCameraCopied) {
            effectCtx.fluid.injectCamera(
              renderer,
              effectCtx.cameraTexture,
              effectCtx.prevCameraTarget.texture,
              effectSource.fluidCameraStrength ?? 3.0
            );
          }
          // Copy current frame to prevCameraTarget for next frame's diff
          // Reuse a shared blit scene to avoid allocating new objects every frame
          if (!effectCtx._camCopyScene) {
            effectCtx._camCopyMat = new THREE.MeshBasicMaterial();
            effectCtx._camCopyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), effectCtx._camCopyMat);
            effectCtx._camCopyScene = new THREE.Scene();
            effectCtx._camCopyScene.add(effectCtx._camCopyMesh);
            effectCtx._camCopyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
          }
          effectCtx._camCopyMat!.map = effectCtx.cameraTexture;
          effectCtx._camCopyMat!.needsUpdate = true;
          renderer.setRenderTarget(effectCtx.prevCameraTarget);
          renderer.render(effectCtx._camCopyScene!, effectCtx._camCopyCam!);
          renderer.setRenderTarget(null);
          effectCtx.prevCameraCopied = true;
        }

        // Mouse interaction — inject velocity + density where user drags/moves mouse
        // Use raw screen-space UVs: U=0 left, U=1 right, V=0 top, V=1 bottom
        const forceScale = effectSource.fluidForceScale ?? 500;
        const fluidCol = effectSource.fluidColor ?? [0.2, 0.5, 1.0];
        if (mouseOnCanvas) {
          const mx = mouseRawU;
          const my = mouseRawV;
          const dmx = mx - effectCtx.lastMouseX;
          const dmy = my - effectCtx.lastMouseY;
          const mouseSpeed = Math.sqrt(dmx * dmx + dmy * dmy);

          if (mouseSpeed > 0.001) {
            const velX = dmx * forceScale;
            const velY = -dmy * forceScale; // negate Y: screen down = negative fluid Y
            effectCtx.fluid.addVelocity(renderer, mx, 1.0 - my, velX, velY, 0.01);

            effectCtx.fluid.addDensity(renderer, mx, 1.0 - my,
              fluidCol[0] * 5, fluidCol[1] * 5, fluidCol[2] * 5, 0.008);
          }

          effectCtx.lastMouseX = mx;
          effectCtx.lastMouseY = my;
        }
        // No automatic motion — fluid is driven purely by mouse and camera input

        // Step simulation
        effectCtx.fluid.step(renderer, deltaTime);

        // Render to target
        effectCtx.fluid.render(renderer, effectCtx.renderTarget);
      }

      // ── Particles3D path ────────────────────────────────────────────────
      if (effectCtx.particles && effectSource.effectType === 'particles') {
        // Resize if needed
        if (effectCtx.particles.width !== width || effectCtx.particles.height !== height) {
          effectCtx.particles.resize(width, height);
        }

        // Sync params from effectSource every frame. Reuse the same object
        // each frame (mutated in place); ParticleSystem3D.setParams has
        // change-detection internally so identical values are a no-op.
        if (!effectCtx._particleParams) {
          effectCtx._particleParams = {
            mode: 0, count: 3000, size: 0.8, speed: 2.0,
            gravity: -0.5, turbulence: 2.0, vortex: 1.0, drag: 0.98,
            mouseForce: 50, mouseRadius: 15, emission: 2.0,
            bloom: 0.6, bloomThreshold: 0.35, material: 0,
            colorA: [0.2, 0.5, 1.0], colorB: [1.0, 0.3, 0.8], colorC: [0.3, 1.0, 0.5],
            colorMode: 0, connectors: false, connectorDist: 5, connectorOpacity: 0.4,
            textureUrl: '', lightCount: 3, lightIntensity: 4.0,
            lightOrbitSpeed: 0.5, lightColorA: [0.3, 0.5, 1.0], lightColorB: [1.0, 0.3, 0.6],
            lightConeAngle: 0.6, ambient: 0.35, autoRotate: true, rotationSpeed: 0.15,
          };
        }
        const pp = effectCtx._particleParams;
        pp.mode            = (effectSource.particleMode ?? 0) as any;
        pp.count           = effectSource.particleCount ?? 3000;
        pp.size            = effectSource.particleSize ?? 0.8;
        pp.speed           = effectSource.particleSpeed ?? 2.0;
        pp.gravity         = effectSource.particleGravity ?? -0.5;
        pp.turbulence      = effectSource.particleTurbulence ?? 2.0;
        pp.vortex          = effectSource.particleVortex ?? 1.0;
        pp.drag            = effectSource.particleDrag ?? 0.98;
        pp.mouseForce      = effectSource.particleMouseForce ?? 50;
        pp.mouseRadius     = effectSource.particleMouseRadius ?? 15;
        pp.emission        = effectSource.particleEmission ?? 2.0;
        pp.bloom           = effectSource.particleBloom ?? 0.6;
        pp.bloomThreshold  = effectSource.particleBloomThreshold ?? 0.35;
        pp.material        = effectSource.particleMaterial ?? 0;
        // Keep the previous cached array reference when no override is present —
        // `?? [0.2, 0.5, 1.0]` would allocate fresh every frame.
        pp.colorA          = effectSource.particleColorA ?? pp.colorA;
        pp.colorB          = effectSource.particleColorB ?? pp.colorB;
        pp.colorC          = effectSource.particleColorC ?? pp.colorC;
        pp.colorMode       = effectSource.particleColorMode ?? 0;
        pp.connectors      = effectSource.particleConnectors ?? false;
        pp.connectorDist   = effectSource.particleConnectorDist ?? 5;
        pp.connectorOpacity= effectSource.particleConnectorOpacity ?? 0.4;
        pp.textureUrl      = effectSource.particleTextureUrl ?? '';
        pp.lightCount      = effectSource.particleLightCount ?? 3;
        pp.lightIntensity  = effectSource.particleLightIntensity ?? 4.0;
        pp.lightOrbitSpeed = effectSource.particleLightOrbitSpeed ?? 0.5;
        pp.lightColorA     = effectSource.particleLightColorA ?? pp.lightColorA;
        pp.lightColorB     = effectSource.particleLightColorB ?? pp.lightColorB;
        pp.lightConeAngle  = effectSource.particleLightConeAngle ?? 0.6;
        pp.ambient         = effectSource.particleAmbient ?? 0.35;
        pp.autoRotate      = effectSource.particleAutoRotate ?? true;
        pp.rotationSpeed   = effectSource.particleRotationSpeed ?? 0.15;
        effectCtx.particles.setParams(pp);

        // Mouse interaction
        if (mouseOnCanvas) {
          const mx = (mouseNormalizedX + 1) * 0.5;
          const my = 1.0 - (mouseNormalizedY + 1) * 0.5;
          effectCtx.particles.setMouse(mx, my, true);
        } else {
          effectCtx.particles.setMouse(0.5, 0.5, false);
        }

        // Step physics + render with bloom to renderTarget
        effectCtx.particles.step(renderer, deltaTime);
        effectCtx.particles.renderToTarget(renderer, effectCtx.renderTarget);
      }

      // Share the rendered texture across all layers referencing this effect source.
      for (const layer of groupedLayers) {
        layer.source!.texture = effectCtx.renderTarget.texture;
      }

      if (!textureCache.has(cacheKey)) {
        textureCache.set(cacheKey, effectCtx.renderTarget.texture);
        evictTextureCache();
      }
    }

    // Clean up effects for removed layers
    for (const [effectId, effectCtx] of integratedEffects) {
      if (!_activeEffectIds.has(effectId)) {
        effectCtx.fluid?.dispose();
        effectCtx.particles?.dispose();
        effectCtx.renderTarget.dispose();
        // Clean up camera feed
        if (effectCtx.cameraStream) {
          effectCtx.cameraStream.getTracks().forEach(t => t.stop());
          effectCtx.cameraVideoEl?.remove();
          effectCtx.cameraTexture?.dispose();
          effectCtx.prevCameraTarget?.dispose();
        }
        integratedEffects.delete(effectId);
        console.log('[Canvas] Disposed integrated effect:', effectId);
      }
    }

    // Reset render target
    renderer.setRenderTarget(null);
  }

  // Expose engine for external use (output window, etc.)
  export function getEngine(): RenderEngine | null {
    return engine;
  }

  // Phase 3 WebGPU bridge: expose the WebGL canvas DOM element so a
  // WebGPU presenter (WebGPUCanvas in bridge mode) can sample it via
  // VideoFrame + importExternalTexture each frame and present the
  // result on a sibling WebGPU canvas. Returns null until onMount has
  // initialised the bind:this.
  export function getCanvas(): HTMLCanvasElement | null {
    return canvas ?? null;
  }

  // Phase 3 WebGPU bridge: when true, the WebGL canvas is hidden via
  // CSS opacity so the overlaid WebGPU presenter shows instead. Chromium
  // continues to PAINT the canvas (opacity:0 doesn't prevent paint, only
  // visibility) so the WebGPU side gets fresh frames. Falls through to
  // visible (opacity:1) by default — no behavioural change for the
  // existing WebGL-only path.
  export let bridgeMode: boolean = false;

  // Expose actual container dimensions for warp handle alignment
  export function getContainerRect(): { x: number; y: number; width: number; height: number } {
    if (!containerEl || !wrapperEl) return { x: 0, y: 0, width: 0, height: 0 };
    const cw = containerEl.offsetWidth;
    const ch = containerEl.offsetHeight;
    const ww = wrapperEl.offsetWidth;
    const wh = wrapperEl.offsetHeight;
    // Container is centered by flexbox within wrapper
    return {
      x: (ww - cw) / 2,
      y: (wh - ch) / 2,
      width: cw,
      height: ch,
    };
  }
</script>

<div class="canvas-wrapper" class:output-mode={isOsrMode || isOutputMode} bind:this={wrapperEl}>
  <div
    class="canvas-container"
    class:output-mode={isOsrMode || isOutputMode}
    bind:this={containerEl}
  >
    <canvas class="main-canvas" class:bridge-source={bridgeMode} bind:this={canvas}></canvas>
    <!-- Edge blend + test pattern overlay -->
    <canvas class="output-overlay" bind:this={outputOverlayCanvas}></canvas>
    {#if $settings.output.blackout}
      <div class="blackout-overlay"></div>
    {/if}
  </div>
</div>

<style>
  .canvas-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #111;
    overflow: hidden;
    position: relative;
  }

  /* Output/OSR mode: fill entire window, no centering constraints */
  .canvas-wrapper.output-mode {
    background: #000;
    align-items: stretch;
    justify-content: stretch;
  }

  .canvas-container {
    position: relative;
    background: #000;
    overflow: hidden;
    contain: paint;
    /* Dimensions are set explicitly by JavaScript in the ResizeObserver callback.
       JS calculates the largest rectangle matching the project aspect ratio
       that fits within the wrapper. This is more reliable than CSS aspect-ratio
       in flex/transform contexts (Tauri WebView). */
  }

  /* Output/OSR mode: fill entire window, no aspect ratio constraints */
  .canvas-container.output-mode {
    max-width: none;
    max-height: none;
    width: 100%;
    height: 100%;
  }

  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* Phase 3 WebGPU bridge: when bridgeMode is on, hide the WebGL
     canvas via opacity so a sibling WebGPU presenter (mounted by
     App.svelte) shows on top instead. opacity:0 keeps the canvas
     in the layout AND keeps Chromium painting it (so the WebGPU
     side gets fresh frames each tick). visibility:hidden /
     display:none would stop the paint. pointer-events stay on
     because mapping interactions still target this layer. */
  .main-canvas.bridge-source {
    opacity: 0;
  }

  .output-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  }

  .blackout-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #000;
    z-index: 2;
  }
</style>
