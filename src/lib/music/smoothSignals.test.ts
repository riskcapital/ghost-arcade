import { describe, expect, it } from 'vitest';
import { VoiceSignals } from './visualVoices';
import type { NoteEvent } from './noteEvents';

const hit = (time: number, velocity = 1): NoteEvent => ({ type: 'on', instrument: 'drums', note: 36, velocity, time, drum: 'kick' } as NoteEvent);
const run = (v: VoiceSignals, from: number, to: number, step = 1 / 60) => {
  const out: Record<string, number>[] = [];
  for (let t = from; t <= to + 1e-9; t += step) {
    v.advance(t, { beat: t * 2, beatSeconds: 0.5 });
    out.push(v.inputs('kick', false));
  }
  return out;
};

describe('smooth signals for visuals', () => {
  it('turns a hit into a surge that eases in and dies away, never a one-frame spike', () => {
    const v = new VoiceSignals();
    run(v, 0, 0.5);
    v.push(hit(0.5), ['kick']);
    const frames = run(v, 0.5 + 1 / 60, 1.6).map((f) => f.vxPulse);
    const peakAt = frames.indexOf(Math.max(...frames));
    expect(frames[0]).toBeLessThan(frames[peakAt]);
    expect(peakAt).toBeGreaterThan(0);
    expect(Math.max(...frames)).toBeGreaterThan(0.6);
    // Still clearly there a quarter second on, nearly gone after a second.
    expect(frames[15]).toBeGreaterThan(0.3);
    expect(frames[frames.length - 1]).toBeLessThan(0.15);
    // Frame to frame it never jumps by more than a third.
    for (let i = 1; i < frames.length; i++) expect(Math.abs(frames[i] - frames[i - 1])).toBeLessThan(0.34);
  });

  it('morphs the hit count on a spring instead of stepping', () => {
    const v = new VoiceSignals();
    run(v, 0, 0.2);
    v.push(hit(0.2), ['kick']);
    const m = run(v, 0.2 + 1 / 60, 1.5).map((f) => f.vxMorph);
    expect(m[0]).toBeLessThan(0.2);
    expect(m[10]).toBeGreaterThan(0.3);
    expect(m[10]).toBeLessThan(0.98);
    expect(m[m.length - 1]).toBeCloseTo(1, 1);
  });

  it('runs the flow clock faster while the sound plays, and always forward', () => {
    const v = new VoiceSignals();
    const quiet = run(v, 0, 1).map((f) => f.vxFlow);
    for (let i = 0; i < 8; i++) v.push(hit(1 + i * 0.125), ['kick']);
    const busy = run(v, 1 + 1 / 60, 2).map((f) => f.vxFlow);
    const rate = (xs: number[]) => (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
    expect(rate(busy)).toBeGreaterThan(rate(quiet) * 2);
    for (let i = 1; i < busy.length; i++) expect(busy[i]).toBeGreaterThan(busy[i - 1]);
  });
});
