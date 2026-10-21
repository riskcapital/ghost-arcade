/**
 * Timing and mapping for the deeper Ableton links:
 *
 *  - Visual score: a MIDI track in Live whose notes fire visuals. Each pitch
 *    maps to a visual; notes are scheduled from Live's song position.
 *  - Locators: arrangement markers fire their visuals as the song passes.
 *  - Signals: continuous values from Live (a device knob, a track's level,
 *    how far a clip is through its loop, the colour of what just launched)
 *    drive any Ghost Arcade control.
 */

import type { LiveCue, ScoreNote, VisualAction } from './abletonLinks';

// ── Visual score ─────────────────────────────────────────────────────────

/** Tracks named like this are visual score tracks without being marked. */
export function isScoreTrackName(name: string): boolean {
  return /\b(ghost ?arcade|visuals?)\b/i.test(name);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Note name as Live shows it: middle C (60) is C3. */
export function noteName(pitch: number): string {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 2}`;
}

/** Lowest pitch of the default column lanes (C1) and snapshot lanes (C3). */
export const SCORE_COLUMN_BASE = 36;
export const SCORE_SNAPSHOT_BASE = 60;

/** What a pitch fires when the score map doesn't say: C1 upward are the
 *  deck A columns, C3 upward the 16 snapshots. */
export function defaultScoreAction(pitch: number, columns: number): VisualAction | null {
  const column = pitch - SCORE_COLUMN_BASE;
  if (column >= 0 && column < Math.min(columns, SCORE_SNAPSHOT_BASE - SCORE_COLUMN_BASE)) {
    return { kind: 'column', deck: 'A', column };
  }
  const slot = pitch - SCORE_SNAPSHOT_BASE;
  if (slot >= 0 && slot < 16) return { kind: 'snapshot', slot };
  return null;
}

export interface DueNote { note: ScoreNote; /** Elapsed beats since the clip started. */ at: number }

/**
 * Notes whose start falls in [from, to), counting elapsed beats since the
 * clip started. The loop repeats every `length` beats, so a window can cover
 * a wrap (or several, after a stall).
 */
export function notesDue(notes: ScoreNote[], from: number, to: number, length: number): DueNote[] {
  if (!(length > 0) || to <= from || !notes.length) return [];
  const due: DueNote[] = [];
  const first = Math.floor(from / length);
  const last = Math.floor(to / length);
  for (let loop = first; loop <= last; loop++) {
    const base = loop * length;
    for (const note of notes) {
      const at = base + note[1];
      if (at >= from && at < to) due.push({ note, at });
    }
  }
  return due.sort((a, b) => a.at - b.at);
}

// ── Locators ─────────────────────────────────────────────────────────────

/** Beyond this the song position jumped rather than played on. */
const MAX_STEP_BEATS = 2;

/**
 * Locators to fire as the song moves from `prev` to `cur`: those passed
 * while playing on, or the one landed on by a jump (Live jumps exactly to a
 * locator when one is clicked).
 */
export function locatorsReached(cues: LiveCue[], prev: number, cur: number): number[] {
  const playedOn = cur >= prev && cur - prev <= MAX_STEP_BEATS;
  return cues.flatMap((cue, index) => {
    if (playedOn) return cue.time > prev && cue.time <= cur ? [index] : [];
    return Math.abs(cue.time - cur) < 0.05 ? [index] : [];
  });
}

// ── Signals ──────────────────────────────────────────────────────────────

export type SignalSource =
  /** A device parameter; track -1 is the master track. */
  | { kind: 'param'; track: number; device: number; param: number; trackName: string; deviceName: string; paramName: string }
  /** A track's output level. */
  | { kind: 'level'; track: number; trackName: string }
  /** How far the playing clip on a track is through its loop. */
  | { kind: 'phrase'; track: number; trackName: string }
  /** The hue of the scene (track -1) or clip that launched last. */
  | { kind: 'color'; track: number; trackName: string };

export interface SignalTarget { path: string; label: string; min: number; max: number }

export interface SignalLink {
  id: string;
  source: SignalSource;
  target: SignalTarget;
  invert: boolean;
  /** 0 = instant, 1 = slow glide. */
  smooth: number;
}

/** Map a 0..1 source value onto the target's range. */
export function signalOutput(value: number, link: Pick<SignalLink, 'invert' | 'target'>): number {
  const v = Math.max(0, Math.min(1, link.invert ? 1 - value : value));
  return link.target.min + v * (link.target.max - link.target.min);
}

/** One-pole smoothing: move `current` toward `next` over `dt` seconds. */
export function smoothToward(current: number, next: number, smooth: number, dt: number): number {
  if (smooth <= 0) return next;
  const tau = smooth * 0.6;
  return current + (next - current) * (1 - Math.exp(-dt / tau));
}

/** Hue (0..1) of a Live 0xRRGGBB colour. */
export function colorHue(color: number): number {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60 + 360) % 360) / 360;
}

/** The recent span of a track's level, for auto-ranging. */
export interface LevelRange { lo: number; hi: number }

/**
 * Fold a new level reading into its range and return it scaled to 0..1.
 * Live's meters are smoothed and sit high on loud tracks (a kick drum
 * hovers around 0.7-0.9), so a fixed curve pins at full. The range follows
 * the track's own recent quietest and loudest instead, easing back over
 * about 15 seconds, so the signal always uses its whole sweep.
 */
export function autoRange(range: LevelRange, level: number): number {
  const v = Math.max(0, level);
  range.hi = Math.max(v, range.hi - 0.002);
  range.lo = Math.min(v, range.lo + 0.002);
  return Math.max(0, Math.min(1, (v - range.lo) / Math.max(0.08, range.hi - range.lo)));
}

export function sanitizeSignals(raw: unknown): SignalLink[] {
  if (!Array.isArray(raw)) return [];
  const out: SignalLink[] = [];
  for (const item of raw as any[]) {
    const s = item?.source;
    const t = item?.target;
    if (typeof item?.id !== 'string' || typeof t?.path !== 'string') continue;
    const track = Number.isInteger(s?.track) ? s.track : null;
    if (track === null) continue;
    const trackName = String(s.trackName ?? '');
    let source: SignalSource | null = null;
    if (s.kind === 'param' && Number.isInteger(s.device) && Number.isInteger(s.param)) {
      source = { kind: 'param', track, device: s.device, param: s.param, trackName, deviceName: String(s.deviceName ?? ''), paramName: String(s.paramName ?? '') };
    } else if (s.kind === 'level' || s.kind === 'phrase' || s.kind === 'color') {
      source = { kind: s.kind, track, trackName };
    }
    if (!source) continue;
    const min = Number.isFinite(t.min) ? t.min : 0;
    const max = Number.isFinite(t.max) ? t.max : 1;
    out.push({
      id: item.id,
      source,
      target: { path: t.path, label: String(t.label ?? t.path), min, max },
      invert: !!item.invert,
      smooth: Math.max(0, Math.min(1, Number(item.smooth) || 0)),
    });
  }
  return out;
}
