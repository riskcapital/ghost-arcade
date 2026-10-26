import { writable } from 'svelte/store';
import { selectedLayerId } from './layers';
import type { MappingPointRef } from '../utils/mappingNudge';

/**
 * The mapping point the arrow keys move: the handle pressed last on the
 * selected layer (see utils/mappingNudge.ts). Every handle overlay sets it
 * on press and reads it for its "selected" look; the canvas's one arrow-key
 * handler moves it. Escape, a click on empty canvas, or selecting another
 * layer lets go of it.
 */
export const mappingPointSelection = writable<MappingPointRef | null>(null);

export function selectMappingPoint(ref: MappingPointRef | null): void {
  mappingPointSelection.set(ref);
}

export function clearMappingPointSelection(): void {
  mappingPointSelection.set(null);
}

let lastLayerId: string | null | undefined;
selectedLayerId.subscribe((id) => {
  if (lastLayerId !== undefined && id !== lastLayerId) mappingPointSelection.set(null);
  lastLayerId = id;
});
