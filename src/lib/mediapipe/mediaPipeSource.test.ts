import { describe, expect, it, vi } from 'vitest';
import { MediaPipeSource } from './mediaPipeSource';

describe('MediaPipe camera startup', () => {
  it('joins repeated render-frame requests into one camera/worker startup', async () => {
    const source = new MediaPipeSource();
    let finish!: () => void;
    const startup = new Promise<void>(resolve => { finish = resolve; });
    const init = vi.spyOn(source as any, '_startInternal').mockImplementation(() => startup);
    const calls = Array.from({ length: 60 }, () => source.start({ useGesture: false }));
    expect(init).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all(calls);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('propagates failure to all callers and permits a deliberate retry', async () => {
    const source = new MediaPipeSource();
    let fail!: (error: Error) => void;
    const startup = new Promise<void>((_, reject) => { fail = reject; });
    const init = vi.spyOn(source as any, '_startInternal').mockImplementation(() => startup);
    const settled = Promise.allSettled([source.start(), source.start()]);
    fail(new Error('camera unavailable'));
    expect((await settled).every(result => result.status === 'rejected')).toBe(true);
    init.mockResolvedValue(undefined);
    await source.start();
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('uses one mirror setting for inference and preview', () => {
    const source = new MediaPipeSource();
    expect(source.isMirrored()).toBe(true);
    source.setMirror(false);
    expect(source.getOpts().mirror).toBe(false);
    source.setMirror(true);
    expect(source.getOpts().mirror).toBe(true);
  });
});
