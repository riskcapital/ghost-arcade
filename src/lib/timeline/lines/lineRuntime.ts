/**
 * Where line values meet the renderer. The Timeline evaluates its lines once
 * per frame and publishes the result here; nothing writes the project.
 *
 *   - mapping layers: nativeRendererSync applies `lineLayerOverrides(id)`
 *     with the same override keys as keyframes and show lanes, after them
 *     (a line wins on the same key)
 *   - Stage FX: nativeRendererSync's composite chain reads `lineStageOverrides()`
 *   - LEDs: the WLED sender reads `lineLedOverrides()`
 *   - sound rows: the sound engine reads `frame.sounds`
 *   - scopes registered at runtime (lineExtensions.ts): their `apply` is
 *     called when their values change; `lineScopeValues(scope)` reads them
 *
 * Canvas subscribes to `controlLineFrame` to push a new scene when values
 * change. Only a frame whose values differ (at float precision) from the
 * last published one is published.
 */
import { writable, get } from 'svelte/store';
import { createLineEvaluator, frameIsEmpty, frameScopeValues, sameFrameValues, snapshotFrame, type LineContext, type LineFrame, type OverrideRecord } from './lineEvaluator';
import type { ControlLine } from './lineModel';
import { onLineExtensionsChange, paramScopes, type ParamScopeDef } from './lineExtensions';

export const controlLineFrame = writable<LineFrame | null>(null);

let current: LineFrame | null = null;

export function publishLineFrame(frame: LineFrame | null): boolean {
  const next = frame ? snapshotFrame(frame) : null;
  const value = frameIsEmpty(next) ? null : next;
  if (sameFrameValues(current, value)) return false;
  const prev = current;
  current = value;
  controlLineFrame.set(value);
  applyScopes(prev, value);
  return true;
}

function sameRecords(a: ReadonlyMap<string, OverrideRecord> | undefined, b: ReadonlyMap<string, OverrideRecord> | undefined): boolean {
  if ((a?.size ?? 0) !== (b?.size ?? 0)) return false;
  if (!a) return true;
  for (const [id, x] of a) {
    const y = b?.get(id);
    if (!y) return false;
    const kx = Object.keys(x);
    if (kx.length !== Object.keys(y).length) return false;
    for (const k of kx) {
      const p = x[k];
      const q = y[k];
      if (typeof p === 'number' && typeof q === 'number' ? Math.fround(p) !== Math.fround(q) : p !== q) return false;
    }
  }
  return true;
}

function applyScope(def: ParamScopeDef, values: ReadonlyMap<string, OverrideRecord> | null): void {
  try {
    def.apply?.(values);
  } catch (err) {
    console.warn(`[lines] scope ${def.scope}: apply failed:`, err);
  }
}

/** Registered scopes whose values changed get them (null: none now). */
function applyScopes(prev: LineFrame | null, next: LineFrame | null): void {
  for (const def of paramScopes()) {
    if (!def.apply) continue;
    const a = frameScopeValues(prev, def.scope);
    const b = frameScopeValues(next, def.scope);
    if (sameRecords(a, b)) continue;
    applyScope(def, b?.size ? b : null);
  }
}

// A scope registered while lines already drive it gets their values at once.
const appliedTo = new WeakSet<ParamScopeDef>();
onLineExtensionsChange(() => {
  for (const def of paramScopes()) {
    if (appliedTo.has(def)) continue;
    appliedTo.add(def);
    const values = frameScopeValues(current, def.scope);
    if (def.apply && values?.size) applyScope(def, values);
  }
});

/**
 * A scope's values now: by target id ('' for a scope with one target), or
 * one target's. Never written to the project; read them at show time.
 */
export function lineScopeValues(scope: string): ReadonlyMap<string, OverrideRecord> | null;
export function lineScopeValues(scope: string, id: string): OverrideRecord | null;
export function lineScopeValues(scope: string, id?: string): ReadonlyMap<string, OverrideRecord> | OverrideRecord | null {
  const byId = frameScopeValues(current, scope);
  if (id === undefined) return byId?.size ? byId : null;
  return byId?.get(id) ?? null;
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
