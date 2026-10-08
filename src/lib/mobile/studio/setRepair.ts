// One-time repair for sets saved by app 1.0.
//
// Two things in those sets hide the picture, and both came from the app, not from the performer:
//   1. Every row blends Normal, so a clip on a lower row is hidden behind row 1.
//   2. Mapping is on with the one starter surface still at its 8% inset, because looking at the
//      Map tab switched mapping on. The output has a black border the performer never asked for.
// A set is never changed without being asked: the studio detects these, offers "Fix this set"
// once, and the fix is one undo step.
import { SET_REV, copy, fullFramePoints, gridPoints, starterBlend, type Show } from './model';

export type SetProblems = {
  /** Decks (0 = A, 1 = B) whose four rows all blend Normal. */
  hiddenDecks: number[];
  /** Mapping is on with the single starter surface still inset by 8%. */
  inset: boolean;
};

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** True for a set saved before the format revision existed, that is by app 1.0. */
export const fromFirstVersion = (show: Show): boolean => show.rev === undefined;

/**
 * What the 1.0 app left in this set. Only sets from that version are looked at: a performer who
 * chooses all-Normal blends in a current set means it.
 */
export function setProblems(show: Show): SetProblems {
  if (!fromFirstVersion(show)) return { hiddenDecks: [], inset: false };
  const decks = show.dualDeck ? [0, 1] : [0];
  const hiddenDecks = decks.filter((deck) => {
    const rows = show.layers.slice(deck * 4, deck * 4 + 4);
    return rows.length === 4 && rows.every((l) => l.blend === 'normal');
  });
  const starter = gridPoints();
  const only = show.surfaces.length === 1 ? show.surfaces[0] : undefined;
  const inset = show.mapping && !!only && only.points.length === starter.length && only.points.every((p, i) => near(p.x, starter[i].x) && near(p.y, starter[i].y));
  return { hiddenDecks, inset };
}

export const needsRepair = (problems: SetProblems): boolean => problems.inset || problems.hiddenDecks.length > 0;

/** One plain sentence for the offer, naming only what is wrong with this set. */
export function repairSummary(problems: SetProblems): string {
  const parts: string[] = [];
  if (problems.hiddenDecks.length) parts.push('clips on the lower rows are hidden behind row 1');
  if (problems.inset) parts.push('the picture sits inside a black border');
  if (!parts.length) return '';
  const text = parts.join(', and ');
  return `This set was saved by an older version: ${text}.`;
}

/**
 * The repaired set. Rows 1 to 3 of a hidden deck blend Screen over an opaque bottom row, as new
 * sets do. The starter surface goes back to the full frame; mapping stays on only if that surface
 * was given an edge fade, a look or a single-layer source, because then it is in use.
 * Layer contents, clips, blocks and every other setting are left exactly as saved.
 */
export function repairSet(show: Show, problems: SetProblems = setProblems(show)): Show {
  const next = copy(show);
  for (const deck of problems.hiddenDecks)
    for (let row = deck * 4; row < deck * 4 + 4; row++) if (next.layers[row]) next.layers[row].blend = starterBlend(row);
  if (problems.inset && next.surfaces[0]) {
    const surface = next.surfaces[0];
    surface.points = fullFramePoints();
    const inUse = surface.feather > 0 || !!surface.look?.enabled || surface.source !== 'mix' || !!next.paint?.strokes?.length;
    if (!inUse) next.mapping = false;
  }
  next.rev = SET_REV;
  return next;
}

/** Marks a set as looked at, with nothing changed, so it reads as a current set from now on. */
export const acceptAsIs = (show: Show): Show => ({ ...show, rev: SET_REV });
