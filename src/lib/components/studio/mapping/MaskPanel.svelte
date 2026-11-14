<script lang="ts">
  /** Masks of the selected surface: add (polygon, circle, freehand, picture), choose, and set how each cuts. */
  import './mappingPanel.css';
  import type { Surface } from '../../../mobile/studio/model';
  import { MAX_FEATHER, MAX_IMAGE_SRC, MAX_MASKS, newEllipseMask, newImageMask, type SurfaceMask } from '../../../mobile/studio/mapping/masks';
  import { withMask } from '../../../mobile/studio/mapping/maskEdit';
  import { isSmooth, removePoint, setPointSmooth, MIN_PATH_POINTS } from '../../../mobile/studio/mapping/pathGeometry';
  import { selectionBox } from '../../../mobile/studio/mapping/edit';
  import MapIcon from './MapIcon.svelte';

  type Tool = 'edit' | 'polygon' | 'freehand';
  type Props = {
    surfaces: Surface[];
    index: number;
    mask: number;
    point: number;
    tool: Tool;
    /** Corners tapped so far for a new polygon. */
    tapped?: number;
    onapply: (surfaces: Surface[]) => void;
    /** Live change inside one slider drag (the undo step was taken at its start). */
    onlive: (surfaces: Surface[]) => void;
    onstart: () => void;
    /** End of a slider drag: save, without another undo step. */
    oncommit: () => void;
    onmask: (mask: number, point: number, tool: Tool) => void;
    onfinish: () => void;
    onnotice: (message: string) => void;
  };
  let { surfaces, index, mask, point, tool, tapped = 0, onapply, onlive, onstart, oncommit, onmask, onfinish, onnotice }: Props = $props();
  const s = $derived(surfaces[index]);
  const masks = $derived(s?.masks ?? []);
  const m = $derived(masks[mask] ?? null);
  const full = $derived(masks.length >= MAX_MASKS);
  let file = $state<HTMLInputElement>();

  const KIND: Record<SurfaceMask['kind'], { label: string; icon: string }> = {
    polygon: { label: 'Polygon', icon: 'polygon' },
    ellipse: { label: 'Circle', icon: 'circle' },
    freehand: { label: 'Freehand', icon: 'draw' },
    image: { label: 'Picture', icon: 'image' },
  };
  const set = (next: SurfaceMask) => onapply(withMask(surfaces, index, mask, next));
  function add(next: SurfaceMask) {
    if (!s || full) return;
    // Its index before applying: the surfaces (and so `masks`) already hold it afterwards.
    const at = masks.length;
    onapply(surfaces.map((x, i) => (i === index ? { ...x, masks: [...(x.masks ?? []), next] } : x)));
    onmask(at, 0, 'edit');
  }
  function circle() {
    const box = s ? selectionBox(surfaces, [index]) : null;
    // Round on the output: the surface's width and height there, in pixels.
    const aspect = box ? ((box.x1 - box.x0) * 16) / Math.max(0.001, (box.y1 - box.y0) * 9) : 16 / 9;
    add(newEllipseMask(aspect, `Circle ${masks.length + 1}`));
  }
  /** A picture from Photos, shrunk to at most 512 px and kept inside the set. */
  async function picture(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    try {
      const bitmap = await createImageBitmap(chosen);
      let side = 512,
        src = '',
        hasAlpha = false;
      while (side >= 128) {
        const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * k));
        canvas.height = Math.max(1, Math.round(bitmap.height * k));
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        hasAlpha = false;
        for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { hasAlpha = true; break; }
        src = canvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.9);
        if (src.length <= MAX_IMAGE_SRC) break;
        side = Math.round(side * 0.75);
      }
      bitmap.close();
      if (!src || src.length > MAX_IMAGE_SRC) throw new Error('too large');
      // A picture with transparency cuts by it; a plain photo or drawing cuts by its brightness.
      add(newImageMask(src, hasAlpha ? 'alpha' : 'luma', `Picture ${masks.length + 1}`));
      onnotice(hasAlpha ? 'Picture mask: its transparent parts are cut away.' : 'Picture mask: dark parts are cut away. Switch to Transparency for a cut-out PNG.');
    } catch {
      onnotice('That picture could not be used as a mask. Try a PNG or JPEG.');
    }
  }
</script>

{#if s}
  <section class="mp" aria-label="Masks">
    <div class="mp-head"><strong>MASKS</strong><span class="mp-label">{masks.length} of {MAX_MASKS}</span></div>
    {#if tool === 'polygon'}
      <p class="mp-hint" role="status">Tap the corners of the area on the canvas{tapped ? ` (${tapped} so far)` : ''}. Tap the first corner again or press Done.</p>
      <div class="mp-row">
        <button class="grow" disabled={tapped < 3} onclick={onfinish}><MapIcon name="add" size={16} />Done</button>
        <button class="grow" onclick={() => onmask(mask, point, 'edit')}>Cancel</button>
      </div>
    {:else if tool === 'freehand'}
      <p class="mp-hint" role="status">Trace around the area on the canvas with one finger.</p>
      <div class="mp-row"><button class="grow" onclick={() => onmask(mask, point, 'edit')}>Cancel</button></div>
    {:else}
      <div class="mp-grid">
        <button disabled={full || s.locked} onclick={() => onmask(-1, 0, 'polygon')}><MapIcon name="polygon" size={20} />Polygon</button>
        <button disabled={full || s.locked} onclick={circle}><MapIcon name="circle" size={20} />Circle</button>
        <button disabled={full || s.locked} onclick={() => onmask(-1, 0, 'freehand')}><MapIcon name="draw" size={20} />Freehand</button>
        <button disabled={full || s.locked} onclick={() => file?.click()}><MapIcon name="image" size={20} />Picture</button>
      </div>
      <input bind:this={file} class="file" type="file" accept="image/*" onchange={picture} tabindex="-1" aria-hidden="true" />
    {/if}
    {#if masks.length}
      <ul class="list">
        {#each masks as item, i (item.id)}
          <li class:on={i === mask}>
            <button class="pick grow" aria-pressed={i === mask} onclick={() => onmask(i === mask ? -1 : i, 0, 'edit')}><MapIcon name={KIND[item.kind].icon} size={16} /><span>{item.name}</span><small>{item.op === 'subtract' ? 'Cut' : 'Keep'}{item.invert ? ' · inverted' : ''}</small></button>
            <button aria-label={item.enabled ? `Hide ${item.name}` : `Show ${item.name}`} aria-pressed={item.enabled} onclick={() => onapply(withMask(surfaces, index, i, { ...item, enabled: !item.enabled }))}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d={item.enabled ? 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z' : 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9 9 0 0 0 4.3-1.1'} /></svg></button>
            <button aria-label={`Delete ${item.name}`} onclick={() => { onapply(withMask(surfaces, index, i, null)); onmask(-1, 0, 'edit'); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if m}
      <div class="mp-seg" role="group" aria-label="What the mask does" style="margin-top:8px">
        <button class:active={m.op === 'add'} aria-pressed={m.op === 'add'} onclick={() => set({ ...m, op: 'add' })}>Keep inside</button>
        <button class:active={m.op === 'subtract'} aria-pressed={m.op === 'subtract'} onclick={() => set({ ...m, op: 'subtract' })}>Cut out</button>
      </div>
      <div class="mp-row">
        <button class="grow" aria-pressed={m.invert} onclick={() => set({ ...m, invert: !m.invert })}><MapIcon name="invert" size={16} />Invert</button>
        {#if m.kind === 'image'}
          <div class="mp-seg grow" role="group" aria-label="Read the picture by">
            <button class:active={m.image?.channel === 'alpha'} aria-pressed={m.image?.channel === 'alpha'} onclick={() => m.image && set({ ...m, image: { ...m.image, channel: 'alpha' } })}>Transparency</button>
            <button class:active={m.image?.channel === 'luma'} aria-pressed={m.image?.channel === 'luma'} onclick={() => m.image && set({ ...m, image: { ...m.image, channel: 'luma' } })}>Brightness</button>
          </div>
        {/if}
      </div>
      <label class="mp-row">
        <span class="mp-label">Feather</span>
        <input type="range" min="0" max={MAX_FEATHER} step="0.005" value={m.feather} aria-label="Mask feather" onpointerdown={onstart} oninput={(e) => onlive(withMask(surfaces, index, mask, { ...m, feather: Number(e.currentTarget.value) }))} onchange={(e) => { onlive(withMask(surfaces, index, mask, { ...m, feather: Number(e.currentTarget.value) })); oncommit(); }} />
        <output class="mp-label">{Math.round(m.feather * 100)}%</output>
      </label>
      {#if (m.kind === 'polygon' || m.kind === 'freehand') && m.points[point]}
        <div class="mp-row">
          <button class="grow" aria-pressed={isSmooth(m.points[point])} onclick={() => set({ ...m, points: setPointSmooth(m.points, point, !isSmooth(m.points[point])) })}><MapIcon name={isSmooth(m.points[point]) ? 'smooth' : 'corner'} size={16} />{isSmooth(m.points[point]) ? 'Curved point' : 'Sharp point'}</button>
          <button class="grow" disabled={m.points.length <= MIN_PATH_POINTS} onclick={() => { set({ ...m, points: removePoint(m.points, point) }); onmask(mask, Math.max(0, point - 1), 'edit'); }}><MapIcon name="remove" size={16} />Delete point</button>
        </div>
      {/if}
      <p class="mp-hint">{m.kind === 'image' ? 'The picture covers the whole surface and moves with it.' : m.kind === 'ellipse' ? 'Drag the middle to move it and the two outer dots to size it.' : 'Drag points or the whole mask on the canvas. Tap a + to add a point; drag it to bend the edge.'}</p>
    {:else if masks.length}
      <p class="mp-hint">Choose a mask to edit it on the canvas.</p>
    {/if}
  </section>
{/if}

<style>
  .file {
    display: none;
  }
  .list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  li {
    display: flex;
    gap: 4px;
    align-items: stretch;
  }
  .pick {
    justify-content: flex-start;
    min-width: 0;
    flex: 1;
  }
  .pick span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pick small {
    margin-left: auto;
    font-size: 12px;
    color: var(--ga-ink-1, #9fb0cc);
  }
  li.on .pick {
    border-color: var(--ga-selection-line, #4f7dff);
  }
</style>
