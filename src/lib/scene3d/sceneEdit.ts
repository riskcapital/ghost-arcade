/**
 * Edits to an Interactive 3D world, as plain functions: each takes a world
 * and returns a new one (the old one is untouched, for undo).
 */
import {
  MAX_SCENE3D_NODES,
  PRESET_MATERIALS,
  identityTransform,
  material,
  type Camera,
  type MaterialPreset,
  type Scene3D,
  type SceneNode,
  type Vec3,
} from './sceneModel';

export type NewNodeKind = 'box' | 'sphere' | 'cylinder' | 'plane' | 'point-light' | 'spot-light' | 'key-light' | 'emitter' | 'field';

export const NEW_NODE_LABELS: Record<NewNodeKind, string> = {
  box: 'Box',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  plane: 'Plane',
  'key-light': 'Sun',
  'point-light': 'Point light',
  'spot-light': 'Spotlight',
  emitter: 'Particles',
  field: 'Force',
};

function freshId(scene: Scene3D, base: string): string {
  const used = new Set(scene.nodes.map((n) => n.id));
  for (let i = 1; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}
function freshName(scene: Scene3D, base: string): string {
  const used = new Set(scene.nodes.map((n) => n.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** A node of `kind` with sensible defaults, standing at the scene's target. */
export function makeNode(scene: Scene3D, kind: NewNodeKind): SceneNode {
  const at: Vec3 = [scene.camera.target[0], 0, scene.camera.target[2]];
  const name = freshName(scene, NEW_NODE_LABELS[kind]);
  const common = { id: freshId(scene, kind), name, visible: true };
  switch (kind) {
    case 'box':
    case 'sphere':
    case 'cylinder':
      return { ...common, kind: 'mesh', shape: kind, material: material('matte', { base: '#c9c6c0' }), collider: 'static', catcher: false, transform: { ...identityTransform(), position: [at[0], 0.5, at[2]] } };
    case 'plane':
      return { ...common, kind: 'mesh', shape: 'plane', material: material('matte'), collider: 'static', catcher: false, transform: { ...identityTransform(), position: at, scale: [4, 1, 4] } };
    case 'key-light':
      return { ...common, kind: 'light', light: 'key', color: '#ffffff', power: 1.2, shadows: true, orbit: 0, transform: { ...identityTransform(), position: [-0.6, 1, 0.4] } };
    case 'point-light':
    case 'spot-light':
      return { ...common, kind: 'light', light: kind === 'spot-light' ? 'spot' : 'point', color: '#ffffff', power: 1, shadows: false, orbit: 0, transform: { ...identityTransform(), position: [at[0], 2, at[2]] } };
    case 'emitter':
      return { ...common, kind: 'emitter', shape: 'point', rate: 400, burst: 0, life: 3, speed: 1, spread: 25, size: 0.02, color: '#9fd6ff', glow: 1, transform: { ...identityTransform(), position: [at[0], 0.2, at[2]] } };
    case 'field':
      return { ...common, kind: 'field', field: 'gravity', strength: 4, radius: 0, transform: identityTransform() };
  }
}

/** Add a node (selected by its id afterwards). Refused when the scene is full. */
export function addNode(scene: Scene3D, kind: NewNodeKind): { scene: Scene3D; id: string } | null {
  if (scene.nodes.length >= MAX_SCENE3D_NODES) return null;
  const node = makeNode(scene, kind);
  return { scene: { ...scene, nodes: [...scene.nodes, node] }, id: node.id };
}

export function patchNode(scene: Scene3D, id: string, patch: Record<string, unknown>): Scene3D {
  return { ...scene, nodes: scene.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as SceneNode) : n)) };
}

export function setTransform(scene: Scene3D, id: string, part: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2, value: number): Scene3D {
  return {
    ...scene,
    nodes: scene.nodes.map((n) => {
      if (n.id !== id) return n;
      const v = [...n.transform[part]] as Vec3;
      v[axis] = value;
      return { ...n, transform: { ...n.transform, [part]: v } };
    }),
  };
}

/** A mesh takes a preset's values; its own colour stays unless the preset has a defining one. */
export function setMaterialPreset(scene: Scene3D, id: string, preset: MaterialPreset): Scene3D {
  return {
    ...scene,
    nodes: scene.nodes.map((n) => (n.id === id && n.kind === 'mesh' ? { ...n, material: { ...PRESET_MATERIALS[preset], preset } } : n)),
  };
}

export function setMaterial(scene: Scene3D, id: string, patch: Record<string, unknown>): Scene3D {
  return {
    ...scene,
    nodes: scene.nodes.map((n) => {
      if (n.id !== id || n.kind !== 'mesh') return n;
      // Changing a value by hand leaves the preset behind.
      const { preset: _preset, ...rest } = n.material;
      return { ...n, material: { ...rest, ...patch } };
    }),
  };
}

export function removeNode(scene: Scene3D, id: string): Scene3D {
  return { ...scene, nodes: scene.nodes.filter((n) => n.id !== id) };
}

export function duplicateNode(scene: Scene3D, id: string): { scene: Scene3D; id: string } | null {
  const source = scene.nodes.find((n) => n.id === id);
  if (!source || scene.nodes.length >= MAX_SCENE3D_NODES) return null;
  const copy = structuredClone(source) as SceneNode;
  copy.id = freshId(scene, source.id.replace(/-\d+$/, ''));
  copy.name = freshName(scene, source.name);
  copy.transform = { ...copy.transform, position: [copy.transform.position[0] + 0.3, copy.transform.position[1], copy.transform.position[2] + 0.3] };
  const at = scene.nodes.indexOf(source) + 1;
  return { scene: { ...scene, nodes: [...scene.nodes.slice(0, at), copy, ...scene.nodes.slice(at)] }, id: copy.id };
}

/** The camera as an orbit round its target: degrees around, degrees up, metres away. */
export type Orbit = { around: number; up: number; distance: number };

export function cameraOrbit(camera: Camera): Orbit {
  const d = camera.position.map((v, i) => v - camera.target[i]) as Vec3;
  const distance = Math.max(0.1, Math.hypot(d[0], d[1], d[2]));
  return {
    around: ((Math.atan2(d[0], d[2]) * 180) / Math.PI + 360) % 360,
    up: (Math.asin(Math.max(-1, Math.min(1, d[1] / distance))) * 180) / Math.PI,
    distance,
  };
}

export function setCameraOrbit(scene: Scene3D, orbit: Orbit): Scene3D {
  const a = (orbit.around * Math.PI) / 180;
  // Straight up or down would leave no direction for "up"; stop just short.
  const e = (Math.max(-89.5, Math.min(89.5, orbit.up)) * Math.PI) / 180;
  const r = Math.max(0.1, orbit.distance);
  const t = scene.camera.target;
  const position: Vec3 = [t[0] + Math.sin(a) * Math.cos(e) * r, t[1] + Math.sin(e) * r, t[2] + Math.cos(a) * Math.cos(e) * r];
  return { ...scene, camera: { ...scene.camera, position } };
}
