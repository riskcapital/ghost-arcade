/**
 * The 3D world part of an Interactive layer's graph: the relief world
 * (relief.ts) drawn by the 3D engine, with the layer's 2D effects either
 * thrown onto it as light (Projected), drawn over it (Over) or left out (Off),
 * and the world's own elements: balls that fall, roll and bounce down the
 * blocks (scene3dWorldShaders.ts).
 *
 * The 2D passes are built as before; this module only says where they draw
 * and puts the world's passes around them. Every world buffer starts with
 * `scene3d:` so the core leaves it to the app, all but the frame block it
 * writes each frame.
 */
import type { InteractiveScene } from '../mobile/studio/interactive';
import { effectParams, MOD_SOURCES, type InteractiveEffect } from '../mobile/studio/interactiveEffects';
import type { WorldInputState } from '../interactive/worldInput';
import {
  blockDepth,
  deepestBlock,
  floorDepth,
  frontPaneDepth,
  pickRelief,
  rayFromUv,
  reliefFrame,
  reliefScene,
  reliefSolids,
  unproject,
  type ReliefFrame,
  type ReliefView,
} from '../scene3d/relief';
import type { ReliefWorld } from '../scene3d/worldModel';
import { buildScene3DGraph, SCENE3D_TIERS, type Scene3DQuality } from './scene3dNative';
import {
  BALL_BLOCK_FLOATS,
  BALL_FLOATS,
  BALL_INPUT_FLOATS,
  BALL_KIND_FLOATS,
  BALL_PARAM_KEYS,
  BALL_PHYS_FLOATS,
  BALL_SUBSTEPS,
} from './scene3dWorldShaders';

/** Brightness of the projected 2D picture on the relief. */
export const RELIEF_PROJECTOR_GAIN = 2.5;
/** Ball slots for throws, and the most for each Bouncing Balls effect. */
export const THROWN_BALLS = 64;
export const MAX_BALLS_PER_EFFECT = 256;
const MAX_BALLS = 1024;

export type WorldPart = {
  textures: object[];
  buffers: { id: string; kind: string; byte_length: number; initial_b64?: string; persistent?: boolean }[];
  passes: object[];
  /** The world's own render passes, in order. The 2D passes go before them
   *  (into `flatTexture`) when Projected, after them when Over. */
  render_passes: object[];
  values: { id: string; initial_b64: string; key: string }[];
  topology: string;
  /** Where the 2D passes draw when Projected; null when they draw on the output. */
  flatTexture: string | null;
};

export type WorldPartOptions = {
  scene: InteractiveScene;
  world: ReliefWorld;
  sourceId: string;
  width: number;
  height: number;
  quality?: Scene3DQuality;
  /** The Studio's Orbit view; face-on without it. */
  view?: ReliefView;
  /** This frame's touches on the world (worldInput.ts). */
  input?: WorldInputState;
};

/** The flat picture's size: the output's, within the core's texture limit. */
export function flatSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 4096 / Math.max(1, width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function b64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
  return btoa(s);
}

// ── Balls ─────────────────────────────────────────────────────────────────

export type BallLayout = {
  /** Every Bouncing Balls effect, on or off (switching one off keeps its slots). */
  effects: InteractiveEffect[];
  perEffect: number;
  count: number;
};

export function ballLayout(scene: InteractiveScene): BallLayout {
  const effects = (scene.effects ?? []).filter((e) => e.kind === 'balls3d');
  const perEffect = effects.length ? Math.min(MAX_BALLS_PER_EFFECT, Math.floor((MAX_BALLS - THROWN_BALLS) / effects.length)) : 0;
  return { effects, perEffect, count: THROWN_BALLS + perEffect * effects.length };
}

const EMISSIONS = ['continuous', 'pulse', 'burst'] as const;

/** One kind's params and their modulation, as the shader's `param()` reads them. */
function writeKind(out: Float32Array, at: number, effect: InteractiveEffect | undefined, slots: [number, number, number, number], emit: [number, number, number, number], overrides: Record<string, number> = {}): void {
  out.set(slots, at);
  out.set(emit, at + 4);
  const defs = effectParams('balls3d');
  BALL_PARAM_KEYS.forEach((key, i) => {
    const d = defs[i];
    out[at + 8 + i] = overrides[key] ?? effect?.params[key] ?? d.value;
    const mod = overrides[key] === undefined ? effect?.mods[key] : undefined;
    if (!mod || mod.source === 'manual') return;
    const ranged = mod.rangeMin !== undefined && mod.rangeMax !== undefined;
    out.set([
      Math.max(0, (MOD_SOURCES as readonly string[]).indexOf(mod.source)), mod.amount, mod.speed, mod.invert ? 1 : 0,
      ranged ? d.min + mod.rangeMin! * (d.max - d.min) : d.min, ranged ? d.min + mod.rangeMax! * (d.max - d.min) : d.max, mod.bpmSync ? 1 : 0, ranged ? 1 : 0,
    ], at + 28 + i * 8);
  });
}

/** Where an effect emitting from a block drops its balls: just above its top. */
function blockEmitter(scene: InteractiveScene, world: ReliefWorld, frame: ReliefFrame, effect: InteractiveEffect) {
  const s = reliefSolids(scene).find((x) => x.id === effect.target);
  if (!s) return null;
  const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return {
    depth: blockDepth(s, world, frame),
    params: { x: (lo + hi) / 2, y: Math.max(0, Math.min(...ys) - 0.04), radius: Math.max(0.005, ((hi - lo) / 2) * 0.8), direction: 90 },
  };
}

export function ballKinds(scene: InteractiveScene, world: ReliefWorld, frame: ReliefFrame, layout: BallLayout): Float32Array {
  const kinds = new Float32Array((1 + layout.effects.length) * BALL_KIND_FLOATS);
  // Kind 0: thrown balls, in the first effect's style.
  const first = layout.effects.find((e) => e.enabled) ?? layout.effects[0];
  writeKind(kinds, 0, first, [0, THROWN_BALLS, 3, 0], [0, 0, 0, 1]);
  layout.effects.forEach((e, i) => {
    const from = e.target !== 'point' ? blockEmitter(scene, world, frame, e) : null;
    writeKind(
      kinds, (i + 1) * BALL_KIND_FLOATS, e,
      [THROWN_BALLS + i * layout.perEffect, layout.perEffect, EMISSIONS.indexOf(e.emission), e.burst],
      [from ? 1 : 0, from?.depth ?? 0, 0, e.enabled ? 1 : 0],
      from?.params,
    );
  });
  return kinds;
}

export function ballBlocks(scene: InteractiveScene, world: ReliefWorld, frame: ReliefFrame): Float32Array {
  const solids = reliefSolids(scene);
  const blocks = new Float32Array(Math.max(1, solids.length) * BALL_BLOCK_FLOATS);
  solids.forEach((s, i) => {
    const d = blockDepth(s, world, frame);
    const pts = s.points.slice(0, 64).map((p) => unproject(frame, p, d));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const at = i * BALL_BLOCK_FLOATS;
    blocks.set([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), d, pts.length, 0, 0], at);
    pts.forEach((p, j) => blocks.set([p.x, p.y], at + 8 + j * 2));
  });
  return blocks;
}

export function ballPhysics(scene: InteractiveScene, world: ReliefWorld, frame: ReliefFrame, layout: BallLayout): Float32Array {
  const pane = world.frontPane ? frontPaneDepth(scene, world, frame) : 0;
  return new Float32Array([
    frame.W, frame.H, frame.camZ, 9.8 * world.gravity,
    pane, world.floor ? -frame.H / 2 : -1e9, Math.max(0.5, deepestBlock(scene, world, frame)), world.floor ? floorDepth(scene, world, frame) : 0,
    layout.count, 1 + layout.effects.length, reliefSolids(scene).length, BALL_SUBSTEPS,
    -frame.H / 2 - 3, frame.W / 2 + 1, frame.camZ * 0.8, 0,
  ]);
}

const TOOL_CODES = { push: 1, attract: 2, repel: 3, vortex: 4 } as const;
const MAX_THROW_SPEED = 14;

/**
 * This frame's touches as the GPU reads them: each point becomes the ray
 * through it and what that ray hits; a throw starts in front of what is
 * under the finger, as deep as the world allows, at the finger's speed.
 */
export function ballInput(scene: InteractiveScene, world: ReliefWorld, frame: ReliefFrame, aspect: number, layout: BallLayout, input?: WorldInputState): Float32Array {
  const data = new Float32Array(BALL_INPUT_FLOATS);
  if (!input) return data;
  const pick = (p: { x: number; y: number }) => {
    const ray = rayFromUv(frame, p);
    return { ray, hit: pickRelief(scene, world, aspect, ray) };
  };
  // Output speed (per second) to meters per second at depth z.
  const speed = (v: { x: number; y: number }, z: number): [number, number] => {
    const k = 1 - z / frame.camZ;
    return [v.x * frame.W * k, -v.y * frame.H * k];
  };
  input.pointers.slice(0, 8).forEach((p, i) => {
    const { hit } = pick(p.point);
    const [vx, vy] = speed(p.velocity, hit.point[2]);
    data.set([...hit.point, TOOL_CODES[p.tool], vx, vy, 0, p.strength], 4 + i * 8);
  });
  const size = (layout.effects.find((e) => e.enabled) ?? layout.effects[0])?.params.size ?? effectParams('balls3d').find((d) => d.key === 'size')!.value;
  const r = 0.03 + 0.17 * Math.max(0, Math.min(1, size));
  const pane = world.frontPane ? frontPaneDepth(scene, world, frame) : Math.max(0.5, deepestBlock(scene, world, frame)) + 0.45;
  input.throws.slice(-8).forEach((t, i) => {
    const { ray, hit } = pick(t.point);
    const lift = 0.05 + ((t.number * 0.618034) % 1) * 0.25;
    const z = Math.max(r + 0.01, Math.min(hit.point[2] + r + lift, pane - r - 0.01));
    const at = (z - ray.origin[2]) / ray.dir[2];
    const pos = [ray.origin[0] + ray.dir[0] * at, ray.origin[1] + ray.dir[1] * at, z];
    let [vx, vy] = speed(t.velocity, z);
    const fast = Math.hypot(vx, vy);
    if (fast > MAX_THROW_SPEED) { vx *= MAX_THROW_SPEED / fast; vy *= MAX_THROW_SPEED / fast; }
    data.set([...pos, t.number, vx, vy, -0.5, 0], 4 + 64 + i * 8);
  });
  data.set([Math.min(8, input.pointers.length), Math.min(8, input.throws.length)], 0);
  return data;
}

export function buildWorldPart(options: WorldPartOptions): WorldPart {
  const { world, width, height, scene } = options;
  const aspect = width / Math.max(1, height);
  const frame = reliefFrame(aspect, world.lens);
  const safe = options.sourceId.replace(/[^\w:-]+/g, '_').slice(0, 120);
  const id = (name: string) => `scene3d:${safe}:${name}`;
  const flatTexture = world.flat === 'projected' ? id('flat') : null;
  const graph = buildScene3DGraph({
    scene: reliefScene(scene, world, aspect, options.view),
    sourceId: options.sourceId,
    width,
    height,
    quality: options.quality ?? SCENE3D_TIERS.default,
    relief: { flatTexture: flatTexture ?? undefined, gain: RELIEF_PROJECTOR_GAIN, sway: world.sun.sway, projector: { width: frame.W, height: frame.H, distance: frame.camZ } },
  });
  const textures = [...graph.config.textures];
  if (flatTexture) textures.unshift({ id: flatTexture, ...flatSize(width, height), format: 'rgba16float' });

  // Balls: their state, the kinds, the blocks they hit and this frame's touches.
  const layout = ballLayout(scene);
  const value = (name: string, kind: 'uniform' | 'storage', data: Float32Array) => ({ id: id(name), kind, byte_length: data.byteLength, initial_b64: b64(data) });
  const ballValues = [
    value('ball-phys', 'uniform', ballPhysics(scene, world, frame, layout)),
    value('ball-kinds', 'storage', ballKinds(scene, world, frame, layout)),
    value('ball-blocks', 'storage', ballBlocks(scene, world, frame)),
    value('ball-input', 'uniform', ballInput(scene, world, frame, aspect, layout, options.input)),
  ];
  const ballBytes = layout.count * BALL_FLOATS * 4;
  const buffers = [
    ...graph.config.buffers,
    ...ballValues,
    { id: id('balls'), kind: 'storage', byte_length: ballBytes, persistent: true },
    { id: id('balls-prev'), kind: 'storage', byte_length: ballBytes, persistent: true },
  ];
  const frameBuffer = graph.config.buffers.find((b) => b.id.endsWith(':scene3d:frame'))!;
  const b = (binding: number, name: string, kind: string) => ({ binding, resource: id(name), kind });
  const simBindings = [
    { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'),
    b(13, 'balls', 'storage'), b(14, 'balls-prev', 'storage'), b(15, 'ball-kinds', 'read-only-storage'),
    b(16, 'ball-blocks', 'read-only-storage'), b(17, 'ball-phys', 'uniform'), b(18, 'ball-input', 'uniform'),
  ];
  const groups = [Math.ceil(layout.count / 64), 1, 1];
  const sim = (name: string, entry: string) => ({ name, shader_id: 'scene3d/balls', entry, dispatch: groups, bindings: simBindings });
  const passes = [...graph.config.passes, sim('balls-life', 'cs_balls_life')];
  for (let i = 0; i < BALL_SUBSTEPS; i++) passes.push(sim(`balls-copy-${i}`, 'cs_balls_copy'), sim(`balls-step-${i}`, 'cs_balls_step'));

  const drawBindings = [
    b(0, 'settings', 'uniform'), { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'),
    { binding: 5, kind: 'graph-depth-texture', texture: id('shadow') }, b(9, 'lights', 'read-only-storage'),
    b(13, 'balls', 'read-only-storage'), b(15, 'ball-kinds', 'read-only-storage'), b(17, 'ball-phys', 'uniform'),
  ];
  const renders = [...graph.config.render_passes] as { name: string }[];
  const after = (name: string, pass: object) => renders.splice(renders.findIndex((r) => r.name === name) + 1, 0, pass as { name: string });
  after('shadow', {
    name: 'ball-shadows', shader_id: 'scene3d/balls-draw', vertex_entry: 'vs_ball_shadow', fragment_entry: 'fs_ball',
    // Not the shadow map itself: it is what this pass draws into.
    target: 'texture', texture: id('shadow'), depth_load: true, vertex_count: 36, instance_count: layout.count, bindings: drawBindings.filter((x) => x.binding !== 5),
  });
  after('opaque', {
    name: 'balls', shader_id: 'scene3d/balls-draw', vertex_entry: 'vs_ball', fragment_entry: flatTexture ? 'fs_ball_relief' : 'fs_ball',
    target: 'texture', texture: id('hdr'), clear: false, depth: true, depth_write: true, depth_load: true, depth_texture: id('depth'),
    vertex_count: 6, instance_count: layout.count,
    bindings: flatTexture ? [...drawBindings, { binding: 11, kind: 'graph-texture', texture: flatTexture }, { binding: 12, kind: 'source-frame-sampler' }] : drawBindings,
  });

  return {
    textures,
    buffers,
    passes,
    render_passes: renders,
    values: [...graph.values, ...ballValues.map(({ id, initial_b64 }) => ({ id, initial_b64 }))].map((v) => ({ ...v, key: v.initial_b64 })),
    topology: `${world.flat}|${flatTexture ? JSON.stringify(flatSize(width, height)) : ''}|balls:${layout.count}:${layout.effects.length}|${graph.topology}`,
    flatTexture,
  };
}
