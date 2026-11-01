/**
 * Control cables, signal side: each source is read once per frame (shared by
 * every cable from it), then each cable shapes it on its own way in, by its
 * settings: an amount (-100% to +100%, negative turns it upside down),
 * attack and release smoothing, and envelope or trigger mode (a pulse on each
 * hit that falls away over the release). Several cables into one input add
 * up, clipped to 0-1. Pure, so it is tested without the engine.
 */

export type CableMode = 'env' | 'trig';

export interface CableShape {
  /** -1 to 1; 1 when missing. */
  amount?: number;
  /** Seconds to rise. */
  attack?: number;
  /** Seconds to fall. */
  release?: number;
  mode?: CableMode;
}

export const CABLE_DEFAULTS: Required<CableShape> = { amount: 1, attack: 0.005, release: 0.12, mode: 'env' };

/** How far a source must jump in one frame to count as a hit. */
const HIT_RISE = 0.12;

export interface CableFollow {
  value: number;
  /** The source's value last frame, for spotting hits. */
  last: number;
}

export const newFollow = (): CableFollow => ({ value: 0, last: 0 });

/** One frame of a cable: the source's raw value `raw` after `dt` seconds. */
export function stepCable(f: CableFollow, raw: number, dt: number, shape: CableShape): CableFollow {
  const s = { ...CABLE_DEFAULTS, ...shape };
  const x = Math.max(0, Math.min(1, raw));
  let target = x;
  if (s.mode === 'trig') {
    // A hit sets the pulse full; between hits it only falls.
    target = x - f.last > HIT_RISE ? 1 : 0;
  }
  const rising = target > f.value;
  const time = rising ? s.attack : s.release;
  const k = time <= 0 ? 1 : 1 - Math.exp(-dt / time);
  const value = s.mode === 'trig' && rising ? 1 : f.value + (target - f.value) * k;
  return { value, last: x };
}

/** What one cable adds to its input: scaled, or upside down for a negative amount. */
export function contribution(value: number, shape: CableShape): number {
  const a = Math.max(-1, Math.min(1, shape.amount ?? 1));
  return a >= 0 ? a * value : -a * (1 - value);
}

/** Everything plugged into one input, added and clipped to its range. */
export function sumInput(parts: number[]): number {
  return Math.max(0, Math.min(1, parts.reduce((a, b) => a + b, 0)));
}

export function normalizeCableShape(raw: Partial<Record<keyof CableShape, unknown>>): CableShape {
  const out: CableShape = {};
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
  const amount = num(raw.amount, -1, 1);
  const attack = num(raw.attack, 0, 2);
  const release = num(raw.release, 0, 4);
  if (amount !== undefined && amount !== 1) out.amount = amount;
  if (attack !== undefined) out.attack = attack;
  if (release !== undefined) out.release = release;
  if (raw.mode === 'trig') out.mode = 'trig';
  return out;
}
