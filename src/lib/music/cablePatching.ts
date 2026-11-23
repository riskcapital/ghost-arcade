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

const EDGE = 8;

/**
 * Where the patch bay opens, against the window: centred over the output
 * (`host`), 34px below its top, at most 620px wide and never past an edge.
 * Without a host it opens at the top of the window.
 */
export function bayPlacement(host: { left: number; top: number; width: number } | null, view: { width: number; height: number }): { left: number; top: number; width: number; maxHeight: number } {
  const width = Math.max(160, Math.min(620, (host ? host.width : view.width) - 24, view.width - EDGE * 2));
  const centre = host ? host.left + host.width / 2 : view.width / 2;
  const left = Math.max(EDGE, Math.min(centre - width / 2, view.width - width - EDGE));
  // Keep room for a useful list: near the bottom of the window it moves up.
  const room = Math.min(200, view.height - EDGE * 2);
  const top = Math.max(EDGE, Math.min(host ? host.top + 34 : EDGE, view.height - EDGE - room));
  const maxHeight = Math.max(room, Math.min(560, view.height * 0.7, view.height - top - EDGE));
  return { left, top, width, maxHeight };
}

/**
 * A popover's corner at the pointer, moved so its whole `size` stays inside
 * the window (8px from every edge).
 */
export function keepInWindow(at: { x: number; y: number }, size: { width: number; height: number }, view: { width: number; height: number }): { x: number; y: number } {
  return {
    x: Math.max(EDGE, Math.min(at.x, view.width - size.width - EDGE)),
    y: Math.max(EDGE, Math.min(at.y, view.height - size.height - EDGE)),
  };
}
