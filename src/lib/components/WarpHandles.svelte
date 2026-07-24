<script lang="ts">
  import { selectedLayer, project, layers, selectedLayerIds } from '../stores/layers';
  import { history } from '../stores/history';
  import { settings } from '../stores/settings';
  import { get } from 'svelte/store';
  import type { WarpCorners, Point2D, Layer } from '../types';
  import { onMount, onDestroy } from 'svelte';
  import { findSnapTarget, getOtherLayerOutlines, type SnapTarget } from '../utils/snapUtils';
  import { normalizedWarpNudge, warpNudgeStepPixels } from '../utils/warpNudge';
  import {
    scaleWarpCornersFromSelectionEdge,
    type SelectionBounds,
    type SelectionEdge,
  } from '../utils/selectionEdgeScale';

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

  // Multi-select: store initial corners for selected layers during batch transforms.
  let batchInitialCorners: Map<string, WarpCorners> = new Map();
  let batchScaleCenter: Point2D | null = null;
  let batchEdgeBounds: SelectionBounds | null = null;

  // Get all selected layers that should be batch-transformed (excluding locked)
  function getBatchLayers(includePrimary = false): Layer[] {
    const ids = get(selectedLayerIds);
    const allLayers = get(layers);
    if (ids.length <= 1) return [];
    return allLayers.filter(l => ids.includes(l.id) && !l.locked && (includePrimary || l.id !== $selectedLayer?.id));
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

  // Apply scale to all batch-selected layers. For the multi-select scale
  // handle we scale around the shared selection center, preserving spacing
  // between layers. Legacy single-layer companion scaling can still pass no
  // center to scale each layer around itself.
  function applyBatchScale(scaleFactor: number, sharedCenter: Point2D | null = null) {
    for (const [layerId, initial] of batchInitialCorners) {
      const cx = sharedCenter?.x ?? (initial.topLeft.x + initial.topRight.x + initial.bottomLeft.x + initial.bottomRight.x) / 4;
      const cy = sharedCenter?.y ?? (initial.topLeft.y + initial.topRight.y + initial.bottomLeft.y + initial.bottomRight.y) / 4;
      project.setCorner(layerId, 'topLeft', { x: cx + (initial.topLeft.x - cx) * scaleFactor, y: cy + (initial.topLeft.y - cy) * scaleFactor });
      project.setCorner(layerId, 'topRight', { x: cx + (initial.topRight.x - cx) * scaleFactor, y: cy + (initial.topRight.y - cy) * scaleFactor });
      project.setCorner(layerId, 'bottomLeft', { x: cx + (initial.bottomLeft.x - cx) * scaleFactor, y: cy + (initial.bottomLeft.y - cy) * scaleFactor });
      project.setCorner(layerId, 'bottomRight', { x: cx + (initial.bottomRight.x - cx) * scaleFactor, y: cy + (initial.bottomRight.y - cy) * scaleFactor });
    }
  }

  function applyBatchEdgeScale(edge: SelectionEdge, deltaX: number, deltaY: number) {
    if (!batchEdgeBounds) return;
    for (const [layerId, initial] of batchInitialCorners) {
      const next = scaleWarpCornersFromSelectionEdge(
        initial,
        batchEdgeBounds,
        edge,
        deltaX,
        deltaY,
      );
      project.setCorner(layerId, 'topLeft', next.topLeft);
      project.setCorner(layerId, 'topRight', next.topRight);
      project.setCorner(layerId, 'bottomLeft', next.bottomLeft);
      project.setCorner(layerId, 'bottomRight', next.bottomRight);
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
  function getCornersBounds(cornerSets: Iterable<WarpCorners>): { minX: number; maxX: number; minY: number; maxY: number } | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of cornerSets) {
      for (const p of [c.topLeft, c.topRight, c.bottomLeft, c.bottomRight]) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
  }

  function captureBatchInitial(includePrimary = false) {
    batchInitialCorners.clear();
    for (const layer of getBatchLayers(includePrimary)) {
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
    const bounds = getCornersBounds(batchInitialCorners.values());
    batchScaleCenter = bounds
      ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
      : null;
  }

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

  // Snap a Point2D to other layers, canvas edges, optionally to grid,
  // AND (new) to the project's pixel grid so projectionists can hit
  // exact target pixels with the mouse. Pixel snap is the lowest-
  // priority step — runs after cross-layer / grid / edge snaps so it
  // refines the already-snapped result without overriding a stronger
  // match.
  function snapPoint(p: Point2D): Point2D {
    let { x, y } = p;

    // Cross-layer snap (highest priority)
    const grid = get(settings).ui.gridSettings;
    const snapToLayersEnabled = grid?.snapToLayers !== false; // default true
    if (snapToLayersEnabled && $selectedLayer) {
      const crossSnap = findSnapTarget({ x, y }, get(layers), $selectedLayer.id);
      if (crossSnap.snapped && crossSnap.target) {
        activeSnapTarget = crossSnap.target;
        return pixelSnap(crossSnap.point);
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
    return pixelSnap({ x, y });
  }

  /** Snap a normalized 0..1 coord to the project's pixel grid, per
   *  the user's `warpDragGranularity` setting. Bypasses cleanly when
   *  the user picks 'free' OR when fine-tune mode is engaged (the
   *  user is actively nudging with arrow keys, where the caller
   *  already passed an exact pixel-aligned target). */
  function pixelSnap(p: Point2D): Point2D {
    const granularity = get(settings).ui.warpDragGranularity ?? '1px';
    if (granularity === 'free') return p;
    const step =
      granularity === 'sub'  ? 0.5 :
      granularity === '5px'  ? 5 :
      granularity === '10px' ? 10 : 1;
    const proj = get(project);
    const pw = Math.max(1, proj.width);
    const ph = Math.max(1, proj.height);
    return {
      x: Math.round(p.x * pw / step) * step / pw,
      y: Math.round(p.y * ph / step) * step / ph,
    };
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

  // Handle keyboard navigation for selected corner. Step size honors
  // the user's `warpDragGranularity` setting so arrow-key nudges
  // move by exactly the same amount as a snapped mouse drag — 1
  // project pixel by default. Shift gives 10x larger steps for
  // gross positioning.
  function handleKeyDown(e: KeyboardEvent) {
    if (!$selectedLayer) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    const active = document.activeElement as HTMLElement | null;
    const activeTag = active?.tagName;
    if (
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' ||
      active?.isContentEditable
    ) return;

    // Resolve project-pixel step from settings.
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
        selectedCorner = null;
        fineTuneCorner = null;
        return;
      default:
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (selectedCorner) {
      if ($selectedLayer.locked) return;
      const currentPos = $selectedLayer.corners[selectedCorner];
      project.setCorner($selectedLayer.id, selectedCorner, {
        x: currentPos.x + dx,
        y: currentPos.y + dy,
      });
      history.record(get(project));
      return;
    }

    const ids = get(selectedLayerIds);
    const selectedIds = ids.length ? ids : [$selectedLayer.id];
    const allLayers = get(layers);
    const movable = allLayers.filter(l => selectedIds.includes(l.id) && !l.locked);
    for (const layer of movable) {
      project.setCorner(layer.id, 'topLeft', { x: layer.corners.topLeft.x + dx, y: layer.corners.topLeft.y + dy });
      project.setCorner(layer.id, 'topRight', { x: layer.corners.topRight.x + dx, y: layer.corners.topRight.y + dy });
      project.setCorner(layer.id, 'bottomLeft', { x: layer.corners.bottomLeft.x + dx, y: layer.corners.bottomLeft.y + dy });
      project.setCorner(layer.id, 'bottomRight', { x: layer.corners.bottomRight.x + dx, y: layer.corners.bottomRight.y + dy });
    }
    if (movable.length > 0) history.record(get(project));
  }

  // Set up keyboard event listener
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('ghost-clear-warp-corner-selection', clearCornerSelection);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('ghost-clear-warp-corner-selection', clearCornerSelection);
  });

  function clearCornerSelection() {
    selectedCorner = null;
    fineTuneCorner = null;
  }

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
    initialCorners = $selectedLayer ? structuredClone($selectedLayer.corners) : null;
    captureBatchInitial(true);
    batchEdgeBounds = batchInitialCorners.size > 1
      ? getCornersBounds(batchInitialCorners.values())
      : null;

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
    captureBatchInitial(true);

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
      if (batchEdgeBounds && batchInitialCorners.size > 1) {
        applyBatchEdgeScale(edge, dx, dy);
        return;
      }
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
      if (batchInitialCorners.size > 1 && batchScaleCenter) {
        applyBatchScale(scaleFactor, batchScaleCenter);
        return;
      }
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
    batchScaleCenter = null;
    batchEdgeBounds = null;
    activeSnapTarget = null;
    batchInitialCorners.clear();
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  // Touch events
  /** Per-corner timestamp of the previous tap. Used to detect a
   *  double-tap that enters fine-tune mode. 350ms is the threshold —
   *  longer than the typical iOS double-tap (~250ms) so users on
   *  slower devices still register. */
  const lastTapAt = new Map<keyof WarpCorners, number>();
  const DOUBLE_TAP_MS = 350;

  /** When set, the on-canvas arrow nudgers are visible and key-press
   *  / button-tap events move this corner by 1 project pixel. The
   *  pad only renders on touch-primary devices (mobile / tablet) —
   *  desktop users have keyboard arrow keys for the same job, so
   *  showing the pad there is just chrome. */
  let fineTuneCorner: keyof WarpCorners | null = null;
  const isTouchPrimary = typeof window !== 'undefined' &&
    (('ontouchstart' in window) || (navigator.maxTouchPoints ?? 0) > 0) &&
    // Heuristic: phones / tablets report coarse pointer; laptops with
    // touchscreens report fine. Suppresses the pad on Surface devices
    // / touchscreen monitors where the user has a mouse + keyboard.
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  function handleCornerTouchStart(corner: keyof WarpCorners, e: TouchEvent) {
    if ($selectedLayer?.locked) return;
    e.preventDefault();
    // Detect double-tap on the same corner → enter fine-tune mode.
    // Don't start a drag in that case; the user wants the nudgers.
    const now = performance.now();
    const prev = lastTapAt.get(corner) ?? 0;
    if (now - prev < DOUBLE_TAP_MS) {
      fineTuneCorner = corner;
      selectedCorner = corner;
      lastTapAt.delete(corner);
      return;
    }
    lastTapAt.set(corner, now);
    dragging = 'corner';
    dragTarget = corner;
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }

  /** Move the fine-tune corner by exactly one project-pixel step in
   *  the given direction. Honors warpDragGranularity so a user who
   *  sets the snap to 5px gets 5px nudges from the arrows too. */
  function nudgeFineTune(dxPx: number, dyPx: number) {
    if (!fineTuneCorner || !$selectedLayer || $selectedLayer.locked) return;
    const step = warpNudgeStepPixels(get(settings).ui.warpDragGranularity);
    const proj = get(project);
    const pw = Math.max(1, proj.width);
    const ph = Math.max(1, proj.height);
    const cur = $selectedLayer.corners[fineTuneCorner];
    // Warp Y goes UP (1=top); arrow "up" should decrease canvas Y
    // pixel coordinate which means INCREASE the corner Y. Sign flip.
    const next = {
      x: cur.x + (dxPx * step) / pw,
      y: cur.y - (dyPx * step) / ph,
    };
    project.setCorner($selectedLayer.id, fineTuneCorner, next);
  }

  function exitFineTune() { fineTuneCorner = null; }

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
    batchScaleCenter = null;
    batchEdgeBounds = null;
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

  $: selectedTransformLayers = (() => {
    const ids = $selectedLayerIds;
    if (!ids || ids.length <= 1) return [];
    return $layers.filter(l => ids.includes(l.id) && !l.locked && l.corners);
  })();
  $: selectionBounds = selectedTransformLayers.length > 1
    ? getCornersBounds(selectedTransformLayers.map(l => l.corners))
    : null;
  $: selectionBoundsPx = selectionBounds
    ? {
        left: selectionBounds.minX * containerWidth,
        right: selectionBounds.maxX * containerWidth,
        top: (1 - selectionBounds.maxY) * containerHeight,
        bottom: (1 - selectionBounds.minY) * containerHeight,
      }
    : null;
  $: selectionEdgePositions = selectionBoundsPx
    ? {
        top: {
          x: (selectionBoundsPx.left + selectionBoundsPx.right) / 2,
          y: selectionBoundsPx.top,
        },
        bottom: {
          x: (selectionBoundsPx.left + selectionBoundsPx.right) / 2,
          y: selectionBoundsPx.bottom,
        },
        left: {
          x: selectionBoundsPx.left,
          y: (selectionBoundsPx.top + selectionBoundsPx.bottom) / 2,
        },
        right: {
          x: selectionBoundsPx.right,
          y: (selectionBoundsPx.top + selectionBoundsPx.bottom) / 2,
        },
      }
    : null;
  $: visibleEdgePositions = selectionEdgePositions ?? edgePositions;
  $: groupScalePosition = selectionBoundsPx
    ? { x: selectionBoundsPx.right + 26, y: selectionBoundsPx.bottom + 26 }
    : null;
  $: visibleScalePosition = groupScalePosition ?? scalePosition;

  // Draw the dashed bounding rectangle connecting the four corner
  // warp handles. We HIDE this rectangle whenever the layer has a
  // non-rectangular shape mask enabled — the user's complaint was
  // that custom/polygon/circle/etc. shapes were visually surrounded
  // by a misleading "rectangle outline" even though the content is
  // clipped to the shape. The corner handles themselves still
  // render (they're the warp inputs), just the connecting rectangle
  // is suppressed so the shape's own outline is the only visible
  // boundary.
  $: shapeHidesBoundingRect = !!(
    $selectedLayer?.layerShape?.enabled &&
    $selectedLayer.layerShape.type &&
    $selectedLayer.layerShape.type !== 'rectangle'
  );
  // Suppress the bbox corner + edge handles when the layer's shape is
  // not a rectangle — non-rect shapes get their polygon-vertex
  // handles from CustomShapeHandles (custom) or LayerShape's shape-
  // warp controls (circle/triangle), and showing the bbox handles on
  // top creates two competing edit systems the user has to choose
  // between. Move/Rotate/Scale stay visible so users can still
  // reposition the whole layer as a unit.
  $: nonRectShape = shapeHidesBoundingRect;
  $: lines = (handlePositions && !shapeHidesBoundingRect)
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
      {#if selectionBoundsPx}
        <rect
          x={selectionBoundsPx.left}
          y={selectionBoundsPx.top}
          width={selectionBoundsPx.right - selectionBoundsPx.left}
          height={selectionBoundsPx.bottom - selectionBoundsPx.top}
          fill="rgba(255, 111, 94, 0.04)"
          stroke="#ff6f5e"
          stroke-width="2"
          stroke-dasharray="7,4"
        />
      {/if}
      {#if visibleScalePosition}
        <line
          x1={selectionBoundsPx ? selectionBoundsPx.right : edgePositions.bottom.x}
          y1={selectionBoundsPx ? selectionBoundsPx.bottom : edgePositions.bottom.y}
          x2={visibleScalePosition.x}
          y2={visibleScalePosition.y}
          stroke="#00ccff"
          stroke-width="1"
          stroke-dasharray="3,3"
        />
      {/if}
    </svg>

    <!-- Corner handles — hidden in mesh mode (overlap with mesh-grid
         corner handles) AND when the layer carries a non-rectangle
         shape (the polygon's own vertex handles in CustomShapeHandles
         become the primary warps). -->
    {#if !hideCorners && !nonRectShape}
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

    <!-- Edge handles (bars) — also suppressed for non-rect shapes
         (same reasoning as the corner handles above). -->
    {#each (nonRectShape || !visibleEdgePositions ? [] : Object.entries(visibleEdgePositions)) as [edge, pos]}
      <div
        class="handle edge-handle edge-{edge}"
        class:dragging={dragging === 'edge' && dragTarget === edge}
        class:locked={$selectedLayer.locked}
        style="left: {pos.x}px; top: {pos.y}px;"
        onmousedown={(e) => handleEdgeMouseDown(edge as 'top' | 'bottom' | 'left' | 'right', e)}
        role="button"
        tabindex="0"
        aria-label={selectionBoundsPx ? `Stretch selected layers from ${edge} edge` : `Move ${edge} edge`}
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
    {#if visibleScalePosition}
      <div
        class="handle scale-handle"
        class:group-scale={!!selectionBoundsPx}
        class:dragging={dragging === 'scale'}
        class:locked={$selectedLayer.locked}
        style="left: {visibleScalePosition.x}px; top: {visibleScalePosition.y}px;"
        onmousedown={handleScaleMouseDown}
        role="button"
        tabindex="0"
        aria-label={selectionBoundsPx ? 'Scale selected layers' : 'Scale layer'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
        </svg>
      </div>
    {/if}

    <!-- Fine-tune nudger pad — appears after a double-tap on a
         corner handle (mobile / touch primary, also clickable on
         desktop). Each arrow tap moves the selected corner by one
         project-pixel step. The pad floats just below-right of the
         center handle so it doesn't cover the corners being adjusted.
         Tap × to dismiss. -->
    {#if fineTuneCorner && centerPosition && isTouchPrimary}
      <div
        class="fine-tune-pad"
        style="left: {centerPosition.x + 60}px; top: {centerPosition.y - 60}px;"
        onmousedown={(e) => e.stopPropagation()}
        ontouchstart={(e) => e.stopPropagation()}
        role="group"
        aria-label="Fine-tune {fineTuneCorner}"
      >
        <div class="ft-label">{fineTuneCorner.replace(/([A-Z])/g, ' $1').trim()}</div>
        <button class="ft-btn ft-up"    onclick={() => nudgeFineTune(0, 1)}  aria-label="Up">▲</button>
        <button class="ft-btn ft-left"  onclick={() => nudgeFineTune(-1, 0)} aria-label="Left">◀</button>
        <button class="ft-btn ft-exit"  onclick={exitFineTune}                aria-label="Exit fine-tune">×</button>
        <button class="ft-btn ft-right" onclick={() => nudgeFineTune(1, 0)}  aria-label="Right">▶</button>
        <button class="ft-btn ft-down"  onclick={() => nudgeFineTune(0, -1)} aria-label="Down">▼</button>
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
    font-size: 11px;
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

  /* ── Fine-tune nudger pad ── */
  /* 3x3 grid of arrow buttons (up / left / × / right / down with the
     diagonals empty) that floats over the canvas when fine-tune mode
     is active. Each tap moves the selected corner by exactly one
     project-pixel step. Sized for touch (44px hit targets per Apple's
     guidelines) but works fine with mouse too. */
  .fine-tune-pad {
    position: absolute;
    display: grid;
    grid-template-columns: 44px 44px 44px;
    grid-template-rows: auto 44px 44px 44px;
    gap: 4px;
    padding: 8px;
    background: rgba(10, 10, 14, 0.92);
    border: 1px solid #4cd1ff;
    border-radius: 8px;
    box-shadow: 0 4px 24px rgba(76, 209, 255, 0.25);
    z-index: 30;
    backdrop-filter: blur(8px);
  }
  .ft-label {
    grid-column: 1 / -1;
    grid-row: 1;
    text-align: center;
    font-size: 11px;
    letter-spacing: 1px;
    color: #4cd1ff;
    text-transform: uppercase;
    font-weight: 600;
  }
  .ft-btn {
    width: 44px;
    height: 44px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    border-radius: 6px;
    color: var(--text-primary, #ddd);
    font-size: 15px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation;  /* suppress 300ms tap delay on iOS */
  }
  .ft-btn:hover, .ft-btn:active {
    background: rgba(76, 209, 255, 0.18);
    border-color: #4cd1ff;
    color: #fff;
  }
  .ft-up    { grid-column: 2; grid-row: 2; }
  .ft-left  { grid-column: 1; grid-row: 3; }
  .ft-exit  { grid-column: 2; grid-row: 3; color: #ff8888; border-color: #3a2a2a; }
  .ft-exit:hover { background: rgba(255, 68, 68, 0.15); border-color: #ff8888; }
  .ft-right { grid-column: 3; grid-row: 3; }
  .ft-down  { grid-column: 2; grid-row: 4; }
</style>
