/** Watchdog decisions, restart rate limits and the crash guardian (electron/install-*.cjs). */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decide, emptyHistory, createFrameStallDetector, DEFAULT_LIMITS } = require('../../../electron/install-watchdog.cjs');
const { guardianDecision } = require('../../../electron/install-guardian.cjs');

const MIN = 60_000;

function run(faults: Array<[string, number]>) {
  let history = emptyHistory();
  return faults.map(([fault, at]) => {
    const d = decide(fault, history, at);
    if (!['wait', 'cooldown', 'ignore'].includes(d.action)) history = d.history;
    return d.action;
  });
}

describe('watchdog decisions', () => {
  it('ends a stalled core first, and only that', () => {
    expect(run([['core-stall', 0]])).toEqual(['kill-core']);
  });

  it('reloads the editor for a hang or a crash', () => {
    expect(run([['renderer-hang', 0]])).toEqual(['reload-renderer']);
    expect(run([['renderer-crash', 0]])).toEqual(['reload-renderer']);
    expect(run([['core-dead', 0]])).toEqual(['reload-renderer']);
  });

  it('waits while a restart takes effect, except after a crash', () => {
    expect(run([['renderer-hang', 0], ['renderer-hang', 10_000], ['renderer-hang', DEFAULT_LIMITS.graceMs + 1]]))
      .toEqual(['reload-renderer', 'wait', 'reload-renderer']);
    expect(run([['renderer-crash', 0], ['renderer-crash', 5_000]])).toEqual(['reload-renderer', 'reload-renderer']);
  });

  it('escalates a crash loop: three reloads, then relaunches, then cools down', () => {
    const faults: Array<[string, number]> = Array.from({ length: 8 }, (_, i) => ['renderer-crash', i * 1000]);
    expect(run(faults)).toEqual([
      'reload-renderer', 'reload-renderer', 'reload-renderer',
      'relaunch-app', 'relaunch-app', 'relaunch-app',
      'cooldown', 'cooldown',
    ]);
  });

  it('escalates repeated core stalls to reloads after five core restarts in ten minutes', () => {
    const step = DEFAULT_LIMITS.graceMs + 1000;
    const faults: Array<[string, number]> = Array.from({ length: 7 }, (_, i) => ['core-stall', i * step]);
    expect(run(faults)).toEqual(['kill-core', 'kill-core', 'kill-core', 'kill-core', 'kill-core', 'reload-renderer', 'reload-renderer']);
  });

  it('gets its budget back once restarts age out of the window', () => {
    const late = 61 * MIN;
    const faults: Array<[string, number]> = [
      ...Array.from({ length: 6 }, (_, i) => ['renderer-crash', i * 1000] as [string, number]),
      ['renderer-crash', 7000],
      ['renderer-crash', late],
    ];
    const out = run(faults);
    expect(out[6]).toBe('cooldown');
    expect(out[7]).toBe('reload-renderer');
  });

  it('tells when to try again during a cooldown', () => {
    let history = emptyHistory();
    for (let i = 0; i < 6; i++) history = decide('renderer-crash', history, i).history;
    const d = decide('renderer-crash', history, 10);
    expect(d.action).toBe('cooldown');
    expect(d.retryAt).toBe(3 + DEFAULT_LIMITS.relaunchWindowMs);
  });

  it('ignores unknown faults and survives a corrupt history', () => {
    expect(decide('nonsense', emptyHistory(), 0).action).toBe('ignore');
    expect(decide('renderer-hang', { reloads: 'x', relaunches: [NaN, 'a'] }, 0).action).toBe('reload-renderer');
  });
});

describe('frame stall detector', () => {
  it('says stalled when the frame count stops for the stall time', () => {
    const d = createFrameStallDetector({ stallMs: 20_000 });
    expect(d.sample({ running: true, instance: 1, ok: true, frames: 10 }, 0).stalled).toBe(false);
    expect(d.sample({ running: true, instance: 1, ok: true, frames: 20 }, 5000).stalled).toBe(false);
    expect(d.sample({ running: true, instance: 1, ok: true, frames: 20 }, 20_000).stalled).toBe(false);
    const v = d.sample({ running: true, instance: 1, ok: true, frames: 20 }, 25_000);
    expect(v.stalled).toBe(true);
    expect(v.reason).toMatch(/no new frame/);
  });
  it('says stalled after three unanswered status calls', () => {
    const d = createFrameStallDetector({ maxMisses: 3 });
    d.sample({ running: true, instance: 1, ok: false }, 0);
    d.sample({ running: true, instance: 1, ok: false }, 5000);
    expect(d.sample({ running: true, instance: 1, ok: false }, 10_000).stalled).toBe(true);
  });
  it('starts over for a new core and while none runs', () => {
    const d = createFrameStallDetector({ stallMs: 1000 });
    d.sample({ running: true, instance: 1, ok: true, frames: 5 }, 0);
    expect(d.sample({ running: true, instance: 2, ok: true, frames: 5 }, 5000).stalled).toBe(false);
    expect(d.sample({ running: false }, 9000).stalled).toBe(false);
    expect(d.sample({ running: true, instance: 2, ok: true, frames: 5 }, 9500).stalled).toBe(false);
  });
});

describe('crash guardian', () => {
  it('lets a clean quit be', () => {
    expect(guardianDecision({ cleanExit: true }, 0).action).toBe('exit');
  });
  it('relaunches after a crash, up to five times an hour', () => {
    expect(guardianDecision({ cleanExit: false }, 0).action).toBe('relaunch');
    const relaunches = [1, 2, 3, 4, 5].map((m) => m * MIN);
    const d = guardianDecision({ cleanExit: false, history: { relaunches } }, 10 * MIN);
    expect(d.action).toBe('wait');
    expect(d.retryAt).toBe(61 * MIN);
    expect(guardianDecision({ cleanExit: false, history: { relaunches } }, 62 * MIN).action).toBe('relaunch');
  });
  it('carries out a relaunch the app asked for without counting it again', () => {
    const relaunches = [1, 2, 3, 4, 5].map((m) => m * MIN);
    const d = guardianDecision({ cleanExit: false, relaunchRequested: true, history: { relaunches } }, 10 * MIN);
    expect(d).toMatchObject({ action: 'relaunch', requested: true });
  });
});
