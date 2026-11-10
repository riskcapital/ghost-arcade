/**
 * Install schedule maths in a daylight-saving time zone (America/New_York,
 * 2026: spring forward Sunday 8 March 02:00 -> 03:00, fall back Sunday
 * 1 November 02:00 -> 01:00). Expectations are UTC instants, so a wrong
 * offset anywhere shows up as an hour.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultInstallSchedule, installScheduleState, normalizeInstallSchedule, type InstallSchedule } from './installSchedule';

const originalTZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });

const utc = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '');

function sched(days: Array<[boolean, string, string]>, patch: Partial<InstallSchedule> = {}): InstallSchedule {
  return { ...defaultInstallSchedule(), enabled: true, days: days.map(([enabled, on, off]) => ({ enabled, on, off })), ...patch };
}
const every = (on: string, off: string) => sched(Array.from({ length: 7 }, () => [true, on, off] as [boolean, string, string]));

describe('install schedule', () => {
  it('is always on with the schedule off', () => {
    expect(installScheduleState(defaultInstallSchedule(), utc('2026-01-05T08:00:00Z'))).toEqual({ on: true, window: null, next: null });
  });

  it('switches on and off at local wall-clock times (winter, UTC-5)', () => {
    const s = every('10:00', '18:00');
    expect(installScheduleState(s, utc('2026-01-05T14:59:00Z')).on).toBe(false);
    const st = installScheduleState(s, utc('2026-01-05T14:59:00Z'));
    expect(iso(st.next!.at)).toBe('2026-01-05T15:00:00Z');
    expect(st.next!.on).toBe(true);
    const on = installScheduleState(s, utc('2026-01-05T15:00:00Z'));
    expect(on.on).toBe(true);
    expect(iso(on.next!.at)).toBe('2026-01-05T23:00:00Z');
    expect(installScheduleState(s, utc('2026-01-05T23:00:00Z')).on).toBe(false);
  });

  it('keeps 10:00 at 10:00 across the spring change (UTC-4 after)', () => {
    const s = every('10:00', '18:00');
    // Saturday 7 March, before the change.
    expect(iso(installScheduleState(s, utc('2026-03-07T12:00:00Z')).next!.at)).toBe('2026-03-07T15:00:00Z');
    // Sunday 8 March, after the change.
    const st = installScheduleState(s, utc('2026-03-08T12:00:00Z'));
    expect(st.on).toBe(false);
    expect(iso(st.next!.at)).toBe('2026-03-08T14:00:00Z');
    expect(iso(installScheduleState(s, utc('2026-03-08T14:00:00Z')).next!.at)).toBe('2026-03-08T22:00:00Z');
  });

  it('resolves an on time inside the spring-forward gap to 03:00', () => {
    const s = every('02:30', '06:00');
    const st = installScheduleState(s, utc('2026-03-08T05:00:00Z')); // 00:00 EST
    expect(iso(st.next!.at)).toBe('2026-03-08T07:00:00Z'); // 03:00 EDT
  });

  it('an overnight period across the autumn change lasts an hour longer', () => {
    const s = every('22:00', '06:00');
    const st = installScheduleState(s, utc('2026-11-01T03:00:00Z')); // Sat 31 Oct 23:00 EDT
    expect(st.on).toBe(true);
    expect(iso(st.window!.start)).toBe('2026-11-01T02:00:00Z'); // 22:00 EDT
    // Back-to-back nights merge: the off is the last morning only if nights
    // do not touch. 06:00 -> 22:00 is a gap, so the off is Sunday 06:00 EST.
    expect(iso(st.next!.at)).toBe('2026-11-01T11:00:00Z');
    expect(st.window!.end - st.window!.start).toBe(9 * 3600_000);
  });

  it('runs past midnight into the next day, by the weekday it started on', () => {
    // Only Friday is on, 20:00 -> 02:00.
    const days = Array.from({ length: 7 }, (_, i) => [i === 5, '20:00', '02:00'] as [boolean, string, string]);
    const s = sched(days);
    // Friday 9 Jan 2026, 21:00 EST: on.
    expect(installScheduleState(s, utc('2026-01-10T02:00:00Z')).on).toBe(true);
    // Saturday 01:30: still Friday's evening.
    const late = installScheduleState(s, utc('2026-01-10T06:30:00Z'));
    expect(late.on).toBe(true);
    expect(iso(late.next!.at)).toBe('2026-01-10T07:00:00Z');
    // Saturday 21:00: Saturday is off.
    const sat = installScheduleState(s, utc('2026-01-11T02:00:00Z'));
    expect(sat.on).toBe(false);
    expect(iso(sat.next!.at)).toBe('2026-01-17T01:00:00Z'); // next Friday 20:00
  });

  it('honours each weekday on its own', () => {
    const days = Array.from({ length: 7 }, (_, i) => [i !== 1, i === 0 ? '12:00' : '10:00', '18:00'] as [boolean, string, string]);
    const s = sched(days);
    // Monday 5 Jan 2026 11:00: Monday is off.
    expect(installScheduleState(s, utc('2026-01-05T16:00:00Z')).on).toBe(false);
    // Sunday 4 Jan 11:00: Sunday opens at 12:00.
    expect(installScheduleState(s, utc('2026-01-04T16:00:00Z')).on).toBe(false);
    expect(installScheduleState(s, utc('2026-01-04T17:00:00Z')).on).toBe(true);
    // Tuesday 11:00: on.
    expect(installScheduleState(s, utc('2026-01-06T16:00:00Z')).on).toBe(true);
  });

  it('merges back-to-back periods into one (00:00 to 00:00 every day = always on)', () => {
    const s = every('00:00', '00:00');
    const st = installScheduleState(s, utc('2026-01-05T15:00:00Z'));
    expect(st.on).toBe(true);
    expect(st.next!.at - utc('2026-01-05T15:00:00Z')).toBeGreaterThan(6 * 86400_000);
  });

  it('has nothing next when every day is off', () => {
    const s = sched(Array.from({ length: 7 }, () => [false, '10:00', '18:00'] as [boolean, string, string]));
    expect(installScheduleState(s, utc('2026-01-05T15:00:00Z'))).toEqual({ on: false, window: null, next: null });
  });

  it('normalizes bad input', () => {
    const n = normalizeInstallSchedule({ enabled: true, days: [{ on: '25:00', off: 'x' }, null, { enabled: false, on: '09:30', off: '17:15' }], warmupSeconds: 9999 });
    expect(n.days).toHaveLength(7);
    expect(n.days[0]).toEqual({ enabled: true, on: '10:00', off: '18:00' });
    expect(n.days[2]).toEqual({ enabled: false, on: '09:30', off: '17:15' });
    expect(n.warmupSeconds).toBe(600);
    expect(normalizeInstallSchedule(null)).toEqual(defaultInstallSchedule());
  });

  it('matches the main process normalisation', async () => {
    const { createRequire } = await import('node:module');
    const { normalizeSchedule } = createRequire(import.meta.url)('../../../electron/show-startup.cjs');
    const raw = { enabled: true, days: [{ on: '07:05', off: '23:59' }, { enabled: false }], projectorPower: true, warmupSeconds: '45', shutter: true };
    expect(normalizeSchedule(raw)).toEqual(normalizeInstallSchedule(raw));
  });
});
