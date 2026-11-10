/**
 * Following musical clocks: MIDI clock + Song Position parsing, show time
 * from source beats (bar offset, tempo map), Link phase lock with fake
 * session anchors (start/stop and quantised start), the tempo mismatch rule,
 * and the show's beats on the launch clock.
 */
import { describe, expect, it } from 'vitest';
import {
  LinkFollower,
  MidiClockParser,
  quartersPerBarAt,
  showSecondsForSourceQuarters,
  showTempoAt,
  sourceOriginQuarters,
  tempoMismatch,
} from './beatChase';
import { showBeatAt } from './showLaunchClock';
import { createTempoMap, secondsAtBar } from '../tempoMap';

const spp = (sixteenths: number) => [0xf2, sixteenths & 0x7f, (sixteenths >> 7) & 0x7f];

describe('MIDI clock and Song Position', () => {
  it('locates on Song Position, then Continue rolls from it one 24th of a quarter per tick', () => {
    const p = new MidiClockParser();
    // 66 sixteenths = 16.5 quarters (bar 5 beat 3 + an eighth in 4/4).
    expect(p.feed(spp(66), 100)).toEqual({ kind: 'locate', quarters: 16.5, atMs: 100 });
    expect(p.feed([0xfb], 200)).toBeNull();
    expect(p.isRunning).toBe(true);
    // The first tick after Continue IS the position.
    expect(p.feed([0xf8], 210)).toEqual({ kind: 'tick', quarters: 16.5, atMs: 210 });
    const t2 = p.feed([0xf8], 230.833);
    expect(t2?.kind).toBe('tick');
    expect(t2!.quarters).toBeCloseTo(16.5 + 1 / 24, 9);
    for (let i = 0; i < 23; i++) p.feed([0xf8], 251.666 + i * 20.833);
    // 25 ticks after the position: one quarter and a 24th on.
    expect(p.feed([0xf8], 251.666 + 23 * 20.833)!.quarters).toBeCloseTo(16.5 + 25 / 24, 9);
  });

  it('Start rolls from the top, Stop parks where the clock got to', () => {
    const p = new MidiClockParser();
    p.feed(spp(40), 0);
    p.feed([0xfa], 10);
    expect(p.feed([0xf8], 20)!.quarters).toBe(0);
    for (let i = 1; i <= 48; i++) p.feed([0xf8], 20 + i * 20);
    expect(p.feed([0xfc], 1000)).toEqual({ kind: 'locate', quarters: 2, atMs: 1000 });
    expect(p.isRunning).toBe(false);
    // Ticks while stopped (a free-running clock) only measure the tempo.
    expect(p.feed([0xf8], 1020)).toBeNull();
  });

  it('a Song Position while rolling makes the next tick that position (a loop jump)', () => {
    const p = new MidiClockParser();
    p.feed([0xfa], 0);
    for (let i = 0; i < 10; i++) p.feed([0xf8], i * 20);
    expect(p.feed(spp(16), 205)).toBeNull();
    expect(p.feed([0xf8], 220)!.quarters).toBe(4);
  });

  it('measures the tempo from the tick spacing', () => {
    const p = new MidiClockParser();
    p.feed([0xfa], 0);
    // 126 BPM: 60000 / (126 * 24) ms a tick.
    const tick = 60000 / (126 * 24);
    for (let i = 0; i < 200; i++) p.feed([0xf8], i * tick);
    expect(p.bpm).toBeCloseTo(126, 0);
  });

  it('rides out late, bursty delivery (a busy page sees ticks in clumps)', () => {
    const p = new MidiClockParser();
    p.feed([0xfa], 0);
    const tick = 60000 / (130 * 24);
    // Every 6th tick on time; the rest held back up to 90 ms and released together.
    let prev = 0;
    for (let i = 0; i < 300; i++) {
      const due = 10 + i * tick;
      const late = i % 6 === 0 ? 0 : Math.min(90, (i % 37) * 3);
      // Delivered in order: a held-back tick holds back the ones behind it.
      prev = Math.max(prev, due + late);
      p.feed([0xf8], prev);
    }
    expect(Math.abs(p.bpm! - 130)).toBeLessThan(0.3);
  });

  it('rides out jittery tick delivery', () => {
    const p = new MidiClockParser();
    p.feed([0xfa], 0);
    const tick = 60000 / (124 * 24);
    let seed = 7;
    const jitter = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648 - 0.5) * 4; };
    for (let i = 0; i < 300; i++) p.feed([0xf8], 10 + i * tick + jitter());
    expect(Math.abs(p.bpm! - 124)).toBeLessThan(0.25);
  });

  it('turns source quarters into show time through the map and the bar offset', () => {
    const map = createTempoMap(120, 1.5);
    expect(sourceOriginQuarters(map, 0)).toBe(0);
    expect(showSecondsForSourceQuarters(map, 0, 0)).toBeCloseTo(1.5, 9);
    expect(showSecondsForSourceQuarters(map, 16.5, 0)).toBeCloseTo(1.5 + 16.5 * 0.5, 9);
    // Source bar 1 on show bar 3: two bars (4 s) later.
    expect(showSecondsForSourceQuarters(map, 0, 2)).toBeCloseTo(secondsAtBar(map, 3), 9);
    expect(showSecondsForSourceQuarters(map, 4, 2)).toBeCloseTo(secondsAtBar(map, 4), 9);
    // 6/8: a bar is 3 quarters.
    const six = createTempoMap(120, 0, 6, 8);
    expect(quartersPerBarAt(six, 0)).toBeCloseTo(3, 9);
    expect(showSecondsForSourceQuarters(six, 0, 1)).toBeCloseTo(1.5, 9);
  });
});

describe('tempo mismatch', () => {
  it('warns past half a BPM and not without both tempos', () => {
    expect(tempoMismatch(120, 120.4)).toBe(false);
    expect(tempoMismatch(120, 126)).toBe(true);
    expect(tempoMismatch(null, 126)).toBe(false);
    expect(tempoMismatch(120, null)).toBe(false);
    expect(showTempoAt(createTempoMap(97.5), 10)).toBe(97.5);
  });
});

describe('Link follower (fake session anchors)', () => {
  const map = createTempoMap(120, 0); // bar = 4 quarters = 2 s

  it('start/stop: the bar Link started on becomes the playhead, then phase-locked', () => {
    const f = new LinkFollower();
    const ctx = { map, playhead: 8, mode: 'startStop' as const };
    expect(f.update({ beat: 37.2, tempo: 120, playing: false, atMs: 0 }, ctx)).toEqual({ seconds: 8, running: false, waiting: false });
    // Started on beat 40 (a bar line), first poll sees 40.1.
    const r = f.update({ beat: 40.1, tempo: 120, playing: true, atMs: 50 }, ctx);
    expect(r.running).toBe(true);
    expect(r.seconds).toBeCloseTo(8 + 0.05, 9);
    // From here show quarters track Link beats one for one.
    const r2 = f.update({ beat: 46, tempo: 120, playing: true, atMs: 3000 }, { ...ctx, playhead: 11 });
    expect(r2.seconds).toBeCloseTo(8 + 3, 9);
    // At another session tempo it keeps following (show time runs faster).
    const r3 = f.update({ beat: 52, tempo: 126, playing: true, atMs: 5800 }, ctx);
    expect(r3.seconds).toBeCloseTo(8 + 6, 9);
    // Stop parks the show where its playhead is.
    expect(f.update({ beat: 53, tempo: 126, playing: false, atMs: 6300 }, { ...ctx, playhead: 14.4 })).toEqual({ seconds: 14.4, running: false, waiting: false });
  });

  it('start/stop: joining a session already mid-bar keeps the bar phase', () => {
    const f = new LinkFollower();
    const r = f.update({ beat: 41.5, tempo: 120, playing: true, atMs: 0 }, { map, playhead: 2, mode: 'startStop' });
    // Bar started at beat 40: the show is 1.5 beats into its bar too.
    expect(r.seconds).toBeCloseTo(2 + 0.75, 9);
  });

  it('quantised start: Play waits for the next Link bar, then stays locked; Pause parks', () => {
    const f = new LinkFollower();
    const ctx = { map, playhead: 4, mode: 'quantisedStart' as const };
    // The session runs, but the show ignores it until Play.
    expect(f.update({ beat: 21, tempo: 120, playing: true, atMs: 0 }, ctx).running).toBe(false);
    f.request(true);
    const waiting = f.update({ beat: 21.3, tempo: 120, playing: true, atMs: 150 }, ctx);
    expect(waiting).toEqual({ seconds: 4, running: false, waiting: true });
    expect(f.update({ beat: 23.9, tempo: 120, playing: true, atMs: 1450 }, ctx).running).toBe(false);
    // Next bar is beat 24.
    const go = f.update({ beat: 24.06, tempo: 120, playing: true, atMs: 1530 }, ctx);
    expect(go.running).toBe(true);
    expect(go.seconds).toBeCloseTo(4 + 0.03, 9);
    expect(f.update({ beat: 28, tempo: 120, playing: true, atMs: 3500 }, ctx).seconds).toBeCloseTo(6, 9);
    f.request(false);
    expect(f.update({ beat: 28.5, tempo: 120, playing: true, atMs: 3750 }, { ...ctx, playhead: 6.25 })).toEqual({ seconds: 6.25, running: false, waiting: false });
  });
});

describe('Link follower: show bars on Link bars', () => {
  // Bar 1 at 0.37 s (a detected map: the music starts on a pickup).
  const map = createTempoMap(120, 0.37);
  const barTimes = Array.from({ length: 40 }, (_, i) => secondsAtBar(map, i - 2));
  /** How far show time `t` is from the nearest show bar line, seconds. */
  const offBar = (t: number) => Math.min(...barTimes.map((b) => Math.abs(b - t)));

  it('start/stop from the stopped show (playhead 0, before bar 1): the session bar is show bar 1', () => {
    const f = new LinkFollower();
    const ctx = { map, playhead: 0, mode: 'startStop' as const };
    const r = f.update({ beat: 40.1, tempo: 120, playing: true, atMs: 0 }, ctx);
    // 0.1 beats into Link's bar = 0.05 s into show bar 1.
    expect(r.seconds).toBeCloseTo(0.37 + 0.05, 9);
    // Every later Link bar line is a show bar line.
    for (let beat = 44; beat <= 120; beat += 4) {
      expect(offBar(f.update({ beat, tempo: 120, playing: true, atMs: 0 }, ctx).seconds)).toBeLessThan(1e-9);
    }
  });

  it('start/stop from a playhead off the bar line locks the bar it is in', () => {
    const f = new LinkFollower();
    // Bar 3 beat 2 and a half: 0.37 + 2 bars (4 s) + 0.75 s.
    const playhead = 0.37 + 4 + 0.75;
    const r = f.update({ beat: 80, tempo: 120, playing: true, atMs: 0 }, { map, playhead, mode: 'startStop' });
    expect(r.seconds).toBeCloseTo(0.37 + 4, 9);
    expect(offBar(f.update({ beat: 84, tempo: 120, playing: true, atMs: 0 }, { map, playhead, mode: 'startStop' }).seconds)).toBeLessThan(1e-9);
  });

  it('"Bar 1 of the source" moves where a start from the top lands', () => {
    const f = new LinkFollower();
    const r = f.update({ beat: 8, tempo: 120, playing: true, atMs: 0 }, { map, playhead: 0, mode: 'startStop', barOffset: 4 });
    expect(r.seconds).toBeCloseTo(secondsAtBar(map, 5), 9);
    // A playhead already past it keeps its own bar.
    const g = new LinkFollower();
    const later = secondsAtBar(map, 9) + 0.2;
    expect(g.update({ beat: 8, tempo: 120, playing: true, atMs: 0 }, { map, playhead: later, mode: 'startStop', barOffset: 4 }).seconds).toBeCloseTo(secondsAtBar(map, 9), 9);
  });

  it('a playhead a hair before a bar line counts as on it', () => {
    const f = new LinkFollower();
    const r = f.update({ beat: 4, tempo: 120, playing: true, atMs: 0 }, { map, playhead: secondsAtBar(map, 7) - 0.01, mode: 'startStop' });
    expect(r.seconds).toBeCloseTo(secondsAtBar(map, 7), 9);
  });

  it('quantised start from an off-bar playhead starts on a show bar at the next Link bar', () => {
    const f = new LinkFollower();
    const ctx = { map, playhead: 0, mode: 'quantisedStart' as const };
    f.request(true);
    expect(f.update({ beat: 21.3, tempo: 120, playing: true, atMs: 0 }, ctx).waiting).toBe(true);
    const go = f.update({ beat: 24.06, tempo: 120, playing: true, atMs: 0 }, ctx);
    expect(go.running).toBe(true);
    expect(go.seconds).toBeCloseTo(0.37 + 0.03, 9);
  });

  it('reads Link against the show bar length (6/8 = 3 quarters), and keeps the locked quantum', () => {
    const six8 = createTempoMap(120, 0, 6, 8);
    const f = new LinkFollower();
    const ctx = { map: six8, playhead: 0, mode: 'startStop' as const };
    expect(f.quantum(ctx)).toBe(3);
    // Beat 31 read against quantum 3: the bar started at beat 30.
    const r = f.update({ beat: 31, tempo: 120, playing: true, atMs: 0, quantum: 3 }, ctx);
    expect(r.seconds).toBeCloseTo(0.5, 9);
    expect(f.quantum({ ...ctx, playhead: 99 })).toBe(3);
  });
});

describe('show beats for the launch clock', () => {
  it('runs on from the last published playhead, at most a quarter second', () => {
    const map = createTempoMap(100, 0.3);
    const anchor = { t: 3.3, at: 1000, map };
    // 3 s after bar 1 at 100 BPM = 5 quarters.
    expect(showBeatAt(anchor, 1000)).toEqual({ beat: 5, bpm: 100 });
    expect(showBeatAt(anchor, 1060)!.beat).toBeCloseTo(5.1, 9);
    expect(showBeatAt(anchor, 5000)!.beat).toBeCloseTo(5 + (0.25 * 100) / 60, 9);
    expect(showBeatAt(null, 1000)).toBeNull();
  });
});
