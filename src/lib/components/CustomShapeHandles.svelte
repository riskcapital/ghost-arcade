<script lang="ts">
  import { selectedLayer, project } from '../stores/layers';
  import type { Point2D, BezierPoint } from '../types';
  import { onDestroy } from 'svelte';
  import { t } from '../i18n';

  // Container dimensions (set by parent)
  export let containerWidth: number = 800;
  export let containerHeight: number = 600;
  export let zoom: number = 1;

  type DragTarget = 'vertex' | 'cpIn' | 'cpOut' | null;
  type PenMode = 'edit' | 'add' | 'remove';

  let dragging: DragTarget = null;
  let dragVertexIndex: number = -1;
  let mousePos: { x: number; y: number } = { x: 0, y: 0 };
  let hoverEdgeIndex: number = -1;
  let selectedVertexIndex: number = -1;
  let penMode: PenMode = 'edit';

  const EDGE_HIT_THRESHOLD = 10; // pixels
  const DRAG_BEND_THRESHOLD = 4; // pixels — drag farther than this to convert click into a curve

  // Pen-tool drag state for click-and-drag-to-bend (Illustrator style).
  // Tracks an in-progress "add point" gesture. Point isn't added to the
  // store until mouseup so we know whether to add it as a sharp corner
  // (no drag) or as a smooth bezier point with handles (significant drag).
  type PenDraft = {
    /** Anchor position in normalized UV space — fixed at mousedown. */
    anchor: Point2D;
    /** Current pixel position while dragging. */
    dragPx: { x: number; y: number };
    /** True once drag distance exceeds DRAG_BEND_THRESHOLD. */
    isCurve: boolean;
    /** When true: we're inserting on an existing edge (add mode); else appending in draw mode. */
    insertOnEdge: boolean;
    /** For insertOnEdge: which edge index. */
    edgeIndex: number;
  } | null;
  let penDraft: PenDraft = null;

  // Layer corners for bilinear warp
  $: corners = $selectedLayer?.corners ?? {
    topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 },
    bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 0 },
  };

  // Forward bilinear: UV (0-1) → warped normalized position → pixel
  function toPixel(point: Point2D): { x: number; y: number } {
    const { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br } = corners;
    const u = point.x, v = point.y;
    const topX = tl.x + (tr.x - tl.x) * u;
    const topY = tl.y + (tr.y - tl.y) * u;
    const botX = bl.x + (br.x - bl.x) * u;
    const botY = bl.y + (br.y - bl.y) * u;
    const wx = botX + (topX - botX) * v;
    const wy = botY + (topY - botY) * v;
    return { x: wx * containerWidth, y: (1 - wy) * containerHeight };
  }

  // Inverse bilinear: pixel → UV (0-1) via Newton-Raphson iteration
  function toNormalized(px: number, py: number): Point2D {
    const { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br } = corners;
    const tx = px / containerWidth;
    const ty = 1 - py / containerHeight;
    let u = 0.5, v = 0.5;
    for (let i = 0; i < 8; i++) {
      const topX = tl.x + (tr.x - tl.x) * u;
      const topY = tl.y + (tr.y - tl.y) * u;
      const botX = bl.x + (br.x - bl.x) * u;
      const botY = bl.y + (br.y - bl.y) * u;
      const px2 = botX + (topX - botX) * v;
      const py2 = botY + (topY - botY) * v;
      const ex = tx - px2, ey = ty - py2;
      const dTopU = tr.x - tl.x, dTopUy = tr.y - tl.y;
      const dBotU = br.x - bl.x, dBotUy = br.y - bl.y;
      const dxdu = dBotU + (dTopU - dBotU) * v;
      const dydu = dBotUy + (dTopUy - dBotUy) * v;
      const dxdv = topX - botX;
      const dydv = topY - botY;
      const det = dxdu * dydv - dydu * dxdv;
      if (Math.abs(det) < 1e-8) break;
      u += (ex * dydv - ey * dxdv) / det;
      v += (dxdu * ey - dydu * ex) / det;
    }
    return { x: u, y: v };
  }

  // Distance from point to line segment
  function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
  ): { dist: number; t: number } {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const projX = a.x + t * dx, projY = a.y + t * dy;
    return { dist: Math.hypot(p.x - projX, p.y - projY), t };
  }

  // Cubic bezier point at t
  function cubicBezier(p0: {x:number; y:number}, cp1: {x:number; y:number}, cp2: {x:number; y:number}, p3: {x:number; y:number}, t: number,
  ): {x:number; y:number} {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: mt2 * mt * p0.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t2 * t * p3.x,
      y: mt2 * mt * p0.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t2 * t * p3.y,
    };
  }

  // Min distance from point to a bezier/line segment (sampled)
  function distToBezierSegment(mouse: {x:number; y:number}, i: number): { dist: number; t: number } {
    const nextI = (i + 1) % customPoints.length;
    const a = customPoints[i];
    const b = customPoints[nextI];
    const aPx = vertexPixels[i];
    const bPx = vertexPixels[nextI];
    const hasCurve = a.cpOut || b.cpIn;
    if (!hasCurve) {
      return distToSegment(mouse, aPx, bPx);
    }
    // Sample bezier curve
    const cp1 = a.cpOut ? toPixel(a.cpOut) : aPx;
    const cp2 = b.cpIn ? toPixel(b.cpIn) : bPx;
    let minDist = Infinity;
    let bestT = 0;
    const steps = 20;
    for (let s = 0; s <= steps; s++) {
      const st = s / steps;
      const pt = cubicBezier(aPx, cp1, cp2, bPx, st);
      const d = Math.hypot(mouse.x - pt.x, mouse.y - pt.y);
      if (d < minDist) { minDist = d; bestT = st; }
    }
    return { dist: minDist, t: bestT };
  }

  // Get centroid of polygon
  function getCentroid(points: Point2D[]): Point2D {
    if (points.length === 0) return { x: 0.5, y: 0.5 };
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  $: layerShape = $selectedLayer?.layerShape;
  $: isCustom = layerShape?.type === 'custom';
  $: customPoints = ((isCustom ? layerShape?.params.customPoints : []) ?? []) as BezierPoint[];
  $: isClosed = isCustom && (layerShape?.params.customClosed ?? false);

  // Pixel positions of vertices
  $: vertexPixels = customPoints.map(toPixel);

  // Build SVG path for bezier curves
  $: svgPath = (() => {
    if (customPoints.length < 2) return '';
    let d = '';
    const first = vertexPixels[0];
    d += `M ${first.x},${first.y}`;
    const count = isClosed ? customPoints.length : customPoints.length - 1;
    for (let i = 0; i < count; i++) {
      const nextI = (i + 1) % customPoints.length;
      const a = customPoints[i];
      const b = customPoints[nextI];
      const bPx = vertexPixels[nextI];
      const hasCurve = a.cpOut || b.cpIn;
      if (hasCurve) {
        const cp1 = a.cpOut ? toPixel(a.cpOut) : vertexPixels[i];
        const cp2 = b.cpIn ? toPixel(b.cpIn) : bPx;
        d += ` C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${bPx.x},${bPx.y}`;
      } else {
        d += ` L ${bPx.x},${bPx.y}`;
      }
    }
    if (isClosed) d += ' Z';
    return d;
  })();

  // Pen-tool mousedown on the canvas.
  //
  // Illustrator-style behavior — defer point creation until mouseup so we can
  // tell a click (sharp corner) from a click-drag (smooth point with handles
  // in the drag direction). Anchor is fixed at mousedown; cpOut tracks the
  // mouse during drag, cpIn is mirrored.
  function handleCanvasMouseDown(e: MouseEvent) {
    if (!$selectedLayer || $selectedLayer.locked || !isCustom) return;
    if (e.button !== 0) return;
    // Don't intercept clicks that originate on a vertex / control-handle.
    const target = e.target as Element;
    if (target.closest('.vertex-dot, .cp-dot')) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = (e.clientX - rect.left) / zoom;
    const py = (e.clientY - rect.top) / zoom;
    const norm = toNormalized(px, py);

    if (!isClosed) {
      // Drawing: anchor the future point at the mousedown location.
      penDraft = {
        anchor: norm,
        dragPx: { x: px, y: py },
        isCurve: false,
        insertOnEdge: false,
        edgeIndex: -1,
      };
      window.addEventListener('mousemove', handlePenDraftMove);
      window.addEventListener('mouseup', handlePenDraftUp);
    } else if (penMode === 'add' && hoverEdgeIndex >= 0 && customPoints.length >= 3) {
      // Add mode: same gesture, but the anchor is computed from the hovered edge.
      const nextIdx = (hoverEdgeIndex + 1) % customPoints.length;
      const a = customPoints[hoverEdgeIndex];
      const b = customPoints[nextIdx];
      const hasCurve = a.cpOut || b.cpIn;
      let anchor: Point2D;
      if (hasCurve) {
        const { t } = distToBezierSegment({ x: px, y: py }, hoverEdgeIndex);
        const aPx = vertexPixels[hoverEdgeIndex];
        const bPx = vertexPixels[nextIdx];
        const cp1 = a.cpOut ? toPixel(a.cpOut) : aPx;
        const cp2 = b.cpIn ? toPixel(b.cpIn) : bPx;
        const ptPx = cubicBezier(aPx, cp1, cp2, bPx, t);
        anchor = toNormalized(ptPx.x, ptPx.y);
      } else {
        const { t } = distToSegment({ x: px, y: py }, vertexPixels[hoverEdgeIndex], vertexPixels[nextIdx]);
        anchor = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      }
      penDraft = {
        anchor,
        dragPx: { x: px, y: py },
        isCurve: false,
        insertOnEdge: true,
        edgeIndex: hoverEdgeIndex,
      };
      window.addEventListener('mousemove', handlePenDraftMove);
      window.addEventListener('mouseup', handlePenDraftUp);
    } else if (penMode === 'edit') {
      // Edit mode click on empty canvas: deselect
      selectedVertexIndex = -1;
    }
  }

  function handlePenDraftMove(e: MouseEvent) {
    if (!penDraft) return;
    const container = document.querySelector('.custom-shape-handles') as HTMLElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const px = (e.clientX - rect.left) / zoom;
    const py = (e.clientY - rect.top) / zoom;
    penDraft.dragPx = { x: px, y: py };
    const anchorPx = toPixel(penDraft.anchor);
    const distPx = Math.hypot(px - anchorPx.x, py - anchorPx.y);
    penDraft.isCurve = distPx > DRAG_BEND_THRESHOLD;
    penDraft = penDraft; // trigger reactivity for the preview overlay
  }

  function handlePenDraftUp(e: MouseEvent) {
    window.removeEventListener('mousemove', handlePenDraftMove);
    window.removeEventListener('mouseup', handlePenDraftUp);
    if (!penDraft || !$selectedLayer) {
      penDraft = null;
      return;
    }

    const draft = penDraft;
    penDraft = null;

    const layerId = $selectedLayer.id;

    if (draft.insertOnEdge) {
      project.insertCustomShapePoint(layerId, draft.edgeIndex, draft.anchor);
      if (draft.isCurve) {
        const newIdx = draft.edgeIndex + 1;
        const cpOutNorm = toNormalized(draft.dragPx.x, draft.dragPx.y);
        const cpInNorm: Point2D = {
          x: 2 * draft.anchor.x - cpOutNorm.x,
          y: 2 * draft.anchor.y - cpOutNorm.y,
        };
        project.updateCustomShapeHandle(layerId, newIdx, 'cpOut', cpOutNorm);
        project.updateCustomShapeHandle(layerId, newIdx, 'cpIn', cpInNorm);
      }
    } else {
      project.addCustomShapePoint(layerId, draft.anchor);
      if (draft.isCurve) {
        const newIdx = customPoints.length; // index of just-added point (before any further updates)
        const cpOutNorm = toNormalized(draft.dragPx.x, draft.dragPx.y);
        const cpInNorm: Point2D = {
          x: 2 * draft.anchor.x - cpOutNorm.x,
          y: 2 * draft.anchor.y - cpOutNorm.y,
        };
        project.updateCustomShapeHandle(layerId, newIdx, 'cpOut', cpOutNorm);
        project.updateCustomShapeHandle(layerId, newIdx, 'cpIn', cpInNorm);
      }
    }
  }

  // Handle right-click: close shape in draw mode
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!$selectedLayer || $selectedLayer.locked || !isCustom) return;

    if (!isClosed) {
      if (customPoints.length >= 3) {
        project.closeCustomShape($selectedLayer.id);
      }
    }
  }

  // Vertex mousedown: select + drag, or remove in pen mode.
  //
  // Special case for draw mode: clicking the FIRST vertex when at least 3
  // points exist closes the shape — matching the mask UX. Without this
  // path users have to right-click to close, which is non-obvious when
  // the green first-vertex marker visibly highlights the close target.
  function handleVertexMouseDown(index: number, e: MouseEvent) {
    if (!$selectedLayer || $selectedLayer.locked || !isCustom) return;

    if (!isClosed) {
      if (index === 0 && customPoints.length >= 3) {
        e.preventDefault();
        e.stopPropagation();
        project.closeCustomShape($selectedLayer.id);
      }
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (penMode === 'remove') {
      // Remove mode: click to delete point
      if (customPoints.length > 3) {
        if (selectedVertexIndex === index) {
          selectedVertexIndex = index > 0 ? index - 1 : customPoints.length - 2;
        } else if (selectedVertexIndex > index) {
          selectedVertexIndex--;
        }
        project.removeCustomShapePoint($selectedLayer.id, index);
      }
      return;
    }

    selectedVertexIndex = index;
    dragging = 'vertex';
    dragVertexIndex = index;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  // Control handle mousedown
  function handleCPMouseDown(index: number, handleType: 'cpIn' | 'cpOut', e: MouseEvent) {
    if (!$selectedLayer || $selectedLayer.locked || !isCustom || !isClosed) return;
    e.preventDefault();
    e.stopPropagation();
    selectedVertexIndex = index;
    dragging = handleType;
    dragVertexIndex = index;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!dragging || !$selectedLayer || dragVertexIndex < 0) return;

    const container = document.querySelector('.custom-shape-handles') as HTMLElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const px = (e.clientX - rect.left) / zoom;
    const py = (e.clientY - rect.top) / zoom;
    const norm = toNormalized(px, py);

    if (dragging === 'vertex') {
      // Move vertex + its handles together
      const pt = customPoints[dragVertexIndex];
      const dx = norm.x - pt.x;
      const dy = norm.y - pt.y;
      const updated: BezierPoint = { ...pt, x: norm.x, y: norm.y };
      if (pt.cpIn) updated.cpIn = { x: pt.cpIn.x + dx, y: pt.cpIn.y + dy };
      if (pt.cpOut) updated.cpOut = { x: pt.cpOut.x + dx, y: pt.cpOut.y + dy };
      project.updateCustomShapePoint($selectedLayer.id, dragVertexIndex, updated);
    } else if (dragging === 'cpIn' || dragging === 'cpOut') {
      project.updateCustomShapeHandle($selectedLayer.id, dragVertexIndex, dragging, norm);
      // Mirror the other handle (symmetric) unless Alt is held
      if (!e.altKey) {
        const pt = customPoints[dragVertexIndex];
        const mirrorType = dragging === 'cpIn' ? 'cpOut' : 'cpIn';
        const mirror: Point2D = {
          x: 2 * pt.x - norm.x,
          y: 2 * pt.y - norm.y,
        };
        project.updateCustomShapeHandle($selectedLayer.id, dragVertexIndex, mirrorType, mirror);
      }
    }
  }

  function handleMouseUp() {
    if (dragging) {
      dragging = null;
      dragVertexIndex = -1;
    }
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  // Track mouse for preview line + edge hover
  function handleOverlayMouseMove(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = (e.clientX - rect.left) / zoom;
    const py = (e.clientY - rect.top) / zoom;
    mousePos = { x: px, y: py };

    // Detect edge hover for add mode
    if (isClosed && customPoints.length >= 3 && penMode === 'add') {
      let closestEdge = -1;
      let closestDist = Infinity;
      for (let i = 0; i < customPoints.length; i++) {
        const { dist } = distToBezierSegment({ x: px, y: py }, i);
        if (dist < closestDist) {
          closestDist = dist;
          closestEdge = i;
        }
      }
      hoverEdgeIndex = closestDist < EDGE_HIT_THRESHOLD ? closestEdge : -1;
    } else {
      hoverEdgeIndex = -1;
    }
  }

  // Double-click on vertex: toggle corner/curve
  function handleVertexDblClick(index: number, e: MouseEvent) {
    if (!$selectedLayer || $selectedLayer.locked || !isCustom || !isClosed) return;
    e.preventDefault();
    e.stopPropagation();
    project.toggleCustomShapePointCurve($selectedLayer.id, index);
  }

  // Clear selection when layer changes
  $: if ($selectedLayer?.id) {
    selectedVertexIndex = -1;
    penMode = 'edit';
  }

  // Cleanup on destroy
  onDestroy(() => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  });

  // Hover insert point for add mode
  $: hoverInsertPoint = (() => {
    if (hoverEdgeIndex < 0 || !isClosed || customPoints.length < 3 || penMode !== 'add') return null;
    const i = hoverEdgeIndex;
    const nextI = (i + 1) % customPoints.length;
    const a = customPoints[i];
    const b = customPoints[nextI];
    const hasCurve = a.cpOut || b.cpIn;
    if (hasCurve) {
      const { t } = distToBezierSegment(mousePos, i);
      const aPx = vertexPixels[i];
      const bPx = vertexPixels[nextI];
      const cp1 = a.cpOut ? toPixel(a.cpOut) : aPx;
      const cp2 = b.cpIn ? toPixel(b.cpIn) : bPx;
      return cubicBezier(aPx, cp1, cp2, bPx, t);
    } else {
      const { t } = distToSegment(mousePos, vertexPixels[i], vertexPixels[nextI]);
      const aPx = vertexPixels[i];
      const bPx = vertexPixels[nextI];
      return { x: aPx.x + t * (bPx.x - aPx.x), y: aPx.y + t * (bPx.y - aPx.y) };
    }
  })();
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="custom-shape-handles"
  class:draw-mode={isCustom && !isClosed}
  class:remove-mode={isClosed && penMode === 'remove'}
  class:add-mode={isClosed && penMode === 'add'}
  style="width: {containerWidth}px; height: {containerHeight}px;"
  on:mousemove={handleOverlayMouseMove}
  on:mousedown={handleCanvasMouseDown}
  on:contextmenu={handleContextMenu}
>
  {#if $selectedLayer && isCustom}
    <svg class="shape-overlay" width={containerWidth} height={containerHeight}>
      {#if customPoints.length >= 2}
        <path d={svgPath} fill="none" stroke={isClosed ? '#ff9800' : '#ffffff'} stroke-width="2" />
      {/if}

      <!-- Pen-tool drag preview: while dragging from a fresh anchor, show
           where the new point + handles will land AND draw the bezier curve
           segment from the previous vertex through the in-progress handles. -->
      {#if penDraft}
        {@const anchorPx = toPixel(penDraft.anchor)}
        {@const cpOutPx = penDraft.dragPx}
        {@const cpInPx = { x: 2 * anchorPx.x - cpOutPx.x, y: 2 * anchorPx.y - cpOutPx.y }}
        {@const prevPx = penDraft.insertOnEdge
          ? vertexPixels[penDraft.edgeIndex]
          : customPoints.length > 0
            ? vertexPixels[customPoints.length - 1]
            : null}
        {@const prevPt = penDraft.insertOnEdge
          ? customPoints[penDraft.edgeIndex]
          : customPoints.length > 0
            ? customPoints[customPoints.length - 1]
            : null}
        {@const prevCpOutPx = prevPt && prevPt.cpOut ? toPixel(prevPt.cpOut) : prevPx}

        <!-- Live bezier curve from the previous vertex to the in-progress anchor -->
        {#if prevPx && prevCpOutPx}
          <path
            d={`M ${prevPx.x},${prevPx.y} C ${prevCpOutPx.x},${prevCpOutPx.y} ${cpInPx.x},${cpInPx.y} ${anchorPx.x},${anchorPx.y}`}
            fill="none"
            stroke="#ff9800"
            stroke-width="2"
            stroke-dasharray={penDraft.isCurve ? 'none' : '4,4'}
            opacity="0.95"
          />
        {/if}

        {#if penDraft.isCurve}
          <!-- Handle bar: cpIn — anchor — cpOut -->
          <line
            x1={cpInPx.x}
            y1={cpInPx.y}
            x2={cpOutPx.x}
            y2={cpOutPx.y}
            stroke="#7EC8E3"
            stroke-width="1"
            opacity="0.85"
          />
          <circle cx={cpInPx.x} cy={cpInPx.y} r="4" fill="#7EC8E3" opacity="0.9" />
          <circle cx={cpOutPx.x} cy={cpOutPx.y} r="4" fill="#7EC8E3" opacity="0.9" />
        {/if}

        <!-- Anchor dot, on top of everything else -->
        <circle cx={anchorPx.x} cy={anchorPx.y} r="6" fill="#ff9800" stroke="#ffffff" stroke-width="2" />
      {/if}

      <!-- Preview line from last vertex to mouse (draw mode only) -->
      {#if !isClosed && customPoints.length > 0 && !penDraft}
        {@const lastPx = vertexPixels[customPoints.length - 1]}
        <line
          x1={lastPx.x}
          y1={lastPx.y}
          x2={mousePos.x}
          y2={mousePos.y}
          stroke="#ffffff"
          stroke-width="1"
          stroke-dasharray="5,5"
          opacity="0.6"
        />
        {#if customPoints.length >= 3}
          {@const firstPx = vertexPixels[0]}
          <line
            x1={firstPx.x}
            y1={firstPx.y}
            x2={mousePos.x}
            y2={mousePos.y}
            stroke="#ff9800"
            stroke-width="1"
            stroke-dasharray="3,3"
            opacity="0.4"
          />
        {/if}
      {/if}

      <!-- Bezier control handle lines and dots (only in edit mode when closed) -->
      {#if isClosed && penMode === 'edit'}
        {#each customPoints as pt, i}
          {#if pt.cpOut}
            {@const anchorPx = vertexPixels[i]}
            {@const cpOutPx = toPixel(pt.cpOut)}
            <line
              x1={anchorPx.x}
              y1={anchorPx.y}
              x2={cpOutPx.x}
              y2={cpOutPx.y}
              stroke="#00bfff"
              stroke-width="1"
              opacity="0.7"
            />
          {/if}
          {#if pt.cpIn}
            {@const anchorPx = vertexPixels[i]}
            {@const cpInPx = toPixel(pt.cpIn)}
            <line
              x1={anchorPx.x}
              y1={anchorPx.y}
              x2={cpInPx.x}
              y2={cpInPx.y}
              stroke="#00bfff"
              stroke-width="1"
              opacity="0.7"
            />
          {/if}
        {/each}
      {/if}

      <!-- Hover edge insert indicator (add mode) -->
      {#if hoverInsertPoint && isClosed && penMode === 'add'}
        <circle cx={hoverInsertPoint.x} cy={hoverInsertPoint.y} r="5" fill="none" stroke="#00ff88" stroke-width="2" />
        <line
          x1={hoverInsertPoint.x - 4}
          y1={hoverInsertPoint.y}
          x2={hoverInsertPoint.x + 4}
          y2={hoverInsertPoint.y}
          stroke="#00ff88"
          stroke-width="2"
        />
        <line
          x1={hoverInsertPoint.x}
          y1={hoverInsertPoint.y - 4}
          x2={hoverInsertPoint.x}
          y2={hoverInsertPoint.y + 4}
          stroke="#00ff88"
          stroke-width="2"
        />
      {/if}

      <!-- Centroid crosshair -->
      {#if isClosed && customPoints.length >= 3}
        {@const center = toPixel(getCentroid(customPoints))}
        <line
          x1={center.x - 6}
          y1={center.y}
          x2={center.x + 6}
          y2={center.y}
          stroke="#ff9800"
          stroke-width="1"
          opacity="0.5"
        />
        <line
          x1={center.x}
          y1={center.y - 6}
          x2={center.x}
          y2={center.y + 6}
          stroke="#ff9800"
          stroke-width="1"
          opacity="0.5"
        />
      {/if}
    </svg>

    <!-- Bezier control point handles (edit mode) -->
    {#if isClosed && penMode === 'edit'}
      {#each customPoints as pt, i}
        {#if pt.cpOut}
          {@const cpOutPx = toPixel(pt.cpOut)}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="cp-handle"
            style="left: {cpOutPx.x}px; top: {cpOutPx.y}px;"
            on:mousedown={(e) => handleCPMouseDown(i, 'cpOut', e)}
            role="button"
            tabindex="-1"
            aria-label={$t('geometryTools.customShape.controlHandleOut', { values: { index: i } })}
          />
        {/if}
        {#if pt.cpIn}
          {@const cpInPx = toPixel(pt.cpIn)}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="cp-handle"
            style="left: {cpInPx.x}px; top: {cpInPx.y}px;"
            on:mousedown={(e) => handleCPMouseDown(i, 'cpIn', e)}
            role="button"
            tabindex="-1"
            aria-label={$t('geometryTools.customShape.controlHandleIn', { values: { index: i } })}
          />
        {/if}
      {/each}
    {/if}

    <!-- Vertex handles -->
    {#each vertexPixels as pos, i}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="vertex-handle"
        class:dragging={dragging === 'vertex' && dragVertexIndex === i}
        class:selected={selectedVertexIndex === i && isClosed}
        class:first-vertex={i === 0 && !isClosed}
        class:has-curve={(customPoints[i]?.cpIn || customPoints[i]?.cpOut) && isClosed}
        style="left: {pos.x}px; top: {pos.y}px;"
        on:mousedown={(e) => handleVertexMouseDown(i, e)}
        on:dblclick={(e) => handleVertexDblClick(i, e)}
        role="button"
        tabindex="-1"
        aria-label={$t(
          selectedVertexIndex === i ? 'geometryTools.customShape.vertexSelected' : 'geometryTools.customShape.vertex',
          { values: { index: i } },
        )}
      />
    {/each}

    <!-- Pen tool toolbar (shown when shape is closed) -->
    {#if isClosed}
      <div class="pen-toolbar">
        <button
          class="pen-btn"
          class:active={penMode === 'edit'}
          on:click|stopPropagation={() => (penMode = 'edit')}
          title={$t('geometryTools.customShape.selectMove')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
          </svg>
        </button>
        <button
          class="pen-btn"
          class:active={penMode === 'add'}
          on:click|stopPropagation={() => (penMode = 'add')}
          title={$t('geometryTools.customShape.addPoint')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 20L8 4l4 10 6-2" />
            <line x1="16" y1="6" x2="16" y2="14" />
            <line x1="12" y1="10" x2="20" y2="10" />
          </svg>
        </button>
        <button
          class="pen-btn"
          class:active={penMode === 'remove'}
          on:click|stopPropagation={() => (penMode = 'remove')}
          title={$t('geometryTools.customShape.removePoint')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 20L8 4l4 10 6-2" />
            <line x1="12" y1="10" x2="20" y2="10" />
          </svg>
        </button>
        <div class="pen-divider"></div>
        <span class="pen-hint">
          {#if penMode === 'edit'}
            {$t('geometryTools.customShape.hints.edit')}
          {:else if penMode === 'add'}
            {$t('geometryTools.customShape.hints.add')}
          {:else}
            {$t('geometryTools.customShape.hints.remove')}
          {/if}
        </span>
      </div>
    {/if}

    <!-- Draw mode instructions -->
    {#if !isClosed}
      <div class="draw-instructions">
        {#if customPoints.length === 0}
          {$t('geometryTools.customShape.drawInstructions.empty')}
        {:else if customPoints.length < 3}
          {$t('geometryTools.customShape.drawInstructions.addPoints', { values: { count: 3 - customPoints.length } })}
        {:else}
          {$t('geometryTools.customShape.drawInstructions.close')}
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .custom-shape-handles {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 15;
  }

  .custom-shape-handles.draw-mode {
    pointer-events: auto;
    cursor: crosshair;
  }

  .custom-shape-handles.add-mode {
    pointer-events: auto;
    cursor: crosshair;
  }

  .custom-shape-handles.remove-mode {
    pointer-events: auto;
    cursor: not-allowed;
  }

  .shape-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    overflow: visible;
  }

  .vertex-handle {
    position: absolute;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    margin-top: -6px;
    border-radius: 50%;
    background: #ff9800;
    border: 2px solid #fff;
    cursor: grab;
    pointer-events: auto;
    z-index: 20;
    transition: transform 0.1s, box-shadow 0.1s;
  }

  .vertex-handle:hover {
    transform: scale(1.3);
    box-shadow: 0 0 8px rgba(255, 152, 0, 0.8);
  }

  .vertex-handle.selected {
    background: #00bfff;
    border-color: #fff;
    box-shadow: 0 0 10px rgba(0, 191, 255, 0.9);
    transform: scale(1.3);
  }

  .vertex-handle.has-curve {
    border-radius: 2px;
  }

  .vertex-handle.dragging {
    cursor: grabbing;
    transform: scale(1.4);
    box-shadow: 0 0 12px rgba(255, 152, 0, 1);
  }

  .vertex-handle.first-vertex {
    background: #00ff88;
    border-color: #fff;
    box-shadow: 0 0 6px rgba(0, 255, 136, 0.6);
  }

  .cp-handle {
    position: absolute;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    margin-top: -4px;
    border-radius: 50%;
    background: #00bfff;
    border: 1.5px solid #fff;
    cursor: grab;
    pointer-events: auto;
    z-index: 21;
  }

  .cp-handle:hover {
    transform: scale(1.4);
    box-shadow: 0 0 6px rgba(0, 191, 255, 0.8);
  }

  /* Pen toolbar */
  .pen-toolbar {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    background: rgba(0, 0, 0, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    padding: 3px 8px;
    pointer-events: auto;
    z-index: 25;
  }

  .pen-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    padding: 0;
  }

  .pen-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .pen-btn.active {
    background: rgba(255, 152, 0, 0.25);
    border-color: #ff9800;
    color: #ff9800;
  }

  .pen-divider {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.15);
    margin: 0 4px;
  }

  .pen-hint {
    font-size: 11px;
    color: var(--text-muted, #888);
    white-space: nowrap;
    user-select: none;
  }

  .draw-instructions {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 13px;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
