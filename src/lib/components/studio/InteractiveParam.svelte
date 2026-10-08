<script lang="ts">
  /** One effect parameter: label, value, slider, Mod button and (optionally) a keyframe button. */
  import ModTray, { modSourceLabel } from '../ModTray.svelte';
  import { DEFAULT_MOD, defaultModRange, type ParamModulation, type ModSource } from '../../audio/modulationControls';
  import type { AutoConfig } from '../../types';
  import type { EffectParam } from '../../mobile/studio/interactiveEffects';

  export let def: EffectParam;
  export let value: number;
  export let mod: ParamModulation | undefined = undefined;
  export let auto: AutoConfig | undefined = undefined;
  export let supportsCrossfader = true;

  /** The value is about to change: remember the scene for undo. */
  export let onstart: () => void = () => {};
  export let onchange: (value: number) => void;
  export let onmod: (value: ParamModulation | undefined) => void;
  export let onauto: (auto: AutoConfig | undefined) => void = () => {};
  export let onkeyframe: (() => void) | undefined = undefined;

  const paramId = crypto.randomUUID();
  const sliderKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

  let anchor: HTMLButtonElement;
  let open = false;

  $: inputId = `param-${paramId}-${def.key}`;
  $: activeSource = auto ? 'auto' : (mod?.source ?? 'manual');

  /** Mod tray picked a source: Manual, Auto, or an audio / LFO / beat source. */
  function source(s: ModSource) {
    if (s === 'auto') {
      onmod(undefined);
      onauto(
        auto ?? {
          phase: 0,
          mode: 'pingpong',
          speedHz: 0.15,
          min: def.min,
          max: def.max,
          playing: true,
          easing: 'sine',
        },
      );
      return;
    }
    onauto(undefined);
    onmod(
      s === 'manual'
        ? undefined
        : { ...DEFAULT_MOD, speed: 0.15, ...mod, ...(!mod ? defaultModRange(value, def.min, def.max) : {}), source: s },
    );
  }

  /** Slider moved by hand. A ranged modulation keeps the new value inside its range. */
  function manual(value: number) {
    onchange(value);
    if (mod?.rangeMin !== undefined && mod.rangeMax !== undefined) {
      const unit = (value - def.min) / (def.max - def.min);
      onmod({ ...mod, rangeMin: Math.max(0, Math.min(1, unit)), rangeMax: Math.max(unit, mod.rangeMax) });
    }
  }

  function autoBound(bound: 'min' | 'max', raw: string) {
    const v = +raw;
    if (auto && Number.isFinite(v)) onauto({ ...auto, [bound]: Math.max(def.min, Math.min(def.max, v)) });
  }
</script>

<div class="param">
  <div class="head">
    <label for={inputId}>{def.label}</label>
    <output>{value.toFixed(def.step === 1 ? 0 : 2)}</output>
    <button
      bind:this={anchor}
      class:assigned={!!auto || (!!mod && mod.source !== 'manual')}
      onclick={() => (open = !open)}
      aria-label={`Modulate ${def.label}`}
    >
      {modSourceLabel(activeSource, !!auto)}
    </button>
    {#if onkeyframe}
      <button onclick={onkeyframe} title="Add keyframe at playhead" aria-label={`Keyframe ${def.label}`}>◇</button>
    {/if}
  </div>
  <input
    id={inputId}
    aria-label={def.label}
    type="range"
    min={def.min}
    max={def.max}
    step={def.step}
    {value}
    onpointerdown={onstart}
    onkeydown={(e) => {
      if (sliderKeys.includes(e.key) && !e.repeat) onstart();
    }}
    oninput={(e) => manual(+e.currentTarget.value)}
  />
  {#if auto}
    <div class="auto-range">
      <label>
        From
        <input
          aria-label={`${def.label} Auto from`}
          type="number"
          onfocus={onstart}
          min={def.min}
          max={def.max}
          step={def.step}
          value={auto.min}
          onchange={(e) => autoBound('min', e.currentTarget.value)}
        />
      </label>
      <label>
        To
        <input
          aria-label={`${def.label} Auto to`}
          type="number"
          onfocus={onstart}
          min={def.min}
          max={def.max}
          step={def.step}
          value={auto.max}
          onchange={(e) => autoBound('max', e.currentTarget.value)}
        />
      </label>
    </div>
  {/if}
</div>
{#if open && anchor}
  <ModTray
    onInteractionStart={onstart}
    label={def.label}
    {anchor}
    source={activeSource}
    {mod}
    {auto}
    {supportsCrossfader}
    autoHint="Set From / To below the parameter to bound its sweep."
    supportsClipPosition={false}
    paramMin={def.min}
    paramMax={def.max}
    paramValue={value}
    onClose={() => (open = false)}
    onSetSource={source}
    onPatchMod={(p) => onmod({ ...DEFAULT_MOD, source: mod?.source ?? 'lfo-sine', ...mod, ...p })}
    onPatchAuto={(p) => {
      if (auto) onauto({ ...auto, ...p });
    }}
  />
{/if}

<style>
  .auto-range {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: #a4bac9;
  }
  .auto-range label {
    min-width: 0;
    flex: 1;
  }
  .auto-range input {
    box-sizing: border-box;
    width: 100%;
    height: 28px;
    color: inherit;
    background: var(--ga-slot, var(--ga-blue-800));
    border: 1px solid var(--ga-blue-mute-600);
    border-radius: 3px;
    padding: 4px;
  }
  .param {
    margin: 10px 0;
    min-width: 0;
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }
  .head label {
    flex: 1;
    font-size: 11px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .head output {
    font:
      10px ui-monospace,
      monospace;
    color: var(--ga-ink-2, #a8b6c4);
  }
  button {
    font-size: 10px;
    min-height: 28px;
    padding: 3px 8px;
    border: 1px solid var(--ga-line-2, var(--ga-blue-mute-600));
    background: var(--ga-slot, var(--ga-blue-900));
    color: inherit;
    border-radius: 4px;
  }
  .assigned {
    color: var(--ga-blue-200);
    border-color: var(--ga-blue-300);
  }
  input {
    width: 100%;
    height: 32px;
    touch-action: none;
    accent-color: var(--ga-accent, var(--ga-blue-mute-300));
    cursor: ew-resize;
    margin: 0;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--ga-blue-200);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    input {
      height: 44px;
    }
    button {
      min-height: 44px;
      min-width: 44px;
    }
    .auto-range input {
      height: 44px;
    }
  }
  :global(.handheld) .head button {
    min-height: 44px;
    min-width: 44px;
  }
  :global(.handheld) input {
    height: 44px;
  }
  :global(.handheld) .head label {
    font-size: 13px;
  }
  :global(.handheld) .head output {
    font-size: 11px;
  }
  :global(.handheld) .auto-range input {
    height: 44px;
  }
</style>
