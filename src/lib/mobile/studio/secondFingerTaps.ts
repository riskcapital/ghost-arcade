/**
 * Lets a second finger press buttons while the first is busy (holding the
 * Flux pad, say).
 *
 * iOS sends a click only for a lone finger. A finger that lands while another
 * is already down gets its pointer events but never a click, so every button
 * that waits for one is dead to the other hand. This watches those extra
 * fingers and, when one lifts where it landed, clicks the button under it.
 * A lone finger is left alone: it already gets its own click.
 */
const SLOP = 12;
const LONGEST_MS = 600;

export function secondFingerTaps(root: HTMLElement) {
  const fingers = new Map<number, { x: number; y: number; at: number; target: Element | null }>();
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || e.isPrimary) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, at: performance.now(), target: e.target as Element | null });
  };
  const up = (e: PointerEvent) => {
    const finger = fingers.get(e.pointerId);
    if (!finger) return;
    fingers.delete(e.pointerId);
    if (Math.hypot(e.clientX - finger.x, e.clientY - finger.y) > SLOP || performance.now() - finger.at > LONGEST_MS) return;
    const button = finger.target?.closest<HTMLElement>('button, [role="button"], [role="tab"], [role="menuitem"]');
    if (!button || !root.contains(button) || (button as HTMLButtonElement).disabled || button.closest('.flux-pad')) return;
    button.click();
  };
  const cancel = (e: PointerEvent) => fingers.delete(e.pointerId);
  root.addEventListener('pointerdown', down, true);
  root.addEventListener('pointerup', up, true);
  root.addEventListener('pointercancel', cancel, true);
  return {
    destroy() {
      root.removeEventListener('pointerdown', down, true);
      root.removeEventListener('pointerup', up, true);
      root.removeEventListener('pointercancel', cancel, true);
    },
  };
}
