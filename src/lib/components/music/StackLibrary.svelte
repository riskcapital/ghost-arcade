<script lang="ts">
  /**
   * The library in the clip visuals editor: the shaders that ship with the
   * app and your own, the Media Library's videos and images, and saved
   * sketches. Picking one adds it to the clip's stack as a layer.
   */
  import { onMount } from 'svelte';
  import { mediaLibrary } from '../../stores/media';
  import { isfShaders } from '../../stores/shaderLibrary';
  import { loadSketches, type StoredSketch } from '../../stores/sketchLibrary';
  import { parseISF } from '../../isf/parser';
  import type { ISFInputDef, ShowClipMedia } from '../../types';
  import { clipMediaFromTrayPayload, withShaderDefaults } from '../show/timeline/clipMedia';

  let { onpick, onclose }: { onpick: (media: ShowClipMedia | null) => void; onclose: () => void } = $props();

  type Tab = 'shaders' | 'media' | 'sketches';
  type Tile = { id: string; name: string; thumb?: string; group?: string; pick: () => Promise<ShowClipMedia | null> };
  let tab = $state<Tab>('shaders');
  let search = $state('');
  let bundled = $state<Tile[]>([]);
  let sketches = $state<StoredSketch[]>([]);
  let busy = $state(false);
  let failed = $state('');

  const shaderMedia = (id: string, name: string, src: string, code: string) => {
    let inputs: ISFInputDef[] = [];
    try {
      inputs = (parseISF(code).metadata.INPUTS ?? []) as ISFInputDef[];
    } catch {
      inputs = [];
    }
    const media = clipMediaFromTrayPayload({ id, type: 'shader', name, src, shaderCode: code, shaderInputs: inputs });
    return media ? withShaderDefaults(media) : null;
  };

  onMount(async () => {
    try {
      const [manifest, thumbs] = await Promise.all([
        fetch('./ISF/manifest.json').then((r) => r.json()),
        fetch('./ISF/thumbnails/manifest.json').then((r) => r.json()).catch(() => ({ thumbnails: {} })),
      ]);
      const entries: Array<{ file: string; enabled?: boolean; category?: string }> =
        manifest.version === 2 ? manifest.shaders.filter((e: { enabled?: boolean }) => e.enabled !== false) : manifest.shaders.map((file: string) => ({ file }));
      bundled = entries
        // The studio's own audio shaders have their own picker.
        .filter((e) => !/(^|\/)VX-/.test(e.file))
        .map((e) => {
          const base = e.file.replace(/\.fs$/, '');
          const name = base.split('/').pop()!.replace(/^(DM|SM|AR)-/, '');
          const thumb = thumbs.thumbnails?.[base.split('/').pop()!];
          const src = `./ISF/${e.file.split('/').map(encodeURIComponent).join('/')}`;
          return {
            id: `isf:${e.file}`, name, group: e.category, thumb: thumb ? `./ISF/thumbnails/${thumb}` : undefined,
            pick: async () => shaderMedia(`isf:${e.file}`, name, src, await fetch(src).then((r) => r.text())),
          };
        });
    } catch {
      failed = 'Could not read the shader list.';
    }
    sketches = await loadSketches().catch(() => []);
  });

  const own = $derived<Tile[]>($isfShaders.map((sh) => ({ id: sh.id, name: sh.name, thumb: sh.thumbnail, group: 'Yours', pick: async () => shaderMedia(sh.id, sh.name, '', sh.code) })));
  const media = $derived<Tile[]>($mediaLibrary.filter((m) => !m.broken).map((m) => ({
    id: m.id, name: m.name, thumb: m.thumbnail, group: m.type === 'video' ? 'Video' : 'Image',
    pick: async () => clipMediaFromTrayPayload({ id: m.id, type: m.type, name: m.name, src: m.src, _assetRef: m._assetRef, thumbnail: m.thumbnail, durationSeconds: m.durationSeconds, videoWidth: m.videoWidth, videoHeight: m.videoHeight }),
  })));
  const sketchTiles = $derived<Tile[]>(sketches.map((sk) => ({ id: sk.id, name: sk.name, thumb: sk.thumbnail, pick: async () => clipMediaFromTrayPayload({ id: sk.id, name: sk.name, jsAnimation: sk.jsAnimation, thumbnail: sk.thumbnail }) })));
  const tiles = $derived.by(() => {
    const all = tab === 'shaders' ? [...own, ...bundled] : tab === 'media' ? media : sketchTiles;
    const q = search.trim().toLowerCase();
    return q ? all.filter((t) => t.name.toLowerCase().includes(q) || (t.group ?? '').toLowerCase().includes(q)) : all;
  });

  async function pick(tile: Tile) {
    busy = true;
    failed = '';
    try {
      const m = await tile.pick();
      if (!m) failed = `Could not load ${tile.name}.`;
      onpick(m);
    } catch {
      failed = `Could not load ${tile.name}.`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="lib">
  <div class="head">
    <span class="ga-eyebrow">Library</span>
    <button class="back" onclick={onclose}>Back to layers</button>
  </div>
  <div class="ga-segmented small tabs" role="tablist" aria-label="Library">
    <button role="tab" aria-selected={tab === 'shaders'} class:active={tab === 'shaders'} onclick={() => (tab = 'shaders')}>Shaders</button>
    <button role="tab" aria-selected={tab === 'media'} class:active={tab === 'media'} onclick={() => (tab = 'media')}>Video and images</button>
    <button role="tab" aria-selected={tab === 'sketches'} class:active={tab === 'sketches'} onclick={() => (tab = 'sketches')}>Sketches</button>
  </div>
  <input class="search" type="search" placeholder="Search" bind:value={search} onkeydown={(e) => e.stopPropagation()} />
  {#if failed}<p class="note" role="status">{failed}</p>{/if}
  <div class="grid" aria-busy={busy}>
    {#each tiles as tile (tile.id)}
      <button class="tile" onclick={() => pick(tile)} disabled={busy} title={tile.group ? `${tile.name} · ${tile.group}` : tile.name}>
        {#if tile.thumb}<img src={tile.thumb} alt="" loading="lazy" />{:else}<span class="blank" aria-hidden="true"></span>{/if}
        <span class="label">{tile.name}</span>
      </button>
    {:else}
      <p class="note">{tab === 'media' ? 'No videos or images in the Media Library yet. Add some there, or use + File.' : tab === 'sketches' ? 'No saved sketches yet.' : 'Nothing matches.'}</p>
    {/each}
  </div>
</div>

<style>
  .lib { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .back { background: none; border: 0; color: var(--ga-ink-1, #ada9a2); cursor: pointer; font: inherit; font-size: var(--ga-text-meta, 11px); }
  .back:hover { color: var(--ga-ink-0, #f2ede4); }
  .tabs { display: flex; }
  .tabs button { flex: 1; }
  .search { height: var(--ga-control-h-sm, 22px); box-sizing: border-box; padding: 0 8px; background: var(--ga-slot, #060504); color: var(--ga-ink-0, #f2ede4); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); font: inherit; }
  .grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; align-content: start; }
  .tile { display: flex; flex-direction: column; gap: 3px; padding: 0; background: none; border: 1px solid transparent; border-radius: var(--ga-r-hard, 5px); color: var(--ga-ink-1, #ada9a2); cursor: pointer; text-align: left; font: inherit; }
  .tile:hover:not(:disabled) { border-color: var(--ga-icon, #5278ff); color: var(--ga-ink-0, #f2ede4); }
  .tile img, .blank { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; background: var(--ga-slot, #060504); display: block; }
  .label { padding: 0 3px 3px; font-size: var(--ga-text-meta, 11px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note { margin: 0; grid-column: 1 / -1; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); line-height: 1.5; }
</style>
