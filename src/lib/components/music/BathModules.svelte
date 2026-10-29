<script lang="ts">
  /**
   * The Sound bath set's own instruments: the drone, the bowls, the XY space
   * pad and the chord pads. Rendered in pieces by `part`, so the Studio view
   * can place each where the set's layout puts it.
   */
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { BOWL_PARAMS, DRONE_PARAMS, bowlNotes, chordName, chordNotes, keyLabel } from '../../music/studioSets';
  import { noteName } from '../../music/noteEvents';
  import { playChord, releaseBowl, releaseChord, strikeBowl } from '../../music/musicRuntime';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  let { part }: { part: 'drone' | 'bowls' | 'xy' | 'chords' } = $props();

  const s = $derived($musicStudio);
  const t = $derived($musicTransport);
  const bowls = $derived(bowlNotes(s.key));
  const chords = $derived(Array.from({ length: 8 }, (_, degree) => ({ degree, name: chordName(chordNotes(s.key, degree)) })));
  const droneSounding = $derived([...t.held].some((k) => k.startsWith('drone:')));

  // Bowl sizes shrink with pitch, like a real set.
  const BOWL_SIZES = [64, 58, 52, 47, 42];
  const pressedBowls = new Map<number, number>();

  function bowlDown(e: PointerEvent, index: number) {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    const note = strikeBowl(index, Math.min(1, 0.55 + s.velocity * 0.45));
    if (note !== null) pressedBowls.set(e.pointerId, note);
  }

  function bowlUp(e: PointerEvent) {
    const note = pressedBowls.get(e.pointerId);
    if (note === undefined) return;
    pressedBowls.delete(e.pointerId);
    releaseBowl(note);
  }

  function chordPress(degree: number) {
    if (t.chord === degree) releaseChord();
    else playChord(degree, s.velocity);
  }

  // ── XY ──
  let pad = $state<HTMLElement | null>(null);
  let trail = $state<Array<{ x: number; y: number }>>([]);
  let dragging = false;

  function xyAt(e: PointerEvent) {
    if (!pad) return;
    const r = pad.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    musicStudio.setParam('xy.x', x);
    musicStudio.setParam('xy.y', y);
    trail = [...trail.slice(-10), { x, y }];
  }

  function xyDown(e: PointerEvent) {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    dragging = true;
    xyAt(e);
  }

  function xyMove(e: PointerEvent) {
    if (dragging) xyAt(e);
  }

  function xyUp() {
    dragging = false;
  }
</script>

{#if part === 'drone'}
  <StudioModule title="DRONE" subtitle={keyLabel(s.key)} led={droneSounding}>
    {#snippet head()}
      <StudioJack id="cv:drone.level" label="Level" title="Drone level, as a control signal" />
      <StudioJack id="audio:drone" label="Out" title="Drone sound" />
    {/snippet}
    <div class="knob-grid">
      {#each DRONE_PARAMS as p (p.key)}
        <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={44} onchange={(v) => musicStudio.setParam(p.key, v)} />
      {/each}
    </div>
  </StudioModule>
{:else if part === 'bowls'}
  <StudioModule title="BOWLS" subtitle="Strike, or hold to keep it lit">
    {#snippet head()}
      <StudioJack id="cv:bowls.ring" label="Ring" title="Bowl ring, as a control signal" />
      <StudioJack id="audio:bowls" label="Out" title="Bowl sound" />
    {/snippet}
    <div class="bowls">
      {#each bowls as note, i (i)}
        <button
          class="bowl"
          class:lit={t.held.has(`bowls:${note}`)}
          style="width: {BOWL_SIZES[i]}px; height: {BOWL_SIZES[i]}px"
          onpointerdown={(e) => bowlDown(e, i)}
          onpointerup={bowlUp}
          onpointercancel={bowlUp}
          aria-label="Bowl {noteName(note)}"
        >{noteName(note)}</button>
      {/each}
    </div>
    <div class="knob-row">
      {#each BOWL_PARAMS as p (p.key)}
        <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={28} onchange={(v) => musicStudio.setParam(p.key, v)} />
      {/each}
    </div>
  </StudioModule>
{:else if part === 'xy'}
  <StudioModule title="XY · SPACE" subtitle="Drone ↔ bowls · near ↔ vast" grow>
    {#snippet head()}
      <StudioJack id="cv:xy.x" label="X" />
      <StudioJack id="cv:xy.y" label="Y" />
    {/snippet}
    <div
      class="xy"
      bind:this={pad}
      role="slider"
      tabindex="0"
      aria-label="XY space pad"
      aria-valuenow={Math.round(s.params['xy.x'] * 100)}
      aria-valuetext="X {Math.round(s.params['xy.x'] * 100)}%, Y {Math.round(s.params['xy.y'] * 100)}%"
      onpointerdown={xyDown}
      onpointermove={xyMove}
      onpointerup={xyUp}
      onpointercancel={xyUp}
      onkeydown={(e) => {
        const step = 0.04;
        if (e.key === 'ArrowLeft') musicStudio.setParam('xy.x', s.params['xy.x'] - step);
        else if (e.key === 'ArrowRight') musicStudio.setParam('xy.x', s.params['xy.x'] + step);
        else if (e.key === 'ArrowUp') musicStudio.setParam('xy.y', s.params['xy.y'] + step);
        else if (e.key === 'ArrowDown') musicStudio.setParam('xy.y', s.params['xy.y'] - step);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <span class="corner bl">DRONE · NEAR</span>
      <span class="corner tr">BOWLS · VAST</span>
      {#each trail as p, i (i)}
        <span class="trail" style="left: {p.x * 100}%; top: {(1 - p.y) * 100}%; opacity: {(i + 1) / (trail.length + 4)}"></span>
      {/each}
      <span class="puck" style="left: {s.params['xy.x'] * 100}%; top: {(1 - s.params['xy.y']) * 100}%"></span>
    </div>
  </StudioModule>
{:else}
  <StudioModule title="CHORDS" subtitle="{keyLabel(s.key)} · tap to hold, tap again to let go">
    <div class="chords">
      {#each chords as c (c.degree)}
        <button class="chord" class:on={t.chord === c.degree} onclick={() => chordPress(c.degree)}>{c.name}</button>
      {/each}
    </div>
  </StudioModule>
{/if}

<style>
  .knob-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 10px; justify-items: center; }
  .knob-row { display: flex; justify-content: space-around; }
  .bowls { display: flex; align-items: center; justify-content: space-around; min-height: 66px; }
  .bowl {
    flex: 0 0 auto;
    padding: 0;
    border-radius: 50%;
    border: 2px solid #6b5a3e;
    background: radial-gradient(circle at 40% 35%, #3b3326, #15120d 72%);
    color: #cfc7b2;
    font-family: var(--ga-font-mono, ui-monospace);
    font-size: 11px;
    cursor: pointer;
    touch-action: none;
    transition: box-shadow 0.4s ease-out;
  }
  .bowl.lit { box-shadow: 0 0 26px rgba(240, 164, 58, 0.55); border-color: var(--studio-accent); }
  .xy {
    position: relative;
    flex: 1;
    min-height: 140px;
    border: 1px solid var(--studio-edge);
    background-color: var(--studio-slot);
    background-image: linear-gradient(#211f1b 1px, transparent 1px), linear-gradient(90deg, #211f1b 1px, transparent 1px);
    background-size: 12.5% 12.5%;
    cursor: crosshair;
    touch-action: none;
    overflow: hidden;
  }
  .xy:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 2px; }
  .corner { position: absolute; font-size: 10px; letter-spacing: 0.1em; color: var(--studio-muted); pointer-events: none; }
  .corner.bl { left: 8px; bottom: 6px; }
  .corner.tr { right: 8px; top: 6px; }
  .trail, .puck { position: absolute; border-radius: 50%; pointer-events: none; transform: translate(-50%, -50%); }
  .trail { width: 8px; height: 8px; background: var(--studio-accent); }
  .puck {
    width: 26px;
    height: 26px;
    box-sizing: border-box;
    border: 2px solid var(--studio-accent);
    background: var(--studio-accent-soft);
    box-shadow: 0 0 18px var(--studio-accent);
  }
  .chords { flex: 1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .chord {
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font-family: var(--ga-font-mono, ui-monospace);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .chord.on { border-color: var(--studio-accent); background: var(--studio-accent-soft); color: var(--studio-accent); box-shadow: 0 0 14px var(--studio-accent-soft); }
</style>
