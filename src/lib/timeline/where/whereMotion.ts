/**
 * Where motions: the where line's position (and spread) as a pure function
 * of show time, picked instead of drawn.
 *
 *   sweep     one pass along the order every `bars` bars (from the block's start)
 *   pingpong  there and back, a pass every `bars` bars
 *   burst     the window grows from the middle of the order to all of it,
 *             every `bars` bars
 *   random    a random piece every beat or bar, from a seed: the same show
 *             always picks the same pieces, never the same one twice running
 *   kick      one step along the order on every kick of the song (counted
 *             from the block's start); every beat when there is no song
 *   reveal    pieces light one after another along the order over `bars`
 *             bars, then all stay lit (reverse: they go dark one after
 *             another, the last one stays)
 *   steps     a step grid (like the Sequencer): which slots each step lights,
 *             a step every `per` quarter notes, looping from the block's
 *             start (stepWeights; the window is not used)
 *   drawn     the block's lines (`where:position` / `where:spread` / `where:soft`),
 *             else the resting values
 *
 * Bars are four quarter notes of the Timeline's tempo map (120 BPM without one).
 */
import type { WhereMotion, WhereSpec } from './whereModel';
import type { WhereWindow } from './whereWindow';

export interface WhereMotionContext {
  /** Quarter notes at show time `t` (the tempo map). */
  beatAt: (t: number) => number;
  /** Sorted kick onsets, show seconds (null: no song analysed). */
  kicks?: Float64Array | readonly number[] | null;
}

/** Values a block's lines give its where line now (undefined: no line). */
export interface WhereLineValues {
  position?: number;
  spread?: number;
  soft?: number;
}

const QUARTERS_PER_BAR = 4;

export function defaultBeatAt(t: number): number {
  return t * 2;
}

function frac(v: number): number {
  return v - Math.floor(v);
}

/** 0..1, deterministic per (seed, k). */
export function hash01(seed: number, k: number): number {
  let h = (Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** The random motion's slot for cycle `k` (k ≥ 0): a seeded walk that never
 *  stays put. Sequential calls are O(1); a jump replays from the nearest
 *  remembered cycle. */
const walkMemo = new Map<string, { k: number; slot: number }>();
export function randomSlot(seed: number, k: number, n: number): number {
  if (n <= 1) return 0;
  const kk = Math.max(0, Math.floor(k));
  const key = `${seed}|${n}`;
  let memo = walkMemo.get(key);
  if (!memo || memo.k > kk) memo = { k: 0, slot: Math.floor(hash01(seed, 0) * n) % n };
  let { k: at, slot } = memo;
  while (at < kk) {
    at++;
    slot = (slot + 1 + Math.floor(hash01(seed, at) * (n - 1))) % n;
  }
  if (walkMemo.size > 64) walkMemo.clear();
  walkMemo.set(key, { k: at, slot });
  return slot;
}

/** Kicks in [from, to] (inclusive), by binary search. */
export function countKicks(kicks: Float64Array | readonly number[], from: number, to: number): number {
  const lower = (x: number) => {
    let lo = 0;
    let hi = kicks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (kicks[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upper = (x: number) => {
    let lo = 0;
    let hi = kicks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (kicks[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return to < from ? 0 : upper(to) - lower(from - 1e-6);
}

/** Kick onsets from a 0..1 hit envelope (`frameRate` frames a second),
 *  shifted by `offset` seconds: a rise through 0.5 after falling under 0.25. */
export function kickOnsets(envelope: Float32Array, frameRate: number, offset = 0): number[] {
  const out: number[] = [];
  let armed = true;
  for (let i = 0; i < envelope.length; i++) {
    const v = envelope[i];
    if (armed && v >= 0.5) {
      out.push(offset + i / frameRate);
      armed = false;
    } else if (!armed && v < 0.25) {
      armed = true;
    }
  }
  return out;
}

/** The step a steps motion is on at `t` (looping from the block's start). */
export function stepIndexAt(motion: Extract<WhereMotion, { kind: 'steps' }>, t: number, start: number, ctx: WhereMotionContext): number {
  const count = Math.max(1, motion.steps.length);
  const k = Math.floor(Math.max(0, ctx.beatAt(t) - ctx.beatAt(start)) / motion.per + 1e-9);
  return k % count;
}

/** How lit each of `n` slots is at `t`, for a steps motion (else null:
 *  the window decides). A step lights its slots fully; the rest are dark. */
export function stepWeights(motion: WhereMotion, t: number, start: number, n: number, ctx: WhereMotionContext): number[] | null {
  if (motion.kind !== 'steps') return null;
  const out = new Array<number>(n).fill(0);
  for (const i of motion.steps[stepIndexAt(motion, t, start, ctx)] ?? []) if (i < n) out[i] = 1;
  return out;
}

/** Position 0..1 for a slot of n (no wrap). */
function slotPosition(slot: number, n: number): number {
  return n <= 1 ? 0 : slot / (n - 1);
}

/**
 * The where window at show time `t` for a block starting at `start`, over
 * `n` slots. Lines (drawn, following, recorded) win on the values they set.
 */
export function whereWindowAt(
  spec: Pick<WhereSpec, 'motion' | 'position' | 'spread' | 'soft' | 'wrap'>,
  t: number,
  start: number,
  n: number,
  ctx: WhereMotionContext,
  lines: WhereLineValues = {},
): WhereWindow {
  const motion: WhereMotion = spec.motion ?? { kind: 'drawn' };
  let position = spec.position ?? 0;
  let spread = spec.spread ?? 0;
  let wrap = spec.wrap === true;
  const beats = () => ctx.beatAt(t) - ctx.beatAt(start);
  switch (motion.kind) {
    case 'sweep': {
      const phase = frac(Math.max(0, beats()) / (motion.bars * QUARTERS_PER_BAR));
      position = motion.reverse ? 1 - phase : phase;
      break;
    }
    case 'pingpong': {
      const phase = (Math.max(0, beats()) / (motion.bars * QUARTERS_PER_BAR)) % 2;
      position = phase <= 1 ? phase : 2 - phase;
      wrap = false;
      break;
    }
    case 'burst': {
      position = 0.5;
      spread = frac(Math.max(0, beats()) / (motion.bars * QUARTERS_PER_BAR));
      wrap = false;
      break;
    }
    case 'random': {
      const k = Math.floor(Math.max(0, beats()) / (motion.every === 'bar' ? QUARTERS_PER_BAR : 1) + 1e-9);
      position = slotPosition(randomSlot(motion.seed, k, n), n);
      wrap = false;
      break;
    }
    case 'kick': {
      const steps = ctx.kicks && ctx.kicks.length
        ? Math.max(0, countKicks(ctx.kicks, start, t) - 1)
        : Math.floor(Math.max(0, beats()) + 1e-9);
      position = slotPosition(n > 0 ? steps % n : 0, n);
      wrap = false;
      break;
    }
    case 'reveal': {
      // m slots lit from the start of the order (from its end, reversed):
      // a window over slots [0, m) is centred on (m − 1) / 2, m slots wide.
      const p = Math.max(0, Math.min(1, Math.max(0, beats()) / (motion.bars * QUARTERS_PER_BAR)));
      const lit = n <= 1 ? 1 : Math.max(1, Math.min(n, motion.reverse ? n - p * (n - 1) : 1 + p * (n - 1)));
      const span = Math.max(1, n - 1);
      spread = (lit - 1) / span;
      position = motion.reverse ? 1 - (lit - 1) / (2 * span) : (lit - 1) / (2 * span);
      wrap = false;
      break;
    }
    case 'drawn':
    default:
      break;
  }
  if (motion.kind === 'drawn' && lines.position !== undefined) position = lines.position;
  if (lines.spread !== undefined) spread = lines.spread;
  const soft = lines.soft ?? spec.soft ?? 0;
  return { position, spread, soft, wrap };
}
