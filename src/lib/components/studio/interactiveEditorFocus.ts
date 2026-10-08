/** DOM helpers for the Interactive Studio editor's keyboard and focus handling. */
import type { KeyTarget } from '../../mobile/studio/editorKeyboard';

const BUTTON_LIKE_INPUTS = ['checkbox', 'button', 'submit', 'reset', 'file', 'color', 'image'];

/** Classify the element a key press started on (see `KeyTarget`). */
export function keyTargetOf(target: EventTarget | null): KeyTarget {
  if (!(target instanceof HTMLElement)) return 'other';
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return 'text';
  if (target instanceof HTMLInputElement) {
    if (target.type === 'range' || target.type === 'radio') return 'adjust';
    return BUTTON_LIKE_INPUTS.includes(target.type) ? 'button' : 'text';
  }
  if (target instanceof HTMLSelectElement) return 'adjust';
  if (target.closest('[role="menu"],[role="listbox"],[role="slider"]')) return 'adjust';
  if (target.closest('button,a[href],summary,[role="button"]')) return 'button';
  return 'other';
}

/** Elements the Tab key can reach inside `root`, in document order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>(
    'button,[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])',
  );
  return [...candidates].filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.tabIndex >= 0 &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden',
  );
}

/**
 * Keep Tab inside `root`: wrap from the last control to the first and back,
 * and pull focus in when it is somewhere outside. Returns true when it moved
 * focus itself.
 */
export function trapTab(e: KeyboardEvent, root: HTMLElement): boolean {
  const items = focusableWithin(root);
  const active = document.activeElement;
  const move = (to: HTMLElement | undefined) => {
    e.preventDefault();
    (to ?? root).focus({ preventScroll: false });
    return true;
  };
  if (!items.length) return move(undefined);
  if (!active || !root.contains(active)) return move(e.shiftKey ? items[items.length - 1] : items[0]);
  const follows = (el: HTMLElement) => !!(active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const precedes = (el: HTMLElement) => !!(active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
  if (e.shiftKey && !items.some(precedes)) return move(items[items.length - 1]);
  if (!e.shiftKey && !items.some(follows)) return move(items[0]);
  return false;
}

/**
 * The dialog the editor sits in, if any. A native modal `<dialog>` already
 * traps focus and restores it on close; a `role="dialog"` element does not.
 */
export function dialogHostOf(root: HTMLElement): { host: HTMLElement | null; native: boolean } {
  const host = root.closest<HTMLElement>('dialog,[role="dialog"]');
  return { host, native: host instanceof HTMLDialogElement };
}

/** True when something else (another dialog, a menu) is drawn over `root`. */
export function isCovered(root: HTMLElement, host: HTMLElement | null): boolean {
  const box = root.getBoundingClientRect();
  if (!box.width || !box.height) return true;
  const top = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(24, box.height / 2));
  return !!top && !(host ?? root).contains(top);
}
