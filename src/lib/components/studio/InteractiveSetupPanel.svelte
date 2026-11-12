<script lang="ts">
  /** Setup tab: input, audio, scene name, save / export / import and the camera reference. */
  import { defaultInteractiveInput, type InteractiveInput, type TrackingSource, type InputForce } from '../../mobile/studio/interactive';
  /** Tracked hands and body. `step` is a single change and its own undo step. */
  export let input: InteractiveInput = defaultInteractiveInput();
  export let oninputchange: (input: InteractiveInput, step: boolean) => void;
  /** The strength slider is about to change: remember the scene for undo. */
  export let oninputstart: () => void;
  const TRACKING: { value: TrackingSource; label: string }[] = [
    { value: 'off', label: 'Pointer only' },
    { value: 'hands', label: 'Hands' },
    { value: 'body', label: 'Body' },
    { value: 'both', label: 'Hands and body' },
  ];
  const FORCES: { value: InputForce; label: string }[] = [
    { value: 'attract', label: 'Attract' },
    { value: 'repel', label: 'Repel' },
    { value: 'vortex', label: 'Vortex' },
  ];
  export let nativeOutput = false;
  /** Phone or tablet: the camera choice is rear / selfie. */
  export let handheld = false;
  export let audioOn = false;
  export let sceneName = '';
  /** Line under the scene name: where the scene is kept. */
  export let saveStatus = '';

  /** Camera reference. `facing`, `motionEnabled`, `sensitivity` and `cameraOpacity` are bound. */
  export let facing: 'rear' | 'front' = 'rear';
  export let camera = false;
  export let cameraBusy = false;
  export let motionEnabled = false;
  export let sensitivity = 0.6;
  export let cameraOpacity = 0.35;

  export let ontoggleaudio: () => void;
  /** The name field got focus: remember the scene for undo. */
  export let onnamestart: () => void;
  export let onname: (name: string) => void;
  export let onsave: () => void;
  export let onscenes: () => void;
  export let onexport: () => void;
  export let onimport: (e: Event) => void;
  export let onstartcamera: () => void;
  export let onstopcamera: () => void;
</script>

<div class="group-label">Input</div>
<label>
  Tracking
  <select value={input.tracking} onchange={(e) => oninputchange({ ...input, tracking: e.currentTarget.value as TrackingSource }, true)}>
    {#each TRACKING as t}
      <option value={t.value}>{t.label}</option>
    {/each}
  </select>
</label>
{#if input.tracking !== 'off'}
  <label>
    Tracked points
    <select value={input.force} onchange={(e) => oninputchange({ ...input, force: e.currentTarget.value as InputForce }, true)}>
      {#each FORCES as f}
        <option value={f.value}>{f.label}</option>
      {/each}
    </select>
  </label>
  <label>
    Strength <output>{Math.round(input.strength * 100)}%</output>
    <input
      type="range"
      min="0"
      max="1"
      step=".01"
      value={input.strength}
      onpointerdown={oninputstart}
      oninput={(e) => oninputchange({ ...input, strength: +e.currentTarget.value }, false)}
    />
  </label>
  <p class="hint">
    {input.tracking === 'hands' ? 'Palms and index fingertips' : input.tracking === 'body' ? 'Head, wrists and feet' : 'Palms, fingertips, head, wrists and feet'}
    from the hand-tracking camera move the effects and touch trigger zones, with this editor open or closed. The camera view maps onto the whole scene.
  </p>
{/if}
<div class="group-label">Audio</div>
{#if !nativeOutput}
  <button class="wide" onclick={ontoggleaudio}>{audioOn ? 'Stop microphone' : 'Enable audio modulation'}</button>
{:else}
  <p class="hint">
    Audio Mod uses the desktop audio input. LFO and beat controls keep running when this editor closes.
  </p>
{/if}
<div class="group-label">Scene</div>
<label>
  Scene name
  <input value={sceneName} onfocus={onnamestart} oninput={(e) => onname(e.currentTarget.value)} maxlength="120" />
</label>
<p class="draft-status" role="status">{saveStatus}</p>
<div class="tools">
  <button onclick={onsave}>Save scene</button>
  <button onclick={onscenes}>My scenes</button>
  <button onclick={onexport}>Export</button>
</div>
<label>
  Import scene
  <input type="file" accept=".json,.ghostinteractive,application/json" onchange={onimport} />
</label>
<details>
  <summary>Camera interaction</summary>
  <label>
    Camera
    <select bind:value={facing} disabled={camera || cameraBusy}>
      <option value="rear">{handheld ? 'Rear' : 'Normal'}</option>
      <option value="front">{handheld ? 'Mirrored selfie' : 'Mirrored'}</option>
    </select>
  </label>
  <div class="tools">
    <button disabled={cameraBusy} onclick={onstartcamera}>{cameraBusy ? 'Opening…' : 'Start camera'}</button>
    <button onclick={onstopcamera} disabled={!camera}>Stop</button>
  </div>
  <label class="check"><input type="checkbox" bind:checked={motionEnabled} /> Motion input</label>
  <label>
    Sensitivity
    <input type="range" min="0" max="1" step=".01" bind:value={sensitivity} />
  </label>
  <label>
    Reference camera opacity
    <input type="range" min="0" max="1" step=".01" bind:value={cameraOpacity} />
  </label>
  <p class="hint">Local movement sensing; not calibrated depth tracking.</p>
</details>
