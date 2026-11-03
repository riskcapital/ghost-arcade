/**
 * Auto-mix: the studio's visuals take turns on the bar.
 *
 *  - all:     every visual shows (as before).
 *  - order:   one at a time, down the list.
 *  - random:  one at a time, a different one each change.
 *  - shuffle: a changing number at once (1, 2, 3...), with the blend modes
 *             changing too.
 *
 * Changes land on bar lines every `bars` bars and crossfade over one beat.
 * Everything is worked out from the bar clock alone, so it is the same on
 * every screen and the same again when the music comes back round. Muted
 * visuals (level 0) sit out. A visual's own Auto (shows while its sound
 * plays) still applies on top.
 */

import type { BlendMode } from '../types';

export type MixMode = 'all' | 'order' | 'random' | 'shuffle';
export const MIX_MODES: readonly { id: MixMode; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Every visual shows' },
  { id: 'order', label: 'One by one', title: 'One visual at a time, down the list, changing on the bar' },
  { id: 'random', label: 'One at random', title: 'One visual at a time, a different one each change' },
  { id: 'shuffle', label: 'Shuffle', title: 'A changing number of visuals at once, blending in changing ways' },
];
export const MIX_BARS = [1, 2, 4, 8] as const;

export interface StudioMix {
  mode: MixMode;
  /** Bars between changes. */
  bars: number;
}

export const DEFAULT_MIX: StudioMix = { mode: 'all', bars: 4 };

export function normalizeMix(raw: unknown): StudioMix {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StudioMix>;
  return {
    mode: MIX_MODES.some((m) => m.id === r.mode) ? (r.mode as MixMode) : 'all',
    bars: MIX_BARS.includes(Number(r.bars) as (typeof MIX_BARS)[number]) ? Number(r.bars) : DEFAULT_MIX.bars,
  };
}

/** Blends that suit light on black: none of them darkens the stack away. */
export const SHUFFLE_BLENDS: readonly BlendMode[] = ['screen', 'add', 'lighten', 'difference', 'exclusion', 'overlay', 'color-dodge', 'hardlight'];

/** The voices' bar clock (vxBars) wraps here. */
const BAR_WRAP = 64;

/** A crossfade lasts one beat (a quarter of a 4/4 bar). */
const FADE_BARS = 0.25;

function hash(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

interface Pick {
  shown: Set<number>;
  blends: Map<number, BlendMode>;
}

/** Which visuals a change shows, and (shuffle) how they blend. `live` are the visuals not muted. */
function pickAt(mode: MixMode, change: number, live: readonly number[]): Pick {
  const shown = new Set<number>();
  const blends = new Map<number, BlendMode>();
  const n = live.length;
  if (!n) return { shown, blends };
  if (mode === 'order') {
    shown.add(live[((change % n) + n) % n]);
  } else if (mode === 'random') {
    // A different one each change: step on from the last pick by 1..n-1.
    let at = Math.floor(hash(0, 1) * n);
    const from = Math.max(0, change - 64);
    for (let c = from; c < change; c++) at = n > 1 ? (at + 1 + Math.floor(hash(c, 2) * (n - 1))) % n : 0;
    shown.add(live[at]);
  } else {
    const most = Math.min(3, n);
    // How many show: up and down through 1..most, never the same count twice
    // running (a chain from a fixed start, so every screen agrees).
    let count = 1;
    for (let c = Math.max(0, change - 64); c <= change; c++) {
      const next = 1 + Math.floor(hash(c, 3) * most);
      count = most > 1 && next === count ? (next % most) + 1 : next;
    }
    const order = [...live].sort((a, b) => hash(change, 10 + a) - hash(change, 10 + b));
    for (const i of order.slice(0, count)) {
      shown.add(i);
      blends.set(i, SHUFFLE_BLENDS[Math.floor(hash(change, 100 + i) * SHUFFLE_BLENDS.length)]);
    }
  }
  return { shown, blends };
}

export interface MixedVoice {
  /** Opacity multiplier, 0-1, crossfading across a change. */
  gain: number;
  /** Blend to use instead of the visual's own (shuffle only). */
  blend?: BlendMode;
}

/**
 * Each visual's share of the mix at `barPos` (bars since the clock's start,
 * fractional). `muted[i]` says a visual is muted and sits out.
 */
export function mixAt(mix: StudioMix, barPos: number, muted: readonly boolean[]): MixedVoice[] {
  const count = muted.length;
  if (mix.mode === 'all' || !count) return muted.map(() => ({ gain: 1 }));
  const live = muted.flatMap((m, i) => (m ? [] : [i]));
  if (!live.length) return muted.map(() => ({ gain: 1 }));
  const bars = Math.max(1, mix.bars);
  const pos = Number.isFinite(barPos) ? barPos : 0;
  const change = Math.floor(pos / bars);
  const into = pos - change * bars;
  const t = Math.min(1, into / FADE_BARS);
  const fade = t * t * (3 - 2 * t);
  const now = pickAt(mix.mode, change, live);
  // The bar clock wraps at 64 bars: change 0 follows the last change of the cycle.
  const previous = change > 0 ? change - 1 : Math.max(0, Math.ceil(BAR_WRAP / bars) - 1);
  const before = fade < 1 ? pickAt(mix.mode, previous, live) : null;
  return muted.map((_, i) => {
    const on = now.shown.has(i) ? 1 : 0;
    const was = before ? (before.shown.has(i) ? 1 : 0) : on;
    const gain = was + (on - was) * fade;
    // The blend follows whichever pick the visual belongs to now (it fades in or out under it).
    const blend = now.blends.get(i) ?? before?.blends.get(i);
    return blend ? { gain, blend } : { gain };
  });
}
