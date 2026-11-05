/**
 * The Preview monitor: a display of its own showing what is going out (the
 * program) and, with the crossfader on, what each deck holds, beside the
 * Live Output on the projector. These are the parts that need no Electron:
 * which display it belongs on, and which core texture each of its tiles
 * shows.
 */

/** The tiles a Preview monitor can show, by the presenter view each one owns. */
export const PREVIEW_MONITOR_TILES = ['program', 'deck-a', 'deck-b'];

/** The presenter view name a tile is shown in. Kept apart from the VJ panel's deck panes. */
export function previewMonitorViewName(tile) {
  return `preview-monitor:${tile}`;
}

/** The decks render at this width while a Preview monitor shows them (480 otherwise). */
export const PREVIEW_MONITOR_DECK_WIDTH = 960;
export const DEFAULT_DECK_MONITOR_WIDTH = 480;

/** What identifies a display across unplugging it: its name, size and scale. */
export function displayFingerprint(display) {
  if (!display) return null;
  return {
    label: String(display.label || ''),
    width: Math.round(Number(display.bounds?.width ?? display.width ?? 0)),
    height: Math.round(Number(display.bounds?.height ?? display.height ?? 0)),
    scaleFactor: Number(display.scaleFactor ?? 1) || 1,
  };
}

function sameFingerprint(a, b) {
  return !!a && !!b && a.label === b.label && a.width === b.width && a.height === b.height
    && Math.abs(a.scaleFactor - b.scaleFactor) < 0.01;
}

/**
 * The display a Preview monitor belongs on: the one it was put on, by id;
 * failing that (ids change when a display is plugged back in) the one that
 * looks the same. Null when it is not connected.
 */
export function findPreviewMonitorDisplay(displays, wanted) {
  if (!Array.isArray(displays) || !wanted) return null;
  const byId = displays.find((d) => d.id === wanted.displayId);
  if (byId && (!wanted.fingerprint || sameFingerprint(displayFingerprint(byId), wanted.fingerprint))) return byId;
  if (wanted.fingerprint) {
    const alike = displays.find((d) => sameFingerprint(displayFingerprint(d), wanted.fingerprint));
    if (alike) return alike;
  }
  return byId || null;
}

/**
 * The texture a tile shows, from the core's answers: the output texture for
 * the program, a bank's monitor texture for a deck. `binding` changes only
 * when the presenter must be told again: macOS and the Windows vblank pump
 * present a bound texture by themselves; the older Windows presenter needs
 * every new frame. Null when there is nothing to show yet.
 */
export function previewMonitorTexture(tile, { output, decks, windows, nativePump }) {
  let source = null;
  if (tile === 'program') {
    source = output;
  } else {
    const bank = tile === 'deck-b' ? 'b' : 'a';
    source = Array.isArray(decks?.banks) ? decks.banks.find((b) => (b?.bank === 'b' ? 'b' : 'a') === bank) : null;
  }
  if (!source) return null;
  const width = Number(source.width ?? 0);
  const height = Number(source.height ?? 0);
  const frame = Number(source.frame ?? 0);
  if (!(width > 0 && height > 0)) return null;
  if (windows) {
    const sharedName = typeof source.shared_name === 'string' ? source.shared_name : '';
    if (!sharedName) return null;
    return { sharedName, width, height, frame, binding: `${sharedName}:${width}x${height}${nativePump ? '' : `:${frame}`}` };
  }
  const surfaceId = Number(source.handle ?? 0);
  if (!Number.isFinite(surfaceId) || surfaceId <= 0) return null;
  return { surfaceId, width, height, frame, binding: `${surfaceId}:${width}x${height}` };
}
