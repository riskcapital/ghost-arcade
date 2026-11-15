<script lang="ts">
  /**
   * The rows' headers in the show's label column, row for row with
   * ShowTrackLanes in the grid. Rows are the mapping layers (in the Layers
   * panel's order; groups fold their children) and the layers the show adds
   * on a piece. An added layer can be dragged up or down among its piece's
   * added layers (that is its drawing order; one undo step on release); a
   * piece's row moves when its layer moves in the Layers panel.
   *
   * Group rows come first, under a Groups header (+ Group); the piece rows
   * sit under the Layers header, which folds them away (layersSection.ts).
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { layers as liveLayersStore } from '../../../stores/layers';
  import ShowTrackHeader from './ShowTrackHeader.svelte';
  import { reorderGapAt, reorderIndexForGap } from './trackLayout';
  import { groupsHeaderHeight, isGroupRow, layersHeaderHeight, rowShown, setGroupsOpen, stackRowHeight, stackTops, timelineRowStack, toggleLayersOpen } from './layersSection';
  import { startGroupRow } from './groupRowUi';
  import RowSectionHeader from './RowSectionHeader.svelte';
  import TimelineIcon from './TimelineIcon.svelte';
  import { trackLaneInfo } from './trackParams';
  import { liveTakeover } from '../../../show/takeover/liveTakeover';
  import { showSlice } from './timelineSlices';
  import { followPointer } from './dragSession';

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

  /** Layers added on each piece (not group rows): its meta line counts them. */
  const layersOnPiece = $derived.by(() => {
    const m = new Map<string, number>();
    for (const t of tracks) if (t.subRow && !t.group) m.set(t.layerId, (m.get(t.layerId) ?? 0) + 1);
    return m;
  });
  const blockCount = $derived(tracks.reduce((n, t, i) => (i >= stack.groupCount ? n + t.clips.length : n), 0));

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
{#if stack.groupCount > 0}
  <RowSectionHeader id="groups" title="Groups" icon="group" count={stack.groupCount} folded={!stack.groupsOpen}
    ontoggle={() => setGroupsOpen(!stack.groupsOpen)} height={groupsHeaderHeight(stack)}
    summary={stack.groupsOpen ? '' : tracks.slice(0, stack.groupCount).map((t) => t.layerName).join(', ')}
    help="Group rows: blocks that play across a group of pieces, as one picture or on each piece. Click a row to put Media Library cards on it.">
    {#snippet actions()}
      <button class="rsh-act" onmousedown={(e) => e.stopPropagation()} onclick={startGroupRow}
        title="A row whose blocks play across a group of pieces you pick on the canvas (Left half, Top row…), as one picture or on each piece"
        data-add-group-row><TimelineIcon name="plus" size={12} />Group</button>
    {/snippet}
  </RowSectionHeader>
{/if}
{#each tracks as tr, index (tr.id)}
  {#if index === stack.groupCount && stack.section}
    <RowSectionHeader id="layers" title="Layers" icon="layers" count={stack.count} folded={!stack.open}
      ontoggle={toggleLayersOpen} height={layersHeaderHeight(stack)}
      help="One row per mapping layer, in the Layers panel's order, and the layers added on a piece. Fold them away when you work with groups.">
      {#snippet actions()}
        {#if !stack.open}<span class="ths-blocks" data-layers-count>{blockCount} {blockCount === 1 ? 'block' : 'blocks'}</span>{/if}
      {/snippet}
    </RowSectionHeader>
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
    layersOn={tr.subRow ? 0 : layersOnPiece.get(tr.layerId) ?? 0}
  />
  {/if}
{/each}
{#if reorder}
  <div class="thl-gap" style:top="{gapY - 1}px" data-track-reorder-gap={reorder.gap}></div>
{/if}
</div>

<style>
  .thl { position: relative; }
  .ths-blocks { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 10px; color: var(--ga-ink-2, #89857e); padding-right: 2px; }
  .thl-gap {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--tl-on, #ff725f);
    box-shadow: 0 0 6px var(--tl-on-line, rgba(255, 114, 95, 0.46));
    pointer-events: none;
    z-index: 5;
  }
</style>
