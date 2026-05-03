// Feature Gates — Maps license tiers to available features
//
// This is the single source of truth for what each tier can access.
// UI components import these helpers to show/hide/lock features.

import type { LicenseTier } from '$lib/stores/license';
import type { EffectType } from '$lib/types';

// ─── Tier Definitions ────────────────────────────────────────────────────────

export type EffectTier = 'demo' | 'pro';

/** Categories whose effects require Pro tier */
const PREMIUM_CATEGORY_PREFIXES = [
  'Premium Color',
  'Premium Stylize',
  'Premium Warp',
  'Premium Atmosphere',
  'Premium Text',
  'Premium 3D',
  'Premium Depth',
  'Premium Feedback',
  'Premium Trails',
];

/**
 * Determine which tier an effect belongs to based on its category.
 * - Categories starting with "Premium" → pro
 * - All other categories → demo (available to everyone)
 *
 * Note: Pro-pack shader *modes* (32 modes in pro-pack.ts) are gated
 * separately via canUseProPackEffects in the shader selection UI.
 */
export function getEffectTier(category: string): EffectTier {
  for (const prefix of PREMIUM_CATEGORY_PREFIXES) {
    if (category.startsWith(prefix)) return 'pro';
  }
  return 'demo';
}

/** Check if a user with the given tier can use an effect from this category */
export function canAccessEffect(userTier: LicenseTier, effectCategory: string): boolean {
  const requiredTier = getEffectTier(effectCategory);
  if (requiredTier === 'demo') return true;
  if (requiredTier === 'pro') return userTier === 'starter' || userTier === 'pro' || userTier === 'enterprise';
  return false;
}

/** Get the display label for a tier badge */
export function getTierBadgeLabel(tier: EffectTier): string {
  switch (tier) {
    case 'demo': return '';
    case 'pro': return 'PRO';
  }
}

// ─── Feature Checks ──────────────────────────────────────────────────────────

export interface FeatureGate {
  id: string;
  label: string;
  description: string;
  requiredTier: LicenseTier;
}

/** All gated features with their required tiers */
export const FEATURE_GATES: FeatureGate[] = [
  { id: 'premium-effects', label: 'Premium Effects', description: '40+ advanced effects including 3D, Atmosphere, and Trails', requiredTier: 'pro' },
  { id: 'spout', label: 'Spout Output', description: 'Send/receive video between applications via Spout', requiredTier: 'pro' },
  { id: 'fluidgen', label: 'FluidGen', description: 'GPU-accelerated fluid simulation engine', requiredTier: 'pro' },
  { id: 'particles3d', label: '3D Particles', description: 'Advanced 3D particle system engine', requiredTier: 'pro' },
  { id: 'threejs', label: 'Three.js Content', description: 'Custom Three.js scenes as media sources', requiredTier: 'pro' },
  { id: 'p5js', label: 'p5.js Content', description: 'Custom p5.js sketches as media sources', requiredTier: 'pro' },
  { id: 'own-api-keys', label: 'Own API Keys', description: 'Use your own AI API keys (Claude, Gemini, Luma)', requiredTier: 'pro' },
  { id: 'midi-edit', label: 'MIDI Editing', description: 'Advanced MIDI mapping and editing controls', requiredTier: 'pro' },
  { id: 'vj-slicing', label: 'VJ Layer Slicing', description: 'Output screen slicing for multi-surface projection', requiredTier: 'pro' },
  { id: 'video-export', label: 'Video Export', description: 'Export compositions as video files', requiredTier: 'pro' },
];

/** Check if a feature is available for a given tier */
export function canAccessFeature(userTier: LicenseTier, featureId: string): boolean {
  const gate = FEATURE_GATES.find(g => g.id === featureId);
  if (!gate) return true; // Unknown feature = ungated

  const tierRank: Record<LicenseTier, number> = { demo: 0, starter: 1, pro: 1, enterprise: 2 };
  return tierRank[userTier] >= tierRank[gate.requiredTier];
}

/** Get layer limit for a given tier — demo is unrestricted (watermark is the only gate) */
export function getLayerLimit(tier: LicenseTier): number {
  return Infinity;
}

/** Get monthly AI credit allocation for a given tier */
export function getMonthlyCredits(tier: LicenseTier): number {
  switch (tier) {
    case 'demo': return 3;
    case 'starter': case 'pro': case 'enterprise': return 0; // BYOK model — unlimited with own keys
  }
}

// ─── Shader Tier Gating ───────────────────────────────────────────────────────

/** Check if a user with the given tier can access a shader tagged with shaderTier */
export function canAccessShader(userTier: LicenseTier, shaderTier: 'demo' | 'pro'): boolean {
  const tierRank: Record<string, number> = { demo: 0, starter: 1, pro: 1, enterprise: 2 };
  return tierRank[userTier] >= tierRank[shaderTier];
}
