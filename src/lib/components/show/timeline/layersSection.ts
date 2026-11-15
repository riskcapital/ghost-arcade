/**
 * The Timeline's Layers section: every piece and layer row (with its added
 * layers and lines) sits under one "Layers" header that folds them away;
 * group rows stay above it. Folded, the header's lane is a thin strip that
 * shows where any layer has blocks, so nothing on the rows is out of sight.
 *
 * Only how the rows are drawn: the show's row list (layerTracks) keeps its
 * order and nothing here goes into the project or the undo history. The
 * choice is kept per project on this computer (a short list in local
 * storage, oldest dropped first); a project never folded shows its layer
 * rows unless it has group rows.
 *
 * The geometry here replaces trackTops / trackIndexAt for the row stack:
 * the headers (ShowTrackHeaders) and lanes (ShowTrackLanes) draw from the
 * same RowStack, so a header always lines up with its lane.
 */
import { derived, get, writable, type Readable } from 'svelte/store';
import type { ShowLayerTrack } from '../../../types';
import { project } from '../../../stores/layers';
import { showTimeline } from '../../../stores/showTimeline';
import { showSlice, distinct } from './timelineSlices';
import { ADD_TRACK_ROW_HEIGHT, focusedTrackId, laneKeySelection, trackHeight } from './trackLayout';
import type { LineLayout } from './lineUi';

/** Height of the Layers header (and, folded, of its summary strip). */
export const LAYERS_SECTION_HEIGHT = 26;

type Row = Pick<ShowLayerTrack, 'id' | 'group' | 'subRow' | 'collapsed' | 'lanes' | 'row'>;

/** A group row (its blocks play across a group of pieces): above the Layers section. */
export function isGroupRow(t: Pick<ShowLayerTrack, 'group'>): boolean {
  return !!t.group;
}

export interface RowStack<T extends Row = ShowLayerTrack> {
  /** Every row in the order drawn: group rows, then the layer rows. */
  rows: readonly T[];
  /** rows[0 .. groupCount) are the group rows. */
  groupCount: number;
  /** The layer rows are shown (the section is open). */
  open: boolean;
  /** The Layers header is drawn: there are layer rows. */
  section: boolean;
  /** What the header counts: the pieces (and mapping groups) under it. */
  count: number;
}

/**
 * The rows as drawn. With no group rows this is the show's own list (same
 * array), so a show without groups draws exactly as before.
 */
export function rowStack<T extends Row>(tracks: readonly T[], open: boolean): RowStack<T> {
  let groups: T[] | null = null;
  let count = 0;
  for (const t of tracks) {
    if (isGroupRow(t)) (groups ??= []).push(t);
    else if (!t.subRow) count++;
  }
  const layerRows = tracks.length - (groups?.length ?? 0);
  const rows = groups ? [...groups, ...tracks.filter((t) => !isGroupRow(t))] : tracks;
  return { rows, groupCount: groups?.length ?? 0, open, section: layerRows > 0, count };
}

/** The row is drawn: a group row always; a layer row while the section is
 *  open and its mapping group is not folded. */
export function rowShown(stack: Pick<RowStack<Row>, 'open'>, t: Row): boolean {
  if (isGroupRow(t)) return true;
  return stack.open && !t.row?.hidden;
}

/** Height of a row in the stack (0 when it is not drawn). */
export function stackRowHeight(stack: Pick<RowStack<Row>, 'open'>, t: Row, layout?: LineLayout): number {
  if (!rowShown(stack, t)) return 0;
  // A group row ignores its host's fold: it is not inside the mapping group.
  return trackHeight(t.row?.hidden ? { ...t, row: { ...t.row, hidden: false } } : t, layout);
}

/** Top of the Layers header in the stack. */
export function stackSectionTop(stack: RowStack<Row>, layout?: LineLayout): number {
  let y = 0;
  for (let i = 0; i < stack.groupCount; i++) y += stackRowHeight(stack, stack.rows[i], layout);
  return y;
}

/** Top of each row in the stack (the header sits between the groups and the layers). */
export function stackTops(stack: RowStack<Row>, layout?: LineLayout): number[] {
  const tops: number[] = [];
  let y = 0;
  stack.rows.forEach((t, i) => {
    if (i === stack.groupCount && stack.section) y += LAYERS_SECTION_HEIGHT;
    tops.push(y);
    y += stackRowHeight(stack, t, layout);
  });
  return tops;
}

/** The rows' height with the header and the "+ Group row" strip under them. */
export function stackHeight(stack: RowStack<Row>, layout?: LineLayout): number {
  let h = ADD_TRACK_ROW_HEIGHT + (stack.section ? LAYERS_SECTION_HEIGHT : 0);
  for (const t of stack.rows) h += stackRowHeight(stack, t, layout);
  return h;
}

/**
 * Index (in `rows`) of the drawn row under `y`, in stack coordinates. On the
 * Layers header, the nearer row on either side of it; past the ends, the
 * first or last drawn row. -1 for an empty stack.
 */
export function stackIndexAt(stack: RowStack<Row>, y: number, layout?: LineLayout): number {
  const { rows } = stack;
  if (!rows.length) return -1;
  const tops = stackTops(stack, layout);
  let last = -1;
  for (let i = 0; i < rows.length; i++) {
    const h = stackRowHeight(stack, rows[i], layout);
    if (h <= 0) continue;
    if (y < tops[i]) return last >= 0 && y < tops[i] - LAYERS_SECTION_HEIGHT / 2 ? last : i;
    if (y < tops[i] + h) return i;
    last = i;
  }
  return last >= 0 ? last : rows.length - 1;
}

/**
 * Where the folded layer rows have blocks: their spans merged, in view
 * order. Drawn as the summary strip.
 */
export function layerBlockSpans(stack: RowStack<Pick<ShowLayerTrack, 'id' | 'group' | 'subRow' | 'collapsed' | 'lanes' | 'row' | 'clips'>>): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (let i = stack.groupCount; i < stack.rows.length; i++) {
    for (const c of stack.rows[i].clips) spans.push({ start: c.startTime, end: c.startTime + c.duration });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (prev && s.start <= prev.end + 1e-6) prev.end = Math.max(prev.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

// ── Open or folded, per project ─────────────────────────────────────────

export const LAYERS_OPEN_KEY = 'ga.timeline.layersOpen';
/** Projects whose choice is kept; the oldest goes first. */
export const LAYERS_OPEN_CAP = 64;

export type LayersChoices = Array<[projectId: string, open: boolean]>;

/** The list with `projectId`'s choice last (most recent), at most `cap` long. */
export function rememberLayersChoice(list: LayersChoices, projectId: string, open: boolean, cap = LAYERS_OPEN_CAP): LayersChoices {
  const next = list.filter(([id]) => id !== projectId);
  next.push([projectId, open]);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function readLayersChoices(): LayersChoices {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LAYERS_OPEN_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is [string, boolean] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'boolean')
      .slice(-LAYERS_OPEN_CAP);
  } catch {
    return [];
  }
}

function writeLayersChoices(list: LayersChoices): void {
  try { localStorage.setItem(LAYERS_OPEN_KEY, JSON.stringify(list)); } catch { /* private window, full storage */ }
}

/** Open while never chosen: unless the show has group rows. */
export function layersOpenFor(choice: boolean | null, hasGroups: boolean): boolean {
  return choice ?? !hasGroups;
}

const projectId = distinct(derived(project, (p) => (p as { id?: string }).id ?? ''));

/** This project's choice (null: never folded or opened). */
const choice = writable<boolean | null>(null);
projectId.subscribe((id) => {
  const found = id ? readLayersChoices().find(([pid]) => pid === id) : undefined;
  choice.set(found ? found[1] : null);
});

const hasGroups = distinct(derived(showSlice('layerTracks'), (tracks) => tracks.some(isGroupRow)));

/** The Layers section is open. */
export const layersOpen: Readable<boolean> = derived([choice, hasGroups], ([c, g]) => layersOpenFor(c, g));

/** The rows as drawn, for the headers and the lanes alike. */
export const timelineRowStack: Readable<RowStack> = derived(
  [showSlice('layerTracks'), layersOpen],
  ([tracks, open]) => rowStack(tracks, open),
);

/**
 * Open or fold the section (remembered for this project). Folding lets go
 * of what sits on the layer rows (blocks, keys, the focused row), so no key
 * acts on a block that is out of sight.
 */
export function setLayersOpen(open: boolean): void {
  const id = get(projectId);
  choice.set(open);
  if (id) writeLayersChoices(rememberLayersChoice(readLayersChoices(), id, open));
  if (open) return;
  const s = get(showTimeline);
  const layerRowIds = new Set(s.layerTracks.filter((t) => !isGroupRow(t)).map((t) => t.id));
  const onLayers = new Set(s.layerTracks.filter((t) => layerRowIds.has(t.id)).flatMap((t) => t.clips.map((c) => c.id)));
  if (s.selectedClipIds.some((cid) => onLayers.has(cid))) showTimeline.selectLayerClips(s.selectedClipIds.filter((cid) => !onLayers.has(cid)));
  if (s.selection?.kind === 'track' && layerRowIds.has(s.selection.id)) showTimeline.select(null);
  const keys = get(laneKeySelection);
  if (keys && layerRowIds.has(keys.trackId)) laneKeySelection.set(null);
  const focused = get(focusedTrackId);
  if (focused && layerRowIds.has(focused)) focusedTrackId.set(null);
}

export function toggleLayersOpen(): void {
  setLayersOpen(!get(layersOpen));
}

/**
 * Something newly picked lives on a layer row (a block selected from the
 * inspector, select-all, an undo): the folded section has to
 * open to show it. Only what is new in `next` counts, so folding never
 * opens the section again by itself.
 */
export function revealsLayerRow(
  tracks: readonly Pick<ShowLayerTrack, 'id' | 'group' | 'clips'>[],
  prevClipIds: readonly string[],
  nextClipIds: readonly string[],
  prevTrackId: string | null = null,
  nextTrackId: string | null = null,
): boolean {
  if (nextTrackId && nextTrackId !== prevTrackId) {
    const t = tracks.find((x) => x.id === nextTrackId);
    if (t && !isGroupRow(t)) return true;
  }
  const before = new Set(prevClipIds);
  const fresh = nextClipIds.filter((id) => !before.has(id));
  if (!fresh.length) return false;
  const wanted = new Set(fresh);
  return tracks.some((t) => !isGroupRow(t) && t.clips.some((c) => wanted.has(c.id)));
}

/**
 * While the section is folded, open it when the show's selection moves onto
 * a layer row. Returns the stop function (the Timeline calls it on unmount).
 */
export function watchLayerReveal(): () => void {
  let prevClips: readonly string[] = get(showTimeline).selectedClipIds;
  const sel0 = get(showTimeline).selection;
  let prevTrack: string | null = sel0?.kind === 'track' ? sel0.id : null;
  const check = () => {
    const s = get(showTimeline);
    const nextTrack = s.selection?.kind === 'track' ? s.selection.id : null;
    const reveal = !get(layersOpen) && revealsLayerRow(s.layerTracks, prevClips, s.selectedClipIds, prevTrack, nextTrack);
    prevClips = s.selectedClipIds;
    prevTrack = nextTrack;
    if (reveal) setLayersOpen(true);
  };
  const a = showSlice('selectedClipIds').subscribe(check);
  const b = showSlice('selection').subscribe(check);
  return () => { a(); b(); };
}
