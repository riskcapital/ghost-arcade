/**
 * Show scheduler: a calendar of show times that starts and stops the show
 * with nobody at the machine.
 *
 * CALENDAR
 * --------
 * Entries are weekly: a set of weekdays (all seven for a daily show) with a
 * start and stop wall-clock time. A stop at or before the start runs past
 * midnight into the next day. Date exceptions override one calendar day:
 * 'closed' cancels every show starting that day, 'hours' replaces them with
 * one show at the given times.
 *
 * WALL CLOCK, NOT DURATIONS
 * -------------------------
 * Every time is local wall-clock time, resolved per day, so a 20:00 show is
 * at 20:00 on both sides of a daylight-saving change. Across the change
 * itself: a time inside the spring-forward gap (02:30 when clocks jump from
 * 02:00 to 03:00) resolves to the first instant after the gap (03:00), and a
 * time that happens twice in the autumn resolves to the first occurrence.
 *
 * EDGE-FREE RUNNER
 * ----------------
 * The runner does not watch for "it is now exactly 19:00". Each tick asks
 * which show window contains now and compares with what it already acted on.
 * That one rule covers a machine that sleeps through a start (it wakes
 * inside the window and starts the show), wakes after a stop (it stops),
 * or sleeps through a whole show (nothing happens), and an app launched
 * mid-show. A window is started at most once, so an operator who stops the
 * show by hand is not overruled on the next tick.
 */

import { writable } from 'svelte/store';
import type { CueEngine } from './cueList';
import type { ProjectorCommand } from './cueList';

export interface ScheduleEntry {
  id: string;
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
  start: string;
  stop: string;
  enabled: boolean;
}

export interface ScheduleException {
  id: string;
  /** YYYY-MM-DD, local. */
  date: string;
  kind: 'closed' | 'hours';
  start: string;
  stop: string;
  note: string;
}

export interface ShowSchedule {
  enabled: boolean;
  entries: ScheduleEntry[];
  exceptions: ScheduleException[];
  /** Cue fired at a show start; null = the first cue. */
  startCueId: string | null;
  /** Cue fired at a show stop, after the list is stopped; null = none. */
  stopCueId: string | null;
  /** Power projectors on at (or before) the start. */
  projectorsOn: boolean;
  /** Minutes before the start to power them on (warm-up). */
  projectorLeadMinutes: number;
  /** Power projectors off at the stop. */
  projectorsOff: boolean;
  /** Open the shutter at the start and close it at the stop. */
  shutter: boolean;
  /** Blackout the output at the stop. */
  blackoutOnStop: boolean;
  /** Open the outputs fullscreen at the start if they are not open. */
  openOutputs: boolean;
}

export interface ShowWindow {
  /** Stable per entry (or exception) and calendar day. */
  key: string;
  start: number;
  end: number;
  sourceId: string;
}

export function defaultSchedule(): ShowSchedule {
  return {
    enabled: false,
    entries: [],
    exceptions: [],
    startCueId: null,
    stopCueId: null,
    projectorsOn: false,
    projectorLeadMinutes: 0,
    projectorsOff: false,
    shutter: false,
    blackoutOnStop: true,
    openOutputs: true,
  };
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseClock(text: string): { h: number; m: number } | null {
  const m = TIME_RE.exec(String(text ?? '').trim());
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

export function formatDateKey(y: number, monthIndex: number, d: number): string {
  return `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Local-date key of an instant. */
export function dateKeyOf(ms: number): string {
  const d = new Date(ms);
  return formatDateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The instant a wall-clock time happens on a local calendar day. Inside a
 * spring-forward gap: the first instant after it. Twice in autumn: the first.
 */
export function wallClockInstant(y: number, monthIndex: number, day: number, h: number, m: number): number {
  const cand = new Date(y, monthIndex, day, h, m, 0, 0);
  if (cand.getHours() === h && cand.getMinutes() === m) return cand.getTime();
  // In a gap the engine has shifted forward by the gap's size. Search back
  // for the transition: the earliest instant whose wall clock on this day is
  // at or past the requested time.
  const wanted = h * 60 + m;
  const wall = (t: number) => {
    const d = new Date(t);
    const sameDay = d.getFullYear() === y && d.getMonth() === monthIndex && d.getDate() === day;
    return sameDay ? d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 : -1;
  };
  let hi = cand.getTime();
  let lo = hi - 3 * 3600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wall(mid) >= wanted) hi = mid;
    else lo = mid;
  }
  return hi;
}

function windowFor(sourceId: string, y: number, mo: number, d: number, start: string, stop: string): ShowWindow | null {
  const s = parseClock(start);
  const e = parseClock(stop);
  if (!s || !e) return null;
  const startMs = wallClockInstant(y, mo, d, s.h, s.m);
  const overnight = e.h * 60 + e.m <= s.h * 60 + s.m;
  const endDay = new Date(y, mo, d + (overnight ? 1 : 0), 12);
  const endMs = wallClockInstant(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), e.h, e.m);
  if (endMs <= startMs) return null;
  return { key: `${sourceId}@${formatDateKey(y, mo, d)}`, start: startMs, end: endMs, sourceId };
}

/** Every show that starts on a local calendar day, earliest first. */
export function windowsStartingOn(schedule: ShowSchedule, y: number, monthIndex: number, day: number): ShowWindow[] {
  const norm = new Date(y, monthIndex, day, 12);
  const Y = norm.getFullYear();
  const M = norm.getMonth();
  const D = norm.getDate();
  const key = formatDateKey(Y, M, D);
  const exception = schedule.exceptions.find((x) => x.date === key);
  if (exception?.kind === 'closed') return [];
  if (exception?.kind === 'hours') {
    const w = windowFor(exception.id, Y, M, D, exception.start, exception.stop);
    return w ? [w] : [];
  }
  const weekday = norm.getDay();
  const out: ShowWindow[] = [];
  for (const entry of schedule.entries) {
    if (!entry.enabled || !entry.days.includes(weekday)) continue;
    const w = windowFor(entry.id, Y, M, D, entry.start, entry.stop);
    if (w) out.push(w);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The window containing `now` (start inclusive, end exclusive), if any.
 *  Overlapping entries: the one that started last wins. */
export function activeWindow(schedule: ShowSchedule, now: number): ShowWindow | null {
  const d = new Date(now);
  let best: ShowWindow | null = null;
  for (const offset of [-1, 0]) {
    for (const w of windowsStartingOn(schedule, d.getFullYear(), d.getMonth(), d.getDate() + offset)) {
      if (now >= w.start && now < w.end && (!best || w.start > best.start)) best = w;
    }
  }
  return best;
}

/** The next window starting after `now`, looking ahead `horizonDays`. */
export function nextWindow(schedule: ShowSchedule, now: number, horizonDays = 15): ShowWindow | null {
  const d = new Date(now);
  for (let k = 0; k <= horizonDays; k++) {
    const found = windowsStartingOn(schedule, d.getFullYear(), d.getMonth(), d.getDate() + k).find((w) => w.start > now);
    if (found) return found;
  }
  return null;
}

// ─── Normalisation ───────────────────────────────────────────────────────

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function normalizeSchedule(raw: unknown): ShowSchedule {
  const d = defaultSchedule();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const entries = (Array.isArray(r.entries) ? r.entries : []).flatMap((e): ScheduleEntry[] => {
    if (!e || typeof e !== 'object') return [];
    const x = e as Record<string, unknown>;
    const days = Array.isArray(x.days)
      ? [...new Set(x.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
      : [];
    return [{
      id: typeof x.id === 'string' && x.id ? x.id : newId(),
      days,
      start: parseClock(String(x.start)) ? String(x.start) : '10:00',
      stop: parseClock(String(x.stop)) ? String(x.stop) : '18:00',
      enabled: x.enabled !== false,
    }];
  });
  const exceptions = (Array.isArray(r.exceptions) ? r.exceptions : []).flatMap((e): ScheduleException[] => {
    if (!e || typeof e !== 'object') return [];
    const x = e as Record<string, unknown>;
    if (typeof x.date !== 'string' || !DATE_RE.test(x.date)) return [];
    return [{
      id: typeof x.id === 'string' && x.id ? x.id : newId(),
      date: x.date,
      kind: x.kind === 'hours' ? 'hours' : 'closed',
      start: parseClock(String(x.start)) ? String(x.start) : '10:00',
      stop: parseClock(String(x.stop)) ? String(x.stop) : '18:00',
      note: typeof x.note === 'string' ? x.note : '',
    }];
  });
  const lead = Number(r.projectorLeadMinutes);
  return {
    enabled: r.enabled === true,
    entries,
    exceptions,
    startCueId: typeof r.startCueId === 'string' && r.startCueId ? r.startCueId : null,
    stopCueId: typeof r.stopCueId === 'string' && r.stopCueId ? r.stopCueId : null,
    projectorsOn: r.projectorsOn === true,
    projectorLeadMinutes: Number.isFinite(lead) ? Math.max(0, Math.min(120, lead)) : 0,
    projectorsOff: r.projectorsOff === true,
    shutter: r.shutter === true,
    blackoutOnStop: r.blackoutOnStop !== false,
    openOutputs: r.openOutputs !== false,
  };
}

export function newScheduleEntry(init: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return { id: newId(), days: [0, 1, 2, 3, 4, 5, 6], start: '10:00', stop: '18:00', enabled: true, ...init };
}

export function newScheduleException(init: Partial<ScheduleException> = {}): ScheduleException {
  return { id: newId(), date: dateKeyOf(Date.now()), kind: 'closed', start: '10:00', stop: '18:00', note: '', ...init };
}

// ─── Runner ──────────────────────────────────────────────────────────────

export type ScheduleEventType = 'start' | 'stop' | 'projectors-on';

export interface ScheduleEvent {
  type: ScheduleEventType;
  window: ShowWindow;
  at: number;
}

export interface ScheduleHooks {
  start(window: ShowWindow): void;
  stop(window: ShowWindow): void;
  projectorsOn(window: ShowWindow): void;
}

function handledKey(w: ShowWindow): string {
  return `${w.key}|${w.start}`;
}

export class ScheduleRunner {
  private started: ShowWindow | null = null;
  private readonly handled = new Set<string>();
  private warmedKey: string | null = null;
  readonly log: ScheduleEvent[] = [];

  constructor(
    private readonly getSchedule: () => ShowSchedule,
    private readonly hooks: ScheduleHooks,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get running(): ShowWindow | null {
    return this.started;
  }

  /** Forget everything (a new project was opened). */
  reset(): void {
    this.started = null;
    this.handled.clear();
    this.warmedKey = null;
  }

  tick(): ScheduleEvent[] {
    const schedule = this.getSchedule();
    const now = this.now();
    const events: ScheduleEvent[] = [];
    const emit = (type: ScheduleEventType, window: ShowWindow, run: () => void) => {
      const ev = { type, window, at: now };
      events.push(ev);
      this.log.push(ev);
      if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
      try {
        run();
      } catch (err) {
        console.warn(`[Scheduler] ${type} failed:`, err);
      }
    };
    if (!schedule.enabled) {
      // Switching the scheduler off does not stop a running show; it only
      // stops the scheduler from touching it again.
      this.started = null;
      return events;
    }
    const active = activeWindow(schedule, now);
    if (this.started && (!active || active.key !== this.started.key)) {
      const w = this.started;
      this.started = null;
      emit('stop', w, () => this.hooks.stop(w));
    }
    // Handled is remembered per window START, not just per entry and day:
    // moving today's start later (or typing through a time, which commits
    // each intermediate value) must still fire at the new time. A show that
    // is running keeps running when only its times change.
    if (this.started && active && active.key === this.started.key) {
      this.started = active;
      this.handled.add(handledKey(active));
    }
    if (active && !this.handled.has(handledKey(active))) {
      this.handled.add(handledKey(active));
      this.started = active;
      this.warmedKey = active.key;
      emit('start', active, () => this.hooks.start(active));
    }
    if (schedule.projectorsOn && schedule.projectorLeadMinutes > 0) {
      const upcoming = nextWindow(schedule, now, 2);
      const leadMs = schedule.projectorLeadMinutes * 60_000;
      if (upcoming && now >= upcoming.start - leadMs && now < upcoming.start && this.warmedKey !== upcoming.key) {
        this.warmedKey = upcoming.key;
        emit('projectors-on', upcoming, () => this.hooks.projectorsOn(upcoming));
      }
    }
    // Keep the handled set small: drop windows that ended over a day ago.
    if (this.handled.size > 64) {
      const cutoff = now - 2 * 86400_000;
      for (const key of [...this.handled]) {
        const date = key.split('@')[1]?.split('|')[0];
        const m = DATE_RE.exec(date ?? '');
        if (m && new Date(+m[1], +m[2] - 1, +m[3]).getTime() < cutoff) this.handled.delete(key);
      }
    }
    return events;
  }
}

// ─── Standard hooks ──────────────────────────────────────────────────────

export interface ScheduleActionDeps {
  cues: Pick<CueEngine, 'fire' | 'go' | 'stop' | 'state'>;
  projector(target: string, command: ProjectorCommand): unknown;
  setBlackout(on: boolean): void;
  /** Extra start work, e.g. opening the outputs. */
  onStart?(): void;
}

/** What a scheduled start and stop do, from the schedule's options. */
export function createScheduleHooks(getSchedule: () => ShowSchedule, deps: ScheduleActionDeps): ScheduleHooks {
  const run = (fn: () => unknown) => {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch((e) => console.warn('[Scheduler]', e));
    } catch (err) {
      console.warn('[Scheduler]', err);
    }
  };
  return {
    projectorsOn() {
      run(() => deps.projector('*', 'power-on'));
    },
    start() {
      const s = getSchedule();
      if (s.projectorsOn && s.projectorLeadMinutes <= 0) run(() => deps.projector('*', 'power-on'));
      if (s.shutter) run(() => deps.projector('*', 'shutter-open'));
      // Undo the blackout the previous scheduled stop left behind.
      if (s.blackoutOnStop) run(() => deps.setBlackout(false));
      if (s.openOutputs) run(() => deps.onStart?.());
      const cueId = s.startCueId && deps.cues.state.cues.some((c) => c.id === s.startCueId)
        ? s.startCueId
        : deps.cues.state.cues[0]?.id ?? null;
      if (cueId) run(() => deps.cues.fire(cueId, 'schedule'));
    },
    stop() {
      const s = getSchedule();
      run(() => deps.cues.stop());
      if (s.stopCueId && deps.cues.state.cues.some((c) => c.id === s.stopCueId)) {
        run(() => deps.cues.fire(s.stopCueId!, 'schedule'));
        // A stop cue is a last look, not the start of another run.
        run(() => deps.cues.stop());
      }
      if (s.blackoutOnStop) run(() => deps.setBlackout(true));
      if (s.shutter) run(() => deps.projector('*', 'shutter-close'));
      if (s.projectorsOff) run(() => deps.projector('*', 'power-off'));
    },
  };
}

/** The open project's schedule. Saved with the project. */
export const showSchedule = writable<ShowSchedule>(defaultSchedule());
