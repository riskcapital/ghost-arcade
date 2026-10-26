import { get, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The master tempo the sequencer follows, under the test's control.
const masterTempo = vi.hoisted(() => ({ store: null as any }));
vi.mock('./audio', async () => {
  const { writable: makeWritable } = await import('svelte/store');
  masterTempo.store = makeWritable(120);
  return { currentBPM: masterTempo.store };
});

let now = 0;
let frame: ((time: number) => void) | null = null;

function advanceTo(ms: number) {
  now = ms;
  const callback = frame;
  frame = null;
  callback?.(now);
}

beforeEach(() => {
  now = 0;
  frame = null;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = null; });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VJ layer sequencer timing', () => {
  async function playing() {
    vi.resetModules();
    const { vjLayerSequencer } = await import('./vjLayerSequencer');
    masterTempo.store.set(120);
    vjLayerSequencer.updateConfig({ syncToMaster: true, subdivision: 1, crossfade: false });
    vjLayerSequencer.play();
    return vjLayerSequencer;
  }

  it('keeps its step when the detected tempo moves', async () => {
    const seq = await playing();
    // 30 s at 120 BPM, one step per beat: 60 steps in, step 12 of 16.
    advanceTo(30_000);
    expect(get(seq).currentStep).toBe(12);
    // Tempo detection settles on 126. Re-scaling 30 s of history put the
    // pattern on step 15; the position itself must not move.
    masterTempo.store.set(126);
    advanceTo(30_000);
    expect(get(seq).currentStep).toBe(12);
    // From here it advances at the new tempo: one beat at 126 is ~476 ms.
    advanceTo(30_000 + 480);
    expect(get(seq).currentStep).toBe(13);
  });

  it('keeps the fraction of the step already played when the subdivision changes', async () => {
    const seq = await playing();
    advanceTo(1_250); // step 2, half way through
    expect(get(seq).currentStep).toBe(2);
    seq.updateConfig({ subdivision: 2 }); // steps are now 250 ms
    advanceTo(1_250);
    expect(get(seq).currentStep).toBe(2);
    advanceTo(1_250 + 130); // the other half of step 2 is 125 ms now
    expect(get(seq).currentStep).toBe(3);
  });

  it('reports a transport time the state sync can resume from', async () => {
    const seq = await playing();
    advanceTo(30_000);
    masterTempo.store.set(126);
    advanceTo(30_000);
    // 60 steps at 126 BPM, as a time at the current tempo.
    expect(seq.getTransportTimeSec()).toBeCloseTo(60 * (60 / 126), 5);
  });
});
