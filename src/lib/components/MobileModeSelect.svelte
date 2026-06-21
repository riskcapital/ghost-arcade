<script lang="ts">
  export let onSelect: (mode: 'standalone' | 'remote') => void;
</script>

<div class="mode-select">
  <img src="{import.meta.env.BASE_URL}logo.png" alt="Ghost Arcade" class="logo" />
  <h1>Ghost Arcade</h1>
  <p class="tagline">Projection mapping & VJ — right on your phone</p>

  <button class="mode-card primary" onclick={() => onSelect('standalone')}>
    <div class="mode-title">Standalone</div>
    <div class="mode-desc">VJ + projection mapping from this device alone. Plug into a projector with USB-C → HDMI.</div>
  </button>

  <button class="mode-card" onclick={() => onSelect('remote')}>
    <div class="mode-title">Remote to Desktop</div>
    <div class="mode-desc">Control a desktop Ghost Arcade running on your computer over WiFi.</div>
  </button>

  <p class="footnote">You can switch modes any time from settings.</p>
</div>

<style>
  .mode-select {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 24px env(safe-area-inset-bottom, 24px);
    background: var(--bg-primary, #0a0a0c);
    color: #fff;
    overflow-y: auto;
    -webkit-tap-highlight-color: transparent;
  }
  .logo {
    width: 120px;
    height: auto;
    margin-bottom: 12px;
  }
  h1 {
    font-size: 29px;
    font-weight: 600;
    margin: 0 0 4px 0;
    letter-spacing: -0.5px;
  }
  .tagline {
    font-size: 15px;
    color: var(--text-muted, #888);
    margin: 0 0 36px 0;
    text-align: center;
  }
  .mode-card {
    width: 100%;
    max-width: 360px;
    text-align: left;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    border-radius: 14px;
    padding: 20px 22px;
    margin-bottom: 14px;
    color: #fff;
    cursor: pointer;
    transition: transform 0.08s ease-out, background 0.15s ease-out;
  }
  .mode-card:active {
    transform: scale(0.98);
    background: #1c1c24;
  }
  .mode-card.primary {
    border-color: #BB86FC;
    background: linear-gradient(135deg, rgba(187, 134, 252, 0.12), rgba(105, 240, 174, 0.06));
  }
  .mode-title {
    font-size: 19px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .mode-desc {
    font-size: 14px;
    color: var(--text-secondary, #aaa);
    line-height: 1.45;
  }
  .footnote {
    font-size: 12px;
    color: #555;
    margin-top: 16px;
    text-align: center;
  }
</style>
