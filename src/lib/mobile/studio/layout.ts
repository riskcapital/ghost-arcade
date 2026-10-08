// One place decides how the mobile studio is laid out.
//
// Every component reads the result as `data-layout` on the studio root (and `data-ga-layout` on
// <html> for dialogs that live outside it), so there is a single set of named layouts instead of
// per-file width breakpoints. The sizes are CSS pixels of the app window, which is the device
// screen on iPhone and can be any Split View or Stage Manager size on iPad.

/** The four layouts the studio is drawn in. */
export type StudioLayout = 'phone' | 'phone-landscape' | 'tablet-portrait' | 'tablet';

/** Where the clip/layer inspector (Controls) lives. */
export type InspectorPlacement = 'sheet' | 'bottom' | 'side';

/** Where the workspace tabs are drawn. */
export type NavPlacement = 'bottom' | 'rail' | 'top';

export interface LayoutInfo {
  layout: StudioLayout;
  /** Controls: a sheet on phones, docked under the deck on a tall tablet, beside it in landscape. */
  inspector: InspectorPlacement;
  /** The mixer is always on screen on tablets and a half-height sheet on phones. */
  mixer: 'sheet' | 'docked';
  nav: NavPlacement;
  /** Too short to show the full preview and four deck rows together: the preview starts collapsed. */
  short: boolean;
}

/** Window heights below this are a phone held sideways (the tallest is 440 pt). */
export const LANDSCAPE_PHONE_MAX_HEIGHT = 500;
/** Narrower than this is a phone, or an iPad app in the narrow Split View column. */
export const PHONE_MAX_WIDTH = 600;
/** From this width, and clearly wider than tall, three panes fit side by side. */
export const TABLET_MIN_WIDTH = 1000;
/** A stacked tablet this tall has room for the inspector under the deck. */
export const DOCKED_INSPECTOR_MIN_HEIGHT = 1100;
/** A phone shorter than this cannot show the full preview above four deck rows. */
export const SHORT_PHONE_HEIGHT = 700;

export function studioLayout(width: number, height: number): LayoutInfo {
  const w = Math.max(0, Math.round(width)), h = Math.max(0, Math.round(height));
  if (h < LANDSCAPE_PHONE_MAX_HEIGHT && w > h) {
    return { layout: 'phone-landscape', inspector: 'sheet', mixer: 'sheet', nav: 'rail', short: true };
  }
  if (w < PHONE_MAX_WIDTH) {
    return { layout: 'phone', inspector: 'sheet', mixer: 'sheet', nav: 'bottom', short: h < SHORT_PHONE_HEIGHT };
  }
  if (w >= TABLET_MIN_WIDTH && w >= h * 1.15) {
    return { layout: 'tablet', inspector: 'side', mixer: 'docked', nav: 'top', short: false };
  }
  return {
    layout: 'tablet-portrait',
    inspector: h >= DOCKED_INSPECTOR_MIN_HEIGHT ? 'bottom' : 'sheet',
    mixer: 'docked',
    nav: 'bottom',
    short: false,
  };
}

const same = (a: LayoutInfo, b: LayoutInfo) =>
  a.layout === b.layout && a.inspector === b.inspector && a.mixer === b.mixer && a.nav === b.nav && a.short === b.short;

/** The layout for the window as it is now. Safe to call before the first render. */
export function currentLayout(): LayoutInfo {
  if (typeof window === 'undefined') return studioLayout(390, 844);
  return studioLayout(window.innerWidth, window.innerHeight);
}

/**
 * Calls `onchange` whenever a rotation, Split View drag or Stage Manager resize moves the window
 * into a different layout. Also mirrors the name onto <html> for dialogs outside the studio root.
 */
export function watchLayout(onchange: (info: LayoutInfo) => void): () => void {
  let last = currentLayout();
  const root = document.documentElement;
  const mirror = (info: LayoutInfo) => { root.dataset.gaLayout = info.layout; };
  mirror(last);
  const check = () => {
    const next = currentLayout();
    if (same(next, last)) return;
    last = next;
    mirror(next);
    onchange(next);
  };
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  window.visualViewport?.addEventListener('resize', check);
  return () => {
    window.removeEventListener('resize', check);
    window.removeEventListener('orientationchange', check);
    window.visualViewport?.removeEventListener('resize', check);
    delete root.dataset.gaLayout;
  };
}
