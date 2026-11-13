/**
 * Interactive scenes with the 3D world on: the starter a new Interactive 3D
 * layer opens with, and an older Interactive 3D layer (a ghost-scene of its
 * own) brought into the Studio.
 */
import { defaultInteractive, type InteractiveScene, type InteractiveSurface } from '../mobile/studio/interactive';
import { editableEffects, makeEffect, soundDefaults } from '../mobile/studio/interactiveEffects';
import { generateUUID } from '../utils/uuid';
import type { MeshNode, Scene3D, SceneNode, LightNode } from './sceneModel';
import { floorFrame, type StageShape } from './worlds';
import { defaultReliefWorld, defaultSurfaceFinish, type SurfaceFinish, type SurfaceFinishPreset } from './worldModel';

/** Three plinths when nothing is mapped yet. */
const PLINTHS: StageShape[] = [0.25, 0.5, 0.75].map((x, i) => ({
  name: `Plinth ${i + 1}`,
  points: [
    { x: x - 0.07, y: 0.3 + i * 0.06 },
    { x: x + 0.07, y: 0.3 + i * 0.06 },
    { x: x + 0.07, y: 0.82 },
    { x: x - 0.07, y: 0.82 },
  ],
}));
const STARTER_FINISHES: SurfaceFinish[] = [
  { preset: 'stone', color: '#7a746c' },
  { preset: 'chrome', color: '#d8dce4' },
  { preset: 'neon', color: '#3d7dff' },
];

/** validateScene's limit on an outline. */
const MAX_SURFACE_POINTS = 64;

const blockFrom = (shape: StageShape, i: number, finish: SurfaceFinish, height = 0.3): InteractiveSurface => ({
  id: generateUUID(),
  name: shape.name || `Block ${i + 1}`,
  behavior: 'solid',
  points: shape.points.slice(0, MAX_SURFACE_POINTS).map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) })),
  height,
  finish,
});

/** The scene's flat effect, following the music, and balls raining onto the blocks. */
function withEffects(scene: InteractiveScene): InteractiveScene {
  return { ...scene, effects: [makeEffect('balls3d'), ...editableEffects(scene).map((e) => ({ ...e, mods: soundDefaults(e.kind) }))] };
}

/** A new Interactive 3D layer: the mapped shapes (or three plinths) standing out of a lit wall. */
export function reliefStarterScene(shapes: StageShape[]): InteractiveScene {
  const used = shapes.filter((s) => s.points.length >= 3).slice(0, 24);
  const surfaces = (used.length ? used : PLINTHS).map((s, i) => blockFrom(s, i, STARTER_FINISHES[i % STARTER_FINISHES.length], 0.25 + (i % 3) * 0.08));
  return withEffects({ ...defaultInteractive(), name: 'Relief', surfaces, world: defaultReliefWorld() });
}

const FINISH_OF: Record<string, SurfaceFinishPreset> = { chrome: 'chrome', glass: 'glass', neon: 'neon', ink: 'ink', matte: 'matte' };

/**
 * An Interactive 3D layer's ghost-scene as a Studio scene: its blocks on the
 * floor (worlds.ts `block()`) become solid objects with the same outline as
 * seen from above, their height their depth; its sun becomes the world's sun.
 * Emitters, fields and the rest arrive with the world elements.
 */
export function interactiveFromScene3D(scene: Scene3D, aspect: number): InteractiveScene {
  const frame = floorFrame(aspect);
  const world = defaultReliefWorld();
  const blocks = scene.nodes.filter(
    (n): n is SceneNode & MeshNode => n.kind === 'mesh' && n.shape === 'outline' && !!n.outline && n.outline.points.length >= 3,
  );
  const surfaces = blocks.slice(0, 32).map((n, i) => {
    // Inverse of block(): outline (x, y) is floor (x, −z); floor to picture.
    const shape: StageShape = { name: n.name, points: n.outline!.points.map((p) => ({ x: p.x / frame.width + 0.5, y: -p.y / frame.depth + 0.5 })) };
    const finish: SurfaceFinish = { preset: FINISH_OF[n.material.preset ?? ''] ?? 'stone', color: /^#[0-9a-f]{6}$/i.test(n.material.base) ? n.material.base.toLowerCase() : defaultSurfaceFinish().color };
    return blockFrom(shape, i, finish, Math.max(0.02, Math.min(0.9, n.outline!.depth / world.depthScale)));
  });
  const key = scene.nodes.find((n): n is SceneNode & LightNode => n.kind === 'light' && n.light === 'key');
  if (key) world.sun = { ...world.sun, color: key.color.toLowerCase(), power: Math.max(0, Math.min(6, key.power * 1.1)) };
  world.bloom = Math.max(0, Math.min(2, scene.post.bloom));
  return withEffects({ ...defaultInteractive(), name: scene.name || 'Interactive 3D', surfaces, world });
}
