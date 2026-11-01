import { describe, expect, it } from 'vitest';
import { contribution, newFollow, normalizeCableShape, stepCable, sumInput } from './controlSignals';
import { connect, normalizeCables, shapeCable, type Cable } from './studioSets';

const run = (values: number[], shape = {}, dt = 1 / 60) => values.reduce((f, v) => stepCable(f, v, dt, shape), newFollow());

describe('control cables', () => {
  it('follows a level, rising with the attack and falling with the release', () => {
    const fast = run([1, 1, 1], { attack: 0 });
    expect(fast.value).toBe(1);
    const slow = run([1], { attack: 0.5 });
    expect(slow.value).toBeGreaterThan(0);
    expect(slow.value).toBeLessThan(0.1);
    const fall = run([1, 0, 0], { attack: 0, release: 0.05 });
    expect(fall.value).toBeLessThan(0.6);
  });

  it('pulses in trigger mode on each hit, then falls away', () => {
    const hit = run([0, 0.6], { mode: 'trig' });
    expect(hit.value).toBe(1);
    // Held, the level does not retrigger; it decays.
    const held = run([0, 0.6, 0.6, 0.6, 0.6], { mode: 'trig', release: 0.05 });
    expect(held.value).toBeLessThan(0.5);
  });

  it('scales, turns upside down and adds up, clipped to the input', () => {
    expect(contribution(0.8, { amount: 0.5 })).toBeCloseTo(0.4);
    expect(contribution(0.8, { amount: -1 })).toBeCloseTo(0.2);
    expect(sumInput([0.7, 0.6])).toBe(1);
    expect(sumInput([0.2, 0.1])).toBeCloseTo(0.3);
    expect(sumInput([])).toBe(0);
  });

  it('lets several cables into one control input, and keeps their settings', () => {
    let cables: Cable[] = [];
    cables = connect(cables, { id: 'a', from: 'cv:inst.shots.level', to: 'dest:macro:m1' });
    cables = connect(cables, { id: 'b', from: 'cv:drum.kick', to: 'dest:macro:m1' });
    cables = connect(cables, { id: 'c', from: 'cv:drum.kick', to: 'dest:macro:m1' });
    expect(cables.map((c) => c.id)).toEqual(['a', 'b']);
    cables = shapeCable(cables, 'b', { amount: -0.5, mode: 'trig', release: 0.3 });
    const saved = normalizeCables({ bath: cables, berlin: [], dub: [], analog: [] });
    expect(saved.bath.find((c) => c.id === 'b')).toEqual({ id: 'b', from: 'cv:drum.kick', to: 'dest:macro:m1', amount: -0.5, mode: 'trig', release: 0.3 });
    expect(normalizeCableShape({ amount: 9, mode: 'nope' })).toEqual({});
  });

  it('moves cables from the old Sources bank onto the module jacks', () => {
    const saved = normalizeCables({ bath: [{ id: 'x', from: 'cv:inst.drone.level', to: 'dest:macro:m1', amount: 0.5 }], berlin: [], dub: [], analog: [] });
    expect(saved.bath).toEqual([{ id: 'x', from: 'cv:drone.level', to: 'dest:macro:m1', amount: 0.5 }]);
  });
});
