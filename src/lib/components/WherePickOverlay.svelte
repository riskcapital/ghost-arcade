<script lang="ts">
  /**
   * Picks a group's pieces on the editor canvas (timeline/where/wherePick.ts):
   * every piece is outlined, chosen ones filled; a click puts a piece in or
   * takes it out. The bar names the group, says how it lights, and ends the
   * pick. Esc cancels.
   */
  import { onDestroy } from 'svelte';
  import { project } from '../stores/layers';
  import { pieceSpots } from '../timeline/where/spatialOrder';
  import { wherePick, type WherePick } from '../timeline/where/wherePick';
  import type { Layer } from '../types';

  interface Props {
    canvasX: number;
    canvasY: number;
    canvasWidth: number;
    canvasHeight: number;
  }
  let { canvasX, canvasY, canvasWidth, canvasHeight }: Props = $props();

  let pick = $derived($wherePick);
  let chosen = $state(new Set<string>());
  let together = $state(false);
  let name = $state('');
  let started: WherePick | null = null;

  // A new pick starts from what it was given.
  $effect(() => {
    if (pick && pick !== started) {
      started = pick;
      chosen = new Set(pick.ids);
      together = pick.together;
      name = pick.groupName ?? '';
    }
    if (!pick) started = null;
  });

  let pieces = $derived.by(() => {
    const layers = ($project.layers ?? []) as Layer[];
    const ids = new Set(pieceSpots(layers).map((s) => s.id));
    return layers
      .filter((layer) => ids.has(layer.id))
      .map((layer) => {
        const c = layer.corners;
        const pts = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft]
          .map((p) => `${(p.x * canvasWidth).toFixed(1)},${((1 - p.y) * canvasHeight).toFixed(1)}`)
          .join(' ');
        const cx = (c.topLeft.x + c.topRight.x + c.bottomRight.x + c.bottomLeft.x) / 4;
        const cy = (c.topLeft.y + c.topRight.y + c.bottomRight.y + c.bottomLeft.y) / 4;
        return { id: layer.id, name: layer.name, pts, cx: cx * canvasWidth, cy: (1 - cy) * canvasHeight };
      });
  });

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    chosen = next;
  }

  function done() {
    if (!pick) return;
    const p = pick;
    wherePick.set(null);
    p.commit([...chosen], together, name.trim() || null);
  }

  function cancel() {
    wherePick.set(null);
  }

  function onKey(e: KeyboardEvent) {
    if (!pick) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); done(); }
  }
  window.addEventListener('keydown', onKey);
  onDestroy(() => window.removeEventListener('keydown', onKey));
</script>

{#if pick}
  <div class="pick-layer" style="left: {canvasX}px; top: {canvasY}px; width: {canvasWidth}px; height: {canvasHeight}px;">
    <svg width={canvasWidth} height={canvasHeight} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} aria-label="Pieces: click to put one in the group or take it out">
      {#each pieces as piece (piece.id)}
        <polygon
          class="piece"
          class:chosen={chosen.has(piece.id)}
          points={piece.pts}
          role="checkbox"
          aria-checked={chosen.has(piece.id)}
          aria-label={piece.name}
          tabindex="-1"
          onclick={() => toggle(piece.id)}
        >
          <title>{piece.name}</title>
        </polygon>
      {/each}
    </svg>
  </div>
  <div class="pick-bar" role="dialog" aria-label="Choose the pieces" data-where-pick>
    <span class="pick-title">{pick.groupName ? `Pieces of ${pick.groupName}` : 'Pieces for this block'}</span>
    <span class="pick-count">{chosen.size} chosen</span>
    <button type="button" onclick={() => (chosen = new Set(pieces.map((p) => p.id)))}>All</button>
    <button type="button" onclick={() => (chosen = new Set())}>None</button>
    <label class="pick-check" title="All the chosen pieces light at once, instead of one after another along the order">
      <input type="checkbox" checked={together} onchange={(e) => (together = (e.currentTarget as HTMLInputElement).checked)} />
      Light together
    </label>
    <input class="pick-name" placeholder={pick.groupName ? 'Name' : 'Name it to reuse it'} bind:value={name}
      title="With a name, the pieces are kept as a group (★) other blocks can use" />
    <button type="button" class="primary" onclick={done} disabled={chosen.size === 0} data-where-pick-done>Done</button>
    <button type="button" onclick={cancel}>Cancel</button>
  </div>
{/if}

<style>
  .pick-layer {
    position: absolute;
    z-index: 80;
  }
  .piece {
    fill: rgba(255, 255, 255, 0.04);
    stroke: rgba(255, 255, 255, 0.55);
    stroke-width: 1;
    cursor: pointer;
  }
  .piece:hover { fill: rgba(255, 255, 255, 0.12); }
  .piece.chosen {
    fill: color-mix(in srgb, var(--ga-icon, #5278ff) 40%, transparent);
    stroke: var(--ga-icon, #5278ff);
    stroke-width: 2;
  }
  .pick-bar {
    position: absolute;
    left: 50%;
    top: 10px;
    z-index: 85;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 24px);
    padding: 4px 4px 4px 10px;
    background: rgba(8, 10, 18, 0.94);
    border: 1px solid var(--ga-icon, #5278ff);
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-control, 12px);
  }
  .pick-title { font-weight: 700; white-space: nowrap; }
  .pick-count {
    color: var(--ga-ink-1, #b8b2c2);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    white-space: nowrap;
  }
  .pick-check { display: flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; }
  .pick-check input { margin: 0; }
  .pick-name {
    width: 140px;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 6px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.3));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #f2ede4);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
  }
  .pick-bar button {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 10px;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.16));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #f2ede4);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    white-space: nowrap;
  }
  .pick-bar button:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.3)); }
  .pick-bar button:disabled { opacity: 0.45; cursor: default; }
  .pick-bar button.primary { background: var(--ga-icon, #5278ff); border-color: var(--ga-icon, #5278ff); color: #fff; }
</style>
