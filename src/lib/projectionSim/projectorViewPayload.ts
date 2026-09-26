/**
 * What the native core needs to render Map Sim projector views: the scene
 * geometry as object-local triangles (sent once per mesh), and a small
 * per-change description of object matrices and projector lenses.
 */
import * as THREE from 'three';
import type { OutputSlice } from '../stores/settings';
import type { NativeProjectorViewScene } from '../api/native-renderer';
import type { ProjectionSimObject, ProjectionSimProjector, ProjectionSimScene } from './types';
import { primitiveParts } from './geometry';
import {
  projectorFar,
  projectorNear,
  projectorProjectionMatrix,
  projectorViewMatrix,
} from './projectorLens';

export const FLOOR_MESH_KEY = 'floor';
const FLOOR_SIZE = 80;

export interface ProjectorViewMesh {
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** The content a projector's lens lays down: the slice crop when it
 *  samples a Screen, else its manual crop. (x, y, w, h), y down. */
export function projectorContentCrop(
  projector: ProjectionSimProjector,
  slices: readonly OutputSlice[],
): [number, number, number, number] {
  if (projector.source === 'slice' && projector.sliceId) {
    const slice = slices.find((s) => s.id === projector.sliceId);
    if (slice) return [slice.cropX, slice.cropY, slice.cropW, slice.cropH];
  }
  const crop = projector.crop ?? [0, 0, 1, 1];
  return [crop[0], crop[1], crop[2], crop[3]];
}

/** Soft-edge blend of a projector's own image, (left, right, top, bottom).
 *  A projector that samples a Screen takes that Screen's blend, which is
 *  what the Map Sim preview shows. */
export function projectorOutputBlend(
  projector: ProjectionSimProjector,
  slices: readonly OutputSlice[],
): [number, number, number, number] {
  if (projector.source === 'slice' && projector.sliceId) {
    const slice = slices.find((s) => s.id === projector.sliceId);
    if (slice) {
      return [slice.edgeBlendLeft ?? 0, slice.edgeBlendRight ?? 0, slice.edgeBlendTop ?? 0, slice.edgeBlendBottom ?? 0];
    }
  }
  const blend = projector.edgeBlend ?? [0, 0, 0, 0];
  return [blend[0], blend[1], blend[2], blend[3]];
}

/** Column-major object matrix, composed exactly as the preview's Object3D
 *  (position, XYZ Euler rotation, scale). */
export function projectionSimObjectMatrix(object: Pick<ProjectionSimObject, 'position' | 'rotation' | 'scale'>): number[] {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation[0], object.rotation[1], object.rotation[2], 'XYZ')),
    new THREE.Vector3(...object.scale),
  );
  return matrix.toArray();
}

export function primitiveMeshKey(object: ProjectionSimObject): string {
  return `primitive:${object.primitive ?? 'box'}`;
}

export function modelMeshKey(object: ProjectionSimObject): string | null {
  if (!object.assetUrl) return null;
  return `${object.type}:${object.assetFormat ?? 'gltf'}:${object.assetUrl}`;
}

/** Merge every mesh under `root` into one triangle list in root space. */
export function meshFromObject3D(key: string, root: THREE.Object3D): ProjectorViewMesh {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    let geometry = mesh.geometry.clone();
    geometry.applyMatrix4(toRoot.clone().multiply(mesh.matrixWorld));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    if (!position || !normal) {
      geometry.dispose();
      return;
    }
    const base = positions.length / 3;
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i + 2 < index.count; i += 3) indices.push(base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2));
    } else {
      for (let i = 0; i + 2 < position.count; i += 3) indices.push(base + i, base + i + 1, base + i + 2);
    }
    geometry.dispose();
  });
  return {
    key,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

export function primitiveMesh(object: ProjectionSimObject): ProjectorViewMesh {
  const root = new THREE.Group();
  for (const part of primitiveParts(object.primitive)) {
    const mesh = new THREE.Mesh(part.geometry);
    mesh.position.y = part.offsetY;
    root.add(mesh);
  }
  const mesh = meshFromObject3D(primitiveMeshKey(object), root);
  root.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
  return mesh;
}

export function floorMesh(): ProjectorViewMesh {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE));
  plane.rotation.x = -Math.PI / 2;
  const root = new THREE.Group().add(plane);
  const mesh = meshFromObject3D(FLOOR_MESH_KEY, root);
  plane.geometry.dispose();
  return mesh;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Little-endian base64 payload for `set_projection_sim_meshes`. */
export function encodeProjectorViewMesh(mesh: ProjectorViewMesh) {
  const bytes = (array: Float32Array | Uint32Array) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  return {
    key: mesh.key,
    positions_b64: base64(bytes(mesh.positions)),
    normals_b64: base64(bytes(mesh.normals)),
    indices_b64: base64(bytes(mesh.indices)),
  };
}

/** Objects and lenses for `set_projection_sim_view`. `meshKeyFor` returns
 *  the key of an uploaded mesh for an object, or null to leave it out
 *  (an import that has not loaded yet, a bare point cloud). */
export function buildProjectorViewScene(
  scene: ProjectionSimScene,
  slices: readonly OutputSlice[],
  meshKeyFor: (object: ProjectionSimObject) => string | null,
): NativeProjectorViewScene {
  const objects: NativeProjectorViewScene['objects'] = [{
    mesh: FLOOR_MESH_KEY,
    matrix: new THREE.Matrix4().toArray(),
    receive: scene.environment.showFloorProjection !== false,
  }];
  for (const object of scene.objects) {
    if (!object.visible) continue;
    const mesh = meshKeyFor(object);
    if (!mesh) continue;
    objects.push({
      mesh,
      matrix: projectionSimObjectMatrix(object),
      receive: object.receiveProjection !== false,
    });
  }
  const ids = new Set(scene.projectors.map((p) => p.id));
  const projectors = scene.projectors.map((projector) => ({
    id: projector.id,
    view: projectorViewMatrix(projector),
    projection: projectorProjectionMatrix(projector),
    position: [...projector.position] as [number, number, number],
    near: projectorNear(projector),
    far: projectorFar(projector),
    crop: projectorContentCrop(projector, slices),
    blend: projectorOutputBlend(projector, slices),
    content_from: projector.contentFrom && ids.has(projector.contentFrom) ? projector.contentFrom : null,
  }));
  return { objects, projectors };
}
