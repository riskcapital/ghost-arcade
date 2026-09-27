/**
 * The multi-selection a primary selection implies.
 *
 * Most add*Layer paths (and undo, paste, import) only move the project's
 * `selectedLayerId`. The multi-selection must follow, or it keeps naming the
 * layer clicked before: the panel shows the new shape selected while Looks'
 * "Selected" acts on the old layer. A primary outside the multi-selection
 * replaces it; a primary inside it (a genuine multi-select) leaves it alone.
 *
 * Returns the ids to store, or null when nothing needs to change.
 */
export function selectionForPrimary(
  primary: string | null | undefined,
  selectedIds: readonly string[],
): string[] | null {
  if (!primary) return null;
  return selectedIds.includes(primary) ? null : [primary];
}
