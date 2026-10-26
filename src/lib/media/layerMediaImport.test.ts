import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  desktop: true,
  prepare: vi.fn(),
  assetRef: vi.fn(),
}));
vi.mock('$lib/bridge', () => ({ get isDesktopApp() { return mocks.desktop; } }));
vi.mock('$lib/video/videoImport', () => ({ prepareVideoImport: mocks.prepare }));
vi.mock('$lib/storage/assetRegistry', () => ({ createDurableAssetRefFromFile: mocks.assetRef }));

import { createLayerMediaSource, LayerMediaRejected } from './layerMediaImport';

class FakeVideo {
  crossOrigin = ''; loop = false; muted = false; playsInline = false; preload = ''; src = '';
  duration = NaN; error: object | null = null;
  play = vi.fn(async () => { throw new DOMException('no supported source', 'NotSupportedError'); });
}
let created: FakeVideo[] = [];
const file = (name: string, type = '') => ({ name, type, text: async () => 'void main(){}' }) as unknown as File;

beforeEach(() => {
  created = [];
  mocks.desktop = true;
  mocks.assetRef.mockResolvedValue({ assetRef: { kind: 'local-file', originalPath: '/show/clip' }, runtimeUrl: 'blob:clip' });
  vi.stubGlobal('document', { createElement: () => { const video = new FakeVideo(); created.push(video); return video; } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('mapping layer media import', () => {
  it('imports a video Chromium cannot decode through the ffmpeg probe and keeps it playing', async () => {
    mocks.prepare.mockResolvedValue({ durationSeconds: 12.5, videoWidth: 3840, videoHeight: 2160, thumbnail: 'data:' });
    const source = await createLayerMediaSource(file('show.mov', ''));
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(source).toMatchObject({ type: 'video', isPlaying: true, durationSeconds: 12.5, videoWidth: 3840, videoHeight: 2160 });
    expect(source.videoElement).toBe(created[0]);
  });

  it('turns an audio file away with a hint instead of making an image layer', async () => {
    await expect(createLayerMediaSource(file('song.wav', 'audio/wav'))).rejects.toThrow(/Show timeline/);
    await expect(createLayerMediaSource(file('song.mp3'))).rejects.toBeInstanceOf(LayerMediaRejected);
    expect(mocks.assetRef).not.toHaveBeenCalled();
  });

  it('reports a file the import cannot read', async () => {
    mocks.prepare.mockRejectedValue(new Error('Could not read this video for import.'));
    await expect(createLayerMediaSource(file('broken.mp4', 'video/mp4'))).rejects.toThrow('Could not read');
  });

  it('refuses a format the browser build cannot play', async () => {
    mocks.desktop = false;
    mocks.prepare.mockImplementation(async (video: FakeVideo) => { video.error = {}; return { thumbnail: '' }; });
    await expect(createLayerMediaSource(file('show.mov'))).rejects.toThrow(/browser can't play/);
  });

  it('keeps images and shaders as before', async () => {
    expect(await createLayerMediaSource(file('logo.png', 'image/png'))).toMatchObject({ type: 'image', src: 'blob:clip' });
    expect(await createLayerMediaSource(file('tunnel.fs'))).toMatchObject({ type: 'shader', shaderCode: 'void main(){}' });
    await expect(createLayerMediaSource(file('notes.txt', 'text/plain'))).rejects.toThrow(/can't be a layer/);
  });
});
