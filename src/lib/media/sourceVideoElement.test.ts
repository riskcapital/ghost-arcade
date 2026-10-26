import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Beside the render core a source <video> element is metadata only: it must
 * never be started for its picture, or every VJ grid clip and mapping layer
 * is decoded twice (once by the core, once by Chromium for nothing).
 */
const mode = vi.hoisted(() => ({ desktop: true }));
vi.mock('$lib/bridge', () => ({ get isDesktopApp() { return mode.desktop; } }));
vi.mock('$lib/stores/settings', () => ({ NATIVE_ENGINE_ONLY: true }));

import {
  configureSourceVideoElement,
  playSourceVideoElement,
  sourceVideoPreload,
  startSourceVideoElement,
} from './sourceVideoElement';
import { restoreVideoSourceElement } from './videoSourceRestore';

class FakeVideo extends EventTarget {
  loop = false; muted = false; playsInline = false; preload = ''; src = ''; crossOrigin = '';
  playbackRate = 1; readyState = 0; duration = 4; currentTime = 0; paused = true; error = null;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn();
}

beforeEach(() => { mode.desktop = true; });
afterEach(() => vi.clearAllMocks());

describe('source video elements beside the render core', () => {
  it('load metadata only and are never played for their picture', async () => {
    const video = configureSourceVideoElement(new FakeVideo() as unknown as HTMLVideoElement);
    expect(video.preload).toBe('metadata');
    expect([video.loop, video.muted, video.playsInline]).toEqual([true, true, true]);
    expect(await startSourceVideoElement(video)).toBe(true);
    playSourceVideoElement(video);
    expect((video as unknown as FakeVideo).play).not.toHaveBeenCalled();
  });

  it('do not start a restored mapping layer, even once it has loaded', async () => {
    const video = new FakeVideo();
    const source: any = { id: 's', type: 'video', src: 'ghost-asset://clip.mov', name: 'clip.mov' };
    restoreVideoSourceElement(source, () => video as unknown as HTMLVideoElement);
    video.readyState = 4;
    video.dispatchEvent(new Event('loadeddata'));
    video.dispatchEvent(new Event('canplay'));
    await Promise.resolve();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.preload).toBe('metadata');
    // The layer still counts as playing: the core plays the file.
    expect(source.isPlaying).toBe(true);
    expect(source.videoElement).toBe(video);
  });

  it('keep playing in the browser build, where the element is the picture', async () => {
    mode.desktop = false;
    expect(sourceVideoPreload()).toBe('auto');
    const video = new FakeVideo();
    expect(await startSourceVideoElement(video as unknown as HTMLVideoElement)).toBe(true);
    expect(video.play).toHaveBeenCalledOnce();
    const restored = new FakeVideo();
    restoreVideoSourceElement({ id: 'r', type: 'video', src: 'blob:clip', name: 'clip' } as any,
      () => restored as unknown as HTMLVideoElement);
    restored.dispatchEvent(new Event('loadeddata'));
    expect(restored.play).toHaveBeenCalled();
  });

  it('report a browser autoplay refusal as not playing in the browser build only', async () => {
    mode.desktop = false;
    const refused = new FakeVideo();
    refused.play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    expect(await startSourceVideoElement(refused as unknown as HTMLVideoElement)).toBe(false);
  });
});
