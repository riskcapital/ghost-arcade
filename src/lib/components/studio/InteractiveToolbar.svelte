<script lang="ts">
  /** Row above the stage: Select / Draw / Play and the undo, redo, pause and restart buttons. */
  import Icon from './StudioIcon.svelte';
  import type { EditorMode } from './interactiveEditorTypes';

  export let mode: EditorMode = 'edit';
  export let placingEmitter = false;
  export let canUndo = false;
  export let canRedo = false;
  export let paused = false;

  export let onmode: (mode: EditorMode) => void;
  export let onundo: () => void;
  export let onredo: () => void;
  export let onpause: () => void;
  export let onrestart: () => void;

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const undoKeys = mac ? '⌘Z' : 'Ctrl+Z';
  const redoKeys = mac ? '⇧⌘Z' : 'Ctrl+Y';
</script>

<div class="canvas-toolbar">
  <div class="segmented" role="group" aria-label="Stage mode">
    <button
      class:active={mode === 'edit' && !placingEmitter}
      aria-pressed={mode === 'edit'}
      onclick={() => onmode('edit')}
    >
      ↖ Select
    </button>
    <button class:active={mode === 'draw'} aria-pressed={mode === 'draw'} onclick={() => onmode('draw')}>✎ Draw</button>
    <button class:active={mode === 'perform'} aria-pressed={mode === 'perform'} onclick={() => onmode('perform')}>
      ◎ Play
    </button>
  </div>
  <div class="transport">
    <button disabled={!canUndo} onclick={onundo} title={`Undo (${undoKeys})`} aria-label="Undo last edit">
      <Icon name="undo" size={16} />
    </button>
    <button disabled={!canRedo} onclick={onredo} title={`Redo (${redoKeys})`} aria-label="Redo">
      <Icon name="redo" size={16} />
    </button>
    <span class="transport-gap" aria-hidden="true"></span>
    <button
      onclick={onpause}
      title={paused ? 'Resume' : 'Pause'}
      aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
      aria-pressed={paused}
    >
      <Icon name={paused ? 'play' : 'pause'} size={16} />
    </button>
    <button class="restart" onclick={onrestart} title="Restart all simulations" aria-label="Restart simulations">
      <Icon name="restart" size={16} /><span>Restart</span>
    </button>
  </div>
</div>
