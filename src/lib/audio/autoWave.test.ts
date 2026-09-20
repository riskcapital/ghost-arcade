import { describe, expect, it } from 'vitest';
import { resolveAutoValue, advanceAutoPhase, autoClipPosition } from './autoWave';
import type { AutoConfig } from '../types';
import { KEYFRAME_EASINGS } from '../keyframes/easing';
const auto = (patch: Partial<AutoConfig> = {}): AutoConfig => ({ phase: .25, mode: 'loop', speedHz: .15, min: 10, max: 30, playing: true, ...patch });
describe('Auto sweep curves', () => {
  it('keeps old projects linear and applies a curve in both travel directions', () => {
    expect(resolveAutoValue(auto())).toBe(15);
    expect(resolveAutoValue(auto({ easing: 'ease-in' }))).toBe(11.25);
    expect(resolveAutoValue(auto({ mode: 'pingpong', easing: 'sine', phase: .125 })))
      .toBeCloseTo(resolveAutoValue(auto({ mode: 'pingpong', easing: 'sine', phase: .875 })));
  });
  it.each(KEYFRAME_EASINGS)('keeps $label inside normal and reversed bounds', ({ value }) => {
    for (const [min, max] of [[10, 30], [30, 10]]) {
      for (let i = 0; i <= 100; i++) {
        const result = resolveAutoValue(auto({ min, max, phase: i / 100, easing: value }));
        expect(result).toBeGreaterThanOrEqual(10);
        expect(result).toBeLessThanOrEqual(30);
      }
    }
  });
  it('preserves endpoints, ping-pong reversal, and nonfinite fallbacks', () => {
    expect(resolveAutoValue(auto({ phase: 0, easing: 'elastic' }))).toBe(10);
    expect(resolveAutoValue(auto({ phase: 1, easing: 'elastic' }))).toBe(30);
    expect(resolveAutoValue(auto({ phase: .5, mode: 'pingpong', easing: 'bounce' }))).toBe(30);
    expect(resolveAutoValue(auto({ phase: NaN, min: NaN, max: Infinity }))).toBe(0);
  });
});

describe('beat-synced Auto phase', () => {
  it('locks to absolute beats regardless of frame rate, tempo or long frame stalls', () => {
    const config = auto({ timing: 'beat', cycleBeats: 4 });
    expect(advanceAutoPhase(config, .016, 5)).toBe(.25);
    expect(advanceAutoPhase(config, 3, 5)).toBe(.25);
    expect(advanceAutoPhase(config, .033, 8)).toBe(0);
    expect(advanceAutoPhase(config, .016, -1)).toBe(.75);
  });
  it('freezes on pause and rejoins the current beat on resume', () => {
    expect(advanceAutoPhase(auto({ timing: 'beat', playing: false }), .016, 12)).toBe(.25);
    expect(advanceAutoPhase(auto({ timing: 'beat' }), .016, 12)).toBe(0);
  });
  it('retains free-running compatibility and ignores stalls only in free mode', () => {
    expect(advanceAutoPhase(auto(), .1, 50)).toBeCloseTo(.265);
    expect(advanceAutoPhase(auto(), 2, 50)).toBe(.25);
    expect(advanceAutoPhase(auto({ timing: 'beat', cycleBeats: 0 }), .1, 1)).toBe(.25);
    expect(advanceAutoPhase(auto({ timing: 'beat' }), .1, NaN)).toBe(.25);
  });
});

describe('crossfader-driven Auto', () => {
  it('follows A/B directly even if the saved time mode is ping-pong', () => {
    const config = auto({ timing: 'crossfader', mode: 'pingpong' });
    expect(advanceAutoPhase(config, .016, 50, 0)).toBe(0);
    expect(advanceAutoPhase(config, .016, 50, 1)).toBe(1);
    expect(resolveAutoValue({ ...config, phase: 1 })).toBe(30);
    expect(resolveAutoValue({ ...config, phase: .5 })).toBe(20);
  });
  it('holds when disabled or paused, then follows the current position on resume', () => {
    const config = auto({ timing: 'crossfader' });
    expect(advanceAutoPhase(config, .016, 50)).toBe(.25);
    expect(advanceAutoPhase({ ...config, playing: false }, .016, 50, .9)).toBe(.25);
    expect(advanceAutoPhase(config, 2, 50, .9)).toBe(.9);
  });
  it('applies curves and reversed ranges and bounds invalid fader inputs', () => {
    expect(resolveAutoValue(auto({ timing: 'crossfader', easing: 'ease-in', phase: .5, min: 30, max: 10 }))).toBe(25);
    expect(advanceAutoPhase(auto({ timing: 'crossfader' }), .016, 0, 8)).toBe(1);
    expect(advanceAutoPhase(auto({ timing: 'crossfader' }), .016, 0, NaN)).toBe(.25);
  });
});

describe('clip-position driver', () => {
  const video = { type: 'video', durationSeconds: 10, trimStart: .2, trimEnd: .8, _nativePlaybackTimeSeconds: 2, _nativePlaybackUpdatedAtMs: 1000, playbackMode: 'loop', isPlaying: true };
  it('tracks trim-relative position, looping, reverse and pause', () => {
    expect(autoClipPosition(video, 4000)).toBe(.5);
    expect(autoClipPosition(video, 7000)).toBe(0);
    expect(autoClipPosition({ ...video, _nativePlaybackTimeSeconds: 8, playbackRate: -1 }, 4000)).toBe(.5);
    expect(autoClipPosition({ ...video, isPlaying: false, _nativePlaybackTimeSeconds: 5 }, 9000)).toBe(.5);
    expect(autoClipPosition({ ...video, playbackMode: 'once' }, 9000)).toBe(1);
  });
  it('follows the bounce return leg and an explicitly scrubbed anchor', () => {
    expect(autoClipPosition({ ...video, playbackMode: 'bounce' }, 10000)).toBe(.5);
    expect(autoClipPosition({ ...video, _nativePlaybackTimeSeconds: 6.5, _nativePlaybackUpdatedAtMs: 5000 }, 5000)).toBe(.75);
  });
  it('holds without valid video data and uses direct position despite ping-pong mode', () => {
    expect(autoClipPosition({ ...video, type: 'image' }, 4000)).toBeUndefined();
    expect(autoClipPosition({ ...video, durationSeconds: NaN }, 4000)).toBeUndefined();
    expect(autoClipPosition({ ...video, trimEnd: .2 }, 4000)).toBeUndefined();
    const config = auto({ timing: 'clip', mode: 'pingpong' });
    expect(advanceAutoPhase(config, .016, 0)).toBe(.25);
    expect(advanceAutoPhase(config, .016, 0, undefined, 1)).toBe(1);
    expect(resolveAutoValue({ ...config, phase: 1 })).toBe(30);
  });
});
