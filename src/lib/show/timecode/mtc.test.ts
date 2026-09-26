/**
 * MTC parsing proof, with generated quarter-frame streams and full-frame
 * locates at every rate the wire format has a code for.
 */

import { describe, expect, it } from 'vitest';
import { MtcParser, mtcFullFrame, mtcQuarterFrameStream, mtcQuarterFrames, type MtcEvent } from './mtc';
import {
  actualFps,
  formatTimecode,
  frameNumberToTimecode,
  timecodeToFrameNumber,
  timecodeToSeconds,
  type Timecode,
  type TimecodeRate,
} from './timecode';

function tc(h: number, m: number, s: number, f: number, rate: TimecodeRate): Timecode {
  return { hours: h, minutes: m, seconds: s, frames: f, rate, dropFrame: rate === 29.97 };
}

function run(parser: MtcParser, start: Timecode, frames: number, startMs = 0): MtcEvent[] {
  const events: MtcEvent[] = [];
  for (const msg of mtcQuarterFrameStream(start, frames, startMs)) events.push(...parser.feed(msg.bytes, msg.atMs));
  return events;
}

describe('MTC quarter frames', () => {
  for (const rate of [24, 25, 29.97, 30] as TimecodeRate[]) {
    it(`assembles every label of a 60 s stream at ${rate}`, () => {
      const start = tc(1, 0, 59, 0, rate);
      const frameCount = Math.round(60 * actualFps(rate)) & ~1;
      const events = run(new MtcParser(), start, frameCount, 1000);
      // One complete label per two frames, all of them.
      expect(events.length).toBe(frameCount / 2);
      const first = timecodeToFrameNumber(start);
      events.forEach((ev, i) => {
        expect(ev.kind).toBe('quarter-frame');
        expect(ev.running).toBe(true);
        expect(ev.timecode.rate).toBe(rate);
        expect(ev.timecode.dropFrame).toBe(rate === 29.97);
        expect(timecodeToFrameNumber(ev.timecode)).toBe(first + i * 2);
        // Piece 7 lands 1.75 frames after the labelled frame starts; the
        // reported seconds must be the show clock at that instant.
        const frameMs = 1000 / actualFps(rate);
        const expectedAt = 1000 + (i * 2 + 1.75) * frameMs;
        expect(ev.atMs).toBeCloseTo(expectedAt, 6);
        expect(ev.seconds).toBeCloseTo(timecodeToSeconds(ev.timecode) + 1.75 / actualFps(rate), 9);
      });
    });
  }

  it('reads hours above 15 through the piece-7 high bit', () => {
    const [ev] = run(new MtcParser(), tc(23, 59, 58, 10, 25), 2);
    expect(formatTimecode(ev.timecode)).toBe('23:59:58:10');
  });

  it('crosses drop-frame minute labels', () => {
    const start = tc(0, 0, 59, 26, 29.97);
    const events = run(new MtcParser(), start, 8);
    expect(events.map((e) => formatTimecode(e.timecode))).toEqual([
      '00:00:59;26',
      '00:00:59;28',
      '00:01:00;02',
      '00:01:00;04',
    ]);
  });

  it('ignores a scrambled or reversed run and resumes on the next piece 0', () => {
    const parser = new MtcParser();
    const qf = mtcQuarterFrames(tc(0, 0, 10, 0, 25));
    // Reverse order (tape rewinding) never completes a label.
    for (const m of [...qf].reverse()) expect(parser.feed(m, 0)).toEqual([]);
    // A dropped piece in the middle poisons that word only.
    for (const [i, m] of qf.entries()) if (i !== 3) expect(parser.feed(m, 0)).toEqual([]);
    const events: MtcEvent[] = [];
    for (const m of mtcQuarterFrames(tc(0, 0, 10, 2, 25))) events.push(...parser.feed(m, 5));
    expect(events.map((e) => formatTimecode(e.timecode))).toEqual(['00:00:10:02']);
  });

  it('accepts messages batched into one packet with realtime bytes between them', () => {
    const parser = new MtcParser();
    const bytes = mtcQuarterFrames(tc(4, 3, 2, 1, 30)).flatMap((m) => [0xf8, ...m]);
    const events = parser.feed(bytes, 42);
    expect(events).toHaveLength(1);
    expect(formatTimecode(events[0].timecode)).toBe('04:03:02:01');
  });

  it('rejects out-of-range labels', () => {
    const parser = new MtcParser();
    const bad = mtcQuarterFrames({ hours: 1, minutes: 2, seconds: 3, frames: 27, rate: 25, dropFrame: false });
    expect(bad.flatMap((m) => parser.feed(m, 0))).toEqual([]);
  });
});

describe('MTC full frames', () => {
  it('parses a locate at every rate as a non-running event', () => {
    for (const rate of [24, 25, 29.97, 30] as TimecodeRate[]) {
      const parser = new MtcParser();
      const label = tc(12, 34, 56, rate === 24 ? 23 : 7, rate);
      const events = parser.feed(mtcFullFrame(label), 99);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('full-frame');
      expect(events[0].running).toBe(false);
      expect(events[0].timecode).toEqual(label);
      expect(events[0].seconds).toBeCloseTo(timecodeToSeconds(label), 9);
    }
  });

  it('accepts a specific device id, skips other SysEx and survives a split packet', () => {
    const parser = new MtcParser();
    const other = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]; // identity request
    expect(parser.feed(other, 0)).toEqual([]);
    const msg = mtcFullFrame(tc(0, 10, 0, 0, 29.97), 0x12);
    expect(parser.feed(msg.slice(0, 4), 0)).toEqual([]);
    const events = parser.feed(msg.slice(4), 1);
    expect(events.map((e) => formatTimecode(e.timecode))).toEqual(['00:10:00;00']);
  });

  it('a locate in the middle of a quarter-frame word discards the partial word', () => {
    const parser = new MtcParser();
    const qf = mtcQuarterFrames(tc(0, 0, 1, 0, 25));
    for (const m of qf.slice(0, 4)) parser.feed(m, 0);
    parser.feed(mtcFullFrame(tc(0, 5, 0, 0, 25)), 1);
    expect(qf.slice(4).flatMap((m) => parser.feed(m, 2))).toEqual([]);
  });

  it('round-trips generated labels for a whole DF hour', () => {
    const parser = new MtcParser();
    for (let n = 0; n < 107892; n += 997) {
      const label = frameNumberToTimecode(n, 29.97, true);
      const [ev] = parser.feed(mtcFullFrame(label), 0);
      expect(timecodeToFrameNumber(ev.timecode)).toBe(n);
    }
  });
});
