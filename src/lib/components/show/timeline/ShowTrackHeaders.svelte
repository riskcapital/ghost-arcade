<script lang="ts">
  /**
   * The rows' headers in the show's label column, row for row with
   * ShowTrackLanes in the grid. Rows are the mapping layers (in the Layers
   * panel's order; groups fold their children) and the layers the show adds
   * on a piece. An added layer can be dragged up or down among its piece's
   * added layers (that is its drawing order; one undo step on release); a
   * piece's row moves when its layer moves in the Layers panel.
   *
   * Group rows come first; the piece rows sit under the Layers header, which
   * folds them away (layersSection.ts).
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { layers as liveLayersStore } from '../../../stores/layers';
  import ShowTrackHeader from './ShowTrackHeader.svelte';
  import { ADD_TRACK_ROW_HEIGHT, reorderGapAt, reorderIndexForGap } from './trackLayout';
  import { LAYERS_SECTION_HEIGHT, isGroupRow, rowShown, stackRowHeight, stackTops, timelineRowStack, toggleLayersOpen } from './layersSection';
  import { startGroupRow } from './groupRowUi';
  import { trackLaneInfo } from './trackParams';
  import { liveTakeover } from '../../../show/takeover/liveTakeover';
  import { showSlice } from './timelineSlices';
  import { followPointer } from './dragSession';
  import { cameraLaneShown } from './cameraLaneUi';

  // Slices, not $showTimeline: the store publishes every playhead frame.
  const soloStore = showSlice('soloTrackId');
  const selectionStore = showSlice('selection');
  const stack = $derived($timelineRowStack);
  const tracks = $derived(stack.rows);
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
    const tops = stackTops(stack);
    const last = tracks.length - 1;
    return reorder.gap < tops.length ? tops[reorder.gap] : tops.length ? tops[last] + stackRowHeight(stack, tracks[last]) : 0;
  });

  /**
   * Drag an added layer among its piece's other added layers (in the same
   * part: group rows among group rows). Gaps count in the rows as drawn;
   * the move goes to the show's list by track id.
   */
  function pressHeader(e: MouseEvent, trackId: string) {
    const list = get(timelineRowStack).rows;
    const from = list.findIndex((t) => t.id === trackId);
    if (from < 0 || list.length < 2) return;
    // Only the layers added on a piece move here, among themselves.
    const moving = list[from];
    if (!moving.subRow) return;
    const siblings = list.map((t, i) => (t.subRow && t.layerId === moving.layerId && isGroupRow(t) === isGroupRow(moving) ? i : -1)).filter((i) => i >= 0);
    const lo = siblings[0];
    const hi = siblings[siblings.length - 1] + 1;
    if (siblings.length < 2) return;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientY - sy) < 4) return;
      moved = true;
      const st = get(timelineRowStack);
      const top = listEl?.getBoundingClientRect().top ?? 0;
      const gap = Math.max(lo, Math.min(hi, reorderGapAt(stackTops(st), st.rows.map((t) => stackRowHeight(st, t)), ev.clientY - top)));
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
      if (r.gap === r.from || r.gap === r.from + 1) return;
      // The gap as an index in the show's list: before the row drawn at the
      // gap, or after the last sibling.
      const shown = get(timelineRowStack).rows;
      const all = get(showTimeline).layerTracks;
      const indexOf = (id: string) => all.findIndex((t) => t.id === id);
      const fromIndex = indexOf(r.trackId);
      const storeGap = r.gap < hi ? indexOf(shown[r.gap].id) : indexOf(shown[hi - 1].id) + 1;
      if (fromIndex < 0 || storeGap < 0) return;
      const to = reorderIndexForGap(fromIndex, storeGap);
      if (to !== fromIndex) showTimeline.reorderLayerTrack(r.trackId, to);
    }
  }

  const EMPTY: ReadonlySet<string> = new Set();
</script>

<div class="thl" bind:this={listEl} data-track-headers>
{#each tracks as tr, index (tr.id)}
  {#if index === stack.groupCount && stack.section}
    <button
      class="ths"
      class:open={stack.open}
      style:height="{LAYERS_SECTION_HEIGHT}px"
      onmousedown={(e) => e.stopPropagation()}
      onclick={toggleLayersOpen}
      aria-expanded={stack.open}
      title={stack.open ? 'Fold the layer rows away (group rows stay)' : 'Show the layer rows'}
      data-layers-section
    >
      <span class="ths-fold" aria-hidden="true">▸</span>
      <span class="ths-name">Layers</span>
      <span class="ths-count" data-layers-count>{stack.count}</span>
    </button>
  {/if}
  {#if rowShown(stack, tr)}
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
  <button class="tha-btn tha-group" onmousedown={(e) => e.stopPropagation()} onclick={startGroupRow}
    title="A row whose blocks play across a group of pieces you pick on the canvas (Left half, Top row…), as one picture or on each piece"
    data-add-group-row>+ Group row</button>
  {#if $cameraLaneStore.length === 0 && !$cameraLaneShown}
    <button class="tha-btn" onmousedown={(e) => e.stopPropagation()} onclick={() => cameraLaneShown.set(true)} title="Shots from the Stage Sim's Demo reel that its camera follows while the show plays" data-add-camera-lane>+ Camera lane</button>
  {:else}
    <span class="tha-hint">Rows follow the mapping layers</span>
  {/if}
</div>

<style>
  .thl { position: relative; }
  .ths {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 0 8px;
    box-sizing: border-box;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-1, #a8a8b3);
    background: rgba(255, 255, 255, 0.025);
    border: 0;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    cursor: pointer;
    text-align: left;
  }
  .ths-fold { display: inline-block; width: 10px; font-size: 10px; transition: transform 0.12s; }
  .ths.open .ths-fold { transform: rotate(90deg); }
  .ths:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
  .ths-name { text-transform: none; letter-spacing: 0.02em; }
  .ths-count {
    min-width: 16px;
    padding: 0 5px;
    border-radius: 8px;
    font-size: 10px;
    line-height: 15px;
    text-align: center;
    color: var(--ga-ink-1, #a8a8b3);
    background: rgba(255, 255, 255, 0.07);
  }
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
    /* Shrinks (with an ellipsis) rather than overrun the header column in
       languages with longer words; the title carries the full text. */
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .tha { gap: 6px; }
  .tha-btn.tha-group { color: #fff; background: color-mix(in srgb, var(--ga-icon, #5278ff) 18%, transparent); border-color: color-mix(in srgb, var(--ga-icon, #5278ff) 60%, transparent); }
  .tha-btn.tha-group:hover { border-color: var(--ga-icon, #5278ff); }
  .tha-hint { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #55555f); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
