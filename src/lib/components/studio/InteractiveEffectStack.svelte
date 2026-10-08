<script lang="ts">
  /** Effects tab, top half: the ordered effect stack and the control that adds to it. */
  import {
    EFFECT_KINDS,
    EFFECT_NAMES,
    MAX_INTERACTIVE_EFFECTS,
    type EffectKind,
    type InteractiveEffect,
  } from '../../mobile/studio/interactiveEffects';
  import type { InteractiveSurface } from '../../mobile/studio/interactive';
  import { effectSourceLabel } from '../../mobile/studio/editorActions';

  export let effects: InteractiveEffect[] = [];
  export let surfaces: InteractiveSurface[] = [];
  export let selectedEffect = '';

  export let onadd: (kind: EffectKind) => void;
  export let onselect: (id: string) => void;
  export let ontoggle: (id: string) => void;
  /** Move effect `from` to where effect `to` is. */
  export let onreorder: (from: string, to: string) => void;

  let effectToAdd = '';
  let dragEffect = '';

  function add() {
    if (!effectToAdd) return;
    onadd(effectToAdd as EffectKind);
    effectToAdd = '';
  }

  function drop(e: DragEvent, target: string) {
    e.preventDefault();
    if (!dragEffect) return;
    onreorder(dragEffect, target);
    dragEffect = '';
  }
</script>

<div class="panel-heading">
  <strong>Effect stack</strong><span>{effects.length}/{MAX_INTERACTIVE_EFFECTS}</span>
</div>
<select
  aria-label="Add visual effect"
  bind:value={effectToAdd}
  onchange={add}
  disabled={effects.length >= MAX_INTERACTIVE_EFFECTS}
>
  <option value="">＋ Add visual effect</option>
  {#each EFFECT_KINDS as kind}<option value={kind}>{EFFECT_NAMES[kind]}</option>{/each}
</select>
<p class="hint">Use ↑ ↓ to reorder. The last effect sits on top.</p>
<div class="effect-list">
  {#each effects as effect, i (effect.id)}
    <div
      class="effect-card"
      class:active={selectedEffect === effect.id}
      draggable="true"
      role="group"
      aria-label={`${effect.name} effect`}
      ondragstart={(e) => {
        dragEffect = effect.id;
        e.dataTransfer?.setData('text/plain', effect.id);
      }}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => drop(e, effect.id)}
    >
      <span class="grip" aria-hidden="true">⠿</span>
      <input
        type="checkbox"
        checked={effect.enabled}
        aria-label={`Enable ${effect.name}`}
        onchange={() => ontoggle(effect.id)}
      />
      <button class="effect-title" onclick={() => onselect(effect.id)} aria-expanded={selectedEffect === effect.id}>
        <span>{effect.name}</span>
        <small>{effectSourceLabel(effect, surfaces)}</small>
      </button>
      <span class="order">{i + 1}</span>
    </div>
  {/each}
</div>
