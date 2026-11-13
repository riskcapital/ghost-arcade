/**
 * The Timeline's keys (line points) as a selection you edit the way a video
 * editor edits keyframes: delete, nudge, drag, copy and paste them across
 * every line and row at once, together with selected blocks. The pure
 * editing is in timeline/lines/keyEdit.ts; this commits it to the show (one
 * undo step per gesture) and keeps the selection on the keys as they move.
 */
import { get } from 'svelte/store';
import { showTimeline } from '../../../stores/showTimeline';
import { clearSelectedKeys, selectKeys, selectedKeys } from '../../../timeline/lines/lineSelection';
import {
  copyKeys, deleteKeys, keysBetween, pasteKeys, shiftKeys, type KeyAt, type KeyClipboard,
} from '../../../timeline/lines/keyEdit';
import { linesForTrack } from './lineUi';
import type { ShowLayerTrack } from '../../../types';

export function hasKeySelection(): boolean {
  return selectedKeys().length > 0;
}

export function deleteSelectedKeys(): boolean {
  const keys = selectedKeys();
  if (!keys.length) return false;
  showTimeline.editLines((lines) => deleteKeys(lines, keys));
  clearSelectedKeys();
  return true;
}

/** Move the selected keys by `dt` seconds (never before 0), keeping them selected. */
export function moveSelectedKeys(dt: number, opts: { continuousKey?: string } = {}): boolean {
  const lines = get(showTimeline).lines;
  const keys = selectedKeys(lines);
  if (!keys.length) return false;
  const moved = shiftKeys(lines, keys, dt);
  if (moved.lines === lines) return false;
  showTimeline.setLines(moved.lines, { continuousKey: opts.continuousKey });
  selectKeys(moved.keys);
  return true;
}

/**
 * A drag of the selected keys: `move(dt)` puts them `dt` seconds from where
 * they started (one undo step for the whole drag), `end()` keeps them there.
 */
export function beginKeyDrag(): { keys: KeyAt[]; move(dt: number): void; end(): void; cancel(): void } | null {
  const base = get(showTimeline).lines;
  const keys = selectedKeys(base);
  if (!keys.length) return null;
  const continuousKey = `keys:${Date.now()}`;
  let last: KeyAt[] = keys;
  return {
    keys,
    move(dt: number) {
      const r = shiftKeys(base, keys, dt);
      showTimeline.setLines(r.lines, { continuousKey });
      last = r.keys;
      selectKeys(last);
    },
    end() { selectKeys(last); },
    cancel() {
      showTimeline.setLines(base, { continuousKey });
      selectKeys(keys);
    },
  };
}

// ── Copy and paste ──────────────────────────────────────────────────────

let clipboard: KeyClipboard | null = null;

/** Copy the selected keys (true when there were any). A copy without keys empties the key clipboard. */
export function copySelectedKeys(): boolean {
  clipboard = copyKeys(get(showTimeline).lines, selectedKeys());
  return !!clipboard;
}

export function canPasteKeys(): boolean {
  return !!clipboard;
}

/** Paste the copied keys with the earliest at the playhead, and select them. */
export function pasteKeysAtPlayhead(): boolean {
  if (!clipboard) return false;
  const s = get(showTimeline);
  const r = pasteKeys(s.lines, clipboard, s.currentTime);
  if (r.lines === s.lines) return false;
  showTimeline.setLines(r.lines);
  selectKeys(r.keys);
  return true;
}

// ── Select forward ──────────────────────────────────────────────────────

/**
 * Select every block that starts at or after `t` and every key from `t` on
 * (Premiere's track select forward), on one row or on all of them.
 */
export function selectForward(t: number, track: ShowLayerTrack | null = null): { clips: number; keys: number } {
  const s = get(showTimeline);
  const rows = track ? [track] : s.layerTracks;
  const clipIds = rows.flatMap((r) => r.clips.filter((c) => c.startTime >= t - 1e-6).map((c) => c.id));
  const lineIds = track ? new Set(linesForTrack(track, s.lines).map((l) => l.id)) : undefined;
  const keys = keysBetween(s.lines, t, Number.POSITIVE_INFINITY, lineIds);
  showTimeline.selectLayerClips(clipIds);
  selectKeys(keys);
  return { clips: clipIds.length, keys: keys.length };
}

/** Select every key (with Select all). */
export function selectAllKeys(): void {
  const lines = get(showTimeline).lines;
  selectKeys(keysBetween(lines, 0, Number.POSITIVE_INFINITY));
}
