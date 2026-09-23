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
import { showToast } from './errorToast';
import {
  settings,
  createDefaultSlice,
  migrateOutputSlice,
  cornersFromRect,
  meshFromRect,
  type OutputSlice,
  type ScreenMask,
} from './settings';
import type { Point2D } from '../types';
import { maxOutputSlices } from './license';
import type { Effect, EffectType } from '../types';
import { getDefaultEffectParams } from '../renderer/effects';
import { isNativeSelectableEffect } from '../renderer/nativeEffectCoverage';
import { NATIVE_ENGINE_ONLY } from './settings';

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

// Which of the selected screen's masks is being edited. Its vertices get
// handles on the editor canvas; the others only draw their outline.
export const selectedScreenMaskId = writable<string | null>(null);
// True while the operator is placing vertices: each click on the editor
// canvas appends a point to the selected mask. Cleared by Done, Escape,
// or selecting a different screen.
export const screenMaskPlacing = writable(false);
selectedScreenId.subscribe(() => {
  selectedScreenMaskId.set(null);
  screenMaskPlacing.set(false);
});

function update(fn: (slices: OutputSlice[]) => OutputSlice[]) {
  settings.update(s => ({ ...s, output: { ...s.output, slices: fn(s.output.slices) } }));
}

function generateId(prefix = 'screen'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneMasks(masks: ScreenMask[] | undefined, freshIds = false): ScreenMask[] {
  return (masks ?? []).map(m => ({
    ...m,
    id: freshIds ? generateId('mask') : m.id,
    points: m.points.map(p => ({ x: p.x, y: p.y })),
  }));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
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
        // Masks are edited in place, so the copy needs its own vertices.
        masks: cloneMasks(src.masks, true),
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
    if (NATIVE_ENGINE_ONLY && !isNativeSelectableEffect(effectType)) {
      console.warn(`[screens] blocked non-native screen effect in native-only mode: ${effectType}`);
      return '';
    }
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

  // ─── Masks ────────────────────────────────────────────────────────────
  // Every mutation rebuilds the masks array (never mutates in place) so
  // the settings store, the canvas overlay and the native sync all see a
  // new reference and re-run.
  /** Add an empty mask, select it and enter placing mode: the operator
   *  clicks on the canvas to drop its vertices. Returns the mask id. */
  addMask(screenId: string): string | null {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return null;
    const id = generateId('mask');
    const mask: ScreenMask = {
      id,
      name: `Mask ${(s.masks?.length ?? 0) + 1}`,
      enabled: true,
      points: [],
      feather: 0,
      invert: false,
    };
    this.update(screenId, { masks: [...cloneMasks(s.masks), mask] });
    selectedScreenMaskId.set(id);
    screenMaskPlacing.set(true);
    return id;
  },

  removeMask(screenId: string, maskId: string) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    this.update(screenId, { masks: cloneMasks(s.masks).filter(m => m.id !== maskId) });
    if (get(selectedScreenMaskId) === maskId) {
      selectedScreenMaskId.set(null);
      screenMaskPlacing.set(false);
    }
  },

  updateMask(screenId: string, maskId: string, partial: Partial<Omit<ScreenMask, 'id'>>) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    this.update(screenId, {
      masks: cloneMasks(s.masks).map(m => (m.id === maskId
        ? { ...m, ...partial, ...(partial.feather != null ? { feather: clamp01(partial.feather) } : {}) }
        : m)),
    });
  },

  /** Append a vertex, or insert it before `index` (edge midpoint
   *  handles use this so a point lands between its two neighbours). */
  addMaskPoint(screenId: string, maskId: string, point: Point2D, index?: number) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    this.update(screenId, {
      masks: cloneMasks(s.masks).map(m => {
        if (m.id !== maskId) return m;
        const points = m.points.slice();
        const at = index == null ? points.length : Math.max(0, Math.min(points.length, index));
        points.splice(at, 0, { x: clamp01(point.x), y: clamp01(point.y) });
        return { ...m, points };
      }),
    });
  },

  updateMaskPoint(screenId: string, maskId: string, index: number, point: Point2D) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    this.update(screenId, {
      masks: cloneMasks(s.masks).map(m => (m.id === maskId
        ? { ...m, points: m.points.map((p, i) => (i === index ? { x: clamp01(point.x), y: clamp01(point.y) } : p)) }
        : m)),
    });
  },

  removeMaskPoint(screenId: string, maskId: string, index: number) {
    const s = get(screens).find(sc => sc.id === screenId);
    if (!s) return;
    this.update(screenId, {
      masks: cloneMasks(s.masks).map(m => (m.id === maskId
        ? { ...m, points: m.points.filter((_, i) => i !== index) }
        : m)),
    });
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

// ── Composite NDI output engagement ──────────────────────────────────
// The main process owns the NDI composite pump (electron/main.js
// startNdiOutputPump): it taps the native renderer's IOSurface output
// at full rate and streams it as ONE NDI sender. This module-level
// subscription is the single engagement point: whenever ANY sender-
// targeted screen selects the 'ndi' transport, start the pump under
// that screen's sender name; when none do, stop it. Renamed screens
// restart the pump under the new name (outputStart is idempotent for
// an unchanged name). No-ops outside Electron (bridge absent).
let lastNdiOutputName: string | null = null;
let ndiOutputChange = 0;
let ndiOutputQueue: Promise<void> = Promise.resolve();
if (typeof window !== 'undefined') {
  screens.subscribe((slices) => {
    const bridge = (window as unknown as {
      ghostNDI?: {
        outputStart?: (o: { name: string }) => Promise<unknown>;
        outputStop?: () => Promise<unknown>;
      };
    }).ghostNDI;
    if (!bridge?.outputStart) return;
    const ndiSlice = (slices ?? []).find(
      (s) => (s.targetType ?? 'sender') === 'sender' && s.outputType === 'ndi'
    );
    const wanted = ndiSlice ? (ndiSlice.spoutName || 'Ghost Arcade') : null;
    if (wanted === lastNdiOutputName) return;
    lastNdiOutputName = wanted;
    const change = ++ndiOutputChange;
    // Serialize start/stop so a slow start cannot resurrect a removed sender.
    ndiOutputQueue = ndiOutputQueue.then(async () => {
      if (change !== ndiOutputChange) return;
      try {
        const result = wanted
          ? await bridge.outputStart!({ name: wanted })
          : await bridge.outputStop?.();
        if (change !== ndiOutputChange) return;
        const status = result as { ok?: boolean; reason?: string; error?: string } | undefined;
        if (status?.ok === false) {
          showToast(`NDI output: ${status.reason || status.error || 'Could not change output state.'}`, 'error');
        }
      } catch (error) {
        if (change === ndiOutputChange) showToast(`NDI output: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    });
  });
}
