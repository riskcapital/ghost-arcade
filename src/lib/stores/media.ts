// Media Library Store
// Shared state for media items (videos, images) that can be used as shader inputs

import { writable, derived } from 'svelte/store';
import type * as THREE from 'three';

export interface MediaItem {
  id: string;
  name: string;
  src: string;
  type: 'video' | 'image';
  thumbnail?: string;
  videoElement?: HTMLVideoElement;
  texture?: THREE.Texture; // Cached texture for this media item
  broken?: boolean;        // True when src failed to load (404, missing file, decode error)
  brokenReason?: string;   // Short description for tooltip
}

function createMediaStore() {
  const { subscribe, update, set } = writable<MediaItem[]>([]);

  return {
    subscribe,

    addItem: (item: MediaItem) => {
      update(items => [...items, item]);
    },

    removeItem: (id: string) => {
      update(items => {
        const item = items.find(i => i.id === id);
        if (item?.src.startsWith('blob:')) {
          URL.revokeObjectURL(item.src);
        }
        return items.filter(i => i.id !== id);
      });
    },

    updateItem: (id: string, updates: Partial<MediaItem>) => {
      update(items => items.map(item =>
        item.id === id ? { ...item, ...updates } : item
      ));
    },

    setTexture: (id: string, texture: THREE.Texture) => {
      update(items => items.map(item =>
        item.id === id ? { ...item, texture } : item
      ));
    },

    getById: (items: MediaItem[], id: string) => {
      return items.find(item => item.id === id);
    },

    reset: () => set([]),
  };
}

export const mediaLibrary = createMediaStore();

// Derived store for video items only
export const videoItems = derived(mediaLibrary, $items =>
  $items.filter(item => item.type === 'video')
);

// Derived store for image items only
export const imageItems = derived(mediaLibrary, $items =>
  $items.filter(item => item.type === 'image')
);
