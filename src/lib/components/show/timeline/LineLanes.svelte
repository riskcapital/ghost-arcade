<script lang="ts">
  /**
   * A group's control lines in the grid (under a row, the Looks row or the
   * Stage row): collapsed, every curve overlaid in its colour with its
   * points; expanded, one lane per line (and a thin depth lane for a line
   * whose follow depth is drawn).
   *
   * - Click an empty spot: a point there on the line being edited (the
   *   selected one; in the overlay, click a curve first to pick it).
   * - Drag a point (or the selection): time and value, snapped to the grid
   *   (Cmd/Ctrl: free). Alt-drag a selection of two or more: scale it
   *   (sideways in time, up/down in value).
   * - Drag on an empty spot: select the points in the box; Shift-click adds.
   * - Right-click a point: its curve to the next point, or delete. Delete /
   *   Backspace deletes the selected points.
   * - Pen (transport): press and draw; the stroke is thinned to a few points.
   * Every gesture is one undo step. Esc while dragging puts it back.
   * A line that follows something shows that as a faint trace behind it.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import type { ControlLine, LineCurve, LinePoint } from '../../../timeline/lines/lineModel';
  import { LINE_CURVES, isLiveOnlySource } from '../../../timeline/lines/lineModel';
  import { lineValueAt } from '../../../timeline/lines/lineEvaluator';
  import { scaleOffsetPoints, strokeToPoints, spliceStroke } from '../../../timeline/lines/lineDrawing';
  import { currentLineSession, lineSelection, liveTraces, liveTraceVersion, recordingPasses, selectedLinePoints } from '../../../timeline/lines/timelineLines';
  import {
    LINE_DEPTH_HEIGHT,
    LINE_LANE_HEIGHT,
    LINE_OVERLAY_HEIGHT,
    activeLineIn,
    curvePath,
    defaultCurveFor,
    deletePoints,
    dragPoints,
    hitOverlay,
    hitPoint,
    insertPoint,
    linePenTool,
    pointsInRect,
    setPointCurves,
    tracePath,
    valueToY,
    yToValue,
  } from './lineUi';
  import { portal } from './trackLayout';
  import { followPointer } from './dragSession';

  interface Props {
    groupId: string;
    lines: ControlLine[];
    expanded: boolean;
    zoom: number;
    viewStart: number;
    viewEnd: number;
    locked?: boolean;
    /** Spans of the blocks whose lines are here (they act only inside them). */
    blockSpans?: Record<string, { start: number; end: number }>;
  }

  let { groupId, lines, expanded, zoom, viewStart, viewEnd, locked = false, blockSpans = {} }: Props = $props();

  type Channel = 'points' | 'depth';
  const sel = $derived($lineSelection);
  const pen = $derived($linePenTool);
  const active = $derived(activeLineIn(lines, sel?.lineId));
  const x0 = $derived(Math.max(0, viewStart) * zoom);
  const w = $derived(Math.max(1, (viewEnd - Math.max(0, viewStart)) * zoom + 8));
  const t0 = $derived(Math.max(0, viewStart));
  const t1 = $derived(Math.max(t0 + 0.001, viewEnd));
  const CURVE_NAMES: Record<LineCurve, string> = {
    hold: 'Hold', linear: 'Linear', smooth: 'Smooth', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in and out',
    sine: 'Sine', exponential: 'Exponential', bounce: 'Bounce', elastic: 'Elastic',
  };

  function colorOf(line: ControlLine): string {
    return line.color ?? '#ff5c8a';
  }
  function pointsOf(line: ControlLine, ch: Channel): LinePoint[] {
    return ch === 'depth' ? line.follow?.depthPoints ?? [] : line.points;
  }
  function rangeOf(line: ControlLine, ch: Channel): [number, number] {
    if (ch === 'depth') return [0, 1];
    return line.kind === 'colour' ? [0, 1] : [line.min, line.max];
  }
  function withPoints(line: ControlLine, ch: Channel, points: LinePoint[]): ControlLine {
    if (ch === 'depth') return line.follow ? { ...line, follow: { ...line.follow, depthPoints: points } } : line;
    return { ...line, points };
  }
  function selectedPoints(line: ControlLine, ch: Channel): number[] {
    return selectedLinePoints(sel, line, ch);
  }
  /** Select points of `line`'s `ch` list as it is in `list` (the list just committed, or the line's own). */
  function selectPoints(line: ControlLine, ch: Channel, indices: number[], list: readonly LinePoint[] = pointsOf(line, ch)): void {
    lineSelection.set({ lineId: line.id, points: indices, channel: ch, of: list });
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function pathFor(line: ControlLine, ch: Channel, h: number): string {
    if (ch === 'depth') return curvePath({ ...line, kind: 'continuous', min: 0, max: 1 }, t0, t1, zoom, h, 3, line.follow?.depthPoints ?? [], [0, 1]);
    return curvePath(line, t0, t1, zoom, h);
  }

  /** The faint trace of what a following line does (offline sources), or the live source's recent values. */
  function traceFor(line: ControlLine, h: number, _v: number): string {
    const f = line.follow;
    if (!f || line.kind === 'colour') return '';
    if (isLiveOnlySource(f.source)) {
      const samples = liveTraces.get(line.id);
      if (!samples?.length) return '';
      return tracePath(samples.map((s) => ({ t: s.t, v: line.min + s.v * (line.max - line.min) })), zoom, h, line.min, line.max);
    }
    const ctx = currentLineSession()?.traceContext() ?? { liveInputs: false };
    const step = Math.max(2, Math.min(8, 4)) / zoom;
    const samples: Array<{ t: number; v: number }> = [];
    for (let t = t0, i = 0; t <= t1 && i < 3000; t += step, i++) {
      const v = lineValueAt(line, t, ctx);
      if (v === undefined) continue;
      samples.push({ t, v: typeof v === 'boolean' ? (v ? line.max : line.min) : v });
    }
    return tracePath(samples, zoom, h, line.min, line.max);
  }

  function pointY(line: ControlLine, ch: Channel, p: LinePoint, h: number): number {
    const [lo, hi] = rangeOf(line, ch);
    const v = line.kind === 'colour' && ch === 'points' ? (0.2126 * ((p.v >> 16) & 255) + 0.7152 * ((p.v >> 8) & 255) + 0.0722 * (p.v & 255)) / 255 : p.v;
    return valueToY(v, lo, hi, h);
  }
  function visiblePoints(points: readonly LinePoint[]): Array<{ p: LinePoint; i: number }> {
    const out: Array<{ p: LinePoint; i: number }> = [];
    points.forEach((p, i) => { if (p.t >= t0 - 1 && p.t <= t1 + 1) out.push({ p, i }); });
    return out;
  }

  // ── Editing ───────────────────────────────────────────────────────────
  let marquee: { x: number; y: number; w: number; h: number; lane: string } | null = $state(null);
  let stroke: { lane: string; d: string } | null = $state(null);
  let menu: { x: number; y: number; lineId: string; ch: Channel; indices: number[] } | null = $state(null);
  let dragSeq = 0;

  function commit(next: ControlLine, continuousKey?: string): void {
    showTimeline.editLines((list) => list.map((l) => (l.id === next.id ? next : l)), continuousKey);
  }

  function snapTime(t: number, ev: MouseEvent): number {
    if (ev.metaKey || ev.ctrlKey || !get(showTimeline).snapEnabled) return Math.max(0, t);
    return Math.max(0, showTimeline.snapTime(t));
  }

  function quantize(line: ControlLine, ch: Channel, v: number): number {
    if (ch === 'depth') return Math.max(0, Math.min(1, v));
    if (line.kind === 'bool') return v >= (line.min + line.max) / 2 ? line.max : line.min;
    if (line.kind === 'stepped') {
      const step = line.step && line.step > 0 ? line.step : 1;
      return Math.max(line.min, Math.min(line.max, line.min + Math.round((v - line.min) / step) * step));
    }
    return v;
  }

  function press(e: MouseEvent, laneLines: ControlLine[], ch: Channel, h: number, laneId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    menu = null;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Which line, which point.
    let line: ControlLine | null;
    let point = -1;
    if (laneLines.length > 1) {
      const hit = hitOverlay(laneLines, x, y, zoom, h);
      line = hit ? laneLines.find((l) => l.id === hit.lineId) ?? null : null;
      point = hit?.point ?? -1;
      if (!line) line = activeLineIn(laneLines, sel?.lineId);
    } else {
      line = laneLines[0] ?? null;
      if (line) point = hitPoint(line, pointsOf(line, ch), x, y, zoom, h, 6, rangeOf(line, ch));
    }
    if (!line) return;
    if (pen && !locked) {
      drawStroke(e, line, ch, h, rect, laneId);
      return;
    }
    if (point >= 0) {
      pressPoint(e, line, ch, h, point);
      return;
    }
    if (line.id !== sel?.lineId) lineSelection.set({ lineId: line.id, points: [] });
    pressEmpty(e, line, ch, h, rect, laneId);
  }

  function pressPoint(e: MouseEvent, line: ControlLine, ch: Channel, h: number, index: number) {
    const current = selectedPoints(line, ch);
    const inSel = current.includes(index);
    let indices: number[];
    if (e.shiftKey) {
      indices = inSel ? current.filter((i) => i !== index) : [...current, index];
      selectPoints(line, ch, indices);
      return;
    }
    indices = inSel ? current : [index];
    selectPoints(line, ch, indices);
    if (locked) return;
    // Esc puts back this line only (a pass recorded meanwhile into another stays).
    const startLine = get(showTimeline).lines.find((l) => l.id === line.id) ?? line;
    const startPoints = pointsOf(line, ch);
    const [lo, hi] = rangeOf(line, ch);
    const sx = e.clientX;
    const sy = e.clientY;
    const key = `line-drag:${line.id}:${Date.now()}-${++dragSeq}`;
    let moved = false;
    followPointer({
      move: (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
        moved = true;
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        let next: { points: LinePoint[]; indices: number[] };
        if (ev.altKey && indices.length > 1) {
          const pts = scaleOffsetPoints(startPoints, {
            timeScale: Math.max(0.05, 1 + dx / 200),
            valueScale: Math.max(0, 1 - dy / Math.max(20, h)),
            min: lo,
            max: hi,
          }, indices);
          next = { points: pts, indices };
        } else {
          next = dragPoints({ points: startPoints, indices, grabbed: index }, dx / zoom, (-dy / Math.max(1, h - 8)) * (hi - lo), {
            min: lo,
            max: hi,
            snap: ev.metaKey || ev.ctrlKey || !get(showTimeline).snapEnabled ? undefined : (t) => showTimeline.snapTime(t),
            step: ch === 'points' && (line.kind === 'stepped' || line.kind === 'bool') ? line.step || 1 : undefined,
          });
        }
        commit(withPoints(line, ch, next.points), key);
        selectPoints(line, ch, next.indices, next.points);
      },
      end: () => {},
      cancel: () => {
        if (moved) showTimeline.editLines((list) => list.map((l) => (l.id === startLine.id ? startLine : l)), key);
      },
    });
  }

  function pressEmpty(e: MouseEvent, line: ControlLine, ch: Channel, h: number, rect: DOMRect, laneId: string) {
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    followPointer({
      move: (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return;
        moved = true;
        const ax = sx - rect.left;
        const ay = sy - rect.top;
        const bx = ev.clientX - rect.left;
        const by = Math.max(0, Math.min(h, ev.clientY - rect.top));
        marquee = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay), lane: laneId };
      },
      end: (ev) => {
        if (moved) {
          const m = marquee;
          marquee = null;
          if (!m) return;
          const picked = pointsInRect(line, pointsOf(line, ch), { x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h }, zoom, h, rangeOf(line, ch));
          const base = ev.shiftKey ? selectedPoints(line, ch) : [];
          selectPoints(line, ch, [...new Set([...base, ...picked])]);
          return;
        }
        if (locked) return;
        // A click: a point here.
        const [lo, hi] = rangeOf(line, ch);
        const t = snapTime((sx - rect.left) / zoom, ev);
        const v = quantize(line, ch, yToValue(sy - rect.top, lo, hi, h));
        const curve = ch === 'points' && defaultCurveFor(line) === 'hold' ? 'hold' : undefined;
        const res = insertPoint(pointsOf(line, ch), t, v, curve);
        commit(withPoints(line, ch, res.points));
        selectPoints(line, ch, [res.index], res.points);
      },
      cancel: () => { marquee = null; },
    });
  }

  function drawStroke(e: MouseEvent, line: ControlLine, ch: Channel, h: number, rect: DOMRect, laneId: string) {
    const [lo, hi] = rangeOf(line, ch);
    const samples: Array<{ t: number; v: number }> = [];
    const add = (ev: MouseEvent) => {
      const t = Math.max(0, (ev.clientX - rect.left) / zoom);
      const v = yToValue(Math.max(0, Math.min(h, ev.clientY - rect.top)), lo, hi, h);
      samples.push({ t, v });
      stroke = { lane: laneId, d: samples.map((s, i) => `${i ? 'L' : 'M'}${(s.t * zoom).toFixed(1)} ${valueToY(s.v, lo, hi, h).toFixed(1)}`).join('') };
    };
    add(e);
    lineSelection.set({ lineId: line.id, points: [] });
    followPointer({
      move: add,
      end: () => {
        stroke = null;
        if (samples.length < 2) return;
        let pts: LinePoint[];
        if (ch === 'points' && (line.kind === 'bool' || line.kind === 'stepped')) {
          pts = [];
          for (const s of samples.slice().sort((a, b) => a.t - b.t)) {
            const v = quantize(line, ch, s.v);
            if (pts.length && pts[pts.length - 1].v === v) continue;
            pts.push({ t: s.t, v, c: 'hold' });
          }
        } else {
          pts = strokeToPoints(samples, { min: lo, max: hi, tolerance: (hi - lo) * 0.025, smooth: 0.04 });
        }
        if (!pts.length) return;
        commit(withPoints(line, ch, spliceStroke(pointsOf(line, ch), pts)));
      },
      cancel: () => { stroke = null; },
    });
  }

  function openMenu(e: MouseEvent, laneLines: ControlLine[], ch: Channel, h: number) {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let line: ControlLine | null = null;
    let point = -1;
    if (laneLines.length > 1) {
      const hit = hitOverlay(laneLines, x, y, zoom, h);
      if (hit && hit.point >= 0) { line = laneLines.find((l) => l.id === hit.lineId) ?? null; point = hit.point; }
    } else if (laneLines[0]) {
      line = laneLines[0];
      point = hitPoint(line, pointsOf(line, ch), x, y, zoom, h, 6, rangeOf(line, ch));
    }
    if (!line || point < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const current = selectedPoints(line, ch);
    const indices = current.includes(point) ? current : [point];
    selectPoints(line, ch, indices);
    menu = { x: e.clientX, y: e.clientY, lineId: line.id, ch, indices };
  }

  function menuLine(): ControlLine | null {
    return menu ? lines.find((l) => l.id === menu!.lineId) ?? null : null;
  }
  function setCurve(curve: LineCurve) {
    const line = menuLine();
    if (!line || !menu) return;
    commit(withPoints(line, menu.ch, setPointCurves(pointsOf(line, menu.ch), menu.indices, curve)));
    menu = null;
  }
  function deleteSelected(line: ControlLine, ch: Channel, indices: number[]) {
    if (!indices.length || locked) return;
    commit(withPoints(line, ch, deletePoints(pointsOf(line, ch), indices)));
    lineSelection.set({ lineId: line.id, points: [] });
  }

  $effect(() => {
    if (!menu) return;
    const close = () => { menu = null; };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); };
  });

  // Delete / Backspace: the selected points of a line in this group.
  $effect(() => {
    const ids = new Set(lines.map((l) => l.id));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const s = get(lineSelection);
      if (!s || !s.points.length || !ids.has(s.lineId)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const line = lines.find((l) => l.id === s.lineId);
      if (!line) return;
      const ch: Channel = s.channel ?? 'points';
      const picked = selectedLinePoints(s, line, ch);
      if (!picked.length) return;
      e.preventDefault();
      e.stopPropagation();
      deleteSelected(line, ch, picked);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const traceTick = $derived($liveTraceVersion);
  const blockTints = $derived(Object.entries(blockSpans).filter(([id]) => lines.some((l) => l.target.scope === 'block' && l.target.id === id)));
</script>

{#snippet laneSvg(laneLines: ControlLine[], ch: Channel, h: number, laneId: string)}
  <svg class="ll-svg" style:left="{x0}px" width={w} height={h} aria-hidden="true">
    <g transform="translate({-x0} 0)">
      {#each blockTints as [id, span] (id)}
        <rect class="ll-block" x={span.start * zoom} y="0" width={Math.max(0, (span.end - span.start) * zoom)} height={h} />
      {/each}
      {#if ch === 'points'}
        {#each laneLines as line (line.id)}
          {#if line.follow}
            <path class="ll-trace" d={traceFor(line, h, traceTick)} style:stroke={colorOf(line)} />
          {/if}
        {/each}
      {/if}
      {#each laneLines as line (line.id)}
        <path
          class="ll-curve"
          class:active={laneLines.length > 1 && line.id === active?.id}
          class:off={line.enabled === false}
          class:depth={ch === 'depth'}
          d={pathFor(line, ch, h)}
          style:stroke={colorOf(line)}
        />
      {/each}
      {#each laneLines as line (line.id)}
        {@const pts = pointsOf(line, ch)}
        {@const chosen = selectedPoints(line, ch)}
        {@const big = laneLines.length === 1 || line.id === active?.id}
        {#each visiblePoints(pts) as { p, i } (i)}
          <circle
            class="ll-pt"
            class:sel={chosen.includes(i)}
            class:small={!big}
            cx={p.t * zoom}
            cy={pointY(line, ch, p, h)}
            r={big ? 4 : 2.5}
            style:fill={chosen.includes(i) ? '#FFD96B' : colorOf(line)}
            data-line-point={i}
          />
        {/each}
      {/each}
      {#if ch === 'points'}
        {#each laneLines as line (line.id)}
          {@const pass = $recordingPasses.get(line.id)}
          {#if pass?.length}
            <path class="ll-rec" d={tracePath(pass, zoom, h, line.kind === 'colour' ? 0 : line.min, line.kind === 'colour' ? 1 : line.max)} data-line-recording={line.id} />
          {/if}
        {/each}
      {/if}
      {#if stroke && stroke.lane === laneId}
        <path class="ll-stroke" d={stroke.d} />
      {/if}
    </g>
  </svg>
  {#if marquee && marquee.lane === laneId}
    <div class="ll-marquee" style:left="{marquee.x}px" style:top="{marquee.y}px" style:width="{marquee.w}px" style:height="{marquee.h}px"></div>
  {/if}
{/snippet}

<div class="ll" class:pen data-line-group={groupId}>
  {#if !expanded}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="ll-lane overlay"
      class:locked
      style:height="{LINE_OVERLAY_HEIGHT}px"
      onmousedown={(e) => press(e, lines, 'points', LINE_OVERLAY_HEIGHT, 'overlay')}
      oncontextmenu={(e) => openMenu(e, lines, 'points', LINE_OVERLAY_HEIGHT)}
      onclick={(e) => e.stopPropagation()}
      data-line-lane="overlay"
    >
      {@render laneSvg(lines, 'points', LINE_OVERLAY_HEIGHT, 'overlay')}
    </div>
  {:else}
    {#each lines as line (line.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="ll-lane"
        class:locked
        class:selected={sel?.lineId === line.id}
        style:height="{LINE_LANE_HEIGHT}px"
        style:--line-color={colorOf(line)}
        onmousedown={(e) => press(e, [line], 'points', LINE_LANE_HEIGHT, line.id)}
        oncontextmenu={(e) => openMenu(e, [line], 'points', LINE_LANE_HEIGHT)}
        onclick={(e) => e.stopPropagation()}
        data-line-lane={line.id}
      >
        {@render laneSvg([line], 'points', LINE_LANE_HEIGHT, line.id)}
      </div>
      {#if line.follow?.depthPoints}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="ll-lane depth"
          class:locked
          style:height="{LINE_DEPTH_HEIGHT}px"
          onmousedown={(e) => press(e, [line], 'depth', LINE_DEPTH_HEIGHT, `${line.id}:depth`)}
          oncontextmenu={(e) => openMenu(e, [line], 'depth', LINE_DEPTH_HEIGHT)}
          onclick={(e) => e.stopPropagation()}
          data-line-depth={line.id}
        >
          {@render laneSvg([line], 'depth', LINE_DEPTH_HEIGHT, `${line.id}:depth`)}
        </div>
      {/if}
    {/each}
  {/if}
</div>

{#if menu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ll-menu" use:portal style:left="{menu.x}px" style:top="{menu.y}px" onmousedown={(e) => e.stopPropagation()} data-line-point-menu>
    <div class="ll-menu-head">Curve to the next point</div>
    {#each LINE_CURVES as c (c)}
      <button class="ll-menu-item" onclick={() => setCurve(c)} data-line-curve={c}>{CURVE_NAMES[c]}</button>
    {/each}
    <div class="ll-menu-sep"></div>
    <button class="ll-menu-item danger" onclick={() => { const l = menuLine(); if (l && menu) deleteSelected(l, menu.ch, menu.indices); menu = null; }} data-line-point-delete>
      {menu.indices.length > 1 ? 'Delete points' : 'Delete point'}
    </button>
  </div>
{/if}

<style>
  .ll { position: relative; }
  .ll-lane {
    position: relative;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.06));
    background: rgba(255, 255, 255, 0.018);
    cursor: crosshair;
  }
  .ll-lane.overlay { background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(0, 0, 0, 0.12)); }
  .ll-lane.selected { background: color-mix(in srgb, var(--line-color) 6%, rgba(255, 255, 255, 0.02)); }
  .ll-lane.depth { background: rgba(0, 0, 0, 0.2); }
  .ll-lane.locked { cursor: default; }
  .ll.pen .ll-lane:not(.locked) { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='M1 15l3-1 9-9-2-2-9 9z' fill='white' stroke='black'/></svg>") 1 15, crosshair; }
  .ll-svg { position: absolute; top: 0; pointer-events: none; overflow: visible; }
  .ll-block { fill: rgba(255, 255, 255, 0.04); }
  .ll-curve { fill: none; stroke-width: 1.6; opacity: 0.9; }
  .ll-curve.active { stroke-width: 2.4; opacity: 1; }
  .ll-curve.off { stroke-dasharray: 3 3; opacity: 0.45; }
  .ll-curve.depth { stroke-width: 1; stroke-dasharray: 4 2; }
  .ll-trace { fill: none; stroke-width: 1; opacity: 0.28; }
  .ll-pt { stroke: rgba(0, 0, 0, 0.75); stroke-width: 1; }
  .ll-pt.small { opacity: 0.8; }
  .ll-pt.sel { filter: drop-shadow(0 0 3px rgba(255, 217, 107, 0.9)); }
  .ll-rec { fill: none; stroke: var(--ga-rec, #ff4757); stroke-width: 2.2; filter: drop-shadow(0 0 3px rgba(255, 71, 87, 0.8)); }
  .ll-stroke { fill: none; stroke: #ffffff; stroke-width: 1.5; stroke-dasharray: 2 2; }
  .ll-marquee {
    position: absolute;
    border: 1px solid rgba(255, 217, 107, 0.8);
    background: rgba(255, 217, 107, 0.08);
    pointer-events: none;
  }
  .ll-menu {
    position: fixed;
    z-index: 10000;
    min-width: 180px;
    padding: 4px;
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    transform: translateY(-100%);
  }
  .ll-menu-head {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    padding: 4px 8px;
  }
  .ll-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--ga-ink-0, #ddd);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .ll-menu-item:hover { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .ll-menu-item.danger { color: var(--ga-rec, #ff4757); }
  .ll-menu-sep { height: 1px; margin: 4px 0; background: var(--ga-line-2, rgba(255, 255, 255, 0.12)); }
</style>
