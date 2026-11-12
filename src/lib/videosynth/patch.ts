/**
 * Phosphor, a video synthesizer: the controls of a patch.
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
 * itself, then finished like a tube: scanlines, colour bleed and roll.
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
export const SOURCES = ['Off', 'Feedback', 'Osc A', 'Osc B', 'Osc C', 'LFO 1', 'LFO 2', 'LFO 3', 'Bass', 'Mids', 'Highs', 'Level', 'Kick'];
export const MOD_MODES = ['Phase', 'Key', 'Hue'];
export const MIX_MODES = ['Brightest', 'Layer', 'YUV'];

const OSC_DEFAULTS = [
  { freq: 0.42, sync: 0.85, shape: 1, mod: 0.3, modSrc: 1, fm: 0.08, fmSrc: 5, hue: 0.0, sat: 0.85 },
  { freq: 0.5, sync: 1.35, shape: 0.5, mod: 0.4, modSrc: 2, fm: 0.08, fmSrc: 6, hue: 0.33, sat: 0.85 },
  { freq: 0.58, sync: 1.8, shape: 1, mod: 0.35, modSrc: 3, fm: 0.08, fmSrc: 7, hue: 0.66, sat: 0.85 },
];

const spec = (key: string, label: string, group: string, min: number, max: number, step: number, value: number, slot: number, options?: string[]): ParamSpec => ({
  key, label, group, min, max, step, default: value, slot, ...(options ? { options } : {}),
});

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
    spec(`vs${n}Hue`, 'Colour', g, 0, 1, 0.001, d.hue, base + 9),
    spec(`vs${n}Sat`, 'Saturation', g, 0, 1, 0.001, d.sat, base + 10),
    spec(`vs${n}Level`, 'Level', g, 0, 1, 0.001, 1, base + 11),
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
  spec('vsFeedback', 'Feedback', 'Feedback', 0, 1, 0.001, 0.55, 42),
  spec('vsFbZoom', 'Zoom', 'Feedback', 0.9, 1.1, 0.0005, 1.012, 43),
  spec('vsFbRotate', 'Turn', 'Feedback', -10, 10, 0.01, 0.4, 44),
  spec('vsFbX', 'Drift X', 'Feedback', -0.05, 0.05, 0.0005, 0, 45),
  spec('vsFbY', 'Drift Y', 'Feedback', -0.05, 0.05, 0.0005, 0, 46),
  spec('vsFbHue', 'Colour shift', 'Feedback', 0, 1, 0.001, 0.02, 47),
  spec('vsLfo1Rate', 'LFO 1 rate', 'LFOs', 0, 1, 0.001, 0.35, 48),
  spec('vsLfo1Skew', 'LFO 1 shape', 'LFOs', 0, 1, 0.001, 0.5, 49),
  spec('vsLfo2Rate', 'LFO 2 rate', 'LFOs', 0, 1, 0.001, 0.25, 50),
  spec('vsLfo2Skew', 'LFO 2 shape', 'LFOs', 0, 1, 0.001, 0.5, 51),
  spec('vsLfo3Rate', 'LFO 3 rate', 'LFOs', 0, 1, 0.001, 0.15, 52),
  spec('vsLfo3Skew', 'LFO 3 shape', 'LFOs', 0, 1, 0.001, 0.5, 53),
  spec('vsScanlines', 'Scanlines', 'Tube', 0, 1, 0.001, 0.35, 54),
  spec('vsBleed', 'Colour bleed', 'Tube', 0, 1, 0.001, 0.3, 55),
  spec('vsRoll', 'Roll', 'Tube', 0, 1, 0.001, 0, 56),
  spec('vsGlow', 'Glow', 'Tube', 0, 1, 0.001, 0.3, 57),
  spec('vsReact', 'Follow the music', 'Music', 0, 1, 0.001, 0.5, 58),
];

/** Slots the app fills after the controls. */
export const SLOT_ASPECT = 59;
export const SLOT_LINES = 60;
export const PARAM_FLOATS = 64;

export const VIDEOSYNTH_DEFAULTS: Record<string, number> = Object.fromEntries(VIDEOSYNTH_PARAMS.map((p) => [p.key, p.default]));

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
