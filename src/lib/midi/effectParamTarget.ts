/**
 * Control paths arrive lowercased, but effect ids and parameter keys are
 * case-sensitive (`hueShift`, not `hueshift`). Resolve a path's effect id
 * and parameter name back to the real ones on an effect list.
 */

import type { Effect } from '../types';

/**
 * The effect and parameter key a lowercased `effectId` / `paramName` name,
 * or null. The effect type's schema wins over keys already in the effect's
 * params, so a stray lowercase key a project picked up earlier is never
 * written again; a name matching neither is ignored rather than invented.
 */
export function resolveEffectParam(
  effects: Effect[],
  effectId: string,
  paramName: string,
  schema: Partial<Record<string, Record<string, unknown>>>,
): { id: string; key: string } | null {
  const effect = effects.find(e => e.id.toLowerCase() === effectId);
  if (!effect) return null;
  const keys = [...Object.keys(schema[effect.type] ?? {}), ...Object.keys(effect.params ?? {})];
  const key = keys.find(k => k.toLowerCase() === paramName);
  return key ? { id: effect.id, key } : null;
}

/** A value held to the parameter's range when its schema gives one. */
export function clampToSchema(
  effects: Effect[],
  target: { id: string; key: string },
  value: number,
  schema: Partial<Record<string, Record<string, unknown>>>,
): number {
  const effect = effects.find(e => e.id === target.id);
  const meta = effect ? schema[effect.type]?.[target.key] as { min?: unknown; max?: unknown } | undefined : undefined;
  if (typeof meta?.min !== 'number' || typeof meta?.max !== 'number') return value;
  return Math.max(meta.min, Math.min(meta.max, value));
}
