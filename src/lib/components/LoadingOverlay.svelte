<script lang="ts">
  import {
    backgroundLoad,
    continueLoadingInBackground,
    loadingCanBackground,
    loadingDetail,
    loadingMessage,
    loadingProgress,
  } from '../stores/loading';
  import { fade } from 'svelte/transition';

  const pct = (p: number | null | undefined) => Math.round(Math.max(0, Math.min(1, p ?? 0)) * 100);

  // Escape sends a file load to the background, the same as the button.
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !$loadingMessage || !$loadingCanBackground) return;
    e.preventDefault();
    e.stopPropagation();
    continueLoadingInBackground();
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

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
      {#if $loadingCanBackground}
        <button
          type="button"
          class="background-btn"
          onclick={continueLoadingInBackground}
          title="Close this and keep working. The layer appears when the file finishes loading."
        >Continue in background</button>
      {/if}
    </div>
  </div>
{/if}

{#if $backgroundLoad && !$loadingMessage}
  <div class="background-chip" role="status" transition:fade={{ duration: 150 }}>
    <div class="chip-spinner"></div>
    <div class="chip-text">
      <div class="chip-message">{$backgroundLoad.message}{#if $backgroundLoad.others} (+{$backgroundLoad.others} more){/if}</div>
      {#if $backgroundLoad.detail}
        <div class="chip-detail">{$backgroundLoad.detail}</div>
      {/if}
    </div>
    {#if $backgroundLoad.progress !== null}
      <div class="chip-value">{pct($backgroundLoad.progress)}%</div>
    {/if}
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
    background: var(--ga-blue-mute-800);
  }

  .progress-fill {
    height: 100%;
    background: var(--ga-blue-300);
    transition: width 90ms linear;
  }

  .background-btn {
    margin-top: 4px;
    padding: 7px 16px;
    border-radius: 5px;
    border: 1px solid #2a2a30;
    background: transparent;
    color: var(--text-secondary, #aaa);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .background-btn:hover {
    border-color: var(--ga-blue-300);
    color: var(--ga-blue-300);
  }

  /* Non-blocking: only the chip itself takes pointer events. */
  .background-chip {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 99998;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(360px, 80vw);
    padding: 8px 12px;
    border: 1px solid #2a2a30;
    border-radius: 6px;
    background: rgba(12, 13, 16, 0.92);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    color: var(--text-secondary, #8b93a1);
  }
  .chip-spinner {
    flex: none;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(187, 134, 252, 0.2);
    border-top: 2px solid #bb86fc;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .chip-text {
    min-width: 0;
  }
  .chip-message {
    color: var(--text-primary, #ccc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip-detail {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip-value {
    flex: none;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
