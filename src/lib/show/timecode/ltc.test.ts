/**
 * LTC decode proof.
 *
 * Every test renders a real biphase-mark PCM stream with the encoder, feeds
 * it to the decoder in AudioWorklet-sized blocks, and demands EVERY frame of
 * a 60 second window back, in order, with the right label and an end time
 * within a sample or two of where the encoder put it. Two frames of pre-roll
 * come first, the way any real source is already running when the input
 * opens: the decoder has to see a whole 80-bit word before it can report
 * one. One frame of post-roll follows, because a frame is only known to be
 * finished when the next one's first edge arrives.
 */

import { describe, expect, it } from 'vitest';
import {
  LtcDecoder,
  encodeLtcFrameBits,
  generateLtc,
  ltcFrameToTimecode,
  type LtcFrame,
  type LtcGenerateOptions,
} from './ltc';
import {
  actualFps,
  formatTimecode,
  frameNumberToTimecode,
  timecodeToFrameNumber,
  type Timecode,
  type TimecodeRate,
} from './timecode';

const PREROLL = 2;
/** A frame is only complete when the next one's first edge arrives, so the
 *  source keeps running one frame past the window. */
const POSTROLL = 1;

function tc(h: number, m: number, s: number, f: number, rate: TimecodeRate, dropFrame = rate === 29.97): Timecode {
  return { hours: h, minutes: m, seconds: s, frames: f, rate, dropFrame };
}

/** Decode in 128-sample blocks, like an AudioWorklet render quantum. */
function decode(samples: Float32Array, sampleRate: number, block = 128): LtcFrame[] {
  const decoder = new LtcDecoder(sampleRate);
  const frames: LtcFrame[] = [];
  for (let i = 0; i < samples.length; i += block) {
    frames.push(...decoder.process(samples.subarray(i, Math.min(samples.length, i + block))));
  }
  return frames;
}

interface Run {
  start: Timecode;
  seconds: number;
  sampleRate: number;
  extra?: Partial<LtcGenerateOptions>;
  block?: number;
  /** Allowed error on each frame's end time, samples. */
  tolerance?: number;
}

/**
 * Render `seconds` of LTC from `start` (plus pre-roll), decode, and assert
 * that every frame in the window came back exactly once, in order.
 */
function expectEveryFrame({ start, seconds, sampleRate, extra = {}, block, tolerance = 1.5 }: Run) {
  const fps = actualFps(start.rate);
  const frameCount = Math.round(seconds * fps);
  const firstNumber = timecodeToFrameNumber(start) - PREROLL;
  const genStart = frameNumberToTimecode(firstNumber, start.rate, start.dropFrame);
  const lead = extra.leadInSamples ?? 0;
  const pcm = generateLtc({ start: genStart, frameCount: PREROLL + frameCount + POSTROLL, sampleRate, ...extra });
  const frames = decode(pcm, sampleRate, block);

  const samplesPerFrame = sampleRate / (fps * (extra.speed ?? 1));
  // Keyed by frame number within the day, so a window across midnight works.
  const perDay = timecodeToFrameNumber({ hours: 23, minutes: 59, seconds: 59, frames: start.rate === 29.97 ? 29 : start.rate - 1, rate: start.rate, dropFrame: start.dropFrame }) + 1;
  const dayNumber = (n: number) => ((n % perDay) + perDay) % perDay;
  const wanted = new Map<number, number>();
  for (let k = 0; k < frameCount; k++) wanted.set(dayNumber(firstNumber + PREROLL + k), PREROLL + k);

  const got: number[] = [];
  for (const f of frames) {
    const label = ltcFrameToTimecode(f, start.rate);
    const n = timecodeToFrameNumber(label);
    const index = wanted.get(n);
    if (index === undefined) continue;
    got.push(n);
    // The frame ends where the next frame's first bit starts.
    const expectedEnd = lead + (index + 1) * samplesPerFrame;
    expect(Math.abs(f.endSample - expectedEnd), `end of ${formatTimecode(label)}`).toBeLessThan(tolerance);
    expect(f.dropFrame).toBe(start.dropFrame);
  }
  const missing = [...wanted.keys()].filter((n) => !got.includes(n));
  expect(missing.map((n) => formatTimecode(frameNumberToTimecode(n, start.rate, start.dropFrame))).slice(0, 5)).toEqual([]);
  expect(got.length).toBe(frameCount);
  for (let i = 1; i < got.length; i++) expect(got[i]).toBe(dayNumber(got[i - 1] + 1));
  return frames;
}

describe('LTC frame bits', () => {
  it('lays out BCD fields, the DF flag and the sync word', () => {
    const bits = encodeLtcFrameBits(tc(12, 34, 56, 27, 29.97));
    const read = (o: number, c: number) => {
      let v = 0;
      for (let i = 0; i < c; i++) v |= bits[o + i] << i;
      return v;
    };
    expect(read(0, 4)).toBe(7);
    expect(read(8, 2)).toBe(2);
    expect(bits[10]).toBe(1);
    expect(read(16, 4)).toBe(6);
    expect(read(24, 3)).toBe(5);
    expect(read(32, 4)).toBe(4);
    expect(read(40, 3)).toBe(3);
    expect(read(48, 4)).toBe(2);
    expect(read(56, 2)).toBe(1);
    expect(Array.from(bits.slice(64))).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
  });

  it('sets the polarity bit so every frame has an even number of zeros', () => {
    for (const rate of [24, 25, 29.97, 30] as TimecodeRate[]) {
      for (let n = 0; n < 300; n += 7) {
        const bits = encodeLtcFrameBits(frameNumberToTimecode(n * 131, rate, rate === 29.97));
        const zeros = bits.reduce((z, b) => z + (b === 0 ? 1 : 0), 0);
        expect(zeros % 2).toBe(0);
      }
    }
  });
});

describe('LTC decode, 60 seconds, every frame', () => {
  it('24 fps at 48 kHz', () => {
    const frames = expectEveryFrame({ start: tc(1, 0, 0, 0, 24), seconds: 60, sampleRate: 48000 });
    expect(frames.at(-1)!.rate).toBe(24);
  });

  it('25 fps at 48 kHz', () => {
    const frames = expectEveryFrame({ start: tc(10, 59, 30, 0, 25), seconds: 60, sampleRate: 48000 });
    expect(frames.at(-1)!.rate).toBe(25);
  });

  it('30 fps at 48 kHz', () => {
    const frames = expectEveryFrame({ start: tc(0, 0, 0, 0, 30, false), seconds: 60, sampleRate: 48000 });
    expect(frames.at(-1)!.rate).toBe(30);
  });

  it('29.97 drop-frame across dropped labels and a tenth minute, at 48 kHz', () => {
    // 00:00:30;00 to 00:01:30;00 crosses 00:01:00;02 (00 and 01 dropped).
    const frames = expectEveryFrame({ start: tc(0, 0, 30, 0, 29.97), seconds: 60, sampleRate: 48000 });
    const labels = frames.map((f) => formatTimecode(ltcFrameToTimecode(f, 29.97)));
    expect(labels).toContain('00:00:59;29');
    expect(labels).toContain('00:01:00;02');
    expect(labels).not.toContain('00:01:00;00');
    expect(labels).not.toContain('00:01:00;01');
    expect(frames.at(-1)!.rate).toBe(29.97);
  });

  it('29.97 drop-frame keeps 00 and 01 on a tenth minute, at 44.1 kHz', () => {
    const frames = expectEveryFrame({ start: tc(0, 9, 30, 0, 29.97), seconds: 60, sampleRate: 44100 });
    const labels = frames.map((f) => formatTimecode(ltcFrameToTimecode(f, 29.97)));
    expect(labels).toContain('00:10:00;00');
    expect(labels).toContain('00:10:00;01');
    expect(labels).not.toContain('00:11:00;00');
  });

  it('every rate at 44.1 kHz and 96 kHz', () => {
    for (const sampleRate of [44100, 96000]) {
      for (const rate of [24, 25, 29.97, 30] as TimecodeRate[]) {
        expectEveryFrame({ start: tc(23, 59, 50, 0, rate), seconds: 20, sampleRate });
      }
    }
  });

  it('wraps from 23:59:59 to 00:00:00', () => {
    const frames = expectEveryFrame({ start: tc(23, 59, 59, 0, 25), seconds: 4, sampleRate: 48000 });
    const labels = frames.map((f) => formatTimecode(ltcFrameToTimecode(f, 25)));
    expect(labels).toContain('23:59:59:24');
    expect(labels).toContain('00:00:00:00');
  });
});

describe('LTC decode survives a bad line', () => {
  it('Gaussian noise at about 14 dB SNR with a real rise time, 29.97 DF', () => {
    expectEveryFrame({
      start: tc(2, 0, 0, 0, 29.97),
      seconds: 60,
      sampleRate: 48000,
      extra: { amplitude: 0.5, noise: 0.1, seed: 7, riseSamples: 2 },
      tolerance: 4,
    });
  });

  it('heavy noise at about 8 dB SNR, 25 fps', () => {
    expectEveryFrame({
      start: tc(0, 0, 0, 0, 25),
      seconds: 60,
      sampleRate: 48000,
      extra: { amplitude: 0.5, noise: 0.2, seed: 11 },
      tolerance: 4,
    });
  });

  it('level ramps and 30 dB steps, both directions, 30 fps', () => {
    // Slow fade 1.0 -> 0.03 -> 1.0 over the first 20 s, then hard steps
    // every 3.3 s between 0.9, 0.03 and 0.3 at arbitrary sample positions.
    const amplitude = (t: number) => {
      if (t < 20) return 0.03 + 0.97 * Math.abs(Math.cos((Math.PI * t) / 20));
      const step = Math.floor((t - 20) / 3.3) % 3;
      return [0.9, 0.03, 0.3][step];
    };
    expectEveryFrame({
      start: tc(0, 30, 0, 0, 30, false),
      seconds: 60,
      sampleRate: 48000,
      extra: { amplitude, noise: 0.002, seed: 3 },
      tolerance: 2.5,
    });
  });

  it('level steps with noise and a DC offset, 24 fps', () => {
    const amplitude = (t: number) => (Math.floor(t / 1.7) % 2 === 0 ? 0.6 : 0.06);
    expectEveryFrame({
      start: tc(5, 5, 5, 5, 24),
      seconds: 60,
      sampleRate: 48000,
      extra: { amplitude, noise: 0.01, seed: 5, dcOffset: 0.2, riseSamples: 1.5 },
      tolerance: 2,
    });
  });

  it('a deck running 3% fast or slow still decodes every frame', () => {
    for (const speed of [0.97, 1.03]) {
      expectEveryFrame({ start: tc(0, 1, 0, 0, 25), seconds: 20, sampleRate: 48000, extra: { speed } });
    }
  });

  it('odd block sizes do not lose frames at block edges', () => {
    expectEveryFrame({ start: tc(0, 0, 10, 0, 29.97), seconds: 20, sampleRate: 48000, block: 37 });
    expectEveryFrame({ start: tc(0, 0, 10, 0, 29.97), seconds: 20, sampleRate: 48000, block: 1 });
  });

  it('reports nothing for silence or noise alone, and recovers after a dropout', () => {
    const decoder = new LtcDecoder(48000);
    expect(decoder.process(new Float32Array(48000))).toEqual([]);
    const noise = generateLtc({ start: tc(0, 0, 0, 0, 25), frameCount: 0, sampleRate: 48000, noise: 0.3, leadInSamples: 48000 });
    expect(decoder.process(noise)).toEqual([]);

    const a = generateLtc({ start: tc(0, 0, 0, 0, 25), frameCount: 50, sampleRate: 48000 });
    const b = generateLtc({ start: tc(0, 0, 10, 0, 25), frameCount: 50, sampleRate: 48000 });
    const first = decoder.process(a);
    decoder.process(new Float32Array(24000)); // half a second of nothing
    const second = decoder.process(b);
    expect(first.length).toBeGreaterThanOrEqual(48);
    expect(second.length).toBeGreaterThanOrEqual(48);
    // The last generated frame (11:24) has no successor, so 11:23 is the
    // last one that can be known complete.
    expect(formatTimecode(ltcFrameToTimecode(second.at(-1)!, 25))).toBe('00:00:11:23');
  });
});
