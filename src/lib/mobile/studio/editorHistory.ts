/**
 * Undo history for the Interactive Studio editor.
 *
 * Entries are deep clones taken BEFORE an edit, oldest first. The functions
 * are pure: they return a new list and never touch the one passed in.
 */
export const HISTORY_DEPTH = 20;

/** Remember `snapshot` as the newest entry, dropping the oldest past `depth`. */
export function pushSnapshot<T>(entries: T[], snapshot: T, depth = HISTORY_DEPTH): T[] {
  return [...entries.slice(-(depth - 1)), structuredClone(snapshot)];
}

/** Take the newest entry off the list. `snapshot` is undefined when there is nothing to undo. */
export function popSnapshot<T>(entries: T[]): { entries: T[]; snapshot: T | undefined } {
  if (!entries.length) return { entries, snapshot: undefined };
  return { entries: entries.slice(0, -1), snapshot: entries[entries.length - 1] };
}
