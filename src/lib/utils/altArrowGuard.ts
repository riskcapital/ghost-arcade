/**
 * Windows shows the menu bar when Alt is pressed and released on its own.
 * Alt+arrow nudges (a finer step) hold Alt the same way, and because the
 * arrow presses are handled in the page the window never sees them, so it
 * took the release for a lone Alt and opened the menu. Every handler that
 * uses Alt+arrow notes it here; the app's keyup handler then keeps that
 * Alt release from the window.
 */
let altArrowHandled = false;

/** Call when an arrow key press with Alt held has been handled. */
export function noteAltArrow(e: Pick<KeyboardEvent, 'altKey'>): void {
  if (e.altKey) altArrowHandled = true;
}

/** Call on every keyup: swallows the Alt release that ends Alt+arrow. */
export function guardAltRelease(e: Pick<KeyboardEvent, 'key' | 'preventDefault'>): void {
  if (e.key !== 'Alt') return;
  if (altArrowHandled) e.preventDefault();
  altArrowHandled = false;
}
