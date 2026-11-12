/**
 * Live input of interactive layers, per layer id: the pointer touches plus
 * the tracked hands and body, as the renderer sync last combined them. The
 * layer's graph params read from here, so the points reach the core through
 * the same value updates as everything else, at frame rate.
 *
 * Live state only: never saved, never an undo step.
 */
import type { Interaction } from '../mobile/studio/interactive';

const live = new Map<string, Interaction[]>();

export function setLiveInteractiveInputs(layerId: string, inputs: Interaction[] | null): void {
  if (inputs) live.set(layerId, inputs);
  else live.delete(layerId);
}

export function liveInteractiveInputs(layerId: string): Interaction[] | undefined {
  return live.get(layerId);
}

/** Drop layers that are gone. */
export function pruneLiveInteractiveInputs(keep: Set<string>): void {
  for (const id of live.keys()) if (!keep.has(id)) live.delete(id);
}
