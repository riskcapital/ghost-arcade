/**
 * Groove for written loops: swing on the off sixteenths, accents by where a
 * note falls in the bar, ghost notes kept soft, and a hair of timing drift on
 * the notes that are not accented, so a loop breathes instead of ticking.
 * Deterministic, so a loop sounds the same every time it is loaded.
 */

import type { LoopNote } from './loops';

export interface GrooveFeel {
  /** Swing on the off sixteenths, as a fraction: 0.5 straight, 0.56 a lazy house or dub swing. */
  swing: number;
  /** Which beats in the bar carry the accent. */
  accent: 'downbeats' | 'two-four' | 'offbeats' | 'flat';
  /** How far velocities lean on the accents, 0-1. */
  depth: number;
}

export const FEELS = {
  straight: { swing: 0.5, accent: 'downbeats', depth: 0.25 },
  techno: { swing: 0.5, accent: 'offbeats', depth: 0.3 },
  house: { swing: 0.56, accent: 'offbeats', depth: 0.3 },
  dub: { swing: 0.55, accent: 'downbeats', depth: 0.3 },
  funk: { swing: 0.57, accent: 'two-four', depth: 0.35 },
  float: { swing: 0.5, accent: 'flat', depth: 0.1 },
} satisfies Record<string, GrooveFeel>;

/** A small fixed jitter from the note's place, -1..1. */
function jitter(beat: number, degree: number): number {
  const x = Math.sin(beat * 12.9898 + degree * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Apply a feel to written notes. Notes already marked soft (velocity under 0.5) stay ghost notes. */
export function applyGroove(notes: LoopNote[], feel: GrooveFeel): LoopNote[] {
  return notes.map((n) => {
    const inBeat = ((n.beat % 1) + 1) % 1;
    const inBar = ((n.beat % 4) + 4) % 4;
    // Swing: an off sixteenth (x.25 or x.75) lands late.
    const offSixteenth = Math.abs(inBeat - 0.25) < 1e-6 || Math.abs(inBeat - 0.75) < 1e-6;
    const swingShift = offSixteenth ? (feel.swing - 0.5) * 0.5 : 0;
    const onBeat = inBeat < 1e-6;
    const offBeat = Math.abs(inBeat - 0.5) < 1e-6;
    let accent = 0;
    if (feel.accent === 'downbeats') accent = onBeat ? (inBar < 1e-6 || Math.abs(inBar - 2) < 1e-6 ? 1 : 0.5) : offBeat ? 0 : -0.5;
    else if (feel.accent === 'two-four') accent = onBeat ? (Math.abs(inBar - 1) < 1e-6 || Math.abs(inBar - 3) < 1e-6 ? 1 : 0.4) : offBeat ? 0 : -0.5;
    else if (feel.accent === 'offbeats') accent = offBeat ? 1 : onBeat ? 0.2 : -0.4;
    const ghost = n.velocity < 0.5;
    const velocity = ghost ? n.velocity : Math.max(0.3, Math.min(1, n.velocity * (1 + accent * feel.depth * 0.35)));
    // Unaccented notes drift by a few milliseconds.
    const drift = accent > 0.5 ? 0 : jitter(n.beat, n.degrees[0] ?? 0) * 0.006;
    return { ...n, beat: Math.max(0, n.beat + swingShift + drift), velocity };
  });
}

/** Voices for each chord in turn, each moving to the nearest note of the next chord. */
export function voiceLead(chords: number[][], start: number[]): number[][] {
  const out: number[][] = [];
  let prev = start;
  for (const tones of chords) {
    const pcs = new Set(tones.map((t) => ((t % 7) + 7) % 7));
    const used = new Set<number>();
    const next = prev.map((v) => {
      // The nearest chord tone, preferring one not already sounded.
      let best = v;
      let bestScore = Infinity;
      for (let d = v - 4; d <= v + 4; d++) {
        const pc = ((d % 7) + 7) % 7;
        if (!pcs.has(pc)) continue;
        const score = Math.abs(d - v) + (used.has(pc) ? 3 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = d;
        }
      }
      used.add(((best % 7) + 7) % 7);
      return best;
    });
    // Any chord tone left out replaces a doubled voice, nearest first.
    for (const pc of pcs) {
      if (used.has(pc)) continue;
      const counts = new Map<number, number>();
      next.forEach((d) => counts.set(((d % 7) + 7) % 7, (counts.get(((d % 7) + 7) % 7) ?? 0) + 1));
      const i = next.findIndex((d) => (counts.get(((d % 7) + 7) % 7) ?? 0) > 1);
      if (i < 0) break;
      const base = next[i];
      const candidates = [-7, 0, 7].map((o) => pc + Math.floor(base / 7) * 7 + o);
      next[i] = candidates.reduce((a, b) => (Math.abs(a - base) <= Math.abs(b - base) ? a : b));
      used.add(pc);
    }
    next.sort((a, b) => a - b);
    out.push(next);
    prev = next;
  }
  return out;
}
