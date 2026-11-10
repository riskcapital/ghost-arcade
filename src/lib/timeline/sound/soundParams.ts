/**
 * What control lines can drive on a Timeline sound row (target
 * `{ scope: 'sound', id: rowId }`):
 *
 *   sound:volume            the row's level, 0..1
 *   sound:mute              bool
 *   sfx:<fxId>:<param>      a Music Studio effect's knob on the row, 0..1
 *                           (the same 0..1 values the studio's knobs set)
 *   duck:depth              how far the row dips when it ducks, 0..1
 */
import { macroFxDef } from '../../music/macroFx';
import type { ParamEntry } from '../lines/paramRegistry';
import type { OverrideRecord } from '../lines/lineEvaluator';
import type { SoundRow } from './soundModel';

export const SOUND_ROW_GROUP = 'Sound row';

export function soundRowParams(row: SoundRow): ParamEntry[] {
  const out: ParamEntry[] = [
    { key: 'sound:volume', label: 'Volume', group: SOUND_ROW_GROUP, min: 0, max: 1, step: 0.01, default: row.volume, kind: 'continuous' },
    { key: 'sound:mute', label: 'Mute', group: SOUND_ROW_GROUP, min: 0, max: 1, step: 1, default: row.muted, kind: 'bool' },
  ];
  if (row.kind === 'live') return out.filter((p) => p.key === 'sound:mute');
  for (const fx of row.fx) {
    const def = macroFxDef(fx.type);
    if (!def) continue;
    for (const p of def.params) {
      const value = fx.params[p.key]?.value ?? p.value;
      out.push({ key: `sfx:${fx.id}:${p.key}`, label: `${def.label} ${p.label}`, group: def.label, min: 0, max: 1, step: 0.01, default: value, kind: 'continuous' });
    }
  }
  if (row.duck) out.push({ key: 'duck:depth', label: 'Duck depth', group: 'Ducking', min: 0, max: 1, step: 0.01, default: row.duck.depth, kind: 'continuous' });
  return out;
}

/** The row's own (stored) value for a key. */
export function readSoundRowParam(row: SoundRow, key: string): number | undefined {
  if (key === 'sound:volume') return row.volume;
  if (key === 'sound:mute') return row.muted ? 1 : 0;
  if (key === 'duck:depth') return row.duck?.depth;
  if (key.startsWith('sfx:')) {
    const [, fxId, param] = key.split(':');
    return row.fx.find((f) => f.id === fxId)?.params[param]?.value;
  }
  return undefined;
}

/** Split an fx key: [fxId, param] or null. */
export function parseFxKey(key: string): [string, string] | null {
  if (!key.startsWith('sfx:')) return null;
  const [, fxId, param] = key.split(':');
  return fxId && param ? [fxId, param] : null;
}

export interface RowValues {
  volume: number;
  muted: boolean;
  duckDepth: number;
  /** Effect values by fx id (0..1 per knob), only for effects that are on. */
  fx: Map<string, Record<string, number>>;
}

/** The row as it sounds at one instant: its own values with the lines' on top. */
export function rowValues(row: SoundRow, lines: OverrideRecord | undefined): RowValues {
  const num = (k: string, d: number) => {
    const v = lines?.[k];
    return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : d;
  };
  const mute = lines?.['sound:mute'];
  const fx = new Map<string, Record<string, number>>();
  for (const f of row.fx) {
    if (!f.enabled) continue;
    const values: Record<string, number> = {};
    for (const [key, param] of Object.entries(f.params)) values[key] = num(`sfx:${f.id}:${key}`, param.value);
    fx.set(f.id, values);
  }
  return {
    volume: num('sound:volume', row.volume),
    muted: typeof mute === 'boolean' ? mute : typeof mute === 'number' ? mute >= 0.5 : row.muted,
    duckDepth: num('duck:depth', row.duck?.depth ?? 0),
    fx,
  };
}
