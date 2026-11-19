<script lang="ts">
  // Per-surface controls for the mapping layer panel:
  //   Source   - own content, a VJ row, the deck mix or a VJ group. A live
  //              source plays on this surface in VJ MAP and STAGE.
  //   Geometry - shared with every preset that uses this surface, or kept
  //              for this layer (and presets saved from it) only.
  import { project } from '../stores/layers';
  import { surfaceIdOf } from '../stores/mapSurfaces';
  import { openSurfaceLink } from '../stores/surfaceLinkRequest';
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
  // A layer is its own surface unless it was linked to another one.
  $: surfaceId = surfaceIdOf(layer);
  $: isSurface = ($project.mapSurfaces ?? []).some((surface) => surface.id === surfaceId);
  $: linkedTo = surfaceId !== layer.id
    ? ($project.mapSurfaces ?? []).find((surface) => surface.id === surfaceId)?.name ?? null
    : null;
  $: presetCount = ($project.vjMode?.compositions ?? [])
    .filter((composition) => composition.layers.some((l) => surfaceIdOf(l) === surfaceId)).length;

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
    <p class="surface-hint">Plays the live VJ picture here while VJ is live, in Map and Stage.</p>
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
  {#if linkedTo}
    <p class="surface-hint" data-testid="surface-linked-to">Linked to <span class="surface-ref">{linkedTo}</span></p>
  {/if}
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
  <div class="surface-actions">
    <button type="button" data-testid="surface-link" onclick={() => openSurfaceLink({ surfaceId })}
      title="Put layers of other presets on an existing surface, so its warp moves them all">Link to surface…</button>
  </div>
{/if}

<style>
  /* Same grid as the inspector's property rows (76px label column). */
  .surface-row {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    min-height: var(--ga-control-h, 26px);
    margin-bottom: 6px;
  }
  .surface-row label,
  .surface-label {
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-body, 500);
  }
  .surface-row select {
    min-width: 0;
    height: var(--ga-control-h, 26px);
    background: transparent;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    padding: 0 8px;
    border-radius: var(--ga-r-hard, 2px);
    font-size: var(--ga-text-control, 12px);
  }
  .surface-state {
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-0, #eef0f4);
  }
  .surface-state.detached {
    color: #f0b35a;
  }
  .surface-ref {
    color: var(--ga-blue-300, #7d9aff);
  }
  .surface-hint {
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #777);
    margin: -2px 0 8px;
    line-height: 1.45;
  }
  .surface-actions {
    display: flex;
    gap: 6px;
    margin: 0 0 8px 82px;
  }
  .surface-actions button {
    flex: 1;
    height: var(--ga-control-h, 26px);
    background: transparent;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .surface-actions button:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
  }
</style>
