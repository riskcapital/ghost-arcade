<script lang="ts">
  /**
   * The selected block on the Screen FX or Effects row: its own copy of the
   * effect and every setting (editing it never touches the Composition
   * panel's effects), mix, timing and fades, a where line (Screen FX), and
   * ◆ buttons that start a control line for a setting at the playhead.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import type { Effect, StageEffect, StageEffectType } from '../../../types';
  import { createDefaultStageEffect, getEffectDef } from '../../../stores/stageEffects';
  import { effectParamLabels, type ParamMeta } from '../../../effects/effectUX';
  import type { TimelineStageClip } from '../../../timeline/stagefx/stageClips';
  import { effectColourGroups, readEffectColour, writeEffectColour } from '../../../timeline/stagefx/effectColours';
  import { stageBlockParams } from '../../../timeline/stagefx/stageFxParams';
  import { addLineAtPlayhead } from '../../../timeline/lines/timelineLines';
  import StageFxChaseControls from '../../StageFxChaseControls.svelte';
  import WhereEditor from './WhereEditor.svelte';
  import { SCREEN_FX_CHOICES, STAGE_ROW_NAMES, blockName, effectLabel } from './stageFxRowsUi';

  interface Props {
    clip: TimelineStageClip;
    onclose: () => void;
  }
  let { clip, onclose }: Props = $props();

  const fx = $derived(clip.screenFx ?? null);
  const def = $derived(fx ? getEffectDef(fx.type) : null);
  const effect = $derived(clip.effect ?? null);
  const metas = $derived(effect ? Object.entries((effectParamLabels as Record<string, Record<string, ParamMeta> | undefined>)[effect.type] ?? {}) : []);
  const colours = $derived(effect ? effectColourGroups(effect.type) : []);
  const colourKeys = $derived(new Set(colours.flatMap((c) => [c.r, c.g, c.b])));
  const lineParams = $derived(stageBlockParams(clip).filter((p) => p.kind !== 'stepped' || p.key.startsWith('fxb:param:') || p.key.startsWith('sfx:param:')));
  const hex = (n: number) => `#${Math.max(0, Math.min(0xffffff, n)).toString(16).padStart(6, '0')}`;

  function patch(p: Partial<TimelineStageClip>, continuous = false) {
    showTimeline.updateStageClip(clip.id, p, { discrete: !continuous });
  }
  function patchFx(p: Partial<StageEffect>, continuous = false) {
    if (fx) patch({ screenFx: { ...fx, ...p } }, continuous);
  }
  function setFxParam(key: string, v: number) {
    if (fx) patchFx({ params: { ...fx.params, [key]: v } }, true);
  }
  function setType(type: StageEffectType) {
    if (!fx) return;
    const fresh = createDefaultStageEffect(type);
    patchFx({ type, params: fresh.params });
  }
  function patchEffect(p: Partial<Effect>, continuous = false) {
    if (effect) patch({ effect: { ...effect, ...p } }, continuous);
  }
  function setEffectParam(name: string, v: number) {
    if (effect) patchEffect({ params: { ...(effect.params as Record<string, unknown>), [name]: v } as Effect['params'] }, true);
  }
  function setEffectColour(group: (typeof colours)[number], value: string) {
    if (!effect) return;
    const params = { ...(effect.params as Record<string, unknown>) };
    writeEffectColour(params, group, Number.parseInt(value.slice(1), 16) || 0);
    patchEffect({ params: params as Effect['params'] });
  }
  function paramValue(name: string, meta: ParamMeta): number {
    const v = (effect?.params as Record<string, unknown> | undefined)?.[name];
    return typeof v === 'number' ? v : meta.default;
  }
  function commit(e: Event, apply: (v: number) => void) {
    apply(parseFloat((e.currentTarget as HTMLInputElement).value));
  }
  const short = (label: string) => {
    const t = label.replace(/^Screen FX /, '').replace(/^Effect /, '').replace(/\s*\(.*\)$/, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
</script>

<div class="show-inspector" data-stage-inspector={clip.row}>
  <span class="insp-title" class:effects={clip.row === 'effects'}>{STAGE_ROW_NAMES[clip.row]} block · {blockName(clip)}</span>
  {#if fx}
    <label class="insp-field">
      <span>Effect</span>
      <select value={fx.type} onchange={(e) => setType((e.currentTarget as HTMLSelectElement).value as StageEffectType)} data-stage-fx-type>
        {#each SCREEN_FX_CHOICES as d (d.type)}<option value={d.type}>{d.icon} {d.label}</option>{/each}
      </select>
    </label>
    <label class="insp-field" title="How much of the effect shows (0 = none)">
      <span>Mix</span>
      <input type="range" min="0" max="1" step="0.01" value={fx.opacity ?? 1} oninput={(e) => patchFx({ opacity: parseFloat((e.currentTarget as HTMLInputElement).value) }, true)} data-stage-fx-mix />
      <span class="insp-unit">{Math.round((fx.opacity ?? 1) * 100)}%</span>
    </label>
    {#each def?.paramSpecs ?? [] as spec (spec.key)}
      {@const v = fx.params[spec.key] ?? def?.defaultParams[spec.key] ?? spec.min}
      <label class="insp-field">
        <span>{spec.label}</span>
        <input type="range" min={spec.min} max={spec.max} step={spec.step ?? 0.01} value={v} oninput={(e) => setFxParam(spec.key, parseFloat((e.currentTarget as HTMLInputElement).value))} data-stage-fx-param={spec.key} />
        <span class="insp-unit">{v.toFixed((spec.step ?? 0.01) >= 1 ? 0 : 2)}</span>
      </label>
    {/each}
    {#if fx.type === 'beat-pulse'}<span class="insp-hint">Flashes on the Timeline's beats.</span>{/if}
    {#if fx.type === 'audio-rms-intensity'}<span class="insp-hint">Follows the Timeline's song.</span>{/if}
    <div class="chase"><StageFxChaseControls effect={fx} target="mapping" onUpdate={(p) => patchFx(p)} /></div>
    <WhereEditor where={clip.where} target={{ scope: 'block', id: clip.id }} />
  {:else if effect}
    <label class="insp-field" title="How much of the effect shows (0 = none)">
      <span>Mix</span>
      <input type="range" min="0" max="1" step="0.01" value={effect.opacity ?? 1} oninput={(e) => patchEffect({ opacity: parseFloat((e.currentTarget as HTMLInputElement).value) }, true)} data-stage-effect-mix />
      <span class="insp-unit">{Math.round((effect.opacity ?? 1) * 100)}%</span>
    </label>
    {#each metas as [name, meta] (name)}
      {#if meta.type !== 'color' && !colourKeys.has(name)}
        {#if meta.type === 'select' && meta.options}
          <label class="insp-field">
            <span>{meta.label}</span>
            <select value={paramValue(name, meta)} onchange={(e) => setEffectParam(name, Number((e.currentTarget as HTMLSelectElement).value))} data-stage-effect-param={name}>
              {#each meta.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          </label>
        {:else}
          <label class="insp-field">
            <span>{meta.label}</span>
            <input type="range" min={meta.min} max={meta.max} step={meta.step || 0.01} value={paramValue(name, meta)} oninput={(e) => setEffectParam(name, parseFloat((e.currentTarget as HTMLInputElement).value))} data-stage-effect-param={name} />
            <span class="insp-unit">{paramValue(name, meta).toFixed(2)}</span>
          </label>
        {/if}
      {/if}
    {/each}
    {#each colours as c (c.base)}
      <label class="insp-field"><span>{c.label}</span><input type="color" value={hex(readEffectColour(effect, c))} onchange={(e) => setEffectColour(c, (e.currentTarget as HTMLInputElement).value)} data-stage-effect-colour={c.base} /></label>
    {/each}
    <span class="insp-hint">Runs over the whole stage after the Effects tab's own ({effectLabel(effect.type)}).</span>
  {/if}
  <span class="insp-lines" role="group" aria-label="Control lines for this block">
    {#each lineParams as p (p.key)}
      <button type="button" class="insp-line" onclick={() => addLineAtPlayhead({ scope: 'block', id: clip.id }, p.key)}
        title={`◆ ${p.label}: a point at the playhead on this block's line`} data-line-key={p.key} data-line-scope="block" data-line-target={clip.id}>◆ {short(p.label)}</button>
    {/each}
  </span>
  <label class="insp-field"><span>Start</span><input type="number" min="0" step="0.1" value={clip.startTime.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ startTime: Math.max(0, v || 0) }))} data-stage-start /><span class="insp-unit">s</span></label>
  <label class="insp-field"><span>Length</span><input type="number" min="0.1" step="0.1" value={clip.duration.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ duration: Math.max(0.1, v || 0) }))} data-stage-length /><span class="insp-unit">s</span></label>
  <label class="insp-field"><span>Fade in</span><input type="number" min="0" step="0.1" value={clip.fadeIn.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ fadeIn: Math.max(0, v || 0) }))} /><span class="insp-unit">s</span></label>
  <label class="insp-field"><span>Fade out</span><input type="number" min="0" step="0.1" value={clip.fadeOut.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ fadeOut: Math.max(0, v || 0) }))} /><span class="insp-unit">s</span></label>
  {#if clip.row === 'screenfx'}<span class="insp-hint">Between blocks no Screen FX shows; overlapping blocks crossfade.</span>{/if}
  <button class="insp-delete" onclick={() => showTimeline.removeStageClip(clip.id)} data-stage-delete>Delete</button>
  <button aria-label="Close block inspector" class="insp-close" onclick={onclose}>×</button>
</div>

<style>
  .show-inspector {
    display: flex; align-items: center; gap: 8px 12px; min-height: 36px; padding: 4px 12px; flex: 0 0 auto; flex-wrap: wrap;
    background: var(--ga-card, #121217); border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1, #bbb); max-height: 40vh; overflow-y: auto;
  }
  .insp-title { color: #5ce1e6; font-weight: var(--ga-weight-control, 600); padding-right: 12px; border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); }
  .insp-title.effects { color: #a78bfa; }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-field input[type="number"], .insp-field select {
    height: var(--ga-control-h-sm, 22px); background: var(--ga-slot, rgba(255, 255, 255, 0.04)); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px); color: var(--ga-ink-0, #e8e8e8); font-size: var(--ga-text-control, 12px); padding: 0 6px; width: 64px; outline: none; font-family: inherit;
  }
  .insp-field select { width: 140px; }
  .insp-field input[type="range"] { width: 70px; }
  .insp-field input[type="color"] { width: 28px; height: 20px; padding: 0; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); background: none; }
  .insp-unit, .insp-hint { color: var(--ga-ink-2, #888); }
  .insp-unit { min-width: 28px; font-variant-numeric: tabular-nums; }
  .insp-hint { font-size: var(--ga-text-meta, 11px); }
  .chase { min-width: 260px; }
  .insp-lines { display: inline-flex; flex-wrap: wrap; gap: 3px; }
  .insp-line { background: var(--ga-sunk, #0c0c10); border: 1px solid rgba(255, 217, 107, 0.4); color: rgba(255, 217, 107, 0.85); border-radius: 3px; font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
  .insp-delete {
    margin-left: auto; height: 22px; background: transparent; border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4757) 40%, transparent);
    color: var(--ga-rec, #FF4757); font-size: 12px; font-weight: 600; padding: 0 10px; border-radius: 3px; cursor: pointer; font-family: inherit;
  }
  .insp-close { background: none; border: none; color: var(--ga-ink-2, #888); font-size: 16px; cursor: pointer; padding: 2px 6px; line-height: 1; }
</style>
