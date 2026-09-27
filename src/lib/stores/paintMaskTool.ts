import { writable } from 'svelte/store';

/**
 * UI-only state of the painted-mask brush. The strokes themselves live on
 * the layer (Layer.paintMask); this is which layer the brush is armed on
 * and the brush the next stroke uses. Brush settings are remembered per
 * viewer in localStorage; the armed layer is not.
 */
export interface PaintBrushSettings {
  mode: 'erase' | 'restore';
  /** Radius in project (output) pixels. */
  size: number;
  softness: number;
  opacity: number;
}

export const PAINT_BRUSH_SIZE_MIN = 2;
export const PAINT_BRUSH_SIZE_MAX = 800;

const STORAGE_KEY = 'ghost-arcade.paintBrush';
const DEFAULT_BRUSH: PaintBrushSettings = { mode: 'erase', size: 60, softness: 0.35, opacity: 1 };

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function normalizePaintBrush(raw: Partial<PaintBrushSettings> | null | undefined): PaintBrushSettings {
  return {
    mode: raw?.mode === 'restore' ? 'restore' : 'erase',
    size: clamp(raw?.size, PAINT_BRUSH_SIZE_MIN, PAINT_BRUSH_SIZE_MAX, DEFAULT_BRUSH.size),
    softness: clamp(raw?.softness, 0, 1, DEFAULT_BRUSH.softness),
    opacity: clamp(raw?.opacity, 0.01, 1, DEFAULT_BRUSH.opacity),
  };
}

function loadBrush(): PaintBrushSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return normalizePaintBrush(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_BRUSH };
  }
}

/** Layer id the brush is armed on, or null. */
export const paintMaskLayerId = writable<string | null>(null);

function createBrushStore() {
  const store = writable<PaintBrushSettings>(loadBrush());
  return {
    subscribe: store.subscribe,
    update(partial: Partial<PaintBrushSettings>) {
      store.update((current) => {
        const next = normalizePaintBrush({ ...current, ...partial });
        try {
          globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Private window or blocked storage: the brush just is not remembered.
        }
        return next;
      });
    },
  };
}

export const paintBrush = createBrushStore();
