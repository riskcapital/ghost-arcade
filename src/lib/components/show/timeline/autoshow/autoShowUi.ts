/** The ✦ Auto show dialog is open (the Song row's and the Sections label's buttons open it). */
import { writable } from 'svelte/store';

export const autoShowOpen = writable(false);

export interface DockRect { left: number; top: number; right: number; bottom: number }

/**
 * Where the "Playing your show" card docks once the show is built: over the
 * Timeline's grid, clear of the side column (Inspector / Perform) on its
 * right and of the status bar (frame rate, version) under it. Offsets from
 * the window's right and bottom edges, in CSS pixels.
 */
export function autoShowDockInset(viewport: { width: number; height: number }, side: DockRect | null, statusbar: DockRect | null, gap = 16): { right: number; bottom: number } {
  const right = side && side.left > 0 && side.left < viewport.width ? viewport.width - side.left + gap : gap;
  const bottom = statusbar && statusbar.top > 0 && statusbar.top < viewport.height ? viewport.height - statusbar.top + gap : gap;
  return { right: Math.round(right), bottom: Math.round(bottom) };
}
