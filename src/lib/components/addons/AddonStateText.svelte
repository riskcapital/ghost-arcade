<script lang="ts">
  /** One add-on's state in words: Locked, Trial · 2 days left, Licensed… */
  import type { AddonAccessEntry } from '../../addons/addonAccess';

  let { entry }: { entry: AddonAccessEntry } = $props();
  const current = $derived(entry.state);
  // Usable in this run although the licence says otherwise: it keeps going until quit.
  const carriedOver = $derived(entry.usable && (current.kind === 'locked' || current.kind === 'expired'));
</script>

<span class="addon-state" data-addon-state={current.kind}>
  {#if current.kind === 'locked'}Locked
  {:else if current.kind === 'trial'}{#if current.daysLeft === 1}Trial · 1 day left{:else}Trial · {current.daysLeft} days left{/if}
  {:else if current.kind === 'licensed'}Licensed
  {:else if current.kind === 'offline-grace'}{#if current.daysLeft === 1}Licensed · check in within 1 day{:else}Licensed · check in within {current.daysLeft} days{/if}
  {:else if current.why === 'trial-ended'}Trial ended
  {:else}Not checked in for 30 days
  {/if}{#if carriedOver}<span class="carried"> · keeps working until you quit</span>{/if}
</span>

<style>
  .addon-state { color: var(--ga-ink-2, #888); }
  .addon-state[data-addon-state='licensed'], .addon-state[data-addon-state='trial'] { color: var(--ga-ink-0, #ddd); }
  .addon-state[data-addon-state='offline-grace'] { color: #f0c674; }
  .carried { color: var(--ga-ink-2, #888); }
</style>
