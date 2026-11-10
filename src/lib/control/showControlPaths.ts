/**
 * `show:` control paths (MIDI, OSC, keys, cue control paths) as actions.
 * Shared by the router, which dispatches them, and the path validator.
 * Pure: no stores.
 */

export type ShowTakeoverSourceSpec =
  | { kind: 'vjRow'; deck: 'A' | 'B'; row: number }
  | { kind: 'vjMix' }
  | { kind: 'vjGroup'; index: number }
  | { kind: 'black' };
export type ShowControlAction =
  | 'go' | 'back' | 'stop' | 'reset' | { cue: number }
  | { live: { track: number; source: ShowTakeoverSourceSpec; hold: boolean } }
  | { release: number | null }
  | { overlay: true }
  | { releaseMode: string }
  | { underneath: 'run' | 'pause' };

const SHOW_RELEASE_MODES = ['instant', 'fade', 'beat', 'bar', 'phrase', 'marker'];
const positiveIndex = (part: string | undefined): number | null => (part && /^\d+$/.test(part) && Number(part) >= 1 ? Number(part) - 1 : null);

/**
 * A `show:` path (already split and lowercased) as a show-control action,
 * or null. Track, row and group numbers count from 1.
 */
export function parseShowControlPath(parts: string[]): ShowControlAction | null {
  const action = parts[1];
  if ((action === 'go' || action === 'back' || action === 'stop' || action === 'reset') && parts.length === 2) return action;
  if (action === 'cue' && /^\d+$/.test(parts[2] ?? '') && parts.length === 3) return { cue: Number(parts[2]) };
  if (action === 'live') {
    const track = positiveIndex(parts[2]);
    if (track === null) return null;
    let rest = parts.slice(3);
    const hold = rest[rest.length - 1] === 'hold';
    if (hold) rest = rest.slice(0, -1);
    let source: ShowTakeoverSourceSpec | null = null;
    if ((rest[0] === 'vja' || rest[0] === 'vjb') && rest.length === 2) {
      const row = positiveIndex(rest[1]);
      if (row !== null) source = { kind: 'vjRow', deck: rest[0] === 'vjb' ? 'B' : 'A', row };
    } else if (rest[0] === 'mix' && rest.length === 1) source = { kind: 'vjMix' };
    else if (rest[0] === 'black' && rest.length === 1) source = { kind: 'black' };
    else if (rest[0] === 'group' && rest.length === 2) {
      const index = positiveIndex(rest[1]);
      if (index !== null) source = { kind: 'vjGroup', index };
    }
    return source ? { live: { track, source, hold } } : null;
  }
  if (action === 'release') {
    if (parts.length === 2) return { release: null };
    const track = positiveIndex(parts[2]);
    return track !== null && parts.length === 3 ? { release: track } : null;
  }
  if (action === 'overlay' && parts.length === 2) return { overlay: true };
  if (action === 'releasemode' && parts.length === 3 && SHOW_RELEASE_MODES.includes(parts[2])) return { releaseMode: parts[2] };
  if (action === 'underneath' && parts.length === 3 && (parts[2] === 'run' || parts[2] === 'pause')) return { underneath: parts[2] };
  return null;
}
