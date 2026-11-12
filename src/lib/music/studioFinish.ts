/**
 * The studio's finish: one post stage over its combined picture, so the
 * voices read as one lit, graded image instead of separate marks. Glow
 * (bloom), trails (each frame keeps a fading copy of the last), a grade (a
 * short list of looks) and grain with a soft vignette. On by default at
 * modest values; every control can go to zero.
 *
 * Glow, grade and grain are ordinary layer effects run as a pass chain after
 * the studio's mix. Trails live in the mix itself: last frame's mix is laid
 * under the voices, faded, before the effects, so glow never piles up.
 */
import type { Effect } from '../types';

export const STUDIO_GRADES = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'tungsten', label: 'Warm tungsten' },
  { id: 'steel', label: 'Cold steel' },
  { id: 'night', label: 'Night blue' },
  { id: 'sodium', label: 'Sodium' },
  { id: 'mono', label: 'Mono' },
] as const;
export type StudioGrade = (typeof STUDIO_GRADES)[number]['id'];

export interface StudioFinish {
  /** 0-1: bloom around bright things. */
  glow: number;
  /** 0-1: how long hits leave a tail. */
  trails: number;
  grade: StudioGrade;
  /** 0-1: film grain and a soft vignette. */
  grain: number;
}

export const DEFAULT_FINISH: StudioFinish = { glow: 0.5, trails: 0.35, grade: 'neutral', grain: 0.3 };

const unit = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

export function normalizeFinish(raw: unknown): StudioFinish {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StudioFinish>;
  return {
    glow: unit(r.glow, DEFAULT_FINISH.glow),
    trails: unit(r.trails, DEFAULT_FINISH.trails),
    grade: STUDIO_GRADES.some((g) => g.id === r.grade) ? (r.grade as StudioGrade) : DEFAULT_FINISH.grade,
    grain: unit(r.grain, DEFAULT_FINISH.grain),
  };
}

/** How much of last frame stays under this one: none at 0, a long tail at 1. */
export function trailsOpacity(finish: StudioFinish): number {
  return finish.trails <= 0 ? 0 : 0.35 + 0.5 * finish.trails;
}

/** Each grade as a temperature and tint shift and a saturation. */
const GRADES: Record<StudioGrade, { temperature: number; tint: number; saturation: number } | null> = {
  neutral: null,
  tungsten: { temperature: 0.45, tint: 0.05, saturation: 1.1 },
  steel: { temperature: -0.4, tint: -0.03, saturation: 0.8 },
  night: { temperature: -0.65, tint: 0.12, saturation: 0.9 },
  sodium: { temperature: 0.85, tint: 0.2, saturation: 0.75 },
  mono: { temperature: 0, tint: 0, saturation: 0 },
};

const effect = (id: string, type: string, params: Record<string, number>): Effect =>
  ({ id: `studio-finish:${id}`, type, enabled: true, params } as unknown as Effect);

/** The finish's effects, in order: glow, grade, grain. */
export function finishEffects(finish: StudioFinish): Effect[] {
  const out: Effect[] = [];
  const g = finish.glow;
  if (g > 0) {
    out.push(effect('glow', 'bloom', {
      amount: 0.3 + 0.6 * g,
      intensity: 0.8 + 0.9 * g,
      // Dim voices glow too: the threshold falls as the glow rises.
      threshold: 0.55 - 0.35 * g,
      knee: 0.5,
      radius: 0.55 + 0.35 * g,
    }));
  }
  const grade = GRADES[finish.grade];
  if (grade) {
    if (grade.temperature || grade.tint) out.push(effect('grade-temperature', 'temperatureTint', { temperature: grade.temperature, tint: grade.tint }));
    if (grade.saturation !== 1) out.push(effect('grade-saturation', 'saturation', { saturation: grade.saturation }));
  }
  if (finish.grain > 0) {
    out.push(effect('grain', 'filmGrain', { grainAmount: 0.35 * finish.grain, grainSize: 1, grainMono: 1 }));
    out.push(effect('vignette', 'vignette', { vignetteSize: 0.95 - 0.2 * finish.grain, vignetteSoftness: 0.6 }));
  }
  return out;
}

const cache = new Map<string, { key: string; effects: Effect[] }>();

/** The same effect objects while an instance's finish is unchanged, so the renderer keeps its passes. */
export function finishEffectsFor(instanceId: string, finish: StudioFinish): Effect[] {
  const key = `${finish.glow}|${finish.grade}|${finish.grain}`;
  const hit = cache.get(instanceId);
  if (hit && hit.key === key) return hit.effects;
  const effects = finishEffects(finish);
  cache.set(instanceId, { key, effects });
  return effects;
}
