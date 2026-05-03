<script lang="ts">
  import { toasts } from '../stores/errorToast';
  import ErrorToast from './ErrorToast.svelte';
</script>

{#if $toasts.length > 0}
  <div class="toast-container">
    {#each $toasts as toast (toast.id)}
      <ErrorToast id={toast.id} message={toast.message} type={toast.type} />
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    pointer-events: none;
  }
</style>
