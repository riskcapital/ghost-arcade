import { describe, expect, it } from 'vitest';
import {
  createDmxLearnTracker,
  formatUniverseFilter,
  inferDmxBindingMode,
  parseUniverseFilter,
  readDmxBindingPosition,
  resolveDmxBindingValue,
  sanitizeDmxBinding,
  stepDmxTrigger,
  type DmxBinding,
} from './dmxBindings';

function binding(fields: Partial<DmxBinding> = {}): DmxBinding {
  return {
    id: 'b1',
    protocol: 'artnet',
    universe: 0,
    channel: 1,
    mode: '8bit',
    path: 'vj:0:opacity',
    min: 0,
    max: 1,
    invert: false,
    threshold: 128,
    hysteresis: 16,
    ...fields,
  };
}

function universe(values: Record<number, number>): Uint8Array {
  const data = new Uint8Array(512);
  for (const [channel, value] of Object.entries(values)) data[Number(channel) - 1] = value;
  return data;
}

describe('8-bit bindings', () => {
  it('maps 0-255 onto the output range', () => {
    const b = binding({ min: 0.2, max: 0.8 });
    expect(resolveDmxBindingValue(b, universe({ 1: 0 }))).toBeCloseTo(0.2);
    expect(resolveDmxBindingValue(b, universe({ 1: 255 }))).toBeCloseTo(0.8);
    expect(resolveDmxBindingValue(b, universe({ 1: 51 }))).toBeCloseTo(0.2 + 0.6 * 0.2);
  });

  it('inverts before the range', () => {
    const b = binding({ min: 10, max: 20, invert: true });
    expect(resolveDmxBindingValue(b, universe({ 1: 0 }))).toBeCloseTo(20);
    expect(resolveDmxBindingValue(b, universe({ 1: 255 }))).toBeCloseTo(10);
  });

  it('supports reversed ranges and natural units', () => {
    expect(resolveDmxBindingValue(binding({ min: 1, max: 0 }), universe({ 1: 255 }))).toBeCloseTo(0);
    expect(resolveDmxBindingValue(binding({ channel: 512, min: 0, max: 300 }), universe({ 512: 255 }))).toBeCloseTo(300);
  });
});

describe('16-bit bindings', () => {
  it('reassembles coarse and fine channels', () => {
    const b = binding({ mode: '16bit', channel: 10, fineChannel: 11 });
    expect(readDmxBindingPosition(b, universe({ 10: 0, 11: 0 }))).toBe(0);
    expect(readDmxBindingPosition(b, universe({ 10: 255, 11: 255 }))).toBe(1);
    expect(readDmxBindingPosition(b, universe({ 10: 0x80, 11: 0x00 }))).toBeCloseTo(0x8000 / 65535);
    expect(readDmxBindingPosition(b, universe({ 10: 0x12, 11: 0x34 }))).toBeCloseTo(0x1234 / 65535);
    // The fine channel alone moves by 1/65535 per step: resolution 8-bit cannot give.
    const low = resolveDmxBindingValue(b, universe({ 10: 100, 11: 0 }));
    const high = resolveDmxBindingValue(b, universe({ 10: 100, 11: 1 }));
    expect(high - low).toBeCloseTo(1 / 65535, 10);
  });

  it('uses the next channel as fine by default and allows any fine channel', () => {
    expect(readDmxBindingPosition(binding({ mode: '16bit', channel: 5 }), universe({ 5: 1, 6: 0 }))).toBeCloseTo(256 / 65535);
    expect(readDmxBindingPosition(binding({ mode: '16bit', channel: 5, fineChannel: 100 }), universe({ 5: 0, 100: 255 }))).toBeCloseTo(255 / 65535);
  });

  it('inverts the 16-bit value and applies the range', () => {
    const b = binding({ mode: '16bit', channel: 1, invert: true, min: 0, max: 100 });
    expect(resolveDmxBindingValue(b, universe({ 1: 255, 2: 255 }))).toBeCloseTo(0);
    expect(resolveDmxBindingValue(b, universe({ 1: 0, 2: 0 }))).toBeCloseTo(100);
  });
});

describe('trigger hysteresis', () => {
  it('presses at the threshold and releases only below threshold - hysteresis', () => {
    const b = binding({ mode: 'trigger', threshold: 128, hysteresis: 16 });
    let pressed = false;
    const run = (value: number) => {
      const step = stepDmxTrigger(b, universe({ 1: value }), pressed);
      pressed = step.pressed;
      return step.edge;
    };
    expect(run(0)).toBe(null);
    expect(run(127)).toBe(null);
    expect(run(128)).toBe('press');
    expect(run(255)).toBe(null);
    expect(run(120)).toBe(null); // inside the band: still held
    expect(run(113)).toBe(null);
    expect(run(135)).toBe(null); // no re-press while held
    expect(run(111)).toBe('release');
    expect(run(125)).toBe(null); // below threshold: no press
    expect(run(128)).toBe('press');
  });

  it('a noisy fader parked on the threshold fires once', () => {
    const b = binding({ mode: 'trigger', threshold: 128, hysteresis: 8 });
    let pressed = false;
    let presses = 0;
    for (const value of [126, 129, 127, 130, 125, 128, 124, 129, 126]) {
      const step = stepDmxTrigger(b, universe({ 1: value }), pressed);
      pressed = step.pressed;
      if (step.edge === 'press') presses += 1;
    }
    expect(presses).toBe(1);
    expect(pressed).toBe(true);
  });

  it('inverted triggers press when the channel drops', () => {
    const b = binding({ mode: 'trigger', invert: true, threshold: 200, hysteresis: 10 });
    expect(stepDmxTrigger(b, universe({ 1: 255 }), false).edge).toBe(null);
    expect(stepDmxTrigger(b, universe({ 1: 50 }), false).edge).toBe('press');
    expect(stepDmxTrigger(b, universe({ 1: 60 }), true).edge).toBe(null); // 195: in band
    expect(stepDmxTrigger(b, universe({ 1: 70 }), true).edge).toBe('release'); // 185
  });

  it('zero hysteresis releases just below the threshold', () => {
    const b = binding({ mode: 'trigger', threshold: 10, hysteresis: 0 });
    expect(stepDmxTrigger(b, universe({ 1: 9 }), true).edge).toBe('release');
  });
});

describe('binding sanitizing', () => {
  it('fills defaults, clamps channels and universes, and infers the mode', () => {
    const clean = sanitizeDmxBinding({ protocol: 'sacn', universe: 0, channel: 900, path: 'vj:0:trigger:2' }, 'x');
    expect(clean).toMatchObject({ id: 'x', protocol: 'sacn', universe: 1, channel: 512, mode: 'trigger', min: 0, max: 1, threshold: 128, hysteresis: 16 });
    expect(sanitizeDmxBinding({ path: 'vj:0:opacity', mode: '16bit', channel: 7 }, 'y')).toMatchObject({ fineChannel: 8, protocol: 'artnet' });
    expect(sanitizeDmxBinding({ path: '' }, 'z')).toBeNull();
    expect(sanitizeDmxBinding(null, 'z')).toBeNull();
    expect(sanitizeDmxBinding({ path: 'vj:layer:0:opacity', threshold: 0, hysteresis: 900 }, 'w')).toMatchObject({ path: 'vj:0:opacity', threshold: 1, hysteresis: 127 });
  });

  it('infers trigger mode for buttons', () => {
    expect(inferDmxBindingMode('vj:0:trigger:0')).toBe('trigger');
    expect(inferDmxBindingMode('vj:column:3')).toBe('trigger');
    expect(inferDmxBindingMode('vj:crossfader:value')).toBe('8bit');
    expect(inferDmxBindingMode('vj:macro:1:value')).toBe('8bit');
  });
});

describe('universe filter', () => {
  it('parses lists and ranges', () => {
    expect(parseUniverseFilter('')).toEqual({ universes: [], error: null });
    expect(parseUniverseFilter('0-3, 8 5')).toEqual({ universes: [0, 1, 2, 3, 5, 8], error: null });
    expect(parseUniverseFilter('3-1').error).toMatch(/backwards/);
    expect(parseUniverseFilter('a').error).toMatch(/not a universe/);
    expect(parseUniverseFilter('0-100').error).toMatch(/64/);
    expect(parseUniverseFilter('64000').error).toMatch(/63999/);
  });

  it('formats back to ranges', () => {
    expect(formatUniverseFilter([8, 0, 1, 2, 3, 5])).toBe('0-3, 5, 8');
  });
});

describe('learn by wiggle', () => {
  it('ignores small drift and picks the channel that moved furthest', () => {
    const tracker = createDmxLearnTracker(24);
    tracker.observe('artnet', 0, 4, 100, 110);
    tracker.observe('artnet', 0, 4, 110, 105);
    expect(tracker.winner()).toBeNull();
    tracker.observe('artnet', 0, 9, 0, 40);
    tracker.observe('artnet', 0, 4, 105, 130);
    expect(tracker.winner()).toEqual({ protocol: 'artnet', universe: 0, channel: 10, span: 40 });
  });

  it('16-bit learn picks the coarse channel even when fine moved further', () => {
    const tracker = createDmxLearnTracker(24);
    tracker.observe('sacn', 1, 20, 10, 12); // coarse: small move
    tracker.observe('sacn', 1, 21, 0, 255); // fine: sweeps
    expect(tracker.winner()!.channel).toBe(22);
    expect(tracker.winner16()!.channel).toBe(21);
  });
});
