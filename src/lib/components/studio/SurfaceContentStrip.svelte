<script lang="ts">
  /**
   * What a surface plays: a strip of the deck, this set's photos and videos, and the visual
   * library. Drag a tile up onto a surface in the picture to put it there, or tap a tile to put it
   * on the selected surface (the way that works with VoiceOver and Switch Control).
   */
  import { onDestroy } from 'svelte';
  import Icon from './StudioIcon.svelte';
  import ClipThumbnail from './ClipThumbnail.svelte';
  import { shaderThumbnail, type Clip, type Surface } from '../../mobile/studio/model';
  import { hitMappingScreens } from '../../mobile/studio/mappingInteraction';
  import type { SurfaceChoice } from '../../mobile/studio/surfaceClips';

  export let visuals: { id: string; name: string }[] = [];
  /** This set's own photos and videos. */
  export let media: Clip[] = [];
  export let surfaces: Surface[] = [];
  export let selected = 0;
  /** The surface's own clip now, to mark its tile. */
  export let current: { shader?: string; clip?: string } | null = null;
  /** The picture surfaces are dropped on. */
  export let target: HTMLElement | undefined;
  /**
   * The surface under a screen point, from the mapping canvas (it knows the zoom and free
   * outlines). Without it the drop is tested against the unzoomed picture.
   */
  export let hitAt: ((clientX: number, clientY: number) => number | null) | undefined = undefined;
  export let onassign: (surface: number, choice: SurfaceChoice) => void = () => {};
  /** The surface under a drag, or null, so the picture can light it up. */
  export let onhover: (surface: number | null) => void = () => {};

  type Tile = { key: string; name: string; choice: SurfaceChoice; image?: string; clip?: Clip };
  $: tiles = [
    { key: 'deck', name: 'Deck mix', choice: { deck: true } } as Tile,
    ...media.map((clip): Tile => ({ key: `clip:${clip.id}`, name: clip.name, choice: { clip: clip.id }, clip })),
    ...visuals.map((v): Tile => ({ key: `shader:${v.id}`, name: v.name, choice: { shader: v.id }, image: shaderThumbnail(v.id) })),
  ];
  $: surfaceLabel = surfaces[selected] ? `Surface ${selected + 1} · ${surfaces[selected].name}` : '';
  const isCurrent = (tile: Tile) =>
    'deck' in tile.choice ? !current : 'shader' in tile.choice ? current?.shader === tile.choice.shader : current?.clip === tile.choice.clip;

  let drag: { tile: Tile; x: number; y: number; over: number | null } | null = null;
  let suppressClick = false;

  function surfaceAt(x: number, y: number): number | null {
    if (hitAt) return hitAt(x, y);
    const box = target?.getBoundingClientRect();
    if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    const hits = hitMappingScreens({ x: (x - box.left) / box.width, y: (y - box.top) / box.height }, surfaces);
    return hits.length ? hits[0] : null;
  }
  function tap(tile: Tile) {
    if (suppressClick || !surfaces[selected]) return;
    onassign(selected, tile.choice);
  }
  /**
   * Picking a tile up. Touch runs on touch events with a listener that may cancel scrolling: the
   * first movement decides, sideways scrolls the strip and upwards lifts the tile. A mouse or
   * pencil on iPad uses pointer events.
   */
  function dragSource(node: HTMLElement) {
    let start: { x: number; y: number; tile: Tile } | null = null;
    let decided = false;
    const tileAt = (el: EventTarget | null) => {
      const key = (el as HTMLElement | null)?.closest?.('[data-surface-choice]')?.getAttribute('data-surface-choice');
      return tiles.find((t) => t.key === key) ?? null;
    };
    const begin = (x: number, y: number, el: EventTarget | null) => {
      const tile = tileAt(el);
      start = tile && surfaces.length ? { x, y, tile } : null;
      decided = false;
    };
    /** True while the movement belongs to a drag (so the page must not scroll). */
    const moveTo = (x: number, y: number): boolean => {
      if (drag) {
        const over = surfaceAt(x, y);
        if (over !== drag.over) onhover(over);
        drag = { ...drag, x, y, over };
        return true;
      }
      if (!start || decided || (x === start.x && y === start.y)) return false;
      decided = true;
      const dx = x - start.x,
        dy = y - start.y;
      if (dy < 0 && Math.abs(dy) >= Math.abs(dx)) {
        drag = { tile: start.tile, x, y, over: null };
        return true;
      }
      start = null;
      return false;
    };
    const end = (x: number, y: number) => {
      start = null;
      if (!drag) return;
      const over = surfaceAt(x, y);
      const tile = drag.tile;
      drag = null;
      onhover(null);
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 400);
      if (over !== null) onassign(over, tile.choice);
    };
    const abandon = () => {
      start = null;
      if (drag) { drag = null; onhover(null); }
    };
    const touchstart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { abandon(); return; }
      begin(e.touches[0].clientX, e.touches[0].clientY, e.target);
    };
    const touchmove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && moveTo(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
    };
    const touchend = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) end(t.clientX, t.clientY); else abandon();
    };
    const pointermove = (e: PointerEvent) => { if (moveTo(e.clientX, e.clientY)) e.preventDefault(); };
    const pointerup = (e: PointerEvent) => { stopPointer(); end(e.clientX, e.clientY); };
    const stopPointer = () => {
      window.removeEventListener('pointermove', pointermove);
      window.removeEventListener('pointerup', pointerup);
      window.removeEventListener('pointercancel', pointercancel);
    };
    const pointercancel = () => { stopPointer(); abandon(); };
    const pointerdown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button > 0) return;
      begin(e.clientX, e.clientY, e.target);
      window.addEventListener('pointermove', pointermove);
      window.addEventListener('pointerup', pointerup);
      window.addEventListener('pointercancel', pointercancel);
    };
    node.addEventListener('touchstart', touchstart, { passive: true });
    node.addEventListener('touchmove', touchmove, { passive: false });
    node.addEventListener('touchend', touchend);
    node.addEventListener('touchcancel', abandon);
    node.addEventListener('pointerdown', pointerdown);
    return {
      destroy() {
        stopPointer();
        node.removeEventListener('touchstart', touchstart);
        node.removeEventListener('touchmove', touchmove);
        node.removeEventListener('touchend', touchend);
        node.removeEventListener('touchcancel', abandon);
        node.removeEventListener('pointerdown', pointerdown);
      },
    };
  }
  onDestroy(() => { if (drag) onhover(null); });
</script>

<section class="content-strip" aria-label="Surface content" data-surface-content>
  <p class="how">{#if surfaces.length}Drag a picture onto a surface, or tap one to put it on <strong>{surfaceLabel}</strong>.{:else}Add a surface first.{/if}</p>
  <div class="strip" role="group" aria-label="Visuals to put on a surface" use:dragSource>
    {#each tiles as tile (tile.key)}
      <button class="tile" class:current={isCurrent(tile)} aria-pressed={isCurrent(tile)} disabled={!surfaces.length}
        aria-label={'deck' in tile.choice ? `Show the deck mix on ${surfaceLabel}` : `Put ${tile.name} on ${surfaceLabel}`}
        data-surface-choice={tile.key} onclick={() => tap(tile)}>
        <span class="thumb">
          {#if tile.clip}<ClipThumbnail clip={tile.clip} />{:else if tile.image}<img src={tile.image} alt="" loading="lazy" decoding="async" draggable="false" />{:else}<span class="deck"><Icon name="mixer" size={20} /></span>{/if}
        </span>
        <span class="name">{tile.name}</span>
      </button>
    {/each}
  </div>
</section>
{#if drag}
  <div class="ghost" aria-hidden="true" style:left={`${drag.x}px`} style:top={`${drag.y}px`}>
    <span>{drag.over === null ? 'Drop on a surface' : `Surface ${drag.over + 1} · ${surfaces[drag.over]?.name ?? ''}`}</span>
    <strong>{drag.tile.name}</strong>
  </div>
{/if}

<style>
  .content-strip { margin: 0 0 12px; }
  .how { margin: 0 0 6px; font-size: 12px; line-height: 1.4; color: var(--ga-ink-1); }
  .how strong { color: var(--ga-ink-0); font-weight: 600; }
  .strip {
    display: flex; gap: 6px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
    padding-bottom: 2px; touch-action: pan-x; -webkit-overflow-scrolling: touch;
  }
  .strip::-webkit-scrollbar { display: none; }
  .tile {
    flex: none; display: grid; width: 96px; padding: 0; overflow: hidden; text-align: left;
    font: inherit; color: var(--ga-ink-0); background: var(--ga-hardware-bg); border: 1px solid var(--ga-line-2); border-radius: 6px;
    touch-action: pan-x; cursor: grab; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  }
  .tile:disabled { opacity: .45; }
  .tile.current { border-color: var(--ga-blue-300); box-shadow: inset 0 0 0 2px var(--ga-blue-400); }
  .tile:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  .thumb { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 9; overflow: hidden; background: var(--ga-slot); }
  .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
  .deck { display: grid; place-items: center; color: var(--ga-blue-200); }
  .name { padding: 4px 6px 6px; font-size: 12px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ghost {
    position: fixed; z-index: 70; display: grid; gap: 1px; min-width: 120px; max-width: 220px; padding: 6px 10px;
    transform: translate(-50%, calc(-100% - 18px)); pointer-events: none;
    border: 1px solid var(--ga-blue-400); border-radius: 8px; background: var(--ga-blue-900); box-shadow: 0 6px 20px #000b;
    font-size: 12px; color: var(--ga-ink-1);
  }
  .ghost strong { font-size: 13px; color: var(--ga-ink-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
