import { describe, expect, it } from 'vitest';
import { chooseAnchor, nextPlaylistIndex, periodKeyFor, resumePlaylistIndex, resumePosition } from './installResume';

describe('resume position', () => {
  const base = { mode: 'clock' as const, now: 1_000_000, duration: 60, loop: true };
  it('a looping show resumes where it would be by the clock', () => {
    expect(resumePosition({ ...base, anchorMs: 1_000_000 - 150_000 })).toBeCloseTo(30);
    expect(resumePosition({ ...base, anchorMs: 1_000_000 - 59_500 })).toBeCloseTo(59.5);
  });
  it('a show that does not loop resumes inside its length, else from the start', () => {
    expect(resumePosition({ ...base, loop: false, anchorMs: 1_000_000 - 20_000 })).toBeCloseTo(20);
    expect(resumePosition({ ...base, loop: false, anchorMs: 1_000_000 - 70_000 })).toBe(0);
  });
  it('starts from 0 in start mode, without an anchor, with an empty show or an anchor in the future', () => {
    expect(resumePosition({ ...base, mode: 'start', anchorMs: 0 })).toBe(0);
    expect(resumePosition({ ...base, anchorMs: null })).toBe(0);
    expect(resumePosition({ ...base, duration: 0, anchorMs: 0 })).toBe(0);
    expect(resumePosition({ ...base, anchorMs: 2_000_000 })).toBe(0);
  });
});

describe('anchor choice', () => {
  const stored = { anchorMs: 500, periodKey: 'p100', projectPath: '/a.gha' };
  it('uses the stored anchor for the same project and period', () => {
    expect(chooseAnchor({ stored, projectPath: '/a.gha', periodKey: 'p100', periodStart: 100, scheduleEnabled: true, warmupMs: 0 })).toBe(500);
  });
  it('falls back to the period start (plus warm-up) for a new period or project', () => {
    expect(chooseAnchor({ stored, projectPath: '/a.gha', periodKey: 'p200', periodStart: 200, scheduleEnabled: true, warmupMs: 60_000 })).toBe(60_200);
    expect(chooseAnchor({ stored, projectPath: '/b.gha', periodKey: 'p100', periodStart: 100, scheduleEnabled: true, warmupMs: 0 })).toBe(100);
  });
  it('has none without a schedule and nothing stored', () => {
    expect(chooseAnchor({ stored: null, projectPath: '/a.gha', periodKey: 'always', periodStart: 5, scheduleEnabled: false, warmupMs: 0 })).toBeNull();
    expect(periodKeyFor(false, 123)).toBe('always');
    expect(periodKeyFor(true, 123)).toBe('p123');
  });
});

describe('playlist position', () => {
  it('wraps round', () => {
    expect(nextPlaylistIndex(0, 3)).toBe(1);
    expect(nextPlaylistIndex(2, 3)).toBe(0);
    expect(nextPlaylistIndex(-1, 3)).toBe(0);
    expect(nextPlaylistIndex(0, 0)).toBe(0);
  });
  it('resumes the stored item in the same period', () => {
    const s = { anchorMs: 1, periodKey: 'always', projectPath: '/x', playlistIndex: 2 };
    expect(resumePlaylistIndex(s, 3, 'always')).toBe(2);
    expect(resumePlaylistIndex(s, 2, 'always')).toBe(0);
    expect(resumePlaylistIndex(s, 3, 'p1')).toBe(0);
  });
});
