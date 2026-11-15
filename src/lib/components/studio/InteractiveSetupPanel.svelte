<script lang="ts">
  /** Setup tab: audio input, scene name, save / export / import and the camera reference. */
  import type { TouchTool } from './interactiveEditorTypes';
  const TOOL_LABELS: Record<TouchTool, string> = { throw: 'Throw', push: 'Push', pour: 'Pour', ignite: 'Ignite', attract: 'Attract', repel: 'Repel', vortex: 'Vortex' };
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
  /** Bound: the tool camera motion acts as, one of `motionTools`. */
  export let motionTool: TouchTool = 'attract';
  export let motionTools: TouchTool[] = ['attract', 'repel', 'vortex'];
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

{#if !nativeOutput}
  <button class="wide" onclick={ontoggleaudio}>{audioOn ? 'Stop microphone' : 'Enable audio modulation'}</button>
{:else}
  <p class="hint">
    Audio Mod uses the desktop audio input. LFO and beat controls keep running when this editor closes.
  </p>
{/if}
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
    Motion acts as
    <select bind:value={motionTool} disabled={!motionEnabled}>
      {#each motionTools as t}<option value={t}>{TOOL_LABELS[t]}</option>{/each}
    </select>
  </label>
  <label>
    Sensitivity
    <input type="range" min="0" max="1" step=".01" bind:value={sensitivity} />
  </label>
  <label>
    Reference camera opacity
    <input type="range" min="0" max="1" step=".01" bind:value={cameraOpacity} />
  </label>
  <p class="hint">Local movement sensing; not calibrated depth tracking. Movement acts where it is seen, as a held touch with that tool would{motionTools.length > 3 ? ', on the desktop’s 3D world too' : ''}.</p>
</details>
