<script lang="ts">
  /**
   * The layer tracks' headers in the show's label column, row for row with
   * ShowTrackLanes in the grid, and the "+ Track" row under them. Dragging a
   * header up or down moves its track (one undo step on release).
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { layers as liveLayersStore } from '../../../stores/layers';
  import ShowTrackHeader from './ShowTrackHeader.svelte';
  import ShowAddTrackMenu from './ShowAddTrackMenu.svelte';
  import { ADD_TRACK_ROW_HEIGHT, reorderGapAt, reorderIndexForGap, trackHeight, trackTops } from './trackLayout';
  import { trackLaneInfo } from './trackParams';
  import { liveTakeover } from '../../../show/takeover/liveTakeover';

  const tracks = $derived($showTimeline.layerTracks);
  const solo = $derived($showTimeline.soloTrackId);
  const selection = $derived($showTimeline.selection);
  const selectedTrackId = $derived(selection?.kind === 'track' ? selection.id : null);
  const liveLayers = $derived($liveLayersStore);
  const liveById = $derived(new Map(liveLayers.map((l) => [l.id, l])));

  let menu: { x: number; y: number } | null = $state(null);

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
    const sy = e.clientY;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientY - sy) < 4) return;
      moved = true;
      const now = get(showTimeline).layerTracks;
      const top = listEl?.getBoundingClientRect().top ?? 0;
      const gap = reorderGapAt(trackTops(now), now.map(trackHeight), ev.clientY - top);
      reorder = { trackId, gap, from };
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const r = reorder;
      reorder = null;
      if (!moved || !r) return;
      // The release is not a click on the header.
      const stop = (ev: Event) => ev.stopPropagation();
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
      const to = reorderIndexForGap(r.from, r.gap);
      if (to !== r.from) showTimeline.reorderLayerTrack(r.trackId, to);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function openMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = menu ? null : { x: r.left, y: r.top - 4 };
  }
  const EMPTY: ReadonlySet<string> = new Set();
</script>

<div class="thl" bind:this={listEl} data-track-headers>
{#each tracks as tr (tr.id)}
  <ShowTrackHeader
    track={tr}
    onStage={liveById.has(tr.layerId)}
    soloed={solo === tr.id}
    otherSoloed={solo !== null && solo !== tr.id}
    selected={selectedTrackId === tr.id}
    live={liveById.get(tr.layerId) ?? null}
    inactiveLanes={tr.lanes.length ? trackLaneInfo(tr, liveById.get(tr.layerId)).inactive : EMPTY}
    onpress={(e) => pressHeader(e, tr.id)}
    dragging={reorder?.trackId === tr.id}
    takeover={$liveTakeover.surfaces[tr.layerId] ?? null}
  />
{/each}
{#if reorder}
  <div class="thl-gap" style:top="{gapY - 1}px" data-track-reorder-gap={reorder.gap}></div>
{/if}
</div>
<div class="tha" style:height="{ADD_TRACK_ROW_HEIGHT}px">
  <button class="tha-btn" class:open={menu !== null} onmousedown={(e) => e.stopPropagation()} onclick={openMenu} title="Add a layer track" data-show-add-track>+ Track</button>
</div>
{#if menu}
  <ShowAddTrackMenu x={menu.x} y={menu.y} onclose={() => (menu = null)} />
{/if}

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
  .tha-btn:hover, .tha-btn.open { border-color: rgba(139, 124, 255, 0.8); color: #fff; }
</style>
