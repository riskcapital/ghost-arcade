import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Clip runtime (pooled <video> elements, cached render sources, hidden
 * pages) is released once no grid, block, deck slot or transition holds the
 * clip, and a queued launch does not rewrite the launcher state every frame
 * while it waits.
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
    removeAttribute = vi.fn((name: string) => { if (name === 'src') this._src = ''; });
  }
  const element = (tag: string) => {
    if (tag === 'video') { const video = new FakeVideo(); videos.push(video); return video; }
    return { getContext: () => null, style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove: vi.fn() };
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
  clear: () => storage.clear(), key: () => null, length: 0,
});
vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16));
vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

const { vjClipLauncher, vjOutputLayers } = await import('./vjClipLauncher');
const { getThreeJSIframeContext } = await import('../renderer/engine');
const { keyframeTimeline } = await import('./keyframeTimeline');
const { get } = await import('svelte/store');

afterAll(() => {
  // Triggers start the keyframe transport; stop it before its frames lose rAF.
  keyframeTimeline.stop();
  vi.unstubAllGlobals();
});

const video = (id: string) => ({ id, type: 'video', name: id, src: `/media/${id}.mov`, durationSeconds: 4, videoWidth: 64, videoHeight: 36 }) as any;
const loaded = (id: string) => h.videos.some(v => v._src === `/media/${id}.mov`);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const state = () => get(vjClipLauncher);

beforeEach(() => {
  vjClipLauncher.reset();
  h.videos.length = 0;
});

describe('clip runtime release', () => {
  it('releases a deleted block’s clips unless a deck is still playing one', async () => {
    vjClipLauncher.addBlock('Second');
    const second = state().blocks[1].id;
    vjClipLauncher.setActiveBlock(second);
    for (let c = 0; c < 4; c++) vjClipLauncher.setClip(1, c, video(`b${c}`));
    vjClipLauncher.setClip(0, 0, video('playing'), 'B');
    vjClipLauncher.triggerClipNow(0, 0, 'B');
    expect(loaded('b0') && loaded('b3') && loaded('playing')).toBe(true);

    vjClipLauncher.deleteBlock(second);
    await settle();

    for (let c = 0; c < 4; c++) expect(loaded(`b${c}`)).toBe(false);
    expect(loaded('playing')).toBe(true);
  });

  it('releases a removed row’s and a removed column’s clips', () => {
    for (let c = 0; c < 3; c++) vjClipLauncher.setClip(3, c, video(`row${c}`));
    vjClipLauncher.setClip(0, 7, video('col'));
    vjClipLauncher.setClip(1, 7, video('col-b'), 'B');

    vjClipLauncher.removeLayer(3);
    vjClipLauncher.removeColumn(7);

    for (let c = 0; c < 3; c++) expect(loaded(`row${c}`)).toBe(false);
    expect(loaded('col')).toBe(false);
    expect(loaded('col-b')).toBe(false);
  });

  it('keeps a clip that another block still holds', () => {
    vjClipLauncher.setClip(0, 0, video('shared'));
    vjClipLauncher.duplicateBlock(state().activeBlockId);
    vjClipLauncher.clearClip(0, 0);
    expect(loaded('shared')).toBe(true);
  });

  it('does not pile up elements for transient launches with fresh ids', async () => {
    vjClipLauncher.setOpen(true, { fromWorkspace: true });
    vjClipLauncher.setLive(true);
    const unsubscribe = vjOutputLayers.subscribe(() => {});
    for (let i = 0; i < 20; i++) {
      vjClipLauncher.launchTransientClip(0, video(`pad-${i}`));
      await settle();
    }
    unsubscribe();
    expect(h.videos.filter(v => v._src).map(v => v._src)).toEqual(['/media/pad-19.mov']);

    vjClipLauncher.stopLayer(0);
    await settle();
    expect(h.videos.filter(v => v._src)).toEqual([]);
  });

  it('disposes a built-in Three.js clip page once its cell is cleared', () => {
    vjClipLauncher.setClip(2, 2, { id: 'three', type: 'threejs', name: 'T', src: '/demo.html' } as any);
    const page = getThreeJSIframeContext('three');
    expect(page).toBeDefined();
    vjClipLauncher.clearClip(2, 2);
    expect(getThreeJSIframeContext('three')).toBeUndefined();
    expect((page!.iframe as any).remove).toHaveBeenCalled();
  });
});

describe('quantized launch queue', () => {
  it('leaves the store alone until the queued launch fires', async () => {
    vjClipLauncher.setClip(0, 0, video('queued'));
    vjClipLauncher.setQuantization('4bar');
    let emissions = 0;
    const unsubscribe = vjClipLauncher.subscribe(() => { emissions++; });
    emissions = 0;
    vjClipLauncher.triggerClip(0, 0);
    expect(state().pendingTriggers).toHaveLength(1);
    const queued = emissions;
    await new Promise(resolve => setTimeout(resolve, 300));
    unsubscribe();
    expect(emissions).toBe(queued);
    expect(state().pendingTriggers).toHaveLength(1);
  });

  it('still fires on the boundary', async () => {
    vjClipLauncher.setClip(0, 0, video('beat'));
    vjClipLauncher.setQuantization('1/4');
    vjClipLauncher.triggerClip(0, 0);
    const deadline = performance.now() + 3000;
    while (state().layerStates[0].activeClip?.id !== 'beat' && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(state().layerStates[0].activeClip?.id).toBe('beat');
    expect(state().pendingTriggers).toHaveLength(0);
  });
});
