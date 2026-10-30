<script lang="ts">
  import { selectedLayer, selectedLayerIds, layers, project, scheduleHistorySnapshot, recordDiscreteAction } from '../stores/layers';
  import type { BlendMode, EdgeEffect } from '../types';
  import EffectParamRow from './EffectParamRow.svelte';
  import EdgeEffectPresets from './EdgeEffectPresets.svelte';
  import {
    EDGE_ANIMATION_TYPES, EDGE_EFFECT_LEVEL_PARAMS, EDGE_FILL_TYPES, EDGE_STROKE_SHAPE_PARAMS, EDGE_STROKE_TYPES,
    EDGE_TRIM_PARAMS, edgeTypeDef, edgeTypeDefaults, type EdgeParamDef, type EdgeTypeDef,
  } from '../drawing/edgeEffectCatalog';
  import { edgeEffectLimitWarning, edgeOutlineWarning } from '../drawing/edgeEffects';

  // The modulation engine identifies the target layer by index into the
  // project's layer array, not by id. Derive it reactively from the
  // currently-selected layer so EffectParamRow can build the right
  // modulation key (`<layerIdx>:edge:<effectId>:<path>`).
  $: layerIdx = $selectedLayer ? $layers.findIndex(l => l.id === $selectedLayer!.id) : -1;
  $: limitWarning = $selectedLayer?.edgeEffects?.enabled ? edgeEffectLimitWarning($selectedLayer.edgeEffects.effects) : null;
  $: outlineWarning = $selectedLayer?.edgeEffects?.enabled
    ? edgeOutlineWarning($selectedLayer as any, $project.width || 1920, $project.height || 1080)
    : null;

  type Kind = 'stroke' | 'fill' | 'animation';
  const KIND_LABEL: Record<Kind, string> = { stroke: 'Outline', fill: 'Fill', animation: 'Animation' };
  const TYPES: Record<Kind, EdgeTypeDef[]> = { stroke: EDGE_STROKE_TYPES, fill: EDGE_FILL_TYPES, animation: EDGE_ANIMATION_TYPES };

  function grouped(list: EdgeTypeDef[]): Array<[string, EdgeTypeDef[]]> {
    const groups = new Map<string, EdgeTypeDef[]>();
    for (const def of list) {
      if (!groups.has(def.group)) groups.set(def.group, []);
      groups.get(def.group)!.push(def);
    }
    return [...groups.entries()];
  }

  const blendModes: { value: BlendMode; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'add', label: 'Add' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'difference', label: 'Difference' },
    { value: 'exclusion', label: 'Exclusion' },
    { value: 'softlight', label: 'Soft light' },
    { value: 'hardlight', label: 'Hard light' },
    { value: 'color-dodge', label: 'Color dodge' },
    { value: 'color-burn', label: 'Color burn' },
    { value: 'lighten', label: 'Lighten' },
    { value: 'darken', label: 'Darken' },
  ];

  function rgbaToHex(c: unknown): string {
    const v = Array.isArray(c) ? c : [1, 1, 1, 1];
    return '#' + [0, 1, 2].map(i => Math.round(Math.max(0, Math.min(1, Number(v[i]) || 0)) * 255).toString(16).padStart(2, '0')).join('');
  }

  function hexToRgb(hex: string): [number, number, number] {
    return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  }

  function formatValue(def: EdgeParamDef, v: number): string {
    switch (def.format) {
      case 'percent': return (v * 100).toFixed(0) + '%';
      case 'px': return v.toFixed(v < 10 ? 1 : 0) + ' px';
      case 'x': return v.toFixed(2) + 'x';
      case 'deg': return v.toFixed(0) + '°';
      case 'int': return v.toFixed(0);
      default: return v.toFixed(2);
    }
  }

  function numberValue(part: Record<string, unknown>, def: EdgeParamDef, typeDef: EdgeTypeDef | undefined): number {
    const v = part?.[def.key] ?? typeDef?.defaults[def.key];
    return typeof v === 'number' ? v : (def.min ?? 0);
  }

  function effectOf(effectId: string): EdgeEffect | undefined {
    return $selectedLayer?.edgeEffects?.effects.find(e => e.id === effectId);
  }

  function updateEffect(effectId: string, updates: Record<string, unknown>) {
    if (!$selectedLayer) return;
    project.updateEdgeEffect($selectedLayer.id, effectId, updates as any);
    scheduleHistorySnapshot(`edge-effect:${$selectedLayer.id}:${effectId}:${Object.keys(updates).sort().join(',')}`);
  }

  function updatePart(effectId: string, kind: Kind, updates: Record<string, unknown>) {
    const effect = effectOf(effectId);
    if (!effect || !$selectedLayer) return;
    project.updateEdgeEffect($selectedLayer.id, effectId, { [kind]: { ...(effect as any)[kind], ...updates } } as any);
    scheduleHistorySnapshot(`edge-effect:${$selectedLayer.id}:${effectId}:${kind}.${Object.keys(updates).sort().join(',')}`);
  }

  // Switching a type keeps what carries over: the outline's colour and
  // width, its shape and trim settings, a fill's colours.
  const CARRY: Record<Kind, string[]> = {
    stroke: ['color', 'width', 'widthMode', 'cap', 'join', 'miterLimit', 'trimStart', 'trimEnd', 'trimOffset', 'trimMode', 'trimSpeed'],
    fill: ['color', 'color2'],
    animation: [],
  };

  function setType(effectId: string, kind: Kind, type: string) {
    const effect = effectOf(effectId);
    if (!effect || !$selectedLayer) return;
    const next = edgeTypeDefaults(kind, type);
    const previous = (effect as any)[kind] ?? {};
    if (type !== 'none') {
      for (const key of CARRY[kind]) {
        if (key in previous && (key in next || !['color', 'width', 'color2'].includes(key))) next[key] = previous[key];
      }
    }
    project.updateEdgeEffect($selectedLayer.id, effectId, { [kind]: next } as any);
    recordDiscreteAction();
  }

  function setColor(effectId: string, kind: Kind | null, key: string, rgb: [number, number, number], alpha: number) {
    const value = [...rgb, alpha];
    if (kind) updatePart(effectId, kind, { [key]: value });
    else updateEffect(effectId, { [key]: value });
  }

  function colorAlpha(part: Record<string, unknown>, key: string, typeDef?: EdgeTypeDef): number {
    const c = (part?.[key] ?? typeDef?.defaults[key]) as number[] | undefined;
    return Array.isArray(c) ? Number(c[3] ?? 1) : 1;
  }

  function summary(effect: EdgeEffect): string {
    const parts = [
      edgeTypeDef('stroke', effect.stroke?.type)?.label,
      edgeTypeDef('fill', effect.fill?.type)?.label,
      edgeTypeDef('animation', effect.animation?.type)?.label,
    ].filter((label) => label && label !== 'None');
    return parts.length ? parts.join(' + ') : 'Empty';
  }

  let expandedEffectId: string | null = null;
  let showShape: Record<string, boolean> = {};
</script>

{#snippet paramRow(effect: EdgeEffect, kind: Kind | null, def: EdgeParamDef, typeDef: EdgeTypeDef | undefined)}
  {@const part = (kind ? (effect as any)[kind] : effect) ?? {}}
  {@const path = kind ? `${kind}.${def.key}` : def.key}
  {#if def.kind === 'number'}
    <EffectParamRow label={def.label} min={def.min ?? 0} max={def.max ?? 1} step={def.step ?? 0.01}
      layerIndex={layerIdx} effectId={effect.id} paramName={path} effectKind="edge"
      value={numberValue(part, def, typeDef)}
      displayValue={(v) => formatValue(def, v)}
      onChange={(v) => kind ? updatePart(effect.id, kind, { [def.key]: def.format === 'int' ? Math.round(v) : v }) : updateEffect(effect.id, { [def.key]: v })} />
  {:else if def.kind === 'color'}
    <div class="control-row">
      <span class="control-label">{def.label}</span>
      <input type="color" aria-label={def.label} value={rgbaToHex(part[def.key] ?? typeDef?.defaults[def.key])}
        oninput={(e) => {
          // Picking a colour for a fully transparent slot makes it visible.
          const alpha = colorAlpha(part, def.key, typeDef);
          setColor(effect.id, kind, def.key, hexToRgb((e.target as HTMLInputElement).value), alpha === 0 ? 1 : alpha);
        }} />
      <input type="range" class="alpha-slider" min="0" max="1" step="0.05" aria-label={`${def.label} opacity`}
        title="Opacity" value={colorAlpha(part, def.key, typeDef)}
        oninput={(e) => {
          const c = (part[def.key] ?? typeDef?.defaults[def.key] ?? [1, 1, 1, 1]) as number[];
          setColor(effect.id, kind, def.key, [c[0], c[1], c[2]], parseFloat((e.target as HTMLInputElement).value));
        }} />
    </div>
  {:else if def.kind === 'select'}
    <div class="control-row">
      <span class="control-label">{def.label}</span>
      <select aria-label={def.label} value={String(part[def.key] ?? typeDef?.defaults[def.key] ?? def.options?.[0]?.value)}
        onchange={(e) => {
          const value = (e.target as HTMLSelectElement).value;
          if (kind) updatePart(effect.id, kind, { [def.key]: value }); else updateEffect(effect.id, { [def.key]: value });
          recordDiscreteAction();
        }}>
        {#each def.options ?? [] as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>
  {:else if def.kind === 'toggle'}
    <label class="control-row toggle-row">
      <input type="checkbox" checked={Boolean(part[def.key] ?? typeDef?.defaults[def.key])}
        onchange={(e) => {
          const value = (e.target as HTMLInputElement).checked;
          if (kind) updatePart(effect.id, kind, { [def.key]: value }); else updateEffect(effect.id, { [def.key]: value });
          recordDiscreteAction();
        }} />
      <span>{def.label}</span>
    </label>
  {/if}
{/snippet}

{#if $selectedLayer}
  <div data-help-page="layers" class="edge-effects-panel">
    <div class="section-header-row">
      <span class="section-title">Edge Effects</span>
      {#if !$selectedLayer.edgeEffects}
        <button class="btn-enable" onclick={() => project.enableEdgeEffects($selectedLayer.id)}>
          Enable
        </button>
      {:else}
        <label class="toggle-label">
          <input type="checkbox" checked={$selectedLayer.edgeEffects.enabled}
            onchange={() => project.toggleEdgeEffectsEnabled($selectedLayer.id)} />
          <span>Active</span>
        </label>
        <button class="btn-disable" aria-label="Remove all edge effects" onclick={() => project.disableEdgeEffects($selectedLayer.id)}>
          &times;
        </button>
      {/if}
    </div>

    <EdgeEffectPresets />

    {#if $selectedLayer.edgeEffects?.enabled}
      {#if limitWarning}<p class="edge-warning" role="status">{limitWarning}</p>{/if}
      {#if outlineWarning}<p class="edge-warning" role="status">{outlineWarning}</p>{/if}

      <div class="stack-controls">
        <label class="control-row" title="Rounds every corner of the outline these effects are drawn on">
          <span class="control-label">Corner radius</span>
          <input type="range" class="radius-slider" min="0" max="200" step="1" aria-label="Corner radius"
            value={$selectedLayer.edgeEffects.cornerRadius ?? 0}
            oninput={(e) => project.setEdgeEffectsCornerRadius($selectedLayer!.id, parseFloat((e.target as HTMLInputElement).value))} />
          <span class="control-value">{($selectedLayer.edgeEffects.cornerRadius ?? 0).toFixed(0)} px</span>
        </label>
      </div>

      {#each $selectedLayer.edgeEffects.effects as effect, idx (effect.id)}
        <div class="effect-card" class:disabled={!effect.enabled} data-edge-effect-index={idx}>
          <div class="effect-header">
            <input type="checkbox" checked={effect.enabled} aria-label={`Effect ${idx + 1} on`}
              onchange={() => updateEffect(effect.id, { enabled: !effect.enabled })} />
            <button class="effect-title" aria-expanded={expandedEffectId === effect.id}
              onclick={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}>
              <span class="effect-name">{idx + 1}. {summary(effect)}</span>
              <span class="expand-icon">{expandedEffectId === effect.id ? '-' : '+'}</span>
            </button>
            <button class="btn-move" aria-label="Move up" title="Move up" disabled={idx === 0}
              onclick={() => project.moveEdgeEffect($selectedLayer.id, effect.id, -1)}>&uarr;</button>
            <button class="btn-move" aria-label="Move down" title="Move down" disabled={idx === $selectedLayer.edgeEffects.effects.length - 1}
              onclick={() => project.moveEdgeEffect($selectedLayer.id, effect.id, 1)}>&darr;</button>
            <button aria-label="Remove this edge effect" class="btn-remove" onclick={() => project.removeEdgeEffect($selectedLayer.id, effect.id)}>&times;</button>
          </div>
          <div class="effect-mix">
            <select class="blend-select" aria-label="Blend mode" value={effect.blendMode}
              onchange={(e) => { updateEffect(effect.id, { blendMode: (e.target as HTMLSelectElement).value }); recordDiscreteAction(); }}>
              {#each blendModes as bm}
                <option value={bm.value}>{bm.label}</option>
              {/each}
            </select>
            <input type="range" class="opacity-slider" min="0" max="1" step="0.05" aria-label="Effect opacity"
              value={effect.opacity}
              oninput={(e) => updateEffect(effect.id, { opacity: parseFloat((e.target as HTMLInputElement).value) })} />
          </div>

          {#if expandedEffectId === effect.id}
            <div class="effect-controls">
              <EffectParamRow label="Opacity" min={0} max={1} step={0.01}
                layerIndex={layerIdx} effectId={effect.id} paramName="opacity" effectKind="edge"
                value={effect.opacity}
                displayValue={(v) => (v * 100).toFixed(0) + '%'}
                onChange={(v) => updateEffect(effect.id, { opacity: v })} />

              {#each ['stroke', 'fill', 'animation'] as const as kind}
                {@const part = (effect as any)[kind] ?? { type: 'none' }}
                {@const typeDef = edgeTypeDef(kind, part.type)}
                <div class="subsection" data-edge-kind={kind}>
                  <span class="subsection-label">{KIND_LABEL[kind]}</span>
                  <div class="control-row">
                    <span class="control-label">Type</span>
                    <select aria-label={`${KIND_LABEL[kind]} type`} value={part.type}
                      onchange={(e) => setType(effect.id, kind, (e.target as HTMLSelectElement).value)}>
                      {#each grouped(TYPES[kind]) as [group, defs]}
                        <optgroup label={group}>
                          {#each defs as def}
                            <option value={def.type}>{def.label}</option>
                          {/each}
                        </optgroup>
                      {/each}
                      {#if !typeDef}<option value={part.type}>{part.type}</option>{/if}
                    </select>
                  </div>
                  {#if typeDef}
                    {#each typeDef.params as def (def.key)}
                      {@render paramRow(effect, kind, def, typeDef)}
                    {/each}
                  {/if}
                  {#if kind === 'stroke' && part.type !== 'none'}
                    <button class="btn-more" aria-expanded={!!showShape[effect.id]}
                      onclick={() => showShape = { ...showShape, [effect.id]: !showShape[effect.id] }}>
                      {showShape[effect.id] ? 'Hide' : 'Show'} line shape and trim
                    </button>
                    {#if showShape[effect.id]}
                      {#each [...EDGE_STROKE_SHAPE_PARAMS, ...EDGE_TRIM_PARAMS] as def (def.key)}
                        {@render paramRow(effect, 'stroke', def, { type: '', label: '', group: '', params: [], defaults: { widthMode: 'pixels', cap: typeDef?.defaults.cap ?? 'butt', join: 'miter', miterLimit: 4, trimStart: 0, trimEnd: 1, trimOffset: 0, trimMode: 'none', trimSpeed: 0.5 } })}
                      {/each}
                    {/if}
                  {/if}
                </div>
              {/each}

              <div class="subsection">
                <span class="subsection-label">Centre and group chase</span>
                {#each EDGE_EFFECT_LEVEL_PARAMS as def (def.key)}
                  {#if (def.key !== 'centerX' && def.key !== 'centerY') || effect.customCenter}
                    {@render paramRow(effect, null, def, { type: '', label: '', group: '', params: [], defaults: { customCenter: false, centerX: 0.5, centerY: 0.5, chaseMode: 'none', chaseSpread: 0.5 } })}
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/each}

      <button class="btn-add-effect" onclick={() => project.addEdgeEffect($selectedLayer.id)}>
        + Add effect
      </button>
    {/if}
  </div>
{/if}

<style>
  .edge-effects-panel {
    padding: 8px 0;
    border-top: 1px solid var(--ga-line-1);
  }

  .section-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h-sm);
    padding: 4px 0;
  }

  /* Eyebrow section label, same as every layer editor. */
  .section-title {
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    color: var(--ga-ink-2);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
    flex: 1;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1);
    cursor: pointer;
  }

  .toggle-label input { width: 14px; height: 14px; }

  .btn-enable {
    height: var(--ga-control-h-sm);
    background: var(--ga-sub);
    color: var(--ga-ink-1);
    border: 1px solid var(--ga-line-2);
    padding: 0 10px;
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .btn-enable:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }

  .btn-disable {
    background: none;
    border: none;
    color: var(--ga-ink-2);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
  }
  .btn-disable:hover { color: var(--ga-rec); }

  .edge-warning {
    margin: 6px 0;
    padding: 6px 8px;
    font-size: var(--ga-text-meta);
    line-height: 1.45;
    color: #ffcf8a;
    background: #2b2112;
    border: 1px solid #6b4b18;
    border-radius: var(--ga-r-hard);
  }

  .stack-controls { margin: 4px 0 6px; }

  .effect-card {
    margin: 6px 0;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    overflow: hidden;
  }
  .effect-card.disabled { opacity: 0.5; }

  .effect-header {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: var(--ga-control-h);
    padding: 2px 8px;
    background: var(--ga-card);
  }
  .effect-header input[type="checkbox"] { width: 14px; height: 14px; flex-shrink: 0; }

  .effect-title {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    color: var(--ga-ink-0);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }
  .effect-title:hover { color: var(--ga-ink-0); }
  .effect-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .expand-icon { color: var(--ga-ink-2); font-size: 14px; }

  .btn-move {
    background: none;
    border: none;
    color: var(--ga-ink-2);
    cursor: pointer;
    font-size: var(--ga-text-control);
    padding: 0 2px;
  }
  .btn-move:hover:not(:disabled) { color: var(--ga-ink-0); }
  .btn-move:disabled { opacity: 0.3; cursor: default; }

  .effect-mix {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 6px 30px;
    background: var(--ga-card);
  }

  .blend-select {
    width: 96px;
    height: var(--ga-control-h-sm);
    background: var(--ga-slot);
    color: var(--ga-ink-0);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-meta);
    padding: 0 4px;
  }

  .opacity-slider {
    flex: 1;
    min-width: 40px;
    accent-color: var(--ga-slider-fill, var(--ga-blue));
  }

  .btn-remove {
    background: none;
    border: none;
    color: var(--ga-ink-2);
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
    flex-shrink: 0;
  }
  .btn-remove:hover { color: var(--ga-rec); }

  .effect-controls {
    padding: 6px 8px;
    background: var(--ga-panel);
    border-top: 1px solid var(--ga-line-1);
  }

  .subsection {
    margin: 10px 0;
  }

  .subsection-label {
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    color: var(--ga-ink-2);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
    display: block;
    margin-bottom: 6px;
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h-sm);
    margin-bottom: 4px;
  }

  .toggle-row { cursor: pointer; font-size: var(--ga-text-control); color: var(--ga-ink-1); }
  .toggle-row input { width: 14px; height: 14px; }

  .control-label {
    width: 72px;
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1);
    flex-shrink: 0;
  }

  .control-row input[type="color"] {
    width: 28px;
    height: var(--ga-control-h-sm);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    padding: 0;
    cursor: pointer;
  }

  .radius-slider { flex: 1; accent-color: var(--ga-slider-fill, var(--ga-blue)); height: 14px; }
  .control-value { width: 44px; text-align: right; font-size: var(--ga-text-meta); color: var(--ga-ink-1); font-variant-numeric: tabular-nums; }

  .alpha-slider {
    flex: 1;
    accent-color: var(--ga-slider-fill, var(--ga-blue));
    height: 14px;
  }

  .control-row select {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h);
    background: var(--ga-slot);
    color: var(--ga-ink-0);
    border: 1px solid var(--ga-line-2);
    padding: 0 6px;
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-control);
  }

  .btn-more {
    display: block;
    height: var(--ga-control-h-sm);
    margin: 6px 0 4px;
    padding: 0 10px;
    background: var(--ga-sub);
    color: var(--ga-ink-1);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .btn-more:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }

  .btn-add-effect {
    display: block;
    width: 100%;
    height: var(--ga-control-h);
    margin: 6px 0;
    padding: 0 10px;
    background: transparent;
    color: var(--ga-ink-1);
    border: 1px dashed var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    text-align: center;
  }
  .btn-add-effect:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
</style>
