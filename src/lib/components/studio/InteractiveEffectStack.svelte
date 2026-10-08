<script lang="ts">
  /** Effects tab, top half: the ordered effect stack and the control that adds to it. */
  import { tick } from 'svelte';
  import Icon from './StudioIcon.svelte';
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

  let dragEffect = '';
  let menuOpen = false;
  let addButton: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;

  $: full = effects.length >= MAX_INTERACTIVE_EFFECTS;
  $: if (full) menuOpen = false;

  const items = () => [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])];

  async function toggleMenu() {
    menuOpen = !menuOpen;
    if (!menuOpen) return;
    await tick();
    items()[0]?.focus({ preventScroll: false });
  }
  function closeMenu(refocus = true) {
    if (!menuOpen) return;
    menuOpen = false;
    if (refocus) addButton?.focus({ preventScroll: true });
  }
  /** One effect per explicit choice: a click, or Enter / Space on the focused item. */
  function choose(kind: EffectKind) {
    closeMenu();
    onadd(kind);
  }
  /** Arrow keys move through the list; they never add anything. */
  function menuKey(e: KeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (at + 1) % list.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (at - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Escape') closeMenu();
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (next >= 0) list[next]?.focus();
  }
  /** A press anywhere else closes the list. */
  function pressOutside(e: PointerEvent) {
    const target = e.target as Node;
    if (menuOpen && !menu?.contains(target) && !addButton?.contains(target)) closeMenu(false);
  }

  function drop(e: DragEvent, target: string) {
    e.preventDefault();
    if (!dragEffect) return;
    onreorder(dragEffect, target);
    dragEffect = '';
  }
</script>

<svelte:window onpointerdowncapture={pressOutside} />

<div class="panel-heading">
  <strong>Effect stack</strong><span>{effects.length}/{MAX_INTERACTIVE_EFFECTS}</span>
</div>
<div
  class="add-effect"
  onfocusout={(e) => {
    if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) closeMenu(false);
  }}
>
  <button
    class="wide add-effect-button"
    bind:this={addButton}
    disabled={full}
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    onclick={toggleMenu}
  >
    <Icon name="plus" size={16} />Add effect
  </button>
  {#if menuOpen}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="add-effect-menu" role="menu" aria-label="Add effect" bind:this={menu} onkeydown={menuKey}>
      {#each EFFECT_KINDS as kind}
        <button role="menuitem" onclick={() => choose(kind)}>{EFFECT_NAMES[kind]}</button>
      {/each}
    </div>
  {/if}
</div>
{#if full}
  <p class="hint limit">All {MAX_INTERACTIVE_EFFECTS} effect slots are in use. Remove one to add another.</p>
{:else}
  <p class="hint">Use ↑ ↓ to reorder. The last effect sits on top.</p>
{/if}
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
