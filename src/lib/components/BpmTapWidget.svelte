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
  }

  .bpm-tap-btn {
    padding: 3px 10px;
    border: 1px solid #444;
    border-radius: 3px;
    background: #0d0d10;
    color: #aaa;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: all 0.1s;
    /* Match the height of the AudioInputPicker buttons (28px) so the row
       stays visually aligned in mapping mode's top bar. */
    height: 28px;
    min-width: 38px;
  }

  .bpm-tap-btn:hover {
    border-color: #BB86FC;
    color: #BB86FC;
  }

  .bpm-tap-btn:active {
    background: #BB86FC;
    color: #000;
  }

  .bpm-readout {
    font-size: 12px;
    font-weight: 700;
    color: #555;
    font-variant-numeric: tabular-nums;
    min-width: 64px;
  }

  .bpm-readout.confident {
    color: #BB86FC;
  }

  .bpm-auto-btn {
    padding: 2px 6px;
    border: 1px solid #444;
    border-radius: 3px;
    background: transparent;
    color: #666;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
  }

  .bpm-auto-btn:hover {
    color: #aaa;
    border-color: #666;
  }
</style>
