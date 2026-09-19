import { describe, expect, it } from 'vitest';
import { nativeVideoLaunchTime, nativeVideoTransportSnapshot, nativeVideoAnchorRate, nativeVideoLoopProgress, predictNativePlayheadSeconds } from './nativeTransport';

describe('native directional launch', () => {
  it('uses trim-in forward and the exclusive trim-out backwards', () => {
    expect(nativeVideoLaunchTime({trimStart:.2,trimEnd:.8,playbackRate:1},10)).toBe(2);
    expect(nativeVideoLaunchTime({trimStart:.2,trimEnd:.8,playbackRate:-2},10)).toBe(8);
  });
  it('bounds trim and waits at zero until duration is known', () => {
    expect(nativeVideoLaunchTime({playbackRate:-1},undefined)).toBe(0);
    expect(nativeVideoLaunchTime({playbackRate:-1},NaN)).toBe(0);
    expect(nativeVideoLaunchTime({trimStart:-1,trimEnd:3,playbackRate:-1},5)).toBe(5);
    expect(nativeVideoLaunchTime({trimStart:.8,trimEnd:.2,playbackRate:-1},5)).toBe(4);
  });
});

describe('bounce transport clock', () => {
  const clip = { durationSeconds: 10, trimStart: .2, trimEnd: .6, playbackMode: 'bounce',
    playbackRate: 1, isPlaying: true, _nativePlaybackTimeSeconds: 2,
    _nativePlaybackUpdatedAtMs: 1000, _nativePlaybackSeekSeq: 1 };
  it('reflects at both trim edges without accumulating drift', () => {
    for (const [elapsed, time, direction] of [[0,2,1],[4,6,-1],[5,5,-1],[8,2,1],[600,2,1]]) {
      expect(nativeVideoTransportSnapshot(clip, 1000 + elapsed * 1000)).toEqual({timeSeconds:time,direction});
    }
  });
  it('retains the reverse leg through a long pause and a speed adjustment', () => {
    const atPause = nativeVideoTransportSnapshot(clip, 6000);
    const paused = {...clip, isPlaying:false, _nativePlaybackTimeSeconds:atPause.timeSeconds,
      _nativePlaybackDirection:atPause.direction, _nativePlaybackUpdatedAtMs:6000};
    expect(nativeVideoTransportSnapshot(paused, 50000)).toEqual({timeSeconds:5,direction:-1});
    const resumed = {...paused,isPlaying:true,playbackRate:2,_nativePlaybackUpdatedAtMs:50000};
    expect(nativeVideoTransportSnapshot(resumed,51000)).toEqual({timeSeconds:3,direction:-1});
    expect(nativeVideoTransportSnapshot(resumed,52000)).toEqual({timeSeconds:3,direction:1});
    expect(nativeVideoAnchorRate(resumed)).toBe(-2);
  });
  it('uses a full out-and-back trip for either initial direction', () => {
    expect(nativeVideoLoopProgress(clip, 5000)).toBe(.5);
    expect(nativeVideoLoopProgress(clip, 9000)).toBe(0);
    const reverse = {...clip,playbackRate:-1,_nativePlaybackTimeSeconds:6};
    expect(nativeVideoLoopProgress(reverse,1000)).toBe(0);
    expect(nativeVideoLoopProgress(reverse,5000)).toBe(.5);
    expect(nativeVideoLoopProgress(reverse,9000)).toBe(0);
  });
  it('predicts the reflected position for external position synchronization', () => {
    expect(predictNativePlayheadSeconds(clip,6000)).toBe(5);
  });
  it('bounds empty ranges and ignores non-finite duration', () => {
    expect(nativeVideoTransportSnapshot({...clip,trimEnd:.2},999999).timeSeconds).toBe(2);
    expect(nativeVideoTransportSnapshot({...clip,durationSeconds:NaN},2000).timeSeconds).toBe(3);
  });
});
