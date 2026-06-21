<script lang="ts">
  import VJFader from './VJFader.svelte';
  import EffectPickerModal from '../EffectPickerModal.svelte';
  import type { EffectType, EffectParams, Effect } from '../../types';
  import { EFFECT_PARAM_DEFS } from '../../effects/effectParamDefs';

  // Props
  export let layerStates: any[] = [];
  export let compositionEffects: Effect[] = [];
  export let clipGrid: (any | null)[][] = [];

  // Layer effect callbacks
  export let onAddLayerEffect: (layerIndex: number, effectType: EffectType) => void = () => {};
  export let onRemoveLayerEffect: (layerIndex: number, effectId: string) => void = () => {};
  export let onToggleLayerEffect: (layerIndex: number, effectId: string) => void = () => {};
  export let onUpdateLayerEffectParams: (layerIndex: number, effectId: string, params: Partial<EffectParams>) => void = () => {};

  // Composition effect callbacks
  export let onAddCompEffect: (effectType: EffectType) => void = () => {};
  export let onRemoveCompEffect: (effectId: string) => void = () => {};
  export let onToggleCompEffect: (effectId: string) => void = () => {};
  export let onUpdateCompEffectParams: (effectId: string, params: Partial<EffectParams>) => void = () => {};

  // Clip effect callbacks
  export let onAddClipEffect: (layerIndex: number, columnIndex: number, effectType: EffectType) => void = () => {};
  export let onRemoveClipEffect: (layerIndex: number, columnIndex: number, effectId: string) => void = () => {};
  export let onToggleClipEffect: (layerIndex: number, columnIndex: number, effectId: string) => void = () => {};
  export let onUpdateClipEffectParams: (layerIndex: number, columnIndex: number, effectId: string, params: Partial<EffectParams>) => void = () => {};

  // (Shader params are now in VJShaderPanel)

  const layerColors = [
    'var(--accent-primary)', '#4FC3F7', '#81C784', '#FFB74D',
    '#CE93D8', '#EF5350', '#4DD0E1', '#AED581',
  ];

  // UI state
  let effectsTab: 'comp' | 'layer' | 'clip' = 'layer';
  let selectedLayerIndex: number | null = 0;
  let expandedEffectId: string | null = null;
  let showEffectPicker = false;

  // Get the effects list for the current tab
  $: currentEffects = (() => {
    if (effectsTab === 'comp') {
      return compositionEffects || [];
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return [];
      const activeCol = layerStates[selectedLayerIndex]?.activeColumn;
      if (activeCol === null || activeCol === undefined) return [];
      const clip = clipGrid[selectedLayerIndex]?.[activeCol];
      return clip?.effects || [];
    } else {
      // layer
      if (selectedLayerIndex === null) return [];
      return layerStates[selectedLayerIndex]?.effects || [];
    }
  })();

  // Current tab label
  $: tabLabel = (() => {
    if (effectsTab === 'comp') return 'COMP FX';
    if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return 'CLIP FX';
      const activeCol = layerStates[selectedLayerIndex]?.activeColumn;
      const clip = activeCol != null ? clipGrid[selectedLayerIndex]?.[activeCol] : null;
      return clip ? `CLIP: ${clip.name}` : 'CLIP FX';
    }
    return selectedLayerIndex !== null ? `L${selectedLayerIndex + 1} FX` : 'LAYER FX';
  })();

  // Use shared effect parameter definitions (covers all 81+ effects)
  const effectParamDefs = EFFECT_PARAM_DEFS;

  // Handle adding effects from the picker modal (supports multi-select)
  function handleAddEffects(types: EffectType[]) {
    for (const type of types) {
      if (effectsTab === 'comp') {
        onAddCompEffect(type);
      } else if (effectsTab === 'clip') {
        if (selectedLayerIndex === null) return;
        const col = layerStates[selectedLayerIndex]?.activeColumn;
        if (col == null) return;
        onAddClipEffect(selectedLayerIndex, col, type);
      } else {
        if (selectedLayerIndex === null) return;
        onAddLayerEffect(selectedLayerIndex, type);
      }
    }
    showEffectPicker = false;
  }

  function handleToggleEffect(effectId: string) {
    if (effectsTab === 'comp') {
      onToggleCompEffect(effectId);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const col = layerStates[selectedLayerIndex]?.activeColumn;
      if (col == null) return;
      onToggleClipEffect(selectedLayerIndex, col, effectId);
    } else {
      if (selectedLayerIndex === null) return;
      onToggleLayerEffect(selectedLayerIndex, effectId);
    }
  }

  function handleRemoveEffect(effectId: string) {
    if (effectsTab === 'comp') {
      onRemoveCompEffect(effectId);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const col = layerStates[selectedLayerIndex]?.activeColumn;
      if (col == null) return;
      onRemoveClipEffect(selectedLayerIndex, col, effectId);
    } else {
      if (selectedLayerIndex === null) return;
      onRemoveLayerEffect(selectedLayerIndex, effectId);
    }
    if (expandedEffectId === effectId) expandedEffectId = null;
  }

  function handleUpdateParams(effectId: string, paramKey: string, value: number) {
    if (effectsTab === 'comp') {
      onUpdateCompEffectParams(effectId, { [paramKey]: value } as Partial<EffectParams>);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const col = layerStates[selectedLayerIndex]?.activeColumn;
      if (col == null) return;
      onUpdateClipEffectParams(selectedLayerIndex, col, effectId, { [paramKey]: value } as Partial<EffectParams>);
    } else {
      if (selectedLayerIndex === null) return;
      onUpdateLayerEffectParams(selectedLayerIndex, effectId, { [paramKey]: value } as Partial<EffectParams>);
    }
  }

  // Normalize a value into 0-1 range for VJFader
  function normalize(val: number, min: number, max: number): number {
    if (max === min) return 0;
    return Math.max(0, Math.min(1, (val - min) / (max - min)));
  }

  // Denormalize from 0-1 to actual range
  function denormalize(norm: number, min: number, max: number, step: number): number {
    const raw = min + norm * (max - min);
    return Math.round(raw / step) * step;
  }
</script>

<div class="effects-panel">
  <!-- ══ COMP / LAYER / CLIP Tabs ══ -->
  <div class="effects-tabs">
    <button class="fx-tab" class:active={effectsTab === 'comp'} on:click={() => { effectsTab = 'comp'; expandedEffectId = null; }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
      Comp
    </button>
    <button class="fx-tab" class:active={effectsTab === 'layer'} on:click={() => { effectsTab = 'layer'; expandedEffectId = null; }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      Layer
    </button>
    <button class="fx-tab" class:active={effectsTab === 'clip'} on:click={() => { effectsTab = 'clip'; expandedEffectId = null; }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Clip
    </button>
  </div>

  <!-- ══ Layer Selector (visible for layer + clip tabs) ══ -->
  {#if effectsTab === 'layer' || effectsTab === 'clip'}
    <div class="layer-selector">
      {#each layerStates as ls, i}
        <button
          class="layer-sel-btn"
          class:active={selectedLayerIndex === i}
          class:has-clip={!!ls.activeClip}
          style="--lc: {layerColors[i % layerColors.length]}"
          on:click={() => { selectedLayerIndex = i; expandedEffectId = null; }}
        >
          <span class="layer-sel-dot"></span>
          <span class="layer-sel-num">L{i + 1}</span>
          {#if ls.effects?.length > 0}
            <span class="layer-fx-count">{ls.effects.length}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- ══ Tab info ══ -->
  <div class="tab-info">
    <span class="tab-label">{tabLabel}</span>
    {#if effectsTab === 'comp'}
      <span class="tab-hint">Applied to all output</span>
    {/if}
  </div>

  <!-- ══ Effects List ══ -->
  <div class="effects-content">
    {#if (effectsTab === 'layer' || effectsTab === 'clip') && selectedLayerIndex === null}
      <div class="empty-hint">Tap a layer above to edit effects</div>
    {:else if effectsTab === 'clip' && selectedLayerIndex !== null && layerStates[selectedLayerIndex]?.activeColumn == null}
      <div class="empty-hint">No active clip on L{selectedLayerIndex + 1}</div>
    {:else}
      <!-- Add effect button - opens full catalog modal -->
      <button class="add-effect-btn" on:click={() => showEffectPicker = true}>
        + Add Effect
      </button>

      <!-- Current effects -->
      {#if currentEffects.length > 0}
        <div class="effects-list">
          {#each currentEffects as effect (effect.id)}
            <div class="effect-item" class:disabled={!effect.enabled}>
              <div class="effect-header" on:click={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}>
                <button
                  class="fx-toggle"
                  class:enabled={effect.enabled}
                  on:click|stopPropagation={() => handleToggleEffect(effect.id)}
                >{effect.enabled ? '●' : '○'}</button>
                <span class="effect-name">{effect.type}</span>
                <span class="expand-arrow">{expandedEffectId === effect.id ? '▲' : '▼'}</span>
                <button class="fx-remove" on:click|stopPropagation={() => handleRemoveEffect(effect.id)}>×</button>
              </div>

              {#if expandedEffectId === effect.id}
                <div class="effect-params">
                  {#each (effectParamDefs[effect.type] || []) as paramDef}
                    {@const rawVal = (effect.params as Record<string, number>)[paramDef.param]}
                    {@const currentVal = rawVal ?? paramDef.default}
                    <div class="param-row">
                      <span class="param-label">{paramDef.name}</span>
                      {#if paramDef.type === 'select' && paramDef.options}
                        <select value={currentVal}
                          on:change={(e) => handleUpdateParams(effect.id, paramDef.param, parseFloat(e.currentTarget.value))}
                          style="flex:1; background:#222; color:#fff; border:1px solid #444; border-radius:3px; padding:4px; font-size:13px;">
                          {#each paramDef.options as opt}
                            <option value={opt.value} selected={currentVal === opt.value}>{opt.label}</option>
                          {/each}
                        </select>
                      {:else if paramDef.type === 'color' && paramDef.colorParams}
                        {@const cr = (effect.params as Record<string, number>)[paramDef.colorParams.r] ?? 0}
                        {@const cg = (effect.params as Record<string, number>)[paramDef.colorParams.g] ?? 1}
                        {@const cb = (effect.params as Record<string, number>)[paramDef.colorParams.b] ?? 0.4}
                        {@const hexVal = '#' + [cr,cg,cb].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}
                        <input type="color" value={hexVal}
                          on:input={(e) => {
                            const hex = e.currentTarget.value;
                            const r = parseInt(hex.slice(1,3), 16) / 255;
                            const g = parseInt(hex.slice(3,5), 16) / 255;
                            const b = parseInt(hex.slice(5,7), 16) / 255;
                            if (paramDef.colorParams) {
                              handleUpdateParams(effect.id, paramDef.colorParams.r, r);
                              handleUpdateParams(effect.id, paramDef.colorParams.g, g);
                              handleUpdateParams(effect.id, paramDef.colorParams.b, b);
                            }
                          }}
                          style="flex:0 0 44px; height:28px; padding:0; border:1px solid #444; border-radius:3px; cursor:pointer;" />
                      {:else}
                        <div class="param-slider">
                          <VJFader
                            value={normalize(currentVal, paramDef.min, paramDef.max)}
                            label=""
                            color={selectedLayerIndex !== null ? layerColors[selectedLayerIndex % layerColors.length] : 'var(--accent-primary)'}
                            orientation="horizontal"
                            onChange={(norm) => {
                              const val = denormalize(norm, paramDef.min, paramDef.max, paramDef.step);
                              handleUpdateParams(effect.id, paramDef.param, val);
                            }}
                            showLeds={false}
                            height={0}
                          />
                        </div>
                        <span class="param-val">
                          {currentVal.toFixed(paramDef.step < 0.1 ? 2 : paramDef.step < 1 ? 1 : 0)}
                        </span>
                      {/if}
                    </div>
                  {/each}
                  {#if (effectParamDefs[effect.type] || []).length === 0}
                    <div class="empty-hint">No adjustable parameters</div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-hint">No effects — tap + Add Effect</div>
      {/if}
    {/if}
  </div>
</div>

<!-- Effect picker modal (full catalog, multi-select) -->
<EffectPickerModal
  bind:open={showEffectPicker}
  onAdd={handleAddEffects}
  onClose={() => showEffectPicker = false}
/>

<style>
  .effects-panel {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    flex: 1;
    min-height: 0;
    gap: 2px;
  }

  /* ── Tabs ── */
  .effects-tabs {
    display: flex;
    gap: 2px;
    padding: 4px 4px 0;
    flex-shrink: 0;
  }

  .fx-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 4px;
    border-radius: 6px 6px 0 0;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-bottom: none;
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.4);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .fx-tab.active {
    background: rgba(187, 134, 252, 0.1);
    border-color: rgba(187, 134, 252, 0.3);
    color: #BB86FC;
  }

  .fx-tab svg {
    opacity: 0.6;
  }
  .fx-tab.active svg {
    opacity: 1;
    stroke: #BB86FC;
  }

  /* ── Layer Selector ── */
  .layer-selector {
    display: flex;
    gap: 3px;
    padding: 4px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .layer-sel-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.4);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    position: relative;
  }

  .layer-sel-btn.active {
    border-color: var(--lc);
    color: var(--lc);
    background: rgba(255, 255, 255, 0.06);
    box-shadow: 0 0 6px color-mix(in srgb, var(--lc) 20%, transparent);
  }

  .layer-sel-btn.has-clip .layer-sel-dot {
    box-shadow: 0 0 4px var(--lc);
  }

  .layer-sel-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--lc);
    opacity: 0.5;
  }

  .layer-sel-btn.active .layer-sel-dot {
    opacity: 1;
  }

  .layer-sel-num {
    font-size: 11px;
  }

  .layer-fx-count {
    font-size: 9px;
    background: rgba(187, 134, 252, 0.2);
    color: #BB86FC;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 800;
  }

  /* ── Tab Info ── */
  .tab-info {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    flex-shrink: 0;
  }

  .tab-label {
    font-size: 11px;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.5);
    letter-spacing: 1px;
  }

  .tab-hint {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.25);
  }

  /* ── Param Row (shared) ── */
  .param-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .param-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.45);
    min-width: 55px;
    max-width: 55px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .param-slider {
    flex: 1;
    min-width: 0;
  }

  .param-val {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.35);
    min-width: 30px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* ── Effects Content ── */
  .effects-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    padding: 0 4px 4px;
  }

  .add-effect-btn {
    width: 100%;
    padding: 7px;
    border-radius: 4px;
    border: 1px dashed rgba(187, 134, 252, 0.25);
    background: rgba(187, 134, 252, 0.05);
    color: #BB86FC;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    margin-bottom: 4px;
  }
  .add-effect-btn:active {
    background: rgba(187, 134, 252, 0.15);
    transform: scale(0.98);
  }

  /* ── Effects List ── */
  .effects-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .effect-item {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 4px;
    overflow: hidden;
  }
  .effect-item.disabled { opacity: 0.5; }

  .effect-header {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 6px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .fx-toggle {
    border: none;
    background: none;
    color: rgba(255, 255, 255, 0.3);
    font-size: 17px;
    cursor: pointer;
    padding: 8px;
    min-width: 36px;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .fx-toggle.enabled { color: #BB86FC; }

  .effect-name {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
  }

  .expand-arrow {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.25);
    padding: 4px;
  }

  .fx-remove {
    border: none;
    background: none;
    color: rgba(255, 68, 68, 0.5);
    font-size: 23px;
    cursor: pointer;
    padding: 8px;
    min-width: 36px;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .fx-remove:active { color: #ff4444; }

  .effect-params {
    padding: 4px 6px 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .empty-hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.2);
    text-align: center;
    padding: 10px;
  }
</style>
