<script lang="ts">
  /**
   * BpmTapWidget — TAP tempo button + live BPM readout + persistent AUTO mode.
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
  import { numericExpression } from '../utils/numericExpression';

  // When false (default) the widget self-hides if audio isn't active.
  // Mapping mode top bar uses this — no clutter when audio is off.
  export let alwaysShow: boolean = false;

  let editing = false;
  let draft = '';
  let error = '';
  $: automatic = $audioStore.manualBPM === null;
  $: waitingForAudio = automatic && !$audioStore.isActive;
  $: displayedBpm = waitingForAudio ? 0 : $audioStore.bpm;
  $: autoStatus = !automatic ? 'Use audio tempo'
    : waitingForAudio ? 'Waiting for audio'
    : $audioStore.bpm > 0 && $audioStore.bpmConfidence > 0.5 ? 'Following audio' : 'Detecting tempo';
  $: autoHelp = !automatic ? 'Switch from manual tempo to incoming audio tempo. Connect audio to detect BPM.'
    : waitingForAudio ? 'Automatic tempo is enabled. Connect an audio source to detect BPM, or type a BPM or tap to set tempo manually.'
    : 'Automatic tempo is enabled. Type a BPM or tap to switch to manual tempo.';
  // Live detection can update BPM while typing; never replace an unfinished expression.
  $: if (!editing) draft = displayedBpm > 0 ? String(displayedBpm) : '';
  function beginEdit() { editing = true; error = ''; }
  function commitBpm(blurred = false): boolean {
    if (!editing) return true;
    const value = numericExpression(draft);
    if (value === null || value <= 0) {
      error = 'Enter a positive tempo or expression, such as 120/2. Tempo unchanged.';
      if (blurred) editing = false;
      return false;
    }
    // Clear ownership before updating the shared clock or triggering blur.
    editing = false;
    error = '';
    audioStore.setManualBPM(value);
    draft = String($audioStore.bpm);
    return true;
  }
  function tempoKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commitBpm()) (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editing = false;
      error = '';
      draft = displayedBpm > 0 ? String(displayedBpm) : '';
      (event.currentTarget as HTMLInputElement).blur();
    }
  }
  function handleTap() { editing = false; error = ''; audioStore.tapTempo(); }
  function clearTap() { editing = false; error = ''; audioStore.clearManualBPM(); }
</script>

{#if alwaysShow || $audioStore.isActive}
  <div data-help-page="midi-audio" class="bpm-tap-widget">
    <button class="bpm-tap-btn" onclick={handleTap} title="Tap to set tempo manually">TAP</button>
    <label class="bpm-readout" class:confident={!waitingForAudio && $audioStore.bpmConfidence > 0.5}>
      <input class="bpm-input" type="text" inputmode="text" maxlength="256" placeholder="—"
        aria-label="Tempo in BPM: number or expression" aria-invalid={!!error}
        title={error || 'Type a tempo or expression (30–300 BPM), e.g. 120/2; Enter applies, Escape cancels'}
        bind:value={draft} onfocus={beginEdit} oninput={() => { editing = true; error = ''; }}
        onblur={() => commitBpm(true)} onkeydown={tempoKey} />
      <span>BPM</span>
    </label>
    {#if error}<span class="tempo-error" role="status">{error}</span>{/if}
    <button class="bpm-auto-btn" class:active={automatic} aria-pressed={automatic}
      aria-label="Automatic tempo" onclick={clearTap} title={autoHelp}>
      <span class="auto-label">AUTO</span>
      <span class="auto-status" aria-live="polite">{autoStatus}</span>
    </button>
  </div>
{/if}

<style>
  .bpm-tap-widget {
    position: relative;
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

  .bpm-input { width: 48px; min-width: 0; height: 26px; box-sizing: border-box; padding: 2px 3px; border: 1px solid var(--ga-line-2, #34363c); border-radius: 4px; background: #090b0f; color: var(--ga-selection-ink, #e0e8ff); font: inherit; text-align: right; appearance: textfield; }
  .bpm-input[aria-invalid="true"] { border-color: #c88d74; }
  .tempo-error { position: absolute; top: calc(100% + 6px); right: 0; width: 220px; padding: 8px 10px; border: 1px solid #725447; border-radius: 6px; background: #191b22; color: #e0b29d; font-size: 11px; line-height: 1.4; z-index: 30; pointer-events: none; }
  .bpm-input:focus { outline: 1px solid var(--ga-focus, #7996ff); }
  .bpm-readout {
    display: inline-flex; align-items: center; gap: 4px;
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
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 0 0 108px;
    width: 108px;
    height: 32px;
    box-sizing: border-box;
    padding: 2px 6px;
    gap: 2px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 5px;
    background: transparent;
    color: var(--ga-ink-2, #5e6571);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
  }

  .auto-label { font-size: 11px; line-height: 12px; }
  .auto-status { font-family: var(--ga-font-sans, inherit); font-size: 10px; line-height: 11px; font-weight: 500; letter-spacing: 0; white-space: nowrap; }
  .bpm-auto-btn.active { background: var(--ga-selection-bg, #182b59); border-color: var(--ga-focus, #5274cc); color: var(--ga-selection-ink, #e0e8ff); }
  .bpm-auto-btn:focus-visible { outline: 2px solid var(--ga-focus, #7996ff); outline-offset: 2px; }
  .bpm-auto-btn:hover {
    color: var(--ga-selection-ink, #e0e8ff);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }
</style>
