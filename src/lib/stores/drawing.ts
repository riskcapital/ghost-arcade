// Drawing Store - Manages drawing layers and elements
import { writable, derived, get } from 'svelte/store';
import type {
  DrawingLayer,
  DrawingElement,
  Shape,
  Fill,
  Stroke,
  Animation,
  ShapeType,
  Point2D,
} from '../drawing/types';
import {
  createDrawingLayer,
  createDrawingElement,
  createDefaultCircle,
  createDefaultRectangle,
  createDefaultTriangle,
  createDefaultLine,
  createDefaultFreehand,
  createDefaultPointClickLine,
  createDefaultPolygon,
  createDefaultStar,
  createDefaultRing,
  createDefaultSpiral,
} from '../drawing/types';
import { generateUUID } from '../types';

// ============================================================================
// STORE STATE
// ============================================================================

interface DrawingState {
  layers: DrawingLayer[];
  selectedLayerId: string | null;
  selectedElementId: string | null;
  drawingMode: DrawingMode;
  isDrawing: boolean;
  currentPoints: Point2D[];
}

export type DrawingMode =
  | 'select'
  | 'freehand'
  | 'pointClick'
  | 'line'
  | 'circle'
  | 'rectangle'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'ring'
  | 'spiral';

const initialState: DrawingState = {
  layers: [],
  selectedLayerId: null,
  selectedElementId: null,
  drawingMode: 'select',
  isDrawing: false,
  currentPoints: [],
};

// ============================================================================
// STORE CREATION
// ============================================================================

function createDrawingStore() {
  const { subscribe, set, update } = writable<DrawingState>(initialState);

  return {
    subscribe,

    // Layer Management
    addLayer: (name?: string) => {
      update((state) => {
        const layer = createDrawingLayer(name || `Drawing ${state.layers.length + 1}`);
        return {
          ...state,
          layers: [...state.layers, layer],
          selectedLayerId: layer.id,
        };
      });
    },

    removeLayer: (layerId: string) => {
      update((state) => ({
        ...state,
        layers: state.layers.filter((l) => l.id !== layerId),
        selectedLayerId:
          state.selectedLayerId === layerId ? null : state.selectedLayerId,
        selectedElementId:
          state.layers.find((l) => l.id === layerId)?.elements.some((e) => e.id === state.selectedElementId)
            ? null
            : state.selectedElementId,
      }));
    },

    selectLayer: (layerId: string | null) => {
      update((state) => ({
        ...state,
        selectedLayerId: layerId,
        selectedElementId: null,
      }));
    },

    updateLayer: (layerId: string, updates: Partial<DrawingLayer>) => {
      update((state) => ({
        ...state,
        layers: state.layers.map((l) =>
          l.id === layerId ? { ...l, ...updates } : l
        ),
      }));
    },

    // Element Management
    addElement: (layerId: string, shapeType: ShapeType) => {
      update((state) => {
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return state;

        let shape: Shape;
        switch (shapeType) {
          case 'circle':
            shape = createDefaultCircle();
            break;
          case 'rectangle':
            shape = createDefaultRectangle();
            break;
          case 'triangle':
            shape = createDefaultTriangle();
            break;
          case 'line':
            shape = createDefaultLine();
            break;
          case 'freehand':
            shape = createDefaultFreehand();
            break;
          case 'pointClickLine':
            shape = createDefaultPointClickLine();
            break;
          case 'polygon':
            shape = createDefaultPolygon();
            break;
          case 'star':
            shape = createDefaultStar();
            break;
          case 'ring':
            shape = createDefaultRing();
            break;
          case 'spiral':
            shape = createDefaultSpiral();
            break;
          default:
            shape = createDefaultCircle();
        }

        const element = createDrawingElement(shape);
        element.shape.zIndex = layer.elements.length;

        return {
          ...state,
          layers: state.layers.map((l) =>
            l.id === layerId
              ? { ...l, elements: [...l.elements, element] }
              : l
          ),
          selectedElementId: element.id,
        };
      });
    },

    addElementWithShape: (layerId: string, shape: Shape) => {
      update((state) => {
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return state;

        const element = createDrawingElement(shape);
        element.shape.zIndex = layer.elements.length;

        return {
          ...state,
          layers: state.layers.map((l) =>
            l.id === layerId
              ? { ...l, elements: [...l.elements, element] }
              : l
          ),
          selectedElementId: element.id,
        };
      });
    },

    removeElement: (layerId: string, elementId: string) => {
      update((state) => ({
        ...state,
        layers: state.layers.map((l) =>
          l.id === layerId
            ? { ...l, elements: l.elements.filter((e) => e.id !== elementId) }
            : l
        ),
        selectedElementId:
          state.selectedElementId === elementId ? null : state.selectedElementId,
      }));
    },

    selectElement: (elementId: string | null) => {
      update((state) => ({
        ...state,
        selectedElementId: elementId,
      }));
    },

    updateElement: (
      layerId: string,
      elementId: string,
      updates: Partial<DrawingElement>
    ) => {
      update((state) => ({
        ...state,
        layers: state.layers.map((l) =>
          l.id === layerId
            ? {
                ...l,
                elements: l.elements.map((e) =>
                  e.id === elementId ? { ...e, ...updates } : e
                ),
              }
            : l
        ),
      }));
    },

    updateElementShape: (
      layerId: string,
      elementId: string,
      shapeUpdates: Partial<Shape>
    ) => {
      update((state) => ({
        ...state,
        layers: state.layers.map((l) =>
          l.id === layerId
            ? {
                ...l,
                elements: l.elements.map((e) =>
                  e.id === elementId
                    ? { ...e, shape: { ...e.shape, ...shapeUpdates } as Shape }
                    : e
                ),
              }
            : l
        ),
      }));
    },

    updateElementFill: (layerId: string, elementId: string, fill: Fill) => {
      update((state) => ({
        ...state,
        layers: state.layers.map((l) =>
          l.id === layerId
            ? {
                ...l,
                elements: l.elements.map((e) =>
                  e.id === elementId ? { ...e, fill } : e
                ),
              }
            : l
        ),
      }));
    },

    updateElementStroke: (layerId: string, elementId: string, stroke: Stroke) => {
      update((state) => ({
        ...state,
        layers: state.layers.map((l) =>
          l.id === layerId
            ? {
                ...l,
                elements: l.elements.map((e) =>
                  e.id === elementId ? { ...e, stroke } : e
                ),
              }
            : l
        ),
      }));
    },

    updateElementAnimation: (
      layerId: string,
      elementId: string,
      animation: Animation
    ) => {
      update((state) => ({
        ...state,
        layers: state.layers.map((l) =>
          l.id === layerId
            ? {
                ...l,
                elements: l.elements.map((e) =>
                  e.id === elementId ? { ...e, animation } : e
                ),
              }
            : l
        ),
      }));
    },

    duplicateElement: (layerId: string, elementId: string) => {
      update((state) => {
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return state;

        const element = layer.elements.find((e) => e.id === elementId);
        if (!element) return state;

        const newElement: DrawingElement = {
          ...JSON.parse(JSON.stringify(element)),
          id: generateUUID(),
          name: `${element.name} Copy`,
          shape: {
            ...JSON.parse(JSON.stringify(element.shape)),
            id: generateUUID(),
            position: {
              x: element.shape.position.x + 0.05,
              y: element.shape.position.y + 0.05,
            },
          },
        };

        return {
          ...state,
          layers: state.layers.map((l) =>
            l.id === layerId
              ? { ...l, elements: [...l.elements, newElement] }
              : l
          ),
          selectedElementId: newElement.id,
        };
      });
    },

    reorderElements: (layerId: string, fromIndex: number, toIndex: number) => {
      update((state) => ({
        ...state,
        layers: state.layers.map((l) => {
          if (l.id !== layerId) return l;
          const elements = [...l.elements];
          const [removed] = elements.splice(fromIndex, 1);
          elements.splice(toIndex, 0, removed);
          return { ...l, elements };
        }),
      }));
    },

    // Drawing Mode
    setDrawingMode: (mode: DrawingMode) => {
      update((state) => ({
        ...state,
        drawingMode: mode,
        isDrawing: false,
        currentPoints: [],
      }));
    },

    startDrawing: () => {
      update((state) => ({
        ...state,
        isDrawing: true,
        currentPoints: [],
      }));
    },

    addDrawingPoint: (point: Point2D) => {
      update((state) => ({
        ...state,
        currentPoints: [...state.currentPoints, point],
      }));
    },

    finishDrawing: () => {
      const state = get({ subscribe });
      if (!state.selectedLayerId || state.currentPoints.length < 2) {
        update((s) => ({ ...s, isDrawing: false, currentPoints: [] }));
        return;
      }

      let shape: Shape;
      if (state.drawingMode === 'freehand') {
        shape = createDefaultFreehand(state.currentPoints);
      } else if (state.drawingMode === 'pointClick') {
        shape = createDefaultPointClickLine(state.currentPoints);
      } else {
        update((s) => ({ ...s, isDrawing: false, currentPoints: [] }));
        return;
      }

      update((s) => {
        const layer = s.layers.find((l) => l.id === s.selectedLayerId);
        if (!layer) return { ...s, isDrawing: false, currentPoints: [] };

        const element = createDrawingElement(shape);
        element.shape.zIndex = layer.elements.length;

        return {
          ...s,
          layers: s.layers.map((l) =>
            l.id === s.selectedLayerId
              ? { ...l, elements: [...l.elements, element] }
              : l
          ),
          selectedElementId: element.id,
          isDrawing: false,
          currentPoints: [],
        };
      });
    },

    cancelDrawing: () => {
      update((state) => ({
        ...state,
        isDrawing: false,
        currentPoints: [],
      }));
    },

    // Utility
    reset: () => set(initialState),

    getState: () => get({ subscribe }),
  };
}

export const drawingStore = createDrawingStore();

// ============================================================================
// DERIVED STORES
// ============================================================================

export const drawingLayers = derived(drawingStore, ($store) => $store.layers);

export const selectedDrawingLayerId = derived(
  drawingStore,
  ($store) => $store.selectedLayerId
);

export const selectedDrawingLayer = derived(drawingStore, ($store) =>
  $store.selectedLayerId
    ? $store.layers.find((l) => l.id === $store.selectedLayerId) || null
    : null
);

export const selectedDrawingElementId = derived(
  drawingStore,
  ($store) => $store.selectedElementId
);

export const selectedDrawingElement = derived(drawingStore, ($store) => {
  if (!$store.selectedLayerId || !$store.selectedElementId) return null;
  const layer = $store.layers.find((l) => l.id === $store.selectedLayerId);
  if (!layer) return null;
  return layer.elements.find((e) => e.id === $store.selectedElementId) || null;
});

export const drawingMode = derived(drawingStore, ($store) => $store.drawingMode);

export const isDrawing = derived(drawingStore, ($store) => $store.isDrawing);

export const currentDrawingPoints = derived(
  drawingStore,
  ($store) => $store.currentPoints
);
