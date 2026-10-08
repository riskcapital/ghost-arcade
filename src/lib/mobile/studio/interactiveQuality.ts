/** Runtime-only limits. These never replace authored or persisted scene values. */
export type InteractiveQualityBudget = {
  tier: 'economy' | 'balanced' | 'high';
  activeLayers: number;
  fieldWidth: number;
  fieldHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  particleLimit: number;
  pointLimit: number;
  collisionChecks: number;
  inputLimit: number;
  substeps: number;
  description: string;
};

export type InteractiveDeviceHints = { hardwareConcurrency?: number; deviceMemory?: number };

/** Safari omits memory hints; unknown devices use the conservative middle tier. */
export function createInteractiveQuality(
  activeLayers = 1,
  hints: InteractiveDeviceHints = typeof navigator === 'undefined' ? {} : navigator,
): InteractiveQualityBudget {
  const enabled = Number.isFinite(activeLayers) ? Math.max(0, Math.min(8, Math.ceil(activeLayers))) : 1;
  const layers = Math.max(1, enabled);
  const cores = hints.hardwareConcurrency ?? 0,
    memory = hints.deviceMemory ?? 0;
  const tier =
    (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4)
      ? 'economy'
      : cores >= 8 && memory >= 8
        ? 'high'
        : 'balanced';
  const scale = tier === 'economy' ? 0.7 : tier === 'high' ? 1.25 : 1;
  // Share one fixed allocation across all enabled layers, including eight fluids.
  const fieldWidth = Math.max(32, Math.min(112, Math.floor((112 * Math.sqrt(scale / layers)) / 16) * 16));
  const fieldHeight = (fieldWidth * 9) / 16;
  const canvasWidth = Math.max(256, Math.min(640, Math.floor((640 * Math.sqrt(scale / layers)) / 64) * 64));
  return {
    tier,
    activeLayers: enabled,
    fieldWidth,
    fieldHeight,
    canvasWidth,
    canvasHeight: (canvasWidth * 9) / 16,
    particleLimit: Math.max(16, Math.floor((700 * scale) / layers)),
    pointLimit: Math.max(16, Math.floor((600 * scale) / layers)),
    collisionChecks: Math.floor((180_000 * scale) / layers),
    inputLimit: 8,
    substeps: tier === 'economy' ? 2 : 3,
    description: `${tier === 'economy' ? 'Economy' : tier === 'high' ? 'High' : 'Balanced'} · ${enabled} active ${enabled === 1 ? 'layer' : 'layers'} · ${fieldWidth}×${fieldHeight} fluid grid · ${canvasWidth}×${(canvasWidth * 9) / 16} layers`,
  };
}

/** Resume with one bounded step; a suspended tab never creates catch-up work. */
export function interactiveFrameDelta(delta: number): number {
  return Number.isFinite(delta) ? Math.max(0, Math.min(0.05, delta)) : 0;
}
