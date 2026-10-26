import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let now = 0;
let frame: ((time: number) => void) | null = null;

function frameAt(ms: number) {
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

async function sequencer(crossfadeEnabled = false) {
  vi.resetModules();
  const { layerSequencer } = await import('./layerSequencer');
  layerSequencer.setStepCount(4);
  layerSequencer.generatePattern('snake', ['a', 'b', 'c', 'd']);
  layerSequencer.updateConfig({ timingMode: 'fixed', fixedStepDuration: 1, crossfadeEnabled, crossfadeDuration: 0.3, loop: true });
  layerSequencer.play();
  return layerSequencer;
}

describe('Mapping layer sequencer timing', () => {
  it('starts each step where the last one ended, not at the frame that noticed', async () => {
    const seq = await sequencer();
    frameAt(1_010); // a frame late into step 1
    expect(get(seq).currentStep).toBe(1);
    // Step 2 is due at 2 s. Re-anchoring on the late frame put it at 2.01 s,
    // and every step lost another part of a frame.
    frameAt(2_005);
    expect(get(seq).currentStep).toBe(2);
    frameAt(3_001);
    expect(get(seq).currentStep).toBe(3);
  });

  it('rebases after a stall instead of racing through the missed steps', async () => {
    const seq = await sequencer();
    frameAt(1_000);
    frameAt(9_500); // the window was hidden for 8 s
    expect(get(seq).currentStep).toBe(2);
    frameAt(9_600);
    expect(get(seq).currentStep).toBe(2);
    frameAt(10_500);
    expect(get(seq).currentStep).toBe(3);
  });

  it('publishes only when the step or a crossfade actually changes something', async () => {
    const seq = await sequencer();
    let updates = 0;
    const stop = seq.subscribe(() => { updates++; });
    updates = 0;
    for (let t = 100; t < 1_000; t += 16) frameAt(t);
    // Holding one step: overrides set once (the first frame), then quiet.
    expect(updates).toBeLessThanOrEqual(1);
    frameAt(1_000);
    expect(updates).toBeLessThanOrEqual(2);
    stop();
  });

  it('still animates a crossfade frame by frame', async () => {
    const seq = await sequencer(true);
    frameAt(100);
    const before = get(seq).opacityOverrides;
    frameAt(800); // inside the last 0.3 s of step 0
    const during = get(seq).opacityOverrides;
    expect(during.a).toBeLessThan(1);
    expect(during.b).toBeGreaterThan(0);
    expect(during).not.toBe(before);
  });
});
