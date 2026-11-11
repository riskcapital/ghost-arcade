/**
 * The Stage group's two block rows on the Timeline:
 *
 *   Screen FX  a stage effect (radial pulse, sweep, chase, strobe, beat
 *              pulse…) that modulates each piece's brightness / colour for
 *              the block's span. The block carries its own copy of the
 *              effect (`screenFx`): editing the block never touches the
 *              project's Screen FX.
 *   Effects    a composition effect over the whole stage (invert, colour,
 *              blur…) switched on for the block's span, with its own copy
 *              of the effect and its settings (`effect`).
 *
 * On both rows overlapping blocks crossfade over their overlap; touching
 * blocks cut; fades ramp a block in and out. Saved in the Timeline document
 * as plain JSON (`stageClips`); see normalizeStageClip.
 */
import type { Effect, EffectType, StageEffect, StageEffectType } from '../../types';
import { STAGE_EFFECT_CATALOG, getEffectDef } from '../../stores/stageEffects';
import { normalizeWhere, type WhereSpec } from '../where/whereModel';
import { generateUUID } from '../../utils/uuid';

export const STAGE_CLIP_ROWS = ['screenfx', 'effects'] as const;
export type StageClipRow = (typeof STAGE_CLIP_ROWS)[number];

export interface TimelineStageClip {
  id: string;
  row: StageClipRow;
  startTime: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  /** Screen FX row: the block's own stage effect. */
  screenFx?: StageEffect;
  /** Effects row: the block's own composition effect. */
  effect?: Effect;
  /** Screen FX row: which pieces the effect touches, over time. */
  where?: WhereSpec | null;
  label?: string;
}

export const STAGE_CLIP_DEFAULT_SECONDS = 8;
const MIN_SECONDS = 0.05;
const EPS = 1e-9;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const HEX = /^#[0-9a-f]{6}$/i;
const SCREEN_FX_TYPES = new Set<string>(STAGE_EFFECT_CATALOG.map((d) => d.type));

function numbers(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

/** A stage effect as a block keeps it (a copy, defaults filled in). */
export function normalizeScreenFx(raw: unknown): StageEffect | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== 'string' || !SCREEN_FX_TYPES.has(e.type)) return null;
  const type = e.type as StageEffectType;
  const def = getEffectDef(type);
  const out: StageEffect = {
    id: typeof e.id === 'string' && e.id ? e.id : generateUUID(),
    type,
    enabled: true,
    opacity: clamp(num(e.opacity, 1), 0, 1),
    params: { ...(def?.defaultParams ?? {}), ...numbers(e.params) },
  };
  if (e.output === 'color' || e.output === 'both' || e.output === 'brightness') out.output = e.output;
  if (e.colorStyle === 'two-tone' || e.colorStyle === 'rainbow') out.colorStyle = e.colorStyle;
  if (typeof e.color === 'string' && HEX.test(e.color)) out.color = e.color.toLowerCase();
  if (typeof e.color2 === 'string' && HEX.test(e.color2)) out.color2 = e.color2.toLowerCase();
  if (Array.isArray(e.order)) {
    const order = e.order.filter((x): x is string => typeof x === 'string' && !!x);
    if (order.length) out.order = order;
  }
  return out;
}

/** A composition effect as a block keeps it (a copy). */
export function normalizeBlockEffect(raw: unknown): Effect | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== 'string' || !e.type) return null;
  const params: Record<string, unknown> = {};
  if (e.params && typeof e.params === 'object') {
    for (const [k, v] of Object.entries(e.params as Record<string, unknown>)) {
      if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') params[k] = v;
    }
  }
  const out: Effect = {
    id: typeof e.id === 'string' && e.id ? e.id : generateUUID(),
    type: e.type as EffectType,
    enabled: true,
    params: params as Effect['params'],
    opacity: clamp(num(e.opacity, 1), 0, 1),
  };
  if (typeof e.blendMode === 'string') out.blendMode = e.blendMode as Effect['blendMode'];
  return out;
}

export function normalizeStageClip(raw: unknown): TimelineStageClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const row: StageClipRow | null = c.row === 'screenfx' || c.row === 'effects' ? c.row : null;
  if (!row) return null;
  const duration = Math.max(MIN_SECONDS, num(c.duration, STAGE_CLIP_DEFAULT_SECONDS));
  const clip: TimelineStageClip = {
    id: typeof c.id === 'string' && c.id ? c.id : generateUUID(),
    row,
    startTime: Math.max(0, num(c.startTime, 0)),
    duration,
    fadeIn: clamp(num(c.fadeIn, 0), 0, duration),
    fadeOut: clamp(num(c.fadeOut, 0), 0, duration),
  };
  if (row === 'screenfx') {
    const fx = normalizeScreenFx(c.screenFx);
    if (!fx) return null;
    clip.screenFx = fx;
    const where = normalizeWhere(c.where);
    if (where) clip.where = { ...where, members: 'pieces' };
  } else {
    const effect = normalizeBlockEffect(c.effect);
    if (!effect) return null;
    clip.effect = effect;
  }
  if (typeof c.label === 'string' && c.label) clip.label = c.label;
  return clip;
}

export function normalizeStageClips(raw: unknown): TimelineStageClip[] {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeStageClip)
    .filter((c): c is TimelineStageClip => c !== null)
    .sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1));
}

export function stageClipEnd(c: Pick<TimelineStageClip, 'startTime' | 'duration'>): number {
  return c.startTime + c.duration;
}

/** Fades in and out as a 0..1 gain at show time `t` (0 outside the block). */
export function stageClipFade(c: TimelineStageClip, t: number): number {
  if (t < c.startTime - EPS || t >= stageClipEnd(c) - EPS) return 0;
  let fadeIn = c.fadeIn;
  let fadeOut = c.fadeOut;
  if (fadeIn + fadeOut > c.duration && fadeIn + fadeOut > 0) {
    const k = c.duration / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }
  let g = 1;
  if (fadeIn > 0) g = Math.min(g, (t - c.startTime) / fadeIn);
  if (fadeOut > 0) g = Math.min(g, (stageClipEnd(c) - t) / fadeOut);
  return clamp(g, 0, 1);
}

export interface StageClipWeight {
  clip: TimelineStageClip;
  /** 0..1: fades × the crossfade with overlapping blocks of the same row. */
  weight: number;
}

/**
 * The blocks of one row playing at `t`, with their weights. Where two
 * overlap, the earlier ramps out and the later ramps in over the overlap
 * (the two weights sum to 1); touching blocks cut.
 */
export function stageClipWeights(clips: readonly TimelineStageClip[], row: StageClipRow, t: number): StageClipWeight[] {
  const active = clips
    .filter((c) => c.row === row && c.duration > 0 && t >= c.startTime - EPS && t < stageClipEnd(c) - EPS)
    .sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1));
  const out: StageClipWeight[] = [];
  for (const clip of active) {
    let weight = stageClipFade(clip, t);
    for (const other of active) {
      if (other === clip) continue;
      if (other.startTime < clip.startTime || (other.startTime === clip.startTime && other.id < clip.id)) {
        const span = Math.min(stageClipEnd(other), stageClipEnd(clip)) - clip.startTime;
        if (span > EPS) weight *= clamp((t - clip.startTime) / span, 0, 1);
      } else {
        const span = Math.min(stageClipEnd(clip), stageClipEnd(other)) - other.startTime;
        if (span > EPS && t >= other.startTime) weight *= clamp(1 - (t - other.startTime) / span, 0, 1);
      }
    }
    if (weight > 0) out.push({ clip, weight });
  }
  return out;
}

/** A display name for a block. */
export function stageClipName(c: TimelineStageClip, effectLabel?: (type: string) => string): string {
  if (c.label) return c.label;
  if (c.row === 'screenfx') return getEffectDef(c.screenFx!.type)?.label ?? c.screenFx!.type;
  const type = c.effect?.type ?? '';
  return effectLabel ? effectLabel(type) : type.charAt(0).toUpperCase() + type.slice(1);
}

/** Drag payloads from the Composition panel's cards. */
export const SCREEN_FX_DRAG_MIME = 'application/x-ghost-screen-fx';
export const COMPOSITION_EFFECT_DRAG_MIME = 'application/x-ghost-composition-effect';

export function writeStageDrag(dt: DataTransfer | null, row: StageClipRow, payload: StageEffect | Effect): void {
  if (!dt) return;
  const json = JSON.stringify(payload);
  dt.setData(row === 'screenfx' ? SCREEN_FX_DRAG_MIME : COMPOSITION_EFFECT_DRAG_MIME, json);
  dt.setData('text/plain', row === 'screenfx' ? `Screen FX: ${(payload as StageEffect).type}` : `Effect: ${payload.type}`);
  dt.effectAllowed = 'copy';
}

export function carriesStageDrag(dt: DataTransfer | null, row: StageClipRow): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes(row === 'screenfx' ? SCREEN_FX_DRAG_MIME : COMPOSITION_EFFECT_DRAG_MIME);
}

export function readStageDrag(dt: DataTransfer | null, row: StageClipRow): StageEffect | Effect | null {
  if (!dt) return null;
  try {
    const raw = JSON.parse(dt.getData(row === 'screenfx' ? SCREEN_FX_DRAG_MIME : COMPOSITION_EFFECT_DRAG_MIME) || 'null');
    return row === 'screenfx' ? normalizeScreenFx(raw) : normalizeBlockEffect(raw);
  } catch {
    return null;
  }
}
