<script lang="ts">
  /**
   * EffectParamRow — every effect parameter renders as a three-row
   * block matching the shader-param UI:
   *
   *   Row 1:  <label> ………… <source dropdown> ………… <value chip>
   *   Row 2:  ────────[ slider ]────────
   *   Row 3 (only when modulated):
   *           "Depth" ──[ magenta amount slider ]── 50%
   *
   * Click / double-click the value chip to type a precise number;
   * Enter commits, Esc reverts, slider snaps to the typed value.
   * The depth slider drives `modulation.amount` so users can dial in
   * how strongly the audio band pushes the param off its baseline.
   *
   * Modulation routing is registered with the engine via
   * `registerEffectParamRange` + `modulationStore.setEffectModulation`
   * keyed by (layerIndex, effectId, paramName) so the same wire works
   * in both editor and projector output windows (the engine ticks in
   * both via modulationBroadcast).
   */
  import { modulationStore, registerEffectParamRange, registerEdgeEffectParamRange, registerGPUParamRange, registerSplatParamRange, type ModSource, type ParamModulation } from '../audio/modulation';
  import { project, layers } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { defaultAutoFor } from '../audio/autoEngine';
  import type { AutoConfig } from '../types';
  import { onMount, tick } from 'svelte';
  import ModTray, { modSourceLabel } from './ModTray.svelte';
  import { t } from '../i18n';

  export let label: string;
  export let value: number;
  export let min: number = 0;
  export let max: number = 1;
  export let step: number = 0.01;
  export let layerIndex: number;
  export let effectId: string;
  /** For regular effects this is the flat key (e.g. `injectStrength`);
   *  for edge effects it's the dotted path (e.g. `stroke.width`). */
  export let paramName: string;
  /** Discriminates which modulation slot the row writes into:
   *    'fx'   — `layer.effects[].params[paramName]`  (default)
   *    'edge' — `layer.edgeEffects.effects[].<paramName>` (nested path)
   *    'gpu'  — `layer.gpuLayerContent.params[paramName]` (mapping-only)
   *    'splat' — `layer.splatContent[paramName]` (mapping-only)
   *  Defaults to 'fx' so existing call sites don't need updates. For
   *  'gpu' the `effectId` prop is unused (every GPU layer has exactly
   *  one shader at a time, so addressing is just layerIndex + paramKey). */
  export let effectKind: 'fx' | 'edge' | 'gpu' | 'splat' = 'fx';
  /** Which render graph this row writes to:
   *    'mapping' — project.layers (LayerPanel, EdgeEffectsPanel)
   *    'vj'      — vjClipLauncher.layerStates (VJ Mode performer panel)
   *  Auto + audio modulation routing branches on this so the same
   *  row component drives both paths without the caller having to
   *  pre-wire different stores. */
  export let target: 'mapping' | 'vj' = 'mapping';
  /** Bank for VJ target. Ignored when target='mapping'. */
  export let vjBank: 'A' | 'B' = 'A';
  export let onChange: (v: number) => void = () => {};
  export let displayValue: ((v: number) => string) | undefined = undefined;
  /** Render only the compact modulation button. This lets panels keep
   *  their established slider/value UI while sharing the exact same
   *  Manual / Audio / LFO / Beat / Auto routing used by shader params. */
  export let buttonOnly: boolean = false;

  let rootEl: HTMLDivElement | null = null;

  // SplatPanel already owns its established range input. In mapping mode,
  // buttonOnly replaces that input with this component's shader-style track
  // so Auto can draw its min/max slippers on the same slider. Do this
  // explicitly instead of relying on a cross-component :has() selector,
  // which is not reliable after Svelte scopes the packaged CSS.
  onMount(() => {
    if (!buttonOnly || !rootEl) return;
    const originalSlider = rootEl.previousElementSibling;
    if (!(originalSlider instanceof HTMLInputElement) || originalSlider.type !== 'range') return;

    const previousDisplay = originalSlider.style.display;
    originalSlider.style.display = 'none';
    return () => {
      originalSlider.style.display = previousDisplay;
    };
  });

  // ---- Range registration so engine clamps modulated output ----
  // Routes to whichever registry matches the kind so engine reads
  // can find it under the same key it was stored with.
  $: if (effectKind === 'edge') {
    registerEdgeEffectParamRange(layerIndex, effectId, paramName, min, max);
  } else if (effectKind === 'gpu') {
    registerGPUParamRange(layerIndex, paramName, min, max);
  } else if (effectKind === 'splat') {
    registerSplatParamRange(layerIndex, paramName, min, max);
  } else {
    registerEffectParamRange(layerIndex, effectId, paramName, min, max);
  }

  // ---- Click-to-type editor for the value chip ----
  let editing = false;
  let editEl: HTMLInputElement | null = null;
  let editBuffer = '';

  function decimalsFromStep(s: number): number {
    if (s >= 1) return 0;
    if (s >= 0.1) return 1;
    if (s >= 0.01) return 2;
    if (s >= 0.001) return 3;
    return 4;
  }
  $: shown = displayValue ? displayValue(value) : value.toFixed(decimalsFromStep(step));

  async function startEdit() {
    editBuffer = String(value);
    editing = true;
    await tick();
    editEl?.focus();
    editEl?.select();
  }
  function commit() {
    const parsed = parseFloat(editBuffer);
    if (!Number.isNaN(parsed)) onChange(Math.max(min, Math.min(max, parsed)));
    editing = false;
  }
  function cancel() { editing = false; }
  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }

  // ---- Modulation source + amount ----
  // Auto (per-param playhead) lives on the effect data itself —
  // `effect.paramAuto[paramName]` — handled by autoEngine.ts. Edge,
  // audio, and LFO sources still go through the modulationStore.
  // The two paths are mutually exclusive per param: picking Audio
  // clears any Auto sidecar; picking Auto clears the audio mod.
  //
  // Routing branches on `target`:
  //   - 'mapping' reads/writes project.layers (and uses 'map:' modKey prefix)
  //   - 'vj'      reads/writes vjClipLauncher.layerStates (uses bank-prefixed key)
  $: vjLauncherState = $vjClipLauncher;
  $: modKey = effectKind === 'edge'
    ? `map:${layerIndex}:edge:${effectId}:${paramName}`
    : effectKind === 'gpu'
      ? `map:${layerIndex}:gpu:${paramName}`
      : effectKind === 'splat'
        ? `map:${layerIndex}:splat:${paramName}`
      : target === 'vj'
        ? `${vjBank === 'B' ? 'B:' : ''}${layerIndex}:fx:${effectId}:${paramName}`
        : `map:${layerIndex}:fx:${effectId}:${paramName}`;
  $: existingMod = ($modulationStore.get(modKey) as ParamModulation | undefined);

  // Look up the live effect (mapping layer OR VJ layer state) so we
  // can read the paramAuto sidecar for the Auto UI state.
  $: currentMappingLayer = target === 'mapping' || effectKind === 'gpu' || effectKind === 'splat' ? $layers[layerIndex] : undefined;
  $: currentVjLayerState = target === 'vj' && effectKind !== 'gpu' && effectKind !== 'splat'
    ? (vjBank === 'B' ? vjLauncherState.bankBLayerStates : vjLauncherState.layerStates)[layerIndex]
    : undefined;
  $: currentEffect = effectKind === 'gpu' || effectKind === 'splat'
    ? null
    : target === 'vj'
      ? currentVjLayerState?.effects.find(e => e.id === effectId)
      : effectKind === 'edge'
        ? (currentMappingLayer?.edgeEffects?.effects.find(e => e.id === effectId) as any)
        : currentMappingLayer?.effects.find(e => e.id === effectId);
  // For gpu, the paramAuto sidecar lives on gpuLayerContent itself.
  $: existingAuto = effectKind === 'gpu'
    ? (currentMappingLayer?.gpuLayerContent?.paramAuto as Record<string, AutoConfig> | undefined)?.[paramName]
    : effectKind === 'splat'
      ? (currentMappingLayer?.splatContent?.paramAuto as Record<string, AutoConfig> | undefined)?.[paramName]
    : (currentEffect?.paramAuto as Record<string, AutoConfig> | undefined)?.[paramName];

  $: currentSource = existingAuto
    ? 'auto'
    : (existingMod?.source ?? 'manual');
  $: isAuto = currentSource === 'auto';
  $: isModulated = isAuto || (currentSource !== 'manual');

  function writeMod(mod: ParamModulation) {
    if (effectKind === 'edge') {
      modulationStore.setEdgeEffectModulation(layerIndex, effectId, paramName, mod, 'mapping');
    } else if (effectKind === 'gpu') {
      modulationStore.setGPUParamModulation(layerIndex, paramName, mod);
    } else if (effectKind === 'splat') {
      modulationStore.setSplatParamModulation(layerIndex, paramName, mod);
    } else if (target === 'vj') {
      modulationStore.setEffectModulation(layerIndex, effectId, paramName, mod, vjBank, 'vj');
    } else {
      modulationStore.setEffectModulation(layerIndex, effectId, paramName, mod, 'A', 'mapping');
    }
  }
  function writeAuto(auto: AutoConfig | null) {
    if (effectKind === 'edge') {
      // Edge effect — paramName is a dotted path like `stroke.width`.
      // The auto map keys by the same string so writes from this row
      // line up with reads in autoEngine + the existing edge updater.
      if (currentMappingLayer) {
        project.setEdgeEffectParamAuto(currentMappingLayer.id, effectId, paramName, auto);
      }
      return;
    }
    if (effectKind === 'gpu') {
      if (currentMappingLayer) {
        project.setGPULayerParamAuto(currentMappingLayer.id, paramName, auto);
      }
      return;
    }
    if (effectKind === 'splat') {
      if (currentMappingLayer) {
        project.setSplatParamAuto(currentMappingLayer.id, paramName, auto);
      }
      return;
    }
    if (target === 'vj') {
      vjClipLauncher.setLayerEffectParamAuto(layerIndex, effectId, paramName, auto, vjBank);
    } else if (currentMappingLayer) {
      project.setEffectParamAuto(currentMappingLayer.id, effectId, paramName, auto);
    }
  }
  function setSource(source: ModSource) {
    if (source === 'auto') {
      // Switching TO auto. Clear any audio modulation (mutually
      // exclusive) and seed a fresh AutoConfig spanning the param's
      // natural range.
      if (existingMod && existingMod.source !== 'manual') {
        writeMod({ source: 'manual', amount: 0, speed: 1, invert: false, bpmSync: false });
      }
      writeAuto(existingAuto ?? defaultAutoFor(min, max));
      return;
    }
    // Switching to anything else — clear the Auto sidecar first.
    if (existingAuto) writeAuto(null);
    if (source === 'manual') {
      writeMod({ source: 'manual', amount: 0, speed: 1, invert: false, bpmSync: false });
    } else {
      const amt = existingMod?.amount ?? 1.0;
      const spd = existingMod?.speed ?? 1.0;
      const inv = existingMod?.invert ?? false;
      const sync = existingMod?.bpmSync ?? false;
      writeMod({ source, amount: amt, speed: spd, invert: inv, bpmSync: sync });
    }
  }
  function setAutoField<K extends keyof AutoConfig>(field: K, value: AutoConfig[K]) {
    if (!existingAuto) return;
    writeAuto({ ...existingAuto, [field]: value });
  }

  // ---- Mod tray (anchored popover owning all modulation tuning) ----
  let trayOpen = false;
  let chipEl: HTMLButtonElement | null = null;
  function patchMod(patch: Partial<ParamModulation>) {
    if (!existingMod || existingMod.source === 'manual') return;
    writeMod({ ...existingMod, ...patch });
  }
  function patchAuto(patch: Partial<AutoConfig>) {
    if (!existingAuto) return;
    writeAuto({ ...existingAuto, ...patch });
  }
</script>

<div bind:this={rootEl} class="epr" class:modulated={isModulated} class:button-only={buttonOnly}>
  {#if buttonOnly}
    <div class="epr-compact-track">
      <div class="epr-track-wrap">
        <input
          class="epr-slider"
          type="range"
          {min}
          {max}
          {step}
          {value}
          data-midi-path={effectKind === 'edge' ? `map:edge:${effectId}:${paramName}` : effectKind === 'gpu' ? `map:gpu:${paramName}` : effectKind === 'splat' ? `map:splat:${paramName}` : `map:effect:${effectId}:${paramName}`}
          data-midi-label={label}
          data-midi-min={min}
          data-midi-max={max}
          data-midi-step={step}
          oninput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
        />
        {#if isAuto && existingAuto}
          {@const _rSpan = (max - min) || 1}
          {@const _aMin = existingAuto.min}
          {@const _aMax = existingAuto.max}
          {@const _aMinFrac = (_aMin - min) / _rSpan}
          {@const _aMaxFrac = (_aMax - min) / _rSpan}
          <div class="epr-slipper-fill" style="left: {_aMinFrac * 100}%; right: {(1 - _aMaxFrac) * 100}%"></div>
          <input type="range" min={min} max={max} step={_rSpan / 200} value={_aMin}
            class="epr-slipper epr-slipper-min"
            aria-label={`${label} ${$t('effects.param.autoMinimum')}`}
            oninput={(e) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              setAutoField('min', Math.min(v, _aMax - _rSpan * 0.02));
            }} />
          <input type="range" min={min} max={max} step={_rSpan / 200} value={_aMax}
            class="epr-slipper epr-slipper-max"
            aria-label={`${label} ${$t('effects.param.autoMaximum')}`}
            oninput={(e) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              setAutoField('max', Math.max(v, _aMin + _rSpan * 0.02));
            }} />
        {/if}
      </div>
      <button
        bind:this={chipEl}
        type="button"
        class="epr-source"
        class:active={isModulated}
        class:open={trayOpen}
        title={$t('effects.param.modulationTitle')}
        onclick={() => trayOpen = !trayOpen}
      >{modSourceLabel(currentSource, isAuto)}</button>
    </div>
  {:else}
    <!-- Row 1: label · source dropdown · value -->
    <div class="epr-head">
      <span class="epr-label" title={label}>{label}</span>
      <button
        bind:this={chipEl}
        type="button"
        class="epr-source"
        class:active={isModulated}
        class:open={trayOpen}
        title={$t('effects.param.modulationTitle')}
        onclick={() => trayOpen = !trayOpen}
      >{modSourceLabel(currentSource, isAuto)}</button>
      {#if editing}
        <input
          bind:this={editEl}
          bind:value={editBuffer}
          class="epr-edit"
          type="text"
          inputmode="decimal"
          onblur={commit}
          onkeydown={onEditKey}
        />
      {:else}
        <button type="button" class="epr-value" title={$t('effects.param.preciseValueTitle')} onclick={startEdit} ondblclick={startEdit}>
          {shown}
        </button>
      {/if}
    </div>

    <!-- Row 2: the actual param slider (+ optional Auto-mode slippers
         overlaid on the same track when source='auto'). -->
    <div class="epr-track-wrap">
      <input
        class="epr-slider"
        type="range"
        {min}
        {max}
        {step}
        {value}
        data-midi-path={effectKind === 'edge' ? `map:edge:${effectId}:${paramName}` : effectKind === 'gpu' ? `map:gpu:${paramName}` : effectKind === 'splat' ? `map:splat:${paramName}` : `map:effect:${effectId}:${paramName}`}
        data-midi-label={label}
        data-midi-min={min}
        data-midi-max={max}
        data-midi-step={step}
        oninput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
      />
      <!-- Slippers — two range inputs overlaid on the main slider so
           their 0..1 axis lines up 1:1 with min..max above. Same
           pattern as the shader-params overlay; cyan thumbs + a faint
           fill band between them mark the active sweep sub-range. -->
      {#if isAuto && existingAuto}
        {@const _rSpan = (max - min) || 1}
        {@const _aMin = existingAuto.min}
        {@const _aMax = existingAuto.max}
        {@const _aMinFrac = (_aMin - min) / _rSpan}
        {@const _aMaxFrac = (_aMax - min) / _rSpan}
        <div class="epr-slipper-fill" style="left: {_aMinFrac * 100}%; right: {(1 - _aMaxFrac) * 100}%"></div>
        <input type="range" min={min} max={max} step={_rSpan / 200} value={_aMin}
          class="epr-slipper epr-slipper-min"
          oninput={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            setAutoField('min', Math.min(v, _aMax - _rSpan * 0.02));
          }} />
        <input type="range" min={min} max={max} step={_rSpan / 200} value={_aMax}
          class="epr-slipper epr-slipper-max"
          oninput={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            setAutoField('max', Math.max(v, _aMin + _rSpan * 0.02));
          }} />
      {/if}
    </div>
  {/if}

  <!-- All modulation tuning (depth, invert, LFO speed / BPM-sync
       rate, auto transport) lives in the ModTray popover — keeps the
       row to label + slider, nothing jammed underneath. The auto
       range slippers stay on the main track above since they map
       1:1 onto the param's pixels. -->
  {#if trayOpen && chipEl}
    <ModTray
      {label}
      anchor={chipEl}
      source={currentSource === 'auto' ? 'manual' : currentSource as ModSource}
      mod={existingMod}
      auto={existingAuto}
      onClose={() => trayOpen = false}
      onSetSource={setSource}
      onPatchMod={patchMod}
      onPatchAuto={patchAuto}
    />
  {/if}
</div>

<style>
  .epr {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .epr:last-child { border-bottom: none; }
  .epr.button-only {
    flex: 1 1 auto;
    display: flex;
    min-width: 0;
    padding: 0;
    border-bottom: 0;
    gap: 0;
  }
  .epr-compact-track {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-width: 0;
  }
  .epr-compact-track .epr-track-wrap {
    flex: 1 1 auto;
    min-width: 0;
  }
  .epr.button-only .epr-source {
    min-width: 44px;
  }

  /* Row 1: label · source · value */
  .epr-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .epr-label {
    /* min-width keeps labels readable on narrow panels (VJ Mode's
       effects column is tight). Was min-width:0 which let the
       label shrink to 2–3 chars when the dropdown grew. The
       dropdown got narrower at the same time so this trade-off
       leaves the slider track full width. */
    flex: 1 1 auto;
    min-width: 70px;
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .epr-source {
    flex: 0 0 auto;
    background: #0f0f10;
    color: var(--text-muted, #888);
    border: 1px solid #444;
    border-radius: 3px;
    padding: 1px 7px;
    font-size: 11px;
    max-width: 76px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .epr-source:hover {
    border-color: #888;
    color: #ccc;
  }
  .epr-source.active {
    border-color: #ff00ff;
    color: #ff00ff;
    background: rgba(255, 0, 255, 0.05);
  }
  .epr-source.open {
    border-color: #ff00ff;
    box-shadow: 0 0 0 1px rgba(255, 0, 255, 0.3);
  }
  .epr-value {
    flex: 0 0 auto;
    min-width: 44px;
    background: transparent;
    border: 1px dashed transparent;
    color: #67e8f9;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    cursor: text;
    padding: 1px 6px;
    border-radius: 3px;
    text-align: right;
  }
  .epr-value:hover {
    background: rgba(103, 232, 249, 0.08);
    border-color: rgba(103, 232, 249, 0.35);
  }
  .epr-edit {
    flex: 0 0 auto;
    width: 56px;
    background: #0f1219;
    border: 1px solid #67e8f9;
    color: #e0e7ef;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    padding: 1px 6px;
    border-radius: 3px;
    text-align: right;
    outline: none;
  }

  /* Row 2: param slider — full width */
  .epr-track-wrap {
    position: relative;
    /* Extra vertical room so the cyan slipper thumbs (18px tall)
       have space above/below the slider line. */
    min-height: 18px;
    display: flex;
    align-items: center;
  }
  .epr-slider {
    width: 100%;
    accent-color: #67e8f9;
  }
  .epr.modulated .epr-slider {
    accent-color: #ff00ff;
  }

  /* ─── Auto-mode slippers (overlay on main slider) ─── */
  /* Two range inputs absolutely positioned over the main slider so
     the slipper thumb positions line up 1:1 with the slider's
     min..max. Track invisible; only the cyan thumbs visible. */
  .epr-slipper {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    pointer-events: none;
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
  .epr-slipper::-webkit-slider-runnable-track { background: transparent; height: 100%; }
  .epr-slipper::-moz-range-track             { background: transparent; height: 100%; }
  .epr-slipper::-webkit-slider-thumb {
    -webkit-appearance: none !important;
    pointer-events: auto !important;
    cursor: ew-resize !important;
    width: 6px !important;
    height: 18px !important;
    margin-top: 0 !important;
    border-radius: 2px !important;
    background: #5ce1e6 !important;
    box-shadow: 0 0 4px rgba(92, 225, 230, 0.5) !important;
    border: none !important;
  }
  .epr-slipper::-moz-range-thumb {
    pointer-events: auto !important;
    cursor: ew-resize !important;
    width: 6px !important;
    height: 18px !important;
    border-radius: 2px !important;
    background: #5ce1e6 !important;
    box-shadow: 0 0 4px rgba(92, 225, 230, 0.5) !important;
    border: none !important;
  }
  .epr-slipper-fill {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: 6px;
    background: rgba(92, 225, 230, 0.18);
    border-top: 1px solid rgba(92, 225, 230, 0.4);
    border-bottom: 1px solid rgba(92, 225, 230, 0.4);
    pointer-events: none;
    z-index: 1;
  }

  /* Depth / LFO speed / BPM-sync / auto transport all moved into the
     ModTray popover — see ModTray.svelte. */
</style>
