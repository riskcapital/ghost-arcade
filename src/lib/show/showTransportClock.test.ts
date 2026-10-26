import { describe, expect, it } from 'vitest';
import { readAudioClock, ShowTransportClock } from './showTransportClock';

describe('ShowTransportClock', () => {
  it('follows the audio clock, not the frame clock, when there is audio', () => {
    const clock = new ShowTransportClock();
    expect(clock.advance({ frame: 100, audio: 50 }, 10)).toBe(10);
    // Frames say a second went by; the sound card says 0.98 s. The sound card wins.
    expect(clock.advance({ frame: 101, audio: 50.98 }, 10)).toBeCloseTo(10.98, 9);
    expect(clock.activeSource).toBe('audio');
  });

  it('runs on the frame clock without audio', () => {
    const clock = new ShowTransportClock();
    clock.advance({ frame: 3, audio: null }, 0);
    expect(clock.advance({ frame: 3.5, audio: null }, 0)).toBeCloseTo(0.5, 9);
    expect(clock.activeSource).toBe('frame');
  });

  it('switching source never makes the playhead jump', () => {
    const clock = new ShowTransportClock();
    clock.advance({ frame: 0, audio: null }, 0);
    const before = clock.advance({ frame: 2, audio: null }, 0);
    // The audio engine starts: its clock is at 900 s, which means nothing to the show.
    expect(clock.advance({ frame: 2.016, audio: 900 }, before)).toBe(before);
    expect(clock.advance({ frame: 2.032, audio: 900.5 }, before)).toBeCloseTo(before + 0.5, 9);
    // …and stops again.
    const at = before + 0.5;
    expect(clock.advance({ frame: 3, audio: null }, at)).toBe(at);
    expect(clock.advance({ frame: 3.25, audio: null }, at)).toBeCloseTo(at + 0.25, 9);
  });

  it('re-anchors after a reset (seek, scrub, start)', () => {
    const clock = new ShowTransportClock();
    clock.advance({ frame: 0, audio: 10 }, 0);
    clock.advance({ frame: 0, audio: 12 }, 0);
    clock.reset();
    expect(clock.advance({ frame: 0, audio: 12.1 }, 30)).toBe(30);
    expect(clock.advance({ frame: 0, audio: 13.1 }, 30)).toBeCloseTo(31, 9);
  });

  it('never runs backwards on jitter, and re-anchors on a real jump back', () => {
    const clock = new ShowTransportClock();
    clock.advance({ frame: 0, audio: 5 }, 0);
    expect(clock.advance({ frame: 0, audio: 6 }, 0)).toBeCloseTo(1, 9);
    expect(clock.advance({ frame: 0, audio: 5.999 }, 1)).toBeCloseTo(1, 9);
    // The engine restarted from zero.
    expect(clock.advance({ frame: 0, audio: 0.01 }, 1)).toBe(1);
    expect(clock.advance({ frame: 0, audio: 0.51 }, 1)).toBeCloseTo(1.5, 9);
  });

  it('a loop wrap keeps every bit of clock time', () => {
    const clock = new ShowTransportClock();
    clock.advance({ frame: 0, audio: 0 }, 9.9);
    const past = clock.advance({ frame: 0, audio: 0.25 }, 9.9); // 10.15 on a 10 s show
    expect(past).toBeCloseTo(10.15, 9);
    clock.shift(-10);
    expect(clock.advance({ frame: 0, audio: 0.35 }, 0.15)).toBeCloseTo(0.25, 9);
  });

  it('drives a long show without drifting from the audio', () => {
    // Frames run 0.1% fast against the sound card for an hour, with hitches.
    const clock = new ShowTransportClock();
    let frame = 0, audio = 0, show = 0;
    show = clock.advance({ frame, audio }, show);
    for (let i = 1; i <= 3600 * 60; i++) {
      frame += (1 / 60) * 1.001 + (i % 600 === 0 ? 0.1 : 0);
      audio += 1 / 60;
      show = clock.advance({ frame, audio }, show);
    }
    expect(show).toBeCloseTo(audio, 6);
  });
});

describe('readAudioClock', () => {
  it('is null without a running context', () => {
    expect(readAudioClock(null, 0)).toBeNull();
    expect(readAudioClock({ state: 'suspended', currentTime: 3 }, 0)).toBeNull();
  });

  it('carries the last output timestamp forward between buffers', () => {
    const ctx = { state: 'running', currentTime: 10.02, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 5000 }) };
    expect(readAudioClock(ctx, 5000)).toBeCloseTo(10, 9);
    expect(readAudioClock(ctx, 5008)).toBeCloseTo(10.008, 9);
    // A stamp this stale means the device stalled: the clock stalls too.
    expect(readAudioClock(ctx, 9000)).toBeCloseTo(10.25, 9);
  });

  it('falls back to currentTime when there is no timestamp yet', () => {
    expect(readAudioClock({ state: 'running', currentTime: 4.5, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) }, 1)).toBe(4.5);
    expect(readAudioClock({ state: 'running', currentTime: 4.5 }, 1)).toBe(4.5);
  });
});
