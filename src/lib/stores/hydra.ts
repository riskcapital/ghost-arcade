// Hydra layer-level control store.
//
// Same edge-triggered command pattern as the Milkdrop store: panel
// buttons fire commands tagged with a monotonic counter; the Canvas
// render loop notices a new tag and acts on it (load sketch by name,
// next/prev/random within the curated preset library).
//
// Favorites are persisted to localStorage so they survive reloads.

import { writable, get } from 'svelte/store';

export type HydraCommandKind = 'next' | 'prev' | 'random' | 'load';

export interface HydraCommand {
  layerId: string;
  kind: HydraCommandKind;
  tag: number;
  presetName?: string;
}

interface HydraState {
  commands: Record<string, HydraCommand>;
  currentPreset: Record<string, string>;
  favorites: Set<string>;
}

const FAV_LS_KEY = 'ghost-arcade.hydra.favorites.v1';

function loadFavorites(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(FAV_LS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function saveFavorites(set: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(FAV_LS_KEY, JSON.stringify([...set])); } catch {}
}

const _state = writable<HydraState>({
  commands: {},
  currentPreset: {},
  favorites: loadFavorites(),
});

let _tagSeq = 1;

export const hydraStore = {
  subscribe: _state.subscribe,

  command(layerId: string, kind: HydraCommandKind, presetName?: string): void {
    _state.update(s => {
      s.commands[layerId] = { layerId, kind, tag: _tagSeq++, presetName };
      return s;
    });
  },

  reportPreset(layerId: string, name: string): void {
    _state.update(s => {
      if (s.currentPreset[layerId] === name) return s;
      s.currentPreset[layerId] = name;
      return s;
    });
  },

  toggleFavorite(name: string): void {
    _state.update(s => {
      if (s.favorites.has(name)) s.favorites.delete(name);
      else s.favorites.add(name);
      saveFavorites(s.favorites);
      return s;
    });
  },

  isFavorite(name: string): boolean {
    return get(_state).favorites.has(name);
  },
};
