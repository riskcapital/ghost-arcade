/**
 * Feature gates — stubbed for the open-source release.
 *
 * Ghost Arcade is now a single product, free, AGPL-3.0. Every effect /
 * shader / feature is available to everyone. The exports below are kept
 * for source compatibility with existing import sites; every check
 * returns "you have access". Effect tier badges resolve to empty
 * strings so the UI doesn't render "PRO" / "STARTER" labels anymore.
 *
 * If you're forking this for a commercial release, this is the right
 * place to re-introduce gating.
 */

import type { LicenseTier } from '$lib/stores/license';

// ─── Effect Tier (stubbed) ───────────────────────────────────────────────────

export type EffectTier = 'demo' | 'pro';

/** All effects are 'demo' (free) in the OSS build. */
export function getEffectTier(_category: string): EffectTier {
  return 'demo';
}

/** Always grants access — open source means no gates. */
export function canAccessEffect(_userTier: LicenseTier, _effectCategory: string): boolean {
  return true;
}

/** Tier badges are empty in the OSS build (nothing to label). */
export function getTierBadgeLabel(_tier: EffectTier): string {
  return '';
}

// ─── Feature gates (stubbed) ─────────────────────────────────────────────────

export interface FeatureGate {
  id: string;
  label: string;
  description: string;
  requiredTier: LicenseTier;
}

/** Empty list in the OSS build — no features are gated. */
export const FEATURE_GATES: FeatureGate[] = [];

/** Always grants access. */
export function canAccessFeature(_userTier: LicenseTier, _featureId: string): boolean {
  return true;
}

/** Layer count is unlimited in the OSS build. */
export function getLayerLimit(_tier: LicenseTier): number {
  return Number.POSITIVE_INFINITY;
}

/** AI credits are caller-supplied (BYOK) in the OSS build — return 0
 *  so the in-app credit display correctly shows "use your own keys". */
export function getMonthlyCredits(_tier: LicenseTier): number {
  return 0;
}

/** Always grants access. */
export function canAccessShader(_userTier: LicenseTier, _shaderTier: 'demo' | 'pro'): boolean {
  return true;
}
