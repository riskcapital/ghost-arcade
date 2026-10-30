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
  drumVoiceForNote,
  noteBus,
  noteOff,
  noteOn,
  type DrumVoice,
  type InstrumentId,
  type NoteEvent,
  type NoteSource,
} from './noteEvents';
import { NOTE_DRIVEN_INPUTS, NOTE_MODE_INPUT, NoteVisualState } from './noteVisuals';
import {
  VOICE_AUTO_INPUT,
  VOICE_DRIVEN_INPUTS,
  VOICE_SOURCE_INPUT,
  VoiceSignals,
  sourcesForEvent,
  voiceSourceAt,
  type SourceContext,
} from './visualVoices';
import { TakeRecorder, takeEventsBetween, type Take } from './recording';
import { STEPS_PER_BEAT, patternBeats, patternHasHits, stepAt, stepsBetween, type DrumPattern } from './drumPattern';
import {
  BEATS_PER_BAR,
  CAPTURE_WINDOW_BEATS,
  EARLY_GRACE_BEATS,
  PlayedNotes,
  capturePhrase,
  nextRecordedName,
  quantizeBeats,
  recordedLoopLabel,
  recordedNotesBetween,
  roleForRecording,
  takeLoop,
  writeHits,
  type LoopTake,
  type RecordedLoop,
} from './loopRecorder';
import { drumPadForKey } from './keyboardLayout';
import { attachMusicKeyboard, musicKeysArmed } from './musicKeyboard';
import { DRUM_CHANNEL, MusicMidiInput, type MidiNoteMessage } from './midiNotes';
import { LOOP_REC_OFF, musicStudio, musicTransport, nextTakeName, type MusicStudioState, type MusicTransportState } from './musicStudioStore';
import { captureScene, dominantColumn, nextSceneName, sceneLaunchActions, type PlayingNow } from './scenes';
import { macros } from '../stores/macros';
import { getNativeRendererFrameSnapshot } from '../api/native-renderer';
import {
  LOOP_ROLES,
  ROLE_INSTRUMENTS,
  beatPattern,
  loopById,
  loopNotesBetween,
  nextBar,
  type LoopRole,
  type MelodicLoop,
} from './loops';
import { SCAN_PARTIALS, columnBands, scanPosition } from './scanSynth';
import { TRACK_IDS, clipFromRecording, clipLoop, findClip, type Session, type SessionClip, type TrackId } from './session';
import type { AnalogDest, AnalogSource } from './analogSynth';
import type { ChannelId } from './mixer';
import { LiveInput } from './liveInput';
import type { VoiceSourceId } from './visualVoices';
import {
  ACID_STEPS,
  bowlNotes,
  chordNotes,
  AUDIO_SOURCES,
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
const voices = new VoiceSignals();
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
  voices.push(event, sourcesForEvent(event, sourceContext()));
  recorder.capture(event);
  trackPlayed(event);
  showInPanel(event);
  ensureFrameLoop();
});

/** Which instruments play which part now, for the visual voices. */
function sourceContext(): SourceContext {
  const s = get(musicStudio);
  const roles: SourceContext['roles'] = {};
  for (const role of LOOP_ROLES) {
    const list: InstrumentId[] = [ROLE_INSTRUMENTS[s.set][role]];
    const slot = loopSlots.get(role);
    if (slot && !list.includes(slot.instrument)) list.push(slot.instrument);
    roles[role] = list;
  }
  return { played: s.instrument, roles };
}

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
  repeats.clear();
  for (const [code] of keyboardNotes) releaseKeyboardNote(code);
  for (const [id] of screenNotes) screenNoteOff(id);
  releaseMidi();
  stopTake();
  const time = audio.peekNow() ?? 0;
  for (const { instrument, note } of held.all()) noteBus.emit(noteOff(instrument, note, 'keyboard', time));
  held.clear();
  audio.allNotesOff();
  visuals.releaseAll();
  voices.releaseAll();
  musicTransport.update((s) => ({ ...s, held: new Set() }));
}

// ── Transport ───────────────────────────────────────────────────────────

/** What Stop stopped, so Play brings the same music back. */
let resumable: { beat: boolean; loops: string[] } | null = null;

/** Stop every part (beat, loops, take, held notes); effect tails ring out. */
export function stopAll(): void {
  const s = get(musicStudio);
  const loops = Object.values(s.playingLoops).filter((id): id is string => !!id);
  if (sequencer || loops.length) resumable = { beat: !!sequencer, loops };
  cancelQueuedScene();
  stopAllLoops();
  if (sequencer) stopSequencer();
  releaseChords();
  setSiren(false);
  panic();
}

/** Start the music again: what Stop stopped, or the beat when there is nothing to bring back. */
export function playAll(): void {
  ensureMusicRuntime();
  const back = resumable;
  resumable = null;
  if (!back || back.beat || !back.loops.length) startSequencer();
  for (const id of back?.loops ?? []) launchLoop(id, true);
}

/** Silence everything at once, effect tails included. */
export function killAll(): void {
  stopAll();
  resumable = null;
  audio.kill();
}

/** A new set starts clean: what was playing stops and its echoes fade out. */
function freshSet(): void {
  cancelQueuedScene();
  stopAllLoops();
  if (sequencer) stopSequencer();
  releaseChords();
  setSiren(false);
  panic();
  resumable = null;
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
    // A hit just recorded onto this step was already heard live.
    if (heardLive.delete(`${step.voice}:${Math.round(step.beat * STEPS_PER_BEAT)}`)) continue;
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
  loop: MelodicLoop | RecordedLoop;
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
  const s = get(musicStudio);
  const found = findClip(s.session, id);
  if (found) {
    startClip(found.track, found.clip, now);
    return;
  }
  // A factory preset that is not in the session (a scene saved before it was).
  const loop = loopById(id);
  if (!loop) return;
  if ('rows' in loop) launchBeatLoop(beatPattern(loop), loop.id, now);
  else startMelodic(loop, ROLE_INSTRUMENTS[s.set][loop.role], now);
}

/** Where a playing clip is now, in beats from its start (null when its track is not playing it). */
export function clipPosition(id: string): number | null {
  const { beat } = launchClockPosition();
  for (const slot of loopSlots.values()) {
    if (slot.loop.id !== id || beat < slot.startBeat || slot.loop.beats <= 0) continue;
    return (beat - slot.startBeat) % slot.loop.beats;
  }
  if (sequencer && get(musicTransport).beatLoop === id) {
    const pattern = get(musicStudio).pattern;
    return ((beat % patternBeats(pattern)) + patternBeats(pattern)) % patternBeats(pattern);
  }
  return null;
}

/** Launch the clip in a session slot. */
export function launchClip(track: TrackId, row: number, now = false): void {
  ensureMusicRuntime();
  audio.now();
  const clip = get(musicStudio).session[track]?.[row];
  if (clip) startClip(track, clip, now);
}

/** Launch a session row across every track; tracks with an empty slot in the row stop. */
export function launchRow(row: number): void {
  ensureMusicRuntime();
  const s = get(musicStudio);
  for (const track of TRACK_IDS) {
    const clip = s.session[track][row];
    if (clip) startClip(track, clip, false);
    else stopTrack(track);
  }
}

/** Stop one track. */
export function stopTrack(track: TrackId): void {
  if (track === 'beats') {
    if (sequencer) stopSequencer();
    musicTransport.update((t) => ({ ...t, queuedBeat: null }));
  } else {
    stopLoop(track);
  }
}

function startClip(track: TrackId, clip: SessionClip, now: boolean): void {
  const s = get(musicStudio);
  if (clip.kind === 'beat') launchBeatLoop(clip.pattern, clip.id, now);
  else if (track !== 'beats') {
    const loop = clipLoop(clip, track, s.set, s.key);
    startMelodic(loop, loop.instrument, now);
  }
}

/**
 * Start a melodic loop in its part's slot. With music playing it starts on
 * the next bar (taking over from the loop there); with nothing playing, or
 * with `now` (a scene already on the bar), it joins the current bar at once,
 * so it still sits on the same bar lines as the beat.
 */
function startMelodic(loop: MelodicLoop | RecordedLoop, instrument: InstrumentId, now: boolean): void {
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
    instrument,
    startBeat,
    scheduledBeat: from,
    stopBeat: null,
    pending: [],
    announced: false,
  });
  musicStudio.setTransport({ queuedLoops: { ...s.queuedLoops, [loop.role]: loop.id } });
  ensureScheduler();
  ensureFrameLoop();
}

/**
 * Follow edits and key changes in playing clips: a melodic clip plays its
 * new notes from the next note on; a beat clip edited in its editor loads
 * into the grid, and grid edits go back into the playing beat clip.
 */
function syncPlayingClips(s: MusicStudioState, sessionChanged: boolean, patternChanged: boolean): void {
  for (const [role, slot] of loopSlots) {
    const found = findClip(s.session, slot.loop.id);
    if (!found || found.clip.kind !== 'notes') continue;
    const next = clipLoop(found.clip, role, s.set, s.key);
    if (next.instrument !== slot.instrument) endLoopSlot(slot, launchClockPosition().beat);
    slot.loop = next;
    slot.instrument = next.instrument;
  }
  const beatId = get(musicTransport).beatLoop;
  if (!beatId) return;
  const beat = findClip(s.session, beatId);
  if (!beat || beat.clip.kind !== 'beat' || beat.clip.pattern === s.pattern) return;
  if (sessionChanged) musicStudio.setPattern(beat.clip.pattern);
  else if (patternChanged) musicStudio.updateSessionClip(beatId, (c) => (c.kind === 'beat' ? { ...c, pattern: s.pattern } : c));
}

function isRecorded(loop: MelodicLoop | RecordedLoop): loop is RecordedLoop {
  return 'kind' in loop && loop.kind === 'recorded';
}

function launchBeatLoop(pattern: DrumPattern, id: string, now: boolean): void {
  if (beatLoopTimer) clearTimeout(beatLoopTimer);
  beatLoopTimer = null;
  const apply = () => {
    beatLoopTimer = null;
    musicStudio.setPattern(pattern);
    musicTransport.update((t) => ({ ...t, beatLoop: id, queuedBeat: null }));
    if (!sequencer) startSequencer();
  };
  if (!sequencer || now) {
    apply();
    return;
  }
  musicTransport.update((t) => ({ ...t, queuedBeat: id }));
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
      const notes = isRecorded(slot.loop)
        ? recordedNotesBetween(slot.loop, slot.startBeat, slot.scheduledBeat, until)
        : loopNotesBetween(slot.loop, s.key, slot.startBeat, slot.scheduledBeat, until);
      for (const n of notes) {
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

// ── Loop recorder ───────────────────────────────────────────────────────

/** Live playing, kept for capture and for the recording window. */
const played = new PlayedNotes();
let loopRec: { startBeat: number; endBeat: number | null; clickBeat: number } | null = null;
/** Grid steps a live hit was just recorded onto, `${voice}:${absolute step}`: the sequencer skips them once. */
const heardLive = new Set<string>();

const isLive = (source: NoteSource) => source === 'keyboard' || source === 'screen' || source === 'midi';

/** Launch-clock beat at an audio-clock time. */
function beatAtTime(time: number): number {
  const { beat, beatMs } = launchClockPosition();
  const now = audio.peekNow() ?? time;
  return beat + ((time - now) * 1000) / beatMs;
}

function trackPlayed(event: NoteEvent): void {
  if (!isLive(event.source)) return;
  const beat = beatAtTime(event.time);
  if (event.instrument === 'drums') {
    if (event.type !== 'on') return;
    const voice = event.drum ?? drumVoiceForNote(event.note);
    played.hit(voice, event.note, event.velocity, beat);
    if (loopRec && beat >= loopRec.startBeat - EARLY_GRACE_BEATS) recordHit(voice, event.velocity, beat);
  } else if (event.type === 'on') {
    played.noteOn(event.instrument, event.note, event.velocity, beat);
  } else {
    played.noteOff(event.instrument, event.note, beat);
  }
  played.forgetBefore(beat - CAPTURE_WINDOW_BEATS);
}

/** Touch drumming while recording writes each hit into the beat grid, which keeps playing it. */
function recordHit(voice: DrumVoice, velocity: number, beat: number): void {
  const s = get(musicStudio);
  const beats = loopRec?.endBeat != null ? loopRec.endBeat - loopRec.startBeat : 0;
  musicStudio.setPattern(writeHits(s.pattern, [{ beat, voice, velocity }], beats));
  const step = Math.round(beat * STEPS_PER_BEAT);
  if (sequencer && step / STEPS_PER_BEAT >= sequencer.scheduledBeat) heardLive.add(`${voice}:${step}`);
  if (!sequencer) startSequencer();
}

/**
 * Record button: the first press counts in to the next bar and records the
 * set number of bars (or until pressed again, ending on a bar line). A press
 * during the count-in cancels.
 */
export function toggleLoopRecord(): void {
  ensureMusicRuntime();
  audio.now();
  const { beat } = launchClockPosition();
  if (loopRec) {
    if (beat < loopRec.startBeat) {
      loopRec = null;
    } else {
      const end = Math.max(loopRec.startBeat + BEATS_PER_BAR, nextBar(beat));
      loopRec.endBeat = loopRec.endBeat === null ? end : Math.min(loopRec.endBeat, end);
    }
    publishLoopRec(beat);
    return;
  }
  const s = get(musicStudio);
  const startBeat = nextBar(beat + 1e-3);
  loopRec = {
    startBeat,
    endBeat: s.recordLength ? startBeat + s.recordLength * BEATS_PER_BAR : null,
    clickBeat: Math.ceil(beat),
  };
  heardLive.clear();
  publishLoopRec(beat);
  ensureScheduler();
  ensureFrameLoop();
}

/**
 * Keep what was just played without having recorded it: the latest phrase,
 * in whole bars, starts looping at once in step with the clock.
 * Returns how many loops it made (a beat counts as one), 0 if nothing was played.
 */
export function captureLoop(): number {
  ensureMusicRuntime();
  audio.now();
  const { beat } = launchClockPosition();
  const phrase = capturePhrase(played.all(), beat);
  if (!phrase) return 0;
  const s = get(musicStudio);
  const take = takeLoop(played.between(phrase.startBeat, phrase.startBeat + phrase.beats), phrase.startBeat, phrase.beats, quantizeBeats(s.quantize));
  // What was kept is used up: the next capture starts from new playing.
  played.clear();
  return keepTake(take, beat, true);
}

/** Keep the beat grid as a clip in the beat track's first empty slot, and play it from there. */
export function saveBeat(): void {
  const s = get(musicStudio);
  const id = generateUUID();
  const names = s.session.beats.filter((c): c is SessionClip => !!c);
  musicStudio.addSessionClip('beats', { kind: 'beat', id, name: nextRecordedName(names, 'Beat'), pattern: s.pattern });
  musicTransport.update((t) => ({ ...t, beatLoop: id }));
}

/** After drumming into the grid, the beat lives in a clip: the playing one, or a new one. */
function keepBeatInSession(): void {
  const beatId = get(musicTransport).beatLoop;
  if (beatId && findClip(get(musicStudio).session, beatId)) return;
  saveBeat();
}

/** Turn a take into recorded loops that start repeating from `fromBeat`; drums go into the grid. */
function keepTake(take: LoopTake, fromBeat: number, writeDrums: boolean): number {
  let made = 0;
  const s = get(musicStudio);
  const kept: RecordedLoop[] = [];
  for (const [instrument, notes] of take.melodic) {
    if (!notes.length) continue;
    const loop: RecordedLoop = {
      kind: 'recorded',
      id: generateUUID(),
      name: nextRecordedName([...sessionClips(s.session), ...kept], recordedLoopLabel(instrument)),
      role: roleForRecording(instrument, notes),
      instrument,
      beats: take.beats,
      notes,
      createdAt: Date.now(),
    };
    kept.push(loop);
  }
  for (const loop of kept) {
    musicStudio.addSessionClip(loop.role, clipFromRecording(loop));
    startRecordedLoop(loop, take.startBeat, fromBeat);
    made++;
  }
  if (writeDrums && take.hits.length) {
    musicStudio.setPattern(writeHits(get(musicStudio).pattern, take.hits, take.beats));
    if (!sequencer) startSequencer();
    made++;
  }
  if (take.hits.length) keepBeatInSession();
  return made;
}

function sessionClips(session: Session): SessionClip[] {
  return TRACK_IDS.flatMap((t) => session[t].filter((c): c is SessionClip => !!c));
}

/** A recorded loop takes its slot at once, in phase with where it was played. */
function startRecordedLoop(loop: RecordedLoop, startBeat: number, fromBeat: number): void {
  const old = loopSlots.get(loop.role);
  if (old) {
    old.stopBeat = fromBeat;
    endingSlots.push(old);
  }
  loopSlots.set(loop.role, {
    loop,
    instrument: loop.instrument,
    startBeat,
    scheduledBeat: fromBeat,
    stopBeat: null,
    pending: [],
    announced: true,
  });
  const s = get(musicStudio);
  const queued = { ...s.queuedLoops };
  delete queued[loop.role];
  musicStudio.setTransport({ playingLoops: { ...s.playingLoops, [loop.role]: loop.id }, queuedLoops: queued });
  ensureScheduler();
  ensureFrameLoop();
}

/** The count-in and recording clicks, and the end of a recording. */
function scheduleLoopRecorder(): void {
  if (!loopRec) return;
  const now = audio.now();
  const { beat, beatMs } = launchClockPosition();
  if (loopRec.endBeat !== null && beat >= loopRec.endBeat - 0.02) {
    finishLoopRecord(loopRec.startBeat, loopRec.endBeat);
    return;
  }
  // Clicks count in, and keep time while recording when nothing else plays.
  const quiet = !sequencer && !loopSlots.size && !replay;
  const horizon = beat + (LOOKAHEAD_SECONDS * 1000) / beatMs;
  for (let b = Math.max(loopRec.clickBeat, Math.ceil(beat - 1e-6)); b < horizon; b++) {
    if (b < loopRec.startBeat || quiet) audio.click(Math.max(now, now + ((b - beat) * beatMs) / 1000), b % BEATS_PER_BAR === 0);
    loopRec.clickBeat = b + 1;
  }
}

function finishLoopRecord(startBeat: number, endBeat: number): void {
  loopRec = null;
  heardLive.clear();
  const s = get(musicStudio);
  const take = takeLoop(played.between(startBeat, endBeat), startBeat, endBeat - startBeat, quantizeBeats(s.quantize));
  played.clear();
  // Drums were written into the grid as they were played.
  keepTake(take, endBeat, false);
  publishLoopRec(launchClockPosition().beat);
}

function publishLoopRec(beat: number): void {
  const next: MusicTransportState['loopRec'] = loopRec
    ? { phase: beat < loopRec.startBeat ? 'count' : 'rec', startBeat: loopRec.startBeat, endBeat: loopRec.endBeat, beat }
    : LOOP_REC_OFF;
  const t = get(musicTransport);
  if (t.loopRec.phase === next.phase && t.loopRec.endBeat === next.endBeat && t.loopRec.startBeat === next.startBeat && Math.abs(t.loopRec.beat - next.beat) < 0.02) return;
  musicTransport.set({ ...t, loopRec: next });
}

function cancelLoopRecord(): void {
  loopRec = null;
  heardLive.clear();
  publishLoopRec(0);
}

// ── Pads ────────────────────────────────────────────────────────────────

/** What a pad plays: a kit voice, or one of the shots. */
export type PadSound = { kind: 'drum'; voice: DrumVoice } | { kind: 'shot'; index: number };

/** Note repeat rates, in beats. */
export const REPEAT_RATES = [
  { id: '1/8', beats: 1 / 2 },
  { id: '1/16', beats: 1 / 4 },
  { id: '1/32', beats: 1 / 8 },
  { id: '1/8T', beats: 1 / 3 },
  { id: '1/16T', beats: 1 / 6 },
] as const;

const SHOT_LENGTH_SECONDS = 0.16;
/** Pads held with note repeat on, by pointer. */
const repeats = new Map<number, { sound: PadSound; velocity: number; rate: number; nextBeat: number }>();

function firePad(sound: PadSound, velocity: number, time: number): void {
  if (sound.kind === 'drum') {
    send(noteOn('drums', DRUM_NOTES[sound.voice], velocity, 'screen', time));
    return;
  }
  send(noteOn('shots', 60 + sound.index, velocity, 'screen', time));
  send(noteOff('shots', 60 + sound.index, 'screen', time + SHOT_LENGTH_SECONDS));
}

/** A pad pressed: it plays now, and with a repeat rate keeps playing on that grid while held. */
export function padDown(pointerId: number, sound: PadSound, velocity: number, repeatRate = 0): void {
  ensureMusicRuntime();
  firePad(sound, velocity, liveTime());
  if (repeatRate > 0) {
    const { beat } = launchClockPosition();
    repeats.set(pointerId, { sound, velocity, rate: repeatRate, nextBeat: (Math.floor(beat / repeatRate + 1e-6) + 1) * repeatRate });
    ensureScheduler();
  }
}

export function padUp(pointerId: number): void {
  repeats.delete(pointerId);
}

function scheduleRepeats(): void {
  if (!repeats.size) return;
  const now = audio.now();
  const { beat, beatMs } = launchClockPosition();
  const horizon = beat + (LOOKAHEAD_SECONDS * 1000) / beatMs;
  for (const hold of repeats.values()) {
    // After a clock jump, pick up from the next grid line rather than catching up.
    if (beat - hold.nextBeat > hold.rate) hold.nextBeat = (Math.floor(beat / hold.rate) + 1) * hold.rate;
    for (; hold.nextBeat < horizon; hold.nextBeat += hold.rate) {
      firePad(hold.sound, hold.velocity, Math.max(now, now + ((hold.nextBeat - beat) * beatMs) / 1000));
    }
  }
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
    if (!sequencer && !replay && !loopSlots.size && !endingSlots.length && !loopRec && !repeats.size) {
      clearInterval(schedulerHandle!);
      schedulerHandle = null;
      return;
    }
    try {
      scheduleSequencer();
      scheduleReplay();
      scheduleLoopWindow();
      scheduleLoopRecorder();
      scheduleRepeats();
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
    const { beat, beatMs } = launchClockPosition();
    voices.advance(now, { beat, beatSeconds: beatMs / 1000 });
    const active = visuals.isActive();
    // One last write after the note visuals go quiet leaves those clips at
    // rest; visual voices follow the clock, so they are written every frame.
    writeNoteInputs(active || visualsWereActive);
    visualsWereActive = active;
    routeControlCables();
    syncMacroFx();
    publishTransport(now);
    if (loopRec) publishLoopRec(launchClockPosition().beat);
  }
  const s = get(musicStudio);
  if (s.isOpen || sequencer || replay || loopSlots.size || loopRec || visualsWereActive) frameHandle = requestAnimationFrame(frame);
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
  /** Visual voice inputs it declares, and its defaults for which sound it follows and auto. */
  voice: string[];
  sourceDefault: number;
  autoDefault: number;
}

const inputCache = new Map<string, ClipNoteInputs>();
const NO_NOTE_INPUTS: ClipNoteInputs = { driven: [], modeDefault: 0, voice: [], sourceDefault: 0, autoDefault: 1 };

/** Which note inputs a shader declares. Parsed once per shader source. */
export function noteInputsForShader(code: string): ClipNoteInputs {
  const cached = inputCache.get(code);
  if (cached) return cached;
  let result = NO_NOTE_INPUTS;
  try {
    const inputs = parseISF(code).metadata.INPUTS ?? [];
    const declared = new Set(inputs.map((i) => i.NAME));
    const driven = NOTE_DRIVEN_INPUTS.filter((name) => declared.has(name));
    const voice = VOICE_DRIVEN_INPUTS.filter((name) => declared.has(name));
    const mode = inputs.find((i) => i.NAME === NOTE_MODE_INPUT);
    const source = inputs.find((i) => i.NAME === VOICE_SOURCE_INPUT);
    const auto = inputs.find((i) => i.NAME === VOICE_AUTO_INPUT);
    if (driven.length || voice.length) {
      result = {
        driven,
        modeDefault: Number(mode?.DEFAULT) || 0,
        voice,
        sourceDefault: Number(source?.DEFAULT) || 0,
        autoDefault: auto ? Number(auto.DEFAULT ?? 1) : 1,
      };
    }
  } catch {
    result = NO_NOTE_INPUTS;
  }
  if (inputCache.size > 200) inputCache.clear();
  inputCache.set(code, result);
  return result;
}

/**
 * Write the studio's values into every playing shader clip that reads them:
 * note inputs while the note visuals move (`notes`), and each visual
 * voice's signals for the sound it follows, every frame.
 */
function writeNoteInputs(notes: boolean): void {
  const launcher = get(vjClipLauncher);
  const byMode = new Map<number, Record<string, number>>();
  const bySource = new Map<string, Record<string, number>>();
  const decks: [VJDeck, typeof launcher.layerStates][] = [['A', launcher.layerStates], ['B', launcher.bankBLayerStates]];
  for (const [deck, states] of decks) {
    states?.forEach((state, layer) => {
      const clip = state?.activeClip;
      if (!clip || clip.type !== 'shader' || !clip.shaderCode) return;
      const info = noteInputsForShader(clip.shaderCode);
      const picked: Record<string, number> = {};
      if (notes && info.driven.length) {
        const mode = Math.round(Number(clip.shaderValues?.[NOTE_MODE_INPUT] ?? info.modeDefault) || 0);
        let values = byMode.get(mode);
        if (!values) {
          values = visuals.inputs(mode);
          byMode.set(mode, values);
        }
        for (const name of info.driven) picked[name] = values[name];
      }
      if (info.voice.length) {
        const source = voiceSourceAt(clip.shaderValues?.[VOICE_SOURCE_INPUT] ?? info.sourceDefault);
        const auto = Boolean(Number(clip.shaderValues?.[VOICE_AUTO_INPUT] ?? info.autoDefault));
        const key = `${source}:${auto}`;
        let values = bySource.get(key);
        if (!values) {
          values = voices.inputs(source, auto);
          bySource.set(key, values);
        }
        for (const name of info.voice) picked[name] = values[name];
      }
      if (Object.keys(picked).length) vjClipLauncher.batchUpdateShaderValues(layer, picked, deck);
    });
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/**
 * Closing the studio stops it: a take being recorded is kept, then the beat,
 * replay and every sounding note stop. Minimizing the panel keeps playing.
 */
function stopEverything(): void {
  if (liveInput?.running) stopLiveInput();
  cancelQueuedScene();
  cancelLoopRecord();
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

// ── Mixer, live input and outside notes ─────────────────────────────────

/** The mixer's channels for a set: its instruments, then the live input. */
export function mixerChannels(set: StudioSet): ChannelId[] {
  return [...AUDIO_SOURCES[set], 'input'];
}

/** Meter levels after each channel's strip, 0-1. The input's meter reads the signal before its fader. */
export function channelLevels(ids: readonly ChannelId[]): Partial<Record<ChannelId, number>> {
  const levels = audio.peekNow() === null ? {} : audio.channelLevels(ids);
  if (liveInput?.running && ids.includes('input')) levels.input = Math.max(levels.input ?? 0, liveInput.level);
  return levels;
}

/** Drum sounds decay from the hit; the rest hold until their note ends. */
const ONE_SHOT_SOURCES = new Set<VoiceSourceId>(['kick', 'snare', 'hats', 'perc']);

/**
 * A note from outside the studio (the live input, a Live track) for the
 * visual voices. It never plays a studio instrument; the sound comes from
 * the instrument itself or from Live. `delaySeconds` queues it ahead.
 */
export function pushOutsideNote(type: 'on' | 'off', note: number, velocity: number, role: VoiceSourceId, delaySeconds = 0): void {
  const time = audio.now() + Math.max(0, delaySeconds);
  const event: NoteEvent = {
    type,
    instrument: ONE_SHOT_SOURCES.has(role) ? 'drums' : 'synth',
    note: Math.max(0, Math.min(127, Math.round(note))),
    velocity: type === 'on' ? Math.max(0, Math.min(1, velocity)) : 0,
    source: 'midi',
    time,
  };
  voices.push(event, role === 'all' ? ['all'] : [role, 'all']);
  ensureFrameLoop();
}

let liveInput: LiveInput | null = null;

/** Start listening to the live input on the device chosen in the studio. */
export async function startLiveInput(): Promise<void> {
  const s = get(musicStudio);
  liveInput ??= new LiveInput(s.liveInput.sensitivity, (events) => {
    const role = get(musicStudio).liveInput.role;
    for (const e of events) pushOutsideNote(e.type, e.note, e.velocity, role);
  }, () => musicStudio.setInputStatus(false, 'The audio input was disconnected.'));
  try {
    const ctx = audioContextForInput();
    await liveInput.start(ctx, s.inputDevice, audio.inputChannel());
    musicStudio.setInputStatus(true);
  } catch (err) {
    musicStudio.setInputStatus(false, err instanceof Error ? err.message : 'The audio input could not be opened.');
  }
}

export function stopLiveInput(): void {
  liveInput?.stop();
  musicStudio.setInputStatus(false);
}

function audioContextForInput(): AudioContext {
  audio.now();
  const ctx = audio.context();
  if (!ctx) throw new Error('Audio is not available.');
  return ctx;
}

let wasOpen = false;
let wasLiveControl = false;
let macroSubscribed = false;
let lastKey = '';
let lastSet: StudioSet | null = null;
let lastSession: Session | null = null;
let lastPattern: DrumPattern | null = null;

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
    const keyChanged = keySig !== lastKey;
    if (keyChanged) {
      lastKey = keySig;
      if (chords.size) revoiceChords();
    }
    const sessionChanged = s.session !== lastSession;
    const patternChanged = s.pattern !== lastPattern;
    lastSession = s.session;
    lastPattern = s.pattern;
    if (keyChanged || sessionChanged || patternChanged) syncPlayingClips(s, sessionChanged, patternChanged);
    if (s.set !== lastSet) {
      const first = lastSet === null;
      lastSet = s.set;
      if (!first) freshSet();
    }
    const volumes = morphedVolumes(s);
    for (const id of INSTRUMENTS) audio.setVolume(id, volumes[id]);
    audio.setParams(soundParams(s));
    audio.setRouting(s.set, instrumentsThroughFx(s.cables[s.set]));
    syncAnalogRoutes(s);
    syncMacroFx(true);
    audio.setMasterVolume(s.masterVolume);
    audio.setMixer(s.mixer, mixerChannels(s.set));
    audio.setInputVolume(s.liveInput.volume);
    audio.setInputMonitor(s.liveInput.monitor);
    liveInput?.setSensitivity(s.liveInput.sensitivity);
    // With Live in control the studio's instruments step aside.
    if (s.liveControl && !wasLiveControl) stopAll();
    wasLiveControl = s.liveControl;
    audio.setInstrumentsSilenced(s.liveControl);
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
