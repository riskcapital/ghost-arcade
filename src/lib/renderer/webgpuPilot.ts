/**
 * webgpuPilot — S4 sprint pilot: a CONTAINED WebGPURenderer instance
 * running independently of the main WebGL2 compositor, used to measure
 * (a) whether `WebGPURenderer` + TSL render successfully under our
 * Electron 42 / Chromium 130-ish runtime, and (b) what the
 * WebGPU-canvas → WebGL2-texture handoff costs per frame.
 *
 * Phase 1 (THIS FILE, current state) — pixel-pipeline-only:
 *
 *   - Creates its own offscreen canvas + WebGPURenderer.
 *   - Renders a simple TSL-defined animated test pattern (no compute
 *     shaders yet — just a render-time fragment expression).
 *   - Exposes a `getOutputCanvas()` so the main compositor can sample
 *     the WebGPU output via `gl.texImage2D(canvas, ...)`. THIS is the
 *     interop measurement point.
 *   - Tracks `webgpuRenderMs` per frame for the diagnostics panel.
 *
 * Phase 2 (later, only if Phase 1's interop numbers justify it):
 *
 *   - Replace the test-pattern fragment with a TSL compute pipeline
 *     that updates a particle StorageBuffer per frame.
 *   - Render instanced billboards sampling the same buffer.
 *   - Add the new layer type to the layer-add menu (gated on the
 *     pilot flag).
 *
 * Phase 1 deliberately does NOT promise a WebGL2 fallback. TSL can
 * compile shared render-shader source to both WGSL and GLSL, but
 * compute pipelines are WebGPU-only — the WebGL2 fallback story (CPU
 * compute? ping-pong fragment shader? "feature unavailable"?) is
 * a separate research question that Phase 2 will document. For now,
 * if WebGPU isn't available (`isWebGPUSupported()` false) the pilot
 * is simply skipped — never instantiated.
 *
 * Lifecycle:
 *
 *   - `WebGPUPilot.create()` is async (WebGPU init is async). Resolves
 *     after the renderer's first successful frame.
 *   - `pilot.tick()` is sync (called from the main animate loop).
 *     Internally calls `renderer.renderAsync()` which returns a Promise
 *     we DON'T await — the next frame's tick will sync via the
 *     subsequent `renderAsync()` resolution. Keeps the main loop
 *     non-blocking.
 *   - `pilot.dispose()` tears down the renderer + canvas. Calling
 *     during a hot animate tick is safe — the pending renderAsync
 *     still resolves but its output is discarded (texture is GC'd).
 *
 * Telemetry stored on `pilot.metrics`:
 *
 *   - `webgpuRenderMs` — ema-smoothed render time per frame
 *   - `framesRendered` — total successful renders
 *   - `framesFailed` — renders that threw (bad pipeline, lost device)
 *   - `lastError` — last thrown error message (null in steady state)
 *   - `outputWidth`/`outputHeight` — current pilot canvas dimensions
 *
 * The handoff metric (`handoffUploadMs`) is measured by the CALLER
 * (Canvas.svelte) since the upload path differs by integration point.
 * Pilot doesn't own that.
 */

import { isWebGPUSupported, getWebGPUInfo } from './webgpuCapability';

export interface WebGPUPilotMetrics {
  webgpuRenderMs: number;
  framesRendered: number;
  framesFailed: number;
  lastError: string | null;
  outputWidth: number;
  outputHeight: number;
}

export interface WebGPUPilotOptions {
  /** Pilot canvas dimensions. Default 512×512 — small enough that
   *  Phase 1's interop measurements aren't dominated by transfer
   *  size, large enough that the compute pipeline (Phase 2) has
   *  meaningful work to do. */
  width?: number;
  height?: number;
}

/** EMA smoothing factor for render-time metric. 0.1 = takes ~10
 *  frames to converge on a step change; smooth enough that the
 *  diagnostics readout doesn't flicker on per-frame jitter. */
const METRICS_EMA_ALPHA = 0.1;

export class WebGPUPilot {
  /** The OWN canvas the pilot renders into. Hidden / off-screen
   *  in production paths; a getContext('webgpu') call has been made
   *  on it by Three's WebGPURenderer. The main compositor reads from
   *  this via `gl.texImage2D(canvas, ...)`. */
  readonly canvas: HTMLCanvasElement;

  readonly metrics: WebGPUPilotMetrics = {
    webgpuRenderMs: 0,
    framesRendered: 0,
    framesFailed: 0,
    lastError: null,
    outputWidth: 0,
    outputHeight: 0,
  };

  /** Underlying Three.js objects. Typed as `any` to avoid pulling
   *  the whole WebGPU type surface into the pilot's signature
   *  (WebGPURenderer's exported types live in `three/webgpu` which
   *  isn't tree-shaken into our main bundle until we import it).
   *  All access is through pilot methods, never directly. */
  private _renderer: any = null;
  private _scene: any = null;
  private _camera: any = null;
  private _mesh: any = null;
  private _disposed = false;
  /** Time at construction, used as the TSL `time` uniform's origin
   *  so the test-pattern animation is deterministic relative to
   *  pilot lifetime (visualregression-friendly). */
  private _t0 = 0;
  /** In-flight renderAsync promise. Awaited by `dispose()` to make
   *  cleanup deterministic; ignored by `tick()` to stay non-blocking. */
  private _pendingRender: Promise<void> | null = null;

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /** Create + initialize a pilot instance. Returns null when WebGPU
   *  isn't supported on this machine (rather than throwing) so the
   *  caller can branch cleanly: `const pilot = await create(); if
   *  (!pilot) skipPilotPath();`. Throws only on UNEXPECTED errors
   *  (renderer init succeeded the capability probe but threw at
   *  pipeline construction time). */
  static async create(opts: WebGPUPilotOptions = {}): Promise<WebGPUPilot | null> {
    if (!isWebGPUSupported()) return null;

    const width = opts.width ?? 512;
    const height = opts.height ?? 512;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // Visually-hidden but kept in document so `gl.texImage2D` can
    // sample it. CSS `display: none` would prevent paint compositing
    // on some Chromium builds; off-screen position is the safer
    // pattern.
    canvas.style.position = 'absolute';
    canvas.style.left = '-9999px';
    canvas.style.top = '-9999px';
    canvas.style.width = '1px';
    canvas.style.height = '1px';
    canvas.style.pointerEvents = 'none';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    const pilot = new WebGPUPilot(canvas);
    pilot.metrics.outputWidth = width;
    pilot.metrics.outputHeight = height;
    pilot._t0 = performance.now();

    try {
      // Dynamic import so the WebGPU bundle stays out of the main
      // chunk until the pilot actually loads. Vite tree-shakes
      // `three/webgpu` separately when it sees the import live in a
      // dynamically-imported module.
      const THREE = await import('three/webgpu');
      const TSL = await import('three/tsl');

      pilot._renderer = new THREE.WebGPURenderer({
        canvas,
        antialias: false, // pilot only — antialiasing affects benchmarks
        alpha: true,      // so the canvas can be composited transparently
        powerPreference: 'high-performance',
      });
      // Initialize the device. Three's WebGPURenderer init is async;
      // skipping the await would race the first render.
      await pilot._renderer.init();
      pilot._renderer.setSize(width, height, false);
      pilot._renderer.setClearColor(0x000000, 0);

      pilot._scene = new THREE.Scene();
      pilot._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      // TSL test pattern. A simple animated radial gradient with
      // chromatic ripple — chosen to be visually distinctive (so the
      // interop pipeline is OBVIOUSLY working when it works) and
      // computationally trivial (so Phase 1 measures handoff cost,
      // not GPU compute cost).
      //
      // Node graph:
      //   uv (vec2 0..1) → centered (-1..1) → length → ripple sin
      //   color = mix(red, cyan, ripple) * radial-falloff
      //
      // This compiles to WGSL on WebGPU and would compile to GLSL on
      // WebGL2 if we ran it through the WebGL TSL backend (we don't
      // here — pilot is WebGPU-only by design).
      const { uv, vec2, vec3, vec4, length, sin, mix, time, sub, mul, smoothstep } = TSL as any;
      const centered = sub(uv(), vec2(0.5, 0.5));
      const r = length(centered);
      const ripple = sin(sub(mul(r, 24.0), mul(time, 4.0)));
      const ripple01 = mul(sin(mul(ripple, 0.5)), 0.5).add(0.5);
      const baseColor = mix(vec3(1.0, 0.2, 0.4), vec3(0.2, 0.9, 1.0), ripple01);
      const falloff = smoothstep(0.6, 0.0, r);
      const finalColor = mul(baseColor, falloff);

      const material = new (THREE as any).NodeMaterial();
      material.colorNode = vec4(finalColor, 1.0);
      material.transparent = true;

      const geometry = new THREE.PlaneGeometry(2, 2);
      pilot._mesh = new THREE.Mesh(geometry, material);
      pilot._scene.add(pilot._mesh);

      // First-frame priming render. If this throws (driver bug,
      // shader compilation failure), we want it to surface during
      // create() so the caller can fall back cleanly, not later
      // during the animate loop where the failure would be silent.
      //
      // `renderer.render()` returns a Promise on WebGPURenderer; we
      // await it here so create() doesn't resolve until the first
      // pixels are on the canvas. Three r184 deprecated the old
      // `renderAsync()` name in favour of `render()` for the
      // unified renderer surface.
      await pilot._renderer.render(pilot._scene, pilot._camera);
      pilot.metrics.framesRendered = 1;

      return pilot;
    } catch (e: any) {
      // Tear down what we built so a failed create doesn't leak
      // device/canvas resources.
      pilot._disposed = true;
      try { pilot._renderer?.dispose?.(); } catch { /* */ }
      try { canvas.remove(); } catch { /* */ }
      const msg = e?.message ?? String(e);
      console.error('[WebGPUPilot] create failed:', msg);
      throw new Error(`WebGPUPilot.create failed: ${msg}`);
    }
  }

  /** Render one frame. Non-blocking — schedules the GPU work and
   *  returns. EMA-smooths the render time into `metrics.webgpuRenderMs`
   *  using the previous frame's measured duration so the readout
   *  reflects the latest steady-state cost without being whipped
   *  around by per-frame jitter. */
  tick(): void {
    if (this._disposed || !this._renderer) return;
    const start = performance.now();
    try {
      // `renderer.render()` is the unified-surface name as of Three
      // r184; it replaced the deprecated `renderAsync()`. The return
      // shape DEPENDS on the Three minor version: some r184.x builds
      // return a Promise (so async errors surface via `.catch`), and
      // others return `undefined` (sync — the GPU work has been
      // queued, but the JS side has nothing to await). We need to
      // tolerate both, because a Three bump shouldn't break the
      // pilot. Calling `.catch` blindly on `undefined` produces the
      // exact symptom we hit in pilot v1: every tick threw "Cannot
      // read properties of undefined (reading 'catch')", every
      // single tick was logged as a failure, and the diagnostics
      // panel showed "1 (N failed)" with N climbing per frame.
      //
      // Sync errors (pipeline compile, lost device) come up the
      // outer try/catch regardless. Async ones — which only exist on
      // builds that DO return a Promise — are forwarded through the
      // safe-cast .catch below.
      const ret: any = this._renderer.render(this._scene, this._camera);
      if (ret && typeof ret.catch === 'function') {
        this._pendingRender = ret as Promise<void>;
        // Don't await — subsequent ticks will overlap with previous
        // GPU work, which is what we want (matches WebGL's pipeline).
        // Errors from the pending render surface here.
        (ret as Promise<void>).catch((e: any) => {
          this.metrics.framesFailed++;
          this.metrics.lastError = e?.message ?? String(e);
        });
      } else {
        // Sync return: no in-flight Promise to track. dispose()'s
        // await of _pendingRender is a no-op in this case, which is
        // fine — Three's WebGPURenderer.dispose() handles tearing
        // down a device with queued work internally.
        this._pendingRender = null;
      }
      const dt = performance.now() - start;
      this.metrics.webgpuRenderMs =
        this.metrics.webgpuRenderMs === 0
          ? dt
          : this.metrics.webgpuRenderMs * (1 - METRICS_EMA_ALPHA) + dt * METRICS_EMA_ALPHA;
      this.metrics.framesRendered++;
      // Clear stale lastError once we've recovered — otherwise a
      // single early failure stays sticky in the diagnostics panel.
      if (this.metrics.lastError) this.metrics.lastError = null;
    } catch (e: any) {
      this.metrics.framesFailed++;
      this.metrics.lastError = e?.message ?? String(e);
    }
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    // Wait for in-flight render so we don't dispose the device
    // mid-submission — that crashes some drivers on Linux/Mesa.
    if (this._pendingRender) {
      try { await this._pendingRender; } catch { /* */ }
    }
    try { this._mesh?.geometry?.dispose?.(); } catch { /* */ }
    try { this._mesh?.material?.dispose?.(); } catch { /* */ }
    try { this._renderer?.dispose?.(); } catch { /* */ }
    try { this.canvas.remove(); } catch { /* */ }
  }
}

/** Diagnostics-friendly summary suitable for the panel. Returns
 *  null when no pilot is currently active. */
export function summarizePilot(pilot: WebGPUPilot | null): {
  active: boolean;
  webgpuRenderMs: number;
  framesRendered: number;
  framesFailed: number;
  outputDims: string;
  adapter: string;
} | null {
  if (!pilot) return null;
  const info = getWebGPUInfo();
  return {
    active: true,
    webgpuRenderMs: Math.round(pilot.metrics.webgpuRenderMs * 100) / 100,
    framesRendered: pilot.metrics.framesRendered,
    framesFailed: pilot.metrics.framesFailed,
    outputDims: `${pilot.metrics.outputWidth}×${pilot.metrics.outputHeight}`,
    adapter: info.description || `${info.vendor ?? '?'}/${info.architecture ?? '?'}`,
  };
}
