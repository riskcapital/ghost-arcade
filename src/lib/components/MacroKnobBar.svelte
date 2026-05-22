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
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
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
    const startAngle = -225;        // degrees (bottom-left)
    const endAngle = startAngle + sweepDeg;
    const cx = radius + 2;
    const cy = radius + 2;
    const sx = cx + radius * Math.cos(startAngle * Math.PI / 180);
    const sy = cy + radius * Math.sin(startAngle * Math.PI / 180);
    const ex = cx + radius * Math.cos(endAngle * Math.PI / 180);
    const ey = cy + radius * Math.sin(endAngle * Math.PI / 180);
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
    {@const enabledFxCount = m.effects.filter(e => e.enabled).length}
    <div
      class="macro-slot"
      title="{m.name} — {enabledFxCount}/{fxCount} effect{fxCount === 1 ? '' : 's'} · drag vertically · right-click to edit"
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
        data-midi-path="vj:macro:{m.id.replace('macro-','')}:value"
        data-midi-label="Macro {m.name}"
        data-midi-min="0"
        data-midi-max="1"
        data-midi-step="0.001"
      >
        <svg width="34" height="34" viewBox="0 0 34 34" class="macro-svg">
          <!-- Background ring -->
          <path d={arcPath(1, 14)} fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3" stroke-linecap="round" />
          <!-- Value arc -->
          {#if m.value > 0.001}
            <path d={arcPath(m.value, 14)} fill="none" stroke="var(--macro-color)" stroke-width="3" stroke-linecap="round" />
          {/if}
          <!-- Center pip indicator -->
          <circle cx="17" cy="17" r="2" fill="var(--macro-color)" opacity={0.4 + m.value * 0.6} />
        </svg>
        {#if fxCount > 0}
          <span class="macro-dest-count" style="--macro-color: {m.color}" title="{enabledFxCount} of {fxCount} effects enabled">{fxCount}</span>
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
            else if (e.key === 'Escape') { renamingId = null; }
          }}
        />
      {:else}
        <button class="macro-name" ondblclick={() => startRename(m)} title="Double-click to rename">
          {m.name}
        </button>
      {/if}
    </div>
  {/each}
</div>

{#if editPopoverFor}
  {@const m = $macros.macros.find(x => x.id === editPopoverFor)}
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
          title="Knob color"
        />
        <button class="macro-popover-close" onclick={closePopover} title="Close">×</button>
      </div>

      <!-- Beat-pulse: auto-cycle the macro value at a beat division.
           Uses the master BPM (manual tap > MIDI clock > audio-detect).
           Off = manual control only. -->
      <div class="macro-popover-section">
        <div class="macro-popover-section-title">AUTO PULSE</div>
        <div class="macro-popover-row macro-pulse-row">
          <select class="macro-pulse-mode"
            value={m.pulseMode ?? 'off'}
            onchange={(e) => macros.setPulseMode(m.id, (e.target as HTMLSelectElement).value as any)}
            title="Cycle the macro value automatically at this beat division">
            <option value="off">Off (manual)</option>
            <option value="1/4">1/4</option>
            <option value="1/2">1/2</option>
            <option value="1bar">1 bar</option>
            <option value="2bar">2 bars</option>
            <option value="4bar">4 bars</option>
          </select>
          <select class="macro-pulse-shape"
            value={m.pulseShape ?? 'sine'}
            disabled={(m.pulseMode ?? 'off') === 'off'}
            onchange={(e) => macros.setPulseShape(m.id, (e.target as HTMLSelectElement).value as any)}
            title="Waveform shape during the cycle">
            <option value="sine">∿ Sine</option>
            <option value="tri">△ Tri</option>
            <option value="saw-up">↗ Saw up</option>
            <option value="saw-down">↘ Saw down</option>
            <option value="square">▁▔ Square</option>
            <option value="pulse">⟂ Pulse</option>
          </select>
        </div>
        {#if (m.pulseMode ?? 'off') !== 'off'}
          <div class="macro-popover-hint" style="border-left-color: {m.color}; background: rgba(187, 134, 252, 0.06);">
            Cycling at <strong>{m.pulseMode}</strong> on the master BPM. The knob ring shows
            live phase — you can still drag it manually to nudge the cycle.
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
          <span class="macro-popover-section-title">EFFECT BUNDLE ({m.effects.length})</span>
          <div class="macro-popover-fx-actions">
            {#if m.effects.length > 0}
              <button class="macro-action-btn macro-action-danger"
                onclick={() => { if (confirm(`Clear all effects from ${m.name}?`)) macros.clearEffects(m.id); }}
                title="Remove all effects from this macro">
                Clear
              </button>
            {/if}
            <button class="macro-action-btn"
              onclick={() => { effectPickerForMacro = m.id; showEffectPicker = true; }}
              title="Open the effect picker to add a new effect to this macro's bundle">
              + Add Effect
            </button>
          </div>
        </div>
        {#if m.effects.length === 0}
          <div class="macro-popover-empty">
            No effects yet — click <strong>+ Add Effect</strong> to build the bundle.
            The knob will then act as a wet/dry mix for everything you add.
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
                    title="Drag to reorder"
                    draggable="true"
                    ondragstart={(e) => {
                      dragEffectIdx = fxIdx;
                      e.dataTransfer?.setData('text/plain', String(fxIdx));
                      e.dataTransfer!.effectAllowed = 'move';
                    }}
                  >⋮⋮</span>
                  <button class="macro-dest-toggle"
                    title={fx.enabled ? 'Bypass this effect' : 'Enable this effect'}
                    onclick={() => macros.toggleEffect(m.id, fx.id)}>
                    {fx.enabled ? '●' : '○'}
                  </button>
                  <button
                    class="macro-fx-expand"
                    class:open={isExpanded}
                    title={isExpanded ? 'Collapse params' : 'Expand to edit params'}
                    onclick={() => expandedFxId = isExpanded ? null : fx.id}
                  >▶</button>
                  <button
                    class="macro-fx-meta"
                    title="Click to {isExpanded ? 'collapse' : 'expand'} parameters"
                    onclick={() => expandedFxId = isExpanded ? null : fx.id}
                  >
                    <div class="macro-fx-label">{EFFECT_LABEL_BY_TYPE[fx.type] ?? fx.type}</div>
                    <div class="macro-fx-sub">
                      opacity {Math.round((fx.opacity ?? 1) * 100)}%
                      {#if paramMetas.length > 0} · {paramMetas.length} param{paramMetas.length === 1 ? '' : 's'}{/if}
                    </div>
                  </button>
                  <input
                    class="macro-fx-opacity"
                    type="range"
                    min="0" max="1" step="0.01"
                    value={fx.opacity ?? 1}
                    oninput={(e) => macros.updateEffectMeta(m.id, fx.id, { opacity: parseFloat((e.target as HTMLInputElement).value) })}
                    title="Per-effect opacity (the macro knob then scales the whole bundle by its wet/dry value)"
                  />
                  <button class="macro-dest-remove"
                    title="Remove this effect from the bundle"
                    onclick={() => macros.removeEffect(m.id, fx.id)}>×</button>
                </div>

                {#if isExpanded}
                  <div class="macro-fx-params">
                    {#if paramMetas.length === 0}
                      <div class="macro-fx-params-empty">
                        This effect has no editable parameters — just toggle on/off
                        and tune its opacity above.
                      </div>
                    {:else}
                      {#each paramMetas as { key, meta } (key)}
                        {@const value = getParamValue(fx, key, meta.default)}
                        {#if meta.type === 'select' && meta.options}
                          <div class="macro-fx-param">
                            <label class="macro-fx-param-label" for="mfx-{fx.id}-{key}">{meta.label}</label>
                            <select
                              id="mfx-{fx.id}-{key}"
                              class="macro-fx-param-select"
                              value={value}
                              onchange={(e) => macros.updateEffectParams(m.id, fx.id, { [key]: parseFloat((e.target as HTMLSelectElement).value) } as Partial<EffectParams>)}
                            >
                              {#each meta.options as opt}
                                <option value={opt.value}>{opt.label}</option>
                              {/each}
                            </select>
                          </div>
                        {:else}
                          <div class="macro-fx-param">
                            <label class="macro-fx-param-label" for="mfx-{fx.id}-{key}">{meta.label}</label>
                            <input
                              id="mfx-{fx.id}-{key}"
                              class="macro-fx-param-slider"
                              type="range"
                              min={meta.min} max={meta.max} step={meta.step}
                              {value}
                              oninput={(e) => macros.updateEffectParams(m.id, fx.id, { [key]: parseFloat((e.target as HTMLInputElement).value) } as Partial<EffectParams>)}
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
  onClose={() => { showEffectPicker = false; effectPickerForMacro = null; }}
/>

<style>
  .macro-bar {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
  }

  .macro-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .macro-slot.learning .macro-knob {
    box-shadow: 0 0 0 2px rgba(187, 134, 252, 0.6), 0 0 14px rgba(187, 134, 252, 0.45);
  }

  .macro-knob {
    position: relative;
    width: 36px;
    height: 36px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 50%;
    cursor: ns-resize;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, border-color 0.12s;
    touch-action: none;
  }
  .macro-knob:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .macro-svg {
    pointer-events: none;
  }

  .macro-dest-count {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    background: var(--macro-color);
    color: #000;
    font-size: 9px;
    font-weight: 800;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .macro-name {
    background: none;
    border: none;
    color: #888;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 0 2px;
    cursor: pointer;
    max-width: 50px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-name:hover { color: #ccc; }

  .macro-name-input {
    width: 50px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: 8px;
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
    font-size: 12px;
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
    color: #aaa;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .macro-popover-close:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }

  .macro-popover-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .macro-popover-section-title {
    font-size: 9px;
    font-weight: 700;
    color: #888;
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
  .macro-popover-actions { gap: 8px; }

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
    color: #888;
    cursor: pointer;
    font-size: 9px;
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
    color: #BB86FC;
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
  .macro-fx-params-empty {
    font-size: 10px;
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
    font-size: 10px;
    color: #ccc;
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
    background: #BB86FC;
    cursor: pointer;
  }
  .macro-fx-param-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #BB86FC;
    border: none;
    cursor: pointer;
  }
  .macro-fx-param-value {
    font-size: 10px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    color: #BB86FC;
    text-align: right;
    user-select: none;
  }
  .macro-fx-param-select {
    grid-column: 2 / 4;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #ddd;
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .macro-fx-handle {
    cursor: grab;
    color: #555;
    font-size: 12px;
    line-height: 1;
    padding: 0 2px;
    user-select: none;
  }
  .macro-fx-handle:active { cursor: grabbing; }
  .macro-fx-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .macro-fx-label {
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-fx-sub {
    font-size: 9px;
    color: #777;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-fx-opacity {
    width: 80px;
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
    background: #BB86FC;
    cursor: pointer;
  }
  .macro-fx-opacity::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #BB86FC;
    border: none;
    cursor: pointer;
  }

  .macro-action-btn {
    background: rgba(255, 133, 119, 0.1);
    border: 1px solid rgba(255, 133, 119, 0.4);
    color: #FF8577;
    font-size: 10px;
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
    background: #FF8577;
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
    color: #ddd;
    font-size: 11px;
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
    border-left: 2px solid #BB86FC;
    padding: 6px 8px;
    font-size: 10px;
    color: #ccc;
    line-height: 1.45;
  }

  .macro-popover-empty {
    font-size: 10px;
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
    color: #BB86FC;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
  }

  .macro-dest-meta {
    overflow: hidden;
  }
  .macro-dest-label {
    font-size: 11px;
    color: #ddd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .macro-dest-path {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 9px;
    color: #666;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .macro-dest-curve {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #ccc;
    border-radius: 3px;
    font-size: 11px;
    padding: 2px;
    cursor: pointer;
  }
  .macro-dest-min, .macro-dest-max {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #ccc;
    font-size: 10px;
    padding: 2px 4px;
    border-radius: 3px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }
  .macro-dest-remove {
    background: none;
    border: none;
    color: #888;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }
  .macro-dest-remove:hover { color: #ff6b6b; }
</style>
