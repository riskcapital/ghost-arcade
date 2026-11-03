/**
 * Auto-mix: the studio's visuals take turns on the bar.
 *
 *  - all:     every visual shows (as before).
 *  - order:   one at a time, down the list.
 *  - random:  one at a time, a different one each change.
 *  - shuffle: a changing number at once (1, 2, 3...), with the blend modes
 *             changing too.
 *
 * Changes land on the grid every `bars` bars (down to an eighth of a bar)
 * and crossfade over up to a beat. Everything is worked out from the bar
 * clock alone, so it is the same on every screen and the same again when the
 * music comes back round. With `follow` on, the music sets the pace instead:
 * busier, louder playing changes faster and shows more at once in shuffle;
 * sparse or quiet playing changes slower (see MixFollower). Muted
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
/** How often the mix changes, in bars: an eighth of a bar up to eight bars. */
export const MIX_BARS = [0.125, 0.25, 0.5, 1, 2, 4, 8] as const;
export const MIX_BAR_OPTIONS: readonly { bars: (typeof MIX_BARS)[number]; label: string }[] = [
  { bars: 0.125, label: 'Every 1/8 bar' },
  { bars: 0.25, label: 'Every beat' },
  { bars: 0.5, label: 'Every 1/2 bar' },
  { bars: 1, label: 'Every bar' },
  { bars: 2, label: 'Every 2 bars' },
  { bars: 4, label: 'Every 4 bars' },
  { bars: 8, label: 'Every 8 bars' },
];

export interface StudioMix {
  mode: MixMode;
  /** Bars between changes. */
  bars: number;
  /** Let the music set the pace around `bars`: busy and loud is faster, sparse and quiet slower. */
  follow: boolean;
}

export const DEFAULT_MIX: StudioMix = { mode: 'all', bars: 4, follow: false };

export function normalizeMix(raw: unknown): StudioMix {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StudioMix>;
  return {
    mode: MIX_MODES.some((m) => m.id === r.mode) ? (r.mode as MixMode) : 'all',
    bars: MIX_BARS.includes(Number(r.bars) as (typeof MIX_BARS)[number]) ? Number(r.bars) : DEFAULT_MIX.bars,
    follow: r.follow === true,
  };
}

/** Blends that suit light on black: none of them darkens the stack away. */
export const SHUFFLE_BLENDS: readonly BlendMode[] = ['screen', 'add', 'lighten', 'difference', 'exclusion', 'overlay', 'color-dodge', 'hardlight'];

/** The voices' bar clock (vxBars) wraps here. */
const BAR_WRAP = 64;

/** A crossfade lasts up to one beat (a quarter of a 4/4 bar), and never more than half the time between changes. */
const fadeBars = (bars: number) => Math.min(0.25, bars / 2);

function hash(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

interface MixPick {
  shown: Set<number>;
  blends: Map<number, BlendMode>;
}

/** Which visuals a change shows, and (shuffle) how they blend. `live` are the visuals not muted. */
function pickAt(mode: MixMode, change: number, live: readonly number[], most = 3): MixPick {
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
    most = Math.max(1, Math.min(most, n));
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
export function mixAt(mix: Pick<StudioMix, 'mode' | 'bars'>, barPos: number, muted: readonly boolean[]): MixedVoice[] {
  const count = muted.length;
  if (mix.mode === 'all' || !count) return muted.map(() => ({ gain: 1 }));
  const live = muted.flatMap((m, i) => (m ? [] : [i]));
  if (!live.length) return muted.map(() => ({ gain: 1 }));
  const bars = Math.max(MIX_BARS[0], mix.bars);
  const pos = Number.isFinite(barPos) ? barPos : 0;
  // A small epsilon so a position landing on a grid line counts as past it.
  const change = Math.floor(pos / bars + 1e-9);
  const into = pos - change * bars;
  const fade = smooth(into / fadeBars(bars));
  const now = pickAt(mix.mode, change, live);
  // The bar clock wraps at 64 bars: change 0 follows the last change of the cycle.
  const previous = change > 0 ? change - 1 : Math.max(0, Math.ceil(BAR_WRAP / bars) - 1);
  const before = fade < 1 ? pickAt(mix.mode, previous, live) : null;
  return blendPicks(muted, now, before, fade);
}

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function blendPicks(muted: readonly boolean[], now: MixPick, before: MixPick | null, fade: number): MixedVoice[] {
  return muted.map((_, i) => {
    const on = now.shown.has(i) ? 1 : 0;
    const was = before ? (before.shown.has(i) ? 1 : 0) : on;
    const gain = was + (on - was) * fade;
    // The blend follows whichever pick the visual belongs to now (it fades in or out under it).
    const blend = now.blends.get(i) ?? before?.blends.get(i);
    return blend ? { gain, blend } : { gain };
  });
}

/**
 * How busy and loud the music is now, 0-1 each: `pace` from how many notes
 * and hits land per beat (a 120 BPM loop in half time reads slow, one in
 * sixteenths reads fast), `level` from how loud it plays.
 */
export interface MixFeel {
  pace: number;
  level: number;
}

/** 0 (sparse, quiet) to 1 (busy, loud). Pace counts for more: it is what makes a loop feel fast or slow. */
export function feelIntensity(feel: MixFeel | null | undefined): number {
  if (!feel) return 0.5;
  const pace = Math.max(0, Math.min(1, Number(feel.pace) || 0));
  const level = Math.max(0, Math.min(1, Number(feel.level) || 0));
  return 0.65 * pace + 0.35 * level;
}

/**
 * The time to the next change when following the music: up to two steps
 * faster or slower than the chosen rate, on the same grid of MIX_BARS.
 */
export function followBars(bars: number, intensity: number): number {
  const at = MIX_BARS.indexOf(bars as (typeof MIX_BARS)[number]);
  const base = at < 0 ? MIX_BARS.indexOf(4) : at;
  const shift = Math.round((Math.max(0, Math.min(1, intensity)) - 0.5) * 4.4);
  return MIX_BARS[Math.max(0, Math.min(MIX_BARS.length - 1, base - shift))];
}

/**
 * Auto-mix that follows the music. Each change picks when the next one
 * lands (on that length's grid) from how the music feels at that moment, so
 * a build speeds the changes up and a breakdown slows them down; in shuffle
 * a big moment shows up to four at once. It keeps a little state (the
 * current change and when the next is due), one follower per studio instance.
 */
export class MixFollower {
  private change = 0;
  private startAt = 0;
  private nextAt = -Infinity;
  private fadeLen = 0.25;
  private most = 3;
  private beforeMost = 3;
  private lastRaw: number | null = null;
  private wraps = 0;
  private liveKey = '';
  private now: MixPick | null = null;
  private before: MixPick | null = null;
  private last: MixedVoice[] = [];

  step(mix: Pick<StudioMix, 'mode' | 'bars'>, barPos: number, muted: readonly boolean[], feel: MixFeel | null | undefined): MixedVoice[] {
    if (mix.mode === 'all' || !muted.length) return (this.last = muted.map(() => ({ gain: 1 })));
    const live = muted.flatMap((m, i) => (m ? [] : [i]));
    if (!live.length) return (this.last = muted.map(() => ({ gain: 1 })));
    const raw = Number.isFinite(barPos) ? barPos : 0;
    // The bar clock wraps at 64: keep counting on through the wrap.
    if (this.lastRaw !== null && raw < this.lastRaw - BAR_WRAP / 2) this.wraps++;
    this.lastRaw = raw;
    const pos = raw + this.wraps * BAR_WRAP;
    // The clock jumped back (stop and start): begin again from here.
    if (pos < this.startAt - 1e-6) this.nextAt = -Infinity;
    const key = live.join(',');
    if (pos >= this.nextAt - 1e-9) {
      const intensity = feelIntensity(feel);
      const bars = followBars(mix.bars, intensity);
      const first = this.nextAt === -Infinity;
      this.change++;
      this.startAt = first ? pos : Math.min(pos, this.nextAt);
      this.nextAt = (Math.floor(pos / bars + 1e-9) + 1) * bars;
      this.fadeLen = first ? 0 : fadeBars(bars);
      this.before = first ? null : this.now;
      this.beforeMost = this.most;
      this.most = 2 + Math.round(intensity * 2);
      this.now = pickAt(mix.mode, this.change, live, this.most);
      this.liveKey = key;
    } else if (key !== this.liveKey) {
      // A visual was muted or brought back: pick again among the ones playing.
      this.now = pickAt(mix.mode, this.change, live, this.most);
      if (this.before) this.before = pickAt(mix.mode, this.change - 1, live, this.beforeMost);
      this.liveKey = key;
    }
    const fade = this.fadeLen > 0 ? smooth((pos - this.startAt) / this.fadeLen) : 1;
    return (this.last = blendPicks(muted, this.now!, fade < 1 ? this.before : null, fade));
  }

  /** The last mix worked out, for the rack's lights. */
  get current(): readonly MixedVoice[] {
    return this.last;
  }
}
