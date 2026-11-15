import { describe, expect, it } from 'vitest';
import { buildDepthCapture, desktopFit, gravityInScan, outputCoverage, resampleEvenly, turnVector } from './depthCapture';
import { fixtureDepthCapture } from './depthCaptureFixture';
import { arCamera, BOX, PROJECTOR, SCREEN, syntheticRoomScan as scan, toWorld } from './depthCaptureFixture';
import type { UV } from './structuredLight';
import { fitPlane, roomFromCapture, validateDepthCapture } from '../../scene3d/roomPhone';
import { projectPoint } from '../../scene3d/projector';

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('depth capture for Depth mode', () => {
  for (const roll of [0, 90, -90, 180]) {
    it(`puts points, gravity and output uv in one frame (phone rolled ${roll}°)`, () => {
      const s = scan(roll);
      expect(s.turn).toBe(roll === 0 ? 0 : roll === 90 ? 270 : roll === -90 ? 90 : 180);
      const down = gravityInScan(s.depth.pose!, s.turn);
      const { capture, report } = buildDepthCapture({
        grid: s.grid,
        screen: SCREEN,
        down,
        surfaces: [{ id: 'top', name: 'Box top', photo: s.top }, { id: 'wall', name: 'Wall', photo: s.wall }, { id: 'front', name: 'Box front', photo: s.front }],
      });
      expect(report.surfaces).toBe(3);
      // Every point is where the room has it, and its uv is where the projector shows it.
      for (const surface of capture.surfaces) for (const sample of surface.samples.slice(0, 200)) {
        const w = toWorld(sample.p, s.cam, s.turn);
        const truth = projectPoint(PROJECTOR, w);
        expect(Math.hypot(truth.x - sample.uv.x, truth.y - sample.uv.y)).toBeLessThan(0.012);
      }
      const top = capture.surfaces.find((x) => x.id === 'top')!, wall = capture.surfaces.find((x) => x.id === 'wall')!;
      for (const p of top.samples) expect(toWorld(p.p, s.cam, s.turn)[1]).toBeCloseTo(BOX.y1, 2);
      for (const p of wall.samples) expect(toWorld(p.p, s.cam, s.turn)[2]).toBeCloseTo(-3, 2);
      // Gravity in the capture's frame: across the top face, across the wall.
      expect(Math.abs(dot(fitPlane(top.samples.map((x) => x.p)).n, capture.down))).toBeGreaterThan(0.999);
      expect(Math.abs(dot(fitPlane(wall.samples.map((x) => x.p)).n, capture.down))).toBeLessThan(0.01);
      // The desktop's solve: the projector comes back, the top is a Top, the wall and front are Sides.
      const { room, report: solved } = roomFromCapture(validateDepthCapture(JSON.parse(JSON.stringify(capture))), 16 / 9);
      expect(solved.fov).toBeCloseTo(38, 0);
      expect(solved.pixelError).toBeLessThan(6);
      expect(Object.fromEntries(room.faces.map((f) => [f.surfaceId, f.role]))).toEqual({ top: 'top', wall: 'side', front: 'side' });
      // Outlines are on the output too.
      for (const corner of top.outline) expect(corner.x).toBeGreaterThan(0);
    });
  }

  it('turns gravity with the picture and flips ARKit’s y and z', () => {
    // Level phone in landscape looking at the horizon: down is +y (image down), no z.
    const level = arCamera([0, 1, 0], [0, 1, -1], 0);
    expect(gravityInScan(level.pose, 0).map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 1, 0]);
    // Looking straight down: gravity runs along the view, +z.
    const floor = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 1, 0, 1];
    expect(gravityInScan(floor, 0)[2]).toBeCloseTo(1, 6);
    expect(turnVector([0, 1, 0], 90).map((v) => v + 0)).toEqual([-1, 0, 0]);
    expect(turnVector([1, 0, 0], 90).map((v) => v + 0)).toEqual([0, 1, 0]);
  });

  it('maps through the Screen’s place in the output', () => {
    const s = scan(0);
    const region = { x: 0.5, y: 0, width: 0.5, height: 1 };
    const { capture } = buildDepthCapture({ grid: s.grid, screen: { ...SCREEN, region }, down: gravityInScan(s.depth.pose!, 0), surfaces: [{ id: 'wall', name: 'Wall', photo: s.wall }] });
    for (const p of capture.surfaces[0].samples) expect(p.uv.x).toBeGreaterThanOrEqual(0.5);
    for (const p of capture.surfaces[0].outline) expect(p.x).toBeGreaterThanOrEqual(0.5);
  });

  // The fixture's projector is 16:9 (square pixels) and shows the whole output; uv is on the OUTPUT.
  for (const [label, aspect] of [['16:9', 16 / 9], ['16:10', 16 / 10], ['4:3', 4 / 3]] as const) {
    it(`reads a Fit within 1 px for a 16:9 Screen on a ${label} output`, () => {
      const { capture } = fixtureDepthCapture();
      expect(capture.source.screen.region).toEqual({ x: 0, y: 0, width: 1, height: 1 });
      expect(desktopFit(capture, aspect)!).toBeLessThan(1);
      const { room } = roomFromCapture(validateDepthCapture(capture), aspect);
      if (label === '16:9') expect(room.projector.aspect).toBeUndefined();
      else expect(room.projector.aspect).toBeCloseTo(16 / 9, 6);
    });
  }

  it('was off by many pixels on a 16:10 output when the Screen was not known', () => {
    const { capture } = fixtureDepthCapture();
    const { source: _source, ...bare } = capture;
    expect(desktopFit(bare as typeof capture, 16 / 10)!).toBeGreaterThan(10);
  });

  it('keeps to the desktop’s limits by even resampling and simplifying, not truncating', () => {
    const s = scan(0);
    const ring = (c: UV[], n: number): UV[] => {
      const cx = c.reduce((a, p) => a + p.x, 0) / c.length, cy = c.reduce((a, p) => a + p.y, 0) / c.length;
      return Array.from({ length: n }, (_, k) => ({ x: cx + 0.12 * Math.cos((k / n) * 2 * Math.PI), y: cy + 0.08 * Math.sin((k / n) * 2 * Math.PI) }));
    };
    const limits = { version: 1 as const, maxSurfaces: 2, maxSamplesPerSurface: 60, maxSamplesTotal: 90, maxOutline: 12, maxBytes: 8_000_000 };
    const full = buildDepthCapture({ grid: s.grid, screen: SCREEN, down: [0, 1, 0], surfaces: [{ id: 'wall', name: 'Wall', photo: s.wall }] }).capture.surfaces[0];
    const { capture, report } = buildDepthCapture({
      grid: s.grid, screen: SCREEN, down: [0, 1, 0], limits,
      surfaces: [{ id: 'wall', name: 'Wall', photo: s.wall }, { id: 'round', name: 'Round', photo: ring(s.wall, 120) }, { id: 'top', name: 'Top', photo: s.top }],
    });
    expect(capture.surfaces.length).toBe(2);
    expect(report.dropped).toBe(1);
    expect(report.samples).toBeLessThanOrEqual(90);
    for (const surface of capture.surfaces) {
      expect(surface.samples.length).toBeLessThanOrEqual(60);
      expect(surface.outline.length).toBeLessThanOrEqual(12);
      expect(surface.outline.length).toBeGreaterThanOrEqual(3);
    }
    // Evenly: the kept wall samples still span the wall, not just its first rows.
    const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const kept = capture.surfaces.find((x) => x.id === 'wall')!.samples;
    expect(span(kept.map((p) => p.uv.y))).toBeGreaterThan(0.8 * span(full.samples.map((p) => p.uv.y)));
    expect(span(kept.map((p) => p.uv.x))).toBeGreaterThan(0.8 * span(full.samples.map((p) => p.uv.x)));
    // The byte limit shrinks the samples to fit.
    const small = buildDepthCapture({ grid: s.grid, screen: SCREEN, down: [0, 1, 0], limits: { ...limits, maxSamplesPerSurface: 4000, maxSamplesTotal: 60000, maxBytes: 20000 }, surfaces: [{ id: 'wall', name: 'Wall', photo: s.wall }] });
    expect(small.report.bytes).toBeLessThanOrEqual(20000);
  });

  it('resamples on a lattice and reports output coverage', () => {
    const cells = Array.from({ length: 100 * 100 }, (_, k) => ({ i: k % 100, j: Math.floor(k / 100) }));
    const kept = resampleEvenly(cells, 400);
    expect(kept.length).toBeLessThanOrEqual(400);
    expect(Math.max(...kept.map((c) => c.j))).toBeGreaterThan(90);
    expect(outputCoverage([[{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }]])).toBeCloseTo(0.5, 2);
  });

  it('says so when nothing was measured', () => {
    const s = scan(0);
    expect(() => buildDepthCapture({ grid: { ...s.grid, hasXyz: new Uint8Array(s.grid.hasXyz.length) }, screen: SCREEN, down: [0, 1, 0], surfaces: [{ id: 'w', name: 'W', photo: s.wall }] })).toThrow(/No surface/);
  });
});
