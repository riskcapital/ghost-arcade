/** The install runner under a fake clock (America/New_York). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InstallRunner, type InstallRunnerHooks } from './installRunner';
import { defaultInstallSchedule, type InstallSchedule } from './installSchedule';

const originalTZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });
const utc = (iso: string) => Date.parse(iso);

function harness(schedule: InstallSchedule, start: string, opts: { projectorsOn?: boolean } = {}) {
  let now = utc(start);
  const calls: string[] = [];
  const hooks: InstallRunnerHooks = {
    openOutputs: () => { calls.push('outputs'); },
    projector: (c) => { calls.push(`projector ${c}`); },
    projectorsAreOn: () => !!opts.projectorsOn,
    setBlackout: (on) => { calls.push(`blackout ${on}`); },
    setLedsBlack: (on) => { calls.push(`leds black ${on}`); },
    startShow: (p) => { calls.push(`start ${new Date(p).toISOString()}`); },
    stopShow: () => { calls.push('stop'); },
    keepShowRunning: () => { calls.push('keep'); },
    log: () => {},
  };
  const runner = new InstallRunner(() => schedule, hooks, () => now);
  return { runner, calls, advance: (ms: number) => { now += ms; }, set: (iso: string) => { now = utc(iso); } };
}

const daily = (patch: Partial<InstallSchedule> = {}): InstallSchedule => ({
  ...defaultInstallSchedule(),
  enabled: true,
  days: Array.from({ length: 7 }, () => ({ enabled: true, on: '10:00', off: '18:00' })),
  ...patch,
});

describe('install runner', () => {
  it('without a schedule switches on at once and keeps the show running', () => {
    const h = harness(defaultInstallSchedule(), '2026-01-05T08:00:00Z');
    expect(h.runner.tick()).toBe('on');
    expect(h.calls).toEqual(['outputs', 'blackout false', 'leds black false', 'start 2026-01-05T08:00:00.000Z']);
    h.calls.length = 0;
    h.runner.tick();
    expect(h.calls).toEqual(['keep']);
  });

  it('coming up during an off period makes sure everything is off', () => {
    const h = harness(daily({ projectorPower: true, shutter: true }), '2026-01-05T12:00:00Z'); // 07:00
    expect(h.runner.tick()).toBe('off');
    expect(h.calls).toEqual(['stop', 'blackout true', 'leds black true', 'projector shutter-close', 'projector power-off']);
    h.calls.length = 0;
    h.runner.tick();
    expect(h.calls).toEqual([]);
  });

  it('powers the projectors on, waits for the warm-up, then starts at the period start', () => {
    const h = harness(daily({ projectorPower: true, warmupSeconds: 60, shutter: true }), '2026-01-05T14:59:59Z');
    h.runner.tick();
    h.calls.length = 0;
    h.advance(1000); // 10:00:00
    expect(h.runner.tick()).toBe('warming');
    expect(h.calls).toEqual(['outputs', 'projector power-on']);
    h.calls.length = 0;
    h.advance(59_000);
    expect(h.runner.tick()).toBe('warming');
    h.advance(1000);
    expect(h.runner.tick()).toBe('on');
    expect(h.calls).toEqual(['projector shutter-open', 'blackout false', 'leds black false', 'start 2026-01-05T15:00:00.000Z']);
  });

  it('skips the warm-up when the projectors already report on (a restart mid-show)', () => {
    const h = harness(daily({ projectorPower: true, warmupSeconds: 60 }), '2026-01-05T17:00:00Z', { projectorsOn: true });
    expect(h.runner.tick()).toBe('on');
    expect(h.calls).toContain('start 2026-01-05T15:00:00.000Z');
  });

  it('switches off at the off time and on again the next day', () => {
    const h = harness(daily({ projectorPower: true }), '2026-01-05T22:59:00Z', { projectorsOn: true });
    expect(h.runner.tick()).toBe('on');
    h.calls.length = 0;
    h.set('2026-01-05T23:00:00Z');
    expect(h.runner.tick()).toBe('off');
    expect(h.calls).toEqual(['stop', 'blackout true', 'leds black true', 'projector power-off']);
    h.set('2026-01-06T15:00:00Z');
    expect(h.runner.tick()).toBe('on');
    expect(h.runner.onSince).toBe(utc('2026-01-06T15:00:00Z'));
  });

  it('a schedule edit that ends today\'s period switches off', () => {
    const s = daily();
    const h = harness(s, '2026-01-05T16:00:00Z');
    h.runner.tick();
    s.days = s.days.map(() => ({ enabled: true, on: '10:00', off: '10:30' }));
    expect(h.runner.tick()).toBe('off');
  });

  it('a failing hook does not stop the others', () => {
    const h = harness(defaultInstallSchedule(), '2026-01-05T08:00:00Z');
    const runner = new InstallRunner(defaultInstallSchedule, {
      openOutputs: () => { throw new Error('no display'); },
      projector: () => {}, projectorsAreOn: () => false,
      setBlackout: () => { h.calls.push('blackout'); }, setLedsBlack: () => {},
      startShow: () => { h.calls.push('start'); }, stopShow: () => {}, log: () => {},
    }, () => utc('2026-01-05T08:00:00Z'));
    expect(runner.tick()).toBe('on');
    expect(h.calls).toEqual(['blackout', 'start']);
  });
});
