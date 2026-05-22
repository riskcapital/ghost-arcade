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
  import { modulationStore, registerEffectParamRange, registerEdgeEffectParamRange, DEFAULT_MOD, type ModSource, type ParamModulation } from '../audio/modulation';
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
  // EffectParamRow is used in mapping-mode panels (LayerPanel +
  // EdgeEffectsPanel) so all keys are namespaced with `map:` —
  // matches the engine's target-aware routing which uses the key
  // prefix to decide whether to write through the VJ deck path or
  // the mapping `_mappingEffectUpdater` callback. Before this
  // namespace was added, effect mods routed as VJ regardless and
  // never updated mapping layers' effect params.
  $: modKey = effectKind === 'edge'
    ? `map:${layerIndex}:edge:${effectId}:${paramName}`
    : `map:${layerIndex}:fx:${effectId}:${paramName}`;
  $: existingMod = ($modulationStore.get(modKey) as ParamModulation | undefined);
  $: currentSource = existingMod?.source ?? 'manual';
  $: currentAmount = existingMod?.amount ?? 1.0;
  $: currentBpmSync = existingMod?.bpmSync ?? false;
  $: isModulated = currentSource !== 'manual';
  $: isLfo = currentSource.startsWith('lfo-');
  $: isAuto = currentSource === 'auto';

  function writeMod(mod: ParamModulation) {
    // Always write under the mapping namespace — see modKey above.
    if (effectKind === 'edge') {
      modulationStore.setEdgeEffectModulation(layerIndex, effectId, paramName, mod, 'mapping');
    } else {
      modulationStore.setEffectModulation(layerIndex, effectId, paramName, mod, 'A', 'mapping');
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
      // For 'auto' source, seed the playhead fields from DEFAULT_MOD
      // so the engine ticks correctly on first frame. autoPlaying
      // is FORCED to true (user just picked Auto, they want it
      // playing — same fix the shader-param path uses).
      if (source === 'auto') {
        writeMod({
          source, amount: amt, speed: spd, invert: inv, bpmSync: sync,
          autoPhase: 0,
          autoMode: existingMod?.autoMode ?? DEFAULT_MOD.autoMode,
          autoSpeedHz: existingMod?.autoSpeedHz ?? DEFAULT_MOD.autoSpeedHz,
          autoMin: existingMod?.autoMin ?? DEFAULT_MOD.autoMin,
          autoMax: existingMod?.autoMax ?? DEFAULT_MOD.autoMax,
          autoPlaying: true,
        });
      } else {
        writeMod({ source, amount: amt, speed: spd, invert: inv, bpmSync: sync });
      }
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
  function setAutoField<K extends keyof ParamModulation>(field: K, value: ParamModulation[K]) {
    if (!existingMod) return;
    writeMod({ ...existingMod, [field]: value });
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
      <optgroup label="Auto"><option value="auto">Auto (playhead)</option></optgroup>
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
      data-midi-path={effectKind === 'edge' ? `map:edge:${effectId}:${paramName}` : `map:effect:${effectId}:${paramName}`}
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
    {#if isAuto}
      {@const _amin = existingMod?.autoMin ?? 0}
      {@const _amax = existingMod?.autoMax ?? 1}
      {@const _rSpan = (max - min) || 1}
      {@const _aminAbs = min + _amin * _rSpan}
      {@const _amaxAbs = min + _amax * _rSpan}
      <div class="epr-slipper-fill" style="left: {_amin * 100}%; right: {(1 - _amax) * 100}%"></div>
      <input type="range" min={min} max={max} step={_rSpan / 200} value={_aminAbs}
        class="epr-slipper epr-slipper-min"
        oninput={(e) => {
          const v = parseFloat((e.target as HTMLInputElement).value);
          const frac = (v - min) / _rSpan;
          setAutoField('autoMin', Math.min(frac, _amax - 0.02));
        }} />
      <input type="range" min={min} max={max} step={_rSpan / 200} value={_amaxAbs}
        class="epr-slipper epr-slipper-max"
        oninput={(e) => {
          const v = parseFloat((e.target as HTMLInputElement).value);
          const frac = (v - min) / _rSpan;
          setAutoField('autoMax', Math.max(frac, _amin + 0.02));
        }} />
    {/if}
  </div>

  <!-- Row 3: depth (amount) — for AUDIO / LFO sources. The auto
       source has its own controls below; depth doesn't apply there
       (raw value comes straight from autoMin..autoMax). -->
  {#if isModulated && !isAuto}
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

  <!-- Row 3 (auto): playhead controls — play/pause + loop/pingpong
       + speed. Range slippers live on the main slider track above
       so the autoMin..autoMax visually aligns with the param's
       actual range; this row just has the transport + speed dial. -->
  {#if isAuto}
    <div class="epr-auto-controls">
      <div class="epr-auto-row">
        <button class="epr-auto-play" class:playing={existingMod?.autoPlaying !== false}
          onclick={() => setAutoField('autoPlaying', existingMod?.autoPlaying === false)}
          title={existingMod?.autoPlaying === false ? 'Resume' : 'Pause'}
        >{existingMod?.autoPlaying === false ? '▶' : '❚❚'}</button>
        <div class="epr-auto-mode">
          <button class:active={(existingMod?.autoMode ?? 'loop') === 'loop'}
            onclick={() => setAutoField('autoMode', 'loop')}>Loop</button>
          <button class:active={existingMod?.autoMode === 'pingpong'}
            onclick={() => setAutoField('autoMode', 'pingpong')}>Ping-pong</button>
        </div>
      </div>
      <div class="epr-auto-row epr-auto-speed">
        <span class="epr-auto-label">Speed</span>
        <input type="range" min="0.01" max="1" step="0.005"
          value={existingMod?.autoSpeedHz ?? 0.15}
          oninput={(e) => setAutoField('autoSpeedHz', parseFloat((e.target as HTMLInputElement).value))}
          class="epr-auto-speed-slider" />
        <span class="epr-auto-val">{(existingMod?.autoSpeedHz ?? 0.15).toFixed(2)}Hz</span>
      </div>
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
    -webkit-appearance: none;
    pointer-events: auto;
    cursor: ew-resize;
    width: 6px;
    height: 18px;
    border-radius: 2px;
    background: #5ce1e6;
    box-shadow: 0 0 4px rgba(92, 225, 230, 0.5);
    border: none;
  }
  .epr-slipper::-moz-range-thumb {
    pointer-events: auto;
    cursor: ew-resize;
    width: 6px;
    height: 18px;
    border-radius: 2px;
    background: #5ce1e6;
    box-shadow: 0 0 4px rgba(92, 225, 230, 0.5);
    border: none;
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

  /* ─── Auto controls card (transport + speed) ─── */
  .epr-auto-controls {
    margin-top: 2px;
    padding: 5px 7px;
    background: rgba(120, 215, 220, 0.06);
    border-left: 2px solid #5ce1e6;
    border-radius: 0 4px 4px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .epr-auto-row { display: flex; align-items: center; gap: 6px; font-size: 10px; }
  .epr-auto-speed input[type='range'] { flex: 1; }
  .epr-auto-label { color: rgba(255,255,255,0.55); width: 38px; flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.4px; }
  .epr-auto-val { color: #5ce1e6; font-variant-numeric: tabular-nums; font-size: 10px; min-width: 48px; text-align: right; }
  .epr-auto-play {
    width: 22px; height: 22px; border-radius: 4px;
    background: transparent; border: 1px solid rgba(255,255,255,0.18);
    color: #ccc; font-size: 9px; cursor: pointer;
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  }
  .epr-auto-play.playing { background: rgba(92,225,230,0.18); border-color: #5ce1e6; color: #5ce1e6; }
  .epr-auto-mode { display: flex; border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden; }
  .epr-auto-mode button { background: transparent; border: none; padding: 2px 7px; font-size: 10px; color: rgba(255,255,255,0.5); cursor: pointer; }
  .epr-auto-mode button.active { background: rgba(92,225,230,0.18); color: #5ce1e6; }
  .epr-auto-speed-slider { accent-color: #5ce1e6; height: 3px; }

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
