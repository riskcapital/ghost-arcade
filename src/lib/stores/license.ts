/**
 * License store — stubbed for the open-source release.
 *
 * Ghost Arcade is now a single product, free, AGPL-3.0. There are no
 * tiers, no watermarks, no activation, no online validation.
 *
 * This file used to manage a four-tier license system with periodic
 * server validation, machine fingerprinting, and grace-period downgrade.
 * All of that infrastructure has been ripped out. The exports below are
 * preserved so existing import sites continue to compile — every gate
 * returns `true` / `Infinity`, no IPC ever fires, and `hasWatermark` is
 * permanently `false`.
 *
 * If you're forking this for a commercial release (e.g. the houses-of-
 * worship spin-off), this is the right place to re-introduce gating —
 * change the `licenseTier` writable to whatever your tier model needs
 * and the `canUse*` derived stores will pick it up automatically.
 */

import { writable, derived } from 'svelte/store';

// ─── Types ───────────────────────────────────────────────────────────────────
// `LicenseTier` is kept as a string union for source compatibility, but
// `'pro'` is the only value we ever hand out now.
export type LicenseTier = 'demo' | 'starter' | 'pro' | 'enterprise';

export interface LicenseStatus {
  tier: LicenseTier;
  user_email: string | null;
  license_id: string | null;
  expires_at: string | null;
  is_perpetual: boolean;
  machine_id: string;
  days_until_check_required: number;
  grace_warning: boolean;
  grace_expired: boolean;
}

const ALWAYS_PRO_STATUS: LicenseStatus = {
  tier: 'pro',
  user_email: null,
  license_id: null,
  expires_at: null,
  is_perpetual: true,
  machine_id: 'oss',
  days_until_check_required: Number.POSITIVE_INFINITY,
  grace_warning: false,
  grace_expired: false,
};

// ─── Core Stores ─────────────────────────────────────────────────────────────

export const licenseStatus = writable<LicenseStatus>(ALWAYS_PRO_STATUS);
export const licenseLoading = writable(false);
export const licenseError = writable<string | null>(null);

// ─── Derived gates — all unlocked, watermark always off ──────────────────────

export const licenseTier = derived(licenseStatus, () => 'pro' as LicenseTier);
export const hasWatermark = derived(licenseStatus, () => false);
export const maxLayers = derived(licenseStatus, () => Number.POSITIVE_INFINITY);

export const canUsePremiumEffects = derived(licenseStatus, () => true);
export const canUseProPackEffects = derived(licenseStatus, () => true);
export const canUseSpout = derived(licenseStatus, () => true);
export const canUseFluidGen = derived(licenseStatus, () => true);
export const canUseParticles3D = derived(licenseStatus, () => true);
export const canUseThreeJS = derived(licenseStatus, () => true);
export const canUseP5JS = derived(licenseStatus, () => true);
export const canUseOwnAPIKeys = derived(licenseStatus, () => true);
export const canUseMIDIEdit = derived(licenseStatus, () => true);
export const canUseVJSlicing = derived(licenseStatus, () => true);
export const canUseVideoExport = derived(licenseStatus, () => true);

export const maxOutputSlices = derived(licenseStatus, () => Number.POSITIVE_INFINITY);
export const canUseOutputSlices = derived(licenseStatus, () => true);

export const graceWarning = derived(licenseStatus, () => false);
export const graceExpired = derived(licenseStatus, () => false);

// ─── No-op actions (kept for source compatibility) ───────────────────────────

/** Dev tier override is a no-op in the OSS build. */
export function setDevTierOverride(_tier: LicenseTier): void {
  /* no-op — everyone is 'pro' now */
}

/** Initialize the license system. No-op in the OSS build. */
export async function initLicense(): Promise<void> {
  licenseStatus.set(ALWAYS_PRO_STATUS);
}

/** Activate a license key. No-op in the OSS build. */
export async function activateLicense(_licenseKey: string): Promise<void> {
  /* no-op — no activation needed */
}

/** Deactivate license on this machine. No-op in the OSS build. */
export async function deactivateLicense(): Promise<void> {
  /* no-op — nothing to deactivate */
}

/** Get this machine's hardware fingerprint. Returns a stable placeholder. */
export async function getMachineId(): Promise<string> {
  return 'oss';
}

/** Cleanup on app teardown. No-op in the OSS build. */
export function destroyLicense(): void {
  /* no-op */
}
