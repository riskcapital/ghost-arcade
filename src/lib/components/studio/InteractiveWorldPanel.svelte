<script lang="ts">
  /**
   * World tab: the 3D world (scene3d/worldModel.ts). Its shape is either a
   * flat wall the scene's solid objects stand out of as lit blocks, or the
   * real objects in front of the projector (depth mode, set up in
   * InteractiveDepthSetup). Off, the scene is the flat 2D scene.
   */
  import { defaultReliefWorld, type FlatMode, type ReliefWorld, type WorldLook, type WorldSource } from '../../scene3d/worldModel';

  export let world: ReliefWorld | undefined = undefined;
  /** How many solid objects stand out as blocks. */
  export let blocks = 0;
  /** `step` is a single change (a switch, a menu) and its own undo step. */
  export let onchange: (world: ReliefWorld | undefined, step: boolean) => void;
  /** A slider is about to move: remember the scene for undo. */
  export let onstart: () => void;
  /** Choose the world's shape; real objects open depth setup the first time. */
  export let ondepth: (source: WorldSource) => void = () => {};
  /** Run depth setup again. */
  export let ondepthsetup: () => void = () => {};

  const SOURCES: { value: WorldSource; label: string }[] = [
    { value: 'wall', label: 'Flat wall' },
    { value: 'room', label: 'Real objects' },
  ];
  const LOOKS: { value: WorldLook; label: string }[] = [
    { value: 'effects', label: 'Effects only' },
    { value: 'shaded', label: 'Shaded' },
  ];

  const FLAT: { value: FlatMode; label: string }[] = [
    { value: 'projected', label: 'Projected' },
    { value: 'over', label: 'Over' },
    { value: 'off', label: 'Hidden' },
  ];
  const FLAT_HINT: Record<FlatMode, string> = {
    projected: 'The effects fall on the wall and blocks as projector light, lit and shaded with them.',
    over: 'The effects are drawn flat on top of the world.',
    off: 'Only the world is drawn.',
  };
  const sliderKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
  const startKey = (e: KeyboardEvent) => {
    if (sliderKeys.includes(e.key) && !e.repeat) onstart();
  };

  $: on = !!world?.enabled;
  $: real = world?.source === 'room';
  const set = (patch: Partial<ReliefWorld>, step = false) => world && onchange({ ...world, ...patch }, step);
  const sun = (patch: Partial<ReliefWorld['sun']>, step = false) => world && set({ sun: { ...world.sun, ...patch } }, step);
  const wall = (patch: Partial<ReliefWorld['wall']>, step = false) => world && set({ wall: { ...world.wall, ...patch } }, step);
  const fill = (patch: Partial<ReliefWorld['fill']>, step = false) => world && set({ fill: { ...world.fill, ...patch } }, step);
  const compass = (deg: number) => {
    const names = ['top', 'upper right', 'right', 'lower right', 'bottom', 'lower left', 'left', 'upper left'];
    return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  };
</script>

<label class="check world-switch">
  <input type="checkbox" checked={on} onchange={(e) => onchange(e.currentTarget.checked ? { ...(world ?? defaultReliefWorld()), enabled: true } : world ? { ...world, enabled: false } : undefined, true)} />
  3D world
</label>
{#if !on}
  <p class="hint">Raise the solid objects out of a wall as lit 3D blocks, with a sun that casts their shadows. The effects keep running on top of them.</p>
{:else if world}
  <div class="group-label">Shape</div>
  <div class="ga-segmented world-flat world-source" role="group" aria-label="The world's shape">
    {#each SOURCES as s}
      <button class:active={world.source === s.value} aria-pressed={world.source === s.value} onclick={() => ondepth(s.value)}>{s.label}</button>
    {/each}
  </div>
  {#if real}
    <p class="hint">
      {world.room?.setup ? `${blocks === 1 ? '1 face' : `${blocks} faces`}, set up by hand.` : `${world.room?.faces.length ?? 0} faces, scanned with the phone.`}
      {world.room?.setup?.linked ? 'Following the mapped layers.' : ''}
    </p>
    <button class="wide" onclick={ondepthsetup}>Set up again</button>
    <div class="group-label">Look</div>
    <div class="ga-segmented world-flat world-source" role="group" aria-label="How the objects are drawn">
      {#each LOOKS as l}
        <button class:active={world.look === l.value} aria-pressed={world.look === l.value} onclick={() => set({ look: l.value }, true)}>{l.label}</button>
      {/each}
    </div>
    <p class="hint">{world.look === 'effects' ? 'Only the effects are drawn: the real objects are the canvas.' : 'The faces are drawn with their finishes, to preview the world on screen.'}</p>
  {:else if blocks === 0}
    <p class="hint">No solid objects yet: the wall stands alone. Set an object's Interaction to Solid blocker in Objects to raise it.</p>
  {/if}
  <div class="group-label">Effects on the world</div>
  <div class="ga-segmented world-flat" role="group" aria-label="Effects on the world">
    {#each FLAT as f}
      <button class:active={world.flat === f.value} aria-pressed={world.flat === f.value} onclick={() => set({ flat: f.value }, true)}>{f.label}</button>
    {/each}
  </div>
  <p class="hint">{real && world.flat === 'projected' ? 'The effects fall on the objects as projector light.' : FLAT_HINT[world.flat]}</p>

  {#if !real}
  <div class="group-label">Blocks</div>
  <label>
    Depth <output>{world.depthScale.toFixed(1)}×</output>
    <input type="range" min=".1" max="4" step=".05" value={world.depthScale} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => set({ depthScale: +e.currentTarget.value })} />
  </label>
  <label>
    Lens <output>{world.lens < 0.34 ? 'Long' : world.lens < 0.67 ? 'Normal' : 'Wide'}</output>
    <input type="range" min="0" max="1" step=".01" value={world.lens} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => set({ lens: +e.currentTarget.value })} />
  </label>
  <p class="hint">A wide lens shows more of the blocks' sides.</p>
  {/if}

  <div class="group-label">Sun</div>
  <label>
    From the <output>{compass(world.sun.azimuth)}</output>
    <input type="range" min="-180" max="180" step="1" value={world.sun.azimuth} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => sun({ azimuth: +e.currentTarget.value })} />
  </label>
  <label>
    Height <output>{Math.round(world.sun.elevation)}°</output>
    <input type="range" min="5" max="85" step="1" value={world.sun.elevation} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => sun({ elevation: +e.currentTarget.value })} />
  </label>
  <label>
    Brightness <output>{world.sun.power.toFixed(1)}</output>
    <input type="range" min="0" max="6" step=".1" value={world.sun.power} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => sun({ power: +e.currentTarget.value })} />
  </label>
  <label>
    Swing <output>{world.sun.sway ? `${Math.round(world.sun.sway)}°` : 'Still'}</output>
    <input type="range" min="0" max="30" step="1" value={world.sun.sway} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => sun({ sway: +e.currentTarget.value })} />
  </label>
  <label class="color-row">
    Color
    <input type="color" value={world.sun.color} onfocus={onstart} oninput={(e) => sun({ color: e.currentTarget.value })} />
  </label>

  <div class="group-label">Fill light</div>
  <label>
    Brightness <output>{world.fill.power.toFixed(1)}</output>
    <input type="range" min="0" max="4" step=".1" value={world.fill.power} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => fill({ power: +e.currentTarget.value })} />
  </label>
  <label class="color-row">
    Color
    <input type="color" value={world.fill.color} onfocus={onstart} oninput={(e) => fill({ color: e.currentTarget.value })} />
  </label>

  <div class="group-label">{real ? 'Ground' : 'Wall'}</div>
  <label class="color-row">
    Color
    <input type="color" value={world.wall.color} onfocus={onstart} oninput={(e) => wall({ color: e.currentTarget.value })} />
  </label>
  <label>
    Roughness <output>{Math.round(world.wall.rough * 100)}%</output>
    <input type="range" min="0" max="1" step=".01" value={world.wall.rough} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => wall({ rough: +e.currentTarget.value })} />
  </label>
  <label class="check">
    <input type="checkbox" checked={world.wall.catcher} onchange={(e) => wall({ catcher: e.currentTarget.checked }, true)} />
    {real ? 'Real ground: draw only light and shadow on it' : 'Real wall: draw only light and shadow on it'}
  </label>
  {#if real && world.room}
    <label class="check">
      <input type="checkbox" checked={world.room.floor} onchange={(e) => world?.room && set({ room: { ...world.room, floor: e.currentTarget.checked } }, true)} />
      Ground under the objects
    </label>
  {:else}
    <label class="check">
      <input type="checkbox" checked={world.floor} onchange={(e) => set({ floor: e.currentTarget.checked }, true)} />
      Ledge along the bottom
    </label>
  {/if}

  <div class="group-label">Picture</div>
  <label>
    Glow <output>{Math.round(world.bloom * 100)}%</output>
    <input type="range" min="0" max="2" step=".01" value={world.bloom} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => set({ bloom: +e.currentTarget.value })} />
  </label>
  <label>
    Exposure <output>{world.exposure > 0 ? '+' : ''}{world.exposure.toFixed(1)}</output>
    <input type="range" min="-3" max="3" step=".1" value={world.exposure} onpointerdown={onstart} onkeydown={startKey} oninput={(e) => set({ exposure: +e.currentTarget.value })} />
  </label>
{/if}
