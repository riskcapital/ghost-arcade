<script lang="ts">
  /**
   * MasterWarpHandles — on-editor-canvas overlay for the MASTER output
   * warp: a single corner/mesh warp applied to the whole composite
   * (settings.output.masterOutputWarp). Shown when the Screens tab is
   * active AND master-warp editing is toggled on (uiState.masterWarpEditing).
   *
   * This is the "someone bumped the projector, nudge the entire output"
   * tool — distinct from the per-screen handles (purple) and rendered in
   * CYAN so the operator always knows they're moving the whole rig, not
   * one screen.
   *
   * Coordinate space: the warp's control points are projector-unit-quad
   * 0..1, top-origin, spanning the full canvas — so px(nx) = nx * width
   * maps them directly onto editor pixels, same as the layer/screen
   * handles. Drag model copies ScreenWarpHandles exactly (mousedown
   * stashes a snapshot, window-level mousemove/mouseup until release).
   */
  import { onDestroy } from 'svelte';
  import type { WarpCorners, MeshWarpGrid } from '../types';
  import type { OutputWarp } from '../stores/settings';
  import { masterOutputWarp, masterWarpActions } from '../stores/screens';
  import { identityOutputCorners, identityOutputMesh } from '../stores/settings';

  interface Props {
    containerWidth: number;
    containerHeight: number;
    zoom?: number;
  }
  let { containerWidth, containerHeight, zoom = 1 }: Props = $props();

  // Effective geometry — fall back to identity so handles always render
  // even before the operator drags (matches the lazy-init in the store).
  let warp = $derived($masterOutputWarp as OutputWarp);
  let corners = $derived(warp.corners ?? identityOutputCorners());
  let mesh = $derived(warp.meshGrid ?? identityOutputMesh());

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
    startMesh: MeshWarpGrid;
  } | null = $state(null);

  function startDrag(e: MouseEvent, kind: DragKind) {
    e.preventDefault();
    e.stopPropagation();
    drag = {
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCorners: { ...corners },
      startMesh: structuredClone(mesh),
    };
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

  function onMouseMove(e: MouseEvent) {
    if (!drag) return;
    const dxN = ((e.clientX - drag.startClientX) / zoom) / Math.max(1, containerWidth);
    const dyN = ((e.clientY - drag.startClientY) / zoom) / Math.max(1, containerHeight);
    const k = drag.kind;
    if (k.kind === 'corner') {
      const c0 = drag.startCorners[k.corner];
      const nx = Math.min(Math.max(0, c0.x + dxN), 1);
      const ny = Math.min(Math.max(0, c0.y + dyN), 1);
      masterWarpActions.setGeometry({ corners: { ...drag.startCorners, [k.corner]: { x: nx, y: ny } } });
    } else if (k.kind === 'corners-move') {
      const c = drag.startCorners;
      masterWarpActions.setGeometry({
        corners: {
          topLeft:     { x: c.topLeft.x     + dxN, y: c.topLeft.y     + dyN },
          topRight:    { x: c.topRight.x    + dxN, y: c.topRight.y    + dyN },
          bottomLeft:  { x: c.bottomLeft.x  + dxN, y: c.bottomLeft.y  + dyN },
          bottomRight: { x: c.bottomRight.x + dxN, y: c.bottomRight.y + dyN },
        },
      });
    } else if (k.kind === 'mesh') {
      const g = drag.startMesh;
      const p0 = g.points[k.row]?.[k.col];
      if (!p0) return;
      const nx = Math.min(Math.max(0, p0.x + dxN), 1);
      const ny = Math.min(Math.max(0, p0.y + dyN), 1);
      const points = g.points.map((row, r) =>
        row.map((pt, c) => (r === k.row && c === k.col ? { x: nx, y: ny } : pt))
      );
      masterWarpActions.setGeometry({ meshGrid: { rows: g.rows, cols: g.cols, points } });
    } else if (k.kind === 'mesh-move') {
      const g = drag.startMesh;
      const points = g.points.map(row => row.map(pt => ({ x: pt.x + dxN, y: pt.y + dyN })));
      masterWarpActions.setGeometry({ meshGrid: { rows: g.rows, cols: g.cols, points } });
    }
  }

  function px(nx: number): number { return nx * containerWidth; }
  function py(ny: number): number { return ny * containerHeight; }

  function cornersPath(c: WarpCorners): string {
    return `${px(c.topLeft.x)},${py(c.topLeft.y)} ${px(c.topRight.x)},${py(c.topRight.y)} ${px(c.bottomRight.x)},${py(c.bottomRight.y)} ${px(c.bottomLeft.x)},${py(c.bottomLeft.y)}`;
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
</script>

<div class="master-warp-handles" style="width: {containerWidth}px; height: {containerHeight}px;">
  <svg class="lines-overlay" width={containerWidth} height={containerHeight}>
    {#if warp.mode === 'corners'}
      <polygon points={cornersPath(corners)} fill="none" stroke="#00e5d0" stroke-width="2" />
      <text x={px(corners.topLeft.x) + 6} y={py(corners.topLeft.y) + 14} fill="#00e5d0" font-size="11" font-family="ui-monospace, monospace" paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">MASTER</text>
    {:else}
      {#each mesh.points as row, ri}
        {#each row as p, ci}
          {#if ci < mesh.cols - 1}
            {@const pn = mesh.points[ri][ci + 1]}
            <line x1={px(p.x)} y1={py(p.y)} x2={px(pn.x)} y2={py(pn.y)} stroke="#00e5d0" stroke-width="2"/>
          {/if}
          {#if ri < mesh.rows - 1}
            {@const pd = mesh.points[ri + 1][ci]}
            <line x1={px(p.x)} y1={py(p.y)} x2={px(pd.x)} y2={py(pd.y)} stroke="#00e5d0" stroke-width="2"/>
          {/if}
        {/each}
      {/each}
      <text x={px(mesh.points[0][0].x) + 6} y={py(mesh.points[0][0].y) + 14} fill="#00e5d0" font-size="11" font-family="ui-monospace, monospace" paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">MASTER</text>
    {/if}
  </svg>

  {#if warp.mode === 'corners'}
    {#each (['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as Array<keyof WarpCorners>) as cn}
      {@const cp = corners[cn]}
      <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'corner' && drag?.kind.corner === cn}
        style="left:{px(cp.x)}px; top:{py(cp.y)}px;"
        onmousedown={(e) => startDrag(e, { kind: 'corner', corner: cn })}>
        <span class="handle-label">{cn}</span>
      </div>
    {/each}
    {@const ctr = cornersCenter(corners)}
    <div class="handle move-handle" class:dragging={drag?.kind.kind === 'corners-move'}
      style="left:{ctr.x}px; top:{ctr.y}px;"
      onmousedown={(e) => startDrag(e, { kind: 'corners-move' })}
      title="Drag to move the whole output">✥</div>
  {:else}
    {#each mesh.points as row, ri}
      {#each row as p, ci}
        {@const isCorner = (ri === 0 || ri === mesh.rows - 1) && (ci === 0 || ci === mesh.cols - 1)}
        {@const isEdge = ri === 0 || ri === mesh.rows - 1 || ci === 0 || ci === mesh.cols - 1}
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
    {@const ctr = meshCenter(mesh)}
    <div class="handle move-handle" class:dragging={drag?.kind.kind === 'mesh-move'}
      style="left:{ctr.x}px; top:{ctr.y}px;"
      onmousedown={(e) => startDrag(e, { kind: 'mesh-move' })}
      title="Drag to move the whole output">✥</div>
  {/if}
</div>

<style>
  .master-warp-handles {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 51; /* above per-screen handles */
    user-select: none;
    -webkit-user-select: none;
  }
  .lines-overlay { position: absolute; top: 0; left: 0; pointer-events: none; }

  .handle {
    position: absolute;
    pointer-events: auto;
    transition: transform 0.1s ease, background 0.1s ease;
    z-index: 51;
  }

  .corner-handle {
    width: 20px; height: 20px;
    margin-left: -10px; margin-top: -10px;
    background: #00e5d0;
    border: 2px solid #fff;
    border-radius: 50%;
    cursor: grab;
  }
  .corner-handle:hover { transform: scale(1.2); background: #2ff5e2; }
  .corner-handle.dragging { cursor: grabbing; transform: scale(1.3); background: #ffff00; }

  .move-handle {
    width: 36px; height: 36px;
    margin-left: -18px; margin-top: -18px;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #00e5d0;
    border-radius: 50%;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #00e5d0;
    font-size: 18px;
    line-height: 1;
  }
  .move-handle:hover { background: rgba(0, 229, 208, 0.2); }
  .move-handle.dragging { cursor: grabbing; background: rgba(255, 255, 0, 0.2); border-color: #ffff00; color: #ffff00; }

  .mesh-handle { cursor: grab; }
  .mesh-handle.corner {
    width: 16px; height: 16px; margin-left: -8px; margin-top: -8px;
    background: #00e5d0; border: 2px solid #fff; border-radius: 50%;
  }
  .mesh-handle.edge {
    width: 12px; height: 12px; margin-left: -6px; margin-top: -6px;
    background: #4af0e2; border: 2px solid #fff; border-radius: 50%;
  }
  .mesh-handle.inner {
    width: 10px; height: 10px; margin-left: -5px; margin-top: -5px;
    background: #9af7ee; border: 1px solid #fff; border-radius: 50%;
  }
  .mesh-handle:hover { transform: scale(1.3); }
  .mesh-handle.dragging { cursor: grabbing; transform: scale(1.5); background: #ffff00; }

  .handle-label {
    position: absolute;
    bottom: 100%;
    left: 50%;
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
