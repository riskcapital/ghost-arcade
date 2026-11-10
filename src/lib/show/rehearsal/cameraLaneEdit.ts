/**
 * Editing the show's Stage camera lane: shots (Demo Reel camera moves) laid
 * out in show time. Clips never overlap; each operation returns a new lane
 * or the same array when nothing could change.
 */
import type { ShowCameraClip } from '../../types';
import { generateUUID } from '../../utils/uuid';

export const CAMERA_CLIP_MIN_SECONDS = 0.25;

function sorted(lane: readonly ShowCameraClip[]): ShowCameraClip[] {
  return [...lane].sort((a, b) => a.startTime - b.startTime);
}

/** The free stretch around `t`: from the end of the clip before to the start of the next. */
export function freeSpanAt(lane: readonly ShowCameraClip[], t: number, excludeId?: string): { start: number; end: number } | null {
  let start = 0;
  let end = Number.POSITIVE_INFINITY;
  for (const c of lane) {
    if (c.id === excludeId) continue;
    const cEnd = c.startTime + c.duration;
    if (t >= c.startTime && t < cEnd) return null;
    if (cEnd <= t) start = Math.max(start, cEnd);
    if (c.startTime > t) end = Math.min(end, c.startTime);
  }
  return { start, end };
}

/** Put a shot at `t`, as long as the shot (or the gap, if shorter). Null when `t` is inside a clip. */
export function addCameraClip(
  lane: readonly ShowCameraClip[],
  shotId: string,
  t: number,
  duration: number,
): { lane: ShowCameraClip[]; id: string } | null {
  const at = Math.max(0, t);
  const span = freeSpanAt(lane, at);
  if (!span) return null;
  const room = span.end - at;
  if (room < CAMERA_CLIP_MIN_SECONDS) return null;
  const id = generateUUID();
  const clip: ShowCameraClip = { id, startTime: at, duration: Math.max(CAMERA_CLIP_MIN_SECONDS, Math.min(duration, room)), shotId };
  return { lane: sorted([...lane, clip]), id };
}

/** Move a clip to start at `start`, held between its neighbours. */
export function moveCameraClip(lane: readonly ShowCameraClip[], id: string, start: number): ShowCameraClip[] {
  const clip = lane.find((c) => c.id === id);
  if (!clip) return lane as ShowCameraClip[];
  const others = lane.filter((c) => c.id !== id);
  const want = Math.max(0, start);
  // Neighbours relative to where the clip is now: it cannot jump over one.
  const before = others.filter((c) => c.startTime < clip.startTime);
  const after = others.filter((c) => c.startTime >= clip.startTime);
  const lo = before.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
  const hi = after.reduce((m, c) => Math.min(m, c.startTime), Number.POSITIVE_INFINITY) - clip.duration;
  if (hi < lo) return lane as ShowCameraClip[];
  const next = Math.max(lo, Math.min(hi, want));
  if (Math.abs(next - clip.startTime) < 1e-9) return lane as ShowCameraClip[];
  return sorted(lane.map((c) => (c.id === id ? { ...c, startTime: next } : c)));
}

/** Drag one edge of a clip to `t`, never past its neighbours or under the minimum length. */
export function trimCameraClip(lane: readonly ShowCameraClip[], id: string, edge: 'start' | 'end', t: number): ShowCameraClip[] {
  const clip = lane.find((c) => c.id === id);
  if (!clip) return lane as ShowCameraClip[];
  const others = lane.filter((c) => c.id !== id);
  const end = clip.startTime + clip.duration;
  let patch: Partial<ShowCameraClip>;
  if (edge === 'start') {
    const lo = others.filter((c) => c.startTime < clip.startTime).reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
    const start = Math.max(lo, Math.min(end - CAMERA_CLIP_MIN_SECONDS, t));
    patch = { startTime: start, duration: end - start };
  } else {
    const hi = others.filter((c) => c.startTime >= end - 1e-9).reduce((m, c) => Math.min(m, c.startTime), Number.POSITIVE_INFINITY);
    const newEnd = Math.min(hi, Math.max(clip.startTime + CAMERA_CLIP_MIN_SECONDS, t));
    patch = { duration: newEnd - clip.startTime };
  }
  return sorted(lane.map((c) => (c.id === id ? { ...c, ...patch } : c)));
}

export function setCameraClipShot(lane: readonly ShowCameraClip[], id: string, shotId: string): ShowCameraClip[] {
  return lane.map((c) => (c.id === id ? { ...c, shotId } : c));
}

export function removeCameraClips(lane: readonly ShowCameraClip[], ids: Iterable<string>): ShowCameraClip[] {
  const drop = new Set(ids);
  return lane.filter((c) => !drop.has(c.id));
}
