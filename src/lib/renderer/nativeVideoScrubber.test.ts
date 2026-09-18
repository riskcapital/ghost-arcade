import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ submit: vi.fn(), status: vi.fn(), toast: vi.fn() }));
vi.mock('../api/native-renderer', () => ({
  submitNativeRendererCommands: rpc.submit, getNativeRendererStatus: rpc.status,
}));
vi.mock('../stores/errorToast', () => ({ showToast: rpc.toast }));
import { clampVideoScrubTime, createNativeVideoScrubber, type ScrubSource } from './nativeVideoScrubber';

describe('direct native video scrubbing', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextRaf: number;
  const source = (id: string): ScrubSource => ({ id, src: '/show/clip.mp4', durationSeconds: 8,
    playbackRate: 1, playbackMode: 'loop', isPlaying: true, _nativePlaybackSeekSeq: 4 });
  const flush = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(fn => fn(0)); };
  const settle = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
  beforeEach(() => {
    vi.resetAllMocks();
    callbacks = new Map(); nextRaf = 0;
    rpc.submit.mockResolvedValue({});
    rpc.status.mockImplementation(async () => {
      const latest = rpc.submit.mock.calls.at(-1)?.[0]?.[0];
      return { native_video_sessions: latest ? [{ source_id: latest.source_id,
        seek_generation: latest.seek_generation, frames_presented: 1 }] : [] };
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextRaf, callback); return nextRaf;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('coalesces drag positions into one paused transport seek, with no preview decode', () => {
    const scrubber = createNativeVideoScrubber();
    const clip = source('coalesce');
    const commit = vi.fn();
    for (const time of [0.2, 0.7, 1.125]) scrubber.seek(clip, time, commit);
    expect(rpc.submit).not.toHaveBeenCalled();
    flush();
    expect(rpc.submit).toHaveBeenCalledTimes(1);
    expect(rpc.submit.mock.calls[0][0]).toEqual([expect.objectContaining({
      type: 'set_media_source_playback', paused: true, time_seconds: 1.125, seek_generation: 5,
    })]);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ isPlaying: false, _nativePlaybackTimeSeconds: 1.125 }));
  });

  it('flushes the final position immediately and resumes only when requested', () => {
    const scrubber = createNativeVideoScrubber();
    const clip = source('final');
    const commit = vi.fn();
    scrubber.seek(clip, 1, commit);
    scrubber.seek(clip, 2, commit, { flush: true, playing: true });
    flush();
    expect(rpc.submit).toHaveBeenCalledTimes(1);
    expect(rpc.submit.mock.calls[0][0][0]).toMatchObject({ time_seconds: 2, paused: false });
  });

  it('shows each accepted drag frame before sending the latest target, without queuing intermediate positions', async () => {
    const scrubber = createNativeVideoScrubber();
    const clip = source('continuous');
    const commit = vi.fn();
    let presented!: (value: unknown) => void;
    rpc.status.mockReturnValueOnce(new Promise(resolve => { presented = resolve; }));
    scrubber.seek(clip, 1, commit); flush();
    await settle();
    for (const time of [2, 3, 4, 5, 6, 7]) { scrubber.seek(clip, time, commit); flush(); }
    expect(rpc.submit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    presented({ native_video_sessions: [{ source_id: clip.id, seek_generation: 5, frames_presented: 1 }] });
    await settle();
    expect(rpc.submit).toHaveBeenCalledTimes(2);
    expect(rpc.submit.mock.calls[1][0][0]).toMatchObject({ time_seconds: 7, paused: true, seek_generation: 6 });
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ _nativePlaybackTimeSeconds: 7 }));
  });

  it('lets mouseup supersede an unfinished seek once and ignores its late acknowledgement', async () => {
    const scrubber = createNativeVideoScrubber();
    const clip = source('release-flight');
    const commit = vi.fn();
    let oldFrame!: (value: unknown) => void;
    rpc.status.mockReturnValueOnce(new Promise(resolve => { oldFrame = resolve; }));
    scrubber.seek(clip, 1, commit); flush();
    await settle();
    scrubber.seek(clip, 2, commit);
    scrubber.seek(clip, 3, commit, { flush: true, playing: true });
    await settle();
    expect(rpc.submit).toHaveBeenCalledTimes(2);
    expect(rpc.submit.mock.calls[1][0][0]).toMatchObject({ time_seconds: 3, paused: false });
    oldFrame({ native_video_sessions: [{ source_id: clip.id, seek_generation: 5, frames_presented: 1 }] });
    await settle(); flush();
    expect(rpc.submit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ isPlaying: true, _nativePlaybackTimeSeconds: 3 }));
  });

  it('drops pending scratch positions when a newer external transport action wins', async () => {
    const scrubber = createNativeVideoScrubber();
    const clip = source('external-transport');
    let acknowledged!: (value: unknown) => void;
    rpc.status.mockReturnValueOnce(new Promise(resolve => { acknowledged = resolve; }));
    scrubber.seek(clip, 1, vi.fn()); flush();
    await settle();
    scrubber.seek(clip, 2, vi.fn()); flush();
    acknowledged({ native_video_sessions: [{ source_id: clip.id, seek_generation: 8, frames_presented: 0 }] });
    await settle(); flush();
    expect(rpc.submit).toHaveBeenCalledTimes(1);
  });

  it('starts a new source immediately while a cancelled old seek is still waiting', async () => {
    const scrubber = createNativeVideoScrubber();
    let oldFrame!: (value: unknown) => void;
    rpc.status.mockReturnValueOnce(new Promise(resolve => { oldFrame = resolve; }));
    scrubber.seek(source('old-seek'), 1, vi.fn()); flush();
    await settle();
    scrubber.cancel();
    scrubber.seek(source('new-seek'), 4, vi.fn()); flush();
    await settle();
    expect(rpc.submit).toHaveBeenCalledTimes(2);
    oldFrame({ native_video_sessions: [{ source_id: 'old-seek', seek_generation: 5, frames_presented: 1 }] });
    await settle();
    expect(rpc.submit.mock.calls[1][0][0]).toMatchObject({ source_id: 'new-seek', time_seconds: 4 });
    expect(rpc.submit).toHaveBeenCalledTimes(2);
  });

  it('keeps the out-point exclusive and honors both trim edges', () => {
    const clip = { ...source('trim'), trimStart: 0.25, trimEnd: 0.75 };
    expect(clampVideoScrubTime(clip, 0)).toBe(2);
    expect(clampVideoScrubTime(clip, 8)).toBeCloseTo(6 - 0.00001, 8);
    expect(clampVideoScrubTime(clip, NaN)).toBe(2);
  });

  it('steps from the native picture and commits the confirmed VFR timestamp without guessing FPS', async () => {
    const scrubber = createNativeVideoScrubber();
    const clip = { ...source('vfr'), _nativePlaybackTimeSeconds: 7 };
    const commit = vi.fn();
    rpc.status.mockResolvedValueOnce({ native_video_sessions: [{ source_id: 'vfr',
      source_frame_step_exact: true, source_time_seconds: 0.124, seek_generation: 17 }] });
    rpc.status.mockResolvedValueOnce({ native_video_sessions: [{ source_id: 'vfr',
      source_time_seconds: 0.217, seek_generation: 18, frames_presented: 1 }] });
    await scrubber.step(clip, 1, commit);
    expect(rpc.submit.mock.calls[0][0][0]).toMatchObject({
      frame_step: 1, time_seconds: 0.124, paused: true, seek_generation: 18,
    });
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({
      isPlaying: false, _nativePlaybackTimeSeconds: 0.217, _nativePlaybackSeekSeq: 18,
    }));
  });

  it('does not present a guessed frame step when exact timing is unavailable', async () => {
    rpc.status.mockResolvedValue({ native_video_sessions: [{ source_id: 'soft',
      source_frame_step_exact: false, source_time_seconds: 1, source_fps: 30 }] });
    await expect(createNativeVideoScrubber().step(source('soft'), -1, vi.fn())).rejects.toThrow('prepared native video frame');
    expect(rpc.submit).not.toHaveBeenCalled();
  });

  it('cancels pending drag work and ignores a step reply after switching clips', async () => {
    const scrubber = createNativeVideoScrubber();
    const clip = source('cancel');
    const commit = vi.fn();
    scrubber.seek(clip, 2, commit);
    scrubber.cancel(); flush();
    expect(rpc.submit).not.toHaveBeenCalled();
    let resolve!: (value: unknown) => void;
    rpc.status.mockReturnValue(new Promise(done => { resolve = done; }));
    const step = scrubber.step(clip, 1, commit);
    scrubber.cancel();
    resolve({ native_video_sessions: [{ source_id: 'cancel', source_frame_step_exact: true,
      source_time_seconds: 0, seek_generation: 4 }] });
    await step;
    expect(commit).not.toHaveBeenCalled();
    expect(rpc.submit).not.toHaveBeenCalled();
  });

  it('starts a new clip immediately after cancellation without the old reply unlocking its pending step', async () => {
    const scrubber = createNativeVideoScrubber();
    const oldCommit = vi.fn();
    const newCommit = vi.fn();
    const duplicateCommit = vi.fn();
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    rpc.status.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    rpc.status.mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve; }));
    rpc.status.mockResolvedValueOnce({ native_video_sessions: [{ source_id: 'new-after-cancel',
      source_time_seconds: 0.36, seek_generation: 11, frames_presented: 1 }] });

    const oldStep = scrubber.step(source('old-before-cancel'), 1, oldCommit);
    scrubber.cancel();
    const newStep = scrubber.step(source('new-after-cancel'), -1, newCommit);
    expect(rpc.status).toHaveBeenCalledTimes(2);

    // The cancelled request completes while the new clip's request is still
    // outstanding. Its finally must not clear the newer request's busy lock.
    resolveOld({ native_video_sessions: [{ source_id: 'old-before-cancel',
      source_frame_step_exact: true, source_time_seconds: 2, seek_generation: 4, frames_presented: 1 }] });
    await oldStep;
    await scrubber.step(source('new-after-cancel'), 1, duplicateCommit);
    expect(rpc.status).toHaveBeenCalledTimes(2);
    expect(rpc.submit).not.toHaveBeenCalled();

    resolveNew({ native_video_sessions: [{ source_id: 'new-after-cancel',
      source_frame_step_exact: true, source_time_seconds: 0.5, seek_generation: 10, frames_presented: 1 }] });
    await newStep;
    expect(rpc.submit).toHaveBeenCalledTimes(1);
    expect(rpc.submit.mock.calls[0][0][0]).toMatchObject({
      source_id: 'new-after-cancel', frame_step: -1, time_seconds: 0.5, paused: true, seek_generation: 11,
    });
    expect(oldCommit).not.toHaveBeenCalled();
    expect(duplicateCommit).not.toHaveBeenCalled();
    expect(newCommit).toHaveBeenLastCalledWith(expect.objectContaining({
      isPlaying: false, _nativePlaybackTimeSeconds: 0.36, _nativePlaybackSeekSeq: 11,
    }));
  });
});
