<script lang="ts">
  /**
   * The song now up, with the previous and next in the set list. A song
   * waiting for the bar shows as waiting; pressing towards it again brings
   * it up at once.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { nextSong, prevSong, queuedSong, songAlongSetlist } from '../../music/songRuntime';

  const s = $derived($musicStudio);
  const waiting = $derived($queuedSong);
  const current = $derived(s.songs.find((x) => x.id === s.currentSongId) ?? null);
  const waitingSong = $derived(waiting ? (s.songs.find((x) => x.id === waiting.songId) ?? null) : null);
  const prev = $derived(songAlongSetlist(s, -1));
  const next = $derived(songAlongSetlist(s, 1));
  const isWaiting = (along: { cursor: number } | null) => !!along && !!waiting && waiting.cursor === along.cursor;

  function stepTitle(along: { song: { name: string }; cursor: number } | null, which: string, end: string): string {
    if (!along) return end;
    return isWaiting(along) ? `Bring ${along.song.name} up now` : `${which}: ${along.song.name}, on the next bar (press again for now)`;
  }
</script>

<div class="song-strip" role="group" aria-label="Songs">
  <button
    class="icon-btn step"
    class:off={!prev}
    aria-disabled={!prev}
    onclick={() => prevSong()}
    aria-label="Previous song"
    title={stepTitle(prev, 'Previous song', 'At the start of the set list')}
    data-midi-path="studio:song.prev"
    data-midi-label="Previous song"
    data-midi-mode="toggle"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
  </button>
  <span class="now" class:waiting={!!waitingSong} title={waitingSong ? `${waitingSong.name} comes up on the next bar` : current ? `Song now: ${current.name}` : 'No song called up yet'}>
    {#if waitingSong}
      <span class="name">{waitingSong.name}</span><span class="when">next bar</span>
    {:else}
      <span class="name" class:none={!current}>{current?.name ?? 'No song'}</span>
    {/if}
  </span>
  <button
    class="icon-btn step"
    class:off={!next}
    class:armed={isWaiting(next)}
    aria-disabled={!next}
    onclick={() => nextSong()}
    aria-label="Next song"
    title={stepTitle(next, 'Next song', s.setlists.length ? 'At the end of the set list' : 'Make a set list in the Songs tab')}
    data-midi-path="studio:song.next"
    data-midi-label="Next song"
    data-midi-mode="toggle"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  </button>
  {#if next && !isWaiting(next)}<span class="up" title="Next in the set list">Next: {next.song.name}</span>{/if}
</div>

<style>
  .song-strip { display: flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; }
  .step { width: 26px; height: 26px; display: inline-grid; place-items: center; }
  .step svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .step.off { opacity: 0.35; cursor: default; }
  .step.armed { border-color: var(--studio-accent); color: var(--studio-accent); }
  .now {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    min-width: 72px;
    max-width: 170px;
    padding: 0 4px;
    overflow: hidden;
  }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--studio-ink); font-weight: var(--ga-weight-control, 600); }
  .name.none { color: var(--studio-muted); font-weight: inherit; }
  .waiting .name { color: var(--studio-accent); }
  .when { flex: 0 0 auto; font-size: var(--ga-text-meta, 11px); color: var(--studio-accent); }
  .up { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
</style>
