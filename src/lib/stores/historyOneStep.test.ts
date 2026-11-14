/**
 * runAsOneStep: a command made of other commands records one undo step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  amendLastHistoryStep,
  cancelPendingHistorySnapshot,
  hasPendingHistorySnapshot,
  recordDiscreteAction,
  runAsOneStep,
  scheduleHistorySnapshot,
  setHistoryCallback,
} from './historyHooks';

let steps: string[] = [];
let label = '';
beforeEach(() => {
  vi.useFakeTimers();
  steps = [];
  label = '';
  setHistoryCallback(() => { steps.push(label); }, {
    capture: () => label,
    commit: (c) => { steps.push(`${c as string}*`); },
  });
});
afterEach(() => {
  cancelPendingHistorySnapshot();
  setHistoryCallback(() => {});
  vi.useRealTimers();
});

describe('runAsOneStep', () => {
  it('folds the steps, debounced edits and amends inside it into one step', () => {
    runAsOneStep(() => {
      label = 'a';
      recordDiscreteAction();
      scheduleHistorySnapshot('k1');
      scheduleHistorySnapshot('k2');
      amendLastHistoryStep();
      label = 'b';
      recordDiscreteAction();
    });
    expect(steps).toEqual(['b']);
    expect(hasPendingHistorySnapshot()).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(steps).toEqual(['b']);
  });

  it('commits an edit still waiting before it as its own step', () => {
    label = 'slider';
    scheduleHistorySnapshot('slider');
    runAsOneStep(() => {
      label = 'update';
      recordDiscreteAction();
    });
    expect(steps).toEqual(['slider*', 'update']);
  });

  it('nested, it is still one step, recorded when the outermost ends', () => {
    runAsOneStep(() => {
      runAsOneStep(() => { label = 'x'; recordDiscreteAction(); });
      expect(steps).toEqual([]);
      label = 'y';
      scheduleHistorySnapshot('k');
    });
    expect(steps).toEqual(['y']);
  });

  it('records nothing when nothing inside asked for a step, and still records after a throw', () => {
    runAsOneStep(() => {});
    expect(steps).toEqual([]);
    expect(() => runAsOneStep(() => { label = 'z'; recordDiscreteAction(); throw new Error('boom'); })).toThrow('boom');
    expect(steps).toEqual(['z']);
    // Outside it again, steps are recorded as usual.
    label = 'after';
    recordDiscreteAction();
    expect(steps).toEqual(['z', 'after']);
  });
});
