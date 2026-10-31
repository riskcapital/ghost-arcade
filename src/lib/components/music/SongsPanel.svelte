<script lang="ts">
  /**
   * Songs and set lists: setups kept per song, played in order.
   *
   * On the left, every song: call one up, rename it, its tempo, what calling
   * it up puts back, notes, keep what is set up now in it. On the right, the
   * set list being played: the songs in order (one can come more than once),
   * the song now up and the one after it.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { MAX_SONG_BPM, MIN_SONG_BPM, nextSetlistName, type Song, type SongRecallGroup } from '../../music/songs';
  import {
    activeSetlist,
    callSong,
    currentSetlistCursor,
    goToSong,
    queuedSong,
    saveSong,
    songAlongSetlist,
    songGo,
    songNotice,
    updateSongFromNow,
  } from '../../music/songRuntime';
  import { confirmPrompt } from '../../stores/confirmPrompt';
  import { launchClockTempo } from '../../stores/launchClock';
  import { abletonLink } from '../../sync/abletonLink';
  import { generateUUID } from '../../utils/uuid';

  const RECALL: { id: SongRecallGroup; label: string; title: string }[] = [
    { id: 'sound', label: 'Sound', title: 'Calling it up puts back the set, sounds, key, beat and mixer' },
    { id: 'band', label: 'Live band', title: "Calling it up puts back the band inputs' roles and levels, and the band's effects" },
    { id: 'visuals', label: 'Visuals', title: 'Calling it up puts back the looks on each instrument feed, the VJ block and column, and the stage preset' },
  ];

  const s = $derived($musicStudio);
  const waiting = $derived($queuedSong);
  const list = $derived(activeSetlist(s));
  const cursor = $derived(currentSetlistCursor(s));
  const upNext = $derived(songAlongSetlist(s, 1));
  const current = $derived(s.songs.find((x) => x.id === s.currentSongId) ?? null);
  const linkTempo = $derived($abletonLink.enabled && $abletonLink.peers > 0);
  const byId = $derived(new Map(s.songs.map((song) => [song.id, song])));
  let notesOpen = $state<string | null>(null);

  /** Ask before something that cannot be undone. */
  function ask(e: MouseEvent, title: string, subtitle: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) =>
      confirmPrompt.set({ title, subtitle, confirmLabel, cancelLabel: 'Cancel', destructive: true, anchorX: e.clientX, anchorY: e.clientY, resolve }),
    );
  }

  function rename(song: Song, value: string) {
    musicStudio.updateSong(song.id, { name: value.trim().slice(0, 60) || song.name });
  }

  function setBpm(song: Song, value: string) {
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n)) return;
    musicStudio.updateSong(song.id, { bpm: Math.max(MIN_SONG_BPM, Math.min(MAX_SONG_BPM, Math.round(n * 10) / 10)) });
  }

  function toggleTempo(song: Song) {
    const now = Math.max(MIN_SONG_BPM, Math.min(MAX_SONG_BPM, Math.round(launchClockTempo() * 10) / 10));
    musicStudio.updateSong(song.id, { bpm: song.bpm === null ? now : null });
  }

  function toggleRecall(song: Song, group: SongRecallGroup) {
    musicStudio.updateSong(song.id, { recall: { ...song.recall, [group]: !song.recall[group] } });
  }

  async function update(e: MouseEvent, song: Song) {
    if (!(await ask(e, `Keep what is set up now in "${song.name}"?`, 'Its sounds, band settings, tempo and visuals are replaced. Its name, notes and what it puts back stay.', 'Replace'))) return;
    updateSongFromNow(song.id);
  }

  async function remove(e: MouseEvent, song: Song) {
    if (!(await ask(e, `Delete "${song.name}"?`, 'It comes out of every set list too. This cannot be undone.', 'Delete'))) return;
    if (notesOpen === song.id) notesOpen = null;
    musicStudio.removeSong(song.id);
  }

  function newSetlist() {
    musicStudio.addSetlist({ id: generateUUID(), name: nextSetlistName(s.setlists), songIds: [] });
  }

  async function removeSetlist(e: MouseEvent) {
    if (!list) return;
    if (!(await ask(e, `Delete the set list "${list.name}"?`, 'Its songs stay in the song list. This cannot be undone.', 'Delete'))) return;
    musicStudio.removeSetlist(list.id);
  }

  /** Add a song to the end of the set list (starting one when there is none). */
  function addToSetlist(song: Song) {
    if (!list) {
      musicStudio.addSetlist({ id: generateUUID(), name: nextSetlistName(s.setlists), songIds: [song.id] });
      return;
    }
    musicStudio.setSetlistSongs(list.id, [...list.songIds, song.id]);
  }

  /**
   * Change the set list's order, keeping the song now up at its place:
   * `place(i)` is where the song at i goes (null: taken out).
   */
  function reorder(ids: string[], place: (i: number) => number | null) {
    if (!list) return;
    const at = s.setlistCursor;
    musicStudio.setSetlistSongs(list.id, ids);
    if (at >= 0) musicStudio.setCurrentSong(s.currentSongId, place(at) ?? -1);
  }

  function move(i: number, by: -1 | 1) {
    if (!list) return;
    const j = i + by;
    if (j < 0 || j >= list.songIds.length) return;
    const ids = [...list.songIds];
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids, (k) => (k === i ? j : k === j ? i : k));
  }

  function takeOut(i: number) {
    if (!list) return;
    reorder(list.songIds.filter((_, k) => k !== i), (k) => (k === i ? null : k > i ? k - 1 : k));
  }

  const isWaiting = (songId: string, at = -2) => !!waiting && waiting.songId === songId && (at === -2 || waiting.cursor === at);
  const callTitle = (songId: string, at = -2) => (isWaiting(songId, at) ? 'Bring it up now' : 'Call it up on the next bar (press again for now)');
</script>

{#snippet play(waitingNow: boolean, label: string, title: string, run: () => void)}
  <button class="go" class:waiting={waitingNow} onclick={run} aria-label={label} {title}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l14 8-14 8z" /></svg>
  </button>
{/snippet}

{#snippet cross(label: string, title: string, run: (e: MouseEvent) => void)}
  <button class="icon-btn" onclick={run} aria-label={label} {title}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
  </button>
{/snippet}

<div class="songs">
  <section class="library" aria-label="Songs">
    <div class="col-head">
      <span class="ga-eyebrow">Songs</span>
      {#if $songNotice}<span class="notice" role="status">{$songNotice}</span>{/if}
      <span class="spacer"></span>
      <button class="text-btn small" onclick={() => saveSong()} title="Keep everything set up now as a new song: sounds, key, tempo, band settings and visuals. It goes on the end of the set list.">+ Save as song</button>
    </div>
    <div class="rows">
      {#each s.songs as song (song.id)}
        {@const up = s.currentSongId === song.id}
        <div class="song" class:up class:waiting={isWaiting(song.id)}>
          <div class="line">
            <div class="name-cell">
              {@render play(isWaiting(song.id), `Call up ${song.name}`, callTitle(song.id), () => callSong(song.id, { history: true }))}
              <input class="name" value={song.name} onchange={(e) => rename(song, (e.target as HTMLInputElement).value)} aria-label="Song name" maxlength="60" />
            </div>
            <span class="tempo" title={linkTempo ? 'Ableton Link has the tempo while it has peers, so this is left to it' : ''}>
              <input type="checkbox" checked={song.bpm !== null} onchange={() => toggleTempo(song)} aria-label="Set the tempo" title={song.bpm === null ? 'Leaves the tempo as it is (to the band, Link or tap). Tick to set it.' : 'Sets the tempo when it comes up. Untick to leave the tempo as it is.'} />
              <input
                class="bpm"
                type="number"
                min={MIN_SONG_BPM}
                max={MAX_SONG_BPM}
                step="0.1"
                value={song.bpm ?? ''}
                placeholder="Leave"
                disabled={song.bpm === null}
                onchange={(e) => setBpm(song, (e.target as HTMLInputElement).value)}
                aria-label="Tempo in BPM"
                title="The tempo it sets"
              />
              <span class="unit" class:link={linkTempo && song.bpm !== null}>{linkTempo && song.bpm !== null ? 'Link' : 'BPM'}</span>
            </span>
            <div class="ga-segmented small recall" role="group" aria-label="What calling it up puts back">
              {#each RECALL as r (r.id)}
                <button class:active={song.recall[r.id]} aria-pressed={song.recall[r.id]} onclick={() => toggleRecall(song, r.id)} title={r.title}>{r.label}</button>
              {/each}
            </div>
            <button class="text-btn small" class:on={notesOpen === song.id || !!song.notes} aria-expanded={notesOpen === song.id} onclick={() => (notesOpen = notesOpen === song.id ? null : song.id)} title={song.notes ? song.notes : 'Add a note: cues, who counts in'}>Notes</button>
            <button class="text-btn small" onclick={(e) => update(e, song)} title="Keep what is set up now in this song">Update</button>
            <button class="icon-btn add" onclick={() => addToSetlist(song)} aria-label="Add {song.name} to the set list" title={list ? `Add to the end of ${list.name}` : 'Start a set list with this song'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
            </button>
            {@render cross(`Delete ${song.name}`, 'Delete song', (e) => remove(e, song))}
          </div>
          {#if notesOpen === song.id}
            <textarea
              class="notes"
              value={song.notes}
              onchange={(e) => musicStudio.updateSong(song.id, { notes: (e.target as HTMLTextAreaElement).value.slice(0, 2000) })}
              placeholder="Cues, who counts in, what to watch for"
              aria-label="Notes for {song.name}"
              rows="2"
            ></textarea>
          {/if}
        </div>
      {:else}
        <p class="empty">Set up a song's sounds, band and visuals, then press Save as song.</p>
      {/each}
    </div>
  </section>

  <section class="setlist" aria-label="Set list">
    <div class="col-head">
      <span class="ga-eyebrow">Set list</span>
      {#if s.setlists.length}
        <select value={s.activeSetlistId ?? ''} onchange={(e) => musicStudio.setActiveSetlist((e.target as HTMLSelectElement).value || null)} aria-label="Set list to play" title="The set list next and previous walk">
          {#each s.setlists as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
        </select>
      {/if}
      <span class="spacer"></span>
      {#if list?.songIds.length}
        <button class="text-btn small go-btn" class:on={!!waiting} onclick={() => songGo()} title="Bring the waiting song up now, or else the next one in the set list" data-midi-path="studio:song.go" data-midi-label="Go: the waiting or next song now" data-midi-mode="toggle">Go</button>
      {/if}
      <button class="text-btn small" onclick={newSetlist} title="Start a new, empty set list and play it">+ New list</button>
      {#if list}
        {@render cross(`Delete set list ${list.name}`, 'Delete this set list (its songs stay)', removeSetlist)}
      {/if}
    </div>
    {#if list}
      <input class="list-name" value={list.name} onchange={(e) => musicStudio.renameSetlist(list.id, (e.target as HTMLInputElement).value.slice(0, 60))} aria-label="Set list name" maxlength="60" />
      {#if list.songIds.length}
        <ol class="rows">
          {#each list.songIds as id, i (`${i}:${id}`)}
            {@const song = byId.get(id)}
            {#if song}
              {@const here = cursor === i}
              {@const next = upNext?.cursor === i}
              <li class="entry" class:up={here} class:waiting={isWaiting(id, i)}>
                <span class="num">{i + 1}</span>
                {@render play(isWaiting(id, i), `Play from ${song.name}`, isWaiting(id, i) ? 'Bring it up now' : 'Play from here: call it up on the next bar (press again for now)', () => goToSong(i, { history: true }))}
                <span class="entry-name">{song.name}</span>
                {#if isWaiting(id, i)}<span class="tag accent">Next bar</span>{:else if here}<span class="tag accent">Now</span>{:else if next}<span class="tag">Next</span>{/if}
                <button class="icon-btn" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move {song.name} up" title="Earlier in the set">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                </button>
                <button class="icon-btn" onclick={() => move(i, 1)} disabled={i === list.songIds.length - 1} aria-label="Move {song.name} down" title="Later in the set">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {@render cross(`Take ${song.name} out of the set list`, 'Take it out of the set list (the song stays)', () => takeOut(i))}
              </li>
            {/if}
          {/each}
        </ol>
      {:else}
        <p class="empty">Add songs to it with the + beside each song.</p>
      {/if}
      {#if current?.notes}
        <p class="cue"><span class="ga-eyebrow">{current.name}</span> {current.notes}</p>
      {/if}
    {:else}
      <p class="empty">Make a set list to play your songs in order, with next and previous.</p>
    {/if}
  </section>
</div>

<style>
  .songs {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 14px;
  }
  section { min-height: 0; display: flex; flex-direction: column; gap: 6px; }
  .col-head { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; min-height: 22px; }
  .spacer { flex: 1; }
  .notice { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .rows { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .empty { margin: 4px 0; color: var(--studio-muted); font-size: var(--ga-text-meta, 11px); line-height: 1.5; }

  /* ── A song ── */
  .song { display: flex; flex-direction: column; gap: 4px; }
  .line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .name-cell, .entry {
    height: 28px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
  }
  .name-cell { flex: 1 1 120px; min-width: 100px; padding: 0 4px 0 2px; }
  .song.up .name-cell, .entry.up { border-color: var(--studio-accent); background: var(--studio-accent); color: var(--studio-on-accent); }
  .song.waiting .name-cell, .entry.waiting { border-color: var(--studio-accent); color: var(--studio-accent); }
  .go {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .go svg { width: 10px; height: 10px; fill: currentColor; }
  .go.waiting svg { animation: studio-blink 0.5s steps(2, jump-none) infinite; }
  .name {
    min-width: 0;
    flex: 1;
    height: 22px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: var(--ga-weight-control, 600);
    border-radius: var(--studio-radius);
  }
  .name:focus, .list-name:focus { border-color: var(--studio-edge); background: var(--studio-slot); color: var(--studio-ink); }
  .tempo { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; }
  .tempo input[type='checkbox'] { margin: 0; accent-color: var(--studio-accent); }
  .bpm {
    width: 56px;
    height: 22px;
    box-sizing: border-box;
    padding: 0 4px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font-family: var(--ga-font-mono, ui-monospace);
    font-size: var(--ga-text-control, 12px);
    font-variant-numeric: tabular-nums;
  }
  .bpm:disabled { color: var(--studio-muted); border-style: dashed; }
  .unit { width: 28px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .unit.link { color: var(--studio-accent); }
  .recall { flex: 0 0 auto; }
  .text-btn.on { border-color: var(--studio-muted); }
  .go-btn.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .icon-btn { flex: 0 0 auto; display: grid; place-items: center; }
  .icon-btn svg { width: 12px; height: 12px; }
  .icon-btn:disabled { opacity: 0.35; cursor: default; }
  .notes {
    margin-left: 26px;
    min-height: 40px;
    resize: vertical;
    padding: 4px 6px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
  }

  /* ── The set list ── */
  .setlist select { min-width: 0; max-width: 150px; }
  .list-name {
    flex: 0 0 auto;
    height: 22px;
    padding: 0 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--studio-ink);
    font: inherit;
    font-weight: var(--ga-weight-control, 600);
    border-radius: var(--studio-radius);
  }
  .entry { flex: 0 0 auto; padding: 0 3px 0 0; gap: 4px; }
  .entry .icon-btn { width: 20px; height: 20px; border-color: transparent; color: inherit; }
  .entry .icon-btn:hover:not(:disabled) { border-color: var(--studio-edge); }
  .num { width: 22px; text-align: right; font-family: var(--ga-font-mono, ui-monospace); font-size: var(--ga-text-meta, 11px); opacity: 0.7; font-variant-numeric: tabular-nums; }
  .entry-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--ga-weight-control, 600); }
  .tag { flex: 0 0 auto; padding: 0 5px; border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); font-size: var(--ga-text-micro, 9px); line-height: 14px; color: var(--studio-muted); }
  .tag.accent { border-color: currentColor; color: inherit; }
  .cue { flex: 0 0 auto; margin: 0; padding: 4px 6px; border-left: 2px solid var(--studio-accent); font-size: var(--ga-text-control, 12px); color: var(--studio-ink); line-height: 1.4; max-height: 54px; overflow: auto; }
  .cue .ga-eyebrow { margin-right: 6px; }
</style>
