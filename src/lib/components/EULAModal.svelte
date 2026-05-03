<script lang="ts">
  import { invoke, isDesktopApp } from '$lib/bridge';
  import { licenseStatus } from '../stores/license';

  export let onAccept: () => void = () => {};

  let scrolledToBottom = false;
  let scrollEl: HTMLDivElement;

  function handleScroll() {
    if (!scrollEl) return;
    const nearBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 20;
    if (nearBottom) scrolledToBottom = true;
  }

  async function accept() {
    // Record acceptance locally
    const timestamp = new Date().toISOString();
    const machineId = $licenseStatus.machine_id || 'unknown';
    const acceptance = {
      accepted: true,
      timestamp,
      machineId,
      appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',
    };
    localStorage.setItem('ghostarcade-eula-accepted', JSON.stringify(acceptance));

    // Record on backend (best-effort, non-blocking)
    try {
      const { settings: settingsStore } = await import('../stores/settings');
      const { get } = await import('svelte/store');
      // If user has a license, record via the license validation endpoint metadata
      // For now, store locally and it gets sent with the next license validation
    } catch {}

    onAccept();
  }

  function decline() {
    // Close the app
    if (isDesktopApp) {
      window.close();
    }
  }
</script>

<div class="eula-overlay">
  <div class="eula-modal">
    <div class="eula-header">
      <h2>License Agreement</h2>
      <p class="eula-subtitle">Please read and accept the Ghost Arcade End User License Agreement</p>
    </div>

    <div class="eula-scroll" bind:this={scrollEl} onscroll={handleScroll}>
      <div class="eula-text">
        <h3>Ghost Arcade End User License Agreement</h3>
        <p><strong>Last updated: April 2026</strong></p>

        <h4>1. License Grant</h4>
        <p>Ghost Arcade ("Software") is licensed, not sold. Risk Capital Media LLC ("Company") grants you a limited, non-exclusive, non-transferable license to use the Software according to your subscription tier. Pro Monthly and Pro Lifetime tiers unlock all features and effects. A separate free, open-source Community edition is distributed under the GNU AGPL v3.0 and is governed by that license, not this Agreement.</p>

        <h4>2. Restrictions</h4>
        <p>You may not: (a) reverse engineer, decompile, or disassemble the Software; (b) redistribute, sublicense, or transfer the Software to any third party; (c) remove or alter any proprietary notices; (d) use the Software for any unlawful purpose; (e) attempt to circumvent the license validation system.</p>

        <h4>3. Machine Activation</h4>
        <p>Licensed copies of the Software are bound to specific machines via hardware fingerprinting. Pro licenses include activations for up to 2 machines. You may deactivate a machine to free a slot for another device.</p>

        <h4>4. Intellectual Property</h4>
        <p>The Software, including all code, shaders, effects, and documentation, is the intellectual property of Risk Capital Media LLC. Content you create using the Software remains your property. The ISF shader library includes open-source shaders used under their respective licenses.</p>

        <h4>5. Payment & Subscriptions</h4>
        <p>Paid subscriptions are billed in advance on a monthly or yearly basis. One-time perpetual licenses include one year of updates. All payments are processed by Stripe. You may cancel your subscription at any time through your account dashboard.</p>

        <h4>6. Refunds</h4>
        <p>We offer a 14-day money-back guarantee for new subscriptions. Contact make@ghostarcade.live to request a refund within this period.</p>

        <h4>7. Data Collection</h4>
        <p>The Software collects: machine fingerprint (for license validation), app version, and usage analytics. No personal content or project data is transmitted. License validation occurs periodically over HTTPS to ghostarcade.live.</p>

        <h4>8. Disclaimer of Warranties</h4>
        <p>THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT.</p>

        <h4>9. Limitation of Liability</h4>
        <p>IN NO EVENT SHALL RISK CAPITAL MEDIA LLC BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SOFTWARE.</p>

        <h4>10. Termination</h4>
        <p>This license is effective until terminated. It terminates automatically if you fail to comply with any term. Upon termination, you must destroy all copies of the Software.</p>

        <h4>11. Governing Law</h4>
        <p>This Agreement shall be governed by the laws of the State of Florida, United States.</p>

        <h4>12. Contact</h4>
        <p>Questions about this agreement? Contact make@ghostarcade.live.</p>
      </div>
    </div>

    <div class="eula-actions">
      <p class="scroll-hint" class:hidden={scrolledToBottom}>Scroll to read the full agreement</p>
      <div class="eula-buttons">
        <button class="eula-decline" onclick={decline}>Decline</button>
        <button class="eula-accept" disabled={!scrolledToBottom} onclick={accept}>
          {scrolledToBottom ? 'I Accept' : 'Read to Accept'}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .eula-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(8px);
  }

  .eula-modal {
    background: var(--bg-secondary, #1a1a2e);
    border: 1px solid var(--border-primary, #333);
    border-radius: 10px;
    width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .eula-header {
    padding: 20px 24px 12px;
    border-bottom: 1px solid var(--border-secondary, #2a2a3e);
  }

  .eula-header h2 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary, #e0e0e0);
  }

  .eula-subtitle {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted, #666);
  }

  .eula-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px;
    max-height: 50vh;
  }

  .eula-text {
    font-size: 12px;
    color: var(--text-secondary, #999);
    line-height: 1.7;
  }

  .eula-text h3 {
    color: var(--text-primary, #e0e0e0);
    font-size: 14px;
    margin: 0 0 8px;
  }

  .eula-text h4 {
    color: var(--text-primary, #ccc);
    font-size: 12px;
    margin: 16px 0 4px;
  }

  .eula-text p {
    margin: 0 0 8px;
  }

  .eula-actions {
    padding: 12px 24px 16px;
    border-top: 1px solid var(--border-secondary, #2a2a3e);
  }

  .scroll-hint {
    font-size: 11px;
    color: var(--text-muted, #555);
    text-align: center;
    margin: 0 0 8px;
    transition: opacity 0.3s;
  }

  .scroll-hint.hidden {
    opacity: 0;
  }

  .eula-buttons {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .eula-decline {
    padding: 8px 20px;
    background: transparent;
    border: 1px solid var(--border-primary, #444);
    color: var(--text-secondary, #888);
    border-radius: 5px;
    font-size: 13px;
    cursor: pointer;
  }

  .eula-decline:hover {
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.3);
  }

  .eula-accept {
    padding: 8px 24px;
    background: linear-gradient(135deg, #a855f7, #7c3aed);
    border: none;
    color: #fff;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .eula-accept:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .eula-accept:hover:not(:disabled) {
    box-shadow: 0 0 20px rgba(168, 85, 247, 0.3);
  }
</style>
