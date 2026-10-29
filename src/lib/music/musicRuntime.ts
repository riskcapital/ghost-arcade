/**
 * The running music studio.
 *
 * Every input (letter keys, on-screen keys, MIDI, the step sequencer, take
 * replay) becomes a NoteEvent and goes through `send()`, which keeps count of
 * held notes and puts the event on the note bus. On the bus:
 *  - the audio engine plays it,
 *  - the note visuals queue it for the shader inputs,
 *  - the recorder captures it while a take is recording,
 *  - the panel lights the key or pad.
 *
 * The sequencer and replay schedule a little ahead on the audio clock, so
 * timing does not depend on frame rate. Once a frame, the visuals advance to
 * the audio clock and their values are written into every playing VJ shader
 * clip that declares note inputs.
 */

import { get } from 'svelte/store';
import { vjClipLauncher, type VJDeck } from '../stores/vjClipLauncher';
import { launchClockPosition, launchClockTempo, nextLaunchBoundary } from '../stores/launchClock';
import { parseISF } from '../isf/parser';
import { generateUUID } from '../utils/uuid';
import { MusicAudioEngine } from './audioEngine';
import {
  DRUM_NOTES,
  DRUM_VOICES,
  HeldNotes,
  INSTRUMENTS,
  noteBus,
  noteOff,
  noteOn,
  type DrumVoice,
  type InstrumentId,
  type NoteEvent,
  type NoteSource,
} from './noteEvents';
import { NOTE_DRIVEN_INPUTS, NOTE_MODE_INPUT, NoteVisualState } from './noteVisuals';
import { TakeRecorder, takeEventsBetween, type Take } from './recording';
import { patternHasHits, stepAt, stepsBetween } from './drumPattern';
import { drumPadForKey } from './keyboardLayout';
import { attachMusicKeyboard, musicKeysArmed } from './musicKeyboard';
import { DRUM_CHANNEL, MusicMidiInput, type MidiNoteMessage } from './midiNotes';
import { musicStudio, musicTransport, nextTakeName, type MusicStudioState } from './musicStudioStore';
import { captureScene, dominantColumn, nextSceneName, sceneLaunchActions, type PlayingNow } from './scenes';
import { macros } from '../stores/macros';
import {
  ACID_STEPS,
  bowlNotes,
  chordNotes,
  instrumentsThroughFx,
  snapToScale,
} from './studioSets';

/** How far ahead the sequencer and replay schedule, in seconds. */
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;
/** Live notes start this far after "now" so a burst of input keeps its spacing. */
const LIVE_OFFSET_SECONDS = 0.005;
/** How long a drum pad stays lit in the panel. */
const PAD_FLASH_MS = 110;

const audio = new MusicAudioEngine();
const visuals = new NoteVisualState();
const recorder = new TakeRecorder();
const held = new HeldNotes();

let started = false;
let midi: MusicMidiInput | null = null;
let detachKeyboard: (() => void) | null = null;
let frameHandle: number | null = null;
let schedulerHandle: ReturnType<typeof setInterval> | null = null;
let visualsWereActive = false;

/** Letter key code → the note it started. */
const keyboardNotes = new Map<string, { instrument: InstrumentId; note: number }>();
/** Pointer id → the note it started on the on-screen keys. */
const screenNotes = new Map<number, { instrument: InstrumentId; note: number }>();
/** MIDI notes down, and those the sustain pedal is holding. */
const midiHeld = new Set<string>();
const midiSustained = new Set<string>();
let sustainDown = false;

let sequencer: { scheduledBeat: number; usedInTake: boolean } | null = null;
let replay: { take: Take; origin: number; cursor: number; loop: boolean; held: Set<string> } | null = null;

const heldKey = (instrument: InstrumentId, note: number) => `${instrument}:${note}`;

// ── The note path ───────────────────────────────────────────────────────

function send(event: NoteEvent): void {
  // Melodic notes are counted per pitch so two sources holding one note
  // release cleanly; only the first on and the last off reach the bus.
  if (event.instrument !== 'drums' && !held.apply(event)) return;
  noteBus.emit(event);
}

noteBus.subscribe((event) => {
  audio.play(event);
  visuals.push(event);
  recorder.capture(event);
  showInPanel(event);
  ensureFrameLoop();
});

function showInPanel(event: NoteEvent): void {
  const key = heldKey(event.instrument, event.note);
  if (event.instrument === 'drums') {
    if (event.type !== 'on') return;
    const delay = Math.max(0, (event.time - (audio.peekNow() ?? event.time)) * 1000);
    setTimeout(() => {
      musicTransport.update((s) => ({ ...s, held: new Set(s.held).add(key) }));
      setTimeout(() => {
        musicTransport.update((s) => {
          const next = new Set(s.held);
          next.delete(key);
          return { ...s, held: next };
        });
      }, PAD_FLASH_MS);
    }, delay);
    return;
  }
  musicTransport.update((s) => {
    const next = new Set(s.held);
    if (event.type === 'on') next.add(key);
    else next.delete(key);
    return { ...s, held: next };
  });
}

function liveTime(): number {
  return audio.now() + LIVE_OFFSET_SECONDS;
}

/** Play a note from a live input. */
export function playNote(instrument: InstrumentId, note: number, velocity: number, source: NoteSource): void {
  ensureMusicRuntime();
  send(noteOn(instrument, note, velocity, source, liveTime()));
}

export function releaseNote(instrument: InstrumentId, note: number, source: NoteSource): void {
  send(noteOff(instrument, note, source, liveTime()));
}

export function hitDrum(voice: DrumVoice, velocity: number, source: NoteSource = 'screen'): void {
  playNote('drums', DRUM_NOTES[voice], velocity, source);
}

/** On-screen keys: a pointer pressed a key. */
export function screenNoteOn(pointerId: number, note: number): void {
  const s = get(musicStudio);
  screenNoteOff(pointerId);
  screenNotes.set(pointerId, { instrument: s.instrument, note });
  playNote(s.instrument, note, s.velocity, 'screen');
}

/** On-screen keys: a pointer let go, or slid off its key. */
export function screenNoteOff(pointerId: number): void {
  const n = screenNotes.get(pointerId);
  if (!n) return;
  screenNotes.delete(pointerId);
  releaseNote(n.instrument, n.note, 'screen');
}

/** Release everything: live inputs, sustain, replay and every sounding voice. */
export function panic(): void {
  for (const [code] of keyboardNotes) releaseKeyboardNote(code);
  for (const [id] of screenNotes) screenNoteOff(id);
  releaseMidi();
  stopTake();
  const time = audio.peekNow() ?? 0;
  for (const { instrument, note } of held.all()) noteBus.emit(noteOff(instrument, note, 'keyboard', time));
  held.clear();
  audio.allNotesOff();
  visuals.releaseAll();
  musicTransport.update((s) => ({ ...s, held: new Set() }));
}

/** With scale lock on, the drone and bowls never play a note outside the key. */
function lockToKey(instrument: InstrumentId, note: number): number {
  const s = get(musicStudio);
  return s.scaleLock && (instrument === 'drone' || instrument === 'bowls') ? snapToScale(note, s.key) : note;
}

// ── Letter keys ─────────────────────────────────────────────────────────

function keyboardNoteOn(note: number, code: string): void {
  const s = get(musicStudio);
  let pitch = note;
  if (s.instrument === 'drums') {
    const pad = drumPadForKey(code);
    if (pad === null) return;
    pitch = DRUM_NOTES[DRUM_VOICES[pad]];
  }
  pitch = lockToKey(s.instrument, pitch);
  keyboardNotes.set(code, { instrument: s.instrument, note: pitch });
  playNote(s.instrument, pitch, s.velocity, 'keyboard');
}

function releaseKeyboardNote(code: string): void {
  const n = keyboardNotes.get(code);
  if (!n) return;
  keyboardNotes.delete(code);
  releaseNote(n.instrument, n.note, 'keyboard');
}

function syncKeyboard(s: MusicStudioState): void {
  const armed = s.isOpen && s.keysArmed;
  musicKeysArmed.set(armed);
  if (armed && !detachKeyboard) {
    detachKeyboard = attachMusicKeyboard({
      octave: () => get(musicStudio).octave,
      noteOn: keyboardNoteOn,
      noteOff: releaseKeyboardNote,
      shiftOctave: (delta) => musicStudio.shiftOctave(delta),
      shiftVelocity: (delta) => musicStudio.shiftVelocity(delta),
      releaseAll: () => { for (const [code] of keyboardNotes) releaseKeyboardNote(code); },
    });
  } else if (!armed && detachKeyboard) {
    detachKeyboard();
    detachKeyboard = null;
  }
}

// ── MIDI ────────────────────────────────────────────────────────────────

function onMidi(message: MidiNoteMessage): void {
  if (message.kind === 'sustain') {
    sustainDown = message.down;
    if (!sustainDown) {
      for (const key of [...midiSustained]) {
        midiSustained.delete(key);
        if (midiHeld.has(key)) continue;
        const [instrument, note] = key.split(':');
        releaseNote(instrument as InstrumentId, Number(note), 'midi');
      }
    }
    return;
  }
  if (message.kind === 'allOff') {
    releaseMidi();
    return;
  }
  // Channel 10 plays the kit, as on any GM device; other channels play the selected instrument.
  const selected = get(musicStudio).instrument;
  const instrument: InstrumentId = message.channel === DRUM_CHANNEL ? 'drums' : selected;
  if (message.kind === 'on') {
    const note = lockToKey(instrument, message.note);
    const key = heldKey(instrument, note);
    midiHeld.add(key);
    midiSustained.delete(key);
    playNote(instrument, note, message.velocity, 'midi');
    return;
  }
  const key = heldKey(instrument, lockToKey(instrument, message.note));
  // Note-offs are matched to whichever instrument (and snapped note) started the note.
  const startedAs = midiHeld.has(key) ? key : [...midiHeld].find((k) => k.endsWith(`:${message.note}`)) ?? key;
  midiHeld.delete(startedAs);
  const [inst, startedNote] = startedAs.split(':');
  if (inst === 'drums') return;
  if (sustainDown) {
    midiSustained.add(startedAs);
    return;
  }
  releaseNote(inst as InstrumentId, Number(startedNote), 'midi');
}

function releaseMidi(): void {
  const keys = new Set([...midiHeld, ...midiSustained]);
  midiHeld.clear();
  midiSustained.clear();
  sustainDown = false;
  for (const key of keys) {
    const [instrument, note] = key.split(':');
    if (instrument !== 'drums') releaseNote(instrument as InstrumentId, Number(note), 'midi');
  }
}

// ── Chords and bowls ────────────────────────────────────────────────────

let chord: { degree: number; notes: number[] } | null = null;

/** Play a scale-locked chord on the drone. It holds until the next chord or a release. */
export function playChord(degree: number, velocity = 0.8): void {
  ensureMusicRuntime();
  const s = get(musicStudio);
  const notes = chordNotes(s.key, degree, 48);
  const previous = chord;
  chord = { degree, notes };
  for (const note of notes) {
    if (!previous?.notes.includes(note)) playNote('drone', note, velocity, 'screen');
  }
  // Notes the chords share keep ringing; the rest let go.
  for (const note of previous?.notes ?? []) {
    if (!notes.includes(note)) releaseNote('drone', note, 'screen');
  }
  musicTransport.update((t) => ({ ...t, chord: degree }));
}

export function releaseChord(): void {
  if (!chord) return;
  for (const note of chord.notes) releaseNote('drone', note, 'screen');
  chord = null;
  musicTransport.update((t) => ({ ...t, chord: null }));
}

/** Strike one of the five bowls, tuned to the key. Holding keeps it lit; it rings on regardless. */
export function strikeBowl(index: number, velocity = 0.85): number | null {
  const note = bowlNotes(get(musicStudio).key)[index];
  if (note === undefined) return null;
  playNote('bowls', note, velocity, 'screen');
  return note;
}

export function releaseBowl(note: number): void {
  releaseNote('bowls', note, 'screen');
}

// ── Sequencer ───────────────────────────────────────────────────────────

export function startSequencer(): void {
  ensureMusicRuntime();
  audio.now();
  // The pattern runs on the VJ launch clock's beats, so it stays in phase
  // with quantized launches, Link and the tapped tempo.
  sequencer = { scheduledBeat: launchClockPosition().beat, usedInTake: get(musicStudio).recording };
  musicStudio.setTransport({ sequencerPlaying: true });
  ensureScheduler();
  ensureFrameLoop();
}

export function stopSequencer(): void {
  sequencer = null;
  if (acidHeld !== null) send(noteOff('acid', acidHeld, 'sequencer', audio.peekNow() ?? 0));
  acidHeld = null;
  musicStudio.setTransport({ sequencerPlaying: false });
  musicTransport.update((s) => ({ ...s, step: -1 }));
}

function scheduleSequencer(): void {
  if (!sequencer) return;
  const s = get(musicStudio);
  const now = audio.now();
  const { beat, beatMs } = launchClockPosition();
  // A clock jump (resync, a newly detected beat) skips ahead rather than
  // firing every step in between.
  if (beat - sequencer.scheduledBeat > 1 || sequencer.scheduledBeat - beat > 2) sequencer.scheduledBeat = beat;
  const horizon = beat + (LOOKAHEAD_SECONDS * 1000) / beatMs;
  if (horizon <= sequencer.scheduledBeat) return;
  const timeAt = (b: number) => Math.max(now, now + ((b - beat) * beatMs) / 1000);
  for (const step of stepsBetween(s.pattern, sequencer.scheduledBeat, horizon)) {
    if (s.drumMutes.includes(step.voice)) continue;
    send(noteOn('drums', step.note, step.velocity, 'sequencer', timeAt(step.beat)));
  }
  if (s.set === 'berlin') scheduleAcid(sequencer.scheduledBeat, horizon, timeAt);
  sequencer.scheduledBeat = horizon;
  if (s.recording && patternHasHits(s.pattern)) sequencer.usedInTake = true;
}

/** Root of the acid row: C2. */
const ACID_ROOT = 36;
let acidHeld: number | null = null;

/** The acid row plays sixteenths with the beat; a glide ties into the next note. */
function scheduleAcid(fromBeat: number, toBeat: number, timeAt: (beat: number) => number): void {
  const steps = get(musicStudio).acidSteps;
  for (let k = Math.ceil(fromBeat * 4 - 1e-9); k < toBeat * 4; k++) {
    const beatPos = k / 4;
    const step = steps[((k % ACID_STEPS) + ACID_STEPS) % ACID_STEPS];
    const time = timeAt(beatPos);
    if (step.note === null) {
      if (acidHeld !== null) send(noteOff('acid', acidHeld, 'sequencer', time));
      acidHeld = null;
      continue;
    }
    const note = ACID_ROOT + step.note;
    const previous = acidHeld;
    if (previous !== null && !step.glide) send(noteOff('acid', previous, 'sequencer', time));
    send(noteOn('acid', note, step.accent ? 1 : 0.75, 'sequencer', time));
    // A glide keeps the voice: the old note ends as the new one slides in.
    if (previous !== null && step.glide && previous !== note) send(noteOff('acid', previous, 'sequencer', time));
    acidHeld = note;
    // Untied notes end before the next sixteenth.
    const next = steps[(((k + 1) % ACID_STEPS) + ACID_STEPS) % ACID_STEPS];
    if (!(next.glide && next.note !== null)) {
      send(noteOff('acid', note, 'sequencer', timeAt(beatPos + 0.16)));
      acidHeld = null;
    }
  }
}

// ── Recording ───────────────────────────────────────────────────────────

export function startRecording(): void {
  ensureMusicRuntime();
  recorder.start(audio.now());
  if (sequencer) sequencer.usedInTake = true;
  musicStudio.setTransport({ recording: true, recordingSince: performance.now() });
}

/** Finish the take and keep it. Returns the take, or null when nothing was played. */
export function stopRecording(): Take | null {
  if (!recorder.recording) return null;
  const s = get(musicStudio);
  const usedPattern = sequencer?.usedInTake ?? false;
  if (sequencer) sequencer.usedInTake = false;
  const take = recorder.stop(audio.now(), {
    id: generateUUID(),
    name: nextTakeName(s.takes),
    bpm: Math.round(launchClockTempo() * 10) / 10,
    pattern: usedPattern ? s.pattern : null,
  });
  musicStudio.setTransport({ recording: false, recordingSince: null });
  if (take) musicStudio.addTake(take);
  return take;
}

export function recordingElapsed(): number {
  return recorder.elapsed(audio.peekNow() ?? 0);
}

// ── Replay ──────────────────────────────────────────────────────────────

export function playTake(id: string, loop = false): void {
  ensureMusicRuntime();
  const take = get(musicStudio).takes.find((t) => t.id === id);
  if (!take) return;
  stopTake();
  const origin = audio.now() + 0.05;
  replay = { take, origin, cursor: origin, loop, held: new Set() };
  musicStudio.setTransport({ playingTakeId: id, loopTake: loop });
  ensureScheduler();
  ensureFrameLoop();
}

export function stopTake(): void {
  if (!replay) return;
  const { held: sounding, cursor } = replay;
  replay = null;
  // Notes already scheduled up to the cursor end there, so nothing started
  // in the look-ahead is left ringing.
  for (const key of sounding) {
    const [instrument, note] = key.split(':');
    send(noteOff(instrument as InstrumentId, Number(note), 'replay', cursor));
  }
  musicStudio.setTransport({ playingTakeId: null });
  musicTransport.update((s) => ({ ...s, takeProgress: 0 }));
}

function scheduleReplay(): void {
  if (!replay) return;
  const now = audio.now();
  const horizon = now + LOOKAHEAD_SECONDS;
  const { take, origin, loop } = replay;
  if (horizon > replay.cursor) {
    for (const e of takeEventsBetween(take, origin, replay.cursor, horizon, loop)) {
      const key = heldKey(e.instrument, e.note);
      if (e.type === 'on') {
        if (e.instrument !== 'drums') replay.held.add(key);
        send(noteOn(e.instrument, e.note, e.velocity, 'replay', e.time));
      } else {
        replay.held.delete(key);
        send(noteOff(e.instrument, e.note, 'replay', e.time));
      }
    }
    replay.cursor = horizon;
  }
  if (!loop && now >= origin + take.length) stopTake();
}

// ── Scenes ──────────────────────────────────────────────────────────────

/** Beats per bar for scene launches. */
const SCENE_GRID_BEATS = 4;
let sceneTimer: ReturnType<typeof setTimeout> | null = null;

function playingNow(): PlayingNow {
  const s = get(musicStudio);
  const launcher = get(vjClipLauncher);
  return {
    pattern: s.pattern,
    beat: s.sequencerPlaying,
    takeId: s.playingTakeId,
    vjColumn: dominantColumn(launcher.layerStates.map((ls) => (ls?.activeClip ? ls.activeColumn : null))),
  };
}

/** Save what is playing (beat, loop, visuals) as a new scene. */
export function captureCurrentScene(): void {
  const s = get(musicStudio);
  musicStudio.addScene(captureScene(generateUUID(), nextSceneName(s.scenes), playingNow()));
}

/**
 * Launch a scene on the next bar. With nothing playing there is nothing to
 * keep in time with, so it starts at once. Launching the queued scene again
 * starts it at once too.
 */
export function launchScene(id: string): void {
  ensureMusicRuntime();
  const s = get(musicStudio);
  if (!s.scenes.some((sc) => sc.id === id)) return;
  const now = playingNow();
  const idle = !now.beat && !now.takeId;
  if (sceneTimer) clearTimeout(sceneTimer);
  sceneTimer = null;
  if (idle || s.queuedSceneId === id) {
    applyScene(id);
    return;
  }
  musicStudio.setTransport({ queuedSceneId: id });
  const wait = Math.max(0, nextLaunchBoundary(SCENE_GRID_BEATS) - performance.now());
  sceneTimer = setTimeout(() => {
    sceneTimer = null;
    applyScene(id);
  }, wait);
}

function applyScene(id: string): void {
  const s = get(musicStudio);
  const scene = s.scenes.find((sc) => sc.id === id);
  musicStudio.setTransport({ queuedSceneId: null });
  if (!scene) return;
  const takeIds = new Set(s.takes.map((t) => t.id));
  for (const action of sceneLaunchActions(scene, playingNow(), takeIds)) {
    if (action.kind === 'pattern') musicStudio.setPattern(action.pattern);
    else if (action.kind === 'beat') (action.play ? startSequencer : stopSequencer)();
    else if (action.kind === 'take') {
      if (action.takeId) playTake(action.takeId, true);
      else stopTake();
    } else vjClipLauncher.triggerColumnNow(action.column, 'A');
  }
  musicStudio.setTransport({ sceneId: id });
}

function cancelQueuedScene(): void {
  if (sceneTimer) clearTimeout(sceneTimer);
  sceneTimer = null;
  musicStudio.setTransport({ queuedSceneId: null, sceneId: null });
}

// ── Clocks ──────────────────────────────────────────────────────────────

function ensureScheduler(): void {
  if (schedulerHandle !== null) return;
  const tick = () => {
    if (!sequencer && !replay) {
      clearInterval(schedulerHandle!);
      schedulerHandle = null;
      return;
    }
    try {
      scheduleSequencer();
      scheduleReplay();
    } catch (err) {
      console.warn('[Music] scheduler failed:', err);
    }
  };
  schedulerHandle = setInterval(tick, SCHEDULER_INTERVAL_MS);
  tick();
}

function ensureFrameLoop(): void {
  if (frameHandle !== null || typeof requestAnimationFrame === 'undefined') return;
  frameHandle = requestAnimationFrame(frame);
}

function frame(): void {
  frameHandle = null;
  const now = audio.peekNow();
  if (now !== null) {
    visuals.advance(now);
    const active = visuals.isActive();
    // One last write after the visuals go quiet leaves the clips at rest.
    if (active || visualsWereActive) writeNoteInputs();
    visualsWereActive = active;
    routeControlCables();
    publishTransport(now);
  }
  const s = get(musicStudio);
  if (s.isOpen || sequencer || replay || visualsWereActive) frameHandle = requestAnimationFrame(frame);
}

function publishTransport(now: number): void {
  const s = get(musicStudio);
  const step = sequencer ? stepAt(s.pattern, launchClockPosition().beat) : -1;
  const progress = replay && replay.take.length > 0
    ? Math.max(0, Math.min(1, (replay.loop ? (now - replay.origin) % replay.take.length : now - replay.origin) / replay.take.length))
    : 0;
  const t = get(musicTransport);
  if (t.step !== step || Math.abs(t.takeProgress - progress) > 0.002) {
    musicTransport.set({ ...t, step, takeProgress: progress });
  }
}

// ── Control cables ──────────────────────────────────────────────────────

/** Layers a cable is pulsing, with the opacity to put back when it is unplugged. */
const pulsedLayers = new Map<number, number>();
const lastSent = new Map<string, number>();

/** The current 0-1 value of a control output. */
function controlValue(jack: string, params: Record<string, number>): number {
  const name = jack.slice(3);
  if (name === 'xy.x' || name === 'xy.y') return params[name] ?? 0.5;
  if (name === 'drone.level') return visuals.instrumentLevel('drone');
  if (name === 'bowls.ring') return visuals.instrumentLevel('bowls');
  if (name === 'acid.level') return visuals.instrumentLevel('acid');
  if (name === 'acid.cutoff') return Math.min(1, (params['acid.cutoff'] ?? 0.35) * (0.4 + 0.6 * visuals.instrumentLevel('acid')) * 1.6);
  if (name.startsWith('drum.')) return visuals.drumLevel(name.slice(5) as DrumVoice);
  return 0;
}

function routeControlCables(): void {
  const s = get(musicStudio);
  const cables = s.studioView ? s.cables[s.set] : [];
  const live = new Set<number>();
  for (const cable of cables) {
    if (!cable.from.startsWith('cv:')) continue;
    const value = controlValue(cable.from, s.params);
    const previous = lastSent.get(cable.to);
    if (previous !== undefined && Math.abs(previous - value) < 0.004) {
      if (cable.to.startsWith('dest:layer:')) live.add(Number(cable.to.slice(11)));
      continue;
    }
    lastSent.set(cable.to, value);
    if (cable.to.startsWith('dest:macro:')) {
      macros.setMacroValue(cable.to.slice(11), value);
    } else if (cable.to.startsWith('dest:layer:')) {
      const layer = Number(cable.to.slice(11));
      live.add(layer);
      if (!pulsedLayers.has(layer)) pulsedLayers.set(layer, get(vjClipLauncher).layerStates[layer]?.opacity ?? 1);
      // A pulse: dim between hits, full on the hit.
      vjClipLauncher.setLayerOpacity(layer, (pulsedLayers.get(layer) ?? 1) * (0.08 + 0.92 * value), 'A');
    }
  }
  for (const [layer, base] of pulsedLayers) {
    if (live.has(layer)) continue;
    pulsedLayers.delete(layer);
    lastSent.delete(`dest:layer:${layer}`);
    vjClipLauncher.setLayerOpacity(layer, base, 'A');
  }
  for (const key of [...lastSent.keys()]) {
    if (!cables.some((c) => c.to === key)) lastSent.delete(key);
  }
}

/**
 * The knobs as the sound engine hears them: the XY pad morphs the drone
 * against the bowls (X) and opens the space (Y) on top of the knob settings.
 */
function soundParams(s: MusicStudioState): Record<string, number> {
  if (s.set !== 'bath') return s.params;
  const y = s.params['xy.y'] ?? 0.5;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    ...s.params,
    'fx.reverb.mix': clamp((s.params['fx.reverb.mix'] ?? 0.5) + (y - 0.5) * 0.7),
    'fx.shimmer.mix': clamp((s.params['fx.shimmer.mix'] ?? 0.35) + (y - 0.5) * 0.6),
    'fx.reverb.space': clamp((s.params['fx.reverb.space'] ?? 0.85) + (y - 0.5) * 0.3),
  };
}

function morphedVolumes(s: MusicStudioState): Record<InstrumentId, number> {
  if (s.set !== 'bath') return s.volumes;
  const x = s.params['xy.x'] ?? 0.5;
  return {
    ...s.volumes,
    drone: s.volumes.drone * Math.min(1, 2 * (1 - x)),
    bowls: s.volumes.bowls * Math.min(1, 2 * x),
  };
}

// ── Shader clips ────────────────────────────────────────────────────────

interface ClipNoteInputs {
  driven: string[];
  /** The shader's default noteMode, when it declares one. */
  modeDefault: number;
}

const inputCache = new Map<string, ClipNoteInputs>();
const NO_NOTE_INPUTS: ClipNoteInputs = { driven: [], modeDefault: 0 };

/** Which note inputs a shader declares. Parsed once per shader source. */
export function noteInputsForShader(code: string): ClipNoteInputs {
  const cached = inputCache.get(code);
  if (cached) return cached;
  let result = NO_NOTE_INPUTS;
  try {
    const inputs = parseISF(code).metadata.INPUTS ?? [];
    const declared = new Set(inputs.map((i) => i.NAME));
    const driven = NOTE_DRIVEN_INPUTS.filter((name) => declared.has(name));
    const mode = inputs.find((i) => i.NAME === NOTE_MODE_INPUT);
    if (driven.length) result = { driven, modeDefault: Number(mode?.DEFAULT) || 0 };
  } catch {
    result = NO_NOTE_INPUTS;
  }
  if (inputCache.size > 200) inputCache.clear();
  inputCache.set(code, result);
  return result;
}

function writeNoteInputs(): void {
  const launcher = get(vjClipLauncher);
  const byMode = new Map<number, Record<string, number>>();
  const decks: [VJDeck, typeof launcher.layerStates][] = [['A', launcher.layerStates], ['B', launcher.bankBLayerStates]];
  for (const [deck, states] of decks) {
    states?.forEach((state, layer) => {
      const clip = state?.activeClip;
      if (!clip || clip.type !== 'shader' || !clip.shaderCode) return;
      const info = noteInputsForShader(clip.shaderCode);
      if (!info.driven.length) return;
      const mode = Math.round(Number(clip.shaderValues?.[NOTE_MODE_INPUT] ?? info.modeDefault) || 0);
      let values = byMode.get(mode);
      if (!values) {
        values = visuals.inputs(mode);
        byMode.set(mode, values);
      }
      const picked: Record<string, number> = {};
      for (const name of info.driven) picked[name] = values[name];
      vjClipLauncher.batchUpdateShaderValues(layer, picked, deck);
    });
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/**
 * Closing the studio stops it: a take being recorded is kept, then the beat,
 * replay and every sounding note stop. Minimizing the panel keeps playing.
 */
function stopEverything(): void {
  cancelQueuedScene();
  releaseChord();
  if (recorder.recording) stopRecording();
  if (sequencer) stopSequencer();
  stopTake();
  panic();
}

let wasOpen = false;

/** Start listening to the studio's settings. Safe to call repeatedly. */
export function ensureMusicRuntime(): void {
  if (started) return;
  started = true;
  musicStudio.subscribe((s) => {
    if (wasOpen && !s.isOpen) {
      wasOpen = false;
      stopEverything();
    }
    wasOpen = s.isOpen;
    audio.setSynthPatch(s.synthPatch);
    audio.setKeysPatch(s.keysPatch);
    const volumes = morphedVolumes(s);
    for (const id of INSTRUMENTS) audio.setVolume(id, volumes[id]);
    audio.setParams(soundParams(s));
    audio.setRouting(s.set, instrumentsThroughFx(s.cables[s.set]));
    audio.setMasterVolume(s.masterVolume);
    visuals.setSettings(s.visuals);
    syncKeyboard(s);
    if (s.isOpen && !midi) {
      // MIDI keeps playing once the studio has been opened, panel shown or not.
      midi = new MusicMidiInput(onMidi);
      void midi.start();
    }
    midi?.select(s.midiInput);
    if (s.isOpen) ensureFrameLoop();
    // A project load stops the transport in the store; follow it here.
    if (!s.sequencerPlaying && sequencer) stopSequencer();
    if (!s.playingTakeId && replay) stopTake();
    if (!s.recording && recorder.recording) recorder.cancel();
  });
}
