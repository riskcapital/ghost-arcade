<script lang="ts">
  import { t } from '../i18n';
  import { dismissToast } from '../stores/errorToast';

  export let id: number;
  export let message = '';
  export let type: 'error' | 'warning' | 'info' = 'error';
</script>

<div class="toast toast-{type}">
  <div class="toast-content">
    <span class="toast-message">{message}</span>
  </div>
  <button class="toast-close" on:click={() => dismissToast(id)} aria-label={$t('systemUi.error.dismiss')}
    >&times;</button>
</div>

<style>
  .toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 320px;
    max-width: 560px;
    padding: 12px 16px;
    background: #1e1e22;
    color: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
    border-left: 4px solid;
    animation: slideUp 0.25s ease-out;
    pointer-events: auto;
    font-size: 14px;
    line-height: 1.4;
  }

  .toast-error {
    border-left-color: #ef4444;
  }

  .toast-warning {
    border-left-color: #f59e0b;
  }

  .toast-info {
    border-left-color: #3b82f6;
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
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-size: 19px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    transition: color 0.15s;
  }

  .toast-close:hover {
    color: #fff;
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
