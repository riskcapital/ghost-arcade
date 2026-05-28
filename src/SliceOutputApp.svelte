<script lang="ts">
  /**
   * SliceOutputApp — Output window for a single multi-output slice
   * routed to a physical display (`targetType: 'display'` on the slice).
   *
   * Mounted by main.ts when the URL is `?mode=slice-display&sliceId=X`.
   * The window is opened by `output_open_slice_window` in main.js and
   * sized to the assigned display's bounds (borderless fullscreen).
   *
   * Architecture (Phase 2 v2 — shader-blended):
   *
   *   1. <Canvas/> is mounted hidden (visibility:hidden + sized to the
   *      master canvas resolution) so it runs the full state-synced
   *      compositing chain just like the editor.
   *   2. A foreground presentation <canvas> covers the whole window.
   *      Per RAF we:
   *        - Read the slice's params from $settings.output.slices (the
   *          editor pushes settings updates via BroadcastChannel so
   *          edits are live-reflected).
   *        - drawImage the rendered <canvas class="main-canvas"> region
   *          (slice's crop) into the presentation canvas, with the
   *          slice's rotation applied via ctx transforms.
   *        - Overlay edge-blend gradients via applyEdgeBlending — same
   *          formula and per-edge gamma as the sender-export path
   *          (outputPostProcess.ts).
   *
   *   Why not pipe through the GPU blendRenderer? blendRenderer does
   *   a readPixels + putImageData every frame — fine for IPC export
   *   (Spout / Syphon / NDI receive bytes) but unnecessary when the
   *   destination is a local <canvas> we can drawImage into directly.
   *   For display targets we keep pixels on the GPU.
   *
   *   Black-level lift on display targets is deferred — it requires
   *   additive composition which canvas-2d only does in linear-space
   *   approximation via `globalCompositeOperation: 'lighter'`. The
   *   sender-export path (blendRenderer.ts) does black-level lift
   *   correctly in linear space; for display-window rigs use a sender
   *   slice if black-level lift is critical.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import Canvas from './lib/components/Canvas.svelte';
  import { initStateBroadcast, destroyStateBroadcast } from './lib/sync/stateBroadcast';
  import { initLicense } from './lib/stores/license';
  import { settings, type OutputSlice } from './lib/stores/settings';
  import { applyEdgeBlending } from './lib/output/outputPostProcess';
  import { invoke } from '$lib/bridge';

  const urlParams = new URLSearchParams(window.location.search);
  const sliceId = urlParams.get('sliceId') || '';

  let presentCanvas: HTMLCanvasElement | null = null;
  let presentCtx: CanvasRenderingContext2D | null = null;
  let rafId = 0;
  let mainCanvasEl: HTMLCanvasElement | null = null;
  // Visible "ESC to close" hint. Shown on mount, fades after 5s.
  // Critical UX safety net: when a user accidentally opens a slice
  // window on their primary monitor (covering the whole desktop) they
  // need an obvious escape hatch. The hint reuses Esc → IPC close.
  let showEscHint = true;

  // Look up the slice's live config every render. The BroadcastChannel
  // state-sync pushes settings into this window's store automatically,
  // so editing the slice in the editor immediately reflects here.
  $: slice = $settings.output.slices.find(s => s.id === sliceId) || null;
  $: waitingForSlice = !slice;

  function presentOneFrame() {
    rafId = requestAnimationFrame(presentOneFrame);
    if (!presentCtx || !presentCanvas) return;

    // The window size = display's bounds (set by main.js). The
    // presentation canvas pixel-buffer matches CSS px because we
    // setSize once on resize.
    const w = presentCanvas.width;
    const h = presentCanvas.height;
    if (w <= 0 || h <= 0) return;

    // Find the rendered <canvas class="main-canvas"> once and cache.
    // It's created by Canvas.svelte after mount; null on the first
    // frame or two while Three.js spins up.
    if (!mainCanvasEl) {
      mainCanvasEl = document.querySelector('.main-canvas') as HTMLCanvasElement | null;
      if (!mainCanvasEl) {
        // Paint black while waiting for Canvas to mount. Avoids the
        // brief flash of last-frame-from-previous-window-instance
        // that some operators saw at Open.
        presentCtx.fillStyle = '#000';
        presentCtx.fillRect(0, 0, w, h);
        return;
      }
    }

    // Without a slice config (BroadcastChannel hasn't arrived yet)
    // present plain black so the projector shows something stable.
    if (!slice) {
      presentCtx.fillStyle = '#000';
      presentCtx.fillRect(0, 0, w, h);
      return;
    }

    // Slice's crop region in main-canvas pixel coords.
    const mw = mainCanvasEl.width;
    const mh = mainCanvasEl.height;
    const sx = Math.round(slice.cropX * mw);
    const sy = Math.round(slice.cropY * mh);
    const sw = Math.round(slice.cropW * mw);
    const sh = Math.round(slice.cropH * mh);
    if (sw <= 0 || sh <= 0) return;

    presentCtx.clearRect(0, 0, w, h);

    // Apply rotation + crop. drawImage from a hardware-accelerated
    // canvas to a 2D canvas is GPU-fast in Chromium; no readback.
    if (slice.rotation === 0) {
      presentCtx.drawImage(mainCanvasEl, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      presentCtx.save();
      presentCtx.translate(w / 2, h / 2);
      presentCtx.rotate((slice.rotation * Math.PI) / 180);
      // For 90/270 the destination's W and H are swapped relative to
      // the rotated content. We rotate around center, then draw
      // centered on (-W/2, -H/2) or (-H/2, -W/2) accordingly.
      if (slice.rotation === 90 || slice.rotation === 270) {
        presentCtx.drawImage(mainCanvasEl, sx, sy, sw, sh, -h / 2, -w / 2, h, w);
      } else {
        presentCtx.drawImage(mainCanvasEl, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
      }
      presentCtx.restore();
    }

    // Apply per-slice color correction via canvas filter. Brightness
    // and contrast are GPU-accelerated; gamma is an approximation
    // (CSS filters don't expose a real gamma curve — same caveat as
    // the editor's preview path. For accurate gamma use a sender
    // slice + the blendRenderer shader pipeline.)
    // Color correction is composited via a SECOND drawImage with
    // the filter set; doing it during the first drawImage would clip
    // at edges. For zero-correction (the common case) skip the cost.
    if (slice.brightness !== 1 || slice.contrast !== 1 || slice.gamma !== 1) {
      const ratio = Math.pow(0.5, slice.gamma) / 0.5;
      const filter = `brightness(${slice.brightness}) contrast(${slice.contrast}) brightness(${ratio.toFixed(3)})`;
      presentCtx.save();
      presentCtx.filter = filter;
      presentCtx.globalCompositeOperation = 'source-over';
      // No source — filter is applied to existing content via a
      // self-blit. Drawing the canvas onto itself with a filter is
      // the canonical post-process trick.
      presentCtx.drawImage(presentCanvas, 0, 0);
      presentCtx.filter = 'none';
      presentCtx.restore();
    }

    // Edge blending — semi-transparent gradient strips. Same formula
    // as the sender-export 2D fallback. Per-edge gamma supported.
    const hasBlend = slice.edgeBlendLeft > 0 || slice.edgeBlendRight > 0
      || slice.edgeBlendTop > 0 || slice.edgeBlendBottom > 0;
    if (hasBlend) {
      applyEdgeBlending(presentCtx, w, h, {
        edgeBlendLeft: slice.edgeBlendLeft,
        edgeBlendRight: slice.edgeBlendRight,
        edgeBlendTop: slice.edgeBlendTop,
        edgeBlendBottom: slice.edgeBlendBottom,
        // Picks per-edge gamma if set, falls back to the slice's
        // default. The 2D path uses one gamma per draw call, so we
        // average the four edge gammas — close enough for the
        // approximate canvas path; the GPU sender path remains the
        // accurate one for asymmetric blend gammas.
        edgeBlendGamma:
          (((slice.edgeBlendLeftGamma ?? slice.edgeBlendGamma)
            + (slice.edgeBlendRightGamma ?? slice.edgeBlendGamma)
            + (slice.edgeBlendTopGamma ?? slice.edgeBlendGamma)
            + (slice.edgeBlendBottomGamma ?? slice.edgeBlendGamma)) / 4),
      });
    }
  }

  function resizePresentCanvas() {
    if (!presentCanvas) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (presentCanvas.width !== w || presentCanvas.height !== h) {
      presentCanvas.width = w;
      presentCanvas.height = h;
    }
  }

  // Svelte 5's onMount typing rejects an async function whose Promise
  // resolves to a cleanup — the cleanup must be returned synchronously.
  // Setup work that doesn't block the cleanup (license init, the tick()
  // before grabbing the present-canvas context) runs in an inner IIFE
  // so we can return the cleanup right away.
  onMount(() => {
    console.log('[SliceOutput] slice window mounted, sliceId=', sliceId);

    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    initLicense().catch(e => console.warn('[SliceOutput] License init:', e));
    initStateBroadcast('receiver');

    void (async () => {
      // Wait one tick so Canvas (mounted below) has appended its
      // .main-canvas to the DOM before the first frame query.
      await tick();
      if (presentCanvas) {
        presentCtx = presentCanvas.getContext('2d');
        resizePresentCanvas();
      }
    })();

    const onResize = () => resizePresentCanvas();
    window.addEventListener('resize', onResize);

    const onDblClick = () => {
      invoke('output_toggle_fullscreen').catch(() => {});
    };
    window.addEventListener('dblclick', onDblClick);

    // Escape-to-close. The slice window is opened borderless +
    // fullscreen on a physical display; if the operator misclicks
    // and routes it to their primary monitor they need a reliable
    // way out without quitting the whole app. Esc closes THIS slice
    // window via the same IPC the Screens panel uses.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        invoke('output_close_slice_window', { sliceId }).catch(() => {
          // Fallback: if IPC fails (preload not exposing the channel
          // yet), close the renderer window itself.
          window.close();
        });
      }
    };
    window.addEventListener('keydown', onKey);

    rafId = requestAnimationFrame(presentOneFrame);

    const hintTimer = setTimeout(() => { showEscHint = false; }, 5000);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keydown', onKey);
      clearTimeout(hintTimer);
    };
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    destroyStateBroadcast();
  });
</script>

<div class="slice-output">
  {#if waitingForSlice}
    <!-- The slice config takes one BroadcastChannel round-trip to
         arrive from the editor. Show a discrete placeholder so the
         operator knows the window is alive, not frozen. -->
    <div class="slice-waiting">
      Waiting for slice <code>{sliceId}</code> from editor…
    </div>
  {/if}
  {#if showEscHint}
    <!-- 5-second close-hint so the operator always knows the way
         out, even when this slice window lands on their primary
         monitor and covers everything else. -->
    <div class="esc-hint">Press <kbd>Esc</kbd> to close</div>
  {/if}
  <!-- Canvas is mounted but visually hidden — it still runs the
       state-synced render loop, just behind the presentation canvas.
       Set to a fixed 1920×1080 box so it doesn't fight the window
       size; the presentation canvas does the actual crop scaling. -->
  <div class="hidden-canvas">
    <Canvas />
  </div>
  <canvas class="slice-present" bind:this={presentCanvas}></canvas>
</div>

<style>
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #000;
    width: 100vw;
    height: 100vh;
    cursor: none;
  }
  :global(#app) {
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  .slice-output {
    position: fixed;
    inset: 0;
    background: #000;
    overflow: hidden;
  }
  /* The actual rendering canvas is hidden — its pixels are read by
     the presentation canvas every frame via drawImage. Visibility
     hidden (not display:none) so its render loop keeps ticking. */
  .hidden-canvas {
    position: absolute;
    left: -10000px;
    top: 0;
    width: 1920px;
    height: 1080px;
    visibility: hidden;
    pointer-events: none;
  }
  .hidden-canvas :global(.canvas-wrapper) {
    background: #000 !important;
    align-items: stretch !important;
    justify-content: stretch !important;
    width: 1920px !important;
    height: 1080px !important;
  }
  .hidden-canvas :global(.canvas-container) {
    max-width: none !important;
    max-height: none !important;
    width: 1920px !important;
    height: 1080px !important;
    aspect-ratio: unset !important;
  }
  .slice-present {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: block;
    background: #000;
    z-index: 1;
  }
  .slice-waiting {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font: 14px/1.4 ui-monospace, monospace;
    z-index: 100;
    pointer-events: none;
  }
  .slice-waiting code {
    color: #5fa8ff;
    padding: 0 4px;
  }
  .esc-hint {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 101;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font: 12px/1.3 ui-monospace, monospace;
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    pointer-events: none;
    animation: esc-fade 5s ease-out forwards;
  }
  .esc-hint kbd {
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 3px;
    padding: 1px 6px;
    margin: 0 2px;
    font-family: inherit;
    font-size: 11px;
  }
  @keyframes esc-fade {
    0% { opacity: 0; transform: translateY(-4px); }
    8% { opacity: 1; transform: translateY(0); }
    80% { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
