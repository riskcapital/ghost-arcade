/**
 * Keyboard commands on the show's layer tracks: split, duplicate, copy /
 * cut / paste, delete and ripple delete, select all, nudge. The tray's key
 * handler (ShowTimeline.svelte, through show/showKeyboard.ts) calls these;
 * each is one undo step through the show store.
 */
import { get } from 'svelte/store';
import { showTimeline, SHOW_SNAP_SECONDS } from '../../../stores/showTimeline';
import { gridStepSeconds, secondsAtBar, barBeatAt } from '../../../show/tempoMap';
import { focusedTrackId, laneKeySelection, setTrackClipboard, trackClipboard } from './trackLayout';

export function hasClipSelection(): boolean {
  return get(showTimeline).selectedClipIds.length > 0 || !!get(laneKeySelection)?.times.length;
}

export function canPasteClips(): boolean {
  return !!trackClipboard()?.groups.length;
}

/** Split under the playhead: the selected clips there, or every clip there. */
export function splitAtPlayhead(): boolean {
  const s = get(showTimeline);
  return showTimeline.splitLayerClips(s.currentTime).length > 0;
}

export function duplicateSelection(): boolean {
  const ids = get(showTimeline).selectedClipIds;
  return ids.length > 0 && showTimeline.duplicateLayerClips(ids).length > 0;
}

/** Copy the selected clips, grouped by track. */
export function copySelection(): boolean {
  const s = get(showTimeline);
  const ids = new Set(s.selectedClipIds);
  if (!ids.size) return false;
  const groups = s.layerTracks
    .map((t) => ({ trackId: t.id, clips: showTimeline.copyLayerClips(t.clips.filter((c) => ids.has(c.id)).map((c) => c.id)) }))
    .filter((g) => g.clips.length);
  if (!groups.length) return false;
  setTrackClipboard({ groups });
  return true;
}

export function cutSelection(): boolean {
  if (!copySelection()) return false;
  showTimeline.removeLayerClips(get(showTimeline).selectedClipIds);
  return true;
}

/**
 * Paste at the playhead. Clips copied from one track go onto the focused
 * track (the one last clicked); from several tracks, each back onto its own.
 */
export function pasteAtPlayhead(): boolean {
  const board = trackClipboard();
  if (!board?.groups.length) return false;
  const s = get(showTimeline);
  const focused = get(focusedTrackId);
  const exists = (id: string | null) => !!id && s.layerTracks.some((t) => t.id === id);
  let groups = board.groups.filter((g) => exists(g.trackId));
  if (board.groups.length === 1 && exists(focused)) groups = [{ trackId: focused!, clips: board.groups[0].clips }];
  if (!groups.length) return false;
  return showTimeline.pasteLayerClipGroups(groups, s.currentTime).length > 0;
}

/** Delete selected keys, or else selected clips. False when neither. */
export function deleteSelection(ripple: boolean): boolean {
  const keys = get(laneKeySelection);
  if (keys?.times.length) {
    showTimeline.removeLaneKeys(keys.trackId, keys.key, keys.times);
    laneKeySelection.set(null);
    return true;
  }
  const ids = get(showTimeline).selectedClipIds;
  if (!ids.length) return false;
  showTimeline.removeLayerClips(ids, { ripple });
  return true;
}

/** One grid step at `t`: the beat grid with a tempo map, else 0.25 s. */
export function gridStep(t: number): number {
  const s = get(showTimeline);
  if (s.tempo && s.snapGrid !== 'off' && s.snapGrid !== 'seconds') {
    const step = gridStepSeconds(s.tempo, t, s.snapGrid);
    if (step && step > 0) return step;
  }
  return SHOW_SNAP_SECONDS;
}

/** One bar at `t` with a tempo map, else one second. */
export function barStep(t: number): number {
  const s = get(showTimeline);
  if (!s.tempo) return 1;
  const bar = barBeatAt(s.tempo, t).bar;
  return Math.max(0.01, secondsAtBar(s.tempo, bar + 1) - secondsAtBar(s.tempo, bar));
}

/** Nudge the selected keys, or else the selected clips, by one step. */
export function nudgeSelection(direction: -1 | 1, bar: boolean): boolean {
  const s = get(showTimeline);
  const keys = get(laneKeySelection);
  if (keys?.times.length) {
    const at = Math.min(...keys.times);
    const delta = direction * (bar ? barStep(at) : gridStep(at));
    const clamped = Math.max(delta, -at);
    if (Math.abs(clamped) < 1e-9) return true;
    showTimeline.shiftLaneKeys(keys.trackId, keys.key, keys.times, clamped, 'nudge');
    laneKeySelection.set({ ...keys, times: keys.times.map((t) => t + clamped) });
    return true;
  }
  const ids = s.selectedClipIds;
  if (!ids.length) return false;
  const idSet = new Set(ids);
  const clips = s.layerTracks.flatMap((t) => t.clips.filter((c) => idSet.has(c.id)));
  if (!clips.length) return false;
  const at = Math.min(...clips.map((c) => c.startTime));
  const delta = direction * (bar ? barStep(at) : gridStep(at));
  showTimeline.moveLayerClipsAcross(ids, Math.max(delta, -at), 0);
  return true;
}

export function clearTrackSelection(): void {
  showTimeline.selectLayerClips([]);
  laneKeySelection.set(null);
}
