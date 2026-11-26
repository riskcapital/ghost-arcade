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

/**
 * The primary layer (the one the inspector and warp handles edit) for a new
 * multi-selection. It must be one of the selected layers: Cmd/Ctrl-click
 * deselecting a layer passes that layer as `requested`, and keeping it made
 * the handles and inspector go on editing a layer no longer selected. A
 * requested layer outside the selection falls back to the current primary
 * when that is still selected, else to the layer added last.
 */
export function primaryForSelection(
  requested: string | null,
  current: string | null | undefined,
  selectedIds: readonly string[],
  validIds: readonly string[],
): string | null {
  if (selectedIds.length === 0) return requested && validIds.includes(requested) ? requested : null;
  if (requested && selectedIds.includes(requested)) return requested;
  if (current && selectedIds.includes(current)) return current;
  return selectedIds[selectedIds.length - 1];
}
