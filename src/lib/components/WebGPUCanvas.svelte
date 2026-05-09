<script lang="ts">
  /**
   * WebGPUCanvas — Phase 2 spike for the editor renderer migration.
   *
   * Mounted by App.svelte INSTEAD of Canvas.svelte when
   * `experimental.editorWebGPU` is on AND the WebGPU capability
   * probe says supported. Otherwise App.svelte mounts the existing
   * Canvas.svelte (the WebGL2 RenderEngine path) — the two are
   * mutually exclusive.
   *
   * Phase 2 scope: the canvas element exists, WebGPUEngine clears
   * to a chosen background colour each frame, the output presenter's
   * `registerEditorCanvas()` is called so the visible WebGPU canvas
   * is what gets captureStream'd. NO per-layer rendering.
   *
   * Why this exists: the editor renderer migration is a multi-week
   * project. Doing it in-place inside Canvas.svelte (which has 25+
   * call sites against `engine`) would block production indefinitely.
   * The parallel scaffold lets us answer the two open questions
   * (does WebGPURenderer work as the main editor canvas? does
   * captureStream work on a WebGPU canvas?) in isolation, then
   * Phase 3 starts porting per-layer renderers and growing
   * WebGPUCanvas's surface incrementally.
   *
   * The component intentionally exports the same minimal interface
   * Canvas.svelte exposes via canvasComponent (`getEngine()` →
   * returns null here for compatibility with App.svelte's null
   * checks). When Phase 3 starts, getEngine() will return the
   * WebGPUEngine instance and downstream code will check the type
   * via instanceof or duck-typing.
   *
   * See docs/WEBGPU_MIGRATION.md for the full roadmap.
   */
  import { onMount, onDestroy } from 'svelte';
  import { settings } from '$lib/stores/settings';
  import { project } from '$lib/stores/layers';
  import { WebGPUEngine } from '$lib/renderer/webgpuEngine';
  import { isWebGPUSupported, probeWebGPU } from '$lib/renderer/webgpuCapability';
  import {
    registerEditorCanvas,
    stopOutputSharedTexturePresenter,
  } from '$lib/sync/outputSharedTexturePresenter';

  // Match Canvas.svelte's mount-mode flags so other modules that
  // check window.__OUTPUT_WINDOW_MODE__ etc. behave consistently.
  const isOutputMode = !!(window as any).__OUTPUT_WINDOW_MODE__;
  const isOsrMode = !!(window as any).__SPOUT_OSR_MODE__;

  let canvas: HTMLCanvasElement;
  let wrapperEl: HTMLDivElement;
  let engine: WebGPUEngine | null = null;
  let rafId: number | null = null;
  let initError: string = '';
  let frameCount = 0;
  let frameLoopStartTime = 0;
  let fpsDisplay = 0;
  let lastFpsLogTime = 0;

  // Container sizing — mirror Canvas.svelte's "fit project aspect into
  // wrapper" logic so the editor canvas displays at the project size.
  let canvasContainerW = 0;
  let canvasContainerH = 0;

  function calcContainerSize(parentW: number, parentH: number, projW: number, projH: number) {
    const projAspect = projW / projH;
    const parentAspect = parentW / parentH;
    if (parentAspect > projAspect) {
      return { w: Math.round(parentH * projAspect), h: Math.round(parentH) };
    }
    return { w: Math.round(parentW), h: Math.round(parentW / projAspect) };
  }

  function sizeContainer(parentW: number, parentH: number) {
    const projW = $project.width || 1920;
    const projH = $project.height || 1080;
    const { w, h } = calcContainerSize(parentW, parentH, projW, projH);
    canvasContainerW = w;
    canvasContainerH = h;
  }

  /** Public method exported for App.svelte's canvasComponent ref.
   *  Phase 2: returns null because WebGPUEngine isn't a drop-in
   *  for RenderEngine (different API surface). Downstream call
   *  sites already handle null. Phase 3 will return the engine
   *  once the WebGPU codepath supports the same API. */
  export function getEngine(): null {
    return null;
  }

  /** Mirrors Canvas.svelte's getContainerRect for API parity so
   *  App.svelte's canvasComponent ref works with either canvas
   *  component. The WebGPU canvas is centered in the wrapper by
   *  flexbox, same as the WebGL canvas. */
  export function getContainerRect(): { x: number; y: number; width: number; height: number } {
    if (!canvas || !wrapperEl) return { x: 0, y: 0, width: 0, height: 0 };
    const ww = wrapperEl.offsetWidth;
    const wh = wrapperEl.offsetHeight;
    return {
      x: (ww - canvasContainerW) / 2,
      y: (wh - canvasContainerH) / 2,
      width: canvasContainerW,
      height: canvasContainerH,
    };
  }

  function startFrameLoop() {
    if (rafId !== null) return;
    frameLoopStartTime = performance.now();
    lastFpsLogTime = frameLoopStartTime;
    const tick = () => {
      if (engine) {
        engine.renderFrame();
        frameCount++;
        const now = performance.now();
        if (now - lastFpsLogTime > 1000) {
          fpsDisplay = (frameCount * 1000) / (now - lastFpsLogTime);
          frameCount = 0;
          lastFpsLogTime = now;
          // Log once a second so we can confirm steady-state from
          // the editor's DevTools console.
          console.log(
            `[WebGPUCanvas] fps=${fpsDisplay.toFixed(1)} ` +
              `renderMs=${engine.metrics.renderMs.toFixed(2)} ` +
              `frames=${engine.metrics.framesRendered} ` +
              `failed=${engine.metrics.framesFailed}`,
          );
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopFrameLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  onMount(async () => {
    // Capability probe is normally kicked off by Canvas.svelte's
    // onMount, but with editorWebGPU on we mount INSTEAD of Canvas
    // — so the probe hasn't run yet. Run it here. probeWebGPU() is
    // idempotent so a future Canvas mount (e.g. user toggles flag
    // off) will return the cached result.
    const supported = await probeWebGPU();
    if (!supported || !isWebGPUSupported()) {
      initError = 'WebGPU is not supported in this build/runtime. ' +
        'Disable experimental.editorWebGPU to fall back to the WebGL renderer.';
      console.error('[WebGPUCanvas] ' + initError);
      return;
    }

    const projW = $project.width || 1920;
    const projH = $project.height || 1080;

    // Initialise wrapper sizing so the canvas has dimensions before
    // the engine starts rendering.
    if (wrapperEl) {
      sizeContainer(wrapperEl.offsetWidth, wrapperEl.offsetHeight);
    }

    try {
      engine = new WebGPUEngine(canvas, projW, projH, {
        // Pleasant editor backdrop while we don't have a real scene.
        // Phase 3 will rip this out — the compositor's own clear
        // takes over once layers render.
        clearColor: 0x0a0a14,
        clearAlpha: 1,
      });
      await engine.ready();
      console.log('[WebGPUCanvas] engine ready, starting frame loop');
      startFrameLoop();

      // CRITICAL Phase 2 success check: make the WebGPU canvas the
      // source for the output presenter. If captureStream works on a
      // WebGPU canvas, the output window will receive frames as
      // before — proves the WebGPU migration doesn't break the
      // already-working zero-copy output transport.
      if (!isOutputMode && !isOsrMode) {
        registerEditorCanvas(canvas, 60);
      }
    } catch (err: any) {
      initError = `WebGPUEngine init failed: ${err?.message || err}`;
      console.error('[WebGPUCanvas] ' + initError, err);
    }

    // Resize observer to keep wrapper fit-aspect synced when the
    // window resizes.
    if (wrapperEl) {
      const observer = new ResizeObserver(() => {
        sizeContainer(wrapperEl.offsetWidth, wrapperEl.offsetHeight);
      });
      observer.observe(wrapperEl);
      // Cleanup attached via component-scope variable so onDestroy
      // can disconnect.
      (canvas as any).__resizeObserver = observer;
    }

    // React to project size changes (resize the engine + canvas).
    const unsubProject = project.subscribe((p) => {
      if (!engine) return;
      const w = p.width || 1920;
      const h = p.height || 1080;
      engine.resize(w, h);
      if (wrapperEl) sizeContainer(wrapperEl.offsetWidth, wrapperEl.offsetHeight);
    });

    // Cleanup function captured for onDestroy.
    (canvas as any).__unsubProject = unsubProject;
  });

  onDestroy(() => {
    stopFrameLoop();
    stopOutputSharedTexturePresenter();
    if (engine) {
      engine.dispose().catch(() => { /* */ });
      engine = null;
    }
    const observer = (canvas as any)?.__resizeObserver as ResizeObserver | undefined;
    if (observer) {
      try { observer.disconnect(); } catch { /* */ }
    }
    const unsubProject = (canvas as any)?.__unsubProject as (() => void) | undefined;
    if (unsubProject) {
      try { unsubProject(); } catch { /* */ }
    }
  });
</script>

<div class="webgpu-canvas-wrapper" bind:this={wrapperEl}>
  <canvas
    bind:this={canvas}
    class="webgpu-canvas"
    style="width: {canvasContainerW}px; height: {canvasContainerH}px;"
  ></canvas>
  {#if initError}
    <div class="error-overlay">
      <div class="error-title">WebGPU canvas error</div>
      <div class="error-body">{initError}</div>
      <div class="error-hint">
        Toggle <code>experimental.editorWebGPU</code> off in dev preferences
        to fall back to the WebGL renderer.
      </div>
    </div>
  {/if}
  {#if engine && !initError}
    <div class="phase2-overlay">
      <div class="phase2-title">Phase 2: WebGPU editor canvas</div>
      <div class="phase2-body">
        <div>fps {fpsDisplay.toFixed(1)}  render {engine.metrics.renderMs.toFixed(2)}ms</div>
        <div>frames {engine.metrics.framesRendered}  failed {engine.metrics.framesFailed}</div>
        <div>adapter {engine.metrics.adapter}</div>
        <div>size {engine.metrics.width}×{engine.metrics.height}</div>
      </div>
      <div class="phase2-hint">
        Open the output window to verify captureStream works on a WebGPU canvas.
      </div>
    </div>
  {/if}
</div>

<style>
  .webgpu-canvas-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    overflow: hidden;
  }
  .webgpu-canvas {
    display: block;
    background: #000;
  }
  .error-overlay,
  .phase2-overlay {
    position: absolute;
    top: 12px;
    left: 12px;
    background: rgba(20, 20, 30, 0.85);
    border: 1px solid rgba(255, 107, 107, 0.25);
    color: #ddd;
    padding: 10px 14px;
    border-radius: 4px;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    pointer-events: none;
    max-width: 360px;
  }
  .error-overlay {
    border-color: rgba(255, 60, 60, 0.5);
  }
  .error-title,
  .phase2-title {
    font-weight: 700;
    font-size: 12px;
    color: #fff;
    margin-bottom: 6px;
  }
  .error-hint,
  .phase2-hint {
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
