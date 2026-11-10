import { describe, expect, it } from 'vitest';
import {
  CAMERA_CLIP_MIN_SECONDS,
  addCameraClip,
  freeSpanAt,
  moveCameraClip,
  removeCameraClips,
  setCameraClipShot,
  trimCameraClip,
} from './cameraLaneEdit';

const lane = [
  { id: 'a', startTime: 1, duration: 4, shotId: 's1' },
  { id: 'b', startTime: 8, duration: 2, shotId: 's2' },
];

describe('stage camera lane editing', () => {
  it('finds the free stretch around a time', () => {
    expect(freeSpanAt(lane, 0.5)).toEqual({ start: 0, end: 1 });
    expect(freeSpanAt(lane, 6)).toEqual({ start: 5, end: 8 });
    expect(freeSpanAt(lane, 12)).toEqual({ start: 10, end: Infinity });
    expect(freeSpanAt(lane, 2)).toBeNull();
  });

  it('adds a shot as long as the shot, cut to the gap, never inside a clip', () => {
    const r = addCameraClip(lane, 's3', 6, 5);
    expect(r).not.toBeNull();
    const added = r!.lane.find((c) => c.id === r!.id)!;
    expect(added).toMatchObject({ startTime: 6, duration: 2, shotId: 's3' });
    expect(r!.lane.map((c) => c.id)).toEqual(['a', added.id, 'b']);
    expect(addCameraClip(lane, 's3', 2, 5)).toBeNull();
    expect(addCameraClip(lane, 's3', 7.9, 5)).toBeNull(); // less than the minimum left
    expect(addCameraClip(lane, 's3', 20, 5)!.lane.at(-1)).toMatchObject({ startTime: 20, duration: 5 });
  });

  it('moves a clip between its neighbours only', () => {
    expect(moveCameraClip(lane, 'a', 2).find((c) => c.id === 'a')!.startTime).toBe(2);
    expect(moveCameraClip(lane, 'a', 6).find((c) => c.id === 'a')!.startTime).toBe(4); // stops at b
    expect(moveCameraClip(lane, 'b', 0).find((c) => c.id === 'b')!.startTime).toBe(5); // stops at a
    expect(moveCameraClip(lane, 'a', -3).find((c) => c.id === 'a')!.startTime).toBe(0);
    expect(moveCameraClip(lane, 'a', 1)).toBe(lane);
  });

  it('trims either edge, held by the neighbours and the minimum length', () => {
    expect(trimCameraClip(lane, 'a', 'end', 7).find((c) => c.id === 'a')!.duration).toBe(6);
    expect(trimCameraClip(lane, 'a', 'end', 9).find((c) => c.id === 'a')!.duration).toBe(7);
    expect(trimCameraClip(lane, 'a', 'end', 0).find((c) => c.id === 'a')!.duration).toBe(CAMERA_CLIP_MIN_SECONDS);
    const b = trimCameraClip(lane, 'b', 'start', 3).find((c) => c.id === 'b')!;
    expect(b).toMatchObject({ startTime: 5, duration: 5 });
  });

  it('changes the shot and removes clips', () => {
    expect(setCameraClipShot(lane, 'b', 's9').find((c) => c.id === 'b')!.shotId).toBe('s9');
    expect(removeCameraClips(lane, ['a']).map((c) => c.id)).toEqual(['b']);
  });
});
