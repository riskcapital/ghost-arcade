<script lang="ts">
  // A room scan a phone sent on its own (its Auto-map with depth): the
  // question whether to use it for Depth mode. One instance lives in
  // App.svelte; the offers and their states are in depthCaptureOffer.ts.
  import type { WaitingDepthOffer } from '../mobile/studio/depthCaptureOffer';

  export let offers: WaitingDepthOffer[] = [];
  export let onaccept: (phone: string) => void;
  export let ondecline: (phone: string) => void;
</script>

{#if offers.length}
  <div class="depth-inbox" data-depth-capture-inbox>
    {#each offers as { phone, offer, applying } (phone)}
      <div class="depth-card" role="alertdialog" aria-label="Room scan from a phone" data-depth-offer>
        <div class="depth-title">Room scan from <span class="device-name">{offer.source.device}</span>: {offer.surfaces === 1 ? '1 surface' : `${offer.surfaces} surfaces`}.</div>
        <div class="depth-meta">{offer.samples.toLocaleString()} points measured</div>
        <div class="depth-question">Use it for Depth mode?</div>
        <div class="depth-actions">
          <button class="depth-btn" disabled={applying} onclick={() => ondecline(phone)}>Not now</button>
          <button class="depth-btn primary primary-btn" disabled={applying} data-depth-accept onclick={() => onaccept(phone)}>{applying ? 'Applying…' : 'Use for Depth mode'}</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .depth-inbox {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 99001;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 300px;
    font-family: var(--ga-font-ui, 'Geist', system-ui, sans-serif);
    font-size: var(--ga-text-control);
    line-height: 1.4;
  }
  .depth-card {
    padding: 12px;
    background: var(--ga-card, #1c1c20);
    color: var(--ga-ink-0, #eee);
    border: 1px solid var(--ga-line-2, #3a3a42);
    border-radius: var(--ga-r-soft, 7px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  }
  .depth-title { font-size: var(--ga-text-body); font-weight: var(--ga-weight-title); overflow-wrap: anywhere; }
  .depth-meta { margin-top: 2px; font-size: var(--ga-text-meta); color: var(--ga-ink-2, #888); }
  .depth-question { margin-top: 8px; color: var(--ga-ink-1, #bbb); }
  .depth-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
  .depth-btn {
    height: var(--ga-control-h, 26px);
    padding: 0 12px;
    font: inherit;
    font-weight: var(--ga-weight-control);
    color: var(--ga-ink-1, #bbb);
    background: var(--ga-card, transparent);
    border: 1px solid var(--ga-line-2, #3a3a42);
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
  }
  .depth-btn:hover:not(:disabled) { color: var(--ga-ink-0, #eee); border-color: var(--ga-line-3, #4a4a52); }
  .depth-btn:disabled { opacity: 0.6; cursor: default; }
  .depth-btn.primary {
    background: var(--ga-violet, #9b87f5);
    border-color: transparent;
    border-radius: var(--ga-r-soft, 7px);
    color: var(--ga-blue-800, #0b0d11);
  }
  .depth-btn.primary:hover:not(:disabled) { filter: brightness(1.06); }
</style>
