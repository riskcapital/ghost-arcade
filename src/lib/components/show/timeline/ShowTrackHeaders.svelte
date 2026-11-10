<script lang="ts">
  /**
   * The layer tracks' headers in the show's label column, row for row with
   * ShowTrackLanes in the grid, and the "+ Track" row under them.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import { layers as liveLayersStore } from '../../../stores/layers';
  import ShowTrackHeader from './ShowTrackHeader.svelte';
  import ShowAddTrackMenu from './ShowAddTrackMenu.svelte';
  import { ADD_TRACK_ROW_HEIGHT } from './trackLayout';
  import { trackLaneInfo } from './trackParams';

  const tracks = $derived($showTimeline.layerTracks);
  const solo = $derived($showTimeline.soloTrackId);
  const selection = $derived($showTimeline.selection);
  const selectedTrackId = $derived(selection?.kind === 'track' ? selection.id : null);
  const liveLayers = $derived($liveLayersStore);
  const liveById = $derived(new Map(liveLayers.map((l) => [l.id, l])));

  let menu: { x: number; y: number } | null = $state(null);

  function openMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = menu ? null : { x: r.left, y: r.top - 4 };
  }
  const EMPTY: ReadonlySet<string> = new Set();
</script>

{#each tracks as tr (tr.id)}
  <ShowTrackHeader
    track={tr}
    onStage={liveById.has(tr.layerId)}
    soloed={solo === tr.id}
    otherSoloed={solo !== null && solo !== tr.id}
    selected={selectedTrackId === tr.id}
    live={liveById.get(tr.layerId) ?? null}
    inactiveLanes={tr.lanes.length ? trackLaneInfo(tr, liveById.get(tr.layerId)).inactive : EMPTY}
  />
{/each}
<div class="tha" style:height="{ADD_TRACK_ROW_HEIGHT}px">
  <button class="tha-btn" class:open={menu !== null} onmousedown={(e) => e.stopPropagation()} onclick={openMenu} title="Add a layer track" data-show-add-track>+ Track</button>
</div>
{#if menu}
  <ShowAddTrackMenu x={menu.x} y={menu.y} onclose={() => (menu = null)} />
{/if}

<style>
  .tha {
    display: flex;
    align-items: center;
    padding: 0 8px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .tha-btn {
    height: 20px;
    padding: 0 8px;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    color: color-mix(in srgb, #8b7cff 70%, #ffffff);
    background: rgba(139, 124, 255, 0.08);
    border: 1px solid rgba(139, 124, 255, 0.4);
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
  }
  .tha-btn:hover, .tha-btn.open { border-color: rgba(139, 124, 255, 0.8); color: #fff; }
</style>
