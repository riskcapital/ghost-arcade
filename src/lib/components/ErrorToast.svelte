<script lang="ts">
  import { dismissToast } from '../stores/errorToast';

  export let id: number;
  export let message = '';
  export let type: 'error' | 'warning' | 'info' = 'error';
</script>

<div data-help-page="troubleshooting" class="toast toast-{type}">
  <div class="toast-content">
    <span class="toast-message">{message}</span>
  </div>
  <button class="toast-close" on:click={() => dismissToast(id)} aria-label="Dismiss"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
</div>

<style>
  .toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 320px;
    max-width: 560px;
    padding: 8px 8px 8px 12px;
    background: var(--ga-panel, #100f0d);
    color: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-left: 3px solid;
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    animation: slideUp 0.25s ease-out;
    pointer-events: auto;
    font-size: var(--ga-text-body);
    line-height: 1.4;
  }

  .toast-error {
    border-left-color: var(--ga-rec, #ff3b30);
  }

  .toast-warning {
    border-left-color: #f59e0b;
  }

  .toast-info {
    border-left-color: var(--ga-selection-line, #5278ff);
  }

  .toast-content {
    flex: 1;
    min-width: 0;
  }

  .toast-message {
    word-break: break-word;
  }

  .toast-close {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: var(--ga-control-h-sm);
    height: var(--ga-control-h-sm);
    padding: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .toast-close:hover {
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c);
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
