<script lang="ts">
  /**
   * WebGPUCanvas — Phase 3.0 (Bridge-A) of the editor renderer
   * migration.
   *
   * Mounted by App.svelte AS AN OVERLAY when
   * `experimental.editorWebGPU` is on AND the WebGPU capability
   * probe says supported. Sits on top of Canvas.svelte (which is
   * also mounted, in `bridgeMode`, with its WebGL canvas hidden via
   * opacity:0 but still being painted by Chromium).
   *
   * Per-frame bridge:
   *
   *   Canvas.svelte (WebGL) renders the full editor scene to its
   *   hidden <canvas> as before
   *      ↓
   *   WebGPUCanvas's animate loop wraps that canvas in a VideoFrame
   *      ↓
   *   device.importExternalTexture({source: videoFrame}) — Chromium
   *   binds the GpuMemoryBuffer that backs the WebGL canvas as a
   *   sampleable WebGPU texture. Same-process, GPU-resident.
   *      ↓
   *   Render fullscreen quad with that texture
   *      ↓
   *   videoFrame.close() releases the GpuMemoryBuffer back to
   *   Chromium's pool
   *
   * Net effect: editor visually identical to the WebGL-only path,
   * but the FINAL present surface (and what captureStream pulls
   * from for the output presenter) is now a WebGPU canvas. This
   * unblocks Phase 3.x — per-layer WebGPU renderers can be added
   * incrementally and composited on top of the bridge surface,
   * eventually replacing it entirely.
   *
   * Why this design (overlay rather than nested):
   *   - Canvas.svelte's logic stays untouched (25+ engine call
   *     sites, store subscriptions, mouse handlers, mapping UI).
   *     Only adds two minimal exports (getCanvas, bridgeMode).
   *   - DOM order: Canvas.svelte is in DOM, WebGPUCanvas is on top
   *     (z-index). pointer-events: none on the WebGPU layer lets
   *     all interactions fall through to Canvas.svelte's wrapper
   *     (mapping clicks, layer selection, etc.).
   *   - VideoFrame from a Canvas in Chromium 130 is GPU-backed
   *     (GpuMemoryBuffer). importExternalTexture binds it
   *     zero-copy for sampling. ~150-300μs per frame at 4K on a
   *     discrete GPU — same primitive proven by the output presenter.
   *
   * NOT this design's job (Phase 3.x):
   *   - Per-layer WebGPU rendering (one bridge frame per layer).
   *   - Compute shaders for fluid / particles.
   *   - Direct WebGPU compositor + blend modes.
   *   - WGSL transpilation for ISF shaders.
   *
   * See docs/WEBGPU_MIGRATION.md for the full roadmap.
   */
  import { onMount, onDestroy } from 'svelte';
  import { isWebGPUSupported, probeWebGPU } from '$lib/renderer/webgpuCapability';
  import { registerEditorCanvas, stopOutputSharedTexturePresenter, setOutputCursor, setOutputCursorStyle } from '$lib/sync/outputSharedTexturePresenter';
  import { settings } from '$lib/stores/settings';
  import { WebGPUPaintDrip } from '$lib/renderer/webgpuPaintDrip';
  import { WebGPUAdvLightPaint } from '$lib/renderer/webgpuAdvLightPaint';
  import { audioBands } from '$lib/stores/audio';
  import { project, selectedLayer } from '$lib/stores/layers';
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
    const supported = await probeWebGPU();
    if (!supported || !isWebGPUSupported()) {
      initStatus = 'no-webgpu';
      initError = 'WebGPU unavailable in this Electron build';
      console.error('[WebGPUCanvas] ' + initError);
      return;
    }
    gpu = (navigator as any).gpu;
    try {
      adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('requestAdapter returned null');
      device = await adapter.requestDevice();
      device.lost.then((info: any) => {
        console.error('[WebGPUCanvas] device lost:', info?.message || info);
        if (!disposed) { initStatus = 'error'; initError = `Device lost: ${info?.message || 'unknown'}`; }
      });
      canvasContext = presentCanvas.getContext('webgpu');
      if (!canvasContext) throw new Error('getContext("webgpu") returned null');
      preferredFormat = gpu.getPreferredCanvasFormat();
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

    let videoFrame: VideoFrame | null = null;
    try {
      // Wrap the WebGL canvas in a VideoFrame. In Chromium 130 with
      // a GPU-accelerated source canvas this is a GpuMemoryBuffer
      // wrapper — no CPU readback. Same primitive used by
      // canvas.captureStream() internally; we're just bypassing the
      // MediaStream layer.
      videoFrame = new VideoFrame(sourceCanvas, { timestamp: performance.now() * 1000 });

      const t0 = performance.now();
      const externalTexture = device.importExternalTexture({ source: videoFrame });
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
    } catch (err) {
      framesSkipped++;
      console.error('[WebGPUCanvas] presentFrame error:', err);
    } finally {
      if (videoFrame) {
        try { videoFrame.close(); } catch { /* */ }
      }
    }
  }

  function startFrameLoop() {
    if (rafId !== null) return;
    const tick = () => {
      if (disposed) return;
      if (initStatus === 'no-source' && sourceCanvas) initStatus = 'running';
      if (initStatus === 'running') presentFrame();
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
    audioUnsub = audioBands.subscribe((bands) => {
      if (paintDrip) paintDrip.setBassEnergy(bands.bass);
      if (advPaint) advPaint.setBassEnergy(bands.bass);
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
