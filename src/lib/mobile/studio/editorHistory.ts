/**
 * Undo / redo history for the Interactive Studio editor.
 *
 * The history holds whole states (the editor passes a scene plus its
 * selection). Every function is pure and returns a new history.
 *
 * Two kinds of edit:
 *
 *  - One step (a button, a menu choice): `record(history, before)` after the
 *    edit, and only if something changed.
 *  - A gesture (dragging a shape, moving a slider, typing a name):
 *    `begin(history, before)` when it starts, `touch(history, now, same)` on
 *    every change. The first real change adds ONE entry; a press that
 *    changes nothing adds none.
 */
export const HISTORY_DEPTH = 100;

export type History<T> = {
  /** States to go back to, oldest first. */
  past: T[];
  /** States undone and available to redo, oldest first. */
  future: T[];
  /** Start of the gesture in progress, until its first real change. */
  pending: T | null;
};

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], pending: null };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/** Add `before` as the newest undo step. A new edit clears anything left to redo. */
export function record<T>(history: History<T>, before: T, depth = HISTORY_DEPTH): History<T> {
  return { past: [...history.past, before].slice(-depth), future: [], pending: null };
}

/** A gesture starts from `before`. Nothing is recorded until something changes. */
export function begin<T>(history: History<T>, before: T): History<T> {
  return { ...history, pending: before };
}

/** The state may have changed during a gesture. Records the gesture's start once. */
export function touch<T>(
  history: History<T>,
  current: T,
  same: (a: T, b: T) => boolean,
  depth = HISTORY_DEPTH,
): History<T> {
  if (history.pending === null || same(history.pending, current)) return history;
  return record(history, history.pending, depth);
}

/**
 * Step back. `capture(target)` returns the present state, to redo later; it
 * receives the state being restored so the caller can capture the same
 * amount of detail (see scene loads in InteractiveStudio).
 */
export function undo<T>(
  history: History<T>,
  capture: (target: T) => T,
  depth = HISTORY_DEPTH,
): { history: History<T>; state: T } | null {
  const state = history.past[history.past.length - 1];
  if (state === undefined) return null;
  return {
    state,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, capture(state)].slice(-depth),
      pending: null,
    },
  };
}

/** Step forward again after an undo. */
export function redo<T>(
  history: History<T>,
  capture: (target: T) => T,
  depth = HISTORY_DEPTH,
): { history: History<T>; state: T } | null {
  const state = history.future[history.future.length - 1];
  if (state === undefined) return null;
  return {
    state,
    history: {
      past: [...history.past, capture(state)].slice(-depth),
      future: history.future.slice(0, -1),
      pending: null,
    },
  };
}
