<script lang="ts">
  /**
   * The loop library as a launcher: a column per kind of loop. Click a loop
   * to start it on the next bar (it takes over from the loop in its column);
   * the square on a column stops it. Melodic loops follow the key and play on
   * the set's own instruments; beats load into the beat grid, ready to edit.
   */
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { BEAT_LOOPS, LOOP_CATEGORIES, MELODIC_LOOPS, ROLE_INSTRUMENTS, type LoopCategory, type LoopRole } from '../../music/loops';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { launchLoop, stopLoop, stopSequencer } from '../../music/musicRuntime';

  const s = $derived($musicStudio);
  const t = $derived($musicTransport);

  const columns = $derived(
    LOOP_CATEGORIES.map((c) => ({
      ...c,
      loops: c.id === 'beats' ? BEAT_LOOPS : MELODIC_LOOPS.filter((l) => l.role === c.id),
      voice: c.id === 'beats' ? 'Drums' : INSTRUMENT_LABELS[ROLE_INSTRUMENTS[s.set][c.id as LoopRole]],
    })),
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
</script>

<div class="launcher" role="group" aria-label="Loop library">
  {#each columns as col (col.id)}
    <div class="column">
      <div class="col-head">
        <span class="col-name">{col.label}</span>
        <span class="col-voice">{col.voice}</span>
        <button class="stop" disabled={!columnActive(col.id)} onclick={() => stop(col.id)} aria-label="Stop {col.label}" title="Stop {col.label.toLowerCase()}">
          <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1" /></svg>
        </button>
      </div>
      <div class="cells">
        {#each col.loops as loop (loop.id)}
          {@const on = playing(col.id, loop.id)}
          {@const next = queued(col.id, loop.id)}
          <button class="cell" class:on class:next onclick={() => launchLoop(loop.id)} aria-pressed={on} title={next ? 'Starts on the next bar' : on ? 'Playing' : 'Start on the next bar'}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" /></svg>
            <span>{loop.name}</span>
          </button>
        {/each}
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
  .stop {
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
  .cells { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 3px; }
  .cell {
    flex: 0 0 auto;
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
  .cell svg { flex: 0 0 auto; width: 9px; height: 9px; fill: var(--studio-muted); }
  .cell span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell:hover { border-color: var(--studio-edge); }
  .cell.next { border-color: var(--studio-accent); color: var(--studio-accent); }
  .cell.next svg { fill: var(--studio-accent); }
  .cell.on { border-color: var(--studio-accent); background: var(--studio-accent); color: var(--studio-on-accent); }
  .cell.on svg { fill: var(--studio-on-accent); }
</style>
