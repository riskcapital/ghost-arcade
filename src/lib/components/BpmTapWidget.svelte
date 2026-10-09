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
      aria-label="Detect tempo from audio" onclick={clearTap} title={`${autoStatus}. ${autoHelp}`}>
      <i class="auto-dot" class:live={automatic && !waitingForAudio} aria-hidden="true"></i>
      <span class="auto-label">DETECT TEMPO</span>
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
    color: var(--ga-blue-800);
  }

  .bpm-input { width: 48px; min-width: 0; height: 26px; box-sizing: border-box; padding: 2px 3px; border: 1px solid var(--ga-line-2, #34363c); border-radius: 4px; background: #090b0f; color: var(--ga-selection-ink, #e0e8ff); font: inherit; text-align: right; appearance: textfield; }
  .bpm-input[aria-invalid="true"] { border-color: #c88d74; }
  .tempo-error { position: absolute; top: calc(100% + 6px); right: 0; width: 220px; padding: 8px 10px; border: 1px solid #725447; border-radius: 6px; background: var(--ga-blue-mute-800); color: #e0b29d; font-size: 11px; line-height: 1.4; z-index: 30; pointer-events: none; }
  .bpm-input:focus { outline: 1px solid var(--ga-focus, var(--ga-blue-300)); }
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

  /* Dark and plain like its neighbours: on is a lit dot and brighter text, not a filled chip. */
  .bpm-auto-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    height: 32px;
    box-sizing: border-box;
    padding: 0 10px;
    gap: 7px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 5px;
    background: transparent;
    color: var(--ga-ink-2, #5e6571);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    white-space: nowrap;
    cursor: pointer;
  }

  .auto-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ga-line-3, rgba(255, 255, 255, 0.2)); }
  .bpm-auto-btn.active .auto-dot { background: var(--ga-blue-300, #7d9bff); }
  .bpm-auto-btn.active .auto-dot.live { background: var(--ga-blue, #5278ff); box-shadow: 0 0 6px var(--ga-blue, #5278ff); }
  /* The state is still announced and in the tooltip; it is just not printed in the bar. */
  .auto-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .bpm-auto-btn.active { color: var(--ga-ink-0, #e6ebf5); }
  .bpm-auto-btn:focus-visible { outline: 2px solid var(--ga-focus, var(--ga-blue-300)); outline-offset: 2px; }
  .bpm-auto-btn:hover {
    color: var(--ga-selection-ink, #e0e8ff);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }
</style>
