/**
 * The 3D world part of an Interactive layer's graph: the relief world
 * (relief.ts) drawn by the 3D engine, with the layer's 2D effects either
 * thrown onto it as light (Projected), drawn over it (Over) or left out (Off).
 *
 * The 2D passes are built as before; this module only says where they draw
 * and puts the world's passes around them. Every world buffer starts with
 * `scene3d:` so the core leaves it to the app, all but the frame block it
 * writes each frame.
 */
import type { InteractiveScene } from '../mobile/studio/interactive';
import { reliefFrame, reliefScene, type ReliefView } from '../scene3d/relief';
import type { ReliefWorld } from '../scene3d/worldModel';
import { buildScene3DGraph, SCENE3D_TIERS, type Scene3DQuality } from './scene3dNative';

/** Brightness of the projected 2D picture on the relief. */
export const RELIEF_PROJECTOR_GAIN = 2.5;

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
};

/** The flat picture's size: the output's, within the core's texture limit. */
export function flatSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 4096 / Math.max(1, width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function buildWorldPart(options: WorldPartOptions): WorldPart {
  const { world, width, height } = options;
  const aspect = width / Math.max(1, height);
  const safe = options.sourceId.replace(/[^\w:-]+/g, '_').slice(0, 120);
  const flatTexture = world.flat === 'projected' ? `scene3d:${safe}:flat` : null;
  const graph = buildScene3DGraph({
    scene: reliefScene(options.scene, world, aspect, options.view),
    sourceId: options.sourceId,
    width,
    height,
    quality: options.quality ?? SCENE3D_TIERS.default,
    relief: {
      flatTexture: flatTexture ?? undefined, gain: RELIEF_PROJECTOR_GAIN, sway: world.sun.sway,
      projector: ((f) => ({ width: f.W, height: f.H, distance: f.camZ }))(reliefFrame(aspect, world.lens)),
    },
  });
  const textures = [...graph.config.textures];
  if (flatTexture) textures.unshift({ id: flatTexture, ...flatSize(width, height), format: 'rgba16float' });
  return {
    textures,
    buffers: graph.config.buffers,
    passes: graph.config.passes,
    render_passes: graph.config.render_passes,
    values: graph.values.map((v) => ({ ...v, key: v.initial_b64 })),
    topology: `${world.flat}|${flatTexture ? JSON.stringify(flatSize(width, height)) : ''}|${graph.topology}`,
    flatTexture,
  };
}
