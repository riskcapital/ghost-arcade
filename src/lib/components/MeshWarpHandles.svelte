<script lang="ts">
  import { selectedLayer, project, layers, recordDiscreteAction } from '../stores/layers';
  import { settings } from '../stores/settings';
  import { get } from 'svelte/store';
  import type { Point2D, MeshWarpGrid, WarpCorners } from '../types';
  import { onMount, onDestroy } from 'svelte';
  import { findSnapTarget, getOtherLayerOutlines, type SnapTarget } from '../utils/snapUtils';
  import { normalizedWarpNudge } from '../utils/warpNudge';
  import { releaseFormControlFocus } from '../utils/formFocus';
  import {
    MESH_CURVE_SEGMENTS,
    meshEdgePoint,
    meshPointTangents,
    meshTangentLinked,
    resolveMeshTangents,
    type MeshTangentSide,
  } from '../utils/meshWarp';
  import type { MeshPointTangents } from '../types';

  export let containerWidth: number = 800;
  export let containerHeight: number = 600;

  // Zoom level for correct coordinate transformation
  export let zoom: number = 1;

  // The native presenter owns visuals in native-primary mode. DOM handles
  // remain mounted and interactive as transparent hit targets.
  export let interactionOnly: boolean = false;

  let dragging: { row: number; col: number } | null = null;
  let containerEl: HTMLDivElement;

  // Selected point for keyboard navigation (persists after click)
  let selectedPoint: { row: number; col: number } | null = null;

  // Active cross-layer snap target for visual feedback
  let activeSnapTarget: SnapTarget | null = null;

  // Bezier mesh: the tangent handle being dragged, and the one the arrow
  // keys nudge (the last handle clicked on the selected point).
  let tangentDrag: { row: number; col: number; side: MeshTangentSide } | null = null;
  let selectedTangent: MeshTangentSide | null = null;

  const OPPOSITE_SIDE: Record<MeshTangentSide, MeshTangentSide> = {
    right: 'left', left: 'right', down: 'up', up: 'down',
  };

  /** Sides of a point that have a neighbour, so a handle there bends an edge. */
  function tangentSides(grid: MeshWarpGrid, row: number, col: number): MeshTangentSide[] {
    const sides: MeshTangentSide[] = [];
    if (col < grid.cols - 1) sides.push('right');
    if (col > 0) sides.push('left');
    if (row < grid.rows - 1) sides.push('down');
    if (row > 0) sides.push('up');
    return sides;
  }

  /**
   * Store a new tangent for one handle. Linked handles (the default) store
   * only the dragged side, so the opposite one mirrors it. Alt unlinks: the
   * opposite handle is frozen where it is and the two move independently
   * from then on. A pair that is already unlinked stays unlinked.
   */
  function writeTangent(row: number, col: number, side: MeshTangentSide, tangent: Point2D, unlink: boolean) {
    const layer = $selectedLayer;
    const grid = layer?.meshGrid;
    if (!layer || !grid) return;
    const stored: MeshPointTangents = { ...(meshPointTangents(grid, row, col) ?? {}) };
    const opposite = OPPOSITE_SIDE[side];
    const linked = meshTangentLinked(grid, row, col, side);
    if (unlink && linked) {
      stored[opposite] = resolveMeshTangents(grid, row, col)[opposite];
    } else if (linked) {
      delete stored[opposite];
    }
    stored[side] = tangent;
    project.setMeshPointTangents(layer.id, row, col, stored);
  }

  /** Double-click: put one handle back on the straight edge. */
  function resetTangent(row: number, col: number, side: MeshTangentSide) {
    const layer = $selectedLayer;
    const grid = layer?.meshGrid;
    if (!layer || !grid || layer.locked) return;
    const stored: MeshPointTangents = { ...(meshPointTangents(grid, row, col) ?? {}) };
    const opposite = OPPOSITE_SIDE[side];
    const point = grid.points[row][col];
    const straight = (s: MeshTangentSide): Point2D | null => {
      const dr = s === 'down' ? 1 : s === 'up' ? -1 : 0;
      const dc = s === 'right' ? 1 : s === 'left' ? -1 : 0;
      const next = grid.points[row + dr]?.[col + dc];
      return next ? { x: (next.x - point.x) / 3, y: (next.y - point.y) / 3 } : null;
    };
    const isStraight = (s: MeshTangentSide) => {
      const want = straight(s);
      const have = stored[s];
      return !want || (!!have && Math.abs(have.x - want.x) < 1e-6 && Math.abs(have.y - want.y) < 1e-6);
    };
    delete stored[side];
    if (stored[opposite] && !meshTangentLinked(grid, row, col, side) && !isStraight(opposite)) {
      // The other handle was unlinked and still bends; keep it and pin
      // this one straight.
      const pinned = straight(side);
      if (pinned) stored[side] = pinned;
    } else {
      // Linked pair: straighten the whole axis.
      delete stored[opposite];
    }
    project.setMeshPointTangents(layer.id, row, col, stored);
    recordDiscreteAction();
  }

  function handleTangentMouseDown(row: number, col: number, side: MeshTangentSide, e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    releaseFormControlFocus();
    cancelDrag(false);
    tangentDrag = { row, col, side };
    selectedTangent = side;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleTangentTouchStart(row: number, col: number, side: MeshTangentSide, e: TouchEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    cancelDrag(false);
    tangentDrag = { row, col, side };
    selectedTangent = side;
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }

  function dragTangentTo(x: number, y: number, unlink: boolean) {
    if (!tangentDrag || !$selectedLayer?.meshGrid) return;
    const { row, col, side } = tangentDrag;
    const local = pixelToMeshPoint(x, y, $selectedLayer.corners);
    const point = $selectedLayer.meshGrid.points[row][col];
    writeTangent(row, col, side, { x: local.x - point.x, y: local.y - point.y }, unlink);
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

  // Convert screen pixel position back to mesh local coordinates (0-1)
  // Given corners and screen position, find the local u,v in the mesh
  function pixelToMeshPoint(pixelX: number, pixelY: number, corners: WarpCorners): Point2D {
    // Convert pixel to normalized screen coords
    const screenX = pixelX / containerWidth;
    const screenY = 1 - pixelY / containerHeight;

    // Inverse bilinear interpolation - find u,v such that bilinear(u,v) = screenX,screenY
    // This is complex for arbitrary quads, so we use iterative refinement
    let u = 0.5;
    let v = 0.5;

    for (let i = 0; i < 10; i++) {
      // Calculate current position from u,v
      const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * u;
      const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * u;
      const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * u;
      const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * u;
      const currentX = bottomX + (topX - bottomX) * v;
      const currentY = bottomY + (topY - bottomY) * v;

      // Calculate error
      const errorX = screenX - currentX;
      const errorY = screenY - currentY;

      if (Math.abs(errorX) < 0.001 && Math.abs(errorY) < 0.001) break;

      // Calculate partial derivatives (Jacobian)
      const dxdu = (corners.topRight.x - corners.topLeft.x) * v +
                   (corners.bottomRight.x - corners.bottomLeft.x) * (1 - v);
      const dxdv = (topX - bottomX);
      const dydu = (corners.topRight.y - corners.topLeft.y) * v +
                   (corners.bottomRight.y - corners.bottomLeft.y) * (1 - v);
      const dydv = (topY - bottomY);

      // Solve for du, dv using inverse Jacobian
      const det = dxdu * dydv - dxdv * dydu;
      if (Math.abs(det) < 0.0001) break;

      const du = (dydv * errorX - dxdv * errorY) / det;
      const dv = (-dydu * errorX + dxdu * errorY) / det;

      u = u + du;
      v = v + dv;
    }

    return { x: u, y: v };
  }

  function handleMouseDown(row: number, col: number, e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    releaseFormControlFocus();
    cancelDrag(false);
    dragging = { row, col };
    if (selectedPoint?.row !== row || selectedPoint?.col !== col) selectedTangent = null;
    selectedPoint = { row, col };  // Set selected point for keyboard navigation
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
      recordDiscreteAction();
      return;
    }

    const newPos: Point2D = {
      x: currentPos.x + dx,
      y: currentPos.y + dy,
    };

    project.setMeshPoint($selectedLayer.id, selectedPoint.row, selectedPoint.col, newPos);
    recordDiscreteAction();
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

  // Stale-drag guard: a drag interrupted by window blur, tab hide, or
  // component teardown must release its global listeners or the next
  // session inherits phantom mousemove handlers.
  function cancelDrag(record = true) {
    if (record && (dragging || tangentDrag)) recordDiscreteAction();
    dragging = null;
    tangentDrag = null;
    activeSnapTarget = null;
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
      const rect = containerEl.getBoundingClientRect();
      dragTangentTo((e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom, e.altKey);
      return;
    }
    if (!dragging) return;

    const rect = containerEl.getBoundingClientRect();
    // Account for zoom transform when converting mouse position
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    // Convert screen position back to mesh-local coordinates using corner warp
    const warpCorners = $selectedLayer.corners;
    let meshLocal = pixelToMeshPoint(x, y, warpCorners);

    // Cross-layer snap for boundary mesh points
    const grid = get(settings).ui.gridSettings;
    const snapEnabled = grid?.snapToLayers !== false;
    if (snapEnabled && isBoundaryPoint(dragging.row, dragging.col)) {
      // Convert the mesh point to normalized screen coords for snap comparison
      const screenPos = meshPointToPixel(meshLocal, warpCorners);
      const normalized = { x: screenPos.x / containerWidth, y: 1 - screenPos.y / containerHeight };

      const crossSnap = findSnapTarget(normalized, get(layers), $selectedLayer.id);
      if (crossSnap.snapped && crossSnap.target) {
        // Convert snapped normalized position back to mesh-local coords
        const snappedPxX = crossSnap.point.x * containerWidth;
        const snappedPxY = (1 - crossSnap.point.y) * containerHeight;
        meshLocal = pixelToMeshPoint(snappedPxX, snappedPxY, warpCorners);
        activeSnapTarget = crossSnap.target;
      } else {
        activeSnapTarget = null;
      }
    } else {
      activeSnapTarget = null;
    }

    project.setMeshPoint($selectedLayer.id, dragging.row, dragging.col, meshLocal);
  }

  function handleMouseUp() {
    cancelDrag();
  }

  function handleTouchStart(row: number, col: number, e: TouchEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    cancelDrag(false);
    dragging = { row, col };
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }

  function handleTouchMove(e: TouchEvent) {
    if ((!dragging && !tangentDrag) || !$selectedLayer || !containerEl) return;
    e.preventDefault();

    const touch = e.touches[0];
    const rect = containerEl.getBoundingClientRect();
    if (tangentDrag) {
      dragTangentTo((touch.clientX - rect.left) / zoom, (touch.clientY - rect.top) / zoom, false);
      return;
    }
    if (!dragging) return;
    // Account for zoom transform when converting touch position
    const x = (touch.clientX - rect.left) / zoom;
    const y = (touch.clientY - rect.top) / zoom;

    // Convert screen position back to mesh-local coordinates using corner warp
    const warpCorners = $selectedLayer.corners;
    let meshLocal = pixelToMeshPoint(x, y, warpCorners);

    // Cross-layer snap for boundary mesh points
    const grid = get(settings).ui.gridSettings;
    const snapEnabled = grid?.snapToLayers !== false;
    if (snapEnabled && isBoundaryPoint(dragging.row, dragging.col)) {
      const screenPos = meshPointToPixel(meshLocal, warpCorners);
      const normalized = { x: screenPos.x / containerWidth, y: 1 - screenPos.y / containerHeight };

      const crossSnap = findSnapTarget(normalized, get(layers), $selectedLayer.id);
      if (crossSnap.snapped && crossSnap.target) {
        const snappedPxX = crossSnap.point.x * containerWidth;
        const snappedPxY = (1 - crossSnap.point.y) * containerHeight;
        meshLocal = pixelToMeshPoint(snappedPxX, snappedPxY, warpCorners);
        activeSnapTarget = crossSnap.target;
      } else {
        activeSnapTarget = null;
      }
    } else {
      activeSnapTarget = null;
    }

    project.setMeshPoint($selectedLayer.id, dragging.row, dragging.col, meshLocal);
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

<div data-help-page="projection-mapping"
  class="mesh-warp-handles"
  class:interaction-only={interactionOnly}
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

      <!-- Other layers' outlines (shown while dragging boundary points) -->
      {#if dragging && isBoundaryPoint(dragging.row, dragging.col) && $selectedLayer}
        {#each getOtherLayerOutlines(get(layers), $selectedLayer.id) as outline}
          {@const c0x = outline.corners[0].x * containerWidth}
          {@const c0y = (1 - outline.corners[0].y) * containerHeight}
          {@const c1x = outline.corners[1].x * containerWidth}
          {@const c1y = (1 - outline.corners[1].y) * containerHeight}
          {@const c2x = outline.corners[2].x * containerWidth}
          {@const c2y = (1 - outline.corners[2].y) * containerHeight}
          {@const c3x = outline.corners[3].x * containerWidth}
          {@const c3y = (1 - outline.corners[3].y) * containerHeight}
          <polygon
            points="{c0x},{c0y} {c1x},{c1y} {c2x},{c2y} {c3x},{c3y}"
            fill="none"
            stroke="rgba(100, 200, 255, 0.3)"
            stroke-width="1"
            stroke-dasharray="4,4"
          />
        {/each}
      {/if}

      <!-- Cross-layer snap indicator -->
      {#if activeSnapTarget}
        {@const snapPxX = activeSnapTarget.point.x * containerWidth}
        {@const snapPxY = (1 - activeSnapTarget.point.y) * containerHeight}
        {#if activeSnapTarget.type === 'corner'}
          <circle cx={snapPxX} cy={snapPxY} r="8" fill="none" stroke="#00ff88" stroke-width="2.5" class="snap-indicator" />
          <circle cx={snapPxX} cy={snapPxY} r="3" fill="#00ff88" />
        {:else}
          <circle cx={snapPxX} cy={snapPxY} r="6" fill="none" stroke="#00ff88" stroke-width="2" class="snap-indicator" />
          <line x1={snapPxX - 8} y1={snapPxY} x2={snapPxX + 8} y2={snapPxY} stroke="#00ff88" stroke-width="1.5" />
          <line x1={snapPxX} y1={snapPxY - 8} x2={snapPxX} y2={snapPxY + 8} stroke="#00ff88" stroke-width="1.5" />
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

  .mesh-warp-handles.interaction-only .handle {
    transition: none;
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
