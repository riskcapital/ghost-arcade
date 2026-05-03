// Recent files tracking — persisted in localStorage.
// Shows up to MAX_RECENT entries in the File menu for quick reopening.
import { writable } from 'svelte/store';

export interface RecentFile {
  name: string;
  path: string | null; // Absolute path (Electron only; null on web)
  timestamp: number;   // When last opened/saved
}

const STORAGE_KEY = 'ill-recent-files';
const MAX_RECENT = 10;

function loadFromStorage(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((f) => f && typeof f.name === 'string')
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveToStorage(files: RecentFile[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files.slice(0, MAX_RECENT)));
  } catch {
    // Ignore quota errors — recent files aren't critical
  }
}

function createRecentFilesStore() {
  const { subscribe, set, update } = writable<RecentFile[]>(loadFromStorage());

  return {
    subscribe,

    /** Record a file as recently opened/saved. Moves it to the top and dedupes by path (or by name if no path). */
    add(name: string, path: string | null = null) {
      update((files) => {
        // Dedupe by path if we have one, otherwise by name
        const dedupeKey = path || name;
        const filtered = files.filter((f) => (f.path || f.name) !== dedupeKey);
        const next = [{ name, path, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENT);
        saveToStorage(next);
        return next;
      });
    },

    /** Remove a single entry (e.g. when the file is confirmed missing). */
    remove(entry: RecentFile) {
      update((files) => {
        const next = files.filter((f) => f !== entry && !(f.path === entry.path && f.name === entry.name));
        saveToStorage(next);
        return next;
      });
    },

    /** Clear the entire list. */
    clear() {
      saveToStorage([]);
      set([]);
    },
  };
}

export const recentFiles = createRecentFilesStore();
