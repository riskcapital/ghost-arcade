/**
 * Shared bits of the takeover UI in the show tray: the source menu's
 * choices, media dropped on a LIVE button, release-mode labels, and the
 * focused-track helpers the Shift+L / R keys and the pads use.
 */
import { get, writable } from 'svelte/store';
import type { ShowClipMedia, ShowLayerTrack } from '../../../types';
import type { VJClipLauncherState } from '../../../stores/vjClipLauncher';
import { showTimeline } from '../../../stores/showTimeline';
import { liveTakeover, type TakeoverReleaseMode, type TakeoverSource } from '../../../show/takeover/liveTakeover';
import { takeOverTrack } from '../../../show/takeover/takeoverRuntime';
import { clipMediaFromFile, clipMediaFromTrayPayload, isTrackMediaFile, MEDIA_SOURCE_DRAG_TYPE } from './clipMedia';
import { focusedTrackId } from './trackLayout';

/** The Live pads strip is folded open (session only). */
export const takeoverPadsOpen = writable(false);

export const RELEASE_MODE_LABELS: Record<TakeoverReleaseMode, string> = {
  instant: 'Cut',
  fade: 'Fade',
  beat: 'Next beat',
  bar: 'Next bar',
  phrase: 'Next phrase',
  marker: 'Next marker',
};

export interface TakeoverSourceOption {
  key: string;
  /** "A2", "Mix", the group name, "Black". */
  label: string;
  /** What is playing there now, if anything. */
  detail: string;
  source: TakeoverSource;
}

export interface TakeoverSourceGroups {
  rows: TakeoverSourceOption[];
  groups: TakeoverSourceOption[];
  other: TakeoverSourceOption[];
}

/** The choices of a LIVE menu: each deck's rows (B with the crossfader on),
 *  the deck mix, VJ groups and black. Pure. */
export function takeoverSourceOptions(vj: Pick<VJClipLauncherState, 'layerStates' | 'bankBLayerStates' | 'crossfaderEnabled' | 'groups'>): TakeoverSourceGroups {
  const rows: TakeoverSourceOption[] = [];
  const decks: Array<['A' | 'B', VJClipLauncherState['layerStates']]> = [['A', vj.layerStates ?? []]];
  if (vj.crossfaderEnabled) decks.push(['B', vj.bankBLayerStates ?? []]);
  for (const [deck, states] of decks) {
    states.forEach((row, index) => {
      const clip = row.activeClip && row.activeClip.type !== 'preset' ? row.activeClip : null;
      rows.push({
        key: `vj${deck}:${index}`,
        label: `${deck}${index + 1}`,
        detail: clip?.name ?? '',
        source: { kind: 'vjRow', deck, row: index },
      });
    });
  }
  const groups = (vj.groups ?? []).map((g) => ({
    key: `group:${g.id}`,
    label: g.name,
    detail: `${g.first + 1}–${g.last + 1}`,
    source: { kind: 'vjGroup', groupId: g.id, name: g.name } as TakeoverSource,
  }));
  return {
    rows,
    groups,
    other: [
      { key: 'mix', label: 'Mix', detail: '', source: { kind: 'vjMix' } },
      { key: 'black', label: 'Black', detail: '', source: { kind: 'black' } },
    ],
  };
}

/** A drag that could carry media for a takeover (types only: dragover). */
export function mayCarryTakeoverMedia(dt: DataTransfer | null): boolean {
  const types = Array.from(dt?.types ?? []);
  return types.includes(MEDIA_SOURCE_DRAG_TYPE) || types.includes('Files');
}

/** Media dropped on a LIVE button: a media-tray card or the first media file. */
export async function takeoverMediaFromDrop(dt: DataTransfer): Promise<ShowClipMedia | null> {
  const raw = dt.getData(MEDIA_SOURCE_DRAG_TYPE);
  if (raw) {
    try {
      return clipMediaFromTrayPayload(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  const file = Array.from(dt.files ?? []).find((f) => isTrackMediaFile(f));
  return file ? clipMediaFromFile(file) : null;
}

/** The track Shift+L and the pads act on: the focused one, else the
 *  selected one, else the only one. */
export function targetTrack(): ShowLayerTrack | null {
  const s = get(showTimeline);
  const focused = get(focusedTrackId);
  const selectedId = s.selection?.kind === 'track' ? s.selection.id : null;
  return s.layerTracks.find((t) => t.id === focused)
    ?? s.layerTracks.find((t) => t.id === selectedId)
    ?? (s.layerTracks.length === 1 ? s.layerTracks[0] : null);
}

/** Shift+L: take the target track over with the last source, or hand it back. */
export function toggleTakeoverOnTarget(): boolean {
  const track = targetTrack();
  if (!track) return false;
  if (liveTakeover.isTakenOver(track.layerId)) {
    liveTakeover.release(track.layerId);
    return true;
  }
  return takeOverTrack(track, liveTakeover.state.lastSource);
}

/** Seconds until the soonest pending release, or null. */
export function pendingReleaseSeconds(
  surfaces: ReadonlyArray<{ phase: string; releaseAtShowTime?: number; releaseAtWallMs?: number }>,
  showTime: number,
  nowMs: number,
): number | null {
  let best: number | null = null;
  for (const s of surfaces) {
    if (s.phase !== 'pendingRelease') continue;
    const left = s.releaseAtShowTime !== undefined ? s.releaseAtShowTime - showTime
      : s.releaseAtWallMs !== undefined ? (s.releaseAtWallMs - nowMs) / 1000 : null;
    if (left !== null && (best === null || left < best)) best = left;
  }
  return best === null ? null : Math.max(0, best);
}
