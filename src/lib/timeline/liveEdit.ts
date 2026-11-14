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
 *     at, together. Discard puts back what each held change changed (the
 *     setting's value before it, the piece's content before it), as one
 *     undo step, and nothing else: an edit made meanwhile that was not held
 *     stays. When a held change cannot be put back, Discard says so and
 *     changes nothing.
 *
 * Content swaps on a piece are held the same way (the content recorder's
 * cut-ins). Off is exactly the recorder disarmed: Live edit is "Rec lines +
 * Follow edits", and either control shows the same state.
 *
 * The state is one value (LiveEditState) moved only by `liveEditStep`:
 * off → on (armed) → holding (a parked change) → on (Update or Discard).
 * Stopping Live edit, opening another document or another project drops
 * what is held (the changes stay in the editor as they were made, not on
 * the Timeline).
 */
import { derived, get, writable } from 'svelte/store';
import { sameTarget, targetId, type ParamTarget } from './lines/paramRegistry';
import { showTimeline } from '../stores/showTimeline';
import { flushPendingHistorySnapshot, recordDiscreteAction, runAsOneStep } from '../stores/historyHooks';
import type { MediaSource, ShowClipMedia } from '../types';

export interface HeldParamEdit {
  kind: 'param';
  id: string;
  target: ParamTarget;
  key: string;
  value: number | boolean;
  /** What it was before the first held change: a new line keeps it up to `t`, and Discard puts it back. */
  was?: number | boolean;
  /** Where the playhead was when it was changed: where Update keys it. */
  t: number;
}

/** The piece a held content swap changed, and what it showed before the first one. */
export interface HeldPiece {
  layerId: string;
  previous: MediaSource | null;
}

export interface HeldContentEdit {
  kind: 'content';
  id: string;
  /** The row it goes on; null when the piece has no row yet (Update makes it, in the same step). */
  trackId: string | null;
  media: ShowClipMedia;
  before: ShowClipMedia | null;
  t: number;
  /** The piece whose content was swapped in the editor (what Discard puts back).
   *  None for content held for a row without touching a piece (a Media Library card on a group row). */
  piece?: HeldPiece;
}

export type HeldEdit = HeldParamEdit | HeldContentEdit;

/** Live edit, as one value. */
export type LiveEditState =
  | { kind: 'off' }
  | { kind: 'on' }
  | { kind: 'holding'; edits: readonly HeldEdit[]; notice: string | null };

export type LiveEditEvent =
  /** Armed with Follow edits. */
  | { type: 'arm' }
  /** Disarmed, or Follow edits off: what is held is dropped. */
  | { type: 'disarm' }
  | { type: 'hold'; edit: HeldEdit }
  /** Update keyed the held changes, or Discard put them back. */
  | { type: 'settle' }
  /** Discard could not put them back: nothing changed, say why. */
  | { type: 'refuse'; notice: string }
  /** Another project or document: what is held belongs to the old one. */
  | { type: 'reset' };

/** The latest value of each held parameter, the first "was" and the first content a swap went back from. */
function merged(list: readonly HeldEdit[], edit: HeldEdit): readonly HeldEdit[] {
  const at = list.findIndex((e) => e.id === edit.id);
  if (at < 0) return [...list, edit];
  const old = list[at];
  let next: HeldEdit = edit;
  if (old.kind === 'param' && edit.kind === 'param') {
    const { was: _drop, ...rest } = edit;
    next = old.was !== undefined ? { ...rest, was: old.was } : rest;
  } else if (old.kind === 'content' && edit.kind === 'content') {
    next = { ...edit, before: old.before, ...(old.piece ? { piece: old.piece } : {}) };
  }
  const copy = list.slice();
  copy[at] = next;
  return copy;
}

/** Every transition of Live edit. Anything not listed leaves the state as it is. */
export function liveEditStep(state: LiveEditState, event: LiveEditEvent): LiveEditState {
  switch (event.type) {
    case 'arm':
      return state.kind === 'off' ? { kind: 'on' } : state;
    case 'disarm':
      return state.kind === 'off' ? state : { kind: 'off' };
    case 'reset':
      return state.kind === 'holding' ? { kind: 'on' } : state;
    case 'hold':
      if (state.kind === 'off') return state;
      return { kind: 'holding', edits: merged(state.kind === 'holding' ? state.edits : [], event.edit), notice: null };
    case 'settle':
      return state.kind === 'holding' ? { kind: 'on' } : state;
    case 'refuse':
      return state.kind === 'holding' ? { ...state, notice: event.notice } : state;
  }
}

/** What Discard's revert hook answers. */
export type RevertResult = { ok: true } | { ok: false; reason: string };

export interface LiveEditHooks {
  /** Key a parameter at a time (timelineLines' keyAtPlayhead); `was`, its value before. */
  keyAt(target: ParamTarget, key: string, value: number | boolean, t: number, was?: number | boolean): void;
  /** Cut held content in on its row at its time (the row is made when it has none). */
  cutIn(edit: HeldContentEdit): void;
  /** Put back what these held changes changed, as one undo step; all or nothing. */
  revert(edits: readonly HeldEdit[]): RevertResult;
  /** Arm or disarm the recorder with Follow edits. */
  setArmed(on: boolean): void;
}

let hooks: Partial<LiveEditHooks> = {};

/** Wired by the app at start (timelineLines.ts). */
export function installLiveEditHooks(next: Partial<LiveEditHooks>): void {
  hooks = { ...hooks, ...next };
}

const state = writable<LiveEditState>({ kind: 'off' });
/** Update or Discard is writing: what they change is not a new held change. */
let settling = false;

function dispatch(event: LiveEditEvent): void {
  const now = get(state);
  const next = liveEditStep(now, event);
  if (next !== now) state.set(next);
}

/** The whole Live edit state. */
export const liveEditState = { subscribe: state.subscribe };

/** Is Live edit on: the recorder armed with Follow edits. */
export const liveEditOn = derived(state, (s) => s.kind !== 'off');

const NONE: readonly HeldEdit[] = [];
/** Changes made while parked, waiting for Update. */
export const heldEdits = derived(state, (s) => (s.kind === 'holding' ? s.edits : NONE));

export const liveEdit = derived(state, (s) => ({
  on: s.kind !== 'off',
  held: s.kind === 'holding' ? s.edits : NONE,
  notice: s.kind === 'holding' ? s.notice : null,
}));

/** The recorder's arm with Follow edits, as Live edit sees it (timelineLines). */
export function setLiveEditArmed(on: boolean): void {
  dispatch({ type: on ? 'arm' : 'disarm' });
}

/** Another project or document is open: held changes are dropped. */
export function resetLiveEdit(): void {
  dispatch({ type: 'reset' });
}

export function setLiveEdit(on: boolean): void {
  hooks.setArmed?.(on);
}

/** A parked parameter change while Live edit is on: held, not keyed. Returns false when Live edit is off. */
export function holdParamEdit(target: ParamTarget, key: string, value: number | boolean, t: number, was?: number | boolean): boolean {
  if (get(state).kind === 'off') return false;
  if (settling) return true;
  const id = `param|${targetId(target)}|${key}`;
  dispatch({ type: 'hold', edit: { kind: 'param', id, target, key, value, ...(was !== undefined ? { was } : {}), t } });
  return true;
}

/**
 * A parked content swap while Live edit is on: held, not cut in. Returns
 * false when Live edit is off. `piece`: the piece swapped in the editor and
 * what it showed before (Discard puts it back); `trackId` null when that
 * piece has no row yet.
 */
export function holdContentEdit(trackId: string | null, media: ShowClipMedia, t: number, before: ShowClipMedia | null, piece?: HeldPiece): boolean {
  if (get(state).kind === 'off') return false;
  if (settling) return true;
  const id = piece ? `content|layer:${piece.layerId}` : `content|${trackId}`;
  dispatch({ type: 'hold', edit: { kind: 'content', id, trackId, media, before, t, ...(piece ? { piece } : {}) } });
  return true;
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

/** Key every held change where it was made, as one undo step (an edit still waiting before it stays its own). */
export function updateHeldEdits(): number {
  const s = get(state);
  if (s.kind !== 'holding' || !hooks.keyAt || !hooks.cutIn) return 0;
  const { keyAt, cutIn } = hooks;
  dispatch({ type: 'settle' });
  runAsOneStep(() => {
    settling = true;
    try {
      for (const e of s.edits) {
        if (e.kind === 'param') keyAt(e.target, e.key, e.value, e.t, e.was);
        else cutIn(e);
      }
    } finally {
      settling = false;
    }
    recordDiscreteAction();
  });
  return s.edits.length;
}

/**
 * Drop every held change, putting back what each one changed (one undo
 * step; Undo brings them back as plain edits). Edits made meanwhile that
 * were not held are left as they are. When a held change cannot be put back
 * nothing changes, the held changes stay and the bar says why. True when
 * they were dropped.
 */
export function discardHeldEdits(): boolean {
  const s = get(state);
  if (s.kind !== 'holding') return true;
  if (!hooks.revert) {
    dispatch({ type: 'refuse', notice: CANT_DISCARD });
    return false;
  }
  flushPendingHistorySnapshot();
  let result: RevertResult;
  settling = true;
  try {
    result = hooks.revert(s.edits);
  } finally {
    settling = false;
  }
  if (!result.ok) {
    dispatch({ type: 'refuse', notice: result.reason });
    return false;
  }
  dispatch({ type: 'settle' });
  return true;
}

const CANT_DISCARD = "Discard can't put these changes back. Undo them, or press Update to keep them.";

/** For tests. */
export function _resetLiveEditForTest(): void {
  hooks = {};
  settling = false;
  state.set({ kind: 'off' });
}
