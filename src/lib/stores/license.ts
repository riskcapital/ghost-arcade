// License Store
// Manages license tier, feature gates, and periodic validation

import { writable, derived, get } from 'svelte/store';
import { invoke, isDesktopApp } from '$lib/bridge';

// ─── Types ───────────────────────────────────────────────────────────────────

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

const DEFAULT_STATUS: LicenseStatus = {
  tier: 'demo',
  user_email: null,
  license_id: null,
  expires_at: null,
  is_perpetual: false,
  machine_id: '',
  days_until_check_required: 0,
  grace_warning: false,
  grace_expired: false,
};

// ─── Core Store ──────────────────────────────────────────────────────────────

export const licenseStatus = writable<LicenseStatus>(DEFAULT_STATUS);
export const licenseLoading = writable(false);
export const licenseError = writable<string | null>(null);

// ─── Derived Feature Gate Stores ─────────────────────────────────────────────

export const licenseTier = derived(licenseStatus, $s => $s.tier);

export const hasWatermark = derived(licenseTier, $t => $t === 'demo');

export const maxLayers = derived(licenseTier, $t => Infinity);

// Demo-friendly: all features unlocked; watermark is the ONLY distinction.
const isPro = ($t: LicenseTier) => true;

// Effect access: everything available to everyone — watermark is the only gate.
export const canUsePremiumEffects = derived(licenseTier, () => true);
export const canUseProPackEffects = derived(licenseTier, () => true);
export const canUseSpout = derived(licenseTier, () => true);
export const canUseFluidGen = derived(licenseTier, () => true);
export const canUseParticles3D = derived(licenseTier, () => true);
export const canUseThreeJS = derived(licenseTier, () => true);
export const canUseP5JS = derived(licenseTier, () => true);
export const canUseOwnAPIKeys = derived(licenseTier, () => true);
export const canUseMIDIEdit = derived(licenseTier, () => true);
export const canUseVJSlicing = derived(licenseTier, () => true);
export const canUseVideoExport = derived(licenseTier, () => true);

// Multi-output slices: fully unlocked regardless of tier
export const maxOutputSlices = derived(licenseTier, () => Infinity);
export const canUseOutputSlices = derived(licenseTier, () => true);

// Grace period warnings
export const graceWarning = derived(licenseStatus, $s => $s.grace_warning);
export const graceExpired = derived(licenseStatus, $s => $s.grace_expired);

// ─── Dev Tier Override (browser dev mode only) ──────────────────────────────

/** Set a dev tier override (browser dev mode only). Persists to localStorage. */
export function setDevTierOverride(tier: LicenseTier): void {
  if (isDesktopApp) return; // No-op in Tauri builds
  try { localStorage.setItem('sw-dev-tier', tier); } catch {}
  licenseStatus.update(s => ({ ...s, tier }));
}

/** Read persisted dev tier override from localStorage */
function getDevTierOverride(): LicenseTier {
  try {
    const saved = localStorage.getItem('sw-dev-tier');
    if (saved === 'demo' || saved === 'starter' || saved === 'pro' || saved === 'enterprise') return saved;
  } catch {}
  return 'pro'; // Default dev mode tier
}

// ─── Actions ─────────────────────────────────────────────────────────────────

let validationInterval: ReturnType<typeof setInterval> | null = null;

/** Initialize license system on app startup */
export async function initLicense(): Promise<void> {
  if (!isDesktopApp) {
    // Running in browser (dev mode) — use persisted tier override
    const devTier = getDevTierOverride();
    licenseStatus.set({
      ...DEFAULT_STATUS,
      tier: devTier,
      machine_id: 'dev-mode',
    });
    return;
  }

  licenseLoading.set(true);
  licenseError.set(null);

  try {
    const status = await invoke<LicenseStatus>('license_get_status');
    licenseStatus.set(status);

    if (status.grace_warning) {
      console.warn(`[License] Grace period warning: online check required within ${30 - (7 - status.days_until_check_required)} days`);
    }

    // Attempt background online validation
    tryOnlineValidation();

    // Set up periodic validation every 4 hours
    if (validationInterval) clearInterval(validationInterval);
    validationInterval = setInterval(() => {
      tryOnlineValidation();
    }, 4 * 60 * 60 * 1000);

  } catch (err: any) {
    console.error('[License] Failed to get license status:', err);
    licenseError.set(err?.message || 'Failed to check license');
    // Fall back to demo
    licenseStatus.set(DEFAULT_STATUS);
  } finally {
    licenseLoading.set(false);
  }
}

/** Try to validate online (silent, non-blocking) */
async function tryOnlineValidation(): Promise<void> {
  if (!isDesktopApp) return;

  const status = get(licenseStatus);
  if (!status.license_id) return; // No license to validate

  try {
    const freshStatus = await invoke<LicenseStatus>('license_validate_online');
    licenseStatus.set(freshStatus);
  } catch {
    // Silent failure — grace period handles offline scenarios
  }
}

/** Activate a license key */
export async function activateLicense(licenseKey: string): Promise<void> {
  licenseLoading.set(true);
  licenseError.set(null);

  try {
    const status = await invoke<LicenseStatus>('license_activate', { licenseKey });
    licenseStatus.set(status);
  } catch (err: any) {
    licenseError.set(err?.message || err || 'Activation failed');
    throw err;
  } finally {
    licenseLoading.set(false);
  }
}

/** Deactivate license on this machine */
export async function deactivateLicense(): Promise<void> {
  licenseLoading.set(true);
  licenseError.set(null);

  try {
    await invoke('license_deactivate');
    licenseStatus.set({ ...DEFAULT_STATUS, machine_id: get(licenseStatus).machine_id });
  } catch (err: any) {
    licenseError.set(err?.message || err || 'Deactivation failed');
    throw err;
  } finally {
    licenseLoading.set(false);
  }
}

/** Get this machine's hardware fingerprint */
export async function getMachineId(): Promise<string> {
  if (!isDesktopApp) return 'dev-mode';
  return invoke<string>('license_get_machine_id');
}

/** Cleanup on app teardown */
export function destroyLicense(): void {
  if (validationInterval) {
    clearInterval(validationInterval);
    validationInterval = null;
  }
}
