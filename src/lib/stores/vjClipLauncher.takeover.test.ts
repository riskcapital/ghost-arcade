import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A show takeover runs the VJ feeds without VJ mode being live: the clip
 * layers exist, clip transitions run, VJ mode's own output choice is left
 * alone.
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

const { vjClipLauncher, vjOutputLayers, vjTransitionOutputLayers, vjFeedsRunning } = await import('./vjClipLauncher');
const { vjClipTransitions } = await import('./vjClipTransitions');
const { keyframeTimeline } = await import('./keyframeTimeline');
const { get } = await import('svelte/store');

afterAll(() => {
  keyframeTimeline.stop();
  vi.unstubAllGlobals();
});

const shader = (id: string) => ({ id, type: 'shader', name: id, src: `./ISF/${id}.fs`, shaderCode: 'void main(){}' }) as any;
const state = () => get(vjClipLauncher);

beforeEach(() => {
  vjClipLauncher.reset();
  vjClipTransitions.clear();
});

describe('takeoverLive', () => {
  it('vjFeedsRunning is live or takeover', () => {
    expect(vjFeedsRunning({ isLive: false, takeoverLive: false })).toBe(false);
    expect(vjFeedsRunning({ isLive: true, takeoverLive: false })).toBe(true);
    expect(vjFeedsRunning({ isLive: false, takeoverLive: true })).toBe(true);
  });

  it('builds the row layers with VJ mode closed while a takeover needs them', () => {
    vjClipLauncher.setClip(1, 0, shader('blue'));
    vjClipLauncher.triggerClipNow(1, 0, 'A');
    const unsubscribe = vjOutputLayers.subscribe(() => {});
    expect(get(vjOutputLayers)).toBeNull();
    vjClipLauncher.setTakeoverLive(true);
    expect(state().isLive).toBe(false);
    expect(state().isOpen).toBe(false);
    expect(get(vjOutputLayers)?.map((l) => l.id)).toEqual(['vj-layer-1']);
    vjClipLauncher.setTakeoverLive(false);
    expect(get(vjOutputLayers)).toBeNull();
    unsubscribe();
  });

  it('runs clip transitions on a row a takeover samples', () => {
    vjClipLauncher.setClip(0, 0, shader('red'));
    vjClipLauncher.setClip(0, 1, shader('blue'));
    vjClipLauncher.setLayerTransition(0, { duration: 2, style: 'dissolve' });
    vjClipLauncher.triggerClipNow(0, 0, 'A');
    // Not live, no takeover: a cut.
    vjClipLauncher.triggerClipNow(0, 1, 'A');
    expect(get(vjClipTransitions).size).toBe(0);
    vjClipLauncher.setTakeoverLive(true);
    vjClipLauncher.triggerClipNow(0, 0, 'A');
    expect([...get(vjClipTransitions).values()].map((t) => [t.layerIndex, t.duration])).toEqual([[0, 2]]);
    expect(get(vjTransitionOutputLayers).length).toBe(1);
  });

  it("VJ mode's Live toggle leaving does not end a takeover's transitions; ending the takeover does", () => {
    vjClipLauncher.setClip(0, 0, shader('red'));
    vjClipLauncher.setClip(0, 1, shader('blue'));
    vjClipLauncher.setLayerTransition(0, { duration: 2, style: 'dissolve' });
    vjClipLauncher.setOpen(true, { fromWorkspace: true });
    vjClipLauncher.setLive(true);
    vjClipLauncher.setTakeoverLive(true);
    vjClipLauncher.triggerClipNow(0, 0, 'A');
    vjClipLauncher.triggerClipNow(0, 1, 'A');
    expect(get(vjClipTransitions).size).toBe(1);
    vjClipLauncher.setLive(false);
    expect(get(vjClipTransitions).size).toBe(1);
    vjClipLauncher.setOpen(false, { fromWorkspace: true });
    expect(get(vjClipTransitions).size).toBe(1);
    vjClipLauncher.setTakeoverLive(false);
    expect(get(vjClipTransitions).size).toBe(0);
  });

});
