/**
 * Dragging a patch cable. A drag starts on an output jack (or picks up the
 * cable plugged into an input) and ends over an input jack, which the cable
 * layer finds under the pointer.
 */

import { writable } from 'svelte/store';

export interface CableDrag {
  from: string;
  x: number;
  y: number;
}

export const cableDrag = writable<CableDrag | null>(null);
