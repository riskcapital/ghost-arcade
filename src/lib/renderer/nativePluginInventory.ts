import type { IntegratedEffectSource } from '$lib/types';
import { missingAddon } from '$lib/plugins/addons';

// Audio Lab is offered like the others but needs no graph of its own:
// it reaches the core as its voices plus a vj-mix (music/studioPlugin.ts).
// The add-ons are always listed; locked, their cards offer a trial instead.
export const NATIVE_PLUGIN_IDS: readonly string[] = ['ghostfx', 'handfx', 'musicstudio', 'analog-synth'];
export const NATIVE_PLUGIN_EFFECT_TYPES = ['ghostfx', 'handfx', 'performer-world', 'vj-crossfade', 'vj-mix', 'scene3d', 'videosynth'] as const;

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

/**
 * Why a plugin layer cannot draw, or null when it can. A layer from an
 * add-on that is locked on this computer draws nothing; its settings stay
 * as saved.
 */
export function nativePluginUnavailableReason(source: IntegratedEffectSource | null | undefined): string | null {
  if (missingAddon(source?.effectType)) return `addon:${String(source?.effectType).trim().toLowerCase()}:locked`;
  return null;
}
