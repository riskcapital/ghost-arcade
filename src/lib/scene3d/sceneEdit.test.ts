import { describe, expect, it } from 'vitest';
import { defaultScene3D, validateScene3D, type Scene3D } from './sceneModel';
import { addNode, cameraOrbit, duplicateNode, NEW_NODE_LABELS, patchNode, removeNode, setCameraOrbit, setMaterial, setMaterialPreset, setTransform, type NewNodeKind } from './sceneEdit';
import { lightAndShadowWorld } from './worlds';

describe('world edits', () => {
  it('every new node is valid, named apart and selectable by its id', () => {
    let scene: Scene3D = defaultScene3D();
    for (const kind of Object.keys(NEW_NODE_LABELS) as NewNodeKind[]) {
      const added = addNode(scene, kind)!;
      expect(added.scene.nodes.at(-1)!.id).toBe(added.id);
      scene = added.scene;
    }
    const twice = addNode(scene, 'box')!;
    expect(new Set(twice.scene.nodes.map((n) => n.name)).size).toBe(twice.scene.nodes.length);
    expect(validateScene3D(twice.scene).nodes).toHaveLength(twice.scene.nodes.length);
  });

  it('leaves the original world untouched', () => {
    const before = lightAndShadowWorld([], 16 / 9);
    const copy = structuredClone(before);
    setTransform(before, 'shape-1', 'position', 0, 3);
    patchNode(before, 'key', { power: 9 });
    removeNode(before, 'floor');
    expect(before).toEqual(copy);
  });

  it('a preset sets the look; a hand-set value leaves the preset', () => {
    let scene = addNode(defaultScene3D(), 'sphere')!;
    let s = setMaterialPreset(scene.scene, scene.id, 'chrome');
    const node = () => s.nodes.find((n) => n.id === scene.id) as { material: { preset?: string; metal: number; rough: number } };
    expect(node().material).toMatchObject({ preset: 'chrome', metal: 1 });
    s = setMaterial(s, scene.id, { rough: 0.5 });
    expect(node().material.preset).toBeUndefined();
    expect(node().material.rough).toBe(0.5);
    scene = { scene: s, id: scene.id };
    expect(validateScene3D(scene.scene).nodes).toHaveLength(1);
  });

  it('duplicates next to the original, with a new id and name', () => {
    const scene = lightAndShadowWorld([], 1);
    const dup = duplicateNode(scene, 'shape-1')!;
    const a = scene.nodes.find((n) => n.id === 'shape-1')!, b = dup.scene.nodes.find((n) => n.id === dup.id)!;
    expect(b.name).not.toBe(a.name);
    expect(b.transform.position[0]).toBeCloseTo(a.transform.position[0] + 0.3);
    expect(dup.scene.nodes.indexOf(b)).toBe(dup.scene.nodes.indexOf(dup.scene.nodes.find((n) => n.id === 'shape-1')!) + 1);
  });

  it('orbits the camera round its target and reads the orbit back', () => {
    const scene = setCameraOrbit(defaultScene3D(), { around: 90, up: 30, distance: 5 });
    const o = cameraOrbit(scene.camera);
    expect(o.around).toBeCloseTo(90);
    expect(o.up).toBeCloseTo(30);
    expect(o.distance).toBeCloseTo(5);
    // Straight down is kept just short of vertical.
    expect(cameraOrbit(setCameraOrbit(scene, { around: 0, up: 90, distance: 5 }).camera).up).toBeLessThan(90);
    expect(validateScene3D(scene).camera).toEqual(scene.camera);
  });
});
