/**
 * Where line values meet the renderer. The Timeline evaluates its lines once
 * per frame and publishes the result here; nothing writes the project.
 *
 *   - mapping layers: nativeRendererSync applies `lineLayerOverrides(id)`
 *     with the same override keys as keyframes and show lanes, after them
 *     (a line wins on the same key)
 *   - Stage FX: nativeRendererSync's composite chain reads `lineStageOverrides()`
 *   - LEDs: the WLED sender reads `lineLedOverrides()`
 *
 * Canvas subscribes to `controlLineFrame` to push a new scene when values
 * change. Only a frame whose values differ (at float precision) from the
 * last published one is published.
 */
import { writable, get } from 'svelte/store';
import { createLineEvaluator, frameIsEmpty, sameFrameValues, snapshotFrame, type LineContext, type LineFrame, type OverrideRecord } from './lineEvaluator';
import type { ControlLine } from './lineModel';

export const controlLineFrame = writable<LineFrame | null>(null);

let current: LineFrame | null = null;

export function publishLineFrame(frame: LineFrame | null): boolean {
  const next = frame ? snapshotFrame(frame) : null;
  const value = frameIsEmpty(next) ? null : next;
  if (sameFrameValues(current, value)) return false;
  current = value;
  controlLineFrame.set(value);
  return true;
}

export function clearLineFrame(): void {
  publishLineFrame(null);
}

export function currentLineFrame(): LineFrame | null {
  return current;
}

export function lineLayerOverrides(layerId: string): OverrideRecord | undefined {
  return current?.layers.get(layerId);
}

export function lineStageOverrides(): OverrideRecord | null {
  return current?.stage ?? null;
}

export function lineLedOverrides(): OverrideRecord | null {
  return current?.leds ?? null;
}

/**
 * What the Timeline calls every frame (and on every seek while paused):
 * evaluate its lines at show time and publish. Returns the published frame
 * (a copy) or null.
 */
export function createLineDriver(opts: {
  lines: () => readonly ControlLine[];
  context: () => LineContext;
}) {
  const evaluator = createLineEvaluator();
  let lastTime = Number.NaN;
  return {
    tick(showTime: number): LineFrame | null {
      // A jump (seek, loop) resets cursors and live smoothing.
      if (!(showTime >= lastTime && showTime - lastTime < 0.5)) evaluator.reset();
      lastTime = showTime;
      const frame = evaluator.evaluate(opts.lines(), showTime, opts.context());
      publishLineFrame(frame);
      return get(controlLineFrame);
    },
    stop(): void {
      lastTime = Number.NaN;
      clearLineFrame();
    },
  };
}
