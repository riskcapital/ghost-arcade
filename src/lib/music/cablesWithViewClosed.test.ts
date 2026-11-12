/**
 * Patch cables belong to the set, not to the Studio view: a cable keeps
 * moving its destination with the view closed (the tray, the deck, another
 * mode), and stops when it is unplugged.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let runtime: typeof import('./musicRuntime');
let store: typeof import('./musicStudioStore');
let macroStore: typeof import('../stores/macros');

function installShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const el = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], getContext: () => null,
  });
  (globalThis as any).document = {
    documentElement: el(), body: el(), head: el(), createElement: () => el(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = () => 0;
  (globalThis as any).cancelAnimationFrame = () => {};
}

beforeAll(async () => {
  installShim();
  runtime = await import('./musicRuntime');
  store = await import('./musicStudioStore');
  macroStore = await import('../stores/macros');
});

describe('patch cables with the Studio view closed', () => {
  it('a cable still moves its macro, and lets go when unplugged', () => {
    const { musicStudio } = store;
    const { macros } = macroStore;
    const macro = get(macros).macros[0];
    expect(macro).toBeTruthy();
    macros.setMacroValue(macro.id, 0.1);

    musicStudio.close();
    expect(get(musicStudio).studioView).toBe(false);
    musicStudio.setParam('xy.x', 0.9);
    musicStudio.connectCable({ id: 'xy-to-macro', from: 'cv:xy.x', to: `dest:macro:${macro.id}` });
    expect(get(musicStudio).cables[get(musicStudio).set].some((c) => c.id === 'xy-to-macro')).toBe(true);

    // A cable follows its source over a few frames.
    for (let i = 0; i < 30; i++) runtime.routeControlCables();
    const driven = get(macros).macros.find((m) => m.id === macro.id)!.value;
    expect(driven).toBeGreaterThan(0.5);

    // Unplugged: the knob goes back to where it was before the cable took it.
    musicStudio.disconnectCable('xy-to-macro');
    runtime.routeControlCables();
    expect(get(macros).macros.find((m) => m.id === macro.id)!.value).toBeCloseTo(0.1, 5);
  });
});
