/*
 * Whether the render core is showing a camera's or screen capture's picture,
 * per capture session.
 *
 * MediaTray called a camera "Live" as soon as the addon produced a frame, so
 * a camera the core could not open (Windows, two GPUs) read as live with a
 * blank layer. The sync now reports what happened to the frames it sends:
 *
 *   (nothing yet) -> sent -> imported      the core shows it
 *                         -> rejected      it cannot, with the reason
 *   rejected -> imported                   it works again
 *
 * The store changes only on those transitions, never per frame.
 */
import { writable, type Readable } from 'svelte/store';

export type LiveCaptureImportState =
  | { state: 'sent' }
  | { state: 'imported' }
  | { state: 'rejected'; message: string };

/** Sessions remembered at once; the oldest is forgotten first. */
export const LIVE_CAPTURE_IMPORT_STATE_MAX = 64;

// Read on every upload, so kept here rather than read back from the store.
let states: ReadonlyMap<string, LiveCaptureImportState> = new Map();
const store = writable<ReadonlyMap<string, LiveCaptureImportState>>(states);

export const liveCaptureImportStates: Readable<ReadonlyMap<string, LiveCaptureImportState>> = { subscribe: store.subscribe };

function same(a: LiveCaptureImportState | undefined, b: LiveCaptureImportState): boolean {
  if (!a || a.state !== b.state) return false;
  return a.state !== 'rejected' || a.message === (b as { message: string }).message;
}

/** The transition from `previous` on this event, or null when nothing changes. */
export function nextLiveCaptureImportState(
  previous: LiveCaptureImportState | undefined,
  event: { type: 'sent' } | { type: 'imported' } | { type: 'rejected'; message: string },
): LiveCaptureImportState | null {
  let next: LiveCaptureImportState;
  if (event.type === 'sent') {
    // A retry of a rejected or an already-imported source is not news.
    if (previous) return null;
    next = { state: 'sent' };
  } else if (event.type === 'imported') {
    next = { state: 'imported' };
  } else {
    next = { state: 'rejected', message: event.message };
  }
  return same(previous, next) ? null : next;
}

function apply(sessionId: string, event: Parameters<typeof nextLiveCaptureImportState>[1]): void {
  if (!sessionId) return;
  const next = nextLiveCaptureImportState(states.get(sessionId), event);
  if (!next) return;
  const map = new Map(states);
  map.delete(sessionId);
  map.set(sessionId, next);
  while (map.size > LIVE_CAPTURE_IMPORT_STATE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  states = map;
  store.set(map);
}

export function noteLiveCaptureSent(sessionId: string): void {
  apply(sessionId, { type: 'sent' });
}

export function noteLiveCaptureImported(sessionId: string): void {
  apply(sessionId, { type: 'imported' });
}

export function noteLiveCaptureRejected(sessionId: string, message: string): void {
  apply(sessionId, { type: 'rejected', message });
}

/** The session was stopped. */
export function forgetLiveCaptureSession(sessionId: string): void {
  if (!states.has(sessionId)) return;
  const map = new Map(states);
  map.delete(sessionId);
  states = map;
  store.set(map);
}

export type LiveCaptureStatusLabel = { label: string; tone: 'live' | 'connecting' | 'error' | 'ready'; title?: string };

/**
 * What MediaTray shows for a native camera or capture whose addon is
 * producing frames: "Ready" until it is on a layer, "Starting…" until the
 * core has shown a frame, then "Live" -- or "No picture" with the reason.
 */
export function liveCaptureStatusLabel(state: LiveCaptureImportState | undefined): LiveCaptureStatusLabel {
  if (!state) return { label: 'Ready', tone: 'ready' };
  if (state.state === 'sent') return { label: 'Starting…', tone: 'connecting' };
  if (state.state === 'imported') return { label: 'Live', tone: 'live' };
  return { label: 'No picture', tone: 'error', title: state.message };
}
