/**
 * Keyboard map for the Interactive Studio editor.
 *
 * While the editor is open it owns the keyboard: the component stops every
 * key from reaching the app behind it and asks this module what the key
 * means. Kept free of DOM and component state so the map can be unit tested.
 */

/** What kind of element had focus when the key was pressed. */
export type KeyTarget =
  /** A typing field: text or number input, textarea. Keys belong to the text. */
  | 'text'
  /** A control that uses arrow keys itself: slider, select, menu item. */
  | 'adjust'
  /** A button, checkbox or link: Enter and Space activate it. */
  | 'button'
  /** Anything else: the stage, a panel, the page. */
  | 'other';

export type EditorKeyPress = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: KeyTarget;
};

export type EditorKeyContext = {
  mode: 'edit' | 'draw' | 'perform';
  placingEmitter: boolean;
  /** Points in the outline being drawn. */
  draftPoints: number;
  /** A shape is selected. */
  hasSelection: boolean;
  /** A question is waiting for an answer (replace scene?). */
  confirming: boolean;
  fullScreen: boolean;
  cleanPreview: boolean;
};

export type EditorKeyCommand =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'remove-surface' }
  /** `dx` / `dy` are -1, 0 or 1; `big` is the Shift step. */
  | { type: 'nudge'; dx: number; dy: number; big: boolean }
  | { type: 'finish-shape' }
  | { type: 'cancel-confirm' }
  | { type: 'leave-field' }
  | { type: 'exit-placing' }
  | { type: 'exit-draw' }
  | { type: 'exit-clean-preview' }
  | { type: 'exit-fullscreen' }
  | { type: 'close' };

export type EditorKeyResult = {
  command: EditorKeyCommand | null;
  /** Stop the browser's own reaction to the key (scrolling, closing a dialog). */
  preventDefault: boolean;
};

const NOTHING: EditorKeyResult = { command: null, preventDefault: false };
const run = (command: EditorKeyCommand): EditorKeyResult => ({ command, preventDefault: true });

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Escape backs out of one thing at a time; with nothing left, it closes the editor. */
function escape(press: EditorKeyPress, context: EditorKeyContext): EditorKeyResult {
  if (context.confirming) return run({ type: 'cancel-confirm' });
  if (press.target === 'text') return run({ type: 'leave-field' });
  if (context.placingEmitter) return run({ type: 'exit-placing' });
  if (context.mode === 'draw') return run({ type: 'exit-draw' });
  if (context.cleanPreview) return run({ type: 'exit-clean-preview' });
  if (context.fullScreen) return run({ type: 'exit-fullscreen' });
  return run({ type: 'close' });
}

export function editorKey(press: EditorKeyPress, context: EditorKeyContext): EditorKeyResult {
  const command = press.metaKey || press.ctrlKey;
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;

  if (key === 'Escape') return escape(press, context);

  // Undo / redo. Typing fields keep the browser's own text undo.
  if (command && !press.altKey && (key === 'z' || key === 'y')) {
    if (press.target === 'text') return NOTHING;
    return run({ type: key === 'y' || press.shiftKey ? 'redo' : 'undo' });
  }
  if (command || press.altKey) return NOTHING;

  if (key === 'Delete' || key === 'Backspace') {
    if (press.target === 'text') return NOTHING;
    const canRemove = context.mode === 'edit' && context.hasSelection && !context.placingEmitter;
    return canRemove ? run({ type: 'remove-surface' }) : NOTHING;
  }

  if (key in ARROWS) {
    if (press.target === 'text' || press.target === 'adjust') return NOTHING;
    if (context.mode !== 'edit' || !context.hasSelection || context.placingEmitter) return NOTHING;
    const [dx, dy] = ARROWS[key];
    return run({ type: 'nudge', dx, dy, big: press.shiftKey });
  }

  if (key === 'Enter') {
    if (press.target !== 'other') return NOTHING;
    return context.mode === 'draw' && context.draftPoints >= 3 ? run({ type: 'finish-shape' }) : NOTHING;
  }

  return NOTHING;
}
