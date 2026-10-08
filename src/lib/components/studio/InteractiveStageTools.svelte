<script lang="ts">
  /** Under the stage: the hint for the current mode and the tools that go with it. */
  import type { EditorMode, TouchTool } from './interactiveEditorTypes';

  export let mode: EditorMode = 'edit';
  export let placingEmitter = false;
  /** Phone or tablet: say "Tap" instead of "Click". */
  export let handheld = false;
  /** Bound: what a touch does in Play mode. */
  export let tool: TouchTool = 'attract';
  export let draftLength = 0;
  /** "emitter" or "light" while that marker is on the stage and can be dragged, else empty. */
  export let markerName = '';
  /** Right-hand note: where the preview pixels come from. */
  export let sourceLabel = '';

  export let onundopoint: () => void;
  export let onfinish: () => void;

  const tools: TouchTool[] = ['attract', 'repel', 'vortex'];

  $: press = handheld ? 'Tap' : 'Click';
  $: hint = placingEmitter
    ? `${press} or drag on the canvas to place the source.${handheld ? '' : ' Esc when done.'}`
    : mode === 'draw'
      ? draftLength < 3
        ? `${press} to add points.`
        : handheld
          ? 'Tap the first point or Finish shape to close it.'
          : 'Click the first point, double-click or press Enter to close it.'
      : mode === 'perform'
        ? 'Drag to stir, attract or repel.'
        : markerName
          ? `Drag a shape, its corners or the ${markerName}.`
          : 'Select a shape. Drag its body or corner handles.';
</script>

<div class="canvas-footer">
  {#if handheld && mode === 'perform'}
    <select class="touch-tool" aria-label="Touch interaction" bind:value={tool}>
      <option value="attract">Attract</option>
      <option value="repel">Repel</option>
      <option value="vortex">Vortex</option>
    </select>
  {/if}
  <span class="stage-hint">{hint}</span>
  {#if mode === 'draw'}
    <div class="stage-tools">
      <button disabled={!draftLength} onclick={onundopoint}>Undo point</button>
      <button disabled={draftLength < 3} onclick={onfinish}>Finish shape</button>
    </div>
  {:else if mode === 'perform' && !handheld}
    <div class="stage-tools" role="group" aria-label="Touch interaction">
      {#each tools as t}
        <button class:active={tool === t} aria-pressed={tool === t} onclick={() => (tool = t)}>{t}</button>
      {/each}
    </div>
  {:else}
    <span class="stage-source">{sourceLabel}</span>
  {/if}
</div>
