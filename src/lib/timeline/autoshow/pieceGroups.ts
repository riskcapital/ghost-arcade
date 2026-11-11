/**
 * Piece groups for Auto show: how the mapping's pieces fall into groups a
 * show can light together, read from where they sit and what shape they
 * are. The mapping itself is never changed; the groups are kept with the
 * show as named where orders (`groupOrders`), so the user sees and reuses
 * them in any block's ⇄ Where.
 *
 *   hero      the piece(s) that stand out: much larger than the rest, else
 *             the one nearest the middle of the stage
 *   rows      bands top → bottom (each left → right), from the pieces'
 *             centres (spatialOrder's spots) split where there is a gap
 *   columns   bands left → right (each top → bottom), the same way
 *   faces     Top / Front / Left / Right: the name Map Sim's auto-map gives
 *             a face ("… · Top"), else the quad's shape (a front has level
 *             top and upright sides; a top keeps its level edges but leans;
 *             a side keeps upright edges but slopes)
 *   sets A/B  two sets that alternate like a checkerboard: neighbours (pieces
 *             that touch) go to different sets; when the pieces do not
 *             touch, every other piece in left → right order
 *
 * Pure and deterministic.
 */
import type { Layer } from '../../types';
import { isLookTarget } from '../../looks/edgeLooks';
import { pieceCentre } from '../where/spatialOrder';
import type { WhereNamedOrder } from '../where/whereModel';

export type FaceKind = 'top' | 'front' | 'left' | 'right';

export interface PieceInfo {
  id: string;
  name: string;
  /** Centre, output 0..1, y down. */
  x: number;
  y: number;
  /** Bounding box (output 0..1, y down). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Area on the output, aspect-corrected (fraction of a 1×1 square at the output's height). */
  area: number;
  face: FaceKind;
}

export interface PieceGroups {
  pieces: PieceInfo[];
  hero: string[];
  rows: string[][];
  columns: string[][];
  faces: Record<FaceKind, string[]>;
  setA: string[];
  setB: string[];
  /** How the sets and faces were found (for the dialog's honesty). */
  how: { sets: 'neighbours' | 'order'; faces: 'names' | 'shape' };
}

const FACE_NAME = /·\s*(top|front|left|right|back|bottom)\s*$/i;

/** The pieces of a mapping: shapes a look or a block can be on, with a place. */
export function pieceInfos(layers: readonly Layer[], aspect = 16 / 9): PieceInfo[] {
  const out: PieceInfo[] = [];
  for (const layer of layers) {
    if (!isLookTarget(layer) || !layer.corners) continue;
    const centre = pieceCentre(layer);
    if (!centre) continue;
    const c = layer.corners;
    // y down, like the spots.
    const pts = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft].map((p) => ({ x: p.x, y: 1 - p.y }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      area += a.x * aspect * b.y - b.x * aspect * a.y;
    }
    out.push({
      id: layer.id,
      name: layer.name || layer.id,
      x: centre.x,
      y: centre.y,
      box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
      area: Math.abs(area) / 2,
      face: faceOf(layer.name ?? '', pts, aspect),
    });
  }
  return out;
}

/** A face's kind from its name, else from its quad (TL, TR, BR, BL; y down). */
export function faceOf(name: string, pts: ReadonlyArray<{ x: number; y: number }>, aspect = 16 / 9): FaceKind {
  const named = FACE_NAME.exec(name)?.[1]?.toLowerCase();
  if (named === 'top' || named === 'front' || named === 'left' || named === 'right') return named;
  if (named === 'back') return 'front';
  if (named === 'bottom') return 'top';
  return faceFromShape(pts, aspect);
}

function faceFromShape(pts: ReadonlyArray<{ x: number; y: number }>, aspect: number): FaceKind {
  const [tl, tr, br, bl] = pts;
  const v = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (b.x - a.x) * aspect, y: b.y - a.y });
  const top = v(tl, tr);
  const bottom = v(bl, br);
  const left = v(tl, bl);
  const right = v(tr, br);
  const deg = (r: number) => (r * 180) / Math.PI;
  // How far the level edges tilt from level, and the upright ones from upright.
  const tiltLevel = Math.max(Math.abs(deg(Math.atan2(top.y, Math.abs(top.x) || 1e-9))), Math.abs(deg(Math.atan2(bottom.y, Math.abs(bottom.x) || 1e-9))));
  const tiltUpright = Math.max(Math.abs(deg(Math.atan2(left.x, Math.abs(left.y) || 1e-9))), Math.abs(deg(Math.atan2(right.x, Math.abs(right.y) || 1e-9))));
  if (tiltLevel < 12 && tiltUpright < 12) return 'front';
  if (tiltLevel <= tiltUpright) return 'top';
  // The top edge falls to the right (y down grows): a face turned to the
  // left of the viewer, else to the right.
  return top.y > 0 ? 'left' : 'right';
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Bands along one axis: sorted by `key`, split where the gap between
 *  neighbours is more than `gap`. */
function bands(pieces: readonly PieceInfo[], key: (p: PieceInfo) => number, gap: number): PieceInfo[][] {
  const sorted = [...pieces].sort((a, b) => key(a) - key(b) || (a.id < b.id ? -1 : 1));
  const out: PieceInfo[][] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && key(p) - key(last[last.length - 1]) <= gap) last.push(p);
    else out.push([p]);
  }
  return out;
}

/** Rows (or columns): gap bands, or even bands when the gaps do not say. */
function lines(pieces: readonly PieceInfo[], axis: 'y' | 'x'): string[][] {
  if (!pieces.length) return [];
  const key = (p: PieceInfo) => (axis === 'y' ? p.y : p.x);
  const across = (p: PieceInfo) => (axis === 'y' ? p.x : p.y);
  const size = median(pieces.map((p) => (axis === 'y' ? p.box.y1 - p.box.y0 : p.box.x1 - p.box.x0)));
  let found = bands(pieces, key, Math.max(1e-4, size * 0.45));
  const n = pieces.length;
  const extent = Math.max(...pieces.map(key)) - Math.min(...pieces.map(key));
  // One band that spans far more than a piece (packed with no gaps), or a
  // band per piece or two: no clear bands.
  const packed = found.length === 1 && extent > 2.5 * size;
  if (n >= 4 && (packed || found.length > Math.max(2, Math.ceil(n / 1.5)))) {
    // No clear bands: even bands of about √n pieces.
    const count = Math.max(2, Math.round(Math.sqrt(n)));
    const sorted = [...pieces].sort((a, b) => key(a) - key(b) || (a.id < b.id ? -1 : 1));
    found = [];
    for (let i = 0; i < count; i++) {
      const part = sorted.slice(Math.floor((i * n) / count), Math.floor(((i + 1) * n) / count));
      if (part.length) found.push(part);
    }
  }
  return found.map((band) => [...band].sort((a, b) => across(a) - across(b) || (a.id < b.id ? -1 : 1)).map((p) => p.id));
}

/** Two pieces touch (their boxes meet, allowing a sliver of gap). */
function touching(a: PieceInfo, b: PieceInfo, slack: number): boolean {
  return a.box.x0 <= b.box.x1 + slack && b.box.x0 <= a.box.x1 + slack && a.box.y0 <= b.box.y1 + slack && b.box.y0 <= a.box.y1 + slack;
}

/** How much two touching pieces are neighbours: the length they share
 *  (an edge counts fully, a corner barely), relative to the smaller one. */
function contact(a: PieceInfo, b: PieceInfo): number {
  const ox = Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0);
  const oy = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0);
  const size = Math.min(a.box.x1 - a.box.x0, a.box.y1 - a.box.y0, b.box.x1 - b.box.x0, b.box.y1 - b.box.y0) || 1e-6;
  return 0.05 + Math.min(1, Math.max(0, Math.max(ox, oy)) / size);
}

/** Two alternating sets: neighbours apart (greedy two-colouring in reading
 *  order, then a few passes that move a piece when that splits more
 *  neighbours), else every other piece left → right. */
function alternatingSets(pieces: readonly PieceInfo[], order: readonly string[]): { a: string[]; b: string[]; how: 'neighbours' | 'order' } {
  const index = new Map(order.map((id, i) => [id, i]));
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const sorted = order.map((id) => byId.get(id)!).filter(Boolean);
  const slack = 0.15 * Math.min(
    median(pieces.map((p) => p.box.x1 - p.box.x0)),
    median(pieces.map((p) => p.box.y1 - p.box.y0)),
  );
  const near = new Map<string, Array<[string, number]>>();
  for (const p of sorted) near.set(p.id, []);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (!touching(sorted[i], sorted[j], slack)) continue;
      const w = contact(sorted[i], sorted[j]);
      near.get(sorted[i].id)!.push([sorted[j].id, w]);
      near.get(sorted[j].id)!.push([sorted[i].id, w]);
    }
  }
  const connected = sorted.filter((p) => near.get(p.id)!.length > 0).length;
  if (sorted.length < 3 || connected < sorted.length * 0.5) {
    const a = order.filter((_, i) => i % 2 === 0);
    const b = order.filter((_, i) => i % 2 === 1);
    return { a, b, how: 'order' };
  }
  const colour = new Map<string, 0 | 1>();
  const count = [0, 0];
  // Reading order: rows top → bottom, left → right within.
  const reading = [...sorted].sort((p, q) => p.y - q.y || p.x - q.x || (index.get(p.id)! - index.get(q.id)!));
  for (const p of reading) {
    const same = [0, 0];
    for (const [id, w] of near.get(p.id)!) {
      const c = colour.get(id);
      if (c !== undefined) same[c] += w;
    }
    const pick: 0 | 1 = same[0] < same[1] - 1e-9 ? 0 : same[1] < same[0] - 1e-9 ? 1 : count[0] <= count[1] ? 0 : 1;
    colour.set(p.id, pick);
    count[pick]++;
  }
  // A few passes: move a piece to the other set when more of its neighbours are in its own.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const p of reading) {
      const mine = colour.get(p.id)!;
      let sameCount = 0;
      let other = 0;
      for (const [id, w] of near.get(p.id)!) {
        if (colour.get(id) === mine) sameCount += w;
        else other += w;
      }
      const balanced = count[mine] - 1 >= count[1 - mine] - 1 - Math.ceil(sorted.length * 0.1);
      if (sameCount > other && balanced) {
        colour.set(p.id, (1 - mine) as 0 | 1);
        count[mine]--;
        count[1 - mine]++;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return {
    a: order.filter((id) => colour.get(id) === 0),
    b: order.filter((id) => colour.get(id) === 1),
    how: 'neighbours',
  };
}

/** How evenly the sets split neighbours: the share of touching pairs in different sets. */
export function setsSplitNeighbours(groups: Pick<PieceGroups, 'pieces' | 'setA'>): number {
  const inA = new Set(groups.setA);
  const pieces = groups.pieces;
  const slack = 0.15 * Math.min(median(pieces.map((p) => p.box.x1 - p.box.x0)), median(pieces.map((p) => p.box.y1 - p.box.y0)));
  let pairs = 0;
  let split = 0;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (!touching(pieces[i], pieces[j], slack)) continue;
      pairs++;
      if (inA.has(pieces[i].id) !== inA.has(pieces[j].id)) split++;
    }
  }
  return pairs ? split / pairs : 1;
}

/** The groups of the mapping's pieces. `aspect` = output width / height. */
export function pieceGroups(layers: readonly Layer[], aspect = 16 / 9): PieceGroups {
  const pieces = pieceInfos(layers, aspect);
  const leftRight = [...pieces].sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1)).map((p) => p.id);
  // Hero: much larger than the rest, else the one nearest the middle.
  let hero: string[] = [];
  if (pieces.length) {
    const areas = pieces.map((p) => p.area);
    const big = Math.max(...areas);
    const typical = median(areas);
    if (pieces.length >= 3 && big >= 2.2 * typical) {
      hero = [...pieces].filter((p) => p.area >= 0.7 * big).sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : 1)).slice(0, 3).map((p) => p.id);
    } else {
      const xs = pieces.map((p) => p.x);
      const ys = pieces.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const d = (p: PieceInfo) => Math.hypot((p.x - cx) * aspect, p.y - cy);
      hero = [[...pieces].sort((a, b) => d(a) - d(b) || b.area - a.area || (a.id < b.id ? -1 : 1))[0].id];
    }
  }
  const faces: Record<FaceKind, string[]> = { top: [], front: [], left: [], right: [] };
  for (const id of leftRight) {
    const p = pieces.find((x) => x.id === id)!;
    faces[p.face].push(id);
  }
  const named = layers.some((l) => FACE_NAME.test(l.name ?? ''));
  const sets = alternatingSets(pieces, leftRight);
  return {
    pieces,
    hero,
    rows: lines(pieces, 'y'),
    columns: lines(pieces, 'x'),
    faces,
    setA: sets.a,
    setB: sets.b,
    how: { sets: sets.how, faces: named ? 'names' : 'shape' },
  };
}

/** Ids of the named orders Auto show keeps with the show (stable, so a
 *  second Auto show replaces them instead of adding more). */
export const GROUP_ORDER_IDS = {
  all: 'autoshow:all',
  sets: 'autoshow:sets',
  setA: 'autoshow:set-a',
  setB: 'autoshow:set-b',
  hero: 'autoshow:hero',
  rows: 'autoshow:rows',
  columns: 'autoshow:columns',
  faces: 'autoshow:faces',
  ring: 'autoshow:around',
} as const;

export type GroupOrderKey = keyof typeof GROUP_ORDER_IDS;

/** The groups as named where orders: sets light together, rows and columns
 *  sweep band by band, faces go Top, Front, Left, Right. */
export function groupOrders(groups: PieceGroups): WhereNamedOrder[] {
  const out: WhereNamedOrder[] = [];
  const add = (key: GroupOrderKey, name: string, slots: string[][], order: WhereNamedOrder['order'] = 'left-right') => {
    const used = slots.filter((s) => s.length);
    if (!used.length) return;
    out.push({ id: GROUP_ORDER_IDS[key], name, order, slots: used });
  };
  const all = [...groups.pieces].sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1)).map((p) => [p.id]);
  add('all', '✦ All pieces', all);
  add('sets', '✦ Sets A | B', [groups.setA, groups.setB]);
  add('setA', '✦ Set A', [groups.setA]);
  add('setB', '✦ Set B', [groups.setB]);
  add('hero', '✦ Hero', [groups.hero]);
  add('rows', '✦ Rows', groups.rows);
  add('columns', '✦ Columns', groups.columns);
  add('faces', '✦ Faces', [groups.faces.top, groups.faces.front, groups.faces.left, groups.faces.right]);
  out.push({ id: GROUP_ORDER_IDS.ring, name: '✦ Around', order: 'around' });
  return out;
}

/** "81 pieces in 6 groups" — the groups worth naming (more than one piece). */
export function groupCount(groups: PieceGroups): number {
  let n = 0;
  if (groups.hero.length) n++;
  if (groups.setA.length && groups.setB.length) n += 2;
  if (groups.rows.length > 1) n++;
  if (groups.columns.length > 1) n++;
  if (Object.values(groups.faces).filter((f) => f.length).length > 1) n++;
  return n;
}
