import type { IntegratedEffectSource } from '$lib/types';

export const NATIVE_PLUGIN_IDS = ['ghostfx', 'handfx'] as const;
export const NATIVE_PLUGIN_EFFECT_TYPES = ['ghostfx', 'handfx', 'performer-world', 'vj-crossfade'] as const;

export type NativePluginEffectType = typeof NATIVE_PLUGIN_EFFECT_TYPES[number];

const nativePluginIdSet = new Set<string>(NATIVE_PLUGIN_IDS);
const nativePluginEffectTypeSet = new Set<string>(NATIVE_PLUGIN_EFFECT_TYPES);

export function isNativePluginId(value: unknown): boolean {
  return nativePluginIdSet.has(String(value ?? '').trim().toLowerCase());
}

export function nativePluginEffectType(value: unknown): NativePluginEffectType | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return nativePluginEffectTypeSet.has(normalized)
    ? normalized as NativePluginEffectType
    : null;
}

export function nativePluginUnavailableReason(source: IntegratedEffectSource | null | undefined): string | null {
  const effectType = nativePluginEffectType(source?.effectType);
  if (!effectType) return null;
  return null;
}
