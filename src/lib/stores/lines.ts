// Lines Store — Drawing interaction state for the Lines layer
// Manages tool mode and active drawing points
// Element CRUD lives on the project store (layers.ts)

import { writable, get } from 'svelte/store';
import type { Point2D } from '../types';
import type { LineToolMode, LineShape, FreehandLine, PointClickLine } from '../lines/types';
import { createDefaultFreehandLine, createDefaultPointClickLine } from '../lines/types';

// ============================================================================
// STORE STATE
// ============================================================================

interface LinesState {
  toolMode: LineToolMode;   // 'select' | 'freehand' | 'pointClick'
  isDrawing: boolean;
  currentPoints: Point2D[];
}

const initialState: LinesState = {
  toolMode: 'select',
  isDrawing: false,
  currentPoints: [],
};

// ============================================================================
// STORE
// ============================================================================

function createLinesStore() {
  const { subscribe, set, update } = writable<LinesState>(initialState);

  return {
    subscribe,

    setToolMode(mode: LineToolMode) {
      update((state) => ({
        ...state,
        toolMode: mode,
        // Cancel any active drawing when switching modes
        isDrawing: false,
        currentPoints: [],
      }));
    },

    startDrawing() {
      update((state) => ({
        ...state,
        isDrawing: true,
        currentPoints: [],
      }));
    },

    addDrawingPoint(point: Point2D) {
      update((state) => ({
        ...state,
        currentPoints: [...state.currentPoints, point],
      }));
    },

    /**
     * Finish drawing and return the completed shape, or null if not enough points.
     */
    finishDrawing(): LineShape | null {
      const state = get({ subscribe });
      if (state.currentPoints.length < 2) {
        set({ ...state, isDrawing: false, currentPoints: [] });
        return null;
      }

      let shape: LineShape;
      if (state.toolMode === 'freehand') {
        shape = createDefaultFreehandLine(state.currentPoints);
      } else if (state.toolMode === 'pointClick') {
        shape = createDefaultPointClickLine(state.currentPoints);
      } else {
        set({ ...state, isDrawing: false, currentPoints: [] });
        return null;
      }

      set({ ...state, isDrawing: false, currentPoints: [] });
      return shape;
    },

    cancelDrawing() {
      update((state) => ({
        ...state,
        isDrawing: false,
        currentPoints: [],
      }));
    },

    reset() {
      set(initialState);
    },

    getState(): LinesState {
      return get({ subscribe });
    },
  };
}

export const linesStore = createLinesStore();

// Convenience exports for direct subscription
export const linesToolMode = {
  subscribe: (fn: (value: LineToolMode) => void) => {
    return linesStore.subscribe((state) => fn(state.toolMode));
  },
};

export const isLinesDrawing = {
  subscribe: (fn: (value: boolean) => void) => {
    return linesStore.subscribe((state) => fn(state.isDrawing));
  },
};

export const currentLinesPoints = {
  subscribe: (fn: (value: Point2D[]) => void) => {
    return linesStore.subscribe((state) => fn(state.currentPoints));
  },
};
