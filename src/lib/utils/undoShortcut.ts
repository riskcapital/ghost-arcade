/**
 * Which keypresses are the app's own Undo / Redo.
 *
 * Cmd/Ctrl+Z inside a text or number field belongs to the field: it undoes
 * the typing, as it does everywhere else on the system. The app-wide handler
 * used to catch it first and roll the whole project back instead, so fixing
 * a typo in a layer name undid the last few edits.
 */

/** Input types that hold text the user types and can undo. Sliders,
 *  checkboxes, colour pickers and buttons have no typing of their own, so
 *  Cmd/Ctrl+Z on them is still the app's undo. */
const NON_TEXT_INPUT_TYPES = new Set([
  'range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'color', 'file', 'hidden',
]);

/** True when `target` is a field the user types into: a textarea, an
 *  editable region, or an input that takes text, numbers, dates and so on. */
export function isTextEntryTarget(target: unknown): boolean {
  const element = target as {
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
    readOnly?: boolean;
    disabled?: boolean;
  } | null;
  if (!element || typeof element.tagName !== 'string') return false;
  if (element.isContentEditable === true) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return !element.readOnly && !element.disabled;
  if (tag !== 'INPUT') return false;
  if (element.readOnly || element.disabled) return false;
  const type = (element.type || 'text').toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}

export interface UndoKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** 'undo' for Cmd/Ctrl+Z, 'redo' for Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y,
 *  otherwise null. */
export function undoShortcut(event: UndoKeyEvent): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}
