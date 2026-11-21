<script lang="ts">
  /**
   * A loop track's one big button. Press: the next step (record, close,
   * overdub, play). Hold: undo the last layer. Two quick presses: stop.
   * With `ring`, a ring round it shows where the loop is.
   */
  import { loopStationView, pressLoopTrack, stopLoopTrack, undoLoopLayer } from '../../music/loopStation';
  import { beatNow, buttonTone, trackProgress } from '../../music/loopUi';
  import { musicStudio } from '../../music/musicStudioStore';

  let { index, size = 52, ring = false }: { index: number; size?: number; ring?: boolean } = $props();

  const HOLD_MS = 500;
  const DOUBLE_MS = 350;

  const v = $derived($loopStationView.tracks[index]);
  const muted = $derived($musicStudio.loopStation.tracks[index]?.muted ?? false);
  const tone = $derived(buttonTone(v, muted));
  const progress = $derived(trackProgress(v, $beatNow));
  const left = $derived(v.phase === 'armed' ? Math.max(1, Math.ceil(v.startBeat - $beatNow)) : v.phase === 'record' && v.endBeat !== null ? Math.max(1, Math.ceil((v.endBeat - $beatNow) / 4)) : 0);
  const disabled = $derived(v.noInput && v.phase === 'empty');

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let lastPress = 0;

  function down(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    held = false;
    holdTimer = setTimeout(() => {
      held = true;
      undoLoopLayer(index);
    }, HOLD_MS);
  }

  function up() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    if (held || disabled) return;
    const now = performance.now();
    if (now - lastPress < DOUBLE_MS && (v.phase === 'play' || v.phase === 'overdub')) {
      lastPress = 0;
      stopLoopTrack(index);
      return;
    }
    lastPress = now;
    pressLoopTrack(index);
  }

  function cancel() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) pressLoopTrack(index);
    }
  }

  const R = 46;
  const C = 2 * Math.PI * R;
</script>

<button
  class="big {tone}"
  class:ringed={ring}
  style="--size: {size}px"
  {disabled}
  onpointerdown={down}
  onpointerup={up}
  onpointerleave={cancel}
  onkeydown={key}
  aria-label="Loop track {index + 1}: {v.phase}"
  title={disabled ? 'No input: choose one in the band inputs' : v.phase === 'empty' ? 'Record from the next bar · hold to undo · double-press to stop' : v.phase === 'armed' ? 'Cancel the recording' : v.phase === 'record' ? 'Close the loop on the bar' : v.phase === 'play' ? 'Overdub from the next bar · hold to undo a layer · double-press to stop' : v.phase === 'overdub' ? 'Stop overdubbing on the next bar · hold to undo a layer' : 'Play from the next bar'}
>
  {#if ring}
    <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={R} class="track" />
      {#if progress > 0}<circle cx="50" cy="50" r={R} class="fill" stroke-dasharray="{progress * C} {C}" transform="rotate(-90 50 50)" />{/if}
    </svg>
  {/if}
  <span class="face">
    {#if disabled}No input{:else if v.phase === 'empty'}Rec{:else if v.phase === 'armed'}In {left}{:else if v.phase === 'record'}{#if v.setsTempo}Set{:else if v.endBeat !== null}Rec {left}{:else}Rec{/if}{:else if v.phase === 'overdub'}Dub{:else if v.phase === 'play'}{#if muted}Muted{:else}Play{/if}{:else}Stopped{/if}
  </span>
</button>

<style>
  .big {
    position: relative;
    flex: none;
    width: var(--size);
    height: var(--size);
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    display: grid;
    place-items: center;
    font: inherit;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }
  .big:disabled { cursor: default; color: var(--studio-muted); }
  .big.rec { border-color: var(--studio-rec); background: var(--studio-rec-soft); color: var(--studio-rec); box-shadow: 0 0 0 4px rgba(255, 107, 87, 0.08); }
  .big.play { border-color: var(--studio-accent); background: var(--studio-accent-soft); }
  .big.muted { border-color: var(--studio-muted); color: var(--studio-muted); }
  .big.ringed { border-width: 0; background: transparent; box-shadow: none; }
  .big.ringed .face { position: absolute; inset: 12%; display: grid; place-items: center; border-radius: 50%; background: var(--studio-cell); border: 1px solid var(--studio-edge-soft); }
  .big.ringed.rec .face { background: var(--studio-rec); color: var(--studio-on-accent); border-color: var(--studio-rec); }
  .ring { position: absolute; inset: 0; width: 100%; height: 100%; }
  .ring circle { fill: none; stroke-width: 7; }
  .ring .track { stroke: var(--studio-slot); }
  .ring .fill { stroke: var(--studio-accent); stroke-linecap: butt; }
  .big.rec .ring .fill { stroke: var(--studio-rec); }
  .big.muted .ring .fill { stroke: var(--studio-muted); }
</style>
