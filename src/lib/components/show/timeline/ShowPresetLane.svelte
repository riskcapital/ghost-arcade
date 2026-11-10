<script lang="ts">
  /**
   * The show's preset lane: composition blocks and the transitions on the
   * junctions between them. Pointer edits are the tray's (it owns the grid
   * geometry); this draws.
   *
   * Every prop keeps its identity while only the playhead moves, and only
   * the blocks and junctions in view are drawn, so a playing show re-renders
   * none of this.
   */
  import { trimEdgeWidth } from './trackLayout';
  import type { CompositionTransitionStyle, ShowPresetClip } from '../../../types';
  import type { ShowTimelineSelection } from '../../../stores/showTimeline';
  import { TRANSITION_OPTIONS } from '../../../stores/presetTransition';
  import type { PresetJunction } from './laneJunctions';
  import { formatPrecise } from './timeFormat';

  interface Props {
    clips: ShowPresetClip[];
    junctions: PresetJunction[];
    height: number;
    zoom: number;
    viewStart: number;
    viewEnd: number;
    selection: ShowTimelineSelection | null;
    activeClipId: string | null;
    /** Composition names by id. */
    names: ReadonlyMap<string, string | undefined>;
    transitionDragActive: boolean;
    transitionDropTarget: string | null;
    onblockdrag: (e: MouseEvent, id: string, startTime: number) => void;
    onblockresize: (e: MouseEvent, id: string, edge: 'start' | 'end') => void;
    ontransitionresize: (e: MouseEvent, clipId: string, boundary: number) => void;
    oncreatetransition: (clipId: string) => void;
    onselecttransition: (clipId: string) => void;
    onremovetransition: (clipId: string) => void;
  }

  let {
    clips, junctions, height, zoom, viewStart, viewEnd, selection, activeClipId, names,
    transitionDragActive, transitionDropTarget,
    onblockdrag, onblockresize, ontransitionresize, oncreatetransition, onselecttransition, onremovetransition,
  }: Props = $props();

  function compositionName(id: string, fallback?: string): string {
    return names.get(id) ?? fallback ?? 'Missing preset';
  }

  function transitionStyleLabel(style: CompositionTransitionStyle | null | undefined): string {
    return TRANSITION_OPTIONS.find((o) => o.value === style)?.label ?? 'Dissolve';
  }

  // What is on screen, in pixels: blocks keep a minimum drawn width and the
  // junction button sticks out either side of its boundary, so the test is
  // on the drawn box with some slack, not on show time alone.
  const SLACK_PX = 24;
  const x0 = $derived(viewStart * zoom - SLACK_PX);
  const x1 = $derived(viewEnd * zoom + SLACK_PX);
  const inView = (left: number, width: number) => left + width >= x0 && left <= x1;

  const visibleClips = $derived(clips.filter((c) => inView(c.startTime * zoom, Math.max(6, c.duration * zoom))));
  const visibleJunctions = $derived(junctions.filter((j) => (j.window
    ? inView(j.window.start * zoom, Math.max(10, j.window.duration * zoom))
    : inView(j.boundary * zoom, 0))));

  /**
   * How far a transition eats into each end of a clip, in pixels.
   *
   * The element is drawn ON TOP of the two clips it straddles, so without
   * this the clip's own name (left-aligned at its head) and its duration
   * (right-aligned at its tail) end up underneath the bowtie and read as
   * "e Grid" / a half-covered number. Pushing the text clear of the overlap
   * keeps both legible without moving the transition off the boundary it is
   * describing.
   */
  const clipTextInsets = $derived.by(() => {
    const map = new Map<string, { head: number; tail: number }>();
    for (const j of junctions) {
      if (!j.window) continue;
      const half = (j.window.duration / 2) * zoom;
      const incoming = map.get(j.clipId) ?? { head: 0, tail: 0 };
      map.set(j.clipId, { ...incoming, head: half });
      const outgoing = map.get(j.window.prev.id) ?? { head: 0, tail: 0 };
      map.set(j.window.prev.id, { ...outgoing, tail: half });
    }
    return map;
  });
</script>

<div class="lane preset-lane" style="height: {height}px">
  {#each visibleClips as clip (clip.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="show-block preset-block"
      class:selected={selection?.kind === 'preset' && selection.id === clip.id}
      class:live={activeClipId === clip.id}
      style="left: {clip.startTime * zoom}px; width: {Math.max(6, clip.duration * zoom)}px; --edge-w: {trimEdgeWidth(Math.max(6, clip.duration * zoom))}px"
      onmousedown={(e) => onblockdrag(e, clip.id, clip.startTime)}
      title={`${compositionName(clip.compositionId, clip.label)} — ${formatPrecise(clip.duration)}`}
    >
      <div class="handle left" onmousedown={(e) => onblockresize(e, clip.id, 'start')}></div>
      <span
        class="block-label"
        style="margin-left: {clipTextInsets.get(clip.id)?.head ?? 0}px"
      >{compositionName(clip.compositionId, clip.label)}</span>
      <span
        class="block-dur"
        style="margin-right: {clipTextInsets.get(clip.id)?.tail ?? 0}px"
      >{formatPrecise(clip.duration)}</span>
      <div class="handle right" onmousedown={(e) => onblockresize(e, clip.id, 'end')}></div>
    </div>
  {/each}
  <!-- Transitions. Drawn AFTER the clips so they sit on top of the
       two blocks they straddle — the element's left/right edges
       are literally where the blend starts and ends. -->
  {#each visibleJunctions as junction (junction.clipId)}
    {#if junction.window}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="show-transition"
        class:selected={selection?.kind === 'transition' && selection.id === junction.clipId}
        style="left: {junction.window.start * zoom}px; width: {Math.max(10, junction.window.duration * zoom)}px"
        onmousedown={(e) => {
          e.stopPropagation();
          onselecttransition(junction.clipId);
        }}
        ondblclick={() => onremovetransition(junction.clipId)}
        title={`${transitionStyleLabel(junction.window.style)} — ${junction.window.duration.toFixed(2)}s centred on ${formatPrecise(junction.boundary)}. Drag an edge to retime, double-click to remove.`}
      >
        <div
          class="xf-handle left"
          onmousedown={(e) => ontransitionresize(e, junction.clipId, junction.boundary)}
        ></div>
        <svg class="xf-bowtie" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0 L100 100 M0 100 L100 0" vector-effect="non-scaling-stroke" />
        </svg>
        {#if junction.window.duration * zoom > 44}
          <span class="xf-dur">{junction.window.duration.toFixed(2)}s</span>
        {/if}
        <div
          class="xf-handle right"
          onmousedown={(e) => ontransitionresize(e, junction.clipId, junction.boundary)}
        ></div>
      </div>
    {:else}
      <!-- Hard cut: a ghost marker on the junction. Appears on
           hover, and lights up while a Transition chip is being
           dragged over it. One click adds the transition. -->
      <button
        class="junction-add"
        class:targeted={transitionDropTarget === junction.clipId}
        class:arming={transitionDragActive}
        style="left: {junction.boundary * zoom}px"
        onclick={(e) => { e.stopPropagation(); oncreatetransition(junction.clipId); }}
        title="Add a transition at this junction"
        aria-label="Add a transition at this junction"
      >
        <svg width="13" height="9" viewBox="0 0 15 10" aria-hidden="true">
          <path d="M0.5 0.5 L7.5 5 L0.5 9.5 Z M14.5 0.5 L7.5 5 L14.5 9.5 Z"
                fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1"/>
        </svg>
      </button>
    {/if}
  {/each}
  {#if clips.length === 0}
    <span class="lane-empty">Drop a preset card here, or use “+ Preset”.</span>
  {/if}
</div>

<style>
  /* Moved with the markup from ShowTimeline.svelte; keep the two in step
     (.lane, .show-block, .handle and .block-label are also drawn there and
     in ShowAudioLane.svelte). */
  .lane {
    position: relative;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    box-sizing: border-box;
  }
  .preset-lane { background: rgba(255, 111, 94, 0.04); }
  .lane-empty {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #55555f);
    pointer-events: none;
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
  .preset-block {
    background: linear-gradient(180deg, color-mix(in srgb, var(--ga-coral, #ff6f5e) 24%, transparent), color-mix(in srgb, var(--ga-coral, #ff6f5e) 10%, transparent));
    border: 1px solid color-mix(in srgb, var(--ga-coral, #ff6f5e) 50%, transparent);
    justify-content: space-between;
    padding: 0 8px;
  }
  .preset-block.live {
    border-color: #FFD96B;
    box-shadow: 0 0 0 1px rgba(255, 217, 107, 0.5), 0 0 12px rgba(255, 217, 107, 0.25);
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
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    pointer-events: none;
  }
  .preset-block .block-label { padding: 0; }
  .block-dur {
    position: relative;
    z-index: 1;
    font-size: var(--ga-text-eyebrow, 10px);
    color: rgba(255, 255, 255, 0.55);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    white-space: nowrap;
    pointer-events: none;
  }

  /* ── Junction transitions ──────────────────────────────────────────────
     The element straddles the boundary: its left edge IS the show time the
     blend starts and its right edge IS where it ends, so the picture on the
     timeline and what the renderer does cannot drift apart. Amber to match
     the playhead/live-clip language; the clip blocks are coral. */
  .show-transition {
    position: absolute;
    top: 3px;
    bottom: 3px;
    z-index: 4;
    border-radius: 3px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, rgba(255, 217, 107, 0.28), rgba(255, 217, 107, 0.12));
    border: 1px solid rgba(255, 217, 107, 0.75);
    cursor: pointer;
    overflow: hidden;
    user-select: none;
  }
  .show-transition:hover { background: linear-gradient(180deg, rgba(255, 217, 107, 0.4), rgba(255, 217, 107, 0.18)); }
  .show-transition.selected {
    border-color: #FFD96B;
    box-shadow: 0 0 0 1px #FFD96B, 0 0 12px rgba(255, 217, 107, 0.45);
    z-index: 5;
  }
  /* The classic bowtie/X. `preserveAspectRatio: none` + non-scaling-stroke
     keeps the crossing lines spanning the whole element at any duration or
     zoom without the stroke smearing. */
  .xf-bowtie {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .xf-bowtie path {
    stroke: rgba(255, 217, 107, 0.85);
    stroke-width: 1;
    fill: none;
  }
  .xf-dur {
    position: relative;
    z-index: 1;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: #1a1408;
    background: rgba(255, 217, 107, 0.92);
    border-radius: 2px;
    padding: 1px 4px;
    pointer-events: none;
    white-space: nowrap;
  }
  .xf-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    z-index: 2;
    cursor: ew-resize;
  }
  .xf-handle.left { left: 0; }
  .xf-handle.right { right: 0; }
  .xf-handle:hover { background: rgba(255, 255, 255, 0.35); }

  /* Ghost marker on a junction that is currently a hard cut. Invisible
     until the lane is hovered (or a transition chip is in flight) so a
     dense arrangement is not covered in permanent buttons. */
  .junction-add {
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
  .preset-lane:hover .junction-add,
  .junction-add.arming { opacity: 1; }
  .junction-add:hover,
  .junction-add.targeted {
    opacity: 1;
    border-style: solid;
    border-color: #FFD96B;
    color: #FFD96B;
    box-shadow: 0 0 10px rgba(255, 217, 107, 0.5);
  }

  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--edge-w, 7px);
    z-index: 2;
    cursor: ew-resize;
  }
  .handle.left { left: 0; }
  .handle.right { right: 0; }
  .handle:hover { background: rgba(255, 255, 255, 0.25); }
</style>
