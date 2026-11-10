<script lang="ts">
  /**
   * The rows' headers in the show's label column, row for row with
   * ShowTrackLanes in the grid. Rows are the mapping layers (in the Layers
   * panel's order; groups fold their children) and the layers the show adds
   * on a piece. An added layer can be dragged up or down among its piece's
   * added layers (that is its drawing order; one undo step on release); a
   * piece's row moves when its layer moves in the Layers panel.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { layers as liveLayersStore } from '../../../stores/layers';
  import ShowTrackHeader from './ShowTrackHeader.svelte';
  import { ADD_TRACK_ROW_HEIGHT, reorderGapAt, reorderIndexForGap, trackHeight, trackTops } from './trackLayout';
  import { trackLaneInfo } from './trackParams';
  import { liveTakeover } from '../../../show/takeover/liveTakeover';
  import { showSlice } from './timelineSlices';
  import { followPointer } from './dragSession';
  import { cameraLaneShown } from './cameraLaneUi';

  // Slices, not $showTimeline: the store publishes every playhead frame.
  const layerTracksStore = showSlice('layerTracks');
  const soloStore = showSlice('soloTrackId');
  const selectionStore = showSlice('selection');
  const tracks = $derived($layerTracksStore);
  const solo = $derived($soloStore);
  const selection = $derived($selectionStore);
  const selectedTrackId = $derived(selection?.kind === 'track' ? selection.id : null);
  const liveLayers = $derived($liveLayersStore);
  const liveById = $derived(new Map(liveLayers.map((l) => [l.id, l])));

  const cameraLaneStore = showSlice('cameraLane');

  // ── Reorder ──────────────────────────────────────────────────────────
  let listEl: HTMLDivElement | undefined = $state();
  let reorder: { trackId: string; gap: number; from: number } | null = $state(null);
  const gapY = $derived.by(() => {
    if (!reorder) return 0;
    const tops = trackTops(tracks);
    return reorder.gap < tops.length ? tops[reorder.gap] : tops.length ? tops[tops.length - 1] + trackHeight(tracks[tracks.length - 1]) : 0;
  });

  function pressHeader(e: MouseEvent, trackId: string) {
    const list = get(showTimeline).layerTracks;
    const from = list.findIndex((t) => t.id === trackId);
    if (from < 0 || list.length < 2) return;
    // Only the layers added on a piece move here, among themselves.
    const moving = list[from];
    if (!moving.subRow) return;
    const siblings = list.map((t, i) => (t.subRow && t.layerId === moving.layerId ? i : -1)).filter((i) => i >= 0);
    const lo = siblings[0];
    const hi = siblings[siblings.length - 1] + 1;
    if (siblings.length < 2) return;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientY - sy) < 4) return;
      moved = true;
      const now = get(showTimeline).layerTracks;
      const top = listEl?.getBoundingClientRect().top ?? 0;
      const gap = Math.max(lo, Math.min(hi, reorderGapAt(trackTops(now), now.map(trackHeight), ev.clientY - top)));
      reorder = { trackId, gap, from };
    };
    // Esc or focus lost: nothing has moved yet, the gap marker just goes.
    followPointer({ move, end: () => up(), cancel: () => { reorder = null; } });
    function up() {
      const r = reorder;
      reorder = null;
      if (!moved || !r) return;
      // The release is not a click on the header.
      const stop = (ev: Event) => ev.stopPropagation();
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
      const to = reorderIndexForGap(r.from, r.gap);
      if (to !== r.from) showTimeline.reorderLayerTrack(r.trackId, to);
    }
  }

  const EMPTY: ReadonlySet<string> = new Set();
</script>

<div class="thl" bind:this={listEl} data-track-headers>
{#each tracks as tr (tr.id)}
  {#if !tr.row?.hidden}
  <ShowTrackHeader
    track={tr}
    onStage={tr.row ? tr.row.onStage : liveById.has(tr.layerId)}
    soloed={solo === tr.id}
    otherSoloed={solo !== null && solo !== tr.id}
    selected={selectedTrackId === tr.id}
    live={liveById.get(tr.layerId) ?? null}
    inactiveLanes={tr.lanes.length ? trackLaneInfo(tr, liveById.get(tr.layerId)).inactive : EMPTY}
    onpress={(e) => pressHeader(e, tr.id)}
    dragging={reorder?.trackId === tr.id}
    takeover={$liveTakeover.surfaces[tr.layerId] ?? null}
  />
  {/if}
{/each}
{#if reorder}
  <div class="thl-gap" style:top="{gapY - 1}px" data-track-reorder-gap={reorder.gap}></div>
{/if}
</div>
<div class="tha" style:height="{ADD_TRACK_ROW_HEIGHT}px">
  {#if $cameraLaneStore.length === 0 && !$cameraLaneShown}
    <button class="tha-btn" onmousedown={(e) => e.stopPropagation()} onclick={() => cameraLaneShown.set(true)} title="Shots from the Stage Sim's Demo reel that its camera follows while the show plays" data-add-camera-lane>+ Stage camera lane</button>
  {:else}
    <span class="tha-hint">Rows follow the mapping layers</span>
  {/if}
</div>

<style>
  .thl { position: relative; }
  .thl-gap {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: #FFD96B;
    box-shadow: 0 0 6px rgba(255, 217, 107, 0.7);
    pointer-events: none;
    z-index: 5;
  }
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
  .tha-btn:hover { border-color: rgba(139, 124, 255, 0.8); color: #fff; }
  .tha-hint { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #55555f); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
