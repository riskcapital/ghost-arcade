<script lang="ts">
  /**
   * The clip editor: a piano roll for a notes clip, a step grid for a beat
   * clip. Edits go straight into the session, so a playing clip plays them
   * from its next note on. Click empty space to draw a note, drag a note to
   * move it, drag its right edge to change its length, double-click (or
   * right-click) to delete it; drag a bar in the velocity lane to set how
   * hard it plays. The scale's notes are shaded so the key is easy to keep.
   */
  import { onDestroy } from 'svelte';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { clipEditorId } from '../../music/studioUi';
  import { findClip, playableNotes, type NotesClip, type TrackId } from '../../music/session';
  import type { RecordedNote } from '../../music/loopRecorder';
  import { ROLE_INSTRUMENTS } from '../../music/loops';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { SCALES, keyLabel } from '../../music/studioSets';
  import { DRUM_LABELS, DRUM_VOICES, isBlackKey, noteName, type InstrumentId } from '../../music/noteEvents';
  import { PATTERN_LENGTHS, STEPS_PER_BEAT, normalizePattern, resizePattern, type DrumPattern, type PatternLength } from '../../music/drumPattern';
  import { clipPosition, launchClip, playNote, releaseNote, stopTrack } from '../../music/musicRuntime';
  import { userPresets } from '../../music/presetLibrary';
  import { clipTrack, downloadMidi } from '../../music/midiExport';
  import { launchClockTempo } from '../../stores/launchClock';
  import { showToast } from '../../stores/errorToast';
  import { generateUUID } from '../../utils/uuid';

  const ROW = 13;
  const VELOCITY_LANE = 46;
  const SNAPS = [
    { id: '1/32', beats: 1 / 8 },
    { id: '1/16', beats: 1 / 4 },
    { id: '1/8', beats: 1 / 2 },
    { id: '1/4', beats: 1 },
    { id: 'Off', beats: 0 },
  ];
  const LENGTHS = [1, 2, 3, 4, 6, 8, 12, 16, 32];
  /** Where each kind of part sits when its clip is empty. */
  const TRACK_CENTRE: Record<TrackId, number> = { beats: 48, bass: 36, lead: 72, chords: 60, texture: 60 };

  const s = $derived($musicStudio);
  const id = $derived($clipEditorId);
  const found = $derived(id ? findClip(s.session, id) : null);
  const clip = $derived(found?.clip ?? null);
  const track = $derived(found?.track ?? 'lead');
  const playingIt = $derived(!!clip && (track === 'beats' ? s.sequencerPlaying && $musicTransport.beatLoop === clip.id : s.playingLoops[track] === clip.id));
  const instrument = $derived<InstrumentId>(clip?.kind === 'notes' ? (clip.instrument ?? (track === 'beats' ? 'drums' : ROLE_INSTRUMENTS[s.set][track])) : 'drums');

  let snap = $state(1 / 4);
  let gridWidth = $state(800);
  let range = $state({ lo: 48, hi: 84 });
  let draft = $state<RecordedNote[] | null>(null);
  let position = $state<number | null>(null);
  let lastOpened: string | null = null;

  // A clip that follows the key opens in the studio's key, so what is drawn is what plays.
  $effect(() => {
    if (clip?.kind !== 'notes' || !clip.key) return;
    if (clip.key.root === s.key.root && clip.key.scale === s.key.scale) return;
    musicStudio.updateSessionClip(clip.id, (c) => (c.kind === 'notes' ? { ...c, notes: playableNotes(c, s.key), key: { ...s.key } } : c));
  });

  // Fit the pitch range to the clip each time a different clip opens.
  $effect(() => {
    if (!clip || clip.id === lastOpened) return;
    lastOpened = clip.id;
    if (clip.kind !== 'notes') return;
    const pitches = clip.notes.map((n) => n.note);
    let lo = pitches.length ? Math.min(...pitches) - 5 : TRACK_CENTRE[track] - 12;
    let hi = pitches.length ? Math.max(...pitches) + 7 : TRACK_CENTRE[track] + 12;
    while (hi - lo < 24) {
      lo--;
      hi++;
    }
    range = { lo: Math.max(0, lo), hi: Math.min(127, hi) };
  });

  // The playhead follows the clip while it plays.
  let frame = 0;
  function tick() {
    position = id ? clipPosition(id) : null;
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  onDestroy(() => cancelAnimationFrame(frame));

  const notesClip = $derived(clip?.kind === 'notes' ? (clip as NotesClip) : null);
  const notes = $derived(draft ?? notesClip?.notes ?? []);
  const beats = $derived(clip?.kind === 'notes' ? clip.beats : clip ? clip.pattern.steps / STEPS_PER_BEAT : 4);
  const ppb = $derived(Math.max(8, gridWidth / beats));
  const pitches = $derived(Array.from({ length: range.hi - range.lo + 1 }, (_, i) => range.hi - i));
  const scaleSteps = $derived(SCALES[s.key.scale].steps);
  const inScale = (p: number) => scaleSteps.includes((((p - s.key.root) % 12) + 12) % 12);

  function close() {
    clipEditorId.set(null);
    draft = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && id) {
      e.stopPropagation();
      close();
    }
  }

  function commit(next: RecordedNote[]) {
    if (!notesClip) return;
    const length = notesClip.beats;
    const clean = next
      .filter((n) => n.beat >= 0 && n.beat < length)
      .map((n) => ({ ...n, dur: Math.max(1 / 32, Math.min(n.dur, length - n.beat)) }))
      .sort((a, b) => a.beat - b.beat || a.note - b.note);
    musicStudio.updateSessionClip(notesClip.id, (c) => (c.kind === 'notes' ? { ...c, notes: clean } : c));
  }

  const snapBeat = (b: number) => (snap > 0 ? Math.round(b / snap) * snap : b);
  const snapDown = (b: number) => (snap > 0 ? Math.floor(b / snap + 1e-6) * snap : b);

  function audition(note: number, velocity: number) {
    playNote(instrument, note, velocity, 'screen');
    setTimeout(() => releaseNote(instrument, note, 'screen'), 180);
  }

  // ── Piano roll pointer work ──
  let drag: { mode: 'move' | 'resize' | 'velocity'; index: number; x: number; y: number; beat: number; note: number; dur: number; velocity: number; base: RecordedNote[] } | null = null;

  function local(e: PointerEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
  }

  function rollDown(e: PointerEvent) {
    if (!notesClip || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const p = local(e, el);
    const beat = snapDown(p.x / ppb);
    const note = range.hi - Math.floor(p.y / ROW);
    if (beat >= notesClip.beats || note < range.lo || note > range.hi) return;
    el.setPointerCapture(e.pointerId);
    const base = [...notes];
    const dur = snap > 0 ? snap : 0.25;
    base.push({ beat, dur, note, velocity: 0.8 });
    draft = base;
    drag = { mode: 'resize', index: base.length - 1, x: e.clientX, y: e.clientY, beat, note, dur, velocity: 0.8, base };
    audition(note, 0.8);
  }

  function noteDown(e: PointerEvent, index: number) {
    e.stopPropagation();
    if (e.button === 2 || e.altKey) {
      e.preventDefault();
      commit(notes.filter((_, i) => i !== index));
      return;
    }
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const n = notes[index];
    const r = target.getBoundingClientRect();
    const mode = e.clientX > r.right - 6 ? 'resize' : 'move';
    drag = { mode, index, x: e.clientX, y: e.clientY, beat: n.beat, note: n.note, dur: n.dur, velocity: n.velocity, base: [...notes] };
    draft = [...notes];
    if (mode === 'move') audition(n.note, n.velocity);
  }

  function velocityDown(e: PointerEvent, index: number) {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const n = notes[index];
    drag = { mode: 'velocity', index, x: e.clientX, y: e.clientY, beat: n.beat, note: n.note, dur: n.dur, velocity: n.velocity, base: [...notes] };
    draft = [...notes];
  }

  function pointerMove(e: PointerEvent) {
    if (!drag || !draft) return;
    const dx = (e.clientX - drag.x) / ppb;
    const dy = e.clientY - drag.y;
    const next = [...drag.base];
    const n = { ...next[drag.index] };
    if (drag.mode === 'move') {
      n.beat = Math.max(0, Math.min(beats - (snap || 1 / 32), snapBeat(drag.beat + dx)));
      const pitch = Math.max(range.lo, Math.min(range.hi, drag.note - Math.round(dy / ROW)));
      if (pitch !== n.note) {
        n.note = pitch;
        if (pitch !== draft[drag.index].note) audition(pitch, n.velocity);
      }
    } else if (drag.mode === 'resize') {
      const end = snap > 0 ? Math.max(drag.beat + snap, snapBeat(drag.beat + drag.dur + dx)) : drag.beat + Math.max(1 / 32, drag.dur + dx);
      n.dur = Math.max(1 / 32, end - drag.beat);
    } else {
      n.velocity = Math.max(0.05, Math.min(1, drag.velocity - dy / VELOCITY_LANE));
    }
    next[drag.index] = n;
    draft = next;
  }

  function pointerUp() {
    if (!drag || !draft) return;
    const next = draft;
    drag = null;
    draft = null;
    commit(next);
  }

  // ── Whole-clip edits ──
  function rename(name: string) {
    if (!clip) return;
    musicStudio.updateSessionClip(clip.id, (c) => ({ ...c, name: name.trim() || c.name }));
  }

  function setLength(value: number) {
    if (!notesClip) return;
    musicStudio.updateSessionClip(notesClip.id, (c) =>
      c.kind === 'notes' ? { ...c, beats: value, notes: c.notes.filter((n) => n.beat < value).map((n) => ({ ...n, dur: Math.min(n.dur, value - n.beat) })) } : c,
    );
  }

  function quantize() {
    if (!notesClip || snap <= 0) return;
    commit(notesClip.notes.map((n) => ({ ...n, beat: Math.min(notesClip.beats - snap, Math.round(n.beat / snap) * snap) })));
  }

  function transpose(semitones: number) {
    if (!notesClip) return;
    commit(notesClip.notes.map((n) => ({ ...n, note: Math.max(0, Math.min(127, n.note + semitones)) })));
    range = { lo: Math.max(0, range.lo + semitones), hi: Math.min(127, range.hi + semitones) };
  }

  function clearNotes() {
    commit([]);
  }

  function togglePlay() {
    if (!found) return;
    if (playingIt) stopTrack(found.track);
    else launchClip(found.track, found.row);
  }

  function savePreset() {
    if (!clip || !found) return;
    userPresets.add(found.track, clip, generateUUID());
    showToast(`Added "${clip.name}" to your presets.`, 'info');
  }

  function saveMidi() {
    if (!clip) return;
    downloadMidi({ bpm: Math.round(launchClockTempo() * 10) / 10, tracks: [clipTrack(clip, s.key)] }, clip.name);
  }

  // ── Beat clips ──
  function editPattern(change: (p: DrumPattern) => DrumPattern) {
    if (!clip || clip.kind !== 'beat') return;
    musicStudio.updateSessionClip(clip.id, (c) => (c.kind === 'beat' ? { ...c, pattern: normalizePattern(change(c.pattern)) } : c));
  }

  function stepDown(e: PointerEvent, voice: (typeof DRUM_VOICES)[number], step: number) {
    e.preventDefault();
    const accent = e.button === 2 || e.shiftKey;
    editPattern((p) => {
      const row = [...p.tracks[voice]];
      row[step] = row[step] > 0 && !accent ? 0 : accent ? 1 : 0.8;
      return { ...p, tracks: { ...p.tracks, [voice]: row } };
    });
  }
</script>

<svelte:window onkeydown={onKey} />

{#if clip && found}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="editor studio-tokens" role="dialog" aria-label="Edit {clip.name}">
      <header>
        <button class="play transport" class:on={playingIt} onclick={togglePlay} aria-label={playingIt ? 'Stop the clip' : 'Play the clip'} title={playingIt ? 'Stop' : 'Play from the next bar'}>
          {#if playingIt}<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>{/if}
        </button>
        <input class="name" value={clip.name} onchange={(e) => rename((e.target as HTMLInputElement).value)} aria-label="Clip name" />
        <span class="muted where">{found.track === 'beats' ? 'Beat' : `${found.track[0].toUpperCase()}${found.track.slice(1)}`} · row {found.row + 1}{clip.kind === 'notes' ? ` · ${INSTRUMENT_LABELS[instrument]} · ${keyLabel(s.key)}` : ''}</span>
        <span class="spacer"></span>
        {#if clip.kind === 'notes'}
          <label class="labelled">Length
            <select value={clip.beats} onchange={(e) => setLength(+(e.target as HTMLSelectElement).value)}>
              {#each LENGTHS.includes(clip.beats) ? LENGTHS : [...LENGTHS, clip.beats].sort((a, b) => a - b) as b}<option value={b}>{b % 4 === 0 ? `${b / 4} bar${b === 4 ? '' : 's'}` : `${b} beats`}</option>{/each}
            </select>
          </label>
          <label class="labelled">Snap
            <select value={snap} onchange={(e) => (snap = +(e.target as HTMLSelectElement).value)}>
              {#each SNAPS as g}<option value={g.beats}>{g.id}</option>{/each}
            </select>
          </label>
          <button class="text-btn" onclick={quantize} disabled={snap <= 0} title="Snap every note's start to the grid">Quantize</button>
          <div class="nudge" role="group" aria-label="Transpose">
            <button class="text-btn" onclick={() => transpose(-12)} title="Down an octave">−12</button>
            <button class="text-btn" onclick={() => transpose(-1)} title="Down a semitone">−1</button>
            <button class="text-btn" onclick={() => transpose(1)} title="Up a semitone">+1</button>
            <button class="text-btn" onclick={() => transpose(12)} title="Up an octave">+12</button>
          </div>
          <button class="text-btn" onclick={clearNotes} title="Remove every note">Clear</button>
        {:else}
          <label class="labelled">Steps
            <select value={clip.pattern.steps} onchange={(e) => editPattern((p) => resizePattern(p, +(e.target as HTMLSelectElement).value as PatternLength))}>
              {#each PATTERN_LENGTHS as n}<option value={n}>{n}</option>{/each}
            </select>
          </label>
          <label class="labelled">Swing
            <input type="range" min="0" max="0.5" step="0.01" value={clip.pattern.swing} oninput={(e) => editPattern((p) => ({ ...p, swing: +(e.target as HTMLInputElement).value }))} />
          </label>
        {/if}
        <span class="divider"></span>
        <button class="text-btn" onclick={savePreset} title="Keep this clip in your presets, for every project">Add to my presets</button>
        <button class="text-btn" onclick={saveMidi} title="Save as a MIDI file">MIDI</button>
        <button class="text-btn" onclick={close} title="Close (Esc)">Done</button>
      </header>

      {#if notesClip}
        <div class="roll-wrap">
          <div class="keys" style="height: {pitches.length * ROW}px">
            {#each pitches as p (p)}
              <div class="key" class:black={isBlackKey(p)} class:scale={inScale(p)} class:root={(((p - s.key.root) % 12) + 12) % 12 === 0} style="height: {ROW}px">{p % 12 === 0 || (((p - s.key.root) % 12) + 12) % 12 === 0 ? noteName(p) : ''}</div>
            {/each}
          </div>
          <div
            class="roll"
            bind:clientWidth={gridWidth}
            style="height: {pitches.length * ROW}px; --ppb: {ppb}px; --bar: {ppb * 4}px"
            role="application"
            aria-label="Piano roll"
            onpointerdown={rollDown}
            onpointermove={pointerMove}
            onpointerup={pointerUp}
            onpointercancel={pointerUp}
            oncontextmenu={(e) => e.preventDefault()}
          >
            {#each pitches as p, i (p)}
              <div class="lane" class:black={isBlackKey(p)} class:scale={inScale(p)} style="top: {i * ROW}px; height: {ROW}px"></div>
            {/each}
            <div class="lines"></div>
            {#each notes as n, i (i)}
              <div
                class="note"
                style="left: {n.beat * ppb}px; top: {(range.hi - n.note) * ROW + 1}px; width: {Math.max(4, n.dur * ppb - 1)}px; height: {ROW - 2}px; --v: {n.velocity}"
                role="button"
                tabindex="-1"
                aria-label="{noteName(n.note)} at beat {n.beat + 1}"
                onpointerdown={(e) => noteDown(e, i)}
                onpointermove={pointerMove}
                onpointerup={pointerUp}
                ondblclick={() => commit(notes.filter((_, j) => j !== i))}
              ></div>
            {/each}
            {#if position !== null}<div class="playhead" style="left: {position * ppb}px"></div>{/if}
          </div>
        </div>
        <div class="velocity" style="--ppb: {ppb}px">
          <span class="lane-name ga-eyebrow legend">Vel</span>
          <div class="bars" role="application" aria-label="Velocities" onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp}>
            {#each notes as n, i (i)}
              <div class="vbar" style="left: {n.beat * ppb}px; height: {n.velocity * 100}%" role="slider" aria-label="Velocity of {noteName(n.note)}" aria-valuenow={Math.round(n.velocity * 127)} tabindex="-1" onpointerdown={(e) => velocityDown(e, i)}></div>
            {/each}
          </div>
        </div>
        <p class="hint muted">Click to draw · drag to move · drag the right edge to lengthen · double-click to delete · drag a velocity bar to set how hard it plays</p>
      {:else if clip.kind === 'beat'}
        {@const steps = Array.from({ length: clip.pattern.steps }, (_, i) => i)}
        <div class="beat" style="--steps: {clip.pattern.steps}">
          {#each DRUM_VOICES as voice (voice)}
            <span class="voice">{DRUM_LABELS[voice]}</span>
            <div class="cells">
              {#each steps as step (step)}
                {@const v = clip.pattern.tracks[voice][step]}
                <button
                  class="cell"
                  class:bar={step % 16 === 0}
                  class:beat-start={step % 4 === 0}
                  class:on={v > 0}
                  class:accent={v >= 1}
                  class:now={position !== null && Math.floor(position * STEPS_PER_BEAT) % clip.pattern.steps === step}
                  onpointerdown={(e) => stepDown(e, voice, step)}
                  oncontextmenu={(e) => e.preventDefault()}
                  aria-label="{DRUM_LABELS[voice]} step {step + 1}"
                  aria-pressed={v > 0}
                ></button>
              {/each}
            </div>
          {/each}
        </div>
        <p class="hint muted">Click a step to set it · right-click or Shift-click for an accent</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .editor {
    width: min(1180px, 94vw);
    max-height: min(640px, 86vh);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 12px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge);
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    user-select: none;
  }
  header { display: flex; align-items: center; gap: 8px; white-space: nowrap; flex-wrap: wrap; }
  .name {
    width: 180px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-weight: var(--ga-weight-control, 600);
  }
  .where { font-size: var(--ga-text-meta, 11px); }
  .spacer { flex: 1; }
  .divider { width: 1px; height: 18px; background: var(--studio-edge-soft); }
  .labelled { display: inline-flex; align-items: center; gap: 6px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  header select { height: var(--ga-control-h, 26px); }
  .nudge { display: inline-flex; gap: 2px; }
  .nudge .text-btn { padding: 0 7px; font-variant-numeric: tabular-nums; }
  .text-btn:disabled { opacity: 0.4; cursor: default; }

  .roll-wrap { flex: 1; min-height: 160px; overflow: auto; display: flex; border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius); background: var(--studio-slot); }
  .keys { flex: 0 0 44px; position: sticky; left: 0; z-index: 2; background: var(--studio-cell); border-right: 1px solid var(--studio-edge); }
  .key { box-sizing: border-box; padding-right: 4px; font-family: var(--ga-font-mono, ui-monospace); font-size: 9px; line-height: 13px; text-align: right; color: var(--studio-muted); border-bottom: 1px solid var(--studio-edge-soft); }
  .key.black { background: rgba(0, 0, 0, 0.35); }
  .key.root { color: var(--studio-accent); font-weight: 700; }
  .roll { position: relative; flex: 1; min-width: 0; cursor: crosshair; touch-action: none; }
  .lane { position: absolute; left: 0; right: 0; box-sizing: border-box; border-bottom: 1px solid rgba(255, 255, 255, 0.03); }
  .lane.black { background: rgba(0, 0, 0, 0.28); }
  .lane.scale { background: color-mix(in srgb, var(--studio-accent) 6%, transparent); }
  .lane.black.scale { background: color-mix(in srgb, var(--studio-accent) 5%, rgba(0, 0, 0, 0.28)); }
  .lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, var(--studio-edge) 1px, transparent 1px),
      linear-gradient(to right, var(--studio-edge-soft) 1px, transparent 1px);
    background-size: var(--bar) 100%, var(--ppb) 100%;
  }
  .note {
    position: absolute;
    box-sizing: border-box;
    border-radius: 2px;
    background: color-mix(in srgb, var(--studio-accent) calc(45% + var(--v) * 55%), var(--studio-cell));
    border: 1px solid var(--studio-accent);
    cursor: grab;
    touch-action: none;
  }
  .note::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 5px; cursor: ew-resize; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--studio-ink); opacity: 0.7; pointer-events: none; }
  .velocity { display: flex; gap: 0; height: 46px; }
  .lane-name { flex: 0 0 44px; padding-top: 2px; }
  .bars { position: relative; flex: 1; border-top: 1px solid var(--studio-edge-soft); border-bottom: 1px solid var(--studio-edge-soft); touch-action: none; }
  .vbar { position: absolute; bottom: 0; width: 5px; margin-left: -2px; background: var(--studio-accent); border-radius: 1px 1px 0 0; cursor: ns-resize; }
  .hint { margin: 0; font-size: var(--ga-text-meta, 11px); }

  .beat { display: grid; grid-template-columns: 70px 1fr; gap: 4px 8px; align-items: center; }
  .voice { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .cells { display: grid; grid-template-columns: repeat(var(--steps), minmax(0, 1fr)); gap: 2px; }
  .cell { height: 22px; padding: 0; border: 1px solid var(--studio-edge-soft); background: var(--studio-cell); border-radius: 2px; cursor: pointer; }
  .cell.beat-start { border-color: var(--studio-edge); }
  .cell.on { background: color-mix(in srgb, var(--studio-accent) 70%, var(--studio-cell)); border-color: var(--studio-accent); }
  .cell.accent { background: var(--studio-accent); }
  .cell.now { outline: 1px solid var(--studio-ink); outline-offset: -1px; }
</style>
