<script lang="ts">
  import { settings } from '../stores/settings';

  export let containerWidth: number;
  export let containerHeight: number;

  $: gridSettings = $settings.ui.gridSettings;
  $: columns = gridSettings?.columns || 12;
  $: rows = gridSettings?.rows || 12;
  $: enabled = gridSettings?.enabled || false;
</script>

{#if enabled}
  <svg
    class="grid-overlay"
    style="width: {containerWidth}px; height: {containerHeight}px;"
    viewBox="0 0 {containerWidth} {containerHeight}"
  >
    <!-- Vertical lines -->
    {#each Array(columns - 1) as _, i}
      {@const x = ((i + 1) / columns) * containerWidth}
      <line x1={x} y1={0} x2={x} y2={containerHeight} />
    {/each}
    <!-- Horizontal lines -->
    {#each Array(rows - 1) as _, j}
      {@const y = ((j + 1) / rows) * containerHeight}
      <line x1={0} y1={y} x2={containerWidth} y2={y} />
    {/each}
  </svg>
{/if}

<style>
  .grid-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 1;
  }

  .grid-overlay line {
    stroke: rgba(255, 255, 255, 0.12);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
</style>
