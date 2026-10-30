/**
 * Which Music Studio instance the studio is playing to, and editing it.
 *
 * In VJ mode it is the studio clip on the selected row, else the first one
 * playing, else the first one on the grid. In mapping it is the selected
 * layer when that shows the studio, else the first layer that does. Loading a
 * scene or changing a voice edits that instance only; when there is none,
 * loading a scene puts one in place first (the first free cell on deck A, or
 * the selected media layer in mapping).
 */

import { derived, get, readable, type Readable } from 'svelte/store';
import { vjClipLauncher, type VJClipLauncherState, type VJDeck } from '../stores/vjClipLauncher';
import { project } from '../stores/layers';
import { generateUUID } from '../utils/uuid';
import type { Layer, MediaSource } from '../types';
import {
  MAX_STUDIO_VOICES,
  STUDIO_EFFECT_TYPE,
  STUDIO_PLUGIN_ID,
  defaultStudioSource,
  isStudioSource,
  normalizeStudioSource,
  studioVoicesFromScene,
  type StudioPluginSource,
  type StudioVoice,
} from './studioPlugin';
import type { StudioSet } from './studioSets';
import type { VoiceSourceId } from './visualVoices';

export type StudioTarget =
  | { kind: 'vj'; deck: VJDeck; layer: number; column: number; playing: boolean; source: Required<StudioPluginSource> }
  | { kind: 'layer'; layerId: string; name: string; source: Required<StudioPluginSource> };

type LauncherState = VJClipLauncherState;

// One normalized copy per stored source object, so an unchanged instance
// reads as the same value and the studio's panels do not redraw for nothing.
const normalized = new WeakMap<object, Required<StudioPluginSource>>();
function studioSourceOf(raw: unknown): Required<StudioPluginSource> {
  if (!raw || typeof raw !== 'object') return normalizeStudioSource(raw);
  let source = normalized.get(raw);
  if (!source) {
    source = normalizeStudioSource(raw);
    normalized.set(raw, source);
  }
  return source;
}

function findVjTarget(state: LauncherState): StudioTarget | null {
  const decks: [VJDeck, typeof state.clipGrid, typeof state.layerStates][] = [
    ['A', state.clipGrid, state.layerStates],
    ['B', state.bankBClipGrid ?? [], state.bankBLayerStates ?? []],
  ];
  const at = (deck: VJDeck, grid: typeof state.clipGrid, layer: number, column: number, playing: boolean): StudioTarget | null => {
    const clip = grid[layer]?.[column];
    if (!clip || clip.type !== 'effect' || !isStudioSource(clip.effectSource)) return null;
    return { kind: 'vj', deck, layer, column, playing, source: studioSourceOf(clip.effectSource) };
  };
  const playingColumn = (grid: typeof state.clipGrid, states: typeof state.layerStates, layer: number): number | null => {
    const active = states[layer]?.activeClip;
    if (!active) return null;
    const column = grid[layer]?.findIndex((c) => c?.id === active.id) ?? -1;
    return column >= 0 ? column : null;
  };
  // The selected row, when it is playing a studio clip.
  const selected = state.selectedLayerIndex;
  if (selected !== null && selected !== undefined) {
    for (const [deck, grid, states] of decks) {
      const column = playingColumn(grid, states, selected);
      const target = column === null ? null : at(deck, grid, selected, column, true);
      if (target) return target;
    }
  }
  // Any studio clip that is playing.
  for (const [deck, grid, states] of decks) {
    for (let layer = 0; layer < grid.length; layer++) {
      const column = playingColumn(grid, states, layer);
      const target = column === null ? null : at(deck, grid, layer, column, true);
      if (target) return target;
    }
  }
  // Any studio clip on the grid.
  for (const [deck, grid] of decks) {
    for (let layer = 0; layer < grid.length; layer++) {
      for (let column = 0; column < (grid[layer]?.length ?? 0); column++) {
        const target = at(deck, grid, layer, column, false);
        if (target) return target;
      }
    }
  }
  return null;
}

function findLayerTarget(layers: Layer[], selectedId: string | null | undefined): StudioTarget | null {
  const asTarget = (layer: Layer | undefined): StudioTarget | null =>
    layer && isStudioSource(layer.source?.effectSource)
      ? { kind: 'layer', layerId: layer.id, name: layer.name, source: studioSourceOf(layer.source?.effectSource) }
      : null;
  return asTarget(layers.find((l) => l.id === selectedId)) ?? layers.map(asTarget).find(Boolean) ?? null;
}

function findTarget(state: LauncherState, layers: Layer[], selectedId: string | null | undefined): StudioTarget | null {
  return state.isOpen ? findVjTarget(state) : findLayerTarget(layers, selectedId);
}

function sameTarget(a: StudioTarget | null, b: StudioTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.source !== b.source) return false;
  if (a.kind === 'vj' && b.kind === 'vj') return a.deck === b.deck && a.layer === b.layer && a.column === b.column && a.playing === b.playing;
  if (a.kind === 'layer' && b.kind === 'layer') return a.layerId === b.layerId && a.name === b.name;
  return false;
}

/** Pass a value on only when it changes (the project and the deck update every frame while performing). */
function distinct<T>(source: Readable<T>, same: (a: T, b: T) => boolean, initial: T): Readable<T> {
  return readable<T>(initial, (set) => {
    let last = initial;
    let first = true;
    return source.subscribe((value) => {
      if (!first && same(last, value)) return;
      first = false;
      last = value;
      set(value);
    });
  });
}

/** The instance the studio plays to now, or null. */
export const studioTarget = distinct(
  derived([vjClipLauncher, project], ([$launcher, $project]) =>
    findTarget($launcher, $project.layers as Layer[], $project.selectedLayerId),
  ),
  sameTarget,
  null as StudioTarget | null,
);

export function studioTargetNow(): StudioTarget | null {
  const p = get(project);
  return findTarget(get(vjClipLauncher), p.layers as Layer[], p.selectedLayerId);
}

function write(target: StudioTarget, next: Required<StudioPluginSource>, gesture?: string): void {
  if (target.kind === 'vj') {
    vjClipLauncher.updateClipEffectSource(target.layer, target.column, next, target.deck);
    return;
  }
  const layer = (get(project).layers as Layer[]).find((l) => l.id === target.layerId);
  if (!layer?.source) return;
  project.setLayerSource(target.layerId, { ...layer.source, effectSource: next } as MediaSource, { gesture });
}

/**
 * Change the instance the studio plays to. Returns false when there is none.
 * `gesture` names a continuous edit (a knob turn), which is one undo step.
 */
export function editStudio(change: (source: Required<StudioPluginSource>) => Required<StudioPluginSource>, gesture?: string): boolean {
  const target = studioTargetNow();
  if (!target) return false;
  write(target, normalizeStudioSource(change(target.source)), gesture);
  return true;
}

function studioClip() {
  return {
    id: generateUUID(),
    type: 'effect' as const,
    name: 'Music Studio',
    src: `plugin://${STUDIO_PLUGIN_ID}`,
    effectSource: defaultStudioSource(),
  };
}

/**
 * Put a Music Studio instance in place: the first free cell on deck A (the
 * selected row first), launched; in mapping, the selected media layer, or a
 * new media layer. Returns the instance, or null when there is no room.
 */
export function placeStudio(): StudioTarget | null {
  const existing = studioTargetNow();
  if (existing) return existing;
  const state = get(vjClipLauncher);
  if (state.isOpen) {
    const rows = state.clipGrid.map((_, i) => i);
    const selected = state.selectedLayerIndex;
    if (selected !== null && selected !== undefined && selected < rows.length) rows.unshift(...rows.splice(selected, 1));
    for (const layer of rows) {
      const column = state.clipGrid[layer]?.findIndex((c) => !c) ?? -1;
      if (column < 0) continue;
      vjClipLauncher.setClip(layer, column, studioClip(), 'A');
      vjClipLauncher.triggerClipNow(layer, column, 'A');
      return studioTargetNow();
    }
    return null;
  }
  const p = get(project);
  const selected = (p.layers as Layer[]).find((l) => l.id === p.selectedLayerId);
  const layerId = selected && selected.type === 'media' ? selected.id : project.addLayer('Music Studio', 'media');
  if (!layerId) return null;
  const clip = studioClip();
  project.setLayerSource(layerId, { id: `plugin-${STUDIO_PLUGIN_ID}-${layerId}-${Date.now()}`, type: 'effect', name: clip.name, src: clip.src, effectSource: clip.effectSource } as MediaSource);
  return studioTargetNow();
}

/** Load a scene's voices into the instance, putting one in place if there is none. */
export function loadSceneIntoStudio(scene: { id: string; set: StudioSet; voices: { file: string; source: VoiceSourceId; params?: Record<string, number>; level?: number }[] }): boolean {
  if (!placeStudio()) return false;
  return editStudio((s) => ({ ...s, musicSet: scene.set, musicSceneId: scene.id, musicVoices: studioVoicesFromScene(scene.voices) }));
}

/** The palette follows the studio's set. */
export function setStudioSet(set: StudioSet): boolean {
  return editStudio((s) => ({ ...s, musicSet: set }));
}

export function addStudioVoice(file: string, source: VoiceSourceId): boolean {
  if (!placeStudio()) return false;
  return editStudio((s) => s.musicVoices.length >= MAX_STUDIO_VOICES ? s : ({
    ...s,
    musicSceneId: null,
    musicVoices: [...s.musicVoices, { file, source, auto: true, level: 1, params: {} }],
  }));
}

export function setStudioVoice(index: number, patch: Partial<StudioVoice>, gesture?: string): boolean {
  return editStudio((s) => ({
    ...s,
    musicVoices: s.musicVoices.map((v, i) => (i === index ? { ...v, ...patch, params: { ...v.params, ...(patch.params ?? {}) } } : v)),
  }), gesture);
}

/** Swap a voice's shader, keeping what it follows and its level; its look starts fresh. */
export function replaceStudioVoice(index: number, file: string): boolean {
  return editStudio((s) => ({
    ...s,
    musicSceneId: null,
    musicVoices: s.musicVoices.map((v, i) => (i === index ? { ...v, file, params: {} } : v)),
  }));
}

export function removeStudioVoice(index: number): boolean {
  return editStudio((s) => ({ ...s, musicSceneId: null, musicVoices: s.musicVoices.filter((_, i) => i !== index) }));
}

export { STUDIO_EFFECT_TYPE };
