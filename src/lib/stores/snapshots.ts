/**
 * Snapshots — capture / recall the live VJ + macro + crossfader state.
 *
 * Different from macros (continuous knob → many params with curves) and
 * different from blocks (clip-grid scenes within a project). A snapshot
 * is a one-click freeze of:
 *   - Per-layer opacity / blend / solo / mute (both decks)
 *   - Crossfader value + transition + curve + enabled flag
 *   - Quantization grid
 *   - Master opacity
 *   - Selected deck + selected layer
 *   - Macro values (the live 0..1 position of each knob, NOT destinations)
 *
 * Recalling a snapshot writes those values back through the existing
 * store mutators so the engine sees them like a normal user action.
 *
 * Use case: nail a look, save as snapshot 1, change everything, save as
 * snapshot 2, then flip between them with a hardware button. Pros call
 * this "scenes" or "presets" depending on which DAW they grew up on.
 */
import { writable, get } from 'svelte/store';
import { vjClipLauncher } from './vjClipLauncher';
import { macros } from './macros';
import { registerSnapshotRecaller } from '../midi/midiRouter';

export interface SnapshotLayerState {
  opacity: number;
  blendMode: string;
  solo: boolean;
  mute: boolean;
}

export interface Snapshot {
  id: string;
  /** 1-indexed slot number for hardware controller bindings (1..16). */
  slot: number;
  name: string;
  color: string;        // hex accent for the badge

  // Captured state (everything is optional so partial snapshots work)
  layerStatesA?: SnapshotLayerState[];
  layerStatesB?: SnapshotLayerState[];
  crossfaderEnabled?: boolean;
  crossfaderValue?: number;
  crossfaderTransition?: string;
  crossfaderCurve?: string;
  quantization?: string;
  masterOpacity?: number;
  selectedDeck?: 'A' | 'B';
  macroValues?: Record<string, number>;   // keyed by macro id

  /** Wall-clock time of last update (for "saved 5 minutes ago" hints). */
  capturedAt: number;
}

export interface SnapshotsState {
  snapshots: Snapshot[];
  /** ID of the most-recently-recalled snapshot (for highlighting in UI). */
  activeId: string | null;
}

const DEFAULT_COLORS = [
  '#FF8577', '#7EC8E3', '#BB86FC', '#22c55e',
  '#f97316', '#3b82f6', '#ec4899', '#eab308',
  '#14b8a6', '#a855f7', '#f43f5e', '#10b981',
  '#fb923c', '#0ea5e9', '#d946ef', '#84cc16',
];

const NUM_SLOTS = 16;

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function createDefaultState(): SnapshotsState {
  // Pre-populate 16 empty slots so the UI shows a fixed bank from the
  // start — users save by clicking, instead of "create snapshot" first.
  return {
    snapshots: Array.from({ length: NUM_SLOTS }, (_, i) => ({
      id: `snap-${i + 1}`,
      slot: i + 1,
      name: '',
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      capturedAt: 0,
    })),
    activeId: null,
  };
}

/** Capture the live VJ + macro state into a Snapshot payload. */
function captureLiveState(): Partial<Snapshot> {
  const vj = get(vjClipLauncher);
  const macroState = get(macros);

  const macroValues: Record<string, number> = {};
  for (const m of macroState.macros) macroValues[m.id] = m.value;

  return {
    layerStatesA: vj.layerStates.map(ls => ({
      opacity: ls.opacity,
      blendMode: ls.blendMode as string,
      solo: ls.solo,
      mute: ls.mute,
    })),
    layerStatesB: vj.bankBLayerStates.map(ls => ({
      opacity: ls.opacity,
      blendMode: ls.blendMode as string,
      solo: ls.solo,
      mute: ls.mute,
    })),
    crossfaderEnabled: vj.crossfaderEnabled,
    crossfaderValue: vj.crossfaderValue,
    crossfaderTransition: vj.crossfaderTransition,
    crossfaderCurve: vj.crossfaderCurve,
    quantization: vj.quantization,
    masterOpacity: vj.masterOpacity,
    selectedDeck: vj.selectedDeck,
    macroValues,
    capturedAt: Date.now(),
  };
}

/** Apply a Snapshot back into live state. Walks each captured field
 *  and writes through the corresponding store mutator so the engine
 *  responds the same way it would to a user action. */
function applySnapshot(snap: Snapshot) {
  // Master + crossfader + quantization (single-shot, scalar writes)
  if (typeof snap.masterOpacity === 'number') {
    vjClipLauncher.setMasterOpacity(snap.masterOpacity);
  }
  if (typeof snap.crossfaderEnabled === 'boolean') {
    // Only flip if state differs — toggling resets the fader to 0 internally.
    const cur = get(vjClipLauncher).crossfaderEnabled;
    if (cur !== snap.crossfaderEnabled) vjClipLauncher.setCrossfaderEnabled(snap.crossfaderEnabled);
  }
  if (typeof snap.crossfaderValue === 'number') {
    vjClipLauncher.setCrossfaderValue(snap.crossfaderValue);
  }
  if (typeof snap.crossfaderTransition === 'string') {
    vjClipLauncher.setCrossfaderTransition(snap.crossfaderTransition as any);
  }
  if (typeof snap.crossfaderCurve === 'string') {
    vjClipLauncher.setCrossfaderCurve(snap.crossfaderCurve as any);
  }
  if (typeof snap.quantization === 'string') {
    vjClipLauncher.setQuantization(snap.quantization as any);
  }
  if (snap.selectedDeck === 'A' || snap.selectedDeck === 'B') {
    vjClipLauncher.setSelectedDeck(snap.selectedDeck);
  }

  // Per-layer state (both decks)
  if (Array.isArray(snap.layerStatesA)) {
    snap.layerStatesA.forEach((ls, i) => {
      vjClipLauncher.setLayerOpacity(i, ls.opacity, 'A');
      vjClipLauncher.setLayerBlendMode(i, ls.blendMode as any, 'A');
      // toggleLayerSolo / toggleLayerMute flip — only fire when state differs
      const cur = get(vjClipLauncher).layerStates[i];
      if (cur && cur.solo !== ls.solo) vjClipLauncher.toggleLayerSolo(i, 'A');
      if (cur && cur.mute !== ls.mute) vjClipLauncher.toggleLayerMute(i, 'A');
    });
  }
  if (Array.isArray(snap.layerStatesB)) {
    snap.layerStatesB.forEach((ls, i) => {
      vjClipLauncher.setLayerOpacity(i, ls.opacity, 'B');
      vjClipLauncher.setLayerBlendMode(i, ls.blendMode as any, 'B');
      const cur = get(vjClipLauncher).bankBLayerStates[i];
      if (cur && cur.solo !== ls.solo) vjClipLauncher.toggleLayerSolo(i, 'B');
      if (cur && cur.mute !== ls.mute) vjClipLauncher.toggleLayerMute(i, 'B');
    });
  }

  // Macro values — restore each knob's live position. Macro destinations
  // are NOT in the snapshot (those are project-level config). Setting
  // the value walks destinations automatically.
  if (snap.macroValues) {
    for (const [id, v] of Object.entries(snap.macroValues)) {
      macros.setMacroValue(id, v);
    }
  }
}

function createSnapshotsStore() {
  const { subscribe, update, set } = writable<SnapshotsState>(createDefaultState());

  return {
    subscribe,
    set,

    reset() {
      set(createDefaultState());
    },

    /** Save current live state to the slot at `index` (0-15). Replaces
     *  any existing snapshot in that slot. Auto-names with timestamp. */
    save(index: number, name?: string) {
      if (index < 0 || index >= NUM_SLOTS) return;
      const captured = captureLiveState();
      update(s => {
        const snapshots = [...s.snapshots];
        const slot = snapshots[index];
        snapshots[index] = {
          ...slot,
          ...captured,
          name: name ?? slot.name ?? `Snapshot ${index + 1}`,
        };
        return { ...s, snapshots, activeId: slot.id };
      });
    },

    /** Recall a snapshot by index. Silently no-ops if the slot is empty
     *  (capturedAt === 0). Marks active so the UI can highlight it. */
    recall(index: number) {
      if (index < 0 || index >= NUM_SLOTS) return;
      const state = get({ subscribe });
      const snap = state.snapshots[index];
      if (!snap || !snap.capturedAt) return;
      applySnapshot(snap);
      update(s => ({ ...s, activeId: snap.id }));
    },

    /** Clear a slot (delete the captured state but keep the placeholder). */
    clear(index: number) {
      if (index < 0 || index >= NUM_SLOTS) return;
      update(s => {
        const snapshots = [...s.snapshots];
        const slot = snapshots[index];
        snapshots[index] = {
          ...slot,
          name: '',
          layerStatesA: undefined,
          layerStatesB: undefined,
          crossfaderEnabled: undefined,
          crossfaderValue: undefined,
          crossfaderTransition: undefined,
          crossfaderCurve: undefined,
          quantization: undefined,
          masterOpacity: undefined,
          selectedDeck: undefined,
          macroValues: undefined,
          capturedAt: 0,
        };
        const newActiveId = s.activeId === slot.id ? null : s.activeId;
        return { ...s, snapshots, activeId: newActiveId };
      });
    },

    rename(index: number, name: string) {
      if (index < 0 || index >= NUM_SLOTS) return;
      update(s => {
        const snapshots = [...s.snapshots];
        if (snapshots[index]) snapshots[index] = { ...snapshots[index], name };
        return { ...s, snapshots };
      });
    },

    serialize(): { snapshots: Snapshot[] } {
      const s = get({ subscribe });
      // Strip empty slots so saves are smaller — populated slots are
      // identifiable by capturedAt > 0.
      return { snapshots: s.snapshots.filter(x => x.capturedAt > 0) };
    },

    hydrate(payload: any) {
      if (!payload || !Array.isArray(payload.snapshots)) {
        set(createDefaultState());
        return;
      }
      const defaults = createDefaultState();
      // Map saved snapshots by slot number into the 16-slot array
      for (const saved of payload.snapshots) {
        if (!saved || typeof saved !== 'object') continue;
        const slotIdx = (typeof saved.slot === 'number' ? saved.slot : 1) - 1;
        if (slotIdx < 0 || slotIdx >= NUM_SLOTS) continue;
        defaults.snapshots[slotIdx] = {
          ...defaults.snapshots[slotIdx],
          ...saved,
          // Always re-snap id + slot from the default so they're consistent
          id: defaults.snapshots[slotIdx].id,
          slot: slotIdx + 1,
        };
      }
      set(defaults);
    },
  };
}

export const snapshots = createSnapshotsStore();

// Bridge MIDI vj:snapshot:N triggers into store recall. Registered after
// the store exists so the router can drive snapshots without a circular
// import.
registerSnapshotRecaller((index: number) => {
  snapshots.recall(index);
});
