<script lang="ts">
  /**
   * The song timeline: the song up now laid out along time. Each block is a
   * section (a row of the clip grid, played for some bars); under its name,
   * a line per track shows what plays in it, and the last line whether its
   * clips bring visuals. Play runs the song through, launching each row on
   * its bar; clicking a block plays from there.
   *
   * Drag a block to move it, its right edge to change its length, and
   * right-click for the rest. The clips themselves are edited in the grid.
   */
  import { onDestroy } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { stopAll } from '../../music/musicRuntime';
  import { TRACKS, sessionRows } from '../../music/session';
  import { hasVisuals } from '../../music/clipStack';
  import { MAX_SECTION_BARS, MAX_SONG_SECTIONS, sectionsBars, type SongSection } from '../../music/songs';
  import { playSong, songPlayThrough, songPlayback, songPlaybackPosition, stopSongPlay } from '../../music/songRuntime';

  const s = $derived($musicStudio);
  const song = $derived(s.songs.find((x) => x.id === s.currentSongId) ?? null);
  const grid = $derived(song?.grid ?? null);
  const sections = $derived(grid?.sections ?? []);
  const total = $derived(sectionsBars(sections));
  const playing = $derived($songPlayback && song && $songPlayback.songId === song.id ? $songPlayback : null);
  const rowCount = $derived(sessionRows(s.session));

  /** What a row holds: a mark per track, and whether any of its clips brings visuals. */
  const rowMarks = $derived(
    Array.from({ length: rowCount }, (_x, row) => ({
      tracks: TRACKS.map((t) => !!s.session[t.id][row]),
      visuals: TRACKS.some((t) => hasVisuals(s.session[t.id][row]?.stack)),
    })),
  );
  const LANES = [...TRACKS.map((t) => t.label), 'Visuals'];

  /** Open: a line per track under each block. Closed: the blocks alone, so the grid keeps its room. */
  const OPEN_KEY = 'ga.songTimeline.open';
  let open = $state(readOpen());
  function readOpen(): boolean {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
  }
  function toggleOpen() {
    open = !open;
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* no storage: the choice lasts the session */ }
  }

  function setSections(next: SongSection[]) {
    if (!song || !grid) return;
    musicStudio.updateSong(song.id, { grid: { ...grid, sections: next.slice(0, MAX_SONG_SECTIONS) } });
  }

  /** A timeline for a song that has none: a section for every row with clips, eight bars each. */
  function makeTimeline() {
    if (!song) return;
    const made: SongSection[] = [];
    for (let row = 0; row < rowCount; row++) if (rowMarks[row].tracks.some(Boolean)) made.push({ name: `Row ${row + 1}`, row, bars: 8 });
    musicStudio.updateSong(song.id, { grid: { session: JSON.parse(JSON.stringify(s.session)), key: { ...s.key }, sections: made } });
  }

  const rowName = (row: number) => sections.find((x) => x.row === row)?.name ?? `Row ${row + 1}`;

  function addSection(e: Event) {
    const el = e.currentTarget as HTMLSelectElement;
    const row = Number(el.value);
    el.value = '';
    if (Number.isInteger(row)) setSections([...sections, { name: rowName(row), row, bars: 8 }]);
  }

  // ── Play ──
  let pos = $state<{ index: number; bar: number } | null>(null);
  let frame = 0;
  function follow() {
    pos = songPlaybackPosition();
    frame = pos ? requestAnimationFrame(follow) : 0;
  }
  $effect(() => {
    if (playing && !frame) follow();
    if (!playing) pos = null;
  });
  onDestroy(() => cancelAnimationFrame(frame));

  function toggle() {
    if (playing) {
      stopSongPlay();
      stopAll();
    } else playSong(0);
  }

  // ── Move, resize, menu ──
  let laneEl = $state<HTMLElement | null>(null);
  type Drag = { kind: 'move'; from: number; x0: number; moved: boolean } | { kind: 'size'; index: number; x0: number; bars0: number; perBar: number };
  let drag = $state<Drag | null>(null);
  let dropAt = $state<number | null>(null);
  let menu = $state<{ index: number; x: number; y: number } | null>(null);

  function insertIndex(clientX: number): number {
    const blocks = laneEl ? Array.from(laneEl.querySelectorAll<HTMLElement>('.block')) : [];
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return blocks.length;
  }
  function blockDown(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { kind: 'move', from: i, x0: e.clientX, moved: false };
  }
  function edgeDown(e: PointerEvent, i: number) {
    e.stopPropagation();
    const block = (e.currentTarget as HTMLElement).parentElement!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { kind: 'size', index: i, x0: e.clientX, bars0: sections[i].bars, perBar: block.getBoundingClientRect().width / sections[i].bars };
  }
  function move(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    if (d.kind === 'size') {
      // Whole phrases of four bars; Shift for single bars.
      const step = e.shiftKey ? 1 : 4;
      const raw = d.bars0 + (e.clientX - d.x0) / Math.max(1, d.perBar);
      const bars = Math.max(step, Math.min(MAX_SECTION_BARS, Math.round(raw / step) * step));
      if (bars !== sections[d.index].bars) setSections(sections.map((x, i) => (i === d.index ? { ...x, bars } : x)));
    } else if (Math.abs(e.clientX - d.x0) > 5) {
      drag = { ...d, moved: true };
      dropAt = insertIndex(e.clientX);
    }
  }
  function up() {
    const d = drag;
    drag = null;
    if (d?.kind === 'move') {
      if (d.moved && dropAt !== null) {
        const to = dropAt > d.from ? dropAt - 1 : dropAt;
        const next = [...sections];
        const [moved] = next.splice(d.from, 1);
        next.splice(to, 0, moved);
        setSections(next);
      } else if (!d.moved) playSong(d.from);
    }
    dropAt = null;
  }
  function openMenu(e: MouseEvent, index: number) {
    e.preventDefault();
    menu = { index, x: e.clientX, y: e.clientY };
  }
  function rename(index: number) {
    const name = prompt('Section name', sections[index].name)?.trim().slice(0, 40);
    if (name) setSections(sections.map((x, i) => (i === index ? { ...x, name } : x)));
  }
  function menuDo(action: 'rename' | 'copy' | 'remove') {
    const m = menu;
    menu = null;
    if (!m) return;
    if (action === 'rename') rename(m.index);
    else if (action === 'copy') setSections([...sections.slice(0, m.index + 1), { ...sections[m.index] }, ...sections.slice(m.index + 1)]);
    else setSections(sections.filter((_x, i) => i !== m.index));
  }
</script>

<svelte:window onpointerdown={(e) => { if (menu && !(e.target as HTMLElement).closest('.tl-menu')) menu = null; }} />

<div class="timeline" role="group" aria-label="Song timeline">
  <div class="head">
    <button class="play" class:on={!!playing} disabled={!sections.length} onclick={toggle} aria-pressed={!!playing} title={playing ? 'Stop the song' : 'Play the song through: each section comes in on its bar'}>
      <svg viewBox="0 0 12 12" aria-hidden="true">{#if playing}<rect x="2.5" y="2.5" width="7" height="7" rx="1" />{:else}<path d="M3 2l7 4-7 4z" />{/if}</svg>
      {playing ? 'Stop' : 'Play song'}
    </button>
    <span class="title">
      {#if song}
        <span class="name">{song.name}</span>
        <span class="meta">{[song.bpm ? `${song.bpm} BPM` : '', `${total} bars`, pos && sections[pos.index] ? `${sections[pos.index].name} ${Math.min(sections[pos.index].bars, Math.floor(pos.bar) + 1)}/${sections[pos.index].bars}` : ''].filter(Boolean).join(' · ')}</span>
      {:else}
        <span class="meta">No song is up. Call one up from the set list to see it here.</span>
      {/if}
    </span>
    {#if grid}
      <button class="text" class:on={open} aria-pressed={open} onclick={toggleOpen} title={open ? 'Show the sections alone' : 'Show what plays in each section: a line per track, and the visuals'}>Tracks</button>
      <select class="add" onchange={addSection} aria-label="Add a section" title="Add a section to the end: pick the row it plays">
        <option value="">+ Section</option>
        {#each rowMarks as marks, row (row)}
          {#if marks.tracks.some(Boolean)}<option value={row}>{row + 1} · {rowName(row)}</option>{/if}
        {/each}
      </select>
      <label class="through" title="When the song ends, go on to the next one in the set list">
        <input type="checkbox" bind:checked={$songPlayThrough} />
        Then next song
      </label>
    {:else if song}
      <button class="text" onclick={makeTimeline} title="Lay this song's rows out along time, eight bars each, and keep the clip grid with the song">Make a timeline</button>
    {/if}
  </div>

  {#if sections.length}
    <div class="body" class:open>
      {#if open}
        <div class="legend" aria-hidden="true">
          <span class="spacer"></span>
          {#each LANES as lane (lane)}<span>{lane}</span>{/each}
        </div>
      {/if}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="lane" bind:this={laneEl} onpointermove={move} onpointerup={up} onpointercancel={up}>
        {#each sections as section, i (i)}
          {@const marks = rowMarks[section.row]}
          {@const live = playing?.index === i}
          {#if dropAt === i}<span class="drop-at"></span>{/if}
          <div
            class="block"
            class:live
            class:lifted={drag?.kind === 'move' && drag.moved && drag.from === i}
            style="flex-grow: {section.bars}"
            role="button"
            tabindex="0"
            title="{section.name}: row {section.row + 1}, {section.bars} bars. Click to play from here; drag to move; right-click for more."
            onpointerdown={(e) => blockDown(e, i)}
            oncontextmenu={(e) => openMenu(e, i)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playSong(i); } }}
          >
            {#if live && pos}<span class="fill" style="width: {Math.min(100, (pos.bar / section.bars) * 100)}%"></span>{/if}
            <span class="label"><span class="sname">{section.name}</span><span class="bars">{section.bars}</span>{#if !open && marks?.visuals}<span class="dot" title="Its clips bring visuals"></span>{/if}</span>
            {#if open}
              {#each LANES as lane, l (lane)}
                <span class="mark" class:has={l < TRACKS.length ? marks?.tracks[l] : marks?.visuals} class:vis={l === TRACKS.length}></span>
              {/each}
            {/if}
            <span class="edge" onpointerdown={(e) => edgeDown(e, i)} title="Drag to change the length (Shift: one bar at a time)"></span>
          </div>
        {/each}
        {#if dropAt === sections.length}<span class="drop-at"></span>{/if}
      </div>
    </div>
  {/if}
</div>

{#if menu}
  <div class="tl-menu" style="left: {menu.x}px; top: {menu.y}px" role="menu">
    <button role="menuitem" onclick={() => menuDo('rename')}>Rename</button>
    <button role="menuitem" onclick={() => menuDo('copy')}>Duplicate</button>
    <button role="menuitem" onclick={() => menuDo('remove')}>Remove</button>
  </div>
{/if}

<style>
  .timeline { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-bottom: 8px; }
  .head { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .play {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;
    border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); background: transparent; color: var(--studio-ink);
    font: inherit; font-size: var(--ga-text-meta, 11px); cursor: pointer;
  }
  .play svg { width: 9px; height: 9px; fill: currentColor; }
  .play.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .play:disabled { opacity: 0.4; cursor: default; }
  .title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; overflow: hidden; white-space: nowrap; }
  .name { font-weight: var(--ga-weight-control, 600); color: var(--studio-ink); overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); overflow: hidden; text-overflow: ellipsis; }
  .add, .text {
    flex: 0 0 auto; height: 22px; border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius);
    background: transparent; color: var(--studio-ink); font: inherit; font-size: var(--ga-text-meta, 11px); cursor: pointer;
  }
  .add { max-width: 110px; }
  .text { padding: 0 8px; }
  .text.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .through { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); cursor: pointer; white-space: nowrap; }
  .through input { accent-color: var(--studio-accent); margin: 0; }

  .body { display: flex; gap: 6px; min-width: 0; }
  .legend { flex: 0 0 auto; display: grid; grid-template-rows: 18px repeat(6, 8px); row-gap: 2px; font-size: 8px; line-height: 8px; color: var(--studio-muted); text-transform: uppercase; letter-spacing: 0.06em; text-align: right; padding: 4px 0; }
  .lane { position: relative; flex: 1; min-width: 0; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: thin; }
  .block {
    position: relative; flex: 1 0 0; min-width: 34px; box-sizing: border-box; padding: 3px 6px 3px 5px;
    display: grid; grid-template-rows: 18px; row-gap: 2px;
    border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius); background: var(--studio-cell);
    color: var(--studio-ink); cursor: pointer; overflow: hidden; touch-action: none; user-select: none;
  }
  .open .block { grid-template-rows: 18px repeat(6, 8px); }
  .block:hover { border-color: var(--studio-edge); }
  .dot { flex: 0 0 auto; align-self: center; width: 5px; height: 5px; border-radius: 50%; background: var(--studio-accent); }
  .block.live { border-color: var(--studio-accent); }
  .block.lifted { opacity: 0.45; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--studio-accent) 16%, transparent); pointer-events: none; }
  .label { position: relative; display: flex; align-items: baseline; gap: 5px; min-width: 0; white-space: nowrap; font-size: var(--ga-text-meta, 11px); }
  .sname { overflow: hidden; text-overflow: ellipsis; }
  .bars { font-size: 9px; color: var(--studio-muted); font-family: var(--ga-font-mono, ui-monospace); }
  .mark { position: relative; border-radius: 1px; background: color-mix(in srgb, var(--studio-ink) 7%, transparent); }
  .mark.has { background: color-mix(in srgb, var(--studio-ink) 55%, transparent); }
  .mark.vis.has { background: var(--studio-accent); }
  .edge { position: absolute; top: 0; right: 0; bottom: 0; width: 7px; cursor: ew-resize; }
  .edge:hover { background: color-mix(in srgb, var(--studio-accent) 40%, transparent); }
  .drop-at { flex: 0 0 2px; align-self: stretch; background: var(--studio-accent); }

  .tl-menu {
    position: fixed; z-index: 1000; display: flex; flex-direction: column; min-width: 120px; padding: 4px;
    border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); background: var(--studio-panel, #16181d);
  }
  .tl-menu button { padding: 5px 8px; border: 0; background: transparent; color: var(--studio-ink); font: inherit; font-size: var(--ga-text-meta, 11px); text-align: left; cursor: pointer; border-radius: 2px; }
  .tl-menu button:hover { background: color-mix(in srgb, var(--studio-ink) 10%, transparent); }
</style>
