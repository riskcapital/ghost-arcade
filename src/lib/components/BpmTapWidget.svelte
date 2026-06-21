<script lang="ts">
  /**
   * BpmTapWidget — TAP tempo button + live BPM readout + AUTO clear.
   *
   * Reusable across mapping mode top bar and VJ audio bar so the user can
   * tap a tempo (or read auto-detected BPM) from anywhere in the app
   * without going to a different mode. Backed by the shared `audioStore`.
   *
   * Visibility: hides itself when audio is not active (no point showing
   * a BPM widget when there's no audio source). Pass `alwaysShow` to
   * force visibility — useful for the VJ top bar where audio detection
   * is already gated upstream.
   */
  import { audioStore } from '../stores/audio';

  // When false (default) the widget self-hides if audio isn't active.
  // Mapping mode top bar uses this — no clutter when audio is off.
  export let alwaysShow: boolean = false;

  function handleTap() { audioStore.tapTempo(); }
  function clearTap() { audioStore.clearManualBPM(); }
</script>

{#if alwaysShow || $audioStore.isActive}
  <div class="bpm-tap-widget">
    <button class="bpm-tap-btn" onclick={handleTap} title="Tap to set tempo manually">TAP</button>
    <span class="bpm-readout" class:confident={$audioStore.bpmConfidence > 0.5}>
      {$audioStore.bpm > 0 ? $audioStore.bpm : '--'} BPM
    </span>
    {#if $audioStore.manualBPM}
      <button class="bpm-auto-btn" onclick={clearTap} title="Clear manual BPM and resume auto-detection">AUTO</button>
    {/if}
  </div>
{/if}

<style>
  .bpm-tap-widget {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
  }

  .bpm-tap-btn {
    padding: 0 10px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
    background: var(--ga-card, #13161c);
    color: var(--ga-ink-1, #9aa0ac);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: all 0.1s;
    /* Match the height of the AudioInputPicker buttons (28px) so the row
       stays visually aligned in mapping mode's top bar. */
    height: 32px;
    min-width: 38px;
  }

  .bpm-tap-btn:hover {
    border-color: var(--ga-violet-line, rgba(155, 135, 245, 0.36));
    color: var(--ga-violet, #9b87f5);
  }

  .bpm-tap-btn:active {
    background: var(--ga-violet, #9b87f5);
    color: #160f2e;
  }

  .bpm-readout {
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 13px;
    font-weight: 700;
    color: var(--ga-ink-2, #5e6571);
    font-variant-numeric: tabular-nums;
    min-width: 64px;
  }

  .bpm-readout.confident {
    color: var(--ga-violet, #9b87f5);
  }

  .bpm-auto-btn {
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
    background: transparent;
    color: var(--ga-ink-2, #5e6571);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
  }

  .bpm-auto-btn:hover {
    color: var(--ga-ink-1, #9aa0ac);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }
</style>
