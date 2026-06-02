// Milkdrop layer-level control store.
//
// Tracks the user's commands for the Milkdrop plugin (next/prev/random/hard-cut)
// plus persistent favorites. The Canvas render hook listens to a per-layer
// `command` counter and acts on the latest command tag; commands are
// edge-triggered, not state.
//
// Favorites are stored as a flat string set keyed by preset name (which is
// unique across butterchurn packs). Persists to localStorage so they survive
// reloads.

import { writable, get } from 'svelte/store';

export type MilkdropCommandKind = 'next' | 'prev' | 'random' | 'cut' | 'lock' | 'unlock' | 'load';

export interface MilkdropCommand {
  layerId: string;
  kind: MilkdropCommandKind;
  tag: number;        // monotonically increasing; render loop uses this to detect "new command"
  presetName?: string; // populated for 'load' commands
}

interface MilkdropState {
  // Latest command per layer id; Canvas reads layer.tag and runs once when it changes.
  commands: Record<string, MilkdropCommand>;
  // Per-layer current preset name reported back from the renderer (so the UI can show it).
  currentPreset: Record<string, string>;
  // Per-layer locked state — when true, auto-evolve is paused even if the manifest param is on.
  locked: Record<string, boolean>;
  // User favorites — preset name set.
  favorites: Set<string>;
}

const FAV_LS_KEY = 'ghost-arcade.milkdrop.favorites.v1';

function loadFavorites(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(FAV_LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function saveFavorites(set: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(FAV_LS_KEY, JSON.stringify([...set])); } catch {}
}

const _state = writable<MilkdropState>({
  commands: {},
  currentPreset: {},
  locked: {},
  favorites: loadFavorites(),
});

let _commandTagSeq = 1;

export const milkdropStore = {
  subscribe: _state.subscribe,

  /** Fire an edge-triggered command at a milkdrop layer. */
  command(layerId: string, kind: MilkdropCommandKind, presetName?: string): void {
    _state.update(s => {
      s.commands[layerId] = { layerId, kind, tag: _commandTagSeq++, presetName };
      if (kind === 'lock') s.locked[layerId] = true;
      else if (kind === 'unlock') s.locked[layerId] = false;
      return s;
    });
  },

  /** Renderer reports the currently displayed preset back to the store. */
  reportPreset(layerId: string, name: string): void {
    _state.update(s => {
      if (s.currentPreset[layerId] === name) return s;
      s.currentPreset[layerId] = name;
      return s;
    });
  },

  /** Toggle favorite for a preset name. */
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

  /** Drop per-layer state when a layer is removed. Optional housekeeping. */
  dropLayer(layerId: string): void {
    _state.update(s => {
      delete s.commands[layerId];
      delete s.currentPreset[layerId];
      delete s.locked[layerId];
      return s;
    });
  },
};
