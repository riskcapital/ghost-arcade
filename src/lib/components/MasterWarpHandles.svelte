<script lang="ts">
  /**
   * MasterWarpHandles — on-editor-canvas overlay for the GLOBAL master
   * warp (settings.output.masterWarp). One warp on the whole output
   * composite, distinct from per-Screen warp. Visual + interaction model
   * mirrors ScreenWarpHandles exactly, but:
   *   - targets the single master warp, not a selected slice;
   *   - orange accent (vs the purple screen handles) so the operator
   *     can tell "this warps EVERYTHING" apart from a per-screen warp;
   *   - two clean modes: Corners (4-point edge/quad warp) and Mesh
   *     (grid of control points). No numeric entry — drag only.
   *
   * Coordinate system: corner / mesh points are normalized 0..1 sample
   * positions on the master canvas (y=0 at top, no flip), identical to
   * the screen-warp convention so pixel mapping is `n * containerSize`.
   * Identity (TL 0,0 / TR 1,0 / BL 0,1 / BR 1,1) is a visual no-op.
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { project } from '../stores/layers';
  import { settings } from '../stores/settings';
  import type { WarpCorners, MeshWarpGrid } from '../types';
  import { normalizedWarpNudge } from '../utils/warpNudge';

  interface Props {
    containerWidth: number;
    containerHeight: number;
    zoom?: number;
  }
  let { containerWidth, containerHeight, zoom = 1 }: Props = $props();

  const IDENTITY_CORNERS: WarpCorners = {
    topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
    bottomLeft: { x: 0, y: 1 }, bottomRight: { x: 1, y: 1 },
  };

  // Live master warp (reactive).
  let warp = $derived($settings.output.masterWarp ?? { enabled: false, mode: 'corners' as const });
  let mode = $derived(warp.mode === 'mesh' && warp.meshGrid ? 'mesh' : 'corners');
  let corners = $derived(warp.corners ?? IDENTITY_CORNERS);
  let meshGrid = $derived(warp.meshGrid ?? null);

  // ─── Drag state ────────────────────────────────────────────────────
  type DragKind =
    | { kind: 'corner'; corner: keyof WarpCorners }
    | { kind: 'corners-move' }
    | { kind: 'mesh'; row: number; col: number }
    | { kind: 'mesh-move' };

  let drag: {
    kind: DragKind;
    startClientX: number;
    startClientY: number;
    startCorners: WarpCorners;
    startMesh: MeshWarpGrid | null;
  } | null = $state(null);
  let selectedCorner: keyof WarpCorners | null = $state(null);
  let selectedMeshPoint: { row: number; col: number } | null = $state(null);

  function startDrag(e: MouseEvent, kind: DragKind) {
    e.preventDefault();
    e.stopPropagation();
    cancelDrag();
    if (kind.kind === 'corner') {
      selectedCorner = kind.corner;
      selectedMeshPoint = null;
    } else if (kind.kind === 'mesh') {
      selectedCorner = null;
      selectedMeshPoint = { row: kind.row, col: kind.col };
    } else {
      selectedCorner = null;
      selectedMeshPoint = null;
    }
    drag = {
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCorners: { ...corners, topLeft: { ...corners.topLeft }, topRight: { ...corners.topRight }, bottomLeft: { ...corners.bottomLeft }, bottomRight: { ...corners.bottomRight } },
      // Manual deep-copy (not structuredClone — it throws DataCloneError
      // on some nested store values) of the {rows,cols,points} lattice.
      startMesh: meshGrid
        ? { rows: meshGrid.rows, cols: meshGrid.cols, points: meshGrid.points.map(r => r.map(p => ({ x: p.x, y: p.y }))) }
        : null,
    };
    if ((window as any).__MWARP_DEBUG__ === true) console.log('[mwarp] handle drag start', kind, { enabled: warp.enabled, mode });
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

  function onMouseUp() {
    cancelDrag();
  }

  function onVisibilityChange() {
    if (document.hidden) cancelDrag();
  }

  function isTextEditingTarget(target: EventTarget | null) {
    const el = target instanceof HTMLElement ? target : null;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const tag = el?.tagName;
    const activeTag = active?.tagName;
    return (
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' ||
      Boolean(el?.isContentEditable || active?.isContentEditable)
    );
  }

  function nudgeCorners(dx: number, dy: number) {
    const c = corners;
    const next: WarpCorners = {
      topLeft:     { x: clamp01(c.topLeft.x     + dx), y: clamp01(c.topLeft.y     + dy) },
      topRight:    { x: clamp01(c.topRight.x    + dx), y: clamp01(c.topRight.y    + dy) },
      bottomLeft:  { x: clamp01(c.bottomLeft.x  + dx), y: clamp01(c.bottomLeft.y  + dy) },
      bottomRight: { x: clamp01(c.bottomRight.x + dx), y: clamp01(c.bottomRight.y + dy) },
    };
    settings.setMasterWarp({ corners: next });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!warp.enabled || isTextEditingTarget(e.target)) return;

    if (e.key === 'Escape') {
      selectedCorner = null;
      selectedMeshPoint = null;
      cancelDrag();
      return;
    }

    const proj = get(project);
    const step = normalizedWarpNudge(
      proj.width,
      proj.height,
      get(settings).ui.warpDragGranularity,
      e.shiftKey ? 10 : 1,
    );

    let dx = 0;
    let dy = 0;
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
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (mode === 'corners' && selectedCorner) {
      const current = corners[selectedCorner];
      settings.setMasterWarp({
        corners: {
          ...corners,
          [selectedCorner]: { x: clamp01(current.x + dx), y: clamp01(current.y + dy) },
        },
      });
      return;
    }

    if (mode === 'mesh' && meshGrid && selectedMeshPoint) {
      const { row, col } = selectedMeshPoint;
      const p = meshGrid.points[row]?.[col];
      if (!p) return;
      const curNorm = meshLocalToNorm(p.x, p.y);
      const next = normToMeshLocal(clamp01(curNorm.x + dx), clamp01(curNorm.y + dy));
      const points = meshGrid.points.map((meshRow, ri) =>
        meshRow.map((pt, ci) => (ri === row && ci === col ? { x: next.u, y: next.v } : pt))
      );
      settings.setMasterWarp({ meshGrid: { rows: meshGrid.rows, cols: meshGrid.cols, points } });
      return;
    }

    nudgeCorners(dx, dy);
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', cancelDrag);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onDestroy(() => {
    cancelDrag();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('blur', cancelDrag);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  const clamp01 = (v: number) => Math.min(Math.max(0, v), 1);

  function onMouseMove(e: MouseEvent) {
    if (!drag) return;
    // Zoom-corrected normalized delta — same recipe as ScreenWarpHandles.
    const dxN = ((e.clientX - drag.startClientX) / zoom) / Math.max(1, containerWidth);
    const dyN = ((e.clientY - drag.startClientY) / zoom) / Math.max(1, containerHeight);
    const k = drag.kind;

    if (k.kind === 'corner') {
      const c0 = drag.startCorners[k.corner];
      const next = { ...drag.startCorners, [k.corner]: { x: clamp01(c0.x + dxN), y: clamp01(c0.y + dyN) } };
      settings.setMasterWarp({ corners: next });
      if ((window as any).__MWARP_DEBUG__ === true) console.log('[mwarp] write corner', k.corner, next[k.corner]);
    } else if (k.kind === 'corners-move') {
      const c = drag.startCorners;
      const next: WarpCorners = {
        topLeft:     { x: clamp01(c.topLeft.x     + dxN), y: clamp01(c.topLeft.y     + dyN) },
        topRight:    { x: clamp01(c.topRight.x    + dxN), y: clamp01(c.topRight.y    + dyN) },
        bottomLeft:  { x: clamp01(c.bottomLeft.x  + dxN), y: clamp01(c.bottomLeft.y  + dyN) },
        bottomRight: { x: clamp01(c.bottomRight.x + dxN), y: clamp01(c.bottomRight.y + dyN) },
      };
      settings.setMasterWarp({ corners: next });
    } else if (k.kind === 'mesh' && drag.startMesh) {
      const g = drag.startMesh;
      const p0 = g.points[k.row]?.[k.col];
      if (!p0) return;
      // The point is quad-local; the cursor moves in master-canvas space.
      // Map the point's current local pos → master-canvas, add the drag
      // delta, then inverse-map back to local so the handle tracks the
      // cursor inside the warped quad (matches map mode).
      const curNorm = meshLocalToNorm(p0.x, p0.y);
      const next = normToMeshLocal(clamp01(curNorm.x + dxN), clamp01(curNorm.y + dyN));
      const points = g.points.map((row, r) =>
        row.map((pt, c) => (r === k.row && c === k.col ? { x: next.u, y: next.v } : pt))
      );
      settings.setMasterWarp({ meshGrid: { rows: g.rows, cols: g.cols, points } });
    } else if (k.kind === 'mesh-move' && drag.startMesh) {
      // Whole-mesh nudge in local space (deltas are small; local≈master
      // scale near identity — good enough for a coarse move handle).
      const g = drag.startMesh;
      const points = g.points.map(row => row.map(pt => ({ x: clamp01(pt.x + dxN), y: clamp01(pt.y + dyN) })));
      settings.setMasterWarp({ meshGrid: { rows: g.rows, cols: g.cols, points } });
    }
  }

  // ─── Pixel helpers ─────────────────────────────────────────────────
  const px = (nx: number) => nx * containerWidth;
  const py = (ny: number) => ny * containerHeight;

  // Mesh points are quad-LOCAL 0..1 (they deform within the corner quad),
  // so handle display/drag must map through the corner quad — same as the
  // layer MeshWarpHandles. Bilinear: local (u,v) → master-canvas 0..1.
  function meshLocalToNorm(u: number, v: number): { x: number; y: number } {
    const c = corners;
    const topX = c.topLeft.x + (c.topRight.x - c.topLeft.x) * u;
    const topY = c.topLeft.y + (c.topRight.y - c.topLeft.y) * u;
    const botX = c.bottomLeft.x + (c.bottomRight.x - c.bottomLeft.x) * u;
    const botY = c.bottomLeft.y + (c.bottomRight.y - c.bottomLeft.y) * u;
    return { x: topX + (botX - topX) * v, y: topY + (botY - topY) * v };
  }
  const meshPx = (u: number, v: number) => px(meshLocalToNorm(u, v).x);
  const meshPy = (u: number, v: number) => py(meshLocalToNorm(u, v).y);
  // Inverse bilinear (Inigo Quilez closed form) — master-canvas 0..1 → quad-local.
  function cross2(ax: number, ay: number, bx: number, by: number) { return ax * by - ay * bx; }
  function normToMeshLocal(pxN: number, pyN: number): { u: number; v: number } {
    const c = corners;
    const a = c.topLeft, b = c.topRight, cc = c.bottomRight, d = c.bottomLeft;
    const ex = b.x - a.x, ey = b.y - a.y;
    const fx = d.x - a.x, fy = d.y - a.y;
    const gx = a.x - b.x + cc.x - d.x, gy = a.y - b.y + cc.y - d.y;
    const hx = pxN - a.x, hy = pyN - a.y;
    const k2 = cross2(gx, gy, fx, fy);
    const k1 = cross2(ex, ey, fx, fy) + cross2(hx, hy, gx, gy);
    const k0 = cross2(hx, hy, ex, ey);
    let v: number;
    if (Math.abs(k2) < 1e-6) {
      // Parallelogram (k2≈0) → linear solve. Guard k1≈0: a degenerate /
      // collapsed / collinear quad makes both k2 and k1 vanish → -k0/k1 is
      // 0/0 = NaN, which clamp01 does NOT sanitize (Math.max(0,NaN)=NaN)
      // and would persist into the stored mesh point. Bail to center.
      if (Math.abs(k1) < 1e-6) return { u: 0.5, v: 0.5 };
      v = -k0 / k1;
    } else {
      const w = k1 * k1 - 4 * k0 * k2;
      if (w < 0) return { u: 0.5, v: 0.5 };
      const sq = Math.sqrt(w);
      const v1 = (-k1 - sq) / (2 * k2), v2 = (-k1 + sq) / (2 * k2);
      v = (v1 >= 0 && v1 <= 1) ? v1 : v2;
    }
    const denomU = ex + gx * v;
    const denomU2 = ey + gy * v;
    const u = Math.abs(denomU) > 1e-6
      ? (hx - fx * v) / denomU
      : (Math.abs(denomU2) > 1e-6 ? (hy - fy * v) / denomU2 : 0.5);
    // Final NaN/Int sanitize — never let a bad value reach the stored mesh.
    const su = Number.isFinite(u) ? u : 0.5;
    const sv = Number.isFinite(v) ? v : 0.5;
    return { u: clamp01(su), v: clamp01(sv) };
  }

  function cornersCenter(c: WarpCorners) {
    return {
      x: px((c.topLeft.x + c.topRight.x + c.bottomLeft.x + c.bottomRight.x) / 4),
      y: py((c.topLeft.y + c.topRight.y + c.bottomLeft.y + c.bottomRight.y) / 4),
    };
  }
  function meshCenter(g: MeshWarpGrid) {
    // Average the points in master-canvas space (each pushed through the
    // corner quad) so the move handle sits at the visual center.
    let sx = 0, sy = 0, n = 0;
    for (const row of g.points) for (const p of row) {
      const np = meshLocalToNorm(p.x, p.y); sx += np.x; sy += np.y; n++;
    }
    return { x: px(sx / Math.max(1, n)), y: py(sy / Math.max(1, n)) };
  }
  const cornersPath = (c: WarpCorners) =>
    `${px(c.topLeft.x)},${py(c.topLeft.y)} ${px(c.topRight.x)},${py(c.topRight.y)} ${px(c.bottomRight.x)},${py(c.bottomRight.y)} ${px(c.bottomLeft.x)},${py(c.bottomLeft.y)}`;

  const CORNER_KEYS: Array<keyof WarpCorners> = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
  const CORNER_LABEL: Record<keyof WarpCorners, string> = {
    topLeft: 'TL', topRight: 'TR', bottomLeft: 'BL', bottomRight: 'BR',
  };
</script>

{#if warp.enabled}
  <div class="master-warp-handles" style="width: {containerWidth}px; height: {containerHeight}px;">
    <!-- Outline / grid lines -->
    <svg class="lines-overlay" width={containerWidth} height={containerHeight}>
      {#if mode === 'corners'}
        <polygon points={cornersPath(corners)} fill="none" stroke="#f0a35e" stroke-width="2" />
        <text x={px(corners.topLeft.x) + 6} y={py(corners.topLeft.y) + 16} fill="#f0a35e"
          font-size="13" font-family="IBM Plex Mono, ui-monospace, monospace"
          paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">Master warp</text>
      {:else if mode === 'mesh' && meshGrid}
        {@const g = meshGrid}
        {#each g.points as row, ri}
          {#each row as p, ci}
            {#if ci < g.cols - 1}
              {@const pn = g.points[ri][ci + 1]}
              <line x1={meshPx(p.x, p.y)} y1={meshPy(p.x, p.y)} x2={meshPx(pn.x, pn.y)} y2={meshPy(pn.x, pn.y)} stroke="#f0a35e" stroke-width="1.5" />
            {/if}
            {#if ri < g.rows - 1}
              {@const pd = g.points[ri + 1][ci]}
              <line x1={meshPx(p.x, p.y)} y1={meshPy(p.x, p.y)} x2={meshPx(pd.x, pd.y)} y2={meshPy(pd.x, pd.y)} stroke="#f0a35e" stroke-width="1.5" />
            {/if}
          {/each}
        {/each}
        <text x={meshPx(g.points[0][0].x, g.points[0][0].y) + 6} y={meshPy(g.points[0][0].x, g.points[0][0].y) + 16} fill="#f0a35e"
          font-size="13" font-family="IBM Plex Mono, ui-monospace, monospace"
          paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">Master warp</text>
      {/if}
    </svg>

    <!-- Handles -->
    {#if mode === 'corners'}
      {#each CORNER_KEYS as cn}
        {@const cp = corners[cn]}
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'corner' && drag?.kind.corner === cn}
          class:selected={selectedCorner === cn}
          style="left:{px(cp.x)}px; top:{py(cp.y)}px;"
          onmousedown={(e) => startDrag(e, { kind: 'corner', corner: cn })}>
          <span class="handle-label">{CORNER_LABEL[cn]}</span>
        </div>
      {/each}
      {@const ctr = cornersCenter(corners)}
      <div class="handle move-handle" class:dragging={drag?.kind.kind === 'corners-move'}
        style="left:{ctr.x}px; top:{ctr.y}px;"
        onmousedown={(e) => startDrag(e, { kind: 'corners-move' })}
        title="Drag to move the whole warp">✥</div>
    {:else if mode === 'mesh' && meshGrid}
      {@const g = meshGrid}
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
            class:selected={selectedMeshPoint?.row === ri && selectedMeshPoint?.col === ci}
            style="left:{meshPx(p.x, p.y)}px; top:{meshPy(p.x, p.y)}px;"
            onmousedown={(e) => startDrag(e, { kind: 'mesh', row: ri, col: ci })}
          ></div>
        {/each}
      {/each}
      {@const ctr = meshCenter(g)}
      <div class="handle move-handle" class:dragging={drag?.kind.kind === 'mesh-move'}
        style="left:{ctr.x}px; top:{ctr.y}px;"
        onmousedown={(e) => startDrag(e, { kind: 'mesh-move' })}
        title="Drag to move the whole warp">✥</div>
    {/if}
  </div>
{/if}

<style>
  .master-warp-handles {
    position: absolute;
    top: 0; left: 0;
    pointer-events: none;
    /* Above the purple screen handles so the global warp wins clicks. */
    z-index: 55;
    user-select: none;
    -webkit-user-select: none;
  }
  .lines-overlay { position: absolute; top: 0; left: 0; pointer-events: none; }

  .handle {
    position: absolute;
    pointer-events: auto;
    transition: transform 0.1s ease, background 0.1s ease;
    z-index: 55;
  }

  .corner-handle {
    width: 20px; height: 20px;
    margin-left: -10px; margin-top: -10px;
    background: #f0a35e;
    border: 2px solid #fff;
    border-radius: 50%;
    cursor: grab;
  }
  .corner-handle:hover { transform: scale(1.2); background: #ffb066; }
  .corner-handle.dragging { cursor: grabbing; transform: scale(1.3); background: #ffff00; }
  .corner-handle.selected {
    box-shadow: 0 0 0 3px rgba(240, 163, 94, 0.35), 0 0 18px rgba(240, 163, 94, 0.7);
  }

  .move-handle {
    width: 36px; height: 36px;
    margin-left: -18px; margin-top: -18px;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #f0a35e;
    border-radius: 50%;
    cursor: grab;
    display: flex; align-items: center; justify-content: center;
    color: #f0a35e;
    font-size: 19px; line-height: 1;
  }
  .move-handle:hover { background: rgba(240, 163, 94, 0.2); }
  .move-handle.dragging { cursor: grabbing; background: rgba(255, 255, 0, 0.2); border-color: #ffff00; color: #ffff00; }

  .mesh-handle { cursor: grab; }
  .mesh-handle.corner {
    width: 16px; height: 16px; margin-left: -8px; margin-top: -8px;
    background: #f0a35e; border: 2px solid #fff; border-radius: 50%;
  }
  .mesh-handle.edge {
    width: 12px; height: 12px; margin-left: -6px; margin-top: -6px;
    background: #f6bd86; border: 2px solid #fff; border-radius: 50%;
  }
  .mesh-handle.inner {
    width: 10px; height: 10px; margin-left: -5px; margin-top: -5px;
    background: #fad3b0; border: 1px solid #fff; border-radius: 50%;
  }
  .mesh-handle:hover { transform: scale(1.3); }
  .mesh-handle.dragging { cursor: grabbing; transform: scale(1.5); background: #ffff00; }
  .mesh-handle.selected {
    box-shadow: 0 0 0 3px rgba(240, 163, 94, 0.35), 0 0 14px rgba(240, 163, 94, 0.7);
  }

  .handle-label {
    position: absolute;
    bottom: 100%; left: 50%;
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
