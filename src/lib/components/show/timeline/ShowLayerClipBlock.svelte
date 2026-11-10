<script lang="ts">
  /**
   * One clip on a layer track.
   *
   * Drawn from the clip alone (plus zoom and selection), so the playhead
   * moving never re-renders it. Every press goes up through `onpress` with
   * the part that was grabbed; the track stack owns the drags.
   *
   * - Body: move (and onto other tracks).
   * - Left edge: trim the start, moving the in-point with it.
   * - Right edge: trim the end ('stop' clips cannot outlast their media).
   * - Top corners: fade in / fade out handles.
   * - Loop notches: where a looping video wraps back.
   * - Hatched: where a 'hold' clip sits on its last frame.
   */
  import type { ShowLayerClip } from '../../../types';
  import { clipFades, clipLoopStart, clipRate, mediaEnd, SHOW_CLIP_END_GUARD_SECONDS } from '../../../show/tracks/showTrackEval';
  import type { ClipPart } from './trackLayout';

  interface Props {
    clip: ShowLayerClip;
    zoom: number;
    selected: boolean;
    locked: boolean;
    color: string;
    thumb: string | null;
    onpress: (e: MouseEvent, clip: ShowLayerClip, part: ClipPart) => void;
    ondoubleclick?: (clip: ShowLayerClip) => void;
    oncontext?: (e: MouseEvent, clip: ShowLayerClip) => void;
  }

  let { clip, zoom, selected, locked, color, thumb, onpress, ondoubleclick, oncontext }: Props = $props();

  const left = $derived(clip.startTime * zoom);
  const width = $derived(Math.max(4, clip.duration * zoom));
  const fades = $derived(clipFades(clip));
  const fadeInPx = $derived(fades.fadeIn * zoom);
  const fadeOutPx = $derived(fades.fadeOut * zoom);
  const name = $derived(clip.label || clip.media.name);

  /** Show-time offsets (from the clip start) where a looping video wraps. */
  const loopNotches = $derived.by(() => {
    if (clip.media.kind !== 'video' || clip.endBehaviour !== 'loop') return [] as number[];
    const end = mediaEnd(clip.media);
    if (!Number.isFinite(end)) return [];
    const rate = clipRate(clip);
    const first = (end - clip.inPoint) / rate;
    const span = (end - Math.min(clipLoopStart(clip), end - SHOW_CLIP_END_GUARD_SECONDS)) / rate;
    if (!(span > 0.05)) return [];
    const out: number[] = [];
    for (let t = first; t < clip.duration - 1e-6 && out.length < 400; t += span) if (t > 1e-6) out.push(t);
    return out;
  });

  /** Seconds from the clip start where a 'hold' clip freezes, or null. */
  const holdFrom = $derived.by(() => {
    if (clip.media.kind !== 'video' || clip.endBehaviour !== 'hold') return null;
    const end = mediaEnd(clip.media);
    if (!Number.isFinite(end)) return null;
    const at = (end - SHOW_CLIP_END_GUARD_SECONDS - clip.inPoint) / clipRate(clip);
    return at < clip.duration ? Math.max(0, at) : null;
  });

  const KIND_ICON: Record<string, string> = { video: '▶', image: '▣', shader: '◈', sketch: '✎', layer: '◻' };

  function fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`;
  }

  function press(e: MouseEvent, part: ClipPart) {
    onpress(e, clip, part);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="lc-block"
  class:selected
  class:locked
  class:narrow={width < 48}
  style:left="{left}px"
  style:width="{width}px"
  style:--clip-color={clip.color || color}
  data-clip-id={clip.id}
  onmousedown={(e) => press(e, 'body')}
  ondblclick={() => ondoubleclick?.(clip)}
  oncontextmenu={(e) => { if (oncontext) { e.preventDefault(); e.stopPropagation(); oncontext(e, clip); } }}
  title={`${name} · ${fmt(clip.duration)}`}
>
  {#if thumb}
    <div class="lc-thumb" style:background-image={`url("${thumb}")`}></div>
  {:else}
    <span class="lc-kind" aria-hidden="true">{KIND_ICON[clip.media.kind] ?? '▣'}</span>
  {/if}
  <span class="lc-name clip-name">{name}</span>
  {#if width > 90}
    <span class="lc-dur">{fmt(clip.duration)}</span>
  {/if}

  {#if holdFrom !== null}
    <div class="lc-hold" style:left="{holdFrom * zoom}px" title="Holds the last frame from here"></div>
  {/if}
  {#each loopNotches as notch (notch)}
    <div class="lc-notch" style:left="{notch * zoom}px"></div>
  {/each}

  {#if fadeInPx > 0.5 || fadeOutPx > 0.5}
    <svg class="lc-fades" width={width} height="100%" viewBox="0 0 {width} 100" preserveAspectRatio="none" aria-hidden="true">
      {#if fadeInPx > 0.5}
        <path d="M0 0 L{fadeInPx} 0 L0 100 Z" class="lc-fade-shade" />
        <path d="M0 100 L{fadeInPx} 0" class="lc-fade-line" vector-effect="non-scaling-stroke" />
      {/if}
      {#if fadeOutPx > 0.5}
        <path d="M{width} 0 L{width - fadeOutPx} 0 L{width} 100 Z" class="lc-fade-shade" />
        <path d="M{width - fadeOutPx} 0 L{width} 100" class="lc-fade-line" vector-effect="non-scaling-stroke" />
      {/if}
    </svg>
  {/if}

  {#if !locked}
    <div class="lc-edge left" onmousedown={(e) => press(e, 'start')} title="Drag to trim the start"></div>
    <div class="lc-edge right" onmousedown={(e) => press(e, 'end')} title="Drag to trim the end"></div>
    {#if width >= 28}
      <div class="lc-fade-handle in" style:left="{Math.min(fadeInPx, width - 8)}px" onmousedown={(e) => press(e, 'fadeIn')} title="Drag to fade in"></div>
      <div class="lc-fade-handle out" style:left="{Math.max(0, width - fadeOutPx - 8)}px" onmousedown={(e) => press(e, 'fadeOut')} title="Drag to fade out"></div>
    {/if}
  {/if}
</div>

<style>
  .lc-block {
    --clip-color: #8b7cff;
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: 4px;
    overflow: hidden;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 6px;
    cursor: grab;
    user-select: none;
    background: linear-gradient(180deg, color-mix(in srgb, var(--clip-color) 28%, transparent), color-mix(in srgb, var(--clip-color) 12%, transparent));
    border: 1px solid color-mix(in srgb, var(--clip-color) 55%, transparent);
  }
  .lc-block:active { cursor: grabbing; }
  .lc-block.locked { cursor: default; opacity: 0.7; }
  .lc-block.selected {
    box-shadow: 0 0 0 1px #FFD96B, 0 0 10px rgba(255, 217, 107, 0.3);
    z-index: 3;
  }
  .lc-thumb {
    flex: 0 0 auto;
    align-self: stretch;
    width: 54px;
    max-width: 40%;
    background-size: cover;
    background-position: center;
    border-right: 1px solid color-mix(in srgb, var(--clip-color) 40%, transparent);
    pointer-events: none;
  }
  .lc-kind {
    flex: 0 0 auto;
    margin-left: 7px;
    font-size: 11px;
    color: color-mix(in srgb, var(--clip-color) 70%, #ffffff);
    pointer-events: none;
  }
  .lc-name {
    position: relative;
    z-index: 1;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11px;
    font-weight: 600;
    color: #e8e8ee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    pointer-events: none;
  }
  .lc-block.narrow .lc-name { display: none; }
  .lc-dur {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    font-size: var(--ga-text-eyebrow, 10px);
    color: rgba(255, 255, 255, 0.55);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    pointer-events: none;
  }
  .lc-hold {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    pointer-events: none;
    background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.13) 0 3px, transparent 3px 7px);
    border-left: 1px dashed rgba(255, 255, 255, 0.45);
  }
  .lc-notch {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px dotted rgba(255, 255, 255, 0.5);
    pointer-events: none;
  }
  .lc-notch::before {
    content: '';
    position: absolute;
    top: 0;
    left: -4px;
    border: 4px solid transparent;
    border-top-color: rgba(255, 255, 255, 0.75);
  }
  .lc-fades {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    pointer-events: none;
  }
  .lc-fade-shade { fill: rgba(0, 0, 0, 0.45); }
  .lc-fade-line { stroke: rgba(255, 255, 255, 0.7); stroke-width: 1; fill: none; }
  .lc-edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    z-index: 2;
    cursor: ew-resize;
  }
  .lc-edge.left { left: 0; }
  .lc-edge.right { right: 0; }
  .lc-edge:hover { background: rgba(255, 255, 255, 0.25); }
  .lc-fade-handle {
    position: absolute;
    top: 0;
    width: 8px;
    height: 8px;
    z-index: 4;
    cursor: ew-resize;
    background: #ffffff;
    border-radius: 0 0 2px 2px;
    opacity: 0;
    transition: opacity 0.1s ease;
  }
  .lc-block:hover .lc-fade-handle,
  .lc-block.selected .lc-fade-handle { opacity: 0.85; }
  .lc-fade-handle:hover { opacity: 1; box-shadow: 0 0 6px rgba(255, 255, 255, 0.8); }
</style>
