// Where the picture sits inside a surface: which part of the source it shows, how big, and turned
// how far. Pure, so the controls, the span and the saved values are tested.
//
// A placement is the region of the source drawn on the surface: its centre (x, y) and size (w, h)
// in source coordinates (0–1 across the picture, y down), turned by `angle` radians about its
// centre. No placement means the whole picture, as before.

import type { Point, Show, Surface } from './model';

export type Placement = { x: number; y: number; w: number; h: number; angle: number };

export const WHOLE_PICTURE: Placement = { x: 0.5, y: 0.5, w: 1, h: 1, angle: 0 };

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A saved placement made safe for the renderer, or undefined when there is none. */
export function normalizePlacement(raw: unknown): Placement | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<Placement>;
  return {
    x: clampTo(finite(r.x, 0.5), -1, 2),
    y: clampTo(finite(r.y, 0.5), -1, 2),
    w: clampTo(finite(r.w, 1), 0.05, 8),
    h: clampTo(finite(r.h, 1), 0.05, 8),
    angle: clampTo(finite(r.angle, 0), -Math.PI, Math.PI),
  };
}

export const isWholePicture = (p: Placement | undefined) =>
  !p || (Math.abs(p.x - 0.5) < 1e-6 && Math.abs(p.y - 0.5) < 1e-6 && Math.abs(p.w - 1) < 1e-6 && Math.abs(p.h - 1) < 1e-6 && Math.abs(p.angle) < 1e-6);

/** The four controls a person moves: zoom (1 = whole picture), position and turn in degrees. */
export type PlacementControls = { zoom: number; x: number; y: number; degrees: number };

export function placementControls(p: Placement | undefined): PlacementControls {
  const q = p ?? WHOLE_PICTURE;
  return { zoom: 1 / Math.max(q.w, q.h), x: q.x, y: q.y, degrees: (q.angle * 180) / Math.PI };
}

/** A placement with one control changed. Zoom keeps the region's shape (a span's crop stays a crop). */
export function withControl(p: Placement | undefined, control: keyof PlacementControls, value: number): Placement {
  const q = { ...(p ?? WHOLE_PICTURE) };
  if (control === 'zoom') {
    const zoom = clampTo(value, 0.25, 8);
    const longest = Math.max(q.w, q.h);
    q.w = q.w / longest / zoom;
    q.h = q.h / longest / zoom;
  } else if (control === 'x') q.x = clampTo(value, -1, 2);
  else if (control === 'y') q.y = clampTo(value, -1, 2);
  else q.angle = clampTo((value * Math.PI) / 180, -Math.PI, Math.PI);
  return normalizePlacement(q)!;
}

/** Surfaces showing the same thing as surface `index`: the same clip, or the same deck source. */
export function sameSourceSurfaces(surfaces: Surface[], index: number): number[] {
  const from = surfaces[index];
  if (!from) return [];
  return surfaces.flatMap((s, i) => (s.enabled || i === index) && (from.clipId ? s.clipId === from.clipId : !s.clipId && s.source === from.source) ? [i] : []);
}

const box = (points: Point[]) => {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
};

/**
 * One picture spread over several surfaces: each shows the part of the picture that lies where
 * the surface sits in the output frame, so together they read as one image. Surfaces not listed
 * keep their placement.
 */
export function spanPlacements(surfaces: Surface[], indexes: number[]): Surface[] {
  const chosen = new Set(indexes);
  return surfaces.map((s, i) => {
    if (!chosen.has(i)) return s;
    const b = box(s.points);
    return { ...s, placement: normalizePlacement({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2, w: Math.max(0.05, b.right - b.left), h: Math.max(0.05, b.bottom - b.top), angle: 0 }) };
  });
}

/** Every listed surface shows what surface `index` shows (its clip, or its deck source). */
export function sameOnSurfaces(show: Pick<Show, 'surfaces'>, index: number, indexes: number[]): Surface[] {
  const from = show.surfaces[index];
  if (!from) return show.surfaces;
  const chosen = new Set(indexes);
  return show.surfaces.map((s, i) => {
    if (!chosen.has(i) || i === index) return s;
    const next: Surface = { ...s, source: from.source };
    if (from.clipId) next.clipId = from.clipId;
    else delete next.clipId;
    return next;
  });
}
