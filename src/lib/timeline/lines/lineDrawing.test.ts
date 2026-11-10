import { describe, expect, it } from 'vitest';
import { createTempoMap } from '../../show/tempoMap';
import { pointsValueAt } from './lineEvaluator';
import { monotoneSamples, scaleOffsetPoints, snapToBeats, spliceStroke, strokeToPoints, thinSamples, type Sample } from './lineDrawing';

function wobble(n = 600): Sample[] {
  // A hand-drawn-ish stroke: a slow wave plus a little jitter, 0..10 s.
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * 10;
    return { t, v: 0.5 + 0.4 * Math.sin(t * 1.3) + 0.003 * Math.sin(i * 7.7) };
  });
}

describe('thinning', () => {
  it('never strays more than the tolerance from a dropped sample', () => {
    const samples = wobble();
    for (const tol of [0.001, 0.01, 0.05]) {
      const thin = thinSamples(samples, tol);
      expect(thin[0]).toEqual(samples[0]);
      expect(thin[thin.length - 1]).toEqual(samples[samples.length - 1]);
      const pts = thin.map((s) => ({ t: s.t, v: s.v }));
      let worst = 0;
      for (const s of samples) worst = Math.max(worst, Math.abs(pointsValueAt(pts, s.t)! - s.v));
      expect(worst).toBeLessThanOrEqual(tol + 1e-12);
      expect(thin.length).toBeLessThan(samples.length);
    }
    expect(thinSamples(samples, 0.05).length).toBeLessThan(thinSamples(samples, 0.001).length);
  });

  it('a flat run folds to its ends', () => {
    const flat = Array.from({ length: 50 }, (_, i) => ({ t: i, v: 3 }));
    expect(thinSamples(flat, 0.001)).toEqual([{ t: 0, v: 3 }, { t: 49, v: 3 }]);
  });
});

describe('pen stroke', () => {
  it('becomes a few smooth points within range, in time order even when the pen went back', () => {
    const raw = [...wobble(300), { t: 4, v: 0.9 }, { t: 4.5, v: 0.95 }];
    const ordered = monotoneSamples(raw);
    expect(ordered[ordered.length - 1].t).toBe(4.5);
    const pts = strokeToPoints(raw, { min: 0, max: 1, curve: 'smooth' });
    expect(pts.length).toBeLessThan(40);
    for (let i = 1; i < pts.length; i++) expect(pts[i].t).toBeGreaterThan(pts[i - 1].t);
    for (const p of pts) {
      expect(p.v).toBeGreaterThanOrEqual(0);
      expect(p.v).toBeLessThanOrEqual(1);
      expect(p.c).toBe('smooth');
    }
  });

  it('splices into a line without moving it outside the stroke', () => {
    const line = [{ t: 0, v: 0 }, { t: 10, v: 10 }];
    const out = spliceStroke(line, [{ t: 4, v: 9 }, { t: 6, v: 9 }]);
    expect(pointsValueAt(out, 2)).toBeCloseTo(2);
    expect(pointsValueAt(out, 5)).toBeCloseTo(9);
    expect(pointsValueAt(out, 8)).toBeCloseTo(8);
    const glide = spliceStroke(line, [{ t: 4, v: 9 }, { t: 6, v: 9 }], { glide: 0.5 });
    expect(pointsValueAt(glide, 6.25)).toBeCloseTo((9 + 6.5) / 2);
    expect(pointsValueAt(glide, 7)).toBeCloseTo(7);
  });
});

describe('snap and transform', () => {
  it('snaps to beats and bars on the tempo map', () => {
    const tempo = createTempoMap(120, 0.25);
    const pts = [{ t: 0.3, v: 1 }, { t: 1.1, v: 2 }, { t: 2.0, v: 3 }];
    expect(snapToBeats(pts, tempo, 1).map((p) => p.t)).toEqual([0.25, 1.25, 2.25]);
    expect(snapToBeats(pts, tempo, 4).map((p) => p.t)).toEqual([0.25, 2.25]);
    expect(snapToBeats(pts, tempo, 1, [1]).map((p) => p.t)).toEqual([0.3, 1.25, 2.0]);
  });

  it('scales and shifts a selection, clamped, in order', () => {
    const pts = [{ t: 0, v: 0 }, { t: 1, v: 2 }, { t: 2, v: 4 }, { t: 3, v: 0 }];
    const doubled = scaleOffsetPoints(pts, { valueScale: 2, max: 6 }, [1, 2]);
    expect(doubled.map((p) => p.v)).toEqual([0, 2, 6, 0]);
    const stretched = scaleOffsetPoints(pts, { timeScale: 2, timeOffset: 0.5 }, [1, 2]);
    expect(stretched.map((p) => p.t)).toEqual([0, 1.5, 3.5]);
    const shifted = scaleOffsetPoints(pts, { valueOffset: -1, min: 0 });
    expect(shifted.map((p) => p.v)).toEqual([0, 1, 3, 0]);
  });
});
