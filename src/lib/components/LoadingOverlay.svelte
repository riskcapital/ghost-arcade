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
    inset: 0;
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    pointer-events: all;
    backdrop-filter: blur(8px);
  }

  .loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid color-mix(in srgb, var(--ga-selection-line, #5278ff) 20%, transparent);
    border-top: 3px solid var(--ga-selection-line, #5278ff);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-text {
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
  }

  .loading-detail,
  .progress-value {
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-meta);
  }

  .progress-value {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  .progress-track {
    width: min(320px, 70vw);
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--ga-slot, #060504);
  }

  .progress-fill {
    height: 100%;
    background: var(--ga-selection-line, #5278ff);
    transition: width 90ms linear;
  }

  .background-btn {
    box-sizing: border-box;
    height: var(--ga-control-h);
    margin-top: 4px;
    padding: 0 12px;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    background: var(--ga-raise, #26221c);
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .background-btn:hover {
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
    color: var(--ga-ink-0, #f2ede4);
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
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-panel, #100f0d);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }
  .chip-spinner {
    flex: none;
    width: 14px;
    height: 14px;
    border: 2px solid color-mix(in srgb, var(--ga-selection-line, #5278ff) 20%, transparent);
    border-top: 2px solid var(--ga-selection-line, #5278ff);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .chip-text {
    min-width: 0;
  }
  .chip-message {
    color: var(--ga-ink-0, #f2ede4);
    font-weight: var(--ga-weight-control);
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
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
