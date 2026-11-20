/**
 * Drift: a visual's settings slowly wander on their own, so one visual keeps
 * changing while it plays, under whatever the sound does to it.
 *
 * Each setting follows its own smooth noise (seeded per visual and per
 * setting, so two visuals never move together): no steps, no jumps, a cycle
 * of a couple of minutes at the default speed. It wanders around the value
 * you set, never further than `amount` of the setting's range either side
 * and never past the range, so the look stays recognisable. The saved value
 * is never touched: drift is worked out every frame in the frame sync
 * (studioPlugin.ts expands the studio's visuals there), so nothing is
 * written to a store while it moves.
 *
 * Layering: drift moves the base the visual starts from. What the sound
 * drives (the `vx` inputs) is put on after it, so audio still lands on top.
 * A setting held out of drift (`hold`), or one something else drives this
 * frame (`yieldTo`), stays at its own value. Turning Drift off (or holding a
 * setting) eases back to the saved value over a moment; turning it on eases
 * in.
 *
 * Time: `driftSeconds()` is the render's show time while Render to video
 * runs, so a render shows the same drift every time.
 */
import { parseISF } from '../isf/parser';
import { renderClockActive, renderClockSeconds } from '../recording/renderClock';
import { isVoiceDrivenInput } from './visualVoices';

export interface VisualDrift {
  on: boolean;
  /** How far it wanders, 0-1: the share of each setting's range either side of your value. */
  amount: number;
  /** How fast, 0-1: 0 is a cycle of about four minutes, 1 about fifteen seconds. */
  speed: number;
  /** Its own noise, so two visuals drift differently. Saved, so a project drifts the same way again. */
  seed: number;
  /** Settings kept out of drift, by input name. */
  hold?: string[];
}

export const DRIFT_DEFAULTS = { amount: 0.35, speed: 0.2 } as const;
/** Most settings one visual can hold out of drift (a damaged file cannot make thousands). */
const MAX_HOLD = 64;
/** Easing in and out, seconds. */
export const DRIFT_EASE_SECONDS = 2.5;

const clamp01 = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

/** A saved drift, checked; undefined when there is none (old projects). */
export function normalizeDrift(raw: unknown): VisualDrift | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const seed = Number(r.seed);
  const hold = Array.isArray(r.hold) ? [...new Set(r.hold.filter((h): h is string => typeof h === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(h)))].slice(0, MAX_HOLD) : [];
  return {
    on: r.on === true,
    amount: clamp01(r.amount, DRIFT_DEFAULTS.amount),
    speed: clamp01(r.speed, DRIFT_DEFAULTS.speed),
    seed: Number.isFinite(seed) ? Math.abs(Math.floor(seed)) % 2147483647 : 1,
    ...(hold.length ? { hold } : {}),
  };
}

/** Drift turned on for the first time: the defaults and a fresh seed. */
export function newDrift(seed = Math.floor(Math.random() * 2147483646) + 1): VisualDrift {
  return { on: true, amount: DRIFT_DEFAULTS.amount, speed: DRIFT_DEFAULTS.speed, seed };
}

/** Drift turned on or off; the rest is kept for next time. */
export function toggledDrift(drift: VisualDrift | undefined): VisualDrift {
  return drift ? { ...drift, on: !drift.on } : newDrift();
}

/** A setting held out of drift, or let back in. */
export function toggledHold(drift: VisualDrift, name: string): VisualDrift {
  const hold = new Set(drift.hold ?? []);
  if (hold.has(name)) hold.delete(name);
  else hold.add(name);
  const { hold: _, ...rest } = drift;
  return hold.size ? { ...rest, hold: [...hold].slice(0, MAX_HOLD) } : rest;
}

/** Seconds per cycle for a speed: about four minutes down to fifteen seconds. */
export function driftCycleSeconds(speed: number): number {
  return 240 * Math.pow(1 / 16, clamp01(speed, DRIFT_DEFAULTS.speed));
}

// ── Noise ───────────────────────────────────────────────────────────────

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** -1..1 for a lattice point. */
function lattice(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x27d4eb2d, 0x9e3779b1) ^ Math.imul(i | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth 1D value noise: quintic between lattice points, so its slope is continuous too. */
function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = lattice(seed, i);
  return a + (lattice(seed, i + 1) - a) * u;
}

/**
 * One setting's wander at `t` seconds, -1..1: a slow line with a little
 * slower-than-a-beat movement on it. Coherent (no jumps), the same for the
 * same seed, name and time.
 */
export function driftNoise(seed: number, name: string, t: number, cycleSeconds: number): number {
  const s = (seed ^ hashString(name)) >>> 0;
  const x = t / Math.max(1, cycleSeconds / 2);
  const n = 0.72 * valueNoise(s, x) + 0.28 * valueNoise(s ^ 0x5bd1e995, x * 2.3 + 17.1);
  return Math.max(-1, Math.min(1, n));
}

// ── Which settings drift ────────────────────────────────────────────────

export interface DriftRange {
  name: string;
  min: number;
  max: number;
  /** The shader's own default, for a setting the visual has never been given. */
  value: number;
}

/** Names the studio sets itself (what a voice follows, its colours): never drifted. */
const STUDIO_SET = new Set(['vxSource', 'vxAuto', 'vxClear', 'ink', 'accent']);

/**
 * The settings of a shader that can drift: decimal settings with a range of
 * up to 4 (wider ones are counts, shown as whole numbers, and would step),
 * not what the sound drives. Cached by code.
 */
const rangeCache = new Map<string, DriftRange[]>();
export function driftRanges(code: string | undefined, inputs?: readonly { NAME?: string; TYPE?: string; MIN?: unknown; MAX?: unknown; DEFAULT?: unknown }[]): DriftRange[] {
  if (!code && !inputs) return [];
  const key = code ?? '';
  if (code) {
    const cached = rangeCache.get(key);
    if (cached) return cached;
  }
  let list = inputs;
  if (!list && code) {
    try {
      list = (parseISF(code).metadata.INPUTS ?? []) as typeof inputs;
    } catch {
      list = [];
    }
  }
  const out: DriftRange[] = [];
  for (const input of list ?? []) {
    if (input.TYPE !== 'float' || typeof input.NAME !== 'string') continue;
    if (STUDIO_SET.has(input.NAME) || isVoiceDrivenInput(input.NAME)) continue;
    const min = Number(input.MIN ?? 0);
    const max = Number(input.MAX ?? 1);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || max - min > 4) continue;
    const value = Number(input.DEFAULT ?? min);
    out.push({ name: input.NAME, min, max, value: Number.isFinite(value) ? value : min });
  }
  if (code) {
    if (rangeCache.size > 300) rangeCache.clear();
    rangeCache.set(key, out);
  }
  return out;
}

// ── Easing in and out ───────────────────────────────────────────────────

interface Ease {
  target: 0 | 1;
  from: number;
  since: number;
  seen: number;
  last: number;
}

/** By visual, then by setting. Entries go when eased out; both maps are capped. */
const eases = new Map<string, Map<string, Ease>>();
const MAX_VISUALS = 512;

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

function easeWeight(e: Ease, t: number): number {
  return e.from + (e.target - e.from) * smooth((t - e.since) / DRIFT_EASE_SECONDS);
}

function step(visual: Map<string, Ease>, name: string, on: boolean, t: number): number {
  let e = visual.get(name);
  if (!e) {
    if (!on) return 0;
    e = { target: 1, from: 0, since: t, seen: t, last: 0 };
    visual.set(name, e);
  }
  // The clock went back (a render starting on show time, a reload): carry on from where it was.
  if (t < e.seen - 1e-3) {
    e.from = e.last;
    e.since = t - (e.last === e.target ? DRIFT_EASE_SECONDS : 0);
  }
  const target = on ? 1 : 0;
  if (target !== e.target) {
    e.from = easeWeight(e, t);
    e.target = target;
    e.since = t;
  }
  e.seen = t;
  e.last = easeWeight(e, t);
  if (e.target === 0 && e.last <= 0) {
    visual.delete(name);
    return 0;
  }
  return e.last;
}

/**
 * A visual's settings with drift on them, at `t` seconds (driftSeconds()).
 * `key` names the visual for its easing (stable while it plays). Returns
 * `params` itself when nothing drifts, otherwise a new record: settings
 * outside `ranges` pass through as they are.
 */
export function applyDrift(
  key: string,
  params: Readonly<Record<string, number>>,
  ranges: readonly DriftRange[],
  drift: VisualDrift | undefined,
  t: number,
  yieldTo?: (name: string) => boolean,
): Record<string, number> {
  const on = !!drift?.on && drift.amount > 0;
  let visual = eases.get(key);
  if (!visual) {
    if (!on || !ranges.length) return params as Record<string, number>;
    if (eases.size >= MAX_VISUALS) evictOldest();
    visual = new Map();
    eases.set(key, visual);
  }
  const d = drift ?? { on: false, amount: 0, speed: DRIFT_DEFAULTS.speed, seed: 1 };
  const held = d.hold?.length ? new Set(d.hold) : null;
  const cycle = driftCycleSeconds(d.speed);
  let out: Record<string, number> | null = null;
  for (const r of ranges) {
    const free = on && !held?.has(r.name) && !yieldTo?.(r.name);
    const w = step(visual, r.name, free, t);
    if (w <= 0) continue;
    const base = Number.isFinite(params[r.name]) ? params[r.name] : r.value;
    const reach = d.amount * (r.max - r.min) * 0.5;
    const lo = Math.max(Math.min(r.min, base), base - reach);
    const hi = Math.min(Math.max(r.max, base), base + reach);
    const n = driftNoise(d.seed, r.name, t, cycle);
    const offset = n >= 0 ? n * (hi - base) : n * (base - lo);
    (out ??= { ...params })[r.name] = base + offset * w;
  }
  if (!visual.size) eases.delete(key);
  return out ?? (params as Record<string, number>);
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldest = Infinity;
  for (const [k, v] of eases) {
    let seen = -Infinity;
    for (const e of v.values()) seen = Math.max(seen, e.seen);
    if (seen < oldest) {
      oldest = seen;
      oldestKey = k;
    }
  }
  if (oldestKey !== null) eases.delete(oldestKey);
}

/** True while a visual is still easing in or out (its drift was on a moment ago). */
export function driftEasing(key: string): boolean {
  return eases.has(key);
}

/** Visuals with drift easing state (tests: memory stays bounded). */
export function driftStateSize(): number {
  return eases.size;
}

/** Tests start clean. */
export function resetDriftForTest(): void {
  eases.clear();
}

/** The drift clock, seconds: the render's show time during Render to video, the wall clock live. */
export function driftSeconds(): number {
  return renderClockActive() ? renderClockSeconds() : (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}
