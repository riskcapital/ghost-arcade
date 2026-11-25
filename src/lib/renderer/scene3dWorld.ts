/**
 * The 3D world part of an Interactive layer's graph: the world (the flat-wall
 * relief or a room of real objects, see worldGeometry.ts) drawn by the 3D engine, with the layer's 2D effects either
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
import { floorDepth, reliefCamera, type ReliefView } from '../scene3d/relief';
import { add, dot, length, scale } from '../scene3d/roomModel';
import {
  faceSites,
  geoFace,
  outputVelocity,
  pickWorld,
  rayThrough,
  spawnZ,
  unprojectAt,
  upOf,
  worldGeometry,
  type WorldGeo,
} from '../scene3d/worldGeometry';
import { roomCamera, worldScene } from '../scene3d/worldScene';
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
  DRIP_FLOATS,
  DRIP_KIND_FLOATS,
  DRIP_PARAM_KEYS,
  FIRE_LIGHT_FLOATS,
  FLAME_FLOATS,
  FLAME_KIND_FLOATS,
  FLAME_PARAM_KEYS,
  BALL_ZONE_FLOATS,
  MAX_BALL_ZONES,
} from './scene3dWorldShaders';

/** Brightness of the projected 2D picture on the relief. */
export const RELIEF_PROJECTOR_GAIN = 2.5;
/** Ball slots for throws, and the most for each Bouncing Balls effect. */
export const THROWN_BALLS = 64;
export const MAX_BALLS_PER_EFFECT = 256;
const MAX_BALLS = 1024;
/** Drop slots for pouring, and the most for all Paint Drips effects together. */
export const POURED_DRIPS = 4096;
export const MAX_DRIPS_PER_EFFECT = 8192;
const MAX_DRIPS = 12288;
/** How long poured paint stays wet, in seconds. */
const GLOSS_SECONDS = 3;
/** Flame slots for Ignite, and the most for all Fire & Smoke effects together. */
export const IGNITED_FLAMES = 2048;
export const MAX_FLAMES_PER_EFFECT = 16384;
const MAX_FLAMES = 24576;

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
  /** The buffer the app reads back live: how many times a ball has come into each zone (ballZones order). */
  zoneHits: { bufferId: string; zoneIds: string[] } | null;
  /**
   * The values that follow live input, worked out again for another Orbit
   * view and other touches without rebuilding the world: the scene settings
   * (the camera), the balls' input and the fire lights. Equal to what a full
   * build with that view and input puts in `values` for the same ids.
   * With `scene` (the same scene with other effect params, from live
   * values), the buffers those params fill are worked out again too: the
   * kinds, the physics and the fire lights.
   */
  live: (view?: ReliefView, input?: WorldInputState, scene?: InteractiveScene) => { id: string; initial_b64: string; key: string }[];
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

/** One kind's params and their modulation, as the shaders' `param()` and `dparam()` read them. */
function writeKind(out: Float32Array, at: number, kind: 'balls3d' | 'drips' | 'flames', effect: InteractiveEffect | undefined, slots: [number, number, number, number], emit: [number, number, number, number], overrides: Record<string, number> = {}): void {
  out.set(slots, at);
  out.set(emit, at + 4);
  const defs = effectParams(kind);
  (kind === 'balls3d' ? BALL_PARAM_KEYS : kind === 'drips' ? DRIP_PARAM_KEYS : FLAME_PARAM_KEYS).forEach((key, i) => {
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

/** Where an effect emitting from a block drops its balls: just above its top, on the output. */
function blockEmitter(scene: InteractiveScene, geo: WorldGeo, effect: InteractiveEffect) {
  const s = scene.surfaces.find((x) => x.id === effect.target);
  const f = geoFace(geo, effect.target);
  if (!s || !f) return null;
  const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return {
    // As far forward as the face comes (on the wall: its depth).
    depth: Math.max(...f.points.map((p) => spawnZ(geo, add(f.origin, add(scale(f.u, p.x), scale(f.v, p.y)))))),
    params: { x: (lo + hi) / 2, y: Math.max(0, Math.min(...ys) - 0.04), radius: Math.max(0.005, ((hi - lo) / 2) * 0.8), direction: 90 },
  };
}

export function ballKinds(scene: InteractiveScene, geo: WorldGeo, layout: BallLayout): Float32Array {
  const kinds = new Float32Array((1 + layout.effects.length) * BALL_KIND_FLOATS);
  // Kind 0: thrown balls, in the first effect's style.
  const first = layout.effects.find((e) => e.enabled) ?? layout.effects[0];
  writeKind(kinds, 0, 'balls3d', first, [0, THROWN_BALLS, 3, 0], [0, 0, 0, 1]);
  layout.effects.forEach((e, i) => {
    const from = e.target !== 'point' ? blockEmitter(scene, geo, e) : null;
    writeKind(
      kinds, (i + 1) * BALL_KIND_FLOATS, 'balls3d', e,
      [THROWN_BALLS + i * layout.perEffect, layout.perEffect, EMISSIONS.indexOf(e.emission), e.burst],
      [from ? 1 : 0, from?.depth ?? 0, 0, e.enabled ? 1 : 0],
      from?.params,
    );
  });
  return kinds;
}

/** The faces things collide with: each one's outline bounds, depth, frame and outline. */
export function ballBlocks(geo: WorldGeo): Float32Array {
  const blocks = new Float32Array(Math.max(1, geo.faces.length) * BALL_BLOCK_FLOATS);
  geo.faces.forEach((f, i) => {
    const pts = f.points.slice(0, 64);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const at = i * BALL_BLOCK_FLOATS;
    blocks.set([
      Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), f.depth, pts.length, 0, 0,
      ...f.origin, 0, ...f.u, 0, ...f.v, 0, ...f.n, 0,
    ], at);
    pts.forEach((p, j) => blocks.set([p.x, p.y], at + 24 + j * 2));
  });
  return blocks;
}

/** The trigger zones balls set off, in the order the GPU counts them. */
export function ballZones(scene: InteractiveScene): InteractiveScene['surfaces'] {
  return scene.surfaces
    .filter((s) => s.behavior === 'trigger' && s.points.length >= 3 && (s.trigger?.when === 'ball' || s.trigger?.when === 'either'))
    .slice(0, MAX_BALL_ZONES);
}

/** Those zones as outlines on the output, for the GPU. */
export function ballZoneOutlines(scene: InteractiveScene): Float32Array {
  const zones = ballZones(scene);
  const out = new Float32Array(Math.max(1, zones.length) * BALL_ZONE_FLOATS);
  zones.forEach((z, i) => {
    const pts = z.points.slice(0, 64);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const at = i * BALL_ZONE_FLOATS;
    out.set([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), pts.length, 0, 0, 0], at);
    pts.forEach((p, j) => out.set([p.x, p.y], at + 8 + j * 2));
  });
  return out;
}

// ── Paint drips ───────────────────────────────────────────────────────────

export type DripLayout = { effects: InteractiveEffect[]; perEffect: number; count: number };

export function dripLayout(scene: InteractiveScene): DripLayout {
  const effects = (scene.effects ?? []).filter((e) => e.kind === 'drips');
  const perEffect = effects.length ? Math.min(MAX_DRIPS_PER_EFFECT, Math.floor(MAX_DRIPS / effects.length)) : 0;
  return { effects, perEffect, count: POURED_DRIPS + perEffect * effects.length };
}

/** A drop or flame kind's sites: three vec4 each, the edge's ends, then the face's normal and depth. */
function writeSites(kinds: Float32Array, at: number, sites: ReturnType<typeof faceSites>): void {
  sites.forEach((site, j) => kinds.set([...site.a, 0, ...site.b, 0, ...site.n, site.depth], at + 188 + j * 12));
}

export function dripKinds(geo: WorldGeo, layout: DripLayout): Float32Array {
  const kinds = new Float32Array((1 + layout.effects.length) * DRIP_KIND_FLOATS);
  // Kind 0: poured paint, in the first effect's style.
  const first = layout.effects.find((e) => e.enabled) ?? layout.effects[0];
  writeKind(kinds, 0, 'drips', first, [0, POURED_DRIPS, 3, 0], [0, 0, 0, 1]);
  layout.effects.forEach((e, i) => {
    const at = (i + 1) * DRIP_KIND_FLOATS;
    const sites = e.target !== 'point' ? faceSites(geo, e.target) : [];
    writeKind(kinds, at, 'drips', e, [POURED_DRIPS + i * layout.perEffect, layout.perEffect, EMISSIONS.indexOf(e.emission), e.burst], [sites.length, 0, 0, e.enabled ? 1 : 0]);
    writeSites(kinds, at, sites);
  });
  return kinds;
}

// ── Fire and smoke ────────────────────────────────────────────────────────

export type FlameLayout = { effects: InteractiveEffect[]; perEffect: number; count: number };

export function flameLayout(scene: InteractiveScene): FlameLayout {
  const effects = (scene.effects ?? []).filter((e) => e.kind === 'flames');
  const perEffect = effects.length ? Math.min(MAX_FLAMES_PER_EFFECT, Math.floor(MAX_FLAMES / effects.length)) : 0;
  return { effects, perEffect, count: IGNITED_FLAMES + perEffect * effects.length };
}

export function flameKinds(geo: WorldGeo, layout: FlameLayout): Float32Array {
  const kinds = new Float32Array((1 + layout.effects.length) * FLAME_KIND_FLOATS);
  // Kind 0: fires lit by Ignite, in the first effect's style.
  const first = layout.effects.find((e) => e.enabled) ?? layout.effects[0];
  writeKind(kinds, 0, 'flames', first, [0, IGNITED_FLAMES, 3, 0], [0, 0, 0, 1]);
  layout.effects.forEach((e, i) => {
    const at = (i + 1) * FLAME_KIND_FLOATS;
    const sites = e.target !== 'point' ? faceSites(geo, e.target) : [];
    writeKind(kinds, at, 'flames', e, [IGNITED_FLAMES + i * layout.perEffect, layout.perEffect, EMISSIONS.indexOf(e.emission), e.burst], [sites.length, 0, 0, e.enabled ? 1 : 0]);
    writeSites(kinds, at, sites);
  });
  return kinds;
}

/** `#rrggbb`-free hue to a linear color with its brightest channel 1, as the shaders do. */
function hueColor(hue: number): [number, number, number] {
  const h = (((hue / 360) % 1) + 1) % 1;
  const k = [0, 2 / 3, 1 / 3].map((o) => (h + o) % 1);
  return k.map((x) => Math.max(0, Math.min(1, Math.abs(x * 6 - 3) - 1))) as [number, number, number];
}

/**
 * Firelight: a flickering light above each Fire & Smoke effect and each spot
 * Ignite set burning, so a fire lights what is round it. At most 8.
 */
export function fireLights(geo: WorldGeo, layout: FlameLayout, input?: WorldInputState): Float32Array {
  const up = upOf(geo);
  const data = new Float32Array(FIRE_LIGHT_FLOATS);
  const lights: { pos: number[]; power: number; color: [number, number, number] }[] = [];
  const tint = (e: InteractiveEffect | undefined) => {
    const c = hueColor(e?.params.hue ?? 24);
    return [0.55 + 0.45 * c[0], 0.3 + 0.3 * c[1], 0.1 + 0.2 * c[2]] as [number, number, number];
  };
  for (const e of layout.effects) {
    if (!e.enabled || (e.params.glow ?? 0) <= 0) continue;
    const sites = e.target !== 'point' ? faceSites(geo, e.target) : [];
    let pos: number[];
    if (sites.length) {
      // Above the middle of the highest edge, halfway back across the top.
      const s0 = sites.reduce((a, b) => (dot(add(a.a, a.b), up) > dot(add(b.a, b.b), up) ? a : b));
      pos = add(add(scale(add(s0.a, s0.b), 0.5), scale(up, 0.3)), scale(s0.n, -s0.depth / 2));
    } else {
      pos = add(unprojectAt(geo, { x: e.params.x ?? 0.5, y: e.params.y ?? 0.85 }, 0.3), scale(up, 0.3));
    }
    lights.push({ pos, power: (e.params.glow ?? 0) * (0.4 + 0.6 * (e.params.flow ?? 0.6)) * (e.params.heat ?? 1.2), color: tint(e) });
  }
  const style = layout.effects.find((e) => e.enabled) ?? layout.effects[0];
  for (const p of input?.pointers ?? []) {
    if (p.tool !== 'ignite') continue;
    const hit = pickWorld(geo, rayThrough(geo.projector, p.point)).point;
    lights.push({ pos: add(hit, add(scale(up, 0.25), scale(geo.projector.fwd, -0.15))), power: 0.8 * p.strength, color: tint(style) });
  }
  lights.slice(0, 8).forEach((l, i) => data.set([...l.pos, l.power, ...l.color, i * 1.37 + 0.5], 4 + i * 8));
  data[0] = Math.min(8, lights.length);
  return data;
}

/** The size of the wet map: the output's shape, 640 wide or high. */
export function wetSize(aspect: number): { width: number; height: number } {
  return aspect >= 1 ? { width: 640, height: Math.max(8, Math.round(640 / aspect)) } : { width: Math.max(8, Math.round(640 * aspect)), height: 640 };
}

export function worldPhysics(scene: InteractiveScene, world: ReliefWorld, geo: WorldGeo, balls: BallLayout, drips: DripLayout, flames: FlameLayout = { effects: [], perEffect: 0, count: 0 }): Float32Array {
  const paint = drips.effects.find((e) => e.enabled) ?? drips.effects[0];
  const frame = geo.frame;
  const floor = !!frame && world.floor;
  return new Float32Array([
    ...geo.down, 9.8 * world.gravity,
    geo.pane, floor ? -frame!.H / 2 : -1e9, geo.deepest, floor ? floorDepth(scene, world, frame!) : 0,
    balls.count, 1 + balls.effects.length, geo.faces.length, BALL_SUBSTEPS,
    ...(frame ? [-frame.H / 2 - 3, frame.W / 2 + 1, frame.camZ * 0.8] : [0, 0, 0]), 0,
    drips.count, 1 + drips.effects.length, paint?.params.dry ?? effectParams('drips').find((d) => d.key === 'dry')!.value, GLOSS_SECONDS,
    flames.count, 1 + flames.effects.length, ballZones(scene).length, 0,
    ...(geo.plane ? [...geo.plane.n, geo.plane.offset] : [0, 0, 0, 0]),
    geo.mode === 'room' ? 1 : 0, geo.spawnRef, geo.radius, 0,
    ...geo.center, 0,
  ]);
}

const TOOL_CODES = { push: 1, attract: 2, repel: 3, vortex: 4, pour: 5, ignite: 6 } as const;
const MAX_THROW_SPEED = 14;

/**
 * This frame's touches as the GPU reads them: each point becomes the ray
 * through it and what that ray hits; a throw starts in front of what is
 * under the finger, as near as the world allows, at the finger's speed.
 */
export function ballInput(geo: WorldGeo, layout: BallLayout, input?: WorldInputState): Float32Array {
  const data = new Float32Array(BALL_INPUT_FLOATS);
  if (!input) return data;
  const pick = (p: { x: number; y: number }) => pickWorld(geo, rayThrough(geo.projector, p));
  input.pointers.slice(0, 8).forEach((p, i) => {
    const hit = pick(p.point);
    data.set([...hit.point, TOOL_CODES[p.tool], ...outputVelocity(geo, p.velocity, hit.point), p.strength], 4 + i * 8);
  });
  const size = (layout.effects.find((e) => e.enabled) ?? layout.effects[0])?.params.size ?? effectParams('balls3d').find((d) => d.key === 'size')!.value;
  const r = 0.03 + 0.17 * Math.max(0, Math.min(1, size));
  const pane = geo.deepest + 0.45;
  input.throws.slice(-8).forEach((t, i) => {
    const hit = pick(t.point);
    const lift = 0.05 + ((t.number * 0.618034) % 1) * 0.25;
    // On the wall: on the ray, in front of what is hit. In a room: just off
    // the surface under the finger (above a top, in front of a side).
    const z = Math.max(r + 0.01, Math.min(spawnZ(geo, hit.point) + r + lift, pane - r - 0.01));
    const pos = geo.mode === 'room' ? add(hit.point, scale(hit.normal, r + lift)) : unprojectAt(geo, t.point, z);
    let v = outputVelocity(geo, t.velocity, pos);
    const fast = Math.hypot(...v);
    if (fast > MAX_THROW_SPEED) v = scale(v, MAX_THROW_SPEED / fast);
    // On the wall, a little way in, away from the projector; in a room it drops where it is.
    data.set([...pos, t.number, ...(geo.mode === 'room' ? v : add(v, scale(geo.projector.fwd, 0.5))), 0], 4 + 64 + i * 8);
  });
  data.set([Math.min(8, input.pointers.length), Math.min(8, input.throws.length)], 0);
  return data;
}

export function buildWorldPart(options: WorldPartOptions): WorldPart {
  const { world, width, height, scene } = options;
  const aspect = width / Math.max(1, height);
  const geo = worldGeometry(scene, world, aspect);
  const safe = options.sourceId.replace(/[^\w:-]+/g, '_').slice(0, 120);
  const id = (name: string) => `scene3d:${safe}:${name}`;
  const flatTexture = world.flat === 'projected' ? id('flat') : null;
  const graph = buildScene3DGraph({
    scene: worldScene(scene, world, geo, aspect, options.view),
    sourceId: options.sourceId,
    width,
    height,
    quality: options.quality ?? SCENE3D_TIERS.default,
    relief: {
      flatTexture: flatTexture ?? undefined, gain: RELIEF_PROJECTOR_GAIN, sway: world.sun.sway, projector: geo.projector,
      // Face-on, the camera is the projector, lens shift and all.
      cameraShift: options.view && (options.view.yaw || options.view.pitch) ? [0, 0] : geo.projector.shift,
      // In a room the lens keeps its own shape over the output (it differs when a Screen stretches the output).
      ...(geo.mode === 'room' ? { cameraAspect: length(geo.projector.right) / Math.max(1e-9, length(geo.projector.up)) } : {}),
    },
  });
  const textures = [...graph.config.textures];
  if (flatTexture) textures.unshift({ id: flatTexture, ...flatSize(width, height), format: 'rgba16float' });

  // Balls and drops: their state, their kinds, the blocks they hit and this frame's touches.
  const layout = ballLayout(scene);
  const paint = dripLayout(scene);
  const fire = flameLayout(scene);
  const value = (name: string, kind: 'uniform' | 'storage', data: Float32Array) => ({ id: id(name), kind, byte_length: data.byteLength, initial_b64: b64(data) });
  const ballValues = [
    value('ball-phys', 'uniform', worldPhysics(scene, world, geo, layout, paint, fire)),
    value('ball-kinds', 'storage', ballKinds(scene, geo, layout)),
    value('ball-blocks', 'storage', ballBlocks(geo)),
    value('ball-input', 'uniform', ballInput(geo, layout, options.input)),
    value('drip-kinds', 'storage', dripKinds(geo, paint)),
    value('flame-kinds', 'storage', flameKinds(geo, fire)),
    value('fire-lights', 'uniform', fireLights(geo, fire, options.input)),
    value('ball-zones', 'storage', ballZoneOutlines(scene)),
  ];
  const ballBytes = layout.count * BALL_FLOATS * 4;
  const wet = wetSize(aspect);
  textures.push({ id: id('wet-stain'), ...wet, format: 'rgba16float' }, { id: id('wet-gloss'), ...wet, format: 'rgba16float' });
  const buffers = [
    ...graph.config.buffers,
    ...ballValues,
    { id: id('drips'), kind: 'storage', byte_length: paint.count * DRIP_FLOATS * 4, persistent: true },
    { id: id('flames'), kind: 'storage', byte_length: fire.count * FLAME_FLOATS * 4, persistent: true },
    { id: id('balls'), kind: 'storage', byte_length: ballBytes, persistent: true },
    { id: id('zone-hits'), kind: 'storage', byte_length: MAX_BALL_ZONES * 4, persistent: true },
    { id: id('balls-prev'), kind: 'storage', byte_length: ballBytes, persistent: true },
  ];
  const frameBuffer = graph.config.buffers.find((b) => b.id.endsWith(':scene3d:frame'))!;
  const b = (binding: number, name: string, kind: string) => ({ binding, resource: id(name), kind });
  const simBindings = [
    b(0, 'settings', 'uniform'), { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'),
    b(13, 'balls', 'storage'), b(14, 'balls-prev', 'storage'), b(15, 'ball-kinds', 'read-only-storage'),
    b(16, 'ball-blocks', 'read-only-storage'), b(17, 'ball-phys', 'uniform'), b(18, 'ball-input', 'uniform'),
    b(26, 'ball-zones', 'read-only-storage'), b(27, 'zone-hits', 'storage'),
  ];
  const groups = [Math.ceil(layout.count / 64), 1, 1];
  const sim = (name: string, entry: string) => ({ name, shader_id: 'scene3d/balls', entry, dispatch: groups, bindings: simBindings });
  const passes = [...graph.config.passes, sim('balls-life', 'cs_balls_life')];
  for (let i = 0; i < BALL_SUBSTEPS; i++) passes.push(sim(`balls-copy-${i}`, 'cs_balls_copy'), sim(`balls-step-${i}`, 'cs_balls_step'));
  passes.push({
    name: 'drips', shader_id: 'scene3d/drips', entry: 'cs_drips', dispatch: [Math.ceil(paint.count / 64), 1, 1],
    bindings: [
      b(0, 'settings', 'uniform'), { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'), b(16, 'ball-blocks', 'read-only-storage'),
      b(17, 'ball-phys', 'uniform'), b(18, 'ball-input', 'uniform'), b(21, 'drips', 'storage'), b(22, 'drip-kinds', 'read-only-storage'),
    ],
  });
  passes.push({
    name: 'flames', shader_id: 'scene3d/flames', entry: 'cs_flames', dispatch: [Math.ceil(fire.count / 64), 1, 1],
    bindings: [
      b(0, 'settings', 'uniform'), { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'), b(16, 'ball-blocks', 'read-only-storage'),
      b(17, 'ball-phys', 'uniform'), b(18, 'ball-input', 'uniform'), b(24, 'flames', 'storage'), b(25, 'flame-kinds', 'read-only-storage'),
    ],
  });

  const drawBindings = [
    b(0, 'settings', 'uniform'), { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'),
    { binding: 5, kind: 'graph-depth-texture', texture: id('shadow') }, b(9, 'lights', 'read-only-storage'),
    b(13, 'balls', 'read-only-storage'), b(15, 'ball-kinds', 'read-only-storage'), b(17, 'ball-phys', 'uniform'), b(23, 'fire-lights', 'uniform'),
  ];
  const renders = [...graph.config.render_passes] as { name: string }[];
  const after = (name: string, pass: object) => renders.splice(renders.findIndex((r) => r.name === name) + 1, 0, pass as { name: string });
  after('shadow', {
    name: 'ball-shadows', shader_id: 'scene3d/balls-draw', vertex_entry: 'vs_ball_shadow', fragment_entry: 'fs_ball',
    // Not the shadow map itself: it is what this pass draws into.
    // Depth on and loaded: it adds to the blocks' shadows, it must not clear them.
    target: 'texture', texture: id('shadow'), depth: true, depth_write: true, depth_load: true, vertex_count: 36, instance_count: layout.count, bindings: drawBindings.filter((x) => x.binding !== 5),
  });
  // The wet map: both pictures fade, then the drops on surfaces paint into them.
  const dripBindings = [
    b(0, 'settings', 'uniform'), { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'),
    b(16, 'ball-blocks', 'read-only-storage'), b(17, 'ball-phys', 'uniform'), b(21, 'drips', 'read-only-storage'), b(22, 'drip-kinds', 'read-only-storage'),
  ];
  const wetPass = (name: string, texture: string, vertex: string, fragment: string, blend: string, vertices: number, instances: number) => ({
    name, shader_id: 'scene3d/drips-draw', vertex_entry: vertex, fragment_entry: fragment, target: 'texture', texture: id(texture),
    clear: false, blend, vertex_count: vertices, instance_count: instances, bindings: dripBindings,
  });
  const opaqueAt = renders.findIndex((r) => r.name === 'opaque');
  renders.splice(opaqueAt, 0,
    wetPass('wet-fade', 'wet-stain', 'vs_full', 'fs_fade_stain', 'alpha', 3, 1) as { name: string },
    wetPass('gloss-fade', 'wet-gloss', 'vs_full', 'fs_fade_gloss', 'alpha', 3, 1) as { name: string },
    wetPass('wet-splat', 'wet-stain', 'vs_splat', 'fs_splat_stain', 'alpha', 6, paint.count) as { name: string },
    wetPass('gloss-splat', 'wet-gloss', 'vs_splat', 'fs_splat_gloss', 'alpha', 6, paint.count) as { name: string },
  );
  // The world's surfaces show the paint.
  const opaque = renders.find((r) => r.name === 'opaque') as { name: string; shader_id: string; fragment_entry: string; bindings: { binding: number }[] };
  opaque.shader_id = 'scene3d/relief';
  opaque.fragment_entry = flatTexture ? 'fs_relief_wet' : 'fs_wet';
  opaque.bindings = [
    ...opaque.bindings.filter((x) => x.binding !== 12),
    { binding: 12, kind: 'source-frame-sampler' } as { binding: number },
    { binding: 19, kind: 'graph-texture', texture: id('wet-stain') } as { binding: number },
    { binding: 20, kind: 'graph-texture', texture: id('wet-gloss') } as { binding: number },
    b(23, 'fire-lights', 'uniform') as { binding: number },
  ];
  after('opaque', {
    name: 'balls', shader_id: 'scene3d/balls-draw', vertex_entry: 'vs_ball', fragment_entry: flatTexture ? 'fs_ball_relief' : 'fs_ball',
    target: 'texture', texture: id('hdr'), clear: false, depth: true, depth_write: true, depth_load: true, depth_texture: id('depth'),
    vertex_count: 6, instance_count: layout.count,
    bindings: flatTexture ? [...drawBindings, { binding: 11, kind: 'graph-texture', texture: flatTexture }, { binding: 12, kind: 'source-frame-sampler' }] : drawBindings,
  });
  const dripDraw = [
    b(0, 'settings', 'uniform'), { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'),
    { binding: 5, kind: 'graph-depth-texture', texture: id('shadow') }, b(9, 'lights', 'read-only-storage'),
    b(17, 'ball-phys', 'uniform'), b(21, 'drips', 'read-only-storage'), b(22, 'drip-kinds', 'read-only-storage'), b(23, 'fire-lights', 'uniform'),
  ];
  after('balls', {
    name: 'drips', shader_id: 'scene3d/drips-draw', vertex_entry: 'vs_drip', fragment_entry: flatTexture ? 'fs_drip_relief' : 'fs_drip',
    target: 'texture', texture: id('hdr'), clear: false, depth: true, depth_write: true, depth_load: true, depth_texture: id('depth'),
    vertex_count: 6, instance_count: paint.count,
    bindings: flatTexture ? [...dripDraw, { binding: 11, kind: 'graph-texture', texture: flatTexture }, { binding: 12, kind: 'source-frame-sampler' }] : dripDraw,
  });
  const flameDraw = [
    b(0, 'settings', 'uniform'), { binding: 1, resource: frameBuffer.id, kind: 'uniform' }, b(2, 'view', 'read-only-storage'),
    b(17, 'ball-phys', 'uniform'), b(24, 'flames', 'read-only-storage'), b(25, 'flame-kinds', 'read-only-storage'),
  ];
  const flamePass = (name: string, vertex: string, fragment: string, blend: string) => ({
    name, shader_id: 'scene3d/flames-draw', vertex_entry: vertex, fragment_entry: fragment,
    target: 'texture', texture: id('hdr'), clear: false, blend,
    depth: true, depth_write: false, depth_compare: 'less-equal', depth_load: true, depth_texture: id('depth'),
    vertex_count: 6, instance_count: fire.count, bindings: flameDraw,
  });
  after('drips', flamePass('smoke', 'vs_smoke', 'fs_smoke', 'alpha'));
  after('smoke', flamePass('fire', 'vs_fire', 'fs_fire', 'add'));

  return {
    textures,
    buffers,
    passes,
    render_passes: renders,
    values: [...graph.values, ...ballValues.map(({ id, initial_b64 }) => ({ id, initial_b64 }))].map((v) => ({ ...v, key: v.initial_b64 })),
    live: (view, input, moved) => {
      // Only the camera reads the view: rewrite its slots of the settings.
      const settings = graph.settings.slice();
      const camera = geo.mode === 'room' || !geo.frame ? roomCamera(geo, view) : reliefCamera(geo.frame, world, view);
      settings.set([...camera.position, camera.fov, ...camera.target, camera.mode === 'director' ? 1 : 0], 0);
      settings.set(view && (view.yaw || view.pitch) ? [0, 0] : geo.projector.shift, 42);
      // Other effect params: same effects in the same order, so the same
      // slots; only the values the params fill change.
      const balls = moved ? ballLayout(moved) : layout;
      const drips = moved ? dripLayout(moved) : paint;
      const flames = moved ? flameLayout(moved) : fire;
      return [
        value('settings', 'uniform', settings),
        value('ball-input', 'uniform', ballInput(geo, balls, input)),
        value('fire-lights', 'uniform', fireLights(geo, flames, input)),
        ...(moved ? [
          value('ball-phys', 'uniform', worldPhysics(moved, world, geo, balls, drips, flames)),
          value('ball-kinds', 'storage', ballKinds(moved, geo, balls)),
          value('drip-kinds', 'storage', dripKinds(geo, drips)),
          value('flame-kinds', 'storage', flameKinds(geo, flames)),
        ] : []),
      ].map(({ id, initial_b64 }) => ({ id, initial_b64, key: initial_b64 }));
    },
    topology: `${geo.mode}|${world.flat}|${flatTexture ? JSON.stringify(flatSize(width, height)) : ''}|balls:${layout.count}:${layout.effects.length}|drips:${paint.count}:${paint.effects.length}:${JSON.stringify(wet)}|flames:${fire.count}:${fire.effects.length}|${graph.topology}`,
    flatTexture,
    zoneHits: ballZones(scene).length ? { bufferId: id('zone-hits'), zoneIds: ballZones(scene).map((z) => z.id) } : null,
  };
}
