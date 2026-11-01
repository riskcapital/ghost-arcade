<script lang="ts">
  /**
   * Tempo for playing with a live band, next to the BPM: Tap (hold it for
   * the downbeat), 1 (this is beat 1), hold ‹ › to nudge into phase, and a
   * menu for half, double and following the band's audio. Alt+T taps and
   * Alt+1 marks the downbeat from the keyboard without touching the piano keys.
   */
  import { onDestroy } from 'svelte';
  import { audioManualBpm } from '../../stores/audio';
  import { setFollowBand, studioDownbeat, studioNudge, studioScaleTempo, studioTapPulse, tapStudioTempo } from '../../music/studioTempo';

  let { tempo }: { tempo: number } = $props();

  let flash = $state(false);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let menu = $state(false);
  const following = $derived($audioManualBpm === null);
  const pulse = $derived($studioTapPulse);

  function blink() {
    flash = true;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash = false), 110);
  }

  function tap() {
    tapStudioTempo();
    blink();
  }

  function downbeat() {
    if (studioDownbeat()) blink();
  }

  // Tap on press; held past half a second it is the downbeat instead.
  function tapDown(e: PointerEvent) {
    if (e.button !== 0) return;
    held = false;
    tap();
    holdTimer = setTimeout(() => { held = true; downbeat(); }, 550);
  }
  function tapUp() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  }

  function key(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'KeyT') { e.preventDefault(); if (!e.repeat) tap(); }
    else if (e.code === 'Digit1') { e.preventDefault(); if (!e.repeat) downbeat(); }
  }

  onDestroy(() => {
    studioNudge(0);
    if (flashTimer) clearTimeout(flashTimer);
    if (holdTimer) clearTimeout(holdTimer);
  });
</script>

<svelte:window onkeydown={key} />

<span class="tempo" class:flash title={pulse.bpm === null && pulse.count > 0 && pulse.count < 4 ? `Tap ${4 - pulse.count} more` : `${tempo.toFixed(1)} BPM`}>
  <span class="tempo-value">{tempo.toFixed(1)}</span> <span class="tempo-unit">BPM</span>
</span>
<div class="tempo-tools" role="group" aria-label="Tempo">
  <button
    class="text-btn tap"
    onpointerdown={tapDown}
    onpointerup={tapUp}
    onpointerleave={tapUp}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } }}
    title="Tap along with the band, 4 taps or more (Alt+T). Hold for the downbeat."
    data-midi-path="studio:tempo.tap"
    data-midi-label="Tap tempo"
    data-midi-mode="toggle"
  >Tap</button>
  <button class="text-btn one wide" onclick={downbeat} title="Downbeat: this is beat 1 (Alt+1). The tempo stays." data-midi-path="studio:tempo.downbeat" data-midi-label="Downbeat" data-midi-mode="toggle">1</button>
  <button class="text-btn nudge wide" onpointerdown={() => studioNudge(-1)} onpointerup={() => studioNudge(0)} onpointerleave={() => studioNudge(0)} title="Hold to slow down a little and drift back into phase" aria-label="Nudge slower" data-midi-path="studio:tempo.nudge-down" data-midi-label="Nudge slower">‹</button>
  <button class="text-btn nudge wide" onpointerdown={() => studioNudge(1)} onpointerup={() => studioNudge(0)} onpointerleave={() => studioNudge(0)} title="Hold to speed up a little and drift into phase" aria-label="Nudge faster" data-midi-path="studio:tempo.nudge-up" data-midi-label="Nudge faster">›</button>
  <button class="text-btn more" class:on={following} onclick={() => (menu = !menu)} aria-expanded={menu} aria-label="More tempo" title="Half, double, follow the band">▾</button>
  {#if menu}
    <div class="menu" role="dialog" aria-label="More tempo">
      <button class="text-btn narrow" onclick={downbeat} title="Downbeat: this is beat 1 (Alt+1)">1</button>
      <button class="text-btn narrow" onpointerdown={() => studioNudge(-1)} onpointerup={() => studioNudge(0)} onpointerleave={() => studioNudge(0)} title="Hold to slow down a little" aria-label="Nudge slower">‹</button>
      <button class="text-btn narrow" onpointerdown={() => studioNudge(1)} onpointerup={() => studioNudge(0)} onpointerleave={() => studioNudge(0)} title="Hold to speed up a little" aria-label="Nudge faster">›</button>
      <button class="text-btn" onclick={() => studioScaleTempo(0.5)} title="Taps landed on double time" data-midi-path="studio:tempo.half" data-midi-label="Half the tempo" data-midi-mode="toggle">÷2</button>
      <button class="text-btn" onclick={() => studioScaleTempo(2)} title="Taps landed on half time" data-midi-path="studio:tempo.double" data-midi-label="Double the tempo" data-midi-mode="toggle">×2</button>
      <label class="follow" title="Follow the tempo detected from the audio input (a band feed or mic); turn off to lock it where it is">
        <input type="checkbox" checked={following} onchange={() => setFollowBand(!following)} /> Follow the band
      </label>
    </div>
  {/if}
</div>

<style>
  .tempo { display: inline-flex; align-items: baseline; gap: 4px; margin-left: 4px; border-radius: 3px; transition: background 0.1s; }
  .tempo.flash { background: var(--studio-accent-soft); }
  .tempo-value { font-family: var(--ga-font-mono, ui-monospace); font-variant-numeric: tabular-nums; color: var(--studio-ink); }
  .tempo-unit { font-size: var(--ga-text-meta, 11px); font-weight: var(--ga-weight-control, 600); color: var(--studio-muted); }
  .tempo-tools { position: relative; display: inline-flex; align-items: center; gap: 2px; }
  .tempo-tools > .text-btn { min-width: 0; padding: 0 6px; touch-action: none; }
  .tap { padding: 0 8px; }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    white-space: nowrap;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: var(--studio-panel);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  }
  .narrow { display: none; touch-action: none; }
  /* Narrower windows: 1 and the nudges move into the menu (holding Tap is still the downbeat). */
  @media (max-width: 1439px) {
    .wide { display: none; }
    .narrow { display: inline-block; }
    .tempo-unit { display: none; }
  }
  .follow { display: inline-flex; align-items: center; gap: 5px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
</style>
