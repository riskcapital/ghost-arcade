/**
 * Shader Library Store
 * Manages saved AI-generated shaders and JS animations
 * Persists to localStorage and syncs with server for file storage
 */

import { writable, derived, get } from 'svelte/store';
import type { GenerationType } from '../api/ai-client';

export interface SavedShader {
  id: string;
  name: string;
  description: string;
  type: GenerationType;
  code: string;
  thumbnail?: string; // Base64 data URL
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  source?: 'user' | 'cloud' | 'ai'; // Where it came from
  version?: number; // Catalog version (cloud shaders) — used for update diffing
  author?: string;
  params?: Array<{
    name: string;
    type: string;
    default?: number | boolean | number[];
    min?: number;
    max?: number;
    label?: string;
  }>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  version: number;
  description?: string;
  author?: string;
  thumbnailUrl?: string;
  downloadUrl: string;
  tags?: string[];
  dateAdded?: number;
}

export interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  total: number;
}

export interface ShaderLibraryState {
  shaders: SavedShader[];
  loading: boolean;
  error: string | null;
}

const STORAGE_KEY = 'ghost-arcade-shader-library';
const CATALOG_URL_KEY = 'ghost-arcade-shader-catalog-url';

// Bridge to Electron IPC for disk-backed shader persistence.
// In the browser / non-Electron runtime these calls silently no-op so the
// store still works (just without disk persistence).
function electronInvoke<T = unknown>(command: string, args?: unknown): Promise<T> | null {
  if (typeof window === 'undefined') return null;
  const api = (window as any).electronAPI;
  if (!api?.invoke) return null;
  return api.invoke(command, args) as Promise<T>;
}

async function persistShaderToDisk(id: string, code: string): Promise<void> {
  const p = electronInvoke('save_shader_source', { id, code });
  if (!p) return;
  try {
    await p;
  } catch (e) {
    console.warn(`[shaderLibrary] disk save failed for ${id}:`, e);
  }
}

async function deleteShaderFromDisk(id: string): Promise<void> {
  const p = electronInvoke('delete_shader_source', { id });
  if (!p) return;
  try {
    await p;
  } catch (e) {
    // Non-fatal — file may not exist
    console.debug(`[shaderLibrary] disk delete skipped for ${id}:`, e);
  }
}

// Default catalog endpoint. User can override via setCatalogUrl().
// Expected shape on server: GET {base}/catalog  →  CatalogEntry[]
//                           GET entry.downloadUrl → raw .fs text
const DEFAULT_CATALOG_URL = 'https://ghostarcade.live/api/shaders';

export function getCatalogUrl(): string {
  try {
    return localStorage.getItem(CATALOG_URL_KEY) || DEFAULT_CATALOG_URL;
  } catch {
    return DEFAULT_CATALOG_URL;
  }
}

export function setCatalogUrl(url: string): void {
  try {
    localStorage.setItem(CATALOG_URL_KEY, url);
  } catch (e) {
    console.error('Failed to save catalog URL:', e);
  }
}

// Load from localStorage
function loadFromStorage(): SavedShader[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.error('Failed to load shader library from storage:', e);
  }
  return [];
}

// Save to localStorage
function saveToStorage(shaders: SavedShader[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shaders));
  } catch (e) {
    console.error('Failed to save shader library to storage:', e);
  }
}

function createShaderLibraryStore() {
  const initialShaders = loadFromStorage();

  const { subscribe, update, set } = writable<ShaderLibraryState>({
    shaders: initialShaders,
    loading: false,
    error: null,
  });

  return {
    subscribe,

    /**
     * Add a new shader to the library
     */
    addShader: (shader: Omit<SavedShader, 'id' | 'createdAt' | 'updatedAt'>): SavedShader => {
      const newShader: SavedShader = {
        ...shader,
        id: `shader-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      update(state => {
        const newShaders = [...state.shaders, newShader];
        saveToStorage(newShaders);
        return { ...state, shaders: newShaders };
      });

      // Also save to server for file persistence
      saveShaderToServer(newShader);

      return newShader;
    },

    /**
     * Update an existing shader
     */
    updateShader: (id: string, updates: Partial<SavedShader>): void => {
      update(state => {
        const newShaders = state.shaders.map(s =>
          s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s
        );
        saveToStorage(newShaders);
        return { ...state, shaders: newShaders };
      });
    },

    /**
     * Remove a shader from the library
     */
    removeShader: (id: string): void => {
      update(state => {
        const shader = state.shaders.find(s => s.id === id);
        const newShaders = state.shaders.filter(s => s.id !== id);
        saveToStorage(newShaders);

        // Also delete from server (legacy local HTTP server, mostly no-op now)
        if (shader) {
          deleteShaderFromServer(shader);
        }

        // Delete from disk if it was a cloud shader (others stay localStorage-only)
        if (shader?.source === 'cloud') {
          deleteShaderFromDisk(id);
        }

        return { ...state, shaders: newShaders };
      });
    },

    /**
     * Get a shader by ID
     */
    getById: (id: string): SavedShader | undefined => {
      const state = get({ subscribe });
      return state.shaders.find(s => s.id === id);
    },

    /**
     * Update shader thumbnail
     */
    setThumbnail: (id: string, thumbnail: string): void => {
      update(state => {
        const newShaders = state.shaders.map(s =>
          s.id === id ? { ...s, thumbnail, updatedAt: Date.now() } : s
        );
        saveToStorage(newShaders);
        return { ...state, shaders: newShaders };
      });
    },

    /**
     * Import shaders from files loaded from server
     */
    importFromServer: (shaders: SavedShader[]): void => {
      update(state => {
        // Merge with existing, avoiding duplicates by ID
        const existingIds = new Set(state.shaders.map(s => s.id));
        const newShaders = [
          ...state.shaders,
          ...shaders.filter(s => !existingIds.has(s.id))
        ];
        saveToStorage(newShaders);
        return { ...state, shaders: newShaders, loading: false };
      });
    },

    /**
     * Set loading state
     */
    setLoading: (loading: boolean): void => {
      update(state => ({ ...state, loading }));
    },

    /**
     * Set error state
     */
    setError: (error: string | null): void => {
      update(state => ({ ...state, error }));
    },

    /**
     * Clear all shaders
     */
    clear: (): void => {
      set({ shaders: [], loading: false, error: null });
      saveToStorage([]);
    },

    /**
     * Sync from the public shader catalog.
     * - Fetches {catalogUrl}/catalog (expects CatalogEntry[])
     * - For each entry: adds if new, updates if cloud version is newer than local,
     *   skips otherwise.
     * - Preserves user-added and ai-generated shaders untouched.
     *
     * Throws on network failure (caller should catch + show toast).
     */
    syncFromCloud: async (): Promise<SyncResult> => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('offline');
      }

      const base = getCatalogUrl().replace(/\/+$/, '');
      let catalog: CatalogEntry[];
      try {
        const resp = await fetch(`${base}/catalog`, { cache: 'no-store' });
        if (!resp.ok) {
          throw new Error(`Catalog responded ${resp.status}`);
        }
        catalog = await resp.json();
      } catch (e) {
        // Distinguish offline-ish errors from real API errors
        const msg = e instanceof Error ? e.message : String(e);
        if (/Failed to fetch|NetworkError|TypeError/i.test(msg)) {
          throw new Error('offline');
        }
        throw new Error(`Could not reach catalog: ${msg}`);
      }

      if (!Array.isArray(catalog)) {
        throw new Error('Catalog returned unexpected format');
      }

      let added = 0;
      let updated = 0;
      let skipped = 0;

      for (const entry of catalog) {
        const state = get({ subscribe });
        const existing = state.shaders.find(s => s.id === entry.id);

        const localVersion = existing?.version ?? 0;
        const needsAdd = !existing;
        const needsUpdate = existing && entry.version > localVersion;

        if (!needsAdd && !needsUpdate) {
          skipped++;
          continue;
        }

        // Download the shader code
        let code: string;
        try {
          const r = await fetch(entry.downloadUrl, { cache: 'no-store' });
          if (!r.ok) {
            console.warn(`[shader-sync] Skipped ${entry.name}: download ${r.status}`);
            continue;
          }
          code = await r.text();
        } catch (e) {
          console.warn(`[shader-sync] Skipped ${entry.name}:`, e);
          continue;
        }

        if (needsAdd) {
          const shader: SavedShader = {
            id: entry.id,
            name: entry.name,
            description: entry.description || '',
            type: 'shader-isf',
            code,
            thumbnail: entry.thumbnailUrl,
            createdAt: entry.dateAdded || Date.now(),
            updatedAt: Date.now(),
            tags: entry.tags,
            source: 'cloud',
            version: entry.version,
            author: entry.author,
          };
          update(state => {
            const newShaders = [...state.shaders, shader];
            saveToStorage(newShaders);
            return { ...state, shaders: newShaders };
          });
          // Disk persistence (Electron only — no-op in browser)
          await persistShaderToDisk(entry.id, code);
          added++;
        } else if (needsUpdate && existing) {
          update(state => {
            const newShaders = state.shaders.map(s =>
              s.id === entry.id
                ? {
                    ...s,
                    code,
                    name: entry.name,
                    description: entry.description || s.description,
                    thumbnail: entry.thumbnailUrl || s.thumbnail,
                    version: entry.version,
                    author: entry.author,
                    updatedAt: Date.now(),
                  }
                : s
            );
            saveToStorage(newShaders);
            return { ...state, shaders: newShaders };
          });
          await persistShaderToDisk(entry.id, code);
          updated++;
        }
      }

      return { added, updated, skipped, total: catalog.length };
    },
  };
}

export const shaderLibrary = createShaderLibraryStore();

// Derived stores for filtering
export const isfShaders = derived(shaderLibrary, $state =>
  $state.shaders.filter(s => s.type === 'shader-isf')
);

export const threejsShaders = derived(shaderLibrary, $state =>
  $state.shaders.filter(s => s.type === 'threejs')
);

export const p5jsShaders = derived(shaderLibrary, $state =>
  $state.shaders.filter(s => s.type === 'p5js')
);

/**
 * Save shader to server for file persistence
 */
async function saveShaderToServer(shader: SavedShader): Promise<void> {
  try {
    const response = await fetch('http://localhost:9002/api/shaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shader),
    });

    if (!response.ok) {
      console.warn('Failed to save shader to server:', await response.text());
    }
  } catch (e) {
    // Server might not have the endpoint yet - that's OK, we have localStorage
    console.debug('Shader server save skipped (endpoint not available):', e);
  }
}

/**
 * Delete shader from server
 */
async function deleteShaderFromServer(shader: SavedShader): Promise<void> {
  try {
    const response = await fetch(`http://localhost:9002/api/shaders/${shader.id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      console.warn('Failed to delete shader from server:', await response.text());
    }
  } catch (e) {
    console.debug('Shader server delete skipped (endpoint not available):', e);
  }
}

/**
 * Load shaders from server on startup
 */
export async function loadShadersFromServer(): Promise<void> {
  shaderLibrary.setLoading(true);

  try {
    const response = await fetch('http://localhost:9002/api/shaders');

    if (response.ok) {
      const shaders = await response.json();
      if (Array.isArray(shaders)) {
        shaderLibrary.importFromServer(shaders);
      }
    }
  } catch (e) {
    // Server endpoint not available - use localStorage only
    console.debug('Shader server load skipped (endpoint not available):', e);
  } finally {
    shaderLibrary.setLoading(false);
  }
}

/**
 * Hydrate cloud-synced shaders from the user data directory on disk.
 *
 * Disk is the source of truth for cloud shaders — survives localStorage
 * clears, browser cache wipes, and incognito sessions. localStorage is just
 * the in-memory cache.
 *
 * On startup this finds any .fs files in {userData}/shaders that aren't
 * already in localStorage (e.g. after a fresh install) and imports them as
 * cloud shaders. Existing localStorage entries are kept (their metadata is
 * richer than what disk has).
 *
 * No-op outside Electron.
 */
export async function loadCloudShadersFromDisk(): Promise<void> {
  const p = electronInvoke<Array<{ id: string; code: string }>>('list_shader_sources');
  if (!p) return;

  let onDisk: Array<{ id: string; code: string }>;
  try {
    onDisk = await p;
  } catch (e) {
    console.warn('[shaderLibrary] disk load failed:', e);
    return;
  }
  if (!Array.isArray(onDisk) || onDisk.length === 0) return;

  const existing = loadFromStorage();
  const existingById = new Map(existing.map(s => [s.id, s]));

  let added = 0;
  for (const { id, code } of onDisk) {
    if (existingById.has(id)) continue;
    existing.push({
      id,
      name: id,
      description: '',
      type: 'shader-isf',
      code,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'cloud',
      version: 0,
    });
    added++;
  }

  if (added > 0) {
    saveToStorage(existing);
    shaderLibrary.importFromServer(existing);
    console.log(`[shaderLibrary] hydrated ${added} cloud shader(s) from disk`);
  }
}
