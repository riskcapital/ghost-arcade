<script lang="ts">
  import { selectedLayer, project, layers, selectedLayerIds } from '../stores/layers';
  import { history } from '../stores/history';
  import { settings } from '../stores/settings';
  import { get } from 'svelte/store';
  import type { WarpCorners, Point2D, Layer } from '../types';
  import { onMount, onDestroy } from 'svelte';
  import { findSnapTarget, getOtherLayerOutlines, type SnapTarget } from '../utils/snapUtils';

  // Container dimensions (set by parent)
  export let containerWidth: number = 800;
  export let containerHeight: number = 600;

  // Zoom level for correct coordinate transformation
  export let zoom: number = 1;

  // When true, hide corner handles (used in mesh mode to avoid overlap with mesh corner handles)
  export let hideCorners: boolean = false;

  // When true, shape warp editing is active — offset move handle to avoid blocking center focus handle
  export let shapeWarpActive: boolean = false;

  let dragging: 'corner' | 'edge' | 'move' | 'rotate' | 'scale' | null = null;
  let dragTarget: keyof WarpCorners | 'top' | 'bottom' | 'left' | 'right' | 'center' | 'rotate' | 'scale' | null = null;
  let containerEl: HTMLDivElement;
  let dragStartPos: { x: number; y: number } | null = null;
  let initialCorners: WarpCorners | null = null;
  // Selected corner for keyboard navigation (persists after click)
  let selectedCorner: keyof WarpCorners | null = null;

  // Scale drag state
  let scaleStartY: number = 0;
  let scaleInitialCorners: WarpCorners | null = null;

  // Active cross-layer snap target for visual feedback
  let activeSnapTarget: SnapTarget | null = null;

  // Multi-select: store initial corners for all selected layers during batch transforms
  let batchInitialCorners: Map<string, WarpCorners> = new Map();

  // Get all selected layers that should be batch-transformed (excluding locked)
  function getBatchLayers(): Layer[] {
    const ids = get(selectedLayerIds);
    const allLayers = get(layers);
    if (ids.length <= 1) return [];
    return allLayers.filter(l => ids.includes(l.id) && !l.locked && l.id !== $selectedLayer?.id);
  }

  // Apply a corner delta to all batch-selected layers
  function applyBatchDelta(dx: number, dy: number) {
    for (const [layerId, initial] of batchInitialCorners) {
      project.setCorner(layerId, 'topLeft', { x: initial.topLeft.x + dx, y: initial.topLeft.y + dy });
      project.setCorner(layerId, 'topRight', { x: initial.topRight.x + dx, y: initial.topRight.y + dy });
      project.setCorner(layerId, 'bottomLeft', { x: initial.bottomLeft.x + dx, y: initial.bottomLeft.y + dy });
      project.setCorner(layerId, 'bottomRight', { x: initial.bottomRight.x + dx, y: initial.bottomRight.y + dy });
    }
  }

  // Apply scale to all batch-selected layers around their own centers
  function applyBatchScale(scaleFactor: number) {
    for (const [layerId, initial] of batchInitialCorners) {
      const cx = (initial.topLeft.x + initial.topRight.x + initial.bottomLeft.x + initial.bottomRight.x) / 4;
      const cy = (initial.topLeft.y + initial.topRight.y + initial.bottomLeft.y + initial.bottomRight.y) / 4;
      project.setCorner(layerId, 'topLeft', { x: cx + (initial.topLeft.x - cx) * scaleFactor, y: cy + (initial.topLeft.y - cy) * scaleFactor });
      project.setCorner(layerId, 'topRight', { x: cx + (initial.topRight.x - cx) * scaleFactor, y: cy + (initial.topRight.y - cy) * scaleFactor });
      project.setCorner(layerId, 'bottomLeft', { x: cx + (initial.bottomLeft.x - cx) * scaleFactor, y: cy + (initial.bottomLeft.y - cy) * scaleFactor });
      project.setCorner(layerId, 'bottomRight', { x: cx + (initial.bottomRight.x - cx) * scaleFactor, y: cy + (initial.bottomRight.y - cy) * scaleFactor });
    }
  }

  // Apply rotation to all batch-selected layers around their own centers
  function applyBatchRotate(deltaAngle: number) {
    const cos = Math.cos(deltaAngle);
    const sin = Math.sin(deltaAngle);
    for (const [layerId, initial] of batchInitialCorners) {
      const cx = (initial.topLeft.x + initial.topRight.x + initial.bottomLeft.x + initial.bottomRight.x) / 4;
      const cy = (initial.topLeft.y + initial.topRight.y + initial.bottomLeft.y + initial.bottomRight.y) / 4;
      function rot(p: Point2D): Point2D {
        const dx = p.x - cx; const dy = p.y - cy;
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
      }
      project.setCorner(layerId, 'topLeft', rot(initial.topLeft));
      project.setCorner(layerId, 'topRight', rot(initial.topRight));
      project.setCorner(layerId, 'bottomLeft', rot(initial.bottomLeft));
      project.setCorner(layerId, 'bottomRight', rot(initial.bottomRight));
    }
  }

  // Capture initial corners for all batch layers (+ children of group layers)
  function captureBatchInitial() {
    batchInitialCorners.clear();
    for (const layer of getBatchLayers()) {
      batchInitialCorners.set(layer.id, structuredClone(layer.corners));
    }
    // If the selected layer is a group, also capture children so they move with it
    if ($selectedLayer?.type === 'group') {
      const allLayers = get(layers);
      for (const child of allLayers) {
        if (child.parentGroupId === $selectedLayer.id && child.corners && !child.locked) {
          batchInitialCorners.set(child.id, structuredClone(child.corners));
        }
      }
    }
  }

  // Movement delta for arrow keys (normalized coordinates)
  const MOVE_DELTA = 0.005;  // Small step
  const MOVE_DELTA_LARGE = 0.02;  // Large step with Shift

  // Edge snap threshold (normalized coords, ~2% of canvas)
  const SNAP_THRESHOLD = 0.02;

  // Snap a normalized value to 0 or 1 if within threshold
  function snapToEdge(val: number): number {
    if (Math.abs(val) < SNAP_THRESHOLD) return 0;
    if (Math.abs(val - 1) < SNAP_THRESHOLD) return 1;
    return val;
  }

  // Snap a normalized value to the nearest grid line if within threshold
  function snapToGrid(val: number, divisions: number): number {
    const gridSnap = Math.round(val * divisions) / divisions;
    const gridThreshold = Math.min(SNAP_THRESHOLD, 0.5 / divisions);
    if (Math.abs(val - gridSnap) < gridThreshold) return gridSnap;
    return val;
  }

  // Snap a Point2D to other layers, canvas edges, and optionally to grid
  function snapPoint(p: Point2D): Point2D {
    let { x, y } = p;

    // Cross-layer snap (highest priority)
    const grid = get(settings).ui.gridSettings;
    const snapToLayersEnabled = grid?.snapToLayers !== false; // default true
    if (snapToLayersEnabled && $selectedLayer) {
      const crossSnap = findSnapTarget({ x, y }, get(layers), $selectedLayer.id);
      if (crossSnap.snapped && crossSnap.target) {
        activeSnapTarget = crossSnap.target;
        return crossSnap.point;
      }
    }
    activeSnapTarget = null;

    // Grid snap
    if (grid?.snapToGrid && grid.enabled) {
      x = snapToGrid(x, grid.columns);
      y = snapToGrid(y, grid.rows);
    }
    // Canvas edge snap (overrides grid snap if near boundary)
    x = snapToEdge(x);
    y = snapToEdge(y);
    return { x, y };
  }

  // Convert normalized (0-1) to pixel coordinates
  function toPixel(point: Point2D): { x: number; y: number } {
    return {
      x: point.x * containerWidth,
      y: (1 - point.y) * containerHeight, // Flip Y for screen coords
    };
  }

  // Convert pixel to normalized coordinates (no clamping - allow off-screen)
  function toNormalized(x: number, y: number): Point2D {
    return {
      x: x / containerWidth,
      y: 1 - y / containerHeight,
    };
  }

  // Get center of the quad
  function getCenter(corners: WarpCorners): Point2D {
    return {
      x: (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4,
      y: (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4,
    };
  }

  // Get midpoint of an edge
  function getEdgeMidpoint(corners: WarpCorners, edge: 'top' | 'bottom' | 'left' | 'right'): Point2D {
    switch (edge) {
      case 'top':
        return { x: (corners.topLeft.x + corners.topRight.x) / 2, y: (corners.topLeft.y + corners.topRight.y) / 2 };
      case 'bottom':
        return { x: (corners.bottomLeft.x + corners.bottomRight.x) / 2, y: (corners.bottomLeft.y + corners.bottomRight.y) / 2 };
      case 'left':
        return { x: (corners.topLeft.x + corners.bottomLeft.x) / 2, y: (corners.topLeft.y + corners.bottomLeft.y) / 2 };
      case 'right':
        return { x: (corners.topRight.x + corners.bottomRight.x) / 2, y: (corners.topRight.y + corners.bottomRight.y) / 2 };
    }
  }

  // Handle corner drag
  function handleCornerMouseDown(corner: keyof WarpCorners, e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = 'corner';
    dragTarget = corner;
    selectedCorner = corner;  // Set selected corner for keyboard navigation
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  // Handle keyboard navigation for selected corner
  function handleKeyDown(e: KeyboardEvent) {
    if (!selectedCorner || !$selectedLayer || $selectedLayer.locked) return;

    const delta = e.shiftKey ? MOVE_DELTA_LARGE : MOVE_DELTA;
    const currentPos = $selectedLayer.corners[selectedCorner];
    let dx = 0;
    let dy = 0;

    switch (e.key) {
      case 'ArrowUp':
        dy = delta;
        break;
      case 'ArrowDown':
        dy = -delta;
        break;
      case 'ArrowLeft':
        dx = -delta;
        break;
      case 'ArrowRight':
        dx = delta;
        break;
      case 'Escape':
        selectedCorner = null;
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

    project.setCorner($selectedLayer.id, selectedCorner, newPos);
  }

  // Set up keyboard event listener
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  // Handle edge drag (moves both corners on that edge)
  function handleEdgeMouseDown(edge: 'top' | 'bottom' | 'left' | 'right', e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = 'edge';
    dragTarget = edge;

    const rect = containerEl.getBoundingClientRect();
    // Account for zoom when storing initial position
    dragStartPos = { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
    initialCorners = $selectedLayer ? { ...$selectedLayer.corners } : null;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  // Handle move (center handle)
  function handleMoveMouseDown(e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = 'move';
    dragTarget = 'center';

    const rect = containerEl.getBoundingClientRect();
    // Account for zoom when storing initial position
    dragStartPos = { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
    initialCorners = $selectedLayer ? structuredClone($selectedLayer.corners) : null;
    captureBatchInitial();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  // Handle rotation
  function handleRotateMouseDown(e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = 'rotate';
    dragTarget = 'rotate';

    const rect = containerEl.getBoundingClientRect();
    // Account for zoom when storing initial position
    dragStartPos = { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
    initialCorners = $selectedLayer ? structuredClone($selectedLayer.corners) : null;
    captureBatchInitial();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  // Handle uniform scale
  function handleScaleMouseDown(e: MouseEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = 'scale';
    dragTarget = 'scale';

    const rect = containerEl.getBoundingClientRect();
    scaleStartY = (e.clientY - rect.top) / zoom;
    scaleInitialCorners = $selectedLayer ? structuredClone($selectedLayer.corners) : null;
    initialCorners = scaleInitialCorners;
    captureBatchInitial();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!dragging || !$selectedLayer || !containerEl) return;

    const rect = containerEl.getBoundingClientRect();
    // Account for zoom transform when converting mouse position
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    if (dragging === 'corner' && dragTarget) {
      const normalized = snapPoint(toNormalized(x, y));
      project.setCorner($selectedLayer.id, dragTarget as keyof WarpCorners, normalized);
    } else if (dragging === 'edge' && dragTarget && dragStartPos && initialCorners) {
      const dx = (x - dragStartPos.x) / containerWidth;
      const dy = -(y - dragStartPos.y) / containerHeight; // Flip Y

      const edge = dragTarget as 'top' | 'bottom' | 'left' | 'right';
      const newCorners = structuredClone(initialCorners);

      // Move both corners on the edge (no clamping - allow off-screen)
      if (edge === 'top') {
        newCorners.topLeft.x = initialCorners.topLeft.x + dx;
        newCorners.topLeft.y = initialCorners.topLeft.y + dy;
        newCorners.topRight.x = initialCorners.topRight.x + dx;
        newCorners.topRight.y = initialCorners.topRight.y + dy;
      } else if (edge === 'bottom') {
        newCorners.bottomLeft.x = initialCorners.bottomLeft.x + dx;
        newCorners.bottomLeft.y = initialCorners.bottomLeft.y + dy;
        newCorners.bottomRight.x = initialCorners.bottomRight.x + dx;
        newCorners.bottomRight.y = initialCorners.bottomRight.y + dy;
      } else if (edge === 'left') {
        newCorners.topLeft.x = initialCorners.topLeft.x + dx;
        newCorners.topLeft.y = initialCorners.topLeft.y + dy;
        newCorners.bottomLeft.x = initialCorners.bottomLeft.x + dx;
        newCorners.bottomLeft.y = initialCorners.bottomLeft.y + dy;
      } else if (edge === 'right') {
        newCorners.topRight.x = initialCorners.topRight.x + dx;
        newCorners.topRight.y = initialCorners.topRight.y + dy;
        newCorners.bottomRight.x = initialCorners.bottomRight.x + dx;
        newCorners.bottomRight.y = initialCorners.bottomRight.y + dy;
      }

      // Snap and update all corners at once
      project.setCorner($selectedLayer.id, 'topLeft', snapPoint(newCorners.topLeft));
      project.setCorner($selectedLayer.id, 'topRight', snapPoint(newCorners.topRight));
      project.setCorner($selectedLayer.id, 'bottomLeft', snapPoint(newCorners.bottomLeft));
      project.setCorner($selectedLayer.id, 'bottomRight', snapPoint(newCorners.bottomRight));
    } else if (dragging === 'move' && dragStartPos && initialCorners) {
      // Move all 4 corners together (no clamping - allow off-screen)
      const dx = (x - dragStartPos.x) / containerWidth;
      const dy = -(y - dragStartPos.y) / containerHeight;

      const newCorners: WarpCorners = {
        topLeft: {
          x: initialCorners.topLeft.x + dx,
          y: initialCorners.topLeft.y + dy
        },
        topRight: {
          x: initialCorners.topRight.x + dx,
          y: initialCorners.topRight.y + dy
        },
        bottomLeft: {
          x: initialCorners.bottomLeft.x + dx,
          y: initialCorners.bottomLeft.y + dy
        },
        bottomRight: {
          x: initialCorners.bottomRight.x + dx,
          y: initialCorners.bottomRight.y + dy
        },
      };

      project.setCorner($selectedLayer.id, 'topLeft', snapPoint(newCorners.topLeft));
      project.setCorner($selectedLayer.id, 'topRight', snapPoint(newCorners.topRight));
      project.setCorner($selectedLayer.id, 'bottomLeft', snapPoint(newCorners.bottomLeft));
      project.setCorner($selectedLayer.id, 'bottomRight', snapPoint(newCorners.bottomRight));

      // Batch move: apply same delta to all other selected layers
      applyBatchDelta(dx, dy);
    } else if (dragging === 'rotate' && dragStartPos && initialCorners) {
      // Calculate rotation based on angle from center
      const center = getCenter(initialCorners);
      const centerPixel = toPixel(center);

      const startAngle = Math.atan2(dragStartPos.y - centerPixel.y, dragStartPos.x - centerPixel.x);
      const currentAngle = Math.atan2(y - centerPixel.y, x - centerPixel.x);
      const deltaAngle = currentAngle - startAngle;

      // Rotate all corners around center
      const cos = Math.cos(deltaAngle);
      const sin = Math.sin(deltaAngle);

      function rotatePoint(p: Point2D, cx: number, cy: number): Point2D {
        const dx = p.x - cx;
        const dy = p.y - cy;
        return {
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
        };
      }

      const newCorners: WarpCorners = {
        topLeft: rotatePoint(initialCorners.topLeft, center.x, center.y),
        topRight: rotatePoint(initialCorners.topRight, center.x, center.y),
        bottomLeft: rotatePoint(initialCorners.bottomLeft, center.x, center.y),
        bottomRight: rotatePoint(initialCorners.bottomRight, center.x, center.y),
      };

      project.setCorner($selectedLayer.id, 'topLeft', newCorners.topLeft);
      project.setCorner($selectedLayer.id, 'topRight', newCorners.topRight);
      project.setCorner($selectedLayer.id, 'bottomLeft', newCorners.bottomLeft);
      project.setCorner($selectedLayer.id, 'bottomRight', newCorners.bottomRight);

      // Batch rotate: apply same angle to all other selected layers
      applyBatchRotate(deltaAngle);
    } else if (dragging === 'scale' && scaleInitialCorners) {
      // Uniform scale: drag up to enlarge, down to shrink
      const deltaY = scaleStartY - y; // positive = up = bigger
      const sensitivity = 0.005;
      const scaleFactor = Math.max(0.05, Math.min(10, 1 + deltaY * sensitivity));
      const center = getCenter(scaleInitialCorners);

      function scalePoint(p: Point2D, cx: number, cy: number): Point2D {
        return {
          x: cx + (p.x - cx) * scaleFactor,
          y: cy + (p.y - cy) * scaleFactor,
        };
      }

      const newCorners: WarpCorners = {
        topLeft: scalePoint(scaleInitialCorners.topLeft, center.x, center.y),
        topRight: scalePoint(scaleInitialCorners.topRight, center.x, center.y),
        bottomLeft: scalePoint(scaleInitialCorners.bottomLeft, center.x, center.y),
        bottomRight: scalePoint(scaleInitialCorners.bottomRight, center.x, center.y),
      };

      project.setCorner($selectedLayer.id, 'topLeft', newCorners.topLeft);
      project.setCorner($selectedLayer.id, 'topRight', newCorners.topRight);
      project.setCorner($selectedLayer.id, 'bottomLeft', newCorners.bottomLeft);
      project.setCorner($selectedLayer.id, 'bottomRight', newCorners.bottomRight);

      // Batch scale: apply same factor to all other selected layers
      applyBatchScale(scaleFactor);
    }
  }

  function handleMouseUp() {
    if (dragging) history.record(get(project));
    dragging = null;
    dragTarget = null;
    dragStartPos = null;
    initialCorners = null;
    scaleStartY = 0;
    scaleInitialCorners = null;
    activeSnapTarget = null;
    batchInitialCorners.clear();
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  // Touch events
  function handleCornerTouchStart(corner: keyof WarpCorners, e: TouchEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    dragging = 'corner';
    dragTarget = corner;
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }

  function handleMoveTouchStart(e: TouchEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    dragging = 'move';
    dragTarget = 'center';

    const rect = containerEl.getBoundingClientRect();
    const touch = e.touches[0];
    // Account for zoom when storing initial position
    dragStartPos = { x: (touch.clientX - rect.left) / zoom, y: (touch.clientY - rect.top) / zoom };
    initialCorners = $selectedLayer ? structuredClone($selectedLayer.corners) : null;
    captureBatchInitial();

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

    if (dragging === 'corner' && dragTarget) {
      const normalized = snapPoint(toNormalized(x, y));
      project.setCorner($selectedLayer.id, dragTarget as keyof WarpCorners, normalized);
    } else if (dragging === 'move' && dragStartPos && initialCorners) {
      const dx = (x - dragStartPos.x) / containerWidth;
      const dy = -(y - dragStartPos.y) / containerHeight;

      const newCorners: WarpCorners = {
        topLeft: {
          x: initialCorners.topLeft.x + dx,
          y: initialCorners.topLeft.y + dy
        },
        topRight: {
          x: initialCorners.topRight.x + dx,
          y: initialCorners.topRight.y + dy
        },
        bottomLeft: {
          x: initialCorners.bottomLeft.x + dx,
          y: initialCorners.bottomLeft.y + dy
        },
        bottomRight: {
          x: initialCorners.bottomRight.x + dx,
          y: initialCorners.bottomRight.y + dy
        },
      };

      project.setCorner($selectedLayer.id, 'topLeft', snapPoint(newCorners.topLeft));
      project.setCorner($selectedLayer.id, 'topRight', snapPoint(newCorners.topRight));
      project.setCorner($selectedLayer.id, 'bottomLeft', snapPoint(newCorners.bottomLeft));
      project.setCorner($selectedLayer.id, 'bottomRight', snapPoint(newCorners.bottomRight));

      // Batch move: apply same delta to all other selected layers
      applyBatchDelta(dx, dy);
    }
  }

  function handleTouchEnd() {
    if (dragging) history.record(get(project));
    dragging = null;
    dragTarget = null;
    dragStartPos = null;
    initialCorners = null;
    activeSnapTarget = null;
    batchInitialCorners.clear();
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
  }

  // Corner handle positions
  $: corners = $selectedLayer?.corners;
  $: handlePositions = corners
    ? {
        topLeft: toPixel(corners.topLeft),
        topRight: toPixel(corners.topRight),
        bottomLeft: toPixel(corners.bottomLeft),
        bottomRight: toPixel(corners.bottomRight),
      }
    : null;

  // Edge midpoint positions
  $: edgePositions = corners && handlePositions
    ? {
        top: toPixel(getEdgeMidpoint(corners, 'top')),
        bottom: toPixel(getEdgeMidpoint(corners, 'bottom')),
        left: toPixel(getEdgeMidpoint(corners, 'left')),
        right: toPixel(getEdgeMidpoint(corners, 'right')),
      }
    : null;

  // Center position for move handle
  $: centerPosition = corners ? toPixel(getCenter(corners)) : null;

  // Rotation handle position (above top edge)
  $: rotatePosition = edgePositions
    ? { x: edgePositions.top.x, y: edgePositions.top.y - 40 }
    : null;

  // Scale handle position (below bottom edge)
  $: scalePosition = edgePositions
    ? { x: edgePositions.bottom.x, y: edgePositions.bottom.y + 40 }
    : null;

  // Draw lines between corners
  $: lines = handlePositions
    ? [
        { from: handlePositions.topLeft, to: handlePositions.topRight },
        { from: handlePositions.topRight, to: handlePositions.bottomRight },
        { from: handlePositions.bottomRight, to: handlePositions.bottomLeft },
        { from: handlePositions.bottomLeft, to: handlePositions.topLeft },
      ]
    : [];
</script>

<div
  class="warp-handles"
  bind:this={containerEl}
  style="width: {containerWidth}px; height: {containerHeight}px;"
>
  {#if $selectedLayer && handlePositions && edgePositions && centerPosition}
    <!-- Edge lines -->
    <svg class="lines-overlay" width={containerWidth} height={containerHeight}>
      {#each lines as line}
        <line
          x1={line.from.x}
          y1={line.from.y}
          x2={line.to.x}
          y2={line.to.y}
          stroke="#BB86FC"
          stroke-width="2"
          stroke-dasharray="5,5"
        />
      {/each}

      <!-- Line to rotation handle -->
      {#if rotatePosition}
        <line
          x1={edgePositions.top.x}
          y1={edgePositions.top.y}
          x2={rotatePosition.x}
          y2={rotatePosition.y}
          stroke="#BB86FC"
          stroke-width="1"
          stroke-dasharray="3,3"
        />
      {/if}

      <!-- Other layers' outlines (shown while dragging for spatial context) -->
      {#if dragging && $selectedLayer}
        {#each getOtherLayerOutlines(get(layers), $selectedLayer.id) as outline}
          {@const c0 = toPixel(outline.corners[0])}
          {@const c1 = toPixel(outline.corners[1])}
          {@const c2 = toPixel(outline.corners[2])}
          {@const c3 = toPixel(outline.corners[3])}
          <polygon
            points="{c0.x},{c0.y} {c1.x},{c1.y} {c2.x},{c2.y} {c3.x},{c3.y}"
            fill="none"
            stroke="rgba(100, 200, 255, 0.3)"
            stroke-width="1"
            stroke-dasharray="4,4"
          />
        {/each}
      {/if}

      <!-- Cross-layer snap indicator -->
      {#if activeSnapTarget}
        {@const snapPx = toPixel(activeSnapTarget.point)}
        {#if activeSnapTarget.type === 'corner'}
          <circle cx={snapPx.x} cy={snapPx.y} r="8" fill="none" stroke="#00ff88" stroke-width="2.5" class="snap-indicator" />
          <circle cx={snapPx.x} cy={snapPx.y} r="3" fill="#00ff88" />
        {:else}
          <circle cx={snapPx.x} cy={snapPx.y} r="6" fill="none" stroke="#00ff88" stroke-width="2" class="snap-indicator" />
          <line x1={snapPx.x - 8} y1={snapPx.y} x2={snapPx.x + 8} y2={snapPx.y} stroke="#00ff88" stroke-width="1.5" />
          <line x1={snapPx.x} y1={snapPx.y - 8} x2={snapPx.x} y2={snapPx.y + 8} stroke="#00ff88" stroke-width="1.5" />
        {/if}
      {/if}

      <!-- Line to scale handle -->
      {#if scalePosition}
        <line
          x1={edgePositions.bottom.x}
          y1={edgePositions.bottom.y}
          x2={scalePosition.x}
          y2={scalePosition.y}
          stroke="#00ccff"
          stroke-width="1"
          stroke-dasharray="3,3"
        />
      {/if}
    </svg>

    <!-- Corner handles (hidden in mesh mode to avoid overlap with mesh grid corner handles) -->
    {#if !hideCorners}
      {#each Object.entries(handlePositions) as [corner, pos]}
        <div
          class="handle corner-handle"
          class:dragging={dragging === 'corner' && dragTarget === corner}
          class:selected={selectedCorner === corner && dragging !== 'corner'}
          class:locked={$selectedLayer.locked}
          style="left: {pos.x}px; top: {pos.y}px;"
          onmousedown={(e) => handleCornerMouseDown(corner as keyof WarpCorners, e)}
          ontouchstart={(e) => handleCornerTouchStart(corner as keyof WarpCorners, e)}
          role="button"
          tabindex="0"
          aria-label="Warp corner {corner}"
        >
          <span class="handle-label">{corner.replace(/([A-Z])/g, ' $1').trim()}{selectedCorner === corner ? ' (selected)' : ''}</span>
        </div>
      {/each}
    {/if}

    <!-- Edge handles (bars) -->
    {#each Object.entries(edgePositions) as [edge, pos]}
      <div
        class="handle edge-handle edge-{edge}"
        class:dragging={dragging === 'edge' && dragTarget === edge}
        class:locked={$selectedLayer.locked}
        style="left: {pos.x}px; top: {pos.y}px;"
        onmousedown={(e) => handleEdgeMouseDown(edge as 'top' | 'bottom' | 'left' | 'right', e)}
        role="button"
        tabindex="0"
        aria-label="Move {edge} edge"
      >
      </div>
    {/each}

    <!-- Center move handle — offset above top-left in mesh/shape-warp mode so it doesn't block center handles -->
    {@const offsetMove = (hideCorners || shapeWarpActive) && handlePositions}
    {@const moveX = offsetMove ? handlePositions.topLeft.x - 30 : centerPosition.x}
    {@const moveY = offsetMove ? handlePositions.topLeft.y - 30 : centerPosition.y}
    <div
      class="handle move-handle"
      class:mesh-offset={hideCorners || shapeWarpActive}
      class:dragging={dragging === 'move'}
      class:locked={$selectedLayer.locked}
      style="left: {moveX}px; top: {moveY}px;"
      onmousedown={handleMoveMouseDown}
      ontouchstart={handleMoveTouchStart}
      role="button"
      tabindex="0"
      aria-label="Move layer"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L12 22M2 12L22 12M12 2L8 6M12 2L16 6M12 22L8 18M12 22L16 18M2 12L6 8M2 12L6 16M22 12L18 8M22 12L18 16" />
      </svg>
    </div>

    <!-- Rotation handle -->
    {#if rotatePosition}
      <div
        class="handle rotate-handle"
        class:dragging={dragging === 'rotate'}
        class:locked={$selectedLayer.locked}
        style="left: {rotatePosition.x}px; top: {rotatePosition.y}px;"
        onmousedown={handleRotateMouseDown}
        role="button"
        tabindex="0"
        aria-label="Rotate layer"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </div>
    {/if}

    <!-- Scale handle -->
    {#if scalePosition}
      <div
        class="handle scale-handle"
        class:dragging={dragging === 'scale'}
        class:locked={$selectedLayer.locked}
        style="left: {scalePosition.x}px; top: {scalePosition.y}px;"
        onmousedown={handleScaleMouseDown}
        role="button"
        tabindex="0"
        aria-label="Scale layer"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
        </svg>
      </div>
    {/if}

  {/if}
</div>

<style>
  .warp-handles {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 50;
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

  /* Corner handles (circles) */
  .corner-handle {
    width: 20px;
    height: 20px;
    margin-left: -10px;
    margin-top: -10px;
    background: #BB86FC;
    border: 2px solid #fff;
    border-radius: 50%;
    cursor: grab;
  }

  .corner-handle:hover {
    transform: scale(1.2);
    background: #CF6EFF;
  }

  .corner-handle.dragging {
    cursor: grabbing;
    transform: scale(1.3);
    background: #ffff00;
  }

  .corner-handle.selected {
    background: #00ff88;
    transform: scale(1.2);
    box-shadow: 0 0 10px #00ff88, 0 0 20px rgba(0, 255, 136, 0.5);
  }

  .corner-handle.locked {
    background: #666;
    cursor: not-allowed;
  }

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

  .corner-handle:hover .handle-label {
    opacity: 1;
  }

  /* Edge handles (rectangles) */
  .edge-handle {
    background: #00aaff;
    border: 2px solid #fff;
    border-radius: 3px;
    cursor: move;
  }

  .edge-handle.edge-top,
  .edge-handle.edge-bottom {
    width: 40px;
    height: 12px;
    margin-left: -20px;
    margin-top: -6px;
  }

  .edge-handle.edge-left,
  .edge-handle.edge-right {
    width: 12px;
    height: 40px;
    margin-left: -6px;
    margin-top: -20px;
  }

  .edge-handle:hover {
    background: #00ccff;
    transform: scale(1.1);
  }

  .edge-handle.dragging {
    background: #ffff00;
    transform: scale(1.15);
  }

  .edge-handle.locked {
    background: #666;
    cursor: not-allowed;
  }

  /* Move handle (center, cross icon) */
  .move-handle {
    width: 36px;
    height: 36px;
    margin-left: -18px;
    margin-top: -18px;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #BB86FC;
    border-radius: 50%;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #BB86FC;
  }

  .move-handle.mesh-offset {
    width: 28px;
    height: 28px;
    margin-left: -14px;
    margin-top: -14px;
    opacity: 0.8;
  }

  .move-handle:hover {
    background: rgba(103, 232, 249, 0.2);
    transform: scale(1.1);
    opacity: 1;
  }

  .move-handle.dragging {
    cursor: grabbing;
    background: rgba(255, 255, 0, 0.3);
    border-color: #ffff00;
    color: #ffff00;
    transform: scale(1.15);
  }

  .move-handle.locked {
    border-color: #666;
    color: #666;
    cursor: not-allowed;
  }

  /* Rotation handle */
  .rotate-handle {
    width: 28px;
    height: 28px;
    margin-left: -14px;
    margin-top: -14px;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #ff00aa;
    border-radius: 50%;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ff00aa;
  }

  .rotate-handle:hover {
    background: rgba(255, 0, 170, 0.2);
    transform: scale(1.1);
  }

  .rotate-handle.dragging {
    cursor: grabbing;
    background: rgba(255, 255, 0, 0.3);
    border-color: #ffff00;
    color: #ffff00;
    transform: scale(1.15);
  }

  .rotate-handle.locked {
    border-color: #666;
    color: #666;
    cursor: not-allowed;
  }

  /* Scale handle */
  .scale-handle {
    width: 28px;
    height: 28px;
    margin-left: -14px;
    margin-top: -14px;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #00ccff;
    border-radius: 50%;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #00ccff;
  }

  .scale-handle:hover {
    background: rgba(0, 204, 255, 0.2);
    transform: scale(1.1);
  }

  .scale-handle.dragging {
    cursor: ns-resize;
    background: rgba(255, 255, 0, 0.3);
    border-color: #ffff00;
    color: #ffff00;
    transform: scale(1.15);
  }

  .scale-handle.locked {
    border-color: #666;
    color: #666;
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
