/**
 * Analog Synth, a video synthesizer: the controls of a patch.
 *
 * A patch is flat values on the layer's effect source (keys `vs…`), so the
 * plugin panel, MIDI learn, presets and Timeline lines all reach every
 * control with no special case. This table is the one place a control is
 * defined: its key, range, default, what it is called and where it sits.
 *
 * The signal: three raster oscillators (A, B, C) each draw a waveform across
 * the picture as a beam would, at a frequency against the picture's own
 * rate; their sync locks the pattern into still bands or lets it drift. Each
 * is modulated (phase, key or hue) and frequency-modulated by a chosen source.
 * A mixer combines them, the picture is moved, mirrored and fed back into
 * itself, then finished like a tube: scanlines, color bleed and roll.
 */

export const VIDEOSYNTH_EFFECT_TYPE = 'videosynth';

export type ParamSpec = {
  key: string;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Named choices; the value is the index. */
  options?: string[];
  /** Index into the shader's parameter block. */
  slot: number;
};

/** What a modulation or FM input listens to. */
export const SOURCES = ['Off', 'Feedback', 'Osc A', 'Osc B', 'Osc C', 'LFO 1', 'LFO 2', 'LFO 3', 'Bass', 'Mids', 'Highs', 'Level', 'Kick', 'Input'];
/** What an oscillator draws: its own beam, or the input layer colored by it. */
export const OSC_INPUTS = ['Oscillator', 'Input'];
export const MOD_MODES = ['Phase', 'Key', 'Hue'];
export const MIX_MODES = ['Brightest', 'Layer', 'YUV'];

// A calm start: three slow, mostly locked patterns in red, green and blue,
// lightly bent by each other and a little feedback.
const OSC_DEFAULTS = [
  { freq: 0.36, sync: 0.92, shape: 1, mod: 0.18, modSrc: 1, fm: 0.04, fmSrc: 5, hue: 0.0, sat: 0.8, level: 1 },
  { freq: 0.44, sync: 1.25, shape: 0.5, mod: 0.22, modSrc: 2, fm: 0.04, fmSrc: 6, hue: 0.36, sat: 0.75, level: 0.8 },
  { freq: 0.52, sync: 1.85, shape: 1, mod: 0.2, modSrc: 3, fm: 0.04, fmSrc: 7, hue: 0.64, sat: 0.75, level: 0.7 },
];

const spec = (key: string, label: string, group: string, min: number, max: number, step: number, value: number, slot: number, options?: string[]): ParamSpec => ({
  key, label, group, min, max, step, default: value, slot, ...(options ? { options } : {}),
});

/** Inputs that only a cable reaches (the oscillators' Mod and FM are knobs too). */
const PATCH_ONLY_JACKS = [
  { id: 'ALevel', label: 'Osc A level', short: 'Level', module: 'Osc A' },
  { id: 'BLevel', label: 'Osc B level', short: 'Level', module: 'Osc B' },
  { id: 'CLevel', label: 'Osc C level', short: 'Level', module: 'Osc C' },
  { id: 'FbZoomIn', label: 'Feedback zoom', short: 'Zoom', module: 'Feedback' },
  { id: 'FbTurnIn', label: 'Feedback turn', short: 'Turn', module: 'Feedback' },
  { id: 'FbHueIn', label: 'Feedback color', short: 'Color', module: 'Feedback' },
  { id: 'RotateIn', label: 'Picture rotate', short: 'Rotate', module: 'Picture' },
  { id: 'ScaleIn', label: 'Picture scale', short: 'Scale', module: 'Picture' },
  { id: 'MoveXIn', label: 'Picture move X', short: 'Move X', module: 'Picture' },
  { id: 'MoveYIn', label: 'Picture move Y', short: 'Move Y', module: 'Picture' },
  { id: 'RollIn', label: 'Tube roll', short: 'Roll', module: 'Tube' },
] as const;

function oscParams(i: number): ParamSpec[] {
  const n = 'ABC'[i], g = `Osc ${n}`, d = OSC_DEFAULTS[i], base = i * 12;
  return [
    spec(`vs${n}Freq`, 'Frequency', g, 0, 1, 0.001, d.freq, base),
    spec(`vs${n}Fine`, 'Fine', g, -1, 1, 0.001, 0, base + 1),
    spec(`vs${n}Sync`, 'Sync (free · H · V)', g, 0, 2, 0.001, d.sync, base + 2),
    spec(`vs${n}Shape`, 'Wave (saw · tri · sine)', g, 0, 1, 0.001, d.shape, base + 3),
    spec(`vs${n}ModMode`, 'Mod mode', g, 0, 2, 1, 0, base + 4, MOD_MODES),
    spec(`vs${n}Mod`, 'Mod amount', g, 0, 1, 0.001, d.mod, base + 5),
    spec(`vs${n}ModSrc`, 'Mod from', g, 0, SOURCES.length - 1, 1, d.modSrc, base + 6, SOURCES),
    spec(`vs${n}Fm`, 'FM amount', g, 0, 1, 0.001, d.fm, base + 7),
    spec(`vs${n}FmSrc`, 'FM from', g, 0, SOURCES.length - 1, 1, d.fmSrc, base + 8, SOURCES),
    spec(`vs${n}Hue`, 'Color', g, 0, 1, 0.001, d.hue, base + 9),
    spec(`vs${n}Sat`, 'Saturation', g, 0, 1, 0.001, d.sat, base + 10),
    spec(`vs${n}Level`, 'Level', g, 0, 1, 0.001, d.level, base + 11),
    spec(`vs${n}Input`, 'Draws', g, 0, 1, 1, 0, 61 + i, OSC_INPUTS),
  ];
}

export const VIDEOSYNTH_PARAMS: ParamSpec[] = [
  ...oscParams(0),
  ...oscParams(1),
  ...oscParams(2),
  spec('vsMix', 'Mixer', 'Mixer', 0, 2, 1, 0, 36, MIX_MODES),
  spec('vsX', 'Move X', 'Picture', -1, 1, 0.001, 0, 37),
  spec('vsY', 'Move Y', 'Picture', -1, 1, 0.001, 0, 38),
  spec('vsRotate', 'Rotate', 'Picture', -180, 180, 0.1, 0, 39),
  spec('vsScale', 'Scale', 'Picture', 0.25, 2, 0.001, 1, 40),
  spec('vsKaleido', 'Mirror segments', 'Picture', 0, 16, 1, 0, 41),
  spec('vsFeedback', 'Feedback', 'Feedback', 0, 1, 0.001, 0.4, 42),
  spec('vsFbZoom', 'Zoom', 'Feedback', 0.9, 1.1, 0.0005, 1.008, 43),
  spec('vsFbRotate', 'Turn', 'Feedback', -10, 10, 0.01, 0.25, 44),
  spec('vsFbX', 'Drift X', 'Feedback', -0.05, 0.05, 0.0005, 0, 45),
  spec('vsFbY', 'Drift Y', 'Feedback', -0.05, 0.05, 0.0005, 0, 46),
  spec('vsFbHue', 'Color shift', 'Feedback', 0, 1, 0.001, 0.02, 47),
  spec('vsLfo1Rate', 'LFO 1 rate', 'LFOs', 0, 1, 0.001, 0.35, 48),
  spec('vsLfo1Skew', 'LFO 1 shape', 'LFOs', 0, 1, 0.001, 0.5, 49),
  spec('vsLfo2Rate', 'LFO 2 rate', 'LFOs', 0, 1, 0.001, 0.25, 50),
  spec('vsLfo2Skew', 'LFO 2 shape', 'LFOs', 0, 1, 0.001, 0.5, 51),
  spec('vsLfo3Rate', 'LFO 3 rate', 'LFOs', 0, 1, 0.001, 0.15, 52),
  spec('vsLfo3Skew', 'LFO 3 shape', 'LFOs', 0, 1, 0.001, 0.5, 53),
  spec('vsScanlines', 'Scanlines', 'Tube', 0, 1, 0.001, 0.3, 54),
  spec('vsBleed', 'Color bleed', 'Tube', 0, 1, 0.001, 0.3, 55),
  spec('vsRoll', 'Roll', 'Tube', 0, 1, 0.001, 0, 56),
  spec('vsGlow', 'Glow', 'Tube', 0, 1, 0.001, 0.2, 57),
  spec('vsReact', 'Follow the music', 'Music', 0, 1, 0.001, 0.5, 58),
  ...PATCH_ONLY_JACKS.flatMap((j, i) => [
    spec(`vs${j.id}Src`, `${j.label} from`, 'Patch', 0, SOURCES.length - 1, 1, 0, 64 + i * 2, SOURCES),
    spec(`vs${j.id}Amt`, `${j.label} amount`, 'Patch', -1, 1, 0.001, 0.5, 65 + i * 2),
  ]),
];

/**
 * The patch bay. Outputs are the sources (one jack each, any number of
 * cables). Inputs are where a cable goes (one cable each): every input is a
 * source setting and an amount. An input's normal is the connection it has
 * with no cable in it; a cable replaces the normal, and pulling the cable out
 * brings the normal back. Pulling out a normal breaks it.
 */
export type OutputJack = { source: number; label: string };
export type InputJack = { id: string; label: string; module: string; srcKey: string; amtKey: string; normal: number };

/** Every source but Off, as jacks. */
export const OUTPUT_JACKS: OutputJack[] = [
  { source: 1, label: 'Out' }, { source: 2, label: 'Osc A' }, { source: 3, label: 'Osc B' }, { source: 4, label: 'Osc C' },
  { source: 5, label: 'LFO 1' }, { source: 6, label: 'LFO 2' }, { source: 7, label: 'LFO 3' },
  { source: 8, label: 'Bass' }, { source: 9, label: 'Mids' }, { source: 10, label: 'Highs' }, { source: 11, label: 'Level' },
  { source: 12, label: 'Kick' }, { source: 13, label: 'Input' },
];

export const INPUT_JACKS: InputJack[] = [
  ...(['A', 'B', 'C'] as const).flatMap((n, i): InputJack[] => [
    { id: `${n}Mod`, label: 'Mod', module: `Osc ${n}`, srcKey: `vs${n}ModSrc`, amtKey: `vs${n}Mod`, normal: OSC_DEFAULTS[i].modSrc },
    { id: `${n}Fm`, label: 'FM', module: `Osc ${n}`, srcKey: `vs${n}FmSrc`, amtKey: `vs${n}Fm`, normal: OSC_DEFAULTS[i].fmSrc },
  ]),
  ...PATCH_ONLY_JACKS.map((j): InputJack => ({ id: j.id, label: j.short, module: j.module, srcKey: `vs${j.id}Src`, amtKey: `vs${j.id}Amt`, normal: 0 })),
];

/** The layer an oscillator draws, or that the Input source reads: an
 *  effect-source string, not a knob. Any layer works, a camera included. */
export const INPUT_LAYER_KEY = 'vsInputLayer';

/** Four stored patches at the corners of the snapshot pad. */
export const SNAPSHOTS_KEY = 'vsSnapshots';
export const MORPH_KEY = 'vsMorph';
export type Snapshots = (Record<string, number> | null)[];

/** Controls a snapshot holds and the pad blends: every knob, not the choices. */
export const MORPHABLE = (): ParamSpec[] => VIDEOSYNTH_PARAMS.filter((p) => !p.options && p.step !== 1);

/** The patch the empty corners hold while the pad moves (see morphBase). */
export const MORPH_BASE_KEY = 'vsMorphBase';

/** Controls that go round a circle: 0 and 1 are the same color. */
const CIRCULAR = new Set(['vsAHue', 'vsBHue', 'vsCHue']);

/**
 * Blend the four corner patches at (x, y): 0,0 is top left (corner 0), then
 * top right, bottom left, bottom right. An empty corner holds `base`, which
 * must stay the same through a gesture (morphBase), so the same point always
 * gives the same patch. Colors blend the short way round the color wheel.
 */
export function morphValues(snapshots: Snapshots, x: number, y: number, base: Record<string, number>): Record<string, number> {
  const fx = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)), fy = Math.max(0, Math.min(1, Number.isFinite(y) ? y : 0));
  const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const whole = w.indexOf(1);
  const out: Record<string, number> = {};
  for (const p of MORPHABLE()) {
    const at = (i: number) => snapshots[i]?.[p.key] ?? base[p.key] ?? p.default;
    // Right on a corner: exactly that corner.
    if (whole >= 0) { out[p.key] = at(whole); continue; }
    let v = 0;
    if (CIRCULAR.has(p.key)) {
      // Each corner's color as a step from corner 1's, the short way round
      // (at most half a turn), blended, then back onto the wheel. Corner 1
      // is a fixed reference, so the blend moves smoothly across the pad.
      const ref = at(0);
      for (let i = 0; i < 4; i++) { const d = at(i) - ref; v += w[i] * (d - Math.round(d)); }
      v = (((ref + v) % 1) + 1) % 1;
    } else {
      for (let i = 0; i < 4; i++) v += w[i] * at(i);
    }
    out[p.key] = v;
  }
  return out;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The patch the empty corners hold for a pad gesture starting now. It is the
 * one the pad last used, so going back to a point brings back the same
 * patch, except for controls turned since the pad last moved (they no longer
 * match what the pad set): those take their new value. The first time, it is
 * the patch as it stands.
 */
export function morphBase(source: Record<string, unknown> | null | undefined, snapshots: Snapshots): Record<string, number> {
  const current: Record<string, number> = Object.fromEntries(MORPHABLE().map((p) => [p.key, paramValue(source, p)]));
  const stored = source?.[MORPH_BASE_KEY] as Record<string, unknown> | undefined;
  const at = source?.[MORPH_KEY];
  if (!stored || typeof stored !== 'object' || !Array.isArray(at) || at.length !== 2) return current;
  const base: Record<string, number> = Object.fromEntries(MORPHABLE().map((p) => [p.key, finite(stored[p.key]) ? stored[p.key] as number : current[p.key]]));
  const set = morphValues(snapshots, Number(at[0]) || 0, Number(at[1]) || 0, base);
  for (const p of MORPHABLE()) {
    if (Math.abs(current[p.key] - set[p.key]) > 1e-6 * Math.max(1, p.max - p.min)) base[p.key] = current[p.key];
  }
  return base;
}

/** Slots the app fills after the controls. */
export const SLOT_ASPECT = 59;
export const SLOT_LINES = 60;
/** The signal model the shader follows (see MODEL_KEY). */
export const SLOT_MODEL = 86;
/** Three slots: the oscillators in the order they are worked out (oscillatorOrder). */
export const SLOT_ORDER = 87;
export const PARAM_FLOATS = 128;

/**
 * Which signal model a patch was made with, on the effect source. 2, the
 * current one: oscillators are worked out in the order their cables need
 * (any oscillator can listen to any other), an input with nothing patched
 * does nothing, and every running phase (oscillators, LFOs, roll) moves on
 * from where it is when its rate changes. 1: the first release, where A
 * could only be heard by B and C, an empty FM input lowered the pitch, an
 * empty Key input moved the threshold and the phases were rate × clock (so
 * a rate change late in a set jumped). A patch without the key was saved
 * before 2 existed and keeps model 1, so saved looks do not change; a new
 * patch and every factory preset start on 2. Not a control: Timeline, MIDI
 * and the pad never touch it.
 */
export const MODEL_KEY = 'vsModel';
export const SIGNAL_MODEL = 2;

export function signalModel(source: Record<string, unknown> | null | undefined): 1 | 2 {
  const v = Number(source?.[MODEL_KEY]);
  return Number.isFinite(v) && v >= 2 ? 2 : 1;
}

/** A new patch: every control at its default, on the current signal model. */
export const VIDEOSYNTH_DEFAULTS: Record<string, number> = {
  ...Object.fromEntries(VIDEOSYNTH_PARAMS.map((p) => [p.key, p.default])),
  [MODEL_KEY]: SIGNAL_MODEL,
};

/** Source numbers 2 to 4 are oscillators A to C. */
const OSC_SOURCE = 2;

/**
 * The order the shader works the oscillators out in (signal model 2), so
 * each one hears the oscillators it listens to (by Mod, FM or a cable into
 * its level) as already drawn at that point. Oscillators that listen to
 * each other in a ring cannot all go first: the ring is opened at its first
 * oscillator in A, B, C order, and an oscillator that hears one not yet
 * worked out (itself included) hears that one's bare wave, its knobs alone
 * with no modulation: one step of delay, the same at every pixel and frame.
 */
export function oscillatorOrder(source: Record<string, unknown> | null | undefined): number[] {
  const value = (key: string) => paramValue(source, VIDEOSYNTH_PARAMS.find((p) => p.key === key)!);
  const hears = [0, 1, 2].map((n) => {
    const name = 'ABC'[n];
    const from = [value(`vs${name}ModSrc`), value(`vs${name}FmSrc`), value(`vs${name}LevelSrc`)];
    return new Set(from.map((s) => s - OSC_SOURCE).filter((m) => m >= 0 && m <= 2 && m !== n));
  });
  const order: number[] = [];
  // Whether `from` hears `to`, through any chain of oscillators not yet placed.
  const reaches = (from: number, to: number, seen = new Set<number>()): boolean =>
    [...hears[from]].some((m) => !order.includes(m) && (m === to || (!seen.has(m) && reaches(m, to, seen.add(m)))));
  while (order.length < 3) {
    const left = [0, 1, 2].filter((n) => !order.includes(n));
    const ready = left.find((n) => [...hears[n]].every((m) => order.includes(m)));
    // Nothing is ready: open a ring at its first oscillator.
    order.push(ready ?? left.find((n) => reaches(n, n)) ?? left[0]);
  }
  return order;
}

/** A control's value from an effect source, clamped, or its default. */
export function paramValue(source: Record<string, unknown> | null | undefined, p: ParamSpec): number {
  const v = Number(source?.[p.key]);
  if (!Number.isFinite(v)) return p.default;
  const clamped = Math.max(p.min, Math.min(p.max, v));
  return p.options || p.step === 1 ? Math.round(clamped) : clamped;
}

/** The shader's parameter block. Degrees become radians on the way. */
export function paramBlock(source: Record<string, unknown> | null | undefined, aspect: number): Float32Array {
  const out = new Float32Array(PARAM_FLOATS);
  for (const p of VIDEOSYNTH_PARAMS) {
    const v = paramValue(source, p);
    out[p.slot] = p.key === 'vsRotate' || p.key === 'vsFbRotate' ? (v * Math.PI) / 180 : v;
  }
  out[SLOT_ASPECT] = aspect;
  out[SLOT_LINES] = 262;
  out[SLOT_MODEL] = signalModel(source);
  oscillatorOrder(source).forEach((n, i) => { out[SLOT_ORDER + i] = n; });
  return out;
}

/** Starting patches. Each is a set of changes from the defaults. */
export const VIDEOSYNTH_PRESETS: { id: string; name: string; values: Record<string, number> }[] = [
  { id: 'warm-up', name: 'Warm up', values: {} },
  {
    id: 'test-card', name: 'Test card',
    values: { vsFeedback: 0, vsASync: 1, vsBSync: 2, vsCSync: 1, vsAMod: 0, vsBMod: 0, vsCMod: 0, vsAFm: 0, vsBFm: 0, vsCFm: 0, vsMix: 2, vsScanlines: 0.5 },
  },
  {
    id: 'tunnel', name: 'Tunnel',
    values: { vsFeedback: 0.86, vsFbZoom: 0.965, vsFbRotate: 1.2, vsKaleido: 6, vsAFreq: 0.3, vsBLevel: 0.6, vsCLevel: 0.4, vsFbHue: 0.05 },
  },
  {
    id: 'key-bars', name: 'Key bars',
    values: { vsAModMode: 1, vsBModMode: 1, vsCModMode: 1, vsAMod: 0.6, vsBMod: 0.6, vsCMod: 0.6, vsMix: 1, vsFeedback: 0.3, vsBleed: 0.55 },
  },
  {
    id: 'melt', name: 'Melt',
    values: { vsAModMode: 2, vsBModMode: 2, vsFeedback: 0.92, vsFbZoom: 1.004, vsFbRotate: 0.1, vsFbY: -0.004, vsRoll: 0.15, vsGlow: 0.6 },
  },
];

export function presetValues(id: string): Record<string, number> {
  const p = VIDEOSYNTH_PRESETS.find((x) => x.id === id);
  return { ...VIDEOSYNTH_DEFAULTS, ...(p?.values ?? {}) };
}
