/**
 * Colours of composition effects as one line value: a `color` param with its
 * R/G/B keys, or a `<base>R / <base>G / <base>B` triple of 0..1 settings,
 * packed 0xRRGGBB (the lines engine's colour kind). No store imports, so the
 * Stage row's registry (stageLedParams.ts) can use it too.
 */
import type { Effect, EffectType } from '../../types';
import { effectParamLabels, type ParamMeta } from '../../effects/effectUX';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface EffectColourGroup {
  /** Key part: `rgb:<base>`. */
  base: string;
  label: string;
  r: string;
  g: string;
  b: string;
}

const colourMemo = new Map<string, EffectColourGroup[]>();

/**
 * The colours of an effect type: a `color` param with its R/G/B keys, and
 * every `<base>R / <base>G / <base>B` triple of 0..1 settings.
 */
export function effectColourGroups(type: EffectType | string): EffectColourGroup[] {
  const hit = colourMemo.get(type);
  if (hit) return hit;
  const labels = (effectParamLabels as Record<string, Record<string, ParamMeta> | undefined>)[type] ?? {};
  const out: EffectColourGroup[] = [];
  const used = new Set<string>();
  for (const [name, meta] of Object.entries(labels)) {
    if (meta.type === 'color' && meta.colorParams) {
      const { r, g, b } = meta.colorParams;
      out.push({ base: name.replace(/R$/, ''), label: meta.label, r, g, b });
      used.add(r); used.add(g); used.add(b);
    }
  }
  for (const [name, meta] of Object.entries(labels)) {
    if (used.has(name) || !/R$/.test(name)) continue;
    const base = name.slice(0, -1);
    const g = labels[`${base}G`];
    const b = labels[`${base}B`];
    if (!g || !b || meta.max > 1.001 || g.max > 1.001 || b.max > 1.001 || meta.min < 0) continue;
    const label = meta.label.replace(/\s*(R|Red)$/i, '').trim() || base;
    out.push({ base, label, r: name, g: `${base}G`, b: `${base}B` });
    used.add(name); used.add(`${base}G`); used.add(`${base}B`);
  }
  colourMemo.set(type, out);
  return out;
}

/** The packed colour of a group in an effect's params (defaults filled in). */
export function readEffectColour(effect: Pick<Effect, 'type' | 'params'>, group: EffectColourGroup): number {
  const labels = (effectParamLabels as Record<string, Record<string, ParamMeta> | undefined>)[effect.type] ?? {};
  const p = (effect.params ?? {}) as Record<string, unknown>;
  const ch = (k: string) => {
    const v = typeof p[k] === 'number' ? (p[k] as number) : labels[k]?.default ?? 0;
    return clamp(Math.round(v * 255), 0, 255);
  };
  return (ch(group.r) << 16) | (ch(group.g) << 8) | ch(group.b);
}

/** Writes a packed colour into an effect's (copied) params. */
export function writeEffectColour(params: Record<string, unknown>, group: EffectColourGroup, value: number): void {
  const n = clamp(Math.round(value) || 0, 0, 0xffffff);
  params[group.r] = ((n >> 16) & 255) / 255;
  params[group.g] = ((n >> 8) & 255) / 255;
  params[group.b] = (n & 255) / 255;
}
