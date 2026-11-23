import { describe, expect, it } from 'vitest';
import { SendReturns } from './sendReturns';

/** Just enough of a Web Audio graph to follow connections and automation. */
function fakeContext() {
  const param = (value = 0) => {
    const events: Array<[string, number, number]> = [];
    return {
      value, events,
      setValueAtTime(v: number, at: number) { events.push(['set', v, at]); return this; },
      linearRampToValueAtTime(v: number, at: number) { events.push(['ramp', v, at]); return this; },
      setTargetAtTime(v: number, at: number) { events.push(['target', v, at]); return this; },
      cancelScheduledValues() { return this; },
      cancelAndHoldAtTime() { return this; },
    };
  };
  const node = (kind: string, extra: Record<string, unknown> = {}) => {
    const n: Record<string, unknown> & { outs: Set<unknown> } = {
      kind, outs: new Set(),
      connect(to: unknown) { n.outs.add(to); return to; },
      disconnect(to?: unknown) { if (to) n.outs.delete(to); else n.outs.clear(); },
      ...extra,
    };
    return n;
  };
  return {
    currentTime: 10,
    sampleRate: 48000,
    createGain: () => node('gain', { gain: param(1) }),
    createDelay: () => node('delay', { delayTime: param(0) }),
    createBiquadFilter: () => node('filter', { frequency: param(), Q: param(), gain: param(), type: 'lowpass' }),
    createWaveShaper: () => node('shaper', { curve: null }),
    createConvolver: () => node('convolver', { buffer: null }),
    createBuffer: (ch: number, len: number) => ({ getChannelData: () => new Float32Array(len), numberOfChannels: ch, length: len }),
  };
}

describe('send returns', () => {
  it('kill gives the echo an empty delay line with the same time', () => {
    const ctx = fakeContext();
    const out = ctx.createGain();
    const r = new SendReturns(ctx as unknown as AudioContext, out as unknown as AudioNode);
    const echoIn = r.inputs.echo as unknown as { outs: Set<{ kind: string; delayTime: { value: number } }> };
    const before = [...echoIn.outs][0];
    before.delayTime.value = 0.4;
    r.kill();
    const after = [...echoIn.outs][0];
    expect(after.kind).toBe('delay');
    expect(after).not.toBe(before);
    expect(after.delayTime.value).toBe(0.4);
  });
});
