/**
 * A full-screen view's own top bar acting as the window's title bar, as the
 * main toolbar does: pressing its empty space moves the window and a
 * double-click maximizes or restores it (frameless Windows/Linux windows;
 * macOS keeps its own title bar). The bar also scrolls sideways when the
 * window is too narrow for everything on it, the mouse wheel included.
 */
import { invoke, isDesktopApp, isMac } from '$lib/bridge';

/** The parts of an element the rule needs, so it can be tested without a DOM. */
export interface CaptionTarget {
  closest(selector: string): unknown;
}
export interface CaptionBar {
  contains(node: never): boolean;
}

/** Controls, and anything inside one (a menu, a popover), never move the window. */
const CONTROLS = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'label', 'summary', '[contenteditable]',
  '[role="button"]', '[role="slider"]', '[role="radio"]', '[role="radiogroup"]', '[role="tab"]',
  '[role="menu"]', '[role="menuitem"]', '[role="dialog"]', '[role="listbox"]', '[data-no-caption]',
].join(', ');

/**
 * Whether a press at `target` is on the bar's empty space. Only controls in
 * the bar count: the view around it may itself be a dialog. `inScrollbar`:
 * the press landed on the bar's own scrollbar, which scrolls instead.
 */
export function isCaptionPress(target: CaptionTarget | null | undefined, bar: CaptionBar, inScrollbar = false): boolean {
  if (!target || inScrollbar) return false;
  const control = target.closest(CONTROLS);
  return !control || !bar.contains(control as never);
}

function pressOnScrollbar(bar: HTMLElement, e: MouseEvent): boolean {
  if (e.target !== bar) return false;
  const r = bar.getBoundingClientRect();
  return e.clientY - r.top >= bar.clientHeight;
}

/** Svelte action: the bar moves and maximizes the window like a title bar. */
export function windowCaption(bar: HTMLElement) {
  if (!isDesktopApp || isMac) return {};
  const caption = (e: MouseEvent) => isCaptionPress(e.target as Element | null, bar, pressOnScrollbar(bar, e));
  const down = (e: MouseEvent) => {
    if (e.button !== 0 || e.detail > 1 || !caption(e)) return;
    void invoke('win_drag_start');
    const end = () => {
      void invoke('win_drag_end');
      window.removeEventListener('mouseup', end, true);
      window.removeEventListener('blur', end, true);
    };
    window.addEventListener('mouseup', end, true);
    window.addEventListener('blur', end, true);
  };
  const double = (e: MouseEvent) => {
    if (!caption(e)) return;
    void invoke('win_drag_end');
    void invoke('win_maximize_toggle');
  };
  bar.addEventListener('mousedown', down);
  bar.addEventListener('dblclick', double);
  return {
    destroy() {
      bar.removeEventListener('mousedown', down);
      bar.removeEventListener('dblclick', double);
    },
  };
}

/** Svelte action: a row that overflows sideways scrolls sideways under the mouse wheel. */
export function wheelScrollsSideways(row: HTMLElement) {
  const wheel = (e: WheelEvent) => {
    if (e.ctrlKey || row.scrollWidth <= row.clientWidth + 1) return;
    // A trackpad's own sideways swipe already scrolls; turn only an up/down wheel.
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * row.clientWidth : e.deltaY;
    const before = row.scrollLeft;
    row.scrollLeft += step;
    if (row.scrollLeft !== before) e.preventDefault();
  };
  row.addEventListener('wheel', wheel, { passive: false });
  return { destroy: () => row.removeEventListener('wheel', wheel) };
}
