/**
 * Build the render graph of an Interactive 3D scene.
 *
 * The scene is turned into GPU data once (vertices, materials, emitters,
 * fields, lights, colliders, settings); everything that moves (the clock,
 * the director camera, the orbiting key light, the particles) moves on the
 * GPU, fed by the frame block the core writes every frame. So the core draws
 * the scene on its own, and the app sends values only when the scene is
 * edited.
 *
 * Passes: frame (camera, light, clock), particles, shadow map, opaque, glass,
 * particles drawn, bloom down and up, composite into the layer's source with
 * premultiplied alpha (a void sky stays transparent and cuts out).
 */
import { modelMatrix, buildSceneMeshes, VERTEX_FLOATS } from '../scene3d/sceneMeshes';
import type { EmitterNode, FieldNode, LightNode, MeshNode, Scene3D, SceneNode, Vec3 } from '../scene3d/sceneModel';
import { scene3dFrameBuffer } from './scene3dFrame';
import {
  COLLIDER_FLOATS,
  EMITTER_FLOATS,
  FIELD_FLOATS,
  LIGHT_FLOATS,
  MATERIAL_FLOATS,
  MAX_COLLIDERS,
  MAX_EMITTERS,
  MAX_FIELDS,
  MAX_POINT_LIGHTS,
  PARTICLE_FLOATS,
  SCENE_UNIFORM_FLOATS,
  VIEW_FLOATS,
} from './scene3dShaders';

export type Scene3DQuality = { particles: number; shadow: number; scene: number };
/** The tiers M0 measured (all near 250 fps on an RTX 4070 laptop). */
export const SCENE3D_TIERS: Record<'performance' | 'balanced' | 'default' | 'insane', Scene3DQuality> = {
  performance: { particles: 65_536, shadow: 1024, scene: 1024 },
  balanced: { particles: 250_000, shadow: 2048, scene: 1536 },
  default: { particles: 500_000, shadow: 2048, scene: 2048 },
  insane: { particles: 1_000_000, shadow: 4096, scene: 3072 },
};
const BLOOM_LEVELS = 6;

export type Scene3DGraphOptions = {
  scene: Scene3D;
  /** Where the picture goes: the layer's source frame. */
  sourceId: string;
  /** The output size; the camera takes its aspect. */
  width: number;
  height: number;
  quality?: Scene3DQuality;
  /** Burst count per emitter node id: each increase releases a burst. */
  bursts?: Record<string, number>;
};

type Buffer = { id: string; kind: 'uniform' | 'storage'; byte_length: number; initial_b64?: string; persistent?: boolean };
export type Scene3DGraph = {
  config: { textures: object[]; buffers: Buffer[]; passes: object[]; render_passes: object[]; readbacks: [] };
  /** Everything that decides which textures, buffers and passes exist. While
   *  it is unchanged, an edit only needs the value buffers resent. */
  topology: string;
  /** The buffers the app fills, for in-place updates. */
  values: { id: string; initial_b64: string }[];
  /** Meshes left out because the vertex budget was full. */
  droppedMeshes: string[];
};

function b64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
  return btoa(s);
}

/** `#rrggbb` to linear light. */
export function linearColor(hex: string): Vec3 {
  const c = (i: number) => Math.pow(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255, 2.2);
  return [c(0), c(1), c(2)];
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
};
/** A node's own axis in the world (0 X, 1 Y, 2 Z), from its model matrix. */
const axis = (node: SceneNode, k: 0 | 1 | 2): Vec3 => {
  const m = modelMatrix(node.transform);
  return norm([m[k * 4], m[k * 4 + 1], m[k * 4 + 2]]);
};

/** 4×4 inverse (column major). */
function invert(m: number[]): number[] {
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  return inv.map((v) => v / (det || 1));
}

const FIELD_INDEX = { gravity: 0, wind: 1, vortex: 2, attract: 3, curl: 4 } as const;
const COLLIDER_SHAPES: Partial<Record<MeshNode['shape'], number>> = { box: 0, sphere: 1, plane: 2, cylinder: 3 };

/** The scene as the GPU's arrays. Pure: exported for tests. */
export function scene3dData(scene: Scene3D, width: number, height: number, quality: Scene3DQuality, bursts: Record<string, number> = {}) {
  const visible = scene.nodes.filter((n) => n.visible);
  const meshes = scene.nodes.filter((n): n is SceneNode & MeshNode => n.kind === 'mesh' && (n.visible || n.catcher));
  const materialOf = new Map(meshes.map((n, i) => [n.id, i]));
  const geometry = buildSceneMeshes(meshes.map((n) => ({ ...n, visible: true })), (n) => materialOf.get(n.id) ?? 0);

  const materials = new Float32Array(Math.max(1, meshes.length) * MATERIAL_FLOATS);
  meshes.forEach((n, i) => {
    materials.set([...linearColor(n.material.base), n.material.metal, n.material.rough, n.material.emissive, n.material.opacity, n.catcher ? 1 : 0], i * MATERIAL_FLOATS);
  });

  // Bounds of the geometry, for the key light's shadow.
  let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < geometry.count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = geometry.vertices[i * VERTEX_FLOATS + k];
      lo[k] = Math.min(lo[k], v);
      hi[k] = Math.max(hi[k], v);
    }
  }
  if (!geometry.count) {
    lo = [-5, 0, -5];
    hi = [5, 5, 5];
  }
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.max(2, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);

  const lightNodes = visible.filter((n): n is SceneNode & LightNode => n.kind === 'light');
  const key = lightNodes.find((n) => n.light === 'key');
  const points = lightNodes.filter((n) => n.light !== 'key').slice(0, MAX_POINT_LIGHTS);
  const lights = new Float32Array(Math.max(1, points.length) * LIGHT_FLOATS);
  points.forEach((n, i) => {
    const down = axis(n, 1).map((v) => -v) as Vec3;
    lights.set([...n.transform.position, n.light === 'spot' ? 1 : 0, ...linearColor(n.color), n.power, ...down, Math.cos((35 * Math.PI) / 180)], i * LIGHT_FLOATS);
  });

  const emitterNodes = visible.filter((n): n is SceneNode & EmitterNode => n.kind === 'emitter').slice(0, MAX_EMITTERS);
  const wanted = emitterNodes.map((n) => ({ steady: Math.ceil(n.rate * n.life), burst: Math.ceil(n.burst) }));
  const total = wanted.reduce((s, w) => s + w.steady + w.burst, 0);
  const fit = total > quality.particles ? quality.particles / total : 1;
  const emitters = new Float32Array(Math.max(1, emitterNodes.length) * EMITTER_FLOATS);
  let next = 0;
  emitterNodes.forEach((n, i) => {
    const steady = Math.floor(wanted[i].steady * fit);
    const burst = Math.floor(wanted[i].burst * fit);
    const shape = n.shape === 'point' ? 0 : n.shape === 'box' ? 1 : 2;
    const s = n.transform.scale;
    emitters.set([
      ...n.transform.position, n.rate,
      ...axis(n, 1), (n.spread * Math.PI) / 180,
      n.speed, n.life, n.size, n.glow,
      ...linearColor(n.color), Math.max(0, Math.floor(bursts[n.id] ?? 0)),
      shape, Math.abs(s[0]) / 2, Math.abs(s[1]) / 2, Math.abs(s[2]) / 2,
      next, steady, next + steady, burst,
    ], i * EMITTER_FLOATS);
    next += steady + burst;
  });
  const particleCount = next;

  const fieldNodes = visible.filter((n): n is SceneNode & FieldNode => n.kind === 'field').slice(0, MAX_FIELDS);
  const fields = new Float32Array(Math.max(1, fieldNodes.length) * FIELD_FLOATS);
  fieldNodes.forEach((n, i) => {
    fields.set([...n.transform.position, FIELD_INDEX[n.field], ...axis(n, n.field === 'wind' ? 0 : 1), n.strength, n.radius, 0, 0, 0], i * FIELD_FLOATS);
  });

  const colliderNodes = meshes.filter((n) => (n.collider !== 'none' || n.catcher) && COLLIDER_SHAPES[n.shape] !== undefined).slice(0, MAX_COLLIDERS);
  const colliders = new Float32Array(Math.max(1, colliderNodes.length) * COLLIDER_FLOATS);
  colliderNodes.forEach((n, i) => {
    const m = modelMatrix(n.transform);
    colliders.set([...m, ...invert(m), COLLIDER_SHAPES[n.shape]!, 0, 0, 0], i * COLLIDER_FLOATS);
  });

  const keyDir = key ? norm(key.transform.position) : ([0, 1, 0] as Vec3);
  const settings = new Float32Array(SCENE_UNIFORM_FLOATS);
  const c = scene.camera;
  settings.set([
    ...c.position, c.fov,
    ...c.target, c.mode === 'director' ? 1 : 0,
    ...(key ? linearColor(key.color) : [0, 0, 0]), key?.power ?? 0,
    ...keyDir, key?.orbit ?? 0,
    key?.shadows ? 1 : 0, key ? 1 : 0, quality.shadow, 0,
    ['void', 'studio', 'night'].indexOf(scene.environment.sky), scene.environment.intensity, scene.environment.fog, width / Math.max(1, height),
    scene.post.bloom, scene.post.exposure, scene.post.contrast, scene.post.saturation,
    scene.post.temperature, scene.post.grain, 0, 0,
    scene.react.light, scene.react.particles, scene.react.bloom, scene.react.camera,
    geometry.count, particleCount, emitterNodes.length, fieldNodes.length,
    points.length, colliderNodes.length, 0, 0,
    ...centre, radius,
  ]);

  return { settings, vertices: geometry.vertices, vertexCount: geometry.count, materials, lights, emitters, fields, colliders, particleCount, droppedMeshes: geometry.dropped, hasShadows: !!key?.shadows };
}

export function buildScene3DGraph(options: Scene3DGraphOptions): Scene3DGraph {
  const quality = options.quality ?? SCENE3D_TIERS.default;
  const data = scene3dData(options.scene, options.width, options.height, quality, options.bursts);
  const safe = options.sourceId.replace(/[^\w:-]+/g, '_').slice(0, 120);
  const id = (name: string) => `scene3d:${safe}:${name}`;

  // The picture keeps the output's shape, its long side at the tier's size.
  const aspect = options.width / Math.max(1, options.height);
  const sceneW = Math.round(aspect >= 1 ? quality.scene : quality.scene * aspect);
  const sceneH = Math.round(aspect >= 1 ? quality.scene / aspect : quality.scene);
  const textures: object[] = [
    { id: id('shadow'), size: quality.shadow, format: 'depth32float' },
    { id: id('hdr'), width: sceneW, height: sceneH, format: 'rgba16float' },
    { id: id('depth'), width: sceneW, height: sceneH, format: 'depth32float' },
  ];
  for (let level = 0; level < (options.scene.post.bloom > 0 || options.scene.react.bloom > 0 ? BLOOM_LEVELS : 0); level++) {
    textures.push({ id: id(`bloom${level}`), width: Math.max(8, sceneW >> (level + 1)), height: Math.max(8, sceneH >> (level + 1)), format: 'rgba16float' });
  }

  const value = (name: string, kind: 'uniform' | 'storage', array: Float32Array): Buffer => ({ id: id(name), kind, byte_length: array.byteLength, initial_b64: b64(array) });
  const frame = scene3dFrameBuffer(id('scene'));
  const buffers: Buffer[] = [
    value('settings', 'uniform', data.settings),
    { ...frame },
    { id: id('view'), kind: 'storage', byte_length: VIEW_FLOATS * 4, persistent: true },
    value('vertices', 'storage', data.vertices),
    value('materials', 'storage', data.materials),
    value('emitters', 'storage', data.emitters),
    value('fields', 'storage', data.fields),
    value('lights', 'storage', data.lights),
    value('colliders', 'storage', data.colliders),
    { id: id('particles'), kind: 'storage', byte_length: Math.max(1, data.particleCount) * PARTICLE_FLOATS * 4, persistent: true },
  ];

  const b = (binding: number, name: string, kind: string) => ({ binding, resource: id(name), kind });
  const base = [b(0, 'settings', 'uniform'), { binding: 1, resource: frame.id, kind: 'uniform' }];
  const passes: object[] = [
    { name: 'frame', shader_id: 'scene3d/sim', entry: 'cs_frame', dispatch: [1, 1, 1], bindings: [...base, b(2, 'view', 'storage')] },
  ];
  if (data.particleCount > 0) {
    passes.push({
      name: 'particles-step', shader_id: 'scene3d/sim', entry: 'cs_sim', dispatch: [Math.ceil(data.particleCount / 256), 1, 1],
      bindings: [...base, b(2, 'view', 'storage'), b(6, 'particles', 'storage'), b(7, 'emitters', 'read-only-storage'), b(8, 'fields', 'read-only-storage'), b(10, 'colliders', 'read-only-storage')],
    });
  }

  const meshBindings = [...base, b(2, 'view', 'read-only-storage'), b(3, 'vertices', 'read-only-storage'), b(4, 'materials', 'read-only-storage')];
  const litBindings = [...meshBindings, { binding: 5, kind: 'graph-depth-texture', texture: id('shadow') }, b(6, 'particles', 'read-only-storage'), b(7, 'emitters', 'read-only-storage'), b(9, 'lights', 'read-only-storage')];
  const renders: object[] = [];
  // The shadow map is always drawn (cleared when empty) so the lit passes can bind it.
  renders.push({
    name: 'shadow', shader_id: 'scene3d/world', vertex_entry: 'vs_shadow', fragment_entry: 'fs_main',
    target: 'texture', texture: id('shadow'), vertex_count: data.hasShadows ? data.vertexCount : 0, bindings: meshBindings,
  });
  renders.push({
    name: 'opaque', shader_id: 'scene3d/world', vertex_entry: 'vs_main', fragment_entry: 'fs_main',
    target: 'texture', texture: id('hdr'), depth: true, depth_write: true, depth_texture: id('depth'),
    clear: true, clear_color: [0, 0, 0, 0], vertex_count: data.vertexCount, bindings: litBindings,
  });
  renders.push({
    name: 'glass', shader_id: 'scene3d/world', vertex_entry: 'vs_main', fragment_entry: 'fs_glass',
    target: 'texture', texture: id('hdr'), clear: false, blend: 'add',
    depth: true, depth_write: false, depth_compare: 'less-equal', depth_load: true, depth_texture: id('depth'),
    vertex_count: data.vertexCount, bindings: litBindings,
  });
  if (data.particleCount > 0) {
    renders.push({
      name: 'particles', shader_id: 'scene3d/world', vertex_entry: 'vs_particle', fragment_entry: 'fs_particle',
      target: 'texture', texture: id('hdr'), clear: false, blend: 'add',
      depth: true, depth_write: false, depth_compare: 'less-equal', depth_load: true, depth_texture: id('depth'),
      vertex_count: 6, instance_count: data.particleCount, bindings: litBindings,
    });
  }
  const post = (name: string, entry: string, from: string, to: string, extra: object = {}) => ({
    name, shader_id: 'scene3d/post', vertex_entry: 'vs_main', fragment_entry: entry,
    target: 'texture', texture: to, clear: true, clear_color: [0, 0, 0, 0], vertex_count: 3,
    bindings: [...base, { binding: 2, kind: 'graph-texture', texture: from }, { binding: 3, kind: 'source-frame-sampler' }],
    ...extra,
  });
  // No glow at all: skip the chain, and the composite reads the scene as its (unused) glow.
  const bloom = options.scene.post.bloom > 0 || options.scene.react.bloom > 0;
  if (bloom) {
    renders.push(post('bloom-down-0', 'fs_down_first', id('hdr'), id('bloom0')));
    for (let level = 1; level < BLOOM_LEVELS; level++) renders.push(post(`bloom-down-${level}`, 'fs_down', id(`bloom${level - 1}`), id(`bloom${level}`)));
    for (let level = BLOOM_LEVELS - 2; level >= 0; level--) renders.push(post(`bloom-up-${level}`, 'fs_up', id(`bloom${level + 1}`), id(`bloom${level}`), { clear: false, blend: 'add' }));
  }
  renders.push({
    name: 'composite', shader_id: 'scene3d/post', vertex_entry: 'vs_main', fragment_entry: 'fs_composite',
    target: 'source_frame', source_id: options.sourceId, clear: true, clear_color: [0, 0, 0, 0], include_snapshot: false, vertex_count: 3,
    bindings: [...base, { binding: 2, kind: 'graph-texture', texture: id('hdr') }, { binding: 3, kind: 'source-frame-sampler' }, { binding: 4, kind: 'graph-texture', texture: id(bloom ? 'bloom0' : 'hdr') }],
  });

  const topology = JSON.stringify([
    textures,
    buffers.map((x) => [x.id, x.kind, x.byte_length, !!x.persistent]),
    passes.map((p) => [(p as { name: string }).name, (p as { dispatch: number[] }).dispatch]),
    renders.map((r) => [(r as { name: string }).name, (r as { vertex_count: number }).vertex_count, (r as { instance_count?: number }).instance_count ?? 1]),
  ]);
  return {
    config: { textures, buffers, passes, render_passes: renders, readbacks: [] },
    topology,
    values: buffers.filter((x) => x.initial_b64 !== undefined && x.id !== frame.id).map((x) => ({ id: x.id, initial_b64: x.initial_b64! })),
    droppedMeshes: data.droppedMeshes,
  };
}
