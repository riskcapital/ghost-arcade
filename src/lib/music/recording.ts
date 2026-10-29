/**
 * Recording and replay of a performance.
 *
 * A take is the note events of a performance, timed in seconds from the
 * start of the take, plus a copy of the beat pattern that was loaded. Every
 * note the performer heard is in the events, the step sequencer's included,
 * so replaying the events alone reproduces the song and, through the note
 * visuals, its pictures. The pattern copy lets the beat be loaded back into
 * the sequencer to keep working on it.
 *
 * Everything here is pure: the studio feeds it clock times.
 */

import { INSTRUMENTS, clampNote, clampVelocity, type InstrumentId, type NoteEvent } from './noteEvents';
import { normalizePattern, type DrumPattern } from './drumPattern';

export interface TakeEvent {
  /** Seconds from the start of the take. */
  t: number;
  type: 'on' | 'off';
  instrument: InstrumentId;
  note: number;
  velocity: number;
}

export interface Take {
  id: string;
  name: string;
  /** ms since epoch. */
  createdAt: number;
  /** Seconds. */
  length: number;
  /** Tempo while recording, for display and for later beat-aware editing. */
  bpm: number;
  events: TakeEvent[];
  pattern: DrumPattern | null;
}

/** Shortest take worth keeping, in seconds. */
export const MIN_TAKE_SECONDS = 0.25;

function noteKey(instrument: InstrumentId, note: number): string {
  return `${instrument}:${note}`;
}

export class TakeRecorder {
  private startTime: number | null = null;
  private events: TakeEvent[] = [];
  private held = new Map<string, number>();

  get recording(): boolean {
    return this.startTime !== null;
  }

  /** Seconds recorded so far. */
  elapsed(now: number): number {
    return this.startTime === null ? 0 : Math.max(0, now - this.startTime);
  }

  start(now: number): void {
    this.startTime = now;
    this.events = [];
    this.held.clear();
  }

  /** Record an event. Replayed notes are left out so a replay is not recorded into itself. */
  capture(event: NoteEvent): void {
    if (this.startTime === null || event.source === 'replay') return;
    const t = Math.max(0, event.time - this.startTime);
    const key = noteKey(event.instrument, event.note);
    if (event.type === 'on') {
      // A retrigger of a held note closes the old one first, so every on has its off.
      if (event.instrument !== 'drums' && (this.held.get(key) ?? 0) > 0) {
        this.events.push({ t, type: 'off', instrument: event.instrument, note: event.note, velocity: 0 });
        this.held.set(key, 0);
      }
      this.events.push({ t, type: 'on', instrument: event.instrument, note: event.note, velocity: event.velocity });
      if (event.instrument !== 'drums') this.held.set(key, 1);
      return;
    }
    if (event.instrument === 'drums') return;
    // An off for a note pressed before recording started has nothing to close.
    if ((this.held.get(key) ?? 0) === 0) return;
    this.held.set(key, 0);
    this.events.push({ t, type: 'off', instrument: event.instrument, note: event.note, velocity: 0 });
  }

  /** Finish the take. Notes still held end at the stop. Returns null for an empty or tiny take. */
  stop(now: number, meta: { id: string; name: string; bpm: number; pattern: DrumPattern | null; createdAt?: number }): Take | null {
    if (this.startTime === null) return null;
    const length = Math.max(0, now - this.startTime);
    for (const [key, count] of this.held) {
      if (count <= 0) continue;
      const [instrument, note] = key.split(':');
      this.events.push({ t: length, type: 'off', instrument: instrument as InstrumentId, note: Number(note), velocity: 0 });
    }
    const events = sortTakeEvents(this.events);
    this.startTime = null;
    this.events = [];
    this.held.clear();
    if (length < MIN_TAKE_SECONDS || !events.some((e) => e.type === 'on')) return null;
    return {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt ?? Date.now(),
      length,
      bpm: meta.bpm,
      events,
      pattern: meta.pattern ? normalizePattern(meta.pattern) : null,
    };
  }

  cancel(): void {
    this.startTime = null;
    this.events = [];
    this.held.clear();
  }
}

/** Time order; at the same instant offs go first so a retrigger is not cut short. */
export function sortTakeEvents(events: TakeEvent[]): TakeEvent[] {
  return [...events].sort((a, b) => a.t - b.t || (a.type === b.type ? 0 : a.type === 'off' ? -1 : 1));
}

/**
 * Events of a take whose time falls in [from, to), as music-clock times.
 * The take starts at `origin`; with `loop` it repeats every `take.length`.
 */
export function takeEventsBetween(
  take: Take,
  origin: number,
  from: number,
  to: number,
  loop: boolean,
): Array<TakeEvent & { time: number }> {
  if (!(to > from) || take.events.length === 0) return [];
  const out: Array<TakeEvent & { time: number }> = [];
  const length = take.length;
  const firstPass = loop && length > 0 ? Math.max(0, Math.floor((from - origin) / length)) : 0;
  const lastPass = loop && length > 0 ? Math.floor((to - origin) / length) : 0;
  for (let pass = firstPass; pass <= lastPass; pass++) {
    const passStart = origin + pass * length;
    for (const event of take.events) {
      // On a loop, an off at the very end belongs to this pass, an on at the
      // very end would sound at the start of the next one.
      if (loop && event.type === 'on' && event.t >= length) continue;
      const time = passStart + event.t;
      if (time >= from && time < to) out.push({ ...event, time });
    }
  }
  return out;
}

/** Count of notes in a take (note-ons). */
export function takeNoteCount(take: Take): number {
  return take.events.reduce((n, e) => n + (e.type === 'on' ? 1 : 0), 0);
}

/** Read a take back from a project file, dropping anything malformed. */
export function normalizeTake(raw: unknown): Take | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<Take>;
  if (typeof input.id !== 'string' || !input.id) return null;
  const events: TakeEvent[] = [];
  for (const e of Array.isArray(input.events) ? input.events : []) {
    if (!e || typeof e !== 'object') continue;
    const ev = e as Partial<TakeEvent>;
    if (ev.type !== 'on' && ev.type !== 'off') continue;
    if (!INSTRUMENTS.includes(ev.instrument as InstrumentId)) continue;
    const t = Number(ev.t);
    if (!Number.isFinite(t) || t < 0) continue;
    events.push({
      t,
      type: ev.type,
      instrument: ev.instrument as InstrumentId,
      note: clampNote(Number(ev.note) || 0),
      velocity: ev.type === 'on' ? clampVelocity(Number(ev.velocity)) : 0,
    });
  }
  const sorted = sortTakeEvents(events);
  const lastEvent = sorted.length ? sorted[sorted.length - 1].t : 0;
  const length = Math.max(Number(input.length) || 0, lastEvent);
  return {
    id: input.id,
    name: typeof input.name === 'string' && input.name ? input.name : 'Take',
    createdAt: Number(input.createdAt) || 0,
    length,
    bpm: Number(input.bpm) > 0 ? Number(input.bpm) : 120,
    events: sorted,
    pattern: input.pattern ? normalizePattern(input.pattern) : null,
  };
}
