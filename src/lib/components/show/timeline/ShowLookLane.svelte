<script lang="ts">
  /**
   * The Timeline's Looks row: one-click shape Looks laid out along the show.
   * A block dresses every shape (or the pieces it names) with its Look for
   * its span; where two blocks overlap they crossfade (the overlap is drawn
   * with a cross), touching blocks cut. Pointer edits are the tray's; this
   * draws. Look cards are dragged here from the Looks gallery.
   */
  import { trimEdgeWidth } from './trackLayout';
  import type { ShowLookClip } from '../../../types';
  import type { ShowTimelineSelection } from '../../../stores/showTimeline';
  import { edgeLook } from '../../../looks/edgeLookCatalog';
  import { lookPalette, type Rgba } from '../../../looks/edgeLooks';
  import { formatPrecise } from './timeFormat';
  import WhereBand from './WhereBand.svelte';
  import { lookPieces } from './whereUi';
  import { project } from '../../../stores/layers';

  interface Props {
    clips: ShowLookClip[];
    height: number;
    zoom: number;
    viewStart: number;
    viewEnd: number;
    selection: ShowTimelineSelection | null;
    /** A Look card is being dragged over the row. */
    dropActive: boolean;
    onblockdrag: (e: MouseEvent, id: string, startTime: number) => void;
    onblockresize: (e: MouseEvent, id: string, edge: 'start' | 'end') => void;
  }

  let { clips, height, zoom, viewStart, viewEnd, selection, dropActive, onblockdrag, onblockresize }: Props = $props();

  const SLACK_PX = 24;
  const x0 = $derived(viewStart * zoom - SLACK_PX);
  const x1 = $derived(viewEnd * zoom + SLACK_PX);
  const visible = $derived(clips.filter((c) => c.startTime * zoom + Math.max(6, c.duration * zoom) >= x0 && c.startTime * zoom <= x1));

  /** Where blocks overlap: the crossfades, drawn over both blocks. */
  const overlaps = $derived.by(() => {
    const out: Array<{ key: string; start: number; end: number }> = [];
    for (let i = 0; i < clips.length; i++) {
      for (let j = i + 1; j < clips.length; j++) {
        const a = clips[i];
        const b = clips[j];
        const start = Math.max(a.startTime, b.startTime);
        const end = Math.min(a.startTime + a.duration, b.startTime + b.duration);
        if (end - start > 1e-6) out.push({ key: `${a.id}:${b.id}`, start, end });
      }
    }
    return out;
  });

  const css = (c: Rgba) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
  function swatch(clip: ShowLookClip): string {
    const [a, b, c] = lookPalette(clip.paletteId).colors;
    return `linear-gradient(90deg, ${css(a)}, ${css(b)}, ${css(c)})`;
  }
  const lookName = (clip: ShowLookClip) => edgeLook(clip.lookId)?.name ?? 'Missing look';
  const scopeText = (clip: ShowLookClip) => clip.scope === 'pieces'
    ? `${clip.layerIds?.length ?? 0} piece${(clip.layerIds?.length ?? 0) === 1 ? '' : 's'}`
    : 'all shapes';
</script>

<div class="lane look-lane" class:drop-active={dropActive} style="height: {height}px" data-show-look-lane>
  {#each visible as clip (clip.id)}
    {@const w = Math.max(6, clip.duration * zoom)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="show-block look-block"
      class:selected={selection?.kind === 'lookClip' && selection.id === clip.id}
      style="left: {clip.startTime * zoom}px; width: {w}px; --edge-w: {trimEdgeWidth(w)}px; --look-swatch: {swatch(clip)}"
      onmousedown={(e) => onblockdrag(e, clip.id, clip.startTime)}
      title={`${lookName(clip)} (${lookPalette(clip.paletteId).name}) on ${scopeText(clip)}, ${formatPrecise(clip.duration)}. Overlap two looks to crossfade them.`}
      data-look-clip={clip.id}
    >
      <span class="look-swatch"></span>
      {#if clip.where}
        <WhereBand info={{ target: { scope: 'look', id: clip.id }, where: clip.where, start: clip.startTime, duration: clip.duration, pieces: lookPieces($project.layers ?? [], clip.scope, clip.layerIds) }} {zoom} />
      {/if}
      <div class="handle left" onmousedown={(e) => onblockresize(e, clip.id, 'start')}></div>
      <span class="block-label">{lookName(clip)}</span>
      {#if w > 120}<span class="block-dur">{scopeText(clip)}</span>{/if}
      <div class="handle right" onmousedown={(e) => onblockresize(e, clip.id, 'end')}></div>
    </div>
  {/each}
  {#each overlaps as o (o.key)}
    <div class="look-xfade" style="left: {o.start * zoom}px; width: {Math.max(2, (o.end - o.start) * zoom)}px" title="Crossfade between the two looks">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 0 L100 100 M0 100 L100 0" vector-effect="non-scaling-stroke" />
      </svg>
    </div>
  {/each}
  {#if clips.length === 0}
    <span class="lane-empty">Drag a Look from the Looks gallery here: the shapes wear it for the block's span.</span>
  {/if}
</div>

<style>
  .lane {
    position: relative;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    box-sizing: border-box;
  }
  .look-lane { background: rgba(140, 120, 255, 0.05); }
  .look-lane.drop-active { background: rgba(140, 120, 255, 0.16); box-shadow: inset 0 0 0 1px rgba(140, 120, 255, 0.6); }
  .lane-empty {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #55555f);
    pointer-events: none;
    white-space: nowrap;
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
  .look-block {
    background: linear-gradient(180deg, rgba(140, 120, 255, 0.26), rgba(140, 120, 255, 0.1));
    border: 1px solid rgba(160, 140, 255, 0.6);
    justify-content: space-between;
    padding: 0 8px;
  }
  .look-swatch {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
    background: var(--look-swatch);
    pointer-events: none;
  }
  .show-block.selected {
    box-shadow: 0 0 0 1px #FFD96B, 0 0 10px rgba(255, 217, 107, 0.3);
    z-index: 3;
  }
  .block-label {
    position: relative;
    z-index: 1;
    font-size: 11px;
    font-weight: 600;
    color: #e8e8ee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    pointer-events: none;
  }
  .block-dur {
    position: relative;
    z-index: 1;
    font-size: var(--ga-text-eyebrow, 10px);
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
    pointer-events: none;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--edge-w, 6px);
    z-index: 2;
    cursor: ew-resize;
  }
  .handle.left { left: 0; }
  .handle.right { right: 0; }
  .handle:hover { background: rgba(255, 255, 255, 0.18); }
  .look-xfade {
    position: absolute;
    top: 4px;
    bottom: 4px;
    z-index: 4;
    pointer-events: none;
    border-left: 1px solid rgba(255, 217, 107, 0.7);
    border-right: 1px solid rgba(255, 217, 107, 0.7);
    background: rgba(255, 217, 107, 0.1);
  }
  .look-xfade svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .look-xfade path { stroke: rgba(255, 217, 107, 0.85); stroke-width: 1; fill: none; }
</style>
