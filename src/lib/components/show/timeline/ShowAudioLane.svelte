<script lang="ts">
  /**
   * One audio lane of the show: its tracks as blocks with a peak-envelope
   * waveform. Pointer edits are the tray's; this draws.
   *
   * Props keep their identity while only the playhead moves, only blocks in
   * view are drawn, and a waveform path is built once per track slice
   * (moving a track or zooming reuses it).
   */
  import type { ShowAudioTrack } from '../../../types';
  import type { ShowTimelineSelection } from '../../../stores/showTimeline';
  import { cachedWavePath, WAVE_VIEW_H } from './waveform';
  import { formatPrecise } from './timeFormat';

  interface Props {
    /** The tracks on this lane. */
    tracks: ShowAudioTrack[];
    height: number;
    zoom: number;
    viewStart: number;
    viewEnd: number;
    selection: ShowTimelineSelection | null;
    /** Show the "drop a song" hint (the first lane of a show with no audio). */
    empty: boolean;
    onpicksong: () => void;
    onblockdrag: (e: MouseEvent, id: string, startTime: number) => void;
    onblockresize: (e: MouseEvent, id: string, edge: 'start' | 'end') => void;
  }

  let { tracks, height, zoom, viewStart, viewEnd, selection, empty, onpicksong, onblockdrag, onblockresize }: Props = $props();

  const SLACK_PX = 24;
  const visible = $derived.by(() => {
    const x0 = viewStart * zoom - SLACK_PX;
    const x1 = viewEnd * zoom + SLACK_PX;
    return tracks.filter((t) => {
      const left = t.startTime * zoom;
      return left + Math.max(6, t.duration * zoom) >= x0 && left <= x1;
    });
  });
</script>

<div class="lane audio-lane" style="height: {height}px">
  {#if empty}
    <span class="lane-empty lane-empty-audio">
      Drop a song here, or
      <button class="lane-empty-btn" onclick={(e) => { e.stopPropagation(); onpicksong(); }}>build a show from a song…</button>
    </span>
  {/if}
  {#each visible as track (track.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="show-block audio-block"
      class:selected={selection?.kind === 'audio' && selection.id === track.id}
      class:missing={!track.url}
      class:muted={track.muted}
      style="left: {track.startTime * zoom}px; width: {Math.max(6, track.duration * zoom)}px"
      onmousedown={(e) => onblockdrag(e, track.id, track.startTime)}
      title={`${track.name} — ${formatPrecise(track.duration)}${track.url ? '' : ' (media missing)'}`}
    >
      <div class="handle left" onmousedown={(e) => onblockresize(e, track.id, 'start')}></div>
      <svg class="wave" viewBox="0 0 1000 {WAVE_VIEW_H}" preserveAspectRatio="none" aria-hidden="true">
        <path d={cachedWavePath(track.peaks, track.offset, track.duration, track.sourceDuration)} />
      </svg>
      <span class="block-label">
        {track.muted ? '🔇 ' : ''}{track.name}
      </span>
      <div class="handle right" onmousedown={(e) => onblockresize(e, track.id, 'end')}></div>
    </div>
  {/each}
</div>

<style>
  /* Moved with the markup from ShowTimeline.svelte; keep the two in step
     (.lane, .show-block, .handle and .block-label are also drawn there and
     in ShowPresetLane.svelte). */
  .lane {
    position: relative;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    box-sizing: border-box;
  }
  .audio-lane { background: rgba(255, 255, 255, 0.012); }
  .lane-empty {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #55555f);
    pointer-events: none;
  }
  .lane-empty-audio { pointer-events: auto; color: var(--ga-ink-2, #6b6b76); }
  .lane-empty-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--ga-ink-0, #fff);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    text-underline-offset: 2px;
  }

  .show-block {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    user-select: none;
  }
  .show-block:active { cursor: grabbing; }
  .audio-block {
    background: linear-gradient(180deg, rgba(92, 225, 230, 0.16), rgba(92, 225, 230, 0.07));
    border: 1px solid rgba(92, 225, 230, 0.45);
  }
  .audio-block.muted { opacity: 0.45; }
  .audio-block.missing {
    background: rgba(255, 71, 87, 0.12);
    border-color: rgba(255, 71, 87, 0.5);
  }
  .show-block.selected {
    box-shadow: 0 0 0 1px #FFD96B, 0 0 10px rgba(255, 217, 107, 0.3);
    z-index: 3;
  }

  .wave {
    position: absolute;
    inset: 4px 0;
    width: 100%;
    height: calc(100% - 8px);
    pointer-events: none;
  }
  .wave path { fill: rgba(92, 225, 230, 0.55); }

  .block-label {
    position: relative;
    z-index: 1;
    font-size: 11px;
    font-weight: 600;
    color: #e8e8ee;
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    pointer-events: none;
  }

  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    z-index: 2;
    cursor: ew-resize;
  }
  .handle.left { left: 0; }
  .handle.right { right: 0; }
  .handle:hover { background: rgba(255, 255, 255, 0.25); }
</style>
