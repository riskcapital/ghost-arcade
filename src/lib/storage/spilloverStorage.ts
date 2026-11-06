/**
 * A localStorage value that may outgrow localStorage.
 *
 * The value stays in localStorage while it fits, where it can be read the
 * moment the app starts. One too large for it (a project or preset holding
 * a p5.js sketch that carries its sounds, or an inline 3D model) is kept
 * whole in IndexedDB instead, and the localStorage key holds a marker saying
 * so, so a launch can still tell at once that there is something to read.
 *
 * IndexedDB is the more durable of the two: a crash can lose localStorage
 * writes that were not on disk yet, the marker among them. So a value in
 * IndexedDB counts whenever localStorage has none, and a value that goes to
 * localStorage, or a clear, always removes the IndexedDB copy.
 */

/** What a localStorage key holds when its value lives in IndexedDB. */
export const SPILLED_TO_INDEXEDDB = '@indexeddb';

/**
 * Longer values go to IndexedDB even when localStorage would take them:
 * localStorage is read whole into memory at every launch and written
 * synchronously, so a project carrying megabytes of sketch files would
 * stall the app each time it autosaves.
 */
export const LOCAL_STORAGE_MAX_CHARS = 2_000_000;

const DB_NAME = 'ghost-arcade-spillover';
const STORE = 'values';

export interface SpilloverValue {
  /** True when there is a value, wherever it is kept. */
  has(): boolean;
  /** True when the value is in IndexedDB and must be read with read(). */
  isSpilled(): boolean;
  /** True when IndexedDB holds a value, even one whose marker a crash lost. */
  inIndexedDB(): Promise<boolean>;
  /** Where the value went; 'cleared' when clear() came first. */
  write(text: string): Promise<'localStorage' | 'indexedDB' | 'cleared'>;
  read(): Promise<string | null>;
  clear(): void;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function spilloverValue(key: string): SpilloverValue {
  // Writes run one after another, in the order they were asked for. A
  // clear() drops any write still waiting, so an old value cannot come back.
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  // Whether IndexedDB may hold a value: unknown at launch, so yes until a
  // delete goes through. Spares an IndexedDB round trip on every clear.
  let mayHoldCopy = true;
  const forget = async () => {
    if (!mayHoldCopy) return;
    try {
      await withStore('readwrite', (store) => store.delete(key));
      mayHoldCopy = false;
    } catch {
      /* stays possibly held */
    }
  };

  /** True when localStorage took the value. */
  function storeLocally(local: Storage | null, text: string): boolean {
    if (!local) return false;
    try {
      local.setItem(key, text);
      return true;
    } catch {
      return false;
    }
  }

  async function store(text: string, asOf: number): Promise<'localStorage' | 'indexedDB' | 'cleared'> {
    if (asOf !== generation) return 'cleared';
    const local = storage();
    if (text.length <= LOCAL_STORAGE_MAX_CHARS && storeLocally(local, text)) {
      // A larger value kept earlier is out of date now.
      await forget();
      return 'localStorage';
    }
    try {
      mayHoldCopy = true;
      await withStore('readwrite', (db) => db.put(text, key));
    } catch (err) {
      // No IndexedDB to be had: localStorage, if it takes the value after all.
      if (storeLocally(local, text)) return 'localStorage';
      throw err;
    }
    if (asOf !== generation) {
      await forget();
      return 'cleared';
    }
    local?.setItem(key, SPILLED_TO_INDEXEDDB);
    return 'indexedDB';
  }

  return {
    has: () => !!storage()?.getItem(key),
    isSpilled: () => storage()?.getItem(key) === SPILLED_TO_INDEXEDDB,

    async inIndexedDB() {
      try {
        return (await withStore<number>('readonly', (db) => db.count(key))) === 1;
      } catch {
        return false;
      }
    },

    write(text) {
      const asOf = generation;
      const result = queue.then(() => store(text, asOf));
      queue = result.catch(() => undefined);
      return result;
    },

    async read() {
      const value = storage()?.getItem(key) ?? null;
      if (value !== null && value !== SPILLED_TO_INDEXEDDB) return value;
      try {
        const text = await withStore<string>('readonly', (store) => store.get(key) as IDBRequest<string>);
        return typeof text === 'string' ? text : null;
      } catch {
        return null;
      }
    },

    clear() {
      generation += 1;
      storage()?.removeItem(key);
      void forget();
    },
  };
}
