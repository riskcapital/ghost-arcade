<script lang="ts">
  /**
   * The Sound bath set's own instruments: the drone, the bowls, the XY space
   * pad and the chord pads. Rendered in pieces by `part`, so the Studio view
   * can place each where the set's layout puts it.
   */
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { BOWL_PARAMS, DRONE_PARAMS, bowlNotes, chordName, chordNotes, keyLabel, scaleNote } from '../../music/studioSets';
  import { noteName } from '../../music/noteEvents';
  import { playNote, releaseBowl, releaseChords, releaseNote, strikeBowl, toggleChord } from '../../music/musicRuntime';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';
  import { BOWL_KITS, bowlSlotNotes } from '../../music/soundSlots';
  import { PAD_PATCHES, padPatchById, soundById, soundGroups } from '../../music/sounds/library';

  let { part }: { part: 'drone' | 'bowls' | 'xy' | 'chords' } = $props();

  const s = $derived($musicStudio);
  const t = $derived($musicTransport);
  // Each bowl's note: its note in the key, moved by the octave chosen for it.
  const bowls = $derived(bowlSlotNotes(bowlNotes(s.key), s.bowlSlots));
  /** Struck sounds only: what a bowl can hold. */
  const bowlGroups = soundGroups((sound) => sound.kind === 'strike');
  let choosingBowls = $state(false);
  const bowlKit = $derived(BOWL_KITS.find((k) => k.slots.every((slot, i) => slot.sound === s.bowlSlots[i]?.sound && slot.octave === s.bowlSlots[i]?.octave))?.id ?? '');
  const patch = $derived(padPatchById(s.dronePatch));
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
    toggleChord(degree, s.velocity);
  }

  // ── XY ──
  let pad = $state<HTMLElement | null>(null);
  let trail = $state<Array<{ x: number; y: number }>>([]);
  let dragging = false;
  /** The note the pad is sounding while touched. */
  let xyNote: number | null = null;
  /** Two octaves of the key across the pad's width. */
  const XY_STEPS = 14;

  function xyPlay(x: number, y: number) {
    const note = scaleNote(s.key, Math.round(x * XY_STEPS), 48);
    if (note === xyNote) return;
    const previous = xyNote;
    xyNote = note;
    // The new note first, so the voice glides instead of restarting.
    playNote('xy', note, 0.45 + y * 0.55, 'screen');
    if (previous !== null) releaseNote('xy', previous, 'screen');
  }

  function xyAt(e: PointerEvent) {
    if (!pad) return;
    const r = pad.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    musicStudio.setParam('xy.x', x);
    musicStudio.setParam('xy.y', y);
    trail = [...trail.slice(-10), { x, y }];
    xyPlay(x, y);
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
    if (xyNote !== null) releaseNote('xy', xyNote, 'screen');
    xyNote = null;
  }
</script>

{#if part === 'drone'}
  <StudioModule title="Drone" subtitle={keyLabel(s.key)} led={droneSounding}>
    {#snippet head()}
      {#if PAD_PATCHES.length}
        <select class="patch" value={s.dronePatch} onchange={(e) => musicStudio.setDronePatch((e.target as HTMLSelectElement).value)} aria-label="Drone sound" title={patch?.blurb ?? 'The drone\'s sound'}>
          {#each PAD_PATCHES as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      {/if}
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
  <StudioModule title="Bowls" subtitle="Strike, or hold">
    {#snippet head()}
      <select class="patch" value={bowlKit} onchange={(e) => { const kit = BOWL_KITS.find((k) => k.id === (e.target as HTMLSelectElement).value); if (kit) musicStudio.setBowlSlots(kit.slots); }} aria-label="Bowl set" title="Put a ready-made set of sounds on the five bowls">
        {#if !bowlKit}<option value="">Your own</option>{/if}
        {#each BOWL_KITS as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
      </select>
      <button class="studio-btn" class:on={choosingBowls} aria-pressed={choosingBowls} onclick={() => (choosingBowls = !choosingBowls)} title="Choose each bowl's sound and octave">Sounds</button>
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
          aria-label="Bowl {noteName(note)}, {soundById(s.bowlSlots[i]?.sound)?.name ?? 'bowl'}"
          title={soundById(s.bowlSlots[i]?.sound)?.blurb ?? ''}
          data-midi-path="studio:bowl.{i + 1}"
          data-midi-label="Bowl {i + 1}"
        >{noteName(note)}</button>
      {/each}
    </div>
    <div class="bowl-names">
      {#each bowls as _note, i (i)}
        {@const slot = s.bowlSlots[i]}
        <div class="bowl-name">
          {#if choosingBowls}
            <select value={slot.sound} onchange={(e) => musicStudio.setBowlSlot(i, { sound: (e.target as HTMLSelectElement).value })} aria-label="Sound of bowl {i + 1}">
              {#if !soundById(slot.sound)}<option value={slot.sound}>{slot.sound}</option>{/if}
              {#each bowlGroups as group (group.category)}
                <optgroup label={group.label}>
                  {#each group.sounds as sound (sound.id)}<option value={sound.id}>{sound.name}</option>{/each}
                </optgroup>
              {/each}
            </select>
            <div class="octave" role="group" aria-label="Octave of bowl {i + 1}">
              <button onclick={() => musicStudio.setBowlSlot(i, { octave: slot.octave - 1 })} disabled={slot.octave <= -2} aria-label="Octave down">−</button>
              <span>{slot.octave > 0 ? `+${slot.octave}` : slot.octave}</span>
              <button onclick={() => musicStudio.setBowlSlot(i, { octave: slot.octave + 1 })} disabled={slot.octave >= 2} aria-label="Octave up">+</button>
            </div>
          {:else}
            <span>{soundById(slot.sound)?.name ?? 'Bowl'}</span>
          {/if}
        </div>
      {/each}
    </div>
    <div class="knob-row">
      {#each BOWL_PARAMS as p (p.key)}
        <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={28} onchange={(v) => musicStudio.setParam(p.key, v)} />
      {/each}
    </div>
  </StudioModule>
{:else if part === 'xy'}
  <StudioModule title="XY · Space" subtitle="Touch to play" grow>
    {#snippet head()}
      <StudioJack id="audio:xy" label="Out" title="XY tone" />
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
      <span class="corner bl ga-eyebrow">Drone · near</span>
      <span class="corner tr ga-eyebrow">Bowls · vast</span>
      {#each trail as p, i (i)}
        <span class="trail" style="left: {p.x * 100}%; top: {(1 - p.y) * 100}%; opacity: {(i + 1) / (trail.length + 4)}"></span>
      {/each}
      <span class="puck" style="left: {s.params['xy.x'] * 100}%; top: {(1 - s.params['xy.y']) * 100}%"></span>
    </div>
  </StudioModule>
{:else}
  <StudioModule title="Chords" subtitle="{keyLabel(s.key)} · tap to layer">
    {#snippet head()}
      {#if t.chords.length}
        <button class="studio-btn" onclick={releaseChords}>Let go</button>
      {/if}
    {/snippet}
    <div class="chords">
      {#each chords as c (c.degree)}
        <button class="chord" class:on={t.chords.includes(c.degree)} aria-pressed={t.chords.includes(c.degree)} onclick={() => chordPress(c.degree)}>{c.name}</button>
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
    border: 2px solid var(--studio-edge);
    background: radial-gradient(circle at 40% 35%, #34406a, #0b1020 72%);
    color: var(--studio-ink);
    font-family: var(--ga-font-mono, ui-monospace);
    font-size: 11px;
    cursor: pointer;
    touch-action: none;
    transition: box-shadow 0.4s ease-out;
  }
  .bowl-names { display: flex; justify-content: space-around; gap: 4px; padding: 2px 0 6px; }
  .bowl-name { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: var(--ga-text-micro, 9px); color: var(--studio-muted); text-align: center; }
  .bowl-name > span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bowl-name select { width: 100%; min-width: 0; font-size: var(--ga-text-micro, 9px); }
  .octave { display: flex; align-items: center; gap: 2px; font-family: var(--ga-font-mono, ui-monospace); }
  .octave button { width: 16px; height: 16px; padding: 0; border: 1px solid var(--studio-edge-soft); background: transparent; color: var(--studio-muted); border-radius: 3px; line-height: 1; cursor: pointer; }
  .octave button:disabled { opacity: 0.35; cursor: default; }
  .octave span { min-width: 14px; text-align: center; }
  .patch { max-width: 112px; }
  .bowl.lit { box-shadow: 0 0 26px var(--ga-blue-a45, rgba(82, 120, 255, 0.45)); border-color: var(--studio-accent); }
  .xy {
    position: relative;
    flex: 1;
    min-height: 140px;
    border: 1px solid var(--studio-edge);
    background-color: var(--studio-slot);
    background-image: linear-gradient(var(--studio-edge-soft) 1px, transparent 1px), linear-gradient(90deg, var(--studio-edge-soft) 1px, transparent 1px);
    background-size: 12.5% 12.5%;
    cursor: crosshair;
    touch-action: none;
    overflow: hidden;
  }
  .xy:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 2px; }
  .corner { position: absolute; pointer-events: none; }
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
