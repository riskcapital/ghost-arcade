/**
 * screens.ts — first-class store for output Screens.
 *
 * A "Screen" is one output region of the rig — typically one projector,
 * one Spout/Syphon/NDI sender, or one physical monitor. The user manages
 * Screens from the Screens tab in the left sidebar (parallel to Layers)
 * and tweaks them live without leaving the editor canvas.
 *
 * Source of truth: `$settings.output.slices` (kept in settings for
 * legacy reasons + because Canvas.svelte's per-frame extractor reads
 * from settings). Persistence to .gha happens via project.outputSlices
 * — handled by layers.ts importProject / exportProject. This store
 * exposes a Screen-centric API on top, so the new Screens UI doesn't
 * have to know about the legacy slice naming.
 *
 * Why not move the data to `$project.outputSlices` as source-of-truth?
 * The per-frame slice extractor in Canvas.svelte:1588 already reads
 * `$settings.output.slices` every tick. Moving the source would force
 * an N-fold refactor of that path AND state-sync wiring (settings is
 * already broadcast cross-window via the BroadcastChannel — project
 * goes through a different sync channel). Keeping settings as the
 * runtime source and project as the persistence snapshot is the
 * pragmatic split.
 */

import { derived, get, writable } from 'svelte/store';
import {
  settings,
  createDefaultSlice,
  migrateOutputSlice,
  cornersFromRect,
  meshFromRect,
  type OutputSlice,
} from './settings';
import { maxOutputSlices } from './license';
import type { Effect, EffectType } from '../types';
import { getDefaultEffectParams } from '../renderer/effects';

// Derived store mirroring $settings.output.slices. Components subscribe
// to this for reactive screen-list updates.
export const screens = derived(settings, ($s) => $s.output.slices);

// Currently-selected screen in the Screens panel. Drives the inspector
// + the on-canvas warp-handle overlay (which screen's geometry is
// editable right now). Independent of `selectedLayerId` because the
// user is in a different authoring mode.
export const selectedScreenId = writable<string | null>(null);
export const selectedScreen = derived(
  [screens, selectedScreenId],
  ([$ss, $id]) => ($id ? $ss.find(s => s.id === $id) ?? null : null)
);

function update(fn: (slices: OutputSlice[]) => OutputSlice[]) {
  settings.update(s => ({ ...s, output: { ...s.output, slices: fn(s.output.slices) } }));
}

function generateId(prefix = 'screen'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Lifecycle ─────────────────────────────────────────────────────────
export const screenActions = {
  /** Add a new screen. Defaults to a full-canvas rectangle; the operator
   *  drags the warp handles to position it. Returns the new screen's id
   *  (the caller usually wants to select it next). */
  add(): string | null {
    const max = get(maxOutputSlices);
    let id: string | null = null;
    update(slices => {
      if (slices.length >= max) return slices;
      const idx = slices.length;
      const names = ['Left', 'Center', 'Right', 'Top', 'Bottom', 'Aux-1', 'Aux-2', 'Aux-3'];
      const name = names[idx] || `Screen ${idx + 1}`;
      id = generateId();
      // Distribute new screen horizontally; existing screens shrink
      // proportionally — matches the convention from the old settings
      // panel so users coming from v1.6 don't see a jarring layout flip.
      const count = slices.length + 1;
      const resized = slices.map((sc, i) => ({ ...sc, cropX: i / count, cropW: 1 / count }));
      resized.push(createDefaultSlice(id, name, name, (count - 1) / count, 1 / count));
      return resized;
    });
    return id;
  },

  remove(screenId: string) {
    update(slices => {
      const filtered = slices.filter(s => s.id !== screenId);
      // Re-distribute crop regions so the operator's existing layout
      // stays visually balanced.
      const count = filtered.length;
      return count > 0
        ? filtered.map((sc, i) => ({ ...sc, cropX: i / count, cropW: 1 / count }))
        : [];
    });
    const sel = get(selectedScreenId);
    if (sel === screenId) selectedScreenId.set(null);
  },

  duplicate(screenId: string): string | null {
    const src = get(screens).find(s => s.id === screenId);
    if (!src) return null;
    const max = get(maxOutputSlices);
    let id: string | null = null;
    update(slices => {
      if (slices.length >= max) return slices;
      id = generateId();
      const copy: OutputSlice = {
        ...src,
        id,
        name: `${src.name} copy`,
        spoutName: `${src.spoutName}-copy`,
        // Offset crop slightly so the dupe is visible.
        cropX: Math.min(0.9, src.cropX + 0.05),
        cropY: Math.min(0.9, src.cropY + 0.05),
      };
      return [...slices, copy];
    });
    return id;
  },

  update(screenId: string, partial: Partial<OutputSlice>) {
    update(slices => slices.map(s => (s.id === screenId ? { ...s, ...partial } : s)));
  },

  /** Re-order screens. The render order doesn't matter for output
   *  (each screen is independent), but the UI list order does — users
   *  expect their named screens to stay in the order they laid them
   *  out. */
  reorder(fromIdx: number, toIdx: number) {
    update(slices => {
      if (fromIdx < 0 || fromIdx >= slices.length || toIdx < 0 || toIdx >= slices.length) return slices;
      const arr = slices.slice();
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  },

  /** Apply a layout preset — replaces the current screens. Used by
   *  the "Quick setup" buttons in the Screens panel for first-time
   *  multi-projector configuration. */
  applyPreset(layout: '2-wide' | '3-wide' | '2x2') {
    const max = get(maxOutputSlices);
    let next: OutputSlice[];
    const t = Date.now();
    if (layout === '2-wide') {
      next = [
        createDefaultSlice(`screen-${t}-0`, 'Left', 'Left', 0, 0.5),
        createDefaultSlice(`screen-${t}-1`, 'Right', 'Right', 0.5, 0.5),
      ];
    } else if (layout === '3-wide') {
      next = [
        createDefaultSlice(`screen-${t}-0`, 'Left', 'Left', 0, 1 / 3),
        createDefaultSlice(`screen-${t}-1`, 'Center', 'Center', 1 / 3, 1 / 3),
        createDefaultSlice(`screen-${t}-2`, 'Right', 'Right', 2 / 3, 1 / 3),
      ];
    } else {
      next = [
        { ...createDefaultSlice(`screen-${t}-0`, 'Top-Left', 'TL', 0, 0.5), cropY: 0, cropH: 0.5 },
        { ...createDefaultSlice(`screen-${t}-1`, 'Top-Right', 'TR', 0.5, 0.5), cropY: 0, cropH: 0.5 },
        { ...createDefaultSlice(`screen-${t}-2`, 'Bottom-Left', 'BL', 0, 0.5), cropY: 0.5, cropH: 0.5 },
        { ...createDefaultSlice(`screen-${t}-3`, 'Bottom-Right', 'BR', 0.5, 0.5), cropY: 0.5, cropH: 0.5 },
      ];
    }
    update(() => next.slice(0, max));
  },

  // ─── Warp mode flip ───────────────────────────────────────────────────
  /** Switch a screen's warpMode. When flipping rect → corners we
   *  derive the four corners from the current rect so the visual
   *  output is unchanged; the user can then drag the corner handles.
   *  Same idea for rect → mesh: lay out a flat grid first. */
  setWarpMode(screenId: string, mode: 'rect' | 'corners' | 'mesh') {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    const patch: Partial<OutputSlice> = { warpMode: mode };
    if (mode === 'corners' && !s.corners) patch.corners = cornersFromRect(s);
    if (mode === 'mesh' && !s.meshGrid) patch.meshGrid = meshFromRect(s);
    this.update(screenId, patch);
  },

  /** Reset corners / mesh to a flat rect so the screen visually
   *  matches its crop region. Useful when a warp got out of hand. */
  resetWarp(screenId: string) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    this.update(screenId, {
      corners: cornersFromRect(s),
      meshGrid: meshFromRect(s),
    });
  },

  // ─── Effect chain ─────────────────────────────────────────────────────
  /** Append a per-screen effect. Effects are applied to the screen's
   *  rendered output AFTER warp+blend, before present. */
  addEffect(screenId: string, effectType: EffectType): string {
    const id = generateId('fx');
    const effect: Effect = {
      id,
      type: effectType,
      enabled: true,
      params: getDefaultEffectParams(effectType),
      opacity: 1,
      blendMode: 'normal',
    };
    this.update(screenId, {
      effects: [...(get(screens).find(s => s.id === screenId)?.effects ?? []), effect],
    });
    return id;
  },

  removeEffect(screenId: string, effectId: string) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    this.update(screenId, { effects: (s.effects ?? []).filter(e => e.id !== effectId) });
  },

  updateEffect(screenId: string, effectId: string, partial: Partial<Effect>) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    this.update(screenId, {
      effects: (s.effects ?? []).map(e => (e.id === effectId ? { ...e, ...partial } : e)),
    });
  },

  reorderEffects(screenId: string, fromIdx: number, toIdx: number) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s || !s.effects) return;
    if (fromIdx < 0 || fromIdx >= s.effects.length || toIdx < 0 || toIdx >= s.effects.length) return;
    const arr = s.effects.slice();
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    this.update(screenId, { effects: arr });
  },

  // ─── Stage effect binding ─────────────────────────────────────────────
  bindStageEffect(screenId: string, stageEffectId: string | null) {
    this.update(screenId, { stageEffectId });
  },
  // Per-Screen output-warp actions removed — geometric warping is now
  // done globally by the Master Warp; a Screen is just a rect slice.
};

/** Hydrate the screens store from a parsed project. Called by
 *  layers.ts importProject. We migrate each entry through the
 *  per-slice migration so older .gha files pick up new fields. */
export function hydrateScreensFromProject(
  outputSlices: unknown[],
  masterCanvasWidth?: number,
  masterCanvasHeight?: number,
) {
  if (!Array.isArray(outputSlices)) return;
  const migrated = outputSlices.map((s: any) =>
    migrateOutputSlice({ ...s, id: s?.id ?? generateId() })
  );
  settings.update(curr => ({
    ...curr,
    output: {
      ...curr.output,
      slices: migrated,
      ...(typeof masterCanvasWidth === 'number' ? { masterCanvasWidth } : {}),
      ...(typeof masterCanvasHeight === 'number' ? { masterCanvasHeight } : {}),
    },
  }));
}
