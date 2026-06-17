import { get, writable } from 'svelte/store';
import { currentBPM } from './audio';

export type VJSequencerPresetMode = 'custom' | 'snake' | 'everyOther' | 'random';

export interface VJLayerSequencerState {
  isOpen: boolean;
  minimized: boolean;
  isPlaying: boolean;
  currentStep: number;
  stepCount: number;
  bpm: number;
  syncToMaster: boolean;
  masterBPM: number;
  subdivision: 1 | 2 | 4;
  crossfade: boolean;
  randomDensity: number;
  presetMode: VJSequencerPresetMode;
  cells: boolean[][];
  opacityOverrides: Record<number, number>;
}

const DEFAULT_STEP_COUNT = 16;

function createCells(layerCount: number, stepCount: number): boolean[][] {
  return Array.from({ length: layerCount }, () => Array.from({ length: stepCount }, () => false));
}

const INITIAL: VJLayerSequencerState = {
  isOpen: false,
  minimized: false,
  isPlaying: false,
  currentStep: 0,
  stepCount: DEFAULT_STEP_COUNT,
  bpm: 120,
  syncToMaster: true,
  masterBPM: 0,
  subdivision: 1,
  crossfade: true,
  randomDensity: 0.35,
  presetMode: 'custom',
  cells: createCells(4, DEFAULT_STEP_COUNT),
  opacityOverrides: {},
};

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Tempo actually driving the steps: the master clock when synced (and live),
 *  otherwise the sequencer's own manual BPM. */
export function effectiveBpm(s: VJLayerSequencerState): number {
  return s.syncToMaster && s.masterBPM > 0 ? s.masterBPM : s.bpm;
}

function stepDuration(s: VJLayerSequencerState): number {
  return (60 / Math.max(1, effectiveBpm(s))) / s.subdivision;
}

function ensureCells(state: VJLayerSequencerState, layerCount: number): boolean[][] {
  return Array.from({ length: layerCount }, (_, layerIdx) => {
    const row = state.cells[layerIdx] ?? [];
    return Array.from({ length: state.stepCount }, (_, stepIdx) => !!row[stepIdx]);
  });
}

function opacitiesAt(state: VJLayerSequencerState, stepIndex: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let layerIdx = 0; layerIdx < state.cells.length; layerIdx++) {
    out[layerIdx] = state.cells[layerIdx]?.[stepIndex] ? 1 : 0;
  }
  return out;
}

function blendedOpacities(state: VJLayerSequencerState, fromStep: number, toStep: number, progress: number): Record<number, number> {
  const out: Record<number, number> = {};
  const t = smoothstep(progress);
  for (let layerIdx = 0; layerIdx < state.cells.length; layerIdx++) {
    const from = state.cells[layerIdx]?.[fromStep] ? 1 : 0;
    const to = state.cells[layerIdx]?.[toStep] ? 1 : 0;
    out[layerIdx] = from * (1 - t) + to * t;
  }
  return out;
}

function evaluateAt(state: VJLayerSequencerState, timeSec: number): Pick<VJLayerSequencerState, 'currentStep' | 'opacityOverrides'> {
  const dur = stepDuration(state);
  const cycle = dur * state.stepCount;
  const wrapped = ((timeSec % cycle) + cycle) % cycle;
  const step = Math.max(0, Math.min(state.stepCount - 1, Math.floor(wrapped / dur)));
  const phase = (wrapped - step * dur) / dur;
  const next = (step + 1) % state.stepCount;
  const fadeStart = 0.72;
  return {
    currentStep: step,
    opacityOverrides: state.crossfade && phase >= fadeStart
      ? blendedOpacities(state, step, next, (phase - fadeStart) / (1 - fadeStart))
      : opacitiesAt(state, step),
  };
}

function createVJLayerSequencerStore() {
  const { subscribe, update, set } = writable<VJLayerSequencerState>({ ...INITIAL });
  let raf: number | null = null;
  let startedAt = 0;

  // Follow the app's master tempo (tap / manual / MIDI / detected — all
  // resolved into `currentBPM`). Stored on state so stepDuration() and the
  // UI read the same number, and so it tracks live while playing.
  currentBPM.subscribe(bpm => {
    const rounded = Math.round(bpm);
    update(s => s.masterBPM === rounded ? s : { ...s, masterBPM: rounded });
  });

  function tick(now: number) {
    const state = get({ subscribe });
    if (!state.isPlaying) {
      raf = null;
      return;
    }
    const next = evaluateAt(state, (now - startedAt) / 1000);
    update(s => ({ ...s, ...next }));
    raf = requestAnimationFrame(tick);
  }

  return {
    subscribe,
    toggleOpen() {
      update(s => ({ ...s, isOpen: !s.isOpen }));
    },
    setOpen(open: boolean) {
      update(s => ({ ...s, isOpen: open }));
    },
    toggleMinimized() {
      update(s => ({ ...s, minimized: !s.minimized }));
    },
    syncLayerCount(layerCount: number) {
      update(s => ({ ...s, cells: ensureCells(s, layerCount), opacityOverrides: { ...s.opacityOverrides } }));
    },
    toggleCell(layerIndex: number, stepIndex: number) {
      update(s => {
        const cells = ensureCells(s, Math.max(s.cells.length, layerIndex + 1));
        cells[layerIndex] = [...cells[layerIndex]];
        cells[layerIndex][stepIndex] = !cells[layerIndex][stepIndex];
        return { ...s, cells, presetMode: 'custom' };
      });
    },
    setStepCount(stepCount: number) {
      update(s => {
        const next = Math.max(4, Math.min(32, stepCount));
        const cells = s.cells.map(row => Array.from({ length: next }, (_, i) => !!row[i]));
        return { ...s, stepCount: next, currentStep: Math.min(s.currentStep, next - 1), cells };
      });
    },
    updateConfig(updates: Partial<Pick<VJLayerSequencerState, 'bpm' | 'syncToMaster' | 'subdivision' | 'crossfade' | 'randomDensity'>>) {
      update(s => ({ ...s, ...updates }));
    },
    generate(mode: VJSequencerPresetMode, layerCount: number) {
      update(s => {
        const cells = createCells(layerCount, s.stepCount);
        for (let step = 0; step < s.stepCount; step++) {
          for (let layer = 0; layer < layerCount; layer++) {
            if (mode === 'snake') cells[layer][step] = layer === step % layerCount;
            else if (mode === 'everyOther') cells[layer][step] = (layer + step) % 2 === 0;
            else if (mode === 'random') cells[layer][step] = Math.random() < s.randomDensity;
          }
        }
        return { ...s, cells, presetMode: mode };
      });
    },
    clear() {
      update(s => ({ ...s, cells: createCells(s.cells.length, s.stepCount), opacityOverrides: {}, presetMode: 'custom' }));
    },
    play() {
      update(s => ({ ...s, isPlaying: true }));
      startedAt = performance.now();
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    },
    pause() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      update(s => ({ ...s, isPlaying: false }));
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      update(s => ({ ...s, isPlaying: false, currentStep: 0, opacityOverrides: {} }));
    },
    seek(timeSec: number) {
      update(s => ({ ...s, ...evaluateAt(s, timeSec) }));
    },
    reset() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      set({ ...INITIAL, cells: createCells(4, DEFAULT_STEP_COUNT) });
    },
  };
}

export const vjLayerSequencer = createVJLayerSequencerStore();
