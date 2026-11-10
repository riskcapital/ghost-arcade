/**
 * One pointer drag in the show tray, from press to release.
 *
 * Every drag in the tray (clips, trims, fades, keys, preset and audio
 * blocks, markers, the marquee, the tray's own height) follows the pointer
 * through here, so they all end the same way:
 *
 * - Release: the drag is done (`end`).
 * - Esc: the drag is cancelled and puts back what it changed (`cancel`).
 *   The tray's key handler asks `cancelActiveDrag()` first, so Esc during
 *   a drag never also clears the selection.
 * - The window losing focus mid-drag (Cmd-Tab, a system dialog): the
 *   release goes to another app, so the drag is cancelled too.
 * - A move with no button held: the release was missed (it happened outside
 *   the window); the drag ends where the pointer last was instead of
 *   following the pointer with nothing held.
 */

export interface DragCallbacks {
  move(ev: MouseEvent): void;
  /** Released. `ev` is the release, or the buttonless move that showed it. */
  end(ev: MouseEvent): void;
  /** Esc or focus lost: undo what the drag did. */
  cancel(): void;
}

interface ActiveDrag { cancel(): void }

let active: ActiveDrag | null = null;

/** True while a drag is following the pointer. */
export function dragInFlight(): boolean {
  return active !== null;
}

/** Cancel the drag in flight, if any. True when there was one. */
export function cancelActiveDrag(): boolean {
  if (!active) return false;
  active.cancel();
  return true;
}

/**
 * The click a cancelled drag's release would make is not a click (the grid
 * would seek on it). Waits for the release, then eats the click after it.
 */
function swallowClickAfterRelease(target: Window): void {
  const stopClick = (ev: Event) => { ev.stopPropagation(); };
  const onUp = () => {
    target.removeEventListener('mouseup', onUp, true);
    target.removeEventListener('mousedown', onDown, true);
    target.addEventListener('click', stopClick, { capture: true, once: true });
    setTimeout(() => target.removeEventListener('click', stopClick, { capture: true }), 0);
  };
  // A fresh press means the release was missed: nothing to swallow.
  const onDown = () => {
    target.removeEventListener('mouseup', onUp, true);
    target.removeEventListener('mousedown', onDown, true);
  };
  target.addEventListener('mouseup', onUp, true);
  target.addEventListener('mousedown', onDown, true);
}

/** Follow the pointer until the drag ends or is cancelled. */
export function followPointer(cb: DragCallbacks, target: Window = window): void {
  // Only one drag at a time; a stale one (it should not exist) gives way.
  if (active) active.cancel();
  let done = false;
  const stop = () => {
    done = true;
    target.removeEventListener('mousemove', onMove);
    target.removeEventListener('mouseup', onUp);
    target.removeEventListener('blur', onBlur);
    if (active === me) active = null;
  };
  const onMove = (ev: MouseEvent) => {
    if (done) return;
    if ((ev.buttons & 1) === 0) {
      stop();
      cb.end(ev);
      return;
    }
    cb.move(ev);
  };
  const onUp = (ev: MouseEvent) => {
    if (done) return;
    stop();
    cb.end(ev);
  };
  const cancel = (afterRelease: boolean) => {
    if (done) return;
    stop();
    if (afterRelease) swallowClickAfterRelease(target);
    cb.cancel();
  };
  const onBlur = () => cancel(false);
  const me: ActiveDrag = { cancel: () => cancel(true) };
  active = me;
  target.addEventListener('mousemove', onMove);
  target.addEventListener('mouseup', onUp);
  target.addEventListener('blur', onBlur);
}
