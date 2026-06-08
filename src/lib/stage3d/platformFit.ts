// Auto-size the stage platform to fit whichever LED screens are in
// the scene. The preset / user supplies the platform "style" (colors,
// height, underglow), and we derive width / depth / centre to enclose
// the current screen footprint with sensible padding.
//
// Recomputed reactively from `Stage3DScene.nodes` so every Random,
// every Add Screen, every node move updates the deck under the rig.

import type { Stage3DScene, StageLedScreenNode, StagePlatform } from './types';

const DEFAULT_PLATFORM: StagePlatform = {
  enabled: true,
  position: [0, 0, 0],
  width: 12,
  height: 1.0,
  depth: 6,
  topColor: '#0a0a0e',
  skirtColor: '#15141c',
  underglow: { enabled: true, color: '#BB86FC', intensity: 1.6 },
  bevelSize: 0.15,
};

/** Padding (meters) added on every side of the LED-screen footprint.
 *  Real stages extend a few meters past the outermost screen — the
 *  performer needs floor to walk on. */
const HORIZONTAL_PAD = 2.4;
const DEPTH_PAD = 2.0;

/** Compute a fitted platform that encloses the scene's LED screens.
 *  Returns null when there's nothing to fit (empty scene, or platform
 *  explicitly disabled in the source scene). */
export function fitPlatform(scene: Stage3DScene): StagePlatform | null {
  const baseStyle = scene.platform ?? DEFAULT_PLATFORM;
  if (baseStyle.enabled === false) return null;

  const led = scene.nodes.filter((n): n is StageLedScreenNode => n.type === 'led-screen' && n.visible);
  if (led.length === 0) {
    // No screens yet — keep the author-supplied platform as-is so the
    // empty scene doesn't lose its deck. Users get a sensible default
    // floor to drop screens onto.
    return baseStyle;
  }

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const node of led) {
    // Conservative AABB: treat screen as `width` along its local X and
    // some depth along Z, then expand by yaw to account for screens
    // angled toward the audience. Skips precise corner math because the
    // padding swallows the small underestimate either way.
    const w = node.width;
    const yaw = node.rotation[1];
    const cos = Math.abs(Math.cos(yaw));
    const sin = Math.abs(Math.sin(yaw));
    // Effective screen footprint in scene-space.
    const fx = (w * cos + 0.5 * sin) / 2;
    const fz = (w * sin + 0.5 * cos) / 2;
    minX = Math.min(minX, node.position[0] - fx);
    maxX = Math.max(maxX, node.position[0] + fx);
    minZ = Math.min(minZ, node.position[2] - fz);
    maxZ = Math.max(maxZ, node.position[2] + fz);
  }

  const width = Math.max(4, (maxX - minX) + HORIZONTAL_PAD * 2);
  const depth = Math.max(2.5, (maxZ - minZ) + DEPTH_PAD * 2);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  return {
    ...baseStyle,
    position: [centerX, baseStyle.position[1] ?? 0, centerZ],
    width,
    depth,
  };
}
