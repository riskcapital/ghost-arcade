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
  import { onDestroy } from 'svelte';
  import { settings } from '../stores/settings';
  import type { WarpCorners, MeshWarpGrid } from '../types';

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

  function startDrag(e: MouseEvent, kind: DragKind) {
    e.preventDefault();
    e.stopPropagation();
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
    if ((window as any).__MWARP_DEBUG__ !== false) console.log('[mwarp] handle drag start', kind, { enabled: warp.enabled, mode });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseUp() {
    drag = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  onDestroy(() => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
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
      if ((window as any).__MWARP_DEBUG__ !== false) console.log('[mwarp] write corner', k.corner, next[k.corner]);
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
      const nx = clamp01(p0.x + dxN), ny = clamp01(p0.y + dyN);
      const points = g.points.map((row, r) =>
        row.map((pt, c) => (r === k.row && c === k.col ? { x: nx, y: ny } : pt))
      );
      settings.setMasterWarp({ meshGrid: { rows: g.rows, cols: g.cols, points } });
    } else if (k.kind === 'mesh-move' && drag.startMesh) {
      const g = drag.startMesh;
      const points = g.points.map(row => row.map(pt => ({ x: clamp01(pt.x + dxN), y: clamp01(pt.y + dyN) })));
      settings.setMasterWarp({ meshGrid: { rows: g.rows, cols: g.cols, points } });
    }
  }

  // ─── Pixel helpers ─────────────────────────────────────────────────
  const px = (nx: number) => nx * containerWidth;
  const py = (ny: number) => ny * containerHeight;

  function cornersCenter(c: WarpCorners) {
    return {
      x: px((c.topLeft.x + c.topRight.x + c.bottomLeft.x + c.bottomRight.x) / 4),
      y: py((c.topLeft.y + c.topRight.y + c.bottomLeft.y + c.bottomRight.y) / 4),
    };
  }
  function meshCenter(g: MeshWarpGrid) {
    let sx = 0, sy = 0, n = 0;
    for (const row of g.points) for (const p of row) { sx += p.x; sy += p.y; n++; }
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
          font-size="11" font-family="ui-monospace, monospace"
          paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">Master warp</text>
      {:else if mode === 'mesh' && meshGrid}
        {@const g = meshGrid}
        {#each g.points as row, ri}
          {#each row as p, ci}
            {#if ci < g.cols - 1}
              {@const pn = g.points[ri][ci + 1]}
              <line x1={px(p.x)} y1={py(p.y)} x2={px(pn.x)} y2={py(pn.y)} stroke="#f0a35e" stroke-width="1.5" />
            {/if}
            {#if ri < g.rows - 1}
              {@const pd = g.points[ri + 1][ci]}
              <line x1={px(p.x)} y1={py(p.y)} x2={px(pd.x)} y2={py(pd.y)} stroke="#f0a35e" stroke-width="1.5" />
            {/if}
          {/each}
        {/each}
        <text x={px(g.points[0][0].x) + 6} y={py(g.points[0][0].y) + 16} fill="#f0a35e"
          font-size="11" font-family="ui-monospace, monospace"
          paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">Master warp</text>
      {/if}
    </svg>

    <!-- Handles -->
    {#if mode === 'corners'}
      {#each CORNER_KEYS as cn}
        {@const cp = corners[cn]}
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'corner' && drag?.kind.corner === cn}
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
            style="left:{px(p.x)}px; top:{py(p.y)}px;"
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

  .move-handle {
    width: 36px; height: 36px;
    margin-left: -18px; margin-top: -18px;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #f0a35e;
    border-radius: 50%;
    cursor: grab;
    display: flex; align-items: center; justify-content: center;
    color: #f0a35e;
    font-size: 18px; line-height: 1;
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

  .handle-label {
    position: absolute;
    bottom: 100%; left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    font-size: 10px;
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
