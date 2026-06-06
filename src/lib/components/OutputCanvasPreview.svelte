<script lang="ts">
  import type { OutputSlice } from '../stores/settings';

  // Top-down preview of the master canvas with each slice drawn as a
  // labeled rectangle. Adjacent slices whose edge-blend regions overlap
  // get a red translucent "overlap zone" overlay — the single most
  // important affordance for setting up a multi-projector blend, since
  // it shows the operator exactly where the blend math is active.
  //
  // Drag interactions:
  //   - Click+drag the body of a slice rectangle → translate (move).
  //   - Click+drag one of the 4 corner handles → resize that corner.
  // All edits emit (sliceId, partialSlice) via `onChange`, leaving
  // persistence to the parent. Snapping to neighboring slice edges
  // within a 1.5%-of-canvas threshold makes building seamless rigs by
  // hand feasible without typing exact numbers.
  export let slices: OutputSlice[] = [];
  export let masterWidth: number = 1920;
  export let masterHeight: number = 1080;
  export let selectedId: string | null = null;
  export let onSelect: (id: string) => void = () => {};
  export let onChange: (sliceId: string, partial: Partial<OutputSlice>) => void = () => {};

  const VIEW_W = 520;
  $: viewH = Math.max(80, Math.round((VIEW_W * masterHeight) / Math.max(1, masterWidth)));

  const COLORS = [
    '#5fa8ff', '#ff7e5f', '#5fff8e', '#ffe55f',
    '#c25fff', '#5fffe7', '#ff5f9e', '#a5ff5f',
  ];

  type Rect = { x: number; y: number; w: number; h: number };

  function blendStrips(slice: OutputSlice): Rect[] {
    const x = slice.cropX * masterWidth;
    const y = slice.cropY * masterHeight;
    const w = slice.cropW * masterWidth;
    const h = slice.cropH * masterHeight;
    const strips: Rect[] = [];
    if (slice.edgeBlendLeft > 0)   strips.push({ x, y, w: w * slice.edgeBlendLeft, h });
    if (slice.edgeBlendRight > 0)  strips.push({ x: x + w * (1 - slice.edgeBlendRight), y, w: w * slice.edgeBlendRight, h });
    if (slice.edgeBlendTop > 0)    strips.push({ x, y, w, h: h * slice.edgeBlendTop });
    if (slice.edgeBlendBottom > 0) strips.push({ x, y: y + h * (1 - slice.edgeBlendBottom), w, h: h * slice.edgeBlendBottom });
    return strips;
  }

  function rectIntersect(a: Rect, b: Rect): Rect | null {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function toView(r: Rect): Rect {
    const sx = VIEW_W / Math.max(1, masterWidth);
    const sy = viewH / Math.max(1, masterHeight);
    return { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy };
  }

  $: overlaps = (() => {
    const out: Rect[] = [];
    const active = slices.filter(s => s.enabled);
    for (let i = 0; i < active.length; i++) {
      const aStrips = blendStrips(active[i]);
      for (let j = i + 1; j < active.length; j++) {
        const bStrips = blendStrips(active[j]);
        const bx = active[j].cropX * masterWidth;
        const by = active[j].cropY * masterHeight;
        const bRect: Rect = { x: bx, y: by, w: active[j].cropW * masterWidth, h: active[j].cropH * masterHeight };
        const ax = active[i].cropX * masterWidth;
        const ay = active[i].cropY * masterHeight;
        const aRect: Rect = { x: ax, y: ay, w: active[i].cropW * masterWidth, h: active[i].cropH * masterHeight };
        for (const s of aStrips) {
          const r = rectIntersect(s, bRect);
          if (r) out.push(toView(r));
        }
        for (const s of bStrips) {
          const r = rectIntersect(s, aRect);
          if (r) out.push(toView(r));
        }
      }
    }
    return out;
  })();

  $: sliceRects = slices.map((s, i) => ({
    slice: s,
    color: COLORS[i % COLORS.length],
    rect: toView({
      x: s.cropX * masterWidth,
      y: s.cropY * masterHeight,
      w: s.cropW * masterWidth,
      h: s.cropH * masterHeight,
    }),
  }));

  // ── Drag state ───────────────────────────────────────────────────────
  // dragKind 'move' = drag rectangle body, repositioning crop X/Y.
  // dragKind 'corner-XX' = drag a specific corner, resizing two edges.
  type DragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se';
  let dragging: {
    sliceId: string;
    kind: DragKind;
    startMx: number;       // mouse start in viewport coords
    startMy: number;
    startCropX: number;    // slice crop state at drag start (normalized 0..1)
    startCropY: number;
    startCropW: number;
    startCropH: number;
  } | null = null;
  // Snap distance — within this fraction of the master canvas, snap
  // the dragged edge to a neighbor's edge so the operator gets a
  // pixel-flush rig without typing in coords.
  const SNAP_FRACTION = 0.015;

  function viewToCanvasNorm(vx: number, vy: number) {
    return { nx: vx / VIEW_W, ny: vy / viewH };
  }

  function svgPoint(e: MouseEvent | PointerEvent): { vx: number; vy: number } {
    // Use the parent SVG's bounding rect to compute local viewport
    // coords. The viewBox is 1:1 with the rendered size since we set
    // width/height directly, so no extra scale factor.
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement
              || (e.currentTarget as SVGSVGElement);
    if (!svg) return { vx: 0, vy: 0 };
    const r = svg.getBoundingClientRect();
    return { vx: e.clientX - r.left, vy: e.clientY - r.top };
  }

  function snapEdge(value: number, sliceId: string, axis: 'x' | 'y'): number {
    // Snap `value` (normalized 0..1) to the nearest edge of any OTHER
    // slice along the same axis. Edges considered: cropX, cropX+cropW
    // (for axis x); cropY, cropY+cropH (for axis y). Plus the master
    // canvas edges 0 and 1.
    const candidates: number[] = [0, 1];
    for (const s of slices) {
      if (s.id === sliceId) continue;
      if (axis === 'x') { candidates.push(s.cropX, s.cropX + s.cropW); }
      else { candidates.push(s.cropY, s.cropY + s.cropH); }
    }
    let best = value;
    let bestD = SNAP_FRACTION;
    for (const c of candidates) {
      const d = Math.abs(c - value);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function startDrag(e: PointerEvent, sliceId: string, kind: DragKind) {
    const slice = slices.find(s => s.id === sliceId);
    if (!slice) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const { vx, vy } = svgPoint(e);
    dragging = {
      sliceId,
      kind,
      startMx: vx,
      startMy: vy,
      startCropX: slice.cropX,
      startCropY: slice.cropY,
      startCropW: slice.cropW,
      startCropH: slice.cropH,
    };
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const { vx, vy } = svgPoint(e);
    const dxN = (vx - dragging.startMx) / VIEW_W;
    const dyN = (vy - dragging.startMy) / viewH;

    if (dragging.kind === 'move') {
      // Clamp move so slice stays inside the master canvas.
      const nx = Math.min(Math.max(0, dragging.startCropX + dxN), 1 - dragging.startCropW);
      const ny = Math.min(Math.max(0, dragging.startCropY + dyN), 1 - dragging.startCropH);
      const snappedX = snapEdge(nx, dragging.sliceId, 'x');
      const snappedY = snapEdge(ny, dragging.sliceId, 'y');
      // If left edge snapped, take that; else if right edge would snap,
      // anchor right and recompute X. Same idea for vertical.
      const rightSnapped = snapEdge(nx + dragging.startCropW, dragging.sliceId, 'x');
      const bottomSnapped = snapEdge(ny + dragging.startCropH, dragging.sliceId, 'y');
      const useLeftSnapX = Math.abs(snappedX - nx) < Math.abs(rightSnapped - (nx + dragging.startCropW));
      const useTopSnapY  = Math.abs(snappedY - ny) < Math.abs(bottomSnapped - (ny + dragging.startCropH));
      const finalX = useLeftSnapX ? snappedX : Math.max(0, rightSnapped - dragging.startCropW);
      const finalY = useTopSnapY  ? snappedY : Math.max(0, bottomSnapped - dragging.startCropH);
      onChange(dragging.sliceId, { cropX: finalX, cropY: finalY });
    } else {
      // Corner resize. We modify two edges based on which corner.
      let { startCropX: x, startCropY: y, startCropW: w, startCropH: h } = dragging;
      if (dragging.kind === 'nw') {
        const newX = Math.min(Math.max(0, x + dxN), x + w - 0.02);
        const newY = Math.min(Math.max(0, y + dyN), y + h - 0.02);
        const sx = snapEdge(newX, dragging.sliceId, 'x');
        const sy = snapEdge(newY, dragging.sliceId, 'y');
        const newW = (x + w) - sx;
        const newH = (y + h) - sy;
        onChange(dragging.sliceId, { cropX: sx, cropY: sy, cropW: newW, cropH: newH });
      } else if (dragging.kind === 'ne') {
        const newR = Math.min(Math.max(x + 0.02, x + w + dxN), 1);
        const newY = Math.min(Math.max(0, y + dyN), y + h - 0.02);
        const sr = snapEdge(newR, dragging.sliceId, 'x');
        const sy = snapEdge(newY, dragging.sliceId, 'y');
        onChange(dragging.sliceId, { cropY: sy, cropW: sr - x, cropH: (y + h) - sy });
      } else if (dragging.kind === 'sw') {
        const newX = Math.min(Math.max(0, x + dxN), x + w - 0.02);
        const newB = Math.min(Math.max(y + 0.02, y + h + dyN), 1);
        const sx = snapEdge(newX, dragging.sliceId, 'x');
        const sb = snapEdge(newB, dragging.sliceId, 'y');
        onChange(dragging.sliceId, { cropX: sx, cropW: (x + w) - sx, cropH: sb - y });
      } else if (dragging.kind === 'se') {
        const newR = Math.min(Math.max(x + 0.02, x + w + dxN), 1);
        const newB = Math.min(Math.max(y + 0.02, y + h + dyN), 1);
        const sr = snapEdge(newR, dragging.sliceId, 'x');
        const sb = snapEdge(newB, dragging.sliceId, 'y');
        onChange(dragging.sliceId, { cropW: sr - x, cropH: sb - y });
      }
    }
  }

  function endDrag(e: PointerEvent) {
    if (!dragging) return;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
    dragging = null;
  }
</script>

<div class="canvas-preview">
  <div class="preview-meta">
    <span>Master canvas: <strong>{masterWidth}×{masterHeight}</strong></span>
    <span class="preview-legend">
      <span class="legend-dot overlap"></span> overlap zone
      <span class="legend-dot disabled"></span> disabled slice
    </span>
  </div>
  <svg
    width={VIEW_W}
    height={viewH}
    viewBox="0 0 {VIEW_W} {viewH}"
    class="preview-svg"
    on:pointermove={onPointerMove}
    on:pointerup={endDrag}
    on:pointercancel={endDrag}
  >
    <defs>
      <pattern id="ga-master-bg" width="20" height="20" patternUnits="userSpaceOnUse">
        <rect width="20" height="20" fill="#1a1a22"/>
        <rect width="10" height="10" fill="#22222b"/>
        <rect x="10" y="10" width="10" height="10" fill="#22222b"/>
      </pattern>
    </defs>
    <rect x="0" y="0" width={VIEW_W} height={viewH} fill="url(#ga-master-bg)" stroke="#444" stroke-width="1"/>

    {#each sliceRects as { slice, color, rect } (slice.id)}
      <g
        class="slice-g"
        class:disabled={!slice.enabled}
        class:selected={selectedId === slice.id}
      >
        <rect
          x={rect.x} y={rect.y} width={rect.w} height={rect.h}
          fill={color}
          fill-opacity={slice.enabled ? 0.18 : 0.06}
          stroke={color}
          stroke-width={selectedId === slice.id ? 2.5 : 1.5}
          stroke-dasharray={slice.enabled ? 'none' : '4 3'}
          on:pointerdown={(e) => { onSelect(slice.id); startDrag(e, slice.id, 'move'); }}
          style="cursor: move;"
        />
        {#if rect.w > 40 && rect.h > 16}
          <rect x={rect.x + 4} y={rect.y + 4} width={Math.min(rect.w - 8, 8 + slice.name.length * 6.5)} height="14" fill="rgba(0,0,0,0.55)" rx="2" pointer-events="none"/>
          <text x={rect.x + 8} y={rect.y + 14} fill={color} font-size="11" font-family="ui-monospace, monospace" pointer-events="none">{slice.name}</text>
        {/if}

        <!-- Corner resize handles. 6px boxes, only shown for the
             selected slice so the preview stays uncluttered when
             scanning the layout. -->
        {#if selectedId === slice.id}
          {@const HS = 7}
          <rect class="handle" x={rect.x - HS/2} y={rect.y - HS/2} width={HS} height={HS}
            fill={color} stroke="#000" stroke-width="1"
            on:pointerdown={(e) => startDrag(e, slice.id, 'nw')} style="cursor: nwse-resize;" />
          <rect class="handle" x={rect.x + rect.w - HS/2} y={rect.y - HS/2} width={HS} height={HS}
            fill={color} stroke="#000" stroke-width="1"
            on:pointerdown={(e) => startDrag(e, slice.id, 'ne')} style="cursor: nesw-resize;" />
          <rect class="handle" x={rect.x - HS/2} y={rect.y + rect.h - HS/2} width={HS} height={HS}
            fill={color} stroke="#000" stroke-width="1"
            on:pointerdown={(e) => startDrag(e, slice.id, 'sw')} style="cursor: nesw-resize;" />
          <rect class="handle" x={rect.x + rect.w - HS/2} y={rect.y + rect.h - HS/2} width={HS} height={HS}
            fill={color} stroke="#000" stroke-width="1"
            on:pointerdown={(e) => startDrag(e, slice.id, 'se')} style="cursor: nwse-resize;" />
        {/if}
      </g>
    {/each}

    {#each overlaps as r}
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(255,80,80,0.35)" stroke="rgba(255,80,80,0.7)" stroke-width="0.5" pointer-events="none"/>
    {/each}
  </svg>
</div>

<style>
  .canvas-preview {
    border: 1px solid #2c2c36;
    border-radius: 6px;
    padding: 10px;
    background: #131319;
    margin-bottom: 12px;
  }
  .preview-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--text-muted, #888);
    margin-bottom: 6px;
    font-family: ui-monospace, monospace;
  }
  .preview-meta strong {
    color: var(--text-primary, #ddd);
    font-weight: 500;
  }
  .preview-legend {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .legend-dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-right: 4px;
    vertical-align: middle;
    border-radius: 2px;
  }
  .legend-dot.overlap { background: rgba(255,80,80,0.45); border: 1px solid rgba(255,80,80,0.7); }
  .legend-dot.disabled { background: transparent; border: 1px dashed #666; }
  .preview-svg {
    display: block;
    width: 100%;
    height: auto;
    max-width: 520px;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  .slice-g {
    outline: none;
  }
  .slice-g:hover rect:first-child {
    fill-opacity: 0.3;
  }
  .slice-g.selected rect:first-child {
    fill-opacity: 0.35;
  }
  .slice-g.disabled {
    opacity: 0.55;
  }
  .handle:hover {
    fill-opacity: 1;
  }
</style>
