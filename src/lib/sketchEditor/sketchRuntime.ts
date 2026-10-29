/**
 * How a sketch is doing where it actually runs.
 *
 * Each layer and clip plays its sketch in an iframe of its own
 * (src/lib/renderer/js-animation.ts), which keeps the errors the page throws
 * and traces them to the file and line the author wrote. The editor asks
 * about the exact page it last sent to the layer, so errors from a previous
 * version never show against the current one.
 */
import { getJSAnimationContext } from '../renderer/js-animation';
import type { SketchError } from './sketchErrors';

export type SketchRunStatus =
  /** The current text is running. */
  | 'running'
  /** The layer has not picked up the current text yet. */
  | 'starting'
  /** Nothing runs it: the layer is hidden, off the output or not playing. */
  | 'stopped';

export interface SketchRun {
  status: SketchRunStatus;
  errors: SketchError[];
}

/** The state of the page `htmlCode` running as the layer source `sourceId`. */
export function readSketchRun(sourceId: string, htmlCode: string): SketchRun {
  const context = getJSAnimationContext(sourceId);
  if (!context) return { status: 'stopped', errors: [] };
  if (!context.runs(htmlCode)) return { status: 'starting', errors: [] };
  return { status: 'running', errors: context.readErrors() };
}
