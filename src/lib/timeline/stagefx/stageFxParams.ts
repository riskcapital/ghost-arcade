/**
 * Control-line parameters of the Stage group's blocks, and the colour
 * parameters of composition effects.
 *
 * Screen FX block (target { scope: 'block', id }):
 *   sfx:mix              the effect's wet/dry (its opacity)
 *   sfx:param:<key>      every generator setting (speed, width, origin, rate…)
 *   sfx:color / color2   lit / rest colour of a colour chase (packed 0xRRGGBB)
 *   sfx:output           0 brightness, 1 colour, 2 both (stepped)
 *   sfx:colorStyle       0 two colours, 1 rainbow (stepped)
 *   where:*              when the block has a where line (paramRegistry)
 * Effects block:
 *   fxb:mix              the effect's mix
 *   fxb:param:<name>     every number setting (select = stepped)
 *   fxb:rgb:<base>       a colour made of three R/G/B settings (packed)
 * Composition effects (Stage row, scope 'stage'):
 *   stage:fx:<id>:rgb:<base>   the same colour keys (stageLedParams.ts)
 *
 * Writers return copies; the block's (and project's) objects never change.
 */
import type { Effect, EffectType, StageEffect } from '../../types';
import { effectParamLabels, type ParamMeta } from '../../effects/effectUX';
import { effectColourGroups, readEffectColour, writeEffectColour } from './effectColours';
import { getEffectDef, DEFAULT_CHASE_COLOR, DEFAULT_CHASE_COLOR2 } from '../../stores/stageEffects';
import type { ParamEntry } from '../lines/paramRegistry';
import type { OverrideRecord } from '../lines/lineEvaluator';
import type { TimelineStageClip } from './stageClips';

const hexToInt = (hex: string | undefined, fallback: string) => Number.parseInt((hex && /^#?[0-9a-f]{6}$/i.test(hex) ? hex : fallback).replace('#', ''), 16) || 0;
const intToHex = (v: number) => `#${Math.max(0, Math.min(0xffffff, Math.round(v) || 0)).toString(16).padStart(6, '0')}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const OUTPUTS = ['brightness', 'color', 'both'] as const;
const STYLES = ['two-tone', 'rainbow'] as const;

// ── Screen FX block ────────────────────────────────────────────────────────

export function screenFxBlockParams(clip: TimelineStageClip): ParamEntry[] {
  const fx = clip.screenFx;
  if (!fx) return [];
  const def = getEffectDef(fx.type);
  const group = `Screen FX · ${def?.label ?? fx.type}`;
  const out: ParamEntry[] = [
    { key: 'sfx:mix', label: 'Screen FX mix', group, min: 0, max: 1, step: 0.01, default: fx.opacity ?? 1, kind: 'continuous' },
  ];
  for (const spec of def?.paramSpecs ?? []) {
    const step = spec.step ?? 0.01;
    out.push({
      key: `sfx:param:${spec.key}`, label: spec.label, group, min: spec.min, max: spec.max, step,
      default: fx.params[spec.key] ?? def?.defaultParams[spec.key] ?? spec.min,
      kind: step >= 1 ? 'stepped' : 'continuous',
    });
  }
  out.push(
    { key: 'sfx:color', label: 'Lit colour', group, min: 0, max: 0xffffff, step: 1, default: hexToInt(fx.color, DEFAULT_CHASE_COLOR), kind: 'colour' },
    { key: 'sfx:color2', label: 'Rest colour', group, min: 0, max: 0xffffff, step: 1, default: hexToInt(fx.color2, DEFAULT_CHASE_COLOR2), kind: 'colour' },
    { key: 'sfx:output', label: 'Drives (brightness / colour / both)', group, min: 0, max: 2, step: 1, default: Math.max(0, OUTPUTS.indexOf(fx.output ?? 'brightness')), kind: 'stepped' },
    { key: 'sfx:colorStyle', label: 'Colour style (two / rainbow)', group, min: 0, max: 1, step: 1, default: fx.colorStyle === 'rainbow' ? 1 : 0, kind: 'stepped' },
  );
  return out;
}

/** The block's effect with its `sfx:` line values (a copy, or the same object). */
export function applyScreenFxLines(fx: StageEffect, rec: OverrideRecord | undefined | null): StageEffect {
  if (!rec) return fx;
  let next: StageEffect | null = null;
  for (const key in rec) {
    if (!key.startsWith('sfx:')) continue;
    next ??= { ...fx, params: { ...fx.params } };
    const raw = rec[key];
    const v = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
    if (key === 'sfx:mix') next.opacity = clamp(v, 0, 1);
    else if (key === 'sfx:color') next.color = intToHex(v);
    else if (key === 'sfx:color2') next.color2 = intToHex(v);
    else if (key === 'sfx:output') next.output = OUTPUTS[clamp(Math.round(v), 0, 2)];
    else if (key === 'sfx:colorStyle') next.colorStyle = STYLES[clamp(Math.round(v), 0, 1)];
    else if (key.startsWith('sfx:param:')) next.params[key.slice(10)] = v;
  }
  return next ?? fx;
}

// ── Effects block ──────────────────────────────────────────────────────────

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function effectBlockParams(clip: TimelineStageClip): ParamEntry[] {
  const effect = clip.effect;
  if (!effect) return [];
  const group = `Effect · ${capital(effect.type)}`;
  const params = (effect.params ?? {}) as Record<string, unknown>;
  const out: ParamEntry[] = [
    { key: 'fxb:mix', label: 'Effect mix', group, min: 0, max: 1, step: 0.01, default: effect.opacity ?? 1, kind: 'continuous' },
  ];
  const colours = effectColourGroups(effect.type);
  for (const c of colours) {
    out.push({ key: `fxb:rgb:${c.base}`, label: c.label, group, min: 0, max: 0xffffff, step: 1, default: readEffectColour(effect, c), kind: 'colour' });
  }
  for (const [name, meta] of Object.entries((effectParamLabels as Record<string, Record<string, ParamMeta> | undefined>)[effect.type] ?? {})) {
    if (meta.type === 'color') continue;
    const current = params[name];
    out.push({
      key: `fxb:param:${name}`, label: meta.label, group, min: meta.min, max: meta.max, step: meta.step || 0.01,
      default: typeof current === 'number' ? current : meta.default,
      kind: meta.type === 'select' ? 'stepped' : 'continuous',
    });
  }
  return out;
}

/** The block's effect with its `fxb:` line values (a copy, or the same object). */
export function applyEffectBlockLines(effect: Effect, rec: OverrideRecord | undefined | null): Effect {
  if (!rec) return effect;
  let next: (Effect & { params: Record<string, unknown> }) | null = null;
  for (const key in rec) {
    if (!key.startsWith('fxb:')) continue;
    next ??= { ...effect, params: { ...(effect.params as Record<string, unknown>) } } as Effect & { params: Record<string, unknown> };
    const raw = rec[key];
    const v = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
    if (key === 'fxb:mix') next.opacity = clamp(v, 0, 1);
    else if (key.startsWith('fxb:param:')) next.params[key.slice(10)] = v;
    else if (key.startsWith('fxb:rgb:')) {
      const group = effectColourGroups(effect.type).find((g) => g.base === key.slice(8));
      if (group) writeEffectColour(next.params, group, v);
    }
  }
  return (next ?? effect) as Effect;
}

/** The parameters a Stage group block offers (by row). */
export function stageBlockParams(clip: TimelineStageClip): ParamEntry[] {
  return clip.row === 'screenfx' ? screenFxBlockParams(clip) : effectBlockParams(clip);
}

/** A Stage block's own value for one of its keys. */
export function readStageBlockParam(clip: TimelineStageClip, key: string): number | undefined {
  const entry = stageBlockParams(clip).find((p) => p.key === key);
  return entry && typeof entry.default === 'number' ? entry.default : undefined;
}
