import { describe, expect, it } from 'vitest';
import { decodeCaptures } from './structuredLight';
import { autoMapSurfaces, type AutoMapped } from './autoMapSurfaces';
import { faceTruth, renderDepth, renderScan, twoBoxRoom, type FaceTruth, type RenderOptions, type Room } from './syntheticRoom';

/**
 * The owner's test, end to end with no phone: two boxes, a projector lighting
 * four faces, the phone's stripe photos and LiDAR rendered from known poses,
 * run through the same decode, detection and LiDAR steps the phone runs.
 * Each lit face must get its own surface, with corners within about 2 px of
 * where the face truly lands in the projector's 1080p picture.
 */

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

export function runRoom(room: Room, options: { depth?: boolean; render?: RenderOptions } = {}) {
  const { plan, captures } = renderScan(room, options.render);
  const decoded = decodeCaptures(plan, captures);
  const { width, height } = room.projector.lens;
  const depth = options.depth === false ? undefined : renderDepth(room);
  const mapped = autoMapSurfaces([{ id: 'p', width, height, plan, decoded, white: captures[0] }], depth);
  const truth = faceTruth(room);
  return { mapped, truth, faces: scoreFaces(room, mapped, truth), coverage: decoded.coverage };
}

const summary = (faces: FaceReport[]) => faces.map(f => `${f.id}: surface ${f.surface} share ${f.share.toFixed(2)} corners ${f.cornerPx.toFixed(1)} px${f.curved ? ' (curved)' : ''}`).join('\n');

function check(faces: FaceReport[]) {
  for (const f of faces) {
    expect(f.surface, f.id).toBeGreaterThanOrEqual(0);
    expect(f.share, f.id).toBeGreaterThan(0.9);
    expect(f.curved, f.id).toBe(false);
  }
  // One surface per face: no slice spans two faces.
  expect(new Set(faces.map(f => f.surface)).size).toBe(faces.length);
  const mean = faces.reduce((s, f) => s + f.cornerPx, 0) / faces.length;
  expect(mean).toBeLessThan(2);
  for (const f of faces) expect(f.cornerPx, f.id).toBeLessThan(4);
}

describe('two boxes, four lit faces, end to end', () => {
  for (const depth of [true, false]) {
    it(`gives every lit face its own surface within 2 px (${depth ? 'LiDAR' : 'stripes only'})`, () => {
      const { faces, mapped } = runRoom(twoBoxRoom(), { depth });
      console.log(`${depth ? 'LiDAR' : 'stripes'}: ${mapped.length} surfaces\n${summary(faces)}`);
      expect(faces.map(f => f.id).sort()).toEqual(['A-front', 'A-top', 'B-front', 'B-top']);
      check(faces);
    }, 120_000);
  }
  it('still does in a dim room with a noisy camera and patchy LiDAR', () => {
    const { faces } = runRoom(twoBoxRoom(), { render: { exposure: 170, noise: 3, ambient: 0.1, seed: 9 } });
    console.log(`dim:\n${summary(faces)}`);
    expect(faces.length).toBe(4);
    check(faces);
  }, 120_000);
  it('gives a third face its own surface when a box is turned to show its side', () => {
    const room = twoBoxRoom();
    room.boxes[1] = { ...room.boxes[1], yawDeg: -42 };
    const { faces } = runRoom(room);
    console.log(`turned:\n${summary(faces)}`);
    expect(faces.length).toBeGreaterThanOrEqual(5);
    check(faces);
  }, 120_000);
});
