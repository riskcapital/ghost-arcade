import { describe, expect, it } from 'vitest';
import { defaultScene3D, identityTransform, material, type Scene3D, type SceneNode } from '../scene3d/sceneModel';
import { buildScene3DGraph, scene3dData, SCENE3D_TIERS } from './scene3dNative';
import { EMITTER_FLOATS, SCENE_UNIFORM_FLOATS } from './scene3dShaders';

const node = (patch: Record<string, unknown>): SceneNode =>
  ({ id: String(patch.id), name: String(patch.id), transform: identityTransform(), visible: true, ...patch }) as SceneNode;
const world = (): Scene3D => ({
  ...defaultScene3D(),
  nodes: [
    node({ id: 'floor', kind: 'mesh', shape: 'plane', material: material('matte'), collider: 'static', catcher: false, transform: { ...identityTransform(), scale: [10, 1, 10] } }),
    node({ id: 'block', kind: 'mesh', shape: 'box', material: material('chrome'), collider: 'static', catcher: false, transform: { ...identityTransform(), position: [0, 0.5, 0] } }),
    node({ id: 'key', kind: 'light', light: 'key', color: '#ffffff', power: 2, shadows: true, orbit: 10, transform: { ...identityTransform(), position: [-1, 2, 1] } }),
    node({ id: 'rain', kind: 'emitter', shape: 'box', rate: 1000, burst: 200, life: 2, speed: 1, spread: 10, size: 0.02, color: '#88aaff', glow: 1 }),
    node({ id: 'down', kind: 'field', field: 'gravity', strength: 9.8, radius: 0 }),
  ],
});

describe('Interactive 3D graph data', () => {
  it('lays out every array the shaders read', () => {
    const d = scene3dData(world(), 1920, 1080, SCENE3D_TIERS.default);
    expect(d.settings).toHaveLength(SCENE_UNIFORM_FLOATS);
    expect(d.vertexCount).toBe(6 + 36);
    // Settings: counts (vertices, particles, emitters, fields) and the aspect.
    expect([...d.settings.slice(36, 40)]).toEqual([42, 2200, 1, 1]);
    expect(d.settings[23]).toBeCloseTo(1920 / 1080);
    // Two colliders, both static.
    expect(d.settings[41]).toBe(2);
    // The emitter's slots: 2000 steady, then 200 for bursts.
    expect([...d.emitters.slice(20, 24)]).toEqual([0, 2000, 2000, 200]);
    expect(d.hasShadows).toBe(true);
  });

  it('shares a small tier fairly between emitters', () => {
    const scene = world();
    scene.nodes.push(node({ id: 'rain2', kind: 'emitter', shape: 'point', rate: 100000, burst: 0, life: 4, speed: 1, spread: 10, size: 0.02, color: '#ffffff', glow: 0 }));
    const d = scene3dData(scene, 1920, 1080, { particles: 10000, shadow: 1024, scene: 1024 });
    expect(d.particleCount).toBeLessThanOrEqual(10000);
    expect(d.emitters[EMITTER_FLOATS + 20]).toBe(d.emitters[21] + d.emitters[23]);
  });

  it('a burst raises the generation the burst slots restart on', () => {
    expect(scene3dData(world(), 100, 100, SCENE3D_TIERS.performance, { rain: 3 }).emitters[15]).toBe(3);
  });

  it('keeps the structure when only a value changes', () => {
    const a = buildScene3DGraph({ scene: world(), sourceId: 'layer', width: 1920, height: 1080 });
    const moved = world();
    (moved.nodes[1].transform.position as number[])[0] = 1;
    moved.post.bloom = 1.4;
    const b = buildScene3DGraph({ scene: moved, sourceId: 'layer', width: 1920, height: 1080 });
    expect(b.topology).toBe(a.topology);
    const before = new Map(a.values.map((v) => [v.id, v.initial_b64]));
    expect(b.values.filter((v) => before.get(v.id) !== v.initial_b64).map((v) => v.id.split(':').pop()).sort()).toEqual(['colliders', 'settings', 'vertices']);
    const bigger = world();
    bigger.nodes.push(node({ id: 'ball', kind: 'mesh', shape: 'sphere', material: material('glass'), collider: 'none', catcher: false }));
    expect(buildScene3DGraph({ scene: bigger, sourceId: 'layer', width: 1920, height: 1080 }).topology).not.toBe(a.topology);
  });

  it('keeps the output shape at the tier size', () => {
    const g = buildScene3DGraph({ scene: world(), sourceId: 'layer', width: 1080, height: 1920, quality: SCENE3D_TIERS.balanced });
    const hdr = (g.config.textures as { id: string; width?: number; height?: number }[]).find((t) => t.id.endsWith(':hdr'))!;
    expect([hdr.width, hdr.height]).toEqual([864, 1536]);
  });
});
