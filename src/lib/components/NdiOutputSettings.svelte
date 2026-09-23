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

<div class="ndi-output" data-help-page="outputs">
  <div class="status-row">
    <strong>{checking ? 'Checking NDI output…' : status.active ? 'NDI output enabled' : status.available ? 'NDI output ready' : 'NDI output unavailable'}</strong>
    <button onclick={refresh} disabled={checking}>Refresh</button>
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
  .ndi-output { color: var(--ga-ink-1, #bdc6d4); font-size: 13px; line-height: 1.6; }
  .status-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px; border: 1px solid #304366; border-radius: 9px; background: #142039; }
  button { border: 1px solid #3c5073; border-radius: 6px; background: #1e304f; color: #e2ebfa; padding: 6px 12px; cursor: pointer; }
  button:disabled { opacity: .5; }
  h4 { margin-bottom: 6px; color: var(--ga-ink-0, #eef0f4); }
  ol { padding-left: 20px; }
  li { margin: 5px 0; }
  .notice { color: #e5ba82; }
</style>
