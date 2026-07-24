<script lang="ts">
  import { selectedLayer, project, layers } from '../stores/layers';
  import { history } from '../stores/history';
  import { settings } from '../stores/settings';
  import { get } from 'svelte/store';
  import type { Point2D, MeshWarpGrid, WarpCorners } from '../types';
  import { onMount, onDestroy } from 'svelte';
  import { findSnapTarget, getOtherLayerOutlines, type SnapTarget } from '../utils/snapUtils';
  import { normalizedWarpNudge } from '../utils/warpNudge';

  export let containerWidth: number = 800;
  export let containerHeight: number = 600;

  // Zoom level for correct coordinate transformation
  export let zoom: number = 1;

  let dragging: { row: number; col: number } | null = null;
  let containerEl: HTMLDivElement;

  // Selected point for keyboard navigation (persists after click)
  let selectedPoint: { row: number; col: number } | null = null;

  // Active cross-layer snap target for visual feedback
  let activeSnapTarget: SnapTarget | null = null;

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
    cancelDrag(false);
    dragging = { row, col };
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
        selectedPoint = null;
        return;
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();

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
    if (record && dragging) history.record(get(project));
    dragging = null;
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
    if (!dragging || !$selectedLayer || !containerEl) return;

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
    if (!dragging || !$selectedLayer || !containerEl) return;
    e.preventDefault();

    const touch = e.touches[0];
    const rect = containerEl.getBoundingClientRect();
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

  // Generate grid lines - transform mesh points through corner warp
  function getGridLines(grid: MeshWarpGrid, corners: WarpCorners): Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
    const lines: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = [];

    // Horizontal lines
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols - 1; c++) {
        lines.push({
          from: meshPointToPixel(grid.points[r][c], corners),
          to: meshPointToPixel(grid.points[r][c + 1], corners),
        });
      }
    }

    // Vertical lines
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows - 1; r++) {
        lines.push({
          from: meshPointToPixel(grid.points[r][c], corners),
          to: meshPointToPixel(grid.points[r + 1][c], corners),
        });
      }
    }

    return lines;
  }

  $: gridLines = meshGrid && corners ? getGridLines(meshGrid, corners) : [];

  // Get screen positions for all mesh handles (transformed through corner warp)
  function getHandlePositions(grid: MeshWarpGrid, corners: WarpCorners): Array<Array<{ x: number; y: number }>> {
    return grid.points.map(row => row.map(point => meshPointToPixel(point, corners)));
  }

  $: handlePositions = meshGrid && corners ? getHandlePositions(meshGrid, corners) : null;
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
        <line
          x1={line.from.x}
          y1={line.from.y}
          x2={line.to.x}
          y2={line.to.y}
          stroke="#ff00aa"
          stroke-width="1"
          stroke-opacity="0.6"
        />
      {/each}

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

  /* Cross-layer snap indicator pulse */
  :global(.snap-indicator) {
    animation: snap-pulse 0.4s ease-in-out infinite alternate;
  }

  @keyframes snap-pulse {
    from { opacity: 0.5; }
    to { opacity: 1; }
  }
</style>
