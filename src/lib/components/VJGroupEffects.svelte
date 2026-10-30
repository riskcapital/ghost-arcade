<script lang="ts">
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import type { VJGroup } from '../stores/vjGroups';
  import type { Effect, EffectParams } from '../types';
  import { effectParamLabels, type ParamMeta } from '../effects/effectUX';
  import { EFFECT_CATALOG } from '../effects/effectCatalog';
  import { nativeEffectChainWarning } from '../renderer/nativeEffectChainPolicy';
  import EffectPickerModal from './EffectPickerModal.svelte';
  import NumericInput from './NumericInput.svelte';
  import CubeLutControls from './CubeLutControls.svelte';
  export let group: VJGroup;
  let pickerOpen = false;
  let error = '';
  $: warning = nativeEffectChainWarning(group.effects);
  const labels = Object.fromEntries(EFFECT_CATALOG.map(effect => [effect.type, effect.label]));
  function params(effect: Effect): Array<[string, ParamMeta]> { return Object.entries(effectParamLabels[effect.type] ?? {}); }
  function value(effect: Effect, key: string, fallback: number) {
    const number = (effect.params as Record<string, unknown>)[key];
    return typeof number === 'number' && Number.isFinite(number) ? number : fallback;
  }
  function patch(effect: Effect, values: Partial<EffectParams>) { vjClipLauncher.updateGroupEffect(group.id, effect.id, { params: values }); }
  function color(effect: Effect, keys: NonNullable<ParamMeta['colorParams']>) {
    return '#' + [keys.r, keys.g, keys.b].map(key => Math.round(Math.max(0, Math.min(1, value(effect, key, 1))) * 255).toString(16).padStart(2, '0')).join('');
  }
</script>
<details data-help-page="vj-mode" class="fx">
  <summary>Effects <span>{group.effects.length}</span></summary>
  <p>Applied to the combined group before its level and blend.</p>
  {#if warning}<p class="warning" role="status">{warning}</p>{/if}
  {#each group.effects as effect, index (effect.id)}
    <div class="effect" class:bypassed={effect.enabled === false}>
      <div class="effect-head">
        <button class:active={effect.enabled !== false} aria-label={`Enable ${labels[effect.type] ?? effect.type}`} aria-pressed={effect.enabled !== false} onclick={() => vjClipLauncher.updateGroupEffect(group.id, effect.id, { enabled: effect.enabled === false })}>⏻</button>
        <strong>{labels[effect.type] ?? effect.type}</strong>
        <button disabled={index === 0} title="Move effect earlier" onclick={() => vjClipLauncher.moveGroupEffect(group.id, effect.id, -1)}>↑</button>
        <button disabled={index === group.effects.length - 1} title="Move effect later" onclick={() => vjClipLauncher.moveGroupEffect(group.id, effect.id, 1)}>↓</button>
        <button title="Remove effect" onclick={() => vjClipLauncher.removeGroupEffect(group.id, effect.id)}>×</button>
      </div>
      <details class="parameters">
        <summary>Parameters</summary>
        <NumericInput midiPath={`vj:group:${encodeURIComponent(group.id)}:fx:${effect.id}:mix`} midiLabel={`${group.name} · ${labels[effect.type]} mix`} label="Mix" value={effect.opacity ?? 1} min={0} max={1} step={0.01} on:input={event => vjClipLauncher.updateGroupEffect(group.id, effect.id, { opacity: event.detail })} />
        {#if effect.type === 'cubeLut'}<CubeLutControls lut={effect.params.cubeLut} contextKey={`group:${group.id}:${effect.id}`} onChange={cubeLut => patch(effect, { cubeLut })} />{/if}
        {#each params(effect) as [key, meta]}
          {#if meta.type === 'select' && meta.options}
            <label class="choice">{meta.label}<select value={value(effect, key, meta.default)} onchange={event => patch(effect, { [key]: Number(event.currentTarget.value) })}>
              {#each meta.options as option}<option value={option.value}>{option.label}</option>{/each}
            </select></label>
          {:else if meta.type === 'color' && meta.colorParams}
            {@const keys = meta.colorParams}
            <label class="choice">{meta.label}<input type="color" value={color(effect, keys)} oninput={event => {
              const hex = event.currentTarget.value;
              patch(effect, { [keys.r]: parseInt(hex.slice(1, 3), 16) / 255, [keys.g]: parseInt(hex.slice(3, 5), 16) / 255, [keys.b]: parseInt(hex.slice(5, 7), 16) / 255 });
            }} /></label>
          {:else}
            <NumericInput midiPath={`vj:group:${encodeURIComponent(group.id)}:fx:${effect.id}:param:${key}`} midiLabel={`${group.name} · ${labels[effect.type]} · ${meta.label}`} label={meta.label} value={value(effect, key, meta.default)} min={meta.min} max={meta.max} step={meta.step} on:input={event => patch(effect, { [key]: event.detail })} />
          {/if}
        {/each}
      </details>
    </div>
  {/each}
  <button class="add" onclick={() => { error = ''; pickerOpen = true; }}>+ Add effect</button>
  {#if error}<p class="warning" role="status">{error}</p>{/if}
</details>
<EffectPickerModal bind:open={pickerOpen} onClose={() => pickerOpen = false} onAdd={types => {
  error = vjClipLauncher.addGroupEffects(group.id, types) ?? '';
  pickerOpen = false;
}} />
<style>
  .fx { margin-top: 8px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); padding: 0 8px; }
  summary { line-height: var(--ga-control-h, 26px); cursor: pointer; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); color: var(--ga-ink-1, #ada9a2); }
  summary:hover { color: var(--ga-ink-0, #f2ede4); }
  summary span { font-variant-numeric: tabular-nums; margin-left: 6px; color: var(--ga-ink-2, #89857e); font-weight: var(--ga-weight-body, 500); }
  .fx[open] { padding-bottom: 8px; }
  p { font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--ga-ink-2, #89857e); margin: 4px 0 8px; }
  .warning { color: #e4ba7b; }
  .effect { border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); padding: 8px 0; }
  .effect-head { display: flex; gap: 4px; align-items: center; }
  .effect-head strong { flex: 1; min-width: 0; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); color: var(--ga-ink-0, #f2ede4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bypassed strong { color: var(--ga-ink-2, #89857e); }
  button, select { height: var(--ga-control-h-sm, 22px); box-sizing: border-box; color: var(--ga-ink-1, #ada9a2); background: var(--ga-card, #16140f); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); padding: 0 6px; font-family: inherit; font-size: var(--ga-text-control, 12px); }
  .effect-head button { min-width: 22px; padding: 0; }
  button { cursor: pointer; } button:disabled { opacity: .35; cursor: default; }
  button:hover:not(:disabled):not(.active) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  button.active { background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); color: var(--ga-selection-ink, #e0e8ff); }
  .parameters { margin-top: 6px; display: block; }
  .parameters > summary { line-height: var(--ga-control-h-sm, 22px); font-size: var(--ga-text-meta, 11px); }
  .parameters :global(.ni) { margin-top: 6px; }
  .choice { display: flex; gap: 8px; justify-content: space-between; align-items: center; margin-top: 6px; font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1, #ada9a2); }
  .choice select { max-width: 65%; height: var(--ga-control-h, 26px); background: var(--ga-slot, #060504); color: var(--ga-ink-0, #f2ede4); }
  .add { height: var(--ga-control-h, 26px); margin-top: 6px; padding: 0 10px; font-weight: var(--ga-weight-control, 600); }
</style>
