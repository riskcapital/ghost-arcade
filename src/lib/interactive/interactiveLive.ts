/**
 * Live input of interactive layers, per layer id: the pointer touches plus
 * the tracked hands and body, as the renderer sync last combined them. The
 * layer's graph params read from here, so the points reach the core through
 * the same value updates as everything else, at frame rate.
 *
 * Live state only: never saved, never an undo step.
 */
import type { Interaction, Point, ZoneWorldAction } from '../mobile/studio/interactive';
import type { WorldInputState } from './worldInput';

const live = new Map<string, Interaction[]>();
/** Pointer touches straight from an open editor, every animation frame. */
const pointers = new Map<string, { inputs: Interaction[]; at: number }>();
/** A pointer older than this is from an editor that has closed or stalled. */
const POINTER_FRESH_MS = 250;
/** The Studio's Orbit view: degrees the 3D world's camera has turned. */
export type WorldView = { yaw: number; pitch: number };
const views = new Map<string, WorldView>();
/** What the touches do to the 3D world's balls this frame (worldInput.ts). */
const worldInputs = new Map<string, WorldInputState>();

export function setLiveWorldInput(layerId: string, state: WorldInputState | null): void {
  if (state && (state.pointers.length || state.throws.length)) worldInputs.set(layerId, state);
  else worldInputs.delete(layerId);
}

export function liveWorldInput(layerId: string): WorldInputState | undefined {
  return worldInputs.get(layerId);
}

/** World actions asked for outside the frame loop (a zone's Test), until the next frame takes them. */
const worldActions = new Map<string, { what: ZoneWorldAction; point: Point }[]>();

export function queueWorldAction(layerId: string, what: ZoneWorldAction, point: Point): void {
  const list = worldActions.get(layerId) ?? [];
  if (list.length < 16) list.push({ what, point });
  worldActions.set(layerId, list);
}

export function takeWorldActions(layerId: string): { what: ZoneWorldAction; point: Point }[] {
  const list = worldActions.get(layerId) ?? [];
  worldActions.delete(layerId);
  return list;
}

/** Turn the layer's 3D world camera, or back to face-on with `null`. */
export function setLiveWorldView(layerId: string, view: WorldView | null): void {
  if (view && (view.yaw || view.pitch)) views.set(layerId, view);
  else views.delete(layerId);
}

export function liveWorldView(layerId: string): WorldView | undefined {
  return views.get(layerId);
}

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
  for (const id of views.keys()) if (!keep.has(id)) views.delete(id);
  for (const id of worldInputs.keys()) if (!keep.has(id)) worldInputs.delete(id);
  for (const id of worldActions.keys()) if (!keep.has(id)) worldActions.delete(id);
}
