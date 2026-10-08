<script lang="ts">
  /** Effects tab, bottom half: everything about the selected effect. */
  import InteractiveParam from './InteractiveParam.svelte';
  import type { AutoConfig } from '../../types';
  import type { ParamModulation } from '../../audio/modulationControls';
  import type { InteractiveSurface } from '../../mobile/studio/interactive';
  import { effectParams, type EffectParam, type InteractiveEffect } from '../../mobile/studio/interactiveEffects';
  import { isEmitter } from '../../mobile/studio/editorActions';

  export let effect: InteractiveEffect | undefined = undefined;
  export let surfaces: InteractiveSurface[] = [];
  export let canMoveUp = false;
  export let canMoveDown = false;
  export let placingEmitter = false;
  /** Bound: whether the Advanced controls are open. */
  export let advanced = false;
  export let supportsCrossfader = false;
  /** Offer the keyframe button on each parameter. */
  export let keyframes = false;

  export let onmove: (delta: number) => void;
  export let onremove: () => void;
  /** A one-step change to the effect (emit target, emission). */
  export let onpatch: (patch: Partial<InteractiveEffect>) => void;
  /** Fire a manual burst now. */
  export let onburst: () => void;
  export let onplacing: () => void;
  /** A slider or Mod control is about to change: remember the scene for undo. */
  export let onstart: () => void;
  export let onvalue: (def: EffectParam, value: number) => void;
  export let onmod: (key: string, mod: ParamModulation | undefined) => void;
  export let onauto: (key: string, auto: AutoConfig | undefined) => void;
  export let onkeyframe: (def: EffectParam) => void = () => {};

  /** Shown first; everything else sits under Advanced controls. */
  const essentialKeys = [
    'opacity',
    'hue',
    'energy',
    'trails',
    'flow',
    'lifetime',
    'heat',
    'size',
    'viscosity',
    'lightPower',
    'spread',
    'haze',
  ];

  $: definitions = effect ? effectParams(effect.kind) : [];
  $: basicDefinitions = definitions.filter((d) => essentialKeys.includes(d.key)).slice(0, 7);
  $: advancedDefinitions = definitions.filter((d) => !basicDefinitions.includes(d));
  $: positionable = definitions.some((d) => d.key === 'x' || d.key === 'lightX');

  /** Pulse interval only applies to repeating bursts, burst duration to any burst. */
  const applies = (def: EffectParam, emission: InteractiveEffect['emission']) =>
    (def.key !== 'period' || emission === 'pulse') && (def.key !== 'duration' || emission !== 'continuous');
</script>

{#if effect}
  {@const current = effect}
  <div class="effect-detail">
    <div class="panel-heading">
      <strong>{current.name}</strong>
      <div class="mini-tools">
        <button onclick={() => onmove(-1)} disabled={!canMoveUp} aria-label="Move effect up">↑</button>
        <button onclick={() => onmove(1)} disabled={!canMoveDown} aria-label="Move effect down">↓</button>
        <button class="danger" onclick={onremove} aria-label="Remove effect">×</button>
      </div>
    </div>
    {#if isEmitter(current.kind)}
      <label>
        Emit from
        <select value={current.target} onchange={(e) => onpatch({ target: e.currentTarget.value })}>
          <option value="point">Position on canvas</option>
          {#each surfaces as s}<option value={s.id}>{s.name} · outline</option>{/each}
        </select>
      </label>
      <label>
        Emission
        <select
          value={current.emission}
          onchange={(e) => onpatch({ emission: e.currentTarget.value as InteractiveEffect['emission'] })}
        >
          <option value="continuous">Continuous flow</option>
          <option value="pulse">Repeating bursts</option>
          <option value="burst">Manual burst</option>
        </select>
      </label>
      {#if current.emission === 'burst'}
        <button class="wide live" onclick={onburst}>◉ Trigger burst</button>
      {/if}
    {/if}
    {#if positionable}
      <button class="wide" class:active={placingEmitter} onclick={onplacing}>
        {placingEmitter
          ? '✓ Done positioning'
          : current.kind === 'light'
            ? '◎ Position light on canvas'
            : '◎ Position emitter on canvas'}
      </button>
    {/if}
    {#each [{ defs: basicDefinitions, extra: false }, { defs: advancedDefinitions, extra: true }] as section}
      {#if section.extra}
        <button class="wide disclosure" aria-expanded={advanced} onclick={() => (advanced = !advanced)}>
          {advanced ? '−' : '＋'} Advanced controls <span>{section.defs.length}</span>
        </button>
      {:else}
        <div class="group-label">Look & motion</div>
      {/if}
      {#if !section.extra || advanced}
        {#each section.defs.filter((d) => applies(d, current.emission)) as def}
          <InteractiveParam
            {def}
            {onstart}
            value={current.params[def.key] ?? def.value}
            mod={current.mods[def.key]}
            onchange={(v) => onvalue(def, v)}
            onmod={(v) => onmod(def.key, v)}
            auto={current.paramAuto?.[def.key]}
            onauto={(v) => onauto(def.key, v)}
            {supportsCrossfader}
            onkeyframe={keyframes ? () => onkeyframe(def) : undefined}
          />
        {/each}
      {/if}
    {/each}
  </div>
{:else}
  <p class="empty">Add an effect to start building your scene.</p>
{/if}
