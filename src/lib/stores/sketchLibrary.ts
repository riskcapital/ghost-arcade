/**
 * Imported p5.js sketches, kept between sessions.
 *
 * A sketch carries its own files (images, sounds, fonts), often more than
 * the few megabytes localStorage allows, so the library lives in IndexedDB:
 * one record per sketch, holding its media source exactly as imported, with
 * the files as written. The media tray lists them in its JS tab on every
 * launch, under the same ids, so layers and clips that use them still find
 * their tray item.
 */
import { writable } from 'svelte/store';
import type { JSAnimationSource } from '../types';

export interface StoredSketch {
  /** The tray item's id. */
  id: string;
  name: string;
  jsAnimation: JSAnimationSource;
  thumbnail?: string;
  addedAt: number;
}

const DB_NAME = 'ghost-arcade-sketch-library';
const DB_VERSION = 1;
const STORE = 'sketches';

let opening: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'));
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * A plain copy for storage: drops anything a structured clone cannot carry
 * (a store proxy, a function) by going through JSON, which every field of a
 * media source survives.
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Every stored sketch, oldest first. */
export async function loadSketches(): Promise<StoredSketch[]> {
  try {
    const all = (await run<StoredSketch[]>('readonly', (store) => store.getAll() as IDBRequest<StoredSketch[]>)) ?? [];
    return all.filter((s) => s && typeof s.id === 'string' && s.jsAnimation).sort((a, b) => a.addedAt - b.addedAt);
  } catch (err) {
    console.warn('[SketchLibrary] could not read the library:', err);
    return [];
  }
}

export async function saveSketch(sketch: StoredSketch): Promise<boolean> {
  try {
    await run('readwrite', (store) => store.put(plain(sketch)));
    return true;
  } catch (err) {
    console.warn(`[SketchLibrary] could not keep "${sketch.name}":`, err);
    return false;
  }
}

/** Changes part of a stored sketch: its thumbnail, or its source after an edit. Unknown ids are left alone. */
export async function updateSketch(id: string, patch: Partial<Omit<StoredSketch, 'id'>>): Promise<void> {
  try {
    const current = await run<StoredSketch | undefined>('readonly', (store) => store.get(id) as IDBRequest<StoredSketch | undefined>);
    if (!current) return;
    await run('readwrite', (store) => store.put(plain({ ...current, ...patch, id })));
  } catch (err) {
    console.warn('[SketchLibrary] could not update a sketch:', err);
  }
}

export async function removeSketch(id: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(id));
  } catch (err) {
    console.warn('[SketchLibrary] could not remove a sketch:', err);
  }
}

/**
 * Changes made to the library from outside the media tray (Find latest
 * bringing in or taking down community sketches), so an open tray can show
 * them straight away. `seq` counts up with every change.
 */
export const sketchLibraryChanges = writable<{ seq: number; put: StoredSketch[]; removed: string[] }>({ seq: 0, put: [], removed: [] });

export function announceSketchChanges(change: { put: StoredSketch[]; removed: string[] }): void {
  sketchLibraryChanges.update((prev) => ({ seq: prev.seq + 1, ...change }));
}
