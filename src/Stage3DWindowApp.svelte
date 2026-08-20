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
  import Canvas from './lib/components/Canvas.svelte';
  import Stage3DDesigner from './lib/components/stage3d/Stage3DDesigner.svelte';
  import { initStateBroadcast, destroyStateBroadcast } from './lib/sync/stateBroadcast';
  import { startAudioBroadcastReceiver } from './lib/sync/audioBroadcast';
  import { audioStore } from './lib/stores/audio';
  import { startModulationBroadcastReceiver } from './lib/sync/modulationBroadcast';
  import { initLicense } from './lib/stores/license';
  import { invoke } from '$lib/bridge';
  import { t } from '$lib/i18n';

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

    window.addEventListener('beforeunload', notifyClosing);
  });

  onDestroy(() => {
    window.removeEventListener('beforeunload', notifyClosing);
    destroyStateBroadcast();
  });

  function notifyClosing() {
    invoke('stage3d_window_closing').catch(() => {
      /* main window may already be gone */
    });
  }

  function closeWindow() {
    invoke('stage3d_window_closing').catch(() => window.close());
  }
</script>

<svelte:head>
  <title>{$t('windowApps.stage3d.title')}</title>
</svelte:head>

<div class="stage3d-window" role="application" aria-label={$t('windowApps.stage3d.ariaLabel')}>
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
