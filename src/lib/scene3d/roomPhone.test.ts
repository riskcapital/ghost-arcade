import { describe, expect, it } from 'vitest';
import { boxPyramid, dirInProjector, inProjector, pyramidCapture } from './roomFixtures';
import { dot, facePoint, faceNormal, length, normalize, sub } from './roomModel';
import { fitPlane, roomFromCapture, solveProjector, symmetricEigen, validateDepthCapture } from './roomPhone';
import { projectorBasis, projectPoint } from './projector';

const ASPECT = 16 / 9;
const deg = (a: number[], b: number[]) => (Math.acos(Math.max(-1, Math.min(1, dot(normalize(a as never), normalize(b as never))))) * 180) / Math.PI;

describe('the room from a phone scan', () => {
  it('finds eigenvectors and planes', () => {
    const { values, vectors } = symmetricEigen([[4, 1, 0], [1, 3, 0], [0, 0, 1]]);
    const i = values.indexOf(Math.min(...values));
    expect(values[i]).toBeCloseTo(1, 9);
    expect(Math.abs(vectors[2][i])).toBeCloseTo(1, 9);
    const plane = fitPlane([[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1], [0.5, 1, 0.3]]);
    expect(Math.abs(plane.n[1])).toBeCloseTo(1, 9);
    expect(plane.error).toBeCloseTo(0, 9);
  });

  it('places a projector with its lens shifted from points and the pixels they show at', () => {
    const truth = boxPyramid([0.9, 1.1, 4.8], [0.1, 1.4, 0], 26, ASPECT, 0, [0, 0.8]);
    const pairs = pyramidCapture(truth).surfaces.flatMap((s) => s.samples);
    const pr = solveProjector(pairs, ASPECT);
    expect(length(sub(pr.position, truth.pr.pos))).toBeLessThan(1e-6);
    expect(pr.fov).toBeCloseTo(26, 6);
    expect(pr.shift.x).toBeCloseTo(0, 6);
    expect(pr.shift.y).toBeCloseTo(0.8, 6);
    expect(deg(pr.fwd, truth.pr.fwd)).toBeLessThan(1e-4);
    expect(deg(pr.up, truth.pr.up)).toBeLessThan(1e-4);
  });

  for (const [label, noise, pixelNoise, tol] of [
    ['exactly', 0, 0, { mm: 0.1, deg: 0.01, fov: 0.001, px: 0.01 }],
    ['through depth and decoding noise', 0.004, 0.5 / 1920, { mm: 25, deg: 1.5, fov: 0.3, px: 1.5 }],
  ] as const) {
    it(`builds the box pyramid's room ${label}, metric and level`, () => {
      // A tilted room seen by a projector with its lens shifted up.
      const truth = boxPyramid([1.2, 1.0, 5], [0.1, 1.2, 0], 28, ASPECT, 7, [0, 0.6]);
      const capture = validateDepthCapture(JSON.parse(JSON.stringify(pyramidCapture(truth, noise, pixelNoise))));
      const { room, report } = roomFromCapture(capture, ASPECT, (id) => `scan:${id}`);
      expect(report.fov).toBeCloseTo(28, 0);
      expect(Math.abs(report.fov - 28)).toBeLessThan(tol.fov);
      expect(report.pixelError).toBeLessThan(tol.px);
      expect(room.source).toBe('phone');
      expect(deg(room.down, dirInProjector(truth.pr, truth.down))).toBeLessThan(tol.deg);
      const pr = projectorBasis(room.projector.position, room.projector.target, room.projector.fov, ASPECT, [room.projector.shift!.x, room.projector.shift!.y]);
      for (const f of truth.faces) {
        const s = room.faces.find((x) => x.surfaceId === `scan:${f.surfaceId}`)!;
        expect(s.role, f.surfaceId).toBe(f.role);
        expect(deg(faceNormal(s), dirInProjector(truth.pr, faceNormal(f))), f.surfaceId).toBeLessThan(tol.deg);
        const outline = capture.surfaces.find((x) => x.id === f.surfaceId)!.outline;
        // A face seen nearly edge-on (past 75°) takes almost no light, and its corners move a lot with a small tilt.
        const middle = inProjector(truth.pr, f.origin);
        const facing = Math.abs(dot(normalize(middle), dirInProjector(truth.pr, faceNormal(f))));
        s.points.forEach((p, i) => {
          // Exactly on its outline, seen from the projector.
          const q = projectPoint(pr, facePoint(s, p));
          expect(Math.hypot(q.x - outline[i].x, q.y - outline[i].y)).toBeLessThan(1e-6);
          // Where the real corner is, in meters (with noise, mostly from where the projector was placed).
          if (facing > 0.26) expect(length(sub(facePoint(s, p), inProjector(truth.pr, facePoint(f, f.points[i]))))).toBeLessThan(tol.mm / 1000);
        });
      }
    });
  }

  it('refuses a capture it cannot use', () => {
    expect(() => validateDepthCapture({ down: [0, 0, 0], surfaces: [] })).toThrow(/down/);
    expect(() => validateDepthCapture({ down: [0, -1, 0], surfaces: [] })).toThrow(/surfaces/);
    expect(() => validateDepthCapture({ down: [0, -1, 0], surfaces: [{ id: 'a', outline: [{ x: 0, y: 0 }], samples: [] }] })).toThrow(/fewer than three/);
    expect(() => solveProjector([], ASPECT)).toThrow(/six points/);
  });
});
