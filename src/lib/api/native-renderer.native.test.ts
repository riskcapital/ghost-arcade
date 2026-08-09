import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => ({ running: true })),
}));

vi.mock('$lib/bridge', () => ({
  invoke: invokeMock,
}));

import { prefetchNativeRendererMedia } from './native-renderer';

describe('native renderer media prefetch contract', () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it('forwards the armed decoder seek generation to Electron', async () => {
    await prefetchNativeRendererMedia(
      'library:clip-a:g7',
      '/tmp/clip-a.mp4',
      1,
      'video',
      {
        timeSeconds: 1.25,
        seekGeneration: 7,
        playbackRate: 1,
        loopEnabled: true,
      },
    );

    expect(invokeMock).toHaveBeenCalledWith(
      'native_renderer_prefetch_media',
      expect.objectContaining({
        source_id: 'library:clip-a:g7',
        seek_generation: 7,
        time_seconds: 1.25,
      }),
    );
  });
});
