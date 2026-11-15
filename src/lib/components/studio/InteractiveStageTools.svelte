<script lang="ts">
  /** Under the stage: the hint for the current mode and the tools that go with it. */
  import type { EditorMode, TouchTool } from './interactiveEditorTypes';
  import Icon from './StudioIcon.svelte';
  import InfoTip from './ui/InfoTip.svelte';

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
  /** The touch tools on offer with the world on (a paired desktop says which it acts on). */
  export let worldTools: TouchTool[] = ['throw', 'push', 'pour', 'ignite', 'attract', 'repel', 'vortex'];
  /** The depth setup step whose control is on the stage, if any. */
  export let depthStep: 'faces' | 'down' | 'projector' | null = null;
  const DEPTH_HINTS = {
    faces: 'Tap a face to change it: Top, Side or Back.',
    down: 'Drag to point the arrow the way things fall.',
    projector: 'Drag up or down to set how steeply the projector looks down.',
  };

  export let onundopoint: () => void;
  export let onfinish: () => void;

  const TOOL_LABELS: Record<TouchTool, string> = { throw: 'Throw', push: 'Push', pour: 'Pour', ignite: 'Ignite', attract: 'Attract', repel: 'Repel', vortex: 'Vortex' };
  $: tools = (world ? worldTools : ['attract', 'repel', 'vortex']) as TouchTool[];
  const PLAY_HINTS: Record<TouchTool, string> = {
    throw: 'Press to throw a ball, hold to keep throwing, flick to fling.',
    push: 'Drag through the balls to sweep them along.',
    pour: 'Hold to pour paint. It runs down whatever it lands on.',
    ignite: 'Press to set fire to whatever is under the finger. It burns on for a few seconds.',
    attract: 'Drag to stir, attract or repel.',
    repel: 'Drag to stir, attract or repel.',
    vortex: 'Drag to stir, attract or repel.',
  };
  /** What each tool does, for the strip's "i". */
  const TOOL_HELP: Record<TouchTool, string> = {
    throw: 'throws a ball where you press; hold to keep throwing, flick to fling it.',
    push: 'sweeps the balls along as you drag through them.',
    pour: 'pours paint while you hold; it runs down whatever it lands on.',
    ignite: 'sets fire to what is under your finger for a few seconds.',
    attract: 'pulls the effects towards your finger.',
    repel: 'pushes the effects away from your finger.',
    vortex: 'swirls the effects round your finger.',
  };

  $: press = handheld ? 'Tap' : 'Click';
  // The phone's tool strip says what the tool does behind its "i", so the line under the stage stays short.
  $: strip = handheld && world && mode === 'perform' && !depthStep;
  $: hint = depthStep
    ? DEPTH_HINTS[depthStep]
    : placingEmitter
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

<div class="canvas-footer" class:with-strip={strip}>
  {#if strip}
    <div class="tool-row">
      <div class="tool-strip" role="radiogroup" aria-label="Touch tool">
        {#each tools as t}
          <button
            role="radio"
            aria-checked={tool === t}
            class:active={tool === t}
            aria-label={TOOL_LABELS[t]}
            onclick={() => (tool = t)}
          >
            <Icon name={`tool-${t}`} size={20} />
          </button>
        {/each}
      </div>
      <InfoTip label="What the touch tools do" title="Touch tools">
        <ul class="tool-help">
          {#each tools as t}<li><b>{TOOL_LABELS[t]}</b> {TOOL_HELP[t]}</li>{/each}
        </ul>
        <p>Throw, Push, Pour and Ignite act on the desktop's 3D world. The phone's preview shows the flat effects only.</p>
      </InfoTip>
    </div>
  {:else if handheld && mode === 'perform'}
    <select class="touch-tool" aria-label="Touch interaction" bind:value={tool}>
      {#each tools as t}<option value={t}>{TOOL_LABELS[t]}</option>{/each}
    </select>
  {/if}
  {#if !strip}<span class="stage-hint">{hint}</span>{/if}
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
  {:else if !strip}
    <span class="stage-source">{sourceLabel}</span>
  {/if}
</div>
