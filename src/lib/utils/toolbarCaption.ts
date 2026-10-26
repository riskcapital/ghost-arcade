/**
 * Where a press on the frameless (Windows/Linux) toolbar may move the window.
 *
 * The toolbar doubles as the title bar, so its empty space drags the window
 * and a double-click maximises it. Only the bar's own background counts: the
 * bar, its three group rows and the logo. Anything deeper is a control or
 * sits inside one (the File menu, the audio popovers, the Mobile panel), so
 * pressing a menu separator or a popover label never moves the window.
 */

/** The parts of an element the rule needs, so it can be tested without a DOM. */
export interface CaptionElement {
  parentElement: CaptionElement | null;
  matches(selector: string): boolean;
}

const GROUPS = '.toolbar-left, .toolbar-center, .toolbar-right';
const LOGO = '.header-logo';

export function isToolbarCaption(target: CaptionElement | null | undefined, bar: CaptionElement | null | undefined): boolean {
  if (!target || !bar) return false;
  if (target === bar) return true;
  const parent = target.parentElement;
  if (parent === bar) return target.matches(GROUPS);
  // The logo sits directly in a group row.
  return target.matches(LOGO) && !!parent && parent.parentElement === bar && parent.matches(GROUPS);
}
