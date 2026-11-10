/**
 * When a sound row ducks: on every beat of the Timeline's grid, or under
 * another row's kick (found offline in that row's files, so it is the same
 * on every run). Pure.
 */
import { beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';
import type { ShowTempoMap } from '../../types';
import type { SongFeatures } from '../lines/songFeatures';

/** Show times of the beats in [from, to). Without a grid: 120 BPM from 0. */
export function beatHitsBetween(tempo: ShowTempoMap | null, from: number, to: number): number[] {
  if (!(to > from)) return [];
  const q = (t: number) => (tempo ? beatAtSeconds(tempo, t) : t * 2);
  const s = (b: number) => (tempo ? secondsAtBeat(tempo, b) : b / 2);
  const out: number[] = [];
  for (let b = Math.ceil(q(from) - 1e-9); ; b++) {
    const t = s(b);
    if (t >= to - 1e-9) break;
    if (t >= from - 1e-9) out.push(t);
    if (out.length > 512) break;
  }
  return out;
}

/** Kick hits in a song's features: where its kick envelope rises past `threshold` (file seconds). */
export function kickHitsInFeatures(features: SongFeatures, threshold = 0.55, minGap = 0.12): number[] {
  const kick = features.features.kick;
  const out: number[] = [];
  let last = -Infinity;
  let prev = 0;
  for (let i = 0; i < kick.length; i++) {
    const v = kick[i];
    if (v >= threshold && prev < threshold) {
      const t = i / features.frameRate;
      if (t - last >= minGap) {
        out.push(t);
        last = t;
      }
    }
    prev = v;
  }
  return out;
}

export interface KickPlacement {
  startTime: number;
  duration: number;
  offset: number;
  hits: readonly number[];
}

/** A row's kicks on the Timeline (show seconds, sorted): each block's hits where the block plays. */
export function rowKickTimes(blocks: readonly KickPlacement[]): number[] {
  const out: number[] = [];
  for (const b of blocks) {
    for (const h of b.hits) {
      const t = b.startTime + (h - b.offset);
      if (h >= b.offset && t < b.startTime + b.duration) out.push(t);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Times in a sorted list within [from, to). */
export function timesBetween(sorted: readonly number[], from: number, to: number): number[] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < from - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < sorted.length && sorted[i] < to - 1e-9; i++) out.push(sorted[i]);
  return out;
}
