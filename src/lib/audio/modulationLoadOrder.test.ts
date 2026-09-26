import { beforeAll, describe, expect, it, vi } from 'vitest';

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
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(installDomShim);

// layers.ts registers its modulation callbacks at module load, and
// modulation.ts reaches layers.ts back through vjClipLauncher. The slice
// windows load both in parallel, so either module can be evaluated first.
describe('modulation / layers load order', () => {
  it('loads with modulation first', async () => {
    vi.resetModules();
    await expect(import('./modulation')).resolves.toBeTruthy();
    await expect(import('../stores/layers')).resolves.toBeTruthy();
  });

  it('loads with layers first', async () => {
    vi.resetModules();
    await expect(import('../stores/layers')).resolves.toBeTruthy();
    await expect(import('./modulation')).resolves.toBeTruthy();
  });

  it('loads both in parallel', async () => {
    vi.resetModules();
    await expect(Promise.all([import('./modulation'), import('../stores/layers')])).resolves.toHaveLength(2);
  });
});
