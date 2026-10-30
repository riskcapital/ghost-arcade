import type { IntegratedEffectSource } from '$lib/types';

// The Music Studio is offered like the others but needs no graph of its own:
// it reaches the core as its voices plus a vj-mix (music/studioPlugin.ts).
export const NATIVE_PLUGIN_IDS = ['ghostfx', 'handfx', 'musicstudio'] as const;
export const NATIVE_PLUGIN_EFFECT_TYPES = ['ghostfx', 'handfx', 'performer-world', 'vj-crossfade', 'vj-mix'] as const;

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
