<script lang="ts">
  import { directorStore, isDirectorStreaming } from '../stores/director';

  function toggle() {
    directorStore.toggleOpen();
  }
</script>

<button
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
    background: var(--accent-primary, #BB86FC);
    border: 2px solid rgba(255,255,255,0.15);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 20px rgba(187,134,252,0.2);
    transition: all 0.2s ease;
  }

  .director-btn:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 24px rgba(0,0,0,0.5), 0 0 30px rgba(187,134,252,0.35);
  }

  .director-btn.streaming {
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 20px rgba(187,134,252,0.2); }
    50% { box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 40px rgba(187,134,252,0.5); }
  }
</style>
