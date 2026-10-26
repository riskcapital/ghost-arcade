/**
 * Keeps the top toolbar inside the window without hiding anything.
 *
 * The toolbar shows every control at full size, labels included, whatever is
 * switched on. When the window is too narrow for that, the control groups
 * scale down evenly, like a picture, until they fit edge to edge. Nothing
 * drops its label, moves into a menu or scrolls out of reach, so a control is
 * always where it was.
 *
 * The bar itself never changes height: only the groups inside it are scaled
 * (CSS `zoom` on each group), so the workspace and the native preview below
 * stay put. A group marked `data-tb-fixed` (the logo and File menu) keeps its
 * full size, so the File menu always opens at a readable size.
 *
 * Scaling down happens as soon as the bar would overflow. Scaling back up
 * waits until there is clear room to spare, so a control that changes width
 * by a few pixels (a timer, a counter) does not make the whole bar pump.
 *
 * It measures rather than guessing breakpoints. Everything runs in a
 * requestAnimationFrame, so the scale is set before the frame is painted and
 * never inside a ResizeObserver callback.
 */

export interface ToolbarFitMeasure {
  /** Width there is for the whole bar, CSS px. */
  room: number;
  /** Width that never scales: padding, gaps, fixed groups, breathing room. */
  fixed: number;
  /** Width of the scaled groups at full size. */
  scalable: number;
}

export interface ToolbarFitOptions {
  /** Smallest scale the groups go down to. */
  smallest?: number;
  /** Scales are kept to multiples of this, so tiny width changes do not register. */
  step?: number;
  /** Spare room, CSS px, needed before the groups grow back. */
  slack?: number;
}

const SMALLEST = 0.6;
const STEP = 0.02;
const SLACK = 24;
/** Breathing room kept between the groups, CSS px. */
const BETWEEN = 8;

function quantizeDown(value: number, step: number): number {
  const steps = Math.floor(value / step + 1e-9);
  return Math.round(steps * step * 1000) / 1000;
}

/**
 * The scale the scaled groups should have, given what was measured and the
 * scale they have now. Pure, so the hysteresis can be tested on its own.
 */
export function toolbarScale(measure: ToolbarFitMeasure, current: number, options: ToolbarFitOptions = {}): number {
  const smallest = options.smallest ?? SMALLEST;
  const step = options.step ?? STEP;
  const slack = options.slack ?? SLACK;
  const { room, fixed, scalable } = measure;
  if (!(scalable > 0) || !(room > 0)) return 1;
  const clamp = (value: number) => Math.min(1, Math.max(smallest, value));
  const now = clamp(Number.isFinite(current) && current > 0 ? current : 1);
  const available = room - fixed;
  if (scalable * now > available + 0.5) {
    // Overflowing: shrink straight away, to the largest step that fits.
    return clamp(quantizeDown(available / scalable, step));
  }
  // It fits. Grow only when the larger scale still leaves `slack` to spare.
  const roomy = clamp(quantizeDown((available - slack) / scalable, step));
  if (now >= 1) return 1;
  // Full size when it fits with room to spare, even if the last step is short of it.
  if (scalable + slack <= available) return 1;
  return roomy > now ? roomy : now;
}

export function fitToolbar(header: HTMLElement) {
  let frame: number | null = null;
  let scale = 1;

  const isShown = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed';
  };

  /** Width a group's contents take at full size, whatever the group itself is stretched to. */
  const needs = (group: HTMLElement) => {
    const style = getComputedStyle(group);
    const gap = parseFloat(style.columnGap) || 0;
    const margins = (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
    let total = 0, shown = 0;
    for (const child of Array.from(group.children) as HTMLElement[]) {
      const width = child.getBoundingClientRect().width;
      if (width <= 0 || !isShown(child)) continue;
      total += width;
      shown++;
    }
    return total + gap * Math.max(0, shown - 1) + margins;
  };

  const groupsOf = () => (Array.from(header.children) as HTMLElement[]).filter(isShown);

  const apply = (next: number) => {
    scale = next;
    header.style.setProperty('--tb-scale', String(next));
    for (const group of Array.from(header.children) as HTMLElement[]) {
      if (next >= 0.999 || group.hasAttribute('data-tb-fixed')) group.style.removeProperty('zoom');
      else group.style.setProperty('zoom', String(next));
    }
  };

  const fit = () => {
    frame = null;
    const parent = header.parentElement;
    if (!parent || getComputedStyle(header).display === 'none') return;
    // Measure at full size, then set the scale, all before the next paint.
    const before = scale;
    header.classList.add('tb-measuring');
    apply(1);
    const style = getComputedStyle(header);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const gap = parseFloat(style.columnGap) || 0;
    const groups = groupsOf();
    let fixed = padding + (gap + BETWEEN) * Math.max(0, groups.length - 1);
    let scalable = 0;
    for (const group of groups) {
      const width = needs(group);
      if (group.hasAttribute('data-tb-fixed')) fixed += width;
      else scalable += width;
    }
    const room = parent.getBoundingClientRect().width;
    apply(toolbarScale({ room, fixed, scalable }, before));
    void header.offsetWidth;
    header.classList.remove('tb-measuring');
  };

  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(fit);
  };

  const observer = new ResizeObserver(schedule);
  if (header.parentElement) observer.observe(header.parentElement);
  const observeChildren = () => {
    for (const group of Array.from(header.children)) {
      // A control appearing or changing size inside a group (a recording
      // timer, a tempo readout) changes what the bar needs.
      for (const child of Array.from(group.children)) observer.observe(child);
    }
  };
  observeChildren();
  const mutations = new MutationObserver(() => {
    observeChildren();
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
      header.style.removeProperty('--tb-scale');
    },
  };
}
