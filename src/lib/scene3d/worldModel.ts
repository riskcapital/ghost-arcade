/**
 * The Studio's 3D world: the scene's objects stand out of a wall as blocks,
 * seen face-on, lit by a sun and a fill light, with gravity running down the
 * projection. Optional on an Interactive scene (`InteractiveScene.world`): a
 * scene without one is the flat 2D Studio scene it always was.
 *
 * The world holds no geometry of its own. The scene's solid objects are the
 * blocks (their outline is the block's front face, their depth `height ×
 * depthScale`), so a flat effect and its block always share one outline and
 * the Studio's shape overlay stays the outline editor. See relief.ts.
 *
 * Validation is strict, in the style of sceneModel.ts: a value outside its
 * range is clamped, a field of the wrong type throws with where and what.
 */
import { validateRoom, type Room } from './roomModel';

export const SURFACE_FINISHES = ['stone', 'matte', 'chrome', 'glass', 'neon', 'ink', 'light'] as const;
export type SurfaceFinishPreset = (typeof SURFACE_FINISHES)[number];
/** How a block looks. `light` is a real object: only the light falling on it
 *  is drawn (for projection onto physical blocks). */
export type SurfaceFinish = { preset: SurfaceFinishPreset; color: string };

/** How the 2D effects meet the world: thrown onto it as projector light (lit,
 *  shadowed, wetted, hidden behind balls), laid over it, or left out. */
/** Where the world's shape comes from: blocks standing out of a flat wall,
 *  seen face-on, or the real objects in front of the projector (roomModel.ts). */
export const WORLD_SOURCES = ['wall', 'room'] as const;
export type WorldSource = (typeof WORLD_SOURCES)[number];

/** How the world's surfaces are drawn: shaded with their finishes, or not at
 *  all, so only the effects show (the real objects are the canvas). */
export const WORLD_LOOKS = ['shaded', 'effects'] as const;
export type WorldLook = (typeof WORLD_LOOKS)[number];

export const FLAT_MODES = ['projected', 'over', 'off'] as const;
export type FlatMode = (typeof FLAT_MODES)[number];

export type ReliefWorld = {
  enabled: boolean;
  source: WorldSource;
  /** The real objects, when the source is `room`. */
  room?: Room;
  look: WorldLook;
  /** 0 a long lens (blocks barely show their sides) to 1 a wide one. */
  lens: number;
  /** Meters of depth per unit of an object's height. */
  depthScale: number;
  /** 0 floats, 1 Earth, 2 heavy. */
  gravity: number;
  wall: { color: string; rough: number; catcher: boolean };
  /** A ledge along the bottom edge that catches what falls. */
  floor: boolean;
  /** An invisible pane in front of the blocks that keeps balls in view. */
  frontPane: boolean;
  /** Degrees round the wall from 12 o'clock, degrees up from the wall, and
   *  degrees a second it swings back and forth. */
  sun: { azimuth: number; elevation: number; color: string; power: number; sway: number };
  fill: { color: string; power: number };
  flat: FlatMode;
  bloom: number;
  exposure: number;
};

/** A mid-dark stone, so projected light reads on it rather than washing out. */
export const defaultSurfaceFinish = (): SurfaceFinish => ({ preset: 'stone', color: '#7a746c' });

export function defaultReliefWorld(): ReliefWorld {
  return {
    enabled: true,
    source: 'wall',
    look: 'shaded',
    lens: 0.3,
    depthScale: 1.6,
    gravity: 1,
    wall: { color: '#2a2826', rough: 0.85, catcher: false },
    floor: true,
    frontPane: true,
    // Strong enough for crisp shadows, low enough that projected light still reads on pale blocks.
    sun: { azimuth: -40, elevation: 38, color: '#ffd2a0', power: 1.4, sway: 4 },
    fill: { color: '#ff3fb4', power: 0.9 },
    flat: 'projected',
    bloom: 0.55,
    exposure: 0,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const fail = (where: string, what: string): never => {
  throw new Error(`World ${where}: ${what}.`);
};
const num = (raw: unknown, where: string, fallback: number, lo: number, hi: number): number => {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) fail(where, 'not a number');
  return Math.max(lo, Math.min(hi, raw as number));
};
const color = (raw: unknown, where: string, fallback: string): string => {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !HEX.test(raw)) fail(where, 'not a #rrggbb color');
  return (raw as string).toLowerCase();
};
const bool = (raw: unknown, where: string, fallback: boolean): boolean => {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'boolean') fail(where, 'not true or false');
  return raw as boolean;
};
const obj = (raw: unknown, where: string): Record<string, unknown> => {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(where, 'not an object');
  return raw as Record<string, unknown>;
};

export function validateSurfaceFinish(raw: unknown): SurfaceFinish {
  const f = obj(raw, 'finish');
  const base = defaultSurfaceFinish();
  const preset = f.preset === undefined ? base.preset : f.preset;
  if (!SURFACE_FINISHES.includes(preset as SurfaceFinishPreset)) fail('finish', `unknown finish ${String(preset)}`);
  return { preset: preset as SurfaceFinishPreset, color: color(f.color, 'finish color', base.color) };
}

export function validateReliefWorld(raw: unknown): ReliefWorld {
  const w = obj(raw, 'settings');
  const d = defaultReliefWorld();
  const wall = obj(w.wall, 'wall'), sun = obj(w.sun, 'sun'), fill = obj(w.fill, 'fill');
  const flat = w.flat === undefined ? d.flat : w.flat;
  const source = w.source === undefined ? d.source : w.source;
  if (!WORLD_SOURCES.includes(source as WorldSource)) fail('source', `unknown source ${String(source)}`);
  const look = w.look === undefined ? d.look : w.look;
  if (!WORLD_LOOKS.includes(look as WorldLook)) fail('look', `unknown look ${String(look)}`);
  if (!FLAT_MODES.includes(flat as FlatMode)) fail('flat', `unknown mode ${String(flat)}`);
  return {
    enabled: bool(w.enabled, 'enabled', d.enabled),
    source: source as WorldSource,
    ...(w.room !== undefined ? { room: validateRoom(w.room) } : {}),
    look: look as WorldLook,
    lens: num(w.lens, 'lens', d.lens, 0, 1),
    depthScale: num(w.depthScale, 'depth', d.depthScale, 0.1, 4),
    gravity: num(w.gravity, 'gravity', d.gravity, 0, 2),
    wall: {
      color: color(wall.color, 'wall color', d.wall.color),
      rough: num(wall.rough, 'wall roughness', d.wall.rough, 0, 1),
      catcher: bool(wall.catcher, 'wall catcher', d.wall.catcher),
    },
    floor: bool(w.floor, 'floor', d.floor),
    frontPane: bool(w.frontPane, 'front pane', d.frontPane),
    sun: {
      azimuth: num(sun.azimuth, 'sun azimuth', d.sun.azimuth, -180, 180),
      elevation: num(sun.elevation, 'sun elevation', d.sun.elevation, 5, 85),
      color: color(sun.color, 'sun color', d.sun.color),
      power: num(sun.power, 'sun power', d.sun.power, 0, 6),
      sway: num(sun.sway, 'sun sway', d.sun.sway, 0, 30),
    },
    fill: { color: color(fill.color, 'fill color', d.fill.color), power: num(fill.power, 'fill power', d.fill.power, 0, 4) },
    flat: flat as FlatMode,
    bloom: num(w.bloom, 'bloom', d.bloom, 0, 2),
    exposure: num(w.exposure, 'exposure', d.exposure, -3, 3),
  };
}
