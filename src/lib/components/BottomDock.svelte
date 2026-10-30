<script lang="ts">
  /**
   * Bottom dock — toggle pills for Presets / Sequencer / Keyframes
   * sitting under the stage. Click a pill to open a drawer; click again
   * to collapse. Inactive pills stay quiet so the dock doesn't shout
   * for attention when the user is mapping or designing.
   *
   * Sequencer and Keyframes are stored in their own panel modules
   * (layerSequencer / keyframeTimeline stores). The dock just toggles
   * their open flags — the existing UIs render themselves. Presets
   * dispatches a custom event the host can handle (showing the
   * Compositions list, opening the VJ Preset save form, etc.).
   */
  import { onMount, onDestroy } from 'svelte';
  import { layerSequencer } from '../stores/layerSequencer';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { compositions } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  // Hide the dock while the VJ panel is up — VJ has its own bottom
  // bar (clip grid + master sliders) and overlapping pills compete for
  // attention during a live performance. Show again when minimised.
  $: vjOpen = $vjClipLauncher.isOpen;

  /** Toggle the Compositions / Saved presets drawer in App.svelte. */
  export let onTogglePresets: () => void = () => {};
  export let presetsOpen = false;

  $: seqOpen = $layerSequencer.isOpen;
  $: kfOpen = $keyframeTimeline.isOpen;

  function toggleSeq() { layerSequencer.toggleOpen(); }
  function toggleKf()  { keyframeTimeline.toggleOpen(); }

  // ⌘P opens presets, ⌘B sequencer (Beat), ⌘K keyframes — quick muscle
  // memory for live sessions. Skip when an input has focus.
  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'p') { e.preventDefault(); onTogglePresets(); }
    else if (k === 'b') { e.preventDefault(); toggleSeq(); }
    else if (k === 'k') { e.preventDefault(); toggleKf(); }
  }

  onMount(() => window.addEventListener('keydown', onKey));
  onDestroy(() => window.removeEventListener('keydown', onKey));
</script>

{#if !vjOpen}
<div data-help-page="interface" class="bottom-dock">
  <button class="pill" class:on={presetsOpen} onclick={onTogglePresets} title="Presets (⌘P)">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 15l6-6 6 6"/>
    </svg>
    Presets
    {#if $compositions.length > 0}<span class="count">{$compositions.length}</span>{/if}
  </button>
  <button class="pill" class:on={seqOpen} onclick={toggleSeq} title="Sequencer (⌘B)">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="9" width="3" height="6"/>
      <rect x="9" y="6" width="3" height="12"/>
      <rect x="15" y="11" width="3" height="4"/>
      <rect x="21" y="8" width="0.0001" height="0.0001"/>
    </svg>
    Sequencer
  </button>
  <button class="pill" class:on={kfOpen} onclick={toggleKf} title="Keyframes (⌘K)">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3l9 9-9 9-9-9z"/>
    </svg>
    Keyframes
  </button>
</div>
{/if}

<style>
  /* Hide the legacy per-panel toggle buttons (Presets, Sequencer,
     Keyframes, Show) since the dock now serves as the single entry point.
     Keeping both visible meant near-identical pills stacking at
     bottom:24px and competing for the same chunk of screen real estate.
     The actual panels stay mounted; we just suppress their toggles. */
  :global(.tray-toggle),
  :global(.seq-toggle),
  :global(.kf-toggle),
  :global(.show-toggle) { display: none !important; }

  .bottom-dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--ga-statusbar-height, 26px);
    height: var(--ga-bottom-dock-height, 48px);
    z-index: 110;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 14px;
    background: var(--ga-bar, rgba(14, 16, 20, .92));
    border-top: 1px solid var(--ga-line-2, rgba(255, 255, 255, .12));
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, .07));
    border-left: 0;
    border-right: 0;
    border-radius: 0;
    backdrop-filter: blur(10px);
    pointer-events: auto;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, .34);
  }
  /* Same toggle as the status-bar pills: quiet when off, selection
     colours when on. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--ga-control-h, 26px);
    padding: 0 12px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, .12));
    border-radius: var(--ga-r-pill, 999px);
    background: transparent;
    color: var(--ga-ink-1, #9aa0ac);
    font: inherit;
    font-family: var(--ga-font-ui, system-ui, sans-serif);
    font-weight: var(--ga-weight-control, 600);
    font-size: var(--ga-text-control, 12px);
    letter-spacing: 0;
    cursor: pointer;
    transition: background 0.14s, color 0.14s, border-color 0.14s;
  }
  .pill:hover:not(.on) {
    color: var(--ga-ink-0, #eef0f4);
    border-color: var(--ga-line-3, rgba(255, 255, 255, .24));
  }
  .pill.on {
    color: var(--ga-selection-ink, #e0e8ff);
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
  }
  .pill svg { flex: none; }
  .count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 16px;
    min-width: 16px;
    padding: 0 5px;
    margin-left: 2px;
    border-radius: var(--ga-r-pill, 999px);
    background: rgba(255, 255, 255, 0.1);
    color: inherit;
    font-family: var(--ga-font-mono, ui-monospace);
    font-size: var(--ga-text-micro, 9px);
    font-weight: 600;
    letter-spacing: 0;
  }
  .pill.on .count {
    background: rgba(255, 255, 255, 0.14);
  }
</style>
