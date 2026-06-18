import { get, writable } from 'svelte/store';
import { currentBPM } from './audio';

export type VJSequencerPresetMode = 'custom' | 'snake' | 'everyOther' | 'random';
export type VJSequencerDeck = 'A' | 'B';
export type VJSequencerTarget = VJSequencerDeck | 'both';

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
  bankBPresetMode: VJSequencerPresetMode;
  /** Deck A pattern. Kept as `cells` for existing single-deck callers. */
  cells: boolean[][];
  /** Deck B pattern used when the VJ A/B crossfader is enabled. */
  bankBCells: boolean[][];
  /** Deck A opacity overrides. Kept as `opacityOverrides` for existing callers. */
  opacityOverrides: Record<number, number>;
  /** Deck B opacity overrides. */
  bankBOpacityOverrides: Record<number, number>;
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
  bankBPresetMode: 'custom',
  cells: createCells(4, DEFAULT_STEP_COUNT),
  bankBCells: createCells(4, DEFAULT_STEP_COUNT),
  opacityOverrides: {},
  bankBOpacityOverrides: {},
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

function ensureCellMatrix(cells: boolean[][] | undefined, layerCount: number, stepCount: number): boolean[][] {
  return Array.from({ length: layerCount }, (_, layerIdx) => {
    const row = cells?.[layerIdx] ?? [];
    return Array.from({ length: stepCount }, (_, stepIdx) => !!row[stepIdx]);
  });
}

function ensureCells(state: VJLayerSequencerState, layerCount: number): boolean[][] {
  return ensureCellMatrix(state.cells, layerCount, state.stepCount);
}

function ensureBankBCells(state: VJLayerSequencerState, layerCount: number): boolean[][] {
  return ensureCellMatrix(state.bankBCells ?? state.cells, layerCount, state.stepCount);
}

function opacitiesAt(cells: boolean[][], stepIndex: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let layerIdx = 0; layerIdx < cells.length; layerIdx++) {
    out[layerIdx] = cells[layerIdx]?.[stepIndex] ? 1 : 0;
  }
  return out;
}

function blendedOpacities(cells: boolean[][], fromStep: number, toStep: number, progress: number): Record<number, number> {
  const out: Record<number, number> = {};
  const t = smoothstep(progress);
  for (let layerIdx = 0; layerIdx < cells.length; layerIdx++) {
    const from = cells[layerIdx]?.[fromStep] ? 1 : 0;
    const to = cells[layerIdx]?.[toStep] ? 1 : 0;
    out[layerIdx] = from * (1 - t) + to * t;
  }
  return out;
}

function evaluateDeckAt(cells: boolean[][], state: VJLayerSequencerState, step: number, next: number, phase: number): Record<number, number> {
  const fadeStart = 0.72;
  return state.crossfade && phase >= fadeStart
    ? blendedOpacities(cells, step, next, (phase - fadeStart) / (1 - fadeStart))
    : opacitiesAt(cells, step);
}

function createPresetCells(mode: VJSequencerPresetMode, layerCount: number, stepCount: number, randomDensity: number): boolean[][] {
  const cells = createCells(layerCount, stepCount);
  for (let step = 0; step < stepCount; step++) {
    for (let layer = 0; layer < layerCount; layer++) {
      if (mode === 'snake') cells[layer][step] = layer === step % layerCount;
      else if (mode === 'everyOther') cells[layer][step] = (layer + step) % 2 === 0;
      else if (mode === 'random') cells[layer][step] = Math.random() < randomDensity;
    }
  }
  return cells;
}

function evaluateAt(state: VJLayerSequencerState, timeSec: number): Pick<VJLayerSequencerState, 'currentStep' | 'opacityOverrides' | 'bankBOpacityOverrides'> {
  const dur = stepDuration(state);
  const cycle = dur * state.stepCount;
  const wrapped = ((timeSec % cycle) + cycle) % cycle;
  const step = Math.max(0, Math.min(state.stepCount - 1, Math.floor(wrapped / dur)));
  const phase = (wrapped - step * dur) / dur;
  const next = (step + 1) % state.stepCount;
  const cellsA = state.cells;
  const cellsB = state.bankBCells ?? state.cells;
  return {
    currentStep: step,
    opacityOverrides: evaluateDeckAt(cellsA, state, step, next, phase),
    bankBOpacityOverrides: evaluateDeckAt(cellsB, state, step, next, phase),
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
      update(s => ({
        ...s,
        cells: ensureCells(s, layerCount),
        bankBCells: ensureBankBCells(s, layerCount),
        opacityOverrides: { ...s.opacityOverrides },
        bankBOpacityOverrides: { ...(s.bankBOpacityOverrides ?? {}) },
      }));
    },
    toggleCell(layerIndex: number, stepIndex: number, deck: VJSequencerDeck = 'A') {
      update(s => {
        if (deck === 'B') {
          const bankBCells = ensureBankBCells(s, Math.max((s.bankBCells ?? s.cells).length, layerIndex + 1));
          bankBCells[layerIndex] = [...bankBCells[layerIndex]];
          bankBCells[layerIndex][stepIndex] = !bankBCells[layerIndex][stepIndex];
          return { ...s, bankBCells, bankBPresetMode: 'custom' };
        }
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
        const bankBCells = (s.bankBCells ?? s.cells).map(row => Array.from({ length: next }, (_, i) => !!row[i]));
        return { ...s, stepCount: next, currentStep: Math.min(s.currentStep, next - 1), cells, bankBCells };
      });
    },
    updateConfig(updates: Partial<Pick<VJLayerSequencerState, 'bpm' | 'syncToMaster' | 'subdivision' | 'crossfade' | 'randomDensity'>>) {
      update(s => ({ ...s, ...updates }));
    },
    generate(mode: VJSequencerPresetMode, layerCount: number, target: VJSequencerTarget = 'A') {
      update(s => {
        const presetA = target === 'A' || target === 'both'
          ? createPresetCells(mode, layerCount, s.stepCount, s.randomDensity)
          : s.cells;
        const presetB = target === 'B' || target === 'both'
          ? createPresetCells(mode, layerCount, s.stepCount, s.randomDensity)
          : (s.bankBCells ?? s.cells);
        return {
          ...s,
          cells: presetA,
          bankBCells: presetB,
          presetMode: target === 'B' ? s.presetMode : mode,
          bankBPresetMode: target === 'A' ? s.bankBPresetMode : mode,
        };
      });
    },
    clear(target: VJSequencerTarget = 'A') {
      update(s => ({
        ...s,
        cells: target === 'A' || target === 'both' ? createCells(s.cells.length, s.stepCount) : s.cells,
        bankBCells: target === 'B' || target === 'both'
          ? createCells((s.bankBCells ?? s.cells).length, s.stepCount)
          : (s.bankBCells ?? s.cells),
        opacityOverrides: target === 'B' ? s.opacityOverrides : {},
        bankBOpacityOverrides: target === 'A' ? (s.bankBOpacityOverrides ?? {}) : {},
        presetMode: target === 'B' ? s.presetMode : 'custom',
        bankBPresetMode: target === 'A' ? s.bankBPresetMode : 'custom',
      }));
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
      update(s => ({ ...s, isPlaying: false, currentStep: 0, opacityOverrides: {}, bankBOpacityOverrides: {} }));
    },
    seek(timeSec: number) {
      update(s => ({ ...s, ...evaluateAt(s, timeSec) }));
    },
    reset() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      set({ ...INITIAL, cells: createCells(4, DEFAULT_STEP_COUNT), bankBCells: createCells(4, DEFAULT_STEP_COUNT) });
    },
  };
}

export const vjLayerSequencer = createVJLayerSequencerStore();
