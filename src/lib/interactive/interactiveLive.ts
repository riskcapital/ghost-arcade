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
/** Pointer touches straight from an open editor, every animation frame. */
const pointers = new Map<string, { inputs: Interaction[]; at: number }>();
/** A pointer older than this is from an editor that has closed or stalled. */
const POINTER_FRESH_MS = 250;

export function setLivePointer(layerId: string, inputs: Interaction[], now = performance.now()): void {
  pointers.set(layerId, { inputs, at: now });
}

/** The editor's pointer for this layer, while it is fresh. */
export function livePointer(layerId: string, now = performance.now()): Interaction[] | undefined {
  const p = pointers.get(layerId);
  if (!p) return undefined;
  if (now - p.at > POINTER_FRESH_MS) {
    pointers.delete(layerId);
    return undefined;
  }
  return p.inputs;
}

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
  for (const id of pointers.keys()) if (!keep.has(id)) pointers.delete(id);
}
