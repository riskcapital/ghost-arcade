<script lang="ts">
  /**
   * The loop library as a launcher: a column per kind of loop. Click a loop
   * to start it on the next bar (it takes over from the loop in its column);
   * the square on a column stops it. Loops you recorded, captured or brought
   * in from MIDI sit at the top of their column and play on the instrument
   * they were played on; library loops follow the key and play on the set's
   * own instruments. Beats load into the beat grid, ready to edit.
   */
  import { get } from 'svelte/store';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { BEAT_LOOPS, LOOP_CATEGORIES, MELODIC_LOOPS, ROLE_INSTRUMENTS, type LoopCategory, type LoopRole } from '../../music/loops';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { launchLoop, saveBeat, stopLoop, stopSequencer } from '../../music/musicRuntime';
  import { downloadMidi, loopTrack, patternTrack } from '../../music/midiExport';
  import { launchClockTempo } from '../../stores/launchClock';

  /** `compact`: the tray's narrower columns, without play marks. */
  let { compact = false }: { compact?: boolean } = $props();

  const s = $derived($musicStudio);
  const t = $derived($musicTransport);

  interface Entry {
    id: string;
    name: string;
    mine: boolean;
    detail?: string;
  }

  const columns = $derived(
    LOOP_CATEGORIES.map((c) => {
      const mine: Entry[] =
        c.id === 'beats'
          ? s.myBeats.map((b) => ({ id: b.id, name: b.name, mine: true, detail: `${b.pattern.steps / 16} bar` }))
          : s.myLoops.filter((l) => l.role === c.id).map((l) => ({ id: l.id, name: l.name, mine: true, detail: INSTRUMENT_LABELS[l.instrument] }));
      const library: Entry[] = (c.id === 'beats' ? BEAT_LOOPS : MELODIC_LOOPS.filter((l) => l.role === c.id)).map((l) => ({ id: l.id, name: l.name, mine: false }));
      return {
        ...c,
        mine,
        library,
        voice: c.id === 'beats' ? 'Drums' : INSTRUMENT_LABELS[ROLE_INSTRUMENTS[s.set][c.id as LoopRole]],
      };
    }),
  );

  function playing(category: LoopCategory, id: string): boolean {
    if (category === 'beats') return s.sequencerPlaying && t.beatLoop === id;
    return s.playingLoops[category] === id;
  }

  function queued(category: LoopCategory, id: string): boolean {
    if (category === 'beats') return t.queuedBeat === id;
    return s.queuedLoops[category] === id;
  }

  function columnActive(category: LoopCategory): boolean {
    if (category === 'beats') return s.sequencerPlaying;
    return !!s.playingLoops[category] || !!s.queuedLoops[category];
  }

  function stop(category: LoopCategory) {
    if (category === 'beats') stopSequencer();
    else stopLoop(category);
  }

  function exportMine(id: string) {
    const state = get(musicStudio);
    const bpm = Math.round(launchClockTempo() * 10) / 10;
    const loop = state.myLoops.find((l) => l.id === id);
    if (loop) {
      downloadMidi({ bpm, tracks: [loopTrack(loop, state.key)] }, loop.name);
      return;
    }
    const beat = state.myBeats.find((b) => b.id === id);
    if (beat) downloadMidi({ bpm, tracks: [patternTrack(beat.pattern, beat.name)] }, beat.name);
  }

  function remove(category: LoopCategory, id: string) {
    if (category !== 'beats' && s.playingLoops[category] === id) stopLoop(category);
    musicStudio.removeMine(id);
  }
</script>

{#snippet cell(col: (typeof columns)[number], entry: Entry)}
  {@const on = playing(col.id, entry.id)}
  {@const next = queued(col.id, entry.id)}
  <div class="row" class:mine={entry.mine}>
    <button class="cell" class:on class:next onclick={() => launchLoop(entry.id)} aria-pressed={on} title={next ? 'Starts on the next bar' : on ? 'Playing' : entry.detail ? `${entry.detail} · start on the next bar` : 'Start on the next bar'}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" /></svg>
      <span>{entry.name}</span>
    </button>
    {#if entry.mine}
      <button class="act" onclick={() => exportMine(entry.id)} aria-label="Save {entry.name} as MIDI" title="Save as a MIDI file">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v6M3.5 5L6 7.5 8.5 5M2 10.5h8" /></svg>
      </button>
      <button class="act" onclick={() => remove(col.id, entry.id)} aria-label="Delete {entry.name}" title="Delete">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" /></svg>
      </button>
    {/if}
  </div>
{/snippet}

<div class="launcher" class:compact role="group" aria-label="Loop library">
  {#each columns as col (col.id)}
    <div class="column">
      <div class="col-head">
        <span class="col-name">{col.label}</span>
        <span class="col-voice">{col.voice}</span>
        {#if col.id === 'beats'}
          <button class="keep" onclick={saveBeat} title="Keep the beat in the grid as one of your beats">SAVE</button>
        {/if}
        <button class="stop" disabled={!columnActive(col.id)} onclick={() => stop(col.id)} aria-label="Stop {col.label}" title="Stop {col.label.toLowerCase()}">
          <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1" /></svg>
        </button>
      </div>
      <div class="cells">
        {#each col.mine as entry (entry.id)}{@render cell(col, entry)}{/each}
        {#if col.mine.length}<div class="rule" aria-hidden="true"></div>{/if}
        {#each col.library as entry (entry.id)}{@render cell(col, entry)}{/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .launcher {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
  .column { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
  .col-head { height: 22px; display: flex; align-items: center; gap: 6px; padding-left: 2px; }
  .col-name { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
  .col-voice { flex: 1; min-width: 0; font-size: 10px; color: var(--studio-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stop,
  .act {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    padding: 0;
    display: inline-grid;
    place-items: center;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .stop:disabled { color: var(--studio-edge); border-color: var(--studio-edge-soft); cursor: default; }
  .stop svg { width: 9px; height: 9px; fill: currentColor; }
  .keep {
    height: 20px;
    padding: 0 6px;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .keep:hover { color: var(--studio-ink); }
  .cells { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 3px; }
  .rule { flex: 0 0 1px; margin: 3px 0; background: var(--studio-edge-soft); }
  .row { flex: 0 0 auto; display: flex; gap: 3px; min-width: 0; }
  .act { width: 22px; height: 26px; border-color: var(--studio-edge-soft); color: var(--studio-muted); opacity: 0; }
  .act svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .row:hover .act,
  .act:focus-visible { opacity: 1; }
  .act:hover { color: var(--studio-ink); border-color: var(--studio-edge); }
  .cell {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .mine .cell { background: var(--studio-slot); }
  .cell svg { flex: 0 0 auto; width: 9px; height: 9px; fill: var(--studio-muted); }
  .cell span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell:hover { border-color: var(--studio-edge); }
  .cell.next { border-color: var(--studio-accent); color: var(--studio-accent); }
  .cell.next svg { fill: var(--studio-accent); }
  .cell.on { border-color: var(--studio-accent); background: var(--studio-accent); color: var(--studio-on-accent); }
  .cell.on svg { fill: var(--studio-on-accent); }
  .compact { gap: 6px; }
  .compact .cell { height: 24px; padding: 0 6px; font-size: 11px; }
  .compact .cell svg { display: none; }
  .compact .col-voice { display: none; }
</style>
