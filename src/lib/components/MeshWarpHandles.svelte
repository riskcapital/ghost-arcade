<script lang="ts">
  import { selectedLayer, selectedLayerIds, project, layers } from '../stores/layers';
  import { history } from '../stores/history';
  import { settings } from '../stores/settings';
  import { get } from 'svelte/store';
  import type { Point2D, MeshWarpGrid, WarpCorners } from '../types';
  import { onMount, onDestroy } from 'svelte';
  import {
    advanceDragTravel,
    beginDragTravel,
    beginSnapSession,
    collectSnapOutlines,
    dragTravelNormalized,
    dragTravelPx,
    snapExcludedLayerIds,
    snapPoint,
    type DragTravel,
    type SnapHit,
    type SnapOutline,
    type SnapSession,
    type SnapView,
  } from '../utils/mappingSnap';
  import { quadInverse, quadPoint } from '../utils/layerQuad';
  import { normalizedWarpNudge } from '../utils/warpNudge';
  import {
    MESH_CURVE_SEGMENTS,
    meshEdgePoint,
    meshTangentLinked,
    meshTangentSides as tangentSides,
    meshTangentsAfterDrag,
    meshTangentsAfterStraighten,
    resolveMeshTangents,
    type MeshTangentSide,
  } from '../utils/meshWarp';

  export let containerWidth: number = 800;
  export let containerHeight: number = 600;

  // Zoom level for correct coordinate transformation
  export let zoom: number = 1;

  let dragging: { row: number; col: number } | null = null;
  let containerEl: HTMLDivElement;

  // Selected point for keyboard navigation (persists after click)
  let selectedPoint: { row: number; col: number } | null = null;

  // A drag moves the point from where it was at the press by the pointer's
  // travel (Shift: a tenth as far), so grabbing a point never moves it.
  // Boundary points snap to the other layers' outlines and the canvas edges.
  let dragStart: Point2D | null = null;
  let dragTravel: DragTravel | null = null;
  let snapSession: SnapSession | null = null;
  let snapOutlines: SnapOutline[] = [];
  let activeSnapHit: SnapHit | null = null;

  // Bezier mesh: the tangent handle being dragged, and the one the arrow
  // keys nudge (the last handle clicked on the selected point).
  let tangentDrag: { row: number; col: number; side: MeshTangentSide } | null = null;
  let selectedTangent: MeshTangentSide | null = null;

  /** Store a new tangent for one handle (linked by default, Alt unlinks;
   *  see meshTangentsAfterDrag). */
  function writeTangent(row: number, col: number, side: MeshTangentSide, tangent: Point2D, unlink: boolean) {
    const layer = $selectedLayer;
    const grid = layer?.meshGrid;
    if (!layer || !grid) return;
    project.setMeshPointTangents(layer.id, row, col, meshTangentsAfterDrag(grid, row, col, side, tangent, unlink));
  }

  /** Double-click: put one handle back on the straight edge. */
  function resetTangent(row: number, col: number, side: MeshTangentSide) {
    const layer = $selectedLayer;
    const grid = layer?.meshGrid;
    if (!layer || !grid || layer.locked) return;
    project.setMeshPointTangents(layer.id, row, col, meshTangentsAfterStraighten(grid, row, col, side));
    history.record(get(project));
  }

  function handleTangentMouseDown(row: number, col: number, side: MeshTangentSide, e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    cancelDrag(false);
    tangentDrag = { row, col, side };
    selectedTangent = side;
    beginTangentDrag(row, col, side, e.clientX, e.clientY);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleTangentTouchStart(row: number, col: number, side: MeshTangentSide, e: TouchEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    cancelDrag(false);
    tangentDrag = { row, col, side };
    selectedTangent = side;
    const touch = e.touches[0];
    if (touch) beginTangentDrag(row, col, side, touch.clientX, touch.clientY);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }

  /** A tangent drag starts at the handle's end, wherever it is drawn. */
  function beginTangentDrag(row: number, col: number, side: MeshTangentSide, clientX: number, clientY: number) {
    const layer = $selectedLayer;
    const grid = layer?.meshGrid;
    const point = grid?.points[row]?.[col];
    if (!layer || !grid || !point) return;
    const t = resolveMeshTangents(grid, row, col)[side];
    dragStart = quadPoint(layer.corners, point.x + t.x, point.y + t.y);
    dragTravel = beginDragTravel(clientX, clientY);
  }

  function dragTangentTo(clientX: number, clientY: number, fine: boolean, unlink: boolean) {
    if (!tangentDrag || !$selectedLayer?.meshGrid || !dragStart) return;
    const { row, col, side } = tangentDrag;
    const point = $selectedLayer.meshGrid.points[row]?.[col];
    if (!point) return;
    const end = add(dragStart, travelTo(clientX, clientY, fine).offset);
    const local = quadInverse($selectedLayer.corners, end);
    if (!local) return;
    writeTangent(row, col, side, { x: local.x - point.x, y: local.y - point.y }, unlink);
  }

  const add = (p: Point2D, d: Point2D): Point2D => ({ x: p.x + d.x, y: p.y + d.y });

  function snapView(): SnapView {
    return { width: containerWidth, height: containerHeight, zoom };
  }

  /** Pointer travel since the press, as a canvas offset (y up). */
  function travelTo(clientX: number, clientY: number, fine: boolean): { offset: Point2D; px: number } {
    dragTravel = advanceDragTravel(dragTravel ?? beginDragTravel(clientX, clientY), clientX, clientY, fine);
    return { offset: dragTravelNormalized(dragTravel, snapView(), true), px: dragTravelPx(dragTravel) };
  }

  /** Start dragging a mesh point: from where it is, snapping it to other
   *  layers and the canvas edges when it is on the mesh's outline. */
  function beginPointDrag(row: number, col: number, clientX: number, clientY: number) {
    const layer = $selectedLayer;
    const point = layer?.meshGrid?.points[row]?.[col];
    if (!layer || !point) return;
    dragStart = quadPoint(layer.corners, point.x, point.y);
    dragTravel = beginDragTravel(clientX, clientY);
    activeSnapHit = null;
    if (!isBoundaryPoint(row, col)) {
      snapOutlines = [];
      snapSession = null;
      return;
    }
    const grid = get(settings).ui.gridSettings;
    const magnet = grid?.snapToLayers !== false;
    const all = get(layers);
    snapOutlines = collectSnapOutlines(all, snapExcludedLayerIds(all, layer.id, get(selectedLayerIds)));
    snapSession = beginSnapSession([dragStart], snapOutlines, {
      layers: magnet,
      canvasEdges: magnet,
      grid: grid?.enabled && grid.snapToGrid ? { columns: grid.columns, rows: grid.rows } : null,
    }, snapView());
  }

  function dragPointTo(clientX: number, clientY: number, fine: boolean, bypass: boolean) {
    if (!dragging || !$selectedLayer || !dragStart) return;
    const travel = travelTo(clientX, clientY, fine);
    let target = add(dragStart, travel.offset);
    if (snapSession) {
      const snapped = snapPoint(snapSession, target, travel.px, bypass);
      target = snapped.point;
      activeSnapHit = snapped.hit;
    }
    const local = quadInverse($selectedLayer.corners, target);
    if (local) project.setMeshPoint($selectedLayer.id, dragging.row, dragging.col, local);
  }

  // Check if a mesh grid point is on the boundary (edge or corner of grid)
  function isBoundaryPoint(row: number, col: number): boolean {
    if (!meshGrid) return false;
    return row === 0 || row === meshGrid.rows - 1 || col === 0 || col === meshGrid.cols - 1;
  }

  // Transform a mesh point (0-1 local coords) to screen position via corner warp
  // This maps the mesh grid onto the warped quad defined by corners
  function meshPointToPixel(meshPoint: Point2D, corners: WarpCorners): { x: number; y: number } {
    // Bilinear interpolation within the corner-warped quad
    const u = meshPoint.x;  // 0-1 horizontal position in mesh
    const v = meshPoint.y;  // 0-1 vertical position in mesh

    // Interpolate along top edge (topLeft to topRight)
    const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * u;
    const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * u;

    // Interpolate along bottom edge (bottomLeft to bottomRight)
    const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * u;
    const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * u;

    // Interpolate vertically between top and bottom
    const finalX = bottomX + (topX - bottomX) * v;
    const finalY = bottomY + (topY - bottomY) * v;

    // Convert to pixel coordinates
    return {
      x: finalX * containerWidth,
      y: (1 - finalY) * containerHeight,
    };
  }

  function handleMouseDown(row: number, col: number, e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    cancelDrag(false);
    dragging = { row, col };
    if (selectedPoint?.row !== row || selectedPoint?.col !== col) selectedTangent = null;
    selectedPoint = { row, col };  // Set selected point for keyboard navigation
    beginPointDrag(row, col, e.clientX, e.clientY);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  // Handle keyboard navigation for selected mesh point
  function handleKeyDown(e: KeyboardEvent) {
    if (!selectedPoint || !$selectedLayer || $selectedLayer.locked || !$selectedLayer.meshGrid) return;

    const active = document.activeElement as HTMLElement | null;
    const activeTag = active?.tagName;
    if (
      activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' ||
      active?.isContentEditable
    ) return;

    const proj = get(project);
    const step = normalizedWarpNudge(
      proj.width,
      proj.height,
      get(settings).ui.warpDragGranularity,
      e.shiftKey ? 10 : 1,
    );
    const currentPos = $selectedLayer.meshGrid.points[selectedPoint.row][selectedPoint.col];
    let dx = 0;
    let dy = 0;

    switch (e.key) {
      case 'ArrowUp':
        dy = step.y;
        break;
      case 'ArrowDown':
        dy = -step.y;
        break;
      case 'ArrowLeft':
        dx = -step.x;
        break;
      case 'ArrowRight':
        dx = step.x;
        break;
      case 'Escape':
        // A selected tangent handle lets go first, then the point.
        if (selectedTangent) selectedTangent = null;
        else selectedPoint = null;
        return;
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    // With a tangent handle picked on a Bezier mesh, the arrows move the
    // handle (Alt unlinks it from its mirror) instead of the point.
    const grid = $selectedLayer.meshGrid;
    if (selectedTangent && grid.bezier
      && tangentSides(grid, selectedPoint.row, selectedPoint.col).includes(selectedTangent)) {
      const current = resolveMeshTangents(grid, selectedPoint.row, selectedPoint.col)[selectedTangent];
      writeTangent(selectedPoint.row, selectedPoint.col, selectedTangent,
        { x: current.x + dx, y: current.y + dy }, e.altKey);
      history.record(get(project));
      return;
    }

    const newPos: Point2D = {
      x: currentPos.x + dx,
      y: currentPos.y + dy,
    };

    project.setMeshPoint($selectedLayer.id, selectedPoint.row, selectedPoint.col, newPos);
    history.record(get(project));
  }

  // Set up keyboard event listener
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onDestroy(() => {
    cancelDrag(false);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('blur', handleWindowBlur);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  function removeMouseDragListeners() {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  function removeTouchDragListeners() {
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
  }

  function cancelDrag(record = true) {
    if (record && (dragging || tangentDrag)) history.record(get(project));
    dragging = null;
    tangentDrag = null;
    dragStart = null;
    dragTravel = null;
    snapSession = null;
    snapOutlines = [];
    activeSnapHit = null;
    removeMouseDragListeners();
    removeTouchDragListeners();
  }

  function handleVisibilityChange() {
    if (document.hidden) cancelDrag();
  }

  function handleWindowBlur() {
    cancelDrag();
  }

  function handleMouseMove(e: MouseEvent) {
    if (!$selectedLayer || !containerEl) return;
    if (tangentDrag) {
      dragTangentTo(e.clientX, e.clientY, e.shiftKey, e.altKey);
      return;
    }
    // Shift: fine drag. Cmd/Ctrl: no snapping.
    dragPointTo(e.clientX, e.clientY, e.shiftKey, e.metaKey || e.ctrlKey);
  }

  function handleMouseUp() {
    cancelDrag();
  }

  function handleTouchStart(row: number, col: number, e: TouchEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    cancelDrag(false);
    dragging = { row, col };
    if (selectedPoint?.row !== row || selectedPoint?.col !== col) selectedTangent = null;
    selectedPoint = { row, col };
    const touch = e.touches[0];
    if (touch) beginPointDrag(row, col, touch.clientX, touch.clientY);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }

  function handleTouchMove(e: TouchEvent) {
    if ((!dragging && !tangentDrag) || !$selectedLayer || !containerEl) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    if (tangentDrag) {
      dragTangentTo(touch.clientX, touch.clientY, false, false);
      return;
    }
    dragPointTo(touch.clientX, touch.clientY, false, false);
  }

  function handleTouchEnd() {
    cancelDrag();
  }

  // Get mesh grid and corners from selected layer
  $: meshGrid = $selectedLayer?.meshGrid;
  $: corners = $selectedLayer?.corners;

  // Generate grid lines - transform mesh points through corner warp. Each
  // cell edge is a polyline: two points when straight, and sampled along
  // its cubic in Bezier mode, the same curve the compositor renders.
  function edgePolyline(grid: MeshWarpGrid, corners: WarpCorners, r0: number, c0: number, r1: number, c1: number): string {
    const steps = grid.bezier ? MESH_CURVE_SEGMENTS : 1;
    const points: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const pixel = meshPointToPixel(meshEdgePoint(grid, r0, c0, r1, c1, i / steps), corners);
      points.push(`${pixel.x},${pixel.y}`);
    }
    return points.join(' ');
  }

  function getGridLines(grid: MeshWarpGrid, corners: WarpCorners): string[] {
    const lines: string[] = [];

    // Horizontal lines
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols - 1; c++) {
        lines.push(edgePolyline(grid, corners, r, c, r, c + 1));
      }
    }

    // Vertical lines
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows - 1; r++) {
        lines.push(edgePolyline(grid, corners, r, c, r + 1, c));
      }
    }

    return lines;
  }

  // Tangent handles of the selected point, in pixels, while in Bezier mode.
  function getTangentHandles(
    grid: MeshWarpGrid,
    corners: WarpCorners,
    point: { row: number; col: number } | null,
  ): Array<{ side: MeshTangentSide; x: number; y: number; linked: boolean }> {
    if (!grid.bezier || !point || !grid.points[point.row]?.[point.col]) return [];
    const origin = grid.points[point.row][point.col];
    const tangents = resolveMeshTangents(grid, point.row, point.col);
    return tangentSides(grid, point.row, point.col).map((side) => {
      const pixel = meshPointToPixel({ x: origin.x + tangents[side].x, y: origin.y + tangents[side].y }, corners);
      return { side, x: pixel.x, y: pixel.y, linked: meshTangentLinked(grid, point.row, point.col, side) };
    });
  }

  // containerWidth/Height are named here so Svelte tracks them: they are read
  // inside meshPointToPixel's closure, invisible to dependency tracking, so
  // the mesh stayed at stale pixel positions after any canvas resize.
  $: gridLines = meshGrid && corners && containerWidth > 0 && containerHeight > 0
    ? getGridLines(meshGrid, corners)
    : [];

  // Get screen positions for all mesh handles (transformed through corner warp)
  function getHandlePositions(grid: MeshWarpGrid, corners: WarpCorners): Array<Array<{ x: number; y: number }>> {
    return grid.points.map(row => row.map(point => meshPointToPixel(point, corners)));
  }

  $: handlePositions = meshGrid && corners && containerWidth > 0 && containerHeight > 0
    ? getHandlePositions(meshGrid, corners)
    : null;

  // Handles follow the point being dragged, or the selected one.
  $: tangentPoint = tangentDrag ?? dragging ?? selectedPoint;
  $: tangentHandles = meshGrid && corners && containerWidth > 0 && containerHeight > 0
    ? getTangentHandles(meshGrid, corners, tangentPoint)
    : [];
  $: tangentOrigin = tangentPoint && handlePositions ? handlePositions[tangentPoint.row]?.[tangentPoint.col] ?? null : null;
  $: if (!meshGrid?.bezier) selectedTangent = null;
</script>

<div
  class="mesh-warp-handles"
  bind:this={containerEl}
  style="width: {containerWidth}px; height: {containerHeight}px;"
>
  {#if $selectedLayer && meshGrid && handlePositions}
    <!-- Grid lines -->
    <svg class="lines-overlay" width={containerWidth} height={containerHeight}>
      {#each gridLines as line}
        <polyline
          points={line}
          fill="none"
          stroke="#ff00aa"
          stroke-width="1"
          stroke-opacity="0.6"
        />
      {/each}

      <!-- Tangent arms of the selected point (Bezier mode) -->
      {#if tangentOrigin}
        {#each tangentHandles as handle (handle.side)}
          <line
            x1={tangentOrigin.x}
            y1={tangentOrigin.y}
            x2={handle.x}
            y2={handle.y}
            stroke="#00d4ff"
            stroke-width="1"
            stroke-opacity="0.8"
            stroke-dasharray={handle.linked ? undefined : '3,3'}
          />
        {/each}
      {/if}

      <!-- Other layers' outlines while dragging a boundary point: what it can snap to -->
      {#if dragging}
        {#each snapOutlines as outline (outline.layerId)}
          <polygon
            points={outline.path.map((p) => `${p.x * containerWidth},${(1 - p.y) * containerHeight}`).join(' ')}
            fill="none"
            stroke="rgba(100, 200, 255, 0.3)"
            stroke-width="1"
            stroke-dasharray="4,4"
          />
        {/each}
      {/if}

      <!-- Snap indicator -->
      {#if activeSnapHit}
        {@const snapPxX = activeSnapHit.point.x * containerWidth}
        {@const snapPxY = (1 - activeSnapHit.point.y) * containerHeight}
        {#if activeSnapHit.kind === 'corner'}
          <circle cx={snapPxX} cy={snapPxY} r="8" fill="none" stroke="#00ff88" stroke-width="2.5" class="snap-indicator" />
          <circle cx={snapPxX} cy={snapPxY} r="3" fill="#00ff88" />
        {:else if activeSnapHit.kind === 'edge'}
          <circle cx={snapPxX} cy={snapPxY} r="6" fill="none" stroke="#00ff88" stroke-width="2" class="snap-indicator" />
          <line x1={snapPxX - 8} y1={snapPxY} x2={snapPxX + 8} y2={snapPxY} stroke="#00ff88" stroke-width="1.5" />
          <line x1={snapPxX} y1={snapPxY - 8} x2={snapPxX} y2={snapPxY + 8} stroke="#00ff88" stroke-width="1.5" />
        {:else}
          {#if activeSnapHit.lineX !== undefined}
            <line x1={activeSnapHit.lineX * containerWidth} y1="0" x2={activeSnapHit.lineX * containerWidth} y2={containerHeight} stroke="#00ff88" stroke-width="1" stroke-dasharray="6,4" opacity="0.8" />
          {/if}
          {#if activeSnapHit.lineY !== undefined}
            <line x1="0" y1={(1 - activeSnapHit.lineY) * containerHeight} x2={containerWidth} y2={(1 - activeSnapHit.lineY) * containerHeight} stroke="#00ff88" stroke-width="1" stroke-dasharray="6,4" opacity="0.8" />
          {/if}
        {/if}
      {/if}
    </svg>

    <!-- Grid point handles - positions are transformed through corner warp -->
    {#each handlePositions as row, rowIndex}
      {#each row as pos, colIndex}
        {@const isCorner = (rowIndex === 0 || rowIndex === meshGrid.rows - 1) && (colIndex === 0 || colIndex === meshGrid.cols - 1)}
        {@const isEdge = rowIndex === 0 || rowIndex === meshGrid.rows - 1 || colIndex === 0 || colIndex === meshGrid.cols - 1}
        <div
          class="handle"
          class:corner={isCorner}
          class:edge={isEdge && !isCorner}
          class:inner={!isEdge}
          class:dragging={dragging?.row === rowIndex && dragging?.col === colIndex}
          class:selected={selectedPoint?.row === rowIndex && selectedPoint?.col === colIndex && !dragging}
          class:locked={$selectedLayer.locked}
          style="left: {pos.x}px; top: {pos.y}px;"
          onmousedown={(e) => handleMouseDown(rowIndex, colIndex, e)}
          ontouchstart={(e) => handleTouchStart(rowIndex, colIndex, e)}
          role="button"
          tabindex="0"
          aria-label="Mesh point {rowIndex},{colIndex}{selectedPoint?.row === rowIndex && selectedPoint?.col === colIndex ? ' (selected)' : ''}"
        >
        </div>
      {/each}
    {/each}

    <!-- Tangent handles: drag to bend (Alt-drag unlinks the pair),
         double-click to straighten -->
    {#if tangentPoint}
      {#each tangentHandles as handle (handle.side)}
        <div
          class="tangent-handle"
          class:unlinked={!handle.linked}
          class:dragging={tangentDrag?.side === handle.side}
          class:selected={selectedTangent === handle.side && !tangentDrag}
          class:locked={$selectedLayer.locked}
          style="left: {handle.x}px; top: {handle.y}px;"
          onmousedown={(e) => handleTangentMouseDown(tangentPoint.row, tangentPoint.col, handle.side, e)}
          ontouchstart={(e) => handleTangentTouchStart(tangentPoint.row, tangentPoint.col, handle.side, e)}
          ondblclick={(e) => { e.preventDefault(); e.stopPropagation(); resetTangent(tangentPoint.row, tangentPoint.col, handle.side); }}
          role="button"
          tabindex="-1"
          title="Drag to bend. Alt-drag to move this handle on its own. Double-click to straighten."
          aria-label="Tangent {handle.side} of mesh point {tangentPoint.row},{tangentPoint.col}{handle.linked ? '' : ' (unlinked)'}"
        ></div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .mesh-warp-handles {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 51;
  }

  .lines-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    overflow: visible;
  }

  .handle {
    position: absolute;
    pointer-events: auto;
    transition: transform 0.1s ease, background 0.1s ease;
    z-index: 51;
    cursor: grab;
  }

  /* Corner handles - largest */
  .handle.corner {
    width: 16px;
    height: 16px;
    margin-left: -8px;
    margin-top: -8px;
    background: #ff00aa;
    border: 2px solid #fff;
    border-radius: 50%;
  }

  /* Edge handles - medium */
  .handle.edge {
    width: 12px;
    height: 12px;
    margin-left: -6px;
    margin-top: -6px;
    background: #ff66cc;
    border: 2px solid #fff;
    border-radius: 50%;
  }

  /* Inner handles - smallest */
  .handle.inner {
    width: 10px;
    height: 10px;
    margin-left: -5px;
    margin-top: -5px;
    background: #ffaadd;
    border: 1px solid #fff;
    border-radius: 50%;
  }

  .handle:hover {
    transform: scale(1.3);
  }

  .handle.dragging {
    cursor: grabbing;
    transform: scale(1.5);
    background: #ffff00;
  }

  .handle.selected {
    background: #00ff88;
    transform: scale(1.4);
    box-shadow: 0 0 10px #00ff88, 0 0 20px rgba(0, 255, 136, 0.5);
  }

  .handle.locked {
    background: #666;
    cursor: not-allowed;
  }

  /* Bezier tangent handles: small diamonds, hollow once unlinked */
  .tangent-handle {
    position: absolute;
    width: 9px;
    height: 9px;
    margin-left: -5px;
    margin-top: -5px;
    background: #00d4ff;
    border: 1px solid #fff;
    transform: rotate(45deg);
    pointer-events: auto;
    cursor: grab;
    z-index: 52;
  }

  .mesh-warp-handles:not(.interaction-only) .tangent-handle {
    transition: transform 0.1s ease;
  }

  .tangent-handle.unlinked {
    background: transparent;
    border: 2px solid #00d4ff;
  }

  .tangent-handle:hover,
  .tangent-handle.dragging {
    transform: rotate(45deg) scale(1.4);
  }

  .tangent-handle.dragging {
    cursor: grabbing;
  }

  .tangent-handle.selected {
    box-shadow: 0 0 8px #00d4ff;
    transform: rotate(45deg) scale(1.3);
  }

  .tangent-handle.locked {
    background: #666;
    cursor: not-allowed;
  }

  /* Cross-layer snap indicator pulse */
  :global(.snap-indicator) {
    animation: snap-pulse 0.4s ease-in-out infinite alternate;
  }

  @keyframes snap-pulse {
    from { opacity: 0.5; }
    to { opacity: 1; }
  }
</style>
