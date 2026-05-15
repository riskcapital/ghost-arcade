<script lang="ts">
  /**
   * WebGPUCanvas — the strategic-default WebGL→WebGPU bridge surface.
   *
   * Mounted by App.svelte AS AN OVERLAY when
   * `experimental.editorWebGPU` is on (default TRUE in the GPU
   * edition) AND the WebGPU capability probe says supported. Sits on
   * top of Canvas.svelte (which is also mounted, in `bridgeMode`,
   * with its WebGL canvas hidden via opacity:0 but still being
   * painted by Chromium).
   *
   * ───────────────────────────────────────────────────────────────
   * THE BRIDGE, IN ONE LOOP:
   *
   *   Canvas.svelte (WebGL) renders the full editor scene to its
   *   hidden <canvas> as before
   *      ↓
   *   withExternalTexture(device, sourceCanvas, (extTex) => {...})
   *      • internally wraps the WebGL canvas in `new VideoFrame()`
   *      • internally calls device.importExternalTexture({...})
   *      • Chromium binds the GpuMemoryBuffer that backs the WebGL
   *        canvas as a sampleable WebGPU texture. Same-process,
   *        GPU-resident, zero CPU readback.
   *      • runs our render callback with the resulting external
   *        texture (fullscreen quad + paint drips + adv-lightpaint
   *        + stroke particles + per-layer pixel-fx renderers)
   *      • try/finally releases the frame at the end — guaranteed,
   *        even on early return or thrown exception. Without this,
   *        each leaked VideoFrame holds ~8MB at 1080p / ~33MB at 4K.
   *      ↓
   *   The visible WebGPU canvas — what the user sees AND what the
   *   output presenter captureStream's from for cross-window video.
   *
   * Net effect: editor visually identical to the WebGL-only path,
   * but the FINAL present surface is a WebGPU canvas. This unblocks
   * the migration roadmap — per-layer WebGPU renderers (paintDrip,
   * advPaint, strokeParticles, pixelFX) composite over the bridge
   * frame inside the same render pass, and over time more of the
   * scene migrates off WebGL.
   *
   * ───────────────────────────────────────────────────────────────
   * WHY OVERLAY (not nested / not replacement):
   *   - Canvas.svelte's WebGL logic stays untouched (25+ engine call
   *     sites, store subscriptions, mouse handlers, mapping UI).
   *     Only adds two minimal exports (getCanvas, bridgeMode).
   *   - DOM order: Canvas.svelte is in DOM, WebGPUCanvas is on top
   *     (z-index). `pointer-events: none` on the WebGPU layer lets
   *     all interactions fall through to Canvas.svelte's wrapper
   *     (mapping clicks, layer selection, etc.).
   *   - One device for the whole edition: ensureWebGPUDevice() is a
   *     singleton, so the bridge, gpuEffectRunner, paintDrip,
   *     advPaint, strokeParticles, and every pixel-fx renderer share
   *     ONE device — the only way they can share textures without
   *     CPU round-trip.
   *
   * ───────────────────────────────────────────────────────────────
   * RELATED: mid-chain GPU effects (gpuEffectRunner.ts) are now
   * DEMOTED to opt-in via `experimental.allowMidChainGpuEffects`
   * (default OFF). That runner does CPU-readback because it has to
   * bridge mid-WebGL-chain — no public API gives us a zero-copy
   * import at an arbitrary point in a WebGL effect chain. This
   * downstream-compositor bridge runs ONCE per frame AFTER the WebGL
   * chain is fully composited, which is the only spot where
   * `new VideoFrame(canvas)` gets us the GpuMemoryBuffer for free.
   *
   * See docs/WEBGPU_MIGRATION.md for the full roadmap.
   */
  import { onMount, onDestroy } from 'svelte';
  import { isWebGPUSupported, probeWebGPU } from '$lib/renderer/webgpuCapability';
  import { registerEditorCanvas, stopOutputSharedTexturePresenter, setOutputCursor, setOutputCursorStyle } from '$lib/sync/outputSharedTexturePresenter';
  import { settings } from '$lib/stores/settings';
  import { WebGPUPaintDrip } from '$lib/renderer/webgpuPaintDrip';
  import { WebGPUAdvLightPaint } from '$lib/renderer/webgpuAdvLightPaint';
  import { WebGPUStrokeParticles, collectGPUStrokes } from '$lib/renderer/webgpuStrokeParticles';
  import { WebGPUPixelParticles } from '$lib/renderer/webgpuPixelParticles';
  // Dedicated renderer for pixel-fx layers in `flythrough` mode.
  // Routed separately from the standard WebGPUPixelParticles because
  // its camera model (auto-advancing Z accumulator), particle topology
  // (worm strokes / billboard points), and slab-replication draw call
  // are different enough that bolting them into PixelParticles would
  // bloat that class. See `webgpuFlythrough.ts` for the full design
  // notes.
  import { WebGPUFlythrough } from '$lib/renderer/webgpuFlythrough';
  import { ensureWebGPUDevice } from '$lib/renderer/webgpuShared';
  // Zero-copy WebGL→WebGPU primitive. Wraps `new VideoFrame()` +
  // `device.importExternalTexture()` in a try/finally so the
  // GpuMemoryBuffer underlying the frame is always released — a
  // missed `.close()` here would leak ~8MB per frame at 1080p
  // and ~33MB per frame at 4K. Every bridge site in the GPU
  // edition routes through this helper now; see
  // `lib/utils/videoFrameBridge.ts` for the leak counter + the
  // compute-path blit helper.
  import { withExternalTexture, checkVideoFrameLeaks } from '$lib/utils/videoFrameBridge';
  import { mediaLibrary } from '$lib/stores/media';
  import { audioBands } from '$lib/stores/audio';
  import { project, selectedLayer } from '$lib/stores/layers';
  import { get as getStore } from 'svelte/store';
  // Cheap synchronous read of the project store from inside the
  // animation frame loop — re-reading is cost-free (stores cache
  // their last value). Used by the GPU stroke particle pass below
  // so progress can advance even when the store didn't change.
  const getProjectSync = () => getStore(project);
  import type { AdvLightPaintingContent } from '$lib/types';

  // Source canvas reference. Set via setSourceCanvas() from App.svelte
  // AFTER both Canvas.svelte and this component have mounted (because
  // Canvas's bind:this getCanvas() doesn't return a non-null value
  // until ITS own onMount completes — a Svelte prop wouldn't propagate
  // that mutation reliably). Imperative setter keeps the timing
  // explicit and race-free.
  let sourceCanvas: HTMLCanvasElement | null = null;

  /** App.svelte calls this AFTER both components mount with the
   *  WebGL canvas DOM element from Canvas.svelte's getCanvas(). The
   *  bridge presenter starts the moment a non-null source is set
   *  (and WebGPU init is done). Idempotent on the same canvas. */
  export function setSourceCanvas(c: HTMLCanvasElement | null): void {
    sourceCanvas = c;
    if (c && (initStatus === 'no-source' || initStatus === 'init')) {
      initStatus = 'running';
    }
  }

  // Match Canvas.svelte's mount-mode flags so behaviour stays
  // consistent. WebGPU bridge only makes sense in editor mode
  // (output / OSR windows have their own WebGPU pipelines).
  const isOutputMode = !!(window as any).__OUTPUT_WINDOW_MODE__;
  const isOsrMode = !!(window as any).__SPOUT_OSR_MODE__;

  // Visible canvas — what the user (and captureStream) sees.
  let presentCanvas: HTMLCanvasElement;
  let wrapperEl: HTMLDivElement;

  // WebGPU resources
  let gpu: any = null;
  let adapter: any = null;
  let device: any = null;
  let canvasContext: any = null;
  let preferredFormat: any = null;
  let pipeline: any = null;
  let sampler: any = null;
  let bindGroupLayout: any = null;

  let initStatus: 'init' | 'no-webgpu' | 'no-source' | 'running' | 'error' = 'init';
  let initError = '';
  let disposed = false;
  let rafId: number | null = null;

  // Latest snapshot of the audio analyzer bands — kept in module
  // scope so the per-frame flythrough loop can read it synchronously
  // without re-subscribing per layer. Updated inside the audioBands
  // subscription below. Null until the analyzer ticks once.
  let lastAudioBands: { bass: number; mid: number; treble: number } | null = null;

  // Phase 3.1 showcase: WebGPU compute-shader paint drip system.
  // Mounted after WebGPU init succeeds; runs an additive overlay
  // pass on top of the bridge frame each tick. Defaults OFF now —
  // it's a "press D to play" extra. The proper feature is the new
  // adv-lightpaint layer type below.
  let paintDrip: WebGPUPaintDrip | null = null;
  let paintEnabled = false;
  let audioUnsub: (() => void) | null = null;

  // Phase 3.2 feature: 3D physics-driven WebGPU paint with brush
  // presets (drip / water / smoke / plasma / shader). Renders
  // whenever an `adv-lightpaint` layer exists in the project. When
  // such a layer is SELECTED, mouse drag spawns particles into it.
  let advPaint: WebGPUAdvLightPaint | null = null;
  let advPaintLayerCount = 0;        // count of adv-lightpaint layers in current project
  let advPaintActiveContent: AdvLightPaintingContent | null = null;
  let advPaintSelected = false;      // true when an adv-lightpaint layer is the selectedLayer
  let projectUnsub: (() => void) | null = null;
  let selectedLayerUnsub: (() => void) | null = null;

  // Light Painting GPU brushes — spiral / firefly / sap-flow.
  // Reads strokes from Light Painting layers in the project, runs a
  // compute pass per frame, renders particles additively over the
  // bridge frame. setStrokes() is hash-keyed so re-uploads only
  // happen when the user adds/edits/removes a GPU-brush stroke.
  let strokeParticles: WebGPUStrokeParticles | null = null;
  // Per-layer pixel-fx renderers, keyed by layer id. Each pixel-fx
  // layer gets its own WebGPUPixelParticles instance so they don't
  // step on each other's source textures or particle buffers.
  // Layers are torn down when their layer is removed; new ones
  // created lazily on first reference each frame.
  const pixelFXRenderers = new Map<string, WebGPUPixelParticles>();
  // Parallel map for layers whose mode is `flythrough` — routes to
  // the dedicated WebGPUFlythrough renderer. We keep a separate map
  // (rather than a single Map<string, any>) so the per-renderer
  // setter API stays statically typed and the GC behaviour of the
  // two renderer families stays predictable.
  const flythroughRenderers = new Map<string, WebGPUFlythrough>();
  // Tracks which layer the flythrough renderer's source was last
  // loaded from, so we don't re-decode the source image / re-bind
  // the video element every frame when nothing changed.
  const flythroughLoadedSourceKey = new Map<string, string | null>();
  // Tracks which sourceUrl we last loaded per layer so we can detect
  // changes and re-import the texture without re-doing it every frame.
  const pixelFXLoadedSourceUrl = new Map<string, string | null>();
  // Per-layer cached <video> element. Videos can't load via Image()
  // — we hold our own muted+looped+playsInline element and pump
  // frames into the GPU texture each render. Reused across source
  // changes so we don't churn video decoders.
  const pixelFXVideoEl = new Map<string, HTMLVideoElement>();
  // Per-layer last src loaded into our cached video element. Lets
  // us avoid re-setting src (which restarts playback) when nothing
  // changed.
  const pixelFXVideoSrc = new Map<string, string>();

  /** Get-or-create the cached <video> element for a pixel-fx layer.
   *  Configures it for autoplay+loop+muted (Chromium needs muted to
   *  honour autoplay without user gesture). The returned element
   *  may not yet have a frame; callers should let updateSourceFromVideo
   *  no-op until readyState >= 2. */
  function ensurePixelFXVideo(layerId: string, src: string): HTMLVideoElement {
    let v = pixelFXVideoEl.get(layerId);
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.autoplay = true;
      v.crossOrigin = /^https?:/i.test(src) ? 'anonymous' : null;
      pixelFXVideoEl.set(layerId, v);
    }
    if (pixelFXVideoSrc.get(layerId) !== src) {
      v.src = src;
      pixelFXVideoSrc.set(layerId, src);
      // Best-effort play. If the user hasn't gestured yet some
      // browsers reject the play() promise — we ignore because the
      // muted+autoplay combo is allowed to start anyway.
      v.play().catch(() => { /* will start when playback policy allows */ });
    }
    return v;
  }
  // Output cursor: when settings.output.outputShowCursor is on, the
  // mouse position over the editor canvas is forwarded to the output
  // window via the existing MessagePort, where it renders as a CSS
  // crosshair overlay. Subscribed in onMount; updated by mousemove.
  let outputShowCursor = false;
  let settingsUnsub: (() => void) | null = null;
  // Spawn position is in normalized canvas coordinates 0..1. Updated
  // by window mousemove handlers below — we listen on window rather
  // than the wrapper so the pointer-events: none doesn't block us.
  let mouseSpawnU = 0.5;
  let mouseSpawnV = 0.5;
  let mouseDown = false;

  // Stats
  let framesPresented = 0;
  let framesSkipped = 0;
  let lastFrameAt = 0;
  let fpsEMA = 0;
  let renderTimeUsEMA = 0;
  let lastFrameDim = '';

  // Pass-through WGSL shader. No transform / colour correction here
  // — those are still done by Canvas.svelte's WebGL composite. The
  // bridge job is "show this canvas exactly as it is" so the output
  // is visually identical to the WebGL-only path. Phase 3.x will
  // add a real compositor with WGSL blend modes; THIS shader is
  // intentionally trivial so it doesn't introduce visual diffs vs
  // the WebGL path.
  const SHADER_WGSL = /* wgsl */ `
@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_external;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );
  var out: VSOut;
  out.clip = vec4<f32>(positions[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  return textureSampleBaseClampToEdge(uTexture, uSampler, in.uv);
}
`;

  /** API parity with Canvas.svelte for App.svelte's canvasComponent
   *  ref. Phase 3.0: returns null because WebGPUCanvas is OVERLAID
   *  on Canvas.svelte rather than replacing it; downstream callers
   *  that want the engine should keep calling Canvas.svelte's
   *  getEngine() (App.svelte routes to the right component). */
  export function getEngine(): null { return null; }

  export function getContainerRect(): { x: number; y: number; width: number; height: number } {
    if (!presentCanvas || !wrapperEl) return { x: 0, y: 0, width: 0, height: 0 };
    const r = presentCanvas.getBoundingClientRect();
    const wr = wrapperEl.getBoundingClientRect();
    return { x: r.left - wr.left, y: r.top - wr.top, width: r.width, height: r.height };
  }

  async function initWebGPU(): Promise<void> {
    // ── Drop any stale per-layer GPU renderers from a previous
    // device. HMR + device-lost both trigger re-init; per-layer
    // pixel-fx renderers were lazily created against the old device
    // and would silently no-op against it. Clearing forces them to
    // be re-created against the new device on the next frame.
    for (const r of pixelFXRenderers.values()) { try { r.dispose?.(); } catch { /* */ } }
    pixelFXRenderers.clear();
    pixelFXLoadedSourceUrl.clear();
    // Flythrough renderers — same lifecycle as the standard pixel-fx
    // ones above; they reference the device and must die with it.
    for (const r of flythroughRenderers.values()) { try { r.dispose?.(); } catch { /* */ } }
    flythroughRenderers.clear();
    flythroughLoadedSourceKey.clear();
    for (const v of pixelFXVideoEl.values()) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* */ } }
    pixelFXVideoEl.clear();
    pixelFXVideoSrc.clear();

    const supported = await probeWebGPU();
    if (!supported || !isWebGPUSupported()) {
      initStatus = 'no-webgpu';
      initError = 'WebGPU unavailable in this Electron build';
      console.error('[WebGPUCanvas] ' + initError);
      return;
    }
    gpu = (navigator as any).gpu;
    try {
      // Use the shared WebGPU device so the bridge presenter, the
      // GPU effect runner, and all the other compute renderers
      // (paintDrip, advPaint, strokeParticles, pixel-fx) talk to
      // ONE device. That's the only way they can share textures
      // without going through the CPU.
      const shared = await ensureWebGPUDevice();
      device = shared.device;
      adapter = shared.adapter;
      preferredFormat = shared.presentFormat;
      canvasContext = presentCanvas.getContext('webgpu');
      if (!canvasContext) throw new Error('getContext("webgpu") returned null');
      canvasContext.configure({
        device,
        format: preferredFormat,
        alphaMode: 'opaque',
        colorSpace: 'srgb',
      });

      const shaderModule = device.createShaderModule({ code: SHADER_WGSL });
      bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: preferredFormat }] },
        primitive: { topology: 'triangle-list' },
      });
      sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      // Phase 3.1: instantiate the paint-drip particle showcase.
      // Failure here is non-fatal — bridge still works, just no
      // particles. Logs the error and continues.
      try {
        paintDrip = await WebGPUPaintDrip.create(device, preferredFormat);
      } catch (err: any) {
        console.error('[WebGPUCanvas] paint drip init failed (non-fatal):', err?.message || err);
        paintDrip = null;
      }

      // Phase 3.2: 3D adv-lightpaint compute renderer. Same
      // failure semantics — non-fatal, the bridge keeps working.
      try {
        advPaint = await WebGPUAdvLightPaint.create(device, preferredFormat);
      } catch (err: any) {
        console.error('[WebGPUCanvas] adv-lightpaint init failed (non-fatal):', err?.message || err);
        advPaint = null;
      }

      // Light Painting GPU brushes — compute particles bound to
      // user-drawn strokes (spiral/firefly/sap-flow). Failure is
      // non-fatal; the rest of the editor keeps working.
      try {
        strokeParticles = await WebGPUStrokeParticles.create(device, preferredFormat);
      } catch (err: any) {
        console.error('[WebGPUCanvas] stroke particles init failed (non-fatal):', err?.message || err);
        strokeParticles = null;
      }

      initStatus = sourceCanvas ? 'running' : 'no-source';
      console.log('[WebGPUCanvas] WebGPU initialised. Adapter:',
        (adapter as any).info?.description || 'unknown');
    } catch (err: any) {
      initStatus = 'error';
      initError = `WebGPU init failed: ${err?.message || err}`;
      console.error('[WebGPUCanvas] ' + initError, err);
    }
  }

  function presentFrame(): void {
    if (!sourceCanvas || !device || !pipeline || !canvasContext) {
      framesSkipped++;
      return;
    }
    // Resize the present canvas backing store to match the source
    // canvas dimensions. The source canvas is at project resolution
    // (e.g. 1920x1080) — we present at the same. CSS scales the
    // visible rect to the wrapper's letterboxed size.
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    if (sw > 0 && sh > 0 && (presentCanvas.width !== sw || presentCanvas.height !== sh)) {
      presentCanvas.width = sw;
      presentCanvas.height = sh;
    }
    if (!sw || !sh) { framesSkipped++; return; }
    lastFrameDim = `${sw}x${sh}`;

    // The whole render pass runs inside withExternalTexture()'s
    // callback so the VideoFrame's lifetime brackets ALL of our GPU
    // work for this frame. The helper handles construction,
    // importExternalTexture, and the try/finally close — see
    // lib/utils/videoFrameBridge.ts for the leak counter wiring.
    // Returns undefined if VideoFrame construction fails (e.g.
    // sourceCanvas became 0×0 mid-frame, context-loss recovery, etc.)
    // — we just skip the frame in that case.
    const t0 = performance.now();
    // Track whether the frame actually made it through to queue.submit
    // — the helper internally returns undefined on a VideoFrame
    // construction failure (silent skip; common during canvas resize
    // + context-loss recovery), and our callback's inner try/catch
    // logs loudly on GPU-encoding errors. Either way `presentSucceeded`
    // ends up false and we bump the skip counter once at the end.
    let presentSucceeded = false;
    withExternalTexture(device, sourceCanvas, (externalTexture) => {
      try {
        const bindGroup = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: externalTexture },
          ],
        });
      const encoder = device.createCommandEncoder();
      const view = canvasContext.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6, 1, 0, 0);
      pass.end();

      // Phase 3.1 paint drip overlay (D-key showcase). Default OFF
      // now — only runs when user hits D explicitly. Routes mouse
      // input only when no adv-lightpaint layer is selected (so the
      // two systems don't double-spawn).
      if (paintDrip && paintEnabled && !advPaintSelected) {
        paintDrip.setSpawnPosition(mouseSpawnU, mouseSpawnV, mouseDown);
        paintDrip.setViewport(presentCanvas.width, presentCanvas.height);
        paintDrip.encodeFrame(encoder, view);
      }

      // Phase 3.2 adv-lightpaint compute renderer. Active any time
      // an adv-lightpaint layer exists in the project; mouse drives
      // it only when one is SELECTED (so adding a layer + selecting
      // a different layer keeps the existing drips animating without
      // accidental new spawns).
      if (advPaint && advPaintActiveContent && advPaintLayerCount > 0) {
        advPaint.setSpawnPosition(mouseSpawnU, mouseSpawnV, mouseDown && advPaintSelected);
        advPaint.setViewport(presentCanvas.width, presentCanvas.height);
        advPaint.encodeFrame(encoder, view);
      }

      // Light Painting GPU brushes (spiral/firefly/sap-flow) — runs
      // when the project has any Light Painting layer with at least
      // one GPU-brush stroke. Particles are bound to the strokes the
      // user drew via the Light Painting tool; the compute pass
      // animates them per frame. Renders additively over the bridge
      // frame.
      //
      // Per-frame: re-collect strokes (cheap; setStrokes is hash-
      // keyed so it's a no-op when nothing immutable changed) AND
      // push current progress values (for the drawing-head animation
      // — particles "draw on" as the layer's playback timeline runs).
      if (strokeParticles) {
        const proj = getProjectSync();
        if (proj) {
          const lpLayers = proj.layers
            .filter((l) => l.type === 'lightpainting')
            .map((l) => ({ id: l.id, visible: l.visible, lightPaintingContent: l.lightPaintingContent }));
          const { strokes: gpuStrokes, progresses } = collectGPUStrokes(lpLayers);
          strokeParticles.setStrokes(gpuStrokes);
          strokeParticles.updateProgresses(progresses);
        }
        strokeParticles.setViewport(presentCanvas.width, presentCanvas.height);
        strokeParticles.encodeFrame(encoder, view);
      }

      // ── Pixel-FX layers ──
      // Each pixel-fx layer has its own WebGPUPixelParticles instance,
      // owns its source texture + particle buffer, and renders in
      // layer-stack order over the bridge frame. Per-layer state
      // (mode, knobs, source) is read from the project store each
      // frame and reconciled into the renderer's setters.
      const proj = getProjectSync();
      if (proj && device) {
        // Find/create renderers for visible pixel-fx layers and tear
        // down any whose layers no longer exist.
        const visiblePxLayers = proj.layers.filter(
          (l) => l.type === 'pixel-fx' && l.visible && l.pixelFXContent != null,
        );
        const liveIds = new Set(visiblePxLayers.map((l) => l.id));
        for (const [id, r] of pixelFXRenderers) {
          if (!liveIds.has(id)) {
            try { r.dispose?.(); } catch { /* */ }
            pixelFXRenderers.delete(id);
            pixelFXLoadedSourceUrl.delete(id);
            // Pause + release the cached video so the decoder can be
            // reclaimed.
            const v = pixelFXVideoEl.get(id);
            if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* */ } }
            pixelFXVideoEl.delete(id);
            pixelFXVideoSrc.delete(id);
          }
        }
        // Mirror reap for the flythrough renderer map — same liveIds
        // set drives both. A layer that toggles mode away from
        // flythrough also gets its flythrough renderer reclaimed here
        // (its id will still be in `liveIds`, but the per-layer branch
        // below will skip the flythrough path and the renderer sits
        // idle — we reap it below when the mode-flip is detected).
        for (const [id, r] of flythroughRenderers) {
          if (!liveIds.has(id)) {
            try { r.dispose?.(); } catch { /* */ }
            flythroughRenderers.delete(id);
            flythroughLoadedSourceKey.delete(id);
          }
        }
        for (const layer of visiblePxLayers) {
          const c = layer.pixelFXContent!;

          // ── Flythrough mode early-branch ─────────────────────────
          // Layers in `flythrough` mode are handled by the dedicated
          // WebGPUFlythrough renderer rather than WebGPUPixelParticles.
          // Self-contained: resolves source, creates the renderer if
          // needed, applies params, encodes the frame, then `continue`s
          // past the standard pixel-fx code. Mode-flip handling: if the
          // user switches a layer's mode away from flythrough, the
          // existing flythrough renderer for that layer is disposed
          // here so its GPU resources don't leak. The reverse case
          // (flipping INTO flythrough) is handled by the lazy-create
          // below + the standard-mode renderer being disposed by its
          // own loop (it'll see the mode change next frame).
          if (c.mode === 'flythrough') {
            // Tear down the standard-mode renderer if it exists — the
            // user just flipped this layer into flythrough mode.
            const stale = pixelFXRenderers.get(layer.id);
            if (stale) {
              try { stale.dispose?.(); } catch { /* */ }
              pixelFXRenderers.delete(layer.id);
              pixelFXLoadedSourceUrl.delete(layer.id);
            }

            // Lazy-create the flythrough renderer for this layer.
            let fly = flythroughRenderers.get(layer.id);
            if (!fly) {
              try {
                fly = new WebGPUFlythrough(device, preferredFormat);
                flythroughRenderers.set(layer.id, fly);
              } catch (err: any) {
                console.error('[flythrough] init failed for layer', layer.id, err?.message || err);
                continue;
              }
            }

            // ── Source resolution (mirrors the standard-mode logic
            // immediately below; kept inline so the two paths can
            // evolve independently without one breaking the other).
            const loadImageOnceFly = (src: string, cacheKey: string, label: string) => {
              if (cacheKey === flythroughLoadedSourceKey.get(layer.id)) return;
              flythroughLoadedSourceKey.set(layer.id, cacheKey);
              const img = new Image();
              if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
              img.onload = () => { fly!.setSourceImage(img).catch(e => console.warn('[flythrough]', label, 'setSourceImage failed', e)); };
              img.onerror = (e) => console.warn('[flythrough]', label, 'image load failed for', src, e);
              img.src = src;
            };

            if (c.sourceType === 'media' && c.sourceMediaId) {
              const items = getStore(mediaLibrary);
              const item = items.find((m: any) => m.id === c.sourceMediaId);
              if (item && item.type === 'video') {
                const vid: HTMLVideoElement | undefined = item.videoElement || (item.src ? ensurePixelFXVideo(layer.id, item.src) : undefined);
                if (vid) fly.updateSourceFromVideo(vid);
              } else if (item && item.src) {
                loadImageOnceFly(item.src, `media:${item.id}:${item.src}`, 'media-library');
              }
            } else if (c.sourceType === 'layer' && c.sourceLayerId) {
              const sourceLayer = proj.layers.find((l) => l.id === c.sourceLayerId);
              if (sourceLayer && sourceLayer.source) {
                const ms = sourceLayer.source;
                const vid: HTMLVideoElement | undefined = (ms as any).videoElement
                  || (ms.type === 'video' && ms.src ? ensurePixelFXVideo(layer.id, ms.src) : undefined);
                if (vid) {
                  fly.updateSourceFromVideo(vid);
                  flythroughLoadedSourceKey.set(layer.id, `layer:${c.sourceLayerId}:video`);
                } else if (ms.src) {
                  loadImageOnceFly(ms.src, `layer:${c.sourceLayerId}:${ms.src}`, 'layer-source');
                }
              }
            } else if (c.sourceUrl) {
              const isVideo = c.sourceType === 'video';
              const cacheKey = `file:${c.sourceUrl}`;
              if (isVideo) {
                const v = ensurePixelFXVideo(layer.id, c.sourceUrl);
                fly.updateSourceFromVideo(v);
                flythroughLoadedSourceKey.set(layer.id, cacheKey);
              } else {
                loadImageOnceFly(c.sourceUrl, cacheKey, 'file');
              }
            }

            // Apply per-frame parameters. The renderer hashes nothing
            // internally — every frame we just set the current values.
            //
            // Audio reactivity (when `flythroughAudioReactive` is on):
            //   bass   → boosts fly speed (kick = forward burst)
            //   treble → boosts flow strength (high freq = swirl chaos)
            // The configured baselines stay the "silence" values; the
            // bands ADD to them rather than replace them, so the layer
            // never goes static when the music drops out. Both bands
            // are 0..1 normalized from the audio analyzer.
            const baseFlySpeed = c.flythroughFlySpeed ?? 0.8;
            const baseFlowStrength = c.flythroughFlowStrength ?? 0.4;
            const reactive = c.flythroughAudioReactive && lastAudioBands;
            const audioFlySpeed = reactive
              ? baseFlySpeed * (1 + lastAudioBands!.bass * 1.8)
              : baseFlySpeed;
            const audioFlowStrength = reactive
              ? baseFlowStrength * (1 + lastAudioBands!.treble * 1.5)
              : baseFlowStrength;

            fly.setParams({
              topology: c.flythroughTopology ?? 'strokes',
              depthSource: c.flythroughDepthSource ?? 'luminance',
              flySpeed: audioFlySpeed,
              tunnelDepth: c.flythroughTunnelDepth ?? 2.0,
              slabCount: c.flythroughSlabCount ?? 4,
              flowStrength: audioFlowStrength,
              flowScale: c.flythroughFlowScale ?? 2.0,
              anchorPull: c.flythroughAnchorPull ?? 1.2,
              strokeLength: c.flythroughStrokeLength ?? 0.08,
              strokeWidth: c.flythroughStrokeWidth ?? 0.006,
              depthStrength: c.flythroughDepthStrength ?? 0.5,
              baseSize: c.baseSize ?? 0.005,
              opacity: (c.opacity ?? 1) * (layer.opacity ?? 1),
              fovDeg: c.fovDeg ?? 50,
              cameraYaw: c.cameraYaw ?? 0,
              cameraPitch: c.cameraPitch ?? 0,
              particleCount: c.particleCount ?? 250_000,
            });
            fly.setBlendMode(layer.blendMode || 'add');
            fly.setViewport(presentCanvas.width, presentCanvas.height);
            fly.encodeFrame(encoder, view);
            continue;
          }

          let renderer = pixelFXRenderers.get(layer.id);
          if (!renderer) {
            // Lazy create — first frame for this layer. Failures are
            // non-fatal; the rest of the canvas keeps rendering.
            try {
              renderer = new (WebGPUPixelParticles as any)(device, preferredFormat);
              pixelFXRenderers.set(layer.id, renderer!);
            } catch (err: any) {
              console.error('[pixel-fx] init failed for layer', layer.id, err?.message || err);
              continue;
            }
          }
          renderer = renderer!;
          // ── Source resolution ──
          // Three source paths, in priority order:
          //   sourceType === 'media': pull from a Media Library item
          //     by id. Same items the Media Tray shows. Most common
          //     path — items already loaded into the project library.
          //   sourceType === 'layer': pull from another layer's media
          //     (image src or videoElement). Use when you've
          //     configured trim/playback on a media layer and want
          //     the pixel-fx to inherit it.
          //   else: load from sourceUrl (one-off file picker).
          // Videos are pumped per frame for live playback; images
          // load once per source change (cache-keyed).
          // Helper: load a still image into the renderer (one-time
          // per source change). Images that fail to decode are
          // logged but do not block the rest of the pipeline.
          const loadImageOnce = (src: string, cacheKey: string, label: string) => {
            if (cacheKey === pixelFXLoadedSourceUrl.get(layer.id)) return;
            pixelFXLoadedSourceUrl.set(layer.id, cacheKey);
            const img = new Image();
            if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
            img.onload = () => { renderer!.setSourceImage(img).catch(e => console.warn('[pixel-fx]', label, 'setSourceImage failed', e)); };
            img.onerror = (e) => console.warn('[pixel-fx]', label, 'image load failed for', src, e);
            img.src = src;
          };

          if (c.sourceType === 'media' && c.sourceMediaId) {
            const items = getStore(mediaLibrary);
            const item = items.find((m: any) => m.id === c.sourceMediaId);
            if (!item) {
              const cacheKey = `media:${c.sourceMediaId}:not-found`;
              if (cacheKey !== pixelFXLoadedSourceUrl.get(layer.id)) {
                pixelFXLoadedSourceUrl.set(layer.id, cacheKey);
                console.warn('[pixel-fx] media library item not found for id', c.sourceMediaId);
              }
            } else if (item.type === 'video') {
              // Prefer the existing videoElement if MediaTray made
              // one; otherwise create our own from the src so the
              // user doesn't need to first place the media on a
              // layer. Pumped per frame.
              const vid: HTMLVideoElement | undefined = item.videoElement || (item.src ? ensurePixelFXVideo(layer.id, item.src) : undefined);
              if (vid) {
                renderer.updateSourceFromVideo(vid);
                if (`media:${item.id}:video` !== pixelFXLoadedSourceUrl.get(layer.id)) {
                  pixelFXLoadedSourceUrl.set(layer.id, `media:${item.id}:video`);
                  console.log('[pixel-fx] source: media library video', item.name, 'src=', item.src?.slice(0, 64));
                }
              }
            } else if (item.src) {
              const cacheKey = `media:${item.id}:${item.src}`;
              if (cacheKey !== pixelFXLoadedSourceUrl.get(layer.id)) {
                console.log('[pixel-fx] source: media library image', item.name, 'src=', item.src.slice(0, 64));
              }
              loadImageOnce(item.src, cacheKey, 'media-library');
            }
          } else if (c.sourceType === 'layer' && c.sourceLayerId) {
            const sourceLayer = proj.layers.find((l) => l.id === c.sourceLayerId);
            if (sourceLayer && sourceLayer.source) {
              const ms = sourceLayer.source;
              const vid: HTMLVideoElement | undefined = (ms as any).videoElement
                || (ms.type === 'video' && ms.src ? ensurePixelFXVideo(layer.id, ms.src) : undefined);
              if (vid) {
                renderer.updateSourceFromVideo(vid);
                pixelFXLoadedSourceUrl.set(layer.id, `layer:${c.sourceLayerId}:video`);
              } else if (ms.src) {
                loadImageOnce(ms.src, `layer:${c.sourceLayerId}:${ms.src}`, 'layer-source');
              }
            }
          } else if (c.sourceUrl) {
            // File / URL source path. Detect video by sourceType OR
            // by file extension/mime hint in the URL — the panel sets
            // sourceType when the user picks via file dialog.
            const isVideo = c.sourceType === 'video';
            const cacheKey = `file:${c.sourceUrl}`;
            if (isVideo) {
              const v = ensurePixelFXVideo(layer.id, c.sourceUrl);
              renderer.updateSourceFromVideo(v);
              if (cacheKey !== pixelFXLoadedSourceUrl.get(layer.id)) {
                console.log('[pixel-fx] source: file video', c.sourceUrl.slice(0, 64));
                pixelFXLoadedSourceUrl.set(layer.id, cacheKey);
              }
            } else {
              if (cacheKey !== pixelFXLoadedSourceUrl.get(layer.id)) {
                console.log('[pixel-fx] source: file image', c.sourceUrl.slice(0, 64));
              }
              loadImageOnce(c.sourceUrl, cacheKey, 'file');
            }
          }
          // Apply per-frame settings (cheap setters; renderer hashes
          // internally to avoid duplicate writes).
          renderer.setMode(c.mode);
          renderer.setKnobs(c.knobs);
          renderer.setBaseSize(c.baseSize);
          renderer.setOpacity(c.opacity * (layer.opacity ?? 1));
          renderer.setAnchorJitter(c.anchorJitter);
          renderer.setCamera(c.fovDeg, c.cameraZ);
          renderer.setOrbit(c.cameraYaw ?? 0, c.cameraPitch ?? 0);
          renderer.setPan(c.panX ?? 0, c.panY ?? 0);
          renderer.setLight(
            c.lightEnabled ?? false,
            c.lightX ?? 1, c.lightY ?? 1, c.lightZ ?? 1.5,
            c.lightIntensity ?? 1.5, c.lightAmbient ?? 0.25, c.lightHeightStrength ?? 1.5,
          );
          renderer.setNoise(c.noiseAmpXY ?? 0, c.noiseAmpZ ?? 0, c.noiseFreq ?? 4, c.noiseSpeed ?? 0.5);
          // Honor the layer's blend mode so pixel-fx composites
          // properly with whatever's behind (the bridge frame, which
          // contains all CPU layers). Default 'add' kept unintended-
          // additive behaviour visible; users will probably want
          // 'normal' or 'screen' for video sources.
          renderer.setBlendMode(layer.blendMode || 'add');
          renderer.setParticleCount(c.particleCount);
          renderer.setViewport(presentCanvas.width, presentCanvas.height);
          renderer.encodeFrame(encoder, view);
        }
      }

        device.queue.submit([encoder.finish()]);
        const us = (performance.now() - t0) * 1000;
        renderTimeUsEMA = renderTimeUsEMA === 0 ? us : renderTimeUsEMA * 0.9 + us * 0.1;

        framesPresented++;
        const now = performance.now();
        if (lastFrameAt > 0) {
          const dt = now - lastFrameAt;
          const inst = 1000 / Math.max(1, dt);
          fpsEMA = fpsEMA === 0 ? inst : fpsEMA * 0.9 + inst * 0.1;
        }
        lastFrameAt = now;
        presentSucceeded = true;
      } catch (err) {
        // Loud diagnostic for GPU-encoding errors. The helper's outer
        // try/finally still closes the VideoFrame regardless.
        console.error('[WebGPUCanvas] presentFrame error:', err);
      }
    });
    if (!presentSucceeded) framesSkipped++;
  }

  function startFrameLoop() {
    if (rafId !== null) return;
    const tick = () => {
      if (disposed) return;
      if (initStatus === 'no-source' && sourceCanvas) initStatus = 'running';
      if (initStatus === 'running') presentFrame();
      // Dev-mode VideoFrame leak watchdog — early-returns when
      // `window.__VIDEO_FRAME_DEBUG__` is falsy, so this is free
      // in production. When debug is on, warns if >1 frame stays
      // open for >10 consecutive ticks — catches "I added a new
      // bridge site and forgot to use the helper" regressions.
      checkVideoFrameLeaks();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function stopFrameLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // ── Paint drip input handlers ─────────────────────────────────────
  // Mouse position is converted to normalized canvas coords (0..1)
  // based on the wrapper's bounding rect. We listen on window so the
  // overlay's `pointer-events: none` doesn't block us — and so the
  // user can drag-paint anywhere over the editor canvas without
  // breaking the underlying mapping/selection clicks (those still
  // hit Canvas.svelte's wrapper underneath us).
  function onMouseMove(e: MouseEvent): void {
    if (!presentCanvas || !wrapperEl) return;
    const r = presentCanvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    if (inside) {
      mouseSpawnU = u;
      mouseSpawnV = v;
    }
    // Forward to output cursor overlay when enabled in settings.
    // Visible only while the cursor is inside the canvas; goes
    // hidden the moment the user moves off so the cursor doesn't
    // stick at the edge.
    if (outputShowCursor) {
      setOutputCursor(inside ? u : 0, inside ? v : 0, inside);
    }
  }
  function onMouseDown(e: MouseEvent): void {
    // Only spawn on primary button. Right-click / middle-click are
    // reserved for mapping context menus / pan.
    if (e.button !== 0) return;
    onMouseMove(e);
    mouseDown = true;
    // When an adv-lightpaint layer is selected AND the click is over
    // the editor canvas, stop the editor's marquee selection from
    // engaging — the user is painting, not selecting layers. This
    // works because we're in the capture phase (registered above);
    // calling stopPropagation here prevents the bubble-phase marquee
    // handler from running. Don't preventDefault — that would suppress
    // focus changes the OS expects.
    if (advPaintSelected && presentCanvas && wrapperEl) {
      const r = presentCanvas.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        e.stopPropagation();
      }
    }
  }
  function onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    mouseDown = false;
    if (advPaintSelected) {
      // Match mousedown's stopPropagation so the marquee handler
      // doesn't see a stray mouseup and produce a phantom selection.
      e.stopPropagation();
    }
  }
  function onKeyDown(e: KeyboardEvent): void {
    // 'D' toggles paint drip. Ignore if user is typing into an input.
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    if (e.key === 'd' || e.key === 'D') {
      paintEnabled = !paintEnabled;
    }
  }

  onMount(async () => {
    await initWebGPU();
    if (initStatus === 'no-source' || initStatus === 'running') {
      startFrameLoop();
    }
    if (!isOutputMode && !isOsrMode && presentCanvas) {
      // The output presenter captureStream's the visible WebGPU
      // canvas. Same registration call as Phase 2 — the WebGPU
      // canvas is what the output sees.
      registerEditorCanvas(presentCanvas, 60);
    }

    // Subscribe to output settings for cursor — toggle, style, size,
    // thickness, color, opacity. Each settings change pushes a fresh
    // cursorStyle message to the output presenter; the cursor flag
    // gates whether mousemove forwards positions at all.
    settingsUnsub = settings.subscribe((s) => {
      outputShowCursor = s.output?.outputShowCursor ?? false;
      setOutputCursorStyle({
        style: s.output?.outputCursorStyle ?? 'crosshair',
        sizePx: s.output?.outputCursorSize ?? 28,
        thicknessPx: s.output?.outputCursorThickness ?? 2,
        color: s.output?.outputCursorColor ?? '#ffffff',
        opacity: s.output?.outputCursorOpacity ?? 0.85,
      });
      // If the user just turned the cursor OFF, hide it immediately
      // so it doesn't linger at the last-known position on the
      // output until the next mousemove.
      if (!outputShowCursor) setOutputCursor(0, 0, false);
    });

    // Hook input handlers in the CAPTURE phase. The editor's marquee
    // selection handler (somewhere inside the canvas wrapper) calls
    // stopPropagation on mousedown — bubble-phase listeners on
    // window never get the event. Capture-phase fires from window
    // DOWN to the target before any descendant runs, so we get the
    // event regardless of who later stops it. We don't preventDefault
    // — the editor's handlers still run, the marquee still works,
    // we just see the event too. (When an adv-lightpaint layer is
    // SELECTED, we also stopPropagation on mousedown ourselves so
    // the marquee doesn't appear during paint — see onMouseDown.)
    window.addEventListener('mousemove', onMouseMove, { capture: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mouseup', onMouseUp, { capture: true });
    window.addEventListener('keydown', onKeyDown);

    // Subscribe to bass band — feeds the audio-reactive jolt that
    // makes drips jump on the kick. audioBands is a derived store
    // that re-emits as the audio analyzer ticks (60Hz callback).
    // Also snapshots the full bass/mid/treble vector into
    // `lastAudioBands` so the per-frame flythrough loop can read
    // it without re-subscribing per layer.
    audioUnsub = audioBands.subscribe((bands) => {
      if (paintDrip) paintDrip.setBassEnergy(bands.bass);
      if (advPaint) advPaint.setBassEnergy(bands.bass);
      lastAudioBands = { bass: bands.bass, mid: bands.mid, treble: bands.treble };
    });

    // Subscribe to project + selected layer so we know:
    //  - whether ANY adv-lightpaint layer exists (controls render
    //    pass enable)
    //  - whether the SELECTED layer is one (controls mouse routing
    //    + which content drives the brush params)
    projectUnsub = project.subscribe((p) => {
      const advLayers = p.layers.filter((l) => l.type === 'adv-lightpaint');
      advPaintLayerCount = advLayers.length;
      if (advPaintLayerCount > 0 && !advPaintSelected) {
        advPaintActiveContent = advLayers[0].advLightPaintingContent;
      } else if (advPaintLayerCount === 0) {
        advPaintActiveContent = null;
      }
      if (advPaint) advPaint.setContent(advPaintActiveContent);

      // Light Painting GPU brushes — initial setStrokes from the
      // projectUnsub fires only on project change. Per-frame
      // collection happens in presentFrame() so progress can
      // advance with playback time even when the project store
      // is silent. setStrokes is hash-keyed so identical-state
      // ticks here are no-ops.
      if (strokeParticles) {
        const lpLayers = p.layers
          .filter((l) => l.type === 'lightpainting')
          .map((l) => ({ id: l.id, visible: l.visible, lightPaintingContent: l.lightPaintingContent }));
        const collected = collectGPUStrokes(lpLayers);
        strokeParticles.setStrokes(collected.strokes);
      }
    });
    selectedLayerUnsub = selectedLayer.subscribe((sl) => {
      if (sl?.type === 'adv-lightpaint' && sl.advLightPaintingContent) {
        advPaintSelected = true;
        advPaintActiveContent = sl.advLightPaintingContent;
        if (advPaint) advPaint.setContent(advPaintActiveContent);
      } else {
        advPaintSelected = false;
        if (advPaintLayerCount === 0) advPaintActiveContent = null;
      }
    });
  });

  onDestroy(() => {
    disposed = true;
    stopFrameLoop();
    stopOutputSharedTexturePresenter();
    window.removeEventListener('mousemove', onMouseMove, { capture: true } as any);
    window.removeEventListener('mousedown', onMouseDown, { capture: true } as any);
    window.removeEventListener('mouseup', onMouseUp, { capture: true } as any);
    window.removeEventListener('keydown', onKeyDown);
    if (audioUnsub) { try { audioUnsub(); } catch { /* */ } audioUnsub = null; }
    if (projectUnsub) { try { projectUnsub(); } catch { /* */ } projectUnsub = null; }
    if (selectedLayerUnsub) { try { selectedLayerUnsub(); } catch { /* */ } selectedLayerUnsub = null; }
    if (settingsUnsub) { try { settingsUnsub(); } catch { /* */ } settingsUnsub = null; }
    try { paintDrip?.dispose?.(); } catch { /* */ }
    paintDrip = null;
    try { advPaint?.dispose?.(); } catch { /* */ }
    advPaint = null;
    try { strokeParticles?.dispose?.(); } catch { /* */ }
    strokeParticles = null;
    for (const r of pixelFXRenderers.values()) { try { r.dispose?.(); } catch { /* */ } }
    pixelFXRenderers.clear();
    pixelFXLoadedSourceUrl.clear();
    for (const r of flythroughRenderers.values()) { try { r.dispose?.(); } catch { /* */ } }
    flythroughRenderers.clear();
    flythroughLoadedSourceKey.clear();
    try { device?.destroy?.(); } catch { /* */ }
  });
</script>

<div class="webgpu-bridge-overlay" bind:this={wrapperEl}>
  <canvas bind:this={presentCanvas} class="webgpu-present"></canvas>
  {#if initStatus === 'no-webgpu' || initStatus === 'error'}
    <div class="error-overlay">
      <div class="error-title">WebGPU bridge error</div>
      <div class="error-body">{initError}</div>
      <div class="error-hint">
        Toggle <code>experimental.editorWebGPU</code> off to fall back to WebGL only.
      </div>
    </div>
  {/if}
  <!-- (Phase 3 development overlay removed — WebGPU bridge + paint
       systems are stable. Re-enable for diagnostics by setting
       window.__WEBGPU_DEBUG__ = true and reloading.) -->
</div>

<style>
  .webgpu-bridge-overlay {
    /* Overlay: positioned absolutely on top of the underlying
       Canvas.svelte. pointer-events: none lets all clicks /
       drag / mouse events fall through to Canvas's wrapper for
       mapping interactions. */
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .webgpu-present {
    /* Match the underlying canvas's letterboxed display rect —
       Canvas.svelte centers its canvas via flexbox in a fixed-aspect
       container; we mirror that with object-fit on a max-sized
       canvas. */
    display: block;
    background: #000;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  /* Error overlay — only shows when WebGPU init fails. Stays in
     production so users get an actionable message instead of a
     silent black canvas. */
  .error-overlay {
    position: absolute;
    top: 12px;
    left: 12px;
    background: rgba(20, 20, 30, 0.85);
    border: 1px solid rgba(255, 60, 60, 0.5);
    color: #ddd;
    padding: 10px 14px;
    border-radius: 4px;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    pointer-events: none;
    max-width: 360px;
  }
  .error-title {
    font-weight: 700;
    font-size: 12px;
    color: #fff;
    margin-bottom: 6px;
  }
  .error-hint {
    font-size: 10px;
    color: #888;
    margin-top: 8px;
  }
  code {
    background: rgba(255, 255, 255, 0.08);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 10px;
  }
</style>
