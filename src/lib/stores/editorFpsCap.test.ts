import { get } from 'svelte/store';
import { beforeEach, expect, it, vi } from 'vitest';

// The editor frame-rate cap defaults to 60. Installs that saved the old
// default (uncapped) move to 60 once; a later choice of Uncapped is kept.
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.resetModules();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { style: { setProperty: () => {} } } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) },
  });
});

const editorCap = async () => get((await import('./settings')).settings).performance.editorMaxFps;

it('caps a new install at 60', async () => {
  expect(await editorCap()).toBe(60);
});

it('moves a saved uncapped setting to 60 once, then keeps a choice of uncapped', async () => {
  storage.set('ghost-arcade_settings', JSON.stringify({ performance: { editorMaxFps: 0 } }));
  expect(await editorCap()).toBe(60);
  // The user picks Uncapped again; the next launch keeps it.
  const saved = JSON.parse(storage.get('ghost-arcade_settings')!);
  saved.performance.editorMaxFps = 0;
  storage.set('ghost-arcade_settings', JSON.stringify(saved));
  vi.resetModules();
  expect(await editorCap()).toBe(0);
});

it('leaves a chosen 30 fps cap alone', async () => {
  storage.set('ghost-arcade_settings', JSON.stringify({ performance: { editorMaxFps: 30 } }));
  expect(await editorCap()).toBe(30);
});
