<script lang="ts">
  /**
   * A locked add-on where it would be used (its card, a layer made with it):
   * a lock, Try free for 3 days and Buy. A trial that ended offers Buy only;
   * one that needs a check-in offers Check now.
   */
  import {
    ADDON_PRODUCTS, ADDON_TRIAL_DAYS, addonsStatus, buyAddon, openAddonsSettings, refreshAddonLicence, startAddonTrial,
    type AddonProductId,
  } from '../../addons/addonAccess';

  let { product, compact = false }: { product: AddonProductId; compact?: boolean } = $props();

  const info = $derived(ADDON_PRODUCTS[product]);
  const current = $derived($addonsStatus.products[product].state);
  const trialEnded = $derived(current.kind === 'expired' && current.why === 'trial-ended');
  const needsCheckIn = $derived(current.kind === 'expired' && current.why === 'offline');
  let checking = $state(false);

  async function checkNow() {
    checking = true;
    try {
      const result = await refreshAddonLicence();
      if (!result.ok) openAddonsSettings();
    } finally {
      checking = false;
    }
  }
</script>

<div class="addon-lock" class:compact data-addon-lock={product}>
  <span class="lock-line">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
    {#if trialEnded}Trial ended{:else if needsCheckIn}Needs a check-in{:else}Paid add-on{/if}
  </span>
  <div class="lock-actions">
    {#if needsCheckIn}
      <button type="button" class="primary" onclick={(e) => { e.stopPropagation(); void checkNow(); }} disabled={checking} data-addon-check>Check now</button>
    {:else if !trialEnded}
      <button type="button" class="primary" onclick={(e) => { e.stopPropagation(); startAddonTrial(product); }} data-addon-try>Try free for {ADDON_TRIAL_DAYS} days</button>
    {/if}
    <button type="button" onclick={(e) => { e.stopPropagation(); buyAddon(product); }} data-addon-buy>Buy (${info.price})</button>
  </div>
</div>

<style>
  .addon-lock { display: flex; flex-direction: column; gap: 6px; }
  .lock-line { display: inline-flex; align-items: center; gap: 5px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); }
  .lock-line svg { color: var(--ga-icon, #5278ff); flex: none; }
  .lock-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  button {
    height: var(--ga-control-h-sm, 22px);
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 8px;
    border-radius: var(--ga-r-hard, 4px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: rgba(255, 255, 255, 0.04);
    color: var(--ga-ink-0, #ddd);
    cursor: pointer;
    white-space: nowrap;
  }
  button.primary { border-color: var(--ga-selection-line, #5278ff); background: color-mix(in srgb, var(--ga-selection-line, #5278ff) 22%, transparent); }
  button:hover:not(:disabled) { filter: brightness(1.15); }
  button:disabled { opacity: 0.45; cursor: default; }
  .compact .lock-line { display: none; }
</style>
