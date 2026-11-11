/**
 * A recording is taken later than its bar lines by the sound's delay into
 * and out of the computer (and the performer's adjustment), at the same
 * length, so the band's beat lands on the bar line when the loop plays.
 */
import { describe, expect, it } from 'vitest';
import { BandLooper } from './bandLooper';

function setup() {
  const posted: Array<Record<string, number>> = [];
  const node = () => ({ gain: { value: 0 }, connect: (d: unknown) => d, disconnect() {} });
  const ctx = { sampleRate: 48000, currentTime: 1, createGain: node } as unknown as AudioContext;
  const looper = new BandLooper(ctx, {} as AudioNode, {} as AudioNode);
  // The capture worklet, stood in for.
  (looper as unknown as { capture: unknown }).capture = { port: { postMessage: (m: Record<string, number>) => posted.push(m) } };
  looper.setClock(() => ({ beat: 0.5, beatMs: 500 }));
  return { looper, posted, ctx: ctx as unknown as { currentTime: number } };
}

describe('the band looper', () => {
  it('records its bars later by the delay measured and adjusted, and the same length', () => {
    const { looper, posted, ctx } = setup();
    looper.setLatency(() => ({ measured: 0.02, offsetMs: 5 }));
    const w = looper.record(0, 2, () => {})!;
    expect(posted[0]).toMatchObject({ type: 'record', start: w.startFrame + 1200, end: w.endFrame + 1200 });
    // Ended sooner (in its first bar), it ends one bar in, by the same lag.
    ctx.currentTime = w.startTime + 0.5;
    const shorter = looper.endRecordingSoon()!;
    expect(shorter.bars).toBe(1);
    expect(posted[1]).toMatchObject({ type: 'end', end: shorter.endFrame + 1200 });
    looper.cancelRecording();
  });

  it('records on the bar lines with nothing measured', () => {
    const { looper, posted } = setup();
    const w = looper.record(0, 2, () => {})!;
    expect(posted[0]).toMatchObject({ start: w.startFrame, end: w.endFrame });
    looper.cancelRecording();
  });
});
