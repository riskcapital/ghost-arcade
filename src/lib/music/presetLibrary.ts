/**
 * Your presets: clips saved from the session to a library on this computer,
 * offered in every project's preset menus next to the factory presets.
 */

import { writable, get } from 'svelte/store';
import { normalizeClip, type SessionClip, type TrackId, TRACK_IDS } from './session';

export interface UserPreset {
  id: string;
  name: string;
  track: TrackId;
  clip: SessionClip;
  createdAt: number;
}

const STORAGE_KEY = 'ghostarcade-music-presets';

function normalizePreset(raw: unknown): UserPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<UserPreset>;
  if (typeof input.id !== 'string' || !TRACK_IDS.includes(input.track as TrackId)) return null;
  const clip = normalizeClip(input.clip);
  if (!clip || (clip.kind === 'beat') !== (input.track === 'beats')) return null;
  return {
    id: input.id,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : clip.name,
    track: input.track as TrackId,
    clip,
    createdAt: Number(input.createdAt) || 0,
  };
}

function load(): UserPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(normalizePreset).filter((p): p is UserPreset => !!p) : [];
  } catch {
    return [];
  }
}

function save(list: UserPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* storage full or blocked: the presets last the session */ }
}

function createPresetLibrary() {
  const store = writable<UserPreset[]>(typeof localStorage === 'undefined' ? [] : load());
  const change = (fn: (list: UserPreset[]) => UserPreset[]) => {
    store.update((list) => {
      const next = fn(list);
      save(next);
      return next;
    });
  };
  return {
    subscribe: store.subscribe,
    add(track: TrackId, clip: SessionClip, id: string, name = clip.name): UserPreset {
      const preset: UserPreset = { id, name: name.trim() || clip.name, track, clip: { ...clip, id }, createdAt: Date.now() };
      change((list) => [...list, preset]);
      return preset;
    },
    rename(id: string, name: string) {
      change((list) => list.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)));
    },
    remove(id: string) {
      change((list) => list.filter((p) => p.id !== id));
    },
    forTrack(track: TrackId): UserPreset[] {
      return get(store).filter((p) => p.track === track);
    },
    byId(id: string): UserPreset | undefined {
      return get(store).find((p) => p.id === id);
    },
  };
}

export const userPresets = createPresetLibrary();
