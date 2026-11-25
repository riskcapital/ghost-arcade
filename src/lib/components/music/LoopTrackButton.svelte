<script lang="ts">
  /**
   * A loop track's one big button. A press (on the way down, like a
   * footswitch) takes the next step: record, close, overdub, play. Undo and
   * Stop are their own buttons beside it. With `ring`, a ring round it shows
   * where the loop is; it blinks while a stop, start or punch waits for its bar.
   */
  import { loopStationView, pressLoopTrack } from '../../music/loopStation';
  import { beatNow, buttonLabel, buttonTone, trackProgress } from '../../music/loopUi';
  import { musicStudio } from '../../music/musicStudioStore';

  let { index, size = 52, ring = false }: { index: number; size?: number; ring?: boolean } = $props();

  const v = $derived($loopStationView.tracks[index]);
  const muted = $derived($musicStudio.loopStation.tracks[index]?.muted ?? false);
  const tone = $derived(buttonTone(v, muted));
  const progress = $derived(trackProgress(v, $beatNow));
  const label = $derived(buttonLabel(v, $beatNow, muted));
  const disabled = $derived(v.noInput && v.phase === 'empty');

  function down(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    // Keep the looper panel's keys where they were.
    e.preventDefault();
    pressLoopTrack(index);
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !e.repeat) pressLoopTrack(index);
    }
  }

  const R = 46;
  const C = 2 * Math.PI * R;
</script>

<button
  class="big {tone}"
  class:ringed={ring}
  class:pending={v.pending !== null}
  style="--size: {size}px"
  {disabled}
  onpointerdown={down}
  onkeydown={key}
  aria-label="Loop track {index + 1}: {v.phase}"
  title={disabled ? 'No input: choose one in the band inputs' : v.phase === 'empty' ? 'Record: the take starts with your first note (or on the next bar, as set)' : v.phase === 'armed' ? (v.waiting ? 'Waiting for your first note · press to cancel' : 'Cancel the recording') : v.phase === 'record' ? 'Close the loop on the bar' : v.phase === 'play' ? 'Overdub from the next bar' : v.phase === 'overdub' ? 'Stop overdubbing on the next bar' : 'Play from the next bar'}
>
  {#if ring}
    <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={R} class="track" />
      {#if progress > 0}<circle cx="50" cy="50" r={R} class="fill" stroke-dasharray="{progress * C} {C}" transform="rotate(-90 50 50)" />{/if}
    </svg>
  {/if}
  <span class="face">{#if disabled}No input{:else}{label}{/if}</span>
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
  .big.rec, .big.armed { border-color: var(--studio-loop-rec); background: var(--studio-loop-rec-soft); color: var(--studio-loop-rec); }
  .big.armed { animation: loop-arm 1s ease-in-out infinite; }
  .big.dub { border-color: var(--studio-loop-dub); background: var(--studio-loop-dub-soft); color: var(--studio-loop-dub); }
  .big.play { border-color: var(--studio-loop-play); background: var(--studio-loop-play-soft); }
  .big.pending { animation: loop-pending 0.5s steps(2, jump-none) infinite; }
  @keyframes loop-arm { 50% { opacity: 0.45; } }
  @keyframes loop-pending { 50% { border-color: var(--studio-ink); } }
  @media (prefers-reduced-motion: reduce) { .big.armed, .big.pending { animation: none; } }
  .big.muted { border-color: var(--studio-muted); color: var(--studio-muted); }
  .big.ringed { border-width: 0; background: transparent; box-shadow: none; }
  .big.ringed .face { position: absolute; inset: 12%; display: grid; place-items: center; border-radius: 50%; background: var(--studio-cell); border: 1px solid var(--studio-edge-soft); }
  .big.ringed.rec .face, .big.ringed.armed .face { background: var(--studio-loop-rec); color: var(--studio-on-accent); border-color: var(--studio-loop-rec); }
  .big.ringed.dub .face { background: var(--studio-loop-dub); color: #1a1206; border-color: var(--studio-loop-dub); }
  .big.ringed.pending .ring .track { stroke: var(--studio-edge); }
  .ring { position: absolute; inset: 0; width: 100%; height: 100%; }
  .ring circle { fill: none; stroke-width: 7; }
  .ring .track { stroke: var(--studio-slot); }
  .ring .fill { stroke: var(--studio-loop-play); stroke-linecap: butt; }
  .big.rec .ring .fill, .big.armed .ring .fill { stroke: var(--studio-loop-rec); }
  .big.dub .ring .fill { stroke: var(--studio-loop-dub); }
  .big.muted .ring .fill { stroke: var(--studio-muted); }
</style>
