import { writable } from 'svelte/store';

export interface EditorCanvasGeometry {
  layoutX: number;
  layoutY: number;
  layoutWidth: number;
  layoutHeight: number;
  clientX: number;
  clientY: number;
  clientWidth: number;
  clientHeight: number;
  revision: number;
}

/**
 * One geometry contract for the editor canvas.
 *
 * Canvas.svelte is the sole publisher. DOM overlays consume the layout-space
 * rectangle while the native presenter consumes the client-space rectangle
 * from the same revision.
 */
export const editorCanvasGeometry = writable<EditorCanvasGeometry | null>(null);
