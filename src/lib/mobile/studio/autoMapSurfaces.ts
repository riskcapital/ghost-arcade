/**
 * The surfaces an auto-map finds, from the decoded stripe scans and (with
 * LiDAR) the depth: the flat faces from the stripes, and curved forms meshed
 * from the depth, a flat fit across a curved form giving way to its mesh.
 * Pure: the Calibration workshop runs it on the phone, tests run it on a
 * synthetic room.
 */
import type { Decoded, PatternPlan, UV } from './structuredLight';
import { detectSurfaces, type Photo } from './surfaceDetect';
import { mapCurvedSurfaces, type CurvedScan, type CurvedSurface, type DepthScan, type MeshMode } from './meshMap';

export type AutoMapScan = { id: string; width: number; height: number; plan: PatternPlan; decoded: Decoded; white?: Photo };

export type AutoMapped = {
  /** Index of the scan (projector) it was found in. */
  scan: number;
  /** The outline on the photo, normalised. */
  outline: UV[];
  /** Four corners in the projector's picture, normalised, top-left origin. */
  points: UV[];
  rmsPx: number;
  /** Stripe-edge residual of the flat fit, projector pixels (see DetectedSurface.edgePx). */
  edgePx?: number;
  curved?: { region: number; surface: CurvedSurface };
  /** Share of the photo it covers. */
  area: number;
  /** How much of its outline the scan filled (flat faces), 0..1. */
  solid: number;
  /**
   * A sliver, a scrap or a small curved blob: light falling off at a wall's
   * edge, clutter. Kept (more is better than less) but ranked after the real
   * faces and switched off until the user turns it on.
   */
  minor: boolean;
};

/** Short side over long side of an outline's box, 0..1 (thin slivers near 0). */
function slenderness(outline: UV[], aspect: number): number {
  // Sides of the outline in photo units (x scaled by the photo's aspect).
  let shortest = Infinity, longest = 0;
  if (outline.length === 4) {
    for (let i = 0; i < 4; i++) {
      const a = outline[i], b = outline[(i + 1) % 4], c = outline[(i + 2) % 4], d = outline[(i + 3) % 4];
      const side = (p: UV, q: UV) => Math.hypot((q.x - p.x) * aspect, q.y - p.y);
      // Opposite sides averaged: a quad's width and height.
      if (i < 2) { const w = (side(a, b) + side(c, d)) / 2; shortest = Math.min(shortest, w); longest = Math.max(longest, w); }
    }
    return longest > 0 ? shortest / longest : 0;
  }
  const xs = outline.map(p => p.x * aspect), ys = outline.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return Math.max(w, h) > 0 ? Math.min(w, h) / Math.max(w, h) : 0;
}

/** Real faces first (big, solid, not thin), then curved forms, then the minor finds. */
export function rankSurfaces(found: AutoMapped[]): AutoMapped[] {
  const score = (m: AutoMapped) => (m.minor ? 0 : m.curved ? 1 : 2) * 10 + Math.min(9.99, m.area * m.solid * 100);
  return found.slice().sort((a, b) => score(b) - score(a));
}

export function isMinor(m: { outline: UV[]; area: number; solid: number; curved?: unknown }, photoAspect: number): boolean {
  if (m.curved) return m.area < 0.01;
  return m.area < 0.003 || m.solid < 0.5 || slenderness(m.outline, photoAspect) < 0.18;
}

export function autoMapSurfaces(scans: AutoMapScan[], depth?: DepthScan, mode: MeshMode = 'wrap'): AutoMapped[] & { curvedScans?: CurvedScan[] } {
  const found = findSurfaces(scans, depth, mode);
  const ranked = rankSurfaces(found) as AutoMapped[] & { curvedScans?: CurvedScan[] };
  ranked.curvedScans = found.curvedScans;
  return ranked;
}

function findSurfaces(scans: AutoMapScan[], depth?: DepthScan, mode: MeshMode = 'wrap'): AutoMapped[] & { curvedScans?: CurvedScan[] } {
  const flat: AutoMapped[] = [];
  scans.forEach((projector, scan) => {
    for (const found of detectSurfaces(projector, { photo: projector.white })) {
      const outline = found.outline.map(p => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
      const aspect = projector.decoded.width / projector.decoded.height;
      flat.push({ scan, outline, points: found.points, rmsPx: found.rmsPx, ...(found.edgePx !== undefined ? { edgePx: found.edgePx } : {}), area: found.area, solid: found.solid, minor: isMinor({ outline, area: found.area, solid: found.solid }, aspect) });
    }
  });
  const out = [] as AutoMapped[] & { curvedScans?: CurvedScan[] };
  if (!depth) { out.push(...flat); return out; }
  const dropped = new Set<AutoMapped>();
  const curved: AutoMapped[] = [];
  out.curvedScans = [];
  scans.forEach((projector, scan) => {
    const own = flat.filter(f => f.scan === scan);
    const found = mapCurvedSurfaces({ width: projector.width, height: projector.height, cell: projector.plan.cell, decoded: projector.decoded }, depth, own.map(f => f.outline), mode);
    out.curvedScans![scan] = found;
    found.keepFlat.forEach((keep, k) => { if (!keep) dropped.add(own[k]); });
    found.surfaces.forEach((surface, region) => curved.push({ scan, outline: surface.outline, points: surface.corners, rmsPx: surface.rmsPx, curved: { region, surface }, area: surface.area, solid: 1, minor: isMinor({ outline: surface.outline, area: surface.area, solid: 1, curved: true }, 1) }));
  });
  out.push(...flat.filter(f => !dropped.has(f)), ...curved);
  return out;
}
