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

export type MacroFxType = 'delay' | 'filter' | 'reverb' | 'chorus' | 'phaser' | 'crush' | 'drive' | 'stutter' | 'autopan';

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
];

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
