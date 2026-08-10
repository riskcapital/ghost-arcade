<script lang="ts">
  /**
   * ScreenWarpHandles — on-editor-canvas overlay shown when the user
   * is on the Screens tab. Mirrors the visual + interaction model of
   * the layer-side WarpHandles + MeshWarpHandles components exactly:
   *
   *   - Faint dashed outline for every screen so the operator sees
   *     the rig at a glance.
   *   - Selected screen: solid outline + interactive handles.
   *   - Rect mode:    4 round corner handles + 4 rectangular edge
   *                   handles + center move handle.
   *   - Corners mode: 4 free quad-warp corner handles + center move.
   *   - Mesh mode:    one round handle per grid point (corner / edge
   *                   / inner sizes) + center move.
   *   - Output warp (orange handles): a SECOND warp on top, applied
   *     to the projector output (not the source crop). Lets the
   *     operator re-align all presets together when the projector
   *     gets bumped on-site.
   *
   * Drag implementation copies the layer-side pattern: mousedown on
   * a handle stashes the drag state + the screen snapshot, then we
   * attach window-level mousemove + mouseup until release. This is
   * the proven approach used by WarpHandles + MeshWarpHandles — no
   * pointer-capture quirks, no SVG event subtleties.
   *
   * Coordinate system: screen geometry is stored in master-canvas
   * normalized 0..1 with y=0 at the TOP (matches how the operator
   * thinks about the projector image — top is up). The editor canvas
   * `containerHeight` runs top→bottom, so `pixelY = nY * height` with
   * no flip. Output-warp geometry uses projector-unit-quad 0..1.
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import type { OutputSlice } from '../stores/settings';
  import { project } from '../stores/layers';
  import { settings } from '../stores/settings';
  import type { WarpCorners, MeshWarpGrid } from '../types';
  import { normalizedWarpNudge } from '../utils/warpNudge';
  import { screens, selectedScreenId, screenActions } from '../stores/screens';

  interface Props {
    containerWidth: number;
    containerHeight: number;
    zoom?: number;
  }
  let { containerWidth, containerHeight, zoom = 1 }: Props = $props();

  // Snap distance — same heuristic as the OutputCanvasPreview drag.
  const SNAP_FRACTION = 0.015;

  // ─── Drag state ────────────────────────────────────────────────────
  type DragKind =
    | { kind: 'rect-corner'; corner: 'nw' | 'ne' | 'sw' | 'se' }
    | { kind: 'rect-edge'; edge: 'top' | 'right' | 'bottom' | 'left' }
    | { kind: 'rect-move' }
    | { kind: 'corner'; corner: keyof WarpCorners }
    | { kind: 'corners-move' }
    | { kind: 'mesh'; row: number; col: number }
    | { kind: 'mesh-move' };

  let drag: {
    sliceId: string;
    kind: DragKind;
    startClientX: number;
    startClientY: number;
    startSlice: OutputSlice;
  } | null = $state(null);

  let containerEl: HTMLDivElement | null = $state(null);

  // ─── Snap ──────────────────────────────────────────────────────────
  function snapAxis(value: number, sliceId: string, axis: 'x' | 'y'): number {
    const candidates: number[] = [0, 1];
    for (const s of $screens) {
      if (s.id === sliceId) continue;
      if (axis === 'x') candidates.push(s.cropX, s.cropX + s.cropW);
      else candidates.push(s.cropY, s.cropY + s.cropH);
    }
    let best = value, bestD = SNAP_FRACTION;
    for (const c of candidates) {
      const d = Math.abs(c - value);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // ─── Start drag ────────────────────────────────────────────────────
  // Mirrors WarpHandles: stash state, attach window listeners.
  function startDrag(e: MouseEvent, sliceId: string, kind: DragKind) {
    e.preventDefault();
    e.stopPropagation();
    const slice = $screens.find(s => s.id === sliceId);
    if (!slice) return;
    cancelDrag();
    drag = {
      sliceId,
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      // Deep-clone the slice's mutable warp data so we can apply
      // deltas to the snapshot, not to a moving target.
      startSlice: {
        ...slice,
        corners: slice.corners ? { ...slice.corners } : undefined,
        // Manual deep-copy — structuredClone throws DataCloneError on
        // some nested store values; the mesh is just {rows,cols,points}.
        meshGrid: slice.meshGrid
          ? { rows: slice.meshGrid.rows, cols: slice.meshGrid.cols, points: slice.meshGrid.points.map(r => r.map(p => ({ x: p.x, y: p.y }))) }
          : undefined,
      },
    };
    selectedScreenId.set(sliceId);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function removeDragListeners() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  function cancelDrag() {
    drag = null;
    removeDragListeners();
  }

  function onMouseUp(_e: MouseEvent) {
    cancelDrag();
  }

  function onVisibilityChange() {
    if (document.hidden) cancelDrag();
  }

  function isTextEditingTarget(target: EventTarget | null): boolean {
    const el = target instanceof HTMLElement ? target : null;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return Boolean(
      el?.closest('input, textarea, select, [contenteditable="true"]') ||
      active?.closest('input, textarea, select, [contenteditable="true"]')
    );
  }

  function nudgeSelectedSlice(dx: number, dy: number) {
    const id = $selectedScreenId;
    const slice = $screens.find(s => s.id === id);
    if (!slice) return;
    const mode = slice.warpMode ?? 'rect';

    if (mode === 'rect') {
      screenActions.update(slice.id, {
        cropX: Math.min(Math.max(0, slice.cropX + dx), 1 - slice.cropW),
        cropY: Math.min(Math.max(0, slice.cropY + dy), 1 - slice.cropH),
      });
      return;
    }

    if (mode === 'corners' && slice.corners) {
      const c = slice.corners;
      screenActions.update(slice.id, {
        corners: {
          topLeft: { x: c.topLeft.x + dx, y: c.topLeft.y + dy },
          topRight: { x: c.topRight.x + dx, y: c.topRight.y + dy },
          bottomLeft: { x: c.bottomLeft.x + dx, y: c.bottomLeft.y + dy },
          bottomRight: { x: c.bottomRight.x + dx, y: c.bottomRight.y + dy },
        },
      });
      return;
    }

    if (mode === 'mesh' && slice.meshGrid) {
      screenActions.update(slice.id, {
        meshGrid: {
          rows: slice.meshGrid.rows,
          cols: slice.meshGrid.cols,
          points: slice.meshGrid.points.map(row =>
            row.map(pt => ({ x: pt.x + dx, y: pt.y + dy }))
          ),
        },
      });
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!$selectedScreenId || isTextEditingTarget(e.target)) return;
    let dx = 0;
    let dy = 0;
    const proj = get(project);
    const step = normalizedWarpNudge(
      proj.width,
      proj.height,
      get(settings).ui.warpDragGranularity,
      e.shiftKey ? 10 : 1,
    );

    switch (e.key) {
      case 'ArrowUp':
        dy = -step.y;
        break;
      case 'ArrowDown':
        dy = step.y;
        break;
      case 'ArrowLeft':
        dx = -step.x;
        break;
      case 'ArrowRight':
        dx = step.x;
        break;
      case 'Escape':
        cancelDrag();
        return;
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    nudgeSelectedSlice(dx, dy);
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onDestroy(() => {
    cancelDrag();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('blur', handleWindowBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  function handleWindowBlur() {
    cancelDrag();
  }


  // ─── Mouse-move dispatcher ────────────────────────────────────────
  function onMouseMove(e: MouseEvent) {
    if (!drag) return;
    // Convert raw clientX/Y delta into normalized 0..1 against the
    // container. Zoom-correct so dragging feels 1:1 with screen px
    // even when the viewport is zoomed in. Same recipe as
    // WarpHandles:367-373.
    const dxN = ((e.clientX - drag.startClientX) / zoom) / Math.max(1, containerWidth);
    const dyN = ((e.clientY - drag.startClientY) / zoom) / Math.max(1, containerHeight);
    const k = drag.kind;
    const id = drag.sliceId;
    const init = drag.startSlice;

    if (k.kind === 'rect-move') {
      const nx = Math.min(Math.max(0, init.cropX + dxN), 1 - init.cropW);
      const ny = Math.min(Math.max(0, init.cropY + dyN), 1 - init.cropH);
      screenActions.update(id, {
        cropX: snapAxis(nx, id, 'x'),
        cropY: snapAxis(ny, id, 'y'),
      });
    } else if (k.kind === 'rect-corner') {
      const x = init.cropX, y = init.cropY, w = init.cropW, h = init.cropH;
      if (k.corner === 'nw') {
        const nx = Math.min(Math.max(0, x + dxN), x + w - 0.02);
        const ny = Math.min(Math.max(0, y + dyN), y + h - 0.02);
        const sx = snapAxis(nx, id, 'x'), sy = snapAxis(ny, id, 'y');
        screenActions.update(id, { cropX: sx, cropY: sy, cropW: (x + w) - sx, cropH: (y + h) - sy });
      } else if (k.corner === 'ne') {
        const nr = Math.min(Math.max(x + 0.02, x + w + dxN), 1);
        const ny = Math.min(Math.max(0, y + dyN), y + h - 0.02);
        const sr = snapAxis(nr, id, 'x'), sy = snapAxis(ny, id, 'y');
        screenActions.update(id, { cropY: sy, cropW: sr - x, cropH: (y + h) - sy });
      } else if (k.corner === 'sw') {
        const nx = Math.min(Math.max(0, x + dxN), x + w - 0.02);
        const nb = Math.min(Math.max(y + 0.02, y + h + dyN), 1);
        const sx = snapAxis(nx, id, 'x'), sb = snapAxis(nb, id, 'y');
        screenActions.update(id, { cropX: sx, cropW: (x + w) - sx, cropH: sb - y });
      } else {
        const nr = Math.min(Math.max(x + 0.02, x + w + dxN), 1);
        const nb = Math.min(Math.max(y + 0.02, y + h + dyN), 1);
        const sr = snapAxis(nr, id, 'x'), sb = snapAxis(nb, id, 'y');
        screenActions.update(id, { cropW: sr - x, cropH: sb - y });
      }
    } else if (k.kind === 'rect-edge') {
      const x = init.cropX, y = init.cropY, w = init.cropW, h = init.cropH;
      if (k.edge === 'top') {
        const ny = Math.min(Math.max(0, y + dyN), y + h - 0.02);
        const sy = snapAxis(ny, id, 'y');
        screenActions.update(id, { cropY: sy, cropH: (y + h) - sy });
      } else if (k.edge === 'bottom') {
        const nb = Math.min(Math.max(y + 0.02, y + h + dyN), 1);
        const sb = snapAxis(nb, id, 'y');
        screenActions.update(id, { cropH: sb - y });
      } else if (k.edge === 'left') {
        const nx = Math.min(Math.max(0, x + dxN), x + w - 0.02);
        const sx = snapAxis(nx, id, 'x');
        screenActions.update(id, { cropX: sx, cropW: (x + w) - sx });
      } else {
        const nr = Math.min(Math.max(x + 0.02, x + w + dxN), 1);
        const sr = snapAxis(nr, id, 'x');
        screenActions.update(id, { cropW: sr - x });
      }
    } else if (k.kind === 'corner' && init.corners) {
      const c0 = init.corners[k.corner];
      const nx = Math.min(Math.max(0, c0.x + dxN), 1);
      const ny = Math.min(Math.max(0, c0.y + dyN), 1);
      const corners = { ...init.corners, [k.corner]: { x: nx, y: ny } };
      screenActions.update(id, { corners });
    } else if (k.kind === 'corners-move' && init.corners) {
      const c = init.corners;
      const newCorners: WarpCorners = {
        topLeft:     { x: c.topLeft.x     + dxN, y: c.topLeft.y     + dyN },
        topRight:    { x: c.topRight.x    + dxN, y: c.topRight.y    + dyN },
        bottomLeft:  { x: c.bottomLeft.x  + dxN, y: c.bottomLeft.y  + dyN },
        bottomRight: { x: c.bottomRight.x + dxN, y: c.bottomRight.y + dyN },
      };
      screenActions.update(id, { corners: newCorners });
    } else if (k.kind === 'mesh' && init.meshGrid) {
      const p0 = init.meshGrid.points[k.row]?.[k.col];
      if (!p0) return;
      const nx = Math.min(Math.max(0, p0.x + dxN), 1);
      const ny = Math.min(Math.max(0, p0.y + dyN), 1);
      const points = init.meshGrid.points.map((row, r) =>
        row.map((pt, c) => (r === k.row && c === k.col ? { x: nx, y: ny } : pt))
      );
      screenActions.update(id, { meshGrid: { rows: init.meshGrid.rows, cols: init.meshGrid.cols, points } });
    } else if (k.kind === 'mesh-move' && init.meshGrid) {
      const points = init.meshGrid.points.map(row =>
        row.map(pt => ({ x: pt.x + dxN, y: pt.y + dyN }))
      );
      screenActions.update(id, { meshGrid: { rows: init.meshGrid.rows, cols: init.meshGrid.cols, points } });
    }
  }

  // ─── Pixel helpers ─────────────────────────────────────────────────
  function px(nx: number): number { return nx * containerWidth; }
  function py(ny: number): number { return ny * containerHeight; }

  function rectCenter(s: OutputSlice): { x: number; y: number } {
    return { x: px(s.cropX + s.cropW / 2), y: py(s.cropY + s.cropH / 2) };
  }
  function cornersCenter(c: WarpCorners): { x: number; y: number } {
    return {
      x: px((c.topLeft.x + c.topRight.x + c.bottomLeft.x + c.bottomRight.x) / 4),
      y: py((c.topLeft.y + c.topRight.y + c.bottomLeft.y + c.bottomRight.y) / 4),
    };
  }
  function meshCenter(g: MeshWarpGrid): { x: number; y: number } {
    let sx = 0, sy = 0, n = 0;
    for (const row of g.points) for (const p of row) { sx += p.x; sy += p.y; n++; }
    return { x: px(sx / Math.max(1, n)), y: py(sy / Math.max(1, n)) };
  }

  function rectPath(s: OutputSlice): string {
    const x0 = px(s.cropX), y0 = py(s.cropY);
    const x1 = px(s.cropX + s.cropW), y1 = py(s.cropY + s.cropH);
    return `${x0},${y0} ${x1},${y0} ${x1},${y1} ${x0},${y1}`;
  }
  function cornersPath(c: WarpCorners): string {
    return `${px(c.topLeft.x)},${py(c.topLeft.y)} ${px(c.topRight.x)},${py(c.topRight.y)} ${px(c.bottomRight.x)},${py(c.bottomRight.y)} ${px(c.bottomLeft.x)},${py(c.bottomLeft.y)}`;
  }
</script>

<div
  class="screen-warp-handles"
  bind:this={containerEl}
  style="width: {containerWidth}px; height: {containerHeight}px;"
>
  <!-- Outlines + mesh grid lines for ALL screens. -->
  <svg class="lines-overlay" width={containerWidth} height={containerHeight}>
    {#each $screens as s (s.id)}
      {@const isSel = $selectedScreenId === s.id}
      {@const stroke = isSel ? '#BB86FC' : 'rgba(187, 134, 252, 0.35)'}
      {@const sw = isSel ? 2 : 1}
      {@const dash = s.enabled ? 'none' : '5 4'}
      {@const mode = s.warpMode ?? 'rect'}
      {#if mode === 'rect'}
        <polygon points={rectPath(s)} fill="none" stroke={stroke} stroke-width={sw} stroke-dasharray={dash} />
      {:else if mode === 'corners' && s.corners}
        <polygon points={cornersPath(s.corners)} fill="none" stroke={stroke} stroke-width={sw} stroke-dasharray={dash} />
      {:else if mode === 'mesh' && s.meshGrid}
        {@const g = s.meshGrid}
        {#each g.points as row, ri}
          {#each row as p, ci}
            {#if ci < g.cols - 1}
              {@const pn = g.points[ri][ci + 1]}
              <line x1={px(p.x)} y1={py(p.y)} x2={px(pn.x)} y2={py(pn.y)} stroke={stroke} stroke-width={sw} stroke-dasharray={dash}/>
            {/if}
            {#if ri < g.rows - 1}
              {@const pd = g.points[ri + 1][ci]}
              <line x1={px(p.x)} y1={py(p.y)} x2={px(pd.x)} y2={py(pd.y)} stroke={stroke} stroke-width={sw} stroke-dasharray={dash}/>
            {/if}
          {/each}
        {/each}
      {/if}
      <!-- Label at the warp's top-left. -->
      {#if mode === 'rect'}
        <text x={px(s.cropX) + 6} y={py(s.cropY) + 14} fill={stroke} font-size="13" font-family="Geist Mono, ui-monospace, monospace" paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">{s.name}</text>
      {:else if mode === 'corners' && s.corners}
        <text x={px(s.corners.topLeft.x) + 6} y={py(s.corners.topLeft.y) + 14} fill={stroke} font-size="13" font-family="Geist Mono, ui-monospace, monospace" paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">{s.name}</text>
      {:else if mode === 'mesh' && s.meshGrid}
        <text x={px(s.meshGrid.points[0][0].x) + 6} y={py(s.meshGrid.points[0][0].y) + 14} fill={stroke} font-size="13" font-family="Geist Mono, ui-monospace, monospace" paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">{s.name}</text>
      {/if}
    {/each}
  </svg>

  <!-- Selected-screen handles (HTML divs positioned absolutely). -->
  {#each $screens as s (s.id)}
    {#if $selectedScreenId === s.id && s.enabled}
      {@const mode = s.warpMode ?? 'rect'}

      {#if mode === 'rect'}
        {@const cx0 = px(s.cropX)}
        {@const cy0 = py(s.cropY)}
        {@const cx1 = px(s.cropX + s.cropW)}
        {@const cy1 = py(s.cropY + s.cropH)}
        <!-- 4 round corner handles -->
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'rect-corner' && drag?.kind.corner === 'nw'}
          style="left:{cx0}px; top:{cy0}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-corner', corner: 'nw' })}>
          <span class="handle-label">{s.name} TL</span>
        </div>
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'rect-corner' && drag?.kind.corner === 'ne'}
          style="left:{cx1}px; top:{cy0}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-corner', corner: 'ne' })}>
          <span class="handle-label">{s.name} TR</span>
        </div>
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'rect-corner' && drag?.kind.corner === 'sw'}
          style="left:{cx0}px; top:{cy1}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-corner', corner: 'sw' })}>
          <span class="handle-label">{s.name} BL</span>
        </div>
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'rect-corner' && drag?.kind.corner === 'se'}
          style="left:{cx1}px; top:{cy1}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-corner', corner: 'se' })}>
          <span class="handle-label">{s.name} BR</span>
        </div>

        <!-- 4 edge handles -->
        {@const ex = (cx0 + cx1) / 2}
        {@const ey = (cy0 + cy1) / 2}
        <div class="handle edge-handle edge-top" class:dragging={drag?.kind.kind === 'rect-edge' && drag?.kind.edge === 'top'}
          style="left:{ex}px; top:{cy0}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-edge', edge: 'top' })}></div>
        <div class="handle edge-handle edge-bottom" class:dragging={drag?.kind.kind === 'rect-edge' && drag?.kind.edge === 'bottom'}
          style="left:{ex}px; top:{cy1}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-edge', edge: 'bottom' })}></div>
        <div class="handle edge-handle edge-left" class:dragging={drag?.kind.kind === 'rect-edge' && drag?.kind.edge === 'left'}
          style="left:{cx0}px; top:{ey}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-edge', edge: 'left' })}></div>
        <div class="handle edge-handle edge-right" class:dragging={drag?.kind.kind === 'rect-edge' && drag?.kind.edge === 'right'}
          style="left:{cx1}px; top:{ey}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-edge', edge: 'right' })}></div>

        <!-- Center move handle -->
        {@const ctr = rectCenter(s)}
        <div class="handle move-handle" class:dragging={drag?.kind.kind === 'rect-move'}
          style="left:{ctr.x}px; top:{ctr.y}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-move' })}
          title="Drag to move {s.name}">✥</div>

      {:else if mode === 'corners' && s.corners}
        {#each (['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as Array<keyof WarpCorners>) as cn}
          {@const cp = s.corners[cn]}
          <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'corner' && drag?.kind.corner === cn}
            style="left:{px(cp.x)}px; top:{py(cp.y)}px;"
            onmousedown={(e) => startDrag(e, s.id, { kind: 'corner', corner: cn })}>
            <span class="handle-label">{s.name} {cn}</span>
          </div>
        {/each}
        {@const ctr = cornersCenter(s.corners)}
        <div class="handle move-handle" class:dragging={drag?.kind.kind === 'corners-move'}
          style="left:{ctr.x}px; top:{ctr.y}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'corners-move' })}
          title="Drag to move {s.name}">✥</div>

      {:else if mode === 'mesh' && s.meshGrid}
        {@const g = s.meshGrid}
        {#each g.points as row, ri}
          {#each row as p, ci}
            {@const isCorner = (ri === 0 || ri === g.rows - 1) && (ci === 0 || ci === g.cols - 1)}
            {@const isEdge = ri === 0 || ri === g.rows - 1 || ci === 0 || ci === g.cols - 1}
            <div
              class="handle mesh-handle"
              class:corner={isCorner}
              class:edge={isEdge && !isCorner}
              class:inner={!isEdge}
              class:dragging={drag?.kind.kind === 'mesh' && drag?.kind.row === ri && drag?.kind.col === ci}
              style="left:{px(p.x)}px; top:{py(p.y)}px;"
              onmousedown={(e) => startDrag(e, s.id, { kind: 'mesh', row: ri, col: ci })}
            ></div>
          {/each}
        {/each}
        {@const ctr = meshCenter(g)}
        <div class="handle move-handle" class:dragging={drag?.kind.kind === 'mesh-move'}
          style="left:{ctr.x}px; top:{ctr.y}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'mesh-move' })}
          title="Drag to move {s.name}">✥</div>
      {/if}

    {/if}
  {/each}
</div>

<style>
  .screen-warp-handles {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 50;
    user-select: none;
    -webkit-user-select: none;
  }
  .lines-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .handle {
    position: absolute;
    pointer-events: auto;
    transition: transform 0.1s ease, background 0.1s ease;
    z-index: 50;
  }

  /* Corner handles — same as WarpHandles corner-handle. */
  .corner-handle {
    width: 20px; height: 20px;
    margin-left: -10px; margin-top: -10px;
    background: #BB86FC;
    border: 2px solid #fff;
    border-radius: 50%;
    cursor: grab;
  }
  .corner-handle:hover { transform: scale(1.2); background: #CF6EFF; }
  .corner-handle.dragging {
    cursor: grabbing;
    transform: scale(1.3);
    background: #ffff00;
  }

  /* Edge handles — same as WarpHandles edge-handle. */
  .edge-handle {
    background: #00aaff;
    border: 2px solid #fff;
    border-radius: 3px;
    cursor: move;
  }
  .edge-handle.edge-top,
  .edge-handle.edge-bottom { width: 40px; height: 12px; margin-left: -20px; margin-top: -6px; }
  .edge-handle.edge-left,
  .edge-handle.edge-right { width: 12px; height: 40px; margin-left: -6px; margin-top: -20px; }
  .edge-handle:hover { background: #00ccff; transform: scale(1.1); }
  .edge-handle.dragging { background: #ffff00; transform: scale(1.15); }

  /* Move handle — same as WarpHandles move-handle. */
  .move-handle {
    width: 36px; height: 36px;
    margin-left: -18px; margin-top: -18px;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #BB86FC;
    border-radius: 50%;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #BB86FC;
    font-size: 19px;
    line-height: 1;
  }
  .move-handle:hover { background: rgba(187, 134, 252, 0.2); }
  .move-handle.dragging {
    cursor: grabbing;
    background: rgba(255, 255, 0, 0.2);
    border-color: #ffff00;
    color: #ffff00;
  }

  /* Mesh handles — same as MeshWarpHandles. */
  .mesh-handle { cursor: grab; }
  .mesh-handle.corner {
    width: 16px; height: 16px;
    margin-left: -8px; margin-top: -8px;
    background: #ff00aa;
    border: 2px solid #fff;
    border-radius: 50%;
  }
  .mesh-handle.edge {
    width: 12px; height: 12px;
    margin-left: -6px; margin-top: -6px;
    background: #ff66cc;
    border: 2px solid #fff;
    border-radius: 50%;
  }
  .mesh-handle.inner {
    width: 10px; height: 10px;
    margin-left: -5px; margin-top: -5px;
    background: #ffaadd;
    border: 1px solid #fff;
    border-radius: 50%;
  }
  .mesh-handle:hover { transform: scale(1.3); }
  .mesh-handle.dragging {
    cursor: grabbing;
    transform: scale(1.5);
    background: #ffff00;
  }

  .handle-label {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
    margin-bottom: 4px;
  }
  .corner-handle:hover .handle-label { opacity: 1; }

</style>
