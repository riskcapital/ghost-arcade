<script lang="ts">
  /**
   * An Interactive 3D layer in the Properties panel: which world it plays,
   * rebuilding it from the stage, and why it cannot draw when it cannot.
   */
  import { project } from '../../stores/layers';
  import { nativeFailedRouteLayers } from '../../stores/nativeRenderer';
  import { checkScene3D } from '../../scene3d/sceneModel';
  import { WORLDS, type WorldId } from '../../scene3d/worlds';
  import type { Layer } from '../../types';
  import Scene3DEditor from './Scene3DEditor.svelte';

  export let layer: Layer;
  let editing = false;

  $: source = layer.source?.effectSource;
  $: world = (source?.scene3dWorld ?? 'light-and-shadow') as WorldId;
  $: chosen = WORLDS.find((w) => w.id === world);
  $: check = checkScene3D(source?.scene3d);
  $: failed = $nativeFailedRouteLayers.includes(layer.id);
  $: counts = check.scene
    ? {
        shapes: check.scene.nodes.filter((n) => n.kind === 'mesh' && n.shape === 'outline').length,
        lights: check.scene.nodes.filter((n) => n.kind === 'light').length,
        emitters: check.scene.nodes.filter((n) => n.kind === 'emitter').length,
      }
    : null;
</script>

<div class="property-row">
  <label for="scene3d-world-{layer.id}">World</label>
  <select
    id="scene3d-world-{layer.id}"
    value={world}
    onchange={(e) => project.setScene3DWorld(layer.id, e.currentTarget.value as WorldId)}
  >
    {#each WORLDS as w}
      <option value={w.id} disabled={!w.ready}>{w.ready ? w.name : `${w.name} (coming with bodies and rules)`}</option>
    {/each}
  </select>
</div>
{#if chosen}<p class="scene3d-note">{chosen.blurb}</p>{/if}
{#if counts}
  <p class="scene3d-note">Shapes from the stage: {counts.shapes}. Lights: {counts.lights}. Particle emitters: {counts.emitters}.</p>
{/if}
<div class="property-row">
  <span></span>
  <button
    class="btn-small"
    title="Build the world again from the shapes mapped now. Replaces this world; undo brings it back."
    onclick={() => project.setScene3DWorld(layer.id, world)}>Rebuild from stage</button
  >
</div>
<div class="property-row">
  <span></span>
  <button class="btn-small" aria-expanded={editing} disabled={!check.scene} onclick={() => (editing = !editing)}>{editing ? 'Close editor' : 'Edit world'}</button>
</div>
{#if editing && check.scene}
  <Scene3DEditor layerId={layer.id} scene={check.scene} />
{/if}
{#if check.error}
  <p class="scene3d-error" role="alert">This world cannot be read: {check.error}</p>
{:else if failed}
  <p class="scene3d-error" role="alert">This world could not be drawn. The message is in the log.</p>
{/if}

<style>
  /* The Properties panel's row look (its styles are scoped to LayerPanel). */
  .property-row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h, 26px);
    margin-bottom: 6px;
  }
  .property-row label {
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-body, 500);
  }
  .property-row select {
    height: var(--ga-control-h, 26px);
    background: transparent;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    padding: 0 24px 0 8px;
    border-radius: var(--ga-r-hard, 2px);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-body, 500);
  }
  .btn-small {
    justify-self: start;
    min-height: var(--ga-control-h, 26px);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
  }
  .btn-small:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    color: var(--ga-ink-0, #fff);
  }
  .scene3d-note,
  .scene3d-error {
    padding-left: 92px;
  }
  .scene3d-note {
    margin: 0 0 8px;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #8a8a8a);
    line-height: 1.4;
  }
  .scene3d-error {
    margin: 0 0 8px;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-danger, #e5484d);
    line-height: 1.4;
  }
</style>
