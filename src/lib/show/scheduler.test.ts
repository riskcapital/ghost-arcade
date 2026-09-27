/**
 * Scheduler logic under a fake clock, in a daylight-saving time zone.
 *
 * America/New_York in 2026: clocks go 02:00 -> 03:00 on Sunday 8 March and
 * 02:00 -> 01:00 on Sunday 1 November. Every expectation is an absolute UTC
 * instant, so a wrong offset anywhere shows up as an hour.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  ScheduleRunner,
  activeWindow,
  createScheduleHooks,
  defaultSchedule,
  newScheduleEntry,
  nextWindow,
  normalizeSchedule,
  wallClockInstant,
  windowsStartingOn,
  type ShowSchedule,
} from './scheduler';
import { CueEngine } from './cueList';
import { projectors } from './projectors';
import { installProjectorHarness, type ProjectorHarness } from './pjlinkHarness.testutil';

const require = createRequire(import.meta.url);
const { startFakePjlink } = require('../../../scripts/fake-pjlink-server.cjs');

const originalTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

const utc = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '');

function schedule(patch: Partial<ShowSchedule>): ShowSchedule {
  return { ...defaultSchedule(), enabled: true, ...patch };
}
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

describe('time zone', () => {
  it('runs in New York with DST', () => {
    expect(new Date(utc('2026-01-15T12:00:00Z')).getTimezoneOffset()).toBe(300);
    expect(new Date(utc('2026-07-15T12:00:00Z')).getTimezoneOffset()).toBe(240);
  });
});

describe('calendar windows', () => {
  it('a daily show', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '10:00', stop: '18:00' })] });
    const [w] = windowsStartingOn(s, 2026, 8, 26);
    expect([iso(w.start), iso(w.end), w.key]).toEqual(['2026-09-26T14:00:00Z', '2026-09-26T22:00:00Z', 'd@2026-09-26']);
  });

  it('a weekly show only on its days', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'w', days: [5, 6], start: '19:30', stop: '23:00' })] });
    // 2026-09-25 is a Friday, 09-27 a Sunday.
    expect(windowsStartingOn(s, 2026, 8, 25)).toHaveLength(1);
    expect(windowsStartingOn(s, 2026, 8, 26)).toHaveLength(1);
    expect(windowsStartingOn(s, 2026, 8, 27)).toHaveLength(0);
    expect(iso(nextWindow(s, utc('2026-09-27T12:00:00Z'))!.start)).toBe('2026-10-02T23:30:00Z');
  });

  it('a show past midnight belongs to the day it starts', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'n', days: [6], start: '22:00', stop: '02:00' })] });
    const w = activeWindow(s, utc('2026-09-27T05:30:00Z'))!; // Sun 01:30 local
    expect(w.key).toBe('n@2026-09-26');
    expect([iso(w.start), iso(w.end)]).toEqual(['2026-09-27T02:00:00Z', '2026-09-27T06:00:00Z']);
    expect(activeWindow(s, utc('2026-09-27T06:00:00Z'))).toBeNull();
  });

  it('date exceptions close a day or replace its hours', () => {
    const s = schedule({
      entries: [newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '10:00', stop: '18:00' })],
      exceptions: [
        { id: 'xmas', date: '2026-12-25', kind: 'closed', start: '', stop: '', note: 'Closed' },
        { id: 'eve', date: '2026-12-31', kind: 'hours', start: '20:00', stop: '01:00', note: 'Late' },
      ],
    });
    expect(windowsStartingOn(s, 2026, 11, 25)).toEqual([]);
    const [late] = windowsStartingOn(s, 2026, 11, 31);
    expect([late.key, iso(late.start), iso(late.end)]).toEqual(['eve@2026-12-31', '2027-01-01T01:00:00Z', '2027-01-01T06:00:00Z']);
    expect(activeWindow(s, utc('2027-01-01T05:59:00Z'))!.key).toBe('eve@2026-12-31');
    expect(windowsStartingOn(s, 2026, 11, 24)).toHaveLength(1);
  });
});

describe('daylight saving', () => {
  it('resolves a spring-forward gap time to the first instant after it', () => {
    // 02:30 does not exist on 8 March; clocks read 03:00 at 07:00Z.
    expect(iso(wallClockInstant(2026, 2, 8, 2, 30))).toBe('2026-03-08T07:00:00Z');
    expect(iso(wallClockInstant(2026, 2, 8, 3, 0))).toBe('2026-03-08T07:00:00Z');
    const s = schedule({ entries: [newScheduleEntry({ id: 'g', days: [0], start: '02:30', stop: '04:00' })] });
    const [w] = windowsStartingOn(s, 2026, 2, 8);
    expect([iso(w.start), iso(w.end)]).toEqual(['2026-03-08T07:00:00Z', '2026-03-08T08:00:00Z']);
  });

  it('resolves a repeated autumn time to its first occurrence', () => {
    expect(iso(wallClockInstant(2026, 10, 1, 1, 30))).toBe('2026-11-01T05:30:00Z');
    const s = schedule({ entries: [newScheduleEntry({ id: 'f', days: [0], start: '01:30', stop: '03:00' })] });
    const [w] = windowsStartingOn(s, 2026, 10, 1);
    // 01:30 EDT to 03:00 EST is two and a half real hours.
    expect([iso(w.start), iso(w.end)]).toEqual(['2026-11-01T05:30:00Z', '2026-11-01T08:00:00Z']);
  });

  it('keeps a daily show at the same wall-clock time on both sides of each change', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '20:00', stop: '22:00' })] });
    const at = (y: number, m: number, d: number) => iso(windowsStartingOn(s, y, m, d)[0].start);
    expect(at(2026, 2, 7)).toBe('2026-03-08T01:00:00Z');
    expect(at(2026, 2, 8)).toBe('2026-03-09T00:00:00Z');
    expect(at(2026, 9, 31)).toBe('2026-11-01T00:00:00Z');
    expect(at(2026, 10, 1)).toBe('2026-11-02T01:00:00Z');
  });

  it('an overnight show across a change ends at the wall-clock stop', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'o', days: ALL_DAYS, start: '23:00', stop: '05:00' })] });
    const [spring] = windowsStartingOn(s, 2026, 2, 7);
    expect((spring.end - spring.start) / 3600_000).toBe(5);
    const [autumn] = windowsStartingOn(s, 2026, 9, 31);
    expect((autumn.end - autumn.start) / 3600_000).toBe(7);
  });
});

describe('runner with a fake clock', () => {
  function harness(s: ShowSchedule, startMs: number) {
    let now = startMs;
    const calls: string[] = [];
    const runner = new ScheduleRunner(() => s, {
      start: (w) => calls.push(`start ${w.key} ${iso(now)}`),
      stop: (w) => calls.push(`stop ${w.key} ${iso(now)}`),
      projectorsOn: (w) => calls.push(`warm ${w.key} ${iso(now)}`),
    }, () => now);
    return {
      runner,
      calls,
      set: (ms: number) => { now = ms; },
      runUntil(endMs: number, stepMs = 30_000) {
        while (now < endMs) {
          now = Math.min(endMs, now + stepMs);
          runner.tick();
        }
      },
    };
  }

  it('starts and stops a daily show every day through the spring change', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '19:00', stop: '23:30' })] });
    const h = harness(s, utc('2026-03-06T12:00:00Z'));
    h.runUntil(utc('2026-03-10T12:00:00Z'));
    expect(h.calls).toEqual([
      'start d@2026-03-06 2026-03-07T00:00:00Z',
      'stop d@2026-03-06 2026-03-07T04:30:00Z',
      'start d@2026-03-07 2026-03-08T00:00:00Z',
      'stop d@2026-03-07 2026-03-08T04:30:00Z',
      'start d@2026-03-08 2026-03-08T23:00:00Z',
      'stop d@2026-03-08 2026-03-09T03:30:00Z',
      'start d@2026-03-09 2026-03-09T23:00:00Z',
      'stop d@2026-03-09 2026-03-10T03:30:00Z',
    ]);
  });

  it('runs a show that straddles the autumn change for its real length', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'n', days: [6], start: '23:00', stop: '03:00' })] });
    const h = harness(s, utc('2026-10-31T12:00:00Z'));
    h.runUntil(utc('2026-11-01T12:00:00Z'), 10_000);
    expect(h.calls).toEqual([
      'start n@2026-10-31 2026-11-01T03:00:00Z',
      'stop n@2026-10-31 2026-11-01T08:00:00Z',
    ]);
  });

  it('a machine waking up mid-show starts it at once, and one waking after the end stops it', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '10:00', stop: '18:00' })] });
    const h = harness(s, utc('2026-09-26T12:00:00Z')); // 08:00 local
    h.runner.tick();
    expect(h.calls).toEqual([]);
    h.set(utc('2026-09-26T17:21:00Z')); // asleep until 13:21
    h.runner.tick();
    h.runner.tick();
    expect(h.calls).toEqual(['start d@2026-09-26 2026-09-26T17:21:00Z']);
    h.set(utc('2026-09-26T23:40:00Z')); // asleep again until 19:40
    h.runner.tick();
    expect(h.calls.at(-1)).toBe('stop d@2026-09-26 2026-09-26T23:40:00Z');
    h.set(utc('2026-09-28T15:00:00Z')); // slept through all of the 27th
    h.runner.tick();
    expect(h.calls.slice(2)).toEqual(['start d@2026-09-28 2026-09-28T15:00:00Z']);
  });

  it('a start moved later the same day still fires at the new time', () => {
    // Seen in a test pass: the time field commits each segment as it is
    // typed, so 10:00 -> 03:29 passed through 03:03 while it was 03:27. The
    // 03:03 window started, the next edit ended it, and 03:29 never fired
    // because the entry was already "handled" for the day.
    const entry = newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '10:00', stop: '18:00' });
    const s = schedule({ entries: [entry] });
    const h = harness(s, utc('2026-09-26T13:00:00Z')); // 09:00 local
    h.runner.tick();
    entry.start = '08:00'; // now inside the window: starts at once
    h.runner.tick();
    entry.start = '09:30'; // edited on: the window closes
    h.runner.tick();
    h.runUntil(utc('2026-09-26T13:31:00Z'));
    expect(h.calls).toEqual([
      'start d@2026-09-26 2026-09-26T13:00:00Z',
      'stop d@2026-09-26 2026-09-26T13:00:00Z',
      'start d@2026-09-26 2026-09-26T13:30:00Z',
    ]);
  });

  it('changing the times of a running show does not restart it', () => {
    const entry = newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '10:00', stop: '18:00' });
    const s = schedule({ entries: [entry] });
    const h = harness(s, utc('2026-09-26T15:00:00Z')); // 11:00 local
    h.runner.tick();
    entry.start = '09:00';
    entry.stop = '20:00';
    h.runUntil(utc('2026-09-26T23:59:00Z')); // 19:59 local: still running
    expect(h.calls).toEqual(['start d@2026-09-26 2026-09-26T15:00:00Z']);
    h.runUntil(utc('2026-09-27T00:01:00Z')); // the new 20:00 stop
    expect(h.calls).toEqual([
      'start d@2026-09-26 2026-09-26T15:00:00Z',
      'stop d@2026-09-26 2026-09-27T00:00:00Z',
    ]);
  });

  it('launching mid-show starts it, and a manual stop is not overruled', () => {
    const s = schedule({ entries: [newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '10:00', stop: '18:00' })] });
    const h = harness(s, utc('2026-09-26T15:00:00Z'));
    h.runner.tick();
    expect(h.calls).toHaveLength(1);
    // The operator stops the show by hand; the runner keeps quiet until the
    // window ends, then runs its stop (projectors off, blackout).
    h.runUntil(utc('2026-09-26T21:59:30Z'));
    expect(h.calls).toHaveLength(1);
    h.runUntil(utc('2026-09-26T22:00:30Z'));
    expect(h.calls.at(-1)).toBe('stop d@2026-09-26 2026-09-26T22:00:00Z');
  });

  it('warms projectors up ahead of the start, once', () => {
    const s = schedule({
      entries: [newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '10:00', stop: '18:00' })],
      projectorsOn: true,
      projectorLeadMinutes: 10,
    });
    const h = harness(s, utc('2026-09-26T13:00:00Z'));
    h.runUntil(utc('2026-09-26T14:05:00Z'));
    expect(h.calls).toEqual([
      'warm d@2026-09-26 2026-09-26T13:50:00Z',
      'start d@2026-09-26 2026-09-26T14:00:00Z',
    ]);
  });

  it('back-to-back shows stop the first before starting the second', () => {
    const s = schedule({ entries: [
      newScheduleEntry({ id: 'a', days: ALL_DAYS, start: '10:00', stop: '12:00' }),
      newScheduleEntry({ id: 'b', days: ALL_DAYS, start: '12:00', stop: '14:00' }),
    ] });
    const h = harness(s, utc('2026-09-26T13:00:00Z'));
    h.runUntil(utc('2026-09-26T19:00:00Z'));
    expect(h.calls).toEqual([
      'start a@2026-09-26 2026-09-26T14:00:00Z',
      'stop a@2026-09-26 2026-09-26T16:00:00Z',
      'start b@2026-09-26 2026-09-26T16:00:00Z',
      'stop b@2026-09-26 2026-09-26T18:00:00Z',
    ]);
  });

  it('does nothing while disabled', () => {
    const s = schedule({ enabled: false, entries: [newScheduleEntry({ days: ALL_DAYS })] });
    const h = harness(s, utc('2026-09-26T12:00:00Z'));
    h.runUntil(utc('2026-09-27T12:00:00Z'));
    expect(h.calls).toEqual([]);
  });
});

describe('scheduled start and stop drive cues and projectors', () => {
  const servers: Array<{ close(): Promise<void> }> = [];
  let harness: ProjectorHarness | null = null;
  afterEach(async () => {
    harness?.dispose();
    harness = null;
    projectors._resetForTest();
    while (servers.length) await servers.pop()!.close();
  });

  it('the fake projector receives authenticated POWR and AVMT from the scheduler', async () => {
    const server = await startFakePjlink({ password: 'venue' });
    servers.push(server);
    harness = installProjectorHarness();
    const main = projectors.add({ name: 'Main', host: '127.0.0.1', port: server.port });
    await projectors.setPassword(main, 'venue');

    const cues = new CueEngine();
    const fired: string[] = [];
    const blackout: boolean[] = [];
    const pending: Promise<unknown>[] = [];
    cues.setExecutor({
      recallPreset: (id) => fired.push(`preset ${id}`),
      recallSnapshot() {}, triggerClip() {}, triggerColumn() {}, stopAllClips() {},
      setBlackout: (on) => blackout.push(on),
      readValue: () => null, writeValue() {}, timeline() {}, projector() {}, bpm: () => 120,
    });
    const opening = cues.addCue({ name: 'Opening' });
    cues.addAction(opening, 'preset');
    cues.updateAction(opening, cues.state.cues[0].actions[0].id, { compositionId: 'loop' });

    const s = schedule({
      entries: [newScheduleEntry({ id: 'd', days: ALL_DAYS, start: '10:00', stop: '18:00' })],
      projectorsOn: true,
      projectorsOff: true,
      shutter: true,
      blackoutOnStop: true,
    });
    let now = utc('2026-09-26T13:59:00Z');
    const hooks = createScheduleHooks(() => s, {
      cues,
      projector: (target, command) => {
        const p = projectors.command(target, command);
        pending.push(p);
        return p;
      },
      setBlackout: (on) => blackout.push(on),
    });
    const runner = new ScheduleRunner(() => s, hooks, () => now);
    runner.tick();
    expect(server.received).toHaveLength(0);
    now = utc('2026-09-26T14:00:00Z');
    runner.tick();
    await Promise.all(pending.splice(0));
    expect(fired).toEqual(['preset loop']);
    expect(cues.state.history.at(-1)?.source).toBe('schedule');
    now = utc('2026-09-26T22:00:00Z');
    runner.tick();
    await Promise.all(pending.splice(0));

    expect(server.received.map((r: { line: string; authenticated: boolean }) => [r.line, r.authenticated])).toEqual([
      ['%1POWR 1', true],
      ['%1AVMT 30', true],
      ['%1AVMT 31', true],
      ['%1POWR 0', true],
    ]);
    expect(blackout).toEqual([false, true]);
    expect(server.state.power).toBe(0);
  });
});

describe('persistence', () => {
  it('normalises junk and keeps valid entries', () => {
    const s = normalizeSchedule({
      enabled: true,
      entries: [{ id: 'a', days: [1, 1, 9, 3], start: '25:00', stop: '07:15' }, 'junk'],
      exceptions: [{ date: 'tomorrow' }, { id: 'x', date: '2026-10-10', kind: 'hours', start: '09:00', stop: '10:00' }],
      projectorLeadMinutes: 500,
    });
    expect(s.entries).toEqual([{ id: 'a', days: [1, 3], start: '10:00', stop: '07:15', enabled: true }]);
    expect(s.exceptions).toHaveLength(1);
    expect(s.projectorLeadMinutes).toBe(120);
    expect(normalizeSchedule(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
