<script lang="ts">
  // Per-surface controls for the mapping layer panel:
  //   Source   - own content, a VJ row, the deck mix or a VJ group. A live
  //              source plays on this surface in VJ MAP and STAGE.
  //   Geometry - shared with every preset that uses this surface, or kept
  //              for this layer (and presets saved from it) only.
  import { project } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { VJ_MIX_SOURCE_INDEX, type Layer } from '../types';

  export let layer: Layer;
  /** Screens always show a VJ feed, so they have no "own content" choice. */
  export let showSource = true;

  $: sourceValue = layer.vjGroupId
    ? `group:${layer.vjGroupId}`
    : layer.vjLayerIndex == null ? 'own' : String(layer.vjLayerIndex);
  $: groups = $vjClipLauncher.groups ?? [];
  $: missingGroup = !!layer.vjGroupId && !groups.some((group) => group.id === layer.vjGroupId);
  $: isSurface = ($project.mapSurfaces ?? []).some((surface) => surface.id === layer.id);
  $: presetCount = ($project.vjMode?.compositions ?? [])
    .filter((composition) => composition.layers.some((l) => (l.surfaceId || l.id) === layer.id)).length;

  function setSource(value: string) {
    if (value.startsWith('group:')) project.setLayerVJGroup(layer.id, value.slice(6));
    else project.setLayerVJIndex(layer.id, value === 'own' ? undefined : Number(value));
  }
</script>

{#if showSource}
  <div class="surface-row">
    <label for={`surface-source-${layer.id}`}>Source</label>
    <select
      id={`surface-source-${layer.id}`}
      data-testid="surface-source"
      value={sourceValue}
      onchange={(e) => setSource(e.currentTarget.value)}
    >
      <option value="own">Own content</option>
      <option value={String(VJ_MIX_SOURCE_INDEX)}>Deck mix</option>
      {#each Array($vjClipLauncher.numLayers) as _, i}
        {@const playing = $vjClipLauncher.layerStates[i]?.activeClip}
        <option value={String(i)}>VJ row {i + 1}{playing && playing.type !== 'preset' ? ` · ${playing.name}` : ''}</option>
      {/each}
      {#each groups as group}
        <option value={`group:${group.id}`}>Group · {group.name}</option>
      {/each}
      {#if missingGroup}
        <option value={`group:${layer.vjGroupId}`}>Group (removed)</option>
      {/if}
    </select>
  </div>
  {#if sourceValue !== 'own'}
    <p class="surface-hint">Plays the live VJ picture here while VJ is live, in MAP and STAGE.</p>
  {/if}
{/if}

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
  .surface-row label,
  .surface-label {
    color: var(--ga-ink-1, #9aa0ac);
    font-size: 13.5px;
    font-weight: 500;
  }
  .surface-row select {
    min-width: 0;
    height: 32px;
    background: transparent;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    padding: 0 8px;
    border-radius: var(--ga-r-hard, 2px);
    font-size: 14px;
  }
  .surface-state {
    font-size: 13px;
    color: var(--ga-ink-0, #eef0f4);
  }
  .surface-state.detached {
    color: #f0b35a;
  }
  .surface-hint {
    font-size: 12px;
    color: #777;
    margin: -2px 0 8px;
    line-height: 1.4;
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
