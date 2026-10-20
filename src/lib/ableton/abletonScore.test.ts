import { describe, expect, it } from 'vitest';
import {
  autoRange,
  colorHue,
  defaultScoreAction,
  isScoreTrackName,
  locatorsReached,
  noteName,
  notesDue,
  sanitizeSignals,
  signalOutput,
  smoothToward,
} from './abletonScore';
import type { ScoreNote } from './abletonLinks';

describe('visual score', () => {
  it('recognises score tracks by name', () => {
    expect(isScoreTrackName('Ghost Arcade')).toBe(true);
    expect(isScoreTrackName('GhostArcade FX')).toBe(true);
    expect(isScoreTrackName('Visuals')).toBe(true);
    expect(isScoreTrackName('Drums')).toBe(false);
  });

  it('names notes the way Live does', () => {
    expect(noteName(60)).toBe('C3');
    expect(noteName(36)).toBe('C1');
    expect(noteName(61)).toBe('C#3');
  });

  it('maps C1 upward to columns and C3 upward to snapshots', () => {
    expect(defaultScoreAction(36, 8)).toEqual({ kind: 'column', deck: 'A', column: 0 });
    expect(defaultScoreAction(43, 8)).toEqual({ kind: 'column', deck: 'A', column: 7 });
    expect(defaultScoreAction(44, 8)).toBeNull();
    expect(defaultScoreAction(62, 8)).toEqual({ kind: 'snapshot', slot: 2 });
    expect(defaultScoreAction(20, 8)).toBeNull();
  });

  it('finds notes due in a window, across loop wraps', () => {
    const notes: ScoreNote[] = [[36, 0, 1, 100], [38, 2, 1, 100], [40, 3.5, 0.5, 100]];
    expect(notesDue(notes, 0, 1, 4).map(d => d.note[0])).toEqual([36]);
    // 3 → 6 covers the end of one loop and the start of the next.
    expect(notesDue(notes, 3, 6.5, 4).map(d => [d.note[0], d.at])).toEqual([[40, 3.5], [36, 4], [38, 6]]);
    expect(notesDue(notes, 1, 1, 4)).toEqual([]);
  });
});

describe('locators', () => {
  const cues = [{ name: 'Intro', time: 0 }, { name: 'Drop', time: 32 }, { name: 'Outro', time: 64 }];
  it('fires locators passed while playing', () => {
    expect(locatorsReached(cues, 31.9, 32.02)).toEqual([1]);
    expect(locatorsReached(cues, 10, 10.1)).toEqual([]);
  });
  it('fires the locator a jump lands on, and nothing it skipped', () => {
    expect(locatorsReached(cues, 8, 64)).toEqual([2]);
    expect(locatorsReached(cues, 40, 20)).toEqual([]);
  });
});

describe('signals', () => {
  it('maps onto the target range, inverted if asked', () => {
    const target = { path: 'vj:fx:hue:hueshift', label: 'Hue', min: 0, max: 360 };
    expect(signalOutput(0.5, { invert: false, target })).toBe(180);
    expect(signalOutput(0.25, { invert: true, target })).toBe(270);
    expect(signalOutput(2, { invert: false, target })).toBe(360);
  });
  it('glides with smoothing and jumps without it', () => {
    expect(smoothToward(0, 1, 0, 0.016)).toBe(1);
    const glided = smoothToward(0, 1, 0.5, 0.016);
    expect(glided).toBeGreaterThan(0);
    expect(glided).toBeLessThan(0.1);
  });
  it('auto-ranges levels that sit high', () => {
    const range = { lo: 0.8, hi: 0.8 };
    for (const v of [0.9, 0.7, 0.9, 0.7]) autoRange(range, v);
    expect(autoRange(range, 0.9)).toBeCloseTo(1, 1);
    expect(autoRange(range, 0.7)).toBeCloseTo(0, 1);
    expect(autoRange(range, 0.8)).toBeGreaterThan(0.3);
  });
  it('reads hue from Live colours', () => {
    expect(colorHue(0xff0000)).toBe(0);
    expect(colorHue(0x00ff00)).toBeCloseTo(1 / 3);
    expect(colorHue(0x0000ff)).toBeCloseTo(2 / 3);
  });
  it('drops malformed signal links', () => {
    const links = sanitizeSignals([
      { id: 'a', source: { kind: 'level', track: 0, trackName: 'Drums' }, target: { path: 'vj:macro:1:value', label: 'Energy', min: 0, max: 1 } },
      { id: 'b', source: { kind: 'param', track: 1 }, target: { path: 'x' } },
      { id: 'c', source: { kind: 'level', track: 0 } },
    ]);
    expect(links.map(l => l.id)).toEqual(['a']);
  });
});
