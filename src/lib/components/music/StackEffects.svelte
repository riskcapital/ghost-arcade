<script lang="ts">
  /**
   * An effect chain in the clip visuals editor: a layer's own effects, or the
   * whole stack's. Native passes only (they run on the layer's picture before
   * it is mixed), at most NATIVE_EFFECT_PASS_LIMIT enabled.
   */
  import type { Effect, EffectParams, EffectType } from '../../types';
  import { effectParamLabels, type ParamMeta } from '../../effects/effectUX';
  import { EFFECT_CATALOG } from '../../effects/effectCatalog';
  import { getDefaultEffectParams } from '../../renderer/effects';
  import { NATIVE_EFFECT_PASS_LIMIT, nativeEffectChainWarning } from '../../renderer/nativeEffectChainPolicy';
  import { isNativeSelectableEffect } from '../../renderer/nativeEffectCoverage';
  import EffectPickerModal from '../EffectPickerModal.svelte';
  import NumericInput from '../NumericInput.svelte';

  let { effects, note, onchange }: { effects: Effect[]; note: string; onchange: (effects: Effect[]) => void } = $props();

  let pickerOpen = $state(false);
  let error = $state('');
  const warning = $derived(nativeEffectChainWarning(effects));
  const labels = Object.fromEntries(EFFECT_CATALOG.map((effect) => [effect.type, effect.label]));
  const params = (effect: Effect): Array<[string, ParamMeta]> => Object.entries(effectParamLabels[effect.type] ?? {});
  function value(effect: Effect, key: string, fallback: number) {
    const n = (effect.params as Record<string, unknown>)[key];
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  }
  const edit = (id: string, patch: Partial<Effect>) => onchange(effects.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const patchParams = (effect: Effect, values: Partial<EffectParams>) => edit(effect.id, { params: { ...effect.params, ...values } as EffectParams });
  function move(index: number, by: number) {
    const next = [...effects];
    const [it] = next.splice(index, 1);
    next.splice(index + by, 0, it);
    onchange(next);
  }
  function add(types: EffectType[]) {
    pickerOpen = false;
    if (types.some((type) => !isNativeSelectableEffect(type))) {
      error = 'Choose effects the native renderer runs.';
      return;
    }
    if (effects.filter((e) => e.enabled !== false).length + types.length > NATIVE_EFFECT_PASS_LIMIT) {
      error = `Up to ${NATIVE_EFFECT_PASS_LIMIT} effects. Turn off or remove some first.`;
      return;
    }
    error = '';
    onchange([...effects, ...types.map((type) => ({ id: crypto.randomUUID(), type, enabled: true, opacity: 1, blendMode: 'normal' as const, params: { ...getDefaultEffectParams(type) } }))]);
  }
</script>

<div class="stack-fx">
  <p class="note">{note}</p>
  {#if warning}<p class="warning" role="status">{warning}</p>{/if}
  {#each effects as effect, index (effect.id)}
    <div class="effect" class:bypassed={effect.enabled === false}>
      <div class="head">
        <button class="toggle" class:on={effect.enabled !== false} aria-pressed={effect.enabled !== false} aria-label="Turn {labels[effect.type] ?? effect.type} on or off" onclick={() => edit(effect.id, { enabled: effect.enabled === false })}>⏻</button>
        <strong>{labels[effect.type] ?? effect.type}</strong>
        <button disabled={index === 0} title="Earlier in the chain" aria-label="Move earlier" onclick={() => move(index, -1)}>↑</button>
        <button disabled={index === effects.length - 1} title="Later in the chain" aria-label="Move later" onclick={() => move(index, 1)}>↓</button>
        <button title="Remove this effect" aria-label="Remove" onclick={() => onchange(effects.filter((e) => e.id !== effect.id))}>×</button>
      </div>
      <div class="params">
        <NumericInput label="Mix" value={effect.opacity ?? 1} min={0} max={1} step={0.01} on:input={(event) => edit(effect.id, { opacity: event.detail })} />
        {#each params(effect) as [key, meta] (key)}
          {#if meta.type === 'select' && meta.options}
            <label class="choice">{meta.label}<select value={value(effect, key, meta.default)} onchange={(event) => patchParams(effect, { [key]: Number(event.currentTarget.value) })}>
              {#each meta.options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
            </select></label>
          {:else if meta.type !== 'color'}
            <NumericInput label={meta.label} value={value(effect, key, meta.default)} min={meta.min} max={meta.max} step={meta.step} on:input={(event) => patchParams(effect, { [key]: event.detail })} />
          {/if}
        {/each}
      </div>
    </div>
  {/each}
  <button class="add" onclick={() => { error = ''; pickerOpen = true; }}>+ Effect</button>
  {#if error}<p class="warning" role="status">{error}</p>{/if}
</div>
<EffectPickerModal bind:open={pickerOpen} onClose={() => (pickerOpen = false)} onAdd={add} />

<style>
  .stack-fx { display: flex; flex-direction: column; gap: 6px; }
  .note { margin: 0; font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--ga-ink-2, #89857e); }
  .warning { margin: 0; font-size: var(--ga-text-meta, 11px); color: #e4ba7b; }
  .effect { border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); padding-top: 6px; }
  .head { display: flex; gap: 4px; align-items: center; }
  .head strong { flex: 1; min-width: 0; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); color: var(--ga-ink-0, #f2ede4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bypassed strong { color: var(--ga-ink-2, #89857e); }
  .params { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  button, select { height: var(--ga-control-h-sm, 22px); box-sizing: border-box; color: var(--ga-ink-1, #ada9a2); background: var(--ga-card, #16140f); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); padding: 0 6px; font-family: inherit; font-size: var(--ga-text-control, 12px); cursor: pointer; }
  .head button { min-width: 22px; padding: 0; }
  button:disabled { opacity: 0.35; cursor: default; }
  button:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  .toggle.on { color: var(--ga-icon, #5278ff); }
  .choice { display: flex; gap: 8px; justify-content: space-between; align-items: center; font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1, #ada9a2); }
  .choice select { max-width: 65%; }
  .add { align-self: flex-start; padding: 0 10px; font-weight: var(--ga-weight-control, 600); }
</style>
