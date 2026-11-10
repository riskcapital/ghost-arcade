/**
 * Install mode: the installation's daily on/off times.
 *
 * One row per weekday: on or not, and the times it switches on and off. An
 * off time at or before the on time runs past midnight into the next day
 * (on 18:00, off 02:00 is one evening). The maths is the show scheduler's
 * (src/lib/show/scheduler.ts): local wall-clock times resolved per day, so
 * 10:00 is 10:00 on both sides of a daylight-saving change, a time inside the
 * spring-forward gap resolves to the first instant after it, and a time that
 * happens twice in autumn resolves to the first occurrence.
 *
 * This schedule belongs to the machine (it is saved with the install-mode
 * settings, not with the project), and it switches the whole installation:
 * projectors, outputs, LEDs and the show. The project's own Schedule
 * (Settings > Show control) still fires cues if it is switched on.
 */

import { activeWindow, nextWindow, parseClock, type ScheduleEntry, type ShowSchedule, type ShowWindow, defaultSchedule } from '../show/scheduler';

export interface InstallDay {
  enabled: boolean;
  /** HH:MM, local. */
  on: string;
  /** HH:MM, local. At or before `on`: the next day. */
  off: string;
}

export interface InstallSchedule {
  /** Off: the installation is on all the time. */
  enabled: boolean;
  /** Index 0 = Sunday ... 6 = Saturday (Date.getDay()). */
  days: InstallDay[];
  /** Power the projectors on and off over PJLink (Settings > Projectors). */
  projectorPower: boolean;
  /** Seconds between powering the projectors on and starting the show. */
  warmupSeconds: number;
  /** Open the shutter at the start and close it at the end. */
  shutter: boolean;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function defaultInstallSchedule(): InstallSchedule {
  return {
    enabled: false,
    days: Array.from({ length: 7 }, () => ({ enabled: true, on: '10:00', off: '18:00' })),
    projectorPower: false,
    warmupSeconds: 60,
    shutter: false,
  };
}

export function normalizeInstallSchedule(raw: unknown): InstallSchedule {
  const d = defaultInstallSchedule();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const rawDays = Array.isArray(r.days) ? r.days : [];
  const days = d.days.map((def, i) => {
    const x = rawDays[i];
    if (!x || typeof x !== 'object') return def;
    const o = x as Record<string, unknown>;
    return {
      enabled: o.enabled !== false,
      on: parseClock(String(o.on)) ? String(o.on) : def.on,
      off: parseClock(String(o.off)) ? String(o.off) : def.off,
    };
  });
  const warm = Number(r.warmupSeconds);
  return {
    enabled: r.enabled === true,
    days,
    projectorPower: r.projectorPower === true,
    warmupSeconds: Number.isFinite(warm) ? Math.max(0, Math.min(600, Math.round(warm))) : d.warmupSeconds,
    shutter: r.shutter === true,
  };
}

/** The same days as show-scheduler entries, so its DST maths applies. */
export function installScheduleAsShowSchedule(s: InstallSchedule): ShowSchedule {
  const entries: ScheduleEntry[] = s.days.map((day, i) => ({
    id: `day${i}`,
    days: [i],
    start: day.on,
    stop: day.off,
    enabled: day.enabled,
  }));
  return { ...defaultSchedule(), enabled: true, entries };
}

export interface InstallScheduleState {
  /** The installation should be running now. */
  on: boolean;
  /** The on period containing now; null when off or when the schedule is off. */
  window: ShowWindow | null;
  /** The next switch (on or off), or null when there is none in two weeks. */
  next: { at: number; on: boolean } | null;
}

export function installScheduleState(s: InstallSchedule, now: number): InstallScheduleState {
  if (!s.enabled) return { on: true, window: null, next: null };
  const show = installScheduleAsShowSchedule(s);
  const active = activeWindow(show, now);
  if (active) {
    // Back-to-back days (off 00:00, next on 00:00) are one long on period:
    // look for the window that starts exactly where this one ends.
    let end = active.end;
    for (let i = 0; i < 8; i++) {
      const following = activeWindow(show, end);
      if (!following || following.end <= end) break;
      end = following.end;
    }
    return { on: true, window: active, next: { at: end, on: false } };
  }
  const upcoming = nextWindow(show, now, 15);
  return { on: false, window: null, next: upcoming ? { at: upcoming.start, on: true } : null };
}
