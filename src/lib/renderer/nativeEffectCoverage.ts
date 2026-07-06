import { EFFECT_CATALOG } from '$lib/effects/effectCatalog';
import type { EffectType } from '$lib/types';
import { NATIVE_EFFECT_PASS_MANIFEST } from './nativeEffectPass';

const VJ_ONLY_PUBLIC_EFFECT_TYPES = [
  'brightness',
  'contrast',
  'saturation',
  'hue',
] as const satisfies readonly EffectType[];

export const STATEFUL_NATIVE_GRAPH_EFFECT_TYPES = [
  'gpuFluidSim',
  'eulerianMagnify',
] as const satisfies readonly EffectType[];

export interface NativeEffectCoverageSummary {
  publicEffectCount: number;
  nativePassCount: number;
  nativePublicEffectCount: number;
  missingPublicEffectCount: number;
  sourceFramePassEligibleEffectCount: number;
  nativeSourceFramePassEffectCount: number;
  missingSourceFramePassEffectCount: number;
  deferredNativeGraphEffectCount: number;
  nativeOnlyPassCount: number;
  nativePublicEffectTypes: EffectType[];
  missingPublicEffectTypes: EffectType[];
  sourceFramePassEligibleEffectTypes: EffectType[];
  nativeSourceFramePassEffectTypes: EffectType[];
  missingSourceFramePassEffectTypes: EffectType[];
  deferredNativeGraphEffectTypes: EffectType[];
  nextSourceFramePassEffectTypes: EffectType[];
  nativeOnlyPassIds: string[];
  detail: string;
  complete: boolean;
}

export function nativeEffectPassIdForEffectType(effectType: EffectType | string): string {
  return String(effectType)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function uniqueEffectTypes(effectTypes: readonly EffectType[]): EffectType[] {
  return Array.from(new Set(effectTypes));
}

function effectLabel(effectType: EffectType): string {
  return String(effectType).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export const PUBLIC_EFFECT_TYPES: readonly EffectType[] = uniqueEffectTypes([
  ...EFFECT_CATALOG.map((entry) => entry.type),
  ...VJ_ONLY_PUBLIC_EFFECT_TYPES,
]);

export function summarizeNativeEffectCoverage(
  publicEffectTypes: readonly EffectType[],
  nativePassIds: readonly string[],
): NativeEffectCoverageSummary {
  const nativePassSet = new Set(nativePassIds.map(String));
  const deferredGraphEffectSet = new Set<EffectType>(STATEFUL_NATIVE_GRAPH_EFFECT_TYPES);
  const nativePublicEffectTypes = publicEffectTypes.filter((effectType) =>
    nativePassSet.has(nativeEffectPassIdForEffectType(effectType)),
  );
  const missingPublicEffectTypes = publicEffectTypes.filter((effectType) =>
    !nativePassSet.has(nativeEffectPassIdForEffectType(effectType)),
  );
  const sourceFramePassEligibleEffectTypes = publicEffectTypes.filter(
    (effectType) => !deferredGraphEffectSet.has(effectType),
  );
  const nativeSourceFramePassEffectTypes = sourceFramePassEligibleEffectTypes.filter((effectType) =>
    nativePassSet.has(nativeEffectPassIdForEffectType(effectType)),
  );
  const missingSourceFramePassEffectTypes = sourceFramePassEligibleEffectTypes.filter((effectType) =>
    !nativePassSet.has(nativeEffectPassIdForEffectType(effectType)),
  );
  const deferredNativeGraphEffectTypes = publicEffectTypes.filter((effectType) =>
    deferredGraphEffectSet.has(effectType),
  );
  const publicNativePassIds = new Set(publicEffectTypes.map(nativeEffectPassIdForEffectType));
  const nativeOnlyPassIds = nativePassIds.map(String).filter((passId) => !publicNativePassIds.has(passId));
  const nextSourceFramePassEffectTypes = missingSourceFramePassEffectTypes.slice(0, 6);
  const missingSample = nextSourceFramePassEffectTypes.map(effectLabel).join(', ');
  const deferredSample = deferredNativeGraphEffectTypes.map(effectLabel).join(', ');
  const detail = [
    `native source-frame effect-pass coverage ${nativeSourceFramePassEffectTypes.length}/${sourceFramePassEligibleEffectTypes.length}`,
    `${missingSourceFramePassEffectTypes.length} pass-eligible public effect${missingSourceFramePassEffectTypes.length === 1 ? '' : 's'} still WebGL-backed`,
    deferredSample
      ? `${deferredNativeGraphEffectTypes.length} stateful/multi-frame effect${deferredNativeGraphEffectTypes.length === 1 ? '' : 's'} tracked outside the effect-pass route: ${deferredSample}`
      : '',
    nativeOnlyPassIds.length
      ? `${nativeOnlyPassIds.length} native helper pass${nativeOnlyPassIds.length === 1 ? '' : 'es'} not exposed as public effects`
      : '',
    missingSample ? `next gaps: ${missingSample}` : '',
  ].filter(Boolean).join('; ');

  return {
    publicEffectCount: publicEffectTypes.length,
    nativePassCount: nativePassIds.length,
    nativePublicEffectCount: nativePublicEffectTypes.length,
    missingPublicEffectCount: missingPublicEffectTypes.length,
    sourceFramePassEligibleEffectCount: sourceFramePassEligibleEffectTypes.length,
    nativeSourceFramePassEffectCount: nativeSourceFramePassEffectTypes.length,
    missingSourceFramePassEffectCount: missingSourceFramePassEffectTypes.length,
    deferredNativeGraphEffectCount: deferredNativeGraphEffectTypes.length,
    nativeOnlyPassCount: nativeOnlyPassIds.length,
    nativePublicEffectTypes,
    missingPublicEffectTypes,
    sourceFramePassEligibleEffectTypes,
    nativeSourceFramePassEffectTypes,
    missingSourceFramePassEffectTypes,
    deferredNativeGraphEffectTypes,
    nextSourceFramePassEffectTypes,
    nativeOnlyPassIds,
    detail,
    complete: missingSourceFramePassEffectTypes.length === 0,
  };
}

export const NATIVE_EFFECT_COVERAGE = summarizeNativeEffectCoverage(
  PUBLIC_EFFECT_TYPES,
  NATIVE_EFFECT_PASS_MANIFEST.map((entry) => entry.id),
);
