<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { RenderEngine, loadImageTexture, createVideoTexture, getThreeJSIframeContext, createThreeJSIframeContext, getJSAnimationContext, createJSAnimationContext } from '../renderer/engine';
  import { project, layers, compositions } from '../stores/layers';
  import { nativePreviewHostEl } from '../stores/nativePreviewHost';
  import { splatPointer } from '../stores/splatPointer';
  import { stage3dScene } from '../stage3d/store';
  import { buildNativeStage3DScene } from '../stage3d/nativeSceneBridge';
  import { setNativeRendererStage3DScene } from '$lib/api/native-renderer';
  import { Stage3DRenderer } from '../stage3d/Stage3DRenderer';
  import { mediaLibrary } from '../stores/media';
  import { phoneVision } from '../stores/phoneVision';
  import { vjOutputLayers, vjClipLauncher } from '../stores/vjClipLauncher';
  import {
    nativePerformerWorldOverlays,
    type NativePerformerWorldOverlay,
  } from '../stores/nativePerformerWorld';
  import { applyFaderCurve } from '../renderer/crossfadeTransitions';
  import { vjLayerSequencer } from '../stores/vjLayerSequencer';
  import { macros } from '../stores/macros';
  import { layerSequencer } from '../stores/layerSequencer';
  import { evaluateStageEffectForScreen, stageEffectsRuntime, resolveStageEffectForLayer } from '../stores/stageEffects';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { createLayer, VJ_MIX_SOURCE_INDEX, type Layer, type MappingCompositionState } from '../types';
  import * as THREE from 'three';
  import { createISFShader, updateISFShader, setISFInputValue, setISFInputTexture, type ISFShaderInstance } from '../isf/renderer';
  import { LinesRenderer } from '../lines/renderer';
  import { DrawingRenderer } from '../drawing/renderer';
  import type { SVGLayerRenderer } from '../svg/renderer';
  import { LightPaintingRenderer } from '../lightpainting/renderer';
  import { LightPaintingWebGLRenderer } from '../lightpainting/webglRenderer';
  import { getGPUBrushCanvas } from '../lightpainting/gpuBrushBridge';
  import { TextRenderer } from '../text/renderer';
  import { SplatRenderer } from '../splat/SplatRenderer';
  import { loadPLY, loadSplatFromUrl } from '../splat';
  import type { Model3DRenderer } from '../model3d/Model3DRenderer';
  import { GpuLayerRenderer } from '$lib/renderer/gpuLayerRenderer';
  import { ensureWebGPUDevice, isWebGPUReady, getWebGPUDevice, getPreferredCanvasFormat, getGhostGpuRuntime } from '$lib/renderer/webgpuShared';
  import { getShaderDef } from '$lib/renderer/gpuShaderCatalog';
  import { GhostGpuAdaptiveGovernor, type GhostGpuGovernorSnapshot, type GhostGpuQualityTier } from '$lib/renderer/gpuCaps';
  import { settings, outputFrozen, SHADER_QUALITY_MULTIPLIERS, masterWarpIsActive } from '../stores/settings';
  import { showToast } from '../stores/errorToast';
  import { getTextureShareLabel, invoke, isDesktopApp, isOsrMode, isOutputMode } from '$lib/bridge';
  import { drawTestPattern, type TestPatternType } from '../utils/testPatterns';
  import { applyEdgeBlending } from '../output/outputPostProcess';
  import { renderSlicePixelsAsync, pruneSliceReadbackStates, isBlendRendererAvailable } from '../output/blendRenderer';
  import { isAtlasSenderSlice } from '../output/atlasLayout';
  import type { FluidSimulation, FluidMode } from '../effects/fluidSimulation';
  import type { ParticleSystem3D } from '../effects/particleSystem3D';
  // Heavy renderer classes (three/addons GLTF/FBX/OBJ loaders, post-processing,
  // Line2, fluid/particle sims) are lazy-loaded on first use so they stay out
  // of the initial Canvas chunk. Constructors are cached after first import;
  // a layer that needs one simply waits a frame or two for its chunk.
  let _SVGLayerRendererCtor: typeof import('../svg/renderer').SVGLayerRenderer | null = null;
  let _Model3DRendererCtor: typeof import('../model3d/Model3DRenderer').Model3DRenderer | null = null;
  let _FluidSimulationCtor: typeof import('../effects/fluidSimulation').FluidSimulation | null = null;
  let _ParticleSystem3DCtor: typeof import('../effects/particleSystem3D').ParticleSystem3D | null = null;
  let _MilkdropVisualizerCtor: typeof import('../effects/milkdropVisualizer').MilkdropVisualizer | null = null;
  let _milkdropLoadPresetPack: typeof import('../effects/milkdropPresets').loadPresetPack | null = null;
  let _milkdropPickNextPreset: typeof import('../effects/milkdropPresets').pickNextPreset | null = null;
  let _AudioMotionVisualizerCtor: typeof import('../effects/audiomotionVisualizer').AudioMotionVisualizer | null = null;
  let _AnalyzerLabVisualizerCtor: typeof import('../effects/analyzerLabVisualizer').AnalyzerLabVisualizer | null = null;
  let _HandFXVisualizerCtor: typeof import('../effects/handfxVisualizer').HandFXVisualizer | null = null;
  let _WaveJSVisualizerCtor: typeof import('../effects/wavejsVisualizer').WaveJSVisualizer | null = null;
  let _HydraVisualizerCtor: typeof import('../effects/hydraVisualizer').HydraVisualizer | null = null;
  let _hydraPresetsMod: typeof import('../effects/hydraPresets') | null = null;
  let _GhostFXVisualizerCtor: typeof import('../effects/ghostfx/ghostfxVisualizer').GhostFXVisualizer | null = null;
  let _GhostPilotVisualizerCtor: typeof import('../effects/ghostPilot/ghostPilotVisualizer').GhostPilotVisualizer | null = null;
  const _lazyLoading = new Set<string>();
  function _lazyLoad(key: string, load: () => Promise<void>): void {
    if (_lazyLoading.has(key)) return;
    _lazyLoading.add(key);
    load().catch((e) => { console.warn(`[Canvas] lazy-load ${key} failed:`, e); _lazyLoading.delete(key); });
  }
  // ParticleSystem removed — Particles3D runs as standalone Bevy app via Spout
  import { audioStore, getLastRawAnalysis } from '../stores/audio';
  import { audioTextures } from '../audio/audioTextures';
  import { audioAnalyzer } from '../audio/analyzer';
  import { multiStemAnalyzer } from '../audio/multiStemAnalyzer';
  import { StemRouter } from '../audio/stemRouter';
  import { getVisualAudioSnapshot } from '../audio/visualAudio';
  import { milkdropStore } from '../stores/milkdrop';
  import { hydraStore } from '../stores/hydra';
  import { initStateBroadcast, destroyStateBroadcast } from '$lib/sync/stateBroadcast';
  import { startAudioBroadcast, stopAudioBroadcast, broadcastAudioFrame } from '$lib/sync/audioBroadcast';
  import { startWLEDSenders, stopWLEDSenders, tickWLEDSenders } from '$lib/wled/sender';
  import { startModulationBroadcast, stopModulationBroadcast } from '$lib/sync/modulationBroadcast';
  import { stopOutputPixelBroadcast } from '$lib/sync/outputPixelBroadcast';
  import { tickMasterWarpOutput, getMasterWarpCanvas, reconcileMasterWarpOutput, disposeMasterWarpOutput } from '$lib/sync/outputComposite';
  import {
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
  import {
    attachNativeEditorPreview,
    detachNativeEditorPreview,
    detachNativeRendererOutputWindow,
    setNativeViewportLayerInteraction,
    setNativeRendererOutputWindow,
    updateNativeEditorPreview,
  } from '$lib/api/native-renderer';
  import { nativeRendererRuntime } from '$lib/stores/nativeRenderer';
  import {
    editorCanvasGeometry,
    type EditorCanvasGeometry,
  } from '$lib/stores/editorCanvasGeometry';
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

  /** When true, the normal layer compositor still renders into
   *  RenderEngine.compositeTarget, but the visible canvas is overwritten
   *  by a 3D stage render that samples that composite texture directly.
   *  This keeps VJ content -> LED wall sampling in one WebGL context. */
  export let stage3DOutput = false;
  let stage3DRenderer: Stage3DRenderer | null = null;

  // Spout output state
  const isTauri = isDesktopApp || (typeof window !== 'undefined' && !!window.__ELECTRON__); // Backwards compat alias — works on both Tauri and Electron
  const isElectron = typeof window !== 'undefined' && !!(window as any).__ELECTRON__;
  let spoutOutputActive = false;
  let spoutSendInFlight = false; // prevent overlapping sends
  let spoutSendPixels: Uint8Array | null = null; // pre-allocated readPixels buffer
  let spoutSendW = 0;
  let spoutSendH = 0;
  let osrSpoutActive = false; // True when OSR zero-copy is handling Spout output
  let spoutCpuFallbackAllowed = !isElectron;
  let spoutZeroCopyFailed = false;
  let spoutWasEnabled = false;
  let spoutFrameSkip = 0;     // Counter for frame skipping on CPU send path
  let spoutSendLogCount = 0; // Limit console spam from send errors
  const isTauriRuntime = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

  // Multi-output slice state
  let sliceSendInFlight = new Set<string>(); // Track in-flight per-slice sends
  // Signature of the active slice id set — used to prune async-readback
  // PBO state in blendRenderer when slices are added/removed.
  let lastSliceIdsKey = '';
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
  // Set once the native sync lifecycle arms; lets the render loop push
  // per-frame layer updates (stage-FX opacity rides) into the native scene.
  let nativeLayersSyncRef: (() => void) | null = null;
// Native stage3d scene publishing intentionally removed: the 3D stage
  // window renders its view in WebGL and the recording flow manages the
  // native scene explicitly. Live publishing overlaid the venue onto the
  // 2D output.
  let nativeRendererStatusTimer: ReturnType<typeof setInterval> | null = null;
  let nativeLayersUnsub: (() => void) | null = null;
  let nativeProjectUnsub: (() => void) | null = null;
  let nativeInteractionRaf: number | null = null;
  const nativeInteractionSignatures = new Map<string, string>();
  const pendingNativeInteractions = new Map<string, import('$lib/api/native-renderer').NativeViewportLayerInteraction>();
  let nativeOutputSceneResyncUnsub: (() => void) | null = null;
  let nativePreviewSyncRaf: number | null = null;
  let nativePreviewResizeObserver: ResizeObserver | null = null;
  let nativePreviewWindowEventUnsub: (() => void) | null = null;
  let nativePreviewLastSignature = '';
  let nativePreviewSyncInFlight = false;
  let nativePreviewSyncQueued = false;
  let nativePreviewSyncQueuedReason = 'queued';
  let nativePreviewRequestGeneration = 0;
  let nativePreviewLastVerifiedAt = 0;
  let editorCanvasGeometrySnapshot: EditorCanvasGeometry | null = null;
  let editorCanvasGeometrySignature = '';
  let editorCanvasGeometryRevision = 0;
  // Native-active preview follows the single-render contract: the Rust/wgpu
  // core renders once and the editor views that core frame. Browser GPU
  // instruments are only allowed when the native core is unavailable.
  // The editor preview must be a real UI-integrated native surface, not a
  // managed output window floating over the app with OS chrome.
  const nativeEditorPreviewWindowEnabled = false;
  const nativeEmbeddedPreviewEnabled = true;
  let nativeEmbeddedPresenterAttached = false;
  let stopOsrStatusListener: (() => void) | null = null;

  function queueNativeLayerInteractions(projectLayers: Layer[]): void {
    if (!nativeEngineRequested() || typeof requestAnimationFrame === 'undefined') return;
    const liveIds = new Set<string>();
    for (const layer of projectLayers) {
      liveIds.add(layer.id);
      const meshGrid = layer.warpMode === 'mesh' ? layer.meshGrid ?? null : null;
      const signature = JSON.stringify([layer.corners, meshGrid]);
      if (nativeInteractionSignatures.get(layer.id) === signature) continue;
      nativeInteractionSignatures.set(layer.id, signature);
      pendingNativeInteractions.set(layer.id, {
        layer_id: layer.id,
        corners: layer.corners,
        mesh_grid: meshGrid,
      });
    }
    for (const layerId of nativeInteractionSignatures.keys()) {
      if (!liveIds.has(layerId)) nativeInteractionSignatures.delete(layerId);
    }
    if (nativeInteractionRaf !== null || pendingNativeInteractions.size === 0) return;
    nativeInteractionRaf = requestAnimationFrame(() => {
      nativeInteractionRaf = null;
      const interactions = Array.from(pendingNativeInteractions.values());
      pendingNativeInteractions.clear();
      for (const interaction of interactions) {
        setNativeViewportLayerInteraction(interaction);
      }
    });
  }

  // Multi-slice zero-copy atlas fan-out. When ≥1 Spout/Syphon SENDER
  // slice exists, main runs a hidden slice-atlas OSR window + native
  // per-name senders; the per-slice CPU readback/send below is skipped
  // for those slices (NDI slices keep the async readback path). When
  // the atlas can't run (macOS until Phase 3, addon missing, device
  // init failure) atlasFanoutActive stays false and the CPU path keeps
  // working unchanged.
  let atlasFanoutActive = false;
  let atlasStartInFlight = false;
  let lastAtlasWantOn: boolean | null = null;
  let stopAtlasStatusListener: (() => void) | null = null;

  // Spout receive state for plugin layers — uses WebSocket binary push for zero-copy frames
  interface SpoutReceiverContext {
    senderName: string;
    texture: THREE.DataTexture;
    frameWs: WebSocket | null;     // Dedicated WS for binary frame push
    width: number;
    height: number;
    _stopPolling?: () => void;
  }
  const spoutReceivers = new Map<string, SpoutReceiverContext>();
  type RawFrameData = ArrayBuffer | ArrayBufferView;
  function asUint8FrameData(data: RawFrameData): Uint8Array {
    return ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
  }

  // NDI receiver context — mirrors SpoutReceiverContext. One entry per
  // active NDI receiver clip (keyed by the per-layer cacheKey, same
  // shape as the Spout map so the render path is structurally
  // identical). poll loop calls ghostNDI.receiveFrame; non-null
  // result → upload to the DataTexture.
  interface NdiReceiverContext {
    sourceName: string;
    texture: THREE.DataTexture;
    width: number;
    height: number;
    lastFrameCounter: number;   // monotonic counter from the addon — skip uploads when unchanged
    _stopPolling?: () => void;
  }
  const ndiReceivers = new Map<string, NdiReceiverContext>();

  function cleanupSpoutReceiver(cacheKey: string) {
    const receiver = spoutReceivers.get(cacheKey);
    if (!receiver) return;

    receiver._stopPolling?.();
    if (receiver.frameWs) {
      try { receiver.frameWs.send(JSON.stringify({ type: 'unsubscribe_spout' })); } catch {}
      try { receiver.frameWs.close(); } catch {}
      receiver.frameWs = null;
    }
    try { receiver.texture.dispose(); } catch {}
    spoutReceivers.delete(cacheKey);
    textureCache.delete(cacheKey);
    void invoke('spout_stop_receiver', { senderName: receiver.senderName }).catch(() => {});
  }

  function cleanupNdiReceiver(cacheKey: string) {
    const receiver = ndiReceivers.get(cacheKey);
    if (!receiver) return;

    receiver._stopPolling?.();
    try { receiver.texture.dispose(); } catch {}
    ndiReceivers.delete(cacheKey);
    textureCache.delete(cacheKey);
    void (window as any).ghostNDI?.destroyReceiver(receiver.sourceName).catch(() => {});
  }

  // ── MAP sub-mode layer cache ──────────────────────────────────────
  // MAP mode renders each preset-slot's composition as a synthetic
  // group + cloned layer stack. The clone strips runtime refs (texture,
  // videoElement, renderTarget) for save-safety, but cloning EVERY
  // FRAME meant the engine never got to attach a stable videoElement
  // to source.videoElement — the field would be set on first call to
  // updateTexturesSync and then thrown away when the next frame's
  // fresh clone replaced the layer. Result: video presets froze on
  // their first frame because needsUpdate=true never fired again.
  //
  // Cache key = `mapvj-<slotIdx>-<clipId>`. We rebuild only when the
  // slot's clip changes (different cache key) or the underlying saved
  // composition object reference changes (preset was edited). The
  // group layer is mutated in-place each frame for opacity/blendMode
  // updates — those are pure scalars, no runtime refs to leak.
  interface MapPresetCacheEntry {
    compositionRef: import('../types').Composition;
    group: Layer;
    layers: Layer[];  // cloned + namespaced preset layers (does NOT include group)
  }
  const mapPresetLayerCache = new Map<string, MapPresetCacheEntry>();

  // ── VJ→layer injection cache (stage mode + mapping-mode bindings) ──
  // The injected layer clone + merged effects array are reused across
  // frames and rebuilt only when an identity changes (store layer
  // object, resolved VJ layer, either effects array). The injected
  // SOURCE is rebuilt every frame on purpose: VJ textures change each
  // frame, and the cached VJ source objects are mutated in place
  // (trim/isPlaying/shaderValues) so a frozen copy would go stale.
  // Before this cache, stage mode allocated a layer clone + effects
  // array per VJ-bound layer per frame.
  interface StageInjectCacheEntry {
    layerRef: Layer;
    resolvedLayerRef: Layer;
    layerFxRef: unknown;
    resolvedFxRef: unknown;
    clone: Layer;
  }
  const stageInjectCache = new Map<string, StageInjectCacheEntry>();
  let stageInjectLayersRef: Layer[] | null = null;
  let previousVjLive = false;
  const vjMixCarrierLayer: Layer = {
    ...createLayer('__vj-mix-source__', 'VJ Mix', 'media'),
    source: {
      id: '__vj-mix-source__',
      type: 'image',
      src: '',
      name: 'VJ Mix',
    },
    layerShape: null,
    effects: [],
  };

  function injectVjIntoLayer(layer: Layer, resolved: { layer: Layer; texture: THREE.Texture }): Layer {
    let entry = stageInjectCache.get(layer.id);
    if (
      !entry
      || entry.layerRef !== layer
      || entry.resolvedLayerRef !== resolved.layer
      || entry.layerFxRef !== layer.effects
      || entry.resolvedFxRef !== resolved.layer.effects
    ) {
      entry = {
        layerRef: layer,
        resolvedLayerRef: resolved.layer,
        layerFxRef: layer.effects,
        resolvedFxRef: resolved.layer.effects,
        // Group layers distribute the injected texture to children via
        // renderGroupToTexture — no effects merge. Screen layers keep
        // layer.type unchanged (engine treats 'screen' like 'media');
        // VJ-layer effects run before the screen's own effects.
        clone: layer.type === 'group'
          ? { ...layer }
          : { ...layer, effects: [...(resolved.layer.effects || []), ...layer.effects] },
      };
      stageInjectCache.set(layer.id, entry);
    }
    // Fresh every frame: live texture + passthrough reads. Tag with
    // __vjStage so updateTexturesSync / updateShaderTextures skip this
    // layer on the second pass — the VJ deck already produced the
    // texture, the screen just samples it.
    (entry.clone as any).source = { ...resolved.layer.source, texture: resolved.texture, __vjStage: true };
    return entry.clone;
  }

  /** Drop cache entries for layers that no longer exist. Runs only when
   *  the layers array identity changes (store update), not per frame. */
  function pruneStageInjectCache(normalLayers: Layer[]): void {
    if (stageInjectLayersRef === normalLayers) return;
    stageInjectLayersRef = normalLayers;
    if (stageInjectCache.size === 0) return;
    const liveIds = new Set(normalLayers.map(l => l.id));
    for (const id of stageInjectCache.keys()) {
      if (!liveIds.has(id)) stageInjectCache.delete(id);
    }
  }

  $: {
    const vjLive = $vjClipLauncher.isLive;
    if (previousVjLive && !vjLive) {
      mapPresetLayerCache.clear();
      stageInjectCache.clear();
      stageInjectLayersRef = null;
    }
    previousVjLive = vjLive;
  }

  // Memoized parse of "vj-layer-N(-A|B)" ids — replaces a per-layer
  // regex match per frame. Bounded by layer count × banks.
  const vjIdParseCache = new Map<string, { idx: number; bank?: 'A' | 'B' } | null>();
  function parseVjLayerId(id: string): { idx: number; bank?: 'A' | 'B' } | null {
    let hit = vjIdParseCache.get(id);
    if (hit === undefined) {
      const m = id.match(/^vj-layer-(\d+)(?:-([AB]))?$/);
      hit = m ? { idx: parseInt(m[1]), bank: m[2] as 'A' | 'B' | undefined } : null;
      vjIdParseCache.set(id, hit);
    }
    return hit;
  }

  /** Resolve the actual GPU texture for a VJ layer entry — shader VJ
   *  layers come from shaderRenderTargets, everything else (video /
   *  threejs / synthvision / spout) carries its texture on the source. */
  function resolveVjLayerTexture(vjLayer: Layer): THREE.Texture | null {
    if (!vjLayer?.source) return null;
    if (vjLayer.source.type === 'shader' && vjLayer.source.src) {
      const rt = shaderRenderTargets.get(`${vjLayer.id}:${vjLayer.source.src}`);
      if (rt) return rt.texture;
    }
    return (vjLayer.source.texture as THREE.Texture | null | undefined) ?? null;
  }

  // JSON sanitizer for MAP-mode layer clones. Strips runtime THREE
  // refs that would (a) re-introduce circular structure if persisted
  // by syncState and (b) crash JSON.stringify on the wrapped DOM
  // elements (HTMLVideoElement, HTMLIFrameElement). Keys starting
  // with `_` and objects whose constructor begins with `_` are
  // private-by-convention runtime state; same treatment.
  function _mapCleanCloneLayer(l: Layer): Layer {
    return JSON.parse(JSON.stringify(l, (key, value) => {
      if (key === 'texture' || key === 'videoElement' || key === 'renderTarget' || key === 'iframeElement' || key === 'synthVisionCanvas') return undefined;
      if (typeof key === 'string' && key.startsWith('_')) return undefined;
      if (value && typeof value === 'object' && value.constructor?.name?.startsWith('_')) return undefined;
      return value;
    }));
  }

  // Construct a synthetic group + cloned layer stack for one MAP-mode
  // preset slot. Called only on cache miss / composition edit — see
  // mapPresetLayerCache. The returned `group` is mutated in-place each
  // frame for opacity/blendMode updates; the `layers` array is the
  // namespaced clone of the composition's saved layers, suitable for
  // the engine to attach runtime refs (texture, videoElement) to on
  // first updateTexturesSync pass and reuse forever after.
  function buildMapPresetCacheEntry(
    groupId: string,
    comp: import('../types').Composition,
    slotIdx: number,
    opacity: number,
    blendMode: any,
  ): MapPresetCacheEntry {
    const group: Layer = {
      id: groupId,
      name: `MAP L${slotIdx + 1}: ${comp.name}`,
      type: 'group',
      visible: true,
      locked: false,
      opacity,
      blendMode,
      source: null,
      linesContent: null,
      svgContent: null,
      colorContent: null,
      lightPaintingContent: null,
      advLightPaintingContent: null,
      textContent: null,
      splatContent: null,
      model3dContent: null,
      pixelFXContent: null,
      gpuLayerContent: null,
      arcadeContent: null,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      flipH: false,
      flipV: false,
      warpMode: 'none',
      corners: {
        topLeft: { x: 0, y: 1 },
        topRight: { x: 1, y: 1 },
        bottomLeft: { x: 0, y: 0 },
        bottomRight: { x: 1, y: 0 },
      },
      meshGrid: null,
      mask: null,
      cropRegion: null,
      layerShape: null,
      effects: [],
      edgeEffects: null,
      groupConfig: { shaderMode: 'individual', overrideStyles: false, shaderSource: null },
    };
    const layers: Layer[] = [];
    for (const layer of comp.layers) {
      const cloned = _mapCleanCloneLayer(layer);
      // Namespace the child id so the same preset on two VJ layer
      // slots doesn't fight over the engine's per-layer texture /
      // render-target cache.
      cloned.id = `${groupId}::${cloned.id}`;
      cloned.parentGroupId = groupId;
      cloned.bank = undefined;
      layers.push(cloned);
    }
    return { compositionRef: comp, group, layers };
  }

  const mappingCompositionAutomationState: {
    lastAdvanceMs?: number;
    lastBeatPhase?: number;
    beatsAccum?: number;
  } = {};

  function getLayerCentroid01(layer: Layer): { x: number; y: number } {
    const corners = layer.corners;
    if (!corners) return { x: 0.5, y: 0.5 };
    const points = [corners.topLeft, corners.topRight, corners.bottomLeft, corners.bottomRight];
    const x = points.reduce((sum, p) => sum + (p?.x ?? 0.5), 0) / points.length;
    const y = points.reduce((sum, p) => sum + (p?.y ?? 0.5), 0) / points.length;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  function getMappingCompositionStageLayers(renderLayers: Layer[]): Layer[] {
    const seen = new Set<string>();
    return renderLayers.filter((layer) => {
      if (!layer.visible) return false;
      // Group CHILDREN are the stage slices in the grouped-slice workflow —
      // they must receive the effect chase. Only the group container itself
      // and VJ feed layers are excluded.
      if (String(layer.type) === 'group') return false;
      if (String(layer.id).startsWith('vj-')) return false;
      if (seen.has(layer.id)) return false;
      seen.add(layer.id);
      return true;
    });
  }

  function applyLayerOpacityModulation(layer: Layer, multiplier: number): void {
    const m = Math.max(0, Math.min(1, multiplier));
    if (m >= 0.999) return;
    const mutable = layer as any;
    if (mutable._stageOrigOpacity === undefined) {
      mutable._stageOrigOpacity = layer.opacity;
    }
    layer.opacity = layer.opacity * m;
  }

  function advanceMappingCompositionAutomation(mappingComposition: MappingCompositionState, nowMs: number): void {
    const auto = mappingComposition.stageEffectAutomation;
    if (!auto?.playing) {
      mappingCompositionAutomationState.lastAdvanceMs = undefined;
      mappingCompositionAutomationState.lastBeatPhase = undefined;
      mappingCompositionAutomationState.beatsAccum = undefined;
      return;
    }

    const cycle = (mappingComposition.stageEffects ?? []).filter((effect) => effect.enabled).map((effect) => effect.id);
    if (cycle.length === 0) return;

    let shouldAdvance = false;
    if (auto.mode === 'time') {
      const intervalMs = Math.max(0.1, auto.seconds ?? 4) * 1000;
      if (mappingCompositionAutomationState.lastAdvanceMs == null) {
        mappingCompositionAutomationState.lastAdvanceMs = nowMs;
        shouldAdvance = true;
      } else if (nowMs - mappingCompositionAutomationState.lastAdvanceMs >= intervalMs) {
        mappingCompositionAutomationState.lastAdvanceMs = nowMs;
        shouldAdvance = true;
      }
    } else {
      const audio = get(audioStore);
      const phase = audio?.beatPhase ?? 0;
      if (mappingCompositionAutomationState.lastBeatPhase == null) {
        mappingCompositionAutomationState.lastBeatPhase = phase;
        mappingCompositionAutomationState.beatsAccum = 0;
        shouldAdvance = true;
      } else {
        if (phase < (mappingCompositionAutomationState.lastBeatPhase ?? 0)) {
          mappingCompositionAutomationState.beatsAccum = (mappingCompositionAutomationState.beatsAccum ?? 0) + 1;
        }
        mappingCompositionAutomationState.lastBeatPhase = phase;
        const target = Math.max(1, Math.round(auto.beats ?? 4));
        if ((mappingCompositionAutomationState.beatsAccum ?? 0) >= target) {
          mappingCompositionAutomationState.beatsAccum = 0;
          shouldAdvance = true;
        }
      }
    }

    if (!shouldAdvance) return;

    const currentId = mappingComposition.activeStageEffectId ?? '';
    let idx = cycle.indexOf(currentId);
    idx = idx < 0 ? 0 : (idx + 1) % cycle.length;
    project.setMappingStageEffectActive(cycle[idx]);
  }

  function applyMappingCompositionStageEffects(
    mappingComposition: MappingCompositionState | undefined,
    renderLayers: Layer[],
    nowMs: number,
  ): void {
    if (!mappingComposition?.enabled || mappingComposition.stageEffects.length === 0) return;
    advanceMappingCompositionAutomation(mappingComposition, nowMs);
    const live = mappingComposition.stageEffects.find((effect) => effect.id === mappingComposition.activeStageEffectId);
    if (!live) return;
    const stageLayers = getMappingCompositionStageLayers(renderLayers);
    const sliceCount = stageLayers.length;
    if (sliceCount === 0) return;

    const tSec = nowMs / 1000;
    for (let i = 0; i < sliceCount; i++) {
      const layer = stageLayers[i];
      const { x, y } = getLayerCentroid01(layer);
      const brightness = evaluateStageEffectForScreen(
        `mapping-composition:${layer.id}`,
        live.type,
        live.params,
        x,
        1 - y,
        tSec,
        {
          effectId: live.id,
          opacity: live.opacity ?? 1,
          sliceIndex: i,
          sliceCount,
        },
      );
      applyLayerOpacityModulation(layer, brightness);
    }
  }

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

    // Draw test pattern if active. Under the native driver the core's
    // output stage draws the pattern into the composite itself (so it
    // reaches the projector); painting it here too would double it in
    // the editor preview.
    if (testPattern && testPattern !== 'none' && !nativePrimaryActive()) {
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

  // 1×1 opaque black placeholder, assigned to a layer's source while its
  // content is swapped (new shader compiling, new video loading). Keeps
  // the layer IN the render plan painting black instead of dropping out
  // for a frame — dropping out flashed whatever layer sat underneath,
  // which read as a jarring flicker on every clip/shader change.
  let blackHoldTexture: THREE.DataTexture | null = null;
  function getBlackHoldTexture(): THREE.DataTexture {
    if (!blackHoldTexture) {
      blackHoldTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
      blackHoldTexture.needsUpdate = true;
    }
    return blackHoldTexture;
  }

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
  // Renderer is either the legacy Canvas2D rasteriser or the WebGL2
  // instanced renderer — picked per-layer at create time based on the
  // user's `settings.performance.useWebGL2LightPainting` flag. Hot-
  // swapping is intentionally NOT supported (would require disposing
  // both backends + losing the persistent committed framebuffer);
  // user toggles take effect on the next layer add.
  type LPRenderer = LightPaintingRenderer | LightPaintingWebGLRenderer;
  const lightPaintingRenderers = new Map<string, LPRenderer>();
  let lastLPUpdateTime = 0;
  // THREE.CanvasTexture wrapping WebGPUCanvas's offscreen GPU-brush
  // canvas. Created once and re-uploaded each frame (needsUpdate). The
  // source ref guards against the brush canvas being swapped out.
  let gpuBrushTexture: THREE.CanvasTexture | null = null;
  let gpuBrushTextureSource: HTMLCanvasElement | null = null;

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
  // Electron 42/macOS and some Chromium builds can crash natively when
  // a WebGPU OffscreenCanvas is bridged through transferToImageBitmap()
  // into the WebGL compositor. Default to the stable canvas-backed
  // texture path; keep bitmap handoff available as an explicit dev opt-in.
  const gpuLayerUseBitmapHandoff = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('gpu-layer-bitmap') === '1';
  const gpuDebugEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('gpu-debug') === '1';
  let gpuDebugHudForced = false;
  let gpuQualityGovernor: GhostGpuAdaptiveGovernor | null = null;
  let gpuGovernorSnapshot: GhostGpuGovernorSnapshot | null = null;
  let gpuDebugHudSnapshot: Record<string, any> | null = null;
  // Texture wrapper for each gpu layer. Default path is CanvasTexture;
  // `?gpu-layer-bitmap=1` uses a bare THREE.Texture fed by ImageBitmap.
  const gpuLayerTextures = new Map<string, THREE.Texture>();
  // Latch — try to init WebGPU once; subsequent gpu layers just
  // pull the existing device.
  let _gpuLayerWebGpuTried = false;
  function ensureWebGPUForGpuLayers(): void {
    if (_gpuLayerWebGpuTried) return;
    _gpuLayerWebGpuTried = true;
    void ensureWebGPUDevice().catch((e: any) => console.warn('[Canvas] gpu-layer: WebGPU init failed', e?.message || e));
  }

  function disposeGpuLayerPreviewTextures(): void {
    for (const texture of gpuLayerTextures.values()) {
      const image = texture?.image as ImageBitmap | undefined;
      if (image && typeof (image as any).close === 'function') {
        try { (image as any).close(); } catch { /* */ }
      }
      try { texture?.dispose(); } catch { /* */ }
    }
    gpuLayerTextures.clear();
  }

  function disposeGpuLayerRenderersForNativePreview(reason = 'native-core-preview'): void {
    if (gpuLayerRenderers.size === 0 && gpuLayerTextures.size === 0) return;
    for (const renderer of gpuLayerRenderers.values()) {
      try { renderer.dispose(); } catch { /* */ }
    }
    gpuLayerRenderers.clear();
    disposeGpuLayerPreviewTextures();
    for (const layer of get(project).layers ?? []) {
      if (layer.type !== 'gpu') continue;
      delete (layer as any)._gpuLayerPreviewCanvas;
      delete (layer as any)._gpuLayerTexture;
    }
    if ((window as any).__NATIVE_PREVIEW_DEBUG__) {
      console.log('[Canvas] disposed browser GPU layer renderers for', reason);
    }
  }

  function clearBrowserPreviewLayerScratch(layer: Layer): void {
    delete (layer as any)._linesTexture;
    delete (layer as any)._svgTexture;
    delete (layer as any)._lightPaintingTexture;
    delete (layer as any)._textTexture;
    delete (layer as any)._splatTexture;
    delete (layer as any)._model3dTexture;
    delete (layer as any)._gpuLayerPreviewCanvas;
    delete (layer as any)._gpuLayerTexture;
  }

  function disposeBrowserPreviewRenderersForNativeCore(reason = 'native-core-preview'): void {
    const hadResources = (
      gpuLayerRenderers.size > 0 ||
      gpuLayerTextures.size > 0 ||
      shaderInstances.size > 0 ||
      shaderRenderTargets.size > 0 ||
      linesRenderTargets.size > 0 ||
      svgRenderers.size > 0 ||
      svgRenderTargets.size > 0 ||
      lightPaintingRenderers.size > 0 ||
      textRenderers.size > 0 ||
      splatRenderers.size > 0 ||
      model3dRenderers.size > 0 ||
      integratedEffects.size > 0
    );

    for (const layer of get(project).layers ?? []) {
      clearBrowserPreviewLayerScratch(layer);
    }

    disposeGpuLayerRenderersForNativePreview(reason);

    for (const shader of shaderInstances.values()) {
      try { shader.material.dispose(); } catch { /* */ }
    }
    shaderInstances.clear();
    for (const rt of shaderRenderTargets.values()) {
      try { rt.dispose(); } catch { /* */ }
    }
    shaderRenderTargets.clear();

    for (const rt of linesRenderTargets.values()) {
      try { rt.dispose(); } catch { /* */ }
    }
    linesRenderTargets.clear();

    for (const svgRenderer of svgRenderers.values()) {
      try { svgRenderer.dispose(); } catch { /* */ }
    }
    svgRenderers.clear();
    for (const rt of svgRenderTargets.values()) {
      try { rt.dispose(); } catch { /* */ }
    }
    svgRenderTargets.clear();

    for (const renderer of lightPaintingRenderers.values()) {
      try { renderer.dispose(); } catch { /* */ }
    }
    lightPaintingRenderers.clear();

    for (const renderer of textRenderers.values()) {
      try { renderer.dispose(); } catch { /* */ }
    }
    textRenderers.clear();

    for (const splatCtx of splatRenderers.values()) {
      try { splatCtx.renderer.dispose(); } catch { /* */ }
      try { splatCtx.renderTarget.dispose(); } catch { /* */ }
    }
    splatRenderers.clear();

    for (const model3dCtx of model3dRenderers.values()) {
      disposeModel3DContext(model3dCtx);
    }
    model3dRenderers.clear();

    for (const effect of integratedEffects.values()) {
      disposeIntegratedEffectContext(effect);
    }
    integratedEffects.clear();

    if (hadResources && (window as any).__NATIVE_PREVIEW_DEBUG__) {
      console.log('[Canvas] disposed browser preview renderers for', reason);
    }
  }

  async function prewarmGpuShaderForLayer(layerId: string, shaderId: string): Promise<void> {
    if (nativeEngineRequested()) return;
    const projectData = get(project);
    const layer = projectData?.layers?.find((l: Layer) => l.id === layerId);
    if (!layer || layer.type !== 'gpu' || !layer.gpuLayerContent || layer.gpuLayerContent.shaderId === shaderId) return;
    const def = getShaderDef(shaderId);
    if (!def) return;

    let device = getWebGPUDevice();
    let presentFormat = getPreferredCanvasFormat();
    if (!isWebGPUReady() || !device) {
      try {
        const ready = await ensureWebGPUDevice();
        device = ready.device;
        presentFormat = ready.presentFormat;
      } catch (err: any) {
        console.warn('[Canvas] gpu-layer: shader prewarm skipped', err?.message || err);
        return;
      }
    }
    if (!device) return;

    if (def.prewarm) {
      try {
        await def.prewarm(device, presentFormat, getGhostGpuRuntime() ?? undefined);
      } catch (err: any) {
        console.warn('[Canvas] gpu-layer: shader prewarm failed', shaderId, err?.message || err);
      }
      return;
    }

    const width = projectData?.width || 1920;
    const height = projectData?.height || 1080;
    let renderer = gpuLayerRenderers.get(layerId);
    if (!renderer) {
      try {
        renderer = new GpuLayerRenderer(device, presentFormat, width, height, {
          handoffMode: gpuLayerUseBitmapHandoff ? 'bitmap' : 'canvas',
        });
        gpuLayerRenderers.set(layerId, renderer);
      } catch (err: any) {
        console.warn('[Canvas] gpu-layer: failed to create prewarm renderer for', layerId, err?.message || err);
        return;
      }
    }

    const restored = layer.gpuLayerContent.paramsByShader?.[shaderId];
    const params = restored
      ? { ...def.defaultParams, ...restored }
      : { ...def.defaultParams };
    renderer.prewarmShader(shaderId, params);
  }

  function getGpuDebugSnapshot(): Record<string, any> {
    const runtime = getGhostGpuRuntime();
    return {
      ready: isWebGPUReady(),
      handoffMode: gpuLayerUseBitmapHandoff ? 'bitmap' : 'canvas',
      activeGpuLayerRenderers: gpuLayerRenderers.size,
      activeGpuLayerTextures: gpuLayerTextures.size,
      runtime: runtime
        ? {
            backend: runtime.backend,
            adapter: runtime.caps.description,
            quality: runtime.caps.quality.label,
            qualityMode: get(settings).performance.gpuInstrumentQuality ?? 'auto',
            features: {
              shaderF16: runtime.caps.shaderF16,
              timestampQuery: runtime.caps.timestampQuery,
              float32Filterable: runtime.caps.float32Filterable,
            },
            governor: gpuGovernorSnapshot,
            stats: runtime.stats(),
          }
        : null,
      layers: [...gpuLayerRenderers.entries()].map(([id, renderer]) => ({
        id,
        ...renderer.debugStats(),
      })),
    };
  }

  function logGpuDebugSnapshot(): void {
    if (!isGpuDebugActive() || isOutputMode || isOsrMode) return;
    const snapshot = getGpuDebugSnapshot();
    const runtimeStats = snapshot.runtime?.stats ?? {};
    console.log('[GPU DEBUG]', {
      ready: snapshot.ready,
      quality: snapshot.runtime?.quality ?? 'n/a',
      gpuLayers: snapshot.activeGpuLayerRenderers,
      shaderModules: runtimeStats.shaderModulesCreated,
      renderPipelines: runtimeStats.renderPipelinesCreated,
      computePipelines: runtimeStats.computePipelinesCreated,
      warmupsPending: runtimeStats.pendingPipelineWarmups,
      pooledBytes: runtimeStats.pooledBytes,
      governor: snapshot.runtime?.governor ?? null,
      layers: snapshot.layers.map((layer: any) => ({
        id: layer.id,
        shaderId: layer.shaderId,
        quality: layer.quality,
        graphCpuMs: layer.shader?.graphCpuMs ?? layer.shader?.smoke?.graphCpuMs,
        passes: layer.shader?.passes?.length ?? layer.shader?.smoke?.passes?.length ?? 0,
      })),
    });
  }

  function isGpuDebugActive(): boolean {
    return gpuDebugEnabled || gpuDebugHudForced;
  }

  function updateGpuDebugHudSnapshot(): void {
    if (!isGpuDebugActive() || isOutputMode || isOsrMode) return;
    gpuDebugHudSnapshot = getGpuDebugSnapshot();
  }

  function formatGpuMs(value: any): string {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(2)}ms` : 'n/a';
  }

  function formatGpuBytes(value: any): string {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '0 MB';
    return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
  }

  function gpuLayerGraphStats(layer: any): { cpuMs: string; passCount: number } {
    const shader = layer?.shader ?? {};
    const stats = shader?.smoke ?? shader;
    const passes = Array.isArray(stats?.passes) ? stats.passes : [];
    return {
      cpuMs: formatGpuMs(stats?.graphCpuMs),
      passCount: passes.length,
    };
  }

  function gpuQualityAppliedSummary(layer: any): string {
    const applied = layer?.quality?.applied;
    if (!applied || typeof applied !== 'object') return 'no caps';
    const keys = Object.keys(applied);
    if (!keys.length) return 'no caps';
    return keys.slice(0, 3).map((key) => `${key}:${applied[key]?.to}`).join('  ');
  }

  function updateGpuQualityGovernor(avgFrameMs: number): void {
    const runtime = getGhostGpuRuntime();
    if (!runtime || gpuLayerRenderers.size === 0 || isOutputMode || isOsrMode || nativeEngineRequested()) return;
    if ((get(settings).performance.gpuInstrumentQuality ?? 'auto') !== 'auto') {
      gpuGovernorSnapshot = null;
      return;
    }
    if (!gpuQualityGovernor) {
      gpuQualityGovernor = new GhostGpuAdaptiveGovernor(runtime.caps.qualityTier);
    }
    gpuGovernorSnapshot = gpuQualityGovernor.recordFrame(avgFrameMs);
  }

  function fixedGpuInstrumentTier(): GhostGpuQualityTier | null {
    const mode = get(settings).performance.gpuInstrumentQuality ?? 'auto';
    return mode === 'auto' ? null : mode as GhostGpuQualityTier;
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

  function disposeModel3DContext(ctx: Model3DRendererContext): void {
    (ctx as any)._disposed = true;
    try { ctx.renderer.dispose(); } catch {}
    try { ctx.renderTarget.dispose(); } catch {}
    try {
      const offCanvas = (ctx as any)._offCanvas as HTMLCanvasElement | undefined;
      offCanvas?.remove();
    } catch {}
    (ctx as any)._offCanvas = null;
    (ctx as any)._canvasTex = null;
  }

  // Integrated effects (FluidSimulation, ParticleSystem3D)
  interface IntegratedEffectContext {
    type: 'fluid' | 'particles' | 'milkdrop' | 'audiomotion' | 'wavejs' | 'hydra' | 'ghostfx' | 'analyzerlab' | 'handfx' | 'ghostpilot';
    fluid?: FluidSimulation;
    particles?: ParticleSystem3D;
    milkdrop?: import('../effects/milkdropVisualizer').MilkdropVisualizer;
    audiomotion?: import('../effects/audiomotionVisualizer').AudioMotionVisualizer;
    audiomotionAudioAttached?: boolean;
    analyzerlab?: import('../effects/analyzerLabVisualizer').AnalyzerLabVisualizer;
    handfx?: import('../effects/handfxVisualizer').HandFXVisualizer;
    wavejs?: import('../effects/wavejsVisualizer').WaveJSVisualizer;
    wavejsAudioAttached?: boolean;
    hydra?: import('../effects/hydraVisualizer').HydraVisualizer;
    hydraLayerId?: string;
    hydraLastCommandTag?: number;
    hydraLoadedPresetName?: string;
    ghostfx?: import('../effects/ghostfx/ghostfxVisualizer').GhostFXVisualizer;
    ghostpilot?: import('../effects/ghostPilot/ghostPilotVisualizer').GhostPilotVisualizer;
    // Milkdrop preset cycling state
    milkdropPresets?: Record<string, any>;
    milkdropPresetNames?: string[];      // cached sorted name list for next/prev navigation
    milkdropPresetPack?: string;
    milkdropLoadedPresetName?: string;
    milkdropLastEvolveAt?: number;       // performance.now()
    milkdropLastEvolveBeat?: number;     // beatCount snapshot
    milkdropAudioAttached?: boolean;
    milkdropAudioSource?: 'mono' | 'stems'; // which audio source butterchurn is currently wired to
    milkdropStemRouter?: import('../audio/stemRouter').StemRouter;  // active when audioSource='stems'
    milkdropLastCommandTag?: number;     // for edge-triggered next/prev/random/cut/load
    milkdropLastHardCutAt?: number;      // refractory to avoid every-beat cut on dense kicks
    milkdropLayerId?: string;            // first layer id in the group — used for store keying
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

  function disposeIntegratedCameraFeed(ctx: IntegratedEffectContext): void {
    try {
      ctx.cameraStream?.getTracks().forEach(track => {
        try { track.onended = null; } catch {}
        track.stop();
      });
    } catch {}
    try {
      if (ctx.cameraVideoEl) {
        ctx.cameraVideoEl.pause();
        ctx.cameraVideoEl.srcObject = null;
        ctx.cameraVideoEl.removeAttribute('src');
        ctx.cameraVideoEl.load();
        ctx.cameraVideoEl.remove();
      }
    } catch {}
    try { ctx.cameraTexture?.dispose(); } catch {}
    try { ctx.prevCameraTarget?.dispose(); } catch {}
    try { ctx._camCopyMat?.dispose(); } catch {}
    try { ctx._camCopyMesh?.geometry?.dispose(); } catch {}
    try {
      if (ctx._camCopyScene && ctx._camCopyMesh) {
        ctx._camCopyScene.remove(ctx._camCopyMesh);
      }
    } catch {}
    ctx.cameraStream = undefined;
    ctx.cameraVideoEl = undefined;
    ctx.cameraTexture = undefined;
    ctx.prevCameraTarget = undefined;
    ctx.prevCameraCopied = false;
    ctx.cameraRequested = false;
    ctx._camCopyScene = undefined;
    ctx._camCopyMat = undefined;
    ctx._camCopyMesh = undefined;
    ctx._camCopyCam = undefined;
  }

  function disposeIntegratedEffectContext(ctx: IntegratedEffectContext): void {
    disposeIntegratedCameraFeed(ctx);
    try { ctx.fluid?.dispose(); } catch (e) { console.warn('[Canvas] fluid dispose error:', e); }
    try { ctx.particles?.dispose(); } catch (e) { console.warn('[Canvas] particles dispose error:', e); }
    try { ctx.milkdrop?.dispose(); } catch (e) { console.warn('[Canvas] milkdrop dispose error:', e); }
    try { ctx.milkdropStemRouter?.dispose(); } catch {}
    try { ctx.audiomotion?.dispose(); } catch (e) { console.warn('[Canvas] audiomotion dispose error:', e); }
    try { ctx.wavejs?.dispose(); } catch (e) { console.warn('[Canvas] wavejs dispose error:', e); }
    try { ctx.hydra?.dispose(); } catch (e) { console.warn('[Canvas] hydra dispose error:', e); }
    try { ctx.ghostfx?.dispose(); } catch (e) { console.warn('[Canvas] ghostfx dispose error:', e); }
    try { ctx.ghostpilot?.dispose(); } catch (e) { console.warn('[Canvas] ghostpilot dispose error:', e); }
    try { ctx.analyzerlab?.dispose(); } catch (e) { console.warn('[Canvas] analyzerlab dispose error:', e); }
    try { ctx.handfx?.dispose(); } catch (e) { console.warn('[Canvas] handfx dispose error:', e); }
    try { ctx.renderTarget.dispose(); } catch {}
  }

  let lastEffectUpdateTime = 0;
  let lastIntegratedEffectManualTime: number | null = null;
  function getIntegratedEffectDeltaTime(): number {
    const manualTime = engine?.manualTime;
    if (typeof manualTime === 'number' && Number.isFinite(manualTime)) {
      const previousManualTime = lastIntegratedEffectManualTime;
      lastIntegratedEffectManualTime = manualTime;
      // Keep the live wall-clock baseline warm so returning from export
      // does not create one large catch-up step.
      lastEffectUpdateTime = performance.now() / 1000;
      if (previousManualTime === null || manualTime < previousManualTime) return 0;
      return Math.max(0, Math.min(manualTime - previousManualTime, 0.1));
    }

    lastIntegratedEffectManualTime = null;
    const currentTime = performance.now() / 1000;
    const deltaTime = Math.min(currentTime - lastEffectUpdateTime, 0.1);
    lastEffectUpdateTime = currentTime;
    return Math.max(0, deltaTime);
  }
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
    publishEditorCanvasGeometry();
  }

  function layoutOffsetWithin(
    element: HTMLElement,
    ancestor: HTMLElement,
  ): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    let current: HTMLElement | null = element;
    while (current && current !== ancestor) {
      x += current.offsetLeft;
      y += current.offsetTop;
      current = current.offsetParent as HTMLElement | null;
    }
    return current === ancestor ? { x, y } : null;
  }

  function publishEditorCanvasGeometry(): EditorCanvasGeometry | null {
    if (isOutputMode || isOsrMode || !containerEl || !wrapperEl) return null;
    const layoutRoot = containerEl.closest('.viewport-content') as HTMLElement | null;
    if (!layoutRoot) return null;

    const layoutOffset = layoutOffsetWithin(containerEl, layoutRoot);
    const clientRect = containerEl.getBoundingClientRect();
    const layoutWidth = containerEl.offsetWidth;
    const layoutHeight = containerEl.offsetHeight;
    if (
      !layoutOffset
      || layoutWidth <= 1
      || layoutHeight <= 1
      || clientRect.width <= 1
      || clientRect.height <= 1
    ) return null;

    const values = [
      layoutOffset.x,
      layoutOffset.y,
      layoutWidth,
      layoutHeight,
      clientRect.left,
      clientRect.top,
      clientRect.width,
      clientRect.height,
    ];
    const signature = values.map((value) => Number(value).toFixed(3)).join(',');
    if (signature === editorCanvasGeometrySignature && editorCanvasGeometrySnapshot) {
      return editorCanvasGeometrySnapshot;
    }

    editorCanvasGeometrySignature = signature;
    editorCanvasGeometrySnapshot = {
      layoutX: layoutOffset.x,
      layoutY: layoutOffset.y,
      layoutWidth,
      layoutHeight,
      clientX: clientRect.left,
      clientY: clientRect.top,
      clientWidth: clientRect.width,
      clientHeight: clientRect.height,
      revision: ++editorCanvasGeometryRevision,
    };
    editorCanvasGeometry.set(editorCanvasGeometrySnapshot);
    return editorCanvasGeometrySnapshot;
  }

  /** Get wrapper layout dimensions (before CSS transforms like viewport zoom).
   *  offsetWidth/offsetHeight are NOT affected by parent transforms, unlike getBoundingClientRect(). */
  function getWrapperLayoutSize() {
    return { w: wrapperEl.offsetWidth, h: wrapperEl.offsetHeight };
  }

  onMount(() => {
    if (!isOutputMode && !isOsrMode && typeof window !== 'undefined') {
      // Splat mouse interaction: window-level so the pointer works over
      // the native presenter hole (which has no DOM surface of its own).
      window.addEventListener('pointermove', handleSplatPointerMove, { passive: true });
      window.addEventListener('pointerdown', handleSplatPointerDown, { passive: true });
      window.addEventListener('pointerup', handleSplatPointerUp, { passive: true });
      (window as any).__ghostPrewarmGpuShader = (layerId: string, shaderId: string) => {
        void prewarmGpuShaderForLayer(layerId, shaderId);
      };
      (window as any).__ghostGpuDebug = () => getGpuDebugSnapshot();
      (window as any).__ghostGpuDebugHud = (enabled = true) => {
        gpuDebugHudForced = !!enabled;
        updateGpuDebugHudSnapshot();
        return gpuDebugHudSnapshot;
      };
    }

    const { w: wrapW, h: wrapH } = getWrapperLayoutSize();
    const projW = $project.width || 1920;
    const projH = $project.height || 1080;

    function startNativeRendererSyncLifecycle(): void {
      if (!((isTauriRuntime || isElectron) && !isOsrMode && !isOutputMode)) return;
      if (nativeRendererSync) return;
      nativeRendererSync = new NativeRendererSync();
      const size = getProjectOutputSize();
      void nativeRendererSync.start(size.width, size.height).then(() => {
        console.log('[NativeRendererSync] sync loop armed');
        void nativeRendererSync?.logStatus();
        nativeRendererStatusTimer = setInterval(() => {
          void nativeRendererSync?.logStatus();
        }, 3000);
      }).catch((err) => {
        console.warn('[NativeRendererSync] failed to start native renderer:', err);
      });

      nativeLayersUnsub = layers.subscribe(($layers) => {
        // Route through the VJ-aware effective-layers path once it is
        // armed: pushing raw $layers here during a VJ-live set drops the
        // deck feed layers and stomps the stage scene (visible as slices
        // reverting to their default shaders whenever the project store
        // churns — e.g. Stage FX automation advancing every beat).
        if (nativeLayersSyncRef) {
          nativeLayersSyncRef();
          return;
        }
        const p = get(project);
        nativeRendererSync?.scheduleSync(p.width || 1920, p.height || 1080, $layers);
      });

      // The native compositor's layer list: VJ live sets replace the editor
      // layers (the legacy engine did this merge inside its render loop,
      // which the native path returns out of before reaching it — VJ clip
      // triggers otherwise never reach the core and the output stays black).
      // A/B crossfader weights for the native compositor: full-A means Bank B
      // contributes NOTHING (opacity 0 — layers stay resident so riding the
      // fader never re-warms sources), full-B mutes Bank A, and the middle
      // blends per the selected fader curve. Dissolve is the native v1 mix;
      // shader transitions (wipes etc.) need a core-side crossfade pass.
      const nativeCrossfadeWeights = (vjState: {
        crossfaderEnabled?: boolean;
        crossfaderValue?: number;
        crossfaderCurve?: 'linear' | 'constant-power' | 'sharp-cut';
      }): { a: number; b: number } | null => {
        if (!vjState.crossfaderEnabled) return null;
        const value = Math.max(0, Math.min(1, vjState.crossfaderValue ?? 0));
        const curve = vjState.crossfaderCurve || 'constant-power';
        const shaped = applyFaderCurve(value, curve);
        if (curve === 'constant-power') {
          return { a: Math.cos(value * Math.PI / 2), b: Math.sin(value * Math.PI / 2) };
        }
        return { a: 1 - shaped, b: shaped };
      };
      const appendNativePerformerWorldLayers = (
        baseLayers: Layer[],
        vjLayers: Layer[],
        weights: { a: number; b: number } | null,
      ): Layer[] => {
        const overlayState = get(nativePerformerWorldOverlays);
        const overlays = (['A', 'B'] as const)
          .map((deck): NativePerformerWorldOverlay | null => overlayState[deck])
          .filter((overlay): overlay is NativePerformerWorldOverlay =>
            !!overlay?.enabled,
          )
          .map((overlay): Layer | null => {
            const sourceLayer = vjLayers.find((candidate) => {
              const parsed = parseVjLayerId(candidate.id);
              if (!parsed || parsed.idx !== overlay.layerIndex) return false;
              return (parsed.bank ?? 'A') === overlay.deck;
            });
            if (!sourceLayer) return null;
            const deckWeight = weights
              ? overlay.deck === 'A' ? weights.a : weights.b
              : 1;
            return {
              ...sourceLayer,
              id: `performer-world-${overlay.deck}-${overlay.layerIndex}`,
              name: 'Performer World',
              opacity: sourceLayer.opacity * deckWeight,
              blendMode: 'add',
              source: {
                id: `performer-world-src-${overlay.deck}-${overlay.layerIndex}`,
                type: 'effect',
                src: `plugin://performer-world/${overlay.deck}/${overlay.layerIndex}`,
                name: 'Performer World',
                effectSource: {
                  effectType: 'performer-world',
                  performerWorldIndex: overlay.worldIndex,
                  performerWorldSpace: overlay.spaceIndex,
                  performerWorldX: overlay.x,
                  performerWorldY: overlay.y,
                  performerWorldPointerDown: overlay.pointerDown,
                  performerWorldParams: overlay.params,
                  performerWorldPump: overlay.pump,
                },
              },
              effects: [],
              edgeEffects: null,
            };
          })
          .filter((overlay): overlay is Layer => !!overlay);
        return overlays.length ? [...overlays, ...baseLayers] : baseLayers;
      };
      // True post-crossfade VJ Mix carrier: a synthetic feed-only layer that
      // makes the core render the full VJ row stack (bottom→top, per-row
      // opacity + blend, post-crossfade per row) into one source frame.
      // Mapping layers bound to "VJ Mix" (vjLayerIndex === -1) get this
      // carrier's source via resolveNativeGroupLayers, replacing the old
      // lowest-active-row approximation. Opacity 0 — it never composites
      // itself, it only keeps the mix frame rendering.
      const appendNativeVjMixCarrier = (list: Layer[]): Layer[] => {
        type MixRowEntry = { layerId: string; opacity: number; blendMode: string };
        const rowsByIdx = new Map<number, MixRowEntry>();
        for (const layer of list) {
          const id = String(layer.id);
          const xfade = /^vj-xfade-(\d+)$/.exec(id);
          if (xfade) {
            // Crossfade carrier: bank opacities are baked into the native
            // transition pass output, so the row rides at full opacity.
            rowsByIdx.set(Number(xfade[1]), {
              layerId: id,
              opacity: 1,
              blendMode: String(layer.blendMode || 'normal'),
            });
            continue;
          }
          const parsed = parseVjLayerId(id);
          if (!parsed) continue;
          const existing = rowsByIdx.get(parsed.idx);
          // A crossfade carrier always wins; among plain/bank rows keep the
          // most visible entry (dual-bank residents ride at opacity 0).
          if (existing?.layerId.startsWith('vj-xfade-')) continue;
          const entry: MixRowEntry = {
            layerId: id,
            opacity: Math.max(0, Math.min(1, layer.opacity ?? 1)),
            blendMode: String(layer.blendMode || 'normal'),
          };
          if (!existing || entry.opacity >= existing.opacity) rowsByIdx.set(parsed.idx, entry);
        }
        if (!rowsByIdx.size) return list;
        // Bottom→top: VJ row 0 is topmost (the engine reverses the render
        // plan), so the composite stacks from the highest index upward.
        const rows = Array.from(rowsByIdx.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([, entry]) => entry);
        return [
          ...list,
          {
            ...createLayer('__vj-mix__', 'VJ Mix', 'media'),
            visible: true,
            opacity: 0,
            blendMode: 'normal',
            source: {
              id: '__vj-mix-src__',
              type: 'effect',
              src: 'plugin://vj-mix',
              name: 'VJ Mix',
              effectSource: {
                effectType: 'vj-mix',
                vjmixRows: rows,
              },
            } as NonNullable<Layer['source']>,
            effects: [],
            edgeEffects: null,
          } as Layer,
        ];
      };
      const nativeEffectiveLayers = (): Layer[] | null => {
        const vjState = get(vjClipLauncher);
        // STAGE mode: the VJ feed layers render their frames invisibly while
        // the mapping scene's Screen layers sample those streams core-side
        // via vj_layer_index. Both lists must reach the native sync.
        const stageWrap = (list: Layer[]): Layer[] => {
          if (!vjState.stageMode) return list;
          const mappingLayers = (get(layers) as Layer[])
            .filter((l) => !String(l.id).startsWith('vj-'))
            .map((l) => ({ ...l }));
          return [
            ...list.map((l) => ({ ...l, opacity: 0 })),
            ...mappingLayers,
          ];
        };
        if (vjState.isLive) {
          if (vjState.mapMode) {
            // ── MAP sub-mode, native path ──
            // The WebGL preset mixer above never runs when the core owns
            // the frame, so build the same synthetic group + namespaced
            // preset children here. resolveNativeGroupLayers drops the
            // group container and multiplies its opacity into the
            // children, so slot faders act on the whole preset.
            if (vjState.stoppedAll) return [];
            const comps = get(compositions);
            const seqState = get(vjLayerSequencer);
            const presetLayers: Layer[] = [];
            const lsArr = vjState.layerStates;
            const hasSolo = lsArr.some((l) => l.solo);
            const activeKeys = new Set<string>();
            for (let i = 0; i < lsArr.length; i++) {
              const ls = lsArr[i];
              if (ls.mute) continue;
              if (hasSolo && !ls.solo) continue;
              const clip = ls.activeClip;
              if (!clip || clip.type !== 'preset' || !clip.presetId) continue;
              const comp = comps.find((c) => c.id === clip.presetId);
              if (!comp) continue;
              const sequenceOpacity = seqState.isPlaying
                ? (seqState.opacityOverrides?.[i] ?? 1)
                : 1;
              const groupOpacity = ls.opacity * sequenceOpacity * (vjState.masterOpacity ?? 1);
              if (groupOpacity <= 0) continue;
              const groupId = `mapvj-${i}-${clip.id}`;
              activeKeys.add(groupId);
              let entry = mapPresetLayerCache.get(groupId);
              if (!entry || entry.compositionRef !== comp) {
                entry = buildMapPresetCacheEntry(groupId, comp, i, groupOpacity, ls.blendMode);
                mapPresetLayerCache.set(groupId, entry);
              }
              entry.group.opacity = groupOpacity;
              entry.group.blendMode = ls.blendMode;
              presetLayers.push(entry.group);
              for (const child of entry.layers) presetLayers.push(child);
            }
            for (const key of mapPresetLayerCache.keys()) {
              if (!activeKeys.has(key)) mapPresetLayerCache.delete(key);
            }
            return presetLayers;
          }
          if (vjState.stoppedAll) return stageWrap([]);
          const vjLayers = get(vjOutputLayers);
          if (!vjLayers?.length) return stageWrap([]);
          const weights = nativeCrossfadeWeights(vjState);
          if (!weights) {
            return stageWrap(appendNativeVjMixCarrier(
              appendNativePerformerWorldLayers(vjLayers, vjLayers, weights),
            ));
          }
          // A/B crossfade with a paired transition shader: both banks stay
          // composited at opacity 0 (their frames keep rendering — the mix
          // pass samples them via layer-frame bindings) and a synthetic
          // layer per index shows the transition output. Single-bank rows
          // fall back to fader-weighted opacity.
          const byIndex = new Map<number, { a?: Layer; b?: Layer }>();
          const output: Layer[] = [];
          for (const layer of vjLayers) {
            const parsed = parseVjLayerId(layer.id);
            if (!parsed?.bank) {
              output.push(layer);
              continue;
            }
            const slot = byIndex.get(parsed.idx) ?? {};
            if (parsed.bank === 'A') slot.a = layer;
            else slot.b = layer;
            byIndex.set(parsed.idx, slot);
          }
          // Mix value handed to the native transition shader. Every WGSL
          // transition applies its own constant-power (or equivalent) response
          // to the incoming mix, so 'constant-power' must pass the RAW fader
          // value — pre-shaping it here double-applied sin(v·π/2), which
          // skewed the perceptual midpoint to ~35% travel and kept the
          // incoming deck invisible until well past a third of the throw.
          // 'linear' is identity and 'sharp-cut' genuinely wants its S-curve
          // pre-shape, so those still go through applyFaderCurve.
          const xfadeCurve = vjState.crossfaderCurve || 'constant-power';
          const rawFader = Math.max(0, Math.min(1, vjState.crossfaderValue ?? 0));
          const shapedMix = xfadeCurve === 'constant-power'
            ? rawFader
            : applyFaderCurve(rawFader, xfadeCurve);
          const stateA = vjState.layerStates ?? [];
          const stateB = vjState.bankBLayerStates ?? [];
          for (const [idx, slot] of byIndex.entries()) {
            // Derived-store lag guard: the launcher state says both decks
            // hold a clip on this row, but vjOutputLayers has only one bank
            // materialized. Emitting the single-bank weighted version now
            // would flip the scene shape for one tick (visible as a black
            // blink and constant template churn). Signal "stale" instead.
            const bothActive = !!stateA[idx]?.activeClip && !!stateB[idx]?.activeClip;
            if (bothActive && (!slot.a || !slot.b)) {
              return null;
            }
            if (slot.a && slot.b) {
              output.push({ ...slot.a, opacity: 0, _deckMonitorBank: 'a', _deckMonitorOpacity: slot.a.opacity });
              output.push({ ...slot.b, opacity: 0, _deckMonitorBank: 'b', _deckMonitorOpacity: slot.b.opacity });
              output.push({
                ...slot.a,
                id: `vj-xfade-${idx}`,
                // Bank opacity is applied inside the native transition pass.
                // Keep the carrier fully live so either side can fade all the
                // way to transparent without double-applying its envelope.
                opacity: 1,
                // Blend modes are discrete, so hand the carrier to whichever
                // bank currently owns the larger share of the fader.
                blendMode: shapedMix < 0.5 ? slot.a.blendMode : slot.b.blendMode,
                source: {
                  id: `vj-xfade-src-${idx}`,
                  type: 'effect',
                  src: `plugin://vj-crossfade/${idx}`,
                  name: 'VJ Crossfade',
                  effectSource: {
                    effectType: 'vj-crossfade',
                    vjxfadeLayerA: slot.a.id,
                    vjxfadeLayerB: slot.b.id,
                    vjxfadeOpacityA: slot.a.opacity,
                    vjxfadeOpacityB: slot.b.opacity,
                    vjxfadeMix: Number(shapedMix.toFixed(4)),
                    vjxfadeTransition: vjState.crossfaderTransition || 'dissolve',
                    vjxfadeBlend: vjState.crossfaderBlendMode || 'normal',
                  },
                } as NonNullable<Layer['source']>,
              });
              continue;
            }
            const single = slot.a ?? slot.b;
            if (!single) continue;
            const weight = slot.a ? weights.a : weights.b;
            output.push({
              ...single,
              opacity: single.opacity * weight,
              _deckMonitorBank: slot.a ? 'a' : 'b',
              _deckMonitorOpacity: single.opacity,
            });
          }
          return stageWrap(appendNativeVjMixCarrier(
            appendNativePerformerWorldLayers(output, vjLayers, weights),
          ));
        }
        // Shallow-copy so per-frame opacity rides (stage FX) captured at
        // call time survive the end-of-frame restore before the sync flush.
        return (get(layers) as Layer[]).map((l) => ({ ...l }));
      };
      let __vjFeedDebugAt = 0;
      type NativeVjLayersSyncDetail = {
        urgent?: boolean;
        videoSourceIds?: string[];
        triggeredAtMs?: number;
      };
      const scheduleNativeLayersSync = (
        urgent = false,
        retry = true,
        videoSourceIds: string[] = [],
        triggeredAtMs?: number,
      ) => {
        const p = get(project);
        const effective = nativeEffectiveLayers();
        if (!effective) {
          // A trigger updates the launcher and derived VJ layers in adjacent
          // store emissions. Give the derived layer one microtask to settle,
          // then push the complete launch transaction immediately.
          if (urgent && retry) {
            queueMicrotask(() => scheduleNativeLayersSync(true, false, videoSourceIds, triggeredAtMs));
          }
          return;
        }
        const now = Date.now();
        if (now - __vjFeedDebugAt > 3000) {
          __vjFeedDebugAt = now;
          const vjState = get(vjClipLauncher);
          if (vjState.isLive) {
            const vjLayers = get(vjOutputLayers);
            console.log('[NativeRendererSync] vj-feed', JSON.stringify({
              xfadeOn: vjState.crossfaderEnabled,
              value: vjState.crossfaderValue,
              transition: vjState.crossfaderTransition,
              stoppedAll: vjState.stoppedAll,
              vjOut: (vjLayers ?? []).map((l) => l.id + '@' + l.opacity.toFixed(2) + ':' + (l.source?.name ?? '?')),
              effective: effective.map((l) => l.id + '@' + l.opacity.toFixed(2)),
              activeA: vjState.layerStates.map((ls) => ls.activeClip?.name ?? null),
              activeB: vjState.bankBLayerStates.map((ls) => ls.activeClip?.name ?? null),
              pending: vjState.pendingTriggers?.length ?? 0,
            }));
          }
        }
        if (urgent) {
          const handoff = videoSourceIds.length > 0
            ? nativeRendererSync?.syncUrgentVideoSources(
              p.width || 1920,
              p.height || 1080,
              effective,
              videoSourceIds,
            )
            : undefined;
          if (handoff) {
            // Keep full graph/effect reconciliation behind the tiny decoder
            // handoff so it cannot delay the first moving video frame.
            void handoff.finally(() => {
              if (typeof triggeredAtMs === 'number') {
                console.log(
                  `[NativeRendererSync] vj-trigger handoff acked in ${(performance.now() - triggeredAtMs).toFixed(1)}ms`,
                  videoSourceIds.join(','),
                );
              }
              nativeRendererSync?.syncNow(p.width || 1920, p.height || 1080, effective);
            });
          } else {
            nativeRendererSync?.syncNow(p.width || 1920, p.height || 1080, effective);
          }
        } else {
          nativeRendererSync?.scheduleSync(p.width || 1920, p.height || 1080, effective);
        }
      };
      nativeProjectUnsub = project.subscribe(($project) => {
        queueNativeLayerInteractions($project.layers || []);
        scheduleNativeLayersSync();
        if (nativeEditorPreviewWindowEnabled || nativeEmbeddedPreviewEnabled) {
          scheduleNativePreviewWindowSync('project');
        }
      });
      nativeLayersSyncRef = () => scheduleNativeLayersSync();
      // ── Stage FX driver (native mode) ──
      // When the native core owns the frame, the WebGL animate() loop
      // never runs — so nothing was ticking the stage-effect engines
      // into the native scene. This RAF loop is the native-mode driver:
      // while either FX engine is live it modulates the bound layers'
      // opacity in place, pushes the scene (the sync captures values by
      // copy at call time), then restores the stashed opacities. Idle
      // frames cost two map-size checks and nothing else.
      let stageFxNativeRaf: number | null = null;
      const stageFxNativeTick = () => {
        stageFxNativeRaf = requestAnimationFrame(stageFxNativeTick);
        const stageRt = get(stageEffectsRuntime);
        const p = get(project);
        const mc = p.mappingComposition;
        const surfaceFx = stageRt.sliceOutputs.size > 0;
        const mappingFx = !!(mc?.enabled && (mc.stageEffects?.length ?? 0) > 0);
        if (!surfaceFx && !mappingFx) return;
        const vjState = get(vjClipLauncher);
        const vjLayers = get(vjOutputLayers);
        const normalLayers = get(layers) as Layer[];
        const working: Layer[] = vjState.isLive && vjState.stageMode
          ? [...(vjLayers ?? []), ...normalLayers]
          : [...normalLayers];
        let fxMatched = 0;
        if (surfaceFx) {
          for (const layer of working) {
            // Direct slice binding OR geometry fallback — same resolver
            // the 3D LED path uses, so a stage whose slice→layer
            // bindings weren't persisted still gets FX in native output.
            const out = resolveStageEffectForLayer(layer, stageRt);
            if (!out.sliceId) continue;
            fxMatched += 1;
            if (out.brightness >= 1) continue;
            applyLayerOpacityModulation(layer, out.brightness);
          }
        }
        if (mappingFx) {
          applyMappingCompositionStageEffects(mc, working, performance.now());
        }
        scheduleNativeLayersSync();
        for (const layer of working) {
          const mutable = layer as { _stageOrigOpacity?: number; opacity: number };
          if (mutable._stageOrigOpacity !== undefined) {
            mutable.opacity = mutable._stageOrigOpacity;
            delete mutable._stageOrigOpacity;
          }
        }
        const nowDbg = performance.now();
        if (nowDbg - ((window as unknown as { __stageFxNativeDbgAt?: number }).__stageFxNativeDbgAt ?? 0) > 2000) {
          (window as unknown as { __stageFxNativeDbgAt?: number }).__stageFxNativeDbgAt = nowDbg;
          console.log('[StageFX:native] surface=' + (surfaceFx ? stageRt.sliceOutputs.size : 0)
            + ' mapping=' + (mappingFx ? 1 : 0)
            + ' matched=' + fxMatched
            + ' layers=' + working.length);
        }
      };
      stageFxNativeRaf = requestAnimationFrame(stageFxNativeTick);
      const nativeVjLayersUnsub = vjOutputLayers.subscribe(() => scheduleNativeLayersSync());
      const nativeVjStateUnsub = vjClipLauncher.subscribe(() => scheduleNativeLayersSync());
      // The timeline and the sequencer drive layer state without touching the
      // project store, so nothing here re-synced on their ticks. The sync's
      // own RAF loop covers layers that animate continuously (shaders), but a
      // media/image layer has no such loop — its sequencer step reached the
      // core only if some unrelated sync happened to fire, which is why a
      // sequenced layer would go dark and never come back.
      const nativeSequencerUnsub = layerSequencer.subscribe(() => scheduleNativeLayersSync());
      const nativeKeyframeUnsub = keyframeTimeline.subscribe(() => scheduleNativeLayersSync());
      const nativePerformerWorldUnsub = nativePerformerWorldOverlays.subscribe(() =>
        scheduleNativeLayersSync(),
      );
      const handleVjLayersSyncEvent = (event: Event) => {
        const detail = (event as CustomEvent<NativeVjLayersSyncDetail>).detail;
        scheduleNativeLayersSync(
          Boolean(detail?.urgent),
          true,
          Array.isArray(detail?.videoSourceIds) ? detail.videoSourceIds : [],
          Number(detail?.triggeredAtMs) || undefined,
        );
      };
      window.addEventListener('ghost:native-vj-layers-sync', handleVjLayersSyncEvent);
      const previousNativeProjectUnsub = nativeProjectUnsub;
      nativeProjectUnsub = () => {
        previousNativeProjectUnsub();
        nativeVjLayersUnsub();
        nativeVjStateUnsub();
        nativeSequencerUnsub();
        nativeKeyframeUnsub();
        nativePerformerWorldUnsub();
        if (stageFxNativeRaf !== null) {
          cancelAnimationFrame(stageFxNativeRaf);
          stageFxNativeRaf = null;
        }
        window.removeEventListener('ghost:native-vj-layers-sync', handleVjLayersSyncEvent);
      };

      const handleNativeOutputSceneResync = () => {
        const p = get(project);
        nativeRendererSync?.forceSync(p.width || 1920, p.height || 1080, get(layers));
      };
      window.addEventListener('ghost:native-output-scene-resync', handleNativeOutputSceneResync);
      nativeOutputSceneResyncUnsub = () => {
        window.removeEventListener('ghost:native-output-scene-resync', handleNativeOutputSceneResync);
      };

      if (nativeEditorPreviewWindowEnabled || nativeEmbeddedPreviewEnabled) {
        scheduleNativePreviewWindowSync('initial');
        if (typeof ResizeObserver !== 'undefined') {
          nativePreviewResizeObserver = new ResizeObserver(() => {
            scheduleNativePreviewWindowSync('resize');
          });
          const geometryTargets = [
            containerEl,
            wrapperEl,
            containerEl?.closest('.viewport') as HTMLElement | null,
          ];
          for (const target of new Set(geometryTargets.filter(Boolean) as Element[])) {
            nativePreviewResizeObserver.observe(target);
          }
        }
        const handleNativePreviewWindowEvent = () => scheduleNativePreviewWindowSync('window');
        window.addEventListener('resize', handleNativePreviewWindowEvent);
        window.addEventListener('orientationchange', handleNativePreviewWindowEvent);
        nativePreviewWindowEventUnsub = () => {
          window.removeEventListener('resize', handleNativePreviewWindowEvent);
          window.removeEventListener('orientationchange', handleNativePreviewWindowEvent);
        };
      }
    }

    if (nativeEngineRequested()) {
      canvas.width = projW;
      canvas.height = projH;
      sizeContainer(wrapW, wrapH);

      if (!isOsrMode && !isOutputMode) {
        initStateBroadcast('sender');
        startAudioBroadcast();
        startModulationBroadcast();
      }
      startNativeRendererSyncLifecycle();

      // Teardown registry for native-branch subscriptions added below.
      const nativeTeardownCallbacks: Array<() => void> = [];

      // WLED under the native driver: the senders used to register the
      // WebGL canvas, which is a cleared underlay here — content-aware
      // sampling read solid black (pattern modes were unaffected). Feed
      // them the composite mirror instead. The mirror snapshot pump only
      // runs while an enabled controller exists, so projects without WLED
      // pay nothing.
      let wledMirror: import('$lib/sync/nativeCompositeMirror').CompositeMirrorHandle | null = null;
      const wledUnsub = project.subscribe((p) => {
        const wantsWled = (p.wledControllers ?? []).some((c: { enabled?: boolean }) => c.enabled);
        if (wantsWled && !wledMirror) {
          void import('$lib/sync/nativeCompositeMirror').then(({ acquireNativeCompositeMirror }) => {
            if (wledMirror) return;
            wledMirror = acquireNativeCompositeMirror({ maxDim: 384, fps: 20 });
            startWLEDSenders(wledMirror.canvas, 'editor');
          });
        } else if (!wantsWled && wledMirror) {
          stopWLEDSenders(wledMirror.canvas);
          wledMirror.release();
          wledMirror = null;
        }
      });
      nativeTeardownCallbacks.push(() => {
        wledUnsub();
        if (wledMirror) {
          stopWLEDSenders(wledMirror.canvas);
          wledMirror.release();
          wledMirror = null;
        }
      });

      canvas.addEventListener('mousemove', handleCanvasMouseMove);
      canvas.addEventListener('mouseleave', handleCanvasMouseLeave);
      canvas.addEventListener('mouseenter', handleCanvasMouseEnter);

      let _nativeShellFrames = 0;
      function animateNativeShell() {
        nativeRendererSync?.setRenderClock(null);
        // Publish one atomic geometry revision for both the native presenter
        // and every DOM overlay. The signature prevents redundant store/IPC
        // updates while still following live resize, zoom, and pan each frame.
        publishEditorCanvasGeometry();
        scheduleNativePreviewWindowSync('layout-frame');
        fpsFrameCount++;
        const fpsNow = performance.now();
        const fpsElapsed = fpsNow - fpsLastTime;
        if (fpsElapsed >= 500) {
          const measuredFrames = Math.max(1, fpsFrameCount);
          const fpsValue = Math.round((measuredFrames * 1000) / fpsElapsed);
          fpsStore.set(fpsValue);
          fpsFrameCount = 0;
          fpsLastTime = fpsNow;
          if (!((_fpsLogCount++) % 10)) {
            const layerCount = ($project?.layers?.length ?? 0);
            console.log(
              `[UI] mode=native-shell FPS=${fpsValue} layers=${layerCount} canvas=${canvas.width}x${canvas.height}`,
            );
          }
        }
        if (_nativeShellFrames < 3) {
          _nativeShellFrames++;
          console.log('[native-shell] frame', _nativeShellFrames, '— legacy RenderEngine disabled');
        }
        animationId = requestAnimationFrame(animateNativeShell);
      }
      animateNativeShell();

      const nativeResizeObserver = new ResizeObserver(() => {
        const { w: parentW, h: parentH } = getWrapperLayoutSize();
        if (parentW <= 0 || parentH <= 0) return;
        const pW = $project.width || 1920;
        const pH = $project.height || 1080;
        sizeContainer(parentW, parentH);
        canvas.width = pW;
        canvas.height = pH;
        window.dispatchEvent(new CustomEvent('ghost:native-vj-layers-sync'));
      });
      nativeResizeObserver.observe(wrapperEl);

      return () => {
        for (const teardown of nativeTeardownCallbacks) {
          try { teardown(); } catch { /* teardown best-effort */ }
        }
        nativeResizeObserver.disconnect();
        editorCanvasGeometrySnapshot = null;
        editorCanvasGeometrySignature = '';
        editorCanvasGeometry.set(null);
        canvas.removeEventListener('mousemove', handleCanvasMouseMove);
        canvas.removeEventListener('mouseleave', handleCanvasMouseLeave);
        canvas.removeEventListener('mouseenter', handleCanvasMouseEnter);
      };
    }

    // preserveDrawingBuffer false unconditionally — was previously true
    // for the editor to support one-shot canvas.toBlob/toDataURL
    // thumbnails, but the cost was paid on every paint. Any thumbnail
    // path that needed it can do an explicit one-shot render to a
    // dedicated render target.
    engine = new RenderEngine(canvas, projW, projH, { preserveDrawingBuffer: false });
    // Register with the offline-render store so its frame loop can
    // resize the engine + read the composite target each tick.
    void import('../recording/offlineRender').then(({ offlineRender }) => {
      offlineRender.registerEngine(engine!, canvas);
    });
    // Start WLED senders. Subscribes to project.wledControllers
    // and reconciles tap canvases when controllers are added/removed.
    // The per-frame tap+send happens via tickWLEDSenders() from
    // inside the animate loop.
    startWLEDSenders(canvas, isOutputMode ? 'output' : isOsrMode ? 'osr' : 'editor');
    // Set initial container size from wrapper layout dimensions
    sizeContainer(wrapW, wrapH);

    // Watermark sync removed — no watermark in OSS build.
    const unsubWatermark = () => {};

    // Sync dome projection settings
    const unsubDome = settings.subscribe(s => {
      if (!engine) return;
      // In editor WebGPU bridge mode the hidden WebGL canvas is the raw
      // source frame; WebGPUCanvas owns output-space reprojection so dome
      // and master warp are baked exactly once before capture/slicing.
      const webgpuBridgeOwnsDome = bridgeMode && !isOutputMode && !isOsrMode && !!s.experimental?.editorWebGPU;
      engine.setDomeEnabled(webgpuBridgeOwnsDome ? false : s.output.domeEnabled);
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
      // Start the audio analysis broadcast too — output windows have no
      // microphone access of their own, so without this their shaders
      // see permanently-zero audio uniforms and the projector shows no
      // reactivity even when the editor is fully reactive.
      startAudioBroadcast();
      // And the modulation map. Audio data alone doesn't help if the
      // receiver doesn't know which params react to which bands — that
      // mapping lives in modulationStore. Without this, kick→particle-
      // density on a shader looks right in the editor but the projector
      // shows the un-modulated baseline.
      startModulationBroadcast();
    }

    // ── Output source + master warp ───────────────────────────────────
    // Register this WebGL editor canvas (or its master-warped derivative)
    // with the output transports — BUT only when this is the real present
    // surface. In bridgeMode (experimental.editorWebGPU) the WebGPU pilot
    // canvas is the final surface and OWNS output registration (see
    // WebGPUCanvas.svelte); registering here too would fight it and the
    // master warp would silently do nothing. So skip when bridgeMode.
    // reconcileMasterWarpOutput (outputComposite) is the single registrar
    // and is itself diff-gated; it's fed from a settings subscription.
    if (!isOsrMode && !isOutputMode && !bridgeMode && canvas) {
      const editorCanvas = canvas;
      outputWebRTCUnsub = settings.subscribe((s) => {
        const _perf = s?.performance;
        reconcileMasterWarpOutput({
          baseSource: editorCanvas,
          // Only route through the warp pass when it would actually change
          // the output — enabling alone (identity) stays passthrough so the
          // zero-copy path is preserved until the operator drags a handle.
          warpActive: masterWarpIsActive(s.output?.masterWarp),
          zeroCopy: !!s.experimental?.outputZeroCopy,
          webrtc: !!s.experimental?.outputWebRTC,
          getWarp: () => get(settings).output?.masterWarp,
          getSize: () => ({
            w: get(settings).output?.masterCanvasWidth ?? 1920,
            h: get(settings).output?.masterCanvasHeight ?? 1080,
          }),
          perf: {
            frameRate: _perf?.outputFrameRate ?? 60,
            maxBitrate: _perf?.outputMaxBitrate,
            degradationPreference: _perf?.outputDegradationPreference,
            codecPreference: _perf?.outputCodecPreference,
          },
        });
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

    // Start native renderer command-stream synchronization. The 2.0 path uses
    // Electron as the UI shell and a separate Rust/wgpu render-core process as
    // the main renderer. If the native process is missing or fails, the error
    // should stay visible; the native path is no longer treated as an optional
    // compatibility layer.
    startNativeRendererSyncLifecycle();

    // Listen for OSR zero-copy status from main process
    if (window.electronOSR?.onOsrStatus) {
      const off = window.electronOSR.onOsrStatus((status) => {
        osrSpoutActive = status.active;
        spoutCpuFallbackAllowed = !isElectron || !!status.cpuFallbackAllowed;
        if (status.active) {
          spoutZeroCopyFailed = false;
          const route = status.reason === 'native-iosurface' ? 'Native IOSurface' : 'OSR zero-copy';
          console.log(`[Canvas] ${route} active — disabling readPixels send`);
        } else if (spoutCpuFallbackAllowed) {
          console.log('[Canvas] OSR inactive (reason:', status.reason, ') — CPU compatibility path is enabled');
        } else if (status.reason && status.reason !== 'stopped') {
          const wasAlreadyFailed = spoutZeroCopyFailed;
          spoutZeroCopyFailed = true;
          spoutOutputActive = false;
          console.warn('[Canvas] OSR zero-copy unavailable (reason:', status.reason, ') — CPU sendImage fallback is disabled');
          if (!wasAlreadyFailed) {
            showToast(`${getTextureShareLabel()} zero-copy unavailable; CPU fallback is disabled.`, 'error');
          }
        } else {
          console.log('[Canvas] OSR inactive (reason:', status.reason, ')');
        }
      });
      stopOsrStatusListener = typeof off === 'function' ? off : null;
    }

    // Atlas fan-out status from main (started / stopped / renderer-gone).
    // Source of truth for skipping per-slice CPU sends: if the atlas dies,
    // main says so and the CPU path resumes next frame.
    if (isElectron && !isOsrMode && !isOutputMode && (window as any).electronAPI?.on) {
      const offAtlas = (window as any).electronAPI.on('texshare-atlas-status', (status: any) => {
        atlasFanoutActive = !!status?.active;
        console.log(`[Canvas] Atlas fan-out ${atlasFanoutActive ? 'active' : `inactive (${status?.reason ?? 'unknown'})`}`);
      });
      stopAtlasStatusListener = typeof offAtlas === 'function' ? offAtlas : null;
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
      const _stage3DFpsCap = stage3DOutput && isOutputMode
        ? (($settings as any)?.performance?.stage3DFrameRate ?? 30)
        : 0;
      const _editorFpsCap = ($settings as any)?.performance?.editorMaxFps ?? 0;
      const _fpsCap = _stage3DFpsCap > 0 ? _stage3DFpsCap : _editorFpsCap;
      if (_fpsCap > 0 && engine?.manualTime === null) {
        const now = performance.now();
        const interval = 1000 / _fpsCap;
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
        const nativeRequested = nativeEngineRequested();
        const nativePreviewOwnsFrame = nativeCorePreviewActive();
        if (nativeRequested) {
          disposeBrowserPreviewRenderersForNativeCore(
            nativePreviewOwnsFrame ? 'native-core-frame-source' : 'native-core-pending'
          );
          const renderClockSeconds = typeof engine.manualTime === 'number' && Number.isFinite(engine.manualTime)
            ? engine.manualTime
            : null;
          nativeRendererSync?.setRenderClock(renderClockSeconds);
          const legacyRenderer = engine.getRenderer();
          legacyRenderer.setRenderTarget(null);
          legacyRenderer.setClearColor(0x020407, 1);
          legacyRenderer.clear(true, true, true);
          // Stage FX are driven by the dedicated native-mode RAF loop
          // installed next to scheduleNativeLayersSync — animate() does
          // not reliably run when the native core owns the frame, so
          // nothing FX-critical may live in this branch.
          // TODO(native composite downsample — see
          // docs/MAINTENANCE_TO_NATIVE_TRANSFER_2026-07-29.md ledger):
          // when the native core owns the frame, this WebGL canvas is
          // cleared each tick, so composite sampling degrades to the
          // clear color. Pattern/test/effect generation (solid, chase,
          // rainbow, LED FX, latch/hold/BPM) still runs fully; only
          // content-derived sampling needs the native readback path.
          tickWLEDSenders(canvas);
          _consecutiveFrameErrors = 0;
          animationId = requestAnimationFrame(animate);
          return;
        }

        engine.setCrossfade(
          vjState.crossfaderEnabled === true && vjState.isLive,
          vjState.crossfaderValue ?? 0,
          vjState.crossfaderTransition || 'dissolve',
          vjState.crossfaderCurve || 'constant-power',
          vjState.crossfaderBlendMode || 'normal'
        );

        let layersToRender: Layer[];
        let stage3DSourceLayers: Layer[] | null = null;
        let compEffects: import('../types').Effect[] | undefined;
        let didStageTexturePrepass = false;

        // VJ Stop All — render nothing (black output) until a clip is triggered
        if (vjState.stoppedAll && vjState.isLive) {
          layersToRender = [];
          compEffects = undefined;
        } else if (vjState.mapMode && vjState.isLive) {
          // ── MAP sub-mode: preset-only mixer ─────────────────────────
          // Each VJ layer slot holding a preset clip is rendered as a
          // synthetic GROUP layer wrapping that preset's composition
          // layers. The group's opacity = VJ-layer-opacity × master,
          // its blendMode = the VJ-layer blendMode. Fading the slot
          // fader thus fades the entire preset as a single composite
          // unit instead of making each surface partially transparent
          // (which produced no visible crossfade when surfaces didn't
          // overlap).
          //
          // CACHING: cloned layers + the synthetic group live across
          // frames in mapPresetLayerCache, keyed by `mapvj-<i>-<clipId>`.
          // We rebuild only on slot/clip changes or composition edits
          // (compositionRef !== entry.compositionRef). Previously we
          // cloned every frame, which threw away the videoElement that
          // updateTexturesSync had just attached to source.videoElement
          // — videos in MAP-mode presets ended up with a texture but
          // no live needsUpdate signal, so they froze on the first
          // frame. Opacity / blendMode are mutated in-place each frame
          // (pure scalars, safe to write).
          const presetLayers: Layer[] = [];
          const lsArr = vjState.layerStates;
          const hasSolo = lsArr.some((l) => l.solo);
          const activeKeys = new Set<string>();
          for (let i = 0; i < lsArr.length; i++) {
            const ls = lsArr[i];
            if (ls.mute) continue;
            if (hasSolo && !ls.solo) continue;
            const clip = ls.activeClip;
            if (!clip || clip.type !== 'preset' || !clip.presetId) continue;
            const comp = $compositions.find((c) => c.id === clip.presetId);
            if (!comp) continue;
            const seqState = $vjLayerSequencer;
            const sequenceOpacity = seqState.isPlaying
              ? (seqState.opacityOverrides?.[i] ?? 1)
              : 1;
            const groupOpacity = ls.opacity * sequenceOpacity * (vjState.masterOpacity ?? 1);
            if (groupOpacity <= 0) continue;

            const groupId = `mapvj-${i}-${clip.id}`;
            activeKeys.add(groupId);

            let entry = mapPresetLayerCache.get(groupId);
            if (!entry || entry.compositionRef !== comp) {
              entry = buildMapPresetCacheEntry(groupId, comp, i, groupOpacity, ls.blendMode);
              mapPresetLayerCache.set(groupId, entry);
            }
            // Live updates — these are scalars / array-of-data refs, safe
            // to mutate without invalidating cached child layers.
            entry.group.opacity = groupOpacity;
            entry.group.blendMode = ls.blendMode;
            entry.group.name = `MAP L${i + 1}: ${comp.name}`;
            // VJ-layer FX chain → applied to the preset's group composite
            // as a single post-pass (see renderGroupToTexture's
            // `_postCompositeEffects` handler). Echo / displacement /
            // chroma key on the VJ layer now wrap the entire preset
            // render, matching the user's mental model of "this slot's
            // effects act on whatever's playing in this slot." Empty
            // array is a no-op in applyEffects so it's safe to set even
            // when the slot has no effects.
            (entry.group as any)._postCompositeEffects = ls.effects ?? [];

            presetLayers.push(entry.group);
            for (const child of entry.layers) presetLayers.push(child);
          }
          // Prune cache entries whose slot+clip no longer maps to a
          // live preset (slot emptied, clip removed, mode toggled).
          // Keeps the cache from growing unbounded across a session of
          // shuffling clips between slots.
          for (const key of mapPresetLayerCache.keys()) {
            if (!activeKeys.has(key)) mapPresetLayerCache.delete(key);
          }
          layersToRender = presetLayers;
          compEffects = vjState.compositionEffects;
          if (browserEditorPreviewActive()) {
            updateAllTextures(layersToRender, null);
          }
          didStageTexturePrepass = true;
        } else if (vjState.stageMode && vjState.isLive) {
          // ── STAGE MODE: VJ layers feed into mapping layers ──

          // 1. Build combined layer list
          const allManagedLayers: Layer[] = [...(vjLayers || []), ...normalLayers];

          // 2. Update all textures in one batch
          if (browserEditorPreviewActive()) {
            updateAllTextures(allManagedLayers, normalLayers);
          }
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
          // Bucket per VJ layer index → { A?, B?, single? }. `single` is set
          // for entries with no bank tag (crossfader off — only Bank A).
          // Texture resolution + id parsing hoisted to component scope
          // (resolveVjLayerTexture / parseVjLayerId) so the frame body
          // doesn't re-allocate closures or re-run regexes.
          type VjBucket = { a?: Layer; b?: Layer; single?: Layer };
          const vjByIndex = new Map<number, VjBucket>();
          if (vjLayers) {
            for (const vjLayer of vjLayers) {
              const parsed = parseVjLayerId(vjLayer.id);
              if (!parsed) continue;
              const slot = vjByIndex.get(parsed.idx) ?? {};
              if (parsed.bank === 'A') slot.a = vjLayer;
              else if (parsed.bank === 'B') slot.b = vjLayer;
              else slot.single = vjLayer;
              vjByIndex.set(parsed.idx, slot);
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
              const tex = resolveVjLayerTexture(slot.single);
              if (tex) vjResolved.set(idx, { layer: slot.single, texture: tex });
              continue;
            }
            if (slot.a && !slot.b) {
              const tex = resolveVjLayerTexture(slot.a);
              if (tex) vjResolved.set(idx, { layer: slot.a, texture: tex });
              continue;
            }
            if (slot.b && !slot.a) {
              const tex = resolveVjLayerTexture(slot.b);
              if (tex) vjResolved.set(idx, { layer: slot.b, texture: tex });
              continue;
            }
            // Both banks present — run per-layer crossfade.
            if (slot.a && slot.b) {
              const texA = resolveVjLayerTexture(slot.a);
              const texB = resolveVjLayerTexture(slot.b);
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

          if (normalLayers.some(layer => layer.vjLayerIndex === VJ_MIX_SOURCE_INDEX) && vjLayers && vjLayers.length > 0) {
            const mixTexture = engine.renderVJMixToTexture(vjLayers);
            if (mixTexture) vjResolved.set(VJ_MIX_SOURCE_INDEX, { layer: vjMixCarrierLayer, texture: mixTexture });
          }

          // 4. Inject VJ sources into Screen / Group layers.
          //
          //    The injected source is rebuilt every frame — VJ textures
          //    change each frame (synthvision canvas, shaders, crossfade
          //    mix) and caching causes stale texture references when
          //    clips swap. The layer clone + merged effects array are
          //    cached per layer (injectVjIntoLayer) and rebuilt only on
          //    identity change.
          pruneStageInjectCache(normalLayers);
          layersToRender = normalLayers.map(layer => {
            if (layer.vjLayerIndex !== undefined) {
              const resolved = vjResolved.get(layer.vjLayerIndex);
              if (resolved) return injectVjIntoLayer(layer, resolved);
            }
            return layer;
          });
          stage3DSourceLayers = [...layersToRender, ...(vjLayers ?? [])];
          compEffects = vjState.compositionEffects;
        } else if (vjLayers) {
          // ── PURE VJ MODE: VJ layers replace mapping layers ──
          layersToRender = vjLayers;
          compEffects = vjState.compositionEffects;
        } else {
          // ── NORMAL MAPPING MODE ──
          // VJ Source injection for groups + screen layers in regular
          // mapping mode. When the user selects a VJ Layer from the
          // group's "VJ Source" dropdown in the LayerPanel, that VJ
          // Layer's currently-active clip should drive the group's
          // unified shader — even without entering Stage live mode.
          // We mirror the texture-resolution + injection path the
          // stage-mode branch uses, gated on the presence of any
          // vjLayerIndex bindings so the cost is paid only when needed.
          layersToRender = normalLayers;
          const mappingComposition = $project.mappingComposition;
          compEffects = mappingComposition?.enabled && mappingComposition.effects.length > 0
            ? mappingComposition.effects
            : undefined;
          const mappedVjLayers = (vjLayers ?? []) as Layer[];
          const anyVjBinding = mappedVjLayers.length > 0 && normalLayers.some(l => l.vjLayerIndex !== undefined);
          if (anyVjBinding) {
            // Bucket per VJ layer index → resolved texture. Simpler than
            // the stage path because mapping mode doesn't currently run
            // the A/B crossfader merge — single bank only.
            const vjResolvedMap = new Map<number, { layer: Layer; texture: THREE.Texture }>();
            for (const vjLayer of mappedVjLayers) {
              const parsed = parseVjLayerId(vjLayer.id);
              if (!parsed) continue;
              // Take Bank A or the single-bank entry; ignore Bank B in
              // mapping mode for now.
              if (parsed.bank === 'B' && vjResolvedMap.has(parsed.idx)) continue;
              const tex = resolveVjLayerTexture(vjLayer);
              if (tex) vjResolvedMap.set(parsed.idx, { layer: vjLayer, texture: tex });
            }
            if (normalLayers.some(layer => layer.vjLayerIndex === VJ_MIX_SOURCE_INDEX)) {
              const mixTexture = engine.renderVJMixToTexture(mappedVjLayers, vjState.compositionEffects);
              if (mixTexture) vjResolvedMap.set(VJ_MIX_SOURCE_INDEX, { layer: vjMixCarrierLayer, texture: mixTexture });
            }
            // Inject the resolved VJ texture into each managed layer via
            // the shared per-layer clone cache (see injectVjIntoLayer).
            pruneStageInjectCache(normalLayers);
            layersToRender = normalLayers.map(layer => {
              if (layer.vjLayerIndex === undefined) return layer;
              const resolved = vjResolvedMap.get(layer.vjLayerIndex);
              if (!resolved) return layer;
              return injectVjIntoLayer(layer, resolved);
            });
            stage3DSourceLayers = [...layersToRender, ...mappedVjLayers];
          }
        }
        stage3DSourceLayers ??= layersToRender;

        // ── Keyframe timeline overrides (applied only during playback so sliders work freely when paused) ──
        const kfState = get(keyframeTimeline);
        const kfOverrides = kfState.config.isPlaying ? kfState.activeOverrides : {};
        const kfStash: Array<{ layer: any; key: string; orig: any; target: any; prop: string }> = [];

        // Debug: log once per second during playback. Behind a manual
        // flag — serializing the whole override map + layer-id array is
        // pure waste in a show. Enable from devtools: __GA_KF_DEBUG__=1
        if ((window as any).__GA_KF_DEBUG__ && kfState.config.isPlaying && Object.keys(kfOverrides).length > 0) {
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
        if (browserEditorPreviewActive() && (!didStageTexturePrepass || hasKeyframeOverrides)) {
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

        // ── Stage Effects opacity modulation (per-slice brightness) ──
        // For any layer that's bound to a Surface slice (via Apply
        // Stage), look up the slice's current effect-driven brightness
        // and multiply the layer's opacity by it.  Stash the original
        // in `_stageOrigOpacity` and restore at the end of the frame
        // alongside the sequencer's `_seqOrigOpacity` restore.  Done
        // BEFORE the sequencer-override block so the sequencer's
        // continuous-mode gate stacks on top (the two systems compose:
        // sequencer says "show/hide this beat", stage says "while
        // shown, ride the cascading pulse").
        const stageRt = get(stageEffectsRuntime);
        if (stageRt.sliceOutputs.size > 0 && stageRt.layerToSlice.size > 0) {
          for (let i = 0; i < layersToRender.length; i++) {
            const layer = layersToRender[i];
            const sliceId = stageRt.layerToSlice.get(layer.id);
            if (!sliceId) continue;
            const brightness = stageRt.sliceOutputs.get(sliceId);
            if (brightness === undefined) continue;
            if (brightness >= 1) continue;
            applyLayerOpacityModulation(layer, brightness);
          }
        }

        const renderClockSeconds = typeof engine.manualTime === 'number' && Number.isFinite(engine.manualTime)
          ? engine.manualTime
          : null;
        nativeRendererSync?.setRenderClock(renderClockSeconds);
        const stageEffectNowMs = browserEditorPreviewActive() && renderClockSeconds !== null
          ? renderClockSeconds * 1000
          : performance.now();
        applyMappingCompositionStageEffects($project.mappingComposition, layersToRender, stageEffectNowMs);
        // Stage FX animate per frame by riding layer opacity; the native
        // scene only updates through the sync, so push while any effect
        // output is live (values are captured by copy in the sync path).
        const stageFxActive = stageRt.sliceOutputs.size > 0
          || !!($project.mappingComposition?.enabled && ($project.mappingComposition?.stageEffects?.length ?? 0) > 0);
        if (stageFxActive) nativeLayersSyncRef?.();

        if (seqOverrides) {
          // Continuous-mode rows take a separate side-channel path:
          // their `layer.opacity` stays unchanged so the engine still
          // renders the layer's content pass every frame (shader TIME,
          // keyframe-driven uniforms, particle integrators all keep
          // advancing). Only the FINAL composite alpha gets gated, via
          // `_seqGate` which the engine reads when uploading uniforms
          // to the layer's display material — see engine.ts uMultiplier
          // path. Non-continuous rows keep the legacy behavior:
          // opacity is multiplied at the layer level (which still
          // renders the pass but can cascade into shader resets
          // elsewhere in the pipeline — exactly the symptom the ∞
          // toggle was added to escape).
          const contMap = seqState.pattern?.continuousLayers ?? {};
          for (let i = 0; i < layersToRender.length; i++) {
            const layer = layersToRender[i];
            const mult = seqOverrides[layer.id];
            if (mult === undefined) continue;
            if (contMap[layer.id]) {
              (layer as any)._seqGate = mult;
            } else if (mult < 1) {
              (layer as any)._seqOrigOpacity = layer.opacity;
              layer.opacity = layer.opacity * mult;
            }
          }
        }

        try {
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
          if (!browserEditorPreviewActive()) {
            const legacyRenderer = engine.getRenderer();
            legacyRenderer.setRenderTarget(null);
            legacyRenderer.setClearColor(0x020407, 1);
            legacyRenderer.clear(true, true, true);
          } else {
            engine.render(layersToRender, null, compEffects, macroBundles);
            if (stage3DOutput) {
              if (!stage3DRenderer) stage3DRenderer = new Stage3DRenderer(glCanvas);
              stage3DRenderer.render(
                engine.getRenderer(),
                get(stage3dScene),
                engine.getCompositeTexture(),
                $settings?.output?.slices ?? [],
                stage3DSourceLayers,
                renderClockSeconds,
              );
            }
          }
        } catch (e) {
          console.error('[Canvas] Render error:', e);
        }

        // Restore keyframe stashed values
        for (const entry of kfStash) {
          if (entry.orig === undefined) delete entry.target[entry.prop];
          else entry.target[entry.prop] = entry.orig;
        }

        // Shader uniforms are restored inside updateShaderTextures now (no-op here)

        // Restore sequencer original opacities + clear continuous-mode
        // alpha-gate side channel after render. Both fields must be
        // wiped each frame so a row toggled off the sequencer (or out
        // of continuous mode) doesn't carry stale state into later
        // frames. Also restore the stage-effect opacity stash for the
        // same reason — disabling all stage effects mid-frame should
        // visibly snap layers back to full opacity, not leave them
        // dimmed from a previous frame's brightness.
        for (let i = 0; i < layersToRender.length; i++) {
          const layer = layersToRender[i];
          if ((layer as any)._seqOrigOpacity !== undefined) {
            layer.opacity = (layer as any)._seqOrigOpacity;
            delete (layer as any)._seqOrigOpacity;
          }
          if ((layer as any)._seqGate !== undefined) {
            delete (layer as any)._seqGate;
          }
          if ((layer as any)._stageOrigOpacity !== undefined) {
            layer.opacity = (layer as any)._stageOrigOpacity;
            delete (layer as any)._stageOrigOpacity;
          }
        }

        // Master-warp output composite — tick HERE, in the render loop,
        // right after the editor canvas is drawn. The editor canvas is
        // preserveDrawingBuffer:false, so its pixels are only readable in
        // the same frame they're rendered; a standalone rAF would read an
        // empty buffer → black output. No-op unless the warp is active.
        // Skip in bridgeMode — WebGPUCanvas owns the warp tick there
        // (its present canvas is the real output surface).
        if (!isOsrMode && !isOutputMode && !bridgeMode && canvas) {
          tickMasterWarpOutput(canvas);
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
        const cpuTextureShareSendAllowed = !isElectron || spoutCpuFallbackAllowed;
        const __syphonGateSkipped =
          !spoutOutputActive || !glCanvas || osrSpoutActive || isOsrMode || isOutputMode || !cpuTextureShareSendAllowed;
        if (__syphonGateSkipped && (window as any).__SPOUT_DEBUG__) {
          const __now2 = Date.now();
          if (!(window as any).__spoutInnerDbgLast || __now2 - (window as any).__spoutInnerDbgLast > 1000) {
            (window as any).__spoutInnerDbgLast = __now2;
            console.log('[syphon-gate] send skipped — spoutOutputActive=', spoutOutputActive,
              'outputWindowOpen=', outputWindowOpen,
              'glCanvas=', !!glCanvas,
              'osrSpoutActive=', osrSpoutActive,
              'cpuFallbackAllowed=', spoutCpuFallbackAllowed,
              'isOsrMode=', isOsrMode,
              'isOutputMode=', isOutputMode);
          }
        }

        if (spoutOutputActive && glCanvas && !osrSpoutActive && !isOsrMode && !isOutputMode && cpuTextureShareSendAllowed) {
          // Skip every other frame on the CPU path — getImageData is expensive
          // (~15-30ms for 1080p). This halves the readback overhead while still
          // delivering 30fps output at 60fps render rate.
          spoutFrameSkip++;
          if (spoutFrameSkip % 2 !== 0 && !spoutSendInFlight) {
            // Skip this frame — let the render loop continue at full speed
          } else {
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

          // Senders slice the TOTAL MAIN OUTPUT. When the master warp is
          // active, that total output is the warped composite (the tick
          // earlier this frame already filled getMasterWarpCanvas()), so
          // each slice crops from the warped frame — not the raw editor
          // canvas. Otherwise fall back to the raw WebGL canvas.
          const _mwSenderSource = masterWarpIsActive($settings?.output?.masterWarp)
            ? getMasterWarpCanvas()
            : null;
          const senderSource: CanvasImageSource =
            _mwSenderSource && _mwSenderSource.width > 0 ? _mwSenderSource : glCanvas;

          // Draw source → 2D canvas (GPU-accelerated, handles Y-flip).
          // scale(1,-1) flips to the bottom-up orientation the native
          // senders expect; both the WebGL canvas and the (upright) warped
          // canvas are drawn upright by drawImage, so the same flip applies.
          spoutScaleCtx!.save();
          spoutScaleCtx!.scale(1, -1); // Flip Y (sender convention is bottom-up)
          spoutScaleCtx!.drawImage(senderSource, 0, -targetH, targetW, targetH);
          spoutScaleCtx!.restore();

          // getImageData is the CPU readback — but at the target resolution, not canvas resolution
          const w = targetW;
          const h = targetH;

          {
            if (activeSlices.length > 0) {
              // ── Multi-output slice path ──────────────────────────────────
              // spoutScaleCanvas already has the frame right-side-up at Spout
              // resolution. Each slice crops a normalized region; the GPU
              // blend renderer (blendRenderer.ts) handles crop + rotation +
              // brightness/contrast/gamma + edge-blend alpha + black-level
              // lift in ONE shader pass, returning ready-to-send RGBA bytes.
              // The legacy 2D path (sliceCanvas + applyEdgeBlending) is
              // kept as a fallback when WebGL initialization fails.
              // NOTE: the slice path re-renders each slice from
              // spoutScaleCanvas, so we deliberately SKIP the full-frame
              // getImageData readback here — it's only consumed by the
              // single-output branch below. (Was an ~8/33 MB readback +
              // memcpy per frame of dead work whenever slices exist.)
              fullFrameCanvas = spoutScaleCanvas;
              fullFrameCtx = spoutScaleCtx;
              const gpuPathAvailable = isBlendRendererAvailable();

              // Drop PBO state for deleted slices (cheap string compare
              // per frame; the prune itself only runs on config change).
              const sliceIdsKey = activeSlices.map(s => s.id).join('|');
              if (sliceIdsKey !== lastSliceIdsKey) {
                lastSliceIdsKey = sliceIdsKey;
                pruneSliceReadbackStates(new Set(activeSlices.map(s => s.id)));
              }

              for (const slice of activeSlices) {
                if (sliceSendInFlight.has(slice.id)) continue; // Backpressure per-slice

                // Atlas fan-out handles Spout/Syphon sender slices natively
                // (zero-copy) — skip their CPU readback + send entirely.
                // Predicate MUST match packAtlas's so the skip set equals
                // the atlas set; NDI + display slices fall through.
                if (atlasFanoutActive && isAtlasSenderSlice(slice)) continue;

                // Slice output dimensions = its fraction of the source
                // canvas. For rotated 90°/270° slices the GPU shader
                // rotates the sample uv, so output stays at sw × sh.
                const sw = Math.round(slice.cropW * w);
                const sh = Math.round(slice.cropH * h);
                if (sw <= 0 || sh <= 0) continue;

                // ── Pixel readout ────────────────────────────────────
                // GPU path: async PBO readback — kicks this frame's
                // render + returns LAST frame's completed bytes, so the
                // render thread never stalls on the GPU. One frame of
                // stream latency, invisible on Spout/Syphon/NDI. While
                // the pipeline warms (null), skip the send this frame —
                // do NOT fall into the 2D path, which would pay the
                // exact synchronous readback this exists to avoid.
                // 2D fallback: only when WebGL init failed entirely.
                let slicePixels: Uint8Array | Uint8ClampedArray | null = null;
                if (gpuPathAvailable) {
                  slicePixels = renderSlicePixelsAsync(fullFrameCanvas!, slice, sw, sh);
                  if (!slicePixels) continue;
                }
                if (!slicePixels) {
                  // 2D fallback. Same code as the v1.5 path; only entered
                  // if the WebGL renderer failed to initialize (rare).
                  const sx = Math.round(slice.cropX * w);
                  const sy = Math.round(slice.cropY * h);
                  if (!sliceCanvas || sliceCanvas.width !== sw || sliceCanvas.height !== sh) {
                    sliceCanvas = document.createElement('canvas');
                    sliceCanvas.width = sw;
                    sliceCanvas.height = sh;
                    sliceCtx = sliceCanvas.getContext('2d');
                  }
                  sliceCtx!.clearRect(0, 0, sw, sh);
                  if (slice.rotation === 0) {
                    sliceCtx!.drawImage(fullFrameCanvas!, sx, sy, sw, sh, 0, 0, sw, sh);
                  } else {
                    sliceCtx!.save();
                    sliceCtx!.translate(sw / 2, sh / 2);
                    sliceCtx!.rotate((slice.rotation * Math.PI) / 180);
                    if (slice.rotation === 90 || slice.rotation === 270) {
                      sliceCtx!.drawImage(fullFrameCanvas!, sx, sy, sw, sh, -sh / 2, -sw / 2, sh, sw);
                    } else {
                      sliceCtx!.drawImage(fullFrameCanvas!, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
                    }
                    sliceCtx!.restore();
                  }
                  const hasBlend = slice.edgeBlendLeft > 0 || slice.edgeBlendRight > 0 || slice.edgeBlendTop > 0 || slice.edgeBlendBottom > 0;
                  if (hasBlend) {
                    if (!sliceBlendCanvas || sliceBlendCanvas.width !== sw || sliceBlendCanvas.height !== sh) {
                      sliceBlendCanvas = document.createElement('canvas');
                      sliceBlendCanvas.width = sw;
                      sliceBlendCanvas.height = sh;
                      sliceBlendCtx = sliceBlendCanvas.getContext('2d');
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
                    slicePixels = sliceBlendCtx!.getImageData(0, 0, sw, sh).data;
                  } else {
                    slicePixels = sliceCtx!.getImageData(0, 0, sw, sh).data;
                  }
                }

                sliceSendInFlight.add(slice.id);
                const senderName = slice.spoutName || `ghostArcade-${slice.name}`;
                // Skip "physical display" target slices — the per-display
                // window (Phase 2) handles its own send pipeline. Sender
                // path stays for 'sender' target only.
                const targetType = slice.targetType ?? 'sender';
                if (targetType === 'display') {
                  sliceSendInFlight.delete(slice.id);
                  continue;
                }
                // NDI transport is handled entirely by the main-process
                // composite pump (electron/main.js startNdiOutputPump,
                // engaged from stores/screens.ts when any slice selects
                // outputType 'ndi') — the old per-slice WebGL readback →
                // ndi_send_image path was dead under NATIVE_ENGINE_ONLY
                // and has been retired. This loop only routes the local
                // Spout / Syphon transports.
                // Re-wrap as Uint8Array for IPC (Spout expects Uint8Array).
                // GPU path already returns Uint8Array; 2D fallback returns
                // Uint8ClampedArray.
                const sendBytes: Uint8Array = slicePixels instanceof Uint8Array
                  ? slicePixels
                  : new Uint8Array(slicePixels.buffer, slicePixels.byteOffset, slicePixels.byteLength);

                if (isElectron) {
                  invoke('spout_send_image', { data: sendBytes, width: sw, height: sh, senderName })
                    .catch(() => {}).finally(() => { sliceSendInFlight.delete(slice.id); });
                } else {
                  fetch(`http://127.0.0.1:9002/spout/send?width=${sw}&height=${sh}&sender=${encodeURIComponent(senderName)}`, {
                    method: 'POST',
                    // BodyInit doesn't include the Uint8Array<ArrayBufferLike>
                    // shape that TS 5.7+ produces for our bytes; coerce via
                    // any to silence — the runtime accepts a typed array fine.
                    body: sendBytes as any,
                  }).catch(() => {}).finally(() => { sliceSendInFlight.delete(slice.id); });
                }
              }
            } else if (!spoutSendInFlight) {
              // ── Legacy single-output path (no slices configured) ─────────
              // Full-frame readback lives HERE (only consumer). Reuse the
              // Uint8Array buffer across frames; the .set() is the lone
              // memcpy (the wrapper is a zero-copy view over imgData).
              const imgData = spoutScaleCtx!.getImageData(0, 0, w, h);
              const expectedBytes = w * h * 4;
              if (!spoutSendPixels || spoutSendPixels.byteLength !== expectedBytes) {
                spoutSendPixels = new Uint8Array(expectedBytes);
              }
              spoutSendPixels.set(new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength));
              spoutSendW = w;
              spoutSendH = h;
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
      // FPS tracking — smooth average every 500ms. In native-core preview mode
      // this measures editor/UI rAF cadence, not native render throughput.
      fpsFrameCount++;
      const fpsNow = performance.now();
      const fpsElapsed = fpsNow - fpsLastTime;
      if (fpsElapsed >= 500) {
        const measuredFrames = Math.max(1, fpsFrameCount);
        const avgFrameMs = fpsElapsed / measuredFrames;
        const fpsValue = Math.round((measuredFrames * 1000) / fpsElapsed);
        updateGpuQualityGovernor(avgFrameMs);
        updateGpuDebugHudSnapshot();
        fpsStore.set(fpsValue);
        fpsFrameCount = 0;
        fpsLastTime = fpsNow;

        // Periodic FPS log to the main-process log file. Prefixes are
        // whitelisted in the console-message forwarder. Log every ~5s so it's
        // useful without being spammy — and only when something is rendering.
        if (!((_fpsLogCount++ ) % 10)) {
          const layerCount = ($project?.layers?.length ?? 0);
          const dpr = window.devicePixelRatio || 1;
          const displayW = canvas.clientWidth;
          const displayH = canvas.clientHeight;
          const nativeOwnsFrame = nativeCorePreviewActive();
          const logPrefix = nativeOwnsFrame ? 'UI' : 'GPU';
          const modeLabel = nativeOwnsFrame
            ? 'native-core-presenter'
            : isOutputMode ? 'output' : 'main';
          console.log(`[${logPrefix}] mode=${modeLabel} FPS=${fpsValue}  layers=${layerCount}  drawingBuffer=${canvas.width}x${canvas.height}  display=${displayW}x${displayH}  dpr=${dpr}`);
          logGpuDebugSnapshot();
          if (isOutputMode && (Math.abs(canvas.width - Math.round(displayW * dpr)) > 1 || Math.abs(canvas.height - Math.round(displayH * dpr)) > 1)) {
            console.warn(`[Output] Canvas backing store ${canvas.width}x${canvas.height} does not match display ${displayW}x${displayH} @ DPR ${dpr}. Use fullscreen output or Match Output Display to avoid compositor scaling.`);
          }
        }
      }

      // WLED tap: after frame is rendered, push pixel data to any
      // configured LED controllers. Cheap (32-490 byte readback +
      // UDP send to main process); throttled to ~60Hz per controller.
      tickWLEDSenders(canvas);

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
      stage3DRenderer?.dispose();
      stage3DRenderer = null;
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
  let _lastNativeFitW: number | null = null;
  let _lastNativeFitH: number | null = null;
  // Native mode has no `engine`, so the block below never ran and an output
  // resize left the editor container at its previous aspect — the presenter
  // filled the new size while every DOM overlay (warp handles, mapping grid)
  // stayed on stale geometry until some unrelated interaction re-fit it.
  // The wrapper's ResizeObserver only fires when the WINDOW changes, not when
  // the project resolution does, so refit here on project dimensions.
  $: if (!engine && nativePrimary && $project.width && $project.height && wrapperEl) {
    const pW = $project.width || 1920;
    const pH = $project.height || 1080;
    if ((pW !== _lastNativeFitW || pH !== _lastNativeFitH)
      && wrapperEl.offsetWidth > 0 && wrapperEl.offsetHeight > 0) {
      _lastNativeFitW = pW;
      _lastNativeFitH = pH;
      sizeContainer(wrapperEl.offsetWidth, wrapperEl.offsetHeight);
      if (canvas) {
        canvas.width = pW;
        canvas.height = pH;
      }
    }
  }
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

  // Atlas fan-out lifecycle: driven purely by the sender-slice set —
  // ≥1 enabled Spout/Syphon sender slice starts the atlas, zero stops
  // it. Independent of the master spoutEnabled toggle (that's the
  // full-frame sender; slices are their own named senders).
  $: if (isElectron && !isOsrMode && !isOutputMode && !atlasStartInFlight) {
    const wantOn = ($settings?.output?.slices ?? []).some(isAtlasSenderSlice);
    if (wantOn !== lastAtlasWantOn) {
      lastAtlasWantOn = wantOn;
      atlasStartInFlight = true;
      if (wantOn) {
        invoke('texshare_start_atlas')
          .then((ok: any) => { atlasFanoutActive = !!ok; })
          .catch(() => { atlasFanoutActive = false; })
          .finally(() => { atlasStartInFlight = false; });
      } else {
        invoke('texshare_stop_atlas')
          .catch(() => {})
          .finally(() => { atlasFanoutActive = false; atlasStartInFlight = false; });
      }
    }
  }

  // Reactive Spout output: start/stop sender when spoutEnabled changes.
  // Extract only the boolean to avoid re-triggering on every $settings change.
  // OSR window must NOT create a Spout sender — the main process handles it
  // via paint events. Output-mode windows (slice-display, slice-atlas,
  // visible output) must not either: state-sync mirrors spoutEnabled=true
  // into them, and before the isOutputMode guard each one raced the editor
  // for ownership of the master sender — closing/reloading such a window
  // then issued spout_stop_sender and silently killed the editor's output.
  let spoutEnabled = false;
  $: spoutEnabled = isTauri && !isOsrMode && !isOutputMode && !!$settings?.output?.spoutEnabled;
  let spoutStarting = false; // Prevent concurrent start calls

  $: {
    if (spoutEnabled !== spoutWasEnabled) {
      spoutZeroCopyFailed = false;
      spoutWasEnabled = spoutEnabled;
    }
  }

  $: if (spoutEnabled && !spoutZeroCopyFailed && !spoutOutputActive && !spoutStarting) {
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
      if (!result?.success) {
        throw new Error(result?.error || `${getTextureShareLabel()} sender failed`);
      }
      const mode = result?.mode || 'unknown';
      spoutCpuFallbackAllowed = !isElectron || !!result?.cpuFallbackAllowed;
      if (mode === 'zero-copy-unavailable' && !spoutCpuFallbackAllowed) {
        spoutZeroCopyFailed = true;
        throw new Error(`${getTextureShareLabel()} zero-copy unavailable`);
      }
      spoutOutputActive = true;
      spoutZeroCopyFailed = false;
      spoutStarting = false;
      spoutSendLogCount = 0;
      console.log(`Spout output started: ${s?.spoutName} (${mode})`);
      const label = getTextureShareLabel();
      const modeLabel = mode === 'zero-copy-pending' ? 'zero-copy starting' : mode;
      showToast(`${label} ${modeLabel}: ${s?.spoutName} ${spoutW}x${spoutH}`, 'info');
    }).catch((e: any) => {
      console.warn('Failed to start Spout sender:', e);
      showToast(`Spout failed: ${e?.message || e}`, 'error');
      spoutZeroCopyFailed = true;
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
      disposeIntegratedEffectContext(effect);
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
      disposeIntegratedEffectContext(effect);
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
      disposeModel3DContext(model3dCtx);
    }
    model3dRenderers.clear();
  }

  onDestroy(() => {
    if (!isOutputMode && !isOsrMode && typeof window !== 'undefined') {
      window.removeEventListener('pointermove', handleSplatPointerMove);
      window.removeEventListener('pointerdown', handleSplatPointerDown);
      window.removeEventListener('pointerup', handleSplatPointerUp);
    }
    if (!isOutputMode && !isOsrMode && typeof window !== 'undefined' && (window as any).__ghostPrewarmGpuShader) {
      delete (window as any).__ghostPrewarmGpuShader;
    }
    if (!isOutputMode && !isOsrMode && typeof window !== 'undefined' && (window as any).__ghostGpuDebug) {
      delete (window as any).__ghostGpuDebug;
    }
    if (!isOutputMode && !isOsrMode && typeof window !== 'undefined' && (window as any).__ghostGpuDebugHud) {
      delete (window as any).__ghostGpuDebugHud;
    }

    cancelAnimationFrame(animationId);
    if (canvas) stopWLEDSenders(canvas);
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
    // Owner-scoped: only clears the diff-gate and disposes master-warp GPU
    // resources if THIS canvas owns the current registration
    // current registration (in bridgeMode it never registered, so this
    // is a no-op and the WebGPU owner's gate stays intact).
    disposeMasterWarpOutput(canvas);

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
    if (nativeInteractionRaf !== null) {
      cancelAnimationFrame(nativeInteractionRaf);
      nativeInteractionRaf = null;
    }
    pendingNativeInteractions.clear();
    nativeInteractionSignatures.clear();
    if (nativeOutputSceneResyncUnsub) {
      nativeOutputSceneResyncUnsub();
      nativeOutputSceneResyncUnsub = null;
    }
    if (nativePreviewSyncRaf !== null) {
      cancelAnimationFrame(nativePreviewSyncRaf);
      nativePreviewSyncRaf = null;
    }
    nativePreviewSyncInFlight = false;
    nativePreviewSyncQueued = false;
    nativePreviewSyncQueuedReason = 'queued';
    nativePreviewLastVerifiedAt = 0;
    if (nativePreviewResizeObserver) {
      try { nativePreviewResizeObserver.disconnect(); } catch { /* */ }
      nativePreviewResizeObserver = null;
    }
    if (nativePreviewWindowEventUnsub) {
      nativePreviewWindowEventUnsub();
      nativePreviewWindowEventUnsub = null;
    }
    if (nativeEmbeddedPresenterAttached || (nativeEmbeddedPreviewEnabled && nativePreviewLastSignature)) {
      nativeEmbeddedPresenterAttached = false;
      nativePreviewLastSignature = '';
      void detachNativeEditorPreview('canvas-destroy').catch(() => {});
    }
    if (nativePreviewLastSignature && !get(settings)?.output?.outputWindowOpen) {
      nativePreviewLastSignature = '';
      void detachNativeRendererOutputWindow().catch(() => {});
    }
    if (nativeRendererSync) {
      // Canvas instances are temporary (HMR, mode changes, route remounts),
      // while the native core is app-scoped. Dispose this sync owner without
      // killing the process a replacement Canvas may already be using.
      void nativeRendererSync.stop({ stopCore: false });
      nativeRendererSync = null;
    }

    destroyStateBroadcast();
    stopAudioBroadcast();
    stopModulationBroadcast();

    // Dispose textures
    for (const texture of textureCache.values()) {
      texture.dispose();
    }
    textureCache.clear();

    // Dispose ISF image-input textures — unbounded, keyed by input ref,
    // and previously never released.
    for (const texture of imageInputTextureCache.values()) {
      texture.dispose();
    }
    imageInputTextureCache.clear();

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
      disposeIntegratedEffectContext(effect);
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
      disposeModel3DContext(model3dCtx);
    }
    model3dRenderers.clear();

    // Dispose GPU shader layer renderers and any ImageBitmap-backed
    // texture handoffs they left for the Three compositor.
    for (const renderer of gpuLayerRenderers.values()) {
      try { renderer.dispose(); } catch { /* */ }
    }
    gpuLayerRenderers.clear();
    for (const texture of gpuLayerTextures.values()) {
      const img = texture.image as ImageBitmap | undefined;
      if (img && typeof (img as any).close === 'function') {
        try { (img as any).close(); } catch { /* */ }
      }
      try { texture.dispose(); } catch { /* */ }
    }
    gpuLayerTextures.clear();

    // Dispose Spout receivers
    for (const key of Array.from(spoutReceivers.keys())) {
      cleanupSpoutReceiver(key);
    }
    stopOsrStatusListener?.();
    stopOsrStatusListener = null;
    stopAtlasStatusListener?.();
    stopAtlasStatusListener = null;

    // Dispose NDI receivers — stop the poll loop, tear down the
    // addon-side receiver, free the DataTexture.
    for (const key of Array.from(ndiReceivers.keys())) {
      cleanupNdiReceiver(key);
    }
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
        // Hold black while the replacement compiles/loads. The real
        // texture overwrites this the moment it's ready (cache assign
        // below or the async load completion); until then the layer
        // stays in the render plan painting opaque black instead of
        // exposing the layer underneath for a few frames.
        layer.source.texture = getBlackHoldTexture();
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

      // AI-generated JS animations (threejs or p5js with jsAnimation) need texture updates.
      // jsContext.updateTexture() already rebinds texture.image to the live
      // iframe canvas AND sets needsUpdate. The previous code set
      // needsUpdate again on layer.source.texture, which is a SEPARATE
      // reference set during loadTextureAsync — Three.js had to re-upload
      // the canvas to the GPU twice per frame. Drop the redundant set.
      if ((layer.source.type === 'threejs' || layer.source.type === 'p5js') && layer.source.jsAnimation) {
        const jsContext = getJSAnimationContext(layer.source.id);
        if (jsContext) jsContext.updateTexture();
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

    cleanupSpoutReceiver(src);
    cleanupSpoutReceiver(cacheKey);
    cleanupNdiReceiver(src);
    cleanupNdiReceiver(cacheKey);

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
    loadingTextures.delete(cacheKey);
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
          // Initialize OPAQUE BLACK. A fresh RT samples as transparent
          // black until the shader's first render; if that lands a frame
          // later (async load completion mid-frame), the layer below
          // bleeds through for a frame — same flicker the black-hold
          // texture prevents during the swap.
          const glr = engine?.getRenderer?.();
          if (glr) {
            const prevTarget = glr.getRenderTarget();
            const prevColor = glr.getClearColor(new THREE.Color());
            const prevAlpha = glr.getClearAlpha();
            glr.setRenderTarget(renderTarget);
            glr.setClearColor(0x000000, 1);
            glr.clear();
            glr.setRenderTarget(prevTarget);
            glr.setClearColor(prevColor, prevAlpha);
          }
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

                invoke<{ data: RawFrameData; width: number; height: number } | null>('spout_receive_frame')
                  .then((frame) => {
                    recvInFlight = false;
                    if (!recvActive) return;

                    if (frame && frame.data) {
                      const w = frame.width;
                      const h = frame.height;
                      const expectedSize = w * h * 4;
                      const frameData = asUint8FrameData(frame.data);

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
                        const newTex = new THREE.DataTexture(frameData, w, h, THREE.RGBAFormat);
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
                        // through tex.image.data + needsUpdate lets THREE
                        // revalidate the GL texture each frame; avoiding a
                        // stale handle matters more than a direct texSubImage2D.
                        (tex.image as any).data = frameData;
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
                    // THREE's normal upload path instead while handing it the
                    // latest frame buffer directly.
                    if (tex.image.data) {
                      (tex.image as any).data = frameData;
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

      // NDI receiver source — pulls frames from a discovered NDI
      // sender on the network. Structurally identical to the Spout
      // receiver path above; differences are limited to the IPC
      // endpoint name and the source-resolution lookup. The native
      // addon's receiveFrame returns null when no new frame has
      // arrived, so the poll loop quietly skips uploads on stale ticks.
      if (source.type === 'spout' && source.ndiSource && isElectron && !isOsrMode) {
        const ndiName = source.ndiSource.senderName;
        let ndiRecv = ndiReceivers.get(cacheKey);
        if (!ndiRecv) {
          try {
            const api = (window as any).ghostNDI;
            if (api) {
              await api.createReceiver(ndiName);
              const initW = source.ndiSource.width || 1920;
              const initH = source.ndiSource.height || 1080;
              // Seed with a faint cyan pattern so the slot visibly
              // exists before the first network frame arrives.
              const initPixels = new Uint8Array(initW * initH * 4);
              for (let i = 0; i < initPixels.length; i += 4) {
                initPixels[i] = 20; initPixels[i+1] = 50; initPixels[i+2] = 70; initPixels[i+3] = 255;
              }
              const tex = new THREE.DataTexture(initPixels, initW, initH, THREE.RGBAFormat);
              tex.minFilter = THREE.LinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.needsUpdate = true;
              ndiRecv = {
                sourceName: ndiName,
                texture: tex,
                width: initW,
                height: initH,
                lastFrameCounter: 0,
              };
              ndiReceivers.set(cacheKey, ndiRecv);

              // Poll loop — RAF cadence with an in-flight guard so we
              // never have two ghostNDI.receiveFrame calls outstanding.
              let pollActive = true;
              let inFlight = false;
              let rafId: number | null = null;
              const recvKey = cacheKey;
              const poll = () => {
                if (!pollActive) return;
                const recv = ndiReceivers.get(recvKey);
                if (!recv) { pollActive = false; return; }
                if (inFlight) { rafId = requestAnimationFrame(poll); return; }
                inFlight = true;
                api.receiveFrame(ndiName).then((frame: any) => {
                  inFlight = false;
                  if (!pollActive) return;
                  if (!frame || !frame.data) {
                    rafId = requestAnimationFrame(poll);
                    return;
                  }
                  // Frame counter advances monotonically in the addon —
                  // skip uploads when the same frame is returned twice
                  // (NDI senders below display refresh).
                  if (frame.frame === recv.lastFrameCounter) {
                    rafId = requestAnimationFrame(poll);
                    return;
                  }
                  recv.lastFrameCounter = frame.frame;
                  const w = frame.width, h = frame.height;
                  const bytes = new Uint8Array(frame.data);
                  const t = recv.texture;
                  if (t.image.width !== w || t.image.height !== h) {
                    // Dimension change — rebuild the texture and
                    // re-point the cache so downstream materials pick
                    // up the new size.
                    const replaced = new THREE.DataTexture(bytes, w, h, THREE.RGBAFormat);
                    replaced.minFilter = THREE.LinearFilter;
                    replaced.magFilter = THREE.LinearFilter;
                    replaced.needsUpdate = true;
                    recv.texture = replaced;
                    recv.width = w;
                    recv.height = h;
                    t.dispose();
                    textureCache.set(recvKey, replaced);
                    evictTextureCache();
                  } else if (t.image.data) {
                    t.image.data.set(bytes);
                    t.needsUpdate = true;
                  }
                  rafId = requestAnimationFrame(poll);
                }).catch(() => {
                  inFlight = false;
                  if (pollActive) rafId = requestAnimationFrame(poll);
                });
              };
              rafId = requestAnimationFrame(poll);
              (ndiRecv as any)._stopPolling = () => {
                pollActive = false;
                if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
              };
            }
          } catch (err) {
            console.error('[NDI] create receiver failed:', err);
          }
        }
        if (ndiRecv) texture = ndiRecv.texture;
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

    // Update audio textures once per frame (for all ISF shaders to use).
    // Also broadcast the analysis bytes to output windows (Spout OSR,
    // fullscreen output) — their own JS context has no microphone access,
    // so without this every projector/Spout output sees zeroed audio
    // uniforms even when the editor is fully reactive. See audioBroadcast.ts.
    const audioState = $audioStore;
    const rawAnalysis = getLastRawAnalysis();
    if (rawAnalysis && audioState.isActive) {
      audioTextures.update(rawAnalysis);
      broadcastAudioFrame(rawAnalysis, true);
    } else if (rawAnalysis) {
      // Send isActive=false to telegraph "stop reacting" to receivers,
      // so their shaders fall back to the same zero state the editor uses.
      broadcastAudioFrame(rawAnalysis, false);
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
        if (!_SVGLayerRendererCtor) {
          // Lazy-load the SVG renderer chunk; skip this layer until ready.
          _lazyLoad('svg', async () => { _SVGLayerRendererCtor = (await import('../svg/renderer')).SVGLayerRenderer; });
          continue;
        }
        // Pass the main renderer to avoid creating multiple WebGL contexts
        const mainRenderer = engine.getRenderer();
        svgRenderer = new _SVGLayerRendererCtor(width, height, mainRenderer);
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
        // 3D + new effect families — these change geometry/material/scene
        // structure so they require a scene rebuild (uniform-only params
        // like rotation speed / metalness update live and stay out of here).
        layer.svgContent.renderMode,
        layer.svgContent.materialPreset,
        layer.svgContent.extrudeDepth,
        layer.svgContent.bevelEnabled,
        layer.svgContent.bevelSize,
        layer.svgContent.lightPreset,
        layer.svgContent.outlineStyle,
        layer.svgContent.connectionStyle,
        layer.svgContent.connectionRange,
        layer.svgContent.particleFillEnabled,
        layer.svgContent.particleFillDensity,
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

        // Render to texture (params drive 3D mode / bloom selection)
        const texture = svgRenderer.render(layer.svgContent);

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

      // Get or create renderer for this layer. Pick the WebGL2 path
      // when the user opted in (default true), otherwise the legacy
      // Canvas2D path. We don't hot-swap between paths for an already-
      // running layer — would lose the committed framebuffer + dispose
      // costs both ways. Toggle takes effect on the next layer add.
      let lpRenderer = lightPaintingRenderers.get(layer.id);
      if (!lpRenderer) {
        const useWebGL2 = $settings?.performance?.useWebGL2LightPainting !== false;
        try {
          lpRenderer = useWebGL2
            ? new LightPaintingWebGLRenderer(width, height)
            : new LightPaintingRenderer(width, height);
        } catch (err: any) {
          // WebGL2 init can fail on hardware without it; fall back
          // to Canvas2D so the user still sees their drawing.
          console.warn('[Canvas] WebGL2 light painting init failed, falling back to Canvas2D:', err?.message || err);
          lpRenderer = new LightPaintingRenderer(width, height);
        }
        lightPaintingRenderers.set(layer.id, lpRenderer);
      } else {
        lpRenderer.resize(width, height);
      }

      // Render and get texture
      const texture = lpRenderer.render(layer.lightPaintingContent, Math.min(deltaTime, 0.1));

      // Store texture on layer for engine to pick up (same pattern as SVG/lines)
      (layer as any)._lightPaintingTexture = texture;
    }

    // ── GPU stroke-particle brushes → topmost light-paint layer ──
    // WebGPUCanvas renders the GPU brushes (spiral / firefly / sap-flow
    // / etc.) into an offscreen canvas (gpuBrushBridge). Slot it as the
    // topmost light-paint layer's _lightPaintingGPUTexture so the engine
    // composites it at that layer's real z-position (instead of the old
    // always-on-top overlay). The brush canvas batches strokes from ALL
    // light-paint layers, so it lands at the topmost one's z; layers
    // stacked above that occlude it. Cleared from every other LP layer
    // so it isn't composited more than once.
    const brushCanvas = getGPUBrushCanvas();
    const lpLayers = layerList.filter((l) => l.type === 'lightpainting');
    // layerList index 0 = top of the panel (renders on top), so the
    // topmost light-paint layer is the one with the lowest index.
    let topLP: Layer | null = null;
    for (const l of lpLayers) {
      if (!topLP || layerList.indexOf(l) < layerList.indexOf(topLP)) topLP = l;
    }
    for (const l of lpLayers) {
      if (l === topLP && brushCanvas && brushCanvas.width > 1) {
        if (!gpuBrushTexture || gpuBrushTextureSource !== brushCanvas) {
          gpuBrushTexture = new THREE.CanvasTexture(brushCanvas);
          gpuBrushTexture.colorSpace = THREE.SRGBColorSpace;
          gpuBrushTextureSource = brushCanvas;
        }
        gpuBrushTexture.needsUpdate = true;
        (l as any)._lightPaintingGPUTexture = gpuBrushTexture;
      } else {
        (l as any)._lightPaintingGPUTexture = null;
      }
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

    const visual = getVisualAudioSnapshot();

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
      const splatBandLevel = splatBand === 'all'
        ? visual.level
        : (visual.bands[splatBand as keyof typeof visual.bands] || 0);
      const splatSensitivity = layer.splatContent.audioSensitivity || 1;
      splatCtx.renderer.update(layer.splatContent, splatBandLevel * splatSensitivity, visual);

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
    if (!browserEditorPreviewActive()) {
      for (const layer of layerList) {
        if (layer.type === 'gpu') {
          delete (layer as any)._gpuLayerPreviewCanvas;
          delete (layer as any)._gpuLayerTexture;
        }
      }
      disposeGpuLayerRenderersForNativePreview('gpu-layer-update-suppressed');
      return;
    }
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
      if (layer.type !== 'gpu' || !layer.gpuLayerContent || !layer.visible) {
        if (layer.type === 'gpu') {
          delete (layer as any)._gpuLayerPreviewCanvas;
        }
        continue;
      }
      liveIds.add(layer.id);
      const c = layer.gpuLayerContent;

      // Lazy-create renderer.
      let renderer = gpuLayerRenderers.get(layer.id);
      if (!renderer) {
        try {
          renderer = new GpuLayerRenderer(device, presentFormat, width, height, {
            handoffMode: gpuLayerUseBitmapHandoff ? 'bitmap' : 'canvas',
          });
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
          phoneVisionNativeFrame: get(phoneVision).nativeFrame,
        };
        // Audio bands for shaders that opt into reactivity (e.g.
        // flythrough audioReactive toggle). Pull from the shared
        // visual-audio bus so these shaders inherit the same smoothing
        // as the rest of the renderer.
        const bandsSnap = getVisualAudioSnapshot();
        // Render-quality scaling — heavy shaders (planet clouds, fluid
        // sims) blow past 60fps budget at full project resolution on
        // Apple Silicon + integrated GPUs. The per-layer renderQuality
        // slider (and the global Shader Quality setting it falls back
        // to) scales the WebGPU backing store, then the downstream
        // CanvasTexture upsamples with LinearFilter. Mirrors the
        // existing ISF path at line ~2852.
        const gpuQuality = layer.renderQuality ?? SHADER_QUALITY_MULTIPLIERS[get(settings).ui.shaderQuality] ?? 1.0;
        const gpuW = Math.max(64, Math.round(width * gpuQuality));
        const gpuH = Math.max(64, Math.round(height * gpuQuality));
        const runtime = getGhostGpuRuntime();
        const manualRenderTime = typeof engine.manualTime === 'number' && Number.isFinite(engine.manualTime)
          ? engine.manualTime
          : null;
        const fixedGpuTier = fixedGpuInstrumentTier();
        const gpuQualityState = runtime
          ? {
              capsTier: runtime.caps.qualityTier,
              suggestedTier: manualRenderTime !== null
                ? fixedGpuTier ?? runtime.caps.qualityTier
                : fixedGpuTier ?? gpuGovernorSnapshot?.suggestedTier ?? runtime.caps.qualityTier,
              qualityScale: fixedGpuTier || manualRenderTime !== null ? 1 : gpuGovernorSnapshot?.qualityScale ?? 1,
              adaptive: !fixedGpuTier && manualRenderTime === null,
              governor: !fixedGpuTier && manualRenderTime === null ? gpuGovernorSnapshot : null,
            }
          : undefined;
        renderer.renderFrame(c.shaderId, mergedParams, gpuW, gpuH, sourceCtx, {
          bass: bandsSnap.bassFast ?? 0,
          mid: bandsSnap.mid ?? 0,
          treble: bandsSnap.high ?? 0,
        }, {
          time: manualRenderTime,
        }, gpuQualityState);
      } catch (err: any) {
        console.warn('[Canvas] gpu-layer: render failed', err?.message || err);
        continue;
      }

      // Handoff into the Three/WebGL compositor. Default is the safer
      // canvas-backed path; `?gpu-layer-bitmap=1` re-enables the
      // ImageBitmap path for profiling on runtimes where it is stable.
      let tex = gpuLayerTextures.get(layer.id);
      let previewElement: CanvasImageSource | null = renderer.canvas;
      if (!tex) {
        tex = gpuLayerUseBitmapHandoff
          ? new THREE.Texture()
          : new THREE.CanvasTexture(renderer.canvas as any);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        // The renderer writes top-down; Three.js samples bottom-up.
        // flipY = true flips on upload so the texture reads upright.
        tex.flipY = true;
        gpuLayerTextures.set(layer.id, tex);
      }
      if (gpuLayerUseBitmapHandoff) {
        const bitmap = renderer.consumeOutputBitmap();
        if (bitmap) {
          const prev = tex.image as ImageBitmap | undefined;
          if (prev && typeof (prev as any).close === 'function') {
            try { (prev as any).close(); } catch { /* */ }
          }
          tex.image = bitmap;
          tex.needsUpdate = true;
        }
        previewElement = (tex.image as CanvasImageSource | undefined) ?? renderer.canvas;
      } else {
        tex.image = renderer.canvas as any;
        tex.needsUpdate = true;
        previewElement = renderer.canvas;
      }
      (layer as any)._gpuLayerTexture = tex;
      (layer as any)._gpuLayerPreviewCanvas = previewElement;
    }

    // Reap renderers for removed/hidden layers.
    for (const [id, r] of gpuLayerRenderers) {
      if (!liveIds.has(id)) {
        try { r.dispose(); } catch { /* */ }
        gpuLayerRenderers.delete(id);
        const t = gpuLayerTextures.get(id);
        const img = t?.image as ImageBitmap | undefined;
        if (img && typeof (img as any).close === 'function') {
          try { (img as any).close(); } catch { /* */ }
        }
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

    const visual = getVisualAudioSnapshot();

    for (const layer of layerList) {
      if (layer.type !== 'model3d' || !layer.model3dContent) continue;

      // Get or create model3d renderer for this layer
      let model3dCtx = model3dRenderers.get(layer.id);

      if (!model3dCtx) {
        if (!_Model3DRendererCtor) {
          // Lazy-load the model3d chunk (GLTF/FBX/OBJ loaders); skip until ready.
          _lazyLoad('model3d', async () => { _Model3DRendererCtor = (await import('../model3d/Model3DRenderer')).Model3DRenderer; });
          continue;
        }
        // Create in standalone mode with its OWN WebGL context + offscreen
        // canvas at HALF resolution to reduce GPU load and texture upload cost.
        const modelW = Math.round(width / 2);
        const modelH = Math.round(height / 2);
        const offCanvas = document.createElement('canvas');
        offCanvas.width = modelW;
        offCanvas.height = modelH;
        offCanvas.style.display = 'none';
        document.body.appendChild(offCanvas);

        const model3dRenderer = new _Model3DRendererCtor(offCanvas, modelH);

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
        const layerId = layer.id;
        ctx.renderer.loadModel(currentModelUrl, layer.model3dContent.modelFormat)
          .then((result) => {
            if ((ctx as any)._disposed || model3dRenderers.get(layerId) !== ctx) return;
            const { vertexCount, faceCount } = result;
            const hasAnimations = (result as any).hasAnimations ?? false;
            console.log('[Canvas] Model loaded:', vertexCount, 'vertices,', faceCount, 'faces', hasAnimations ? `(${hasAnimations} animations)` : '');
            project.updateModel3DContent(layerId, { vertexCount, faceCount, hasFileAnimations: hasAnimations });
            ctx.loadingModel = false;
            (ctx as any)._failedUrl = null;
          })
          .catch((err) => {
            if ((ctx as any)._disposed || model3dRenderers.get(layerId) !== ctx) return;
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
      const modelBandLevel = modelBand === 'all'
        ? visual.level
        : (visual.bands[modelBand as keyof typeof visual.bands] || 0);
      model3dCtx.renderer.update(content, modelBandLevel, visual);
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
        disposeModel3DContext(ctx);
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

    // In offline render mode, engine.manualTime is the world clock.
    // Integrated effects must advance from that clock as well; otherwise
    // slow frame capture lets stateful effects run ahead on live RAF ticks.
    const deltaTime = getIntegratedEffectDeltaTime();

    const visual = getVisualAudioSnapshot();

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
      if (effectSource.effectType !== 'fluid' && effectSource.effectType !== 'particles' && effectSource.effectType !== 'milkdrop' && effectSource.effectType !== 'audiomotion' && effectSource.effectType !== 'wavejs' && effectSource.effectType !== 'hydra' && effectSource.effectType !== 'ghostfx' && effectSource.effectType !== 'analyzerlab' && effectSource.effectType !== 'handfx' && effectSource.effectType !== 'ghostpilot') continue;

      // Lazy-load the sim class chunk; skip this group until the ctor is
      // ready (only matters on the very first frame the effect appears).
      if (!effectCtx) {
        if (effectSource.effectType === 'fluid' && !_FluidSimulationCtor) {
          _lazyLoad('fluid', async () => { _FluidSimulationCtor = (await import('../effects/fluidSimulation')).FluidSimulation; });
          continue;
        }
        if (effectSource.effectType === 'particles' && !_ParticleSystem3DCtor) {
          _lazyLoad('particles3d', async () => { _ParticleSystem3DCtor = (await import('../effects/particleSystem3D')).ParticleSystem3D; });
          continue;
        }
        if (effectSource.effectType === 'milkdrop' && (!_MilkdropVisualizerCtor || !_milkdropLoadPresetPack)) {
          _lazyLoad('milkdrop', async () => {
            const mod = await import('../effects/milkdropVisualizer');
            _MilkdropVisualizerCtor = mod.MilkdropVisualizer;
            const pmod = await import('../effects/milkdropPresets');
            _milkdropLoadPresetPack = pmod.loadPresetPack;
            _milkdropPickNextPreset = pmod.pickNextPreset;
          });
          continue;
        }
        if (effectSource.effectType === 'audiomotion' && !_AudioMotionVisualizerCtor) {
          _lazyLoad('audiomotion', async () => {
            const mod = await import('../effects/audiomotionVisualizer');
            _AudioMotionVisualizerCtor = mod.AudioMotionVisualizer;
          });
          continue;
        }
        if (effectSource.effectType === 'wavejs' && !_WaveJSVisualizerCtor) {
          _lazyLoad('wavejs', async () => {
            const mod = await import('../effects/wavejsVisualizer');
            _WaveJSVisualizerCtor = mod.WaveJSVisualizer;
          });
          continue;
        }
        if (effectSource.effectType === 'hydra' && (!_HydraVisualizerCtor || !_hydraPresetsMod)) {
          _lazyLoad('hydra', async () => {
            const mod = await import('../effects/hydraVisualizer');
            _HydraVisualizerCtor = mod.HydraVisualizer;
            _hydraPresetsMod = await import('../effects/hydraPresets');
          });
          continue;
        }
        if (effectSource.effectType === 'ghostfx' && !_GhostFXVisualizerCtor) {
          _lazyLoad('ghostfx', async () => {
            const mod = await import('../effects/ghostfx/ghostfxVisualizer');
            _GhostFXVisualizerCtor = mod.GhostFXVisualizer;
          });
          continue;
        }
        if (effectSource.effectType === 'ghostpilot' && !_GhostPilotVisualizerCtor) {
          _lazyLoad('ghostpilot', async () => {
            const mod = await import('../effects/ghostPilot/ghostPilotVisualizer');
            _GhostPilotVisualizerCtor = mod.GhostPilotVisualizer;
            // First use arms gamepad polling so a controller is live the
            // moment the world appears (no-op if already running).
            const gp = await import('../input/gamepad');
            gp.startGamepadPolling();
          });
          continue;
        }
        if (effectSource.effectType === 'analyzerlab' && !_AnalyzerLabVisualizerCtor) {
          _lazyLoad('analyzerlab', async () => {
            const mod = await import('../effects/analyzerLabVisualizer');
            _AnalyzerLabVisualizerCtor = mod.AnalyzerLabVisualizer;
          });
          continue;
        }
        if (effectSource.effectType === 'handfx' && !_HandFXVisualizerCtor) {
          _lazyLoad('handfx', async () => {
            const mod = await import('../effects/handfxVisualizer');
            _HandFXVisualizerCtor = mod.HandFXVisualizer;
          });
          continue;
        }
      }

      if (effectCtx && effectCtx.type !== effectSource.effectType) {
        // Flipping from fluid → particles (or back) must clean up webcam
        // resources from the previous effect. Without this, the MediaStream
        // tracks stayed live and the video/texture leaked GPU memory every
        // time the user changed effect type on a webcam-enabled layer.
        disposeIntegratedEffectContext(effectCtx);
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
          type: effectSource.effectType as 'fluid' | 'particles' | 'milkdrop' | 'audiomotion' | 'wavejs' | 'hydra' | 'ghostfx' | 'analyzerlab' | 'handfx',
          renderTarget,
          simulationWidth: width,
          simulationHeight: height,
          lastUpdateTime: performance.now() / 1000,
          mouseX: 0.5,
          mouseY: 0.5,
          lastMouseX: 0.5,
          lastMouseY: 0.5,
        };

        if (effectSource.effectType === 'fluid') {
          const simSize = getFluidSimulationSize(width, height);
          const fluid = new _FluidSimulationCtor!(simSize.width, simSize.height);
          fluid.init(renderer);
          if (effectSource.fluidMode !== undefined) {
            fluid.setMode(effectSource.fluidMode as FluidMode);
          }
          effectCtx.fluid = fluid;
          effectCtx.simulationWidth = simSize.width;
          effectCtx.simulationHeight = simSize.height;
        } else if (effectSource.effectType === 'particles') {
          const ps = new _ParticleSystem3DCtor!(width, height);
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
        } else if (effectSource.effectType === 'milkdrop') {
          // Lazily create the shared AudioContext so Milkdrop can initialise
          // before any audio source has been started. Butterchurn renders
          // silent visuals until connectAudio() is called later (we retry
          // each frame in the render path below).
          const audioCtx = audioAnalyzer.getOrCreateAudioContext();
          const pixelRatio = effectSource.milkdropPixelRatio ?? 1;
          const meshSize = effectSource.milkdropMeshSize ?? 48;
          const mk = new _MilkdropVisualizerCtor!(audioCtx, {
            width, height, pixelRatio, meshSize,
          });
          mk.init(renderer);
          mk.setSensitivity(effectSource.milkdropSensitivity ?? 1.5);
          effectCtx.milkdrop = mk;
        } else if (effectSource.effectType === 'audiomotion') {
          const audioCtx = audioAnalyzer.getOrCreateAudioContext();
          const am = new _AudioMotionVisualizerCtor!(audioCtx, width, height);
          am.init(renderer);
          am.setParams({
            mode: effectSource.audiomotionMode ?? 4,
            gradient: effectSource.audiomotionGradient ?? 'orangered',
            radial: effectSource.audiomotionRadial ?? false,
            barStyle: effectSource.audiomotionBarStyle ?? 'normal',
            peakLine: effectSource.audiomotionPeakLine ?? false,
            showPeaks: effectSource.audiomotionShowPeaks ?? true,
            mirror: effectSource.audiomotionMirror ?? 0,
            flipY: effectSource.audiomotionFlipY ?? false,
            reflexRatio: effectSource.audiomotionReflexRatio ?? 0,
            barSpace: effectSource.audiomotionBarSpace ?? 0.1,
            minFreq: effectSource.audiomotionMinFreq ?? 30,
            maxFreq: effectSource.audiomotionMaxFreq ?? 16000,
            sensitivity: effectSource.audiomotionSensitivity ?? 1,
            smoothing: effectSource.audiomotionSmoothing ?? 0.5,
            bgAlpha: effectSource.audiomotionBgAlpha ?? 1.0,
          });
          effectCtx.audiomotion = am;
        } else if (effectSource.effectType === 'wavejs') {
          const audioCtx = audioAnalyzer.getOrCreateAudioContext();
          const wj = new _WaveJSVisualizerCtor!(audioCtx, width, height);
          wj.init(renderer);
          wj.setParams({
            animation: effectSource.wavejsAnimation ?? 'Wave',
            sensitivity: effectSource.wavejsSensitivity ?? 1.5,
            lineWidth: effectSource.wavejsLineWidth ?? 4,
            colorA: effectSource.wavejsColorA ?? [1.0, 0.42, 0.42],
            colorB: effectSource.wavejsColorB ?? [1.0, 0.55, 0.30],
            useGradient: effectSource.wavejsUseGradient ?? true,
            gradientRotate: effectSource.wavejsGradientRotate ?? 0,
            glowStrength: effectSource.wavejsGlowStrength ?? 15,
            glowColor: effectSource.wavejsGlowColor ?? [1.0, 0.42, 0.42],
            bgAlpha: effectSource.wavejsBgAlpha ?? 1.0,
            flipY: effectSource.wavejsFlipY ?? false,
          });
          effectCtx.wavejs = wj;
        } else if (effectSource.effectType === 'hydra') {
          const hy = new _HydraVisualizerCtor!(width, height);
          hy.init(renderer);
          hy.setParams({
            sketchName: effectSource.hydraSketchName ?? 'Welcome',
            sketchCode: effectSource.hydraSketchCode ?? 'osc(20, 0.1, 1.4).rotate(0.1).out()',
            sensitivity: effectSource.hydraSensitivity ?? 1.5,
            bgAlpha: effectSource.hydraBgAlpha ?? 1.0,
          });
          effectCtx.hydra = hy;
          effectCtx.hydraLoadedPresetName = effectSource.hydraSketchName ?? 'Welcome';
        } else if (effectSource.effectType === 'ghostfx') {
          const fx = new _GhostFXVisualizerCtor!(width, height);
          fx.init(renderer);
          fx.setParams({
            scenePreset:        effectSource.ghostfxScenePreset        ?? 'drift',
            sensitivity:        effectSource.ghostfxSensitivity        ?? 1.4,
            hueDriftSpeed:      effectSource.ghostfxHueDriftSpeed      ?? 0.15,
            bloomIntensity:     effectSource.ghostfxBloomIntensity     ?? 1.4,
            bloomThreshold:     effectSource.ghostfxBloomThreshold     ?? 0.45,
            vignette:           effectSource.ghostfxVignette           ?? 0.7,
            exposure:           effectSource.ghostfxExposure           ?? 0.1,
            bgAlpha:            effectSource.ghostfxBgAlpha            ?? 1.0,
            vortexStrength:     effectSource.ghostfxVortexStrength     ?? 2.0,
            latticeThreshold:   effectSource.ghostfxLatticeThreshold   ?? 2.5,
            trailIntensity:     effectSource.ghostfxTrailIntensity     ?? 1.0,
            feedbackAmount:     effectSource.ghostfxFeedbackAmount     ?? 0.35,
            feedbackZoom:       effectSource.ghostfxFeedbackZoom       ?? 1.003,
            ribbonWidth:        effectSource.ghostfxRibbonWidth        ?? 0.10,
            ribbonSpawn:        effectSource.ghostfxRibbonSpawn        ?? 1.0,
            ribbonTranslucency: effectSource.ghostfxRibbonTranslucency ?? 0.35,
            ribbonBlend:        effectSource.ghostfxRibbonBlend        ?? 'additive',
            lightAzimuth:       effectSource.ghostfxLightAzimuth       ?? 35,
            lightElevation:     effectSource.ghostfxLightElevation     ?? 55,
            lightStrength:      effectSource.ghostfxLightStrength      ?? 0.9,
            ambient:            effectSource.ghostfxAmbient            ?? 0.30,
            liquidSplatForce:   effectSource.ghostfxLiquidSplatForce   ?? 1.0,
            liquidSplatRadius:  effectSource.ghostfxLiquidSplatRadius  ?? 0.08,
            liquidDyeDecay:     effectSource.ghostfxLiquidDyeDecay     ?? 0.995,
            liquidVelDecay:     effectSource.ghostfxLiquidVelDecay     ?? 0.992,
            liquidBassRate:     effectSource.ghostfxLiquidBassRate     ?? 1.0,
          });
          effectCtx.ghostfx = fx;
        } else if (effectSource.effectType === 'ghostpilot') {
          const gpv = new _GhostPilotVisualizerCtor!(width, height);
          gpv.init(renderer);
          gpv.setParams({
            sensitivity:  effectSource.ghostpilotSensitivity  ?? 1.4,
            speedScale:   effectSource.ghostpilotSpeedScale   ?? 1.0,
            hueBase:      effectSource.ghostpilotHueBase      ?? 0.0,
            autopilot:    effectSource.ghostpilotAutopilot    ?? true,
            steerAssist:  effectSource.ghostpilotSteerAssist  ?? 1.0,
          });
          effectCtx.ghostpilot = gpv;
        } else if (effectSource.effectType === 'analyzerlab') {
          const al = new _AnalyzerLabVisualizerCtor!(width, height);
          al.init(renderer);
          al.setParams({
            layout:             effectSource.analyzerLabLayout             ?? 'stack',
            colormap:           effectSource.analyzerLabColormap           ?? 'inferno',
            spectroOrientation: effectSource.analyzerLabSpectroOrientation ?? 'horizontal',
            spectroGain:        effectSource.analyzerLabSpectroGain        ?? 1.0,
            spectroMinDb:       effectSource.analyzerLabSpectroMinDb       ?? -85,
            spectroMaxDb:       effectSource.analyzerLabSpectroMaxDb       ?? -25,
            scrollSpeed:        effectSource.analyzerLabScrollSpeed        ?? 1.0,
            chromaStyle:        effectSource.analyzerLabChromaStyle        ?? 'bars',
            chromaGlow:         effectSource.analyzerLabChromaGlow         ?? 0.5,
            waveStyle:          effectSource.analyzerLabWaveStyle          ?? 'line',
            waveLineWidth:      effectSource.analyzerLabWaveLineWidth      ?? 1.5,
            showBeats:          effectSource.analyzerLabShowBeats          ?? true,
            showLabels:         effectSource.analyzerLabShowLabels         ?? true,
            bgAlpha:            effectSource.analyzerLabBgAlpha            ?? 1.0,
          });
          effectCtx.analyzerlab = al;
        } else if (effectSource.effectType === 'handfx') {
          const hx = new _HandFXVisualizerCtor!(width, height);
          hx.init(renderer);
          hx.setParams({
            mode:                effectSource.handfxMode                ?? 'trails',
            cameraOn:            effectSource.handfxCameraOn            ?? false,
            smoothing:           effectSource.handfxSmoothing           ?? 0.15,
            predictMs:           effectSource.handfxPredictMs           ?? 18,
            showHelp:            effectSource.handfxShowHelp            ?? true,
            bgAlpha:             effectSource.handfxBgAlpha             ?? 0.0,
            panelColor:          effectSource.handfxPanelColor          ?? '#FFFFFF',
            panelOpacity:        effectSource.handfxPanelOpacity        ?? 1.0,
            panelPadding:        effectSource.handfxPanelPadding        ?? 0.04,
            panelCornerRadius:   effectSource.handfxPanelCornerRadius   ?? 0.02,
            trailFade:           effectSource.handfxTrailFade           ?? 0.985,
            trailColorMode:      effectSource.handfxTrailColorMode      ?? 'rainbow',
            trailThickness:      effectSource.handfxTrailThickness      ?? 3,
            trailVelocityScale:  effectSource.handfxTrailVelocityScale  ?? 1.5,
            trailSparkDensity:   effectSource.handfxTrailSparkDensity   ?? 0.5,
            trailFlowStrength:   effectSource.handfxTrailFlowStrength   ?? 0.7,
            inkColorMode:        effectSource.handfxInkColorMode        ?? 'coral',
            inkSize:             effectSource.handfxInkSize             ?? 55,
            inkOpacity:          effectSource.handfxInkOpacity          ?? 0.28,
            inkDrift:            effectSource.handfxInkDrift            ?? 1.0,
            skeletonColor:       effectSource.handfxSkeletonColor       ?? '#FF6B6B',
            skeletonGlow:        effectSource.handfxSkeletonGlow        ?? 1.5,
            sprayColorMode:      effectSource.handfxSprayColorMode      ?? 'rainbow',
            sprayIntensity:      effectSource.handfxSprayIntensity      ?? 1.5,
            sprayThreshold:      effectSource.handfxSprayThreshold      ?? 0.25,
            showCamera:          effectSource.handfxShowCamera          ?? false,
            cameraOpacity:       effectSource.handfxCameraOpacity       ?? 0.5,
          });
          effectCtx.handfx = hx;
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
        disposeIntegratedCameraFeed(ctx);
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

      // ── Milkdrop path ──────────────────────────────────────────────────
      if (effectCtx.milkdrop && effectSource.effectType === 'milkdrop') {
        const mk = effectCtx.milkdrop;
        const blendTime = effectSource.milkdropBlendTime ?? 2.7;

        // Track first-layer id for store keying (panel commands target by layer id)
        const layerId = groupedLayers[0]?.id ?? '';
        effectCtx.milkdropLayerId = layerId;

        // Resize on project-size change
        if (
          effectCtx.renderTarget.width !== width ||
          effectCtx.renderTarget.height !== height
        ) {
          mk.resize(width, height, effectSource.milkdropPixelRatio ?? 1);
        }

        // Audio routing: when the multi-stem analyser is running AND the
        // layer has a routing matrix, build a StemRouter and feed its
        // weighted sum into butterchurn instead of the raw mono source.
        // Otherwise late-attach the single-channel source as before.
        const stemsRunning = multiStemAnalyzer.isRunning();
        const wantStems = stemsRunning && !!effectSource.milkdropRoutingMatrix;
        const wantSource: 'mono' | 'stems' = wantStems ? 'stems' : 'mono';
        if (wantSource !== effectCtx.milkdropAudioSource) {
          // Source mode flipped — rebuild
          if (effectCtx.milkdropStemRouter) {
            try { effectCtx.milkdropStemRouter.dispose(); } catch {}
            effectCtx.milkdropStemRouter = undefined;
          }
          if (wantStems) {
            const audioCtx = audioAnalyzer.getOrCreateAudioContext();
            const router = new StemRouter(audioCtx);
            router.setStems(multiStemAnalyzer.getStems());
            router.setMatrix(effectSource.milkdropRoutingMatrix as any);
            mk.connectAudio(router.getOutput());
            effectCtx.milkdropStemRouter = router;
            effectCtx.milkdropAudioSource = 'stems';
            effectCtx.milkdropAudioAttached = true;
            console.log('[Canvas] Milkdrop → stem router');
          } else {
            const src = audioAnalyzer.getSourceNode();
            if (src) {
              mk.connectAudio(src);
              effectCtx.milkdropAudioSource = 'mono';
              effectCtx.milkdropAudioAttached = true;
              console.log('[Canvas] Milkdrop → mono source');
            } else {
              effectCtx.milkdropAudioAttached = false;
            }
          }
        } else if (wantStems && effectCtx.milkdropStemRouter) {
          // Source mode unchanged but matrix may have shifted — push
          // current matrix every frame; setTargetAtTime smooths it.
          effectCtx.milkdropStemRouter.setMatrix(effectSource.milkdropRoutingMatrix as any);
        } else if (wantSource === 'mono' && !effectCtx.milkdropAudioAttached) {
          const src = audioAnalyzer.getSourceNode();
          if (src) {
            mk.connectAudio(src);
            effectCtx.milkdropAudioAttached = true;
          }
        }

        // Push sensitivity each frame (cheap; no-op if unchanged in viz)
        mk.setSensitivity(effectSource.milkdropSensitivity ?? 1.5);

        // Preset pack load / pick-first-preset
        const wantPack = effectSource.milkdropPresetPack ?? 'minimal';
        if (effectCtx.milkdropPresetPack !== wantPack && _milkdropLoadPresetPack) {
          effectCtx.milkdropPresetPack = wantPack;
          // Fire-and-forget; once resolved, the next frame picks a preset.
          _milkdropLoadPresetPack(wantPack as any).then(presets => {
            effectCtx!.milkdropPresets = presets;
            effectCtx!.milkdropPresetNames = Object.keys(presets).sort();
            const first = _milkdropPickNextPreset!(presets, null);
            if (first) {
              mk.loadPreset(first, presets[first], 0);
              effectCtx!.milkdropLoadedPresetName = first;
              effectCtx!.milkdropLastEvolveAt = performance.now();
              if (layerId) milkdropStore.reportPreset(layerId, first);
            }
          }).catch(e => console.warn('[Canvas] milkdrop preset pack load failed', e));
        }

        const presets = effectCtx.milkdropPresets;
        const names = effectCtx.milkdropPresetNames ?? [];

        // ── Edge-triggered commands from the panel ─────────────────────
        if (layerId && presets && names.length > 0) {
          const cmd = milkdropStore['subscribe'] ? undefined : undefined; // no-op
          const state = get(milkdropStore);
          const latest = state.commands[layerId];
          if (latest && latest.tag !== effectCtx.milkdropLastCommandTag) {
            effectCtx.milkdropLastCommandTag = latest.tag;
            const curName = effectCtx.milkdropLoadedPresetName ?? null;
            let target: string | null = null;
            let cutBlend = blendTime;
            switch (latest.kind) {
              case 'next': {
                const idx = curName ? names.indexOf(curName) : -1;
                target = names[(idx + 1 + names.length) % names.length];
                break;
              }
              case 'prev': {
                const idx = curName ? names.indexOf(curName) : 0;
                target = names[(idx - 1 + names.length) % names.length];
                break;
              }
              case 'random': {
                target = _milkdropPickNextPreset ? _milkdropPickNextPreset(presets, curName) : null;
                break;
              }
              case 'cut': {
                // Pick a fresh random preset with zero blend (hard cut feel).
                target = _milkdropPickNextPreset ? _milkdropPickNextPreset(presets, curName) : null;
                cutBlend = 0;
                break;
              }
              case 'load': {
                if (latest.presetName && presets[latest.presetName]) target = latest.presetName;
                break;
              }
              // lock/unlock are state-only — handled in auto-evolve gate below
            }
            if (target && presets[target]) {
              mk.loadPreset(target, presets[target], cutBlend);
              effectCtx.milkdropLoadedPresetName = target;
              effectCtx.milkdropLastEvolveAt = performance.now();
              effectCtx.milkdropLastEvolveBeat = (getLastRawAnalysis()?.beat?.beatCount ?? 0);
              milkdropStore.reportPreset(layerId, target);
            }
          }
        }

        // Locked? Skip auto-evolve and hard-cut entirely.
        const lockedState = layerId ? get(milkdropStore).locked[layerId] : false;

        // Hard-cut on beat (independent of auto-evolve; fires on strong beats only)
        if (
          !lockedState &&
          presets && names.length > 0 &&
          (effectSource.milkdropHardCutEnabled ?? false)
        ) {
          const audio = getLastRawAnalysis();
          const beatIntensity = audio?.beat?.beatIntensity ?? 0;
          const threshold = effectSource.milkdropHardCutThreshold ?? 0.8;
          const now = performance.now();
          // 500ms refractory — at 140 BPM that's ~1.2 beats, so we cut once
          // per phrase-grade beat instead of every kick.
          const refractoryOk = (now - (effectCtx.milkdropLastHardCutAt ?? 0)) > 500;
          if (audio?.beat?.isBeat && beatIntensity >= threshold && refractoryOk && _milkdropPickNextPreset) {
            const next = _milkdropPickNextPreset(presets, effectCtx.milkdropLoadedPresetName ?? null);
            if (next) {
              mk.loadPreset(next, presets[next], 0);
              effectCtx.milkdropLoadedPresetName = next;
              effectCtx.milkdropLastHardCutAt = now;
              effectCtx.milkdropLastEvolveAt = now;
              effectCtx.milkdropLastEvolveBeat = audio.beat.beatCount;
              if (layerId) milkdropStore.reportPreset(layerId, next);
            }
          }
        }

        // Auto-evolve presets (timer or beat-sync). Pauses while locked.
        if (!lockedState && presets && (effectSource.milkdropAutoEvolve ?? true) && _milkdropPickNextPreset) {
          const mode = effectSource.milkdropEvolveMode ?? 1;
          let shouldEvolve = false;
          if (mode === 0) {
            const intervalMs = (effectSource.milkdropEvolveInterval ?? 22) * 1000;
            const lastAt = effectCtx.milkdropLastEvolveAt ?? 0;
            shouldEvolve = (performance.now() - lastAt) >= intervalMs;
          } else {
            const audio = getLastRawAnalysis();
            const beatCount = audio?.beat?.beatCount ?? 0;
            const bars = effectSource.milkdropEvolveBars ?? 8;
            const lastBeat = effectCtx.milkdropLastEvolveBeat ?? beatCount;
            if (effectCtx.milkdropLastEvolveBeat === undefined) {
              effectCtx.milkdropLastEvolveBeat = beatCount;
            }
            shouldEvolve = beatCount - lastBeat >= bars * 4;
          }
          if (shouldEvolve) {
            const next = _milkdropPickNextPreset(presets, effectCtx.milkdropLoadedPresetName ?? null);
            if (next) {
              mk.loadPreset(next, presets[next], blendTime);
              effectCtx.milkdropLoadedPresetName = next;
              if (layerId) milkdropStore.reportPreset(layerId, next);
            }
            effectCtx.milkdropLastEvolveAt = performance.now();
            effectCtx.milkdropLastEvolveBeat = (getLastRawAnalysis()?.beat?.beatCount ?? 0);
          }
        }

        mk.render(renderer, effectCtx.renderTarget);
      }

      // ── AudioMotion path ───────────────────────────────────────────────
      if (effectCtx.audiomotion && effectSource.effectType === 'audiomotion') {
        const am = effectCtx.audiomotion;
        if (effectCtx.renderTarget.width !== width || effectCtx.renderTarget.height !== height) {
          am.resize(width, height);
        }
        // Late-attach audio (same pattern as Milkdrop) — connect to the
        // shared source node as soon as the user starts mic/system audio.
        if (!effectCtx.audiomotionAudioAttached) {
          const src = audioAnalyzer.getSourceNode();
          if (src) {
            am.connectAudio(src);
            effectCtx.audiomotionAudioAttached = true;
            console.log('[Canvas] AudioMotion audio attached');
          }
        }
        am.setParams({
          mode: effectSource.audiomotionMode ?? 4,
          gradient: effectSource.audiomotionGradient ?? 'orangered',
          radial: effectSource.audiomotionRadial ?? false,
          barStyle: effectSource.audiomotionBarStyle ?? 'normal',
          peakLine: effectSource.audiomotionPeakLine ?? false,
          showPeaks: effectSource.audiomotionShowPeaks ?? true,
          mirror: effectSource.audiomotionMirror ?? 0,
          flipY: effectSource.audiomotionFlipY ?? false,
          reflexRatio: effectSource.audiomotionReflexRatio ?? 0,
          barSpace: effectSource.audiomotionBarSpace ?? 0.1,
          minFreq: effectSource.audiomotionMinFreq ?? 30,
          maxFreq: effectSource.audiomotionMaxFreq ?? 16000,
          sensitivity: effectSource.audiomotionSensitivity ?? 1,
          smoothing: effectSource.audiomotionSmoothing ?? 0.5,
          bgAlpha: effectSource.audiomotionBgAlpha ?? 1.0,
        });
        am.render(renderer, effectCtx.renderTarget);
      }

      // ── Analyzer Lab path ──────────────────────────────────────────────
      if (effectCtx.analyzerlab && effectSource.effectType === 'analyzerlab') {
        const al = effectCtx.analyzerlab;
        if (effectCtx.renderTarget.width !== width || effectCtx.renderTarget.height !== height) {
          al.resize(width, height);
        }
        al.setParams({
          layout:             effectSource.analyzerLabLayout             ?? 'stack',
          colormap:           effectSource.analyzerLabColormap           ?? 'inferno',
          spectroOrientation: effectSource.analyzerLabSpectroOrientation ?? 'horizontal',
          spectroGain:        effectSource.analyzerLabSpectroGain        ?? 1.0,
          spectroMinDb:       effectSource.analyzerLabSpectroMinDb       ?? -85,
          spectroMaxDb:       effectSource.analyzerLabSpectroMaxDb       ?? -25,
          scrollSpeed:        effectSource.analyzerLabScrollSpeed        ?? 1.0,
          chromaStyle:        effectSource.analyzerLabChromaStyle        ?? 'bars',
          chromaGlow:         effectSource.analyzerLabChromaGlow         ?? 0.5,
          waveStyle:          effectSource.analyzerLabWaveStyle          ?? 'line',
          waveLineWidth:      effectSource.analyzerLabWaveLineWidth      ?? 1.5,
          showBeats:          effectSource.analyzerLabShowBeats          ?? true,
          showLabels:         effectSource.analyzerLabShowLabels         ?? true,
          bgAlpha:            effectSource.analyzerLabBgAlpha            ?? 1.0,
        });
        al.render(renderer, effectCtx.renderTarget);
      }

      // ── HandFX path ────────────────────────────────────────────────────
      if (effectCtx.handfx && effectSource.effectType === 'handfx') {
        const hx = effectCtx.handfx;
        if (effectCtx.renderTarget.width !== width || effectCtx.renderTarget.height !== height) {
          hx.resize(width, height);
        }
        hx.setParams({
          mode:                effectSource.handfxMode                ?? 'trails',
          cameraOn:            effectSource.handfxCameraOn            ?? false,
          smoothing:           effectSource.handfxSmoothing           ?? 0.15,
          predictMs:           effectSource.handfxPredictMs           ?? 18,
          showHelp:            effectSource.handfxShowHelp            ?? true,
          bgAlpha:             effectSource.handfxBgAlpha             ?? 0.0,
          panelColor:          effectSource.handfxPanelColor          ?? '#FFFFFF',
          panelOpacity:        effectSource.handfxPanelOpacity        ?? 1.0,
          panelPadding:        effectSource.handfxPanelPadding        ?? 0.04,
          panelCornerRadius:   effectSource.handfxPanelCornerRadius   ?? 0.02,
          trailFade:           effectSource.handfxTrailFade           ?? 0.985,
          trailColorMode:      effectSource.handfxTrailColorMode      ?? 'rainbow',
          trailThickness:      effectSource.handfxTrailThickness      ?? 3,
          trailVelocityScale:  effectSource.handfxTrailVelocityScale  ?? 1.5,
          trailSparkDensity:   effectSource.handfxTrailSparkDensity   ?? 0.5,
          trailFlowStrength:   effectSource.handfxTrailFlowStrength   ?? 0.7,
          inkColorMode:        effectSource.handfxInkColorMode        ?? 'coral',
          inkSize:             effectSource.handfxInkSize             ?? 55,
          inkOpacity:          effectSource.handfxInkOpacity          ?? 0.28,
          inkDrift:            effectSource.handfxInkDrift            ?? 1.0,
          skeletonColor:       effectSource.handfxSkeletonColor       ?? '#FF6B6B',
          skeletonGlow:        effectSource.handfxSkeletonGlow        ?? 1.5,
          sprayColorMode:      effectSource.handfxSprayColorMode      ?? 'rainbow',
          sprayIntensity:      effectSource.handfxSprayIntensity      ?? 1.5,
          sprayThreshold:      effectSource.handfxSprayThreshold      ?? 0.25,
          showCamera:          effectSource.handfxShowCamera          ?? false,
          cameraOpacity:       effectSource.handfxCameraOpacity       ?? 0.5,
        });
        hx.render(renderer, effectCtx.renderTarget);
      }

      // ── Wave.js path ───────────────────────────────────────────────────
      if (effectCtx.wavejs && effectSource.effectType === 'wavejs') {
        const wj = effectCtx.wavejs;
        if (effectCtx.renderTarget.width !== width || effectCtx.renderTarget.height !== height) {
          wj.resize(width, height);
        }
        if (!effectCtx.wavejsAudioAttached) {
          const src = audioAnalyzer.getSourceNode();
          if (src) {
            wj.connectAudio(src);
            effectCtx.wavejsAudioAttached = true;
            console.log('[Canvas] Wave.js audio attached');
          }
        }
        wj.setParams({
          animation: effectSource.wavejsAnimation ?? 'Wave',
          sensitivity: effectSource.wavejsSensitivity ?? 1.5,
          lineWidth: effectSource.wavejsLineWidth ?? 4,
          colorA: effectSource.wavejsColorA ?? [1.0, 0.42, 0.42],
          colorB: effectSource.wavejsColorB ?? [1.0, 0.55, 0.30],
          useGradient: effectSource.wavejsUseGradient ?? true,
          gradientRotate: effectSource.wavejsGradientRotate ?? 0,
          glowStrength: effectSource.wavejsGlowStrength ?? 15,
          glowColor: effectSource.wavejsGlowColor ?? [1.0, 0.42, 0.42],
          bgAlpha: effectSource.wavejsBgAlpha ?? 1.0,
          flipY: effectSource.wavejsFlipY ?? false,
        });
        wj.render(renderer, effectCtx.renderTarget);
      }

      // ── Hydra path ─────────────────────────────────────────────────────
      if (effectCtx.hydra && effectSource.effectType === 'hydra') {
        const hy = effectCtx.hydra;
        const layerId = groupedLayers[0]?.id ?? '';
        effectCtx.hydraLayerId = layerId;

        if (effectCtx.renderTarget.width !== width || effectCtx.renderTarget.height !== height) {
          hy.resize(width, height);
        }

        // Apply param changes (sensitivity / sketch code)
        hy.setParams({
          sketchName: effectSource.hydraSketchName ?? 'Welcome',
          sketchCode: effectSource.hydraSketchCode ?? '',
          sensitivity: effectSource.hydraSensitivity ?? 1.5,
          bgAlpha: effectSource.hydraBgAlpha ?? 1.0,
        });

        // Edge-triggered commands from the HydraPanel
        if (layerId && _hydraPresetsMod) {
          const presets = _hydraPresetsMod.HYDRA_PRESETS;
          const pickNext = _hydraPresetsMod.pickNextHydraPreset;
          const state = get(hydraStore);
          const latest = state.commands[layerId];
          if (latest && latest.tag !== effectCtx.hydraLastCommandTag) {
            effectCtx.hydraLastCommandTag = latest.tag;
            const curName = effectCtx.hydraLoadedPresetName ?? null;
            let target = null as null | { name: string; code: string };
            switch (latest.kind) {
              case 'next': {
                const idx = curName ? presets.findIndex(p => p.name === curName) : -1;
                target = presets[(idx + 1 + presets.length) % presets.length];
                break;
              }
              case 'prev': {
                const idx = curName ? presets.findIndex(p => p.name === curName) : 0;
                target = presets[(idx - 1 + presets.length) % presets.length];
                break;
              }
              case 'random': target = pickNext(curName); break;
              case 'load': {
                if (latest.presetName) target = presets.find(p => p.name === latest.presetName) ?? null;
                break;
              }
            }
            if (target) {
              // Persist the swap on the layer's effectSource so panels +
              // saved projects see the right preset name on reload.
              for (const layer of groupedLayers) {
                if (layer.source?.effectSource) {
                  project.setLayerSource(layer.id, {
                    ...layer.source,
                    effectSource: {
                      ...layer.source.effectSource,
                      hydraSketchName: target.name,
                      hydraSketchCode: target.code,
                    },
                  });
                }
              }
              effectCtx.hydraLoadedPresetName = target.name;
              hydraStore.reportPreset(layerId, target.name);
            }
          }
          // Keep the store's current-preset display in sync on first load
          if (effectCtx.hydraLoadedPresetName && state.currentPreset[layerId] !== effectCtx.hydraLoadedPresetName) {
            hydraStore.reportPreset(layerId, effectCtx.hydraLoadedPresetName);
          }
        }

        hy.step(deltaTime, visual);
        hy.render(renderer, effectCtx.renderTarget);
      }

      // ── GhostFX path ───────────────────────────────────────────────────
      if (effectCtx.ghostfx && effectSource.effectType === 'ghostfx') {
        const fx = effectCtx.ghostfx;
        if (effectCtx.renderTarget.width !== width || effectCtx.renderTarget.height !== height) {
          fx.resize(width, height);
        }
        fx.setParams({
          scenePreset:        effectSource.ghostfxScenePreset        ?? 'drift',
          sensitivity:        effectSource.ghostfxSensitivity        ?? 1.4,
          hueDriftSpeed:      effectSource.ghostfxHueDriftSpeed      ?? 0.15,
          exposure:           effectSource.ghostfxExposure           ?? 0,
          bgAlpha:            effectSource.ghostfxBgAlpha            ?? 1.0,
          bloomIntensity:     effectSource.ghostfxBloomIntensity     ?? 1.4,
          bloomThreshold:     effectSource.ghostfxBloomThreshold     ?? 0.45,
          vignette:           effectSource.ghostfxVignette           ?? 0.7,
          vortexStrength:     effectSource.ghostfxVortexStrength     ?? 2.0,
          latticeThreshold:   effectSource.ghostfxLatticeThreshold   ?? 2.5,
          trailIntensity:     effectSource.ghostfxTrailIntensity     ?? 1.0,
          feedbackAmount:     effectSource.ghostfxFeedbackAmount     ?? 0.35,
          feedbackZoom:       effectSource.ghostfxFeedbackZoom       ?? 1.003,
          ribbonWidth:        effectSource.ghostfxRibbonWidth        ?? 0.10,
          ribbonSpawn:        effectSource.ghostfxRibbonSpawn        ?? 1.0,
          ribbonTranslucency: effectSource.ghostfxRibbonTranslucency ?? 0.35,
          ribbonBlend:        effectSource.ghostfxRibbonBlend        ?? 'additive',
          lightAzimuth:       effectSource.ghostfxLightAzimuth       ?? 35,
          lightElevation:     effectSource.ghostfxLightElevation     ?? 55,
          lightStrength:      effectSource.ghostfxLightStrength      ?? 0.9,
          ambient:            effectSource.ghostfxAmbient            ?? 0.30,
          liquidSplatForce:   effectSource.ghostfxLiquidSplatForce   ?? 1.0,
          liquidSplatRadius:  effectSource.ghostfxLiquidSplatRadius  ?? 0.08,
          liquidDyeDecay:     effectSource.ghostfxLiquidDyeDecay     ?? 0.995,
          liquidVelDecay:     effectSource.ghostfxLiquidVelDecay     ?? 0.992,
          liquidBassRate:     effectSource.ghostfxLiquidBassRate     ?? 1.0,
        });
        // Pass the raw AudioAnalysis through; GhostFX's internal
        // smoother + BPM-sync handle the "anticipate not react"
        // shaping. The shader never sees raw audio.
        fx.render(renderer, effectCtx.renderTarget, getLastRawAnalysis(), deltaTime);
      }

      // ── Ghost Pilot path ───────────────────────────────────────────────
      if (effectCtx.ghostpilot && effectSource.effectType === 'ghostpilot') {
        const gpv = effectCtx.ghostpilot;
        if (effectCtx.renderTarget.width !== width || effectCtx.renderTarget.height !== height) {
          gpv.resize(width, height);
        }
        gpv.setParams({
          sensitivity:  effectSource.ghostpilotSensitivity  ?? 1.4,
          speedScale:   effectSource.ghostpilotSpeedScale   ?? 1.0,
          hueBase:      effectSource.ghostpilotHueBase      ?? 0.0,
          autopilot:    effectSource.ghostpilotAutopilot    ?? true,
          steerAssist:  effectSource.ghostpilotSteerAssist  ?? 1.0,
        });
        // Reads the live gamepad internally each frame; audio builds the
        // world; deltaTime drives physics + verb scheduling.
        gpv.render(renderer, effectCtx.renderTarget, getLastRawAnalysis(), deltaTime);
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
        // handfx.dispose unsubscribes from mediaPipeSource so the camera
        // worker isn't holding a dead callback. We deliberately do NOT
        // mediaPipeSource.stop() here — the MediaPipePanel and other
        // gesture consumers may still be using it.
        disposeIntegratedEffectContext(effectCtx);
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
  // Native v2 primary driver. The browser canvas remains mounted for
  // interaction geometry and store synchronization, but it must not run
  // its own GPU shader/compositor image while the Rust/wgpu renderer is
  // the live graphics source.
  export let nativePrimary: boolean = false;
  export let nativePresenterSuspended: boolean = false;
  let nativeCorePreviewIsReady = false;
  let nativeEnginePendingVisible = false;
  let nativeEnginePendingTitle = '';
  let nativeEnginePendingDetail = '';
  $: {
    const previewSourceReady = $nativeRendererRuntime.readinessChecks
      ?.find((check) => check.id === 'native-editor-preview-frame-source')
      ?.ok === true;
    nativeCorePreviewIsReady = !!(
      nativePrimary
      && !isOutputMode
      && !isOsrMode
      && $nativeRendererRuntime.running
      && $nativeRendererRuntime.backendReady
      && $nativeRendererRuntime.sharedTextureOutputExportReady
      && previewSourceReady
    );
  }
  $: {
    const nativeRequested = nativePrimary && !isOutputMode && !isOsrMode;
    const layerCount = $layers.length;
    nativeEnginePendingVisible = nativeRequested && (layerCount === 0 || !nativeCorePreviewIsReady);
    nativeEnginePendingTitle = layerCount === 0
      ? 'Native engine ready'
      : 'Native engine starting';
    nativeEnginePendingDetail = layerCount === 0
      ? 'Create a native layer to start the core graph'
      : 'Native-only mode: waiting for core frame source';
  }
  $: if ((nativeEditorPreviewWindowEnabled || nativeEmbeddedPreviewEnabled) && nativeCorePreviewIsReady && !isOutputMode && !isOsrMode) {
    scheduleNativePreviewWindowSync('ready');
  }
  $: if (nativeEmbeddedPreviewEnabled && nativeCorePreviewIsReady && !isOutputMode && !isOsrMode) {
    // The editor presenter consumes the core's IOSurface while the projector
    // window presents the same composite through its own swapchain. They are
    // independent presentation sinks, so opening output must not blank or
    // detach the embedded editor preview.
    scheduleNativePreviewWindowSync('output-occlusion');
  }

  function nativePrimaryActive(): boolean {
    return nativeEngineRequested();
  }

  function nativeEngineRequested(): boolean {
    return nativePrimary && !isOutputMode && !isOsrMode;
  }

  function nativeCorePreviewActive(): boolean {
    return nativeCorePreviewIsReady;
  }

  function nativePreviewParentedActive(): boolean {
    if (!nativeCorePreviewActive()) return false;
    return get(nativeRendererRuntime).nativeEditorPreviewParented;
  }

  function browserEditorPreviewActive(): boolean {
    return !nativeEngineRequested();
  }

  function nativeEmbeddedPreviewActive(): boolean {
    return nativeEmbeddedPreviewEnabled
      && !nativePresenterSuspended
      && nativeCorePreviewActive()
      && nativeEmbeddedPresenterAttached;
  }

  function nativeEditorPreviewWindowActive(): boolean {
    return nativeEditorPreviewWindowEnabled && nativeCorePreviewActive();
  }

  function openAddLayerMenu(): void {
    window.dispatchEvent(new CustomEvent('ghost:open-add-layer-menu'));
  }

  function nativePreviewChromeOffsetY(): number {
    if (typeof window === 'undefined') return 0;
    const offset = Number(window.outerHeight || 0) - Number(window.innerHeight || 0);
    return Number.isFinite(offset) ? Math.max(0, Math.min(96, offset)) : 0;
  }

  function nativePreviewWindowRect(): { x: number; y: number; width: number; height: number } | null {
    if (!containerEl || typeof window === 'undefined') return null;
    const rect = containerEl.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width <= 1 || height <= 1) return null;
    return {
      x: Math.round(Number(window.screenX || 0) + rect.left),
      y: Math.round(Number(window.screenY || 0) + nativePreviewChromeOffsetY() + rect.top),
      width,
      height,
    };
  }

  // ── Splat mouse interaction feed ──
  // Publishes the pointer's normalized position over the native preview's
  // CONTENT rect (letterbox-aware). The sync packs it into the splat
  // uniforms so point clouds react to the mouse in native mode.
  function updateSplatPointerFromEvent(e: PointerEvent, down?: boolean) {
    const rect = nativePreviewEmbeddedRect();
    if (!rect || rect.contentWidth <= 2 || rect.contentHeight <= 2) {
      splatPointer.update((prev) => (prev.active ? { ...prev, active: false } : prev));
      return;
    }
    const nx = (e.clientX - rect.x - rect.contentX) / rect.contentWidth;
    const ny = (e.clientY - rect.y - rect.contentY) / rect.contentHeight;
    const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
    splatPointer.update((prev) => ({
      x: inside ? nx : prev.x,
      y: inside ? ny : prev.y,
      active: inside,
      down: down ?? prev.down,
    }));
  }
  function handleSplatPointerMove(e: PointerEvent) { updateSplatPointerFromEvent(e); }
  function handleSplatPointerDown(e: PointerEvent) { updateSplatPointerFromEvent(e, true); }
  function handleSplatPointerUp(e: PointerEvent) { updateSplatPointerFromEvent(e, false); }

  function nativePreviewEmbeddedRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
    contentX: number;
    contentY: number;
    contentWidth: number;
    contentHeight: number;
  } | null {
    if (typeof window === 'undefined') return null;
    // A fullscreen workspace (VJ mode, SynthVision performer) can claim the
    // presenter by registering its preview element; the underlay then tracks
    // that box instead of the editor viewport. Content letterboxes to the
    // project aspect inside the host box.
    const hostEl = get(nativePreviewHostEl);
    if (hostEl?.isConnected) {
      const host = hostEl.getBoundingClientRect();
      const hostWidth = Math.max(1, Math.round(host.width));
      const hostHeight = Math.max(1, Math.round(host.height));
      if (hostWidth > 4 && hostHeight > 4) {
        const proj = get(project);
        const projAspect = Math.max(0.001, (proj.width || 1920) / Math.max(1, proj.height || 1080));
        const hostAspect = hostWidth / hostHeight;
        const contentWidth = hostAspect > projAspect ? hostHeight * projAspect : hostWidth;
        const contentHeight = hostAspect > projAspect ? hostHeight : hostWidth / projAspect;
        return {
          x: Math.round(host.left),
          y: Math.round(host.top),
          width: hostWidth,
          height: hostHeight,
          contentX: (hostWidth - contentWidth) / 2,
          contentY: (hostHeight - contentHeight) / 2,
          contentWidth,
          contentHeight,
        };
      }
    }
    const geometry = publishEditorCanvasGeometry();
    if (!geometry) return null;
    const width = Math.max(1, geometry.clientWidth);
    const height = Math.max(1, geometry.clientHeight);
    if (width <= 1 || height <= 1) return null;
    return {
      x: geometry.clientX,
      y: geometry.clientY,
      width,
      height,
      contentX: 0,
      contentY: 0,
      contentWidth: width,
      contentHeight: height,
    };
  }

  function scheduleNativePreviewWindowSync(reason = 'schedule'): void {
    nativePreviewSyncQueuedReason = reason;
    if (nativePreviewSyncInFlight) {
      nativePreviewSyncQueued = true;
      return;
    }
    if (nativePreviewSyncRaf !== null || typeof requestAnimationFrame === 'undefined') return;
    nativePreviewSyncRaf = requestAnimationFrame(() => {
      nativePreviewSyncRaf = null;
      void syncNativePreviewWindow(nativePreviewSyncQueuedReason);
    });
  }

  async function syncNativePreviewWindow(reason = 'tick'): Promise<void> {
    if (nativePreviewSyncInFlight) {
      nativePreviewSyncQueued = true;
      nativePreviewSyncQueuedReason = reason;
      return;
    }
    nativePreviewSyncInFlight = true;
    try {
      await syncNativePreviewWindowNow(reason);
    } finally {
      nativePreviewSyncInFlight = false;
      if (nativePreviewSyncQueued) {
        nativePreviewSyncQueued = false;
        scheduleNativePreviewWindowSync(nativePreviewSyncQueuedReason);
      }
    }
  }

  async function syncNativePreviewWindowNow(reason = 'tick'): Promise<void> {
    if (!isElectron || isOutputMode || isOsrMode) return;
    const outputWindowOpen = !!get(settings)?.output?.outputWindowOpen;
    if (nativeEmbeddedPreviewEnabled) {
      if (nativePresenterSuspended || !nativeCorePreviewActive()) {
        if (nativeEmbeddedPresenterAttached || nativePreviewLastSignature) {
          nativeEmbeddedPresenterAttached = false;
          nativePreviewLastSignature = '';
          const reason = nativePresenterSuspended ? 'native-preview-suspended' : 'native-preview-inactive';
          await detachNativeEditorPreview(reason).catch(() => {});
        }
        return;
      }
      const rect = nativePreviewEmbeddedRect();
      if (!rect) return;
      const signature = `embedded:${rect.x},${rect.y},${rect.width}x${rect.height}:content=${rect.contentX.toFixed(2)},${rect.contentY.toFixed(2)},${rect.contentWidth.toFixed(2)}x${rect.contentHeight.toFixed(2)}`;
      // AppKit can adjust child-view geometry while a live resize is being
      // committed. Re-verify the acknowledged canvas rectangle periodically
      // even when the DOM signature is unchanged; normal animation frames
      // still avoid IPC between checks.
      const now = performance.now();
      const needsGeometryVerification = now - nativePreviewLastVerifiedAt >= 500;
      if (
        signature === nativePreviewLastSignature
        && nativeEmbeddedPresenterAttached
        && !needsGeometryVerification
      ) return;
      const requestRect = {
        ...rect,
        generation: ++nativePreviewRequestGeneration,
      };
      try {
        const status = nativeEmbeddedPresenterAttached
          ? await updateNativeEditorPreview(requestRect)
          : await attachNativeEditorPreview(requestRect);
        nativeEmbeddedPresenterAttached = !!status?.attached;
        if (nativeEmbeddedPresenterAttached && status?.geometryMatches === true) {
          nativePreviewLastSignature = signature;
          nativePreviewLastVerifiedAt = performance.now();
        } else {
          nativePreviewLastSignature = '';
          nativePreviewLastVerifiedAt = 0;
          scheduleNativePreviewWindowSync('geometry-retry');
        }
      } catch (err) {
        nativeEmbeddedPresenterAttached = false;
        nativePreviewLastSignature = '';
        nativePreviewLastVerifiedAt = 0;
        if ((window as any).__NATIVE_PREVIEW_DEBUG__) {
          console.warn('[NativePreview] failed to sync embedded native preview:', reason, err);
        }
      }
      return;
    }
    if (!nativeEditorPreviewWindowEnabled) {
      if (nativePreviewLastSignature && !outputWindowOpen) {
        nativePreviewLastSignature = '';
        await detachNativeRendererOutputWindow().catch(() => {});
      }
      return;
    }
    if (!nativeCorePreviewActive()) {
      if (nativePreviewLastSignature && !outputWindowOpen) {
        nativePreviewLastSignature = '';
        await detachNativeRendererOutputWindow().catch(() => {});
      }
      return;
    }
    if (outputWindowOpen) {
      nativePreviewLastSignature = '';
      return;
    }
    const rect = nativePreviewWindowRect();
    if (!rect) return;
    const parented = nativePreviewParentedActive();
    const signature = `${rect.x},${rect.y},${rect.width}x${rect.height}:${parented ? 'parented' : 'floating'}:underlay-probe`;
    if (signature === nativePreviewLastSignature) return;
    nativePreviewLastSignature = signature;
    await setNativeRendererOutputWindow({
      title: 'Ghost Arcade Native Preview',
      label: 'Ghost Arcade Native Preview',
      width: rect.width,
      height: rect.height,
      x: rect.x,
      y: rect.y,
      attached: true,
      visible: true,
      fullscreen: false,
      decorations: false,
      resizable: false,
      input_transparent: true,
      always_on_top: false,
      always_on_bottom: true,
      underlay: true,
    }).catch((err) => {
      nativePreviewLastSignature = '';
      if ((window as any).__NATIVE_PREVIEW_DEBUG__) {
        console.warn('[NativePreview] failed to sync native preview window:', reason, err);
      }
    });
  }

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

<div
  class="canvas-wrapper"
  class:output-mode={isOsrMode || isOutputMode}
  class:native-primary-source={nativePrimaryActive()}
  bind:this={wrapperEl}
>
  <div
    class="canvas-container"
    class:output-mode={isOsrMode || isOutputMode}
    class:native-primary-source={nativePrimaryActive()}
    bind:this={containerEl}
  >
    <canvas
      class="main-canvas"
      class:bridge-source={bridgeMode}
      class:native-primary-source={nativeEmbeddedPreviewEnabled && nativeCorePreviewIsReady}
      class:native-window-source={nativeEditorPreviewWindowActive()}
      bind:this={canvas}
    ></canvas>
    <!-- Edge blend + test pattern overlay -->
    <canvas class="output-overlay" bind:this={outputOverlayCanvas}></canvas>
    {#if nativeEnginePendingVisible}
      <div class="native-engine-pending">
        {#if $layers.length === 0}
          <div class="native-engine-pending__actions">
            <button type="button" onclick={openAddLayerMenu}>Add Layer to Get Started</button>
          </div>
        {:else}
          <div class="native-engine-pending__title">
            {nativeEnginePendingTitle}
          </div>
          <div class="native-engine-pending__detail">
            {nativeEnginePendingDetail}
          </div>
        {/if}
      </div>
    {/if}
    <!-- Mapping grid mount lives in App.svelte (sibling to both this
         Canvas and the WebGPU bridge) so it stays visible when
         experimental.editorWebGPU is on — WebGPUCanvas's overlay
         (z-index 10) otherwise paints over anything mounted inside
         .canvas-container. -->
    {#if $settings.output.blackout}
      <div class="blackout-overlay"></div>
    {/if}
    {#if isGpuDebugActive() && gpuDebugHudSnapshot && !isOutputMode && !isOsrMode}
      <div class="gpu-debug-hud" aria-hidden="true">
        <div class="gpu-debug-hud__top">
          <strong>GPU</strong>
          <span>{gpuDebugHudSnapshot.runtime?.quality ?? 'n/a'}</span>
          <span>{gpuDebugHudSnapshot.runtime?.qualityMode ?? 'auto'}</span>
        </div>
        <div class="gpu-debug-hud__grid">
          <span>avg</span>
          <b>{formatGpuMs(gpuDebugHudSnapshot.runtime?.governor?.averageMs)}</b>
          <span>scale</span>
          <b>{(gpuDebugHudSnapshot.runtime?.governor?.qualityScale ?? 1).toFixed(2)}</b>
          <span>pool</span>
          <b>{formatGpuBytes(gpuDebugHudSnapshot.runtime?.stats?.pooledBytes)}</b>
          <span>pipes</span>
          <b>{(gpuDebugHudSnapshot.runtime?.stats?.renderPipelinesCreated ?? 0) + (gpuDebugHudSnapshot.runtime?.stats?.computePipelinesCreated ?? 0)}</b>
        </div>
        {#if gpuDebugHudSnapshot.layers?.length}
          <div class="gpu-debug-hud__layers">
            {#each gpuDebugHudSnapshot.layers as layer (layer.id)}
              {@const graph = gpuLayerGraphStats(layer)}
              <div class="gpu-debug-hud__layer">
                <div class="gpu-debug-hud__layer-head">
                  <span>{layer.shaderId ?? 'shader'}</span>
                  <b>{graph.cpuMs}</b>
                </div>
                <div class="gpu-debug-hud__layer-body">
                  <span>{graph.passCount} passes</span>
                  <span>{gpuQualityAppliedSummary(layer)}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
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

  .canvas-wrapper.native-primary-source {
    background: transparent;
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

  .canvas-container.native-primary-source {
    background: transparent;
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

  .main-canvas {
    position: relative;
    z-index: 2;
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

  .main-canvas.native-primary-source {
    opacity: 0;
  }

  .main-canvas.native-window-source {
    opacity: 0;
  }

  .output-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 3;
  }

  .native-engine-pending {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: grid;
    place-content: center;
    gap: 8px;
    pointer-events: none;
    background:
      linear-gradient(135deg, rgba(20, 255, 240, 0.06), transparent 38%),
      rgba(0, 0, 0, 0.74);
    color: #e8fdff;
    text-align: center;
    font-family: inherit;
  }

  .native-engine-pending__title {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .native-engine-pending__detail {
    font-size: 12px;
    color: rgba(232, 253, 255, 0.68);
  }

  .native-engine-pending__actions {
    pointer-events: auto;
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 8px;
  }

  .native-engine-pending__actions button {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--ga-icon, #5278ff);
    border-radius: 2px;
    background: var(--ga-card, rgba(8, 18, 22, 0.88));
    color: var(--ga-ink-0, #eef0f4);
    font: 700 12px/1 var(--ga-font-ui, system-ui, sans-serif);
    cursor: pointer;
  }

  .native-engine-pending__actions button:hover {
    border-color: var(--ga-icon, #5278ff);
    background: var(--ga-blue-soft, rgba(82, 120, 255, 0.18));
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

  .gpu-debug-hud {
    position: absolute;
    left: 10px;
    top: 10px;
    z-index: 6;
    min-width: 220px;
    max-width: min(340px, calc(100% - 20px));
    padding: 10px;
    border: 1px solid rgba(74, 242, 255, 0.32);
    background: rgba(2, 6, 12, 0.86);
    color: #d9fbff;
    font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    pointer-events: none;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(10px);
  }

  .gpu-debug-hud__top,
  .gpu-debug-hud__layer-head,
  .gpu-debug-hud__layer-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .gpu-debug-hud__top {
    padding-bottom: 7px;
    border-bottom: 1px solid rgba(74, 242, 255, 0.18);
    color: #63f2ff;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .gpu-debug-hud__top strong,
  .gpu-debug-hud b {
    color: #ffffff;
    font-weight: 700;
  }

  .gpu-debug-hud__grid {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 4px 10px;
    padding-top: 8px;
  }

  .gpu-debug-hud__grid span,
  .gpu-debug-hud__layer-body {
    color: rgba(217, 251, 255, 0.62);
  }

  .gpu-debug-hud__layers {
    display: grid;
    gap: 6px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(74, 242, 255, 0.18);
  }

  .gpu-debug-hud__layer {
    padding: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
  }

  .gpu-debug-hud__layer-head span,
  .gpu-debug-hud__layer-body span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gpu-debug-hud__layer-body {
    margin-top: 3px;
    font-size: 10px;
  }
</style>
