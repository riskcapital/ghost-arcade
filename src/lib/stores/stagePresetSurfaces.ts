import type { StagePreset, Surface } from '../types';

export function cloneStagePresetSurface(surface: Surface): Surface {
  return structuredClone(surface);
}

/** Capture all Surface-owned state a Stage preset needs. Keeping this
 * contract pure makes project and global presets identical and prevents
 * future saves from dropping Stage FX while retaining only layer data. */
export function captureStagePresetSurfaceState(surface: Surface): Pick<
  StagePreset,
  'surfaceId' | 'surfaceSnapshot' | 'stageEffects'
> {
  return {
    surfaceId: surface.id,
    surfaceSnapshot: cloneStagePresetSurface(surface),
    stageEffects: {
      effects: structuredClone(surface.effects ?? []),
      activeEffectId: surface.activeEffectId ?? null,
      automation: surface.effectAutomation
        ? structuredClone(surface.effectAutomation)
        : null,
    },
  };
}

/** Replace or insert a preset-owned Surface without sharing references
 *  with the serialized preset. This keeps later Stage Designer edits from
 *  mutating the preset snapshot in memory. */
export function restoreStagePresetSurface(
  surfaces: Surface[],
  snapshot: Surface,
): Surface[] {
  const restored = cloneStagePresetSurface(snapshot);
  const index = surfaces.findIndex(surface => surface.id === restored.id);
  if (index < 0) return [...surfaces, restored];
  return surfaces.map((surface, surfaceIndex) =>
    surfaceIndex === index ? restored : surface
  );
}

/**
 * Resolve the Surface owned by a Stage preset.
 *
 * New presets persist surfaceId directly. Presets created before 1.9.98
 * recover that relationship from the layer bindings stored on each surface.
 */
export function resolveStagePresetSurfaceId(
  preset: Pick<StagePreset, 'surfaceId' | 'surfaceSnapshot' | 'layers'>,
  surfaces: Surface[],
  fallbackSurfaceId: string | null = null,
): string | null {
  if (preset.surfaceSnapshot) return preset.surfaceSnapshot.id;

  if (preset.surfaceId && surfaces.some(surface => surface.id === preset.surfaceId)) {
    return preset.surfaceId;
  }

  const layerIds = new Set(preset.layers.map(layer => layer.id));
  let bestSurfaceId: string | null = null;
  let bestScore = 0;

  for (const surface of surfaces) {
    let score = 0;
    for (const slice of surface.slices) {
      if (
        slice.sourceBinding?.kind === 'layer'
        && layerIds.has(slice.sourceBinding.layerId)
      ) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSurfaceId = surface.id;
    }
  }

  if (bestSurfaceId) return bestSurfaceId;
  if (fallbackSurfaceId && surfaces.some(surface => surface.id === fallbackSurfaceId)) {
    return fallbackSurfaceId;
  }
  return surfaces[0]?.id ?? null;
}
