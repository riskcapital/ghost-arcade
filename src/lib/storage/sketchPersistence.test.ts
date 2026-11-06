import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSAnimationSource } from '../types';

/**
 * Imported p5.js sketches outlive the session: the sketch library and the
 * crash-recovery snapshot both keep them in IndexedDB when localStorage is
 * too small. Node has no IndexedDB, so these run against a small in-memory
 * one that behaves the same for the calls the stores make. Tests that load
 * the presets store afresh allow for its first, slower import.
 */

function memoryIndexedDb() {
  const databases = new Map<string, Map<string, { keyPath?: string; rows: Map<unknown, unknown> }>>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  return {
    open(name: string) {
      const request: any = {};
      later(() => {
        const fresh = !databases.has(name);
        if (fresh) databases.set(name, new Map());
        const stores = databases.get(name)!;
        const db = {
          objectStoreNames: { contains: (store: string) => stores.has(store) },
          createObjectStore: (store: string, options?: { keyPath?: string }) => stores.set(store, { keyPath: options?.keyPath, rows: new Map() }),
          close: () => {},
          transaction(storeName: string) {
            const tx: any = {};
            const target = stores.get(storeName)!;
            const done = (result: unknown) => {
              const req: any = { result };
              later(() => tx.oncomplete?.());
              return req;
            };
            tx.objectStore = () => ({
              put: (value: unknown, key?: unknown) => {
                const id = target.keyPath ? (value as Record<string, unknown>)[target.keyPath] : key;
                target.rows.set(id, structuredClone(value));
                return done(id);
              },
              get: (key: unknown) => done(structuredClone(target.rows.get(key))),
              getAll: () => done([...target.rows.values()].map((v) => structuredClone(v))),
              count: (key: unknown) => done(target.rows.has(key) ? 1 : 0),
              delete: (key: unknown) => {
                target.rows.delete(key);
                return done(undefined);
              },
            });
            return tx;
          },
        };
        request.result = db;
        if (fresh) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function memoryStorage(limit = Infinity) {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > limit) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('the sketch library', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', memoryIndexedDb());
  });
  afterEach(() => vi.unstubAllGlobals());

  const source: JSAnimationSource = {
    animationType: 'p5js',
    htmlCode: '<html><!-- p5.js sketch "Orbit" --></html>',
    sketch: { files: [{ path: 'sketch.js', text: 'function draw() {}' }, { path: 'assets/song.mp3', base64: 'SUQz'.repeat(500_000) }] },
    origin: { kind: 'p5-editor', sketchName: 'Orbit', importedFrom: 'zip', importedAt: 1 },
  };

  it('keeps a sketch with its files across launches, under its tray id', async () => {
    const library = await import('../stores/sketchLibrary');
    expect(await library.saveSketch({ id: 'item-1', name: 'Orbit', jsAnimation: source, addedAt: 2 })).toBe(true);
    await library.saveSketch({ id: 'item-0', name: 'Older', jsAnimation: source, addedAt: 1 });
    const stored = await library.loadSketches();
    expect(stored.map((s) => s.id)).toEqual(['item-0', 'item-1']);
    expect(stored[1].jsAnimation).toEqual(source);
  });

  it('takes a thumbnail or an edit later, and forgets a removed sketch', async () => {
    const library = await import('../stores/sketchLibrary');
    await library.saveSketch({ id: 'item-1', name: 'Orbit', jsAnimation: source, addedAt: 1 });
    await library.updateSketch('item-1', { thumbnail: 'data:image/jpeg;base64,xx' });
    await library.updateSketch('not-a-sketch', { thumbnail: 'ignored' });
    expect((await library.loadSketches()).map((s) => [s.id, s.thumbnail])).toEqual([['item-1', 'data:image/jpeg;base64,xx']]);
    await library.removeSketch('item-1');
    expect(await library.loadSketches()).toEqual([]);
  });

  it('stores a plain copy, whatever the tray handed it', async () => {
    const library = await import('../stores/sketchLibrary');
    const withExtras = { ...source, notStorable: () => 1 } as unknown as JSAnimationSource;
    expect(await library.saveSketch({ id: 'item-2', name: 'Orbit', jsAnimation: withExtras, addedAt: 1 })).toBe(true);
    expect((await library.loadSketches())[0].jsAnimation).toEqual(source);
  });
});

describe('the crash-recovery snapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', memoryIndexedDb());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stays in localStorage while the project fits', async () => {
    vi.stubGlobal('localStorage', memoryStorage(1000));
    const store = await import('./autosaveStore');
    expect(await store.writeAutosave('{"small":true}')).toBe('localStorage');
    expect(store.hasAutosave()).toBe(true);
    expect(await store.readAutosave()).toBe('{"small":true}');
  });

  it('goes to IndexedDB whole when the project is too large, and comes back from there', async () => {
    const local = memoryStorage(1000);
    vi.stubGlobal('localStorage', local);
    const store = await import('./autosaveStore');
    const big = JSON.stringify({ sketch: 'x'.repeat(5000) });
    expect(await store.writeAutosave(big)).toBe('indexedDB');
    expect(local.getItem('ghostarcade-autosave')).toBe(store.AUTOSAVE_IN_INDEXEDDB);
    expect(store.hasAutosave()).toBe(true);
    expect(await store.readAutosave()).toBe(big);
    // Small again: back in localStorage, and the large copy is gone.
    expect(await store.writeAutosave('{"small":true}')).toBe('localStorage');
    expect(await store.readAutosave()).toBe('{"small":true}');
  });

  it('forgets the snapshot in both places', async () => {
    vi.stubGlobal('localStorage', memoryStorage(1000));
    const store = await import('./autosaveStore');
    await store.writeAutosave('y'.repeat(5000));
    store.clearAutosaveSnapshot();
    await settle();
    expect(store.hasAutosave()).toBe(false);
    expect(await store.readAutosave()).toBeNull();
  });

  it('does not bring back a snapshot cleared while it was being written', async () => {
    vi.stubGlobal('localStorage', memoryStorage(1000));
    const store = await import('./autosaveStore');
    const writing = store.writeAutosave('z'.repeat(5000));
    store.clearAutosaveSnapshot();
    await writing;
    expect(store.hasAutosave()).toBe(false);
  });
});

describe('a localStorage value that outgrows localStorage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', memoryIndexedDb());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps writes in the order they were made', async () => {
    vi.stubGlobal('localStorage', memoryStorage(1000));
    const { spilloverValue } = await import('./spilloverStorage');
    const value = spilloverValue('k');
    const results = await Promise.all([value.write('a'.repeat(5000)), value.write('b'.repeat(4000)), value.write('small')]);
    expect(results).toEqual(['indexedDB', 'indexedDB', 'localStorage']);
    expect(await value.read()).toBe('small');
  });

  it('gives global stage presets their full list back, sketches included, after a launch', async () => {
    const local = memoryStorage(1000);
    vi.stubGlobal('localStorage', local);
    const sketchPreset = { id: 'p1', name: 'With sketch', layers: [{ source: { jsAnimation: { sketch: { files: [{ path: 'a.mp3', base64: 'x'.repeat(5000) }] } } } }] };
    const { spilloverValue } = await import('./spilloverStorage');
    await spilloverValue('ghost-arcade_global_stage_presets').write(JSON.stringify([sketchPreset]));

    vi.resetModules();
    const { globalStagePresets } = await import('../stores/globalPresets');
    const read = () => { let list: any[] = []; globalStagePresets.subscribe((v) => { list = v; })(); return list; };
    // Added while the stored list is still on its way.
    globalStagePresets.add({ id: 'p2', name: 'Added at launch', layers: [] } as any);
    await settle();
    await settle();
    expect(read().map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(read()[0].layers[0].source.jsAnimation.sketch.files[0].base64).toHaveLength(5000);
    // And the merged list is what is stored now.
    await settle();
    expect(JSON.parse((await spilloverValue('ghost-arcade_global_stage_presets').read())!).map((p: any) => p.id)).toEqual(['p1', 'p2']);
  }, 20_000);
});

describe('a large value with room to spare in localStorage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', memoryIndexedDb());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('still goes to IndexedDB, so launches and autosaves stay quick', async () => {
    const local = memoryStorage();
    vi.stubGlobal('localStorage', local);
    const { spilloverValue, LOCAL_STORAGE_MAX_CHARS, SPILLED_TO_INDEXEDDB } = await import('./spilloverStorage');
    const value = spilloverValue('k');
    expect(await value.write('x'.repeat(LOCAL_STORAGE_MAX_CHARS + 1))).toBe('indexedDB');
    expect(local.getItem('k')).toBe(SPILLED_TO_INDEXEDDB);
    expect(await value.write('x'.repeat(LOCAL_STORAGE_MAX_CHARS))).toBe('localStorage');
  });
});

describe('without IndexedDB', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a large value in localStorage rather than losing it', async () => {
    const broken = { open: () => { const request: any = {}; setTimeout(() => { request.error = new DOMException('Internal error opening backing store', 'UnknownError'); request.onerror?.(); }, 0); return request; } };
    vi.stubGlobal('indexedDB', broken);
    vi.stubGlobal('localStorage', memoryStorage());
    const { spilloverValue, LOCAL_STORAGE_MAX_CHARS } = await import('./spilloverStorage');
    const value = spilloverValue('k');
    const big = 'x'.repeat(LOCAL_STORAGE_MAX_CHARS + 10);
    expect(await value.write(big)).toBe('localStorage');
    expect(await value.read()).toBe(big);
  });

  it('says so when neither can hold it', async () => {
    const broken = { open: () => { const request: any = {}; setTimeout(() => { request.error = new DOMException('no', 'UnknownError'); request.onerror?.(); }, 0); return request; } };
    vi.stubGlobal('indexedDB', broken);
    vi.stubGlobal('localStorage', memoryStorage(10));
    const { spilloverValue } = await import('./spilloverStorage');
    await expect(spilloverValue('k').write('x'.repeat(100))).rejects.toBeTruthy();
  });
});

describe('after a crash that lost localStorage writes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', memoryIndexedDb());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('still finds and recovers a snapshot kept in IndexedDB', async () => {
    const local = memoryStorage(1000);
    vi.stubGlobal('localStorage', local);
    const store = await import('./autosaveStore');
    const big = 'p'.repeat(5000);
    await store.writeAutosave(big);
    // The marker never reached disk.
    local.removeItem('ghostarcade-autosave');
    vi.resetModules();
    const relaunched = await import('./autosaveStore');
    expect(relaunched.hasAutosave()).toBe(false);
    expect(await relaunched.findAutosave()).toBe(true);
    expect(await relaunched.readAutosave()).toBe(big);
  });

  it('never offers a snapshot that was cleared, or replaced by a smaller one', async () => {
    vi.stubGlobal('localStorage', memoryStorage(1000));
    const store = await import('./autosaveStore');
    await store.writeAutosave('q'.repeat(5000));
    await store.writeAutosave('{"small":true}');
    expect(await store.findAutosave()).toBe(false);
    await store.writeAutosave('r'.repeat(5000));
    store.clearAutosaveSnapshot();
    await settle();
    expect(await store.findAutosave()).toBe(false);
  });

  it('gives global stage presets back from IndexedDB when localStorage lost them', async () => {
    const local = memoryStorage(1000);
    vi.stubGlobal('localStorage', local);
    const { spilloverValue } = await import('./spilloverStorage');
    await spilloverValue('ghost-arcade_global_stage_presets').write(JSON.stringify([{ id: 'p1', name: 'Big', layers: [], pad: 'x'.repeat(5000) }]));
    local.removeItem('ghost-arcade_global_stage_presets');
    vi.resetModules();
    const { globalStagePresets } = await import('../stores/globalPresets');
    await settle();
    await settle();
    let list: any[] = [];
    globalStagePresets.subscribe((v) => { list = v; })();
    expect(list.map((p) => p.id)).toEqual(['p1']);
  }, 20_000);
});
