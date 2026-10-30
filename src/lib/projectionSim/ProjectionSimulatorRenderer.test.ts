import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectionSimulatorRenderer,
  objectAppearanceHash,
  objectStructureHash,
  trimAssetCache,
} from './ProjectionSimulatorRenderer';
import { loadProjectionSimPly } from './geometry';
import { createProjectionSimScene, makeProjectionSimPrimitive, type ProjectionSimObject, type ProjectionSimScene } from './types';

vi.mock('./geometry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./geometry')>();
  return {
    ...actual,
    loadProjectionSimPly: vi.fn(async () => ({
      geometry: new THREE.BufferGeometry(),
      hasFaces: false,
      dataType: 'pointcloud',
    })),
  };
});

/** The renderer's scene-building half, without a WebGL context. */
function bareRenderer(scene: ProjectionSimScene): any {
  const r: any = Object.create(ProjectionSimulatorRenderer.prototype);
  Object.assign(r, {
    currentScene: scene,
    selectable: new Map(),
    projectorParts: new Map(),
    projectionMaterials: [],
    modelCache: new Map(),
    plyCache: new Map(),
    disposed: false,
    sceneVersion: 0,
    renderRequested: false,
    lastDepthHash: '',
    lastShadowHash: '',
    ambientLight: null,
    floorMaterial: null,
  });
  return r;
}

function sceneWithBox(): ProjectionSimScene {
  const scene = createProjectionSimScene('Test');
  scene.environment.surfaceStyle = 'original';
  scene.objects = [makeProjectionSimPrimitive('box', 'Box', [0, 1, 0], [2, 2, 2], '#336699')];
  return scene;
}

afterEach(() => {
  vi.mocked(loadProjectionSimPly).mockClear();
});

describe('Map Sim slider edits', () => {
  it('leave the structure hash alone, so they do not rebuild or reload imports', () => {
    const scene = sceneWithBox();
    const next: ProjectionSimScene = {
      ...scene,
      environment: { ...scene.environment, ambient: 0.6, floorColor: '#222222' },
      objects: scene.objects.map((o) => ({ ...o, color: '#ff0000', roughness: 0.2, pointSize: 0.05 })),
      projectors: scene.projectors.map((p) => ({ ...p, fov: 50, aspect: 4 / 3, lensShift: [0.1, 0] as [number, number], color: '#00ff00' })),
    };
    expect(objectStructureHash(next)).toBe(objectStructureHash(scene));
    expect(objectAppearanceHash(next)).not.toBe(objectAppearanceHash(scene));

    const moved = { ...scene, objects: scene.objects.map((o) => ({ ...o, assetUrl: 'blob:other' })) };
    expect(objectStructureHash(moved)).not.toBe(objectStructureHash(scene));
  });

  it('patch colours, roughness and beams on the built meshes in place', () => {
    const scene = sceneWithBox();
    const r = bareRenderer(scene);
    const object = scene.objects[0];
    const projector = scene.projectors[0];
    const group = r.buildObject(object);
    r.selectable.set(`object:${object.id}`, group);
    const projectorGroup = r.buildProjector(projector);
    r.selectable.set(`projector:${projector.id}`, projectorGroup);
    const mesh = group.children[0] as THREE.Mesh;
    const beam = r.projectorParts.get(projector.id).beam;

    const recoloured: ProjectionSimScene = {
      ...scene,
      objects: [{ ...object, color: '#ff0000', roughness: 0.3 }],
    };
    r.applyAppearance(recoloured);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(group.children[0]).toBe(mesh);
    expect(`#${material.color.getHexString()}`).toBe('#ff0000');
    expect(material.roughness).toBeCloseTo(0.3);
    // Lens unchanged: the beam is kept.
    expect(r.projectorParts.get(projector.id).beam).toBe(beam);

    r.applyAppearance({ ...recoloured, projectors: [{ ...projector, fov: 60 }] });
    const newBeam = r.projectorParts.get(projector.id).beam;
    expect(newBeam).not.toBe(beam);
    expect(beam.parent).toBeNull();
    expect(newBeam.parent).toBe(projectorGroup);
  });
});

describe('Map Sim point clouds', () => {
  const cloud = (): ProjectionSimObject => ({
    ...makeProjectionSimPrimitive('box'),
    type: 'pointcloud',
    primitive: undefined,
    assetUrl: 'blob:cloud',
  });

  it('parse a file once and skip holders a rebuild already dropped', async () => {
    const object = cloud();
    const r = bareRenderer({ ...createProjectionSimScene(), objects: [object] });

    const detached = new THREE.Group();
    await r.loadPointCloud(object, detached);
    expect(detached.children).toHaveLength(0);

    const attached = new THREE.Group();
    new THREE.Group().add(attached);
    await r.loadPointCloud(object, attached);
    expect(attached.children).toHaveLength(1);
    expect(attached.children[0].userData.projectionSimSharedGeometry).toBe(true);
    expect(loadProjectionSimPly).toHaveBeenCalledTimes(1);
  });
});

describe('Map Sim import cache', () => {
  it('drops the least recently used entries past the limit, keeping ones in use', async () => {
    const freed: string[] = [];
    const cache = new Map<string, Promise<string>>();
    for (const key of ['a', 'b', 'c', 'd']) cache.set(key, Promise.resolve(key));
    trimAssetCache(cache, new Set(['a']), 2, (value) => freed.push(value));
    expect([...cache.keys()]).toEqual(['a', 'd']);
    await Promise.resolve();
    await Promise.resolve();
    expect(freed.sort()).toEqual(['b', 'c']);
  });
});

describe('Map Sim calibration labels', () => {
  it('free their canvas texture when the markers are cleared', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    try {
      const r = bareRenderer(createProjectionSimScene());
      const sprite = r.makeLabelSprite('1', '#ffffff') as THREE.Sprite;
      const texture = sprite.material.map!;
      const onDispose = vi.fn();
      texture.addEventListener('dispose', onDispose);
      const group = new THREE.Group();
      group.add(sprite);
      r.clearGroup(group);
      expect(onDispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
