<script lang="ts">
  /**
   * LeftSidebar — wraps the left-edge authoring panel and exposes a
   * Layers / Screens tab strip at the top. Replaces the bare
   * <LayerPanel /> that App.svelte used to mount.
   *
   * Tab state lives in `$leftSidebarTab` (uiState.ts) so other parts
   * of the app — notably the editor viewport, which overlays warp
   * handles only when Screens is active — can subscribe.
   */
  import LayerPanel from './LayerPanel.svelte';
  import ScreenPanel from './ScreenPanel.svelte';
  import { leftSidebarTab, type LeftSidebarTab } from '../stores/uiState';

  function setTab(t: LeftSidebarTab) {
    leftSidebarTab.set(t);
  }
</script>

<div class="left-sidebar">
  <div class="left-tabs" role="tablist" aria-label="Left sidebar tab">
    <button
      class="left-tab"
      class:active={$leftSidebarTab === 'layers'}
      role="tab"
      aria-selected={$leftSidebarTab === 'layers'}
      onclick={() => setTab('layers')}
      title="Layers — content the user composes"
    >Layers</button>
    <button
      class="left-tab"
      class:active={$leftSidebarTab === 'screens'}
      role="tab"
      aria-selected={$leftSidebarTab === 'screens'}
      onclick={() => setTab('screens')}
      title="Screens — output regions (projectors, senders) with warp + blend + effects"
    >Screens</button>
  </div>

  <div class="left-panel-host" role="tabpanel">
    {#if $leftSidebarTab === 'layers'}
      <LayerPanel />
    {:else}
      <ScreenPanel />
    {/if}
  </div>
</div>

<style>
  .left-sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* The two child panels (LayerPanel / ScreenPanel) own their own
       width via their existing CSS. We just provide the tab strip
       above. */
    flex-shrink: 0;
    background: var(--ga-panel, #0b0d11);
    border-right: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    font-family: var(--ga-font-ui, system-ui, sans-serif);
  }
  .left-tabs {
    display: flex;
    gap: 0;
    padding: 0 14px;
    background: var(--ga-panel, #0b0d11);
    border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    flex-shrink: 0;
  }
  .left-tab {
    flex: 0 0 auto;
    padding: 13px 14px;
    margin-right: 8px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--ga-ink-2, #5e6571);
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.10em;
    cursor: pointer;
    transition: color 80ms ease, border-color 80ms ease;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
  }
  .left-tab:hover {
    color: var(--ga-ink-0, #eef0f4);
  }
  .left-tab.active {
    background: transparent;
    color: var(--ga-ink-0, #eef0f4);
    border-bottom-color: var(--ga-violet, #9b87f5);
  }
  .left-panel-host {
    flex: 1;
    min-height: 0;
    /* The hosted panel (LayerPanel/ScreenPanel) provides its own
       scroll containers. Let it size itself; we just take up the
       remaining vertical space. */
    display: flex;
    flex-direction: column;
  }
</style>
