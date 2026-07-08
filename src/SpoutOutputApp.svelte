<script lang="ts">
  /**
   * SpoutOutputApp — Minimal renderer for Spout zero-copy output.
   *
   * This component runs inside a hidden OSR (offscreen rendering) window.
   * It renders the same Three.js scene as the main window but without any
   * UI panels. The Electron main process captures this window's paint events
   * as DXGI shared texture handles and sends them to Spout.
   *
   * State sync: uses BroadcastChannel to receive layer/project state
   * updates from the main window, so rendering stays in sync.
   */
  import { onMount, onDestroy } from 'svelte';
  import Canvas from './lib/components/Canvas.svelte';
  import { initStateBroadcast, destroyStateBroadcast } from './lib/sync/stateBroadcast';
  import { initLicense } from './lib/stores/license';
  import { invoke } from '$lib/bridge';

  // Fill the entire window — the OSR window is sized to the Spout output resolution
  let width = window.innerWidth;
  let height = window.innerHeight;
  let isOutputWindow = false;

  function exitOutputFullscreen() {
    invoke('output_exit_fullscreen').catch((err: any) => {
      console.error('[Output] Failed to exit fullscreen:', err);
    });
  }

  onMount(() => {
    console.log('[SpoutOutput] OSR renderer started', width, 'x', height);

    // Remove splash screen immediately — output window doesn't use App.svelte which normally does this
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    // Initialize license so watermark state is correct on the output window
    initLicense().catch(e => console.warn('[Output] License init:', e));

    // Initialize BroadcastChannel receiver for state sync from main window
    initStateBroadcast('receiver');

    // Handle resize (if OSR window dimensions change)
    const onResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    // Double-click to toggle fullscreen (for output window mode)
    isOutputWindow = !!(window as any).__OUTPUT_WINDOW_MODE__;
    const onDblClick = () => {
      if (isOutputWindow) {
        invoke('output_toggle_fullscreen').catch((err: any) => {
          console.error('[Output] Failed to toggle fullscreen:', err);
        });
      }
    };
    window.addEventListener('dblclick', onDblClick);

    const onKeydown = (e: KeyboardEvent) => {
      if (isOutputWindow && e.key === 'Escape') {
        e.preventDefault();
        exitOutputFullscreen();
      }
    };
    window.addEventListener('keydown', onKeydown);

    // Signal to main process that the renderer is ready after a delay
    // (allows Three.js to initialize and first state to arrive)
    // Only signal for the hidden OSR window, not the visible output window
    const readyTimer = !isOutputWindow ? setTimeout(() => {
      console.log('[SpoutOutput] Signaling ready to main process');
      invoke('spout_osr_ready').catch((err: any) => {
        console.error('[SpoutOutput] Failed to signal ready:', err);
      });
    }, 2000) : null;

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keydown', onKeydown);
      if (readyTimer) clearTimeout(readyTimer);
    };
  });

  onDestroy(() => {
    destroyStateBroadcast();
  });
</script>

<!-- Full-window canvas — no UI panels, no toolbars -->
<div
  class="spout-output"
>
  <Canvas />
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

  .spout-output {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: #000;
    overflow: hidden;
  }

  /* Hide any UI elements that Canvas might render (handles, overlays) */
  .spout-output :global(.warp-handles),
  .spout-output :global(.layer-controls),
  .spout-output :global(.toolbar),
  .spout-output :global(.sidebar) {
    display: none !important;
  }

  /* Force canvas wrapper/container to fill output window — no aspect ratio constraint */
  .spout-output :global(.canvas-wrapper) {
    background: #000 !important;
    align-items: stretch !important;
    justify-content: stretch !important;
  }

  .spout-output :global(.canvas-container) {
    max-width: none !important;
    max-height: none !important;
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: unset !important;
  }
</style>
