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
   *
   * Masks: each screen's masks are stored in the screen's own content
   * space and cut from the projector's frame after crop + warp. They are
   * drawn here through the same forward map the core samples with
   * (screenMaskGeometry), so the shaded region on the canvas is what the
   * projector loses. The selected mask gets vertex handles, edge "+"
   * handles to insert a vertex, and a click-to-place mode that appends
   * vertices while `screenMaskPlacing` is on. Curved edges work like layer
   * custom shapes: double-click a vertex to toggle corner / curve, drag a
   * round curve handle to bend (its partner mirrors unless Alt is held).
   *
   * Bezier mesh: a mesh screen with Bezier on shows tangent handles on its
   * selected point, with the same rules as layer meshes and the Master
   * Warp (meshWarp.ts): linked by default, Alt-drag unlinks, double-click
   * straightens, and the arrow keys nudge the handle clicked last (or the
   * point, once a point is clicked; Escape goes back to moving the screen).
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import type { OutputSlice, ScreenMask } from '../stores/settings';
  import { project } from '../stores/layers';
  import { recordDiscreteAction } from '../stores/historyHooks';
  import { settings, screenMaskIsActive } from '../stores/settings';
  import type { WarpCorners, MeshWarpGrid, Point2D } from '../types';
  import { normalizedWarpNudge } from '../utils/warpNudge';
  import { releaseFormControlFocus } from '../utils/formFocus';
  import { claimWarpKeys, ownsWarpKeys } from '../utils/warpKeyOwner';
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
  import { screens, selectedScreenId, screenActions, selectedScreenMaskId, screenMaskPlacing, screenMaskPointPress, screenMaskCanvasPress, screenMaskEdgeMidpoint } from '../stores/screens';
  import {
    canvasToScreenContent,
    screenContentToCanvas,
    screenMaskAlpha,
    screenMaskCanvasOutline,
    screenMaskCanvasPoints,
    screenOutlineCanvasPoints,
  } from '../stores/screenMaskGeometry';
  import { insetHandle, meshMoveGrip } from '../utils/warpHandleLayout';

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
    | { kind: 'mesh-move' }
    | { kind: 'tangent'; row: number; col: number; side: MeshTangentSide }
    | { kind: 'mask-point'; maskId: string; index: number }
    | { kind: 'mask-cp'; maskId: string; index: number; which: 'cpIn' | 'cpOut' };

  let drag: {
    sliceId: string;
    kind: DragKind;
    startClientX: number;
    startClientY: number;
    startSlice: OutputSlice;
  } | null = $state(null);

  let containerEl: HTMLDivElement | null = $state(null);

  // Mesh point picked for the arrow keys, and on a Bezier mesh the tangent
  // handle clicked last on it.
  let selectedMeshPoint: { sliceId: string; row: number; col: number } | null = $state(null);
  let selectedTangent: MeshTangentSide | null = $state(null);

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
    // The arrow keys nudge what was pressed, not the panel control that
    // still has focus (a toggle just clicked, a number field).
    releaseFormControlFocus();
    claimWarpKeys('screen');
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
        // some nested store values. Tangents are copied with the points.
        meshGrid: slice.meshGrid ? cloneMeshGrid(slice.meshGrid) : undefined,
      },
    };
    if (kind.kind === 'mesh' || kind.kind === 'tangent') {
      const same = selectedMeshPoint?.sliceId === sliceId && selectedMeshPoint.row === kind.row && selectedMeshPoint.col === kind.col;
      if (kind.kind === 'tangent') selectedTangent = kind.side;
      else if (!same) selectedTangent = null;
      selectedMeshPoint = { sliceId, row: kind.row, col: kind.col };
    } else if (kind.kind !== 'mask-point' && kind.kind !== 'mask-cp') {
      selectedMeshPoint = null;
      selectedTangent = null;
    }
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

  /** A drag ends as one undo step (history skips it if nothing moved). */
  function endDrag() {
    const wasDragging = drag !== null;
    cancelDrag();
    if (wasDragging) recordDiscreteAction();
  }

  function onMouseUp(_e: MouseEvent) {
    endDrag();
  }

  function onVisibilityChange() {
    if (document.hidden) endDrag();
  }

  function isTextEditingTarget(target: EventTarget | null): boolean {
    const el = target instanceof HTMLElement ? target : null;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return Boolean(
      el?.closest('input, textarea, select, [contenteditable="true"]') ||
      active?.closest('input, textarea, select, [contenteditable="true"]')
    );
  }

  function nudgeSelectedSlice(dx: number, dy: number, alt = false) {
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
      const grid = slice.meshGrid;
      const picked = selectedMeshPoint?.sliceId === slice.id ? selectedMeshPoint : null;
      const p = picked ? grid.points[picked.row]?.[picked.col] : null;
      if (picked && p) {
        // A picked tangent handle on a Bezier mesh moves (Alt unlinks it);
        // otherwise the picked point does.
        if (selectedTangent && grid.bezier && meshTangentSides(grid, picked.row, picked.col).includes(selectedTangent)) {
          const t = resolveMeshTangents(grid, picked.row, picked.col)[selectedTangent];
          moveTangent(slice.id, grid, picked.row, picked.col, selectedTangent, { x: t.x + dx, y: t.y + dy }, alt);
          return;
        }
        const points = grid.points.map((row, r) => row.map((pt, c) => (r === picked.row && c === picked.col ? { x: pt.x + dx, y: pt.y + dy } : pt)));
        screenActions.update(slice.id, { meshGrid: withMeshPoints(grid, points) });
        return;
      }
      screenActions.update(slice.id, {
        meshGrid: withMeshPoints(grid, grid.points.map(row =>
          row.map(pt => ({ x: pt.x + dx, y: pt.y + dy }))
        )),
      });
    }
  }


  /** Store one tangent handle of a screen mesh point (linked by default,
   *  `unlink` freezes the mirror; see meshTangentsAfterDrag). */
  function moveTangent(sliceId: string, grid: MeshWarpGrid, row: number, col: number, side: MeshTangentSide, tangent: Point2D, unlink: boolean) {
    const tangents = meshTangentsAfterDrag(grid, row, col, side, tangent, unlink);
    screenActions.update(sliceId, { meshGrid: withMeshPointTangents(grid, row, col, tangents) });
  }

  /** Double-click a tangent handle: back onto the straight edge. */
  function straightenTangent(sliceId: string, row: number, col: number, side: MeshTangentSide) {
    const grid = $screens.find(s => s.id === sliceId)?.meshGrid;
    if (!grid) return;
    screenActions.update(sliceId, { meshGrid: withMeshPointTangents(grid, row, col, meshTangentsAfterStraighten(grid, row, col, side)) });
    recordDiscreteAction();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!$selectedScreenId || isTextEditingTarget(e.target) || !ownsWarpKeys('screen')) return;
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
      case 'Enter':
        // Ends vertex placing first; a second Escape still cancels a drag.
        if (get(screenMaskPlacing)) {
          e.preventDefault();
          screenMaskPlacing.set(false);
          return;
        }
        if (e.key === 'Escape') {
          // A picked tangent handle lets go first, then the mesh point.
          if (selectedTangent) selectedTangent = null;
          else selectedMeshPoint = null;
          cancelDrag();
        }
        return;
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    nudgeSelectedSlice(dx, dy, e.altKey);
    recordDiscreteAction();
  }

  // Picking a screen in the panel hands it the arrow keys.
  const stopScreenKeyClaim = selectedScreenId.subscribe((id) => { if (id) claimWarpKeys('screen'); });
  onDestroy(stopScreenKeyClaim);

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
    endDrag();
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
      screenActions.update(id, { meshGrid: withMeshPoints(init.meshGrid, points) });
    } else if (k.kind === 'mesh-move' && init.meshGrid) {
      const points = init.meshGrid.points.map(row =>
        row.map(pt => ({ x: pt.x + dxN, y: pt.y + dyN }))
      );
      screenActions.update(id, { meshGrid: withMeshPoints(init.meshGrid, points) });
    } else if (k.kind === 'tangent' && init.meshGrid) {
      // Screen mesh points are canvas positions, so the handle's end just
      // follows the cursor. Linkedness comes from the live grid so an Alt
      // unlink freezes the mirror where it is now.
      const live = $screens.find(s => s.id === id)?.meshGrid;
      if (!live) return;
      const t = resolveMeshTangents(init.meshGrid, k.row, k.col)[k.side];
      moveTangent(id, live, k.row, k.col, k.side, { x: t.x + dxN, y: t.y + dyN }, e.altKey);
    } else if (k.kind === 'mask-point') {
      // Drag in canvas space, store in the screen's content space, so the
      // vertex tracks the cursor on a corner-pinned or mesh-warped screen.
      // Masks are rebuilt on every edit, never mutated, so the snapshot's
      // vertex is still the pre-drag position.
      const p0 = init.masks?.find(m => m.id === k.maskId)?.points[k.index];
      if (!p0) return;
      const start = screenContentToCanvas(init, p0);
      const content = canvasToScreenContent(init, { x: start.x + dxN, y: start.y + dyN });
      if (content) screenActions.updateMaskPoint(id, k.maskId, k.index, content);
    } else if (k.kind === 'mask-cp') {
      // Same canvas-to-content trip for a curve handle. Its partner
      // mirrors through the vertex unless Alt is held, as on layer shapes.
      // Off the screen the inverse continues the warp outward, so the
      // handle keeps following the cursor there.
      const p0 = init.masks?.find(m => m.id === k.maskId)?.points[k.index];
      const h0 = p0?.[k.which];
      if (!p0 || !h0) return;
      const start = screenContentToCanvas(init, h0);
      const content = canvasToScreenContent(init, { x: start.x + dxN, y: start.y + dyN });
      if (!content) return;
      const mirror = e.altKey ? undefined : { x: 2 * p0.x - content.x, y: 2 * p0.y - content.y };
      screenActions.setMaskPointHandles(id, k.maskId, k.index, k.which === 'cpIn'
        ? { cpIn: content, cpOut: mirror }
        : { cpOut: content, cpIn: mirror });
    }
  }

  // ─── Masks ─────────────────────────────────────────────────────────
  function selectedMaskOf(s: OutputSlice): ScreenMask | null {
    return s.masks?.find(m => m.id === $selectedScreenMaskId) ?? null;
  }

  function startMaskPointDrag(e: MouseEvent, s: OutputSlice, maskId: string, index: number) {
    const pointCount = (s.masks ?? []).find(m => m.id === maskId)?.points.length ?? 0;
    const action = screenMaskPointPress(e, get(screenMaskPlacing), index, pointCount);
    if (action === 'drag') {
      startDrag(e, s.id, { kind: 'mask-point', maskId, index });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (action === 'close') screenMaskPlacing.set(false);
    else screenActions.removeMaskPoint(s.id, maskId, index);
  }

  /** Click on an edge's "+" handle: insert a vertex halfway along the
   *  edge (in content space, so it lands on the edge the operator sees; a
   *  curved edge is split without changing its shape). */
  function insertMaskPoint(e: MouseEvent, s: OutputSlice, mask: ScreenMask, index: number) {
    e.preventDefault();
    e.stopPropagation();
    screenActions.insertMaskPointOnEdge(s.id, mask.id, index);
  }

  /** Double-click a vertex: toggle it between a corner and a curve. */
  function toggleMaskPointCurve(e: MouseEvent, s: OutputSlice, mask: ScreenMask, index: number) {
    e.preventDefault();
    e.stopPropagation();
    if (get(screenMaskPlacing)) return;
    screenActions.toggleMaskPointCurve(s.id, mask.id, index);
  }

  /** Placing mode: every click on the canvas appends a vertex. Clicks
   *  outside the screen clamp to its edge, which is where the core would
   *  cut anyway. */
  function placeMaskPoint(e: MouseEvent) {
    const s = $screens.find(sc => sc.id === $selectedScreenId);
    const mask = s ? selectedMaskOf(s) : null;
    if (!s || !mask || !containerEl) return;
    e.preventDefault();
    e.stopPropagation();
    const action = screenMaskCanvasPress(e.button);
    if (action === 'close') screenMaskPlacing.set(false);
    if (action !== 'add') return;
    const r = containerEl.getBoundingClientRect();
    const canvasPoint = {
      x: (e.clientX - r.left) / Math.max(1, r.width),
      y: (e.clientY - r.top) / Math.max(1, r.height),
    };
    const content = canvasToScreenContent(s, canvasPoint);
    if (!content) return;
    screenActions.addMaskPoint(s.id, mask.id, content);
  }

  function polyPath(points: Point2D[]): string {
    return points.map(p => `${px(p.x)},${py(p.y)}`).join(' ');
  }

  // Shading of what each screen's masks remove. Evaluated per pixel with
  // the same maths the core cuts with (screenMaskAlpha), through the same
  // crop / warp map, so the dimmed region on the canvas is what the
  // projector loses, feather included. Drawn at reduced resolution and
  // only inside screens that have a usable mask.
  let maskCanvas: HTMLCanvasElement | null = $state(null);
  const MASK_SHADE_MAX_DIM = 480;
  let maskShadeFrame = 0;

  function drawMaskShade() {
    maskShadeFrame = 0;
    const canvas = maskCanvas;
    if (!canvas) return;
    const scale = Math.min(1, MASK_SHADE_MAX_DIM / Math.max(1, containerWidth, containerHeight));
    const w = Math.max(1, Math.round(containerWidth * scale));
    const h = Math.max(1, Math.round(containerHeight * scale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const masked = $screens.filter(s => s.enabled && (s.masks ?? []).some(screenMaskIsActive));
    if (masked.length === 0) return;
    const image = ctx.createImageData(w, h);
    const data = image.data;
    for (const s of masked) {
      const outline = screenOutlineCanvasPoints(s);
      const xs = outline.map(p => p.x), ys = outline.map(p => p.y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs) * w)), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs) * w));
      const y0 = Math.max(0, Math.floor(Math.min(...ys) * h)), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys) * h));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          // Only the screen's own pixels shade, so skip the solve past it.
          const uv = canvasToScreenContent(s, { x: (x + 0.5) / w, y: (y + 0.5) / h }, { extrapolate: false });
          if (!uv || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) continue;
          const removed = 1 - screenMaskAlpha(s.masks, uv);
          const o = (y * w + x) * 4 + 3;
          // Overlapping screens: keep the darker of the two shades.
          data[o] = Math.max(data[o], Math.round(removed * 255));
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  $effect(() => {
    // Track everything the shade depends on, then redraw once per frame.
    void $screens; void containerWidth; void containerHeight; void maskCanvas;
    if (typeof requestAnimationFrame === 'undefined' || maskShadeFrame) return;
    maskShadeFrame = requestAnimationFrame(drawMaskShade);
  });

  onDestroy(() => {
    if (maskShadeFrame) cancelAnimationFrame(maskShadeFrame);
  });

  // ─── Pixel helpers ─────────────────────────────────────────────────
  function px(nx: number): number { return nx * containerWidth; }
  function py(ny: number): number { return ny * containerHeight; }
  // Handles are drawn whole inside the canvas (a point on the right edge
  // would otherwise be half under the sidebar); `half` is the handle's
  // half-size in px. Lines keep the true positions.
  function hx(x: number, half: number): number { return insetHandle(x, containerWidth, half); }
  function hy(y: number, half: number): number { return insetHandle(y, containerHeight, half); }

  function rectCenter(s: OutputSlice): { x: number; y: number } {
    return { x: px(s.cropX + s.cropW / 2), y: py(s.cropY + s.cropH / 2) };
  }
  function cornersCenter(c: WarpCorners): { x: number; y: number } {
    return {
      x: px((c.topLeft.x + c.topRight.x + c.bottomLeft.x + c.bottomRight.x) / 4),
      y: py((c.topLeft.y + c.topRight.y + c.bottomLeft.y + c.bottomRight.y) / 4),
    };
  }
  /** The mesh move grip sits in the middle of the central cell, never on
   *  a mesh point (the centre point of a 5x5 mesh used to be under it). */
  function meshCenter(g: MeshWarpGrid): { x: number; y: number } {
    const grip = meshMoveGrip(g.points, g.rows, g.cols);
    return { x: px(grip.x), y: py(grip.y) };
  }

  function rectPath(s: OutputSlice): string {
    const x0 = px(s.cropX), y0 = py(s.cropY);
    const x1 = px(s.cropX + s.cropW), y1 = py(s.cropY + s.cropH);
    return `${x0},${y0} ${x1},${y0} ${x1},${y1} ${x0},${y1}`;
  }
  function cornersPath(c: WarpCorners): string {
    return `${px(c.topLeft.x)},${py(c.topLeft.y)} ${px(c.topRight.x)},${py(c.topRight.y)} ${px(c.bottomRight.x)},${py(c.bottomRight.y)} ${px(c.bottomLeft.x)},${py(c.bottomLeft.y)}`;
  }

  /** One mesh cell edge as SVG polyline points: two when straight, sampled
   *  along its cubic in Bezier mode (the curve the core samples along). */
  function meshEdgePath(g: MeshWarpGrid, r0: number, c0: number, r1: number, c1: number): string {
    const steps = g.bezier ? MESH_CURVE_SEGMENTS : 1;
    const out: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = meshEdgePoint(g, r0, c0, r1, c1, i / steps);
      out.push(`${px(p.x)},${py(p.y)}`);
    }
    return out.join(' ');
  }

  /** Tangent handles of the picked point of a Bezier mesh screen. */
  function tangentHandlesOf(s: OutputSlice): Array<{ side: MeshTangentSide; row: number; col: number; x: number; y: number; ox: number; oy: number; linked: boolean }> {
    const g = s.meshGrid;
    const k = drag?.sliceId === s.id && (drag.kind.kind === 'tangent' || drag.kind.kind === 'mesh') ? drag.kind : null;
    const point = k ?? (selectedMeshPoint?.sliceId === s.id ? selectedMeshPoint : null);
    if ((s.warpMode ?? 'rect') !== 'mesh' || !g?.bezier || !point || !g.points[point.row]?.[point.col]) return [];
    const o = g.points[point.row][point.col];
    const t = resolveMeshTangents(g, point.row, point.col);
    return meshTangentSides(g, point.row, point.col).map((side) => ({
      side, row: point.row, col: point.col,
      x: px(o.x + t[side].x), y: py(o.y + t[side].y), ox: px(o.x), oy: py(o.y),
      linked: meshTangentLinked(g, point.row, point.col, side),
    }));
  }

  $effect(() => {
    // Leaving mesh mode, switching screens or turning Bezier off drops the
    // picked point / handle.
    const s = $screens.find(sc => sc.id === selectedMeshPoint?.sliceId);
    if (selectedMeshPoint && (!s || $selectedScreenId !== s.id || (s.warpMode ?? 'rect') !== 'mesh' || !s.meshGrid?.points[selectedMeshPoint.row]?.[selectedMeshPoint.col])) {
      selectedMeshPoint = null;
    }
    if (selectedTangent && !s?.meshGrid?.bezier) selectedTangent = null;
  });
</script>

<div data-help-page="projection-mapping"
  class="screen-warp-handles"
  bind:this={containerEl}
  style="width: {containerWidth}px; height: {containerHeight}px;"
>
  <!-- What each screen's masks cut away, shaded the way the projector
       loses it (black, feathered). Under every outline and handle. -->
  <canvas class="mask-shade" bind:this={maskCanvas} style="width: {containerWidth}px; height: {containerHeight}px;"></canvas>

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
          {#each row as _p, ci}
            {#if ci < g.cols - 1}
              <polyline points={meshEdgePath(g, ri, ci, ri, ci + 1)} fill="none" stroke={stroke} stroke-width={sw} stroke-dasharray={dash}/>
            {/if}
            {#if ri < g.rows - 1}
              <polyline points={meshEdgePath(g, ri, ci, ri + 1, ci)} fill="none" stroke={stroke} stroke-width={sw} stroke-dasharray={dash}/>
            {/if}
          {/each}
        {/each}
        {#if isSel}
          {#each tangentHandlesOf(s) as handle (handle.side)}
            <line x1={handle.ox} y1={handle.oy} x2={handle.x} y2={handle.y}
              stroke="#00d4ff" stroke-width="1" stroke-opacity="0.8" stroke-dasharray={handle.linked ? undefined : '3,3'} />
          {/each}
        {/if}
      {/if}
      <!-- Label at the warp's top-left. -->
      {#if mode === 'rect'}
        <text x={px(s.cropX) + 6} y={py(s.cropY) + 14} fill={stroke} font-size="13" font-family="Geist Mono, ui-monospace, monospace" paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">{s.name}</text>
      {:else if mode === 'corners' && s.corners}
        <text x={px(s.corners.topLeft.x) + 6} y={py(s.corners.topLeft.y) + 14} fill={stroke} font-size="13" font-family="Geist Mono, ui-monospace, monospace" paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">{s.name}</text>
      {:else if mode === 'mesh' && s.meshGrid}
        <text x={px(s.meshGrid.points[0][0].x) + 6} y={py(s.meshGrid.points[0][0].y) + 14} fill={stroke} font-size="13" font-family="Geist Mono, ui-monospace, monospace" paint-order="stroke" stroke="rgba(0,0,0,0.7)" stroke-width="3">{s.name}</text>
      {/if}
      <!-- Mask outlines, drawn through the screen's warp. The mask being
           edited is solid; the rest of the selected screen's masks are
           dashed; other screens' masks are faint. Disabled masks are
           dotted so they can still be found. -->
      {#each s.masks ?? [] as m (m.id)}
        {#if m.points.length >= 2}
          {@const editing = isSel && $selectedScreenMaskId === m.id}
          {@const open = m.points.length < 3 || (editing && $screenMaskPlacing)}
          {@const pts = polyPath(open ? screenMaskCanvasPoints(s, m) : screenMaskCanvasOutline(s, m))}
          {@const mstroke = editing ? '#4dd8ff' : isSel ? 'rgba(77, 216, 255, 0.7)' : 'rgba(77, 216, 255, 0.3)'}
          {@const mdash = m.enabled ? (editing ? 'none' : '6 4') : '2 4'}
          {#if !open}
            <polygon points={pts} fill="none" stroke={mstroke} stroke-width={editing ? 2 : 1} stroke-dasharray={mdash} />
          {:else}
            <polyline points={pts} fill="none" stroke={mstroke} stroke-width={editing ? 2 : 1} stroke-dasharray={mdash} />
          {/if}
        {/if}
      {/each}
    {/each}
  </svg>

  {#if $screenMaskPlacing && $selectedScreenMaskId}
    <!-- Click-to-place layer: sits over the screen handles (so a click
         never grabs the move handle by accident) and under the vertex
         handles (so placed vertices can still be dragged). -->
    <div class="mask-place-layer" role="presentation" onmousedown={placeMaskPoint}
      oncontextmenu={(e) => e.preventDefault()}></div>
  {/if}

  {#each $screens as s (s.id)}
    {#if $selectedScreenId === s.id}
      {@const mask = selectedMaskOf(s)}
      {#if mask}
        {@const canvasPts = screenMaskCanvasPoints(s, mask)}
        {#if !$screenMaskPlacing && mask.points.length >= 2}
          <!-- Edge "+" handles insert a vertex midway along that edge. -->
          {#each mask.points as _p, i}
            {#if i < mask.points.length - 1 || mask.points.length >= 3}
              {@const mid = screenContentToCanvas(s, screenMaskEdgeMidpoint(mask.points, i))}
              <div class="handle mask-insert-handle" style="left:{hx(px(mid.x), 7)}px; top:{hy(py(mid.y), 7)}px;"
                role="button" tabindex="-1" title="Add a point here"
                onmousedown={(e) => insertMaskPoint(e, s, mask, i)}>+</div>
            {/if}
          {/each}
          <!-- Curve handles: an arm from each curved vertex to its round
               handle. Drag to bend; the partner mirrors unless Alt is held. -->
          <svg class="lines-overlay mask-cp-arms" width={containerWidth} height={containerHeight}>
            {#each mask.points as p, i}
              {@const v = screenContentToCanvas(s, p)}
              {#each (['cpIn', 'cpOut'] as const) as which}
                {@const h = p[which]}
                {#if h}
                  {@const hc = screenContentToCanvas(s, h)}
                  <line x1={px(v.x)} y1={py(v.y)} x2={px(hc.x)} y2={py(hc.y)} stroke="#4dd8ff" stroke-width="1" stroke-opacity="0.8" />
                {/if}
              {/each}
            {/each}
          </svg>
          {#each mask.points as p, i}
            {#each (['cpIn', 'cpOut'] as const) as which}
              {@const h = p[which]}
              {#if h}
                {@const hc = screenContentToCanvas(s, h)}
                <div class="handle mask-cp-handle"
                  class:dragging={drag?.kind.kind === 'mask-cp' && drag.kind.maskId === mask.id && drag.kind.index === i && drag.kind.which === which}
                  style="left:{hx(px(hc.x), 5)}px; top:{hy(py(hc.y), 5)}px;"
                  role="button" tabindex="-1"
                  title="Drag to bend. Alt-drag to move this handle on its own."
                  aria-label="{which === 'cpIn' ? 'Curve handle into' : 'Curve handle out of'} mask point {i + 1}"
                  onmousedown={(e) => startDrag(e, s.id, { kind: 'mask-cp', maskId: mask.id, index: i, which })}></div>
              {/if}
            {/each}
          {/each}
        {/if}
        {#each canvasPts as cp, i}
          {@const closable = $screenMaskPlacing && i === 0 && canvasPts.length >= 3}
          <div class="handle mask-point-handle" class:first={i === 0} class:closable
            class:dragging={drag?.kind.kind === 'mask-point' && drag?.kind.maskId === mask.id && drag?.kind.index === i}
            style="left:{hx(px(cp.x), 6)}px; top:{hy(py(cp.y), 6)}px;"
            role="button" tabindex="-1"
            class:curved={!!(mask.points[i]?.cpIn || mask.points[i]?.cpOut)}
            title={closable ? 'Click to close the mask' : $screenMaskPlacing ? 'Drag to move. Right-click to close the mask.' : 'Drag to move. Double-click for a curve or a corner. Right-click or Alt-click to remove.'}
            oncontextmenu={(e) => e.preventDefault()}
            ondblclick={(e) => toggleMaskPointCurve(e, s, mask, i)}
            onmousedown={(e) => startMaskPointDrag(e, s, mask.id, i)}></div>
        {/each}
      {/if}
    {/if}
  {/each}

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
          style="left:{hx(cx0, 10)}px; top:{hy(cy0, 10)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-corner', corner: 'nw' })}>
          <span class="handle-label">{s.name} TL</span>
        </div>
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'rect-corner' && drag?.kind.corner === 'ne'}
          style="left:{hx(cx1, 10)}px; top:{hy(cy0, 10)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-corner', corner: 'ne' })}>
          <span class="handle-label">{s.name} TR</span>
        </div>
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'rect-corner' && drag?.kind.corner === 'sw'}
          style="left:{hx(cx0, 10)}px; top:{hy(cy1, 10)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-corner', corner: 'sw' })}>
          <span class="handle-label">{s.name} BL</span>
        </div>
        <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'rect-corner' && drag?.kind.corner === 'se'}
          style="left:{hx(cx1, 10)}px; top:{hy(cy1, 10)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-corner', corner: 'se' })}>
          <span class="handle-label">{s.name} BR</span>
        </div>

        <!-- 4 edge handles -->
        {@const ex = (cx0 + cx1) / 2}
        {@const ey = (cy0 + cy1) / 2}
        <div class="handle edge-handle edge-top" class:dragging={drag?.kind.kind === 'rect-edge' && drag?.kind.edge === 'top'}
          style="left:{hx(ex, 20)}px; top:{hy(cy0, 6)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-edge', edge: 'top' })}></div>
        <div class="handle edge-handle edge-bottom" class:dragging={drag?.kind.kind === 'rect-edge' && drag?.kind.edge === 'bottom'}
          style="left:{hx(ex, 20)}px; top:{hy(cy1, 6)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-edge', edge: 'bottom' })}></div>
        <div class="handle edge-handle edge-left" class:dragging={drag?.kind.kind === 'rect-edge' && drag?.kind.edge === 'left'}
          style="left:{hx(cx0, 6)}px; top:{hy(ey, 20)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-edge', edge: 'left' })}></div>
        <div class="handle edge-handle edge-right" class:dragging={drag?.kind.kind === 'rect-edge' && drag?.kind.edge === 'right'}
          style="left:{hx(cx1, 6)}px; top:{hy(ey, 20)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-edge', edge: 'right' })}></div>

        <!-- Center move handle -->
        {@const ctr = rectCenter(s)}
        <div class="handle move-handle" class:dragging={drag?.kind.kind === 'rect-move'}
          style="left:{hx(ctr.x, 18)}px; top:{hy(ctr.y, 18)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'rect-move' })}
          title="Drag to move {s.name}">✥</div>

      {:else if mode === 'corners' && s.corners}
        {#each (['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as Array<keyof WarpCorners>) as cn}
          {@const cp = s.corners[cn]}
          <div class="handle corner-handle" class:dragging={drag?.kind.kind === 'corner' && drag?.kind.corner === cn}
            style="left:{hx(px(cp.x), 10)}px; top:{hy(py(cp.y), 10)}px;"
            onmousedown={(e) => startDrag(e, s.id, { kind: 'corner', corner: cn })}>
            <span class="handle-label">{s.name} {cn}</span>
          </div>
        {/each}
        {@const ctr = cornersCenter(s.corners)}
        <div class="handle move-handle" class:dragging={drag?.kind.kind === 'corners-move'}
          style="left:{hx(ctr.x, 18)}px; top:{hy(ctr.y, 18)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'corners-move' })}
          title="Drag to move {s.name}">✥</div>

      {:else if mode === 'mesh' && s.meshGrid}
        {@const g = s.meshGrid}
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
              class:selected={selectedMeshPoint?.sliceId === s.id && selectedMeshPoint.row === ri && selectedMeshPoint.col === ci}
              style="left:{hx(px(p.x), half)}px; top:{hy(py(p.y), half)}px;"
              onmousedown={(e) => startDrag(e, s.id, { kind: 'mesh', row: ri, col: ci })}
            ></div>
          {/each}
        {/each}
        {@const ctr = meshCenter(g)}
        <div class="handle move-handle" class:dragging={drag?.kind.kind === 'mesh-move'}
          style="left:{hx(ctr.x, 18)}px; top:{hy(ctr.y, 18)}px;"
          onmousedown={(e) => startDrag(e, s.id, { kind: 'mesh-move' })}
          title="Drag to move {s.name}">✥</div>
        <!-- Tangent handles: drag to bend (Alt-drag unlinks the pair),
             double-click to straighten -->
        {#each tangentHandlesOf(s) as handle (handle.side)}
          <div
            class="tangent-handle"
            class:unlinked={!handle.linked}
            class:dragging={drag?.kind.kind === 'tangent' && drag.kind.side === handle.side}
            class:selected={selectedTangent === handle.side && drag?.kind.kind !== 'tangent'}
            style="left:{hx(handle.x, 5)}px; top:{hy(handle.y, 5)}px;"
            onmousedown={(e) => startDrag(e, s.id, { kind: 'tangent', row: handle.row, col: handle.col, side: handle.side })}
            ondblclick={(e) => { e.preventDefault(); e.stopPropagation(); straightenTangent(s.id, handle.row, handle.col, handle.side); }}
            role="button"
            tabindex="-1"
            title="Drag to bend. Alt-drag to move this handle on its own. Double-click to straighten."
            aria-label="Tangent {handle.side} of {s.name} mesh point {handle.row},{handle.col}{handle.linked ? '' : ' (unlinked)'}"
          ></div>
        {/each}
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
  .mask-shade {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }
  .mask-place-layer {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    cursor: crosshair;
    z-index: 60;
  }

  /* Mask vertices sit above the placing layer so they stay draggable. */
  .handle.mask-point-handle {
    width: 12px; height: 12px;
    margin-left: -6px; margin-top: -6px;
    background: #4dd8ff;
    border: 2px solid #fff;
    border-radius: 2px;
    cursor: grab;
    z-index: 70;
  }
  .mask-point-handle.first { background: #ffffff; border-color: #4dd8ff; }
  /* While placing, the first vertex closes the shape: ring it so it reads
     as a target, like a pen tool's start point. */
  .mask-point-handle.first.closable { cursor: pointer; box-shadow: 0 0 0 4px rgba(77, 216, 255, 0.45); }
  .mask-point-handle.first.closable:hover { transform: scale(1.5); }
  .mask-point-handle:hover { transform: scale(1.25); }
  .mask-point-handle.dragging { cursor: grabbing; transform: scale(1.35); background: #ffff00; }
  .handle.mask-insert-handle {
    width: 14px; height: 14px;
    margin-left: -7px; margin-top: -7px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(77, 216, 255, 0.8);
    color: #4dd8ff;
    font-size: 12px;
    line-height: 12px;
    text-align: center;
    cursor: copy;
    opacity: 0.55;
    z-index: 70;
  }
  .mask-insert-handle:hover { opacity: 1; transform: scale(1.2); }
  /* A curved vertex reads as round, like a pen tool's smooth point. */
  .mask-point-handle.curved { border-radius: 50%; }
  .handle.mask-cp-handle {
    width: 9px; height: 9px;
    margin-left: -5px; margin-top: -5px;
    border-radius: 50%;
    background: #0b1720;
    border: 2px solid #4dd8ff;
    cursor: grab;
    z-index: 70;
  }
  .mask-cp-handle:hover { transform: scale(1.3); }
  .mask-cp-handle.dragging { cursor: grabbing; background: #ffff00; transform: scale(1.4); }

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

  /* Mesh handles — same as MeshWarpHandles. Above the move grip, so a
     point under it can always be picked. */
  .mesh-handle { cursor: grab; z-index: 51; }
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
  .mesh-handle.selected {
    background: #00ff88;
    box-shadow: 0 0 10px #00ff88;
  }

  /* Bezier tangent handles: small diamonds, hollow once unlinked (same as
     the layer mesh). */
  .tangent-handle {
    position: absolute;
    width: 9px; height: 9px;
    margin-left: -5px; margin-top: -5px;
    background: #00d4ff;
    border: 1px solid #fff;
    transform: rotate(45deg);
    pointer-events: auto;
    cursor: grab;
    z-index: 52;
    transition: transform 0.1s ease;
  }
  .tangent-handle.unlinked { background: transparent; border: 2px solid #00d4ff; }
  .tangent-handle:hover, .tangent-handle.dragging { transform: rotate(45deg) scale(1.4); }
  .tangent-handle.dragging { cursor: grabbing; }
  .tangent-handle.selected { box-shadow: 0 0 8px #00d4ff; transform: rotate(45deg) scale(1.3); }

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
