<script lang="ts">
  // Scans arriving from a paired phone: the accept prompt, progress, and the
  // "Add as Point Cloud layer" notice. One instance lives in App.svelte.
  import {
    phoneScanOffers, phoneScanTransfers, phoneScanArrived,
    answerPhoneScanOffer, cancelPhoneScanTransfer, addPhoneScanAsLayer,
    phoneScanAutoAccept, setPhoneScanAutoAccept,
  } from '../stores/phoneScans';
  import { showToast } from '../stores/errorToast';

  let always = phoneScanAutoAccept();

  function megabytes(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  function answer(requestId: string, accept: boolean) {
    if (accept) setPhoneScanAutoAccept(always);
    answerPhoneScanOffer(requestId, accept);
  }
  function addLayer() {
    const scan = $phoneScanArrived;
    if (!scan) return;
    if (addPhoneScanAsLayer(scan)) phoneScanArrived.set(null);
    else showToast('Could not add a Point Cloud layer for this scan.');
  }
</script>

{#if $phoneScanOffers.length || $phoneScanTransfers.length || $phoneScanArrived}
  <div class="scan-inbox" data-phone-scan-inbox>
    {#each $phoneScanOffers as offer (offer.requestId)}
      <div class="scan-card" role="alertdialog" aria-label="Scan from phone" data-scan-offer>
        <div class="scan-title">A phone wants to send a scan</div>
        <div class="scan-name">{offer.name}</div>
        <div class="scan-meta">{megabytes(offer.bytes)} · {offer.points.toLocaleString()} points</div>
        <label class="scan-always"><input type="checkbox" bind:checked={always} /> Always accept scans from paired phones</label>
        <div class="scan-actions">
          <button class="scan-btn" onclick={() => answer(offer.requestId, false)}>Decline</button>
          <button class="scan-btn primary" data-scan-accept onclick={() => answer(offer.requestId, true)}>Accept</button>
        </div>
      </div>
    {/each}
    {#each $phoneScanTransfers as transfer (transfer.requestId)}
      <div class="scan-card" data-scan-progress>
        <div class="scan-title">Receiving scan</div>
        <div class="scan-name">{transfer.name}</div>
        <progress max={transfer.bytes} value={transfer.received}></progress>
        <div class="scan-meta">{megabytes(transfer.received)} of {megabytes(transfer.bytes)}</div>
        <div class="scan-actions">
          <button class="scan-btn" onclick={() => cancelPhoneScanTransfer(transfer.requestId)}>Cancel</button>
        </div>
      </div>
    {/each}
    {#if $phoneScanArrived}
      <div class="scan-card" role="status" data-scan-arrived>
        <div class="scan-title">Scan received</div>
        <div class="scan-name">{$phoneScanArrived.name}</div>
        <div class="scan-meta">Saved in the Media Library, Scan tab.</div>
        <div class="scan-actions">
          <button class="scan-btn" onclick={() => phoneScanArrived.set(null)}>Close</button>
          <button class="scan-btn primary" data-scan-add-layer onclick={addLayer}>Add as Point Cloud layer</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .scan-inbox {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 99000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 300px;
    font-family: var(--ga-font-ui, 'Geist', system-ui, sans-serif);
    font-size: 12px;
    line-height: 1.4;
  }
  .scan-card {
    padding: 12px;
    background: var(--ga-inspector-bg, #1c1c20);
    color: var(--ga-ink-0, #eee);
    border: 1px solid var(--ga-line-3, #3a3a42);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  }
  .scan-title { font-size: 13px; font-weight: 600; }
  .scan-name { margin-top: 4px; overflow-wrap: anywhere; color: var(--ga-ink-0, #eee); }
  .scan-meta { margin-top: 2px; color: var(--ga-ink-2, #888); }
  .scan-always { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--ga-ink-1, #bbb); }
  .scan-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
  .scan-btn {
    padding: 5px 12px;
    font: inherit;
    color: var(--ga-ink-0, #eee);
    background: transparent;
    border: 1px solid var(--ga-line-3, #3a3a42);
    border-radius: 4px;
    cursor: pointer;
  }
  .scan-btn:hover { background: rgba(255, 255, 255, 0.06); }
  .scan-btn.primary { background: var(--ga-selection-bg, #38271c); border-color: var(--ga-selection-line, #b5683a); font-weight: 600; }
  progress { width: 100%; height: 6px; margin-top: 8px; accent-color: var(--ga-selection-line, #b5683a); }
</style>
