/**
 * Starter worlds, and how a mapped stage becomes a world.
 *
 * A world for projection looks straight down on a floor laid out like the
 * output: the output's left-right is the floor's X, its top is far (-Z). The
 * camera is placed so the floor fills the picture exactly, so a mapped
 * shape's outline in the output is where its block stands in the world, and
 * what is drawn on the floor lands where the projector puts it.
 */
import type { InteractiveScene } from '../mobile/studio/interactive';
import {
  defaultScene3D,
  identityTransform,
  material,
  type Scene3D,
  type SceneNode,
  type Transform,
  type Vec3,
} from './sceneModel';

/** A mapped shape: its outline in output space (0..1, y down). */
export type StageShape = { name: string; points: { x: number; y: number }[] };

/** The floor is this many metres from the top of the picture to the bottom. */
const FLOOR_DEPTH = 4;
const FOV = 30;

export type FloorFrame = {
  /** Metres across and top to bottom. */
  width: number;
  depth: number;
  /** Camera height that fits the floor to the picture. */
  height: number;
  fov: number;
  /** Output (0..1, y down) to floor (x, z). */
  toFloor(p: { x: number; y: number }): { x: number; z: number };
};

export function floorFrame(aspect: number): FloorFrame {
  const depth = FLOOR_DEPTH;
  const width = depth * Math.max(0.1, aspect);
  const height = depth / 2 / Math.tan((FOV * Math.PI) / 360);
  return { width, depth, height, fov: FOV, toFloor: (p) => ({ x: (p.x - 0.5) * width, z: (p.y - 0.5) * depth }) };
}

const node = (id: string, name: string, body: Record<string, unknown>, transform: Partial<Transform> = {}): SceneNode =>
  ({ id, name, visible: true, transform: { ...identityTransform(), ...transform }, ...body }) as SceneNode;

/** A top-down camera that fits the floor. */
function topDown(frame: FloorFrame): Scene3D['camera'] {
  return { mode: 'free', fov: frame.fov, position: [0, frame.height, 0], target: [0, 0, 0] };
}

/**
 * An outline standing on the floor: the shape's outline as seen from above,
 * raised `height` metres. (An outline mesh extrudes along its own -Z; turned
 * -90° about X its plane lies on the floor and the extrusion points down, so
 * it is lifted by its height to stand on the floor.)
 */
function block(id: string, name: string, frame: FloorFrame, points: { x: number; y: number }[], height: number, look = material('matte', { base: '#d6d2ca' })): SceneNode {
  const outline = points.map((p) => {
    const f = frame.toFloor(p);
    return { x: f.x, y: -f.z };
  });
  return node(id, name, { kind: 'mesh', shape: 'outline', material: look, collider: 'static', catcher: false, outline: { points: outline, depth: height } }, {
    position: [0, height, 0],
    rotation: [-90, 0, 0],
  });
}

function floor(frame: FloorFrame, look = material('matte', { base: '#8c8a86' })): SceneNode {
  return node('floor', 'Floor', { kind: 'mesh', shape: 'plane', material: look, collider: 'static', catcher: false }, {
    scale: [frame.width * 1.02, 1, frame.depth * 1.02],
  });
}

/** Three plinths when the stage has nothing mapped yet. */
const PLACEHOLDER_SHAPES: StageShape[] = [0.25, 0.5, 0.75].map((x, i) => ({
  name: `Plinth ${i + 1}`,
  points: [
    { x: x - 0.06, y: 0.38 },
    { x: x + 0.06, y: 0.38 },
    { x: x + 0.06, y: 0.62 },
    { x: x - 0.06, y: 0.62 },
  ],
}));

/**
 * Light and shadow: the mapped shapes rise out of the floor as blocks, and a
 * warm key light circles overhead, so their shadows sweep round them like a
 * sundial. Dust drifts in the light and falls into the shadows. The light
 * breathes with the bass.
 */
export function lightAndShadowWorld(shapes: StageShape[], aspect: number): Scene3D {
  const frame = floorFrame(aspect);
  const used = (shapes.filter((s) => s.points.length >= 3).length ? shapes : PLACEHOLDER_SHAPES).filter((s) => s.points.length >= 3).slice(0, 64);
  const nodes: SceneNode[] = [floor(frame, material('matte', { base: '#4b4a48', rough: 0.85 }))];
  used.forEach((s, i) => nodes.push(block(`shape-${i + 1}`, s.name || `Shape ${i + 1}`, frame, s.points, 0.55, material('matte', { base: '#c9c6c0', rough: 0.75 }))));
  nodes.push(node('key', 'Sun', { kind: 'light', light: 'key', color: '#ffd9b0', power: 1.25, shadows: true, orbit: 9 }, { position: [-0.7, 1.2, 0.35] }));
  nodes.push(node('dust', 'Dust', {
    kind: 'emitter', shape: 'box', rate: 220, burst: 0, life: 9, speed: 0.02, spread: 180, size: 0.007, color: '#fff1dc', glow: 0.02,
  }, { position: [0, 1.4, 0], scale: [frame.width, 2.2, frame.depth] }));
  nodes.push(node('air', 'Air', { kind: 'field', field: 'curl', strength: 0.12, radius: 0 }));
  return {
    ...defaultScene3D(),
    name: 'Light and shadow',
    nodes,
    environment: { sky: 'void', intensity: 0.9, fog: 0 },
    camera: topDown(frame),
    post: { bloom: 0.35, exposure: -0.15, contrast: 1.08, saturation: 1, temperature: 0.04, grain: 0.05 },
    react: { light: 0.35, particles: 0.3, bloom: 0.3, camera: 0 },
  };
}

export type WorldId = 'light-and-shadow' | 'marbles' | 'body-mirror';
export const WORLDS: { id: WorldId; name: string; blurb: string; ready: boolean }[] = [
  { id: 'light-and-shadow', name: 'Light and shadow', blurb: 'Your mapped shapes stand up as blocks under a circling sun. Their shadows sweep round them.', ready: true },
  { id: 'marbles', name: 'Marbles', blurb: 'Chrome and glass balls with real shadows. Touch throws them; a hit plays a sound.', ready: false },
  { id: 'body-mirror', name: 'Body mirror', blurb: 'A tracked silhouette in particles. Both hands up fires a Look.', ready: false },
];

export function buildWorld(id: WorldId, shapes: StageShape[], aspect: number): Scene3D {
  switch (id) {
    case 'light-and-shadow':
      return lightAndShadowWorld(shapes, aspect);
    default:
      throw new Error(`The ${WORLDS.find((w) => w.id === id)?.name ?? id} world arrives with bodies and rules.`);
  }
}

// ── Old 2D scenes ─────────────────────────────────────────────────────────

const EFFECT_COLOR: Record<string, string> = {
  fire: '#ff7a2e', smoke: '#9a9a9a', balls: '#b8eb88', cloud: '#7fd3ff', liquid: '#5fb8ff', light: '#ffd8a8',
};
const hueColor = (hue: number): string => {
  const h = (((hue % 360) + 360) % 360) / 60, c = 0.85, x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + 0.15) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
};

/**
 * An old `ghost-interactive` scene as a world: its objects stand up from the
 * floor (solid ones as blocks, emitters as low pads, attractors as fields,
 * triggers as zones) under a front key light, and its effects become
 * emitters and fields that approximate them.
 */
export function fromInteractiveScene(old: InteractiveScene, aspect: number): Scene3D {
  const frame = floorFrame(aspect);
  const nodes: SceneNode[] = [floor(frame, material('ink'))];
  const centre = (pts: { x: number; y: number }[]) => {
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
    const f = frame.toFloor(c);
    return [f.x, 0, f.z] as Vec3;
  };
  const span = (pts: { x: number; y: number }[]) => {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return [(Math.max(...xs) - Math.min(...xs)) * frame.width, (Math.max(...ys) - Math.min(...ys)) * frame.depth] as const;
  };
  old.surfaces.forEach((s, i) => {
    const id = `obj-${i + 1}`;
    if (s.behavior === 'solid') nodes.push(block(id, s.name, frame, s.points, Math.max(0.05, (s.height ?? 0.25) * 2), material('matte', { base: '#cfcac0' })));
    else if (s.behavior === 'emitter') nodes.push(block(id, s.name, frame, s.points, 0.04, material('neon', { base: hueColor(old.hue) })));
    else if (s.behavior === 'attractor') nodes.push(node(id, s.name, { kind: 'field', field: 'attract', strength: 1.2, radius: 2 }, { position: centre(s.points) }));
    else {
      const [w, d] = span(s.points);
      nodes.push(node(id, s.name, { kind: 'zone', shape: 'box', emits: `${s.name || id}-touched`.slice(0, 60) }, { position: [...centre(s.points)].map((v, k) => (k === 1 ? 0.5 : v)) as Vec3, scale: [Math.max(0.05, w), 1, Math.max(0.05, d)] }));
    }
  });
  let lights = 0;
  (old.effects ?? []).filter((e) => e.enabled).slice(0, 8).forEach((e, i) => {
    const target = old.surfaces.find((s) => s.id === e.target);
    const at: Vec3 = target ? centre(target.points) : (() => { const f = frame.toFloor({ x: e.params.x ?? 0.5, y: e.params.y ?? 0.5 }); return [f.x, 0.1, f.z] as Vec3; })();
    const color = EFFECT_COLOR[e.kind] ?? hueColor(e.params.hue ?? old.hue);
    if (e.kind === 'light') {
      if (lights++ === 0) nodes.push(node(`fx-${i}`, e.name, { kind: 'light', light: 'key', color, power: Math.max(0.5, e.params.lightPower ?? 1.5), shadows: true, orbit: 0 }, { position: [(e.params.lightX ?? 0.25) - 0.5, 1, (e.params.lightY ?? 0.15) - 0.5] }));
      return;
    }
    const fire = e.kind === 'fire', smoke = e.kind === 'smoke', balls = e.kind === 'balls';
    nodes.push(node(`fx-${i}`, e.name, {
      kind: 'emitter', shape: target ? 'box' : 'point',
      rate: fire ? 3000 : smoke ? 1200 : balls ? 60 : 1500,
      burst: e.emission === 'burst' ? 400 : 0,
      life: fire ? 1.2 : smoke ? 4 : balls ? 6 : 6,
      speed: fire ? 1.4 : smoke ? 0.4 : balls ? 1.2 : 0.3,
      spread: fire ? 18 : smoke ? 30 : 60,
      size: balls ? 0.06 : fire ? 0.025 : 0.018,
      color,
      glow: fire ? 3 : balls ? 0.2 : 0.8,
    }, { position: [at[0], 0.15, at[2]], scale: target ? [span(target.points)[0], 0.1, span(target.points)[1]] : [1, 1, 1] }));
    if (balls) nodes.push(node(`fx-${i}-g`, `${e.name} gravity`, { kind: 'field', field: 'gravity', strength: 9.8 * Math.max(0.1, Math.abs(e.params.gravity ?? 0.4)), radius: 0 }));
    else if (!fire) nodes.push(node(`fx-${i}-c`, `${e.name} drift`, { kind: 'field', field: 'curl', strength: 0.3 * (e.params.turbulence ?? 0.6), radius: 0 }));
  });
  if (!lights) nodes.push(node('key', 'Front light', { kind: 'light', light: 'key', color: '#ffffff', power: 1.6, shadows: true, orbit: 0 }, { position: [-0.4, 1, 0.6] }));
  return {
    ...defaultScene3D(),
    name: `${old.name} (3D)`.slice(0, 100),
    nodes: nodes.slice(0, 256),
    environment: { sky: 'void', intensity: 0.4, fog: 0 },
    camera: topDown(frame),
  };
}
