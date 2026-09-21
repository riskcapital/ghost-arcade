import { validateCubeLut } from '../color/cubeLutAssets';
import { KEYFRAME_EASINGS } from '../keyframes/easing';
import { writable } from 'svelte/store';
import type { Effect } from '../types';
import { generateUUID } from '../utils/uuid';
import { EFFECT_CATALOG } from '../effects/effectCatalog';

export interface EffectChainPreset { id: string; name: string; effects: Effect[] }
export const MAX_PRESET_FILE_BYTES = 32 * 1024 * 1024;
const KEY = 'ghost-arcade-effect-chain-presets-v1';
const knownTypes = new Set<string>(EFFECT_CATALOG.map(effect => effect.type));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Saved chains own their data and never reuse live effect/automation identities. */
export function instantiateEffectChain(effects: readonly Effect[]): Effect[] {
  return clone(effects).map(effect => ({ ...effect, id: generateUUID() }));
}

// Bound imported data before any effect reaches the renderer or automation engine.
function validateJson(value: unknown, depth = 0): void {
  if (depth > 24) throw new Error('Preset data is too deeply nested.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Preset contains an invalid number.');
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid preset property.');
      validateJson(child, depth + 1);
    }
  }
}

export function parseEffectChainPresets(raw: string | null): EffectChainPreset[] {
  if (!raw) return [];
  if (raw.length > MAX_PRESET_FILE_BYTES) throw new Error('Preset library exceeds the 32 MB limit.');
  const data = JSON.parse(raw);
  validateJson(data);
  if (!Array.isArray(data) || data.length > 128) throw new Error('Invalid preset library.');
  const ids = new Set<string>();
  for (const preset of data) {
    if (!preset || typeof preset.id !== 'string' || ids.has(preset.id)
      || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 80
      || !Array.isArray(preset.effects) || !preset.effects.length || preset.effects.length > 128)
      throw new Error('Invalid effect-chain preset.');
    ids.add(preset.id);
    for (const effect of preset.effects) {
      if (!effect || typeof effect.id !== 'string' || !knownTypes.has(effect.type)
        || typeof effect.enabled !== 'boolean' || !effect.params || typeof effect.params !== 'object' || Array.isArray(effect.params))
        throw new Error('A saved preset contains an unsupported effect.');
      if (effect.type === 'cubeLut' && effect.params.cubeLut != null) validateCubeLut(effect.params.cubeLut);
      if (effect.opacity !== undefined && (typeof effect.opacity !== 'number' || effect.opacity < 0 || effect.opacity > 1))
        throw new Error('Invalid effect opacity.');
      if (effect.blendMode !== undefined && typeof effect.blendMode !== 'string') throw new Error('Invalid effect blend mode.');
      if (effect.paramAuto !== undefined) {
        if (!effect.paramAuto || typeof effect.paramAuto !== 'object' || Array.isArray(effect.paramAuto)) throw new Error('Invalid effect automation.');
        for (const auto of Object.values(effect.paramAuto) as any[]) {
          if (!auto || (auto.timing !== undefined && !['free', 'beat', 'crossfader', 'clip'].includes(auto.timing))
            || (auto.cycleBeats !== undefined && (typeof auto.cycleBeats !== 'number' || !Number.isFinite(auto.cycleBeats) || auto.cycleBeats <= 0))
            || (auto.easing !== undefined && !KEYFRAME_EASINGS.some(curve => curve.value === auto.easing)) || !['loop', 'pingpong'].includes(auto.mode) || typeof auto.playing !== 'boolean'
            || !['phase', 'speedHz', 'min', 'max'].every(key => typeof auto[key] === 'number' && Number.isFinite(auto[key]))
            || auto.speedHz < 0) throw new Error('Invalid effect automation.');
        }
      }
    }
  }
  return data;
}

export function createEffectChainPresetLibrary(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let values: EffectChainPreset[] = [];
  let loadError = '';
  try { values = parseEffectChainPresets(storage.getItem(KEY)); }
  catch { loadError = 'Saved presets could not be read. The stored library has been preserved.'; }
  const state = writable({ presets: values, error: loadError });
  function persist(next: EffectChainPreset[]) {
    if (loadError) throw new Error(loadError);
    // Publish only after durable storage succeeds; a quota failure must not look saved.
    storage.setItem(KEY, JSON.stringify(next));
    values = next;
    state.set({ presets: clone(values), error: '' });
  }
  return {
    subscribe: state.subscribe,
    save(name: string, effects: readonly Effect[]) {
      name = name.trim();
      if (!name || name.length > 80) throw new Error('Use a name between 1 and 80 characters.');
      if (values.some(preset => preset.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already saved. Choose another name.');
      const preset = { id: generateUUID(), name, effects: instantiateEffectChain(effects) };
      const next = [...values, preset];
      parseEffectChainPresets(JSON.stringify(next));
      persist(next);
      return preset.id;
    },
    exportLibrary() {
      if (loadError) throw new Error(loadError);
      const file = JSON.stringify({ format: 'ghost-arcade-effect-chains', version: 1, presets: values }, null, 2);
      if (new TextEncoder().encode(file).byteLength > MAX_PRESET_FILE_BYTES) throw new Error('Library export exceeds 32 MB. Remove unused presets first.');
      return file;
    },
    importLibrary(raw: string) {
      if (raw.length > MAX_PRESET_FILE_BYTES || new TextEncoder().encode(raw).byteLength > MAX_PRESET_FILE_BYTES) throw new Error('Choose a preset file smaller than 32 MB.');
      const file = JSON.parse(raw);
      if (file?.format !== 'ghost-arcade-effect-chains' || file.version !== 1)
        throw new Error('Choose a Ghost Arcade effect-chain file (version 1).');
      const imported = parseEffectChainPresets(JSON.stringify(file.presets));
      if (!imported.length) throw new Error('This file contains no presets.');
      if (values.length + imported.length > 128) throw new Error('Import would exceed 128 presets. Delete unused presets first.');
      const names = new Set(values.map(preset => preset.name.toLowerCase()));
      const additions = imported.map(preset => {
        const base = preset.name.trim();
        let name = base;
        let suffix = 2;
        while (names.has(name.toLowerCase())) {
          const ending = ` (${suffix++})`;
          name = base.slice(0, 80 - ending.length) + ending;
        }
        names.add(name.toLowerCase());
        return { id: generateUUID(), name, effects: instantiateEffectChain(preset.effects) };
      });
      const next = [...values, ...additions];
      parseEffectChainPresets(JSON.stringify(next));
      persist(next);
      return additions.map(preset => preset.id);
    },
    remove(id: string) { persist(values.filter(preset => preset.id !== id)); },
  };
}

export const effectChainPresets = createEffectChainPresetLibrary({
  getItem: key => typeof localStorage === 'undefined' ? null : localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
