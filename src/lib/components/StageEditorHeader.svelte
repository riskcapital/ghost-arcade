<script lang="ts">
  import { activeSurface, surfaceStore } from '../stores/surface';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { vjStageEdit } from '../stores/vjStageEdit';

  export let onUndo: () => void;
  export let onRedo: () => void;
  export let onFit: () => void;
  export let zoom = 1;
</script>

<div class="stage-header" aria-label="Stage designer toolbar">
  <div class="left">
    <button class="back" onclick={() => vjStageEdit.set(false)}>← <span>Back to {$vjClipLauncher.isOpen ? 'VJ' : 'Mapping'}</span></button>
    <span class="divider"></span>
    <span class="title">Stage Edit</span>
    {#if $activeSurface}
      <input aria-label="Stage layout name" value={$activeSurface.name} onchange={(event) => surfaceStore.renameSurface($activeSurface!.id, event.currentTarget.value)} />
      <span class="dimensions">{$activeSurface.width} × {$activeSurface.height}</span>
    {/if}
  </div>
  <div class="right">
    <span class="live"><i></i> Live output</span>
    <span class="divider"></span>
    <button class="action" onclick={onUndo} title="Undo stage edit" aria-label="Undo stage edit">↶</button>
    <button class="action" onclick={onRedo} title="Redo stage edit" aria-label="Redo stage edit">↷</button>
    <button class="action" onclick={onFit} title="Fit stage to view" aria-label="Fit stage to view">⛶</button>
    <span class="zoom">{Math.round(zoom * 100)}%</span>
  </div>
</div>

<style>
  /* Same bar as the app top bar: 48px, 30px controls, 13px text. */
  .stage-header {
    height: var(--ga-bar-h, 48px);
    flex-shrink: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ga-bar-group-gap, 14px);
    padding: 0 14px;
    background: var(--ga-bar, #100f0d);
    border-bottom: 1px solid var(--ga-line-2);
    color: var(--ga-ink-0);
    font-family: var(--ga-font-ui, system-ui, sans-serif);
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: var(--ga-bar-gap, 6px);
    min-width: 0;
  }
  .back,
  .action {
    height: var(--ga-bar-control-h, 30px);
    box-sizing: border-box;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-1);
    font: inherit;
    font-size: var(--ga-text-body, 13px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    white-space: nowrap;
  }
  .back:hover,
  .action:hover {
    border-color: var(--ga-line-3);
    color: var(--ga-ink-0);
  }
  .action {
    width: var(--ga-bar-control-h, 30px);
    padding: 0;
    display: grid;
    place-items: center;
    font-size: 16px;
  }
  .divider {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--ga-line-2);
    flex-shrink: 0;
  }
  .title {
    color: var(--ga-ink-0);
    font-size: var(--ga-text-title, 14px);
    font-weight: var(--ga-weight-title, 650);
    white-space: nowrap;
  }
  input {
    height: var(--ga-bar-control-h, 30px);
    box-sizing: border-box;
    min-width: 110px;
    max-width: 170px;
    padding: 0 8px;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-0);
    font: inherit;
    font-size: var(--ga-text-body, 13px);
  }
  .dimensions,
  .zoom {
    color: var(--ga-ink-2);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    white-space: nowrap;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ga-green, #46d18a);
    font-size: var(--ga-text-meta, 11px);
    font-weight: 600;
    white-space: nowrap;
  }
  .live i {
    width: 6px;
    height: 6px;
    background: var(--ga-green, #46d18a);
    border-radius: 50%;
    box-shadow: 0 0 7px var(--ga-green, #46d18a);
  }
  .zoom {
    min-width: 34px;
    text-align: right;
  }
  @media (max-width: 960px) {
    .dimensions,
    .live { display: none; }
    .stage-header { gap: 6px; }
    input { max-width: 120px; }
  }
</style>
