import { get, writable } from 'svelte/store';
import { currentBPM } from './audio';

export type VJSequencerPresetMode = 'custom' | 'snake' | 'everyOther' | 'random';
export type VJSequencerDeck = 'A' | 'B';
export type VJSequencerTarget = VJSequencerDeck | 'both';
export type VJSequencerSubdivision = 0.0625 | 0.125 | 0.25 | 0.5 | 1 | 2 | 4;

export interface VJLayerSequencerState {
  isOpen: boolean;
  minimized: boolean;
  isPlaying: boolean;
  currentStep: number;
  stepCount: number;
  bpm: number;
  syncToMaster: boolean;
  masterBPM: number;
  subdivision: VJSequencerSubdivision;
  crossfade: boolean;
  crossfadeDuration: number;
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
const SUBDIVISION_VALUES: VJSequencerSubdivision[] = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4];

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
  crossfadeDuration: 0.2,
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

function clampCrossfadeDuration(value: unknown): number {
  return Math.max(0.05, Math.min(8, Number(value) || 0.2));
}

function sanitizeSubdivision(value: unknown, fallback: VJSequencerSubdivision): VJSequencerSubdivision {
  const numeric = Number(value);
  return SUBDIVISION_VALUES.includes(numeric as VJSequencerSubdivision)
    ? numeric as VJSequencerSubdivision
    : fallback;
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
  const fadePortion = Math.min(0.95, clampCrossfadeDuration(state.crossfadeDuration) / Math.max(0.001, stepDuration(state)));
  const fadeStart = 1 - fadePortion;
  return state.crossfade && fadePortion > 0 && phase >= fadeStart
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

function sanitizeSyncedState(current: VJLayerSequencerState, payload: Partial<VJLayerSequencerState> | null | undefined): VJLayerSequencerState {
  if (!payload || typeof payload !== 'object') return current;

  const stepCount = Math.max(4, Math.min(32, Number(payload.stepCount ?? current.stepCount) || current.stepCount));
  const layerCount = Math.max(
    current.cells.length,
    Array.isArray(payload.cells) ? payload.cells.length : 0,
    Array.isArray(payload.bankBCells) ? payload.bankBCells.length : 0,
  );

  return {
    ...current,
    ...payload,
    isOpen: Boolean(payload.isOpen ?? current.isOpen),
    minimized: Boolean(payload.minimized ?? current.minimized),
    isPlaying: Boolean(payload.isPlaying ?? current.isPlaying),
    currentStep: Math.max(0, Math.min(stepCount - 1, Number(payload.currentStep ?? current.currentStep) || 0)),
    stepCount,
    bpm: Math.max(1, Number(payload.bpm ?? current.bpm) || current.bpm),
    syncToMaster: Boolean(payload.syncToMaster ?? current.syncToMaster),
    masterBPM: Math.max(0, Number(payload.masterBPM ?? current.masterBPM) || 0),
    subdivision: sanitizeSubdivision(payload.subdivision, current.subdivision),
    crossfade: Boolean(payload.crossfade ?? current.crossfade),
    crossfadeDuration: clampCrossfadeDuration(payload.crossfadeDuration ?? current.crossfadeDuration),
    randomDensity: Math.max(0, Math.min(1, Number(payload.randomDensity ?? current.randomDensity) || 0)),
    presetMode: payload.presetMode ?? current.presetMode,
    bankBPresetMode: payload.bankBPresetMode ?? current.bankBPresetMode,
    cells: ensureCellMatrix(payload.cells ?? current.cells, layerCount, stepCount),
    bankBCells: ensureCellMatrix(payload.bankBCells ?? current.bankBCells ?? current.cells, layerCount, stepCount),
    opacityOverrides: payload.opacityOverrides && typeof payload.opacityOverrides === 'object'
      ? { ...payload.opacityOverrides }
      : current.opacityOverrides,
    bankBOpacityOverrides: payload.bankBOpacityOverrides && typeof payload.bankBOpacityOverrides === 'object'
      ? { ...payload.bankBOpacityOverrides }
      : current.bankBOpacityOverrides,
  };
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

function sameOpacityMap(a: Record<number, number>, b: Record<number, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (Math.abs((a as any)[key] - ((b as any)[key] ?? Number.NaN)) > 0.0005) return false;
  }
  return true;
}

function createVJLayerSequencerStore() {
  const { subscribe, update, set } = writable<VJLayerSequencerState>({ ...INITIAL });
  let raf: number | null = null;
  let startedAt = 0;

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function startLoop(transportTimeSec = 0) {
    stopLoop();
    startedAt = performance.now() - Math.max(0, transportTimeSec) * 1000;
    raf = requestAnimationFrame(tick);
  }

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
    if (
      next.currentStep !== state.currentStep
      || !sameOpacityMap(next.opacityOverrides, state.opacityOverrides)
      || !sameOpacityMap(next.bankBOpacityOverrides, state.bankBOpacityOverrides ?? {})
    ) {
      update(s => ({ ...s, ...next }));
    }
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
    updateConfig(updates: Partial<Pick<VJLayerSequencerState, 'bpm' | 'syncToMaster' | 'subdivision' | 'crossfade' | 'crossfadeDuration' | 'randomDensity'>>) {
      update(s => ({
        ...s,
        ...updates,
        crossfadeDuration: updates.crossfadeDuration === undefined
          ? s.crossfadeDuration
          : clampCrossfadeDuration(updates.crossfadeDuration),
      }));
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
      update(s => ({ ...s, isPlaying: true, ...evaluateAt(s, 0) }));
      startLoop(0);
    },
    pause() {
      stopLoop();
      update(s => ({ ...s, isPlaying: false }));
    },
    stop() {
      stopLoop();
      update(s => ({ ...s, isPlaying: false, currentStep: 0, opacityOverrides: {}, bankBOpacityOverrides: {} }));
    },
    seek(timeSec: number) {
      update(s => ({ ...s, ...evaluateAt(s, timeSec) }));
    },
    hydrate(payload: Partial<VJLayerSequencerState> | null | undefined) {
      const transportTimeSec = Math.max(0, Number((payload as any)?.transportTimeSec ?? 0) || 0);
      let shouldPlay = false;
      update(s => sanitizeSyncedState(s, payload));
      update(s => {
        shouldPlay = s.isPlaying;
        return shouldPlay ? { ...s, ...evaluateAt(s, transportTimeSec) } : s;
      });
      if (shouldPlay) startLoop(transportTimeSec);
      else stopLoop();
    },
    getTransportTimeSec(): number {
      const state = get({ subscribe });
      return state.isPlaying ? Math.max(0, (performance.now() - startedAt) / 1000) : 0;
    },
    serialize(): VJLayerSequencerState {
      return JSON.parse(JSON.stringify(get({ subscribe }))) as VJLayerSequencerState;
    },
    reset() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      set({ ...INITIAL, cells: createCells(4, DEFAULT_STEP_COUNT), bankBCells: createCells(4, DEFAULT_STEP_COUNT) });
    },
  };
}

export const vjLayerSequencer = createVJLayerSequencerStore();
