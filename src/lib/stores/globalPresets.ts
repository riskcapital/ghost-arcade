// Global Presets Store — localStorage-backed two-tier preset system
// Global presets persist across all projects (localStorage)
// Project presets are saved inside .ghost-arcade files (project store)

import { writable } from 'svelte/store';
import type { StagePreset, SVKeyboardPreset } from '../types';

const GLOBAL_STAGE_PRESETS_KEY = 'ghost-arcade_global_stage_presets';
const GLOBAL_SV_KEYBOARD_PRESETS_KEY = 'ghost-arcade_global_sv_keyboard_presets';
const OLD_SV_PRESETS_KEY = 'sv-keyboard-presets';

// ──── Helpers ────

function loadFromStorage<T>(key: string): T[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToStorage<T>(key: string, data: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn(`[GlobalPresets] Failed to save to localStorage key '${key}':`, e);
  }
}

// ──── Migration from old localStorage key ────
// Old SV keyboard presets were stored as 'sv-keyboard-presets' in localStorage.
// On first run, migrate them to the new global presets key and delete the old key.

function migrateOldSVPresets(): SVKeyboardPreset[] {
  try {
    const oldStored = localStorage.getItem(OLD_SV_PRESETS_KEY);
    if (oldStored) {
      const oldPresets = JSON.parse(oldStored);
      const migrated: SVKeyboardPreset[] = oldPresets.map((p: any) => ({
        ...p,
        scope: 'global' as const,
      }));
      localStorage.removeItem(OLD_SV_PRESETS_KEY);
      return migrated;
    }
  } catch {
    // Silently fail — old data may be corrupt
  }
  return [];
}

// ──── Global Stage Presets ────

function createGlobalStagePresetsStore() {
  const initial = loadFromStorage<StagePreset>(GLOBAL_STAGE_PRESETS_KEY);
  const { subscribe, update } = writable<StagePreset[]>(initial);

  // Auto-persist on every change
  let skipFirst = true;
  subscribe(value => {
    if (skipFirst) { skipFirst = false; return; }
    saveToStorage(GLOBAL_STAGE_PRESETS_KEY, value);
  });

  return {
    subscribe,
    add(preset: StagePreset) {
      update(list => [...list, { ...preset, scope: 'global' }]);
    },
    remove(id: string) {
      update(list => list.filter(p => p.id !== id));
    },
    rename(id: string, name: string) {
      update(list => list.map(p => p.id === id ? { ...p, name } : p));
    },
    /** Overwrite an existing global stage preset with new layers/thumbnail.
     * Keeps the same id + name + createdAt so the UI position is stable. */
    updateContents(id: string, layers: StagePreset['layers'], thumbnail?: string) {
      update(list => list.map(p =>
        p.id === id ? { ...p, layers, thumbnail: thumbnail ?? p.thumbnail } : p
      ));
    },
  };
}

// ──── Global SV Keyboard Presets ────

function createGlobalSVKeyboardPresetsStore() {
  // Load existing global presets + migrate old localStorage presets
  const existing = loadFromStorage<SVKeyboardPreset>(GLOBAL_SV_KEYBOARD_PRESETS_KEY);
  const migrated = migrateOldSVPresets();
  const initial = [...existing, ...migrated];

  // If we migrated old presets, persist them immediately
  if (migrated.length > 0) {
    saveToStorage(GLOBAL_SV_KEYBOARD_PRESETS_KEY, initial);
  }

  const { subscribe, update } = writable<SVKeyboardPreset[]>(initial);

  // Auto-persist on every change
  let skipFirst = true;
  subscribe(value => {
    if (skipFirst) { skipFirst = false; return; }
    saveToStorage(GLOBAL_SV_KEYBOARD_PRESETS_KEY, value);
  });

  return {
    subscribe,
    add(preset: SVKeyboardPreset) {
      update(list => [...list, { ...preset, scope: 'global' }]);
    },
    remove(id: string) {
      update(list => list.filter(p => p.id !== id));
    },
    rename(id: string, name: string) {
      update(list => list.map(p => p.id === id ? { ...p, name } : p));
    },
    /** Overwrite an existing global SV keyboard preset's contents (clipAssignments
     * etc.) without touching id / name / scope. Used by right-click "Update Preset". */
    updateContents(id: string, fields: Partial<SVKeyboardPreset>) {
      update(list => list.map(p => p.id === id ? { ...p, ...fields, id, name: p.name, scope: 'global' } : p));
    },
  };
}

export const globalStagePresets = createGlobalStagePresetsStore();
export const globalSVKeyboardPresets = createGlobalSVKeyboardPresetsStore();
