import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const h = vi.hoisted(() => ({
  layers: [] as any[],
  items: [] as any[],
  setLayerSource: vi.fn(),
  relinkClipFiles: vi.fn(() => 2),
  updateItem: vi.fn(),
  noteMediaRelinked: vi.fn(),
}));
vi.mock('$lib/bridge', () => ({ isDesktopApp: true, invoke: vi.fn() }));
vi.mock('$lib/api/native-renderer', () => ({ probeNativeVideo: vi.fn(async () => null) }));
vi.mock('$lib/stores/settings', () => ({ NATIVE_ENGINE_ONLY: true }));
vi.mock('$lib/stores/errorToast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/stores/layers', () => ({
  project: { subscribe: (run: (value: any) => void) => { run({ layers: h.layers }); return () => {}; }, setLayerSource: h.setLayerSource },
}));
vi.mock('$lib/stores/vjClipLauncher', () => ({ vjClipLauncher: { relinkClipFiles: h.relinkClipFiles } }));
vi.mock('$lib/stores/media', () => ({
  mediaLibrary: { subscribe: (run: (value: any) => void) => { run(h.items); return () => {}; }, updateItem: h.updateItem },
}));
vi.mock('$lib/stores/missingMedia', () => ({ noteMediaRelinked: h.noteMediaRelinked }));
vi.mock('$lib/storage/assetRegistry', () => ({ pathToFileUrl: (p: string) => `ghost-asset://localhost${p}` }));

import { relinkVideoFile } from '$lib/media/relinkVideoFile';
import { convertForSmoothPlayback, describeRelink } from './playbackConversionFlow';
import { videoDecodeHealth } from './videoDecodeHealth';

class FakeVideo extends EventTarget {
  loop = false; muted = false; playsInline = false; preload = ''; src = ''; crossOrigin = ''; playbackRate = 1;
  readyState = 0; paused = true; currentTime = 0; duration = NaN;
  play = vi.fn(async () => {}); pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new FakeVideo() });
  videoDecodeHealth.set({});
  const oldElement = new FakeVideo();
  h.layers = [
    { id: 'layer-1', source: { id: 's1', type: 'video', name: 'show.mov', src: 'ghost-asset://localhost/show/show.mov',
      isPlaying: false, trimStart: 0.25, playbackMode: 'bounce', _nativePlaybackSeekSeq: 3, videoElement: oldElement } },
    { id: 'layer-2', source: { id: 's2', type: 'video', name: 'other.mov', src: 'ghost-asset://localhost/show/other.mov' } },
    { id: 'layer-3', source: { id: 's3', type: 'image', name: 'show.mov', src: 'ghost-asset://localhost/show/show.mov' } },
  ];
  h.items = [{ id: 'tray-1', type: 'video', name: 'show.mov', src: 'blob:x', _assetRef: { kind: 'local-file', originalPath: '/show/show.mov' } }];
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('convert for smooth playback', () => {
  it('points the layers, clips and tray items that used the file at the converted copy', () => {
    const result = relinkVideoFile('/show/show.mov', '/show/show-playback.mp4');
    expect(result).toEqual({ layers: 1, clips: 2, items: 1 });
    expect(h.relinkClipFiles).toHaveBeenCalledWith({ '/show/show.mov': '/show/show-playback.mp4' });
    const [layerId, source] = h.setLayerSource.mock.calls[0];
    expect(layerId).toBe('layer-1');
    expect(source).toMatchObject({
      type: 'video', name: 'show-playback.mp4', src: 'ghost-asset://localhost/show/show-playback.mp4',
      isPlaying: false, trimStart: 0.25, playbackMode: 'bounce', _nativePlaybackSeekSeq: 4,
      _assetRef: { kind: 'local-file', originalPath: '/show/show-playback.mp4' },
    });
    expect(source.id).not.toBe('s1');
    expect(source.videoElement).toBeInstanceOf(FakeVideo);
    expect(source.videoElement.play).not.toHaveBeenCalled();
    expect(h.layers[0].source.videoElement.pause).toHaveBeenCalled();
    expect(h.updateItem).toHaveBeenCalledWith('tray-1', expect.objectContaining({ src: 'ghost-asset://localhost/show/show-playback.mp4' }));
    expect(h.noteMediaRelinked).toHaveBeenCalledOnce();
  });

  it('converts, relinks, rechecks and says what changed', async () => {
    const toast = vi.fn();
    const recheck = vi.fn(async () => null);
    let progressSeen = 0;
    const convert = vi.fn(async (_path: string, onProgress: (p: { progress: number; message: string }) => void) => {
      onProgress({ progress: 0.5, message: 'Encoding video (50%)...' });
      progressSeen = get(videoDecodeHealth)['/show/show.mov']?.converting?.progress ?? 0;
      return { outputPath: '/show/show-playback.mp4' };
    });
    const relink = vi.fn(() => ({ layers: 1, clips: 2, items: 0 }));
    expect(await convertForSmoothPlayback('/show/show.mov', { convert, relink, toast, recheck })).toBe('/show/show-playback.mp4');
    expect(progressSeen).toBe(0.5);
    expect(relink).toHaveBeenCalledWith('/show/show.mov', '/show/show-playback.mp4');
    expect(recheck).toHaveBeenCalledWith('/show/show-playback.mp4', { force: true });
    expect(toast).toHaveBeenLastCalledWith(
      'Converted show.mov. 1 layer and 2 clips now play show-playback.mp4. Save the project to keep this.', 'info');
    expect(get(videoDecodeHealth)['/show/show.mov']?.converting).toBeUndefined();
  });

  it('reports a failed conversion and leaves the media alone', async () => {
    const toast = vi.fn();
    const relink = vi.fn();
    const convert = vi.fn(async () => { throw new Error('FFmpeg exited with code 1.\nmore'); });
    expect(await convertForSmoothPlayback('/show/x.mov', { convert, relink, toast })).toBeNull();
    expect(relink).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Could not convert x.mov: FFmpeg exited with code 1.', 'error');
  });

  it('warns when HDR could not be tone-mapped', async () => {
    const toast = vi.fn();
    await convertForSmoothPlayback('/show/hdr.mov', {
      convert: async () => ({ outputPath: '/show/hdr-playback.mp4', hdrSkipped: true }),
      relink: () => ({ layers: 0, clips: 1, items: 0 }), toast, recheck: async () => null,
    });
    expect(toast.mock.calls.at(-1)?.[0]).toMatch(/washed out/);
    expect(toast.mock.calls.at(-1)?.[1]).toBe('warning');
  });

  it('lists what was relinked in words', () => {
    expect(describeRelink({ layers: 0, clips: 0, items: 0 })).toBe('');
    expect(describeRelink({ layers: 2, clips: 1, items: 3 })).toBe('2 layers, 1 clip and 3 media items');
  });
});
