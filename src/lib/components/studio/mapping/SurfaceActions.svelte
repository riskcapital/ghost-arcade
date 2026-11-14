<script lang="ts">
  /** Managing surfaces: several at once, groups, copies, mirrors, drawing order, solo and test patterns. */
  import './mappingPanel.css';
  import type { Surface } from '../../../mobile/studio/model';
  import type { SurfacePattern } from '../../../mobile/studio/compositor';
  import { duplicateSurface, mirrorSurface, reorderSurfaces, setGroup, unweldAt, weldCount, withGroups } from '../../../mobile/studio/mapping/edit';
  import MapIcon from './MapIcon.svelte';

  type Props = {
    surfaces: Surface[];
    index: number;
    selection: number[];
    multi: boolean;
    solo: boolean;
    pattern: SurfacePattern | null;
    onapply: (surfaces: Surface[], select?: { index: number; selection: number[] }) => void;
    onmulti: (on: boolean) => void;
    onsolo: (on: boolean) => void;
    onpattern: (pattern: SurfacePattern | null) => void;
    onnotice: (message: string) => void;
  };
  let { surfaces, index, selection, multi, solo, pattern, onapply, onmulti, onsolo, onpattern, onnotice }: Props = $props();
  const s = $derived(surfaces[index]);
  const picked = $derived(selection.length > 1 ? selection : [index]);
  const grouped = $derived(withGroups(surfaces, picked).length > 1 && picked.some((i) => surfaces[i]?.group));
  const welds = $derived(s ? weldCount(surfaces, index) : 0);

  function duplicate() {
    if (!s) return;
    if (surfaces.length >= 16) return onnotice('A set supports up to 16 surfaces.');
    onapply([...surfaces, duplicateSurface(s)], { index: surfaces.length, selection: [] });
  }
  function mirror(h: boolean) {
    const chosen = withGroups(surfaces, picked).filter((i) => !surfaces[i].locked);
    if (!chosen.length) return;
    onapply(surfaces.map((x, i) => (chosen.includes(i) ? mirrorSurface(x, h) : x)));
  }
  function order(by: number) {
    const to = index + by;
    if (to < 0 || to >= surfaces.length) return;
    const next = reorderSurfaces(surfaces, index, to);
    onapply(next, { index: to, selection: [] });
  }
  function unweldAll() {
    if (!s?.welds) return;
    let next = surfaces;
    for (const w of s.welds) next = unweldAt(next, index, w);
    onapply(next);
    onnotice('Unwelded: this surface\'s points move on their own again.');
  }
  const patterns: { id: SurfacePattern | null; label: string }[] = [
    { id: null, label: 'Off' },
    { id: 'identify', label: 'Number' },
    { id: 'card', label: 'Grid' },
    { id: 'white', label: 'White' },
  ];
</script>

{#if s}
  <section class="mp" aria-label="Arrange surfaces">
    <div class="mp-head"><strong>ARRANGE</strong>{#if selection.length > 1}<span class="mp-label">{selection.length} selected</span>{/if}</div>
    <div class="mp-row">
      <button class="grow" aria-pressed={multi} onclick={() => onmulti(!multi)}><MapIcon name="group" size={16} />{multi ? 'Done selecting' : 'Select several'}</button>
      {#if grouped}
        <button class="grow" onclick={() => onapply(setGroup(surfaces, withGroups(surfaces, picked), false))}>Ungroup</button>
      {:else}
        <button class="grow" disabled={selection.length < 2} onclick={() => { onapply(setGroup(surfaces, selection, true)); onnotice('Grouped: tap any of them to pick up the whole group.'); }}>Group</button>
      {/if}
    </div>
    {#if multi}<p class="mp-hint" role="status">Tap surfaces on the canvas to add or remove them. Then drag any of them to move all; use the dots around them to turn and size.</p>{/if}
    <div class="mp-row">
      <button class="grow" disabled={surfaces.length >= 16} onclick={duplicate}><MapIcon name="duplicate" size={16} />Duplicate</button>
      <button aria-label="Mirror left to right" onclick={() => mirror(true)}><MapIcon name="mirrorH" size={18} /></button>
      <button aria-label="Mirror top to bottom" onclick={() => mirror(false)}><MapIcon name="mirrorV" size={18} /></button>
      <button aria-label="Bring forward" disabled={index >= surfaces.length - 1} onclick={() => order(1)}><MapIcon name="up" size={18} /></button>
      <button aria-label="Send backward" disabled={index <= 0} onclick={() => order(-1)}><MapIcon name="down" size={18} /></button>
    </div>
    <div class="mp-row">
      <button class="grow" aria-pressed={solo} onclick={() => onsolo(!solo)}><MapIcon name="solo" size={16} />{solo ? 'Solo on' : 'Solo'}</button>
      {#if welds}<button class="grow" onclick={unweldAll}><MapIcon name="unweld" size={16} />Unweld ({welds})</button>{/if}
    </div>
    <span class="mp-label pattern-label">Test pattern on the projector</span>
    <div class="mp-seg" role="group" aria-label="Test pattern on this surface">
      {#each patterns as p}<button class:active={pattern === p.id} aria-pressed={pattern === p.id} onclick={() => onpattern(p.id)}>{p.label}</button>{/each}
    </div>
  </section>
{/if}

<style>
  .pattern-label {
    display: block;
    margin: 12px 0 6px;
  }
</style>
