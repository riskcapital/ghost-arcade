/**
 * Loop tracks: the live looper's sums, kept apart from the audio so they can
 * be tested.
 *
 * Six tracks, each MIDI (notes played on an instrument) or audio (a band
 * input). One button per track walks it through its states, RC-looper style:
 *
 *   empty → armed → record → (overdub | play) ⇄ overdub, and stopped → play.
 *
 * A fixed length punches in on the next bar and out after its bars; Free ends
 * on the bar nearest the press (or, with nothing playing, the first free loop
 * sets the tempo). Each overdub pass that adds something is a layer; undo and
 * redo take the last layer off and put it back, 8 layers deep. Layers past
 * that, or past the memory budget, fold into the oldest one.
 *
 * Pure: the station runtime (loopStation.ts) owns the clock and the sound.
 */

import { BEATS_PER_BAR, EARLY_GRACE_BEATS, type PlayedNote, type RecordedNote } from './loopRecorder';
import { INSTRUMENTS, clampNote, clampVelocity, type InstrumentId } from './noteEvents';

export const LOOP_TRACK_COUNT = 6;
/** Layers kept for undo, per track. */
export const MAX_LAYERS = 8;
/** Lengths offered, in bars; 0 is Free. */
export const LOOP_LENGTHS = [1, 2, 4, 8, 16, 0] as const;
export type LoopLength = (typeof LOOP_LENGTHS)[number];
/** The longest MIDI loop, in bars. */
export const MAX_MIDI_LOOP_BARS = 64;
/** The longest audio loop: 64 bars, and never more than this many seconds. */
export const MAX_AUDIO_LOOP_BARS = 64;
export const MAX_AUDIO_LOOP_SECONDS = 120;
/**
 * Audio held by all loop tracks' layers together. Past it the oldest layers
 * of the biggest track fold together (undo gets shallower, nothing is lost
 * from what plays). 2 minutes of stereo float at 48 kHz is 46 MB.
 */
export const AUDIO_MEMORY_BUDGET_BYTES = 320 * 1024 * 1024;
/** A free loop shorter than this is thrown away. */
export const MIN_FREE_BEATS = 1;

export type LoopTrackKind = 'midi' | 'audio';
export type AfterRecord = 'play' | 'overdub';
export type CountIn = 0 | 1 | 2;
export const COUNT_INS: readonly CountIn[] = [0, 1, 2];

/** Where a track is. `armed` waits for its bar (counting in when the clock is idle). */
export type TrackPhase = 'empty' | 'armed' | 'record' | 'overdub' | 'play' | 'stopped';

/** What a press of the track button asks the runtime to do. */
export type TrackAction =
  | { type: 'arm' }
  | { type: 'cancel' }
  | { type: 'close-record' }
  | { type: 'punch-in' }
  | { type: 'punch-out' }
  | { type: 'play' };

/** The track button: one press, one step. */
export function pressTrackButton(phase: TrackPhase): TrackAction {
  switch (phase) {
    case 'empty':
      return { type: 'arm' };
    case 'armed':
      return { type: 'cancel' };
    case 'record':
      return { type: 'close-record' };
    case 'play':
      return { type: 'punch-in' };
    case 'overdub':
      return { type: 'punch-out' };
    case 'stopped':
      return { type: 'play' };
  }
}

/** Where a recording goes once its last bar is in. */
export function phaseAfterRecord(after: AfterRecord): TrackPhase {
  return after === 'overdub' ? 'overdub' : 'play';
}

/** The default after-record per kind: Play for MIDI, Overdub for audio (the owner's choice). */
export function defaultAfterRecord(kind: LoopTrackKind): AfterRecord {
  return kind === 'audio' ? 'overdub' : 'play';
}

// ── Layers ────────────────────────────────────────────────────────────

export interface LayerStack<T> {
  layers: T[];
  /** Layers taken off by undo, the latest last. A new layer clears it. */
  redo: T[];
}

export function emptyStack<T>(): LayerStack<T> {
  return { layers: [], redo: [] };
}

/** Add a layer; past `max`, the two oldest fold into one. */
export function pushLayer<T>(stack: LayerStack<T>, layer: T, merge: (older: T, newer: T) => T, max = MAX_LAYERS): LayerStack<T> {
  let layers = [...stack.layers, layer];
  while (layers.length > Math.max(1, max)) layers = [merge(layers[0], layers[1]), ...layers.slice(2)];
  return { layers, redo: [] };
}

/** Fold the two oldest layers into one (the memory budget). Unchanged with fewer than two. */
export function foldOldest<T>(stack: LayerStack<T>, merge: (older: T, newer: T) => T): LayerStack<T> {
  if (stack.layers.length < 2) return stack;
  return { layers: [merge(stack.layers[0], stack.layers[1]), ...stack.layers.slice(2)], redo: stack.redo };
}

/** Take the last layer off. Undoing the only layer leaves the track empty. */
export function undoLayer<T>(stack: LayerStack<T>): LayerStack<T> {
  if (!stack.layers.length) return stack;
  return { layers: stack.layers.slice(0, -1), redo: [...stack.redo, stack.layers[stack.layers.length - 1]] };
}

export function redoLayer<T>(stack: LayerStack<T>): LayerStack<T> {
  if (!stack.redo.length) return stack;
  return { layers: [...stack.layers, stack.redo[stack.redo.length - 1]], redo: stack.redo.slice(0, -1) };
}

// ── MIDI layers ───────────────────────────────────────────────────────

export type MidiLayer = RecordedNote[];

export const mergeMidiLayers = (a: MidiLayer, b: MidiLayer): MidiLayer => sortNotes([...a, ...b]);

/** Every note a track plays: its layers together, each note tagged with its layer (0 = first). */
export function flattenMidi(stack: LayerStack<MidiLayer>): Array<RecordedNote & { layer: number }> {
  const out: Array<RecordedNote & { layer: number }> = [];
  stack.layers.forEach((layer, i) => { for (const n of layer) out.push({ ...n, layer: i }); });
  return out.sort((a, b) => a.beat - b.beat || a.note - b.note);
}

function sortNotes(notes: RecordedNote[]): RecordedNote[] {
  return notes.sort((a, b) => a.beat - b.beat || a.note - b.note);
}

const MIN_NOTE_BEATS = 1 / 64;

/** `x` wrapped into [0, length). */
export function wrapBeat(x: number, length: number): number {
  const w = ((x % length) + length) % length;
  return Math.abs(w - length) < 1e-6 ? 0 : w + 0;
}

/**
 * The notes of `instrument` played in [from, to), as a layer of a loop that
 * started on `origin` and repeats every `beats`: times wrap into the loop,
 * snapped to `grid` beats (0 leaves them). A note held past `to` ends there;
 * none is longer than the loop. Notes a beat early (EARLY_GRACE_BEATS) count
 * as on the punch-in.
 */
export function notesForLayer(
  played: readonly PlayedNote[],
  instrument: InstrumentId,
  from: number,
  to: number,
  origin: number,
  beats: number,
  grid: number,
): MidiLayer {
  const out: MidiLayer = [];
  if (!(to > from) || !(beats > 0)) return out;
  for (const n of played) {
    if (n.instrument !== instrument || n.beat < from - EARLY_GRACE_BEATS || n.beat >= to) continue;
    const at = Math.max(n.beat, from - EARLY_GRACE_BEATS);
    const raw = wrapBeat(at - origin, beats);
    const snapped = grid > 0 ? wrapBeat(Math.round(raw / grid) * grid, beats) : raw;
    const heldTo = Math.min(n.end ?? to, to);
    const dur = Math.max(MIN_NOTE_BEATS, Math.min(beats, heldTo - Math.max(n.beat, from)));
    out.push({ beat: snapped, dur, note: clampNote(n.note), velocity: clampVelocity(n.velocity) });
  }
  return sortNotes(out);
}

/** Notes the loop plays in [fromBeat, toBeat), with pass 0 starting on `origin`. */
export function loopNotesInWindow(
  notes: readonly RecordedNote[],
  origin: number,
  beats: number,
  fromBeat: number,
  toBeat: number,
): Array<RecordedNote & { at: number }> {
  if (!(toBeat > fromBeat) || !(beats > 0)) return [];
  const out: Array<RecordedNote & { at: number }> = [];
  const first = Math.max(0, Math.floor((fromBeat - origin) / beats));
  const last = Math.floor((toBeat - origin) / beats);
  for (let pass = first; pass <= last; pass++) {
    const start = origin + pass * beats;
    for (const n of notes) {
      const at = start + n.beat;
      if (at < fromBeat || at >= toBeat || at < origin) continue;
      out.push({ ...n, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ── Timing ────────────────────────────────────────────────────────────

/** The first bar line at or after `beat` (a hair past it counts as on it). */
export function nextBarAt(beat: number): number {
  return Math.ceil(beat / BEATS_PER_BAR - 1e-6) * BEATS_PER_BAR + 0;
}

/** Where a recording armed at `beat` starts: the next bar, after the count-in bars when the clock is idle. */
export function recordStart(beat: number, countIn: CountIn, clockRunning: boolean): number {
  const bar = nextBarAt(beat + 1e-3);
  return clockRunning ? bar : bar + countIn * BEATS_PER_BAR;
}

/**
 * Where a free recording closes when stop is pressed at `beat`: the bar
 * line nearest the press (the one ahead when the press is in a bar's last
 * beat), and at least one bar after the start.
 */
export function freeRecordEnd(startBeat: number, beat: number): number {
  const into = beat - startBeat;
  const bars = Math.max(1, into % BEATS_PER_BAR >= BEATS_PER_BAR - 1 ? Math.ceil(into / BEATS_PER_BAR) : Math.round(into / BEATS_PER_BAR));
  return startBeat + bars * BEATS_PER_BAR;
}

/** Where a press during overdub or play takes effect: the next bar line. */
export function punchAt(beat: number): number {
  return nextBarAt(beat + 1e-3);
}

/** The pass of a loop (from `origin`, every `beats`) that `beat` is in, and where that pass ends. */
export function passEnd(origin: number, beats: number, beat: number): number {
  const pass = Math.floor((beat - origin) / beats + 1e-9);
  return origin + (pass + 1) * beats;
}

/** How far through its loop a track is, 0–1. */
export function loopProgress(origin: number, beats: number, beat: number): number {
  if (!(beats > 0) || beat < origin) return 0;
  return wrapBeat(beat - origin, beats) / beats;
}

/**
 * The tempo a free first loop sets: its length taken as 1, 2, 4 or 8 bars,
 * whichever lands in 80–160 BPM (the one nearest 120 when two do; the
 * nearest to the range when none does).
 */
export function inferTempo(seconds: number): { bpm: number; bars: number } | null {
  if (!(seconds > 0.2)) return null;
  let best: { bpm: number; bars: number; score: number } | null = null;
  for (const bars of [1, 2, 4, 8]) {
    const bpm = (bars * BEATS_PER_BAR * 60) / seconds;
    const outside = bpm < 80 ? 80 - bpm : bpm > 160 ? bpm - 160 : 0;
    const score = outside * 1000 + Math.abs(bpm - 120);
    if (!best || score < best.score) best = { bpm, bars, score };
  }
  if (!best || best.bpm < 30 || best.bpm > 300) return null;
  return { bpm: Math.round(best.bpm * 100) / 100, bars: best.bars };
}

/** Beats recorded at one tempo, read at another: the free first loop's notes after it set the tempo. */
export function rescaleBeats(beatsAtOld: number, oldBeatMs: number, newBeatMs: number): number {
  return newBeatMs > 0 ? (beatsAtOld * oldBeatMs) / newBeatMs : beatsAtOld;
}

// ── Latency ───────────────────────────────────────────────────────────

/**
 * How late the input reaches the recorder, in seconds: the output and input
 * latencies the audio context reports (what is heard was scheduled earlier,
 * and what is played arrives later), plus the manual offset (ms). Never
 * negative.
 */
export function inputLatencySeconds(reported: { baseLatency?: number; outputLatency?: number; inputLatency?: number }, manualMs: number): number {
  const part = (x: number | undefined) => (Number.isFinite(x) && (x as number) > 0 ? (x as number) : 0);
  const auto = part(reported.baseLatency) + part(reported.outputLatency) + part(reported.inputLatency);
  return Math.max(0, auto + (Number.isFinite(manualMs) ? manualMs : 0) / 1000);
}

/** Frames to shift a recording by, for a latency in seconds. */
export function latencyFrames(seconds: number, sampleRate: number): number {
  return Math.max(0, Math.round(seconds * sampleRate));
}

/**
 * The loopback Measure: where the click sent at frame 0 came back in what
 * was recorded (the first sample past `threshold` of the peak), in frames,
 * or null when nothing came back.
 */
export function findClickOnset(samples: Float32Array, threshold = 0.5): number | null {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 0.01) return null;
  const level = peak * threshold;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= level) return i;
  return null;
}

// ── Audio layers ──────────────────────────────────────────────────────

/** Bytes a stereo float loop of `frames` frames holds. */
export const audioBytes = (frames: number) => frames * 2 * 4;

/**
 * Which tracks fold their oldest layers, and how often, to keep the total
 * under the budget: the track holding most goes first. `held` is each
 * track's layer sizes in bytes.
 */
export function foldsForBudget(held: number[][], budget = AUDIO_MEMORY_BUDGET_BYTES): number[] {
  const sizes = held.map((layers) => [...layers]);
  const total = () => sizes.reduce((sum, l) => sum + l.reduce((a, b) => a + b, 0), 0);
  const folds: number[] = [];
  while (total() > budget) {
    let pick = -1;
    let most = 0;
    sizes.forEach((l, i) => {
      const bytes = l.reduce((a, b) => a + b, 0);
      if (l.length >= 2 && bytes > most) { most = bytes; pick = i; }
    });
    if (pick < 0) break;
    // Two layers of one loop fold into one of the same size.
    sizes[pick] = [sizes[pick][1], ...sizes[pick].slice(2)];
    folds.push(pick);
  }
  return folds;
}

/** Sum `layer` into a copy of `base` from `offset` (frames into the loop), wrapping round the loop. */
export function mixInto(base: Float32Array, layer: Float32Array, offset = 0): Float32Array {
  const out = new Float32Array(base);
  const n = out.length;
  if (!n) return out;
  for (let i = 0; i < layer.length; i++) out[(((offset + i) % n) + n) % n] += layer[i];
  return out;
}

/** The frames a loop of `bars` lasts at `beatMs`, rounded once. */
export function loopFrames(bars: number, beatMs: number, sampleRate: number): number {
  return Math.max(1, Math.round(((bars * BEATS_PER_BAR * beatMs) / 1000) * sampleRate));
}

/** The most bars an audio loop may be at this tempo. */
export function maxAudioBars(beatMs: number): number {
  const bar = (BEATS_PER_BAR * beatMs) / 1000;
  return bar > 0 ? Math.max(1, Math.min(MAX_AUDIO_LOOP_BARS, Math.floor(MAX_AUDIO_LOOP_SECONDS / bar + 1e-9))) : 1;
}

// ── Saved state ───────────────────────────────────────────────────────

/** What a loop track keeps in the project. Audio is this session's: an audio track keeps its settings only. */
export interface LoopTrackData {
  kind: LoopTrackKind;
  name: string;
  /** MIDI: what it plays on. */
  instrument: InstrumentId | null;
  tone?: string;
  /** Audio: which band input (0-3) it records. */
  input: number;
  afterRecord: AfterRecord;
  /** 0–1. */
  level: number;
  muted: boolean;
  /** MIDI: the loop's beats and its layers (the first is the recording). */
  beats: number;
  layers: MidiLayer[];
  /** The library loop it was saved as, when it was. */
  savedId?: string;
}

export interface LoopSection {
  id: string;
  name: string;
  /** The tracks that play in it. */
  tracks: number[];
}

export type PedalPreset = 'off' | '2-switch' | '3-switch';
export const PEDAL_PRESETS: readonly PedalPreset[] = ['off', '2-switch', '3-switch'];

export interface LoopStationData {
  tracks: LoopTrackData[];
  length: LoopLength;
  countIn: CountIn;
  /** Bars a stopped loop fades over, 0 = cut. */
  fadeBars: number;
  /** Manual latency offset for audio, ms (added to what the system reports). */
  latencyMs: number;
  sections: LoopSection[];
  pedal: PedalPreset;
}

export function blankTrack(i: number, kind: LoopTrackKind = i < 4 ? 'midi' : 'audio'): LoopTrackData {
  return {
    kind,
    name: '',
    instrument: null,
    input: kind === 'audio' ? Math.max(0, i - 4) : 0,
    afterRecord: defaultAfterRecord(kind),
    level: 0.8,
    muted: false,
    beats: 0,
    layers: [],
  };
}

export function defaultStationData(): LoopStationData {
  return {
    tracks: Array.from({ length: LOOP_TRACK_COUNT }, (_, i) => blankTrack(i)),
    length: 4,
    countIn: 1,
    fadeBars: 0,
    latencyMs: 0,
    sections: [],
    pedal: 'off',
  };
}

const finite = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function normalizeLayer(raw: unknown, beats: number): MidiLayer {
  const out: MidiLayer = [];
  for (const n of Array.isArray(raw) ? raw : []) {
    if (!n || typeof n !== 'object') continue;
    const r = n as Partial<RecordedNote>;
    const beat = finite(r.beat, -1);
    if (beat < 0 || beat >= beats) continue;
    out.push({ beat, dur: clamp(finite(r.dur, 0.25), MIN_NOTE_BEATS, beats), note: clampNote(finite(r.note, 60)), velocity: clampVelocity(finite(r.velocity, 0.8)) });
  }
  return sortNotes(out);
}

export function normalizeTrack(raw: unknown, i: number): LoopTrackData {
  if (!raw || typeof raw !== 'object') return blankTrack(i);
  const r = raw as Partial<LoopTrackData>;
  const kind: LoopTrackKind = r.kind === 'audio' ? 'audio' : 'midi';
  const base = blankTrack(i, kind);
  const beats = kind === 'midi' ? clamp(Math.round(finite(r.beats, 0) / BEATS_PER_BAR), 0, MAX_MIDI_LOOP_BARS) * BEATS_PER_BAR : 0;
  const layers = beats > 0 ? (Array.isArray(r.layers) ? r.layers : []).slice(-MAX_LAYERS).map((l) => normalizeLayer(l, beats)) : [];
  return {
    ...base,
    name: typeof r.name === 'string' ? r.name.slice(0, 80) : '',
    instrument: INSTRUMENTS.includes(r.instrument as InstrumentId) ? (r.instrument as InstrumentId) : null,
    ...(typeof r.tone === 'string' && r.tone ? { tone: r.tone } : {}),
    input: clamp(Math.round(finite(r.input, base.input)), 0, 3),
    afterRecord: r.afterRecord === 'overdub' || r.afterRecord === 'play' ? r.afterRecord : base.afterRecord,
    level: clamp(finite(r.level, base.level), 0, 1),
    muted: r.muted === true,
    beats: layers.length ? beats : 0,
    layers,
    ...(typeof r.savedId === 'string' && r.savedId ? { savedId: r.savedId } : {}),
  };
}

/** The station from a project file; a project from before it gets six empty tracks. */
export function normalizeStationData(raw: unknown): LoopStationData {
  const d = defaultStationData();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<LoopStationData>;
  const tracks = Array.from({ length: LOOP_TRACK_COUNT }, (_, i) => normalizeTrack(Array.isArray(r.tracks) ? r.tracks[i] : null, i));
  const sections: LoopSection[] = [];
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string') continue;
    sections.push({
      id: s.id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : `Section ${sections.length + 1}`,
      tracks: [...new Set((Array.isArray(s.tracks) ? s.tracks : []).map(Number).filter((t) => Number.isInteger(t) && t >= 0 && t < LOOP_TRACK_COUNT))],
    });
  }
  return {
    tracks,
    length: (LOOP_LENGTHS as readonly number[]).includes(Number(r.length)) ? (Number(r.length) as LoopLength) : d.length,
    countIn: (COUNT_INS as readonly number[]).includes(Number(r.countIn)) ? (Number(r.countIn) as CountIn) : d.countIn,
    fadeBars: clamp(Math.round(finite(r.fadeBars, 0)), 0, 4),
    latencyMs: clamp(finite(r.latencyMs, 0), -200, 500),
    sections: sections.slice(0, 16),
    pedal: PEDAL_PRESETS.includes(r.pedal as PedalPreset) ? (r.pedal as PedalPreset) : 'off',
  };
}

// ── Names ─────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "Keys 3 · 4 bars · 120 · A min": the name a save starts with. */
export function autoLoopName(label: string, bars: number, bpm: number, key?: { root: number; scale: string } | null): string {
  const parts = [label, `${bars} bar${bars === 1 ? '' : 's'}`, `${Math.round(bpm)}`];
  if (key) parts.push(`${NOTE_NAMES[((key.root % 12) + 12) % 12]} ${key.scale.startsWith('min') ? 'min' : key.scale.startsWith('maj') ? 'maj' : key.scale}`);
  return parts.join(' · ');
}

/** A name not already taken: "Riff" → "Riff 2" → "Riff 3". */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((t) => t.toLowerCase()));
  const base = name.trim() || 'Loop';
  if (!set.has(base.toLowerCase())) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} ${n}`;
    if (!set.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}
