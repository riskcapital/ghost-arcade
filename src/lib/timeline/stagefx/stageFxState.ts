/**
 * The Timeline's Screen FX / Effects rows as last published (see
 * stageFxRuntime.ts). Kept free of store imports so the renderer can read
 * it without pulling the Timeline in.
 */
import { writable } from 'svelte/store';
import type { Effect } from '../../types';
import type { ScreenFxOut } from './stageFxEval';

export interface TimelineStageFxState {
  time: number;
  /** Piece id → output, or null when the project's own Screen FX run. */
  screenFx: ReadonlyMap<string, ScreenFxOut> | null;
  effects: readonly Effect[];
  screenFxBlocks: readonly { clipId: string; weight: number }[];
}

/** Changes whenever the published values change (Canvas resyncs on it). */
export const timelineStageFxFrame = writable<TimelineStageFxState | null>(null);
let current: TimelineStageFxState | null = null;

/** The Timeline's Screen FX by piece, or null (the project's own run). */
export function timelineScreenFx(): ReadonlyMap<string, ScreenFxOut> | null {
  return current?.screenFx ?? null;
}

/** A scene layer's Screen FX output (copies of a piece follow the piece). */
export function timelineScreenFxFor(layerId: string): ScreenFxOut | undefined {
  const map = current?.screenFx;
  if (!map) return undefined;
  return map.get(layerId) ?? map.get(scenePieceId(layerId) ?? '');
}

/** The Effects row's composition effects under the playhead (copies). */
export function timelineCompositionEffects(): readonly Effect[] {
  return current?.effects ?? EMPTY;
}
const EMPTY: readonly Effect[] = [];

function q(v: number): number {
  return Math.round(v * 2048);
}
function sameState(a: TimelineStageFxState | null, b: TimelineStageFxState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (!!a.screenFx !== !!b.screenFx) return false;
  if (a.screenFx && b.screenFx) {
    if (a.screenFx.size !== b.screenFx.size) return false;
    for (const [id, x] of a.screenFx) {
      const y = b.screenFx.get(id);
      if (!y || q(x.brightness) !== q(y.brightness) || !!x.tint !== !!y.tint) return false;
      if (x.tint && y.tint && (q(x.tint[0]) !== q(y.tint[0]) || q(x.tint[1]) !== q(y.tint[1]) || q(x.tint[2]) !== q(y.tint[2]))) return false;
    }
  }
  if (a.effects.length !== b.effects.length) return false;
  for (let i = 0; i < a.effects.length; i++) {
    const x = a.effects[i];
    const y = b.effects[i];
    if (x.id !== y.id || x.type !== y.type || q(x.opacity ?? 1) !== q(y.opacity ?? 1) || JSON.stringify(x.params) !== JSON.stringify(y.params)) return false;
  }
  return true;
}

/** Publish a frame (or null). Returns true when something changed. */
export function publishStageFx(state: TimelineStageFxState | null): boolean {
  const next = state && (state.screenFx || state.effects.length) ? state : null;
  if (sameState(current, next)) {
    current = next;
    return false;
  }
  current = next;
  timelineStageFxFrame.set(next);
  return true;
}

export function resetStageFxState(): void {
  current = null;
  timelineStageFxFrame.set(null);
}

/** The piece a Timeline scene copy stands for (sub-row, where copy, off-stage or dissolve copy). */
export function scenePieceId(id: string): string | null {
  for (const prefix of ['showsub::', 'showwhere::']) {
    if (id.startsWith(prefix)) {
      const rest = id.slice(prefix.length);
      const cut = rest.lastIndexOf('::');
      return cut > 0 ? rest.slice(0, cut) : null;
    }
  }
  for (const prefix of ['showtrack::', 'showfade::']) if (id.startsWith(prefix)) return id.slice(prefix.length);
  return null;
}
