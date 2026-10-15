<script lang="ts">
  // Welcome screen — first launch only. Offers the guided tour and the
  // starter templates but never starts either by itself: people who already
  // know VJ software go straight to a blank or saved project.

  export let onClose: () => void = () => {};
  export let onTour: () => void = () => {};
  export let onTemplates: () => void = () => {};
  export let onOpenProject: () => void = () => {};

  function choose(next: () => void) {
    localStorage.setItem('ghostarcade-welcome-seen', 'true');
    onClose();
    next();
  }
</script>

<div data-help-page="getting-started" class="welcome-overlay">
  <div class="welcome-panel">
    <div class="welcome-logo">
      <img src="{import.meta.env.BASE_URL}icon-new.png" alt="Ghost Arcade" class="logo-img" />
    </div>
    <h1 class="welcome-title">Welcome to Ghost Arcade</h1>
    <p class="welcome-subtitle">How would you like to start?</p>

    <div class="welcome-choices">
      <button class="welcome-choice primary" onclick={() => choose(onTour)}>
        <span class="choice-title">Show me around</span>
        <span class="choice-detail">A two-minute hands-on tour of playing visuals</span>
      </button>
      <button class="welcome-choice" onclick={() => choose(onTemplates)}>
        <span class="choice-title">Start from a template</span>
        <span class="choice-detail">A deck already set up for a band, a club night, a light show or mapping</span>
      </button>
      <button class="welcome-choice" onclick={() => choose(onOpenProject)}>
        <span class="choice-title">Open a project</span>
        <span class="choice-detail">Carry on with a saved show</span>
      </button>
      <button class="welcome-choice" onclick={() => choose(() => {})}>
        <span class="choice-title">Blank project</span>
        <span class="choice-detail">Straight in, nothing set up</span>
      </button>
    </div>

    <p class="welcome-hint">
      The tour and templates are always under the ? button.
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
    background: linear-gradient(135deg, var(--ga-blue-mute-800) 0%, var(--ga-blue-800) 100%);
    border: 1px solid #333;
    border-radius: 16px;
    padding: 40px 36px 32px;
    width: 420px;
    text-align: center;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  }

  .welcome-choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 20px 0 16px;
  }
  .welcome-choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 11px 14px;
    text-align: left;
    font: inherit;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-primary, #e0e0e0);
    cursor: pointer;
  }
  .welcome-choice:hover { border-color: rgba(255, 255, 255, 0.35); }
  .welcome-choice.primary {
    background: var(--ga-blue-200, #9ec5ff);
    border-color: var(--ga-blue-200, #9ec5ff);
    color: #0b1220;
  }
  .choice-title { font-weight: 700; font-size: 14px; }
  .choice-detail { font-size: 12px; opacity: 0.8; }

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
    font-size: 23px;
    font-weight: 700;
    color: var(--text-primary, #e0e0e0);
    margin: 0 0 6px 0;
  }

  .welcome-subtitle {
    font-size: 14px;
    color: var(--text-muted, #888);
    margin: 0 0 28px 0;
  }

  .welcome-hint {
    font-size: 12px;
    color: #555;
    line-height: 1.6;
    margin: 0;
  }

  .key-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px 16px;
    color: var(--text-primary, #e0e0e0);
    font-family: 'Fira Code', monospace;
    font-size: 15px;
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
    font-size: 13px;
    margin: 8px 0 0 0;
  }
</style>
