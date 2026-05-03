<script lang="ts">
  import { loadingMessage } from '../stores/loading';
  import { fade } from 'svelte/transition';
</script>

{#if $loadingMessage}
  <div class="loading-overlay" transition:fade={{ duration: 150 }}>
    <div class="loading-content">
      <div class="spinner"></div>
      <div class="loading-text">{$loadingMessage}</div>
    </div>
  </div>
{/if}

<style>
  .loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    pointer-events: all;
    backdrop-filter: blur(2px);
  }

  .loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(187, 134, 252, 0.2);
    border-top: 3px solid #BB86FC;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-text {
    color: #ccc;
    font-size: 13px;
    font-family: monospace;
    letter-spacing: 0.05em;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
