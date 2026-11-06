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
  /** The OS's own name for the display; may be empty. */
  label: string;
  /** What the interface shows: the label, or "Display N" without one. */
  name?: string;
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

/**
 * The name the OS gives a display, or '' when it gives none. Older builds
 * filled a missing name with "Display <id>", and that id is exactly what
 * Windows renumbers, so such a stored label says nothing about the display.
 */
function osLabel(label: unknown): string {
  const trimmed = String(label ?? '').trim();
  return /^Display \d+$/.test(trimmed) ? '' : trimmed;
}

export function displayFingerprint(display: DisplayLike): DisplayFingerprint {
  return {
    label: osLabel(display.label),
    width: Math.round(Number(display.width) || 0),
    height: Math.round(Number(display.height) || 0),
    scaleFactor: Number(display.scaleFactor) || 1,
  };
}

function sameLabel(display: DisplayLike, fp: DisplayFingerprint): boolean {
  const label = osLabel(fp.label);
  return !!label && osLabel(display.label) === label;
}

function sameShape(display: DisplayLike, fp: DisplayFingerprint): boolean {
  return Math.round(display.width) === fp.width
    && Math.round(display.height) === fp.height
    && Math.abs((Number(display.scaleFactor) || 1) - fp.scaleFactor) < 0.01;
}

/** Looks like the saved display: its name (when one was saved), size and
 *  scale. Without a saved name, size and scale are all there is to go on. */
function matchesFingerprint(display: DisplayLike, fp: DisplayFingerprint): boolean {
  if (osLabel(fp.label) && !sameLabel(display, fp)) return false;
  return sameShape(display, fp);
}

/**
 * Which connected display a saved `{ id, fingerprint }` refers to.
 *
 * - The id is connected and looks like the saved display (or no fingerprint
 *   was saved): that display.
 * - Otherwise the one display that looks like the saved one (ids were
 *   reshuffled, or the id is gone).
 * - Otherwise the one display with the saved name: a projector whose
 *   resolution or scale was changed on purpose. The id decides while it
 *   still names it.
 * - Otherwise missing, also when the id now names a display with another
 *   name (the laptop panel that inherited the projector's id): opening there
 *   would cover the editor. An empty display list (enumeration failed) is
 *   not treated as missing: callers cannot tell, so they keep the saved id.
 */
export function resolveSavedDisplay<D extends DisplayLike>(
  displays: D[],
  id: number | null | undefined,
  fingerprint?: DisplayFingerprint | null,
): DisplayResolution<D> {
  if (id == null && !fingerprint) return { status: 'unset', display: null };
  const byId = id == null ? null : displays.find((d) => d.id === id) ?? null;
  if (!fingerprint) return byId ? { status: 'found', display: byId } : { status: 'missing', display: null };
  if (byId && matchesFingerprint(byId, fingerprint)) return { status: 'found', display: byId };
  const matching = displays.filter((d) => matchesFingerprint(d, fingerprint));
  if (matching.length === 1) return { status: 'renumbered', display: matching[0] };
  // No name saved: a display of another size under the old id is not it.
  if (!osLabel(fingerprint.label)) return { status: 'missing', display: null };
  // The same name under the id: its resolution or scale was changed.
  if (byId && sameLabel(byId, fingerprint)) return { status: 'found', display: byId };
  const named = displays.filter((d) => sameLabel(d, fingerprint));
  if (named.length === 1) return { status: 'renumbered', display: named[0] };
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

export type LiveOutputDisplayChoice<D extends DisplayLike> = {
  /** Where the output opens; null when there is nowhere it may go. */
  display: D | null;
  /** The display picked for the output is not connected, so another was used. */
  savedMissing: boolean;
};

/**
 * Which display the Live Output opens on.
 *
 * The display picked for it (right-click on the output buttons) when it is
 * connected; otherwise the first display that is not the main one. A
 * fullscreen output never takes the main display, where it would cover the
 * editor; a windowed preview falls back to it when nothing else is
 * connected.
 */
export function pickLiveOutputDisplay<D extends DisplayLike>(
  displays: D[],
  savedId: number | null | undefined,
  savedFingerprint: DisplayFingerprint | null | undefined,
  options: { fullscreen: boolean },
): LiveOutputDisplayChoice<D> {
  const saved = resolveSavedDisplay(displays, savedId, savedFingerprint);
  const savedMissing = saved.status === 'missing' && displays.length > 0;
  if (saved.display && !(options.fullscreen && saved.display.isPrimary)) {
    return { display: saved.display, savedMissing: false };
  }
  const external = displays.find((d) => !d.isPrimary) ?? null;
  if (external) return { display: external, savedMissing };
  if (options.fullscreen) return { display: null, savedMissing };
  return { display: displays.find((d) => d.isPrimary) ?? displays[0] ?? null, savedMissing };
}
