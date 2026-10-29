/**
 * Bringing a sketch in, from any of its ways in: which files it keeps, where
 * it came from, and what the wrapper makes of it.
 */
import type { JSAnimationOrigin, JSAnimationSketch, JSAnimationSource } from '../types';
import { keptFiles, storedFiles, type P5Sketch } from '../p5sketch/files';
import { sketchP5Version, sketchSource, wrapSketch, type P5CanvasMode, type WrappedSketch } from '../p5sketch/wrapSketch';

export interface ImportedSketch {
  name: string;
  /** The media source: the sketch's files as written, and the page wrapped from them. */
  source: JSAnimationSource;
  /** What the wrapper made of it: whether it can run, its canvas, its controls. */
  wrapped: WrappedSketch;
  /** What was left out on the way in, then the wrapper's notes. */
  notes: string[];
}

export interface ImportOptions {
  /** The canvas the person chose; unset follows the wrapper's suggestion. */
  canvas?: P5CanvasMode;
  now?: number;
}

export function importSketch(sketch: P5Sketch, options: ImportOptions = {}): ImportedSketch {
  const { files, notes: importNotes } = keptFiles(sketch.files);
  const p5Version = sketchP5Version(sketch.files);
  const origin: JSAnimationOrigin = {
    kind: sketch.source === 'files' ? 'p5-files' : 'p5-editor',
    sketchName: sketch.name,
    importedFrom: sketch.source,
    importedAt: options.now ?? Date.now(),
    ...(sketch.author ? { author: sketch.author } : {}),
    ...(sketch.url ? { url: sketch.url } : {}),
    ...(sketch.id ? { sketchId: sketch.id } : {}),
    ...(p5Version ? { p5Version } : {}),
  };
  const canvas = options.canvas ? { canvas: options.canvas } : {};
  // Read with the import's own detail (why a file stays online) for the review.
  const wrapped = wrapSketch({ files, ...canvas }, { origin });
  const kept: JSAnimationSketch = { files: storedFiles(files), ...canvas };
  return {
    name: sketch.name,
    source: sketchSource(kept, { origin }),
    wrapped,
    notes: [...importNotes, ...wrapped.notes],
  };
}
