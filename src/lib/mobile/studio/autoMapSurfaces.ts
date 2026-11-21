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
};

export function autoMapSurfaces(scans: AutoMapScan[], depth?: DepthScan, mode: MeshMode = 'wrap'): AutoMapped[] & { curvedScans?: CurvedScan[] } {
  const flat: AutoMapped[] = [];
  scans.forEach((projector, scan) => {
    for (const found of detectSurfaces(projector, { photo: projector.white })) {
      flat.push({ scan, outline: found.outline.map(p => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) })), points: found.points, rmsPx: found.rmsPx, ...(found.edgePx !== undefined ? { edgePx: found.edgePx } : {}) });
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
    found.surfaces.forEach((surface, region) => curved.push({ scan, outline: surface.outline, points: surface.corners, rmsPx: surface.rmsPx, curved: { region, surface } }));
  });
  out.push(...flat.filter(f => !dropped.has(f)), ...curved);
  return out;
}
