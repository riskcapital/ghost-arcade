<script lang="ts">
  /**
   * The selected row: what its piece shows between blocks, its colour, and
   * clearing it (a piece's row: its blocks and lanes go, the row stays as
   * long as the mapping layer does) or removing it (a layer added on a
   * piece, or a row whose piece is gone).
   */
  import type { ShowLayerTrack } from '../../../types';
  import { showTimeline } from '../../../stores/showTimeline';

  interface Props {
    track: ShowLayerTrack;
    onStage: boolean;
    onclose: () => void;
  }

  let { track, onStage, onclose }: Props = $props();

  const SWATCHES = ['#8b7cff', '#ff6f5e', '#f0c674', '#5fdc76', '#5ce1e6', '#5278ff', '#c77dff'];
  const kind = $derived(track.row?.kind ?? (track.subRow ? 'sub' : 'piece'));
  const title = $derived(kind === 'sub' ? 'Layer on a piece' : kind === 'missing' ? 'Missing piece' : kind === 'group' ? 'Group row' : 'Row');
</script>

<div class="show-inspector" data-track-inspector>
  <span class="insp-title">{title}</span>
  <span class="insp-name layer-name">{track.layerName}</span>
  {#if kind === 'missing'}
    <span class="insp-hint">This mapping layer is gone from the stage and every look the show uses.</span>
  {/if}
  <label class="insp-field" title="A row with no blocks always shows what the current look gives its piece">
    <span>Between blocks</span>
    <select
      value={track.gap}
      onchange={(e) => showTimeline.updateLayerTrack(track.id, { gap: (e.currentTarget as HTMLSelectElement).value as 'layer' | 'hide' })}
      data-track-gap
    >
      <option value="hide">Hide the piece</option>
      <option value="layer">Show the look</option>
    </select>
  </label>
  <span class="insp-swatches" role="group" aria-label="Row colour">
    {#each SWATCHES as sw (sw)}
      <button
        class="insp-swatch"
        class:on={(track.color ?? SWATCHES[0]) === sw}
        style:background={sw}
        onclick={() => showTimeline.updateLayerTrack(track.id, { color: sw === SWATCHES[0] ? undefined : sw })}
        title="Row colour"
        aria-label="Row colour"
      ></button>
    {/each}
  </span>
  {#if kind === 'sub' || kind === 'missing'}
    <button class="insp-delete" onclick={() => showTimeline.removeLayerTrack(track.id)} title="Remove this row and its blocks" data-track-remove>Remove row</button>
  {:else}
    <button class="insp-delete" disabled={!track.clips.length && !track.lanes.length} onclick={() => showTimeline.removeLayerTrack(track.id)} title="Take every block and lane off this row. The mapping layer and its row stay." data-track-remove>Clear row</button>
  {/if}
  <button aria-label="Close row inspector" class="insp-close" onclick={onclose}>×</button>
</div>

<style>
  .show-inspector {
    display: flex;
    align-items: center;
    gap: 10px 12px;
    min-height: 36px;
    padding: 4px 12px;
    background: var(--ga-card, #121217);
    border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #bbb);
    flex: 0 0 auto;
    flex-wrap: wrap;
  }
  .insp-title {
    color: #FFD96B;
    font-weight: var(--ga-weight-control, 600);
    padding-right: 12px;
    border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .insp-name { color: var(--ga-ink-0, #ddd); font-weight: 600; }
  .insp-hint { font-size: var(--ga-text-meta, 11px); color: #f0c674; }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-field select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
    outline: none;
    font-family: inherit;
  }
  .insp-swatches { display: flex; gap: 3px; }
  .insp-swatch {
    width: 14px;
    height: 14px;
    padding: 0;
    border-radius: 3px;
    border: 1px solid var(--ga-line-3, rgba(255, 255, 255, 0.24));
    cursor: pointer;
  }
  .insp-swatch.on { box-shadow: 0 0 0 1px #FFD96B; }
  .insp-delete {
    margin-left: auto;
    height: var(--ga-control-h-sm, 22px);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4757) 40%, transparent);
    color: var(--ga-rec, #FF4757);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
    font-family: inherit;
  }
  .insp-delete:hover { background: color-mix(in srgb, var(--ga-rec, #ff4757) 14%, transparent); }
  .insp-close {
    background: none;
    border: none;
    color: var(--ga-ink-2, #888);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .insp-close:hover { color: var(--ga-ink-0, #fff); }
</style>
