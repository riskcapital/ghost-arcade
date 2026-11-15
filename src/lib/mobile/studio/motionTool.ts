/**
 * Camera motion as a touch tool. The motion the camera sees becomes touch-like
 * input; by default it attracts (as phone app 1.2 did), and the user may give
 * it any tool a touch can use now: Attract, Repel or Vortex, and with the 3D
 * world on a desktop that acts on them, Throw, Push, Pour or Ignite.
 */
import type { Interaction } from './interactive';
import type { TouchTool } from '../../components/studio/interactiveEditorTypes';

export const BASIC_TOOLS: readonly TouchTool[] = ['attract', 'repel', 'vortex'];

/** The tools camera motion may drive: the desktop's world tools only while the world is on. */
export function motionToolsFor(worldOn: boolean, desktopTools: readonly TouchTool[] | undefined): TouchTool[] {
  return [...(worldOn && desktopTools?.length ? desktopTools : BASIC_TOOLS)];
}

/** Motion input acting as `tool`. Attract is sent as before (no mode), so an older desktop sees exactly what 1.2 sent. */
export function withTool(motion: Interaction[], tool: TouchTool): Interaction[] {
  return tool === 'attract' ? motion : motion.map((m) => ({ ...m, mode: tool }));
}
