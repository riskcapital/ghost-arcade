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
  }
  .left-tabs {
    display: flex;
    gap: 2px;
    padding: 4px 6px 0 6px;
    background: var(--bg-panel, #0f0f15);
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
  }
  .left-tab {
    flex: 1;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 4px 4px 0 0;
    color: #888;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: background 80ms ease, color 80ms ease;
    font-family: inherit;
  }
  .left-tab:hover {
    background: rgba(255, 255, 255, 0.04);
    color: #ccc;
  }
  .left-tab.active {
    background: var(--accent-faint, rgba(187, 134, 252, 0.15));
    color: var(--accent, #BB86FC);
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
