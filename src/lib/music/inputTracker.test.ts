import { describe, expect, it } from 'vitest';
import { InputTracker, detectPitch, gateDb, hzToMidi, rmsDb } from './inputTracker';
import { channelAudible, formatDb, formatPan, meterLevel, normalizeMixer, normalizeStrip } from './mixer';

const SR = 48000;
const BLOCK = 2048;

function tone(hz: number, amp: number, offset = 0, harmonics = true): Float32Array {
  const out = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    const t = (offset + i) / SR;
    let v = Math.sin(2 * Math.PI * hz * t);
    if (harmonics) v += 0.5 * Math.sin(4 * Math.PI * hz * t) + 0.25 * Math.sin(6 * Math.PI * hz * t);
    out[i] = amp * v * (harmonics ? 0.57 : 1);
  }
  return out;
}

const silence = () => new Float32Array(BLOCK);

describe('detectPitch', () => {
  it.each([82.41, 110, 196, 440, 987.8])('finds %f Hz', (hz) => {
    const p = detectPitch(tone(hz, 0.5), SR);
    expect(p).not.toBeNull();
    expect(Math.abs(12 * Math.log2(p!.hz / hz))).toBeLessThan(0.3);
  });

  it('gives nothing for noise', () => {
    const noise = new Float32Array(BLOCK);
    let seed = 1;
    for (let i = 0; i < BLOCK; i++) {
      seed = (seed * 16807) % 2147483647;
      noise[i] = seed / 2147483647 - 0.5;
    }
    expect(detectPitch(noise, SR)).toBeNull();
  });

  it('maps to MIDI', () => {
    expect(hzToMidi(440)).toBe(69);
    expect(hzToMidi(82.41)).toBe(40);
  });
});

describe('InputTracker', () => {
  const frame = 1 / 60;

  it('plays a note on a pluck and lets it go when it dies away', () => {
    const t = new InputTracker({ sensitivity: 0.5 });
    expect(t.step(silence(), SR, 0)).toEqual([]);
    const on = t.step(tone(110, 0.4), SR, frame);
    expect(on).toEqual([{ type: 'on', note: 45, velocity: expect.any(Number) }]);
    expect(on[0].velocity).toBeGreaterThan(0.3);
    // Held: nothing new.
    expect(t.step(tone(110, 0.35, BLOCK), SR, 2 * frame)).toEqual([]);
    const off = t.step(silence(), SR, 3 * frame);
    expect(off).toEqual([{ type: 'off', note: 45, velocity: 0 }]);
  });

  it('hears a second pluck of the same note as a new hit', () => {
    const t = new InputTracker({ sensitivity: 0.5 });
    t.step(silence(), SR, 0);
    t.step(tone(196, 0.4), SR, frame);
    // Decays well under the first hit, then a fresh pluck.
    for (let i = 2; i < 10; i++) expect(t.step(tone(196, 0.4 * Math.pow(0.85, i)), SR, i * frame)).toEqual([]);
    const again = t.step(tone(196, 0.4), SR, 10 * frame);
    expect(again.map((e) => e.type)).toEqual(['off', 'on']);
  });

  it('follows a slide to a new pitch once it holds', () => {
    const t = new InputTracker({ sensitivity: 0.5 });
    t.step(silence(), SR, 0);
    t.step(tone(220, 0.4), SR, frame);
    expect(t.step(tone(247, 0.4), SR, 2 * frame)).toEqual([]);
    const slid = t.step(tone(247, 0.4), SR, 3 * frame);
    expect(slid.map((e) => [e.type, e.note])).toEqual([['off', 57], ['on', 59]]);
  });

  it('ignores playing under the gate', () => {
    const t = new InputTracker({ sensitivity: 0 });
    t.step(silence(), SR, 0);
    expect(t.step(tone(220, 0.01), SR, frame)).toEqual([]);
    expect(rmsDb(tone(220, 0.01))).toBeLessThan(gateDb(0));
    // More sensitive, the same playing counts.
    const s = new InputTracker({ sensitivity: 1 });
    s.step(silence(), SR, 0);
    expect(s.step(tone(220, 0.01), SR, frame).map((e) => e.type)).toEqual(['on']);
  });

  it('reset lets a held note go', () => {
    const t = new InputTracker({ sensitivity: 0.5 });
    t.step(silence(), SR, 0);
    t.step(tone(330, 0.4), SR, frame);
    expect(t.reset()).toEqual([{ type: 'off', note: 64, velocity: 0 }]);
    expect(t.reset()).toEqual([]);
  });
});

describe('mixer', () => {
  it('fills and clamps a saved strip', () => {
    expect(normalizeStrip({ low: 40, mid: 'x', pan: -3, mute: true })).toEqual({ low: 15, mid: 0, high: 0, pan: -1, mute: true, solo: false });
    expect(normalizeMixer({ drums: { high: -4 }, nope: {} })).toEqual({ drums: { low: 0, mid: 0, high: -4, pan: 0, mute: false, solo: false } });
  });

  it('mutes and solos among the channels in play', () => {
    const among = ['drums', 'acid', 'synth'] as const;
    expect(channelAudible({}, 'acid', among)).toBe(true);
    expect(channelAudible({ acid: { ...normalizeStrip({}), mute: true } }, 'acid', among)).toBe(false);
    const solo = { drums: { ...normalizeStrip({}), solo: true } };
    expect(channelAudible(solo, 'drums', among)).toBe(true);
    expect(channelAudible(solo, 'acid', among)).toBe(false);
    // A solo on a channel not in play does not silence the rest.
    expect(channelAudible({ siren: { ...normalizeStrip({}), solo: true } }, 'acid', among)).toBe(true);
  });

  it('meters and formats', () => {
    expect(meterLevel(new Float32Array(16))).toBe(0);
    expect(meterLevel([1, -0.5])).toBe(1);
    expect(meterLevel([0.001 * 31.62])).toBeCloseTo(0.5, 1);
    expect(formatDb(0)).toBe('0 dB');
    expect(formatDb(3.4)).toBe('+3.5 dB');
    expect(formatPan(0)).toBe('C');
    expect(formatPan(-0.4)).toBe('L 40');
  });
});
