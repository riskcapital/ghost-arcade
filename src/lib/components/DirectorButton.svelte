<script lang="ts">
  import { directorStore, isDirectorStreaming } from '../stores/director';

  function toggle() {
    directorStore.toggleOpen();
  }
</script>

<button data-help-page="ai-generation"
  class="director-btn"
  class:streaming={$isDirectorStreaming}
  onclick={toggle}
  title="Director AI Agent (Ctrl+Shift+D)"
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
  </svg>
</button>

<style>
  .director-btn {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9990;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--ga-raise);
    border: 1px solid var(--ga-line-3);
    color: var(--ga-ink-0);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    transition: all 0.2s ease;
  }

  .director-btn:hover {
    border-color: var(--ga-selection-line);
    box-shadow: 0 6px 24px rgba(0,0,0,0.5);
  }

  .director-btn.streaming {
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 0 0 var(--ga-selection-line); }
    50% { box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 0 4px color-mix(in srgb, var(--ga-selection-line) 35%, transparent); }
  }
</style>
