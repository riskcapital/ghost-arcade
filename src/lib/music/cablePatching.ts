/**
 * Dragging a patch cable. A drag starts on an output jack (or picks up the
 * cable plugged into an input) and ends over an input jack, which the cable
 * layer finds under the pointer.
 */

import { writable } from 'svelte/store';
import type { Cable } from './studioSets';

export interface CableDrag {
  from: string;
  x: number;
  y: number;
  /** A cable picked up off an input: dropped on another input it moves there (settings and all), anywhere else it is unplugged. */
  carry?: Cable;
}

export const cableDrag = writable<CableDrag | null>(null);

/** The cables just unplugged, so the next "Undo" can put them back. */
export const lastUnplugged = writable<{ cables: Cable[]; at: number } | null>(null);
