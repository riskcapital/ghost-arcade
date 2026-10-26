/*
 * Finding a saved display again.
 *
 * Electron's display ids are not stable: Windows hands out new ones when a
 * projector is unplugged and plugged back in, or when the cable moves to
 * another port, and a project opened on another computer carries ids that
 * mean nothing there. A Screen or the Live Output that only remembered the id
 * then fell back to the main display and covered the editor.
 *
 * Alongside the id we keep what the display looked like (its name, size and
 * scale), and use that to recognise it under a new id. When nothing connected
 * matches, the display is reported missing and nothing opens.
 */

export type DisplayLike = {
  id: number;
  label: string;
  width: number;
  height: number;
  isPrimary?: boolean;
  scaleFactor?: number;
};

/** What a display looked like when it was picked. */
export type DisplayFingerprint = {
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
};

export type DisplayResolution<D extends DisplayLike> =
  /** The saved id is connected (and, if a fingerprint was saved, still the same screen). */
  | { status: 'found'; display: D }
  /** The saved id is gone or now names another screen; this one matches the fingerprint. */
  | { status: 'renumbered'; display: D }
  /** Nothing connected is the saved display. */
  | { status: 'missing'; display: null }
  /** Nothing was saved. */
  | { status: 'unset'; display: null };

export function displayFingerprint(display: DisplayLike): DisplayFingerprint {
  return {
    label: String(display.label ?? ''),
    width: Math.round(Number(display.width) || 0),
    height: Math.round(Number(display.height) || 0),
    scaleFactor: Number(display.scaleFactor) || 1,
  };
}

function sameLabel(display: DisplayLike, fp: DisplayFingerprint): boolean {
  return !!fp.label && String(display.label ?? '') === fp.label;
}

function sameShape(display: DisplayLike, fp: DisplayFingerprint): boolean {
  return Math.round(display.width) === fp.width
    && Math.round(display.height) === fp.height
    && Math.abs((Number(display.scaleFactor) || 1) - fp.scaleFactor) < 0.01;
}

/** The single display that is the fingerprinted one, or null if none or several are. */
function findByFingerprint<D extends DisplayLike>(displays: D[], fp: DisplayFingerprint): D | null {
  const exact = displays.filter((d) => sameLabel(d, fp) && sameShape(d, fp));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // The same projector after its resolution was changed.
  const byLabel = displays.filter((d) => sameLabel(d, fp));
  if (byLabel.length === 1) return byLabel[0];
  return null;
}

/**
 * Which connected display a saved `{ id, fingerprint }` refers to.
 *
 * - The id is connected and looks like the saved display (or no fingerprint
 *   was saved): that display.
 * - The id is connected but now names a different screen, and exactly one
 *   other display looks like the saved one: that one (ids were reshuffled).
 * - The id is gone and exactly one display looks like the saved one: that one.
 * - Otherwise missing. An empty display list (enumeration failed) is not
 *   treated as missing: callers cannot tell, so they keep the saved id.
 */
export function resolveSavedDisplay<D extends DisplayLike>(
  displays: D[],
  id: number | null | undefined,
  fingerprint?: DisplayFingerprint | null,
): DisplayResolution<D> {
  if (id == null && !fingerprint) return { status: 'unset', display: null };
  const byId = id == null ? null : displays.find((d) => d.id === id) ?? null;
  // The id still names the same screen (a resolution change keeps its name).
  if (byId && (!fingerprint || !fingerprint.label || sameLabel(byId, fingerprint))) {
    return { status: 'found', display: byId };
  }
  const match = fingerprint ? findByFingerprint(displays, fingerprint) : null;
  if (match) return { status: match === byId ? 'found' : 'renumbered', display: match };
  // The id names a screen with another name and nothing else matches: most
  // likely the same screen reporting a new name, so keep it.
  if (byId) return { status: 'found', display: byId };
  return { status: 'missing', display: null };
}

/** True when a saved display is known to be disconnected (never for an empty list). */
export function savedDisplayMissing(
  displays: DisplayLike[],
  id: number | null | undefined,
  fingerprint?: DisplayFingerprint | null,
): boolean {
  if (displays.length === 0) return false;
  return resolveSavedDisplay(displays, id, fingerprint).status === 'missing';
}
