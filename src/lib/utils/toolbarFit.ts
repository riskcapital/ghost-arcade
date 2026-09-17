/**
 * Keeps the top toolbar inside the window.
 *
 * The toolbar needs about 1500px at full size and more once audio is on (the
 * BPM widget) or a recording is running, while the window can be as narrow as
 * 1200px. On a 1280px laptop screen the right-hand end, Stage, Settings and
 * Connect Mobile, was simply off the edge of the window with no way to reach
 * it.
 *
 * Rather than guess breakpoints, this measures. When the last group runs past
 * the toolbar's edge it steps up a compact level (`tb-compact-1` .. `-N`, each
 * applied on top of the previous), and steps back down as soon as the full
 * layout fits again. The styles for each level live with the toolbar. The top
 * level lets the centre group scroll sideways, so nothing can end up
 * unreachable however much the toolbar holds.
 *
 * Everything runs in a requestAnimationFrame, so a level change is laid out
 * before the frame is painted, and never inside a ResizeObserver callback,
 * which would report a loop error when the level changes a group's size.
 */
const LEVELS = 4;

export function fitToolbar(header: HTMLElement) {
  let level = 0;
  let frame: number | null = null;

  const apply = (next: number) => {
    for (let i = 1; i <= LEVELS; i++) {
      header.classList.toggle(`tb-compact-${i}`, i <= next);
    }
    level = next;
  };

  const overflowing = () => {
    const last = header.lastElementChild as HTMLElement | null;
    if (!last) return false;
    const box = header.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(header).paddingRight) || 0;
    // The groups are flex items that do not shrink below their content, so
    // the last one runs past the content edge exactly when the row is too
    // wide. Its box excludes absolutely positioned popovers, so opening a
    // menu never counts as overflow.
    return last.getBoundingClientRect().right > box.right - padding + 0.5;
  };

  const fit = () => {
    frame = null;
    while (level < LEVELS && overflowing()) apply(level + 1);
    while (level > 0) {
      const current = level;
      apply(current - 1);
      if (overflowing()) {
        apply(current);
        break;
      }
    }
  };

  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(fit);
  };

  const observer = new ResizeObserver(schedule);
  observer.observe(header);
  for (const group of Array.from(header.children)) observer.observe(group);
  schedule();

  return {
    destroy() {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      apply(0);
    },
  };
}
