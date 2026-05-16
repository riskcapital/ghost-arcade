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
  import { modulationStore, registerEffectParamRange, registerEdgeEffectParamRange, type ModSource, type ParamModulation } from '../audio/modulation';
  import { tick } from 'svelte';

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
   *  Defaults to 'fx' so existing call sites don't need updates. */
  export let effectKind: 'fx' | 'edge' = 'fx';
  export let onChange: (v: number) => void = () => {};
  export let displayValue: ((v: number) => string) | undefined = undefined;

  // ---- Range registration so engine clamps modulated output ----
  // Routes to whichever registry matches the kind so engine reads
  // can find it under the same key it was stored with.
  $: if (effectKind === 'edge') {
    registerEdgeEffectParamRange(layerIndex, effectId, paramName, min, max);
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
  // Key shape differs by kind so the engine routes through the right
  // updater path. The store has separate setters but both write into
  // the same ModulationMap.
  $: modKey = effectKind === 'edge'
    ? `${layerIndex}:edge:${effectId}:${paramName}`
    : `${layerIndex}:fx:${effectId}:${paramName}`;
  $: existingMod = ($modulationStore.get(modKey) as ParamModulation | undefined);
  $: currentSource = existingMod?.source ?? 'manual';
  $: currentAmount = existingMod?.amount ?? 1.0;
  $: currentBpmSync = existingMod?.bpmSync ?? false;
  $: isModulated = currentSource !== 'manual';
  $: isLfo = currentSource.startsWith('lfo-');

  function writeMod(mod: ParamModulation) {
    if (effectKind === 'edge') {
      modulationStore.setEdgeEffectModulation(layerIndex, effectId, paramName, mod);
    } else {
      modulationStore.setEffectModulation(layerIndex, effectId, paramName, mod);
    }
  }
  function setSource(source: ModSource) {
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
  function setAmount(amount: number) {
    if (!existingMod || existingMod.source === 'manual') return;
    writeMod({ ...existingMod, amount });
  }
  function setBpmSync(bpmSync: boolean) {
    if (!existingMod || existingMod.source === 'manual') return;
    writeMod({ ...existingMod, bpmSync });
  }
</script>

<div class="epr" class:modulated={isModulated}>
  <!-- Row 1: label · source dropdown · value -->
  <div class="epr-head">
    <span class="epr-label">{label}</span>
    <select
      class="epr-source"
      class:active={isModulated}
      value={currentSource}
      title="Audio / LFO modulation source"
      onchange={(e) => setSource((e.target as HTMLSelectElement).value as ModSource)}
    >
      <optgroup label="Control"><option value="manual">Manual</option></optgroup>
      <optgroup label="Audio">
        <option value="sub">Sub</option>
        <option value="bass">Bass</option>
        <option value="lowMid">Low Mid</option>
        <option value="mid">Mid</option>
        <option value="highMid">Hi Mid</option>
        <option value="treble">Treble</option>
        <option value="air">Air</option>
        <option value="presence">Presence</option>
        <option value="high">High (legacy)</option>
        <option value="amplitude">Volume</option>
      </optgroup>
      <optgroup label="Onsets">
        <option value="kick">Kick</option>
        <option value="snare">Snare</option>
      </optgroup>
      <optgroup label="Sync"><option value="beatPhase">Beat</option></optgroup>
      <optgroup label="LFO">
        <option value="lfo-sine">Sine</option>
        <option value="lfo-saw">Saw</option>
        <option value="lfo-square">Square</option>
        <option value="lfo-tri">Triangle</option>
      </optgroup>
    </select>
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
      <button type="button" class="epr-value" title="Click to type a precise value" onclick={startEdit} ondblclick={startEdit}>
        {shown}
      </button>
    {/if}
  </div>

  <!-- Row 2: the actual param slider -->
  <input
    class="epr-slider"
    type="range"
    {min}
    {max}
    {step}
    {value}
    data-midi-path={effectKind === 'edge' ? `map:edge:${effectId}:${paramName}` : `map:effect:${effectId}:${paramName}`}
    data-midi-label={label}
    data-midi-min={min}
    data-midi-max={max}
    data-midi-step={step}
    oninput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
  />

  <!-- Row 3: depth (amount) — only shown when something is modulating.
       LFO sources also get a BPM-sync checkbox to the right of the depth
       value, which reinterprets `speed` as a beat-division multiplier
       instead of free-running Hz. -->
  {#if isModulated}
    <div class="epr-depth-row">
      <span class="epr-depth-label">Depth</span>
      <input
        class="epr-depth-slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={currentAmount}
        oninput={(e) => setAmount(parseFloat((e.target as HTMLInputElement).value))}
      />
      <span class="epr-depth-val">{(currentAmount * 100).toFixed(0)}%</span>
      {#if isLfo}
        <label class="epr-bpm-sync" title="Sync LFO to detected BPM. Speed becomes a beat-division multiplier (1 = one cycle per beat, 0.25 = one cycle per 4 beats, 4 = sixteenths).">
          <input
            type="checkbox"
            checked={currentBpmSync}
            onchange={(e) => setBpmSync((e.target as HTMLInputElement).checked)}
          />
          BPM
        </label>
      {/if}
    </div>
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

  /* Row 1: label · source · value */
  .epr-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .epr-label {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11px;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .epr-source {
    flex: 0 0 auto;
    background: #0f0f10;
    color: #888;
    border: 1px solid #444;
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 10px;
    max-width: 90px;
  }
  .epr-source.active {
    border-color: #ff00ff;
    color: #ff00ff;
    background: rgba(255, 0, 255, 0.05);
  }
  .epr-value {
    flex: 0 0 auto;
    min-width: 44px;
    background: transparent;
    border: 1px dashed transparent;
    color: #67e8f9;
    font: inherit;
    font-size: 11px;
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
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    padding: 1px 6px;
    border-radius: 3px;
    text-align: right;
    outline: none;
  }

  /* Row 2: param slider — full width */
  .epr-slider {
    width: 100%;
    accent-color: #67e8f9;
  }
  .epr.modulated .epr-slider {
    accent-color: #ff00ff;
  }

  /* Row 3: depth amount, only when modulated. Magenta to match the
     source dropdown so the two pieces of "this param is modulated"
     state read as one visual group. */
  .epr-depth-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 2px;
  }
  .epr-depth-label {
    flex: 0 0 auto;
    font-size: 10px;
    color: #ff00ff;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    min-width: 38px;
  }
  .epr-depth-slider {
    flex: 1 1 auto;
    accent-color: #ff00ff;
  }
  .epr-depth-val {
    flex: 0 0 auto;
    min-width: 36px;
    font-size: 10px;
    color: #ff00ff;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .epr-bpm-sync {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 9px;
    color: #ff00ff;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    padding-left: 4px;
    border-left: 1px solid rgba(255, 0, 255, 0.2);
    user-select: none;
  }
  .epr-bpm-sync input[type="checkbox"] {
    accent-color: #ff00ff;
    margin: 0;
    cursor: pointer;
  }
</style>
