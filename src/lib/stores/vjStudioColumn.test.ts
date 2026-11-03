import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

// The launcher store expects a browser; the same shim the layer tests use.
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
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).CustomEvent ??= class extends Event {
    detail: unknown;
    constructor(name: string, options: any) { super(name); this.detail = options.detail; }
  };
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(() => installDomShim());

describe('a Music Studio on the deck', () => {
  it('keeps playing when a column fires with nothing in its row', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    const studio = { id: 'studio', type: 'effect' as const, name: 'Music Studio', src: 'plugin://music-studio', effectSource: { effectType: 'music-studio' } };
    const other = { id: 'clip', type: 'color' as const, name: 'Colour', src: '' };
    vjClipLauncher.setClip(0, 0, studio as any, 'A');
    vjClipLauncher.setClip(1, 1, other as any, 'A');
    vjClipLauncher.triggerClipNow(0, 0, 'A');
    vjClipLauncher.triggerColumnNow(1, 'A');
    const rows = get(vjClipLauncher).layerStates;
    expect(rows[0].activeClip?.id).toBe('studio');
    expect(rows[1].activeClip?.id).toBe('clip');
  });

  it('gives way to a clip of its own row in the fired column', async () => {
    const { vjClipLauncher } = await import('./vjClipLauncher');
    vjClipLauncher.setClip(0, 2, { id: 'mine', type: 'color', name: 'Colour', src: '' } as any, 'A');
    vjClipLauncher.triggerColumnNow(2, 'A');
    expect(get(vjClipLauncher).layerStates[0].activeClip?.id).toBe('mine');
  });
});
