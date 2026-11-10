/**
 * Session state of the Stage camera lane in the show tray: whether the lane
 * is shown while it is still empty, and which camera clip is selected.
 */
import { get, writable } from 'svelte/store';
import { showTimeline } from '../../../stores/showTimeline';
import { demoReel } from '../../../stage3d/demoReel';
import { addCameraClip } from '../../../show/rehearsal/cameraLaneEdit';

export const CAMERA_LANE_HEIGHT = 40;

/** Shown on request even before it has a shot (a lane with shots always shows). */
export const cameraLaneShown = writable(false);

export const selectedCameraClipId = writable<string | null>(null);


/** Place a shot on the lane at `t` (snapped), selecting it. False when there is no room. */
export function placeCameraShot(shotId: string, t: number): boolean {
  const shot = get(demoReel).shots.find((s) => s.id === shotId);
  if (!shot) return false;
  const result = addCameraClip(get(showTimeline).cameraLane, shotId, showTimeline.snapTime(t), shot.durationSec);
  if (!result) return false;
  showTimeline.setCameraLane(result.lane);
  selectedCameraClipId.set(result.id);
  showTimeline.select(null);
  showTimeline.selectLayerClips([]);
  return true;
}
