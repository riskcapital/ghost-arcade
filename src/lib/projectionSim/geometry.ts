/**
 * Map Sim geometry shared by the three.js preview and the native projector
 * view. Both must see exactly the same surfaces, or a calibrated projector
 * would line up in the preview and miss on the real object.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadPLY } from '../splat';
import { splatFrameBox } from '../splat/splatTransform';
import type { ProjectionSimObject, ProjectionSimPrimitiveKind } from './types';

export interface PrimitivePart {
  geometry: THREE.BufferGeometry;
  /** Offset of the part inside the object, object-local units. */
  offsetY: number;
  /** Surface colour override (the column caps are stone-coloured). */
  tint?: string;
}

/** The meshes that make up one primitive, in object-local space. */
export function primitiveParts(kind: ProjectionSimPrimitiveKind | undefined): PrimitivePart[] {
  switch (kind ?? 'box') {
    case 'column':
      return [
        { geometry: new THREE.CylinderGeometry(0.34, 0.34, 1, 32), offsetY: 0 },
        { geometry: new THREE.BoxGeometry(1.05, 0.16, 1.05), offsetY: 0.58, tint: '#ded8c8' },
        { geometry: new THREE.BoxGeometry(1.05, 0.16, 1.05), offsetY: -0.58, tint: '#ded8c8' },
      ];
    case 'sphere':
      return [{ geometry: new THREE.SphereGeometry(0.5, 48, 24), offsetY: 0 }];
    case 'cylinder':
      return [{ geometry: new THREE.CylinderGeometry(0.5, 0.5, 1, 40), offsetY: 0 }];
    case 'cone':
      return [{ geometry: new THREE.ConeGeometry(0.55, 1, 40), offsetY: 0 }];
    case 'pyramid': {
      const geometry = new THREE.ConeGeometry(0.75, 1, 4);
      geometry.rotateY(Math.PI / 4);
      return [{ geometry, offsetY: 0 }];
    }
    case 'plane':
      return [{ geometry: new THREE.BoxGeometry(1, 1, 0.06), offsetY: 0 }];
    case 'box':
    default:
      return [{ geometry: new THREE.BoxGeometry(1, 1, 1), offsetY: 0 }];
  }
}

export interface LoadedModelData {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export async function loadProjectionSimModel(object: ProjectionSimObject): Promise<LoadedModelData> {
  const url = object.assetUrl!;
  const format = object.assetFormat;
  if (format === 'obj') {
    return { scene: await new OBJLoader().loadAsync(url), animations: [] };
  }
  if (format === 'fbx') {
    const scene = await new FBXLoader().loadAsync(url);
    return { scene, animations: scene.animations ?? [] };
  }
  const gltf = await new GLTFLoader().loadAsync(url);
  return { scene: gltf.scene, animations: gltf.animations ?? [] };
}

/** Centre an imported model on its bounds and scale it to a unit size, so
 *  the object's own scale reads in metres whatever the file's units. */
export function normalizeImportedObject(obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  obj.position.sub(center);
  obj.scale.multiplyScalar(1 / maxDim);
}

export interface PlyGeometry {
  geometry: THREE.BufferGeometry;
  /** True when the PLY carried faces, so it is a surface, not points. */
  hasFaces: boolean;
  dataType: string;
}

/** A PLY as geometry, normalised to a unit size like imported models. */
export async function loadProjectionSimPly(url: string): Promise<PlyGeometry> {
  const ply = await loadPLY(url);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(ply.vertices.length * 3);
  const colors = new Float32Array(ply.vertices.length * 3);
  const normals = ply.vertices.every((v) => v.nx !== undefined && v.ny !== undefined && v.nz !== undefined)
    ? new Float32Array(ply.vertices.length * 3)
    : null;
  // Framed on the bulk of the cloud so one stray point cannot shrink it.
  const frame = splatFrameBox(ply);
  const center = frame.center;
  const maxDim = frame.size || 1;
  for (let i = 0; i < ply.vertices.length; i++) {
    const v = ply.vertices[i];
    positions[i * 3] = (v.x - center.x) / maxDim;
    positions[i * 3 + 1] = (v.y - center.y) / maxDim;
    positions[i * 3 + 2] = (v.z - center.z) / maxDim;
    colors[i * 3] = (v.r ?? 255) / 255;
    colors[i * 3 + 1] = (v.g ?? 255) / 255;
    colors[i * 3 + 2] = (v.b ?? 255) / 255;
    if (normals) {
      normals[i * 3] = v.nx ?? 0;
      normals[i * 3 + 1] = v.ny ?? 1;
      normals[i * 3 + 2] = v.nz ?? 0;
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  const indices: number[] = [];
  for (const face of ply.faces ?? []) {
    const valid = face.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < ply.vertices.length);
    if (valid.length < 3) continue;
    for (let j = 1; j < valid.length - 1; j++) {
      indices.push(valid[0], valid[j], valid[j + 1]);
    }
  }
  if (indices.length) {
    geometry.setIndex(indices);
    if (!normals) geometry.computeVertexNormals();
  }
  geometry.computeBoundingSphere();
  return { geometry, hasFaces: indices.length > 0, dataType: ply.dataType };
}
