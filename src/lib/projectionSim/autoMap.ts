/**
 * Auto-map — build a mapping project for the model in Map Sim.
 *
 * Every face of every object that a projector can see becomes its own
 * surface layer, with its corners placed exactly where that face lands in
 * the projector's image. The result lines up in the simulator straight away,
 * which makes the demo models a quick way to see mapping working, and a
 * starting point for a real rig that was measured into the simulator.
 */
import * as THREE from 'three';
import { get } from 'svelte/store';
import { project } from '../stores/layers';
import { settings } from '../stores/settings';
import type { WarpCorners } from '../types';
import { primitiveParts } from './geometry';
import { projectorCameraModel, projectorImageSize, projectToImage } from './projectorLens';
import { projectionSimObjectMatrix, projectorContentCrop } from './projectorViewPayload';
import type { ProjectionSimObject, ProjectionSimProjector, ProjectionSimScene } from './types';

/** Layers made by auto-map carry this so a re-run replaces them. */
export const AUTO_MAP_TAG = 'projection-sim-auto-map';

type Face = { name: string; normal: THREE.Vector3; corners: THREE.Vector3[] };

/** Flat colour per face: a hue per object, lit by which way the face
 *  points, like a lit model. Each face is a media layer that shows this
 *  colour until it is given content, so the shading shows at a glance
 *  whether every face landed on the right surface. An empty layer costs
 *  almost nothing to render, so a large model stays smooth. */
function faceColour(objectIndex: number, face: Face): { hue: number; saturation: number; lightness: number; alpha: number } {
  const hue = Math.round((objectIndex * 137.508 + 205) % 360);
  const up = face.normal.y;
  const lightness = up > 0.5 ? 64 : up < -0.5 ? 26 : 34 + Math.abs(face.normal.z) * 16;
  return { hue, saturation: 62, lightness: Math.round(lightness), alpha: 1 };
}

// Box faces in object-local space, corners ordered TL, TR, BR, BL as seen
// from outside the face.
const BOX_FACES: Array<{ name: string; normal: [number, number, number]; corners: Array<[number, number, number]> }> = [
  { name: 'Front', normal: [0, 0, 1], corners: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  { name: 'Back', normal: [0, 0, -1], corners: [[0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5]] },
  { name: 'Right', normal: [1, 0, 0], corners: [[0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]] },
  { name: 'Left', normal: [-1, 0, 0], corners: [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5]] },
  { name: 'Top', normal: [0, 1, 0], corners: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { name: 'Bottom', normal: [0, -1, 0], corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]] },
];

/** The local box a primitive's faces are taken from. Round shapes are
 *  mapped by their bounding box, the way a mapper would start on them. */
function primitiveBox(object: ProjectionSimObject): { size: [number, number, number]; faces?: string[] } {
  switch (object.primitive ?? 'box') {
    case 'column': return { size: [0.68, 1, 0.68], faces: ['Front', 'Back', 'Left', 'Right'] };
    case 'cylinder': return { size: [1, 1, 1], faces: ['Front', 'Back', 'Left', 'Right', 'Top'] };
    case 'plane': return { size: [1, 1, 0.06], faces: ['Front', 'Back'] };
    case 'pyramid': return { size: [1.06, 1, 1.06], faces: ['Front', 'Back', 'Left', 'Right'] };
    default: return { size: [1, 1, 1] };
  }
}

function objectFaces(object: ProjectionSimObject): Face[] {
  const matrix = new THREE.Matrix4().fromArray(projectionSimObjectMatrix(object));
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const { size, faces } = primitiveBox(object);
  return BOX_FACES
    // Undersides are never lit from a rigged projector in practice, and an
    // edge-on one only throws a sliver of light onto the floor.
    .filter((face) => face.name !== 'Bottom' && (!faces || faces.includes(face.name)))
    .map((face) => ({
      name: face.name,
      normal: new THREE.Vector3(...face.normal).applyMatrix3(normalMatrix).normalize(),
      corners: face.corners.map(([x, y, z]) => new THREE.Vector3(x * size[0], y * size[1], z * size[2]).applyMatrix4(matrix)),
    }));
}

/** Meshes used to test whether a face is hidden behind another object. */
function buildOccluders(objects: ProjectionSimObject[]): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  for (const object of objects) {
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.matrix.fromArray(projectionSimObjectMatrix(object));
    for (const part of primitiveParts(object.primitive)) {
      const mesh = new THREE.Mesh(part.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      mesh.position.y = part.offsetY;
      mesh.userData.objectId = object.id;
      root.add(mesh);
    }
    root.updateMatrixWorld(true);
    meshes.push(root);
  }
  return meshes;
}

function faceVisible(
  face: Face,
  objectId: string,
  projector: ProjectionSimProjector,
  occluders: THREE.Object3D[],
  raycaster: THREE.Raycaster,
): boolean {
  const eye = new THREE.Vector3(...projector.position);
  const centre = face.corners.reduce((sum, c) => sum.add(c), new THREE.Vector3()).multiplyScalar(0.25);
  const toEye = eye.clone().sub(centre).normalize();
  if (face.normal.dot(toEye) < 0.2) return false; // edge-on or facing away
  // Sample the centre and points towards each corner: a face counts when
  // most of it is in the open, not just its middle.
  const samples = [centre, ...face.corners.map((c) => centre.clone().lerp(c, 0.7))];
  let open = 0;
  for (const point of samples) {
    const target = point.clone().addScaledVector(face.normal, 0.002);
    const dir = target.clone().sub(eye);
    const distance = dir.length();
    raycaster.set(eye, dir.normalize());
    raycaster.far = distance + 0.01;
    const hit = raycaster.intersectObjects(occluders, true)[0];
    if (!hit || hit.object.userData.objectId === objectId || hit.distance >= distance - 0.01) open++;
  }
  // Any open sample counts: the faces are stacked nearest-on-top below, so
  // the part of a face hidden behind a nearer object is covered by that
  // object's own faces, exactly as on the real model.
  return open >= 1;
}

function polygonArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export interface AutoMapResult {
  surfaces: number;
  skipped: number;
  /** Faces left out because the render core draws a fixed number of layers. */
  overBudget: number;
  budget: number;
}

/** The render core composites at most this many layers (MAX_SCENE_LAYERS). */
const CORE_LAYER_LIMIT = 1024;

/**
 * Replace earlier auto-mapped layers with one surface per visible face.
 * Faces smaller than `minArea` (fraction of the frame) are left out, since
 * trims and edges that small are not worth a layer of their own.
 */
export async function autoMapProjectionSim(
  scene: ProjectionSimScene,
  options: { shaderFile?: string; minArea?: number; maxSurfaces?: number } = {},
): Promise<AutoMapResult> {
  const shaderFile = options.shaderFile;
  const minArea = options.minArea ?? 0.00002;
  // Leave room for the layers the user made themselves.
  const ownLayers = get(project).layers.filter((layer) => (layer as any).autoMap !== AUTO_MAP_TAG).length;
  const budget = Math.max(0, Math.min(options.maxSurfaces ?? CORE_LAYER_LIMIT, CORE_LAYER_LIMIT - ownLayers));
  const objects = scene.objects.filter((o) => o.visible && o.receiveProjection && o.type === 'primitive');
  const projectors = scene.projectors.filter((p) => p.enabled);
  if (!objects.length || !projectors.length) return { surfaces: 0, skipped: 0, overBudget: 0, budget };

  const slices = get(settings).output?.slices ?? [];
  const occluders = buildOccluders(objects);
  const raycaster = new THREE.Raycaster();
  type Candidate = { name: string; corners: WarpCorners; area: number; depth: number; colour: ReturnType<typeof faceColour> };
  const candidates: Candidate[] = [];
  let skipped = 0;

  for (const [objectIndex, object] of objects.entries()) {
    for (const face of objectFaces(object)) {
      // Lay the face through the projector that sees it most squarely.
      let best: { projector: ProjectionSimProjector; facing: number } | null = null;
      for (const projector of projectors) {
        if (!faceVisible(face, object.id, projector, occluders, raycaster)) continue;
        const centre = face.corners.reduce((s, c) => s.add(c), new THREE.Vector3()).multiplyScalar(0.25);
        const facing = face.normal.dot(new THREE.Vector3(...projector.position).sub(centre).normalize());
        if (!best || facing > best.facing) best = { projector, facing };
      }
      if (!best) continue;
      const [width, height] = projectorImageSize(best.projector);
      const model = projectorCameraModel(best.projector, width, height);
      const [cx, cy, cw, ch] = projectorContentCrop(best.projector, slices);
      const points: Array<[number, number]> = [];
      for (const corner of face.corners) {
        const pixel = projectToImage(model, [corner.x, corner.y, corner.z]);
        if (!pixel) break;
        // Projector image -> composition (y down) -> layer corners (y up).
        points.push([cx + (pixel[0] / width) * cw, 1 - (cy + (pixel[1] / height) * ch)]);
      }
      if (points.length !== 4) continue;
      const area = polygonArea(points);
      if (area < minArea) { skipped++; continue; }
      const [tl, tr, br, bl] = points;
      const centre = face.corners.reduce((sum, c) => sum.add(c), new THREE.Vector3()).multiplyScalar(0.25);
      candidates.push({
        name: `${object.name} · ${face.name}`,
        area,
        depth: centre.distanceTo(new THREE.Vector3(...best.projector.position)),
        colour: faceColour(objectIndex, face),
        corners: {
          topLeft: { x: tl[0], y: tl[1] },
          topRight: { x: tr[0], y: tr[1] },
          bottomRight: { x: br[0], y: br[1] },
          bottomLeft: { x: bl[0], y: bl[1] },
        } as WarpCorners,
      });
    }
  }

  // Keep the faces that cover the most of the picture, then stack those by
  // depth below.
  // Every visible face gets a surface; only past the core's layer limit are
  // the smallest left out.
  candidates.sort((a, b) => b.area - a.area);
  const chosen = candidates.slice(0, budget);
  const overBudget = candidates.length - chosen.length;

  // Replace the previous run's layers, leave everything else alone.
  for (const layer of get(project).layers) {
    if ((layer as any).autoMap === AUTO_MAP_TAG) project.removeLayer(layer.id);
  }

  const src = shaderFile ? `./ISF/${encodeURIComponent(shaderFile)}` : '';
  const shaderCode = shaderFile ? await fetch(src).then((r) => (r.ok ? r.text() : '')).catch(() => '') : '';
  // Painter's order: the farthest face goes in first (bottom of the stack)
  // and the nearest last (top), so wherever two faces overlap in the
  // projector's image the one in front wins, as it does on the object.
  const byDepth = [...chosen].sort((a, b) => b.depth - a.depth);
  for (const candidate of byDepth) {
    // Media layers, so every face takes a shader, clip or image like any
    // other layer; the face colour is only their fill while they are empty.
    const id = project.addLayer(candidate.name, 'media');
    if (!id) continue;
    project.updateLayer(id, { colorContent: candidate.colour } as any);
    if (shaderFile && shaderCode) {
      project.setLayerSource(id, {
        id: `${shaderFile}-${id}`,
        type: 'shader',
        src,
        name: shaderFile!.replace(/\.fs$/, '').replace(/^DM-/, ''),
        shaderCode,
        shaderValues: {},
      } as any);
    }
    project.updateLayer(id, { corners: candidate.corners, autoMap: AUTO_MAP_TAG } as any);
  }
  return { surfaces: chosen.length, skipped, overBudget, budget };
}

// The Map Sim pop-out is its own window with its own copy of the stores;
// the editor owns the project. Auto-map therefore always runs in the editor:
// the pop-out sends its scene over and waits for the answer.
const AUTO_MAP_CHANNEL = 'ga-projection-sim-auto-map';

type AutoMapMessage =
  | { type: 'request'; id: string; scene: ProjectionSimScene }
  | { type: 'result'; id: string; result?: AutoMapResult; error?: string };

function isMapSimPopout(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'projection-sim';
}

/** Auto-map from either window; the layers always land in the editor. */
export function requestAutoMap(scene: ProjectionSimScene): Promise<AutoMapResult> {
  if (!isMapSimPopout() || typeof BroadcastChannel === 'undefined') return autoMapProjectionSim(scene);
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const channel = new BroadcastChannel(AUTO_MAP_CHANNEL);
    const timer = setTimeout(() => {
      channel.close();
      reject(new Error('the main window did not answer'));
    }, 20000);
    channel.onmessage = (event: MessageEvent<AutoMapMessage>) => {
      const message = event.data;
      if (message?.type !== 'result' || message.id !== id) return;
      clearTimeout(timer);
      channel.close();
      if (message.result) resolve(message.result);
      else reject(new Error(message.error || 'auto-map failed'));
    };
    channel.postMessage({ type: 'request', id, scene: JSON.parse(JSON.stringify(scene)) } satisfies AutoMapMessage);
  });
}

/** Run in the editor window: answer auto-map requests from the pop-out. */
export function startAutoMapHost(): () => void {
  if (typeof BroadcastChannel === 'undefined' || isMapSimPopout()) return () => {};
  const channel = new BroadcastChannel(AUTO_MAP_CHANNEL);
  channel.onmessage = async (event: MessageEvent<AutoMapMessage>) => {
    const message = event.data;
    if (message?.type !== 'request') return;
    try {
      const result = await autoMapProjectionSim(message.scene);
      channel.postMessage({ type: 'result', id: message.id, result } satisfies AutoMapMessage);
    } catch (err) {
      channel.postMessage({ type: 'result', id: message.id, error: err instanceof Error ? err.message : String(err) } satisfies AutoMapMessage);
    }
  };
  return () => channel.close();
}
