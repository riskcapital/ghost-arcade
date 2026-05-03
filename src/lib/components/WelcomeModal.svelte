<script lang="ts">
  import { licenseTier, licenseStatus, activateLicense } from '../stores/license';

  export let onClose: () => void = () => {};

  let mode: 'welcome' | 'activate' = 'welcome';
  let licenseKeyInput = '';
  let activating = false;
  let activateError = '';

  async function handleActivate() {
    if (!licenseKeyInput.trim()) return;
    activating = true;
    activateError = '';
    try {
      await activateLicense(licenseKeyInput.trim());
      onClose();
    } catch (err: any) {
      activateError = typeof err === 'string' ? err : err?.message || 'Activation failed';
    } finally {
      activating = false;
    }
  }

  function startDemo() {
    localStorage.setItem('ghostarcade-welcome-seen', 'true');
    onClose();
  }

  function openPurchase() {
    window.open('https://ghostarcade.live/pricing', '_blank');
  }
</script>

<div class="welcome-overlay">
  <div class="welcome-panel">
    {#if mode === 'welcome'}
      <div class="welcome-logo">
        <img src="{import.meta.env.BASE_URL}illVisualsLogo.png" alt="Ghost Arcade" class="logo-img" />
      </div>
      <h1 class="welcome-title">Welcome to Ghost Arcade</h1>
      <p class="welcome-subtitle">Professional projection mapping & VJ software</p>

      <div class="welcome-actions">
        <button class="welcome-btn primary" onclick={() => { mode = 'activate'; }}>
          Enter License Key
        </button>
        <button class="welcome-btn secondary" onclick={startDemo}>
          Start Free Demo
        </button>
        <button class="welcome-btn outline" onclick={openPurchase}>
          Purchase License
        </button>
      </div>

      <p class="welcome-hint">
        The free demo includes all features with a watermark overlay.
        Upgrade anytime from Settings → License.
      </p>

    {:else}
      <h2 class="activate-title">Activate License</h2>
      <p class="activate-desc">Enter your license key to unlock Ghost Arcade.</p>

      <div class="activate-form">
        <input
          type="text"
          class="key-input"
          placeholder="SW-XXXX-XXXX-XXXX-XXXX"
          bind:value={licenseKeyInput}
          disabled={activating}
          onkeydown={(e) => { if (e.key === 'Enter') handleActivate(); }}
        />
        {#if activateError}
          <p class="error-msg">{activateError}</p>
        {/if}
      </div>

      <div class="activate-actions">
        <button class="welcome-btn outline" onclick={() => { mode = 'welcome'; activateError = ''; }}>
          Back
        </button>
        <button class="welcome-btn primary" onclick={handleActivate} disabled={activating || !licenseKeyInput.trim()}>
          {activating ? 'Activating...' : 'Activate'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .welcome-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20000;
    backdrop-filter: blur(8px);
  }

  .welcome-panel {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #333;
    border-radius: 16px;
    padding: 40px 36px 32px;
    width: 420px;
    text-align: center;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  }

  .welcome-logo {
    margin-bottom: 16px;
  }

  .logo-img {
    max-width: 180px;
    max-height: 120px;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: 14px;
  }

  .welcome-title {
    font-size: 22px;
    font-weight: 700;
    color: #e0e0e0;
    margin: 0 0 6px 0;
  }

  .welcome-subtitle {
    font-size: 13px;
    color: #888;
    margin: 0 0 28px 0;
  }

  .welcome-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 20px;
  }

  .welcome-btn {
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .welcome-btn.primary {
    background: linear-gradient(135deg, #e74c6f, #c2185b);
    color: #fff;
    border: none;
  }

  .welcome-btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  .welcome-btn.primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .welcome-btn.secondary {
    background: rgba(255, 255, 255, 0.08);
    color: #e0e0e0;
    border: 1px solid #444;
  }

  .welcome-btn.secondary:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: #666;
  }

  .welcome-btn.outline {
    background: transparent;
    color: #999;
    border: 1px solid #333;
  }

  .welcome-btn.outline:hover {
    color: #ccc;
    border-color: #555;
  }

  .welcome-hint {
    font-size: 11px;
    color: #555;
    line-height: 1.6;
    margin: 0;
  }

  /* Activate mode */
  .activate-title {
    font-size: 18px;
    font-weight: 600;
    color: #e0e0e0;
    margin: 0 0 6px 0;
  }

  .activate-desc {
    font-size: 13px;
    color: #888;
    margin: 0 0 20px 0;
  }

  .activate-form {
    margin-bottom: 16px;
  }

  .key-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px 16px;
    color: #e0e0e0;
    font-family: 'Fira Code', monospace;
    font-size: 14px;
    letter-spacing: 0.05em;
    text-align: center;
    box-sizing: border-box;
  }

  .key-input::placeholder {
    color: #555;
  }

  .key-input:focus {
    outline: none;
    border-color: #e74c6f;
  }

  .error-msg {
    color: #ef4444;
    font-size: 12px;
    margin: 8px 0 0 0;
  }

  .activate-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .activate-actions .welcome-btn {
    flex: 1;
  }
</style>
