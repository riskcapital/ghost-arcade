<script lang="ts">
  /** Objects tab: the shapes in the scene and what can be done to the selected one. */
  import {
    defaultSurfaceLook,
    invisibleSurfaceLook,
    surfaceHidden,
    type Behavior,
    type InteractiveSurface,
    type SurfaceFill,
    type SurfaceLook,
  } from '../../mobile/studio/interactive';
  import type { EffectKind } from '../../mobile/studio/interactiveEffects';
  import { MAX_SURFACES, type ShapeKind } from '../../mobile/studio/editorActions';

  export let surfaces: InteractiveSurface[] = [];
  export let selected = '';
  /** There are corner-mapped layers whose outlines can be copied in. */
  export let canImportMapping = false;
  /** Every effect slot is in use, so nothing more can be attached. */
  export let effectsFull = false;

  export let onshape: (kind: ShapeKind) => void;
  export let onselect: (id: string) => void;
  export let onrename: (name: string) => void;
  export let onbehavior: (behavior: Behavior) => void;
  /** The depth slider is about to change: remember the scene for undo. */
  export let onheightstart: () => void;
  export let onheight: (height: number) => void;
  /** A look slider is about to change: remember the scene for undo. */
  export let onlookstart: () => void;
  /** `step` is a single change (a menu, a switch) and its own undo step. */
  export let onlook: (look: SurfaceLook | undefined, step: boolean) => void;
  export let onattach: (kind: EffectKind) => void;
  export let ontransform: (scale: number, angle?: number) => void;
  export let onduplicate: () => void;
  export let ondelete: () => void;
  export let onimportmapping: () => void;

  const ROTATE_STEP = Math.PI / 12;
  const sliderKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

  $: chosen = surfaces.find((s) => s.id === selected);
  $: full = surfaces.length >= MAX_SURFACES;
  $: look = chosen?.look;
  $: appearance = !look ? 'effects' : surfaceHidden(look) ? 'invisible' : 'custom';

  const FILLS: { value: SurfaceFill; label: string }[] = [
    { value: 'none', label: 'Empty (outline only)' },
    { value: 'contours', label: 'Contours' },
    { value: 'weave', label: 'Weave' },
    { value: 'ripples', label: 'Ripples' },
    { value: 'bands', label: 'Bands' },
    { value: 'spiral', label: 'Spiral' },
    { value: 'grid', label: 'Grid' },
    { value: 'stripes', label: 'Stripes' },
    { value: 'dots', label: 'Dots' },
    { value: 'checker', label: 'Checker' },
    { value: 'noise', label: 'Noise' },
    { value: 'glow', label: 'Solid glow' },
  ];
  const LOOK_SLIDERS: { key: 'brightness' | 'scale' | 'speed' | 'outline'; label: string; fillOnly: boolean }[] = [
    { key: 'brightness', label: 'Fill brightness', fillOnly: true },
    { key: 'scale', label: 'Pattern detail', fillOnly: true },
    { key: 'speed', label: 'Pattern motion', fillOnly: true },
    { key: 'outline', label: 'Outline', fillOnly: false },
  ];

  function setAppearance(value: string) {
    if (value === 'effects') onlook(undefined, true);
    else if (value === 'invisible') onlook(invisibleSurfaceLook(), true);
    else onlook(defaultSurfaceLook(), true);
  }
  function slide(patch: Partial<SurfaceLook>) {
    if (look) onlook({ ...look, ...patch }, false);
  }
  function startSlide(e: KeyboardEvent) {
    if (sliderKeys.includes(e.key) && !e.repeat) onlookstart();
  }
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
      onkeydown={(e) => {
        if (sliderKeys.includes(e.key) && !e.repeat) onheightstart();
      }}
      oninput={(e) => onheight(+e.currentTarget.value)}
    />
  </label>
  <div class="group-label">Look</div>
  <label>
    Appearance
    <select value={appearance} onchange={(e) => setAppearance(e.currentTarget.value)}>
      <option value="effects">Drawn by the effects</option>
      <option value="custom">Custom</option>
      <option value="invisible">Invisible (interaction only)</option>
    </select>
  </label>
  {#if look && appearance === 'invisible'}
    <p class="hint">Nothing of this object is drawn. It still blocks, emits, attracts or triggers.</p>
  {:else if look}
    <label>
      Inside
      <select value={look.fill} onchange={(e) => onlook({ ...look, fill: e.currentTarget.value as SurfaceFill }, true)}>
        {#each FILLS as f}
          <option value={f.value}>{f.label}</option>
        {/each}
      </select>
    </label>
    {#each LOOK_SLIDERS as c}
      {#if !c.fillOnly || look.fill !== 'none'}
        <label>
          {c.label} <output>{Math.round(look[c.key] * 100)}%</output>
          <input
            type="range"
            min="0"
            max="1"
            step=".01"
            value={look[c.key]}
            onpointerdown={onlookstart}
            onkeydown={startSlide}
            oninput={(e) => slide({ [c.key]: +e.currentTarget.value })}
          />
        </label>
      {/if}
    {/each}
    <label class="check">
      <input
        type="checkbox"
        checked={look.hue !== undefined}
        onchange={(e) => {
          const { hue: _hue, ...rest } = look;
          onlook(e.currentTarget.checked ? { ...rest, hue: 185 } : rest, true);
        }}
      />
      Own colour
    </label>
    {#if look.hue !== undefined}
      <label>
        Colour <output>{Math.round(look.hue)}°</output>
        <input
          type="range"
          min="0"
          max="360"
          step="1"
          value={look.hue}
          onpointerdown={onlookstart}
          onkeydown={startSlide}
          oninput={(e) => slide({ hue: +e.currentTarget.value })}
        />
      </label>
    {/if}
  {/if}
  <div class="group-label">Attach an effect</div>
  <div class="tools">
    <button class="ignite" disabled={effectsFull} onclick={() => onattach('fire')}>♨ Ignite</button>
    <button disabled={effectsFull} onclick={() => onattach('smoke')}>Smoke</button>
    <button disabled={effectsFull} onclick={() => onattach('liquid')}>Pour</button>
  </div>
  {#if effectsFull}
    <p class="hint limit">All effect slots are in use. Remove an effect to attach another.</p>
  {/if}
  <div class="tools">
    <button onclick={() => ontransform(0.9)}>Scale −</button>
    <button onclick={() => ontransform(1.1)}>Scale +</button>
    <button onclick={() => ontransform(1, ROTATE_STEP)} title="Rotate 15°">Rotate</button>
  </div>
  <div class="tools">
    <button onclick={onduplicate} disabled={full}>Duplicate</button>
    <button class="danger" onclick={ondelete}>Delete object</button>
  </div>
{:else}
  <p class="hint">Select or draw an object to edit its geometry and attach an effect.</p>
{/if}
<button class="wide" disabled={!canImportMapping} onclick={onimportmapping}>Import mapping outlines</button>
