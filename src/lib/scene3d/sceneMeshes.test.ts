import { describe, expect, it } from 'vitest';
import { identityTransform, material, type SceneNode, type Transform, type Vec3 } from './sceneModel';
import { buildSceneMeshes, MAX_SCENE_VERTICES, modelMatrix, triangulate, VERTEX_FLOATS } from './sceneMeshes';

const mesh = (shape: string, transform: Partial<Transform> = {}, extra: Record<string, unknown> = {}): SceneNode =>
  ({ id: `${shape}-${Math.random()}`, name: shape, transform: { ...identityTransform(), ...transform }, visible: true, kind: 'mesh', shape, material: material(), collider: 'static', catcher: false, ...extra }) as SceneNode;

/** Triangles as [a, b, c, stored normal of a]. */
function tris(v: Float32Array, count: number) {
  const out: { p: Vec3[]; n: Vec3 }[] = [];
  for (let i = 0; i < count; i += 3) {
    const at = (k: number): Vec3 => [v[(i + k) * VERTEX_FLOATS], v[(i + k) * VERTEX_FLOATS + 1], v[(i + k) * VERTEX_FLOATS + 2]];
    out.push({ p: [at(0), at(1), at(2)], n: [v[i * VERTEX_FLOATS + 3], v[i * VERTEX_FLOATS + 4], v[i * VERTEX_FLOATS + 5]] });
  }
  return out;
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Every triangle of a closed shape centred on `centre` faces away from it,
 *  by its winding (what the GPU culls by) and by its stored normal. */
function expectOutward(nodes: SceneNode[], centre: Vec3) {
  const m = buildSceneMeshes(nodes, () => 0);
  for (const t of tris(m.vertices, m.count)) {
    const mid: Vec3 = [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3, (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3];
    const out = sub(mid, centre);
    const face = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
    if (Math.hypot(...face) < 1e-9) continue;
    expect(dot(face, out)).toBeGreaterThan(0);
    expect(dot(t.n, out)).toBeGreaterThan(-1e-6);
  }
  return m;
}

describe('scene meshes', () => {
  it('box, sphere and cylinder face outward, and keep doing so when moved, turned, stretched or mirrored', () => {
    for (const shape of ['box', 'sphere', 'cylinder']) {
      expectOutward([mesh(shape)], [0, 0, 0]);
      expectOutward([mesh(shape, { position: [2, 1, -3], rotation: [30, 45, 10], scale: [2, 0.5, 1] })], [2, 1, -3]);
      expectOutward([mesh(shape, { position: [0, 1, 0], scale: [-1, 1, 1] })], [0, 1, 0]);
    }
  });

  it('places a unit box by its transform', () => {
    const m = buildSceneMeshes([mesh('box', { position: [1, 2, 3], scale: [2, 4, 6] })], () => 5);
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < m.count; i++) {
      xs.push(m.vertices[i * VERTEX_FLOATS]); ys.push(m.vertices[i * VERTEX_FLOATS + 1]); zs.push(m.vertices[i * VERTEX_FLOATS + 2]);
      expect(m.vertices[i * VERTEX_FLOATS + 6]).toBe(5);
    }
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 2]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 4]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([0, 6]);
    expect(m.count).toBe(36);
  });

  it('a plane is one quad facing up', () => {
    const m = buildSceneMeshes([mesh('plane', { scale: [10, 1, 10] })], () => 0);
    expect(m.count).toBe(6);
    for (const t of tris(m.vertices, m.count)) {
      expect(cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]))[1]).toBeGreaterThan(0);
      expect(t.n).toEqual([0, 1, 0]);
    }
  });

  it('extrudes a concave outline into a closed solid whichever way it was drawn', () => {
    // An L shape, drawn clockwise and anticlockwise.
    const l = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    for (const points of [l, [...l].reverse()]) {
      const node = mesh('outline', {}, { outline: { points, depth: 0.5 } });
      const m = buildSceneMeshes([node], () => 0);
      // 4 cap triangles a side, 6 walls of 2.
      expect(m.count / 3).toBe(4 * 2 + 6 * 2);
      // Caps face front and back; walls face out of the L.
      for (const t of tris(m.vertices, m.count)) {
        const face = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
        const zs = t.p.map((p) => p[2]);
        if (zs.every((z) => z === 0)) expect(face[2]).toBeGreaterThan(0);
        else if (zs.every((z) => z === -0.5)) expect(face[2]).toBeLessThan(0);
        else {
          const mid = [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3];
          const probe = { x: mid[0] + face[0] * 0.01 / Math.hypot(face[0], face[1]), y: mid[1] + face[1] * 0.01 / Math.hypot(face[0], face[1]) };
          const inL = (p: { x: number; y: number }) => p.x > 0 && p.y > 0 && p.x < 2 && p.y < 2 && !(p.x > 1 && p.y > 1);
          expect(inL(probe)).toBe(false);
        }
      }
    }
  });

  it('triangulates a concave polygon without overlap', () => {
    const l = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    const t = triangulate(l);
    expect(t).toHaveLength(4);
    const area = t.reduce((s, [a, b, c]) => s + Math.abs((l[b].x - l[a].x) * (l[c].y - l[a].y) - (l[b].y - l[a].y) * (l[c].x - l[a].x)) / 2, 0);
    expect(area).toBeCloseTo(3);
  });

  it('leaves out hidden meshes and what does not fit the budget', () => {
    const hidden = { ...mesh('box'), visible: false } as SceneNode;
    expect(buildSceneMeshes([hidden], () => 0).count).toBe(0);
    const spheres = Array.from({ length: Math.ceil(MAX_SCENE_VERTICES / 6600) + 2 }, () => mesh('sphere'));
    const m = buildSceneMeshes(spheres, () => 0);
    expect(m.count).toBeLessThanOrEqual(MAX_SCENE_VERTICES);
    expect(m.dropped.length).toBeGreaterThan(0);
  });

  it('builds a column-major model matrix: rotate 90 degrees about Y takes +X to -Z', () => {
    const m = modelMatrix({ position: [0, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] });
    expect(m[0]).toBeCloseTo(0);
    expect(m[2]).toBeCloseTo(-1);
  });
});
