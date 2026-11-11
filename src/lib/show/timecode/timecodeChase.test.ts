/**
 * Chase clock: lock, jump, dropout, freewheel, lost and parked, fed both by
 * hand and by the real LTC decoder and MTC parser; and the show timeline
 * following it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { ChaseClock, normalizeTimecodeSettings, timecodeChase, type ChaseSample } from './timecodeChase';
import { LtcDecoder, generateLtc } from './ltc';
import { MtcParser, mtcFullFrame, mtcQuarterFrameStream } from './mtc';
import { actualFps, timecodeToSeconds, type Timecode, type TimecodeRate } from './timecode';
import { showTimeline, setShowCompositionLoader, setShowChaseTransportHandler } from '../../stores/showTimeline';
import { MidiClockParser, showSecondsForSourceQuarters } from '../sync/beatChase';
import { createTempoMap } from '../tempoMap';
import { clipAudioBus, computeClipAudioDrift, type ClipAudioTransport } from '../../audio/clipAudioBus';

function tc(h: number, m: number, s: number, f: number, rate: TimecodeRate): Timecode {
  return { hours: h, minutes: m, seconds: s, frames: f, rate, dropFrame: rate === 29.97 };
}

describe('ChaseClock', () => {
  it('a locate while rolling and then silence ends lost, not searching for ever', () => {
    const c = new ChaseClock(3, 2000);
    let t = 0;
    for (let i = 0; i < 50; i++) { c.onFrame(10 + i * 0.04, t); t += 40; }
    expect(c.read(t).lock).toBe('locked');
    c.onFrame(100, t); t += 40;
    c.onFrame(100.04, t); t += 40;
    expect(c.read(t + 500).lock).toBe('searching');
    expect(c.read(t + 60000)).toMatchObject({ lock: 'lost', seconds: null, running: false });
  });

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
    // The rolling source owns the transport: Pause and Stop leave it
    // playing (they used to stop it for one tick, then restart it with a
    // hard seek of the audio and every video).
    const gen = showTimeline.seekGeneration();
    showTimeline.pause();
    showTimeline.stop();
    showTimeline.play();
    expect(get(showTimeline)).toMatchObject({ isPlaying: true, currentTime: 12 });
    showTimeline.chase(12.016, true);
    expect(get(showTimeline).isPlaying).toBe(true);
    expect(showTimeline.seekGeneration()).toBe(gen);
    showTimeline.chase(12.5, false);
    expect(get(showTimeline)).toMatchObject({ isPlaying: false, currentTime: 12.5 });
    showTimeline.releaseChase();
    expect(showTimeline.isChasing()).toBe(false);
  });

  it('keeps the musical-clock settings and refuses junk', () => {
    expect(normalizeTimecodeSettings({ source: 'link', linkMode: 'quantisedStart', barOffset: 4.4 })).toMatchObject({ source: 'link', linkMode: 'quantisedStart', barOffset: 4 });
    expect(normalizeTimecodeSettings({ source: 'midiClock' })).toMatchObject({ source: 'midiClock', linkMode: 'startStop', barOffset: 0 });
    expect(normalizeTimecodeSettings({ source: 'osc', linkMode: 'x', barOffset: 'y' })).toMatchObject({ source: 'off', linkMode: 'startStop', barOffset: 0 });
  });

  it('MIDI clock + Song Position chase the show through its map, and name both tempos when they differ', () => {
    const map = createTempoMap(120, 0.5);
    showTimeline.hydrate({ presetClips: [{ id: 'a', compositionId: 'A', startTime: 0, duration: 60, transitionIn: 'cut', transitionDuration: 0 }] });
    timecodeChase.setShowContext(() => ({ map, playhead: get(showTimeline).currentTime, playing: get(showTimeline).isPlaying }));
    timecodeChase.setSink((sample) => {
      if (sample.showTime !== null && (sample.lock === 'locked' || sample.lock === 'freewheel')) showTimeline.chase(sample.showTime, sample.running);
    });
    timecodeChase.settings.set(normalizeTimecodeSettings({ source: 'midiClock' }));
    const parser = new MidiClockParser();
    const feed = (bytes: number[], at: number) => {
      const ev = parser.feed(bytes, at);
      if (ev) timecodeChase.feedBeats(showSecondsForSourceQuarters(map, ev.quarters, 0), ev.atMs, ev.kind === 'tick', parser.bpm);
    };
    // Locate to bar 3 (32 sixteenths = 8 quarters): parked at 0.5 + 4 s.
    feed([0xf2, 32, 0], 0);
    timecodeChase.step(5);
    expect(get(showTimeline)).toMatchObject({ isPlaying: false, currentTime: 4.5 });
    // Continue at 126 BPM against the map's 120.
    feed([0xfb], 10);
    const tick = 60000 / (126 * 24);
    let at = 20;
    for (let i = 0; i < 96; i++, at += tick) feed([0xf8], at);
    // Read at the last tick.
    timecodeChase.step(at - tick);
    const st = get(showTimeline);
    expect(st.isPlaying).toBe(true);
    // 95 ticks after the position = 95/24 quarters, at the map's 0.5 s a quarter.
    expect(st.currentTime).toBeCloseTo(4.5 + (95 / 24) * 0.5, 2);
    const status = get(timecodeChase.status);
    expect(status.sourceBpm).toBeCloseTo(126, 0);
    expect(status.showBpm).toBe(120);
    expect(status.mismatch).toBe(true);
    expect(status.label).toBe('3.4');
    timecodeChase.setShowContext(null);
  });

  it('while chasing, the show transport asks the source first (Link quantised start)', () => {
    const ops: string[] = [];
    setShowChaseTransportHandler((op) => { ops.push(op); return true; });
    showTimeline.hydrate({ presetClips: [{ id: 'a', compositionId: 'A', startTime: 0, duration: 20, transitionIn: 'cut', transitionDuration: 0 }] });
    showTimeline.play();
    expect(ops).toEqual([]);
    showTimeline.pause();
    showTimeline.chase(3, false);
    showTimeline.play();
    showTimeline.pause();
    showTimeline.stop();
    expect(ops).toEqual(['play', 'pause', 'stop']);
    setShowChaseTransportHandler(null);
  });
});

describe('following a musical clock', () => {
  const map = createTempoMap(120, 0.5);
  const tick = (bpm: number) => 60000 / (bpm * 24);
  let parser: MidiClockParser;
  const feed = (bytes: number[], at: number) => {
    const ev = parser.feed(bytes, at);
    if (ev) timecodeChase.feedBeats(showSecondsForSourceQuarters(map, ev.quarters, 0), ev.atMs, ev.kind === 'tick', parser.bpm);
  };
  const setup = (extra: Record<string, unknown> = {}) => {
    parser = new MidiClockParser();
    showTimeline.hydrate({ presetClips: [{ id: 'a', compositionId: 'A', startTime: 0, duration: 120, transitionIn: 'cut', transitionDuration: 0 }], ...extra });
    timecodeChase.setShowContext(() => ({ map, playhead: get(showTimeline).currentTime, playing: get(showTimeline).isPlaying }));
    timecodeChase.setSink((sample) => {
      if (sample.showTime !== null && (sample.lock === 'locked' || sample.lock === 'freewheel')) showTimeline.chase(sample.showTime, sample.running, sample.rate);
    });
    timecodeChase.settings.set(normalizeTimecodeSettings({ source: 'midiClock' }));
  };
  afterEach(() => {
    timecodeChase.setSink(null);
    timecodeChase.setShowContext(null);
    timecodeChase.shutdown();
    timecodeChase.settings.set(normalizeTimecodeSettings({}));
    showTimeline._resetForTest();
    vi.restoreAllMocks();
    delete (globalThis as { document?: unknown }).document;
  });

  it('parked: the user can move the playhead, and only a new locate moves it back', () => {
    setup();
    feed([0xf2, 32, 0], 0); // bar 3
    timecodeChase.step(5);
    expect(get(showTimeline).currentTime).toBeCloseTo(4.5, 9);
    showTimeline.seek(10);
    for (let at = 21; at < 500; at += 16) timecodeChase.step(at);
    expect(get(showTimeline).currentTime).toBe(10);
    showTimeline.stop();
    for (let at = 500; at < 700; at += 16) timecodeChase.step(at);
    expect(get(showTimeline)).toMatchObject({ currentTime: 0, isPlaying: false });
    // The DAW locates somewhere new: the show follows.
    feed([0xf2, 64, 0], 710); // bar 5
    timecodeChase.step(712);
    expect(get(showTimeline).currentTime).toBeCloseTo(8.5, 9);
  });

  it('a chased time before 0 or past a looping show\'s end is not a jump every tick', () => {
    showTimeline.hydrate({ loop: true, presetClips: [{ id: 'a', compositionId: 'A', startTime: 0, duration: 10, transitionIn: 'cut', transitionDuration: 0 }] });
    expect(get(showTimeline).loop).toBe(true);
    // Link locked on bar 0 of a map with a pickup: show time starts negative.
    showTimeline.chase(-1, true);
    const gen = showTimeline.seekGeneration();
    for (let t = -1; t < 0; t += 0.016) showTimeline.chase(t, true);
    expect(showTimeline.seekGeneration()).toBe(gen);
    // A source that runs on past the loop end (show time unwrapped).
    for (let t = 0; t < 14; t += 0.016) showTimeline.chase(t, true);
    // One wrap is one jump at most, not one per tick.
    expect(showTimeline.seekGeneration() - gen).toBeLessThanOrEqual(1);
    expect(get(showTimeline).currentTime).toBeCloseTo(14 - 10, 1);
  });

  it('at another tempo the song plays at source / map tempo with no seek storm', () => {
    // A fake document: the show wires one element per audio track to the bus.
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ dataset: {}, pause() {}, removeAttribute() {}, load() {} }),
    };
    const providers: Array<() => ClipAudioTransport | null> = [];
    vi.spyOn(clipAudioBus, 'attachClip').mockImplementation((_id, _el, opts) => {
      if (opts?.provider) providers.push(opts.provider);
      return true;
    });
    vi.spyOn(clipAudioBus, 'detachClip').mockImplementation(() => {});
    vi.spyOn(clipAudioBus, 'resume').mockImplementation(() => {});
    setup({ audioTracks: [{ id: 't', url: 'song.mp3', name: 'Song', startTime: 0, duration: 120, offset: 0, sourceDuration: 120, volume: 1, muted: false }] });
    // Continue from bar 3 at 132 BPM against the map's 120: 10% fast.
    feed([0xf2, 32, 0], 0);
    feed([0xfb], 1);
    const bpm = 132;
    let nextTick = 10;
    let elementTime = 0;
    let elementRate = 1;
    let lastGen = -1;
    let seeks = 0;
    let worstDrift = 0;
    let lastFrame = 0;
    for (let at = 10; at < 20000; at += 1) {
      while (nextTick <= at) {
        feed([0xf8], nextTick);
        nextTick += tick(bpm);
      }
      if (at - lastFrame < 16) continue;
      elementTime += ((at - lastFrame) / 1000) * elementRate;
      lastFrame = at;
      timecodeChase.step(at);
      const provider = providers[0];
      const transport = provider?.();
      if (!transport || transport.paused) continue;
      const generationChanged = transport.seekGeneration !== lastGen;
      lastGen = transport.seekGeneration;
      const c = computeClipAudioDrift({ authorityTime: transport.timeSeconds, elementTime, baseRate: transport.playbackRate, forceSeek: generationChanged });
      if (c.seekTo !== null) {
        elementTime = c.seekTo;
        if (at > 3000) seeks++;
      }
      elementRate = c.playbackRate;
      if (at > 3000) worstDrift = Math.max(worstDrift, Math.abs(c.drift));
    }
    expect(seeks).toBe(0);
    expect(worstDrift).toBeLessThan(0.03);
    // The song runs at the source's tempo over the map's.
    expect(providers[0]!()!.playbackRate).toBeCloseTo(132 / 120, 2);
  });
});

