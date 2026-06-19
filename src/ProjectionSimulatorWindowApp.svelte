<script lang="ts">
  /**
   * Projection Simulator pop-out window.
   *
   * This mirrors the Stage 3D external-window architecture: keep a local,
   * synced compositor canvas alive in this BrowserWindow, then feed that
   * canvas directly into the projection simulator as the projector source
   * texture. The editor stays free for mapping on the primary monitor.
   */
  import { onDestroy, onMount } from 'svelte';
  import Canvas from './lib/components/Canvas.svelte';
  import ProjectionSimulatorPanel from './lib/components/ProjectionSimulatorPanel.svelte';
  import { initStateBroadcast, destroyStateBroadcast } from './lib/sync/stateBroadcast';
  import { startAudioBroadcastReceiver } from './lib/sync/audioBroadcast';
  import { audioStore } from './lib/stores/audio';
  import { startModulationBroadcastReceiver } from './lib/sync/modulationBroadcast';
  import { initLicense } from './lib/stores/license';
  import { invoke } from '$lib/bridge';

  let canvasComponent: Canvas | null = null;
  let sourceCanvas: HTMLCanvasElement | null = null;
  let sourceCanvasPoll: ReturnType<typeof setInterval> | null = null;

  function refreshSourceCanvas() {
    const next = canvasComponent?.getCanvas?.() ?? null;
    if (next !== sourceCanvas) sourceCanvas = next;
  }

  onMount(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    initStateBroadcast('receiver');
    startAudioBroadcastReceiver({ onFrame: (frame) => audioStore.injectBroadcastedFrame(frame) });
    startModulationBroadcastReceiver();
    initLicense().catch((e) => console.warn('[ProjectionSimWindow] License init:', e));

    refreshSourceCanvas();
    requestAnimationFrame(refreshSourceCanvas);
    sourceCanvasPoll = setInterval(refreshSourceCanvas, 250);
    window.addEventListener('beforeunload', notifyClosing);
  });

  onDestroy(() => {
    window.removeEventListener('beforeunload', notifyClosing);
    if (sourceCanvasPoll) {
      clearInterval(sourceCanvasPoll);
      sourceCanvasPoll = null;
    }
    destroyStateBroadcast();
  });

  function notifyClosing() {
    invoke('projection_sim_window_closing').catch(() => { /* main window may already be gone */ });
  }

  function closeWindow() {
    invoke('projection_sim_window_closing').catch(() => window.close());
  }
</script>

<div class="projection-sim-window">
  <div class="projection-sim-source" aria-hidden="true">
    <Canvas bind:this={canvasComponent} />
  </div>
  <ProjectionSimulatorPanel
    {sourceCanvas}
    onClose={closeWindow}
    nativeWindowMode={true}
  />
</div>

<style>
  :global(html), :global(body) {
    margin: 0;
    width: 100%;
    height: 100%;
    background: #05070b;
    overflow: hidden;
  }

  .projection-sim-window {
    position: fixed;
    inset: 0;
    background: #05070b;
    overflow: hidden;
  }

  .projection-sim-source {
    position: absolute;
    inset: 0;
    z-index: 0;
    opacity: 0;
    pointer-events: none;
  }

  .projection-sim-source :global(.canvas-wrapper),
  .projection-sim-source :global(.canvas-container),
  .projection-sim-source :global(.main-canvas) {
    width: 100% !important;
    height: 100% !important;
  }
</style>
