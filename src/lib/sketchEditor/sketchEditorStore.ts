/**
 * Opening the sketch editor, and telling the media tray about saves.
 *
 * The editor opens on a layer (from the layer panel or the tray's controls
 * for the selected layer) or on a tray item. It is mounted once, by the app,
 * and edits whatever this store points at.
 */
import { writable } from 'svelte/store';
import type { JSAnimationSource, SketchFile } from '../types';

export interface SketchTrayItem {
  id: string;
  name: string;
  jsAnimation: JSAnimationSource;
}

export interface SketchEditorTarget {
  /** Edit the sketch on this layer, previewing on it. */
  layerId?: string;
  /** Edit this media tray item, previewing on every layer showing it. */
  item?: SketchTrayItem;
}

export const sketchEditorTarget = writable<SketchEditorTarget | null>(null);

export function openSketchEditor(target: SketchEditorTarget): void {
  sketchEditorTarget.set(target);
}

export function closeSketchEditor(): void {
  sketchEditorTarget.set(null);
}

/** Tray item ids of the sketches Ghost Arcade ships, which a save never overwrites. */
export const BUILT_IN_SKETCH_PREFIX = 'builtin-threejs-';

export interface SketchSaved {
  /** The tray item the sketch came from, when known. */
  itemId: string | null;
  /** Layer source ids that were saved, for finding the item when itemId is unknown. */
  sourceIds: string[];
  /** The sketch's page before the save: any tray item still holding it is the same sketch. */
  previousHtml: string;
  /** A new tray item for an edited copy of a shipped sketch. */
  newItem?: { id: string; name: string };
  /** The sketch's files as saved, for updating other copies of it. */
  files: SketchFile[];
  jsAnimation: JSAnimationSource;
}

const savedListeners = new Set<(saved: SketchSaved) => void>();

export function onSketchSaved(listener: (saved: SketchSaved) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

export function announceSketchSaved(saved: SketchSaved): void {
  for (const listener of savedListeners) listener(saved);
}

/** Whether a layer source id belongs to a tray item: `${item.id}-${layerId}-${time}`. */
export function sourceBelongsToItem(sourceId: string | undefined, itemId: string): boolean {
  return !!sourceId && (sourceId === itemId || sourceId.startsWith(`${itemId}-`));
}
