import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScrubSource, ScrubUpdate } from './nativeVideoScrubber';

const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./nativeVideoScrubber', () => ({ createNativeVideoScrubber: mock.create }));
import { createNativeVideoScratchController } from './nativeVideoScratch';

describe('absolute video scratch controls', () => {
  const source = (id: string): ScrubSource => ({
    id, src: `/show/${id}.mp4`, durationSeconds: 8, trimStart: 0.25, trimEnd: 0.75,
    isPlaying: true, _nativePlaybackSeekSeq: 1, _nativePlaybackTimeSeconds: 2,
  });
  const patch = (time: number, generation = 2): ScrubUpdate => ({
    isPlaying: false, _nativePlaybackTimeSeconds: time,
    _nativePlaybackSeekSeq: generation, _nativePlaybackUpdatedAtMs: 10,
  });
  beforeEach(() => {
    mock.create.mockReset();
    mock.create.mockImplementation(() => ({ seek: vi.fn(), cancel: vi.fn() }));
  });

  it('maps a knob across trim boundaries and holds the picture without a video element', () => {
    const clip = source('trimmed');
    const controller = createNativeVideoScratchController(() => clip, vi.fn());
    for (const value of [-1, 0.5, 2]) controller.seek('A:0', value);
    const scrubber = mock.create.mock.results[0].value;
    expect(scrubber.seek.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 4, 6]);
    for (const call of scrubber.seek.mock.calls) expect(call[3]).toEqual({ playing: false });
  });

  it('keeps independent targets and its own transport updates alive', () => {
    const sources = new Map([['A:0', source('a')], ['B:0', source('b')]]);
    const controller = createNativeVideoScratchController(key => sources.get(key) ?? null,
      (key, clip, update) => {
        sources.set(key, { ...clip, ...update });
        controller.refresh();
      });
    controller.seek('A:0', 0.2);
    controller.seek('B:0', 0.8);
    expect(mock.create).toHaveBeenCalledTimes(2);
    const a = mock.create.mock.results[0].value;
    const b = mock.create.mock.results[1].value;
    a.seek.mock.calls[0][2](patch(2.8));
    controller.seek('A:0', 0.4);
    expect(mock.create).toHaveBeenCalledTimes(2);
    expect(a.cancel).not.toHaveBeenCalled();
    expect(b.cancel).not.toHaveBeenCalled();
  });

  it('cancels queued work when a clip is replaced and ignores its late frame confirmation', () => {
    let clip = source('old');
    const commit = vi.fn();
    const controller = createNativeVideoScratchController(() => clip, commit);
    controller.seek('A:0', 0.2);
    const old = mock.create.mock.results[0].value;
    clip = source('new');
    controller.refresh();
    controller.seek('A:0', 0.8);
    old.seek.mock.calls[0][2](patch(2.8));
    expect(old.cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(mock.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    { isPlaying: true },
    { _nativePlaybackSeekSeq: 5 },
    { trimEnd: 0.5 },
    { playbackRate: 2 },
  ])('lets explicit transport changes revoke pending scratch work: %j', change => {
    let clip = { ...source('held'), isPlaying: false };
    const commit = vi.fn();
    const controller = createNativeVideoScratchController(() => clip, commit);
    controller.seek('A:0', 0.8);
    const scrubber = mock.create.mock.results[0].value;
    clip = { ...clip, ...change };
    controller.refresh();
    scrubber.seek.mock.calls[0][2](patch(5.2));
    expect(scrubber.cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
