/**
 * LFO shapes, 0..1, from a position in cycles (time × rate; for a bpm-synced
 * LFO, beats × rate). The position can be negative: a show playing before
 * its bar 1 counts negative beats, and `x % 1` of a negative number is
 * negative, which put saw and triangle LFOs below their range there.
 */
export type LfoShape = 'sine' | 'saw' | 'square' | 'tri';

/** The fractional part of `x`, always in [0, 1). */
export function cyclePhase(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const f = x - Math.floor(x);
  return f >= 1 ? 0 : f;
}

export function lfoValue(shape: LfoShape, cycles: number): number {
  switch (shape) {
    case 'sine': return (Math.sin(cycles * Math.PI * 2) + 1) / 2;
    case 'square': return Math.sin(cycles * Math.PI * 2) > 0 ? 1 : 0;
    case 'saw': return cyclePhase(cycles);
    case 'tri': {
      const phase = cyclePhase(cycles);
      return phase < 0.5 ? phase * 2 : 2 - phase * 2;
    }
  }
}
