import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { BezierPoint } from '../types';
import { surfaceCanRedo, surfaceCanUndo, surfaceStore } from './surface';

const initialPolygon: BezierPoint[] = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];

function activePolygon(sliceId: string): BezierPoint[] {
  const state = get(surfaceStore);
  const surface = state.surfaces.find(item => item.id === state.activeSurfaceId);
  const slice = surface?.slices.find(item => item.id === sliceId);
  if (!slice) throw new Error(`Missing test slice ${sliceId}`);
  return slice.polygon;
}

describe('surface history', () => {
  beforeEach(() => {
    surfaceStore.reset();
  });

  it('collapses an entire drag gesture into one undo step', () => {
    surfaceStore.createSurface('Undo test');
    const sliceId = surfaceStore.addSlice(initialPolygon, 'Slice');
    if (!sliceId) throw new Error('Failed to create test slice');

    const dragStepOne = initialPolygon.map(point => ({ x: point.x + 20, y: point.y + 10 }));
    const dragStepTwo = initialPolygon.map(point => ({ x: point.x + 80, y: point.y + 40 }));

    surfaceStore.beginHistoryGesture();
    surfaceStore.updateSlice(sliceId, { polygon: dragStepOne });
    surfaceStore.updateSlice(sliceId, { polygon: dragStepTwo });
    surfaceStore.endHistoryGesture();

    expect(activePolygon(sliceId)).toEqual(dragStepTwo);
    expect(get(surfaceCanUndo)).toBe(true);

    surfaceStore.undo();
    expect(activePolygon(sliceId)).toEqual(initialPolygon);
    expect(get(surfaceCanRedo)).toBe(true);

    surfaceStore.redo();
    expect(activePolygon(sliceId)).toEqual(dragStepTwo);
  });
});
