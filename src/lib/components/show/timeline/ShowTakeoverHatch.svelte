<script lang="ts">
  /**
   * The masked part of each taken-over track: hatched orange from the
   * takeover's start up to the playhead, over the track's clip row. Drawn
   * apart from the lanes, so the playhead moving re-renders only this.
   */
  import type { ShowLayerTrack } from '../../../types';
  import { showSlice } from './timelineSlices';
  import { liveTakeover } from '../../../show/takeover/liveTakeover';
  import { TRACK_ROW_HEIGHT, trackTops } from './trackLayout';
  import { lineLayout } from './lineUi';

  interface Props {
    tracks: ShowLayerTrack[];
    zoom: number;
  }

  let { tracks, zoom }: Props = $props();

  const tops = $derived(trackTops(tracks, $lineLayout));
  const currentTimeStore = showSlice('currentTime');
  const playhead = $derived($currentTimeStore);
  const spans = $derived.by(() => {
    const out: Array<{ trackId: string; top: number; left: number; width: number; returning: boolean }> = [];
    tracks.forEach((t, i) => {
      const o = $liveTakeover.surfaces[t.layerId];
      if (!o) return;
      const start = Math.min(o.startShowTime, playhead);
      const width = Math.max(0, (playhead - start) * zoom);
      out.push({ trackId: t.id, top: tops[i] ?? 0, left: start * zoom, width, returning: o.phase === 'pendingRelease' || o.phase === 'releasing' });
    });
    return out;
  });
</script>

{#each spans as sp (sp.trackId)}
  <div
    class="tk-hatch"
    class:returning={sp.returning}
    style:top="{sp.top + 2}px"
    style:left="{sp.left}px"
    style:width="{sp.width}px"
    style:height="{TRACK_ROW_HEIGHT - 4}px"
    data-takeover-hatch={sp.trackId}
  ></div>
{/each}

<style>
  .tk-hatch {
    position: absolute;
    z-index: 6;
    pointer-events: none;
    box-sizing: border-box;
    border-left: 2px solid #ff8c28;
    background:
      repeating-linear-gradient(135deg, rgba(255, 140, 40, 0.55) 0 4px, rgba(255, 140, 40, 0.12) 4px 9px);
    mix-blend-mode: normal;
  }
  .tk-hatch.returning { opacity: 0.6; }
</style>
