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
import { getNativeRendererFrameSnapshot } from '../api/native-renderer';
import {
  LOOP_ROLES,
  ROLE_INSTRUMENTS,
  beatPattern,
  isBeatLoop,
  loopById,
  loopNotesBetween,
  nextBar,
  type BeatLoop,
  type LoopRole,
  type MelodicLoop,
} from './loops';
import { SCAN_PARTIALS, columnBands, scanPosition } from './scanSynth';
import type { AnalogDest, AnalogSource } from './analogSynth';
import {
  ACID_STEPS,
  bowlNotes,
  chordNotes,
  instrumentsThroughFx,
  scaleNote,
  snapToScale,
  type StudioSet,
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

/** Chords held on the drone, by scale degree. Several can ring at once. */
const chords = new Map<number, { notes: number[]; velocity: number }>();

function publishChords(): void {
  musicTransport.update((t) => ({ ...t, chords: [...chords.keys()].sort((x, y) => x - y) }));
}

function holdChord(degree: number, velocity: number): void {
  const notes = chordNotes(get(musicStudio).key, degree, 48);
  chords.set(degree, { notes, velocity });
  // A note another held chord already plays is counted, not restarted.
  for (const note of notes) playNote('drone', note, velocity, 'screen');
}

function letGoOfChord(degree: number): void {
  const chord = chords.get(degree);
  if (!chord) return;
  chords.delete(degree);
  for (const note of chord.notes) releaseNote('drone', note, 'screen');
}

/**
 * Tap a chord pad: a chord not held starts and keeps ringing, a held one
 * lets go. Chords layer, and every one is built from the key.
 */
export function toggleChord(degree: number, velocity = 0.8): void {
  ensureMusicRuntime();
  if (chords.has(degree)) letGoOfChord(degree);
  else holdChord(degree, velocity);
  publishChords();
}

/** Let go of every held chord. */
export function releaseChords(): void {
  for (const degree of [...chords.keys()]) letGoOfChord(degree);
  publishChords();
}

/** A new key re-voices the held chords so they stay in it. */
function revoiceChords(): void {
  const held = [...chords.entries()];
  for (const [degree] of held) letGoOfChord(degree);
  for (const [degree, chord] of held) holdChord(degree, chord.velocity);
  publishChords();
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
    loops: { ...s.playingLoops },
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
  const idle = !now.beat && !now.takeId && !loopSlots.size;
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
    } else if (action.kind === 'visuals') vjClipLauncher.triggerColumnNow(action.column, 'A');
    else {
      // The scene lands on the bar already, so its loops start now.
      for (const role of LOOP_ROLES) {
        const id = action.loops[role];
        if (id) launchLoop(id, true);
        else stopLoop(role);
      }
    }
  }
  musicStudio.setTransport({ sceneId: id });
}

function cancelQueuedScene(): void {
  if (sceneTimer) clearTimeout(sceneTimer);
  sceneTimer = null;
  musicStudio.setTransport({ queuedSceneId: null, sceneId: null });
}

// ── Loop library ────────────────────────────────────────────────────────

interface LoopSlot {
  loop: MelodicLoop;
  instrument: InstrumentId;
  startBeat: number;
  /** Where scheduling has reached, in launch-clock beats. */
  scheduledBeat: number;
  /** Set when another loop takes over the slot: play up to here, then end. */
  stopBeat: number | null;
  /** Notes started whose ends are still ahead, to cut if the loop stops early. */
  pending: Array<{ note: number; offBeat: number }>;
  announced: boolean;
}

const loopSlots = new Map<LoopRole, LoopSlot>();
const endingSlots: LoopSlot[] = [];
let beatLoopTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Launch a library loop. With music playing it starts on the next bar
 * (taking over its slot from the loop there). With nothing playing, or with
 * `now` (a scene already on the bar), it joins the current bar at once, so it
 * still sits on the same bar lines as the beat.
 */
export function launchLoop(id: string, now = false): void {
  ensureMusicRuntime();
  audio.now();
  const loop = loopById(id);
  if (!loop) return;
  if (isBeatLoop(loop)) {
    launchBeatLoop(loop, now);
    return;
  }
  const s = get(musicStudio);
  const { beat } = launchClockPosition();
  const busy = !!sequencer || !!replay || loopSlots.size > 0;
  const startBeat = busy && !now ? nextBar(beat) : Math.floor(beat / 4 + 1e-6) * 4;
  const from = Math.max(startBeat, beat);
  const old = loopSlots.get(loop.role);
  if (old) {
    old.stopBeat = from;
    endingSlots.push(old);
  }
  loopSlots.set(loop.role, {
    loop,
    instrument: ROLE_INSTRUMENTS[s.set][loop.role],
    startBeat,
    scheduledBeat: from,
    stopBeat: null,
    pending: [],
    announced: false,
  });
  musicStudio.setTransport({ queuedLoops: { ...s.queuedLoops, [loop.role]: id } });
  ensureScheduler();
  ensureFrameLoop();
}

function launchBeatLoop(loop: BeatLoop, now: boolean): void {
  if (beatLoopTimer) clearTimeout(beatLoopTimer);
  beatLoopTimer = null;
  const apply = () => {
    beatLoopTimer = null;
    musicStudio.setPattern(beatPattern(loop));
    musicTransport.update((t) => ({ ...t, beatLoop: loop.id, queuedBeat: null }));
    if (!sequencer) startSequencer();
  };
  if (!sequencer || now) {
    apply();
    return;
  }
  musicTransport.update((t) => ({ ...t, queuedBeat: loop.id }));
  const wait = Math.max(0, nextLaunchBoundary(4) - performance.now() - 10);
  beatLoopTimer = setTimeout(apply, wait);
}

/** Stop the loop in a slot (and one handing over to it); notes they were holding let go now. */
export function stopLoop(role: LoopRole): void {
  const beat = launchClockPosition().beat;
  const slot = loopSlots.get(role);
  if (slot) endLoopSlot(slot, beat);
  loopSlots.delete(role);
  for (let i = endingSlots.length - 1; i >= 0; i--) {
    if (endingSlots[i].loop.role !== role) continue;
    endLoopSlot(endingSlots[i], beat);
    endingSlots.splice(i, 1);
  }
  const s = get(musicStudio);
  const playing = { ...s.playingLoops };
  const queued = { ...s.queuedLoops };
  delete playing[role];
  delete queued[role];
  musicStudio.setTransport({ playingLoops: playing, queuedLoops: queued });
}

export function stopAllLoops(): void {
  for (const role of [...loopSlots.keys()]) stopLoop(role);
  for (const slot of endingSlots.splice(0)) endLoopSlot(slot, launchClockPosition().beat);
  if (beatLoopTimer) clearTimeout(beatLoopTimer);
  beatLoopTimer = null;
  musicTransport.update((t) => ({ ...t, queuedBeat: null }));
}

/** A set change hands each playing loop to the new set's instrument for its part. */
function retargetLoops(set: StudioSet): void {
  const beat = launchClockPosition().beat;
  for (const [role, slot] of loopSlots) {
    const instrument = ROLE_INSTRUMENTS[set][role];
    if (instrument === slot.instrument) continue;
    endLoopSlot(slot, beat);
    slot.instrument = instrument;
  }
}

function endLoopSlot(slot: LoopSlot, atBeat: number): void {
  const time = audio.peekNow() ?? 0;
  for (const p of slot.pending) {
    if (p.offBeat > atBeat) send(noteOff(slot.instrument, p.note, 'sequencer', time));
  }
  slot.pending = [];
}

function scheduleLoops(beat: number, horizon: number, timeAt: (b: number) => number): void {
  const s = get(musicStudio);
  const announce: Partial<Record<LoopRole, string>> = {};
  const schedule = (slot: LoopSlot) => {
    const until = slot.stopBeat === null ? horizon : Math.min(horizon, slot.stopBeat);
    if (until > slot.scheduledBeat) {
      for (const n of loopNotesBetween(slot.loop, s.key, slot.startBeat, slot.scheduledBeat, until)) {
        const offBeat = slot.stopBeat === null ? n.beat + n.dur : Math.min(n.beat + n.dur, slot.stopBeat);
        send(noteOn(slot.instrument, n.note, n.velocity, 'sequencer', timeAt(n.beat)));
        send(noteOff(slot.instrument, n.note, 'sequencer', timeAt(offBeat)));
        slot.pending.push({ note: n.note, offBeat });
      }
      slot.scheduledBeat = until;
    }
    slot.pending = slot.pending.filter((p) => p.offBeat > beat);
  };
  for (const [role, slot] of loopSlots) {
    schedule(slot);
    if (!slot.announced && beat >= slot.startBeat - 0.01) {
      slot.announced = true;
      announce[role] = slot.loop.id;
    }
  }
  for (let i = endingSlots.length - 1; i >= 0; i--) {
    const slot = endingSlots[i];
    schedule(slot);
    if (slot.stopBeat !== null && beat >= slot.stopBeat) endingSlots.splice(i, 1);
  }
  if (Object.keys(announce).length) {
    const queued = { ...s.queuedLoops };
    for (const role of Object.keys(announce) as LoopRole[]) delete queued[role];
    musicStudio.setTransport({ playingLoops: { ...s.playingLoops, ...announce }, queuedLoops: queued });
  }
}

function scheduleLoopWindow(): void {
  if (!loopSlots.size && !endingSlots.length) return;
  const now = audio.now();
  const { beat, beatMs } = launchClockPosition();
  const horizon = beat + (LOOKAHEAD_SECONDS * 1000) / beatMs;
  scheduleLoops(beat, horizon, (b) => Math.max(now, now + ((b - beat) * beatMs) / 1000));
}

// ── Dub controls ────────────────────────────────────────────────────────

let throwHeld = false;
let dropHeld = false;

/** Hold the siren (or latch it); it sounds through whatever its cable reaches. */
export function setSiren(on: boolean): void {
  ensureMusicRuntime();
  if (on) playNote('siren', 72, 0.85, 'screen');
  else releaseNote('siren', 72, 'screen');
}

/** Fire one of the eight shots. */
export function triggerShot(index: number, velocity = 0.85): void {
  ensureMusicRuntime();
  playNote('shots', 60 + index, velocity, 'screen');
  setTimeout(() => releaseNote('shots', 60 + index, 'screen'), 160);
}

/** A dub throw: while held, everything in the echo chamber floods the tape echo. */
export function setThrow(on: boolean): void {
  throwHeld = on;
  refreshSound();
}

/** A drop: while held, the drums and bass cut out and the echoes carry the tune. */
export function setDrop(on: boolean): void {
  dropHeld = on;
  refreshSound();
}

function refreshSound(): void {
  const s = get(musicStudio);
  const volumes = morphedVolumes(s);
  for (const id of INSTRUMENTS) audio.setVolume(id, volumes[id]);
  audio.setParams(soundParams(s));
}

// ── Analog patching ─────────────────────────────────────────────────────

const ANALOG_SOURCES = new Set(['cv:analog.lfo', 'cv:analog.env', 'cv:analog.vco2']);

/** Cables between the analog synth's own jacks become audio-rate routes. */
function syncAnalogRoutes(s: MusicStudioState): void {
  const routes = s.cables.analog
    .filter((c) => ANALOG_SOURCES.has(c.from) && c.to.startsWith('dest:analog.'))
    .map((c) => ({ from: c.from.slice(10) as AnalogSource, to: c.to.slice(12) as AnalogDest }));
  audio.setAnalogRoutes(s.set === 'analog' ? routes : []);
}

// ── Scan synth ──────────────────────────────────────────────────────────

let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanBusy = false;
let scanLevel = 0;
const SCAN_INTERVAL_MS = 90;

const midiToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

/** Start or stop the scan synth reading the live output. */
export function setScan(on: boolean): void {
  ensureMusicRuntime();
  musicStudio.setTransport({ scanOn: on });
  audio.scanRunning(on);
  if (on && !scanTimer) {
    scanTimer = setInterval(() => void scanTick(), SCAN_INTERVAL_MS);
  } else if (!on && scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
    scanLevel = 0;
  }
}

async function scanTick(): Promise<void> {
  if (scanBusy) return;
  scanBusy = true;
  try {
    const s = get(musicStudio);
    const x = scanPosition(launchClockPosition().beat, s.params['scan.speed'] ?? 0.5);
    const snap = await getNativeRendererFrameSnapshot(true, { max_dim: 48 });
    if (!snap?.rgba_b64 || !snap.width || !snap.height) return;
    const raw = atob(snap.rgba_b64);
    const pixels = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) pixels[i] = raw.charCodeAt(i);
    const bands = columnBands(pixels, snap.width, snap.height, pixels.length / snap.height, x, SCAN_PARTIALS);
    // Bands climb the key from the pitch knob's octave; spread widens the steps.
    const base = 24 + Math.round((s.params['scan.pitch'] ?? 0.4) * 36);
    const step = 0.5 + (s.params['scan.spread'] ?? 0.5) * 1.5;
    const freqs = bands.map((_, i) => midiToHz(scaleNote(s.key, Math.round(i * step), base)));
    audio.scanPlay(freqs, bands, s.params['scan.level'] ?? 0.6);
    scanLevel = bands.reduce((a, b) => a + b, 0) / bands.length;
  } catch {
    // No native frame to read (browser preview): the synth stays quiet.
  } finally {
    scanBusy = false;
  }
}

// ── Clocks ──────────────────────────────────────────────────────────────

function ensureScheduler(): void {
  if (schedulerHandle !== null) return;
  const tick = () => {
    if (!sequencer && !replay && !loopSlots.size && !endingSlots.length) {
      clearInterval(schedulerHandle!);
      schedulerHandle = null;
      return;
    }
    try {
      scheduleSequencer();
      scheduleReplay();
      scheduleLoopWindow();
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
    syncMacroFx();
    publishTransport(now);
  }
  const s = get(musicStudio);
  if (s.isOpen || sequencer || replay || loopSlots.size || visualsWereActive) frameHandle = requestAnimationFrame(frame);
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
  if (name === 'analog.lfo') return audio.analogLfo();
  if (name === 'analog.env' || name === 'analog.vco2' || name === 'analog.level') return visuals.instrumentLevel('analog');
  if (name === 'dubbass.level') return visuals.instrumentLevel('dubbass');
  if (name === 'siren.level') return visuals.instrumentLevel('siren');
  if (name === 'shots.level') return visuals.instrumentLevel('shots');
  if (name === 'scan.level') return scanLevel;
  return 0;
}

let macroSyncAt = 0;

/** Hand the macros' sound effects their knob values (and the tempo, for synced delays). */
function syncMacroFx(force = false): void {
  const now = performance.now();
  if (!force && now - macroSyncAt < 250) return;
  macroSyncAt = now;
  const s = get(musicStudio);
  const values = new Map(get(macros).macros.map((m) => [m.id, m.value]));
  audio.setMacroFx(
    get(macros).macros.map((m) => ({ macroValue: values.get(m.id) ?? 0, effects: s.macroFx[m.id] ?? [] })),
    launchClockTempo(),
  );
}

function routeControlCables(): void {
  const s = get(musicStudio);
  const cables = s.studioView ? s.cables[s.set] : [];
  const live = new Set<number>();
  for (const cable of cables) {
    if (!cable.from.startsWith('cv:')) continue;
    // The analog synth's own sources reach its inputs at audio rate instead.
    if (ANALOG_SOURCES.has(cable.from) && cable.to.startsWith('dest:analog.')) continue;
    const value = controlValue(cable.from, s.params);
    const previous = lastSent.get(cable.to);
    if (previous !== undefined && Math.abs(previous - value) < 0.004) {
      if (cable.to.startsWith('dest:layer:')) live.add(Number(cable.to.slice(11)));
      continue;
    }
    lastSent.set(cable.to, value);
    if (cable.to.startsWith('dest:macro:')) {
      macros.setMacroValue(cable.to.slice(11), value);
    } else if (cable.to.startsWith('dest:analog.')) {
      audio.setAnalogExternal(cable.to.slice(12) as AnalogDest, value);
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
    if (cables.some((c) => c.to === key)) continue;
    lastSent.delete(key);
    if (key.startsWith('dest:analog.')) audio.setAnalogExternal(key.slice(12) as AnalogDest, null);
  }
}

/**
 * The knobs as the sound engine hears them: the XY pad morphs the drone
 * against the bowls (X) and opens the space (Y) on top of the knob settings.
 */
function soundParams(s: MusicStudioState): Record<string, number> {
  if (s.set === 'dub' && throwHeld) {
    return {
      ...s.params,
      'fx.echo.mix': 1,
      'fx.echo.feedback': Math.min(1, (s.params['fx.echo.feedback'] ?? 0.6) + 0.25),
    };
  }
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
  if (s.set === 'dub' && dropHeld) return { ...s.volumes, drums: 0, dubbass: 0 };
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
  stopAllLoops();
  setScan(false);
  throwHeld = false;
  dropHeld = false;
  releaseChords();
  if (recorder.recording) stopRecording();
  if (sequencer) stopSequencer();
  stopTake();
  panic();
}

let wasOpen = false;
let macroSubscribed = false;
let lastKey = '';
let lastSet: StudioSet | null = null;

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
    const keySig = `${s.key.root}:${s.key.scale}`;
    if (keySig !== lastKey) {
      lastKey = keySig;
      if (chords.size) revoiceChords();
    }
    if (s.set !== lastSet) {
      lastSet = s.set;
      retargetLoops(s.set);
    }
    const volumes = morphedVolumes(s);
    for (const id of INSTRUMENTS) audio.setVolume(id, volumes[id]);
    audio.setParams(soundParams(s));
    audio.setRouting(s.set, instrumentsThroughFx(s.cables[s.set]));
    syncAnalogRoutes(s);
    syncMacroFx(true);
    audio.setMasterVolume(s.masterVolume);
    visuals.setSettings(s.visuals);
    syncKeyboard(s);
    if (!macroSubscribed) {
      macroSubscribed = true;
      // A turned macro moves its sound at once, not on the next quarter second.
      macros.subscribe(() => syncMacroFx(true));
    }
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
    const loopsInStore = Object.keys(s.playingLoops).length + Object.keys(s.queuedLoops).length;
    if (!loopsInStore && loopSlots.size) stopAllLoops();
    if (!s.recording && recorder.recording) recorder.cancel();
  });
}
