<script lang="ts">
  /**
   * Depth setup in the 3D world tab: how the world learns the real objects'
   * shape, a step at a time. The stage shows each step's control (roles on
   * the faces, the gravity arrow, the projector marker); the solve runs as
   * things change, so the preview follows.
   */
  import type { RoomSetup } from '../../scene3d/roomModel';
  import type { DepthStep, PhoneDepthScan } from './interactiveEditorTypes';
  import { depthScanLabel } from '../../mobile/studio/depthScanFlow';
  import Icon from './StudioIcon.svelte';

  export let step: DepthStep;
  export let setup: RoomSetup;
  /** 0 floats, 1 Earth, 2 heavy. */
  export let gravity = 1;
  /** Solid objects in the scene: the faces. */
  export let faces = 0;
  /** Corners where faces were found to meet. */
  export let contacts = 0;
  /** Corner-mapped layers are there to use. */
  export let canLink = false;
  export let onstep: (step: DepthStep | null) => void;
  /** `undo` is a single change and its own undo step; sliders say false and call onstart first. */
  export let onsetup: (patch: Partial<RoomSetup>, undo: boolean) => void;
  export let ongravity: (value: number, undo: boolean) => void;
  export let onlink: () => void;
  export let onstart: () => void;
  export let ondone: () => void;
  /** A depth capture file the phone app saved: its text. */
  export let oncapture: (text: string) => void = () => {};
  /** Scanning from a paired phone, started here. Null where there is no pairing (the phone's own editor). */
  export let phoneScan: PhoneDepthScan | null = null;
  let chosenPhone = '';
  $: phones = phoneScan?.phones ?? [];
  $: if (phones.length && !phones.some((p) => p.id === chosenPhone)) chosenPhone = phones[0].id;
  $: flow = phoneScan?.flow ?? { kind: 'idle' as const };
  $: running = flow.kind === 'asking' || flow.kind === 'scanning' || flow.kind === 'applying';
  $: progress = flow.kind === 'scanning' && flow.pct !== undefined ? flow.pct : null;
  async function openCapture(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) oncapture(await file.text());
  }

  const HAND: DepthStep[] = ['surfaces', 'faces', 'down', 'projector'];
  const TITLES: Record<DepthStep, string> = {
    start: 'Real objects',
    scan: 'Scan with the phone',
    surfaces: 'Faces',
    faces: 'What each face is',
    down: 'Which way is down',
    projector: 'The projector',
  };
  $: at = HAND.indexOf(step);
  const sliderKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
  const startKey = (e: KeyboardEvent) => {
    if (sliderKeys.includes(e.key) && !e.repeat) onstart();
  };
  const pull = (g: number) => (g < 0.05 ? 'Floating' : g < 0.75 ? 'Light' : g < 1.3 ? 'Earth' : 'Heavy');
</script>

<div class="depth-setup">
  <div class="depth-head">
    <strong>{TITLES[step]}</strong>
    {#if at >= 0}<span>Step {at + 1} of {HAND.length}</span>{/if}
  </div>

  {#if step === 'start'}
    <p class="hint">Effects follow the shape of what you project on: balls roll off the tops, paint runs down the sides, fire sits on the ledges.</p>
    <div class="starter-grid">
      <button class="starter" onclick={() => onstep('scan')}>
        <Icon name="scan" size={18} />
        <strong>Scan with the phone</strong>
        <span>An iPhone's depth camera measures the objects while the projector shows the auto-map stripes. Most accurate.</span>
      </button>
      <button class="starter" onclick={() => onstep('surfaces')}>
        <Icon name="map" size={18} />
        <strong>Set up by hand</strong>
        <span>Use the faces you mapped, then say which way is down and where the projector is.</span>
      </button>
    </div>
  {:else if step === 'scan'}
    {#if phoneScan}
      {#if flow.kind === 'applied'}
        <p class="depth-scan-done" role="status" data-depth-scan-done>{flow.summary}</p>
        <div class="tools">
          {#if phoneScan.canUndo}<button onclick={phoneScan.onundo}>Undo</button>{/if}
          <button onclick={phoneScan.ondismiss}>Scan again</button>
        </div>
      {:else if running}
        <p class="hint" role="status" data-depth-scan-status>{depthScanLabel(flow)}</p>
        {#if progress !== null}<progress max="100" value={progress}></progress>{:else}<progress></progress>{/if}
        {#if flow.kind !== 'applying'}<button class="wide" onclick={phoneScan.oncancel}>Cancel the scan</button>{/if}
      {:else if phones.length}
        {#if flow.kind === 'failed'}<p class="depth-scan-error" role="alert">{flow.message}</p>{/if}
        <p class="hint">Start the scan here, then prop the phone up where it sees the objects and the projection and tap Start on it. The stripes show on the output while it measures.</p>
        {#if phones.length > 1}
          <label>
            Phone
            <select bind:value={chosenPhone}>
              {#each phones as phone (phone.id)}<option value={phone.id} class="device-name">{phone.label}</option>{/each}
            </select>
          </label>
        {:else}
          <p class="depth-count"><span class="device-name">{phones[0].label}</span> is paired.</p>
        {/if}
        <button class="wide primary" data-depth-scan-start onclick={() => phoneScan?.onstart(chosenPhone)}>Start on phone</button>
      {:else}
        {#if flow.kind === 'failed'}<p class="depth-scan-error" role="alert">{flow.message}</p>{/if}
        <p class="hint">No phone with depth scan is paired. Scan this code with an iPhone that has LiDAR, in the Ghost Arcade app.</p>
        {#if phoneScan.pair?.qr}
          <img class="depth-pair-qr" src={phoneScan.pair.qr} alt="Pairing code" />
          {#if phoneScan.pair.url}<p class="hint depth-pair-url" translate="no">{phoneScan.pair.url}</p>{/if}
        {:else}
          <button class="wide" onclick={phoneScan.onpair}>Show the pairing code</button>
        {/if}
      {/if}
      <p class="hint">Or, from a scan the phone saved:</p>
    {:else}
      <p class="hint">On the phone, run Auto-map with depth from Calibration, with the phone held still where it sees the objects and the projection. Then open the depth capture it saved.</p>
    {/if}
    <label class="wide file-button">
      Open a depth capture
      <input type="file" accept=".json,application/json" onchange={openCapture} />
    </label>
    <p class="hint">The faces, the projector's place and lens, and which way is down all come from the scan.</p>
  {:else if step === 'surfaces'}
    <p class="hint">Each flat face of an object is its own outline: the top of a box and each side you can see.</p>
    {#if canLink}
      <button class="wide" onclick={onlink}>{setup.linked ? 'Following the mapped layers' : 'Use the mapped layers'}</button>
      <label class="check">
        <input type="checkbox" checked={setup.linked} onchange={(e) => onsetup({ linked: e.currentTarget.checked }, true)} />
        Keep following the mapping
      </label>
      <p class="hint">Corner-mapped layers become the faces. While linked, moving a layer in mapping mode moves its face here.</p>
    {:else}
      <p class="hint">No corner-mapped layers yet. Map the faces in mapping mode, or draw them in Objects as solid objects.</p>
    {/if}
    <p class="depth-count">{faces === 1 ? '1 face' : `${faces} faces`}</p>
  {:else if step === 'faces'}
    <p class="hint">Tap a face on the stage to change it. Top lies level, Side stands upright, Back is the wall behind.</p>
    <button class="wide" disabled={!Object.keys(setup.roles).length} onclick={() => onsetup({ roles: {} }, true)}>Guess them again</button>
  {:else if step === 'down'}
    <p class="hint">Drag on the stage to point the arrow the way things fall, as you see it on the objects.</p>
    <label>
      Gravity <output>{pull(gravity)}</output>
      <input type="range" min="0" max="2" step=".05" value={gravity} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => ongravity(+e.currentTarget.value, false)} />
    </label>
  {:else}
    <p class="hint">Drag the projector marker up or down until the faces sit right: higher when it looks down on the objects.</p>
    <label>
      Looks down <output>{Math.round(setup.elevation)}°</output>
      <input type="range" min="-60" max="85" step="1" value={setup.elevation} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => onsetup({ elevation: +e.currentTarget.value }, false)} />
    </label>
    <label>
      Lens <output>{Math.round(setup.fov)}°</output>
      <input type="range" min="8" max="90" step="1" value={setup.fov} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => onsetup({ fov: +e.currentTarget.value }, false)} />
    </label>
    <label>
      Distance <output>{setup.distance.toFixed(1)} m</output>
      <input type="range" min="0.5" max="15" step=".1" value={setup.distance} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => onsetup({ distance: +e.currentTarget.value }, false)} />
    </label>
    <p class="hint">{contacts ? `The faces meet at ${contacts} corners.` : 'No faces meet: each stands on the ground on its own.'} Orbit the view to check them from the side.</p>
  {/if}

  <div class="tools depth-nav">
    {#if step === 'start'}
      <button onclick={() => onstep(null)}>Cancel</button>
    {:else}
      <button onclick={() => onstep(at > 0 ? HAND[at - 1] : 'start')}>Back</button>
      {#if step === 'scan'}
        {#if phoneScan?.flow.kind === 'applied'}<button onclick={ondone}>Done</button>{:else}<span></span>{/if}
      {:else if at < HAND.length - 1}
        <button disabled={step === 'surfaces' && faces === 0} onclick={() => onstep(HAND[at + 1])}>Next</button>
      {:else}
        <button onclick={ondone}>Done</button>
      {/if}
    {/if}
  </div>
</div>
