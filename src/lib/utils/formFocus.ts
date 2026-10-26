/**
 * Hand the keyboard back to the canvas.
 *
 * Canvas handles call preventDefault on press so a drag never selects text,
 * which also means pressing one leaves focus wherever it was. When that is a
 * panel control (a slider, a select, a number field), the arrow keys meant
 * for nudging the selected handle go to the control instead: the point stays
 * put and the control changes. Call this when a handle is pressed.
 */
export function releaseFormControlFocus(): void {
  if (typeof document === 'undefined') return;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable) {
    active.blur();
  }
}
