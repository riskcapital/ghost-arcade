<script lang="ts">
  /**
   * The ask for a locked add-on, opened from its dock button, its card or a
   * layer made with it: Try free for 3 days, Buy, or enter a licence key.
   * The trial starts on ghostarcade.live (it needs an account); the key the
   * website shows then comes back here. Buy opens the add-on's checkout and
   * then waits: Check again when a key is already here (the purchase joins
   * the licence), else the key from the email or the account page.
   */
  import {
    ADDON_PRODUCTS, ADDON_TRIAL_DAYS, addonOffer, addonsStatus, buyAddon, refreshAddonLicence, startAddonTrial,
    type AddonActionResult,
  } from '../../addons/addonAccess';
  import AddonStateText from './AddonStateText.svelte';
  import AddonErrorText from './AddonErrorText.svelte';
  import LicenceKeyForm from './LicenceKeyForm.svelte';
  import AudioLabIcon from '../AudioLabIcon.svelte';
  import PluginIcon from '../PluginIcon.svelte';

  const offer = $derived($addonOffer);
  const info = $derived(offer ? ADDON_PRODUCTS[offer.product] : null);
  const entry = $derived(offer ? $addonsStatus.products[offer.product] : null);
  const hasKey = $derived(!!$addonsStatus.licence?.key);
  const trialEnded = $derived(entry?.state.kind === 'expired' && entry.state.why === 'trial-ended');
  let showKey = $state(false);
  let checking = $state(false);
  let checkFailure = $state<Extract<AddonActionResult, { ok: false }> | null>(null);

  $effect(() => {
    if (!offer) {
      showKey = false;
      checkFailure = null;
    }
  });

  function close() {
    addonOffer.set(null);
  }

  async function checkAgain() {
    checking = true;
    checkFailure = null;
    try {
      const result = await refreshAddonLicence();
      if (!result.ok) checkFailure = result;
    } finally {
      checking = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (offer && e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if offer && info && entry}
  <div class="backdrop" onclick={close} role="presentation">
    <div class="offer" role="dialog" aria-modal="true" aria-label={info.name} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} data-addon-offer={offer.product}>
      <header>
        <span class="mark">
          {#if offer.product === 'addon.audio-lab'}<AudioLabIcon size={22} />{:else}<PluginIcon pluginId="analog-synth" size={22} />{/if}
        </span>
        <div class="title">
          <h2 translate="no">{info.name}</h2>
          <AddonStateText {entry} />
        </div>
        <button class="close" onclick={close} aria-label="Close">×</button>
      </header>

      {#if entry.usable}
        <p class="lead">{info.name} is ready on this computer.</p>
        <div class="actions"><button class="primary" onclick={close} data-addon-done>Done</button></div>
      {:else if offer.step === 'trial'}
        <ol class="steps">
          <li>On ghostarcade.live, sign in and press Try free for {ADDON_TRIAL_DAYS} days under {info.name}.</li>
          {#if hasKey}
            <li>Then check again here: the trial joins your licence on this computer.</li>
          {:else}
            <li>Paste the licence key from your account page here:</li>
          {/if}
        </ol>
        {#if hasKey}
          <div class="actions">
            <button class="primary" onclick={checkAgain} disabled={checking} data-addon-check>{checking ? 'Checking…' : 'Check again'}</button>
            <button onclick={() => startAddonTrial(offer.product)}>Open the website again</button>
          </div>
          {#if checkFailure}<p class="error" role="alert"><AddonErrorText code={checkFailure.code} /></p>{/if}
        {:else}
          <LicenceKeyForm autofocus />
          <div class="actions quiet"><button onclick={() => startAddonTrial(offer.product)}>Open the website again</button></div>
        {/if}
      {:else if offer.step === 'buy'}
        {#if hasKey}
          <p class="lead">Finished checking out? Press Check again to unlock on this computer.</p>
          <div class="actions">
            <button class="primary" onclick={checkAgain} disabled={checking} data-addon-check>{checking ? 'Checking…' : 'Check again'}</button>
            <button onclick={() => buyAddon(offer.product)} data-addon-checkout-again>Open checkout again</button>
          </div>
          {#if checkFailure}<p class="error" role="alert"><AddonErrorText code={checkFailure.code} /></p>{/if}
        {:else}
          <p class="lead">Paste the licence key from your email or account page here:</p>
          <LicenceKeyForm autofocus />
          <div class="actions quiet"><button onclick={() => buyAddon(offer.product)} data-addon-checkout-again>Open checkout again</button></div>
        {/if}
      {:else}
        <p class="lead">
          {#if trialEnded}Your free trial has ended. Buy {info.name} to keep using it; projects made with it open as they were.
          {:else}A paid add-on, one payment of ${info.price}, yours to keep. Try it free for {ADDON_TRIAL_DAYS} days first: you'll need a free Ghost Arcade account.
          {/if}
        </p>
        <div class="actions">
          {#if !trialEnded}<button class="primary" onclick={() => startAddonTrial(offer.product)} data-addon-try>Try free for {ADDON_TRIAL_DAYS} days</button>{/if}
          <button class={trialEnded ? 'primary' : ''} onclick={() => buyAddon(offer.product)} data-addon-buy>Buy (${info.price})</button>
        </div>
        <p class="note">A licence works on 2 computers.</p>
        {#if showKey}
          <LicenceKeyForm autofocus />
        {:else}
          <button class="link" onclick={() => (showKey = true)} data-addon-have-key>I have a licence key</button>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: color-mix(in srgb, var(--ga-void, #0a0908) 70%, transparent);
    backdrop-filter: blur(6px);
  }
  .offer {
    width: min(420px, 92vw);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--ga-faceplate-bg, var(--ga-panel, #100f0d));
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: inset 0 1px 0 var(--ga-metal-hi, rgba(255, 255, 255, 0.08)), 0 24px 80px rgba(0, 0, 0, 0.58);
    color: var(--ga-ink-1, #ada9a2);
    font-size: var(--ga-text-control, 12px);
    line-height: 1.5;
  }
  header { display: flex; align-items: center; gap: 10px; }
  .mark { color: var(--ga-icon, #5278ff); display: inline-flex; }
  .title { flex: 1; display: flex; flex-direction: column; gap: 1px; font-size: var(--ga-text-meta, 11px); }
  h2 { margin: 0; font-size: var(--ga-text-heading, 15px); font-weight: var(--ga-weight-title, 600); color: var(--ga-ink-0, #eee); }
  .close { width: 26px; padding: 0; font-size: 16px; line-height: 1; }
  .lead { margin: 0; color: var(--ga-ink-0, #ddd); }
  .steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--ga-ink-0, #ddd); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .actions.quiet { justify-content: flex-end; }
  .note { margin: 0; color: var(--ga-ink-2, #888); font-size: var(--ga-text-meta, 11px); }
  .error { margin: 0; color: #ff8a80; }
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
  button:disabled { opacity: 0.45; cursor: default; }
  button.link { align-self: flex-start; height: auto; padding: 0; border: none; background: none; color: var(--ga-ink-2, #999); text-decoration: underline; font-weight: 500; }
</style>
