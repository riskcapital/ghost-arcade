<script lang="ts">
  // Welcome modal — first-launch greeter for the open-source build.
  // No license activation, no purchase upsell, no demo/watermark fork.
  // Just a friendly hello + a "Get started" button.

  export let onClose: () => void = () => {};

  function getStarted() {
    localStorage.setItem('ghostarcade-welcome-seen', 'true');
    onClose();
  }
  function openGitHub() {
    window.open('https://github.com/riskcapital/ghost-arcade', '_blank', 'noopener');
  }
</script>

<div class="welcome-overlay">
  <div class="welcome-panel">
    <div class="welcome-logo">
      <img src="{import.meta.env.BASE_URL}logo.png" alt="Ghost Arcade" class="logo-img" />
    </div>
    <h1 class="welcome-title">Welcome to Ghost Arcade</h1>
    <p class="welcome-subtitle">Open-source projection mapping &amp; VJ software</p>

    <div class="welcome-actions">
      <button class="welcome-btn primary" onclick={getStarted}>
        Get started
      </button>
      <button class="welcome-btn outline" onclick={openGitHub}>
        View on GitHub
      </button>
    </div>

    <p class="welcome-hint">
      Free, AGPL-3.0. Every effect, layer type, and output is unlocked — no
      tiers, no watermarks, no signup. Pair your phone via the QR-code button
      in the toolbar.
    </p>
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
    font-size: 24px;
    font-weight: 700;
    color: var(--text-primary, #e0e0e0);
    margin: 0 0 6px 0;
  }

  .welcome-subtitle {
    font-size: 15px;
    color: var(--text-muted, #888);
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
    font-size: 16px;
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
    color: var(--text-primary, #e0e0e0);
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
    color: var(--text-primary, #ccc);
    border-color: #555;
  }

  .welcome-hint {
    font-size: 13px;
    color: #555;
    line-height: 1.6;
    margin: 0;
  }

  /* Activate mode */
  .activate-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary, #e0e0e0);
    margin: 0 0 6px 0;
  }

  .activate-desc {
    font-size: 15px;
    color: var(--text-muted, #888);
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
    color: var(--text-primary, #e0e0e0);
    font-family: 'Fira Code', monospace;
    font-size: 16px;
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
    font-size: 14px;
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
