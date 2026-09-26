// Callbacks the layers store hands to the modulation engine.
//
// This module must stay import-free. modulation.ts reaches layers.ts back
// through vjClipLauncher, so when modulation.ts is evaluated first, layers.ts
// runs its registration while modulation.ts is still mid-load. Registering
// into modulation.ts's own `let` bindings then threw a TDZ ReferenceError,
// which intermittently killed slice windows that import both in parallel.
// A leaf module is always fully evaluated before either side runs.

type LayerValues = (layerIndex: number, values: Record<string, number>) => void;
type LayerValue = (layerIndex: number, paramName: string) => number | undefined;
type EffectValues = (layerIndex: number, effectId: string, values: Record<string, number>) => void;
type EffectValue = (layerIndex: number, effectId: string, paramName: string) => number | undefined;

export const modulationHandlers: {
  compositionReader: ((effectId: string, paramName: string) => number | undefined) | null;
  compositionWriter: ((effectId: string, values: Record<string, number>) => void) | null;
  /** Applies modulated shader values to a mapping layer. */
  mappingLayerUpdater: LayerValues | null;
  /** Reads a mapping layer's shader value, for the initial base capture. */
  mappingLayerReader: LayerValue | null;
  /** True when layerIndex refers to a mapping layer rather than VJ. */
  isMappingLayer: ((layerIndex: number) => boolean) | null;
  /** Without these, mapping-mode effects sit at the manual slider value. */
  mappingEffectUpdater: EffectValues | null;
  mappingEffectReader: EffectValue | null;
  /** paramPath is dotted (e.g. 'stroke.width'); the updater deep-merges it. */
  mappingEdgeEffectUpdater: ((layerIndex: number, effectId: string, paramPath: string, value: number) => void) | null;
  mappingEdgeEffectReader: ((layerIndex: number, effectId: string, paramPath: string) => number | undefined) | null;
  /** Writes go through project.updateGPULayerParams so they feel like a slider drag. */
  mappingGPUUpdater: LayerValues | null;
  mappingGPUReader: LayerValue | null;
  /** Splat / point-cloud params, written into layer.splatContent. */
  mappingSplatUpdater: LayerValues | null;
  mappingSplatReader: LayerValue | null;
} = {
  compositionReader: null,
  compositionWriter: null,
  mappingLayerUpdater: null,
  mappingLayerReader: null,
  isMappingLayer: null,
  mappingEffectUpdater: null,
  mappingEffectReader: null,
  mappingEdgeEffectUpdater: null,
  mappingEdgeEffectReader: null,
  mappingGPUUpdater: null,
  mappingGPUReader: null,
  mappingSplatUpdater: null,
  mappingSplatReader: null,
};

export function registerCompositionModulationHandlers(
  reader: NonNullable<typeof modulationHandlers.compositionReader>,
  writer: NonNullable<typeof modulationHandlers.compositionWriter>,
) {
  modulationHandlers.compositionReader = reader;
  modulationHandlers.compositionWriter = writer;
}

/** Register mapping mode callbacks — called once from layers store init */
export function registerMappingLayerCallbacks(
  updater: LayerValues,
  reader: LayerValue,
  isMapping: (layerIndex: number) => boolean,
  effectUpdater?: EffectValues,
  effectReader?: EffectValue,
  edgeEffectUpdater?: NonNullable<typeof modulationHandlers.mappingEdgeEffectUpdater>,
  edgeEffectReader?: NonNullable<typeof modulationHandlers.mappingEdgeEffectReader>,
  gpuUpdater?: LayerValues,
  gpuReader?: LayerValue,
  splatUpdater?: LayerValues,
  splatReader?: LayerValue,
) {
  const h = modulationHandlers;
  h.mappingLayerUpdater = updater;
  h.mappingLayerReader = reader;
  h.isMappingLayer = isMapping;
  if (effectUpdater) h.mappingEffectUpdater = effectUpdater;
  if (effectReader) h.mappingEffectReader = effectReader;
  if (edgeEffectUpdater) h.mappingEdgeEffectUpdater = edgeEffectUpdater;
  if (edgeEffectReader) h.mappingEdgeEffectReader = edgeEffectReader;
  if (gpuUpdater) h.mappingGPUUpdater = gpuUpdater;
  if (gpuReader) h.mappingGPUReader = gpuReader;
  if (splatUpdater) h.mappingSplatUpdater = splatUpdater;
  if (splatReader) h.mappingSplatReader = splatReader;
}
