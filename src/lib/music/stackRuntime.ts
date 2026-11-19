/**
 * The clip visual stacks playing now (clipStack.ts): one per track whose
 * clip has visuals, studio session tracks and Ableton Live tracks alike.
 *
 * A clip starting on a track brings its stack in and fades the track's
 * previous one out (a crossfade, not a cut); a track stopping fades its
 * stack out. Other tracks' stacks keep playing, so firing a row layers every
 * clip's stack, in track order.
 *
 * Entries look their stack up each frame rather than copy it, so editing a
 * playing clip's visuals shows at once. Levels are worked out from time, so
 * a fade does not touch the store; the store changes only when a stack comes
 * or goes (the "Now playing" panel follows it).
 */
import { writable, get } from 'svelte/store';
import type { ClipStack } from './clipStack';
import { hasVisuals } from './clipStack';

/** Fade time of a stack coming in or going, ms. */
export const STACK_FADE_MS = 480;

export interface StackEntry {
  /** Unique per entry: its layers' ids are made from it, so a clip that comes back does not reuse a fading copy's layers. */
  uid: string;
  /** The track it plays on: "studio:<track>" or "live:<track name>". */
  track: string;
  /** Track order: lower draws first (under). */
  order: number;
  trackName: string;
  clipName: string;
  /** Where the clip's stack lives now (the session clip, the Live clip's key). */
  resolve: () => ClipStack | undefined;
  /** For editing: the session clip id, or the Live clip's stack key. */
  clipId?: string;
  liveKey?: string;
  /** The fade: from `from` at `at` to `to` over `ms`. */
  from: number;
  to: number;
  at: number;
  ms: number;
}

const entries = writable<StackEntry[]>([]);
/** The stacks playing (or fading out), bottom first. */
export const playingStacks = { subscribe: entries.subscribe };

let seq = 0;
let clock = (): number => performance.now();
/** Tests run on their own clock. */
export function setStackClock(now: () => number): void {
  clock = now;
}

export function stackLevel(e: Pick<StackEntry, 'from' | 'to' | 'at' | 'ms'>, now = clock()): number {
  const t = e.ms > 0 ? Math.max(0, Math.min(1, (now - e.at) / e.ms)) : 1;
  return e.from + (e.to - e.from) * t;
}

const leaving = (e: StackEntry) => e.to === 0;

/** A clip starts on a track: its stack comes in, and the track's previous one goes. */
export function bringStack(entry: Omit<StackEntry, 'uid' | 'from' | 'to' | 'at' | 'ms'>, fadeMs = STACK_FADE_MS): void {
  const now = clock();
  entries.update((list) => {
    const kept = list.map((e) => (e.track === entry.track && !leaving(e) ? { ...e, from: stackLevel(e, now), to: 0, at: now, ms: fadeMs } : e));
    // The same clip again on its track: it stays as it is.
    const same = list.find((e) => e.track === entry.track && !leaving(e) && e.clipId === entry.clipId && e.liveKey === entry.liveKey);
    if (same) return list;
    const next: StackEntry = { ...entry, uid: `s${++seq}`, from: 0, to: 1, at: now, ms: fadeMs };
    return [...kept, next].sort((a, b) => a.order - b.order);
  });
}

/** A track stops: its stack goes. */
export function dropStack(track: string, fadeMs = STACK_FADE_MS): void {
  const now = clock();
  entries.update((list) => list.map((e) => (e.track === track && !leaving(e) ? { ...e, from: stackLevel(e, now), to: 0, at: now, ms: fadeMs } : e)));
}

/** Every track whose key starts with `prefix` lets its stack go (Live disconnecting: "live:"). */
export function dropTracks(prefix: string, fadeMs = STACK_FADE_MS): void {
  const now = clock();
  entries.update((list) => list.map((e) => (e.track.startsWith(prefix) && !leaving(e) ? { ...e, from: stackLevel(e, now), to: 0, at: now, ms: fadeMs } : e)));
}

/** Everything stops at once (a new project, the studio closing). */
export function clearStacks(): void {
  entries.set([]);
}

// ── Audition: the stack being edited plays on top while its editor is open ──

let audition: { resolve: () => ClipStack | undefined; solo: boolean } | null = null;
const AUDITION: StackEntry = { uid: 'audition', track: 'audition', order: 1e9, trackName: '', clipName: '', resolve: () => undefined, from: 1, to: 1, at: 0, ms: 0 };

/** Play a stack on top of everything (`solo`: on its own) while it is being edited; null stops. */
export function auditionStack(resolve: (() => ClipStack | undefined) | null, solo = false): void {
  audition = resolve ? { resolve, solo } : null;
}
/** The audition hides the studio's own voices and the other playing stacks. */
export const auditionSolo = () => !!audition?.solo;

/** What draws this frame: each live entry with its stack and level, bottom first. Finished fades are dropped. */
export function currentStacks(now = clock()): Array<{ entry: StackEntry; stack: ClipStack; level: number }> {
  const auditioned = audition?.resolve();
  const top = hasVisuals(auditioned) ? [{ entry: AUDITION, stack: auditioned, level: 1 }] : [];
  if (audition?.solo) return top;
  const list = get(entries);
  if (!list.length) return top;
  const done = list.filter((e) => leaving(e) && stackLevel(e, now) <= 0);
  if (done.length) entries.set(list.filter((e) => !done.includes(e)));
  const out: Array<{ entry: StackEntry; stack: ClipStack; level: number }> = [];
  for (const entry of list) {
    if (done.includes(entry)) continue;
    const stack = entry.resolve();
    const level = stackLevel(entry, now);
    if (hasVisuals(stack) && level > 0) out.push({ entry, stack, level });
  }
  return [...out, ...top];
}

/** The stacks playing and staying (not fading out), for the "Now playing" panel. */
export const stayingStacks = (list: StackEntry[]) => list.filter((e) => !leaving(e));
