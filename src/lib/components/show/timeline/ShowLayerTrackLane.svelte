<script lang="ts">
  /**
   * One layer track in the grid: its clip row, the crossfades between
   * touching clips, and (unfolded) its keyframe lanes.
   *
   * Only clips in the visible window are drawn. Props are the track object
   * itself (replaced on every edit, never mutated) and plain numbers, so the
   * playhead moving does not re-render anything here.
   */
  import type { ShowLayerClip, ShowLayerTrack } from '../../../types';
  import { trackTransitionWindow } from '../../../show/tracks/showTrackEval';
  import { findJunctionPredecessor } from '../../../show/showJunctions';
  import ShowLayerClipBlock from './ShowLayerClipBlock.svelte';
  import KeyframeLaneView from './KeyframeLaneView.svelte';
  import { thumbnailFor } from './clipMedia';
  import { clipsInView, LANE_ROW_HEIGHT, TRACK_ROW_HEIGHT, type LaneKeySelection, type TrackLaneController } from './trackLayout';

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
  }

  let {
    track, index, zoom, viewStart, viewEnd, selectedIds, keySelection, thumbs, dropTime, inactiveLanes, laneRanges, ctl,
  }: Props = $props();

  const DEFAULT_COLOR = '#8b7cff';
  const color = $derived(track.color || DEFAULT_COLOR);
  const visible = $derived(clipsInView(track.clips, viewStart, viewEnd));

  /** Junctions between touching clips in view: drawn transitions or a
   *  ghost "add crossfade" button. */
  const junctions = $derived(visible
    .filter((c) => findJunctionPredecessor(track.clips, c))
    .map((c) => ({ clip: c, window: trackTransitionWindow(track.clips, c) })));

  const NO_TIMES: number[] = [];
  function selectedTimes(key: string): readonly number[] {
    return keySelection && keySelection.trackId === track.id && keySelection.key === key ? keySelection.times : NO_TIMES;
  }

  function onpress(e: MouseEvent, clip: ShowLayerClip, part: import('./trackLayout').ClipPart) {
    ctl.pressClip(e, track, clip, part);
  }

  function pressRow(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.lc-block') || target.closest('.tx') || target.closest('.tx-add')) return;
    ctl.pressEmpty(e, track);
  }
</script>

<div class="lt" data-track-id={track.id} data-track-index={index}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="lt-clips"
    class:locked={track.locked}
    class:muted={track.muted}
    class:drop={dropTime !== null}
    style:height="{TRACK_ROW_HEIGHT}px"
    style:--track-color={color}
    onmousedown={pressRow}
    ondragover={(e) => ctl.dragOver(e, track)}
    ondragleave={(e) => ctl.dragLeave(e)}
    ondrop={(e) => ctl.drop(e, track)}
  >
    {#each visible as clip (clip.id)}
      <ShowLayerClipBlock
        {clip}
        {zoom}
        selected={selectedIds.has(clip.id)}
        locked={track.locked}
        {color}
        thumb={thumbnailFor(thumbs, clip.media)}
        {onpress}
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
      <span class="lt-empty">Drop media from the tray or your computer here</span>
    {/if}
  </div>
  {#if !track.collapsed}
    {#each track.lanes as lane (lane.key)}
      <KeyframeLaneView
        {lane}
        {zoom}
        {viewStart}
        {viewEnd}
        height={LANE_ROW_HEIGHT}
        min={laneRanges[lane.key]?.min ?? 0}
        max={laneRanges[lane.key]?.max ?? 1}
        inactive={inactiveLanes.has(lane.key)}
        locked={track.locked}
        selectedTimes={selectedTimes(lane.key)}
        snap={ctl.snap}
        onaddkey={(time, value) => ctl.laneAddKey(track, lane.key, time, value)}
        onmovekey={(from, to, value, dragId) => ctl.laneMoveKey(track, lane.key, from, to, value, dragId)}
        onshiftkeys={(times, delta, dragId) => ctl.laneShiftKeys(track, lane.key, times, delta, dragId)}
        onselectkeys={(times, additive) => ctl.laneSelectKeys(track, lane.key, times, additive)}
        ondeletekeys={(times) => ctl.laneDeleteKeys(track, lane.key, times)}
        oneasing={(times, easing) => ctl.laneEasing(track, lane.key, times, easing)}
      />
    {/each}
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
