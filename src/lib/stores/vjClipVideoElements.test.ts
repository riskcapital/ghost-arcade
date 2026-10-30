import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Every resident VJ grid clip and every trigger used to start a looping,
 * autoplaying Chromium <video> beside the render core's own decoder. In the
 * desktop build those elements load metadata only and are never played.
 */
const h = vi.hoisted(() => {
  const videos: any[] = [];
  class FakeVideo extends EventTarget {
    loop = false; muted = false; playsInline = false; preload = ''; crossOrigin = '';
    readyState = 4; duration = 4; currentTime = 0; paused = true; videoWidth = 64; videoHeight = 36;
    playbackRate = 1; error = null; srcObject = null; _src = '';
    get src() { return this._src; }
    set src(value: string) { this._src = value; }
    play = vi.fn(async () => { this.paused = false; });
    pause = vi.fn(() => { this.paused = true; });
    load = vi.fn();
    removeAttribute = vi.fn();
  }
  const element = (tag: string) => {
    if (tag === 'video') { const video = new FakeVideo(); videos.push(video); return video; }
    return { getContext: () => null, style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} };
  };
  return { videos, element };
});

vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  isDesktopApp: true,
  isElectron: true,
  invoke: vi.fn(async () => null),
}));

vi.stubGlobal('document', {
  createElement: h.element,
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {}, removeChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  documentElement: {
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  visibilityState: 'visible',
});

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear(),
  key: () => null,
  length: 0,
});
vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16));
vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

const { vjClipLauncher } = await import('./vjClipLauncher');
const { keyframeTimeline } = await import('./keyframeTimeline');

afterAll(() => {
  // Triggers start the keyframe transport; stop it before its frames lose rAF.
  keyframeTimeline.stop();
  vi.unstubAllGlobals();
});

describe('VJ clip video elements beside the render core', () => {
  it('never plays resident grid clips or triggered clips, and loads metadata only', async () => {
    const clip = {
      id: 'clip-a', name: 'Clip A', type: 'video' as const, src: '/show/clip-a.mov', thumbnail: '',
    };
    vjClipLauncher.setClip(0, 0, clip as any);
    vjClipLauncher.triggerClip(0, 0);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(h.videos.length).toBeGreaterThan(0);
    for (const video of h.videos) {
      video.dispatchEvent(new Event('loadeddata'));
      expect(video.preload).toBe('metadata');
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    for (const video of h.videos) expect(video.play).not.toHaveBeenCalled();
  });
});
