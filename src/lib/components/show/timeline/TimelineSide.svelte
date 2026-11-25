<script lang="ts">
  /**
   * The Timeline's side column, beside the lanes: Inspector (the selection's
   * settings), Media (the Media Library, with a banner saying where a click
   * puts a card) and Perform (GO, the cue list, takeover, pads). One column,
   * so the canvas is never covered. × closes it and the lanes get the width
   * back; a block click or the toolbar's Perform opens it again. Drag its
   * left edge to make it wider or narrower (Perform keeps its own width).
   */
  import type { Snippet } from 'svelte';
  import MediaTray from '../../MediaTray.svelte';
  import { formatBarsBeats } from '../../../show/tempoMap';
  import { showSlice } from './timelineSlices';
  import { formatPrecise } from './timeFormat';
  import { followPointer } from './dragSession';
  import { sideColumn, sideWidth, type SideTab } from './sideColumn';
  import { activeMediaTarget, mediaTarget } from './rowSelect';
  import TimelineIcon, { type TimelineIconName } from './TimelineIcon.svelte';

  interface Props {
    inspector: Snippet;
    perform: Snippet;
    /** Shown on the Perform tab's header: its keys. */
    performKeys?: Snippet;
  }
  let { inspector, perform, performKeys }: Props = $props();

  const TABS: Array<{ id: SideTab; label: string; icon: TimelineIconName; title: string }> = [
    { id: 'inspector', label: 'Inspector', icon: 'control', title: 'The settings of what is selected' },
    { id: 'media', label: 'Media', icon: 'media', title: 'The Media Library, next to the rows: click a card to put it on the selected row, or drag it onto any row' },
    { id: 'perform', label: 'Perform', icon: 'pads', title: 'GO, the cue list, pads and taking rows over live' },
  ];

  const side = $derived($sideColumn);
  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1920);
  // On a 1280 px laptop the 600 px Perform column would leave the lanes a sliver.
  const width = $derived(sideWidth(side, windowWidth));

  // The Media tab's target: the selected row a card click goes on.
  const selection = showSlice('selection');
  const layerTracks = showSlice('layerTracks');
  const currentTime = showSlice('currentTime');
  const tempo = showSlice('tempo');
  const target = $derived.by(() => {
    void $selection; void $layerTracks; void $mediaTarget;
    return activeMediaTarget();
  });

  function startResize(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    followPointer({
      move: (ev) => sideColumn.send({ kind: 'resize', width: w0 - (ev.clientX - x0) }),
      end: () => {},
      cancel: () => sideColumn.send({ kind: 'resize', width: w0 }),
    });
  }
</script>

<svelte:window bind:innerWidth={windowWidth} />
{#if side.open}
  <aside class="tl-side" style:width="{width}px" data-timeline-side={side.tab} aria-label="Timeline side column">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="side-grip" onmousedown={startResize} title="Drag to make the column wider or narrower"></div>
    <div class="side-tabs" role="tablist">
      {#each TABS as tab (tab.id)}
        <button
          role="tab"
          class:on={side.tab === tab.id}
          aria-selected={side.tab === tab.id}
          onclick={() => sideColumn.send({ kind: 'show', tab: tab.id })}
          title={tab.title}
          data-side-tab={tab.id}
        ><TimelineIcon name={tab.icon} size={15} />{tab.label}</button>
      {/each}
      <span class="side-grow"></span>
      {#if side.tab === 'perform' && performKeys}{@render performKeys()}{/if}
      <button class="side-x" onclick={() => sideColumn.send({ kind: 'close' })} title="Close the column (the lanes get the width)" aria-label="Close the side column" data-side-close><TimelineIcon name="close" size={14} /></button>
    </div>
    {#if side.tab === 'inspector'}
      <div class="side-body" data-side-inspector>{@render inspector()}</div>
    {:else if side.tab === 'media'}
      <div class="side-media" data-side-media>
        {#if target}
          <div class="media-target" data-media-target={target.id}>
            <TimelineIcon name={target.group ? 'group' : 'piece'} size={15} />
            <p>
              Click a card to put it on <b class="layer-name">{target.layerName}</b> at the playhead
              <span class="mono">{$tempo ? formatBarsBeats($tempo, $currentTime, true) : formatPrecise($currentTime)}</span>, up to the next block.
              Or drag it onto any row.
            </p>
            <button onclick={() => mediaTarget.set(null)} title="Let go of the row: cards then only drag" aria-label="Let go of the row" data-media-target-clear><TimelineIcon name="close" size={12} /></button>
          </div>
        {:else}
          <p class="media-hint">Drag a card onto a row. Click a row first to put cards on it with a click.</p>
        {/if}
        <div class="media-tray"><MediaTray embedded={true} /></div>
      </div>
    {:else}
      <div class="side-body perform" data-side-perform>{@render perform()}</div>
    {/if}
  </aside>
{/if}

<style>
  .tl-side {
    position: relative;
    flex: 0 0 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--ga-panel, #100f0d);
    border-left: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .side-grip { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: ew-resize; z-index: 5; }
  .side-grip:hover { background: color-mix(in srgb, var(--ga-icon, #5278ff) 35%, transparent); }
  .side-tabs {
    flex: 0 0 36px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    border-bottom: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    min-width: 0;
  }
  .side-tabs > button[role='tab'] {
    height: 26px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .side-tabs > button[role='tab'] :global(.tl-icon) { color: var(--ga-ink-1, #ada9a2); }
  .side-tabs > button[role='tab']:hover:not(.on) { background: var(--ga-raise, #26221c); }
  .side-tabs > button.on { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .side-tabs > button.on :global(.tl-icon) { color: var(--ga-selection-ink, #e0e8ff); }
  .side-grow { flex: 1; min-width: 4px; }
  .side-x {
    width: 24px; height: 24px; flex: 0 0 auto; display: grid; place-items: center; padding: 0;
    border: 0; border-radius: 4px; background: transparent; color: var(--ga-ink-2, #89857e); cursor: pointer;
  }
  .side-x:hover { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .side-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; }
  .side-body.perform { padding: 10px 12px; }
  .side-media { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .media-target {
    margin: 10px 10px 4px;
    padding: 8px 8px 8px 10px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    border-radius: var(--ga-r-hard, 5px);
    background: var(--tl-on-soft, rgba(255, 114, 95, 0.13));
    border: 1px solid var(--tl-on-line, rgba(255, 114, 95, 0.46));
    color: var(--tl-on-ink, #ffd9d2);
  }
  .media-target :global(.tl-icon) { color: var(--tl-on, #ff725f); margin-top: 1px; }
  .media-target p { margin: 0; flex: 1; font-size: var(--ga-text-control, 12px); line-height: 1.45; }
  .media-target b { color: var(--ga-ink-0, #f2ede4); }
  .media-target .mono { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .media-target button { flex: 0 0 auto; width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--tl-on-ink, #ffd9d2); cursor: pointer; }
  .media-target button:hover { background: rgba(0, 0, 0, 0.25); }
  .media-hint { margin: 10px 12px 2px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .media-tray { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .media-tray :global(.media-tray.embedded) { flex: 1; min-height: 0; }

  /* Inspectors made for the old one-line strip, stacked for the column. */
  .side-body :global(.show-inspector) {
    flex-direction: column;
    align-items: stretch;
    flex-wrap: nowrap;
    gap: 8px;
    min-height: 0;
    padding: 0;
    background: transparent;
    border: 0;
  }
  .side-body :global(.show-inspector .insp-title) {
    border-right: 0;
    padding: 0;
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-title, 14px);
    font-weight: var(--ga-weight-title, 650);
  }
  .side-body :global(.show-inspector .insp-field) {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
  }
  .side-body :global(.show-inspector .insp-field > span:first-child) { color: var(--ga-ink-1, #ada9a2); }
  .side-body :global(.show-inspector .insp-field input[type='number']),
  .side-body :global(.show-inspector .insp-field input[type='text']),
  .side-body :global(.show-inspector .insp-field select) {
    width: 100%;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: var(--ga-slot, #060504);
    border-radius: 4px;
  }
  .side-body :global(.show-inspector .insp-delete) {
    margin: 4px 0 0;
    align-self: stretch;
    height: var(--ga-control-h, 26px);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--tl-on, #ff725f);
  }
  .side-body :global(.show-inspector .insp-close) { display: none; }
  .side-body :global(.show-inspector .insp-hint) { line-height: 1.45; }
</style>
