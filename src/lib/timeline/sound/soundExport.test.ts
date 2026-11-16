import { describe, expect, it } from 'vitest';
import {
  blockGainSteps,
  crossfadeInto,
  fxTailSeconds,
  soundPieces,
  soundPreroll,
  SOUND_BASE_PREROLL,
  SOUND_MAX_PREROLL,
} from './soundExport';
import { createMacroFx } from '../../music/macroFx';
import { EMPTY_SOUND_DOC } from './soundModel';

const SR = 48000;

describe('the soundtrack in pieces', () => {
  it('covers every frame once, each context on a quantum and a pre-roll before its piece', () => {
    const total = 600 * SR + 77;
    const pieces = soundPieces(total, { pieceFrames: 30 * SR, prerollFrames: 9 * SR });
    expect(pieces[0]).toEqual({ outStart: 0, outEnd: 30 * SR, ctxStart: 0, ctxEnd: 30 * SR });
    let at = 0;
    for (const p of pieces) {
      expect(p.outStart).toBe(at);
      at = p.outEnd;
      expect(p.ctxStart % 128).toBe(0);
      expect(p.ctxStart).toBeLessThanOrEqual(p.outStart);
      if (p.outStart > 0) expect(p.outStart - p.ctxStart).toBeGreaterThanOrEqual(9 * SR);
      expect(p.outStart - p.ctxStart).toBeLessThan(9 * SR + 128);
      expect(p.ctxEnd).toBe(p.outEnd);
    }
    expect(at).toBe(total);
    // Memory per piece does not depend on the length of the show.
    const longest = Math.max(...pieces.map((p) => p.ctxEnd - p.ctxStart));
    expect(longest).toBeLessThanOrEqual(39 * SR + 128);
    expect(soundPieces(3 * 3600 * SR, { pieceFrames: 30 * SR, prerollFrames: 9 * SR }).every((p) => p.ctxEnd - p.ctxStart <= longest)).toBe(true);
  });

  it('a whole render is one piece', () => {
    expect(soundPieces(1000, { pieceFrames: 1000, prerollFrames: 5000 })).toEqual([{ outStart: 0, outEnd: 1000, ctxStart: 0, ctxEnd: 1000 }]);
  });

  it('never opens a context inside a build: it starts at the build instead', () => {
    // A build from 25 s to 33 s (+ its tail): the piece at 30 s would open at 21 s... fine;
    // the one at 60 s would open at 51 s, inside a build from 45 s to 58 s + tail.
    const avoid = [[45 * SR, 66 * SR]] as const;
    const pieces = soundPieces(120 * SR, { pieceFrames: 30 * SR, prerollFrames: 9 * SR, avoid });
    const at60 = pieces.find((p) => p.outStart === 60 * SR)!;
    expect(at60.ctxStart).toBeLessThanOrEqual(45 * SR);
    expect(at60.ctxStart).toBeGreaterThan(45 * SR - 300);
    expect(at60.ctxStart % 128).toBe(0);
    for (const p of pieces) expect(p.ctxStart > 45 * SR && p.ctxStart < 66 * SR).toBe(false);
  });

  it('pieces overlap for a crossfade only when asked', () => {
    const pieces = soundPieces(100 * SR, { pieceFrames: 30 * SR, prerollFrames: 2 * SR, overlapFrames: 960 });
    expect(pieces.slice(0, -1).every((p) => p.ctxEnd === p.outEnd + 960)).toBe(true);
    expect(pieces[pieces.length - 1].ctxEnd).toBe(100 * SR);
  });

  it('crossfades the last piece into the next, from all old to all new', () => {
    const next = new Float32Array(4).fill(1);
    crossfadeInto(next, new Float32Array(4).fill(0));
    expect([...next]).toEqual([0.125, 0.375, 0.625, 0.875]);
  });
});

describe('the pre-roll a doc needs', () => {
  const doc = (fx: ReturnType<typeof createMacroFx>[], lines: Array<{ target: { scope: string; id: string }; key: string }> = []) => {
    const rows = [{ id: 'r1', name: 'Song', kind: 'audio' as const, volume: 1, muted: false, solo: false, fx, duck: null }];
    return { sound: { ...EMPTY_SOUND_DOC, rows }, lines: lines as never, tempo: null, audioTracks: [] };
  };

  it('is the base with no effects, and grows with an echo or a reverb', () => {
    expect(soundPreroll(doc([]))).toEqual({ preroll: SOUND_BASE_PREROLL, clocked: false, capped: false });
    const reverb = createMacroFx('v', 'reverb');
    const withReverb = soundPreroll(doc([reverb])).preroll;
    expect(withReverb).toBeCloseTo(SOUND_BASE_PREROLL + fxTailSeconds(reverb, false, 120));
    expect(withReverb).toBeGreaterThan(SOUND_BASE_PREROLL + 0.5);
  });

  it('a line moving an echo takes its worst case, capped', () => {
    const delay = createMacroFx('d', 'delay');
    const still = soundPreroll(doc([delay])).preroll;
    const moved = soundPreroll(doc([delay], [{ target: { scope: 'sound', id: 'r1' }, key: 'sfx:d:feedback' }]));
    expect(moved.preroll).toBeGreaterThan(still);
    expect(moved.preroll).toBe(SOUND_MAX_PREROLL);
    expect(moved.capped).toBe(true);
  });

  it('knows effects with their own clock', () => {
    expect(soundPreroll(doc([createMacroFx('c', 'chorus')])).clocked).toBe(true);
    expect(soundPreroll(doc([createMacroFx('p', 'phaser')])).clocked).toBe(true);
    expect(soundPreroll(doc([createMacroFx('f', 'filter'), createMacroFx('e', 'eq')])).clocked).toBe(false);
  });
});

describe('a block fade as steps', () => {
  const block = { id: 'b', url: 'x', name: 'x', startTime: 10, duration: 20, offset: 0, lane: 0, volume: 0.5, muted: false, fadeIn: 2, fadeOut: 1 } as never;

  it('is silent before and after, and a piece starting part way takes the step it lands in', () => {
    const steps = blockGainSteps(block, { fadeIn: 2, fadeOut: 1 }, 100);
    expect(steps[0]).toEqual([0, 0]);
    expect(steps[steps.length - 1]).toEqual([30, 0]);
    for (let i = 1; i < steps.length; i++) expect(steps[i][0]).toBeGreaterThan(steps[i - 1][0]);
    // Flat at the block's level between the fades.
    const mid = steps.filter(([t]) => t > 12.001 && t < 29);
    expect(mid.every(([, v]) => v === 0.5)).toBe(true);
    const valueAt = (t: number) => { let v = 0; for (const [s, x] of steps) if (s <= t) v = x; return v; };
    expect(valueAt(11)).toBeGreaterThan(0);
    expect(valueAt(11)).toBeLessThan(0.5);
    expect(valueAt(20)).toBe(0.5);
    expect(valueAt(5)).toBe(0);
  });

  it('a render shorter than the block ends it at the render end', () => {
    const steps = blockGainSteps(block, { fadeIn: 2, fadeOut: 1 }, 15);
    expect(steps[steps.length - 1]).toEqual([15, 0]);
    expect(steps.every(([t]) => t <= 15)).toBe(true);
  });
});
