<script lang="ts">
  import { onMount } from 'svelte';
  type OutputStatus = { available?: boolean; active?: boolean; name?: string; fps?: number; reason?: string; lastError?: string };
  let status: OutputStatus = {};
  let checking = true;
  let alive = true;
  async function refresh() {
    checking = true;
    try {
      const bridge = (window as any).ghostNDI;
      const result = bridge?.outputStatus
        ? await bridge.outputStatus()
        : { available: false, reason: 'NDI output requires the desktop app with the optional NDI runtime.' };
      if (alive) status = result ?? { available: false, reason: 'NDI output status is unavailable.' };
    } catch (error) {
      if (alive) status = { available: false, reason: error instanceof Error ? error.message : String(error) };
    } finally { if (alive) checking = false; }
  }
  onMount(() => { void refresh(); return () => { alive = false; }; });
</script>

<div class="ndi-output" data-help-page="syphon-spout-ndi">
  <div class="status-row">
    <strong>{checking ? 'Checking NDI output…' : status.active ? 'NDI output enabled' : status.available ? 'NDI output ready' : 'NDI output unavailable'}</strong>
    <button class="secondary-btn" onclick={refresh} disabled={checking}>Refresh</button>
  </div>
  {#if status.active}<p>Sender: <strong>{status.name}</strong>{status.fps ? ` · up to ${status.fps} fps` : ''}</p>{/if}
  {#if !checking && status.reason}<p class="notice">{status.reason}</p>{/if}
  {#if status.lastError}<p class="notice">{status.lastError}</p>{/if}
  <h4>Set up a sender</h4>
  <ol>
    <li>Open the <strong>Screens</strong> tab next to Layers in Mapping.</li>
    <li>Add or select a screen and set <strong>Send to → sender</strong>.</li>
    <li>Choose <strong>Transport → NDI</strong> and set the sender name.</li>
    <li>Select that sender in the receiving app on your local network.</li>
  </ol>
  <p>NDI currently sends one full composition. Screen crops and individual screen warps are not sent separately. Select the local transport again to stop NDI.</p>
  <p>NDI output requires the optional NDI runtime and native addon on Windows or macOS. Check availability above. NDI input availability is separate from output support.</p>
</div>

<style>
  .ndi-output { color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-meta); line-height: 1.55; }
  .ndi-output p { margin: 8px 0; }
  .ndi-output strong { color: var(--ga-ink-0, #f2ede4); font-weight: var(--ga-weight-control); }
  .status-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 8px 8px 12px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card, #16140f); font-size: var(--ga-text-body); }
  .secondary-btn {
    height: var(--ga-control-h);
    padding: 0 12px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-raise, #26221c);
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .secondary-btn:hover:not(:disabled) { color: var(--ga-ink-0, #f2ede4); border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .secondary-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  /* Sub-heading: the eyebrow, like the section heading above it. */
  h4 {
    margin: 20px 0 4px;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }
  ol { margin: 0; padding-left: 18px; }
  li { margin: 4px 0; }
  .notice { color: #e5ba82; }
</style>
