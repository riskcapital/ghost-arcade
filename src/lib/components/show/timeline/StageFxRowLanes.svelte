<script lang="ts">
  /**
   * The Stage group's Screen FX and Effects lanes: their blocks along the
   * Timeline. Drag a block to move it, its edges to trim it; drop a card from
   * the Composition panel's Screen FX / Effects tab on its row for a block
   * there (a copy of that effect with its settings). Where two blocks
   * overlap they crossfade (drawn as a cross).
   */
  import { showTimeline, type ShowTimelineSelection } from '../../../stores/showTimeline';
  import { showSlice } from './timelineSlices';
  import { carriesStageDrag, readStageDrag, type StageClipRow, type TimelineStageClip } from '../../../timeline/stagefx/stageClips';
  import type { Effect, StageEffect } from '../../../types';
  import { followPointer } from './dragSession';
  import { trimEdgeWidth } from './trackLayout';
  import { formatPrecise } from './timeFormat';
  import WhereBand from './WhereBand.svelte';
  import { STAGE_FX_ROWS, STAGE_FX_ROW_HEIGHT, STAGE_ROW_NAMES, blockName, newBlockEffect, newScreenFx, stageBlockBackground, stageFxRowAtY, stageRowOverlaps } from './stageFxRowsUi';

  interface Props {
    zoom: number;
    viewStart: number;
    viewEnd: number;
    width: number;
    selection: ShowTimelineSelection | null;
  }
  let { zoom, viewStart, viewEnd, width, selection }: Props = $props();

  let root: HTMLDivElement | undefined = $state();
  let dropRow: StageClipRow | null = $state(null);
  const stageClipsStore = showSlice('stageClips');
  const stageClips = $derived($stageClipsStore);

  const SLACK = 24;
  const byRow = $derived.by(() => {
    const out: Record<StageClipRow, TimelineStageClip[]> = { screenfx: [], effects: [] };
    const x0 = viewStart * zoom - SLACK;
    const x1 = viewEnd * zoom + SLACK;
    for (const c of stageClips) {
      if (c.startTime * zoom + Math.max(6, c.duration * zoom) < x0 || c.startTime * zoom > x1) continue;
      out[c.row].push(c);
    }
    return out;
  });
  /** Overlaps of each row (crossfades). */
  const overlaps = $derived(stageRowOverlaps(stageClips));

  function timeAt(e: MouseEvent): number {
    const r = root!.getBoundingClientRect();
    return Math.max(0, (e.clientX - r.left) / zoom);
  }
  function rowAt(e: MouseEvent): StageClipRow | null {
    const r = root!.getBoundingClientRect();
    return stageFxRowAtY(e.clientY - r.top);
  }

  function pressBlock(e: MouseEvent, clip: TimelineStageClip, part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind: 'stageClip', id: clip.id });
    const before = showTimeline.exportArrangement();
    const grab = timeAt(e) - clip.startTime;
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        if (part === 'body') showTimeline.moveStageClip(clip.id, timeAt(ev) - grab);
        else showTimeline.resizeStageClip(clip.id, part, timeAt(ev));
      },
      end: () => {},
      cancel: () => { if (moved) showTimeline.restoreArrangement(before); },
    });
  }

  function carries(e: DragEvent, row: StageClipRow | null): row is StageClipRow {
    return !!row && carriesStageDrag(e.dataTransfer, row);
  }
  function dragover(e: DragEvent) {
    const row = rowAt(e);
    const ok = carries(e, row);
    dropRow = ok ? row : null;
    if (!ok) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
  function drop(e: DragEvent) {
    const row = rowAt(e);
    dropRow = null;
    if (!carries(e, row)) return;
    const payload = readStageDrag(e.dataTransfer, row);
    if (!payload) return;
    e.preventDefault();
    e.stopPropagation();
    if (row === 'screenfx') {
      const fx = payload as StageEffect;
      showTimeline.addStageClip('screenfx', timeAt(e), { screenFx: newScreenFx(fx.type, fx) });
    } else {
      const fx = payload as Effect;
      showTimeline.addStageClip('effects', timeAt(e), { effect: newBlockEffect(fx.type, fx.params, fx) });
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sfx-lanes" bind:this={root} style:width="{width}px" ondragover={dragover} ondragleave={() => (dropRow = null)} ondrop={drop} data-stage-fx-lanes>
  {#each STAGE_FX_ROWS as row (row)}
    <div class="sfx-lane" class:effects={row === 'effects'} class:drop={dropRow === row} style:height="{STAGE_FX_ROW_HEIGHT}px" data-stage-fx-lane={row}>
      {#each byRow[row] as clip (clip.id)}
        {@const w = Math.max(6, clip.duration * zoom)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="sfx-block"
          class:effects={row === 'effects'}
          class:selected={selection?.kind === 'stageClip' && selection.id === clip.id}
          class:where={!!clip.where}
          style:left="{clip.startTime * zoom}px"
          style:width="{w}px"
          style:--edge-w="{trimEdgeWidth(w)}px"
          style:--sfx-bg={stageBlockBackground(clip)}
          onmousedown={(e) => pressBlock(e, clip, 'body')}
          onclick={(e) => e.stopPropagation()}
          title={`${STAGE_ROW_NAMES[row]}: ${blockName(clip)}, ${formatPrecise(clip.duration)}${clip.where ? ' (travels: where line)' : ''}`}
          data-stage-clip={clip.id}
        >
          <span class="swatch"></span>
          {#if clip.fadeIn > 0}<span class="fade in" style:width="{Math.min(w, clip.fadeIn * zoom)}px"></span>{/if}
          {#if clip.fadeOut > 0}<span class="fade out" style:width="{Math.min(w, clip.fadeOut * zoom)}px"></span>{/if}
          {#if clip.where}
            <WhereBand info={{ target: { scope: 'block', id: clip.id }, where: clip.where, start: clip.startTime, duration: clip.duration }} {zoom} tint={[92, 225, 230]} />
          {/if}
          <div class="handle left" onmousedown={(e) => pressBlock(e, clip, 'start')}></div>
          <span class="label">{blockName(clip)}</span>
          <div class="handle right" onmousedown={(e) => pressBlock(e, clip, 'end')}></div>
        </div>
      {/each}
      {#each overlaps[row] as { key, start: s, end: e } (key)}
        <svg class="xfade" style:left="{s * zoom}px" style:width="{Math.max(2, (e - s) * zoom)}px" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="0" x2="100" y2="100" /><line x1="0" y1="100" x2="100" y2="0" />
        </svg>
      {/each}
    </div>
  {/each}
</div>

<style>
  .sfx-lanes { position: relative; }
  .sfx-lane { position: relative; border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); box-sizing: border-box; background: rgba(92, 225, 230, 0.02); }
  .sfx-lane.effects { background: rgba(167, 139, 250, 0.03); }
  .sfx-lane.drop { background: rgba(92, 225, 230, 0.16); box-shadow: inset 0 0 0 1px rgba(92, 225, 230, 0.6); }
  .sfx-lane.effects.drop { background: rgba(167, 139, 250, 0.18); box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7); }
  .sfx-block {
    position: absolute; top: 3px; bottom: 3px; border-radius: 4px; overflow: hidden; box-sizing: border-box; cursor: grab; user-select: none;
    display: flex; align-items: center; padding: 0 8px; border: 1px solid rgba(92, 225, 230, 0.6); background: rgba(10, 18, 20, 0.92);
  }
  .sfx-block.effects { border-color: rgba(167, 139, 250, 0.65); background: rgba(16, 12, 24, 0.92); }
  .sfx-block:active { cursor: grabbing; }
  .sfx-block.selected { box-shadow: 0 0 0 1px #FFD96B, 0 0 10px rgba(255, 217, 107, 0.3); z-index: 3; }
  .swatch { position: absolute; inset: 0; background: var(--sfx-bg); pointer-events: none; }
  .sfx-block.where .swatch { top: auto; height: 5px; }
  .fade { position: absolute; top: 0; bottom: 0; pointer-events: none; }
  .fade.in { left: 0; background: linear-gradient(90deg, rgba(0, 0, 0, 0.55), transparent); }
  .fade.out { right: 0; background: linear-gradient(270deg, rgba(0, 0, 0, 0.55), transparent); }
  .label { position: relative; z-index: 1; font-size: 11px; font-weight: 600; color: #eef6f7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); pointer-events: none; }
  .handle { position: absolute; top: 0; bottom: 0; width: var(--edge-w, 6px); z-index: 2; cursor: ew-resize; }
  .handle.left { left: 0; }
  .handle.right { right: 0; }
  .handle:hover { background: rgba(255, 255, 255, 0.18); }
  .xfade { position: absolute; top: 3px; height: calc(100% - 6px); z-index: 4; pointer-events: none; }
  .xfade line { stroke: rgba(255, 255, 255, 0.55); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
</style>
