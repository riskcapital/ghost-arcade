<script lang="ts">
  import { loadingDetail, loadingMessage, loadingProgress } from '../stores/loading';
  import { fade } from 'svelte/transition';
</script>

{#if $loadingMessage}
  <div class="loading-overlay" transition:fade={{ duration: 150 }}>
    <div class="loading-content">
      <div class="spinner"></div>
      <div class="loading-text">{$loadingMessage}</div>
      {#if $loadingDetail}
        <div class="loading-detail">{$loadingDetail}</div>
      {/if}
      {#if $loadingProgress !== null}
        <div class="progress-track" aria-label="Loading progress">
          <div class="progress-fill" style="width: {Math.max(0, Math.min(100, $loadingProgress * 100))}%"></div>
        </div>
        <div class="progress-value">{Math.round(Math.max(0, Math.min(1, $loadingProgress)) * 100)}%</div>
      {/if}
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
    border-top: 3px solid #bb86fc;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-text {
    color: var(--text-primary, #ccc);
    font-size: 14px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    letter-spacing: 0.05em;
  }

  .loading-detail,
  .progress-value {
    color: var(--text-secondary, #8b93a1);
    font-size: 12px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  .progress-track {
    width: min(320px, 70vw);
    height: 4px;
    overflow: hidden;
    background: #232833;
  }

  .progress-fill {
    height: 100%;
    background: #67e8f9;
    transition: width 90ms linear;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
