<script lang="ts">
  /**
   * The Timeline's Sections row: named, coloured spans along the top. Drag a
   * section to move it, its edges to resize it (both snap to bars), double-
   * click an empty stretch to add one there, click one to edit it. A section
   * holding, looping or handing pieces to the VJ decks shows it.
   */
  import { get } from 'svelte/store';
  import type { ShowTempoMap } from '../../../../types';
  import { showTimeline, showSectionStatus, type ShowTimelineSelection } from '../../../../stores/showTimeline';
  import { SECTION_ACTION_GLYPHS, SECTION_ACTION_LABELS, SECTION_MIN_SECONDS, makeSection, nearestBar, placeNewSection, type TimelineSection } from '../../../../timeline/sections/sectionModel';
  import { followPointer } from '../dragSession';
  import { formatPrecise } from '../timeFormat';

  interface Props {
    sections: TimelineSection[];
    tempo: ShowTempoMap | null;
    height: number;
    zoom: number;
    viewStart: number;
    viewEnd: number;
    selection: ShowTimelineSelection | null;
    snap: boolean;
  }
  let { sections, tempo, height, zoom, viewStart, viewEnd, selection, snap }: Props = $props();

  let laneEl: HTMLDivElement | undefined = $state();
  const EDGE_PX = 6;
  const visible = $derived(sections.filter((s) => s.end * zoom >= viewStart * zoom - 24 && s.start * zoom <= viewEnd * zoom + 24));
  const status = $derived($showSectionStatus);

  function timeAt(ev: MouseEvent): number {
    const r = laneEl?.getBoundingClientRect();
    return Math.max(0, ((ev.clientX - (r?.left ?? 0)) / zoom));
  }
  const snapT = (t: number, free: boolean) => (snap && !free ? nearestBar(tempo, t) : Math.max(0, Math.round(t * 100) / 100));

  function neighbours(id: string): { before: number; after: number } {
    const list = get(showTimeline).sections;
    const i = list.findIndex((s) => s.id === id);
    return { before: i > 0 ? list[i - 1].end : 0, after: i >= 0 && i < list.length - 1 ? list[i + 1].start : Infinity };
  }

  function startDrag(e: MouseEvent, s: TimelineSection) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind: 'section', id: s.id });
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const edge: 'start' | 'end' | 'move' = e.clientX - r.left <= EDGE_PX ? 'start' : r.right - e.clientX <= EDGE_PX ? 'end' : 'move';
    const t0 = timeAt(e);
    const orig = { start: s.start, end: s.end };
    const { before, after } = neighbours(s.id);
    const key = `drag-${s.id}-${Date.now()}`;
    let moved = false;
    followPointer({
      move: (ev) => {
        const free = ev.metaKey || ev.ctrlKey;
        const dt = timeAt(ev) - t0;
        if (!moved && Math.abs(dt * zoom) < 3) return;
        moved = true;
        let start = orig.start;
        let end = orig.end;
        if (edge === 'move') {
          const len = orig.end - orig.start;
          start = Math.min(Math.max(before, snapT(orig.start + dt, free)), after - len);
          end = start + len;
        } else if (edge === 'start') {
          start = Math.min(Math.max(before, snapT(orig.start + dt, free)), orig.end - SECTION_MIN_SECONDS);
        } else {
          end = Math.max(Math.min(after, snapT(orig.end + dt, free)), orig.start + SECTION_MIN_SECONDS);
        }
        showTimeline.updateSection(s.id, { start, end }, { continuousKey: key });
      },
      end: () => {},
      cancel: () => { if (moved) showTimeline.updateSection(s.id, orig, { continuousKey: key }); },
    });
  }

  function addAt(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.sec-block')) return;
    const s = get(showTimeline);
    const span = placeNewSection(s.sections, s.tempo, timeAt(e));
    if (!span) return;
    showTimeline.addSection(makeSection(s.sections, span.start, span.end));
  }

  function stateOf(s: TimelineSection): string {
    if (status.holdId === s.id) return s.action === 'live' ? 'Live: waiting for GO' : 'Holding: GO to go on';
    if (status.vampExitId === s.id) return 'Leaving after this pass';
    if (status.armed.includes(s.id)) return 'GO armed: plays on';
    if (status.liveId === s.id) return 'Live: pieces on the VJ decks';
    return '';
  }
  function title(s: TimelineSection): string {
    const extra = s.action === 'jump' ? ` → ${sections.find((x) => x.id === s.jumpTo)?.name ?? 'nothing'}${(s.passes ?? 1) > 1 ? ` after ${s.passes} passes` : ''}` : '';
    return `${s.name}: ${formatPrecise(s.start)}–${formatPrecise(s.end)}. At its end: ${SECTION_ACTION_LABELS[s.action]}${extra}. Drag to move, drag an edge to resize, click to edit.`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sec-lane" style="height: {height}px" bind:this={laneEl} ondblclick={addAt} data-section-lane>
  {#each visible as s (s.id)}
    {@const st = stateOf(s)}
    <div
      class="sec-block"
      class:selected={selection?.kind === 'section' && selection.id === s.id}
      class:holding={status.holdId === s.id}
      class:live={status.liveId === s.id}
      class:armed={status.armed.includes(s.id) || status.vampExitId === s.id}
      style="left: {s.start * zoom}px; width: {Math.max(4, (s.end - s.start) * zoom)}px; --sec: {s.color}"
      onmousedown={(e) => startDrag(e, s)}
      title={title(s)}
      data-section-id={s.id}
      data-section-name={s.name}
    >
      <span class="sec-name item-name">{s.name}</span>
      {#if s.action !== 'through'}<span class="sec-action" aria-label={SECTION_ACTION_LABELS[s.action]}>{SECTION_ACTION_GLYPHS[s.action]}</span>{/if}
      {#if st}<span class="sec-state">{st}</span>{/if}
    </div>
  {/each}
  {#if !sections.length}
    <span class="sec-empty">Double-click to add a section, or Score this song</span>
  {/if}
</div>

<style>
  .sec-lane {
    position: relative;
    border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    background: rgba(255, 255, 255, 0.015);
  }
  .sec-block {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--sec) 38%, transparent);
    border: 1px solid color-mix(in srgb, var(--sec) 80%, transparent);
    border-left-width: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    overflow: hidden;
    white-space: nowrap;
    cursor: grab;
    font-size: 11px;
    color: var(--text-primary, #eee);
    box-sizing: border-box;
  }
  .sec-block::before,
  .sec-block::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .sec-block::before { left: -3px; }
  .sec-block::after { right: 0; }
  .sec-block.selected { outline: 2px solid var(--accent-color, #5b8def); outline-offset: -1px; }
  .sec-block.holding { animation: sec-pulse 1s ease-in-out infinite; }
  .sec-block.live { background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--sec) 45%, transparent) 0 6px, color-mix(in srgb, var(--sec) 20%, transparent) 6px 12px); }
  .sec-block.armed { border-style: dashed; }
  .sec-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .sec-action { opacity: 0.9; }
  .sec-state { font-size: 10px; opacity: 0.85; color: #ffd36b; overflow: hidden; text-overflow: ellipsis; }
  .sec-empty {
    position: sticky;
    left: 8px;
    top: 0;
    line-height: 26px;
    font-size: 11px;
    opacity: 0.45;
    pointer-events: none;
  }
  @keyframes sec-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sec) 70%, transparent); }
    50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sec) 70%, transparent); }
  }
</style>
