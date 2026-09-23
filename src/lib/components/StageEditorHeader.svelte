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
    <span class="title">STAGE DESIGNER</span>
    {#if $activeSurface}
      <input aria-label="Stage layout name" value={$activeSurface.name} onchange={(event) => surfaceStore.renameSurface($activeSurface!.id, event.currentTarget.value)} />
      <span class="dimensions">{$activeSurface.width} × {$activeSurface.height}</span>
    {/if}
  </div>
  <div class="right">
    <span class="live"><i></i> LIVE OUTPUT</span>
    <span class="divider"></span>
    <button class="action" onclick={onUndo} title="Undo stage edit" aria-label="Undo stage edit">↶</button>
    <button class="action" onclick={onRedo} title="Redo stage edit" aria-label="Redo stage edit">↷</button>
    <button class="action" onclick={onFit} title="Fit stage to view" aria-label="Fit stage to view">⛶</button>
    <span class="zoom">{Math.round(zoom * 100)}%</span>
  </div>
</div>

<style>
  .stage-header{height:45px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:15px;padding:0 12px;background:linear-gradient(180deg,#151a22,#0e1117);border-bottom:1px solid #344259;color:#e5efff;font-family:Inter,system-ui,sans-serif}
  .left,.right{display:flex;align-items:center;gap:10px;min-width:0}.back,.action{height:28px;background:#182333;border:1px solid #3c4e68;border-radius:5px;color:#c5d7f2;cursor:pointer}.back{padding:0 10px;font-size:12px;font-weight:650;white-space:nowrap}.back:hover,.action:hover{border-color:#7099d4;background:#223958;color:#fff}.action{width:30px;font-size:17px}.divider{width:1px;height:18px;background:#39465a;flex-shrink:0}.title{color:#97bdf4;font-size:11px;font-weight:800;letter-spacing:.15em;white-space:nowrap}input{height:27px;min-width:110px;max-width:170px;padding:0 8px;background:#0b0f15;border:1px solid #33435a;border-radius:5px;color:#e8f0fc;font:12px Inter,system-ui,sans-serif}.dimensions,.zoom{color:#91a0b7;font:11px ui-monospace,monospace;white-space:nowrap}.live{display:flex;align-items:center;gap:6px;color:#9dc7b7;font-size:10px;font-weight:800;letter-spacing:.09em;white-space:nowrap}.live i{width:6px;height:6px;background:#5be1a8;border-radius:50%;box-shadow:0 0 7px #5be1a8}.zoom{min-width:34px;text-align:right}
  @media (max-width:960px){.dimensions,.live{display:none}.stage-header{gap:6px}.left,.right{gap:6px}input{max-width:120px}}
</style>
