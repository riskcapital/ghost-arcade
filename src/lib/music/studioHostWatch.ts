/**
 * The studio plays for the clips and layers that host it. When the last one
 * goes (its cell cleared with X, its deck row or the whole deck stopped, its
 * mapping layer removed), the music stops with it.
 */

import { isStudioSource } from './studioPlugin';

interface ClipLike {
  type?: string;
  effectSource?: unknown;
}
interface LayerLike {
  source?: { effectSource?: unknown } | null;
}
export interface HostState {
  layerStates: ReadonlyArray<{ activeClip: ClipLike | null }>;
  bankBLayerStates?: ReadonlyArray<{ activeClip: ClipLike | null }>;
}

/** Whether a studio clip plays on either deck, or a mapping layer is a studio. */
export function studioHosted(vj: HostState, layers: readonly LayerLike[]): boolean {
  const playing = (states: HostState['layerStates'] | undefined) =>
    (states ?? []).some((s) => s.activeClip?.type === 'effect' && isStudioSource(s.activeClip.effectSource));
  return playing(vj.layerStates) || playing(vj.bankBLayerStates) || layers.some((l) => isStudioSource(l.source?.effectSource));
}

/** Calls `onGone` each time hosting goes from somewhere to nowhere. */
export function hostWatch(onGone: () => void): (hosted: boolean) => void {
  let was = false;
  return (hosted) => {
    if (was && !hosted) onGone();
    was = hosted;
  };
}
