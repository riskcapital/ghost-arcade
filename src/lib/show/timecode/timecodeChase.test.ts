/**
 * Chase clock: lock, jump, dropout, freewheel, lost and parked, fed both by
 * hand and by the real LTC decoder and MTC parser; and the show timeline
 * following it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { ChaseClock, normalizeTimecodeSettings, timecodeChase, type ChaseSample } from './timecodeChase';
import { LtcDecoder, generateLtc } from './ltc';
import { MtcParser, mtcFullFrame, mtcQuarterFrameStream } from './mtc';
import { actualFps, timecodeToSeconds, type Timecode, type TimecodeRate } from './timecode';
import { showTimeline, setShowCompositionLoader } from '../../stores/showTimeline';

function tc(h: number, m: number, s: number, f: number, rate: TimecodeRate): Timecode {
  return { hours: h, minutes: m, seconds: s, frames: f, rate, dropFrame: rate === 29.97 };
}

describe('ChaseClock', () => {
  it('searches, then locks after three continuous frames and runs on between them', () => {
    const c = new ChaseClock(3, 2000);
    expect(c.read(0).lock).toBe('searching');
    c.onFrame(10, 0);
    c.onFrame(10.04, 40);
    expect(c.read(41).lock).toBe('searching');
    c.onFrame(10.08, 80);
    const r = c.read(100);
    expect(r.lock).toBe('locked');
    expect(r.running).toBe(true);
    expect(r.seconds).toBeCloseTo(10.1, 6);
  });

  it('a jump drops back to searching and relocks at the new place', () => {
    const c = new ChaseClock(3, 2000);
    for (let i = 0; i < 5; i++) c.onFrame(10 + i * 0.04, i * 40);
    c.onFrame(300, 200);
    expect(c.read(201).lock).toBe('searching');
    c.onFrame(300.04, 240);
    c.onFrame(300.08, 280);
    expect(c.read(281)).toMatchObject({ lock: 'locked', running: true });
  });

  it('freewheels through a dropout, then reports lost and holds', () => {
    const c = new ChaseClock(3, 2000);
    for (let i = 0; i <= 10; i++) c.onFrame(i * 0.04, i * 40);
    // Last frame at 400 ms; dropout after 4 frame intervals (160 ms).
    expect(c.read(500).lock).toBe('locked');
    const fw = c.read(1500);
    expect(fw.lock).toBe('freewheel');
    expect(fw.running).toBe(true);
    expect(fw.seconds).toBeCloseTo(1.5, 6);
    const lost = c.read(5000);
    expect(lost.lock).toBe('lost');
    expect(lost.running).toBe(false);
    // Held where freewheel ran out: 400 + 160 + 2000 ms.
    expect(lost.seconds).toBeCloseTo(2.56, 6);
    // The source comes back: straight to locked again after three frames.
    c.onFrame(9, 6000);
    c.onFrame(9.04, 6040);
    c.onFrame(9.08, 6080);
    expect(c.read(6090).lock).toBe('locked');
  });

  it('a generator repeating one frame is parked, and a locate parks at once', () => {
    const c = new ChaseClock(3, 2000);
    for (let i = 0; i < 4; i++) c.onFrame(5, i * 40);
    expect(c.read(200)).toMatchObject({ lock: 'locked', running: false, seconds: 5 });
    const d = new ChaseClock(3, 2000);
    d.onFrame(42, 0, false);
    expect(d.read(10_000)).toMatchObject({ lock: 'locked', running: false, seconds: 42 });
  });
});

describe('chase from decoded sources', () => {
  it('LTC with a one-second dropout: locked, freewheel, locked, with sub-frame accuracy', () => {
    const rate: TimecodeRate = 25;
    const sr = 48000;
    const start = tc(1, 0, 0, 0, rate);
    const pcm = generateLtc({ start, frameCount: 250, sampleRate: sr, amplitude: 0.4, noise: 0.02, seed: 9 });
    // Cut a hole from 4.0 s to 5.0 s.
    const holeFrom = 4 * sr;
    const holeTo = 5 * sr;
    pcm.fill(0, holeFrom, holeTo);
    const decoder = new LtcDecoder(sr);
    const clock = new ChaseClock(3, 2000);
    const startSeconds = timecodeToSeconds(start);
    const readings: Array<{ t: number; lock: string; err: number | null }> = [];
    for (let i = 0; i < pcm.length; i += 128) {
      const block = pcm.subarray(i, Math.min(pcm.length, i + 128));
      for (const f of decoder.process(block)) {
        const atMs = (f.endSample / sr) * 1000;
        clock.onFrame(timecodeToSeconds({ ...start, hours: f.hours, minutes: f.minutes, seconds: f.seconds, frames: f.frames }) + 1 / actualFps(rate), atMs);
      }
      const nowMs = ((i + block.length) / sr) * 1000;
      if ((i / 128) % 40 === 0) {
        const r = clock.read(nowMs);
        readings.push({ t: nowMs / 1000, lock: r.lock, err: r.seconds === null ? null : r.seconds - (startSeconds + nowMs / 1000) });
      }
    }
    const at = (t: number) => readings.reduce((best, r) => (Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best));
    expect(at(2).lock).toBe('locked');
    expect(at(4.6).lock).toBe('freewheel');
    expect(at(8).lock).toBe('locked');
    // Every locked or freewheel reading is within a frame of true time.
    for (const r of readings) {
      if (r.lock === 'locked' || r.lock === 'freewheel') expect(Math.abs(r.err!)).toBeLessThan(1 / 25);
    }
  });

  it('MTC quarter frames lock and track true time, and a full frame parks', () => {
    const rate: TimecodeRate = 29.97;
    const start = tc(0, 59, 50, 0, rate);
    const parser = new MtcParser();
    const clock = new ChaseClock(3, 2000);
    const t0 = timecodeToSeconds(start);
    let worst = 0;
    for (const msg of mtcQuarterFrameStream(start, 600, 0)) {
      for (const ev of parser.feed(msg.bytes, msg.atMs)) clock.onFrame(ev.seconds, ev.atMs, ev.running);
      const r = clock.read(msg.atMs);
      if (r.lock === 'locked') worst = Math.max(worst, Math.abs(r.seconds! - (t0 + msg.atMs / 1000)));
    }
    expect(clock.read(20_000).lock).not.toBe('searching');
    expect(worst).toBeLessThan(0.01);
    for (const ev of parser.feed(mtcFullFrame(tc(2, 0, 0, 0, rate)), 30_000)) clock.onFrame(ev.seconds, ev.atMs, ev.running);
    expect(clock.read(31_000)).toMatchObject({ lock: 'locked', running: false });
    expect(clock.read(31_000).seconds).toBeCloseTo(timecodeToSeconds(tc(2, 0, 0, 0, rate)), 9);
  });
});

describe('controller and show timeline', () => {
  afterEach(() => {
    timecodeChase.setSink(null);
    timecodeChase.shutdown();
    timecodeChase.settings.set(normalizeTimecodeSettings({}));
    showTimeline._resetForTest();
    setShowCompositionLoader(null);
  });

  it('applies the offset and hands samples to the sink only while a source is set', () => {
    const samples: ChaseSample[] = [];
    timecodeChase.setSink((s) => samples.push(s));
    timecodeChase.settings.set(normalizeTimecodeSettings({ source: 'ltc', offset: 3600 }));
    const label = tc(1, 0, 10, 0, 25);
    for (let i = 0; i < 3; i++) timecodeChase.feed(3610 + i * 0.04, 1000 + i * 40, true, label);
    const s = timecodeChase.step(1100);
    expect(s.lock).toBe('locked');
    expect(s.showTime).toBeCloseTo(10.1, 6);
    expect(samples).toHaveLength(1);
    expect(get(timecodeChase.status)).toMatchObject({ lock: 'locked', running: true, framesReceived: 3 });
  });

  it('the show timeline follows a chased clock and ignores its own transport', () => {
    const loads: string[] = [];
    setShowCompositionLoader((id) => loads.push(id));
    showTimeline.hydrate({
      presetClips: [
        { id: 'a', compositionId: 'A', startTime: 0, duration: 10, transitionIn: 'cut', transitionDuration: 0 },
        { id: 'b', compositionId: 'B', startTime: 10, duration: 10, transitionIn: 'cut', transitionDuration: 0 },
      ],
    });
    showTimeline.chase(5, true);
    expect(get(showTimeline)).toMatchObject({ isPlaying: true, currentTime: 5 });
    expect(loads).toEqual(['A']);
    showTimeline.chase(5.016, true);
    showTimeline.chase(12, true);
    expect(loads).toEqual(['A', 'B']);
    showTimeline.pause();
    showTimeline.play();
    expect(get(showTimeline).isPlaying).toBe(false);
    showTimeline.chase(12.5, true);
    expect(get(showTimeline).isPlaying).toBe(true);
    showTimeline.chase(12.5, false);
    expect(get(showTimeline)).toMatchObject({ isPlaying: false, currentTime: 12.5 });
    showTimeline.releaseChase();
    expect(showTimeline.isChasing()).toBe(false);
  });
});
