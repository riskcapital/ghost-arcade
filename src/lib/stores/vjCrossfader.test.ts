import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let store: typeof import('./vjClipLauncher');

// The launcher module touches the DOM and storage when it loads.
function installDomShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const makeEl = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    load() {}, play: () => Promise.resolve(), pause() {},
  });
  (globalThis as any).document = {
    documentElement: makeEl(), body: makeEl(), head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  store = await import('./vjClipLauncher');
});

describe('VJ crossfader position', () => {
  it('moves without touching the launcher state, which picks it up at rest', () => {
    const { vjClipLauncher, vjCrossfader, vjClipLauncherNow } = store;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vjClipLauncher.cutToA();
      let emissions = 0;
      const stop = vjClipLauncher.subscribe(() => { emissions++; });
      emissions = 0;
      vjClipLauncher.setCrossfaderValue(.25);
      vjClipLauncher.setCrossfaderValue(.4);
      expect(get(vjCrossfader)).toBe(.4);
      expect(vjClipLauncherNow().crossfaderValue).toBe(.4);
      expect(emissions).toBe(0);
      expect(get(vjClipLauncher).crossfaderValue).toBe(0);
      vi.advanceTimersByTime(200);
      expect(emissions).toBe(1);
      expect(get(vjClipLauncher).crossfaderValue).toBe(.4);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries a moving fader into any other launcher change, and follows cuts', () => {
    const { vjClipLauncher, vjCrossfader } = store;
    vjClipLauncher.cutToA();
    vjClipLauncher.setCrossfaderValue(.7);
    vjClipLauncher.setMasterOpacity(.5);
    expect(get(vjClipLauncher).crossfaderValue).toBe(.7);
    expect(get(vjClipLauncher).masterOpacity).toBe(.5);
    vjClipLauncher.cutToB();
    expect(get(vjCrossfader)).toBe(1);
    expect(get(vjClipLauncher).crossfaderValue).toBe(1);
    vjClipLauncher.setMasterOpacity(1);
  });

  it('notifies a slice only when its part of the state is replaced', () => {
    const { vjClipLauncher, vjSlice } = store;
    const grids: unknown[] = [];
    const stop = vjSlice(state => state.clipGrid).subscribe(grid => grids.push(grid));
    vjClipLauncher.setMasterOpacity(.8);
    vjClipLauncher.setMasterOpacity(1);
    expect(grids).toHaveLength(1);
    expect(grids[0]).toBe(get(vjClipLauncher).clipGrid);
    stop();
  });
});
