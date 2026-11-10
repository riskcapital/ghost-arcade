<script lang="ts">
  /**
   * Stage 3D pop-out window.
   *
   * This window intentionally renders its own synced copy of the VJ
   * compositor, then draws the 3D stage in the SAME WebGL renderer via
   * Canvas.svelte's `stage3DOutput` mode. That keeps the content texture
   * and LED-wall material sampling in one GPU context. No captureStream,
   * VideoTexture, ImageBitmap, drawImage, or readPixels bridge is used for
   * the stage surface itself.
   */
  import { onMount, onDestroy } from 'svelte';
  import { derived, get } from 'svelte/store';
  import Canvas from './lib/components/Canvas.svelte';
  import Stage3DDesigner from './lib/components/stage3d/Stage3DDesigner.svelte';
  import { initStateBroadcast, destroyStateBroadcast } from './lib/sync/stateBroadcast';
  import { startAudioBroadcastReceiver } from './lib/sync/audioBroadcast';
  import { audioStore } from './lib/stores/audio';
  import { startModulationBroadcastReceiver } from './lib/sync/modulationBroadcast';
  import { initLicense } from './lib/stores/license';
  import { invoke } from '$lib/bridge';
  import { installStageRehearsal, stageRecActive } from './lib/show/rehearsal/stageRehearsal';
  import { reelRenderBusy, stageReelRender } from './lib/recording/stageReelRender';

  // Rehearse the editor's show here: its transport, camera lane and sound.
  let stopRehearsal: (() => void) | null = null;

  onMount(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    initStateBroadcast('receiver');
    startAudioBroadcastReceiver({ onFrame: (frame) => audioStore.injectBroadcastedFrame(frame) });
    startModulationBroadcastReceiver();
    initLicense().catch((e) => console.warn('[Stage3DWindow] License init:', e));
    stopRehearsal = installStageRehearsal();

    window.addEventListener('beforeunload', notifyClosing);
  });

  // Tell the main process while a capture runs: closing the window then
  // asks first instead of losing the recording without a word.
  const captureBusy = derived([stageRecActive, stageReelRender], ([$rec, $reel]) => $rec || reelRenderBusy($reel.status));
  const stopBusyReport = captureBusy.subscribe((busy) => {
    invoke('stage3d_capture_state', { busy }).catch(() => { /* older main process */ });
  });

  onDestroy(() => {
    stopBusyReport();
    window.removeEventListener('beforeunload', notifyClosing);
    stopRehearsal?.();
    stopRehearsal = null;
    destroyStateBroadcast();
  });

  /** A Rec, reel or rehearsal render is running or saving here. */
  function captureRunning(): boolean {
    return get(stageRecActive) || reelRenderBusy(get(stageReelRender).status);
  }

  function notifyClosing() {
    if (captureRunning()) return;
    invoke('stage3d_window_closing').catch(() => { /* main window may already be gone */ });
  }

  function closeWindow() {
    invoke('stage3d_window_closing').catch(() => window.close());
  }
</script>

<div class="stage3d-window">
  <Canvas stage3DOutput={true} />
  <Stage3DDesigner renderViewport={false} onClose={closeWindow} />
</div>

<style>
  :global(html), :global(body) {
    margin: 0;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
  }

  .stage3d-window {
    position: fixed;
    inset: 0;
    background: #000;
  }

  .stage3d-window :global(.canvas-wrapper),
  .stage3d-window :global(.canvas-container),
  .stage3d-window :global(.main-canvas) {
    width: 100% !important;
    height: 100% !important;
  }
</style>
