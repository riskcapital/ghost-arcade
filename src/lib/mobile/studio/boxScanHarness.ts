/**
 * Test-only harness for the synthetic auto-map rooms: runs the phone's real
 * decode and surface finding on a rendered scan, and scores each true face.
 */
import { decodeCaptures, type Capture } from './structuredLight';
import { turnIntrinsics, turnRaster, type Turn } from './lidarScan';
import { autoMapSurfaces, type AutoMapped } from './autoMapSurfaces';
import { faceTruth, renderDepth, renderScan, type FaceTruth, type RenderOptions, type Room } from './syntheticRoom';

const inside = (poly: { x: number; y: number }[], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

export type FaceReport = { id: string; surface: number; share: number; cornerPx: number; curved: boolean };

/** Which surface each true face got, and how far its corners are from the truth (projector pixels). */
export function scoreFaces(room: Room, mapped: AutoMapped[], truth: FaceTruth[]): FaceReport[] {
  const { width: pw, height: ph } = room.projector.lens;
  const quads = mapped.map(m => m.points.map(p => ({ x: p.x * pw, y: p.y * ph })));
  return truth.map(face => {
    // The surface that best matches the face: most of the face inside it, and not much else (overlap over union).
    const area = (poly: { x: number; y: number }[]) => Math.abs(poly.reduce((s, p, i) => s + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0)) / 2;
    const faceArea = area(face.projector);
    let best = -1, share = 0, bestIou = 0;
    quads.forEach((quad, k) => {
      const n = face.samples.filter(s => inside(quad, s.proj.x, s.proj.y)).length / face.samples.length;
      const iou = (n * faceArea) / (area(quad) + faceArea - n * faceArea);
      if (iou > bestIou) { bestIou = iou; share = n; best = k; }
    });
    let cornerPx = Infinity;
    if (best >= 0 && quads[best].length === 4) {
      const q = quads[best];
      for (const order of [[0, 1, 2, 3], [0, 3, 2, 1]]) for (let shift = 0; shift < 4; shift++) {
        let sum = 0;
        for (let i = 0; i < 4; i++) { const p = q[order[(i + shift) % 4]], t = face.projector[i]; sum += Math.hypot(p.x - t.x, p.y - t.y); }
        cornerPx = Math.min(cornerPx, sum / 4);
      }
    }
    return { id: face.id, surface: best, share, cornerPx, curved: best >= 0 && !!mapped[best].curved };
  });
}

export function runRoom(room: Room, options: { depth?: boolean; render?: RenderOptions; turn?: Turn } = {}) {
  const rendered = renderScan(room, options.render);
  const { plan } = rendered;
  // The phone turns every photo (and the depth with its lens) upright by gravity: a sideways phone's sensor
  // frames reach the solver turned, all by the same amount.
  const turn = options.turn ?? 0;
  const captures: Capture[] = rendered.captures.map(c => { const t = turnRaster(c.luma as Uint8Array, c.width, c.height, turn); return { width: t.width, height: t.height, luma: t.data }; });
  const decoded = decodeCaptures(plan, captures);
  const { width, height } = room.projector.lens;
  const flat = options.depth === false ? undefined : renderDepth(room);
  const depth = flat && (() => { const t = turnRaster(flat.meters, flat.width, flat.height, turn); return { ...flat, width: t.width, height: t.height, meters: t.data, intrinsics: turnIntrinsics(flat.intrinsics, turn), turn }; })();
  const mapped = autoMapSurfaces([{ id: 'p', width, height, plan, decoded, white: captures[0] }], depth);
  const truth = faceTruth(room).filter(f => !f.id.startsWith('c'));
  return { mapped, truth, faces: scoreFaces(room, mapped, truth), coverage: decoded.coverage };
}

