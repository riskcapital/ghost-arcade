<script lang="ts">
  /** Under the stage: the hint for the current mode and the tools that go with it. */
  import type { EditorMode, TouchTool } from './interactiveEditorTypes';

  export let mode: EditorMode = 'edit';
  export let placingEmitter = false;
  export let handheld = false;
  /** Bound: what a touch does in Play mode. */
  export let tool: TouchTool = 'attract';
  export let draftLength = 0;
  /** Right-hand note: where the preview pixels come from. */
  export let sourceLabel = '';

  export let onundopoint: () => void;
  export let onfinish: () => void;

  const tools: TouchTool[] = ['attract', 'repel', 'vortex'];

  $: hint = placingEmitter
    ? 'Drag on the canvas to position the source.'
    : mode === 'draw'
      ? 'Tap the outline, then finish.'
      : mode === 'perform'
        ? 'Drag to stir, attract or repel.'
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
  <span>{hint}</span>
  <span>{sourceLabel}</span>
</div>
{#if mode === 'draw'}
  <div class="tools">
    <button disabled={!draftLength} onclick={onundopoint}>Undo point</button>
    <button disabled={draftLength < 3} onclick={onfinish}>Finish shape</button>
  </div>
{/if}
{#if mode === 'perform' && !handheld}
  <div class="tools">
    {#each tools as t}
      <button class:active={tool === t} onclick={() => (tool = t)}>{t}</button>
    {/each}
  </div>
{/if}
