/**
 * Every Audio Lab entry point asks the licence (addons/addonAccess.ts):
 * the studio store, the studio view key, its MIDI/OSC controls and paths,
 * band keys, and the Timeline/plugin layers (plugins/addons.test.ts).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

beforeAll(() => {
  const storage = new Map<string, string>();
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
    value: { activeElement: null, documentElement: { style: { setProperty: () => {} } }, addEventListener: () => {}, removeEventListener: () => {} },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
});

// No Web Audio here: every engine call is a no-op.
vi.mock('../music/audioEngine', () => ({
  MusicAudioEngine: class {
    constructor() {
      return new Proxy(this, { get: (_t, key) => (key === 'then' ? undefined : () => 0) });
    }
  },
}));

async function load(unlocked: boolean) {
  vi.resetModules();
  const access = await import('./addonAccess');
  access.setAddonsStatusForTests({ 'addon.audio-lab': unlocked });
  return {
    access,
    studio: await import('../music/musicStudioStore'),
    controls: await import('../music/studioControls'),
    deck: await import('../music/studioDeck'),
    paths: await import('../control/controlPaths'),
    inputs: await import('../midi/midiInputs'),
  };
}

const backquote = () => ({ code: 'Backquote', repeat: false, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) as KeyboardEvent;
const keysDevice = [{ id: 'k1', name: 'Keys', state: 'connected' }] as never[];
const keysSetup = [{ name: 'Keys', use: 'keys' }] as never[];

describe('Audio Lab locked', () => {
  it('never opens; asking for it offers the add-on instead', async () => {
    const m = await load(false);
    m.studio.musicStudio.open();
    m.studio.musicStudio.toggleOpen();
    m.studio.musicStudio.setStudioView(true);
    expect(get(m.studio.musicStudio).isOpen).toBe(false);
    expect(get(m.access.addonOffer)).toEqual({ product: 'addon.audio-lab', step: 'offer' });
  });

  it('leaves the studio view key alone', async () => {
    const m = await load(false);
    expect(m.deck.isStudioViewKey(backquote())).toBe(false);
  });

  it('offers no studio controls to MIDI, OSC, DMX or MCP, and lists none of its paths', async () => {
    const m = await load(false);
    expect(m.controls.studioControls()).toEqual([]);
    expect(m.controls.studioControl('studio.view')).toBeUndefined();
    expect(m.controls.runStudioControl('studio.view', 1)).toBe(false);
    expect(m.paths.controlPathExamples().some((e) => e.path.startsWith('studio:'))).toBe(false);
  });

  it('treats band keys as a controller', async () => {
    const m = await load(false);
    const inUse = m.inputs.resolveMidiInputs(keysDevice, keysSetup, null);
    expect(inUse.keys).toEqual([]);
    expect(inUse.control).toEqual(['k1']);
  });
});

describe('Audio Lab unlocked', () => {
  it('opens', async () => {
    const m = await load(true);
    m.studio.musicStudio.open();
    expect(get(m.studio.musicStudio).isOpen).toBe(true);
    expect(get(m.access.addonOffer)).toBeNull();
  });

  it('answers the studio view key, its controls and its paths', async () => {
    const m = await load(true);
    expect(m.deck.isStudioViewKey(backquote())).toBe(true);
    expect(m.controls.studioControl('studio.view')).toBeDefined();
    expect(m.paths.controlPathExamples().some((e) => e.path.startsWith('studio:'))).toBe(true);
  });

  it('plays band keys', async () => {
    const m = await load(true);
    expect(m.inputs.resolveMidiInputs(keysDevice, keysSetup, null).keys).toEqual(['k1']);
  });
});
