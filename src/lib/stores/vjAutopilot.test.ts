import { describe, expect, it } from 'vitest';
import { chooseAutopilotColumn, normalizeAutopilot, VJAutopilotClock, type AutopilotSample } from './vjAutopilot';
const sample = (patch: Partial<AutopilotSample> = {}): AutopilotSample => ({
  key: 'A:0', token: 'run1', scope: 'main:A:0', config: { target: 'next', unit: 'beats', count: 4 },
  ids: ['a', null, 'b'], current: 0, running: true, bpm: 120, rate: 1, rangeSeconds: 2, video: true, once: false, ...patch,
});
describe('Autopilot rules and transport clock', () => {
  it.each([['next', 0, 2], ['next', 2, 0], ['previous', 0, 2], ['previous', 2, 0],
    ['first', 2, 0], ['last', 0, 2], ['random-other', 0, 2]] as const)('%s skips empty cells', (target, current, expected) => {
    expect(chooseAutopilotColumn(['a', null, 'b'], current, { target, unit: 'beats', count: 1 }, new Set(), () => 0)).toBe(expected);
  });
  it('does nothing for an empty target or random-other on a single clip', () => {
    expect(chooseAutopilotColumn(['a', null], 0, { target: 'column', column: 1, unit: 'beats', count: 1 }, new Set())).toBeNull();
    expect(chooseAutopilotColumn(['a'], 0, { target: 'random-other', unit: 'beats', count: 1 }, new Set())).toBeNull();
  });
  it('random bag visits every clip once per cycle and avoids a boundary repeat', () => {
    const played = new Set<string>();
    const config = { target: 'random-bag', unit: 'beats', count: 1 } as const;
    let current = 0;
    const sequence = [current];
    for (let i = 0; i < 8; i++) {
      current = chooseAutopilotColumn(['a', 'b', 'c'], current, config, played, () => 0)!;
      sequence.push(current);
    }
    expect(sequence).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    expect(chooseAutopilotColumn(['a', 'new', 'c'], current, config, played, () => 0)).toBe(1);
  });
  it('uses the old tempo until a tempo change, then the new tempo', () => {
    const clock = new VJAutopilotClock();
    clock.sync([sample()], 0);
    clock.sync([sample({ bpm: 60 })], 1000);
    clock.sync([sample({ bpm: 60 })], 2999);
    expect(clock.takeDue()).toEqual([]);
    clock.sync([sample({ bpm: 60 })], 3000);
    expect(clock.takeDue()).toEqual([{ key: 'A:0', token: 'run1', column: 2 }]);
    expect(clock.takeDue()).toEqual([]);
  });
  it('pauses counting while locked, paused or waiting for manual input', () => {
    const clock = new VJAutopilotClock();
    clock.sync([sample()], 0);
    clock.sync([sample({ running: false })], 500);
    clock.sync([sample()], 10000);
    clock.sync([sample()], 11499);
    expect(clock.takeDue()).toEqual([]);
    clock.sync([sample()], 11500);
    expect(clock.takeDue()).toHaveLength(1);
  });
  it('counts trimmed video loops across speed changes and resets after a seek', () => {
    const clock = new VJAutopilotClock();
    const config = { target: 'next', unit: 'loops', count: 2 } as const;
    clock.sync([sample({ config })], 0);
    clock.sync([sample({ config, rate: 2 })], 2000);
    clock.sync([sample({ config, rate: 2 })], 3000);
    expect(clock.takeDue()).toHaveLength(1);
    clock.sync([sample({ config, token: 'seek2', initialLoopProgress: 0.5 })], 4000);
    clock.sync([sample({ config, token: 'seek2' })], 6999);
    expect(clock.takeDue()).toHaveLength(0);
    clock.sync([sample({ config, token: 'seek2' })], 7000);
    expect(clock.takeDue()).toHaveLength(1);
  });
  it('a play-once clip cannot count a second pass', () => {
    const clock = new VJAutopilotClock();
    const s = sample({ once: true, config: { target: 'next', unit: 'loops', count: 2 } });
    clock.sync([s], 0); clock.sync([s], 100000);
    expect(clock.takeDue()).toHaveLength(0);
  });
  it('does not count loops for still images or unknown video durations', () => {
    for (const patch of [{ video: false }, { rangeSeconds: 0 }]) {
      const clock = new VJAutopilotClock();
      const s = sample({ ...patch, config: { target: 'next', unit: 'loops', count: 1 } });
      clock.sync([s], 0); clock.sync([s], 100000);
      expect(clock.takeDue()).toHaveLength(0);
    }
  });
  it('clears runs on exit and fires at most once after a delayed frame', () => {
    const clock = new VJAutopilotClock();
    clock.sync([sample()], 0); clock.sync([sample()], 600000);
    expect(clock.takeDue()).toHaveLength(1);
    clock.sync([], 600001);
    expect(clock.active).toBe(false);
    clock.sync([sample()], 600002);
    expect(clock.takeDue()).toHaveLength(0);
  });
  it('sanitizes persisted settings', () => {
    expect(normalizeAutopilot({ target: 'unknown' })).toBeUndefined();
    expect(normalizeAutopilot({ target: 'none' })).toBeUndefined();
    expect(normalizeAutopilot({ target: 'next', unit: 'bad', count: NaN })).toEqual({ target: 'next', unit: 'beats', count: 1 });
    expect(normalizeAutopilot({ target: 'column', count: 10000, column: -1 })).toEqual({ target: 'column', unit: 'beats', count: 999, column: 0 });
  });
});
