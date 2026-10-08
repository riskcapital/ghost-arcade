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
   *
   * Bezier mesh: with the mesh's Bezier toggle on, the selected point
   * shows tangent handles that bend its cell edges, with the layer mesh's
   * rules (meshWarp.ts): handles move as a linked pair, Alt-drag unlinks
   * one, double-click straightens it, and the arrow keys nudge the handle
   * clicked last.
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { project } from '../stores/layers';
  import { settings } from '../stores/settings';
  import { recordDiscreteAction } from '../stores/historyHooks';
  import type { WarpCorners, MeshWarpGrid, Point2D } from '../types';
  import { normalizedWarpNudge } from '../utils/warpNudge';
  import { releaseFormControlFocus } from '../utils/formFocus';
  import { claimWarpKeys, ownsWarpKeys } from '../utils/warpKeyOwner';
  import { insetHandle, meshMoveGrip } from '../utils/warpHandleLayout';
  import { screens, selectedScreenId } from '../stores/screens';
  import {
    MESH_CURVE_SEGMENTS,
    cloneMeshGrid,
    meshEdgePoint,
    meshTangentLinked,
    meshTangentSides,
    meshTangentsAfterDrag,
    meshTangentsAfterStraighten,
    resolveMeshTangents,
    withMeshPointTangents,
    withMeshPoints,
    type MeshTangentSide,
  } from '../utils/meshWarp';

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
  // While a screen is selected on the Screens tab its handles are the ones
  // being edited, so they sit above these where the two overlap (a
  // screen's corner mesh point under a Master Warp corner could not be
  // picked). ScreenWarpHandles only draws an enabled selected screen.
  let yieldToScreen = $derived($screens.some((s) => s.id === $selectedScreenId && s.enabled));

  // ─── Drag state ────────────────────────────────────────────────────
  type DragKind =
    | { kind: 'corner'; corner: keyof WarpCorners }
    | { kind: 'corners-move' }
    | { kind: 'mesh'; row: number; col: number }
    | { kind: 'mesh-move' }
    | { kind: 'tangent'; row: number; col: number; side: MeshTangentSide };

  let drag: {
    kind: DragKind;
    startClientX: number;
    startClientY: number;
    startCorners: WarpCorners;
    startMesh: MeshWarpGrid | null;
  } | null = $state(null);
  let selectedCorner: keyof WarpCorners | null = $state(null);
  let selectedMeshPoint: { row: number; col: number } | null = $state(null);
  // Bezier mesh: the tangent handle the arrow keys nudge (the last one
  // clicked on the selected point).
  let selectedTangent: MeshTangentSide | null = $state(null);

  function startDrag(e: MouseEvent, kind: DragKind) {
    e.preventDefault();
    e.stopPropagation();
    // The arrow keys nudge what was pressed, not the panel control that
    // still has focus (a toggle just clicked, a number field).
    releaseFormControlFocus();
    claimWarpKeys('master');
    cancelDrag();
    if (kind.kind === 'corner') {
      selectedCorner = kind.corner;
      selectedMeshPoint = null;
    } else if (kind.kind === 'mesh') {
      selectedCorner = null;
      if (selectedMeshPoint?.row !== kind.row || selectedMeshPoint?.col !== kind.col) selectedTangent = null;
      selectedMeshPoint = { row: kind.row, col: kind.col };
    } else if (kind.kind === 'tangent') {
      selectedCorner = null;
      selectedMeshPoint = { row: kind.row, col: kind.col };
      selectedTangent = kind.side;
    } else {
      selectedCorner = null;
      selectedMeshPoint = null;
      selectedTangent = null;
    }
    drag = {
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCorners: { ...corners, topLeft: { ...corners.topLeft }, topRight: { ...corners.topRight }, bottomLeft: { ...corners.bottomLeft }, bottomRight: { ...corners.bottomRight } },
      // Manual deep-copy (not structuredClone — it throws DataCloneError
      // on some nested store values), tangents included.
      startMesh: meshGrid ? cloneMeshGrid(meshGrid) : null,
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

  /** A drag ends as one undo step (history skips it if nothing moved). */
  function endDrag() {
    const wasDragging = drag !== null;
    cancelDrag();
    if (wasDragging) recordDiscreteAction();
  }

  function onMouseUp() {
    endDrag();
  }

  function onVisibilityChange() {
    if (document.hidden) endDrag();
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
    if (!warp.enabled || isTextEditingTarget(e.target) || !ownsWarpKeys('master')) return;

    if (e.key === 'Escape') {
      // A selected tangent handle lets go first, then the point.
      if (selectedTangent) {
        selectedTangent = null;
      } else {
        selectedCorner = null;
        selectedMeshPoint = null;
      }
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
      recordDiscreteAction();
      return;
    }

    if (mode === 'mesh' && meshGrid && selectedMeshPoint) {
      const { row, col } = selectedMeshPoint;
      const p = meshGrid.points[row]?.[col];
      if (!p) return;
      // With a tangent handle picked on a Bezier mesh, the arrows move the
      // handle (Alt unlinks it from its mirror) instead of the point.
      if (selectedTangent && meshGrid.bezier && meshTangentSides(meshGrid, row, col).includes(selectedTangent)) {
        const t = resolveMeshTangents(meshGrid, row, col)[selectedTangent];
        const end = meshLocalToNorm(p.x + t.x, p.y + t.y);
        moveTangentEnd(meshGrid, row, col, selectedTangent, { x: end.x + dx, y: end.y + dy }, e.altKey);
        recordDiscreteAction();
        return;
      }
      const curNorm = meshLocalToNorm(p.x, p.y);
      const next = normToMeshLocal(clamp01(curNorm.x + dx), clamp01(curNorm.y + dy));
      const points = meshGrid.points.map((meshRow, ri) =>
        meshRow.map((pt, ci) => (ri === row && ci === col ? { x: next.u, y: next.v } : pt))
      );
      settings.setMasterWarp({ meshGrid: withMeshPoints(meshGrid, points) });
      recordDiscreteAction();
      return;
    }

    nudgeCorners(dx, dy);
    recordDiscreteAction();
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onDestroy(() => {
    cancelDrag();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('blur', endDrag);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  const clamp01 = (v: number) => Math.min(Math.max(0, v), 1);

  /** Put one tangent handle's end at a master-canvas position. The handle
   *  may sit outside the quad (a boundary edge bending outward), so its end
   *  goes through the unclamped inverse. */
  function moveTangentEnd(grid: MeshWarpGrid, row: number, col: number, side: MeshTangentSide, end: Point2D, unlink: boolean) {
    const local = normToMeshLocalRaw(end.x, end.y);
    const p = grid.points[row]?.[col];
    if (!local || !p) return;
    const tangents = meshTangentsAfterDrag(grid, row, col, side, { x: local.u - p.x, y: local.v - p.y }, unlink);
    settings.setMasterWarp({ meshGrid: withMeshPointTangents(grid, row, col, tangents) });
  }

  /** Double-click a tangent handle: back onto the straight edge. */
  function straightenTangent(row: number, col: number, side: MeshTangentSide) {
    const grid = meshGrid;
    if (!grid) return;
    settings.setMasterWarp({ meshGrid: withMeshPointTangents(grid, row, col, meshTangentsAfterStraighten(grid, row, col, side)) });
    recordDiscreteAction();
  }

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
      settings.setMasterWarp({ meshGrid: withMeshPoints(g, points) });
    } else if (k.kind === 'mesh-move' && drag.startMesh) {
      // Whole-mesh nudge in local space (deltas are small; local≈master
      // scale near identity — good enough for a coarse move handle).
      const g = drag.startMesh;
      const points = g.points.map(row => row.map(pt => ({ x: clamp01(pt.x + dxN), y: clamp01(pt.y + dyN) })));
      settings.setMasterWarp({ meshGrid: withMeshPoints(g, points) });
    } else if (k.kind === 'tangent' && drag.startMesh && meshGrid) {
      // The handle's end follows the cursor; linkedness and the stored
      // sides come from the live grid so an Alt unlink freezes the mirror
      // where it is now.
      const g = drag.startMesh;
      const p = g.points[k.row]?.[k.col];
      if (!p) return;
      const t = resolveMeshTangents(g, k.row, k.col)[k.side];
      const end = meshLocalToNorm(p.x + t.x, p.y + t.y);
      moveTangentEnd(meshGrid, k.row, k.col, k.side, { x: end.x + dxN, y: end.y + dyN }, e.altKey);
    }
  }

  // ─── Pixel helpers ─────────────────────────────────────────────────
  const px = (nx: number) => nx * containerWidth;
  const py = (ny: number) => ny * containerHeight;
  // Handles are drawn whole inside the canvas (a point on the right edge
  // would otherwise be half under the sidebar); `half` is the handle's
  // half-size in px. Lines keep the true positions.
  const hx = (x: number, half: number) => insetHandle(x, containerWidth, half);
  const hy = (y: number, half: number) => insetHandle(y, containerHeight, half);

  // A corner grip sits inside its corner, toward the middle of the quad, on
  // a short leader. The corner itself is often exactly where a screen's
  // corner point is (a full-canvas screen under an identity warp), and
  // there the selected screen's point is on top; the grip keeps the Master
  // Warp corner reachable beside it. It steps in far enough along both
  // axes to clear a corner point drawn at the same corner.
  const CORNER_GRIP_AXIS_INSET_PX = 22;
  const CORNER_GRIP_MAX_INSET_PX = 64;
  function cornerGrip(cn: keyof WarpCorners): { x: number; y: number; ox: number; oy: number } {
    const ox = px(corners[cn].x);
    const oy = py(corners[cn].y);
    const ctr = cornersCenter(corners);
    const dx = ctr.x - ox;
    const dy = ctr.y - oy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: hx(ox, 10), y: hy(oy, 10), ox, oy };
    const ux = dx / len;
    const uy = dy / len;
    const axis = Math.max(1e-3, Math.min(Math.abs(ux), Math.abs(uy)));
    const inset = Math.min(CORNER_GRIP_MAX_INSET_PX, len * 0.25, CORNER_GRIP_AXIS_INSET_PX / axis);
    return { x: hx(ox + ux * inset, 10), y: hy(oy + uy * inset, 10), ox, oy };
  }

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
    const raw = normToMeshLocalRaw(pxN, pyN);
    return raw ? { u: clamp01(raw.u), v: clamp01(raw.v) } : { u: 0.5, v: 0.5 };
  }
  function normToMeshLocalRaw(pxN: number, pyN: number): { u: number; v: number } | null {
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
      if (Math.abs(k1) < 1e-6) return null;
      v = -k0 / k1;
    } else {
      const w = k1 * k1 - 4 * k0 * k2;
      if (w < 0) return null;
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
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    return { u, v };
  }

  function cornersCenter(c: WarpCorners) {
    return {
      x: px((c.topLeft.x + c.topRight.x + c.bottomLeft.x + c.bottomRight.x) / 4),
      y: py((c.topLeft.y + c.topRight.y + c.bottomLeft.y + c.bottomRight.y) / 4),
    };
  }
  function meshCenter(g: MeshWarpGrid) {
    // The middle of the central cell, pushed through the corner quad: never
    // on a mesh point (the centre point of a 5x5 mesh used to be under it).
    const grip = meshMoveGrip(g.points, g.rows, g.cols);
    const np = meshLocalToNorm(grip.x, grip.y);
    return { x: px(np.x), y: py(np.y) };
  }
  const cornersPath = (c: WarpCorners) =>
    `${px(c.topLeft.x)},${py(c.topLeft.y)} ${px(c.topRight.x)},${py(c.topRight.y)} ${px(c.bottomRight.x)},${py(c.bottomRight.y)} ${px(c.bottomLeft.x)},${py(c.bottomLeft.y)}`;

  /** One cell edge as SVG polyline points: two when straight, sampled
   *  along its cubic in Bezier mode (the curve the core renders). */
  function edgePolyline(g: MeshWarpGrid, r0: number, c0: number, r1: number, c1: number): string {
    const steps = g.bezier ? MESH_CURVE_SEGMENTS : 1;
    const out: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = meshEdgePoint(g, r0, c0, r1, c1, i / steps);
      out.push(`${meshPx(p.x, p.y)},${meshPy(p.x, p.y)}`);
    }
    return out.join(' ');
  }

  // Tangent handles follow the point being dragged, or the selected one.
  function draggedMeshPoint(): { row: number; col: number } | null {
    const k = drag?.kind;
    return k && (k.kind === 'tangent' || k.kind === 'mesh') ? { row: k.row, col: k.col } : null;
  }
  let tangentPoint = $derived(draggedMeshPoint() ?? selectedMeshPoint);
  let tangentHandles = $derived.by(() => {
    const g = meshGrid;
    const point = tangentPoint;
    void containerWidth; void containerHeight; void corners;
    if (mode !== 'mesh' || !g?.bezier || !point || !g.points[point.row]?.[point.col]) return [];
    const origin = g.points[point.row][point.col];
    const resolved = resolveMeshTangents(g, point.row, point.col);
    return meshTangentSides(g, point.row, point.col).map((side) => {
      const end = meshLocalToNorm(origin.x + resolved[side].x, origin.y + resolved[side].y);
      return { side, x: px(end.x), y: py(end.y), linked: meshTangentLinked(g, point.row, point.col, side) };
    });
  });
  $effect(() => {
    if (!meshGrid?.bezier) selectedTangent = null;
  });

  const CORNER_KEYS: Array<keyof WarpCorners> = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
  const CORNER_LABEL: Record<keyof WarpCorners, string> = {
    topLeft: 'TL', topRight: 'TR', bottomLeft: 'BL', bottomRight: 'BR',
  };
</script>

{#if warp.enabled}
  <div data-help-page="projection-mapping" class="master-warp-handles" class:yield-to-screen={yieldToScreen} style="width: {containerWidth}px; height: {containerHeight}px;">
    <!-- Outline / grid lines -->
    <svg class="lines-overlay" width={containerWidth} height={containerHeight}>
      {#if mode === 'corners'}
        <polygon points={cornersPath(corners)} fill="none" stroke="#f0a35e" stroke-width="2" />
        {#each CORNER_KEYS as cn}
          {@const grip = cornerGrip(cn)}
          <line x1={grip.ox} y1={grip.oy} x2={grip.x} y2={grip.y} stroke="#f0a35e" stroke-width="1.5" stroke-opacity="0.8" />
        {/each}
        <text x={px(corners.topLeft.x) + 6} y={py(corners.topLeft.y) + 16} fill="#f0a35e"
          font-size="13" font-family="Geist Mono, ui-monospace, monospace"
          paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">Master warp</text>
      {:else if mode === 'mesh' && meshGrid}
        {@const g = meshGrid}
        {#each g.points as row, ri}
          {#each row as _p, ci}
            {#if ci < g.cols - 1}
              <polyline points={edgePolyline(g, ri, ci, ri, ci + 1)} fill="none" stroke="#f0a35e" stroke-width="1.5" />
            {/if}
            {#if ri < g.rows - 1}
              <polyline points={edgePolyline(g, ri, ci, ri + 1, ci)} fill="none" stroke="#f0a35e" stroke-width="1.5" />
            {/if}
          {/each}
        {/each}
        {#if tangentPoint && g.points[tangentPoint.row]?.[tangentPoint.col]}
          {@const o = g.points[tangentPoint.row][tangentPoint.col]}
          {#each tangentHandles as handle (handle.side)}
            <line x1={meshPx(o.x, o.y)} y1={meshPy(o.x, o.y)} x2={handle.x} y2={handle.y}
              stroke="#00d4ff" stroke-width="1" stroke-opacity="0.8" stroke-dasharray={handle.linked ? undefined : '3,3'} />
          {/each}
        {/if}
        <text x={meshPx(g.points[0][0].x, g.points[0][0].y) + 6} y={meshPy(g.points[0][0].x, g.points[0][0].y) + 16} fill="#f0a35e"
          font-size="13" font-family="Geist Mono, ui-monospace, monospace"
          paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">Master warp</text>
      {/if}
    </svg>

    <!-- Handles -->
    {#if mode === 'corners'}
      {#each CORNER_KEYS as cn}
        {@const grip = cornerGrip(cn)}
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'corner' && drag?.kind.corner === cn}
          class:selected={selectedCorner === cn}
          style="left:{grip.x}px; top:{grip.y}px;"
          onmousedown={(e) => startDrag(e, { kind: 'corner', corner: cn })}>
          <span class="handle-label">{CORNER_LABEL[cn]}</span>
        </div>
      {/each}
      {@const ctr = cornersCenter(corners)}
      <div class="handle move-handle" class:dragging={drag?.kind.kind === 'corners-move'}
        style="left:{hx(ctr.x, 18)}px; top:{hy(ctr.y, 18)}px;"
        onmousedown={(e) => startDrag(e, { kind: 'corners-move' })}
        title="Drag to move the whole warp">✥</div>
    {:else if mode === 'mesh' && meshGrid}
      {@const g = meshGrid}
      {#each g.points as row, ri}
        {#each row as p, ci}
          {@const isCorner = (ri === 0 || ri === g.rows - 1) && (ci === 0 || ci === g.cols - 1)}
          {@const isEdge = ri === 0 || ri === g.rows - 1 || ci === 0 || ci === g.cols - 1}
          {@const half = isCorner ? 8 : isEdge ? 6 : 5}
          <div
            class="handle mesh-handle"
            class:corner={isCorner}
            class:edge={isEdge && !isCorner}
            class:inner={!isEdge}
            class:dragging={drag?.kind.kind === 'mesh' && drag?.kind.row === ri && drag?.kind.col === ci}
            class:selected={selectedMeshPoint?.row === ri && selectedMeshPoint?.col === ci}
            style="left:{hx(meshPx(p.x, p.y), half)}px; top:{hy(meshPy(p.x, p.y), half)}px;"
            onmousedown={(e) => startDrag(e, { kind: 'mesh', row: ri, col: ci })}
          ></div>
        {/each}
      {/each}
      {@const ctr = meshCenter(g)}
      <div class="handle move-handle" class:dragging={drag?.kind.kind === 'mesh-move'}
        style="left:{hx(ctr.x, 18)}px; top:{hy(ctr.y, 18)}px;"
        onmousedown={(e) => startDrag(e, { kind: 'mesh-move' })}
        title="Drag to move the whole warp">✥</div>
      <!-- Tangent handles: drag to bend (Alt-drag unlinks the pair),
           double-click to straighten -->
      {#if tangentPoint}
        {@const tp = tangentPoint}
        {#each tangentHandles as handle (handle.side)}
          <div
            class="tangent-handle"
            class:unlinked={!handle.linked}
            class:dragging={drag?.kind.kind === 'tangent' && drag.kind.side === handle.side}
            class:selected={selectedTangent === handle.side && drag?.kind.kind !== 'tangent'}
            style="left:{hx(handle.x, 5)}px; top:{hy(handle.y, 5)}px;"
            onmousedown={(e) => startDrag(e, { kind: 'tangent', row: tp.row, col: tp.col, side: handle.side })}
            ondblclick={(e) => { e.preventDefault(); e.stopPropagation(); straightenTangent(tp.row, tp.col, handle.side); }}
            role="button"
            tabindex="-1"
            title="Drag to bend. Alt-drag to move this handle on its own. Double-click to straighten."
            aria-label="Tangent {handle.side} of master warp point {tp.row},{tp.col}{handle.linked ? '' : ' (unlinked)'}"
          ></div>
        {/each}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .master-warp-handles {
    position: absolute;
    top: 0; left: 0;
    pointer-events: none;
    /* Above the purple screen handles so the global warp wins clicks... */
    z-index: 55;
    user-select: none;
    -webkit-user-select: none;
  }
  /* ...except while a screen is selected: its handles are the ones being
     edited, so they win where the two overlap. */
  .master-warp-handles.yield-to-screen { z-index: 45; }
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

  /* Above the move grip, so a point under it can always be picked. */
  .mesh-handle { cursor: grab; z-index: 56; }
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

  /* Bezier tangent handles: small diamonds, hollow once unlinked (same as
     the layer mesh). */
  .tangent-handle {
    position: absolute;
    width: 9px; height: 9px;
    margin-left: -5px; margin-top: -5px;
    background: var(--ga-blue-300);
    border: 1px solid #fff;
    transform: rotate(45deg);
    pointer-events: auto;
    cursor: grab;
    z-index: 56;
    transition: transform 0.1s ease;
  }
  .tangent-handle.unlinked { background: transparent; border: 2px solid var(--ga-blue-300); }
  .tangent-handle:hover, .tangent-handle.dragging { transform: rotate(45deg) scale(1.4); }
  .tangent-handle.dragging { cursor: grabbing; }
  .tangent-handle.selected { box-shadow: 0 0 8px var(--ga-blue-300); transform: rotate(45deg) scale(1.3); }

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
