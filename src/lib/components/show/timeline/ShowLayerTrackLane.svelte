<script lang="ts">
  /**
   * One row in the grid: its blocks, the crossfades between touching
   * blocks, the stretches where its piece is hidden (hatched), and
   * (unfolded) its control lines.
   *
   * Only clips in the visible window are drawn. Props are the track object
   * itself (replaced on every edit, never mutated) and plain numbers, so the
   * playhead moving does not re-render anything here.
   */
  import type { ShowLayerClip, ShowLayerTrack } from '../../../types';
  import { trackTransitionWindow } from '../../../show/tracks/showTrackEval';
  import { junctionPredecessors, predecessorList } from './laneJunctions';
  import ShowLayerClipBlock from './ShowLayerClipBlock.svelte';
  import LineLanes from './LineLanes.svelte';
  import { lineLayout } from './lineUi';
  import { thumbnailFor } from './clipMedia';
  import { clipsInView, hiddenSpans, rowColor, TRACK_ROW_HEIGHT, type LaneKeySelection, type TrackLaneController } from './trackLayout';

  interface Props {
    track: ShowLayerTrack;
    index: number;
    zoom: number;
    viewStart: number;
    viewEnd: number;
    selectedIds: ReadonlySet<string>;
    keySelection: LaneKeySelection | null;
    thumbs: Record<string, string>;
    /** Show time of a drop about to land on this track, or null. */
    dropTime: number | null;
    /** Lanes whose parameter is not on the layer right now. */
    inactiveLanes: ReadonlySet<string>;
    laneRanges: Record<string, { min: number; max: number }>;
    ctl: TrackLaneController;
    /** The track's surface is taken over live (the row turns orange). */
    live?: boolean;
  }

  let {
    track, index, zoom, viewStart, viewEnd, selectedIds, thumbs, dropTime, ctl, live = false,
  }: Props = $props();

  const color = $derived(rowColor(track));
  const visible = $derived(clipsInView(track.clips, viewStart, viewEnd));
  /** Where the piece is hidden (only rows that hide: a row with no blocks
   *  follows the look). */
  const hidden = $derived(hiddenSpans(track, viewStart, viewEnd));
  const kind = $derived(track.row?.kind ?? (track.subRow ? 'sub' : 'piece'));

  /** Each clip's junction predecessor, worked out once per edit of the
   *  track (not per clip in view, and not again on every scroll). */
  const predecessors = $derived(junctionPredecessors(track.clips));
  /** Junctions between touching clips in view: drawn transitions or a
   *  ghost "add crossfade" button. */
  const junctions = $derived(visible
    .filter((c) => predecessors.has(c))
    .map((c) => ({ clip: c, window: trackTransitionWindow(predecessorList(predecessors.get(c), c), c) })));

  const rowLines = $derived($lineLayout.lines.get(track.id) ?? []);
  const linesExpanded = $derived($lineLayout.expanded.has(track.id));
  const blockSpans = $derived(Object.fromEntries(track.clips.map((c) => [c.id, { start: c.startTime, end: c.startTime + c.duration }])));

  function onpress(e: MouseEvent, clip: ShowLayerClip, part: import('./trackLayout').ClipPart) {
    ctl.pressClip(e, track, clip, part);
  }

  function pressRow(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.lc-block') || target.closest('.tx') || target.closest('.tx-add')) return;
    ctl.pressEmpty(e, track);
  }
</script>

<div class="lt" data-track-id={track.id} data-track-index={index} data-row-kind={kind}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="lt-clips"
    class:locked={track.locked}
    class:muted={track.muted}
    class:drop={dropTime !== null}
    class:live
    class:sub={kind === 'sub'}
    style:height="{TRACK_ROW_HEIGHT}px"
    style:--track-color={color}
    onmousedown={pressRow}
    ondragover={(e) => ctl.dragOver(e, track)}
    ondragleave={(e) => ctl.dragLeave(e)}
    ondrop={(e) => ctl.drop(e, track)}
  >
    {#each hidden as span (span.start)}
      <div
        class="lt-hidden"
        style:left="{span.start * zoom}px"
        style:width="{Math.max(0, (span.end - span.start) * zoom)}px"
        title={track.muted ? 'Hidden for the whole show (the eye)' : 'Hidden here: no block on this row'}
        data-hidden-span
      ></div>
    {/each}
    {#each visible as clip (clip.id)}
      <ShowLayerClipBlock
        {clip}
        {zoom}
        selected={selectedIds.has(clip.id)}
        locked={track.locked}
        {color}
        thumb={thumbnailFor(thumbs, clip.media)}
        {onpress}
        oncontext={(e, c) => ctl.contextClip(e, track, c)}
      />
    {/each}
    {#each junctions as j (j.clip.id)}
      {#if j.window}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tx"
          class:selected={selectedIds.has(j.clip.id)}
          style:left="{j.window.start * zoom}px"
          style:width="{Math.max(10, j.window.duration * zoom)}px"
          onmousedown={(e) => ctl.pressXfade(e, track, j.clip, 'body')}
          ondblclick={() => ctl.removeXfade(track, j.clip)}
          title={`Crossfade ${j.window.duration.toFixed(2)}s. Drag an edge to change its length, double-click to remove.`}
          data-xfade-clip={j.clip.id}
        >
          {#if !track.locked}
            <div class="tx-h left" onmousedown={(e) => ctl.pressXfade(e, track, j.clip, 'edge')}></div>
          {/if}
          <svg class="tx-bowtie" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 0 L100 100 M0 100 L100 0" vector-effect="non-scaling-stroke" />
          </svg>
          {#if !track.locked}
            <div class="tx-h right" onmousedown={(e) => ctl.pressXfade(e, track, j.clip, 'edge')}></div>
          {/if}
        </div>
      {:else if !track.locked}
        <button
          class="tx-add"
          style:left="{j.clip.startTime * zoom}px"
          onmousedown={(e) => e.stopPropagation()}
          onclick={(e) => { e.stopPropagation(); ctl.addXfade(track, j.clip); }}
          title="Add a crossfade between these clips"
          aria-label="Add a crossfade between these clips"
          data-xfade-add={j.clip.id}
        >
          <svg width="13" height="9" viewBox="0 0 15 10" aria-hidden="true">
            <path d="M0.5 0.5 L7.5 5 L0.5 9.5 Z M14.5 0.5 L7.5 5 L14.5 9.5 Z" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      {/if}
    {/each}
    {#if dropTime !== null}
      <div class="lt-drop" style:left="{dropTime * zoom}px"></div>
    {/if}
    {#if track.clips.length === 0 && dropTime === null}
      <!-- The hint on the first piece row; the rest say it on hover, not all at once. -->
      <span class="lt-empty" class:quiet={index > 0 && kind === 'piece'}>{kind === 'sub' ? 'Drop media here: it draws over the piece' : kind === 'missing' ? 'This layer is gone from the stage' : 'Shows its look. Drop media here to play it on this piece'}</span>
    {/if}
  </div>
  {#if !track.collapsed && rowLines.length}
    <LineLanes groupId={track.id} lines={rowLines} expanded={linesExpanded} {zoom} {viewStart} {viewEnd} locked={track.locked} {blockSpans} />
  {/if}
</div>

<style>
  .lt { position: relative; }
  .lt-clips {
    --track-color: #8b7cff;
    position: relative;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    background: color-mix(in srgb, var(--track-color) 4%, transparent);
  }
  .lt-clips.muted { opacity: 0.5; }
  .lt-clips.sub { background: color-mix(in srgb, var(--track-color) 2%, rgba(0, 0, 0, 0.18)); }
  .lt-hidden {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 0;
    pointer-events: none;
    background: repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.42) 0 5px, rgba(255, 255, 255, 0.035) 5px 10px);
  }
  .lt-clips.live {
    background: color-mix(in srgb, #ff8c28 7%, transparent);
    box-shadow: inset 0 1px 0 rgba(255, 140, 40, 0.55), inset 0 -1px 0 rgba(255, 140, 40, 0.55);
  }
  .lt-clips.locked {
    background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0 6px, transparent 6px 12px);
  }
  .lt-clips.drop {
    background: color-mix(in srgb, var(--track-color) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--track-color) 60%, transparent);
  }
  .lt-drop {
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 2px;
    margin-left: -1px;
    background: #FFD96B;
    box-shadow: 0 0 6px rgba(255, 217, 107, 0.8);
    pointer-events: none;
    z-index: 6;
  }
  .lt-empty.quiet { opacity: 0; transition: opacity 120ms; }
  .lt:hover .lt-empty.quiet { opacity: 1; }
  .lt-empty {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #55555f);
    pointer-events: none;
    white-space: nowrap;
  }
  .tx {
    position: absolute;
    top: 3px;
    bottom: 3px;
    z-index: 4;
    border-radius: 3px;
    box-sizing: border-box;
    /* Opaque base: the clips' names and lengths under it would otherwise
       read through the bowtie. */
    background: linear-gradient(180deg, rgba(255, 217, 107, 0.28), rgba(255, 217, 107, 0.12)), #15130d;
    border: 1px solid rgba(255, 217, 107, 0.75);
    cursor: pointer;
    overflow: hidden;
  }
  .tx.selected { box-shadow: 0 0 0 1px #FFD96B, 0 0 12px rgba(255, 217, 107, 0.45); }
  .tx-bowtie { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .tx-bowtie path { stroke: rgba(255, 217, 107, 0.85); stroke-width: 1; fill: none; }
  .tx-h { position: absolute; top: 0; bottom: 0; width: 6px; z-index: 2; cursor: ew-resize; }
  .tx-h.left { left: 0; }
  .tx-h.right { right: 0; }
  .tx-h:hover { background: rgba(255, 255, 255, 0.35); }
  .tx-add {
    position: absolute;
    top: 50%;
    width: 19px;
    height: 15px;
    margin-left: -9.5px;
    transform: translateY(-50%);
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 3px;
    background: rgba(10, 10, 14, 0.85);
    border: 1px dashed rgba(255, 217, 107, 0.45);
    color: rgba(255, 217, 107, 0.75);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .lt-clips:hover .tx-add { opacity: 1; }
  .tx-add:hover { border-style: solid; border-color: #FFD96B; color: #FFD96B; }
</style>
