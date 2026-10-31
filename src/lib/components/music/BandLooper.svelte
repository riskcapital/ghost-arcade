<script lang="ts">
  /**
   * The band looper: bars of the band recorded in time and looped, and
   * chopped onto the FX pads.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { chopToPads, looperState, putBackPads, selectLoopSlot, setLoopLevel, setLooperLength, toggleLoopPlay, toggleLooperRecord } from '../../music/looperRuntime';
  import { LOOP_SLOT_IDS, LOOP_SLOT_NAMES, type LoopSlotId } from '../../music/bandLooper';
  import { LOOP_LENGTHS } from '../../music/looperMath';
  import { isChopId } from '../../music/sounds/chops';
  import StudioKnob from './StudioKnob.svelte';

  const v = $derived($looperState);
  const s = $derived($musicStudio);
  const name = (id: LoopSlotId) => LOOP_SLOT_NAMES[id];
  const plural = (n: number) => `${n} bar${n === 1 ? '' : 's'}`;
  const percent = (x: number) => `${Math.round(x * 100)}%`;

  const busy = $derived(v.phase !== 'off');
  const into = $derived(v.recordingSlot ?? v.slot);
  const padsChopped = $derived(s.fxPads[s.set].some(isChopId));
  const hasLoop = $derived(v.slots.some((slot) => slot.state !== 'empty'));
  const drifting = $derived(LOOP_SLOT_IDS.filter((id) => v.slots[id].ownLength));

  const recordLabel = $derived(v.phase === 'count' ? `In ${v.countIn}` : v.phase === 'rec' ? 'Recording' : 'Record');
  const recordTitle = $derived(
    v.phase === 'off'
      ? `Record ${plural(v.length)} of the band into loop ${name(v.slot)} from the next bar; it then loops in time`
      : v.phase === 'rec'
        ? 'End the recording on the next bar line'
        : 'Cancel the recording',
  );
  const status = $derived.by(() => {
    if (v.phase === 'arming') return 'Getting the recorder ready…';
    if (v.phase === 'count') return `Counting in: ${plural(v.bars)} into loop ${name(into)}`;
    if (v.phase === 'rec') return `Recording loop ${name(into)}: bar ${v.bar} of ${v.bars}`;
    if (drifting.length) return `Loop ${drifting.map(name).join(' and ')} keeps its own length: the tempo has moved too far since it was recorded.`;
    return 'Records the band from the next bar line and loops it in time.';
  });

  function playLabel(id: LoopSlotId): string {
    const state = v.slots[id].state;
    return state === 'playing' ? `Playing ${name(id)}` : state === 'queued' ? 'Next bar' : `Play ${name(id)}`;
  }

  function playTitle(id: LoopSlotId): string {
    const slot = v.slots[id];
    if (slot.state === 'empty') return `Nothing recorded in loop ${name(id)} yet`;
    if (slot.state === 'stopped') return `Play loop ${name(id)} (${plural(slot.bars)}) from the next bar, in time`;
    return `Stop loop ${name(id)}`;
  }
</script>

<section class="looper">
  <span class="ga-eyebrow">Looper</span>
  <div class="row choices">
    <div class="ga-segmented small" role="group" aria-label="Bars to record">
      {#each LOOP_LENGTHS as bars (bars)}
        <button class:active={v.length === bars} aria-pressed={v.length === bars} onclick={() => setLooperLength(bars)} title="Record {plural(bars)}">{bars}</button>
      {/each}
    </div>
    <div class="ga-segmented small" role="group" aria-label="Loop to record into and chop">
      {#each LOOP_SLOT_IDS as id (id)}
        <button class:active={v.slot === id} aria-pressed={v.slot === id} onclick={() => selectLoopSlot(id)} title="Record into loop {name(id)}, and chop it">{name(id)}</button>
      {/each}
    </div>
  </div>

  <div class="row">
    <div class="rec-col">
      <button
        class="hold rec"
        class:on={v.phase === 'rec'}
        class:count={v.phase === 'count' || v.phase === 'arming'}
        aria-pressed={busy}
        onclick={toggleLooperRecord}
        title={recordTitle}
        data-midi-path="studio:looper.record"
        data-midi-label="Looper record"
      ><span class="dot" aria-hidden="true"></span>{recordLabel}</button>
      <span class="progress" role="progressbar" aria-label="Recording" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.progress * 100)}>
        <span class="fill" style="width: {v.phase === 'rec' ? v.progress * 100 : 0}%"></span>
      </span>
    </div>
    {#each LOOP_SLOT_IDS as id (id)}
      {@const slot = v.slots[id]}
      <div class="slot">
        <button
          class="hold"
          class:on={slot.state === 'playing'}
          class:queued={slot.state === 'queued'}
          aria-pressed={slot.state === 'playing' || slot.state === 'queued'}
          disabled={slot.state === 'empty'}
          onclick={() => toggleLoopPlay(id)}
          title={playTitle(id)}
          data-midi-path="studio:looper.play-{id === 0 ? 'a' : 'b'}"
          data-midi-label="Play loop {name(id)}"
        >{playLabel(id)}</button>
        <StudioKnob label="Level" value={slot.level} defaultValue={0.8} size={24} format={percent} title="How loud loop {name(id)} plays" onchange={(x) => setLoopLevel(id, x)} />
      </div>
    {/each}
  </div>

  <span class="status" aria-live="polite">{status}</span>
  {#if v.error}<span class="error" role="alert">{v.error}</span>{:else if v.note}<span class="hint">{v.note}</span>{/if}

  <div class="row">
    <button
      class="studio-btn"
      disabled={!hasLoop}
      onclick={() => chopToPads()}
      title="Slice loop {name(v.slot)} into eight and put the slices on this set's FX pads"
      data-midi-path="studio:looper.chop"
      data-midi-label="Chop loop to pads"
    >Chop to pads</button>
    <button class="studio-btn" disabled={!padsChopped} onclick={putBackPads} title="Put back the sounds the FX pads had before they were chopped">Put back pads</button>
  </div>
  <span class="hint">Chops play from the FX pads until the studio closes. They are not saved with the project.</span>
</section>

<style>
  section { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: 300px; }
  .row { display: flex; align-items: flex-start; gap: 8px; }
  .choices { align-items: center; }
  .rec-col, .slot { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .hold {
    min-width: 64px;
    height: 44px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
  }
  .hold:disabled { opacity: 0.4; cursor: default; }
  .hold.on { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); }
  .hold.queued { border-color: var(--studio-accent); color: var(--studio-accent); }
  /* Wide enough for every label, so the row does not shift as they change. */
  .slot .hold { min-width: 88px; }
  /* Record keeps the record red, as the other record buttons do. */
  .rec { min-width: 100px; }
  .rec .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ga-rec, #ff3b30); opacity: 0.55; }
  .rec.on { background: var(--studio-cell); border-color: var(--ga-rec, #ff3b30); color: var(--ga-rec, #ff3b30); }
  .rec.on .dot { opacity: 1; }
  .rec.count { border-color: var(--ga-rec, #ff3b30); color: var(--ga-rec, #ff3b30); }
  .rec.count .dot { animation: looper-blink 0.5s steps(2, jump-none) infinite; }
  @keyframes looper-blink { 50% { opacity: 0.2; } }
  .progress { width: 100%; height: 3px; border-radius: 2px; background: var(--studio-edge-soft); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--ga-rec, #ff3b30); }
  .status { font-size: var(--ga-text-control, 12px); color: var(--studio-ink); font-variant-numeric: tabular-nums; }
  .hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); line-height: 1.35; }
  .error { font-size: var(--ga-text-meta, 11px); color: var(--ga-danger, #ff6b6b); }
</style>
