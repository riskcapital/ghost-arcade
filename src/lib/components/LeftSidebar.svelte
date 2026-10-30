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

<div data-help-page="interface" class="left-sidebar">
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
  /* Sentence-case tabs in the UI face; the chosen one takes the
     selection colours and a 2px underline. */
  .left-tabs {
    display: flex;
    align-items: stretch;
    gap: 2px;
    height: 36px;
    padding: 0 8px;
    background: var(--ga-panel, #0b0d11);
    border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    flex-shrink: 0;
  }
  .left-tab {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--ga-ink-1, #9aa0ac);
    font-family: var(--ga-font-ui, system-ui, sans-serif);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    letter-spacing: 0;
    text-transform: none;
    cursor: pointer;
    transition: color 80ms ease, border-color 80ms ease, background 80ms ease;
  }
  .left-tab:hover {
    color: var(--ga-ink-0, #eef0f4);
  }
  .left-tab.active {
    background: var(--ga-selection-bg, transparent);
    color: var(--ga-selection-ink, var(--ga-ink-0, #eef0f4));
    border-bottom-color: var(--ga-selection-line, #5278ff);
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
