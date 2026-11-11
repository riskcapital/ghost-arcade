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
    /* With the Show / Timeline tray open (ShowTimeline publishes the lift,
       0px when closed) a toast sat on the block inspector's Where and colour
       buttons for five seconds: it rises over the preview instead, clear of
       the viewport's zoom buttons. */
    bottom: calc(24px + var(--ga-tray-toast-lift, 0px));
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
