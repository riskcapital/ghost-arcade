/**
 * Which key the band is in, from the notes heard: each pitch class is
 * weighted by how loud it was played, and the totals are compared with the
 * major and minor key profiles (how often each degree sounds in music in
 * that key). The best match wins; how far it stands above the runner-up
 * says how sure the guess is.
 */

/** Major and minor key profiles, from the tonic up (Krumhansl and Kessler). */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyGuess {
  /** 0 = C ... 11 = B. */
  root: number;
  mode: 'major' | 'minor';
  /** 0-1: how clearly this key beats the next best. */
  confidence: number;
  /** Notes heard so far. */
  notes: number;
}

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export class KeyFinder {
  private weights = new Array<number>(12).fill(0);
  private count = 0;

  reset(): void {
    this.weights.fill(0);
    this.count = 0;
  }

  /** A note was heard (MIDI note, 0-1 loudness). */
  add(note: number, velocity = 0.7): void {
    if (!Number.isFinite(note)) return;
    const pc = ((Math.round(note) % 12) + 12) % 12;
    this.weights[pc] += 0.3 + Math.max(0, Math.min(1, velocity));
    this.count++;
  }

  /** The best key so far, or null before enough has been heard. */
  guess(minNotes = 12): KeyGuess | null {
    if (this.count < minNotes) return null;
    const scores: { root: number; mode: 'major' | 'minor'; r: number }[] = [];
    for (let root = 0; root < 12; root++) {
      const rotated = this.weights.map((_, i) => this.weights[(i + root) % 12]);
      scores.push({ root, mode: 'major', r: correlation(rotated, MAJOR) });
      scores.push({ root, mode: 'minor', r: correlation(rotated, MINOR) });
    }
    scores.sort((a, b) => b.r - a.r);
    const [best, next] = scores;
    if (!best || best.r <= 0) return null;
    // The relative major/minor share their notes; a narrow margin there is normal, so it is judged on the third best too.
    const relative = (k: { root: number; mode: string }) =>
      (k.mode === 'major' && next.mode === 'minor' && next.root === (k.root + 9) % 12)
      || (k.mode === 'minor' && next.mode === 'major' && next.root === (k.root + 3) % 12);
    const rival = relative(best) ? scores[2] : next;
    const margin = Math.max(0, best.r - (rival?.r ?? 0));
    const confidence = Math.max(0, Math.min(1, margin * 4 * Math.min(1, this.count / 40)));
    return { root: best.root, mode: best.mode, confidence, notes: this.count };
  }
}
