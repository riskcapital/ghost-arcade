/**
 * The show's rows come from the mapping stage: one row per mapping layer (a
 * piece), in the Layers panel's order, with groups folding their children.
 *
 * Pieces are gathered from the layers on stage now and from every look
 * (preset) the show uses, merged by layer id (a preset keeps the ids of the
 * layers it was saved from), so a piece that is only in a later look still
 * gets its row. A piece missing from the stage is placed after the piece it
 * follows in its look.
 *
 * Rows are tracks in the show store. A row with nothing on it (no blocks, no
 * lanes, no settings) is made on the fly with a fixed id, `row:<layerId>`,
 * and never saved, so opening a project does not change its show. Layers the
 * show adds on a piece (`subRow`) follow their piece's row. A row with blocks
 * whose piece no longer exists anywhere stays as a "missing piece" row the
 * user can delete; one with nothing on it simply goes.
 *
 * Pure: the show store applies the result.
 */
import type { Layer, ShowLayerTrack, ShowRowInfo } from '../../types';

export const SHOW_ROW_ID_PREFIX = 'row:';

/** The fixed id of a piece's own row. */
export function rowTrackId(layerId: string): string {
  return SHOW_ROW_ID_PREFIX + layerId;
}

export interface StagePiece {
  id: string;
  name: string;
  /** The layer as the stage (or, off stage, the first look having it) has it. */
  layer: Layer;
  isGroup: boolean;
  parentGroupId: string | null;
  /** In the current look. */
  onStage: boolean;
}

/**
 * Every piece the show can drive: the stage's layers in order, then the
 * layers of the looks the show uses that the stage lacks, each placed after
 * the piece it follows in its look (at the top when it leads its look).
 */
export function stagePieces(stage: readonly Layer[], looks: ReadonlyArray<readonly Layer[]>): StagePiece[] {
  const order: string[] = [];
  const byId = new Map<string, StagePiece>();
  for (const layer of stage) {
    if (!layer?.id || byId.has(layer.id)) continue;
    byId.set(layer.id, piece(layer, true));
    order.push(layer.id);
  }
  for (const look of looks) {
    let after: string | null = null;
    for (const layer of look) {
      if (!layer?.id) continue;
      if (byId.has(layer.id)) {
        after = layer.id;
        continue;
      }
      byId.set(layer.id, piece(layer, false));
      const at: number = after === null ? 0 : order.indexOf(after) + 1;
      // Past the pieces already inserted after the same predecessor, and past
      // a group's children when the predecessor is a group in another look.
      let i = at;
      if (after !== null) {
        while (i < order.length && isInside(byId, order[i], after)) i++;
      }
      order.splice(i, 0, layer.id);
      after = layer.id;
    }
  }
  return order.map((id) => byId.get(id)!);
}

function piece(layer: Layer, onStage: boolean): StagePiece {
  return {
    id: layer.id,
    name: layer.name || layer.id,
    layer,
    isGroup: layer.type === 'group',
    parentGroupId: layer.parentGroupId ?? null,
    onStage,
  };
}

/** `id` sits inside the group `groupId` (at any depth). */
function isInside(byId: ReadonlyMap<string, StagePiece>, id: string, groupId: string): boolean {
  let parent = byId.get(id)?.parentGroupId ?? null;
  for (let guard = 0; parent && guard < 64; guard++) {
    if (parent === groupId) return true;
    parent = byId.get(parent)?.parentGroupId ?? null;
  }
  return false;
}

/** A row with nothing on it that the show does not need to keep. */
export function isBareRow(track: ShowLayerTrack): boolean {
  return track.id === rowTrackId(track.layerId)
    && !track.subRow
    && track.clips.length === 0
    && track.lanes.length === 0
    && !track.muted
    && !track.locked
    && !track.color
    && !track.foldChildren
    && track.gap === 'hide';
}

/** A row that holds something of its own (blocks, lanes) and so needs its
 *  copy of the piece for when the piece is off stage. */
export function rowHasContent(track: ShowLayerTrack): boolean {
  return track.clips.length > 0 || track.lanes.length > 0;
}

export function bareRowFor(piece: Pick<StagePiece, 'id' | 'name'>): ShowLayerTrack {
  return {
    id: rowTrackId(piece.id),
    layerId: piece.id,
    layerName: piece.name,
    template: null,
    clips: [],
    lanes: [],
    gap: 'hide',
    muted: false,
    locked: false,
    collapsed: false,
  };
}

export interface ReconcileOptions {
  /** A clean copy of a layer for a row's template (trackTemplateFromLayer). */
  templateOf: (layer: Layer) => Layer;
}

function sameRowInfo(a: ShowRowInfo | undefined, b: ShowRowInfo): boolean {
  return !!a && a.kind === b.kind && a.depth === b.depth && a.hidden === b.hidden && a.onStage === b.onStage;
}

/**
 * The row list for `pieces`, from the tracks the show has. Returns null when
 * nothing changes (same rows in the same order, same names, same row info),
 * so the store is not written for nothing.
 */
export function reconcileStageRows(
  tracks: readonly ShowLayerTrack[],
  pieces: readonly StagePiece[],
  opts: ReconcileOptions,
): ShowLayerTrack[] | null {
  const mains = new Map<string, ShowLayerTrack>();
  const subs = new Map<string, ShowLayerTrack[]>();
  for (const t of tracks) {
    if (t.subRow) {
      const list = subs.get(t.layerId) ?? [];
      list.push(t);
      subs.set(t.layerId, list);
    } else if (!mains.has(t.layerId)) {
      mains.set(t.layerId, t);
    } else {
      // A second track on one piece (a hand-edited file): it carries on as a
      // layer on the piece rather than being lost.
      const list = subs.get(t.layerId) ?? [];
      list.push({ ...t, subRow: true });
      subs.set(t.layerId, list);
    }
  }
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  const depthOf = (p: StagePiece): number => {
    let depth = 0;
    let parent = p.parentGroupId;
    for (let guard = 0; parent && guard < 64; guard++) {
      const g = pieceById.get(parent);
      if (!g) break;
      depth++;
      parent = g.parentGroupId;
    }
    return depth;
  };
  const folded = (p: StagePiece): boolean => {
    let parent = p.parentGroupId;
    for (let guard = 0; parent && guard < 64; guard++) {
      const g = pieceById.get(parent);
      if (!g) break;
      if (mains.get(g.id)?.foldChildren) return true;
      parent = g.parentGroupId;
    }
    return false;
  };

  const out: ShowLayerTrack[] = [];
  const withRow = (t: ShowLayerTrack, row: ShowRowInfo, patch: Partial<ShowLayerTrack> = {}): ShowLayerTrack => {
    const keys = Object.keys(patch) as Array<keyof ShowLayerTrack>;
    const changed = !sameRowInfo(t.row, row) || keys.some((k) => t[k] !== patch[k]);
    return changed ? { ...t, ...patch, row } : t;
  };
  for (const p of pieces) {
    const depth = depthOf(p);
    const hidden = folded(p);
    const existing = mains.get(p.id) ?? bareRowFor(p);
    const patch: Partial<ShowLayerTrack> = {};
    if (existing.layerName !== p.name) patch.layerName = p.name;
    const own = subs.get(p.id) ?? [];
    if (!existing.template && (rowHasContent(existing) || own.length)) patch.template = opts.templateOf(p.layer);
    out.push(withRow(existing, { kind: p.isGroup ? 'group' : 'piece', depth, hidden, onStage: p.onStage }, patch));
    for (const sub of own) {
      const subPatch: Partial<ShowLayerTrack> = {};
      if (!sub.template) subPatch.template = opts.templateOf(p.layer);
      out.push(withRow(sub, { kind: 'sub', depth: depth + 1, hidden, onStage: p.onStage }, subPatch));
    }
  }
  // Rows whose piece is gone from the stage and every look.
  for (const t of tracks) {
    if (pieceById.has(t.layerId)) continue;
    const keep = rowHasContent(t) || t.muted || t.locked || (subs.get(t.layerId)?.length ?? 0) > 0;
    if (!t.subRow && !keep) continue;
    const row: ShowRowInfo = { kind: t.subRow ? 'sub' : 'missing', depth: t.subRow ? 1 : 0, hidden: false, onStage: false };
    out.push(withRow(t, row));
  }

  if (out.length === tracks.length && out.every((t, i) => t === tracks[i])) return null;
  return out;
}

/** The rows a track list shows, numbered from 1 as `show:live:<n>` counts
 *  them: every row but the layers added on a piece (those share the
 *  piece's takeover). */
export function numberedRows(tracks: readonly ShowLayerTrack[]): ShowLayerTrack[] {
  return tracks.filter((t) => !t.subRow);
}
