/**
 * Video Library Store
 * Persists AI-generated videos using IndexedDB for binary storage
 */

import { writable, get } from 'svelte/store';

export interface SavedVideo {
  id: string;
  name: string;
  prompt: string;
  thumbnail: string; // base64 data URL
  createdAt: number;
  // Stored separately in IndexedDB as blob
  blobKey: string;
}

export interface VideoLibraryState {
  videos: SavedVideo[];
  loading: boolean;
}

const DB_NAME = 'ghost-arcade-video-library';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const BLOB_STORE = 'blobs';
const STORAGE_KEY = 'ghost-arcade-video-library-meta';

// ─── IndexedDB helpers ──────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getBlob(key: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const req = tx.objectStore(BLOB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteBlob(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Metadata persistence (localStorage for small JSON) ─────────────

function loadMeta(): SavedVideo[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.error('Failed to load video library metadata:', e);
  }
  return [];
}

function saveMeta(videos: SavedVideo[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  } catch (e) {
    console.error('Failed to save video library metadata:', e);
  }
}

// ─── Store ──────────────────────────────────────────────────────────

function createVideoLibraryStore() {
  const initialVideos = loadMeta();

  const { subscribe, update, set } = writable<VideoLibraryState>({
    videos: initialVideos,
    loading: false,
  });

  return {
    subscribe,

    /**
     * Save a video to the persistent library
     */
    addVideo: async (video: {
      name: string;
      prompt: string;
      thumbnail: string;
      blob: Blob;
    }): Promise<SavedVideo> => {
      const blobKey = `video-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const saved: SavedVideo = {
        id: blobKey,
        name: video.name,
        prompt: video.prompt,
        thumbnail: video.thumbnail,
        createdAt: Date.now(),
        blobKey,
      };

      // Store blob in IndexedDB
      await storeBlob(blobKey, video.blob);

      // Update store and localStorage
      update(state => {
        const newVideos = [...state.videos, saved];
        saveMeta(newVideos);
        return { ...state, videos: newVideos };
      });

      return saved;
    },

    /**
     * Load a video blob from IndexedDB
     */
    loadVideoBlob: async (blobKey: string): Promise<Blob | null> => {
      return getBlob(blobKey);
    },

    /**
     * Remove a video from the library
     */
    removeVideo: async (id: string): Promise<void> => {
      const state = get({ subscribe });
      const video = state.videos.find(v => v.id === id);
      if (video) {
        await deleteBlob(video.blobKey).catch(e =>
          console.warn('Failed to delete video blob:', e)
        );
      }

      update(state => {
        const newVideos = state.videos.filter(v => v.id !== id);
        saveMeta(newVideos);
        return { ...state, videos: newVideos };
      });
    },

    /**
     * Clear all saved videos
     */
    clear: async (): Promise<void> => {
      const state = get({ subscribe });
      for (const v of state.videos) {
        await deleteBlob(v.blobKey).catch(() => {});
      }
      set({ videos: [], loading: false });
      saveMeta([]);
    },
  };
}

export const videoLibrary = createVideoLibraryStore();
