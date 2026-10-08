<script lang="ts">
  /** Row above the stage: Select / Draw / Play and the undo, pause and restart buttons. */
  import Icon from './StudioIcon.svelte';
  import type { EditorMode } from './interactiveEditorTypes';

  export let mode: EditorMode = 'edit';
  export let placingEmitter = false;
  export let canUndo = false;
  export let paused = false;

  export let onmode: (mode: EditorMode) => void;
  export let onundo: () => void;
  export let onpause: () => void;
  export let onrestart: () => void;
</script>

<div class="canvas-toolbar">
  <div class="segmented">
    <button class:active={mode === 'edit' && !placingEmitter} onclick={() => onmode('edit')}>↖ Select</button>
    <button class:active={mode === 'draw'} onclick={() => onmode('draw')}>✎ Draw</button>
    <button class:active={mode === 'perform'} onclick={() => onmode('perform')}>◎ Play</button>
  </div>
  <div class="transport">
    <button disabled={!canUndo} onclick={onundo} title="Undo" aria-label="Undo last edit">
      <Icon name="undo" size={16} />
    </button>
    <button onclick={onpause} aria-label={paused ? 'Resume simulation' : 'Pause simulation'} aria-pressed={paused}>
      <Icon name={paused ? 'play' : 'pause'} size={16} />
    </button>
    <button onclick={onrestart} title="Restart all simulations" aria-label="Restart simulations">
      <Icon name="redo" size={16} />
    </button>
  </div>
</div>
