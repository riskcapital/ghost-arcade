/**
 * The Studio view's two instrument sets, their knobs, keys and scales, and
 * the patch cables between their jacks.
 *
 * Every knob is a 0-1 value stored under "module.param". Every jack has an
 * id; an output feeds an input of the same kind:
 *  - audio: an instrument's sound into the effects rack ("audio:drone" ->
 *    "fx:in"). An instrument with no cable plays straight to the speakers.
 *  - control: a moving 0-1 signal into something that can follow one ("cv:xy.x"
 *    -> "dest:macro:<id>" turns a macro knob; "-> dest:layer:2" pulses a VJ
 *    layer's opacity).
 */

import { DRUM_VOICES, type DrumVoice, type InstrumentId } from './noteEvents';

export type StudioSet = 'bath' | 'berlin';

export const STUDIO_SETS: { id: StudioSet; label: string }[] = [
  { id: 'bath', label: 'Sound bath' },
  { id: 'berlin', label: 'Berlin' },
];

export interface ParamDef {
  key: string;
  label: string;
  default: number;
}

const defs = (module: string, list: Array<[string, string, number]>): ParamDef[] =>
  list.map(([param, label, value]) => ({ key: `${module}.${param}`, label, default: value }));

export const DRONE_PARAMS = defs('drone', [
  ['tone', 'Tone', 0.35], ['motion', 'Motion', 0.6], ['shimmer', 'Shimmer', 0.5], ['width', 'Width', 0.8],
  ['detune', 'Detune', 0.25], ['swell', 'Swell', 0.55], ['air', 'Air', 0.25], ['depth', 'Depth', 0.6],
]);

export const BOWL_PARAMS = defs('bowls', [['ring', 'Ring', 0.7], ['tone', 'Tone', 0.5], ['spread', 'Spread', 0.5]]);

export const XY_PARAMS = defs('xy', [['x', 'X', 0.5], ['y', 'Y', 0.5]]);

export const ACID_PARAMS = defs('acid', [
  ['cutoff', 'Cutoff', 0.35], ['reso', 'Reso', 0.75], ['env', 'Env', 0.6],
  ['decay', 'Decay', 0.35], ['accent', 'Accent', 0.7], ['drive', 'Drive', 0.4],
]);

export interface FxUnitDef {
  id: string;
  name: string;
  params: ParamDef[];
}

/** The effects rack of each set, in signal order. */
export const FX_RACKS: Record<StudioSet, FxUnitDef[]> = {
  bath: [
    { id: 'shimmer', name: 'Shimmer', params: defs('fx.shimmer', [['size', 'Size', 0.75], ['tone', 'Tone', 0.6], ['mix', 'Mix', 0.35]]) },
    { id: 'tape', name: 'Tape', params: defs('fx.tape', [['wow', 'Wow', 0.3], ['age', 'Age', 0.4], ['mix', 'Mix', 0.3]]) },
    { id: 'delay', name: 'Delay', params: defs('fx.delay', [['time', 'Time', 0.55], ['feedback', 'Feedbk', 0.45], ['mix', 'Mix', 0.25]]) },
    { id: 'reverb', name: 'Reverb', params: defs('fx.reverb', [['space', 'Space', 0.85], ['decay', 'Decay', 0.75], ['mix', 'Mix', 0.5]]) },
  ],
  berlin: [
    { id: 'drive', name: 'Drive', params: defs('fx.drive', [['gain', 'Gain', 0.45], ['tone', 'Tone', 0.5], ['mix', 'Mix', 0.5]]) },
    { id: 'crush', name: 'Bitcrush', params: defs('fx.crush', [['bits', 'Bits', 0.6], ['rate', 'Rate', 0.7], ['mix', 'Mix', 0.0]]) },
    { id: 'dub', name: 'Dub delay', params: defs('fx.dub', [['time', 'Time', 0.75], ['feedback', 'Feedbk', 0.55], ['mix', 'Mix', 0.3]]) },
    { id: 'gate', name: 'Gate verb', params: defs('fx.gate', [['space', 'Space', 0.5], ['length', 'Gate', 0.4], ['mix', 'Mix', 0.2]]) },
  ],
};

/** Level and tune for each kit voice on the drum mixer. */
export const MIXER_PARAMS: ParamDef[] = DRUM_VOICES.flatMap((v) => [
  { key: `mix.${v}.level`, label: 'Level', default: 0.8 },
  { key: `mix.${v}.tune`, label: 'Tune', default: 0.5 },
]);

export const ALL_PARAMS: ParamDef[] = [
  ...DRONE_PARAMS, ...BOWL_PARAMS, ...XY_PARAMS, ...ACID_PARAMS,
  ...FX_RACKS.bath.flatMap((u) => u.params), ...FX_RACKS.berlin.flatMap((u) => u.params),
  ...MIXER_PARAMS,
];

const PARAM_DEFAULTS: Record<string, number> = Object.fromEntries(ALL_PARAMS.map((p) => [p.key, p.default]));

export function defaultParams(): Record<string, number> {
  return { ...PARAM_DEFAULTS };
}

/** Known knobs only, each clamped to 0-1; anything missing takes its default. */
export function normalizeParams(raw: unknown): Record<string, number> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = defaultParams();
  for (const key of Object.keys(out)) {
    const n = Number(input[key]);
    if (input[key] !== undefined && input[key] !== null && Number.isFinite(n)) out[key] = Math.max(0, Math.min(1, n));
  }
  return out;
}

// ── Keys and scales ─────────────────────────────────────────────────────

export type ScaleId = 'dorian' | 'minor' | 'major' | 'lydian' | 'pentatonic';

export const SCALES: Record<ScaleId, { label: string; steps: number[] }> = {
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  minor: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  lydian: { label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  pentatonic: { label: 'Pentatonic', steps: [0, 3, 5, 7, 10] },
};

export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface MusicKey {
  /** Pitch class 0-11. */
  root: number;
  scale: ScaleId;
}

export function keyLabel(key: MusicKey): string {
  return `${ROOT_NAMES[key.root]} ${SCALES[key.scale].label}`;
}

/** The scale note nearest to `note` (ties go down), for scale-locked playing. */
export function snapToScale(note: number, key: MusicKey): number {
  const steps = SCALES[key.scale].steps;
  for (let d = 0; d <= 6; d++) {
    for (const candidate of [note - d, note + d]) {
      const pc = (((candidate - key.root) % 12) + 12) % 12;
      if (steps.includes(pc)) return candidate;
    }
  }
  return note;
}

/** MIDI note of scale degree `degree` (0 = root) from the octave starting at `base`. */
export function scaleNote(key: MusicKey, degree: number, base: number): number {
  const steps = SCALES[key.scale].steps;
  const octave = Math.floor(degree / steps.length);
  const index = ((degree % steps.length) + steps.length) % steps.length;
  return base + key.root + octave * 12 + steps[index];
}

/** A four-note chord stacked in thirds on a scale degree. */
export function chordNotes(key: MusicKey, degree: number, base = 48): number[] {
  const five = SCALES[key.scale].steps.length === 5;
  // A pentatonic scale has no thirds to stack; take every other note instead.
  const stack = five ? [0, 1, 2, 4] : [0, 2, 4, 6];
  return stack.map((s) => scaleNote(key, degree + s, base));
}

/** A short chord name from its root and intervals: "Dm7", "Fmaj7", "C6"... */
export function chordName(notes: number[]): string {
  const root = notes[0];
  const iv = notes.map((n) => (n - root + 120) % 12);
  const third = iv.includes(4) ? 'maj' : iv.includes(3) ? 'min' : 'sus';
  const fifth = iv.includes(7) ? 7 : iv.includes(6) ? 6 : iv.includes(8) ? 8 : 0;
  const seventh = iv.includes(11) ? 'maj7' : iv.includes(10) ? '7' : iv.includes(9) ? '6' : '';
  const name = ROOT_NAMES[((root % 12) + 12) % 12];
  if (third === 'min' && fifth === 6) return `${name}m7b5`;
  if (third === 'sus') return `${name}sus${iv.includes(5) ? 4 : 2}`;
  if (third === 'maj') return `${name}${seventh === 'maj7' ? 'maj7' : seventh}`;
  return `${name}m${seventh === 'maj7' ? 'maj7' : seventh}`;
}

/** The five bowls: root, third, fifth, seventh and ninth of the key, low to high. */
export function bowlNotes(key: MusicKey): number[] {
  return [0, 2, 4, 6, 8].map((d) => scaleNote(key, d, 48));
}

// ── Acid note row ───────────────────────────────────────────────────────

export interface AcidStep {
  /** Semitones above the root, or null for a rest. */
  note: number | null;
  accent: boolean;
  glide: boolean;
}

export const ACID_STEPS = 16;
export const ACID_RANGE = 24;

export function defaultAcidSteps(): AcidStep[] {
  const notes: Array<number | null> = [0, 0, 12, null, 3, 0, 7, null, 0, 10, 12, 0, 5, null, 15, 0];
  return notes.map((note, i) => ({ note, accent: [0, 4, 10, 14].includes(i), glide: i === 6 || i === 11 }));
}

export function normalizeAcidSteps(raw: unknown): AcidStep[] {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) return defaultAcidSteps();
  return Array.from({ length: ACID_STEPS }, (_, i) => {
    const s = (list[i] && typeof list[i] === 'object' ? list[i] : {}) as Partial<AcidStep>;
    const n = Number(s.note);
    return {
      note: s.note === null || s.note === undefined || !Number.isFinite(n) ? null : Math.max(0, Math.min(ACID_RANGE, Math.round(n))),
      accent: s.accent === true,
      glide: s.glide === true,
    };
  });
}

// ── Jacks and cables ────────────────────────────────────────────────────

export type JackKind = 'audio' | 'control';

export interface Cable {
  id: string;
  from: string;
  to: string;
}

/** Instruments with a sound output jack in each set. */
export const AUDIO_SOURCES: Record<StudioSet, InstrumentId[]> = {
  bath: ['drone', 'bowls', 'xy', 'synth', 'keys'],
  berlin: ['drums', 'acid', 'synth', 'keys'],
};

/** Control outputs each set offers. */
export function controlSources(set: StudioSet): string[] {
  return set === 'bath'
    ? ['cv:xy.x', 'cv:xy.y', 'cv:drone.level', 'cv:bowls.ring']
    : [...DRUM_VOICES.map((v: DrumVoice) => `cv:drum.${v}`), 'cv:acid.cutoff', 'cv:acid.level'];
}

const DRUM_NAMES: Record<string, string> = {
  kick: 'Kick', snare: 'Snare', clap: 'Clap', hatClosed: 'Hat', hatOpen: 'Open hat', tom: 'Tom', rim: 'Rim', crash: 'Crash',
};

/** What a control output is called, for "driven by" labels. */
export function sourceLabel(jack: string): string {
  const name = jack.replace(/^cv:|^audio:/, '');
  if (name.startsWith('drum.')) return DRUM_NAMES[name.slice(5)] ?? name.slice(5);
  const labels: Record<string, string> = {
    'xy.x': 'XY X', 'xy.y': 'XY Y', 'drone.level': 'Drone', 'bowls.ring': 'Bowls',
    'acid.cutoff': 'Acid cutoff', 'acid.level': 'Acid',
  };
  return labels[name] ?? name;
}

export function jackKind(jack: string): JackKind | null {
  if (jack.startsWith('audio:') || jack === 'fx:in') return 'audio';
  if (jack.startsWith('cv:') || jack.startsWith('dest:')) return 'control';
  return null;
}

export function isOutputJack(jack: string): boolean {
  return jack.startsWith('audio:') || jack.startsWith('cv:');
}

/** Whether a cable may run from `from` to `to`. */
export function canConnect(from: string, to: string): boolean {
  if (!isOutputJack(from) || isOutputJack(to)) return false;
  const kind = jackKind(from);
  return kind !== null && kind === jackKind(to);
}

/**
 * Add a cable. An input takes one cable (a new one replaces it); an output
 * can feed several inputs. An identical cable is not added twice.
 */
export function connect(cables: Cable[], cable: Cable): Cable[] {
  if (!canConnect(cable.from, cable.to)) return cables;
  if (cable.to === 'fx:in') {
    // The rack's input mixes any number of instruments.
    if (cables.some((c) => c.from === cable.from && c.to === cable.to)) return cables;
    return [...cables, cable];
  }
  return [...cables.filter((c) => c.to !== cable.to), cable];
}

export function disconnect(cables: Cable[], id: string): Cable[] {
  return cables.filter((c) => c.id !== id);
}

/** Instruments a set's cables send through the effects rack. */
export function instrumentsThroughFx(cables: Cable[]): Set<InstrumentId> {
  return new Set(cables.filter((c) => c.to === 'fx:in' && c.from.startsWith('audio:')).map((c) => c.from.slice(6) as InstrumentId));
}

export function defaultCables(): Record<StudioSet, Cable[]> {
  return {
    bath: [
      { id: 'bath-drone-fx', from: 'audio:drone', to: 'fx:in' },
      { id: 'bath-bowls-fx', from: 'audio:bowls', to: 'fx:in' },
    ],
    berlin: [{ id: 'berlin-acid-fx', from: 'audio:acid', to: 'fx:in' }],
  };
}

export function normalizeCables(raw: unknown): Record<StudioSet, Cable[]> {
  if (!raw || typeof raw !== 'object') return defaultCables();
  const input = raw as Partial<Record<StudioSet, unknown>>;
  const out = { bath: [] as Cable[], berlin: [] as Cable[] };
  for (const set of ['bath', 'berlin'] as StudioSet[]) {
    for (const c of Array.isArray(input[set]) ? (input[set] as unknown[]) : []) {
      if (!c || typeof c !== 'object') continue;
      const { id, from, to } = c as Partial<Cable>;
      if (typeof id !== 'string' || typeof from !== 'string' || typeof to !== 'string') continue;
      out[set] = connect(out[set], { id, from, to });
    }
  }
  return out;
}
