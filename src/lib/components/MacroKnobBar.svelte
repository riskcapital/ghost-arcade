<script lang="ts">
  /**
   * MacroKnobBar — 8 macro knobs in a single horizontal row.
   *
   * Each knob is a ~28px circular control showing the current value as a
   * filled arc. Drag vertically to change the value (DAW convention).
   * Right-click → "Edit Macro" popover: rename, color, auto-pulse,
   * effect bundle (add via EffectPickerModal · enable/disable · remove ·
   * drag-reorder).
   *
   * The macro value is the wet/dry mix amount for the bundle. Renderer
   * scales each effect's opacity by `value` and runs the chain on the
   * dual-deck composite. Multiple macros stack.
   *
   * MIDI: each knob exposes `vj:macro:N:value` so hardware controllers
   * can drive the wet/dry mix directly.
   */
  import { macros, type Macro } from '../stores/macros';
  import EffectPickerModal from './EffectPickerModal.svelte';
  import { effectParamLabels, type ParamMeta } from '../effects/effectUX';
  import { EFFECT_CATALOG } from '../effects/effectCatalog';
  import type { EffectType, Effect, EffectParams } from '../types';
  import { t } from '../i18n';
  import { effectOptionLabel, effectParamLabel, effectTypeLabel } from '../i18n/displayLabels';

  // Drag state — track which knob is being dragged + start position.
  let dragKnobId: string | null = null;
  let dragStartY = 0;
  let dragStartValue = 0;

  // Right-click "Edit Macro" popover state.
  let editPopoverFor: string | null = null;
  let popoverX = 0;
  let popoverY = 0;
  let popoverEl: HTMLDivElement | null = null;

  // Effect picker modal state — opened by [+ Add Effect] inside the
  // popover. Same modal the layer/clip/composition effects panels use.
  let showEffectPicker = false;
  let effectPickerForMacro: string | null = null;

  // Drag-reorder state for effects within a macro's chain.
  let dragEffectIdx: number | null = null;

  // Which effect row in the popover is expanded to show its parameter
  // sliders. One at a time — clicking an effect's title row toggles its
  // own panel and collapses any other open one. null = all collapsed.
  let expandedFxId: string | null = null;

  // Inline name-edit state.
  let renamingId: string | null = null;
  let renameDraft = '';

  // Cache: effect type → human label (from EFFECT_CATALOG). Falls back to
  // the type string if no entry. Used in the effect-row title.
  const EFFECT_LABEL_BY_TYPE: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    for (const e of EFFECT_CATALOG) map[e.type] = e.label;
    return map;
  })();

  function displayLabelKey(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function getEffectLabel(type: string): string {
    return effectTypeLabel($t, type, EFFECT_LABEL_BY_TYPE[type] ?? type);
  }

  function getEffectParamDisplayLabel(key: string, fallback = key): string {
    const translatedById = effectParamLabel($t, key);
    return translatedById === key
      ? effectParamLabel($t, displayLabelKey(fallback), fallback)
      : translatedById;
  }

  function getEffectOptionDisplayLabel(value: string | number, fallback = String(value)): string {
    const translatedById = effectOptionLabel($t, value);
    return translatedById === String(value)
      ? effectOptionLabel($t, displayLabelKey(fallback), fallback)
      : translatedById;
  }

  // Param metadata helpers — pull the per-effect-type param schema from
  // effectUX.ts and turn it into an iterable list for the slider grid.
  function getParamMetas(effectType: EffectType): Array<{ key: string; meta: ParamMeta }> {
    const schema = effectParamLabels[effectType];
    if (!schema) return [];
    return Object.entries(schema).map(([key, meta]) => ({ key, meta: meta as ParamMeta }));
  }
  function getParamValue(fx: Effect, key: string, fallback: number): number {
    const v = (fx.params as any)?.[key];
    return typeof v === 'number' ? v : fallback;
  }

  function knobStartDrag(e: PointerEvent, m: Macro) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragKnobId = m.id;
    dragStartY = e.clientY;
    dragStartValue = m.value;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function knobOnPointerMove(e: PointerEvent, m: Macro) {
    if (dragKnobId !== m.id) return;
    // 200px of vertical drag = full 0..1 sweep. Drag up = increase.
    const dy = dragStartY - e.clientY;
    const next = Math.max(0, Math.min(1, dragStartValue + dy / 200));
    macros.setMacroValue(m.id, next);
  }
  function knobEndDrag(e: PointerEvent) {
    dragKnobId = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // Wheel: fine-tune. Each notch = 0.02. Shift = 0.005 for finer.
  function knobOnWheel(e: WheelEvent, m: Macro) {
    e.preventDefault();
    const step = e.shiftKey ? 0.005 : 0.02;
    const dir = e.deltaY > 0 ? -1 : 1;
    macros.setMacroValue(m.id, m.value + dir * step);
  }

  // Double-click: reset to 0
  function knobReset(m: Macro) {
    macros.setMacroValue(m.id, 0);
  }

  function openEditPopover(e: MouseEvent, m: Macro) {
    e.preventDefault();
    editPopoverFor = m.id;
    popoverX = e.clientX;
    popoverY = e.clientY;
  }
  function closePopover() {
    editPopoverFor = null;
  }
  function onWindowClick(e: MouseEvent) {
    if (!editPopoverFor) return;
    const t = e.target as Node;
    if (popoverEl && !popoverEl.contains(t)) {
      // Don't close if the click was on the knob itself (right-click reopens)
      const knob = (t as HTMLElement).closest?.('.macro-knob');
      if (knob) return;
      closePopover();
    }
  }

  function startRename(m: Macro) {
    renamingId = m.id;
    renameDraft = m.name;
  }
  function commitRename(m: Macro) {
    if (renameDraft.trim()) {
      macros.setMacroName(m.id, renameDraft.trim().toUpperCase().slice(0, 12));
    }
    renamingId = null;
  }

  // Compute the SVG path for the knob's value arc.
  // Sweep from -225° (bottom-left) clockwise to value × 270°. Always-on
  // background ring sits underneath.
  function arcPath(value: number, radius: number): string {
    const v = Math.max(0, Math.min(1, value));
    const sweepDeg = v * 270;
    const startAngle = -225; // degrees (bottom-left)
    const endAngle = startAngle + sweepDeg;
    const cx = radius + 2;
    const cy = radius + 2;
    const sx = cx + radius * Math.cos((startAngle * Math.PI) / 180);
    const sy = cy + radius * Math.sin((startAngle * Math.PI) / 180);
    const ex = cx + radius * Math.cos((endAngle * Math.PI) / 180);
    const ey = cy + radius * Math.sin((endAngle * Math.PI) / 180);
    // SVG's large-arc-flag flips when the swept ANGLE exceeds 180°.
    // The knob's total range is 270° (not 360°), so the flip happens
    // at v = 180/270 ≈ 0.667 — NOT at 0.5. The old `v > 0.5` test
    // flipped early at ~135° of sweep, making the path take the
    // long-way-around and visibly bleed outside the background ring
    // between roughly 50% and 67% of the knob travel.
    const largeArc = sweepDeg > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${radius} ${radius} 0 ${largeArc} 1 ${ex} ${ey}`;
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="macro-bar">
  {#each $macros.macros as m (m.id)}
    {@const fxCount = m.effects.length}
    {@const enabledFxCount = m.effects.filter((e) => e.enabled).length}
    <div
      class="macro-slot"
      title={$t('sequencer.macro.slotTitle', { values: { name: m.name, enabled: enabledFxCount, total: fxCount } })}
    >
      <button
        class="macro-knob"
        style="--macro-color: {m.color}"
        onpointerdown={(e) => knobStartDrag(e, m)}
        onpointermove={(e) => knobOnPointerMove(e, m)}
        onpointerup={knobEndDrag}
        onpointercancel={knobEndDrag}
        onpointerleave={knobEndDrag}
        onlostpointercapture={knobEndDrag}
        onwheel={(e) => knobOnWheel(e, m)}
        ondblclick={() => knobReset(m)}
        oncontextmenu={(e) => openEditPopover(e, m)}
        data-midi-path="vj:macro:{m.id.replace('macro-', '')}:value"
        data-midi-label={$t('sequencer.macro.midiLabel', { values: { name: m.name } })}
        data-midi-min="0"
        data-midi-max="1"
        data-midi-step="0.001"
        aria-label={$t('sequencer.macro.knobLabel', { values: { name: m.name } })}
      >
        <svg width="34" height="34" viewBox="0 0 34 34" class="macro-svg">
          <!-- Background ring -->
          <path
            d={arcPath(1, 14)}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            stroke-width="3"
            stroke-linecap="round"
          />
          <!-- Value arc -->
          {#if m.value > 0.001}
            <path
              d={arcPath(m.value, 14)}
              fill="none"
              stroke="var(--macro-color)"
              stroke-width="3"
              stroke-linecap="round"
            />
          {/if}
          <!-- Center pip indicator -->
          <circle cx="17" cy="17" r="2" fill="var(--macro-color)" opacity={0.4 + m.value * 0.6} />
        </svg>
        <span class="macro-pointer" style="transform: rotate({-135 + m.value * 270}deg)" aria-hidden="true"></span>
        {#if fxCount > 0}
          <span
            class="macro-dest-count"
            style="--macro-color: {m.color}"
            title={$t('sequencer.macro.effectsEnabledTitle', { values: { enabled: enabledFxCount, total: fxCount } })}
            >{fxCount}</span
          >
        {/if}
      </button>

      {#if renamingId === m.id}
        <input
          class="macro-name-input"
          bind:value={renameDraft}
          autofocus
          onblur={() => commitRename(m)}
          onkeydown={(e) => {
            if (e.key === 'Enter') commitRename(m);
            else if (e.key === 'Escape') {
              renamingId = null;
            }
          }}
        />
      {:else}
        <button class="macro-name" ondblclick={() => startRename(m)} title={$t('sequencer.macro.renameTitle')}>
          {m.name}
        </button>
      {/if}
    </div>
  {/each}
</div>

{#if editPopoverFor}
  {@const m = $macros.macros.find((x) => x.id === editPopoverFor)}
  {#if m}
    <div class="macro-popover" bind:this={popoverEl} style="left:{popoverX}px;top:{popoverY}px">
      <div class="macro-popover-head">
        <input
          class="macro-popover-name"
          value={m.name}
          oninput={(e) => macros.setMacroName(m.id, (e.target as HTMLInputElement).value.toUpperCase().slice(0, 12))}
        />
        <input
          class="macro-popover-color"
          type="color"
          value={m.color}
          oninput={(e) => macros.setMacroColor(m.id, (e.target as HTMLInputElement).value)}
          title={$t('sequencer.macro.colorTitle')}
        />
        <button
          class="macro-popover-close"
          onclick={closePopover}
          title={$t('sequencer.macro.close')}
          aria-label={$t('sequencer.macro.close')}>×</button
        >
      </div>

      <!-- Beat-pulse: auto-cycle the macro value at a beat division.
           Uses the master BPM (manual tap > MIDI clock > audio-detect).
           Off = manual control only. -->
      <div class="macro-popover-section">
        <div class="macro-popover-section-title">{$t('sequencer.macro.pulse.title')}</div>
        <div class="macro-popover-row macro-pulse-row">
          <select
            class="macro-pulse-mode"
            value={m.pulseMode ?? 'off'}
            onchange={(e) => macros.setPulseMode(m.id, (e.target as HTMLSelectElement).value as any)}
            title={$t('sequencer.macro.pulse.modeTitle')}
          >
            <option value="off">{$t('sequencer.macro.pulseMode.off')}</option>
            <option value="1/4">1/4</option>
            <option value="1/2">1/2</option>
            <option value="1bar">{$t('sequencer.macro.pulseMode.1bar')}</option>
            <option value="2bar">{$t('sequencer.macro.pulseMode.2bar')}</option>
            <option value="4bar">{$t('sequencer.macro.pulseMode.4bar')}</option>
          </select>
          <select
            class="macro-pulse-shape"
            value={m.pulseShape ?? 'sine'}
            disabled={(m.pulseMode ?? 'off') === 'off'}
            onchange={(e) => macros.setPulseShape(m.id, (e.target as HTMLSelectElement).value as any)}
            title={$t('sequencer.macro.pulse.shapeTitle')}
          >
            <option value="sine">{$t('sequencer.macro.pulseShape.sine')}</option>
            <option value="tri">{$t('sequencer.macro.pulseShape.tri')}</option>
            <option value="saw-up">{$t('sequencer.macro.pulseShape.sawUp')}</option>
            <option value="saw-down">{$t('sequencer.macro.pulseShape.sawDown')}</option>
            <option value="square">{$t('sequencer.macro.pulseShape.square')}</option>
            <option value="pulse">{$t('sequencer.macro.pulseShape.pulse')}</option>
          </select>
        </div>
        {#if (m.pulseMode ?? 'off') !== 'off'}
          <div class="macro-popover-hint" style="border-left-color: {m.color}; background: rgba(187, 134, 252, 0.06);">
            {$t('sequencer.macro.pulse.hint', {
              values: {
                mode: $t(`sequencer.macro.pulseMode.${m.pulseMode ?? 'off'}`),
              },
            })}
          </div>
        {/if}
      </div>

      <!-- Effect bundle. Drag-reorder rows to change apply order;
           toggle enable per-effect; remove individuals. The macro's
           value (knob position) is the wet/dry mix for the whole
           bundle — at value=0 the whole chain is silent, at value=1
           each effect runs at its own opacity setting. -->
      <div class="macro-popover-section">
        <div class="macro-popover-section-title-row">
          <span class="macro-popover-section-title">{$t('sequencer.macro.effectBundle.title', { values: { count: m.effects.length} })}</span>
          <div class="macro-popover-fx-actions">
            {#if m.effects.length > 0}
              <button class="macro-action-btn macro-action-danger"
                onclick={() => { if (confirm($t('sequencer.macro.effectBundle.clearConfirm', { values: { name: m.name } }))) macros.clearEffects(m.id); }}
                title={$t('sequencer.macro.effectBundle.clearTitle')}
              >
                {$t('sequencer.macro.clear')}
              </button>
            {/if}
            <button class="macro-action-btn"
              onclick={() => { effectPickerForMacro = m.id; showEffectPicker = true; }}
              title={$t('sequencer.macro.effectBundle.addTitle')}
            >
              {$t('sequencer.macro.addEffect')}
            </button>
          </div>
        </div>
        {#if m.effects.length === 0}
          <div class="macro-popover-empty">
            {$t('sequencer.macro.effectBundle.emptyBefore')} <strong>{$t('sequencer.macro.addEffect')}</strong>
            {$t('sequencer.macro.effectBundle.emptyAfter')}
          </div>
        {:else}
          <div class="macro-fx-list">
            {#each m.effects as fx, fxIdx (fx.id)}
              {@const paramMetas = getParamMetas(fx.type)}
              {@const isExpanded = expandedFxId === fx.id}
              <div
                class="macro-fx-card"
                class:disabled={!fx.enabled}
                class:dragging={dragEffectIdx === fxIdx}
                class:expanded={isExpanded}
                ondragover={(e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; }}
                ondrop={(e) => {
                  e.preventDefault();
                  if (dragEffectIdx !== null && dragEffectIdx !== fxIdx) {
                    macros.reorderEffects(m.id, dragEffectIdx, fxIdx);
                  }
                  dragEffectIdx = null;
                }}
                ondragend={() => { dragEffectIdx = null; }}
                role="listitem"
              >
                <div class="macro-fx-row">
                  <!-- Drag handle is the ONLY draggable element. Earlier
                       impl set draggable on the whole row, which made
                       the inner opacity <input range> initiate a drag
                       instead of receiving the slider gesture. Now the
                       ⋮⋮ alone owns the reorder grip. -->
                  <span
                    class="macro-fx-handle"
                    title={$t('sequencer.macro.effectBundle.dragToReorder')}
                    draggable="true"
                    ondragstart={(e) => {
                      dragEffectIdx = fxIdx;
                      e.dataTransfer?.setData('text/plain', String(fxIdx));
                      e.dataTransfer!.effectAllowed = 'move';
                    }}
                  >⋮⋮</span>
                  <button class="macro-dest-toggle"
                    title={$t(
                      fx.enabled ? 'sequencer.macro.effectBundle.bypass' : 'sequencer.macro.effectBundle.enable',
                    )}
                    aria-label={$t(
                      fx.enabled ? 'sequencer.macro.effectBundle.bypass' : 'sequencer.macro.effectBundle.enable',
                    )}
                    onclick={() => macros.toggleEffect(m.id, fx.id)}>
                    {fx.enabled ? '●' : '○'}
                  </button>
                  <button
                    class="macro-fx-expand"
                    class:open={isExpanded}
                    title={$t(
                      isExpanded ? 'sequencer.macro.effectBundle.collapseParams'
                        : 'sequencer.macro.effectBundle.expandParams',
                    )}
                    aria-label={$t(
                      isExpanded
                        ? 'sequencer.macro.effectBundle.collapseParams'
                        : 'sequencer.macro.effectBundle.expandParams',
                    )}
                    onclick={() => (expandedFxId = isExpanded ? null : fx.id)}
                  >▶</button>
                  <button
                    class="macro-fx-meta"
                    title={$t(
                      isExpanded
                        ? 'sequencer.macro.effectBundle.collapseParams'
                        : 'sequencer.macro.effectBundle.expandParams',
                    )}
                    onclick={() => (expandedFxId = isExpanded ? null : fx.id)}
                  >
                    <div class="macro-fx-label">{getEffectLabel(fx.type)}</div>
                    <div class="macro-fx-sub">
                      {$t('sequencer.macro.effectBundle.opacity', {
                        values: { percent: Math.round((fx.opacity ?? 1) * 100)},
                      })}
                      {#if paramMetas.length > 0} · {$t('sequencer.macro.effectBundle.paramsCount', {
                          values: { count: paramMetas.length},
                        })}{/if}
                    </div>
                  </button>
                  <input
                    class="macro-fx-opacity"
                    type="range"
                    min="0" max="1" step="0.01"
                    value={fx.opacity ?? 1}
                    oninput={(e) => macros.updateEffectMeta(m.id, fx.id, { opacity: parseFloat((e.target as HTMLInputElement).value),
                      })}
                    title={$t('sequencer.macro.effectBundle.opacityTitle')}
                  />
                  <button class="macro-dest-remove"
                    title={$t('sequencer.macro.effectBundle.remove')}
                    aria-label={$t('sequencer.macro.effectBundle.remove')}
                    onclick={() => macros.removeEffect(m.id, fx.id)}>×</button>
                </div>

                {#if isExpanded}
                  <div class="macro-fx-params">
                    <div class="macro-fx-params-title">
                      <span>{$t('sequencer.macro.effectBundle.effect')}</span>
                      <strong>{getEffectLabel(fx.type)}</strong>
                    </div>
                    {#if paramMetas.length === 0}
                      <div class="macro-fx-params-empty">
                        {$t('sequencer.macro.effectBundle.noParams')}
                      </div>
                    {:else}
                      {#each paramMetas as { key, meta } (key)}
                        {@const value = getParamValue(fx, key, meta.default)}
                        {#if meta.type === 'select' && meta.options}
                          <div class="macro-fx-param">
                            <label class="macro-fx-param-label" for="mfx-{fx.id}-{key}">{getEffectParamDisplayLabel(key, meta.label)}</label>
                            <select
                              id="mfx-{fx.id}-{key}"
                              class="macro-fx-param-select"
                              {value}
                              onchange={(e) => macros.updateEffectParams(m.id, fx.id, { [key]: parseFloat((e.target as HTMLSelectElement).value),
                                } as Partial<EffectParams>)}
                            >
                              {#each meta.options as opt}
                                <option value={opt.value}>{getEffectOptionDisplayLabel(opt.value, opt.label)}</option>
                              {/each}
                            </select>
                          </div>
                        {:else}
                          <div class="macro-fx-param">
                            <label class="macro-fx-param-label" for="mfx-{fx.id}-{key}">{getEffectParamDisplayLabel(key, meta.label)}</label>
                            <input
                              id="mfx-{fx.id}-{key}"
                              class="macro-fx-param-slider"
                              type="range"
                              min={meta.min} max={meta.max} step={meta.step}
                              {value}
                              oninput={(e) => macros.updateEffectParams(m.id, fx.id, { [key]: parseFloat((e.target as HTMLInputElement).value),
                                } as Partial<EffectParams>)}
                            />
                            <span class="macro-fx-param-value">{value.toFixed(meta.step >= 1 ? 0 : 2)}</span>
                          </div>
                        {/if}
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}

<!-- Effect picker — same modal the layer/clip/composition effects
     panels use. Multi-select supported; each picked type is appended to
     the macro's effect bundle in order. -->
<EffectPickerModal
  bind:open={showEffectPicker}
  onAdd={(types: EffectType[]) => {
    if (effectPickerForMacro) {
      for (const t of types) macros.addEffect(effectPickerForMacro, t);
    }
    showEffectPicker = false;
    effectPickerForMacro = null;
  }}
  onClose={() => {
    showEffectPicker = false;
    effectPickerForMacro = null;
  }}
/>

<style>
  .macro-bar {
    display: inline-flex;
    align-items: center;
    gap: var(--vj-macro-gap, 1px);
    padding: 4px 4px 1px;
    width: var(--vj-macro-bank-w, auto);
    box-sizing: border-box;
    justify-content: center;
  }

  .macro-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex: 0 0 var(--vj-macro-slot, 46px);
    width: var(--vj-macro-slot, 46px);
    min-height: calc(var(--vj-macro-knob, 34px) + 16px);
  }
  .macro-slot.learning .macro-knob {
    box-shadow:
      0 0 0 2px rgba(187, 134, 252, 0.6),
      0 0 14px rgba(187, 134, 252, 0.45);
  }

  .macro-knob {
    position: relative;
    width: var(--vj-macro-knob, 34px);
    height: var(--vj-macro-knob, 34px);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 50%;
    cursor: ns-resize;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 0.12s,
      border-color 0.12s;
    touch-action: none;
  }
  .macro-knob:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .macro-svg {
    width: calc(var(--vj-macro-knob, 34px) - 2px);
    height: calc(var(--vj-macro-knob, 34px) - 2px);
    pointer-events: none;
    position: relative;
    z-index: 1;
  }

  .macro-pointer {
    display: none;
    position: absolute;
    top: 5px;
    left: 50%;
    z-index: 2;
    width: 2px;
    height: 12px;
    margin-left: -1px;
    border-radius: 999px;
    transform-origin: 50% 12px;
    pointer-events: none;
  }

  .macro-dest-count {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 17px;
    height: 17px;
    padding: 0 3px;
    background: var(--macro-color);
    color: #000;
    font-size: 12px;
    font-weight: 800;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    z-index: 3;
  }

  .macro-name {
    background: none;
    border: none;
    color: rgba(238, 240, 244, 0.52);
    font-size: var(--vj-macro-name-font, 9px);
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 0 2px;
    cursor: pointer;
    max-width: var(--vj-macro-slot, 46px);
    line-height: 1.05;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-name:hover {
    color: var(--text-primary, #ccc);
  }

  .macro-name-input {
    width: var(--vj-macro-slot, 46px);
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: calc(var(--vj-macro-name-font, 9px) + 2px);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-align: center;
    border-radius: 3px;
    padding: 1px 2px;
  }

  /* Popover */
  .macro-popover {
    position: fixed;
    z-index: 10000;
    min-width: 360px;
    max-width: 460px;
    background: #15151a;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .macro-popover-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .macro-popover-name {
    flex: 1;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #fff;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .macro-popover-color {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    cursor: pointer;
    padding: 0;
    border-radius: 4px;
  }
  .macro-popover-close {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    font-size: 17px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .macro-popover-close:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  .macro-popover-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .macro-popover-section-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-muted, #888);
    letter-spacing: 0.16em;
  }
  /* Header row inside a section: title on the left + action buttons on
     the right. Used by the EFFECT BUNDLE section to put the [+ Add]
     and [Clear] buttons inline with the section heading. */
  .macro-popover-section-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .macro-popover-fx-actions {
    display: flex;
    gap: 6px;
  }
  .macro-popover-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .macro-popover-actions {
    gap: 8px;
  }

  /* Effect-bundle list: each row is one effect in the chain. Drag the
     ⋮⋮ handle to reorder. Toggle ●/○ enables/disables. The ▶ button
     expands the row into a parameter editor (sliders for amount /
     amount2 / threshold / etc.) so you can tune the effect inline.
     Slider on the right sets per-effect opacity (the macro knob's
     wet/dry then scales the whole bundle). The × removes the effect. */
  .macro-fx-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 420px;
    overflow-y: auto;
  }
  .macro-fx-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 5px;
    transition: background 0.12s, border-color 0.12s, opacity 0.12s;
    overflow: hidden;
  }
  .macro-fx-card:hover { border-color: rgba(255, 255, 255, 0.12); }
  .macro-fx-card.disabled { opacity: 0.45; }
  .macro-fx-card.dragging { opacity: 0.55; background: rgba(187, 134, 252, 0.06); border-color: rgba(187, 134, 252, 0.4); }
  .macro-fx-card.expanded { background: rgba(255, 255, 255, 0.045); border-color: rgba(187, 134, 252, 0.35); }
  .macro-fx-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
  }
  .macro-fx-expand {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 4px 2px;
    transition: transform 0.15s, color 0.12s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .macro-fx-expand:hover { color: #fff; }
  .macro-fx-expand.open {
    transform: rotate(90deg);
    color: #bb86fc;
  }
  /* Make the meta block clickable as a secondary expand affordance —
     clicking the effect name should also toggle the param drawer, since
     the chevron is small. */
  button.macro-fx-meta {
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0;
  }
  button.macro-fx-meta:hover .macro-fx-label { color: #fff; }

  /* Expanded param panel — sits inside the same card as the row, drops
     down with a top border so the visual relationship is clear. Two
     param-row layouts: slider+value (numeric) or full-width select. */
  .macro-fx-params {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px 10px;
    border-top: 1px solid rgba(187, 134, 252, 0.18);
    background: rgba(0, 0, 0, 0.18);
  }
  .macro-fx-params-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 0 0 6px;
    margin-bottom: 2px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    color: var(--text-muted, #888);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .macro-fx-params-title strong {
    min-width: 0;
    color: var(--text-primary, #fff);
    font-size: 13px;
    letter-spacing: 0.02em;
    text-transform: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-fx-params-empty {
    font-size: 13px;
    color: #777;
    font-style: italic;
    padding: 2px 0;
  }
  .macro-fx-param {
    display: grid;
    grid-template-columns: 90px 1fr 44px;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }
  .macro-fx-param-label {
    font-size: 13px;
    color: var(--text-primary, #ccc);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
  }
  .macro-fx-param-slider {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    cursor: pointer;
  }
  .macro-fx-param-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #bb86fc;
    cursor: pointer;
  }
  .macro-fx-param-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #bb86fc;
    border: none;
    cursor: pointer;
  }
  .macro-fx-param-value {
    font-size: 13px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    color: #bb86fc;
    text-align: right;
    user-select: none;
  }
  .macro-fx-param-select {
    grid-column: 2 / 4;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-primary, #ddd);
    font-size: 14px;
    padding: 3px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .macro-fx-handle {
    cursor: grab;
    color: #555;
    font-size: 15px;
    line-height: 1;
    padding: 0 2px;
    user-select: none;
  }
  .macro-fx-handle:active { cursor: grabbing; }
  .macro-fx-meta {
    flex: 1 1 150px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .macro-fx-label {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-fx-sub {
    font-size: 12px;
    color: #777;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-fx-opacity {
    width: 110px;
    flex: 0 0 110px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    cursor: pointer;
  }
  .macro-fx-opacity::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #bb86fc;
    cursor: pointer;
  }
  .macro-fx-opacity::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #bb86fc;
    border: none;
    cursor: pointer;
  }

  .macro-action-btn {
    background: rgba(255, 133, 119, 0.1);
    border: 1px solid rgba(255, 133, 119, 0.4);
    color: #ff8577;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 5px 10px;
    border-radius: 4px;
    cursor: pointer;
  }
  .macro-action-btn:hover {
    background: rgba(255, 133, 119, 0.2);
  }
  .macro-action-btn.active {
    background: #ff8577;
    color: #000;
  }
  .macro-action-btn.macro-action-danger {
    background: rgba(255, 80, 80, 0.1);
    border-color: rgba(255, 80, 80, 0.4);
    color: #ff8080;
  }
  .macro-action-btn.macro-action-danger:hover {
    background: rgba(255, 80, 80, 0.2);
  }

  /* Pulse mode + shape selectors — paired in one row */
  .macro-pulse-row {
    gap: 6px;
  }
  .macro-pulse-mode, .macro-pulse-shape {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-primary, #ddd);
    font-size: 14px;
    padding: 4px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .macro-pulse-shape:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .macro-popover-hint {
    background: rgba(187, 134, 252, 0.08);
    border-left: 2px solid #bb86fc;
    padding: 6px 8px;
    font-size: 13px;
    color: var(--text-primary, #ccc);
    line-height: 1.45;
  }

  .macro-popover-empty {
    font-size: 13px;
    color: #666;
    font-style: italic;
    padding: 6px 0;
  }

  .macro-dest-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 240px;
    overflow-y: auto;
  }
  .macro-dest-row {
    display: grid;
    grid-template-columns: 18px 1fr 36px 56px 56px 18px;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 4px;
    border: 1px solid transparent;
  }
  .macro-dest-row:hover { border-color: rgba(255, 255, 255, 0.08); }
  .macro-dest-row.disabled { opacity: 0.45; }

  .macro-dest-toggle {
    background: none;
    border: none;
    color: #bb86fc;
    cursor: pointer;
    font-size: 17px;
    line-height: 1;
    padding: 0;
  }

  .macro-dest-meta {
    overflow: hidden;
  }
  .macro-dest-label {
    font-size: 14px;
    color: var(--text-primary, #ddd);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-dest-path {
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 12px;
    color: #666;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .macro-dest-curve {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #ccc);
    border-radius: 3px;
    font-size: 14px;
    padding: 2px;
    cursor: pointer;
  }
  .macro-dest-min, .macro-dest-max {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-primary, #ccc);
    font-size: 13px;
    padding: 2px 4px;
    border-radius: 3px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
  .macro-dest-remove {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }
  .macro-dest-remove:hover { color: #ff6b6b; }

  :global(html[data-theme='arcade']) .macro-bar {
    gap: 4px;
  }

  :global(html[data-theme='arcade']) .macro-slot {
    gap: 4px;
  }

  :global(html[data-theme='arcade']) .macro-knob {
    width: 42px;
    height: 42px;
    background:
      radial-gradient(circle at 50% 48%, #1a1814 0 45%, #090807 46% 62%, transparent 63%),
      conic-gradient(from 210deg, #28231b 0 75%, #0c0b09 75% 100%);
    border: 1px solid #050403;
    box-shadow:
      inset 0 2px 4px rgba(255, 255, 255, 0.1),
      inset 0 -5px 8px rgba(0, 0, 0, 0.8),
      0 0 0 3px #342b20,
      0 0 0 4px rgba(245, 236, 222, 0.11),
      0 7px 15px rgba(0, 0, 0, 0.65);
  }

  :global(html[data-theme='arcade']) .macro-knob:hover {
    background:
      radial-gradient(circle at 50% 48%, #211d17 0 45%, #0b0908 46% 62%, transparent 63%),
      conic-gradient(from 210deg, #3a2f22 0 75%, #0f0d0a 75% 100%);
    border-color: var(--ga-coral-line, rgba(255, 111, 94, 0.5));
    box-shadow:
      inset 0 2px 4px rgba(255, 255, 255, 0.12),
      inset 0 -5px 8px rgba(0, 0, 0, 0.8),
      0 0 0 3px #3b2f22,
      0 0 0 4px var(--ga-coral-line, rgba(255, 111, 94, 0.5)),
      0 0 14px color-mix(in srgb, var(--ga-coral, #ff6f5e) 25%, transparent),
      0 7px 15px rgba(0, 0, 0, 0.65);
  }

  :global(html[data-theme='arcade']) .macro-knob::before {
    content: '';
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 38% 28%, rgba(255, 255, 255, 0.1), transparent 26%),
      linear-gradient(145deg, #242018, #0a0907 58%, #020202);
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.16),
      inset 0 -4px 7px rgba(0, 0, 0, 0.82);
  }

  :global(html[data-theme='arcade']) .macro-svg {
    opacity: 0.92;
    filter: drop-shadow(0 0 5px color-mix(in srgb, var(--macro-color) 35%, transparent));
    z-index: 1;
  }

  :global(html[data-theme='arcade']) .macro-svg path:first-child {
    stroke: rgba(245, 236, 222, 0.13);
  }

  :global(html[data-theme='arcade']) .macro-svg circle {
    opacity: 0;
  }

  :global(html[data-theme='arcade']) .macro-pointer {
    display: block;
    background: linear-gradient(180deg, #fff2d6, var(--ga-coral, #ff6f5e));
    box-shadow: 0 0 6px var(--ga-coral-glow, rgba(255, 111, 94, 0.5));
  }

  :global(html[data-theme='arcade']) .macro-name {
    color: rgba(238, 240, 244, 0.5);
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    letter-spacing: 0.04em;
  }

  :global(html[data-theme='arcade']) .macro-name:hover {
    color: var(--ga-coral, #ff6f5e);
    text-shadow: 0 0 7px var(--ga-coral-glow, rgba(255, 111, 94, 0.5));
  }

  :global(html[data-theme='arcade']) .macro-dest-count {
    background: var(--ga-coral, #ff6f5e);
    color: #231009;
    box-shadow: 0 0 8px var(--ga-coral-glow, rgba(255, 111, 94, 0.5));
  }

  :global(html[data-theme='arcade']) .macro-popover {
    background: var(--ga-faceplate-bg, #16140f);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 3px);
    box-shadow:
      inset 0 1px 0 var(--ga-metal-hi, rgba(255, 255, 255, 0.16)),
      0 20px 60px rgba(0, 0, 0, 0.66);
  }

  :global(html[data-theme='arcade']) .macro-fx-card.dragging,
  :global(html[data-theme='arcade']) .macro-fx-card.expanded,
  :global(html[data-theme='arcade']) .macro-fx-params,
  :global(html[data-theme='arcade']) .macro-popover-hint {
    background: var(--ga-coral-soft, rgba(255, 111, 94, 0.13)) !important;
    border-color: var(--ga-coral-line, rgba(255, 111, 94, 0.5)) !important;
  }

  :global(html[data-theme='arcade']) .macro-fx-expand.open,
  :global(html[data-theme='arcade']) .macro-popover-section-title,
  :global(html[data-theme='arcade']) .macro-popover-row strong,
  :global(html[data-theme='arcade']) .macro-dest-toggle {
    color: var(--ga-coral, #ff6f5e);
  }

  :global(html[data-theme='arcade']) .macro-fx-param-slider::-webkit-slider-thumb,
  :global(html[data-theme='arcade']) .macro-opacity-slider::-webkit-slider-thumb {
    background: var(--ga-coral, #ff6f5e);
  }

  :global(html[data-theme='arcade']) .macro-fx-param-slider::-moz-range-thumb,
  :global(html[data-theme='arcade']) .macro-opacity-slider::-moz-range-thumb {
    background: var(--ga-coral, #ff6f5e);
  }
</style>
