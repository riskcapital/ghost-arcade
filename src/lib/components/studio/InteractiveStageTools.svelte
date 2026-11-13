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

  /** The scene's 3D world is on: its balls can be thrown and pushed. */
  export let world = false;

  export let onundopoint: () => void;
  export let onfinish: () => void;

  const TOOL_LABELS: Record<TouchTool, string> = { throw: 'Throw', push: 'Push', attract: 'Attract', repel: 'Repel', vortex: 'Vortex' };
  $: tools = (world ? ['throw', 'push', 'attract', 'repel', 'vortex'] : ['attract', 'repel', 'vortex']) as TouchTool[];
  const PLAY_HINTS: Record<TouchTool, string> = {
    throw: 'Press to throw a ball, hold to keep throwing, flick to fling.',
    push: 'Drag through the balls to sweep them along.',
    attract: 'Drag to stir, attract or repel.',
    repel: 'Drag to stir, attract or repel.',
    vortex: 'Drag to stir, attract or repel.',
  };

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
        ? PLAY_HINTS[tool]
        : markerName
          ? `Drag a shape, its corners or the ${markerName}.`
          : 'Select a shape. Drag its body or corner handles.';
</script>

<div class="canvas-footer">
  {#if handheld && mode === 'perform'}
    <select class="touch-tool" aria-label="Touch interaction" bind:value={tool}>
      {#each tools as t}<option value={t}>{TOOL_LABELS[t]}</option>{/each}
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
        <button class:active={tool === t} aria-pressed={tool === t} onclick={() => (tool = t)}>{TOOL_LABELS[t]}</button>
      {/each}
    </div>
  {:else}
    <span class="stage-source">{sourceLabel}</span>
  {/if}
</div>
