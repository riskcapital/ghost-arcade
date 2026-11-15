import { describe, expect, it } from 'vitest';
import { boxPyramid, dirInProjector, inProjector, pyramidCapture } from './roomFixtures';
import { dot, facePoint, faceNormal, length, normalize, sub } from './roomModel';
import { CAPTURE_LIMITS, fitCaptureToLimits, fitPlane, lensAspect, resampleEvenly, roomFromCapture, simplifyOutline, solveProjector, symmetricEigen, validateDepthCapture } from './roomPhone';
import { projectorBasis, projectPoint } from './projector';
import { worldGeometry } from './worldGeometry';
import { defaultReliefWorld } from './worldModel';
import { defaultInteractive } from '../mobile/studio/interactive';

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

describe('a phone scan larger than the limits', () => {
  /** Distance from p to the closed outline. */
  const offOutline = (p: { x: number; y: number }, outline: { x: number; y: number }[]) => {
    let best = Infinity;
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    });
    return best;
  };

  it('thins a list evenly, first and last kept, in order', () => {
    const list = Array.from({ length: 10 }, (_, i) => i);
    expect(resampleEvenly(list, 4)).toEqual([0, 3, 6, 9]);
    expect(resampleEvenly(list, 10)).toEqual(list);
    expect(resampleEvenly(list, 12)).not.toBe(list);
    expect(resampleEvenly(list, 1)).toEqual([0]);
    expect(resampleEvenly(list, 0)).toEqual([]);
  });

  it('keeps the corners of a densely traced square', () => {
    const corners = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.7 }, { x: 0.2, y: 0.7 }];
    const traced = corners.flatMap((a, i) => {
      const b = corners[(i + 1) % 4];
      return Array.from({ length: 100 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / 100, y: a.y + ((b.y - a.y) * k) / 100 }));
    });
    const out = simplifyOutline(traced);
    expect(out.length).toBeLessThanOrEqual(64);
    for (const c of corners) expect(out).toContainEqual(c);
    // Kept in the outline's own order, every corner one of the original ones.
    const at = out.map((p) => traced.indexOf(p));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('follows a round outline closely with 64 corners, where cutting the list off loses most of it', () => {
    const circle = Array.from({ length: 900 }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos((i / 900) * 2 * Math.PI), y: 0.5 + 0.3 * Math.sin((i / 900) * 2 * Math.PI) }));
    const out = simplifyOutline(circle, 64);
    expect(out).toHaveLength(64);
    expect(Math.max(...circle.map((p) => offOutline(p, out)))).toBeLessThan(0.002);
    // What the old .slice(0, 64) kept: a sliver of the circle.
    expect(Math.max(...circle.map((p) => offOutline(p, circle.slice(0, 64))))).toBeGreaterThan(0.2);
  });

  it('thins samples over the whole face and keeps the busiest surfaces, still solving', () => {
    const truth = boxPyramid([1.2, 1.0, 5], [0.1, 1.2, 0], 28, ASPECT, 7, [0, 0.6]);
    const base = pyramidCapture(truth);
    // Every face measured at 5000 points (36 repeated), plus 50 tiny extra surfaces of 3 points.
    const dense = {
      down: base.down,
      surfaces: [
        ...base.surfaces.map((s) => ({ ...s, samples: Array.from({ length: 5000 }, (_, i) => s.samples[Math.floor((i * s.samples.length) / 5000)]) })),
        ...Array.from({ length: 50 }, (_, i) => ({ id: `speck${i}`, name: 'speck', outline: base.surfaces[0].outline, samples: base.surfaces[0].samples.slice(0, 3) })),
      ],
    };
    const capture = validateDepthCapture(JSON.parse(JSON.stringify(dense)));
    expect(capture.surfaces).toHaveLength(CAPTURE_LIMITS.surfaces);
    // All the real faces stay; specks go first.
    for (const s of base.surfaces) expect(capture.surfaces.some((x) => x.id === s.id)).toBe(true);
    const total = capture.surfaces.reduce((a, s) => a + s.samples.length, 0);
    expect(total).toBeLessThanOrEqual(CAPTURE_LIMITS.samplesTotal);
    for (const s of capture.surfaces) expect(s.samples.length).toBeLessThanOrEqual(CAPTURE_LIMITS.samplesPerSurface);
    // Thinned, not cut off: the last grid point of each face is still there.
    for (const s of base.surfaces) expect(capture.surfaces.find((x) => x.id === s.id)!.samples.at(-1)).toEqual(s.samples.at(-1));
    const { report } = roomFromCapture(capture, ASPECT);
    expect(Math.abs(report.fov - 28)).toBeLessThan(0.001);
  });

  it('shares the total out evenly between surfaces', () => {
    const outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    const surfaces = Array.from({ length: 20 }, (_, k) => ({ id: `s${k}`, name: '', outline, samples: Array.from({ length: 4500 }, (_, i) => ({ p: [k, i, 1] as [number, number, number], uv: { x: 0, y: 0 } })) }));
    const fitted = fitCaptureToLimits({ down: [0, -1, 0], surfaces });
    const counts = fitted.surfaces.map((s) => s.samples.length);
    expect(counts.reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(CAPTURE_LIMITS.samplesTotal);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(3000);
    // Ends kept, the middle spread evenly.
    expect(fitted.surfaces[0].samples[0].p[1]).toBe(0);
    expect(fitted.surfaces[0].samples.at(-1)!.p[1]).toBe(4499);
  });

  it('refuses a capture far past anything a phone makes', () => {
    const big = { down: [0, -1, 0], surfaces: [{ id: 'a', outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], samples: new Array(1_000_001).fill({ p: [0, 0, 1], uv: { x: 0, y: 0 } }) }] };
    expect(() => validateDepthCapture(big)).toThrow(/million/);
  });
});

/**
 * A 16:9 projector (square pixels) on a Screen that shows the output, or a
 * part of it, stretched over its own pixels: the phone maps each stripe pixel
 * through the Screen's region into the OUTPUT (the contract's uv), and the
 * solve must take the lens's shape over the output from the Screen, not the
 * output's aspect.
 */
describe('a scan through a Screen of another shape than the output', () => {
  const SCREEN = { width: 1920, height: 1080 };
  function throughScreen(outputAspect: number, region = { x: 0, y: 0, width: 1, height: 1 }) {
    const truth = boxPyramid([1.2, 1.0, 5], [0.1, 1.2, 0], 28, SCREEN.width / SCREEN.height, 7, [0, 0.6]);
    const raw = pyramidCapture(truth);
    const out = (p: { x: number; y: number }) => ({ x: region.x + p.x * region.width, y: region.y + p.y * region.height });
    const capture = {
      ...raw,
      surfaces: raw.surfaces.map((s) => ({ ...s, outline: s.outline.map(out), samples: s.samples.map((q) => ({ p: q.p, uv: out(q.uv) })) })),
      source: { device: 'Test', screen: { id: 'screen-1', ...SCREEN, region }, capturedAt: '' },
    };
    return { truth, capture: validateDepthCapture(JSON.parse(JSON.stringify(capture))), out, outputAspect };
  }
  /** Output pixels at 1920 wide between where the room puts each measured point and where it was measured. */
  function worldMiss(t: ReturnType<typeof throughScreen>) {
    const { room } = roomFromCapture(t.capture, t.outputAspect, (id) => id);
    const scene = { ...defaultInteractive(), surfaces: t.capture.surfaces.map((s) => ({ id: s.id, name: s.name, behavior: 'solid' as const, points: s.outline })) };
    const geo = worldGeometry(scene as never, { ...defaultReliefWorld(), enabled: true, source: 'room', room }, t.outputAspect);
    let worst = 0;
    for (const f of t.truth.faces) {
      for (const p of f.points) {
        const at = inProjector(t.truth.pr, facePoint(f, p));
        const q = projectPoint(geo.projector, at);
        const want = t.out(projectPoint(t.truth.pr, facePoint(f, p)));
        worst = Math.max(worst, Math.hypot((q.x - want.x) * 1920, (q.y - want.y) * 1920 / t.outputAspect));
      }
    }
    return { room, worst };
  }

  for (const [label, outputAspect] of [['16:10', 16 / 10], ['4:3', 4 / 3], ['16:9', 16 / 9]] as const) {
    it(`solves a 16:9 Screen on a ${label} output within 1 px`, () => {
      const t = throughScreen(outputAspect);
      const { report } = roomFromCapture(t.capture, outputAspect);
      expect(report.pixelError).toBeLessThan(1);
      expect(Math.abs(report.fov - 28)).toBeLessThan(0.01);
      // The world built from it puts every corner back on its pixel.
      const { room, worst } = worldMiss(t);
      expect(worst).toBeLessThan(1);
      // The lens's shape is kept only when it is not the output's (old rooms are unchanged).
      if (label === '16:9') expect(room.projector.aspect).toBeUndefined();
      else expect(room.projector.aspect).toBeCloseTo(16 / 9, 6);
    });
  }

  it('maps through a Screen showing part of the output', () => {
    // The left half of a 32:10 output on a 16:9 projector.
    const t = throughScreen(32 / 10, { x: 0, y: 0, width: 0.5, height: 1 });
    expect(lensAspect(t.capture.screen, 32 / 10)).toBeCloseTo((16 / 9) * 2, 9);
    const { report } = roomFromCapture(t.capture, 32 / 10);
    expect(report.pixelError).toBeLessThan(1);
    expect(worldMiss(t).worst).toBeLessThan(1);
  });

  it('was off by about 21 px before, with the output taken as the lens shape', () => {
    const t = throughScreen(16 / 10);
    const { report } = roomFromCapture({ ...t.capture, screen: undefined }, 16 / 10);
    expect(report.pixelError).toBeGreaterThan(10);
  });

  it('keeps a capture without a Screen at the output shape, and reads a bad region as the whole output', () => {
    expect(lensAspect(undefined, 1.6)).toBe(1.6);
    const c = validateDepthCapture({ ...JSON.parse(JSON.stringify(pyramidCapture(boxPyramid([1.2, 1.0, 5], [0.1, 1.2, 0], 28, ASPECT)))), source: { screen: { width: 1280, height: 720, region: { x: 0, y: 0, width: 0, height: 1 } } } });
    expect(c.screen).toEqual({ width: 1280, height: 720 });
    expect(validateDepthCapture({ ...c, source: { screen: { width: 'wide' } } }).screen).toBeUndefined();
  });
});
