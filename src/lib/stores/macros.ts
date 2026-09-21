/**
 * Eight performance macros: output effect bundles plus stable parameter routes.
 * Parameter assignments have independent endpoint ranges and exclusive ownership.
 * Legacy v1 destinations remain opaque and round-trip unchanged.
 */
import { applyMacroAssignments, macroTargetKey, normalizeMacroAssignment, type MacroAssignment, type MacroTarget } from './macroAssignments';
import { writable, get } from 'svelte/store';
import { registerMacroValueSetter } from '../midi/midiRouter';
import { audioStore } from './audio';
import type { Effect, EffectType, EffectParams } from '../types';
import { isNativeSelectableEffect } from '../renderer/nativeEffectCoverage';
import { NATIVE_ENGINE_ONLY } from './settings';

/** Auto-pulse mode for a macro. When set, the macro value cycles
 *  automatically at the specified beat division using the master BPM
 *  (manual tap > MIDI clock > audio-detected). Lets users use macros
 *  as rhythm-driven build-ups without setting up modulation. */
export type MacroPulseMode = 'off' | '1/4' | '1/2' | '1bar' | '2bar' | '4bar';

/** Pulse waveform shape (controls how the macro value moves over a cycle). */
export type MacroPulseShape = 'sine' | 'saw-up' | 'saw-down' | 'tri' | 'square' | 'pulse';

export interface Macro {
  id: string;
  name: string;            // 'ENERGY', 'CHAOS', etc.
  color: string;           // hex accent for the knob ring
  value: number;           // 0..1 wet/dry mix for the effect chain
  /** Effect chain — same Effect type as layer/clip/composition effects.
   *  Order in this array = render order (top → bottom = first → last). */
  effects: Effect[];
  assignments?: MacroAssignment[];
  pulseMode?: MacroPulseMode;
  pulseShape?: MacroPulseShape;
  /** v1 destinations field — preserved verbatim on disk for projects
   *  saved by older Pro builds that still use the routing model. The
   *  new code ignores this completely. */
  _legacyDestinations?: unknown[];
}

export interface MacrosState {
  macros: Macro[];
}

const DEFAULT_NAMES = ['ENERGY', 'CHAOS', 'DRAMA', 'BUILD', 'SUB', 'AIR', 'FX', 'WILD'];
const DEFAULT_COLORS = [
  '#FF8577', // coral
  '#7EC8E3', // cyan
  '#BB86FC', // purple
  '#22c55e', // green
  '#f97316', // orange
  '#3b82f6', // blue
  '#ec4899', // pink
  '#eab308', // yellow
];

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

function createDefaultMacros(): Macro[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `macro-${i + 1}`,
    name: DEFAULT_NAMES[i] || `MACRO ${i + 1}`,
    color: DEFAULT_COLORS[i] || '#888',
    value: 0,
    effects: [],
    pulseMode: 'off' as MacroPulseMode,
    pulseShape: 'sine' as MacroPulseShape,
  }));
}

function createDefaultState(): MacrosState {
  return { macros: createDefaultMacros() };
}

function createMacrosStore() {
  const { subscribe, update, set } = writable<MacrosState>(createDefaultState());

  return {
    subscribe,
    set,

    /** Reset everything — used by reset() / new project. */
    reset() {
      set(createDefaultState());
    },

    /** Hydrate from a saved-project payload. Tolerant of both the v1
     *  shape (destinations array) and the v2 shape (effects array) — v1
     *  destinations are kept verbatim in `_legacyDestinations` so they
     *  survive a round-trip without being interpreted. */
    hydrate(payload: unknown) {
      const p = payload as { macros?: unknown[] } | null;
      if (!p || !Array.isArray(p.macros)) {
        set(createDefaultState());
        return;
      }
      const defaults = createDefaultMacros();
      const validPulse = ['off', '1/4', '1/2', '1bar', '2bar', '4bar'];
      const validShape = ['sine', 'saw-up', 'saw-down', 'tri', 'square', 'pulse'];
      const restoredTargets = new Set<string>();
      const macros: Macro[] = defaults.map((d, i) => {
        const saved = p.macros![i] as Record<string, unknown> | undefined;
        if (!saved) return d;
        const effects = Array.isArray(saved.effects) ? (saved.effects as Effect[]) : [];
        const legacyDests = Array.isArray(saved.destinations) ? saved.destinations : undefined;
        return {
          id: typeof saved.id === 'string' ? saved.id : d.id,
          name: typeof saved.name === 'string' ? saved.name : d.name,
          color: typeof saved.color === 'string' ? saved.color : d.color,
          value: typeof saved.value === 'number' && Number.isFinite(saved.value) ? Math.max(0, Math.min(1, saved.value)) : 0,
          effects,
          assignments: Array.isArray(saved.assignments) ? saved.assignments.map(normalizeMacroAssignment).filter((a): a is MacroAssignment => {
            if (!a) return false;
            const key = macroTargetKey(a.target);
            if (restoredTargets.has(key)) return false;
            restoredTargets.add(key);
            return true;
          }) : [],
          pulseMode: validPulse.includes(saved.pulseMode as string) ? (saved.pulseMode as MacroPulseMode) : 'off',
          pulseShape: validShape.includes(saved.pulseShape as string) ? (saved.pulseShape as MacroPulseShape) : 'sine',
          _legacyDestinations: legacyDests,
        };
      });
      set({ macros });
    },

    /** Mouse, MIDI and auto-pulse share this route to both effect bundles
     * and assigned effect parameters. */
    setMacroValue(macroId: string, value: number) {
      if (!Number.isFinite(value)) return;
      const v = Math.max(0, Math.min(1, value));
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId ? { ...m, value: v } : m),
      }));
      applyMacroAssignments(get({ subscribe }).macros.find(m => m.id === macroId)?.assignments ?? [], v);
    },

    assignParameter(macroId: string, input: MacroAssignment) {
      const assignment = normalizeMacroAssignment(input);
      if (!assignment || !get({ subscribe }).macros.some(m => m.id === macroId)) return;
      const key = macroTargetKey(assignment.target);
      update(s => ({ ...s, macros: s.macros.map(m => ({ ...m,
        assignments: [...(m.assignments ?? []).filter(a => macroTargetKey(a.target) !== key), ...(m.id === macroId ? [assignment] : [])],
      })) }));
      const macro = get({ subscribe }).macros.find(m => m.id === macroId)!;
      applyMacroAssignments([assignment], macro.value);
    },

    unassignParameter(target: MacroTarget) {
      const key = macroTargetKey(target);
      update(s => ({ ...s, macros: s.macros.map(m => ({ ...m,
        assignments: (m.assignments ?? []).filter(a => macroTargetKey(a.target) !== key),
      })) }));
    },

    setMacroName(macroId: string, name: string) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId ? { ...m, name } : m),
      }));
    },

    setMacroColor(macroId: string, color: string) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId ? { ...m, color } : m),
      }));
    },

    /** Auto-pulse — drives the value automatically at a beat division.
     *  Off = manual control only. */
    setPulseMode(macroId: string, mode: MacroPulseMode) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId ? { ...m, pulseMode: mode } : m),
      }));
      ensurePulseTickRunning();
    },

    setPulseShape(macroId: string, shape: MacroPulseShape) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId ? { ...m, pulseShape: shape } : m),
      }));
    },

    // ─── Effect bundle management ────────────────────────────────────

    /** Add an effect to a macro's chain. Returns the new effect's id. */
    addEffect(macroId: string, type: EffectType, params: EffectParams = {} as EffectParams): string {
      if (NATIVE_ENGINE_ONLY && !isNativeSelectableEffect(type)) {
        console.warn(`[macros] blocked non-native effect in native-only mode: ${type}`);
        return '';
      }
      const newId = generateUUID();
      const newEffect: Effect = {
        id: newId,
        type,
        enabled: true,
        params,
        opacity: 1,
        blendMode: 'normal',
      };
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId
          ? { ...m, effects: [...m.effects, newEffect] }
          : m),
      }));
      return newId;
    },

    removeEffect(macroId: string, effectId: string) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId
          ? { ...m, effects: m.effects.filter(e => e.id !== effectId) }
          : m),
      }));
    },

    toggleEffect(macroId: string, effectId: string) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId
          ? { ...m, effects: m.effects.map(e => e.id === effectId ? { ...e, enabled: !e.enabled } : e) }
          : m),
      }));
    },

    updateEffectParams(macroId: string, effectId: string, patch: Partial<EffectParams>) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId
          ? {
              ...m,
              effects: m.effects.map(e => e.id === effectId
                ? { ...e, params: { ...e.params, ...patch } }
                : e),
            }
          : m),
      }));
    },

    /** Update top-level Effect fields (opacity, blendMode) — these
     *  live on the Effect itself, not inside params. */
    updateEffectMeta(macroId: string, effectId: string, patch: { opacity?: number; blendMode?: Effect['blendMode'] }) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId
          ? {
              ...m,
              effects: m.effects.map(e => e.id === effectId
                ? { ...e, ...patch } as Effect
                : e),
            }
          : m),
      }));
    },

    /** Reorder effects within a chain (drag-reorder UI). */
    reorderEffects(macroId: string, fromIndex: number, toIndex: number) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => {
          if (m.id !== macroId) return m;
          if (fromIndex === toIndex) return m;
          if (fromIndex < 0 || fromIndex >= m.effects.length) return m;
          if (toIndex < 0 || toIndex >= m.effects.length) return m;
          const effects = [...m.effects];
          const [moved] = effects.splice(fromIndex, 1);
          effects.splice(toIndex, 0, moved);
          return { ...m, effects };
        }),
      }));
    },

    clearEffects(macroId: string) {
      update(s => ({
        ...s,
        macros: s.macros.map(m => m.id === macroId ? { ...m, effects: [] } : m),
      }));
    },

    /** Snapshot for project save. Writes effects + (back-compat)
     *  destinations + pulse settings. */
    serialize(): { macros: unknown[] } {
      const s = get({ subscribe });
      return {
        macros: s.macros.map(m => ({
          id: m.id,
          name: m.name,
          color: m.color,
          value: m.value,
          effects: m.effects,
          assignments: m.assignments ?? [],
          pulseMode: m.pulseMode,
          pulseShape: m.pulseShape,
          // Round-trip the v1 destinations array if present so older
          // Pro builds reading this file don't lose them.
          ...(m._legacyDestinations ? { destinations: m._legacyDestinations } : {}),
        })),
      };
    },
  };
}

export const macros = createMacrosStore();

// Hardware and mouse use the same assignment dispatch and output mix.
registerMacroValueSetter((macroId: string, value: number) => {
  macros.setMacroValue(macroId, value);
});

// ─── Beat-pulse engine ────────────────────────────────────────────────────
//
// Walks every macro on rAF; for any with pulseMode != 'off', computes a
// phase from current wall time + master BPM and writes the resulting
// value into the macro store. Tick loop self-suspends when no macro is
// pulsing (saves frame budget on idle projects).

const PULSE_EPOCH = performance.now();

function pulseGridToBeats(mode: MacroPulseMode): number {
  switch (mode) {
    case '1/4':  return 1;
    case '1/2':  return 2;
    case '1bar': return 4;
    case '2bar': return 8;
    case '4bar': return 16;
    default:     return 0;
  }
}

function shapePhase(phase: number, shape: MacroPulseShape): number {
  switch (shape) {
    case 'sine':     return (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    case 'tri':      return phase < 0.5 ? phase * 2 : 2 - phase * 2;
    case 'saw-up':   return phase;
    case 'saw-down': return 1 - phase;
    case 'square':   return phase < 0.5 ? 1 : 0;
    case 'pulse':    return phase < 0.1 ? 1 : Math.max(0, 1 - (phase - 0.1) * 4);
    default:         return phase;
  }
}

let pulseTickHandle: number | null = null;
function ensurePulseTickRunning() {
  if (pulseTickHandle !== null) return;
  if (typeof requestAnimationFrame !== 'function') return;
  const tick = () => {
    pulseTickHandle = null;
    const state = get(macros);
    const active = state.macros.filter(m => (m.pulseMode || 'off') !== 'off');
    if (active.length === 0) return;

    const audio = get(audioStore);
    const bpm = audio.manualBPM || audio.bpm || 120;
    if (bpm > 0) {
      const beatMs = 60000 / bpm;
      const now = performance.now();
      for (const m of active) {
        const beats = pulseGridToBeats(m.pulseMode!);
        if (beats === 0) continue;
        const cycleMs = beats * beatMs;
        const elapsed = (now - PULSE_EPOCH) % cycleMs;
        const phase = elapsed / cycleMs;
        const shaped = shapePhase(phase, m.pulseShape || 'sine');
        macros.setMacroValue(m.id, shaped);
      }
    }
    pulseTickHandle = requestAnimationFrame(tick);
  };
  pulseTickHandle = requestAnimationFrame(tick);
}

if (typeof window !== 'undefined' && typeof requestAnimationFrame === 'function') {
  setTimeout(() => ensurePulseTickRunning(), 100);
}
