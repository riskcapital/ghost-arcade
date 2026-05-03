import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import {
  licenseStatus,
  licenseTier,
  hasWatermark,
  maxLayers,
  maxOutputSlices,
  canUseOutputSlices,
  canUseSpout,
  canUseOwnAPIKeys,
  canUseVideoExport,
  graceWarning,
  graceExpired,
  type LicenseStatus,
} from './license';

function setTier(tier: LicenseStatus['tier']) {
  licenseStatus.set({
    tier,
    user_email: null,
    license_id: null,
    expires_at: null,
    is_perpetual: false,
    machine_id: 'test',
    days_until_check_required: 30,
    grace_warning: false,
    grace_expired: false,
  });
}

describe('license feature gates', () => {
  it('demo tier has watermark', () => {
    setTier('demo');
    expect(get(hasWatermark)).toBe(true);
  });

  it('starter tier has no watermark', () => {
    setTier('starter');
    expect(get(hasWatermark)).toBe(false);
  });

  it('pro tier has no watermark', () => {
    setTier('pro');
    expect(get(hasWatermark)).toBe(false);
  });

  it('demo tier allows 3 layers', () => {
    setTier('demo');
    expect(get(maxLayers)).toBe(3);
  });

  it('starter tier allows 8 layers', () => {
    setTier('starter');
    expect(get(maxLayers)).toBe(8);
  });

  it('pro tier allows unlimited layers', () => {
    setTier('pro');
    expect(get(maxLayers)).toBe(Infinity);
  });

  it('pro-only features disabled for demo', () => {
    setTier('demo');
    expect(get(canUseSpout)).toBe(false);
    expect(get(canUseOwnAPIKeys)).toBe(false);
    expect(get(canUseVideoExport)).toBe(false);
  });

  it('pro-only features disabled for starter', () => {
    setTier('starter');
    expect(get(canUseSpout)).toBe(false);
    expect(get(canUseOwnAPIKeys)).toBe(false);
  });

  it('pro-only features enabled for pro', () => {
    setTier('pro');
    expect(get(canUseSpout)).toBe(true);
    expect(get(canUseOwnAPIKeys)).toBe(true);
    expect(get(canUseVideoExport)).toBe(true);
  });

  it('derived licenseTier reflects status', () => {
    setTier('starter');
    expect(get(licenseTier)).toBe('starter');
    setTier('pro');
    expect(get(licenseTier)).toBe('pro');
  });

  // ── Output slices tier gating ──────────────────────────────────────────
  it('demo gets 0 output slices', () => {
    setTier('demo');
    expect(get(maxOutputSlices)).toBe(0);
    expect(get(canUseOutputSlices)).toBe(false);
  });

  it('starter gets 1 output slice', () => {
    setTier('starter');
    expect(get(maxOutputSlices)).toBe(1);
    expect(get(canUseOutputSlices)).toBe(false);
  });

  it('pro gets up to 3 output slices', () => {
    setTier('pro');
    expect(get(maxOutputSlices)).toBe(3);
    expect(get(canUseOutputSlices)).toBe(true);
  });

  it('enterprise gets unlimited output slices', () => {
    setTier('enterprise');
    expect(get(maxOutputSlices)).toBe(Infinity);
    expect(get(canUseOutputSlices)).toBe(true);
  });

  it('enterprise inherits all pro features', () => {
    setTier('enterprise');
    expect(get(canUseSpout)).toBe(true);
    expect(get(canUseOwnAPIKeys)).toBe(true);
    expect(get(canUseVideoExport)).toBe(true);
    expect(get(maxLayers)).toBe(Infinity);
    expect(get(hasWatermark)).toBe(false);
  });

  it('grace period flags propagate', () => {
    licenseStatus.set({
      tier: 'pro',
      user_email: null,
      license_id: null,
      expires_at: null,
      is_perpetual: false,
      machine_id: 'test',
      days_until_check_required: 2,
      grace_warning: true,
      grace_expired: false,
    });
    expect(get(graceWarning)).toBe(true);
    expect(get(graceExpired)).toBe(false);
  });
});
