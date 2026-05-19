<script lang="ts">
  import { settings } from '../stores/settings';

  $: gridSettings = $settings.ui.gridSettings;
  $: columns = gridSettings?.columns || 12;
  $: rows = gridSettings?.rows || 12;
  $: enabled = gridSettings?.enabled || false;

  // Pre-compute the line positions in 0-100 viewBox space so the
  // template stays free of {@const} (which has historically tripped up
  // template rendering on this file).
  $: verticals = (() => {
    const out: number[] = [];
    for (let i = 1; i < columns; i++) out.push((i / columns) * 100);
    return out;
  })();
  $: horizontals = (() => {
    const out: number[] = [];
    for (let j = 1; j < rows; j++) out.push((j / rows) * 100);
    return out;
  })();
</script>

{#if enabled}
  <svg
    class="grid-overlay"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
  >
    {#each verticals as x}
      <line x1={x} y1="0" x2={x} y2="100" />
    {/each}
    {#each horizontals as y}
      <line x1="0" y1={y} x2="100" y2={y} />
    {/each}
  </svg>
{/if}

<style>
  /* Self-sizing overlay: position:absolute + top/left/right/bottom:0
     stretches across whatever the parent is (Canvas.svelte's
     .canvas-container in practice), so the grid always aligns with
     the project's visible canvas region. vector-effect:non-scaling-stroke
     keeps the line weight 1px regardless of SVG → DOM stretch. */
  .grid-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 5;
  }

  .grid-overlay line {
    stroke: rgba(255, 255, 255, 0.22);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
</style>
