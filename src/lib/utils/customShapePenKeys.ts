// Keyboard shortcuts of the custom-shape pen toolbar (CustomShapeHandles):
// V select & move, + add point, - remove point.

export type CustomShapePenMode = 'edit' | 'add' | 'remove';

interface PenKey {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/** The pen mode a key press picks, or null when it is not a pen shortcut.
 *  "=" counts as "+" (the same key without Shift), "_" as "-". Keys with
 *  Cmd, Ctrl or Alt belong to other shortcuts (Cmd + and - zoom). */
export function penModeForKey(e: PenKey): CustomShapePenMode | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case 'v': case 'V': return 'edit';
    case '+': case '=': return 'add';
    case '-': case '_': return 'remove';
    default: return null;
  }
}
