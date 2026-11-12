/**
 * Live edit: one switch for "what I change goes onto the Timeline".
 *
 * On, it arms the line recorder with Follow edits (timelineLines.ts), so
 * every setting changed in the editor (Mapping, the panels, a controller)
 * lands on the Timeline:
 *
 *   - while the Timeline plays, it is recorded as it happens (the
 *     recorder's Touch or Latch pass, as before);
 *   - while it is parked, it is HELD: the change shows on the stage at once
 *     (a held value wins over its line, see `heldTouches`), but nothing is
 *     keyed until Update keys every held change at the playhead it was made
 *     at, together. Discard goes back to before the first held change,
 *     through the undo history, so it can be redone.
 *
 * Content swaps on a piece are held the same way (the content recorder's
 * cut-ins). Off is exactly the recorder disarmed: Live edit is "Rec lines +
 * Follow edits", and either control shows the same state.
 */
import { derived, get, writable } from 'svelte/store';
import { sameTarget, targetId, type ParamTarget } from './lines/paramRegistry';
import { showTimeline } from '../stores/showTimeline';
import { history } from '../stores/history';
import { flushPendingHistorySnapshot, recordDiscreteAction } from '../stores/historyHooks';
import type { ShowClipMedia } from '../types';

export interface HeldParamEdit {
  kind: 'param';
  id: string;
  target: ParamTarget;
  key: string;
  value: number | boolean;
  /** Where the playhead was when it was changed: where Update keys it. */
  t: number;
}

export interface HeldContentEdit {
  kind: 'content';
  id: string;
  trackId: string;
  media: ShowClipMedia;
  before: ShowClipMedia | null;
  t: number;
}

export type HeldEdit = HeldParamEdit | HeldContentEdit;

export interface LiveEditHooks {
  /** Key a parameter at a time (timelineLines' keyAtPlayhead). */
  keyAt(target: ParamTarget, key: string, value: number | boolean, t: number): void;
  /** Cut content in on a row at a time (the content recorder's swap). */
  cutIn(trackId: string, media: ShowClipMedia, t: number, before: ShowClipMedia | null): void;
  /** One app-level undo step (App's handleUndo); false when there is none. */
  undo(): boolean;
  /** Arm or disarm the recorder with Follow edits. */
  setArmed(on: boolean): void;
}

let hooks: LiveEditHooks | null = null;

/** Wired by the app at start (App.svelte and timelineLines.ts). */
export function installLiveEditHooks(next: Partial<LiveEditHooks>): void {
  hooks = { ...(hooks ?? ({} as LiveEditHooks)), ...next };
}

/** Is Live edit on: the recorder armed with Follow edits. Set by timelineLines. */
export const liveEditOn = writable(false);

/** Changes made while parked, waiting for Update. */
export const heldEdits = writable<HeldEdit[]>([]);

/** The history step before the first held change: where Discard goes back to. */
let heldFrom: number | null = null;

export const liveEdit = derived([liveEditOn, heldEdits], ([$on, $held]) => ({ on: $on, held: $held }));

export function setLiveEdit(on: boolean): void {
  hooks?.setArmed(on);
}

/** A parked parameter change while Live edit is on: held, not keyed. Returns false when Live edit is off. */
export function holdParamEdit(target: ParamTarget, key: string, value: number | boolean, t: number): boolean {
  if (!get(liveEditOn)) return false;
  markStart();
  heldEdits.update((list) => {
    const id = `param|${targetId(target)}|${key}`;
    const next: HeldParamEdit = { kind: 'param', id, target, key, value, t };
    const at = list.findIndex((e) => e.id === id);
    if (at < 0) return [...list, next];
    const copy = list.slice();
    copy[at] = next;
    return copy;
  });
  return true;
}

/** A parked content swap while Live edit is on: held, not cut in. Returns false when Live edit is off. */
export function holdContentEdit(trackId: string, media: ShowClipMedia, t: number, before: ShowClipMedia | null): boolean {
  if (!get(liveEditOn)) return false;
  markStart();
  heldEdits.update((list) => {
    const id = `content|${trackId}`;
    const held = list.find((e) => e.id === id) as HeldContentEdit | undefined;
    // The first "before" is what Discard and the cut-in go back from.
    const next: HeldContentEdit = { kind: 'content', id, trackId, media, before: held ? held.before : before, t };
    return held ? list.map((e) => (e.id === id ? next : e)) : [...list, next];
  });
  return true;
}

function markStart(): void {
  if (get(heldEdits).length === 0) heldFrom = history.currentStepId();
}

/** Held values by line id, for the line evaluator: a held change shows as made. */
export function heldTouches(): ReadonlyMap<string, number> {
  const held = get(heldEdits);
  if (!held.length) return EMPTY;
  const lines = get(showTimeline).lines;
  const out = new Map<string, number>();
  for (const e of held) {
    if (e.kind !== 'param') continue;
    const line = lines.find((l) => l.key === e.key && sameTarget(l.target, e.target));
    if (line) out.set(line.id, typeof e.value === 'boolean' ? (e.value ? 1 : 0) : e.value);
  }
  return out;
}
const EMPTY: ReadonlyMap<string, number> = new Map();

/** Key every held change where it was made, as one step. */
export function updateHeldEdits(): number {
  const held = get(heldEdits);
  if (!held.length || !hooks) return 0;
  flushPendingHistorySnapshot();
  heldEdits.set([]);
  heldFrom = null;
  for (const e of held) {
    if (e.kind === 'param') hooks.keyAt(e.target, e.key, e.value, e.t);
    else hooks.cutIn(e.trackId, e.media, e.t, e.before);
  }
  recordDiscreteAction();
  return held.length;
}

/** Drop every held change: back to before the first one (it can be redone). */
export function discardHeldEdits(): void {
  const from = heldFrom;
  heldEdits.set([]);
  heldFrom = null;
  if (!hooks) return;
  flushPendingHistorySnapshot();
  // Each step back is one app undo; bounded, in case the mark is gone.
  for (let i = 0; i < 200 && from !== null && history.currentStepId() !== from; i++) {
    if (!hooks.undo()) break;
  }
}

/** For tests. */
export function _resetLiveEditForTest(): void {
  hooks = null;
  heldFrom = null;
  liveEditOn.set(false);
  heldEdits.set([]);
}
