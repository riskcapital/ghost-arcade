<script lang="ts">
  // Per-surface controls for the mapping layer panel:
  //   Geometry - shared with every preset that uses this surface, or kept
  //              for this layer (and presets saved from it) only.
  import { project } from '../stores/layers';
  import type { Layer } from '../types';

  export let layer: Layer;

  $: isSurface = ($project.mapSurfaces ?? []).some((surface) => surface.id === layer.id);
  $: presetCount = ($project.vjMode?.compositions ?? [])
    .filter((composition) => composition.layers.some((l) => (l.surfaceId || l.id) === layer.id)).length;
</script>

{#if isSurface}
  <div class="surface-row">
    <span class="surface-label">Geometry</span>
    {#if layer.surfaceDetached}
      <span class="surface-state detached" data-testid="surface-geometry-state">This layer only</span>
    {:else}
      <span class="surface-state" data-testid="surface-geometry-state">Shared{presetCount ? ` by ${presetCount} preset${presetCount === 1 ? '' : 's'}` : ''}</span>
    {/if}
  </div>
  <div class="surface-actions">
    {#if layer.surfaceDetached}
      <button type="button" data-testid="surface-use-shared" onclick={() => project.setLayerSurfaceSharing(layer.id, 'use')}
        title="Drop this layer's own warp and use the shared one">Use shared</button>
      <button type="button" data-testid="surface-share" onclick={() => project.setLayerSurfaceSharing(layer.id, 'share')}
        title="Make this warp the shared one; every preset using this surface moves to it">Share this</button>
    {:else}
      <button type="button" data-testid="surface-detach" onclick={() => project.setLayerSurfaceSharing(layer.id, 'detach')}
        title="Keep this layer's warp to itself; presets saved from it keep it too">Detach</button>
    {/if}
  </div>
{/if}

<style>
  .surface-row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
  }
  .surface-label {
    color: var(--ga-ink-1, #9aa0ac);
    font-size: 13.5px;
    font-weight: 500;
  }
  .surface-state {
    font-size: 13px;
    color: var(--ga-ink-0, #eef0f4);
  }
  .surface-state.detached {
    color: #f0b35a;
  }
  .surface-actions {
    display: flex;
    gap: 6px;
    margin: 0 0 10px 92px;
  }
  .surface-actions button {
    flex: 1;
    height: 28px;
    background: transparent;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
    font-size: 12.5px;
    cursor: pointer;
  }
  .surface-actions button:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
  }
</style>
