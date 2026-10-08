<script lang="ts">
  /** Objects tab: the shapes in the scene and what can be done to the selected one. */
  import type { Behavior, InteractiveSurface } from '../../mobile/studio/interactive';
  import type { EffectKind } from '../../mobile/studio/interactiveEffects';
  import { MAX_SURFACES, type ShapeKind } from '../../mobile/studio/editorActions';

  export let surfaces: InteractiveSurface[] = [];
  export let selected = '';
  /** There are corner-mapped layers whose outlines can be copied in. */
  export let canImportMapping = false;

  export let onshape: (kind: ShapeKind) => void;
  export let onselect: (id: string) => void;
  export let onrename: (name: string) => void;
  export let onbehavior: (behavior: Behavior) => void;
  /** The depth slider is about to change: remember the scene for undo. */
  export let onheightstart: () => void;
  export let onheight: (height: number) => void;
  export let onattach: (kind: EffectKind) => void;
  export let ontransform: (scale: number, angle?: number) => void;
  export let onduplicate: () => void;
  export let ondelete: () => void;
  export let onimportmapping: () => void;

  const ROTATE_STEP = Math.PI / 12;

  $: chosen = surfaces.find((s) => s.id === selected);
  $: full = surfaces.length >= MAX_SURFACES;
</script>

<div class="panel-heading"><strong>Objects & blockers</strong><span>{surfaces.length}/{MAX_SURFACES}</span></div>
<div class="tools">
  <button disabled={full} onclick={() => onshape('box')}>▭ Box</button>
  <button disabled={full} onclick={() => onshape('circle')}>○ Circle</button>
  <button disabled={full} onclick={() => onshape('triangle')}>△ Triangle</button>
</div>
<div class="surface-list">
  {#each surfaces as s}
    <button class:active={s.id === selected} onclick={() => onselect(s.id)}>
      <span>{s.name}</span><small>{s.behavior}</small>
    </button>
  {/each}
</div>
{#if chosen}
  <label>
    Object name
    <input value={chosen.name} onchange={(e) => onrename(e.currentTarget.value)} maxlength="80" />
  </label>
  <label>
    Interaction
    <select value={chosen.behavior} onchange={(e) => onbehavior(e.currentTarget.value as Behavior)}>
      <option value="solid">Solid blocker</option>
      <option value="emitter">Emitter boundary</option>
      <option value="attractor">Attractor</option>
      <option value="trigger">Trigger region</option>
    </select>
  </label>
  <label>
    Blocker depth <output>{(chosen.height ?? 0.25).toFixed(2)}</output>
    <input
      type="range"
      min=".02"
      max=".9"
      step=".01"
      value={chosen.height ?? 0.25}
      onpointerdown={onheightstart}
      oninput={(e) => onheight(+e.currentTarget.value)}
    />
  </label>
  <div class="group-label">Attach an effect</div>
  <div class="tools">
    <button class="ignite" onclick={() => onattach('fire')}>♨ Ignite</button>
    <button onclick={() => onattach('smoke')}>Smoke</button>
    <button onclick={() => onattach('liquid')}>Pour</button>
  </div>
  <div class="tools">
    <button onclick={() => ontransform(0.9)}>Scale −</button>
    <button onclick={() => ontransform(1.1)}>Scale +</button>
    <button onclick={() => ontransform(1, ROTATE_STEP)}>Rotate</button>
  </div>
  <div class="tools">
    <button onclick={onduplicate} disabled={full}>Duplicate</button>
    <button class="danger" onclick={ondelete}>Delete object</button>
  </div>
{:else}
  <p class="hint">Select or draw an object to edit its geometry and attach an effect.</p>
{/if}
<button class="wide" disabled={!canImportMapping} onclick={onimportmapping}>Import mapping outlines</button>
