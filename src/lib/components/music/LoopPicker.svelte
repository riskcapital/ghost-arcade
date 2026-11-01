<script lang="ts">
  /**
   * The loop browser: every loop in a grid of tiles, filtered by part, style,
   * a search and the starred ones. Each tile shows the loop's shape, drawn
   * from its notes, and previews it in the studio's key and tempo on its own
   * tone (in time with what is playing). Add, Enter or a double-click puts it
   * in the slot the browser was opened on; a tile can also be dragged onto a
   * session slot. Arrows move, Space previews, Enter adds, Esc closes.
   */
  import { onDestroy, tick } from 'svelte';
  import { BEAT_LOOPS, MELODIC_LOOPS, beatPattern, type BeatLoop, type MelodicLoop } from '../../music/loops';
  import { LOOP_STYLE_LABELS, loopStyle } from '../../music/loopLibrary';
  import { clipFromPreset, type TrackId } from '../../music/session';
  import { musicStudio } from '../../music/musicStudioStore';
  import { previewLoop, previewingLoop, stopPreview } from '../../music/musicRuntime';
  import { loopBrowser, loopFavourites } from '../../music/studioUi';
  import { toneById } from '../../music/tone/tones';
  import { DRUM_VOICES } from '../../music/noteEvents';
  import { generateUUID } from '../../utils/uuid';

  type Role = TrackId | 'all' | 'dub';
  interface Item { id: string; name: string; track: TrackId; style: string; bars: number; tone: string; loop: MelodicLoop | BeatLoop }

  const ROLES: { id: Role; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'bass', label: 'Bass' },
    { id: 'lead', label: 'Leads' },
    { id: 'chords', label: 'Chords' },
    { id: 'texture', label: 'Textures' },
    { id: 'beats', label: 'Drums' },
    { id: 'dub', label: 'Dub specials' },
  ];

  const ITEMS: Item[] = [
    ...MELODIC_LOOPS.map((l): Item => ({
      id: l.id, name: l.name, track: l.role, style: styleLabel(l.id), bars: Math.max(1, Math.round(l.beats / 4)),
      tone: l.tone ? (toneById(l.tone)?.name ?? '') : '', loop: l,
    })),
    ...BEAT_LOOPS.map((l): Item => ({ id: l.id, name: l.name, track: 'beats', style: styleLabel(l.id), bars: l.steps / 16, tone: '', loop: l })),
  ];
  const STYLES = [...new Set(ITEMS.map((i) => i.style))].sort();

  function styleLabel(id: string): string {
    const s = loopStyle(id);
    return s ? LOOP_STYLE_LABELS[s] : 'Essentials';
  }

  const target = $derived($loopBrowser);
  let role = $state<Role>('all');
  let style = $state('');
  let query = $state('');
  let favsOnly = $state(false);
  let focus = $state(0);
  let grid = $state<HTMLDivElement | null>(null);
  let searchEl = $state<HTMLInputElement | null>(null);

  // Opened on a track, the browser starts on that track's loops.
  let openedFor = '';
  $effect(() => {
    const key = target ? `${target.track}:${target.row}` : '';
    if (key === openedFor) return;
    openedFor = key;
    if (target) {
      role = target.track ?? 'all';
      focus = 0;
      void tick().then(() => searchEl?.focus());
    } else stopPreview();
  });

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return ITEMS.filter((i) => {
      if (role === 'dub' ? !(i.style === 'Dub' || i.style === 'Roots') : role !== 'all' && i.track !== role) return false;
      if (style && i.style !== style) return false;
      if (favsOnly && !$loopFavourites.includes(i.id)) return false;
      return !q || i.name.toLowerCase().includes(q) || i.style.toLowerCase().includes(q) || i.tone.toLowerCase().includes(q);
    });
  });

  $effect(() => {
    if (focus >= shown.length) focus = Math.max(0, shown.length - 1);
  });

  function close() {
    stopPreview();
    loopBrowser.set(null);
  }

  /** Put a loop in the slot the browser was opened on, or the first empty slot of its track. */
  function add(item: Item) {
    const s = $musicStudio;
    const clip = clipFromPreset(item.id, s.key, generateUUID());
    if (!clip) return;
    if (target && target.track === item.track && target.row !== null) musicStudio.setSessionClip(item.track, target.row, clip);
    else musicStudio.addSessionClip(item.track, clip);
    close();
  }

  function star(id: string) {
    loopFavourites.update((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  }

  /** Tiles per row, from where they sit. */
  function columns(): number {
    const tiles = grid?.querySelectorAll<HTMLElement>('.tile');
    if (!tiles || tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    let n = 0;
    for (const t of tiles) {
      if (t.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  }

  function key(e: KeyboardEvent) {
    if (!target) return;
    const inSearch = e.target === searchEl;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    const item = shown[focus];
    if (e.key === 'Enter' && item) {
      e.preventDefault();
      add(item);
      return;
    }
    if (inSearch && !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const cols = columns();
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      focus = Math.max(0, Math.min(shown.length - 1, focus + move));
      void tick().then(() => grid?.querySelectorAll<HTMLElement>('.tile')[focus]?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === ' ' && item) {
      e.preventDefault();
      previewLoop(item.id);
    }
  }

  function dragStart(e: DragEvent, item: Item) {
    e.dataTransfer?.setData('application/x-ga-loop', item.id);
    e.dataTransfer?.setData('text/plain', item.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  /** The loop's shape: notes as bars across its length, high notes higher; drum hits as dots per voice. */
  function shape(loop: MelodicLoop | BeatLoop): Array<{ x: number; y: number; w: number; h: number }> {
    if ('rows' in loop) {
      const p = beatPattern(loop);
      const voices = DRUM_VOICES.filter((v) => p.tracks[v].some((x) => x > 0));
      return voices.flatMap((v, vi) => p.tracks[v].flatMap((vel, i) => (vel > 0 ? [{ x: (i / p.steps) * 100, y: (vi / Math.max(1, voices.length)) * 24 + 2, w: 100 / p.steps - 0.6, h: 2 + vel * 1.5 }] : [])));
    }
    const all = loop.notes.flatMap((n) => n.degrees);
    const lo = Math.min(...all);
    const hi = Math.max(...all, lo + 1);
    return loop.notes.flatMap((n) => n.degrees.map((d) => ({
      x: (n.beat / loop.beats) * 100,
      y: 25 - ((d - lo) / (hi - lo)) * 22,
      w: Math.max(0.8, (n.dur / loop.beats) * 100 - 0.3),
      h: 2,
    })));
  }

  onDestroy(stopPreview);
</script>

<svelte:window onkeydown={key} />

{#if target}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="browser studio-tokens" role="dialog" aria-label="Loops">
      <header>
        <h2>Loops</h2>
        <div class="ga-segmented small" role="tablist" aria-label="Part">
          {#each ROLES as r (r.id)}
            <button role="tab" aria-selected={role === r.id} class:active={role === r.id} onclick={() => { role = r.id; focus = 0; }}>{r.label}</button>
          {/each}
        </div>
        <select bind:value={style} aria-label="Style">
          <option value="">Every style</option>
          {#each STYLES as st (st)}<option value={st}>{st}</option>{/each}
        </select>
        <input class="search" type="search" placeholder="Search" bind:value={query} bind:this={searchEl} aria-label="Search loops" />
        <button class="text-btn" class:on={favsOnly} aria-pressed={favsOnly} onclick={() => (favsOnly = !favsOnly)} title="Only the loops you starred">★ Starred</button>
        <span class="spacer"></span>
        <span class="count">{shown.length} loops</span>
        <button class="close" onclick={close} aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </header>

      <div class="grid" bind:this={grid} role="listbox" aria-label="Loops">
        {#each shown as item, i (item.id)}
          {@const playing = $previewingLoop === item.id}
          <div
            class="tile"
            class:focus={focus === i}
            class:playing
            role="option"
            aria-selected={focus === i}
            tabindex="-1"
            draggable="true"
            ondragstart={(e) => dragStart(e, item)}
            onclick={() => (focus = i)}
            ondblclick={() => add(item)}
            onkeydown={() => {}}
          >
            <div class="top">
              <button class="play" class:on={playing} onclick={(e) => { e.stopPropagation(); focus = i; previewLoop(item.id); }} aria-label={playing ? `Stop ${item.name}` : `Preview ${item.name}`} title={playing ? 'Stop' : 'Preview in the key and tempo'}>
                {#if playing}<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3" y="3" width="6" height="6" /></svg>{:else}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.5l6 3.5-6 3.5z" /></svg>{/if}
              </button>
              <span class="name">{item.name}</span>
              <button class="star" class:on={$loopFavourites.includes(item.id)} onclick={(e) => { e.stopPropagation(); star(item.id); }} aria-pressed={$loopFavourites.includes(item.id)} aria-label="Star {item.name}" title="Star">★</button>
            </div>
            <svg class="shape" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
              {#each shape(item.loop) as r}<rect x={r.x} y={r.y} width={r.w} height={r.h} />{/each}
            </svg>
            <div class="meta">
              <span>{item.style} · {ROLES.find((r) => r.id === item.track)?.label ?? item.track} · {item.bars} bar{item.bars === 1 ? '' : 's'}{item.tone ? ` · ${item.tone}` : ''}</span>
              <button class="add" onclick={(e) => { e.stopPropagation(); add(item); }} title={target.row !== null && target.track === item.track ? `Put it in row ${target.row + 1}` : 'Add it to its track'}>Add</button>
            </div>
          </div>
        {:else}
          <p class="empty">No loops match. Clear the search or pick another style.</p>
        {/each}
      </div>
      <p class="hint">Arrows move · Space previews · Enter adds · drag a tile onto a session slot</p>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(0, 0, 0, 0.45); }
  .browser {
    width: min(1180px, 94vw);
    height: min(720px, 88vh);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge);
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    color: var(--studio-ink);
  }
  header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  h2 { margin: 0; font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); }
  .search { width: 180px; height: var(--ga-control-h, 26px); padding: 0 8px; border: 1px solid var(--studio-edge); background: var(--studio-slot); color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; }
  select { height: var(--ga-control-h, 26px); }
  .text-btn.on { color: var(--studio-accent); border-color: var(--studio-accent); }
  .spacer { flex: 1; }
  .count { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .close { width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-muted); border-radius: var(--studio-radius); cursor: pointer; }
  .close svg { width: 14px; height: 14px; }
  .grid { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); grid-auto-rows: min-content; gap: 6px; align-content: start; }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-cell);
    border-radius: var(--studio-radius);
    cursor: grab;
  }
  .tile:hover { border-color: var(--studio-edge); }
  .tile.focus { border-color: var(--studio-accent); }
  .top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .play { flex: 0 0 auto; width: 24px; height: 24px; padding: 0; display: grid; place-items: center; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-ink); border-radius: var(--studio-radius); cursor: pointer; }
  .play svg { width: 10px; height: 10px; fill: currentColor; }
  .play.on { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-title, 650); }
  .star { flex: 0 0 auto; padding: 0 2px; border: 0; background: transparent; color: var(--studio-edge); cursor: pointer; font-size: 13px; }
  .star.on { color: var(--studio-accent); }
  .shape { width: 100%; height: 30px; background: var(--studio-slot); border-radius: 3px; }
  .shape rect { fill: var(--studio-muted); }
  .tile.playing .shape rect, .tile.focus .shape rect { fill: var(--studio-accent); }
  .meta { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .meta span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .add { flex: 0 0 auto; height: 22px; padding: 0 10px; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; font-size: var(--ga-text-meta, 11px); cursor: pointer; }
  .add:hover { border-color: var(--studio-accent); color: var(--studio-accent); }
  .empty, .hint { margin: 0; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
</style>
