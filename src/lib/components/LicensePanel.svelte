<script lang="ts">
  import {
    licenseStatus, licenseTier, licenseLoading, licenseError,
    hasWatermark, activateLicense, deactivateLicense, getMachineId,
    type LicenseStatus
  } from '../stores/license';
  import { canAccessFeature, FEATURE_GATES, getLayerLimit, getMonthlyCredits } from '../license/featureGates';

  export let isOpen = false;
  export let onClose: () => void = () => {};
  export let embedded = false;  // When true, renders inline without modal overlay

  let licenseKeyInput = '';
  let activating = false;
  let deactivating = false;
  let activateError = '';
  let activateSuccess = '';
  let machineId = '';
  let showDeactivateConfirm = false;
  let showSwitchKey = false;
  let copiedMachineId = false;

  // Get machine ID on mount
  getMachineId().then(id => { machineId = id; });

  async function handleActivate() {
    if (!licenseKeyInput.trim()) return;
    activating = true;
    activateError = '';
    activateSuccess = '';

    try {
      await activateLicense(licenseKeyInput.trim());
      activateSuccess = 'License activated successfully!';
      licenseKeyInput = '';
      showSwitchKey = false;
    } catch (err: any) {
      activateError = typeof err === 'string' ? err : err?.message || 'Activation failed. Check your key and try again.';
    } finally {
      activating = false;
    }
  }

  async function handleDeactivate() {
    deactivating = true;
    activateError = '';
    try {
      await deactivateLicense();
      showDeactivateConfirm = false;
      activateSuccess = 'License deactivated. This machine slot is now free.';
    } catch (err: any) {
      activateError = typeof err === 'string' ? err : err?.message || 'Deactivation failed';
    } finally {
      deactivating = false;
    }
  }

  function openUrl(url: string) {
    window.open(url, '_blank');
  }

  function copyMachineId() {
    navigator.clipboard.writeText(machineId);
    copiedMachineId = true;
    setTimeout(() => copiedMachineId = false, 2000);
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function getTierColor(tier: string): string {
    switch (tier) {
      case 'enterprise': return '#a855f7';
      case 'pro': return '#f59e0b';
      case 'starter': return '#3b82f6';
      default: return '#6b7280';
    }
  }

  function getTierLabel(tier: string): string {
    switch (tier) {
      case 'enterprise': return 'Enterprise';
      case 'pro': return 'Pro';
      case 'starter': return 'Starter';
      default: return 'Free Demo';
    }
  }

  function formatExpiry(expiresAt: string | null, isPerpetual: boolean): string {
    if (isPerpetual) return 'Perpetual';
    if (!expiresAt) return 'N/A';
    const d = new Date(expiresAt);
    const now = new Date();
    const daysLeft = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    if (daysLeft < 0) return `Expired (${dateStr})`;
    if (daysLeft <= 7) return `${dateStr} (${daysLeft}d left)`;
    return dateStr;
  }

  $: status = $licenseStatus;
  $: tier = $licenseTier;
  $: isLicensed = tier !== 'demo';
</script>

{#if isOpen}
  {@const content = true}
  {#if !embedded}
  <div class="license-overlay" onclick={handleOverlayClick} role="dialog" aria-modal="true">
    <div class="license-panel">
      <div class="license-header">
        <h2>License & Subscription</h2>
        <button class="close-btn" onclick={onClose}>✕</button>
      </div>
      <div class="license-body">
        {@render licenseContent()}
      </div>
    </div>
  </div>
  {:else}
    <div class="license-body embedded">
      {@render licenseContent()}
    </div>
  {/if}
{/if}

{#snippet licenseContent()}
  <!-- ═══ Current License Status ═══ -->
  <section class="lp-section">
    <div class="lp-section-label">Current License</div>
    <div class="status-card" style="border-left-color: {getTierColor(tier)}">
      <div class="status-top">
        <div class="tier-badge" style="background: {getTierColor(tier)}; color: {tier === 'pro' ? '#000' : '#fff'}">
          {tier.toUpperCase()}
        </div>
        <span class="status-label">{getTierLabel(tier)}</span>
        {#if isLicensed}
          <span class="status-active">● Active</span>
        {/if}
      </div>

      {#if isLicensed}
        <div class="status-grid">
          <div class="sg-item">
            <span class="sg-label">Email</span>
            <span class="sg-value">{status.user_email || '—'}</span>
          </div>
          <div class="sg-item">
            <span class="sg-label">Expires</span>
            <span class="sg-value" class:warn={status.expires_at && !status.is_perpetual && new Date(status.expires_at) < new Date(Date.now() + 7 * 86400000)}>
              {formatExpiry(status.expires_at, status.is_perpetual)}
            </span>
          </div>
          <div class="sg-item">
            <span class="sg-label">License</span>
            <span class="sg-value mono">{status.license_id?.slice(0, 12) || '—'}…</span>
          </div>
          <div class="sg-item">
            <span class="sg-label">Machine</span>
            <button class="sg-value mono machine-copy" onclick={copyMachineId} title="Click to copy">
              {machineId.slice(0, 12)}…
              <span class="copy-icon">{copiedMachineId ? '✓' : '⎘'}</span>
            </button>
          </div>
        </div>
      {:else}
        <p class="demo-desc">Free demo with watermark. Activate a license key to unlock all features.</p>
        <div class="sg-item" style="margin-top: 6px">
          <span class="sg-label">Machine</span>
          <button class="sg-value mono machine-copy" onclick={copyMachineId} title="Click to copy">
            {machineId.slice(0, 12)}…
            <span class="copy-icon">{copiedMachineId ? '✓' : '⎘'}</span>
          </button>
        </div>
      {/if}

      <!-- Grace period alerts -->
      {#if status.grace_warning}
        <div class="alert warn">
          ⚠ Connect to internet to validate. License reverts to demo in ~{status.days_until_check_required} days without check.
        </div>
      {/if}
      {#if status.grace_expired}
        <div class="alert error">
          🔒 License not validated for 30+ days. Connect to the internet and restart to restore.
        </div>
      {/if}
    </div>
  </section>

  <!-- ═══ Activate / Switch Key ═══ -->
  <section class="lp-section">
    <div class="lp-section-label">{isLicensed ? 'Switch License Key' : 'Activate License'}</div>

    {#if isLicensed && !showSwitchKey}
      <p class="section-hint">Have a different key? Switch between monthly subscription and lifetime licenses.</p>
      <button class="btn-outline" onclick={() => { showSwitchKey = true; activateError = ''; activateSuccess = ''; }}>
        Enter a Different Key
      </button>
    {:else}
      {#if isLicensed}
        <p class="section-hint">Enter a new license key to replace the current one. Your old key's machine slot will be freed.</p>
      {/if}
      <div class="key-form">
        <input
          type="text"
          class="key-input"
          placeholder="SW-XXXX-XXXX-XXXX-XXXX"
          bind:value={licenseKeyInput}
          disabled={activating}
          onkeydown={(e) => { if (e.key === 'Enter') handleActivate(); }}
        />
        <button class="btn-primary" onclick={handleActivate} disabled={activating || !licenseKeyInput.trim()}>
          {activating ? 'Activating…' : 'Activate'}
        </button>
      </div>
      {#if isLicensed && showSwitchKey}
        <button class="btn-text" onclick={() => { showSwitchKey = false; licenseKeyInput = ''; activateError = ''; }}>Cancel</button>
      {/if}
    {/if}

    {#if activateError}
      <div class="alert error small">{activateError}</div>
    {/if}
    {#if activateSuccess}
      <div class="alert success small">{activateSuccess}</div>
    {/if}
  </section>

  <!-- ═══ Manage License (licensed users) ═══ -->
  {#if isLicensed}
    <section class="lp-section">
      <div class="lp-section-label">Manage</div>
      <div class="manage-grid">
        <button class="manage-card" onclick={() => openUrl('https://ghostarcade.live/account')}>
          <span class="mc-icon">👤</span>
          <span class="mc-label">Account</span>
          <span class="mc-desc">Profile & settings</span>
        </button>
        <button class="manage-card" onclick={() => openUrl('https://ghostarcade.live/account/billing')}>
          <span class="mc-icon">💳</span>
          <span class="mc-label">Billing</span>
          <span class="mc-desc">Payment & invoices</span>
        </button>
        <button class="manage-card" onclick={() => openUrl('https://ghostarcade.live/pricing')}>
          <span class="mc-icon">⚡</span>
          <span class="mc-label">Upgrade</span>
          <span class="mc-desc">Change your plan</span>
        </button>
        <button class="manage-card danger" onclick={() => { showDeactivateConfirm = true; activateError = ''; activateSuccess = ''; }}>
          <span class="mc-icon">🔓</span>
          <span class="mc-label">Deactivate</span>
          <span class="mc-desc">Free this machine</span>
        </button>
      </div>

      {#if showDeactivateConfirm}
        <div class="deactivate-confirm">
          <p>Remove license from this machine? This frees a device slot so you can activate on another computer.</p>
          <div class="confirm-row">
            <button class="btn-danger" onclick={handleDeactivate} disabled={deactivating}>
              {deactivating ? 'Deactivating…' : 'Yes, Deactivate'}
            </button>
            <button class="btn-outline small" onclick={() => showDeactivateConfirm = false}>Cancel</button>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <!-- ═══ Upgrade CTAs (demo/starter users) ═══ -->
  {#if tier === 'demo'}
    <section class="lp-section">
      <div class="lp-section-label">Get Started</div>
      <p class="section-hint">Unlock all features, remove the watermark, and go pro.</p>
      <div class="upgrade-row">
        <button class="upgrade-card pro" onclick={() => openUrl('https://ghostarcade.live/checkout?tier=pro&billing=monthly')}>
          <span class="uc-tier">Pro Monthly</span>
          <span class="uc-price">$19<small>/mo</small></span>
          <span class="uc-features">All features • No watermark • Unlimited layers</span>
        </button>
        <button class="upgrade-card perpetual" onclick={() => openUrl('https://ghostarcade.live/checkout?tier=pro&billing=perpetual')}>
          <span class="uc-tier">Pro Lifetime</span>
          <span class="uc-price">$399<small> once</small></span>
          <span class="uc-features">Pay once, own forever • All updates included</span>
        </button>
      </div>
      <button class="btn-text center" onclick={() => openUrl('https://ghostarcade.live/pricing')}>
        Compare all plans →
      </button>
    </section>
  {:else if tier === 'starter'}
    <section class="lp-section">
      <div class="lp-section-label">Upgrade</div>
      <button class="upgrade-card pro wide" onclick={() => openUrl('https://ghostarcade.live/checkout?tier=pro&billing=monthly')}>
        <span class="uc-tier">Upgrade to Pro</span>
        <span class="uc-price">$19<small>/mo</small></span>
        <span class="uc-features">Premium effects • Spout • 3D Particles • Video Export</span>
      </button>
    </section>
  {/if}

  <!-- ═══ Feature Comparison (collapsible) ═══ -->
  <details class="lp-section feature-details">
    <summary class="lp-section-label clickable">Feature Comparison ▸</summary>
    <div class="feature-table">
      <div class="ft-row header">
        <span class="ft-name">Feature</span>
        <span class="ft-tier">Demo</span>
        <span class="ft-tier">Pro</span>
      </div>
      <div class="ft-row">
        <span class="ft-name">Max Layers</span>
        <span class="ft-tier">{getLayerLimit('demo')}</span>
        <span class="ft-tier">∞</span>
      </div>
      <div class="ft-row">
        <span class="ft-name">Watermark</span>
        <span class="ft-tier dimmed">Yes</span>
        <span class="ft-tier check">✓ Removed</span>
      </div>
      {#each FEATURE_GATES as gate}
        <div class="ft-row">
          <span class="ft-name">{gate.label}</span>
          <span class="ft-tier">{canAccessFeature('demo', gate.id) ? '✓' : '—'}</span>
          <span class="ft-tier check">✓</span>
        </div>
      {/each}
    </div>
  </details>

  <!-- ═══ Diagnostics ═══ -->
  <details class="lp-section">
    <summary class="lp-section-label clickable">Diagnostics ▸</summary>
    <div class="diag-grid">
      <div class="diag-item">
        <span class="diag-label">Tier</span>
        <span class="diag-value">{tier}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Machine ID</span>
        <span class="diag-value mono">{machineId || 'loading…'}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">License ID</span>
        <span class="diag-value mono">{status.license_id || 'none'}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Perpetual</span>
        <span class="diag-value">{status.is_perpetual ? 'Yes' : 'No'}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Grace Warning</span>
        <span class="diag-value">{status.grace_warning ? 'Yes' : 'No'}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Grace Expired</span>
        <span class="diag-value">{status.grace_expired ? 'Yes' : 'No'}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Days Until Check</span>
        <span class="diag-value">{status.days_until_check_required}</span>
      </div>
    </div>
  </details>
{/snippet}

<style>
  /* ═══ Layout ═══ */
  .license-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
  }

  .license-panel {
    background: var(--bg-secondary, #1a1a2e);
    border: 1px solid var(--border-primary, #333);
    border-radius: 12px;
    width: 540px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .license-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-secondary, #2a2a3e);
  }

  .license-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--bg-tertiary, #252540);
    color: var(--text-primary, #e0e0e0);
  }

  .license-body {
    padding: 16px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .license-body.embedded {
    padding: 0;
    gap: 14px;
  }

  /* ═══ Sections ═══ */
  .lp-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .lp-section-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-muted, #666);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .lp-section-label.clickable {
    cursor: pointer;
    user-select: none;
  }

  .lp-section-label.clickable:hover {
    color: var(--text-secondary, #888);
  }

  .section-hint {
    font-size: 11px;
    color: var(--text-secondary, #777);
    margin: 0;
    line-height: 1.5;
  }

  /* ═══ Status Card ═══ */
  .status-card {
    background: var(--bg-tertiary, #252540);
    border: 1px solid var(--border-secondary, #333);
    border-left: 3px solid;
    border-radius: 8px;
    padding: 12px 14px;
  }

  .status-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .tier-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
  }

  .status-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
  }

  .status-active {
    font-size: 11px;
    color: #22c55e;
    margin-left: auto;
  }

  .status-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 16px;
  }

  .sg-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .sg-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted, #555);
  }

  .sg-value {
    font-size: 12px;
    color: var(--text-primary, #e0e0e0);
  }

  .sg-value.warn {
    color: #f59e0b;
  }

  .mono {
    font-family: 'Fira Code', 'JetBrains Mono', monospace;
    font-size: 11px;
  }

  .machine-copy {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .machine-copy:hover {
    color: var(--accent-primary, #e74c6f);
  }

  .copy-icon {
    font-size: 12px;
    opacity: 0.5;
  }

  .demo-desc {
    font-size: 12px;
    color: var(--text-secondary, #888);
    margin: 0 0 4px 0;
    line-height: 1.5;
  }

  /* ═══ Alerts ═══ */
  .alert {
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.4;
  }

  .alert.warn {
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.25);
    color: #f59e0b;
    margin-top: 8px;
  }

  .alert.error {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #ef4444;
  }

  .alert.success {
    background: rgba(34, 197, 94, 0.08);
    border: 1px solid rgba(34, 197, 94, 0.25);
    color: #22c55e;
  }

  .alert.small {
    margin-top: 6px;
  }

  /* ═══ Key Input Form ═══ */
  .key-form {
    display: flex;
    gap: 6px;
  }

  .key-input {
    flex: 1;
    background: var(--bg-primary, #0d0d1a);
    border: 1px solid var(--border-primary, #333);
    border-radius: 5px;
    padding: 7px 10px;
    color: var(--text-primary, #e0e0e0);
    font-family: 'Fira Code', monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
  }

  .key-input::placeholder {
    color: var(--text-muted, #444);
  }

  .key-input:focus {
    border-color: var(--accent-primary, #e74c6f);
    outline: none;
  }

  /* ═══ Buttons ═══ */
  .btn-primary {
    background: var(--accent-primary, #e74c6f);
    color: #fff;
    border: none;
    border-radius: 5px;
    padding: 7px 14px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.15);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--border-primary, #444);
    color: var(--text-primary, #ccc);
    border-radius: 5px;
    padding: 7px 14px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn-outline:hover {
    background: var(--bg-tertiary, #252540);
    border-color: var(--text-secondary, #888);
  }

  .btn-outline.small {
    padding: 5px 12px;
    font-size: 10px;
  }

  .btn-danger {
    background: #ef4444;
    color: #fff;
    border: none;
    border-radius: 5px;
    padding: 7px 14px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-danger:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-danger:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn-text {
    background: none;
    border: none;
    color: var(--accent-primary, #e74c6f);
    font-size: 11px;
    cursor: pointer;
    padding: 4px 0;
  }

  .btn-text:hover {
    text-decoration: underline;
  }

  .btn-text.center {
    text-align: center;
    margin-top: 4px;
  }

  /* ═══ Manage Grid ═══ */
  .manage-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .manage-card {
    background: var(--bg-tertiary, #252540);
    border: 1px solid var(--border-secondary, #2a2a3e);
    border-radius: 6px;
    padding: 10px;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: all 0.15s;
  }

  .manage-card:hover {
    border-color: var(--text-secondary, #666);
    background: var(--bg-overlay, #303050);
  }

  .manage-card.danger:hover {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.06);
  }

  .mc-icon {
    font-size: 16px;
    margin-bottom: 2px;
  }

  .mc-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
  }

  .mc-desc {
    font-size: 10px;
    color: var(--text-muted, #666);
  }

  .manage-card.danger .mc-label {
    color: var(--text-secondary, #aaa);
  }

  /* ═══ Deactivate Confirm ═══ */
  .deactivate-confirm {
    background: rgba(239, 68, 68, 0.05);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
    padding: 10px;
    margin-top: 4px;
  }

  .deactivate-confirm p {
    color: var(--text-secondary, #888);
    font-size: 11px;
    margin: 0 0 8px 0;
    line-height: 1.4;
  }

  .confirm-row {
    display: flex;
    gap: 6px;
  }

  /* ═══ Upgrade Cards ═══ */
  .upgrade-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .upgrade-card {
    border: none;
    border-radius: 8px;
    padding: 14px 12px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: all 0.2s;
  }

  .upgrade-card.pro {
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: #000;
  }

  .upgrade-card.annual {
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: #fff;
  }

  .upgrade-card.perpetual {
    background: linear-gradient(135deg, #a855f7, #7c3aed);
    color: #fff;
  }

  .upgrade-card.wide {
    grid-column: 1 / -1;
  }

  .upgrade-card:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  .uc-tier {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.8;
  }

  .uc-price {
    font-size: 22px;
    font-weight: 800;
    line-height: 1;
  }

  .uc-price small {
    font-size: 12px;
    font-weight: 500;
  }

  .uc-features {
    font-size: 10px;
    opacity: 0.8;
    line-height: 1.3;
    margin-top: 2px;
  }

  /* ═══ Feature Table ═══ */
  .feature-details {
    margin-top: 2px;
  }

  .feature-details[open] .lp-section-label {
    margin-bottom: 6px;
  }

  .feature-table {
    border: 1px solid var(--border-secondary, #2a2a3e);
    border-radius: 6px;
    overflow: hidden;
  }

  .ft-row {
    display: grid;
    grid-template-columns: 1fr 50px 50px;
    padding: 5px 10px;
    font-size: 11px;
    border-bottom: 1px solid var(--border-secondary, #1e1e35);
  }

  .ft-row:last-child {
    border-bottom: none;
  }

  .ft-row.header {
    background: var(--bg-tertiary, #252540);
    font-weight: 700;
    color: var(--text-secondary, #888);
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.06em;
    padding: 6px 10px;
  }

  .ft-name {
    color: var(--text-primary, #ccc);
  }

  .ft-tier {
    text-align: center;
    color: var(--text-muted, #555);
  }

  .ft-tier.check {
    color: #22c55e;
  }

  .ft-tier.dimmed {
    color: var(--text-muted, #555);
  }

  /* ═══ Diagnostics ═══ */
  .diag-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;
    background: var(--bg-tertiary, #1a1a2e);
    border: 1px solid var(--border-secondary, #2a2a3e);
    border-radius: 6px;
    padding: 10px;
    margin-top: 4px;
  }

  .diag-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .diag-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted, #555);
  }

  .diag-value {
    font-size: 11px;
    color: var(--text-secondary, #999);
    word-break: break-all;
  }

  .detail-row {
    font-size: 12px;
    color: var(--text-primary, #e0e0e0);
  }

  .active-text {
    color: #22c55e;
  }
</style>
