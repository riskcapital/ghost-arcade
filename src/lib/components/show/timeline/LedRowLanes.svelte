<script lang="ts">
  /**
   * The LEDs group's lanes: each LED row's blocks along the Timeline. Drag a
   * block to move it (also onto another LED row), its edges to trim it;
   * double-click an empty stretch for a Colour block there; drop a Look card
   * on a row for a Look block. A block with a where line shows its band.
   */
  import { showTimeline, type ShowTimelineSelection } from '../../../stores/showTimeline';
  import { ledClipName, type TimelineLedClip } from '../../../timeline/leds/ledClips';
  import { readEdgeLookDrag, carriesEdgeLook } from '../../../looks/edgeLookDrag';
  import { followPointer } from './dragSession';
  import { trimEdgeWidth } from './trackLayout';
  import { formatPrecise } from './timeFormat';
  import WhereBand from './WhereBand.svelte';
  import { ledRows, ledGroupFolded, ledBlockBackground, ledRowAtY, LED_GROUP_HEADER_HEIGHT, LED_ROW_HEIGHT, newLedBlockFields, LED_KIND_LABELS } from './ledRowsUi';

  interface Props {
    zoom: number;
    viewStart: number;
    viewEnd: number;
    width: number;
    selection: ShowTimelineSelection | null;
  }
  let { zoom, viewStart, viewEnd, width, selection }: Props = $props();

  let root: HTMLDivElement | undefined = $state();
  let dropRow: string | null = $state(null);

  const SLACK = 24;
  const clipsByRow = $derived.by(() => {
    const out = new Map<string, TimelineLedClip[]>();
    const x0 = viewStart * zoom - SLACK;
    const x1 = viewEnd * zoom + SLACK;
    for (const c of $showTimeline.ledClips) {
      if (c.startTime * zoom + Math.max(6, c.duration * zoom) < x0 || c.startTime * zoom > x1) continue;
      const list = out.get(c.rowId) ?? [];
      list.push(c);
      out.set(c.rowId, list);
    }
    return out;
  });

  function timeAt(e: MouseEvent): number {
    const r = root!.getBoundingClientRect();
    return Math.max(0, (e.clientX - r.left) / zoom);
  }
  function rowAt(e: MouseEvent) {
    const r = root!.getBoundingClientRect();
    return ledRowAtY(e.clientY - r.top, $ledRows);
  }

  function pressBlock(e: MouseEvent, clip: TimelineLedClip, part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind: 'ledClip', id: clip.id });
    const before = showTimeline.exportArrangement();
    const grab = timeAt(e) - clip.startTime;
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        if (part === 'body') showTimeline.moveLedClip(clip.id, timeAt(ev) - grab, rowAt(ev)?.id);
        else showTimeline.resizeLedClip(clip.id, part, timeAt(ev));
      },
      end: () => {},
      cancel: () => { if (moved) showTimeline.restoreArrangement(before); },
    });
  }

  function dblclick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-led-clip]')) return;
    const row = rowAt(e);
    if (!row) return;
    e.stopPropagation();
    showTimeline.addLedClip(row.id, timeAt(e), newLedBlockFields('colour'));
  }

  function dragover(e: DragEvent) {
    if (!carriesEdgeLook(e.dataTransfer)) return;
    const row = rowAt(e);
    dropRow = row?.id ?? null;
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
  function drop(e: DragEvent) {
    const look = readEdgeLookDrag(e.dataTransfer);
    const row = rowAt(e);
    dropRow = null;
    if (!look || !row) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.addLedClip(row.id, timeAt(e), { ...newLedBlockFields('look'), lookId: look.lookId, paletteId: look.paletteId || 'neon' });
  }
</script>

{#if $ledRows.length}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="led-lanes" bind:this={root} style:width="{width}px" ondblclick={dblclick} ondragover={dragover} ondragleave={() => (dropRow = null)} ondrop={drop} data-led-lanes>
    <div class="led-group-strip" style:height="{LED_GROUP_HEADER_HEIGHT}px"></div>
    {#if !$ledGroupFolded}
      {#each $ledRows as row (row.id)}
        {@const clips = clipsByRow.get(row.id) ?? []}
        <div class="led-lane" class:drop={dropRow === row.id} class:range={row.kind === 'range'} style:height="{LED_ROW_HEIGHT}px" data-led-lane={row.id}>
          {#each clips as clip (clip.id)}
            {@const w = Math.max(6, clip.duration * zoom)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="led-block"
              class:selected={selection?.kind === 'ledClip' && selection.id === clip.id}
              class:where={!!clip.where}
              style:left="{clip.startTime * zoom}px"
              style:width="{w}px"
              style:--edge-w="{trimEdgeWidth(w)}px"
              style:--led-bg={ledBlockBackground(clip)}
              onmousedown={(e) => pressBlock(e, clip, 'body')}
              onclick={(e) => e.stopPropagation()}
              title={`${LED_KIND_LABELS[clip.kind]}: ${ledClipName(clip)}, ${formatPrecise(clip.duration)}${clip.where ? ' (travels: where line)' : ''}`}
              data-led-clip={clip.id}
            >
              <span class="swatch"></span>
              {#if clip.where}
                <WhereBand info={{ target: { scope: 'block', id: clip.id }, where: clip.where, start: clip.startTime, duration: clip.duration }} {zoom} tint={[255, 159, 67]} />
              {/if}
              <div class="handle left" onmousedown={(e) => pressBlock(e, clip, 'start')}></div>
              <span class="label">{ledClipName(clip)}</span>
              <div class="handle right" onmousedown={(e) => pressBlock(e, clip, 'end')}></div>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .led-lanes { position: relative; }
  .led-group-strip { border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); background: rgba(255, 159, 67, 0.05); box-sizing: border-box; }
  .led-lane { position: relative; border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); box-sizing: border-box; background: rgba(255, 159, 67, 0.02); }
  .led-lane.drop { background: rgba(255, 159, 67, 0.16); box-shadow: inset 0 0 0 1px rgba(255, 159, 67, 0.6); }
  .led-block {
    position: absolute; top: 3px; bottom: 3px; border-radius: 4px; overflow: hidden; box-sizing: border-box; cursor: grab; user-select: none;
    display: flex; align-items: center; padding: 0 8px; border: 1px solid rgba(255, 159, 67, 0.65); background: rgba(20, 16, 12, 0.9);
  }
  .led-block:active { cursor: grabbing; }
  .led-block.selected { box-shadow: 0 0 0 1px #FFD96B, 0 0 10px rgba(255, 217, 107, 0.3); z-index: 3; }
  .swatch { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: var(--led-bg); pointer-events: none; }
  .led-block:not(.where) .swatch { top: 0; height: auto; opacity: 0.55; }
  .label { position: relative; z-index: 1; font-size: 11px; font-weight: 600; color: #f4f0ea; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); pointer-events: none; }
  .handle { position: absolute; top: 0; bottom: 0; width: var(--edge-w, 6px); z-index: 2; cursor: ew-resize; }
  .handle.left { left: 0; }
  .handle.right { right: 0; }
  .handle:hover { background: rgba(255, 255, 255, 0.18); }
</style>
