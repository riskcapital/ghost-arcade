/**
 * Sound effects that live on a macro knob.
 *
 * Each macro can hold a chain of audio effects on the studio's master bus.
 * Every effect parameter has a set value and a macro amount: turning the
 * macro pushes the parameter from its set value by that amount (a negative
 * amount pulls it down). So one knob can open a delay, close a filter and
 * thicken a chorus at once, while the same macro's visual effects move with
 * it. Values are 0-1 here; each effect maps them to useful ranges.
 */

export type MacroFxType = 'delay' | 'filter' | 'reverb' | 'chorus' | 'phaser' | 'crush' | 'drive' | 'stutter' | 'autopan' | 'eq' | 'compressor' | 'tape' | 'spring'
  | 'grains' | 'shimmer' | 'freqshift' | 'ring' | 'resonator' | 'vowel' | 'fold' | 'reverse' | 'glitch' | 'tapestop' | 'harmony';

export interface MacroFxParamDef {
  key: string;
  label: string;
  /** Set value. */
  value: number;
  /** How far a full macro pushes it, -1 to 1. */
  depth: number;
  format: (v: number, tempo: number) => string;
}

export interface MacroFxDef {
  type: MacroFxType;
  label: string;
  /** Where it sits in the Add effect menu. */
  group?: 'classic' | 'wild';
  /** One line on what it does, for the menu's tooltip. */
  blurb?: string;
  params: MacroFxParamDef[];
}

/** Beat divisions the delay and stutter lock to, shortest first. */
export const DIVISIONS: { label: string; beats: number }[] = [
  { label: '1/32', beats: 0.125 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16 dotted', beats: 0.375 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8 dotted', beats: 0.75 },
  { label: '1/4', beats: 1 },
  { label: '1/4 dotted', beats: 1.5 },
  { label: '1/2', beats: 2 },
  { label: '1 bar', beats: 4 },
];

export function division(v: number): { label: string; beats: number } {
  return DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, Math.round(v * (DIVISIONS.length - 1))))];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const hz = (lo: number, hi: number) => (v: number) => {
  const f = lo * Math.pow(hi / lo, v);
  return f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`;
};
const rate = (lo: number, hi: number) => (v: number) => `${(lo * Math.pow(hi / lo, v)).toFixed(2)} Hz`;
const div = (v: number) => division(v).label;
const db = (v: number) => `${v >= 0.5 ? '+' : ''}${Math.round((v - 0.5) * 24)} dB`;
const steps = (labels: string[]) => (v: number) => labels[Math.max(0, Math.min(labels.length - 1, Math.round(v * (labels.length - 1))))];
const ms = (lo: number, hi: number) => (v: number) => `${Math.round(lo * Math.pow(hi / lo, v))} ms`;
const seconds = (lo: number, hi: number) => (v: number) => `${(lo * Math.pow(hi / lo, v)).toFixed(1)} s`;
const semis = (v: number) => { const st = Math.round(v * 24 - 12); return st === 0 ? 'Unison' : `${st > 0 ? '+' : ''}${st} st`; };
const shiftHz = (v: number) => { const s = v * 2 - 1; const hzv = Math.sign(s) * (Math.pow(2, Math.abs(s) * 11) - 1); return Math.abs(hzv) < 1 ? '0 Hz' : `${hzv > 0 ? '+' : ''}${Math.abs(hzv) >= 1000 ? (hzv / 1000).toFixed(1) + ' k' : Math.round(hzv) + ' '}Hz`; };
const p = (key: string, label: string, value: number, depth: number, format: MacroFxParamDef['format'] = pct): MacroFxParamDef =>
  ({ key, label, value, depth, format });

export const MACRO_FX: MacroFxDef[] = [
  { type: 'delay', label: 'Delay', params: [
    p('time', 'Time', 0.6, 0, div), p('feedback', 'Feedback', 0.45, 0.3), p('tone', 'Tone', 0.6, -0.2),
    p('spread', 'Ping-pong', 0.7, 0), p('mix', 'Mix', 0, 0.6),
  ] },
  { type: 'filter', label: 'Filter', params: [
    p('cutoff', 'Cutoff', 1, -0.75, hz(60, 18000)), p('reso', 'Reso', 0.3, 0.3),
    p('mode', 'Mode', 0, 0, (v) => (v < 0.34 ? 'Low-pass' : v < 0.67 ? 'Band-pass' : 'High-pass')),
    p('drive', 'Drive', 0.1, 0), p('mix', 'Mix', 1, 0),
  ] },
  { type: 'reverb', label: 'Reverb', params: [
    p('size', 'Size', 0.7, 0.2), p('decay', 'Decay', 0.6, 0.2), p('damping', 'Damping', 0.4, 0),
    p('predelay', 'Pre-delay', 0.1, 0, (v) => `${Math.round(v * 200)} ms`), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'chorus', label: 'Chorus', params: [
    p('rate', 'Rate', 0.3, 0.2, rate(0.05, 6)), p('depth', 'Depth', 0.4, 0.4), p('feedback', 'Feedback', 0.2, 0),
    p('mix', 'Mix', 0, 0.6),
  ] },
  { type: 'phaser', label: 'Phaser', params: [
    p('rate', 'Rate', 0.35, 0.2, rate(0.05, 8)), p('depth', 'Depth', 0.6, 0.3), p('feedback', 'Feedback', 0.5, 0.2),
    p('mix', 'Mix', 0, 0.6),
  ] },
  { type: 'crush', label: 'Bitcrush', params: [
    p('bits', 'Bits', 1, -0.7, (v) => `${Math.round(2 + v * 14)} bit`), p('tone', 'Tone', 0.7, -0.3), p('mix', 'Mix', 0, 0.8),
  ] },
  { type: 'drive', label: 'Drive', params: [
    p('gain', 'Gain', 0.2, 0.7), p('tone', 'Tone', 0.6, 0), p('mix', 'Mix', 0.6, 0.3),
  ] },
  { type: 'stutter', label: 'Stutter', params: [
    p('length', 'Length', 0.25, 0, div), p('engage', 'Engage', 0, 1, (v) => (v > 0.5 ? 'Repeating' : 'Off')),
  ] },
  { type: 'autopan', label: 'Auto-pan', params: [
    p('rate', 'Rate', 0.4, 0.3, rate(0.05, 10)), p('depth', 'Depth', 0, 0.9),
  ] },
  { type: 'eq', label: 'EQ', params: [
    p('low', 'Low', 0.5, 0, db), p('mid', 'Mid', 0.5, 0, db), p('high', 'High', 0.5, 0, db),
    p('midFreq', 'Mid freq', 0.5, 0, hz(200, 5000)),
  ] },
  { type: 'compressor', label: 'Compressor', params: [
    p('threshold', 'Threshold', 0.5, -0.3, (v) => `${Math.round(-v * 48)} dB`), p('ratio', 'Ratio', 0.4, 0, (v) => `${(1 + v * 19).toFixed(1)}:1`),
    p('attack', 'Attack', 0.2, 0, (v) => `${Math.round(1 + v * 99)} ms`), p('makeup', 'Make-up', 0.3, 0, (v) => `+${Math.round(v * 18)} dB`), p('mix', 'Mix', 1, 0),
  ] },
  { type: 'tape', label: 'Tape echo', params: [
    p('time', 'Time', 0.55, 0, div), p('feedback', 'Feedback', 0.55, 0.3), p('tone', 'Tone', 0.4, -0.2),
    p('wow', 'Wow', 0.4, 0), p('mix', 'Mix', 0, 0.6),
  ] },
  { type: 'spring', label: 'Spring', params: [
    p('tone', 'Tone', 0.5, 0), p('mix', 'Mix', 0, 0.6),
  ] },
];

/** Sample-by-sample effects: run on the audio thread (fxDsp.ts), every knob smoothed. */
const WILD: MacroFxDef[] = [
  { type: 'grains', label: 'Grain cloud', group: 'wild', blurb: 'Scatters tiny slices of the sound in time and pitch, forwards and backwards', params: [
    p('size', 'Grain', 0.4, 0, ms(30, 500)), p('density', 'Density', 0.5, 0.3, (v) => `${Math.round(2 * Math.pow(30, v))}/s`),
    p('pitch', 'Pitch', 0.4, 0, steps(['-1 oct', '-5th', 'Unison', '+5th', '+1 oct', '+2 oct'])), p('spray', 'Spray', 0.4, 0.3),
    p('reverse', 'Reverse', 0.25, 0), p('feedback', 'Feedback', 0.3, 0.2), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'shimmer', label: 'Shimmer', group: 'wild', blurb: 'A huge reverb whose tail climbs an octave on every pass', params: [
    p('size', 'Size', 0.7, 0), p('decay', 'Decay', 0.7, 0.2, seconds(1, 30)), p('shimmer', 'Shimmer', 0.5, 0.4),
    p('tone', 'Tone', 0.55, 0), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'freqshift', label: 'Frequency shift', group: 'wild', blurb: 'Moves every frequency by the same hertz: bells, robots, a barber-pole climb', params: [
    p('shift', 'Shift', 0.62, 0.2, shiftHz), p('spread', 'Spread', 0.3, 0), p('feedback', 'Feedback', 0.2, 0.3), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'ring', label: 'Ring mod', group: 'wild', blurb: 'Multiplies the sound by a tone: metal, bells, sci-fi voices', params: [
    p('freq', 'Freq', 0.45, 0.3, hz(20, 4000)), p('wobble', 'Wobble', 0.2, 0.3), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'resonator', label: 'Resonator', group: 'wild', blurb: 'Four tuned strings the sound rings through: drums come out as a chord', params: [
    p('note', 'Note', 2 / 11, 0, steps(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])),
    p('chord', 'Chord', 0, 0, steps(['Fifths', 'Major', 'Minor', 'Fourths', 'Cluster'])),
    p('decay', 'Decay', 0.6, 0.3), p('bright', 'Bright', 0.5, 0), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'vowel', label: 'Vowel', group: 'wild', blurb: 'Formant filters that make the sound speak, a-e-i-o-u', params: [
    p('vowel', 'Vowel', 0, 1, steps(['A', 'E', 'I', 'O', 'U'])), p('talk', 'Talk', 0.3, 0.3), p('rate', 'Rate', 0.4, 0, rate(0.1, 8)),
    p('reso', 'Reso', 0.5, 0), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'fold', label: 'Wavefolder', group: 'wild', blurb: 'Folds the wave back on itself: harmonics bloom instead of clipping', params: [
    p('drive', 'Drive', 0.35, 0.6), p('symmetry', 'Symmetry', 0.5, 0), p('tone', 'Tone', 0.7, 0), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'reverse', label: 'Reverse delay', group: 'wild', blurb: 'Plays the last beat backwards, in time', params: [
    p('time', 'Time', 0.625, 0, div), p('feedback', 'Feedback', 0.4, 0.3), p('tone', 'Tone', 0.6, 0), p('mix', 'Mix', 0, 0.7),
  ] },
  { type: 'glitch', label: 'Glitch', group: 'wild', blurb: 'Cuts the beat up as it plays: repeats, rolls, flips, octave drops, brakes', params: [
    p('division', 'Step', 0.25, 0, div), p('chance', 'Chance', 0, 0.8), p('variety', 'Variety', 0.5, 0, steps(['Tame', 'Wild', 'Wilder'])),
    p('mix', 'Mix', 1, 0),
  ] },
  { type: 'tapestop', label: 'Tape stop', group: 'wild', blurb: 'The record-player brake: slows to a halt, spins back up when let go', params: [
    p('engage', 'Engage', 0, 1, (v) => (v > 0.5 ? 'Stopping' : 'Playing')), p('time', 'Time', 0.4, 0, seconds(0.15, 3)),
  ] },
  { type: 'harmony', label: 'Harmonizer', group: 'wild', blurb: 'Two extra voices at set intervals, one each side', params: [
    p('voice1', 'Voice 1', 19 / 24, 0, semis), p('voice2', 'Voice 2', 1, 0, semis), p('detune', 'Width', 0.2, 0),
    p('level2', 'Voice 2 level', 0.7, 0), p('mix', 'Mix', 0, 0.6),
  ] },
];
for (const def of MACRO_FX) def.group ??= 'classic';
MACRO_FX.push(...WILD);

export function macroFxDef(type: MacroFxType): MacroFxDef {
  return MACRO_FX.find((d) => d.type === type)!;
}

export interface MacroFxParam {
  value: number;
  depth: number;
}

export interface MacroFxInstance {
  id: string;
  type: MacroFxType;
  enabled: boolean;
  params: Record<string, MacroFxParam>;
}

export function createMacroFx(id: string, type: MacroFxType): MacroFxInstance {
  const def = macroFxDef(type);
  return {
    id,
    type,
    enabled: true,
    params: Object.fromEntries(def.params.map((pd) => [pd.key, { value: pd.value, depth: pd.depth }])),
  };
}

/** A parameter's value with its macro at `macro` (0-1). */
export function effectiveValue(param: MacroFxParam, macro: number): number {
  return Math.max(0, Math.min(1, param.value + param.depth * macro));
}

export function normalizeMacroFx(raw: unknown): Record<string, MacroFxInstance[]> {
  const out: Record<string, MacroFxInstance[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [macroId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const fx: MacroFxInstance[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Partial<MacroFxInstance>;
      if (typeof it.id !== 'string' || !MACRO_FX.some((d) => d.type === it.type)) continue;
      const base = createMacroFx(it.id, it.type as MacroFxType);
      for (const key of Object.keys(base.params)) {
        const saved = (it.params as Record<string, Partial<MacroFxParam>> | undefined)?.[key];
        const value = Number(saved?.value);
        const depth = Number(saved?.depth);
        if (Number.isFinite(value)) base.params[key].value = Math.max(0, Math.min(1, value));
        if (Number.isFinite(depth)) base.params[key].depth = Math.max(-1, Math.min(1, depth));
      }
      base.enabled = it.enabled !== false;
      fx.push(base);
    }
    if (fx.length) out[macroId] = fx;
  }
  return out;
}
