import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeControlPath } from '../control/controlPaths';

/**
 * OSC bindings restored from a saved project must not be able to break
 * anything downstream.
 *
 * hydrate used to pass saved bindings through as-is. A binding with no `path`
 * made normalizeControlPath call `.trim()` on undefined, which threw inside
 * importProject and failed the entire project load over one malformed OSC
 * row. Missing or repeated ids went straight into the Settings panel's keyed
 * each block, which in a release build silently reuses the wrong row. This
 * app's own saves always write both, but a project is a file, and files get
 * edited, merged and imported.
 */

let oscStore: typeof import('./oscStore').oscStore;

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

beforeAll(async () => {
  installDomShim();
  // Evaluate the store graph in the order the app does. Importing oscStore
  // first reaches midiRouter's late-bound setters before their declarations
  // have run, a TDZ ReferenceError; layers pulls the graph in the working
  // order, the same entry point layerPersistence.test.ts uses.
  await import('../stores/layers');
  ({ oscStore } = await import('./oscStore'));
});

function bindingsNow() {
  let value: any;
  oscStore.subscribe((s) => { value = s; })();
  return value.bindings as Array<{ id: string; path: string; address?: string }>;
}

describe('OSC binding hydration', () => {
  it('names the hazard it guards against', () => {
    // The pre-fix hydrate called this directly on every saved binding.
    expect(() => normalizeControlPath(undefined as unknown as string)).toThrow();
  });

  it('does not throw on a binding with no path or a non-string path', () => {
    expect(() => oscStore.hydrate({
      bindings: [
        { address: '/no-path' } as any,
        { address: '/numeric-path', path: 42 } as any,
      ],
    })).not.toThrow();
    for (const b of bindingsNow()) expect(typeof b.path).toBe('string');
  });

  it('gives every binding a unique, non-empty id', () => {
    oscStore.hydrate({
      bindings: [
        { id: 'dup', address: '/a', path: 'vj:0:opacity' },
        { id: 'dup', address: '/b', path: 'vj:1:opacity' },
        { address: '/c', path: 'vj:2:opacity' },
        { id: '   ', address: '/d', path: 'vj:3:opacity' },
      ] as any,
    });
    const ids = bindingsNow().map((b) => b.id);
    expect(ids).toHaveLength(4);
    expect(ids.every((id) => typeof id === 'string' && id.trim().length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps valid ids rather than regenerating them', () => {
    // Other state can refer to a binding by id; rewriting good ones would
    // quietly orphan those references.
    oscStore.hydrate({
      bindings: [
        { id: 'keep-1', address: '/a', path: 'vj:0:opacity' },
        { id: 'keep-2', address: '/b', path: 'vj:1:opacity' },
      ] as any,
    });
    expect(bindingsNow().map((b) => b.id)).toEqual(['keep-1', 'keep-2']);
  });

  it('drops rows that are not objects and tolerates a non-array', () => {
    oscStore.hydrate({ bindings: [null, 42, 'x', { address: '/ok', path: 'vj:0:opacity' }] as any });
    expect(bindingsNow().map((b) => b.address)).toEqual(['/ok']);

    oscStore.hydrate({ bindings: 'not-an-array' as any });
    expect(bindingsNow()).toEqual([]);
  });
});
