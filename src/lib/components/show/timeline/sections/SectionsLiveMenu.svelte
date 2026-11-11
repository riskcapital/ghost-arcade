<script lang="ts">
  /**
   * The Sections row's Live menu: sections from Live's arrangement locators
   * (once, or kept in sync), and the sections sent back to Live as locators.
   */
  import { abletonBridge, LIVE_PHRASE_PROTOCOL } from '../../../../ableton/abletonBridge';
  import { showToast } from '../../../../stores/errorToast';
  import { locatorMessage, sectionsFromLive, sendSectionsToLive } from '../../../../timeline/phrases/liveArrangementRuntime';

  let open = $state(false);
  let btn: HTMLButtonElement | undefined = $state();
  let pos = $state({ x: 0, y: 0 });
  let busy = $state(false);
  const bridge = $derived($abletonBridge);
  const scriptOld = $derived(bridge.connected && bridge.protocol > 0 && bridge.protocol < LIVE_PHRASE_PROTOCOL);

  function toggle() {
    if (!open && btn) {
      const r = btn.getBoundingClientRect();
      pos = { x: r.left, y: r.bottom + 4 };
    }
    open = !open;
  }
  function fromLive() {
    const r = sectionsFromLive();
    if (r.ok) showToast(`${r.count} section${r.count === 1 ? '' : 's'} from Live's locators (Cmd+Z takes them back).`, 'info');
    else showToast(locatorMessage(r.reason), 'info');
    open = false;
  }
  async function toLive() {
    busy = true;
    try {
      const r = await sendSectionsToLive();
      if (r.ok) showToast(`Sent ${r.count} section${r.count === 1 ? '' : 's'} to Live as locators (${r.added ?? 0} added, ${r.moved ?? 0} moved).`, 'info');
      else showToast(locatorMessage(r.reason), 'info');
    } finally {
      busy = false;
      open = false;
    }
  }
  function onWindowDown(e: MouseEvent) {
    if (!open) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-sections-live-menu]') || t.closest('[data-sections-live]')) return;
    open = false;
  }
</script>

<svelte:window onmousedown={onWindowDown} />

<button
  class="lane-line-add live"
  class:on={bridge.syncLocators}
  bind:this={btn}
  onclick={toggle}
  title="Sections and Ableton Live's arrangement locators, both ways"
  data-sections-live
>Live</button>

{#if open}
  <div class="slm" style="left: {pos.x}px; top: {pos.y}px" role="menu" data-sections-live-menu>
    {#if !bridge.connected}
      <p class="slm-note">Live is not connected: open the Ableton panel (VJ mode → Ableton) and turn the connection on.</p>
    {/if}
    <button role="menuitem" disabled={!bridge.connected} onclick={fromLive} data-sections-from-live>Sections from Live locators</button>
    <label class="slm-check" title="Whenever Live's locators change, the sections follow">
      <input type="checkbox" checked={bridge.syncLocators} onchange={(e) => abletonBridge.setSyncLocators((e.currentTarget as HTMLInputElement).checked)} data-sections-sync-live />
      Keep in sync with Live's locators
    </label>
    <button role="menuitem" disabled={!bridge.connected || busy} onclick={toLive} data-sections-to-live>Send sections to Live as locators</button>
    {#if scriptOld}
      <p class="slm-note warn">Update the Ghost Arcade script in Live (Ableton panel → Install, then restart Live) to send locators and fire scenes on the beat.</p>
    {:else}
      <p class="slm-note">Live places locators only while it is stopped. Locators are matched by name and never deleted.</p>
    {/if}
  </div>
{/if}

<style>
  .lane-line-add.live.on { color: #5fdc76; }
  .slm {
    position: fixed;
    z-index: 1200;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 260px;
    max-width: 320px;
    padding: 8px;
    background: var(--ga-card, #16161c);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-0, #e8e8e8);
  }
  .slm button {
    text-align: left;
    height: 26px;
    padding: 0 8px;
    background: none;
    border: 0;
    border-radius: 4px;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .slm button:hover:not(:disabled) { background: var(--ga-selection-bg, #1f3170); }
  .slm button:disabled { opacity: 0.4; cursor: default; }
  .slm-check { display: flex; align-items: center; gap: 6px; padding: 2px 8px; }
  .slm-note { margin: 2px 8px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); }
  .slm-note.warn { color: #ffd36b; }
</style>
