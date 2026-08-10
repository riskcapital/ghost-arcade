import { writable } from 'svelte/store';

/**
 * Pointer state over the output canvas, for point-cloud mouse
 * interaction in native mode.
 *
 * Coordinates are normalized to the output canvas content rect
 * (0..1, y-down, matching layer/canvas space). `active` is true while
 * the pointer is inside the canvas area; `down` while a button is held.
 *
 * Written by Canvas.svelte's pointer listeners (which know the live
 * canvas geometry); read by the native sync when packing splat uniforms.
 */
export interface SplatPointerState {
  x: number;
  y: number;
  active: boolean;
  down: boolean;
}

export const splatPointer = writable<SplatPointerState>({
  x: 0.5,
  y: 0.5,
  active: false,
  down: false,
});
