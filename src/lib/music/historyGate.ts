/**
 * Changes that are not edits: playing the show (a song or scene called up,
 * a studio cell, a controller move) and the runtime's own bookkeeping. Run
 * them through `outsideHistory` and Audio Lab's undo history
 * (audioLabHistory.ts) leaves them alone: what they changed comes out of the
 * history, so no later undo walks it back.
 *
 * No imports, so any studio module can use it without a cycle.
 */

let depth = 0;

/** Run `fn` as live control: none of what it changes is an undo step. */
export function outsideHistory<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}

/** True while an `outsideHistory` call runs. */
export function historyQuiet(): boolean {
  return depth > 0;
}
