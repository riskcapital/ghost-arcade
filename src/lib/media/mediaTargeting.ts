import type { Layer } from '../types';

const MEDIA_TARGET_LAYER_TYPES = new Set(['media', 'screen', 'group']);

export function activeMediaTargetLayerIds(
  selectedLayerId: string | null | undefined,
  layers: readonly Layer[],
): string[] {
  if (!selectedLayerId) return [];
  const layer = layers.find((candidate) => candidate.id === selectedLayerId);
  return layer && MEDIA_TARGET_LAYER_TYPES.has(layer.type) ? [layer.id] : [];
}
