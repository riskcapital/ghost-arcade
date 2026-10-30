<script lang="ts">
  /**
   * One macro's effects. Sound: audio effects on the studio's mix, each
   * parameter with a set value and how far the macro pushes it. Picture:
   * visual effects from the app's catalog, faded in by the macro. Both belong
   * to the macro alone, apart from composition, layer and clip effects.
   */
  import { macros } from '../../stores/macros';
  import { EFFECT_CATALOG } from '../../effects/effectCatalog';
  import { EFFECT_PARAM_DEFS } from '../../effects/effectParamDefs';
  import { getDefaultEffectParams } from '../../renderer/effects';
  import { isNativeSelectableEffect } from '../../renderer/nativeEffectCoverage';
  import { launchClockTempo } from '../../stores/launchClock';
  import { generateUUID } from '../../utils/uuid';
  import type { EffectType } from '../../types';
  import { MACRO_FX, effectiveValue, macroFxDef, type MacroFxType } from '../../music/macroFx';
  import { musicStudio } from '../../music/musicStudioStore';
  import { macroEditorId } from '../../music/studioUi';
  import StudioKnob from './StudioKnob.svelte';

  const macro = $derived($macros.macros.find((m) => m.id === $macroEditorId) ?? null);
  const soundFx = $derived(macro ? ($musicStudio.macroFx[macro.id] ?? []) : []);
  const tempo = launchClockTempo();

  /** The catalog's effects that this build can render, grouped for the picker. */
  const catalog = EFFECT_CATALOG.filter((e) => isNativeSelectableEffect(e.type));
  const categories = [...new Set(catalog.map((e) => e.category))];

  function addSound(e: Event) {
    const el = e.target as HTMLSelectElement;
    if (macro && el.value) musicStudio.addMacroFx(macro.id, generateUUID(), el.value as MacroFxType);
    el.value = '';
  }

  function addPicture(e: Event) {
    const el = e.target as HTMLSelectElement;
    const type = el.value as EffectType;
    if (macro && type) macros.addEffect(macro.id, type, getDefaultEffectParams(type));
    el.value = '';
  }

  function label(type: string): string {
    return EFFECT_CATALOG.find((e) => e.type === type)?.label ?? type;
  }

  function sliderDefs(type: string) {
    return (EFFECT_PARAM_DEFS[type] ?? []).filter((d) => (d.type ?? 'slider') === 'slider').slice(0, 6);
  }
</script>

{#if macro}
  <aside class="editor" aria-label="{macro.name} effects">
    <header>
      <div class="title">
        <span class="ga-eyebrow">Macro</span>
        <h2>{macro.name}</h2>
      </div>
      <StudioKnob label="Amount" value={macro.value} size={44} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => macros.setMacroValue(macro.id, v)} />
      <button class="close" onclick={() => macroEditorId.set(null)} aria-label="Close macro effects"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
    </header>

    <div class="scroll">
      <section>
        <div class="section-head">
          <h3 class="ga-eyebrow">Sound</h3>
          <select value="" onchange={addSound} aria-label="Add a sound effect">
            <option value="" disabled>Add sound effect…</option>
            {#each MACRO_FX as def (def.type)}<option value={def.type}>{def.label}</option>{/each}
          </select>
        </div>
        {#each soundFx as fx (fx.id)}
          {@const def = macroFxDef(fx.type)}
          <div class="fx" class:off={!fx.enabled}>
            <div class="fx-head">
              <button class="power" class:on={fx.enabled} onclick={() => musicStudio.toggleMacroFx(macro.id, fx.id)} aria-pressed={fx.enabled} aria-label="{def.label} on"></button>
              <span class="fx-name">{def.label}</span>
              <button class="remove" onclick={() => musicStudio.removeMacroFx(macro.id, fx.id)} aria-label="Remove {def.label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
            <div class="params">
              {#each def.params as pd (pd.key)}
                {@const param = fx.params[pd.key]}
                <div class="param">
                  <StudioKnob label={pd.label} value={param.value} defaultValue={pd.value} size={30} format={(v) => pd.format(v, tempo)} onchange={(v) => musicStudio.setMacroFxParam(macro.id, fx.id, pd.key, { value: v })} />
                  <StudioKnob label="Macro" value={param.depth} min={-1} max={1} defaultValue={pd.depth} size={20} format={(v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`} onchange={(v) => musicStudio.setMacroFxParam(macro.id, fx.id, pd.key, { depth: v })} title="How far {macro.name} pushes {pd.label}" />
                  <span class="now">{pd.format(effectiveValue(param, macro.value), tempo)}</span>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <p class="empty">No sound effects yet. A delay that opens as you turn {macro.name} is a good start.</p>
        {/each}
      </section>

      <section>
        <div class="section-head">
          <h3 class="ga-eyebrow">Picture</h3>
          <select value="" onchange={addPicture} aria-label="Add a visual effect">
            <option value="" disabled>Add visual effect…</option>
            {#each categories as category}
              <optgroup label={category}>
                {#each catalog.filter((e) => e.category === category) as entry (entry.type)}
                  <option value={entry.type}>{entry.label}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </div>
        {#each macro.effects as effect (effect.id)}
          <div class="fx" class:off={!effect.enabled}>
            <div class="fx-head">
              <button class="power" class:on={effect.enabled} onclick={() => macros.toggleEffect(macro.id, effect.id)} aria-pressed={effect.enabled} aria-label="{label(effect.type)} on"></button>
              <span class="fx-name">{label(effect.type)}</span>
              <button class="remove" onclick={() => macros.removeEffect(macro.id, effect.id)} aria-label="Remove {label(effect.type)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
            <div class="params">
              {#each sliderDefs(effect.type) as d (d.param)}
                {@const value = Number((effect.params as Record<string, unknown>)[d.param] ?? d.default)}
                <StudioKnob label={d.name} value={value} min={d.min} max={d.max} defaultValue={d.default} size={30} format={(v) => (d.max - d.min > 10 ? v.toFixed(0) : v.toFixed(2))} onchange={(v) => macros.updateEffectParams(macro.id, effect.id, { [d.param]: v })} />
              {/each}
            </div>
          </div>
        {:else}
          <p class="empty">No visual effects yet. {macro.name} fades in whatever you add here, on top of the output.</p>
        {/each}
      </section>
    </div>
  </aside>
{/if}

<style>
  .editor {
    position: absolute;
    top: var(--ga-bar-h, 48px);
    right: 0;
    bottom: 0;
    width: 460px;
    z-index: 8;
    display: flex;
    flex-direction: column;
    background: var(--studio-panel);
    border-left: 1px solid var(--studio-edge);
    box-shadow: -18px 0 40px rgba(0, 0, 0, 0.55);
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--studio-edge-soft);
  }
  .title { flex: 1; }
  h2 { margin: 2px 0 0; font-size: var(--ga-text-heading, 16px); font-weight: var(--ga-weight-title, 650); }
  .close {
    width: var(--ga-control-h, 26px);
    height: var(--ga-control-h, 26px);
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-ink-1);
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .close:hover { color: var(--studio-ink); border-color: var(--studio-muted); }
  .close svg { width: 14px; height: 14px; }
  .scroll { flex: 1; overflow: auto; padding: 6px 16px 16px; }
  section { padding-top: 10px; }
  .section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  h3 { margin: 0; flex: 1; }
  .section-head select { height: var(--ga-control-h, 26px); }
  .fx { padding: 8px 0 10px; border-top: 1px solid var(--studio-edge-soft); }
  .fx.off { opacity: 0.5; }
  .fx-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .fx-name { flex: 1; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-title, 650); }
  .power {
    width: 14px;
    height: 14px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--studio-edge);
    background: transparent;
    cursor: pointer;
  }
  .power.on { background: var(--studio-accent); border-color: var(--studio-accent); box-shadow: 0 0 6px var(--studio-accent); }
  .remove {
    width: 22px;
    height: 22px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--studio-muted);
    cursor: pointer;
  }
  .remove:hover { color: var(--studio-ink); }
  .remove svg { width: 12px; height: 12px; }
  .params { display: flex; flex-wrap: wrap; gap: 10px 6px; }
  .param { display: flex; flex-direction: column; align-items: center; gap: 3px; width: 72px; }
  .now { font-family: var(--ga-font-mono, ui-monospace); font-size: 9px; color: var(--studio-muted); text-align: center; }
  .empty { margin: 4px 0 8px; color: var(--studio-muted); font-size: var(--ga-text-meta, 11px); line-height: 1.5; }
</style>
