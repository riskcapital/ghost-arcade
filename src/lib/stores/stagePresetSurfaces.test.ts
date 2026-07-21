import { describe, expect, it } from 'vitest';
import type { Layer, StagePreset, Surface } from '../types';
import {
  captureStagePresetSurfaceState,
  resolveStagePresetSurfaceId,
  restoreStagePresetSurface,
} from './stagePresetSurfaces';

function layer(id: string): Layer {
  return { id } as Layer;
}

function surface(id: string, layerIds: string[]): Surface {
  return {
    id,
    name: id,
    width: 1920,
    height: 1080,
    slices: layerIds.map((layerId, index) => ({
      id: `${id}-slice-${index}`,
      name: `Slice ${index}`,
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      color: '#ffffff',
      visible: true,
      locked: false,
      sourceBinding: { kind: 'layer', layerId },
    })),
  };
}

function preset(layers: Layer[], surfaceId?: string): StagePreset {
  return {
    id: 'preset',
    name: 'Preset',
    createdAt: 1,
    layers,
    surfaceId,
  };
}

describe('resolveStagePresetSurfaceId', () => {
  it('uses the preset-owned surface snapshot before live surface state', () => {
    const snapshot = surface('surface-saved', ['saved-layer']);
    const savedPreset = {
      ...preset([layer('saved-layer')], 'surface-live'),
      surfaceSnapshot: snapshot,
    };
    expect(resolveStagePresetSurfaceId(
      savedPreset,
      [surface('surface-live', ['live-layer'])],
      'surface-live',
    )).toBe('surface-saved');
  });

  it('uses the persisted surface when it still exists', () => {
    const surfaces = [surface('surface-a', ['a']), surface('surface-b', ['b'])];
    expect(resolveStagePresetSurfaceId(preset([layer('a')], 'surface-b'), surfaces, 'surface-a'))
      .toBe('surface-b');
  });

  it('recovers legacy presets from their layer bindings', () => {
    const surfaces = [surface('surface-a', ['a']), surface('surface-b', ['b', 'c'])];
    expect(resolveStagePresetSurfaceId(preset([layer('b'), layer('c')]), surfaces, 'surface-a'))
      .toBe('surface-b');
  });

  it('uses the active surface only when no binding can identify ownership', () => {
    const surfaces = [surface('surface-a', ['a']), surface('surface-b', ['b'])];
    expect(resolveStagePresetSurfaceId(preset([layer('missing')]), surfaces, 'surface-b'))
      .toBe('surface-b');
  });
});

describe('restoreStagePresetSurface', () => {
  it('replaces the live surface with the preset geometry, bindings, and effects', () => {
    const live = {
      ...surface('surface-a', ['latest-layer']),
      effects: [],
      activeEffectId: null,
    };
    const saved = {
      ...surface('surface-a', ['preset-one-layer']),
      effects: [{
        id: 'chase',
        type: 'chase' as const,
        enabled: true,
        opacity: 1,
        params: { speed: 2 },
      }],
      activeEffectId: 'chase',
    };

    const restored = restoreStagePresetSurface([live], saved);
    expect(restored).toHaveLength(1);
    expect(restored[0].slices[0].sourceBinding).toEqual({
      kind: 'layer',
      layerId: 'preset-one-layer',
    });
    expect(restored[0].activeEffectId).toBe('chase');

    saved.slices[0].sourceBinding = null;
    expect(restored[0].slices[0].sourceBinding).toEqual({
      kind: 'layer',
      layerId: 'preset-one-layer',
    });
  });

  it('adds a missing surface restored by an older project import', () => {
    const restored = restoreStagePresetSurface(
      [surface('surface-live', ['live-layer'])],
      surface('surface-saved', ['saved-layer']),
    );
    expect(restored.map(item => item.id)).toEqual(['surface-live', 'surface-saved']);
  });
});

describe('captureStagePresetSurfaceState', () => {
  it('captures an independent complete Stage FX bundle', () => {
    const live = {
      ...surface('surface-a', ['layer-a']),
      effects: [{
        id: 'chase',
        type: 'chase' as const,
        enabled: true,
        opacity: 0.85,
        params: { speed: 2.5 },
        color: '#ff3366',
      }],
      activeEffectId: 'chase',
      effectAutomation: {
        playing: true,
        mode: 'beat' as const,
        seconds: 4,
        beats: 8,
      },
    };

    const captured = captureStagePresetSurfaceState(live);
    expect(captured.surfaceId).toBe('surface-a');
    expect(captured.surfaceSnapshot?.activeEffectId).toBe('chase');
    expect(captured.stageEffects?.effects[0].color).toBe('#ff3366');
    expect(captured.stageEffects?.automation?.playing).toBe(true);

    live.effects[0].color = '#00ff00';
    live.effectAutomation.playing = false;
    expect(captured.surfaceSnapshot?.effects?.[0].color).toBe('#ff3366');
    expect(captured.stageEffects?.effects[0].color).toBe('#ff3366');
    expect(captured.stageEffects?.automation?.playing).toBe(true);
  });
});
