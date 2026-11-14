import { describe, expect, it } from 'vitest';
import { defaultInteractive, type InteractiveScene } from '../mobile/studio/interactive';
import { project, reliefFrame, unproject } from './relief';
import { cross, dot, facePoint, length, normalize, sub, validateRoom, type Room, type RoomFace } from './roomModel';
import { modelMatrix } from './sceneMeshes';
import type { Vec3 } from './sceneModel';
import {
  basisEuler,
  faceSites,
  pickWorld,
  projectorBasis,
  projectPoint,
  rayDirection,
  rayThrough,
  spawnZ,
  unprojectAt,
  wallProjector,
  worldGeometry,
} from './worldGeometry';
import { worldScene } from './worldScene';
import { defaultReliefWorld, validateReliefWorld } from './worldModel';

const ASPECT = 16 / 9;
const near = (a: Vec3, b: Vec3, eps = 1e-6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], -Math.log10(eps)));

/** A box's top and front, seen by a projector up and in front of it, gravity down. */
function boxRoom(): { scene: InteractiveScene; room: Room } {
  const top: RoomFace = {
    surfaceId: 'top', role: 'top', origin: [0, 0.5, 0], u: [1, 0, 0], v: [0, 0, -1],
    points: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }], depth: 1,
  };
  const front: RoomFace = {
    surfaceId: 'front', role: 'side', origin: [0, 0, 0.5], u: [1, 0, 0], v: [0, 1, 0],
    points: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }], depth: 1,
  };
  const room: Room = { source: 'manual', projector: { position: [0, 2.5, 4], target: [0, 0, 0], fov: 35 }, down: [0, -1, 0], floor: true, faces: [top, front] };
  const geo = worldGeometry(defaultInteractive(), { ...defaultReliefWorld(), source: 'room', room }, ASPECT);
  // The surfaces are where the faces show from the projector.
  const outline = (f: RoomFace) => f.points.map((p) => projectPoint(geo.projector, facePoint(f, p)));
  const scene: InteractiveScene = {
    ...defaultInteractive(),
    surfaces: [
      { id: 'top', name: 'Top', behavior: 'solid', points: outline(top) },
      { id: 'front', name: 'Front', behavior: 'solid', points: outline(front) },
    ],
  };
  return { scene, room };
}

describe('the projector', () => {
  it('is the relief camera for the wall: same rays, same output points', () => {
    const frame = reliefFrame(ASPECT, 0.3);
    const pr = wallProjector(frame);
    for (const uv of [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }, { x: 0.5, y: 0.5 }]) {
      for (const d of [0, 0.4, 1.2]) {
        const w = unproject(frame, uv, d);
        const p = projectPoint(pr, [w.x, w.y, d]);
        expect(p.x).toBeCloseTo(uv.x, 9);
        expect(p.y).toBeCloseTo(uv.y, 9);
        const back = project(frame, [w.x, w.y, d]);
        expect(back.x).toBeCloseTo(p.x, 9);
      }
    }
  });

  it('looks where it is pointed, unrolled, with the output aspect', () => {
    const pr = projectorBasis([1, 2, 5], [1, 0, 0], 40, ASPECT);
    near(pr.fwd, normalize([0, -2, -5]));
    expect(pr.right[1]).toBeCloseTo(0, 9);
    expect(dot(pr.up, [0, 1, 0])).toBeGreaterThan(0);
    expect(length(pr.right) / length(pr.up)).toBeCloseTo(ASPECT, 9);
    const mid = projectPoint(pr, [1, 0, 0]);
    expect(mid.x).toBeCloseTo(0.5, 9);
    expect(mid.y).toBeCloseTo(0.5, 9);
    // The top edge of the view is fov / 2 above the axis.
    const edge = rayDirection(pr, { x: 0.5, y: 0 });
    expect((Math.acos(dot(normalize(edge), pr.fwd)) * 180) / Math.PI).toBeCloseTo(20, 6);
    // Straight down still works.
    const down = projectorBasis([0, 5, 0], [0, 0, 0], 40, 1);
    expect(length(cross(down.right, down.up))).toBeGreaterThan(0);
  });
});

describe('a room', () => {
  it('validates, keeping axes at right angles and units unit', () => {
    const r = validateRoom({ down: [0, -9.8, 0], faces: [{ surfaceId: 's', u: [2, 0, 0], v: [1, 1, 0], points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] });
    expect(r.down).toEqual([0, -1, 0]);
    near(r.faces[0].u, [1, 0, 0]);
    near(r.faces[0].v, [0, 1, 0]);
    expect(() => validateRoom({ faces: [{ surfaceId: 's', points: [] }] })).toThrow(/fewer than three/);
    expect(() => validateRoom({ faces: [{ points: [] }] })).toThrow(/no surface/);
    const w = validateReliefWorld({ source: 'room', look: 'effects', room: {} });
    expect(w.source).toBe('room');
    expect(w.room?.faces).toEqual([]);
    expect(() => validateReliefWorld({ look: 'chalk' })).toThrow(/unknown look/);
  });

  it('puts each face where its surface shows from the projector', () => {
    const { scene, room } = boxRoom();
    const geo = worldGeometry(scene, { ...defaultReliefWorld(), source: 'room', room }, ASPECT);
    expect(geo.mode).toBe('room');
    expect(geo.faces.map((f) => f.surfaceId)).toEqual(['top', 'front']);
    // Through the middle of the front's outline the ray meets the front.
    const s = scene.surfaces[1];
    const mid = { x: s.points.reduce((a, p) => a + p.x, 0) / 4, y: s.points.reduce((a, p) => a + p.y, 0) / 4 };
    const hit = pickWorld(geo, rayThrough(geo.projector, mid));
    expect(hit.surfaceId).toBe('front');
    near(hit.normal, [0, 0, 1]);
    // The top's middle: the top, facing up.
    const t = scene.surfaces[0];
    const topMid = { x: t.points.reduce((a, p) => a + p.x, 0) / 4, y: t.points.reduce((a, p) => a + p.y, 0) / 4 };
    const up = pickWorld(geo, rayThrough(geo.projector, topMid));
    expect(up.surfaceId).toBe('top');
    near(up.normal, [0, 1, 0]);
    // Beside the box: the ground, at the box's foot.
    const ground = pickWorld(geo, rayThrough(geo.projector, { x: 0.1, y: 0.9 }));
    expect(ground.surfaceId).toBeNull();
    expect(ground.point[1]).toBeCloseTo(-0.5, 6);
    // A spawn point is on the ray it was asked for.
    const p = unprojectAt(geo, { x: 0.3, y: 0.2 }, 0.7);
    const back = projectPoint(geo.projector, p);
    expect(back.x).toBeCloseTo(0.3, 9);
    expect(back.y).toBeCloseTo(0.2, 9);
    expect(spawnZ(geo, p)).toBeCloseTo(0.7, 9);
  });

  it('drips from the edges that face up: the front face from its top edge, the top from its back', () => {
    const { scene, room } = boxRoom();
    const geo = worldGeometry(scene, { ...defaultReliefWorld(), source: 'room', room }, ASPECT);
    const front = faceSites(geo, 'front');
    expect(front).toHaveLength(1);
    expect(front[0].a[1]).toBeCloseTo(0.5, 9);
    expect(front[0].b[1]).toBeCloseTo(0.5, 9);
    // A level top has no edge facing up.
    expect(faceSites(geo, 'top')).toHaveLength(0);
  });

  it('draws each face as a mesh lying on its plane', () => {
    const { scene, room } = boxRoom();
    const world = { ...defaultReliefWorld(), source: 'room' as const, room, look: 'effects' as const };
    const geo = worldGeometry(scene, world, ASPECT);
    const s3 = worldScene(scene, world, geo, ASPECT);
    expect(s3.camera.position).toEqual(geo.projector.pos);
    for (const f of room.faces) {
      const n = s3.nodes.find((x) => x.id === `block:${f.surfaceId}`) as unknown as { transform: Parameters<typeof modelMatrix>[0]; catcher: boolean };
      expect(n.catcher).toBe(true);
      const m = modelMatrix(n.transform);
      for (const p of f.points) {
        const w: Vec3 = [m[0] * p.x + m[4] * p.y + m[12], m[1] * p.x + m[5] * p.y + m[13], m[2] * p.x + m[6] * p.y + m[14]];
        near(w, facePoint(f, p));
      }
    }
    const ground = s3.nodes.find((x) => x.id === 'ground') as unknown as { transform: Parameters<typeof modelMatrix>[0] };
    const g = modelMatrix(ground.transform);
    near(normalize([g[4], g[5], g[6]]), [0, 1, 0]);
  });
});

describe('basisEuler', () => {
  it('turns a mesh onto any frame', () => {
    const frames: [Vec3, Vec3][] = [[[1, 0, 0], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]], [[1, 0, 0], [0, 0, -1]], [[0, 0, -1], [1, 0, 0]], [normalize([1, 1, 0]), normalize([-1, 1, 0.5])]];
    for (const [u0, v0] of frames) {
      const u = normalize(u0);
      const v = normalize(sub(v0, [u[0] * dot(v0, u), u[1] * dot(v0, u), u[2] * dot(v0, u)]));
      const n = cross(u, v);
      const m = modelMatrix({ position: [0, 0, 0], rotation: basisEuler(u, v, n), scale: [1, 1, 1] });
      near([m[0], m[1], m[2]], u);
      near([m[4], m[5], m[6]], v);
      near([m[8], m[9], m[10]], n);
    }
  });
});
