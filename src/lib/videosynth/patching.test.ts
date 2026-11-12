import { describe, expect, it } from 'vitest';
import { cablePath } from '../music/cableLook';
import { chooseInputPatch, INPUT_SOURCE, inputJack, inputUsers, plugPatch, unplugPatch } from './patching';

describe('Analog Synth patching', () => {
  const mod = inputJack('AMod')!;
  const rotate = inputJack('RotateIn')!;

  it('plugs a cable over an input, and moving it puts the old input back to its normal', () => {
    expect(plugPatch(rotate, 5)).toEqual({ vsRotateInSrc: 5 });
    expect(plugPatch(rotate, 5, mod)).toEqual({ vsRotateInSrc: 5, vsAModSrc: mod.normal });
    // Dropped back where it came from: nothing else changes.
    expect(plugPatch(mod, 5, mod)).toEqual({ vsAModSrc: 5 });
  });

  it('unplugging a cable restores the normal; unplugging the normal breaks it', () => {
    expect(mod.normal).toBeGreaterThan(0);
    expect(unplugPatch(mod, 9)).toEqual({ vsAModSrc: mod.normal });
    expect(unplugPatch(mod, mod.normal)).toEqual({ vsAModSrc: 0 });
    // A patch-only input has no normal: unplugged, it is empty.
    expect(unplugPatch(rotate, 5)).toEqual({ vsRotateInSrc: 0 });
  });
});

describe('choosing the input layer', () => {
  it('sets Oscillator A to draw it when nothing uses the input', () => {
    expect(chooseInputPatch({}, 'vj-layer-1')).toEqual({ vsInputLayer: 'vj-layer-1', vsAInput: 1 });
    expect(inputUsers({ vsAInput: 1 }).drawnBy).toEqual(['A']);
  });

  it('leaves the patch alone when something already uses it, or when the input is cleared', () => {
    expect(chooseInputPatch({ vsCInput: 1 }, 'cam')).toEqual({ vsInputLayer: 'cam' });
    expect(chooseInputPatch({ vsRotateInSrc: INPUT_SOURCE }, 'cam')).toEqual({ vsInputLayer: 'cam' });
    expect(inputUsers({ vsRotateInSrc: INPUT_SOURCE }).patchedTo.map((j) => j.id)).toEqual(['RotateIn']);
    expect(chooseInputPatch({}, '')).toEqual({ vsInputLayer: '' });
  });
});

describe('cable floor', () => {
  /** The lowest point of the path, sampled along its curve. */
  function lowest(d: string): number {
    const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [y0, y1, y2, y3] = [n[1], n[3], n[5], n[7]];
    let low = -Infinity;
    for (let t = 0; t <= 1; t += 0.01) {
      const u = 1 - t;
      low = Math.max(low, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
    return low;
  }

  it('keeps a cable between low jacks above the floor', () => {
    expect(lowest(cablePath(40, 860, 1000, 880))).toBeGreaterThan(900);
    expect(lowest(cablePath(40, 860, 1000, 880, 900))).toBeLessThanOrEqual(900.5);
    // Still hangs a little below its ends.
    expect(lowest(cablePath(40, 860, 1000, 880, 882))).toBeGreaterThan(880);
  });

  it('leaves cables alone without a floor', () => {
    expect(cablePath(0, 0, 100, 0)).toBe(cablePath(0, 0, 100, 0, undefined));
  });
});
