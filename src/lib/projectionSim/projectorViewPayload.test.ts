/** The native projector-view payload: geometry matches the preview's, the
 *  matrices match three.js, and each projector carries the right content. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FLOOR_MESH_KEY,
  buildProjectorViewScene,
  encodeProjectorViewMesh,
  floorMesh,
  primitiveMesh,
  primitiveMeshKey,
  projectionSimObjectMatrix,
  projectorContentCrop,
  projectorOutputBlend,
} from './projectorViewPayload';
import { createProjectionSimScene, makeProjectionSimPrimitive, makeProjectionSimProjector } from './types';
import { projectorProjectionMatrix, projectorViewMatrix } from './projectorLens';
import type { OutputSlice } from '../stores/settings';

function decode(b64: string, type: 'f32' | 'u32') {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return type === 'f32' ? new Float32Array(bytes.buffer) : new Uint32Array(bytes.buffer);
}

const slice = {
  id: 'screen-a',
  cropX: 0.5, cropY: 0.25, cropW: 0.5, cropH: 0.5,
  edgeBlendLeft: 0.1, edgeBlendRight: 0, edgeBlendTop: 0.05, edgeBlendBottom: 0,
} as unknown as OutputSlice;

describe('projector view meshes', () => {
  it('builds a closed unit box for box primitives and encodes it losslessly', () => {
    const box = primitiveMesh(makeProjectionSimPrimitive('box'));
    expect(box.key).toBe('primitive:box');
    expect(box.positions.length / 3).toBe(24);
    expect(box.indices.length).toBe(36);
    const extent = Math.max(...Array.from(box.positions).map(Math.abs));
    expect(extent).toBeCloseTo(0.5, 6);
    const encoded = encodeProjectorViewMesh(box);
    expect(Array.from(decode(encoded.positions_b64, 'f32'))).toEqual(Array.from(box.positions));
    expect(Array.from(decode(encoded.normals_b64, 'f32'))).toEqual(Array.from(box.normals));
    expect(Array.from(decode(encoded.indices_b64, 'u32'))).toEqual(Array.from(box.indices));
  });

  it('bakes the column caps at their offsets', () => {
    const column = primitiveMesh(makeProjectionSimPrimitive('column'));
    const ys = Array.from(column.positions).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(0.58 + 0.08, 5);
    expect(Math.min(...ys)).toBeCloseTo(-0.58 - 0.08, 5);
  });

  it('lays the floor flat, facing up', () => {
    const floor = floorMesh();
    expect(floor.key).toBe(FLOOR_MESH_KEY);
    for (let i = 1; i < floor.positions.length; i += 3) expect(floor.positions[i]).toBeCloseTo(0, 6);
    for (let i = 0; i < floor.normals.length; i += 3) expect(floor.normals[i + 1]).toBeCloseTo(1, 6);
  });
});

describe('projector view scene', () => {
  it('composes object matrices exactly like the preview Object3D', () => {
    const object = { ...makeProjectionSimPrimitive('box'), position: [1, 2, 3], rotation: [0.3, -0.7, 0.2], scale: [2, 1, 0.5] } as const;
    const reference = new THREE.Object3D();
    reference.position.set(1, 2, 3);
    reference.rotation.set(0.3, -0.7, 0.2);
    reference.scale.set(2, 1, 0.5);
    reference.updateMatrix();
    const matrix = projectionSimObjectMatrix({ position: [...object.position], rotation: [...object.rotation], scale: [...object.scale] });
    matrix.forEach((value, i) => expect(value).toBeCloseTo(reference.matrix.elements[i], 12));
  });

  it('describes objects, the floor and every lens, with content taken from the mapping source', () => {
    const scene = createProjectionSimScene('Test');
    const block = makeProjectionSimPrimitive('box');
    const hidden = { ...makeProjectionSimPrimitive('sphere'), visible: false };
    const wall = { ...makeProjectionSimPrimitive('plane'), receiveProjection: false };
    scene.objects = [block, hidden, wall];
    const designer = { ...makeProjectionSimProjector('Design'), enabled: false, source: 'slice' as const, sliceId: 'screen-a' };
    const real = { ...makeProjectionSimProjector('Real'), contentFrom: designer.id, edgeBlend: [0.2, 0, 0, 0] as [number, number, number, number] };
    const orphan = { ...makeProjectionSimProjector('Orphan'), contentFrom: 'gone' };
    scene.projectors = [designer, real, orphan];
    scene.environment.showFloorProjection = false;

    const view = buildProjectorViewScene(scene, [slice], primitiveMeshKey);
    expect(view.objects.map((o) => [o.mesh, o.receive])).toEqual([
      [FLOOR_MESH_KEY, false],
      ['primitive:box', true],
      ['primitive:plane', false],
    ]);
    expect(view.projectors.map((p) => p.id)).toEqual([designer.id, real.id, orphan.id]);
    const [design, realView, orphanView] = view.projectors;
    expect(design.crop).toEqual([0.5, 0.25, 0.5, 0.5]);
    expect(design.blend).toEqual([0.1, 0, 0.05, 0]);
    expect(realView.content_from).toBe(designer.id);
    expect(realView.blend).toEqual([0.2, 0, 0, 0]);
    expect(orphanView.content_from).toBeNull();
    expect(realView.view).toEqual(projectorViewMatrix(real));
    expect(realView.projection).toEqual(projectorProjectionMatrix(real));
  });

  it('falls back to the manual crop when the sampled Screen is gone', () => {
    const projector = { ...makeProjectionSimProjector('P'), source: 'slice' as const, sliceId: 'missing', crop: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number] };
    expect(projectorContentCrop(projector, [slice])).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(projectorOutputBlend(projector, [slice])).toEqual([0, 0, 0, 0]);
  });
});
