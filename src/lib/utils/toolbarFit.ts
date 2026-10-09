/**
 * Keeps the top toolbar inside the window without hiding anything.
 *
 * The toolbar shows every control at full size, labels included, whatever is
 * switched on. When the window is too narrow for that, the whole bar scales
 * down evenly, like a picture, until it fits edge to edge. Nothing drops its
 * label, moves into a menu or scrolls out of reach, so a control is always
 * where it was.
 *
 * It measures rather than guessing breakpoints: what the three groups need at
 * full size against the width there is. Everything runs in a
 * requestAnimationFrame, so the scale is set before the frame is painted and
 * never inside a ResizeObserver callback.
 */
const SMALLEST = 0.6;
/** Breathing room kept between the groups, full-size pixels. */
const BETWEEN = 14;

export function fitToolbar(header: HTMLElement) {
  let frame: number | null = null;
  let scale = 1;

  /** Width a group's contents take at full size, whatever the group itself is stretched to. */
  const needs = (group: HTMLElement) => {
    const gap = parseFloat(getComputedStyle(group).columnGap) || 0;
    let total = 0, shown = 0;
    for (const child of Array.from(group.children) as HTMLElement[]) {
      const width = child.getBoundingClientRect().width;
      if (width <= 0 || getComputedStyle(child).position === 'absolute' || getComputedStyle(child).position === 'fixed') continue;
      total += width;
      shown++;
    }
    return total + gap * Math.max(0, shown - 1);
  };

  const apply = (next: number) => {
    scale = next;
    if (next >= 0.999) {
      header.style.removeProperty('zoom');
    } else {
      // A zoomed bar still fills its row: its 100% is measured in its own,
      // smaller pixels, so it needs no widening.
      header.style.setProperty('zoom', String(next));
    }
  };

  const fit = () => {
    frame = null;
    const parent = header.parentElement;
    if (!parent) return;
    // Measure at full size, then set the scale, all before the next paint.
    header.classList.add('tb-measuring');
    apply(1);
    const style = getComputedStyle(header);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const groups = Array.from(header.children) as HTMLElement[];
    const wanted = padding + groups.reduce((sum, group) => sum + needs(group), 0) + BETWEEN * Math.max(0, groups.length - 1);
    const room = parent.getBoundingClientRect().width;
    if (wanted > room && wanted > 0) apply(Math.max(SMALLEST, Math.floor((room / wanted) * 1000) / 1000));
    void header.offsetWidth;
    header.classList.remove('tb-measuring');
  };

  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(fit);
  };

  const observer = new ResizeObserver(schedule);
  if (header.parentElement) observer.observe(header.parentElement);
  for (const group of Array.from(header.children)) {
    observer.observe(group);
    // A control appearing or changing size inside a group (a recording timer,
    // a tempo readout) changes what the bar needs.
    for (const child of Array.from(group.children)) observer.observe(child);
  }
  const mutations = new MutationObserver(() => {
    for (const group of Array.from(header.children)) for (const child of Array.from(group.children)) observer.observe(child);
    schedule();
  });
  for (const group of Array.from(header.children)) mutations.observe(group, { childList: true });
  schedule();

  return {
    destroy() {
      observer.disconnect();
      mutations.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      apply(1);
    },
  };
}
