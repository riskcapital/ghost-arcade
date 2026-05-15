/**
 * WebGPUEngine — Phase 2 scaffold of the editor renderer migration.
 *
 * Mirrors the PUBLIC surface of `RenderEngine` (engine.ts) but uses
 * `THREE.WebGPURenderer` from `three/webgpu` and TSL materials from
 * `three/tsl`. This file is INTENTIONALLY minimal — it implements
 * just enough to prove out two open questions before we commit to
 * the rest of the migration:
 *
 *   Q1: Does THREE.WebGPURenderer actually work as the editor's
 *       MAIN renderer (not just an offscreen pilot)? The pilot
 *       proves WebGPU + TSL render in this Electron build, but
 *       that pilot is offscreen-only. Main canvas integration adds
 *       lifecycle, resize, present-to-screen, etc.
 *
 *   Q2: Does `canvas.captureStream()` work on a WebGPU canvas? The
 *       output presenter (outputSharedTexturePresenter.ts) consumes
 *       the editor canvas via captureStream. Chromium DOCS that
 *       captureStream supports any GPU-accelerated canvas including
 *       WebGPU, but driver/build details may surprise us. If it
 *       breaks, we need an alternate transport before continuing.
 *
 * Until those answers are positive, this engine renders ONE THING
 * — a clear color (or a tiny TSL test pattern). The `renderFrame()`
 * method is a stub that does the clear. Per-layer rendering, the
 * compositor crossfade, the effects pipeline — all out of scope
 * for Phase 2.
 *
 * Selection (in Canvas.svelte):
 *   if (settings.experimental.editorWebGPU && webgpuSupported) {
 *     engine = new WebGPUEngine(canvas, w, h);
 *   } else {
 *     engine = new RenderEngine(canvas, w, h);
 *   }
 *
 * Parallel scaffolding (NOT a fork) — we DO NOT delete or modify
 * `engine.ts` for Phase 2. Both engines coexist; the flag picks one
 * at mount time. Phase 3 ports the per-layer renderers one at a
 * time. Phase 5 deletes engine.ts.
 *
 * See docs/WEBGPU_MIGRATION.md for the full roadmap.
 */

export interface WebGPUEngineOptions {
  /** Background clear color (RGB hex). Default 0x000000.
   *  Phase 2 visual: the canvas just shows this color. */
  clearColor?: number;
  /** Background clear alpha. Default 1. */
  clearAlpha?: number;
}

export interface WebGPUEngineMetrics {
  framesRendered: number;
  framesFailed: number;
  lastError: string | null;
  /** EMA-smoothed render time per frame (ms). */
  renderMs: number;
  /** Whether the renderer's init() succeeded. False during the
   *  async window between construction and ready. */
  ready: boolean;
  width: number;
  height: number;
  adapter: string;
}

const METRICS_EMA_ALPHA = 0.1;

export class WebGPUEngine {
  readonly canvas: HTMLCanvasElement;
  readonly metrics: WebGPUEngineMetrics = {
    framesRendered: 0,
    framesFailed: 0,
    lastError: null,
    renderMs: 0,
    ready: false,
    width: 0,
    height: 0,
    adapter: 'unknown',
  };

  // All Three.js objects typed as `any` to avoid pulling the entire
  // `three/webgpu` declaration surface into our top-level imports.
  // Phase 3 can install @webgpu/types + tighten if needed.
  private _renderer: any = null;
  private _scene: any = null;
  private _camera: any = null;
  private _mesh: any = null;
  private _ready: Promise<void>;
  private _disposed = false;
  private _pendingRender: Promise<void> | null = null;
  private _clearColor: number;
  private _clearAlpha: number;

  constructor(canvas: HTMLCanvasElement, width: number, height: number, options: WebGPUEngineOptions = {}) {
    this.canvas = canvas;
    this.metrics.width = width;
    this.metrics.height = height;
    this._clearColor = options.clearColor ?? 0x000000;
    this._clearAlpha = options.clearAlpha ?? 1;
    // Synchronous part of the constructor must succeed; the async
    // adapter init runs in `_ready` which the caller awaits via the
    // public ready() method or implicitly via render().
    this._ready = this._initAsync(width, height);
  }

  /** Resolves once the renderer is ready to render. Caller can await
   *  this to know when WebGPU is initialised; or call render() and
   *  let it implicitly await. */
  ready(): Promise<void> {
    return this._ready;
  }

  private async _initAsync(width: number, height: number): Promise<void> {
    try {
      // Dynamic imports so the WebGPU + TSL bundles stay out of the
      // main chunk until WebGPUEngine actually instantiates. Vite
      // tree-shakes these into separate chunks.
      const THREE = await import('three/webgpu');
      // const TSL = await import('three/tsl'); // not needed for Phase 2 clear-color stub

      this._renderer = new THREE.WebGPURenderer({
        canvas: this.canvas,
        antialias: false,
        alpha: true,
        powerPreference: 'high-performance',
      });
      // WebGPURenderer.init() is async (adapter request, device
      // creation). Skipping the await would race the first render.
      await this._renderer.init();
      this._renderer.setPixelRatio(1);
      this._renderer.setSize(width, height, false);
      this._renderer.setClearColor(this._clearColor, this._clearAlpha);

      this._scene = new THREE.Scene();
      this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      // Phase 2 scaffold: NO test mesh added yet. The clear color
      // alone proves end-to-end render. We can add a TSL test
      // pattern here later if visual confirmation is needed.

      // Surface the adapter description for the diagnostics panel.
      try {
        const adapterInfo = (this._renderer as any).backend?.adapter?.info;
        this.metrics.adapter = adapterInfo?.description || 'unknown';
      } catch { /* */ }

      this.metrics.ready = true;
      console.log(
        `[WebGPUEngine] initialised. Adapter: ${this.metrics.adapter}, ` +
          `size: ${width}x${height}`,
      );
    } catch (err: any) {
      this.metrics.lastError = err?.message || String(err);
      console.error('[WebGPUEngine] init failed:', this.metrics.lastError, err);
      throw err;
    }
  }

  /** Render one frame. Phase 2: just the clear pass.
   *
   *  Returns a Promise that resolves when the GPU work is queued
   *  (NOT when it completes — that's fenced separately). Caller
   *  typically does NOT await; the next renderFrame call will
   *  overlap with the previous frame's GPU work, matching WebGL's
   *  pipeline behaviour. */
  renderFrame(): void {
    if (this._disposed) return;
    if (!this.metrics.ready || !this._renderer) {
      // Init still in flight. Skip this frame; the animate loop
      // will retry on the next tick. Calling _ready without await
      // here is intentional — we don't want to block the loop on
      // the first-frame init.
      return;
    }
    const start = performance.now();
    try {
      // r184+: renderer.render() is the unified surface name. May
      // return a Promise (so we can attach .catch) or undefined
      // (sync — work queued, JS has nothing to await). Tolerate
      // both — a Three minor bump shouldn't break us.
      const ret: any = this._renderer.render(this._scene, this._camera);
      if (ret && typeof ret.catch === 'function') {
        this._pendingRender = ret as Promise<void>;
        (ret as Promise<void>).catch((e: any) => {
          this.metrics.framesFailed++;
          this.metrics.lastError = e?.message || String(e);
        });
      } else {
        this._pendingRender = null;
      }
      const dt = performance.now() - start;
      this.metrics.renderMs =
        this.metrics.renderMs === 0
          ? dt
          : this.metrics.renderMs * (1 - METRICS_EMA_ALPHA) + dt * METRICS_EMA_ALPHA;
      this.metrics.framesRendered++;
      if (this.metrics.lastError) this.metrics.lastError = null;
    } catch (err: any) {
      this.metrics.framesFailed++;
      this.metrics.lastError = err?.message || String(err);
    }
  }

  /** Resize the renderer + camera to new dimensions. Synchronous
   *  enough that calling from a ResizeObserver callback is fine. */
  resize(width: number, height: number): void {
    if (this._disposed || !this._renderer) return;
    this.metrics.width = width;
    this.metrics.height = height;
    this._renderer.setSize(width, height, false);
    // Orthographic camera covers [-1,1]² regardless of size — no
    // per-resize update needed for Phase 2's full-screen clear.
  }

  /** Update the clear color (e.g. user changed background colour
   *  in settings). */
  setClearColor(color: number, alpha = 1): void {
    if (this._disposed || !this._renderer) return;
    this._clearColor = color;
    this._clearAlpha = alpha;
    this._renderer.setClearColor(color, alpha);
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    if (this._pendingRender) {
      try { await this._pendingRender; } catch { /* */ }
    }
    try { this._mesh?.geometry?.dispose?.(); } catch { /* */ }
    try { this._mesh?.material?.dispose?.(); } catch { /* */ }
    try { this._renderer?.dispose?.(); } catch { /* */ }
    this._renderer = null;
    this._scene = null;
    this._camera = null;
  }
}
