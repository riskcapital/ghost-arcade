import { EFFECT_CATALOG } from '$lib/effects/effectCatalog';
import type { EffectType } from '$lib/types';
import { NATIVE_EFFECT_PASS_MANIFEST } from './nativeEffectPass';

const VJ_ONLY_PUBLIC_EFFECT_TYPES = [
  'brightness',
  'contrast',
  'saturation',
  'hue',
] as const satisfies readonly EffectType[];

export interface NativeEffectCoverageSummary {
  publicEffectCount: number;
  nativePassCount: number;
  nativePublicEffectCount: number;
  missingPublicEffectCount: number;
  nativeOnlyPassCount: number;
  nativePublicEffectTypes: EffectType[];
  missingPublicEffectTypes: EffectType[];
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
  const nativePublicEffectTypes = publicEffectTypes.filter((effectType) =>
    nativePassSet.has(nativeEffectPassIdForEffectType(effectType)),
  );
  const missingPublicEffectTypes = publicEffectTypes.filter((effectType) =>
    !nativePassSet.has(nativeEffectPassIdForEffectType(effectType)),
  );
  const publicNativePassIds = new Set(publicEffectTypes.map(nativeEffectPassIdForEffectType));
  const nativeOnlyPassIds = nativePassIds.map(String).filter((passId) => !publicNativePassIds.has(passId));
  const missingSample = missingPublicEffectTypes.slice(0, 6).map(effectLabel).join(', ');
  const detail = [
    `native public effect coverage ${nativePublicEffectTypes.length}/${publicEffectTypes.length}`,
    `${missingPublicEffectTypes.length} public effect${missingPublicEffectTypes.length === 1 ? '' : 's'} still WebGL-only`,
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
    nativeOnlyPassCount: nativeOnlyPassIds.length,
    nativePublicEffectTypes,
    missingPublicEffectTypes,
    nativeOnlyPassIds,
    detail,
    complete: missingPublicEffectTypes.length === 0,
  };
}

export const NATIVE_EFFECT_COVERAGE = summarizeNativeEffectCoverage(
  PUBLIC_EFFECT_TYPES,
  NATIVE_EFFECT_PASS_MANIFEST.map((entry) => entry.id),
);
