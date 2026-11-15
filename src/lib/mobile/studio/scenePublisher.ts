import type { InteractiveScene, Interaction } from './interactive';

/** How often a live touch goes out while it is held (ms). */
export const SCENE_PUBLISH_MS = 50;

export type ScenePublish = (scene: InteractiveScene, inputs: Interaction[], active: boolean, paused: boolean) => void;

/**
 * The Interactive Studio's scene, handed to its host only when something in
 * it changed: the scene (edits replace it), output on or off, paused, or the
 * live input. While a touch or motion is live it still goes out every
 * SCENE_PUBLISH_MS, as a stream (a paired desktop drops a touch it stops
 * hearing about); idle, nothing is sent.
 */
export function createScenePublisher(send: ScenePublish) {
  let last: { scene: InteractiveScene; inputs: Interaction[]; active: boolean; paused: boolean } | null = null;
  let lastAt = -Infinity;
  const same = (a: Interaction[], b: Interaction[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const publish = (now: number, scene: InteractiveScene, inputs: Interaction[], active: boolean, paused: boolean) => {
    last = { scene, inputs, active, paused };
    lastAt = now;
    send(scene, inputs, active, paused);
  };
  return {
    /** Every animation frame: sends when something changed, at most every SCENE_PUBLISH_MS. */
    tick(now: number, scene: InteractiveScene, inputs: Interaction[], active: boolean, paused: boolean): boolean {
      if (now - lastAt <= SCENE_PUBLISH_MS) return false;
      const changed = !last || last.scene !== scene || last.active !== active || last.paused !== paused || !same(last.inputs, inputs);
      if (!changed && !inputs.length) return false;
      publish(now, scene, inputs, active, paused);
      return true;
    },
    /** Send now, whatever changed (output toggled, the editor flushed). */
    now(now: number, scene: InteractiveScene, inputs: Interaction[], active: boolean, paused: boolean): void {
      publish(now, scene, inputs, active, paused);
    },
  };
}
