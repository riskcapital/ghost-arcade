<script lang="ts">
  /**
   * SliceAtlasApp — hidden offscreen (OSR) compositor for multi-slice
   * zero-copy senders. Mounted at ?mode=slice-atlas.
   *
   * Renders EVERY Spout/Syphon sender slice into its tile of a single
   * atlas canvas using the shared blendRenderer warp/crop/color/blend
   * shader. Chromium captures the atlas canvas as one shared GPU texture
   * (DXGI / IOSurface); the native addon sub-copies each tile into a
   * per-name sender. One compositor + one capture for any number of
   * slices — cost is flat in slice count (see
   * docs/multi-slice-zerocopy-plan.md).
   *
   * Mirrors SliceOutputApp's LEGACY path: it has no window.opener (main.js
   * created it), so it runs its own state-synced master compositor via a
   * hidden <Canvas/> rather than receiving frames over a MessagePort.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import Canvas from './lib/components/Canvas.svelte';
  import { initStateBroadcast, destroyStateBroadcast } from './lib/sync/stateBroadcast';
  import { initLicense } from './lib/stores/license';
  import { settings, masterWarpIsActive } from './lib/stores/settings';
  import {
    startMasterWarpOutput,
    stopMasterWarpOutput,
    tickMasterWarpOutput,
    getMasterWarpCanvas,
    disposeMasterWarpOutput,
  } from './lib/sync/outputComposite';
  import {
    beginSliceAtlasFrame,
    renderSliceAtlasTile,
    endSliceAtlasFrame,
    disposeAtlasRenderer,
  } from './lib/output/blendRenderer';
  import { packAtlas, atlasLayoutSignature, type AtlasLayout } from './lib/output/atlasLayout';
  import { invoke } from '$lib/bridge';
  import { t } from '$lib/i18n';

  let atlasCanvas: HTMLCanvasElement | null = null;
  let mainCanvasEl: HTMLCanvasElement | null = null;
  let rafId = 0;
  let lastSig = '';
  let currentLayout: AtlasLayout = { atlasW: 0, atlasH: 0, tiles: [], overflow: false };

  function masterSource(): HTMLCanvasElement | null {
    if (!mainCanvasEl) {
      mainCanvasEl = document.querySelector('.main-canvas') as HTMLCanvasElement | null;
    }
    if (!mainCanvasEl) return null;
    // Master warp (if active) is baked into a dedicated canvas — slices
    // crop from the warped master, matching the editor + the per-display
    // path. Otherwise crop straight from the raw composite.
    const out = $settings.output;
    const mw = out?.masterCanvasWidth ?? mainCanvasEl.width;
    const mh = out?.masterCanvasHeight ?? mainCanvasEl.height;
    if (masterWarpIsActive(out?.masterWarp)) {
      startMasterWarpOutput(
        () => out?.masterWarp,
        () => ({ w: mw, h: mh }),
      );
      tickMasterWarpOutput(mainCanvasEl);
      const warped = getMasterWarpCanvas();
      if (warped && warped.width > 0) return warped;
    } else {
      stopMasterWarpOutput();
    }
    return mainCanvasEl;
  }

  function renderAtlasFrame() {
    rafId = requestAnimationFrame(renderAtlasFrame);
    if (!atlasCanvas) return;

    const out = $settings.output;
    const masterW = out?.masterCanvasWidth ?? 1920;
    const masterH = out?.masterCanvasHeight ?? 1080;
    const slices = out?.slices ?? [];

    const layout = packAtlas(slices, masterW, masterH);
    const sig = atlasLayoutSignature(layout);
    if (sig !== lastSig) {
      lastSig = sig;
      currentLayout = layout;
      // Tell main the new layout so it can (re)configure the native
      // atlas senders + resize the OSR window. Sent on change only.
      invoke('texshare_atlas_layout', {
        atlasW: layout.atlasW,
        atlasH: layout.atlasH,
        overflow: layout.overflow,
        tiles: layout.tiles,
      }).catch(() => {
        /* main may not be ready yet */
      });
    }

    if (layout.tiles.length === 0 || layout.atlasW <= 0 || layout.atlasH <= 0) {
      return;
    }

    const source = masterSource();
    if (!source || source.width <= 0) return;

    if (!beginSliceAtlasFrame(atlasCanvas, layout.atlasW, layout.atlasH, source)) return;

    const sliceById = new Map(slices.map((s) => [s.id, s]));
    for (const tile of layout.tiles) {
      const slice = sliceById.get(tile.sliceId);
      if (!slice) continue;
      // Layout tiles are top-left; GL viewport origin is bottom-left.
      const glY = layout.atlasH - tile.y - tile.h;
      renderSliceAtlasTile(slice, tile.x, glY, tile.w, tile.h);
    }
    endSliceAtlasFrame();
  }

  onMount(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    initLicense().catch((e) => console.warn('[SliceAtlas] License init:', e));
    initStateBroadcast('receiver');

    void (async () => {
      await tick();
      rafId = requestAnimationFrame(renderAtlasFrame);
    })();
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    disposeAtlasRenderer();
    disposeMasterWarpOutput();
    destroyStateBroadcast();
    invoke('texshare_atlas_layout', { atlasW: 0, atlasH: 0, overflow: false, tiles: [] }).catch(() => {});
  });
</script>

<svelte:head>
  <title>{$t('windowApps.sliceAtlas.title')}</title>
</svelte:head>

<div class="slice-atlas" aria-hidden="true">
  <!-- Hidden master compositor — same off-screen-but-composited trick as
       the per-display slice window so Chromium keeps painting it and its
       canvas is uploadable as a WebGL texture (NOT visibility:hidden). -->
  <div class="hidden-canvas">
    <Canvas />
  </div>
  <!-- The atlas canvas IS the OSR-captured surface. -->
  <canvas class="atlas-present" bind:this={atlasCanvas}></canvas>
</div>

<style>
  :global(html), :global(body) {
    margin: 0; padding: 0; overflow: hidden; background: #000;
    width: 100vw; height: 100vh;
  }
  :global(#app) { width: 100vw; height: 100vh; margin: 0; padding: 0; overflow: hidden; }
  .slice-atlas { position: fixed; inset: 0; background: #000; overflow: hidden; }
  .hidden-canvas {
    position: absolute; left: -10000px; top: 0;
    width: 1920px; height: 1080px; opacity: 0.01; pointer-events: none;
  }
  .hidden-canvas :global(.canvas-wrapper) {
    background: #000 !important;
    align-items: stretch !important; justify-content: stretch !important;
    width: 1920px !important; height: 1080px !important;
  }
  .hidden-canvas :global(.canvas-container) {
    max-width: none !important; max-height: none !important;
    width: 1920px !important; height: 1080px !important; aspect-ratio: unset !important;
  }
  .atlas-present { position: fixed; inset: 0; display: block; background: #000; }
</style>
