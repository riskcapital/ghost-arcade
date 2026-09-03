import { get } from 'svelte/store';
import { vjClipLauncher, predictedClipPlayheadSeconds } from '../stores/vjClipLauncher';

/**
 * Reading control paths, so OSC can send state back out.
 *
 * The router has always been one-way: a path is parsed and a value written.
 * That makes every control surface fire-and-forget — move a fader in the app
 * and the hardware never hears about it, so the two drift apart and a layout
 * cannot show anything. Clip buttons that light when their clip is live are
 * the single most visible thing this unlocks.
 *
 * This is deliberately a read-only mirror of the paths worth showing on a
 * surface, not of everything the router accepts. A value nobody can display
 * costs bandwidth on every poll and buys nothing.
 */

/** Paths whose value is a 0/1 state rather than a continuous amount. */
export type ControlPathValue = number;

function deckOf(path: string): 'A' | 'B' | null {
  if (path.startsWith('vj:')) return 'A';
  if (path.startsWith('vj-b:')) return 'B';
  return null;
}

/**
 * Current value of a control path, or null when the path is not one we
 * mirror (or addresses something that is not there right now).
 *
 * Null means "send nothing" rather than "send zero" — a layer that does not
 * exist and a layer at zero opacity should not look the same on a surface.
 */
export function readControlPath(path: string): ControlPathValue | null {
  const deck = deckOf(path);
  if (!deck) return null;

  const parts = path.split(':');
  const state = get(vjClipLauncher) as any;
  const layerStates = deck === 'B' ? state.bankBLayerStates : state.layerStates;
  const grid = deck === 'B' ? state.bankBClipGrid : state.clipGrid;
  const tail = parts[1];

  // Deck-wide values.
  if (tail === 'master' && parts[2] === 'opacity') return Number(state.masterOpacity ?? 1);
  if (tail === 'crossfader' && parts[2] === 'value') return Number(state.crossfaderValue ?? 0.5);
  if (tail === 'column') {
    // A column reads as "on" when any layer is currently firing it, which is
    // what makes a scene button light after a column launch.
    const column = Number(parts[2]);
    if (!Number.isInteger(column)) return null;
    return layerStates?.some((ls: any) => ls?.activeColumn === column) ? 1 : 0;
  }

  const layerIndex = Number(tail);
  if (!Number.isInteger(layerIndex)) return null;
  const layerState = layerStates?.[layerIndex];
  if (!layerState) return null;

  switch (parts[2]) {
    case 'opacity':
      return Number(layerState.opacity ?? 1);
    case 'solo':
      return layerState.solo ? 1 : 0;
    case 'mute':
      return layerState.mute ? 1 : 0;
    case 'trigger': {
      // Lights the one cell that is live on this layer.
      const column = Number(parts[3]);
      if (!Number.isInteger(column)) return null;
      const clip = grid?.[layerIndex]?.[column];
      if (!clip) return 0;
      return layerState.activeClip?.id === clip.id ? 1 : 0;
    }
    case 'video': {
      const clip = layerState.activeClip;
      if (!clip || clip.type !== 'video') return null;
      if (parts[3] === 'play') return clip.isPlaying === false ? 0 : 1;
      if (parts[3] === 'position') {
        // Normalized across the trim range, matching what the same path
        // accepts inbound — a fader bound to it must read back where it wrote.
        const duration = Number(clip.durationSeconds ?? clip.videoElement?.duration);
        if (!Number.isFinite(duration) || duration <= 0) return null;
        const trimStart = Math.max(0, Math.min(1, Number(clip.trimStart ?? 0)));
        const trimEnd = Math.max(trimStart, Math.min(1, Number(clip.trimEnd ?? 1)));
        const span = Math.max(1e-6, trimEnd - trimStart);
        const fraction = predictedClipPlayheadSeconds(clip) / duration;
        return Math.max(0, Math.min(1, (fraction - trimStart) / span));
      }
      return null;
    }
    default:
      return null;
  }
}

/** True when this path is one readControlPath can mirror. */
export function isReadableControlPath(path: string): boolean {
  return readControlPath(path) !== null;
}
