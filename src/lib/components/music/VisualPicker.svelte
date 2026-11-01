<script lang="ts">
  /**
   * The visual browser: every visual voice as a tile with its picture, name
   * and what it answers to, filtered by the set it was drawn for, a search
   * and the starred ones. Opened by whatever wants a visual (visualPicker in
   * studioUi.ts); choosing one hands it back and closes. Arrows move, Enter
   * chooses, Esc closes. Pictures are rendered once and cached.
   */
  import { tick } from 'svelte';
  import { VOICE_SHADERS } from '../../music/visualScenes';
  import { STUDIO_SETS, type StudioSet } from '../../music/studioSets';
  import { visualFavourites, visualPicker } from '../../music/studioUi';
  import { demoVoiceCode, voiceRespondsTo } from '../../music/voiceThumbnails';
  import { generateCachedThumbnail } from '../../isf/thumbnail';

  interface Item { file: string | null; name: string; family: StudioSet | null; blurb: string }

  const ITEMS: Item[] = VOICE_SHADERS.map((v) => ({ file: v.file, name: v.name, family: v.family, blurb: v.blurb }));
  const NONE: Item = { file: null, name: 'None', family: null, blurb: 'No visual' };

  const req = $derived($visualPicker);
  let family = $state<StudioSet | 'all'>('all');
  let query = $state('');
  let favsOnly = $state(false);
  let focus = $state(0);
  let grid = $state<HTMLDivElement | null>(null);
  let searchEl = $state<HTMLInputElement | null>(null);

  // Pictures and what each answers to, filled in as they load (shared between openings).
  let thumbs = $state<Record<string, string>>({});
  let responds = $state<Record<string, string>>({});
  let blank = $state<Record<string, boolean>>({});
  let loading = false;

  /** Whether a picture is all but black. */
  async function isBlank(url: string): Promise<boolean> {
    const img = new Image();
    // The load event, with a time limit: a picture that cannot be checked is shown as it is.
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      setTimeout(() => resolve(img.complete && img.naturalWidth > 0), 1200);
      img.src = url;
    });
    if (!loaded) return false;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const g = c.getContext('2d');
    if (!g) return false;
    g.drawImage(img, 0, 0, 32, 18);
    const d = g.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) / 3 < 6;
  }

  async function loadThumbs() {
    if (loading) return;
    loading = true;
    for (const v of VOICE_SHADERS) {
      if (thumbs[v.file]) continue;
      try {
        const code = await fetch(`./ISF/${v.file}`).then((r) => r.text());
        responds = { ...responds, [v.file]: voiceRespondsTo(code) };
        const url = await generateCachedThumbnail(demoVoiceCode(code));
        // Multi-pass voices build up over frames, which only the native renderer draws: no black boxes.
        if (await isBlank(url)) blank = { ...blank, [v.file]: true };
        else thumbs = { ...thumbs, [v.file]: url };
      } catch {
        // No picture: the tile shows its name only.
      }
    }
    loading = false;
  }

  let opened = false;
  $effect(() => {
    if (req && !opened) {
      opened = true;
      query = '';
      favsOnly = false;
      void loadThumbs();
      void tick().then(() => {
        const at = shown.findIndex((i) => i.file === req.current);
        focus = Math.max(0, at);
        searchEl?.focus();
        grid?.querySelectorAll<HTMLElement>('.tile')[focus]?.scrollIntoView({ block: 'nearest' });
      });
    } else if (!req) opened = false;
  });

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = ITEMS.filter((i) => {
      if (family !== 'all' && i.family !== family) return false;
      if (favsOnly && !$visualFavourites.includes(i.file!)) return false;
      return !q || i.name.toLowerCase().includes(q) || i.blurb.toLowerCase().includes(q) || (responds[i.file!] ?? '').includes(q);
    });
    return req?.none && !q && !favsOnly ? [NONE, ...list] : list;
  });

  $effect(() => {
    if (focus >= shown.length) focus = Math.max(0, shown.length - 1);
  });

  function close() {
    visualPicker.set(null);
  }

  function choose(item: Item) {
    const r = req;
    close();
    r?.pick(item.file);
  }

  function star(file: string) {
    visualFavourites.update((f) => (f.includes(file) ? f.filter((x) => x !== file) : [...f, file]));
  }

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
    if (!req) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const item = shown[focus];
    if (e.key === 'Enter' && item) {
      e.preventDefault();
      choose(item);
      return;
    }
    if (e.target === searchEl && !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      focus = Math.max(0, Math.min(shown.length - 1, focus + move));
      void tick().then(() => grid?.querySelectorAll<HTMLElement>('.tile')[focus]?.scrollIntoView({ block: 'nearest' }));
    }
  }
</script>

<svelte:window onkeydowncapture={key} />

{#if req}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="browser studio-tokens" role="dialog" aria-label="Visuals">
      <header>
        <h2>{req.title ?? 'Visuals'}</h2>
        <div class="ga-segmented small" role="tablist" aria-label="Drawn for">
          <button role="tab" aria-selected={family === 'all'} class:active={family === 'all'} onclick={() => { family = 'all'; focus = 0; }}>All</button>
          {#each STUDIO_SETS as st (st.id)}
            <button role="tab" aria-selected={family === st.id} class:active={family === st.id} onclick={() => { family = st.id; focus = 0; }}>{st.label}</button>
          {/each}
        </div>
        <input class="search" type="search" placeholder="Search" bind:value={query} bind:this={searchEl} aria-label="Search visuals" />
        <button class="text-btn" class:on={favsOnly} aria-pressed={favsOnly} onclick={() => (favsOnly = !favsOnly)} title="Only the visuals you starred">★ Starred</button>
        <span class="spacer"></span>
        <span class="count">{shown.filter((i) => i.file).length} visuals</span>
        <button class="close" onclick={close} aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </header>

      <div class="grid" bind:this={grid} role="listbox" aria-label="Visuals">
        {#each shown as item, i (item.file ?? 'none')}
          <div
            class="tile"
            class:focus={focus === i}
            class:current={item.file === req.current}
            role="option"
            aria-selected={focus === i}
            tabindex="-1"
            onclick={() => { focus = i; choose(item); }}
            onpointerenter={() => (focus = i)}
            onkeydown={() => {}}
            title={item.blurb}
          >
            <div class="pic">
              {#if item.file && thumbs[item.file]}<img src={thumbs[item.file]} alt="" />{:else if item.file && blank[item.file]}<span class="words">{item.blurb}</span>{:else if !item.file}<span class="none-mark">None</span>{/if}
            </div>
            <div class="top">
              <span class="name">{item.name}</span>
              {#if item.file}
                <button class="star" class:on={$visualFavourites.includes(item.file)} onclick={(e) => { e.stopPropagation(); star(item.file!); }} aria-pressed={$visualFavourites.includes(item.file)} aria-label="Star {item.name}" title="Star">★</button>
              {/if}
            </div>
            <span class="meta">{item.file ? `Answers to ${responds[item.file] ?? '…'}` : item.blurb}</span>
          </div>
        {:else}
          <p class="empty">No visuals match. Clear the search or pick another set.</p>
        {/each}
      </div>
      <p class="hint">Arrows move · Enter chooses · Esc closes</p>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 97; display: grid; place-items: center; background: rgba(0, 0, 0, 0.45); }
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
  .text-btn.on { color: var(--studio-accent); border-color: var(--studio-accent); }
  .spacer { flex: 1; }
  .count { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .close { width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-muted); border-radius: var(--studio-radius); cursor: pointer; }
  .close svg { width: 14px; height: 14px; }
  .grid { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); grid-auto-rows: min-content; gap: 8px; align-content: start; }
  .tile { display: flex; flex-direction: column; gap: 5px; padding: 6px; border: 1px solid var(--studio-edge-soft); background: var(--studio-cell); border-radius: var(--studio-radius); cursor: pointer; }
  .tile:hover { border-color: var(--studio-edge); }
  .tile.focus { border-color: var(--studio-accent); }
  .pic { aspect-ratio: 16 / 9; display: grid; place-items: center; overflow: hidden; background: var(--studio-slot); border-radius: 3px; }
  .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .none-mark { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .words { padding: 0 10px; text-align: center; font-size: var(--ga-text-meta, 11px); line-height: 1.4; color: var(--studio-muted); }
  .top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-title, 650); }
  .tile.current .name { color: var(--studio-accent); }
  .star { flex: 0 0 auto; padding: 0 2px; border: 0; background: transparent; color: var(--studio-edge); cursor: pointer; font-size: 13px; }
  .star.on { color: var(--studio-accent); }
  .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .empty, .hint { margin: 0; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
</style>
