<script lang="ts">
  /**
   * Settings → App → Add-ons: what is unlocked on this computer, the licence
   * key, this computer's seat. Machine-level, never saved with a project.
   */
  import { onMount } from 'svelte';
  import {
    ADDON_PRODUCT_IDS, ADDON_PRODUCTS, ADDON_TRIAL_DAYS, addonsStatus, buyAddon, checkAddons, deactivateAddonLicence,
    extendAddonLicence, manageAddonsOnline, refreshAddonLicence, startAddonTrial,
    type AddonActionResult,
  } from '../../addons/addonAccess';
  import AddonStateText from './AddonStateText.svelte';
  import AddonErrorText from './AddonErrorText.svelte';
  import LicenceKeyForm from './LicenceKeyForm.svelte';

  const desktop = typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI;
  const status = $derived($addonsStatus);
  const licence = $derived(status.licence);
  let busy = $state(false);
  let changeKey = $state(false);
  let confirmDeactivate = $state(false);
  let failure = $state<Extract<AddonActionResult, { ok: false }> | null>(null);
  let notice = $state<'checked' | 'deactivated' | 'extended' | null>(null);

  onMount(() => { if (desktop) void checkAddons(); });

  async function run(action: () => Promise<AddonActionResult>, done: 'checked' | 'deactivated' | 'extended') {
    busy = true;
    failure = null;
    notice = null;
    try {
      const result = await action();
      if (result.ok) notice = done;
      else failure = result;
    } finally {
      busy = false;
      confirmDeactivate = false;
    }
  }

  function day(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

<div class="addons-settings" data-addons-settings>
  {#if !desktop}
    <p class="sc-hint">Add-ons need the desktop app.</p>
  {:else}
    {#if status.server}
      <p class="dev-server" translate="no">Development licence server: {status.server}</p>
    {/if}

    {#each ADDON_PRODUCT_IDS as id (id)}
      {@const entry = status.products[id]}
      {@const info = ADDON_PRODUCTS[id]}
      <div class="sc-row" data-addon-row={id}>
        <div class="sc-label">
          <span class="sc-title" translate="no">{info.name}</span>
          <span class="sc-hint"><AddonStateText {entry} /></span>
        </div>
        {#if entry.state.kind === 'locked' || entry.state.kind === 'trial' || (entry.state.kind === 'expired' && entry.state.why === 'trial-ended')}
          <div class="row-buttons">
            {#if entry.state.kind === 'locked'}<button onclick={() => startAddonTrial(id)} data-addon-try>Try free for {ADDON_TRIAL_DAYS} days</button>{/if}
            <button class="primary" onclick={() => buyAddon(id)} data-addon-buy>Buy (${info.price})</button>
          </div>
        {/if}
      </div>
    {/each}

    {#if status.offlineDaysLeft !== null || licence?.emergency.available || licence?.emergency.until}
      <div class="warn" role="status" data-addons-offline>
        {#if licence?.emergency.until}
          Emergency extension in use until {day(licence.emergency.until)}. Connect to the internet and press Check now before then.
        {:else}
          This computer hasn't checked its licence with ghostarcade.live for a while. Connect to the internet and press Check now; without a check-in the add-ons lock once 30 days have passed.
        {/if}
        {#if licence?.emergency.available}
          <button onclick={() => run(extendAddonLicence, 'extended')} disabled={busy} data-addons-extend title="Once per licence, for a computer that can't go online">Add 14 days (once)</button>
        {/if}
      </div>
    {/if}

    <div class="sc-sub">Licence</div>
    {#if status.problem === 'other-computer'}
      <p class="warn">The licence saved here was activated on a different computer. Activate your key again to use it on this one.</p>
    {:else if status.problem}
      <p class="warn">The licence saved here couldn't be checked. Activate your key again.</p>
    {/if}
    {#if licence?.key && !changeKey}
      <div class="sc-row">
        <div class="sc-label">
          <span class="sc-title key" translate="no">{licence.key}</span>
          <span class="sc-hint">
            {#if licence.email}<span translate="no">{licence.email}</span>&nbsp;·&nbsp;{/if}{#if licence.checkedAt}Last checked {day(licence.checkedAt)}{:else}Not activated on this computer{/if}
          </span>
        </div>
        <div class="row-buttons">
          <button onclick={() => run(refreshAddonLicence, 'checked')} disabled={busy} data-addons-check>{busy ? 'Checking…' : 'Check now'}</button>
          <button onclick={() => (changeKey = true)} disabled={busy}>Use another key</button>
        </div>
      </div>
    {:else}
      <div class="sc-row column">
        <div class="sc-label">
          <span class="sc-title">Licence key</span>
          <span class="sc-hint">From the email after your purchase, or your account page at ghostarcade.live. A free trial gives you a key there too.</span>
        </div>
        <LicenceKeyForm onactivated={() => { changeKey = false; notice = null; }} />
        {#if changeKey}<button class="link" onclick={() => (changeKey = false)}>Keep the current key</button>{/if}
      </div>
    {/if}

    <div class="sc-sub">This computer</div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title" translate="no">{status.machine.name || 'This computer'}</span>
        <span class="sc-hint">A licence works on 2 computers. Deactivate this one to move the licence to another; the add-ons keep working here until you quit.</span>
      </div>
      <div class="row-buttons">
        {#if licence?.key}
          {#if confirmDeactivate}
            <button class="danger" onclick={() => run(deactivateAddonLicence, 'deactivated')} disabled={busy} data-addons-deactivate-confirm>Deactivate</button>
            <button onclick={() => (confirmDeactivate = false)} disabled={busy}>Cancel</button>
          {:else}
            <button onclick={() => (confirmDeactivate = true)} disabled={busy} data-addons-deactivate>Deactivate…</button>
          {/if}
        {/if}
        <button onclick={manageAddonsOnline}>Manage on ghostarcade.live</button>
      </div>
    </div>

    {#if failure}<p class="error" role="alert"><AddonErrorText code={failure.code} maxMachines={failure.maxMachines} /></p>{/if}
    {#if notice === 'checked'}<p class="ok" role="status">Checked with ghostarcade.live just now.</p>{/if}
    {#if notice === 'deactivated'}<p class="ok" role="status">This computer is deactivated. Its seat is free for another computer.</p>{/if}
    {#if notice === 'extended'}<p class="ok" role="status">14 more days added. Check in online before they run out.</p>{/if}
  {/if}
</div>

<style>
  .addons-settings { display: flex; flex-direction: column; gap: 4px; }
  .addons-settings :global(.sc-row) { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); }
  .addons-settings :global(.sc-row.column) { flex-direction: column; align-items: stretch; }
  .addons-settings :global(.sc-label) { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .addons-settings :global(.sc-title) { font-size: var(--ga-text-body, 13px); font-weight: var(--ga-weight-body, 500); color: var(--ga-ink-0, #eee); }
  .addons-settings :global(.sc-hint) { font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--ga-ink-2, #777); }
  .addons-settings :global(.sc-sub) { margin: 16px 0 4px; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); color: var(--ga-ink-2, #9a9aa6); }
  .key { font-family: var(--ga-font-mono, ui-monospace, monospace); letter-spacing: 0.04em; }
  .row-buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
  .warn {
    margin: 8px 0 0;
    padding: 8px 10px;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid rgba(240, 198, 116, 0.4);
    background: rgba(240, 198, 116, 0.08);
    color: #f0c674;
    font-size: var(--ga-text-control, 12px);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .dev-server { margin: 0 0 4px; font-size: var(--ga-text-meta, 11px); color: #f0c674; font-family: var(--ga-font-mono, ui-monospace, monospace); }
  .error { margin: 6px 0 0; color: #ff8a80; font-size: var(--ga-text-control, 12px); }
  .ok { margin: 6px 0 0; color: var(--ga-ink-1, #bbb); font-size: var(--ga-text-control, 12px); }
  button {
    height: var(--ga-control-h, 26px);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 4px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: rgba(255, 255, 255, 0.04);
    color: var(--ga-ink-0, #ddd);
    cursor: pointer;
    white-space: nowrap;
  }
  button.primary { border-color: var(--ga-selection-line, #5278ff); background: color-mix(in srgb, var(--ga-selection-line, #5278ff) 22%, transparent); }
  button.danger { border-color: rgba(255, 138, 128, 0.6); color: #ff8a80; }
  button:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  button:disabled { opacity: 0.45; cursor: default; }
  button.link { align-self: flex-start; height: auto; padding: 4px 0 0; border: none; background: none; color: var(--ga-ink-2, #999); text-decoration: underline; font-weight: 500; }
</style>
