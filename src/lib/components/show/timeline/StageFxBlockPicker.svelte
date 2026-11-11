<script lang="ts">
  /**
   * "+" on the Screen FX or Effects row: what the new block holds. The
   * project's own Screen FX / composition effects come first (the block gets
   * a copy with their settings), then every type (searchable for Effects).
   */
  import { get } from 'svelte/store';
  import type { Effect, StageEffect } from '../../../types';
  import { project } from '../../../stores/layers';
  import { getEffectDef } from '../../../stores/stageEffects';
  import { getDefaultEffectParams } from '../../../renderer/effects';
  import type { StageClipRow } from '../../../timeline/stagefx/stageClips';
  import { BLOCK_EFFECT_CATALOG, SCREEN_FX_CHOICES, effectLabel, type StageBlockPick } from './stageFxRowsUi';
  import { portal } from './trackLayout';

  interface Props {
    row: StageClipRow;
    x: number;
    y: number;
    onpick: (pick: StageBlockPick) => void;
    onclose: () => void;
  }
  let { row, x, y, onpick, onclose }: Props = $props();

  let query = $state('');
  const comp = (get(project) as { mappingComposition?: { stageEffects?: StageEffect[]; effects?: Effect[] } }).mappingComposition;
  const ownScreenFx = comp?.stageEffects ?? [];
  const ownEffects = comp?.effects ?? [];
  const q = $derived(query.trim().toLowerCase());
  const effectList = $derived(q ? BLOCK_EFFECT_CATALOG.filter((e) => e.label.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)) : BLOCK_EFFECT_CATALOG);

  function focus(node: HTMLInputElement) {
    requestAnimationFrame(() => node.focus());
  }
  $effect(() => {
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.('[data-stage-block-picker]')) return;
      onclose();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sbp" use:portal style:left="{x}px" style:top="{y}px" onmousedown={(e) => e.stopPropagation()} data-stage-block-picker={row} data-help-disabled>
  {#if row === 'screenfx'}
    <div class="head">Screen FX block at the playhead</div>
    {#if ownScreenFx.length}
      <div class="sub">From the Screen FX tab (a copy)</div>
      {#each ownScreenFx as eff (eff.id)}
        <button type="button" onclick={() => onpick({ screenFx: { type: eff.type, from: eff } })} data-stage-pick-own={eff.id}>
          <span class="icon">{getEffectDef(eff.type)?.icon ?? '◆'}</span>{getEffectDef(eff.type)?.label ?? eff.type}
        </button>
      {/each}
      <div class="sub">New</div>
    {/if}
    <div class="list">
      {#each SCREEN_FX_CHOICES as def (def.type)}
        <button type="button" onclick={() => onpick({ screenFx: { type: def.type } })} data-stage-pick-type={def.type}>
          <span class="icon">{def.icon}</span>{def.label}
        </button>
      {/each}
    </div>
  {:else}
    <div class="head">Effect block at the playhead</div>
    {#if ownEffects.length}
      <div class="sub">From the Effects tab (a copy)</div>
      {#each ownEffects as eff (eff.id)}
        <button type="button" onclick={() => onpick({ effect: { type: eff.type, params: eff.params, from: eff } })} data-stage-pick-own={eff.id}>{effectLabel(eff.type)}</button>
      {/each}
    {/if}
    <input class="search" placeholder="Search effects" bind:value={query} use:focus data-stage-pick-search
      onkeydown={(e) => { if (e.key === 'Enter' && effectList[0]) onpick({ effect: { type: effectList[0].type, params: getDefaultEffectParams(effectList[0].type) } }); if (e.key === 'Escape') onclose(); }} />
    <div class="list">
      {#each effectList.slice(0, 80) as e (e.type)}
        <button type="button" title={e.description} onclick={() => onpick({ effect: { type: e.type, params: getDefaultEffectParams(e.type) } })} data-stage-pick-type={e.type}>
          {e.label}<span class="cat">{e.category}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sbp {
    position: fixed; z-index: 1000; display: flex; flex-direction: column; width: 230px; max-height: 360px; padding: 4px;
    background: var(--ga-card, #121217); border: 1px solid rgba(167, 139, 250, 0.5); border-radius: 5px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    font-size: 12px; color: var(--ga-ink-0, #e8e8e8);
  }
  .head { padding: 4px 8px; color: #a78bfa; font-weight: 600; }
  .sub { padding: 4px 8px 2px; color: var(--ga-ink-2, #888); font-size: 11px; }
  .list { overflow-y: auto; display: flex; flex-direction: column; min-height: 0; }
  button { display: flex; align-items: center; gap: 6px; background: none; border: 0; text-align: left; color: inherit; padding: 4px 8px; font: inherit; cursor: pointer; border-radius: 3px; }
  button:hover { background: rgba(167, 139, 250, 0.16); }
  .icon { width: 16px; text-align: center; }
  .cat { margin-left: auto; color: var(--ga-ink-2, #888); font-size: 10px; }
  .search {
    margin: 4px; height: 22px; background: var(--ga-slot, rgba(255, 255, 255, 0.04)); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 3px; color: inherit; padding: 0 6px; font: inherit; outline: none;
  }
</style>
