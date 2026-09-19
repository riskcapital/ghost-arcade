import { expect, it } from 'vitest';
import { VideoBeatPhase, type BeatPhaseClip } from './videoBeatPhase';
const clip: BeatPhaseClip = { id: 'clip', src: '/clip.mov', durationSeconds: 10,
  trimStart: .2, trimEnd: .6, playbackRate: 2, playbackSyncBeats: 4, playbackMode: 'loop',
  _nativePlaybackTimeSeconds: 2, _nativePlaybackUpdatedAtMs: 0, _nativePlaybackSeekSeq: 1 };
it('follows continuous beats across many cycles without reanchoring on tempo changes', () => {
  const follow = new VideoBeatPhase();
  follow.sample('A:0', clip, 0, null, 0);
  expect(follow.sample('A:0', { ...clip, playbackRate: 3 }, 1201.5, null, 0)?.timeSeconds).toBeCloseTo(3.5);
});
it('tracks reverse and both bounce legs', () => {
  const follow = new VideoBeatPhase();
  const reverse = { ...clip, playbackRate: -2, _nativePlaybackTimeSeconds: 6 };
  follow.sample('A:0', reverse, 0, null, 0);
  expect(follow.sample('A:0', reverse, 1, null, 0)).toEqual({ timeSeconds: 5, reverse: true });
  const bounce = { ...clip, playbackMode: 'bounce' as const };
  follow.sample('B:0', bounce, 0, null, 0);
  expect(follow.sample('B:0', bounce, 3, null, 0)).toEqual({ timeSeconds: 4, reverse: true });
});
it('manual seeks and pauses reset anchors instead of fighting the operator', () => {
  const follow = new VideoBeatPhase();
  follow.sample('A:0', clip, 0, null, 0);
  const seek = { ...clip, _nativePlaybackTimeSeconds: 4, _nativePlaybackSeekSeq: 2 };
  expect(follow.sample('A:0', seek, 1, null, 0)?.timeSeconds).toBe(4);
  expect(follow.sample('A:0', { ...seek, isPlaying: false }, 2, null, 0)).toBeNull();
  expect(follow.sample('A:0', seek, 3, null, 0)?.timeSeconds).toBe(4);
});
it('discards stopped rows and rejects one-shot or unknown-duration content', () => {
  const follow = new VideoBeatPhase();
  follow.sample('A:0', clip, 0, null, 0);
  follow.retain(new Set());
  expect(follow.sample('A:0', clip, 3, null, 0)?.timeSeconds).toBe(2);
  expect(follow.sample('A:0', { ...clip, playbackMode: 'once' }, 3, null, 0)).toBeNull();
  expect(follow.sample('A:0', { ...clip, durationSeconds: NaN }, 3, null, 0)).toBeNull();
});
