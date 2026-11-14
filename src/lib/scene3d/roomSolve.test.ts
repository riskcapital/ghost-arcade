import { describe, expect, it } from 'vitest';
import { boxPyramid, dirInProjector, inProjector } from './roomFixtures';
import { cross, dot, facePoint, faceNormal, length, normalize, sub } from './roomModel';
import { downFromArrow, solveRoom } from './roomSolve';
import type { Vec3 } from './sceneModel';
import { projectorBasis, projectPoint } from './worldGeometry';

const ASPECT = 16 / 9;
const deg = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))))) * 180) / Math.PI;

describe('solving a room by hand', () => {
  it('turns the arrow and the angle into down', () => {
    const d = downFromArrow({ x: 0, y: 1 }, 30);
    expect(d[0]).toBeCloseTo(0, 9);
    expect(d[1]).toBeCloseTo(-Math.cos(Math.PI / 6), 9);
    expect(d[2]).toBeCloseTo(-0.5, 9);
    expect(length(downFromArrow({ x: 0.3, y: 0.4 }, -10))).toBeCloseTo(1, 9);
  });

  for (const [label, position, target, fov, roll] of [
    ['from above and to the right', [1.4, 2.6, 5.2], [0, 0.9, 0], 34, 0],
    ['from low on the left, with a wide lens', [-2.5, 1.2, 3.6], [0, 1, 0], 50, 0],
    ['with the projector turned on its side a little', [0.8, 3, 4.5], [0, 0.8, 0], 30, 8],
  ] as [string, Vec3, Vec3, number, number][]) {
    it(`finds the box pyramid ${label}`, () => {
      const truth = boxPyramid(position, target, fov, ASPECT, roll);
      const result = solveRoom({ surfaces: truth.surfaces, aspect: ASPECT, arrow: truth.arrow, elevation: truth.elevation, fov, distance: 5 });
      // Every face found, in the role it has.
      expect(result.room.faces).toHaveLength(truth.faces.length);
      for (const f of truth.faces) expect(result.roles[f.surfaceId], f.surfaceId).toBe(f.role);
      expect(result.contacts).toBeGreaterThan(10);
      const solvedPr = projectorBasis(result.room.projector.position, result.room.projector.target, fov, ASPECT);
      // Down as it really is.
      expect(deg(result.room.down, dirInProjector(truth.pr, truth.down))).toBeLessThan(0.01);
      // Scale is unknown by hand: compare shapes once sized alike.
      const solvedPts: Vec3[] = [], truePts: Vec3[] = [];
      for (const f of truth.faces) {
        const s = result.room.faces.find((x) => x.surfaceId === f.surfaceId)!;
        // Seen from the projector, each corner is where it was mapped (< 1 px at 1920).
        const outline = truth.surfaces.find((x) => x.id === f.surfaceId)!.points;
        s.points.forEach((p, i) => {
          const q = projectPoint(solvedPr, facePoint(s, p));
          expect(Math.hypot(q.x - outline[i].x, q.y - outline[i].y)).toBeLessThan(1 / 1920);
        });
        // Its plane turned the right way, within 2 degrees.
        expect(deg(faceNormal(s), dirInProjector(truth.pr, faceNormal(f))), f.surfaceId).toBeLessThan(2);
        // Tops level.
        if (f.role === 'top') expect(deg(faceNormal(s), result.room.down)).toBeCloseTo(180, 1);
        s.points.forEach((p) => solvedPts.push(facePoint(s, p)));
        f.points.forEach((p) => truePts.push(inProjector(truth.pr, facePoint(f, p))));
      }
      const k = solvedPts.reduce((a, p, i) => a + length(p) / length(truePts[i]), 0) / solvedPts.length;
      for (let i = 0; i < solvedPts.length; i++) {
        expect(length(sub(solvedPts[i], [truePts[i][0] * k, truePts[i][1] * k, truePts[i][2] * k]))).toBeLessThan(0.01 * k);
      }
      expect(result.mismatch).toBeLessThan(1e-3);
    });
  }

  it('takes the roles it is given, and calls a face that fills the output the backdrop', () => {
    const truth = boxPyramid([1.4, 2.6, 5.2], [0, 0.9, 0], 34, ASPECT);
    const surfaces = truth.surfaces.map((s) => (s.id === 'b2-top' ? { ...s, role: 'side' as const } : s));
    const wall = { id: 'wall', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.7 }, { x: 0, y: 0.7 }] };
    const result = solveRoom({ surfaces: [...surfaces, wall], aspect: ASPECT, arrow: truth.arrow, elevation: truth.elevation, fov: 34 });
    expect(result.roles['b2-top']).toBe('side');
    expect(result.roles.wall).toBe('backdrop');
    const back = result.room.faces.find((f) => f.surfaceId === 'wall')!;
    // Upright, facing the projector.
    expect(Math.abs(dot(faceNormal(back), result.room.down))).toBeLessThan(1e-9);
    expect(dot(faceNormal(back), back.origin)).toBeLessThan(0);
    expect(length(cross(faceNormal(back), [1, 0, 0]))).toBeGreaterThan(0.9);
  });
});
