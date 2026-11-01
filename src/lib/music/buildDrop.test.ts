import { describe, expect, it } from 'vitest';
import { buildLanding, buildProgress, normalizeBuildSettings, rollHits } from './buildDrop';

describe('a build-up', () => {
  it('lands exactly on a bar line, the given number of bars after the next one', () => {
    expect(buildLanding(0, 4)).toBe(16);
    expect(buildLanding(2.3, 1)).toBe(8);
    expect(buildLanding(3.999, 2)).toBe(12);
    for (let beat = 0; beat < 20; beat += 0.37) {
      for (const bars of [1, 2, 4, 8]) {
        const land = buildLanding(beat, bars);
        expect(land % 4).toBe(0);
        expect(land - beat).toBeGreaterThanOrEqual(bars * 4 - 1e-9);
      }
    }
  });

  it('rolls faster and harder towards the drop, every hit on the grid', () => {
    const hits = rollHits(0, 16);
    const gaps = hits.slice(1).map((h, i) => h.beat - hits[i].beat);
    expect(gaps[0]).toBe(1);
    expect(gaps[gaps.length - 1]).toBe(0.125);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] + 1e-9);
    for (let i = 1; i < hits.length; i++) expect(hits[i].velocity).toBeGreaterThanOrEqual(hits[i - 1].velocity);
    expect(hits.every((h) => h.beat < 16)).toBe(true);
    expect(hits[hits.length - 1].beat).toBeCloseTo(15.875);
  });

  it('leaves the last half beat empty with a gap', () => {
    const hits = rollHits(0, 8, true);
    expect(Math.max(...hits.map((h) => h.beat))).toBeLessThan(7.5);
  });

  it('counts progress from 0 to 1', () => {
    expect(buildProgress(4, 12, 4)).toBe(0);
    expect(buildProgress(4, 12, 8)).toBe(0.5);
    expect(buildProgress(4, 12, 20)).toBe(1);
  });

  it('loads saved settings safely', () => {
    const s = normalizeBuildSettings({ bars: 3, style: 'dub', riser: 4, dropSet: 'moon' }, ['dub', 'berlin']);
    expect(s.bars).toBe(4);
    expect(s.style).toBe('dub');
    expect(s.riser).toBe(1);
    expect(s.dropSet).toBeNull();
  });
});
