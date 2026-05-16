// Layer Sequencer Store
// Step sequencer for layer visibility with crossfade transitions,
// beat-synced and fixed-time timing modes, and preset pattern generation.

import { writable, derived, get } from 'svelte/store';
import type {
  SequencerStep,
  SequencerPattern,
  SequencerConfig,
  SequencerPresetMode,
  SequencerTimingMode,
  SequencerSubdivision,
} from '../types';

// ─── State ───────────────────────────────────────

export interface LayerSequencerState {
  isOpen: boolean;
  isPlaying: boolean;
  currentStep: number;
  pattern: SequencerPattern;
  config: SequencerConfig;
  /** Opacity overrides applied during playback: layerId → 0..1 multiplier */
  opacityOverrides: Record<string, number>;
}

const DEFAULT_CONFIG: SequencerConfig = {
  timingMode: 'fixed',
  bpm: 120,
  subdivision: 1,
  fixedStepDuration: 1.0,
  crossfadeEnabled: true,
  crossfadeDuration: 0.3,
  loop: true,
  presetMode: 'custom',
  randomDensity: 0.3,
};

const DEFAULT_STEP_COUNT = 16;

function createEmptyPattern(stepCount: number): SequencerPattern {
  const steps: SequencerStep[] = [];
  for (let i = 0; i < stepCount; i++) {
    steps.push({ activeLayers: {} });
  }
  return { steps, stepCount };
}

const INITIAL_STATE: LayerSequencerState = {
  isOpen: false,
  isPlaying: false,
  currentStep: 0,
  pattern: createEmptyPattern(DEFAULT_STEP_COUNT),
  config: { ...DEFAULT_CONFIG },
  opacityOverrides: {},
};

// ─── Playback engine state (module-scoped, not in store) ───

let animFrameId: number | null = null;
let lastStepTime = 0;

// ─── Store ───────────────────────────────────────

function createLayerSequencerStore() {
  const { subscribe, update, set } = writable<LayerSequencerState>({ ...INITIAL_STATE });

  // Smoothstep easing: t² × (3 − 2t)
  function smoothstep(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  // Calculate duration of one step in seconds
  function getStepDuration(config: SequencerConfig): number {
    if (config.timingMode === 'beat') {
      const beatSec = 60 / Math.max(1, config.bpm);
      return beatSec / config.subdivision;
    }
    return config.fixedStepDuration;
  }

  // Apply opacity overrides for a given step (no crossfade — immediate)
  function applyStepOpacities(state: LayerSequencerState, stepIndex: number): Record<string, number> {
    const overrides: Record<string, number> = {};
    const step = state.pattern.steps[stepIndex];
    if (!step) return overrides;

    // Collect all layer IDs referenced in any step
    const allLayerIds = new Set<string>();
    for (const s of state.pattern.steps) {
      for (const id of Object.keys(s.activeLayers)) {
        allLayerIds.add(id);
      }
    }

    for (const id of allLayerIds) {
      overrides[id] = step.activeLayers[id] ? 1.0 : 0.0;
    }
    return overrides;
  }

  // Interpolate opacity overrides between two steps during crossfade
  function applyTransitionOpacities(
    state: LayerSequencerState,
    fromStep: number,
    toStep: number,
    progress: number,
  ): Record<string, number> {
    const overrides: Record<string, number> = {};
    const from = state.pattern.steps[fromStep];
    const to = state.pattern.steps[toStep];
    if (!from || !to) return overrides;

    const eased = smoothstep(progress);

    const allLayerIds = new Set<string>();
    for (const s of state.pattern.steps) {
      for (const id of Object.keys(s.activeLayers)) {
        allLayerIds.add(id);
      }
    }

    for (const id of allLayerIds) {
      const fromVal = from.activeLayers[id] ? 1.0 : 0.0;
      const toVal = to.activeLayers[id] ? 1.0 : 0.0;
      overrides[id] = fromVal * (1 - eased) + toVal * eased;
    }
    return overrides;
  }

  // Get next step index (respecting loop)
  function nextStepIndex(state: LayerSequencerState): number {
    const next = state.currentStep + 1;
    if (next >= state.pattern.stepCount) {
      return state.config.loop ? 0 : state.pattern.stepCount - 1;
    }
    return next;
  }

  // ─── RAF playback tick ───

  function tick(now: number) {
    const state = get(store);
    if (!state.isPlaying) {
      animFrameId = null;
      return;
    }

    const stepDuration = getStepDuration(state.config);
    const elapsed = (now - lastStepTime) / 1000;

    // Clamp crossfade to 80% of step duration
    const maxCrossfade = stepDuration * 0.8;
    const crossfadeDur = state.config.crossfadeEnabled
      ? Math.min(state.config.crossfadeDuration, maxCrossfade)
      : 0;

    let newOverrides: Record<string, number>;

    if (crossfadeDur > 0 && elapsed >= stepDuration - crossfadeDur) {
      // In crossfade zone — blend toward next step
      const fadeProgress = (elapsed - (stepDuration - crossfadeDur)) / crossfadeDur;
      const nextIdx = nextStepIndex(state);
      newOverrides = applyTransitionOpacities(state, state.currentStep, nextIdx, fadeProgress);
    } else {
      // Fully on current step
      newOverrides = applyStepOpacities(state, state.currentStep);
    }

    if (elapsed >= stepDuration) {
      // Advance to next step
      const nextIdx = nextStepIndex(state);
      const atEnd = state.currentStep + 1 >= state.pattern.stepCount;

      if (atEnd && !state.config.loop) {
        // End of sequence, not looping → stop
        update(s => ({
          ...s,
          isPlaying: false,
          opacityOverrides: applyStepOpacities(s, s.currentStep),
        }));
        animFrameId = null;
        return;
      }

      lastStepTime = now;
      newOverrides = applyStepOpacities(state, nextIdx);
      update(s => ({ ...s, currentStep: nextIdx, opacityOverrides: newOverrides }));
    } else {
      update(s => ({ ...s, opacityOverrides: newOverrides }));
    }

    animFrameId = requestAnimationFrame(tick);
  }

  const store = {
    subscribe,

    // ─── UI ───

    toggleOpen() {
      update(s => ({ ...s, isOpen: !s.isOpen }));
    },

    setOpen(open: boolean) {
      update(s => ({ ...s, isOpen: open }));
    },

    // ─── Pattern editing ───

    toggleCell(stepIndex: number, layerId: string) {
      update(s => {
        const steps = [...s.pattern.steps];
        const step = { ...steps[stepIndex] };
        step.activeLayers = { ...step.activeLayers };
        step.activeLayers[layerId] = !step.activeLayers[layerId];
        steps[stepIndex] = step;
        return {
          ...s,
          pattern: { ...s.pattern, steps },
          config: { ...s.config, presetMode: 'custom' as SequencerPresetMode },
        };
      });
    },

    setStepCount(count: number) {
      update(s => {
        const newSteps: SequencerStep[] = [];
        for (let i = 0; i < count; i++) {
          newSteps.push(s.pattern.steps[i] ?? { activeLayers: {} });
        }
        return {
          ...s,
          currentStep: Math.min(s.currentStep, count - 1),
          pattern: { steps: newSteps, stepCount: count },
        };
      });
    },

    generatePattern(mode: SequencerPresetMode, layerIds: string[]) {
      update(s => {
        const steps: SequencerStep[] = [];
        const count = s.pattern.stepCount;
        const n = layerIds.length;

        for (let i = 0; i < count; i++) {
          const activeLayers: Record<string, boolean> = {};

          if (mode === 'snake') {
            // One layer at a time, cycling through
            const activeIdx = i % n;
            layerIds.forEach((id, idx) => {
              activeLayers[id] = idx === activeIdx;
            });
          } else if (mode === 'everyOther') {
            // Alternating layers, pattern shifts each step
            layerIds.forEach((id, idx) => {
              activeLayers[id] = (idx + i) % 2 === 0;
            });
          } else if (mode === 'random') {
            // Random activation based on density
            layerIds.forEach(id => {
              activeLayers[id] = Math.random() < s.config.randomDensity;
            });
          }
          // 'custom' — no auto-generation

          steps.push({ activeLayers });
        }

        return {
          ...s,
          pattern: { steps, stepCount: count },
          config: { ...s.config, presetMode: mode },
        };
      });
    },

    clearPattern() {
      update(s => ({
        ...s,
        pattern: createEmptyPattern(s.pattern.stepCount),
        config: { ...s.config, presetMode: 'custom' as SequencerPresetMode },
      }));
    },

    // ─── Config ───

    updateConfig(updates: Partial<SequencerConfig>) {
      update(s => ({
        ...s,
        config: { ...s.config, ...updates },
      }));
    },

    // ─── Playback ───

    play() {
      update(s => {
        if (s.isPlaying) return s;
        return { ...s, isPlaying: true };
      });
      lastStepTime = performance.now();
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(tick);
    },

    pause() {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      update(s => ({ ...s, isPlaying: false }));
    },

    stop() {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      update(s => ({
        ...s,
        isPlaying: false,
        currentStep: 0,
        opacityOverrides: {},
      }));
    },

    seekStep(index: number) {
      update(s => {
        const clamped = Math.max(0, Math.min(index, s.pattern.stepCount - 1));
        return {
          ...s,
          currentStep: clamped,
          opacityOverrides: applyStepOpacities(s, clamped),
        };
      });
      lastStepTime = performance.now();
    },

    /** Serialize the pattern + config for project save. Excludes runtime
     *  fields (isPlaying, currentStep, opacityOverrides) which are session
     *  state, not composition state. `isOpen` is kept because the user
     *  expects the panel to be where they left it on reopen. */
    serialize(): { pattern: SequencerPattern; config: SequencerConfig; isOpen: boolean } {
      const s = get({ subscribe });
      return {
        pattern: s.pattern,
        config: s.config,
        isOpen: s.isOpen,
      };
    },

    /** Restore from project save. Stops playback (no auto-start on load —
     *  would surprise the user) and resets the playhead to step 0. */
    hydrate(payload: any) {
      if (!payload || typeof payload !== 'object') {
        set({ ...INITIAL_STATE });
        return;
      }
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      const pattern = payload.pattern && typeof payload.pattern === 'object' && Array.isArray(payload.pattern.steps)
        ? payload.pattern as SequencerPattern
        : createEmptyPattern(DEFAULT_STEP_COUNT);
      const config = payload.config && typeof payload.config === 'object'
        ? { ...DEFAULT_CONFIG, ...payload.config }
        : { ...DEFAULT_CONFIG };
      set({
        isOpen: !!payload.isOpen,
        isPlaying: false,
        currentStep: 0,
        pattern,
        config,
        opacityOverrides: {},
      });
    },
  };

  return store;
}

export const layerSequencer = createLayerSequencerStore();

// Derived convenience stores
export const sequencerIsOpen = derived(layerSequencer, s => s.isOpen);
export const sequencerIsPlaying = derived(layerSequencer, s => s.isPlaying);
export const sequencerOpacities = derived(layerSequencer, s => s.opacityOverrides);
