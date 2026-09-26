import { writable } from 'svelte/store';
import { KEYFRAME_EASINGS } from '../keyframes/easing';
import type { EdgeEffect } from '../types';
import { generateUUID } from '../utils/uuid';
import { isKnownEdgeType } from '../drawing/edgeEffectCatalog';

/** A saved Edge Effect stack: the effects in order and the outline's corner radius. */
export interface EdgeEffectPreset { id: string; name: string; effects: EdgeEffect[]; cornerRadius?: number }

export const MAX_EDGE_PRESET_FILE_BYTES = 32 * 1024 * 1024;
const KEY = 'ghost-arcade-edge-effect-presets-v1';
const FORMAT = 'ghost-arcade-edge-effects';
const MAX_PRESETS = 128;
const MAX_EFFECTS_PER_PRESET = 64;
const CHASE_MODES = ['none', 'order', 'leftToRight', 'radial'];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Saved stacks own their data: every use gets fresh effect ids, so
 *  modulation and automation never bind to another layer's effects. */
export function instantiateEdgeEffects(effects: readonly EdgeEffect[]): EdgeEffect[] {
  return clone(effects).map((effect) => ({ ...effect, id: generateUUID() }));
}

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

function validPart(kind: 'stroke' | 'fill' | 'animation', part: unknown): boolean {
  return !!part && typeof part === 'object' && !Array.isArray(part) && isKnownEdgeType(kind, (part as { type?: unknown }).type);
}

function validateEffect(effect: any): void {
  if (!effect || typeof effect !== 'object' || typeof effect.id !== 'string' || typeof effect.enabled !== 'boolean'
    || !validPart('stroke', effect.stroke) || !validPart('fill', effect.fill) || !validPart('animation', effect.animation))
    throw new Error('A saved preset contains an unsupported edge effect.');
  if (typeof effect.opacity !== 'number' || effect.opacity < 0 || effect.opacity > 1) throw new Error('Invalid edge effect opacity.');
  if (typeof effect.blendMode !== 'string') throw new Error('Invalid edge effect blend mode.');
  if (effect.customCenter !== undefined && typeof effect.customCenter !== 'boolean') throw new Error('Invalid edge effect centre.');
  for (const key of ['centerX', 'centerY', 'chaseSpread']) {
    if (effect[key] !== undefined && typeof effect[key] !== 'number') throw new Error('Invalid edge effect setting.');
  }
  if (effect.chaseMode !== undefined && !CHASE_MODES.includes(effect.chaseMode)) throw new Error('Invalid group chase.');
  if (effect.paramAuto !== undefined) {
    if (!effect.paramAuto || typeof effect.paramAuto !== 'object' || Array.isArray(effect.paramAuto)) throw new Error('Invalid edge effect automation.');
    for (const auto of Object.values(effect.paramAuto) as any[]) {
      if (!auto || (auto.timing !== undefined && !['free', 'beat', 'crossfader', 'clip'].includes(auto.timing))
        || (auto.cycleBeats !== undefined && (typeof auto.cycleBeats !== 'number' || auto.cycleBeats <= 0))
        || (auto.easing !== undefined && !KEYFRAME_EASINGS.some((curve) => curve.value === auto.easing))
        || !['loop', 'pingpong'].includes(auto.mode) || typeof auto.playing !== 'boolean'
        || !['phase', 'speedHz', 'min', 'max'].every((key) => typeof auto[key] === 'number')
        || auto.speedHz < 0) throw new Error('Invalid edge effect automation.');
    }
  }
}

export function parseEdgeEffectPresets(raw: string | null): EdgeEffectPreset[] {
  if (!raw) return [];
  if (raw.length > MAX_EDGE_PRESET_FILE_BYTES) throw new Error('Preset library exceeds the 32 MB limit.');
  const data = JSON.parse(raw);
  validateJson(data);
  if (!Array.isArray(data) || data.length > MAX_PRESETS) throw new Error('Invalid preset library.');
  const ids = new Set<string>();
  for (const preset of data) {
    if (!preset || typeof preset.id !== 'string' || ids.has(preset.id)
      || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 80
      || !Array.isArray(preset.effects) || !preset.effects.length || preset.effects.length > MAX_EFFECTS_PER_PRESET)
      throw new Error('Invalid edge effect preset.');
    if (preset.cornerRadius !== undefined && (typeof preset.cornerRadius !== 'number' || preset.cornerRadius < 0 || preset.cornerRadius > 1000))
      throw new Error('Invalid corner radius.');
    ids.add(preset.id);
    preset.effects.forEach(validateEffect);
  }
  return data;
}

export function createEdgeEffectPresetLibrary(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let values: EdgeEffectPreset[] = [];
  let loadError = '';
  try { values = parseEdgeEffectPresets(storage.getItem(KEY)); }
  catch { loadError = 'Saved edge effect presets could not be read. The stored library has been preserved.'; }
  const state = writable({ presets: values, error: loadError });
  function persist(next: EdgeEffectPreset[]) {
    if (loadError) throw new Error(loadError);
    // Publish only after durable storage succeeds; a quota failure must not look saved.
    storage.setItem(KEY, JSON.stringify(next));
    values = next;
    state.set({ presets: clone(values), error: '' });
  }
  return {
    subscribe: state.subscribe,
    save(name: string, effects: readonly EdgeEffect[], cornerRadius?: number) {
      name = name.trim();
      if (!name || name.length > 80) throw new Error('Use a name between 1 and 80 characters.');
      if (!effects.length) throw new Error('Add an edge effect before saving a preset.');
      if (values.some((preset) => preset.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already saved. Choose another name.');
      const preset: EdgeEffectPreset = { id: generateUUID(), name, effects: instantiateEdgeEffects(effects) };
      if (cornerRadius && cornerRadius > 0) preset.cornerRadius = cornerRadius;
      const next = [...values, preset];
      parseEdgeEffectPresets(JSON.stringify(next));
      persist(next);
      return preset.id;
    },
    exportLibrary() {
      if (loadError) throw new Error(loadError);
      const file = JSON.stringify({ format: FORMAT, version: 1, presets: values }, null, 2);
      if (new TextEncoder().encode(file).byteLength > MAX_EDGE_PRESET_FILE_BYTES) throw new Error('Library export exceeds 32 MB. Remove unused presets first.');
      return file;
    },
    importLibrary(raw: string) {
      if (raw.length > MAX_EDGE_PRESET_FILE_BYTES || new TextEncoder().encode(raw).byteLength > MAX_EDGE_PRESET_FILE_BYTES) throw new Error('Choose a preset file smaller than 32 MB.');
      const file = JSON.parse(raw);
      if (file?.format !== FORMAT || file.version !== 1) throw new Error('Choose a Ghost Arcade edge effect preset file (version 1).');
      const imported = parseEdgeEffectPresets(JSON.stringify(file.presets));
      if (!imported.length) throw new Error('This file contains no presets.');
      if (values.length + imported.length > MAX_PRESETS) throw new Error(`Import would exceed ${MAX_PRESETS} presets. Delete unused presets first.`);
      const names = new Set(values.map((preset) => preset.name.toLowerCase()));
      const additions = imported.map((preset) => {
        const base = preset.name.trim();
        let name = base;
        let suffix = 2;
        while (names.has(name.toLowerCase())) {
          const ending = ` (${suffix++})`;
          name = base.slice(0, 80 - ending.length) + ending;
        }
        names.add(name.toLowerCase());
        const addition: EdgeEffectPreset = { id: generateUUID(), name, effects: instantiateEdgeEffects(preset.effects) };
        if (preset.cornerRadius) addition.cornerRadius = preset.cornerRadius;
        return addition;
      });
      const next = [...values, ...additions];
      parseEdgeEffectPresets(JSON.stringify(next));
      persist(next);
      return additions.map((preset) => preset.id);
    },
    remove(id: string) { persist(values.filter((preset) => preset.id !== id)); },
  };
}

export const edgeEffectPresets = createEdgeEffectPresetLibrary({
  getItem: (key) => typeof localStorage === 'undefined' ? null : localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
