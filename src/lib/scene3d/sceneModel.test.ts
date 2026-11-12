import { describe, expect, it } from 'vitest';
import {
  checkScene3D,
  defaultScene3D,
  identityTransform,
  material,
  validateScene3D,
  type Scene3D,
  type SceneNode,
} from './sceneModel';

const box = (patch: Partial<SceneNode> = {}): SceneNode =>
  ({ id: 'box', name: 'Box', transform: identityTransform(), visible: true, kind: 'mesh', shape: 'box', material: material('matte'), collider: 'static', catcher: false, ...patch }) as SceneNode;

const scene = (nodes: unknown[] = [box()], patch: Record<string, unknown> = {}): Record<string, unknown> => ({ ...defaultScene3D(), nodes, ...patch });
const errorOf = (raw: unknown) => checkScene3D(raw).error;

describe('ghost-scene v1', () => {
  it('keeps a valid scene as it is, every node kind included', () => {
    const nodes: SceneNode[] = [
      box(),
      { id: 'wall', name: 'Wall', transform: identityTransform(), visible: true, kind: 'mesh', shape: 'outline', material: material('ink'), collider: 'static', catcher: true, outline: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], depth: 0.2 } },
      { id: 'spray', name: 'Spray', transform: identityTransform(), visible: true, kind: 'emitter', shape: 'point', rate: 2000, burst: 500, life: 3, speed: 2, spread: 25, size: 0.02, color: '#FF8800', glow: 2 },
      { id: 'wind', name: 'Wind', transform: identityTransform(), visible: true, kind: 'field', field: 'wind', strength: -2, radius: 0 },
      { id: 'key', name: 'Key', transform: identityTransform(), visible: true, kind: 'light', light: 'key', color: '#ffffff', power: 1.5, shadows: true, orbit: 12 },
      { id: 'pad', name: 'Pad', transform: identityTransform(), visible: true, kind: 'zone', shape: 'box', emits: 'pad-hit' },
    ];
    const out = validateScene3D(scene(nodes));
    expect(out.nodes).toHaveLength(6);
    expect((out.nodes[2] as { color: string }).color).toBe('#ff8800');
    expect(validateScene3D(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });

  it('says what is wrong and where, instead of dropping it', () => {
    expect(errorOf({ ...scene(), schema: 'ghost-interactive' })).toMatch(/not a ghost-scene scene/);
    expect(errorOf({ ...scene(), version: 2 })).toMatch(/version 2 is not supported/);
    expect(errorOf(scene([box({ shape: 'cone' } as never)]))).toBe('nodes[0] "Box".shape: unknown shape "cone" (one of box, sphere, plane, cylinder, outline)');
    expect(errorOf(scene([{ ...box(), colour: 'red' }]))).toBe('nodes[0] "Box": unknown field "colour"');
    expect(errorOf(scene([box({ material: { ...material('chrome'), metal: 3 } })]))).toBe('nodes[0] "Box".material.metal: must be between 0 and 1');
    expect(errorOf(scene([box(), box()]))).toMatch(/id "box" is used twice/);
    expect(errorOf(scene([box({ transform: { ...identityTransform(), scale: [1, 0, 1] } })]))).toMatch(/scale: cannot be zero/);
    expect(errorOf(scene([box({ shape: 'outline' })]))).toMatch(/an outline mesh needs its outline/);
    expect(errorOf(scene([box({ material: material('matte', { base: 'red' }) })]))).toMatch(/must be a color like #ff8800/);
    expect(errorOf(scene([], { camera: { mode: 'projector', fov: 40, position: [0, 1, 5], target: [0, 0, 0] } }))).toMatch(/unknown camera mode "projector"/);
    expect(errorOf(scene([], { camera: { mode: 'free', fov: 40, position: [1, 1, 1], target: [1, 1, 1] } }))).toMatch(/cannot be the same point/);
    expect(errorOf({ ...scene(), extra: 1 })).toBe('scene: unknown field "extra"');
  });

  it('caps the node count', () => {
    const many = Array.from({ length: 257 }, (_, i) => box({ id: `b${i}` }));
    expect(errorOf(scene(many))).toMatch(/at most 256 nodes/);
  });

  it('starts transparent, finished and following the music', () => {
    const d: Scene3D = defaultScene3D();
    expect(d.environment.sky).toBe('void');
    expect(d.post.bloom).toBeGreaterThan(0);
    for (const v of Object.values(d.react)) expect(v).toBeGreaterThan(0);
    expect(validateScene3D(d)).toEqual(d);
  });
});
