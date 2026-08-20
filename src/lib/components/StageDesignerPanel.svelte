<script lang="ts">
  /**
   * Stage Designer workspace — Phase 1 implementation.
   *
   * A fullscreen overlay (mirrors VJModePanel's z=999 positioning)
   * where the user designs the projection geometry: imports SVG /
   * pre-made shapes, edits polygon slices, and prepares the surface
   * for slice→content binding (Phase 3) + stage effects (Phase 4).
   *
   * THIS phase is metadata-only:
   *  - SVG import → slices list
   *  - Pan/zoom design canvas with polygon overlays
   *  - Click-to-select, drag-to-move
   *  - Slice list (rename, visibility, lock, delete)
   *  - Pen tool to draw new polygons
   *  - Premade shape drag
   *
   * No render integration: slices don't yet feed the engine. Phase 2
   * adds real-geometry rendering; Phase 3 wires slice→output.
   */

  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from '../i18n';
  import { workspace } from '../stores/workspace';
	import {
	  surfaceStore,
	  activeSurface,
	  activeSurfaceSlices,
	  selectedSlice,
	  selectedSliceIds,
	  surfaceCanUndo,
	  surfaceCanRedo,
	  parseSurfaceSVG,
	} from '../stores/surface';
  import { layers as projectLayers } from '../stores/layers';
  import { STAGE_TEMPLATES, type StageTemplate } from '../stores/stageTemplates';
  import type { Point2D, BezierPoint, SurfaceSlice } from '../types';

  // ── Canvas pan/zoom state ─────────────────────────────────
  // Mirrors the App.svelte viewport pattern: pan + zoom on a wrapper
  // div so SVG overlays stay in sync with the canvas-space content.
  let canvasEl: HTMLDivElement;
  let zoom = 0.5;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStart = { x: 0, y: 0, px: 0, py: 0 };

  // ── Tool state ────────────────────────────────────────────
  type Tool = 'select' | 'pen';
  let tool: Tool = 'select';

  // Pen-tool in-flight polygon points. First click starts a draft;
  // each subsequent click adds a vertex; clicking near the first
  // vertex (or pressing Enter) closes the polygon and commits a slice.
  // Click-and-drag from a new vertex pulls out symmetric bezier
  // handles (Illustrator-style) so the segment leaving the anchor is
  // a curve.
  let penDraft: BezierPoint[] | null = null;
  /** Live cursor position in surface coords — used to render a
   *  preview segment from the last placed vertex to the cursor while
   *  the user is mid-draw. */
  let penCursor: Point2D | null = null;
  /** When the user mouses down to place a pen vertex but is still
   *  holding the button, we treat further movement as "pulling out"
   *  the bezier handle. This state tracks the in-progress vertex. */
  let penPulling: { anchorIndex: number; anchorPos: Point2D } | null = null;

  // ── Slice-vertex drag state ───────────────────────────────
  // For the select tool: drag an anchor or a bezier handle of the
  // selected slice to reshape it without leaving the panel; OR drag
  // the rotate / scale handles around the bounding box to transform
  // the whole slice uniformly (point + handle counts preserved).
	type VertexDrag =
	    | { kind: 'anchor';     sliceId: string; idx: number }
	    | { kind: 'cpIn';       sliceId: string; idx: number }
	    | { kind: 'cpOut';      sliceId: string; idx: number }
	    | { kind: 'sliceMove';  sliceId: string; startMouse: Point2D; startPolygons: { sliceId: string; polygon: BezierPoint[] }[];
      }
	    | { kind: 'sliceRotate'; sliceId: string; centroid: Point2D; startAngle: number; startPolygon: BezierPoint[] }
	    | { kind: 'sliceScale';  sliceId: string; centroid: Point2D; startDist: number; startPolygon: BezierPoint[] };
	  let vertexDrag: VertexDrag | null = null;
	  function beginVertexDrag(next: VertexDrag) {
	    surfaceStore.beginHistoryGesture();
	    vertexDrag = next;
	  }
	  const DRAG_SELECT_THRESHOLD_PX = 5;
	  let sliceDragSelect: {
	    startSurface: Point2D;
	    startClient: Point2D;
	    hitSliceId: string | null;
	    additive: boolean;
	    initialIds: string[];
	    active: boolean;
	  } | null = null;
	  let sliceMarqueeStart: Point2D | null = null;
	  let sliceMarqueeCurrent: Point2D | null = null;
	  let isSliceMarqueeSelecting = false;

	  function clonePolygon(poly: BezierPoint[]): BezierPoint[] {
	    return poly.map((p) => ({
	      x: p.x, y: p.y,
	      cpIn:  p.cpIn  ? { ...p.cpIn  } : undefined,
	      cpOut: p.cpOut ? { ...p.cpOut } : undefined,
	    }));
	  }

  /** Centroid of a polygon's anchors (ignores bezier handles).
   *  Used as the pivot for rotation + uniform scaling. */
  function polygonCentroid(poly: BezierPoint[]): Point2D {
    let sx = 0,
      sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  /** Bounding box of a polygon's anchors. */
  function polygonBBox(poly: BezierPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  // ── File input for SVG import ─────────────────────────────
  let fileInput: HTMLInputElement;
  let isDraggingFile = false;
  function triggerFilePicker() { fileInput?.click(); }

  /** One-click template apply. If the active surface already has
   *  slices, confirm before replacing — easy to wipe a user's
   *  in-progress design otherwise. */
  function applyTemplate(tpl: StageTemplate) {
    const sliceCount = $activeSurfaceSlices.length;
    if (sliceCount > 0) {
      const ok = confirm(
        $t('projection.stage.confirmReplace', {
          values: {
            count: sliceCount,
            suffix: sliceCount === 1 ? '' : $t('projection.stage.pluralSuffix'),
            template: templateLabel(tpl),
          },
        }),
      );
      if (!ok) return;
    }
    surfaceStore.applyTemplate(tpl.id);
  }

  const templateCatalogKeys: Record<string, string> = {
    'wall-of-circles': 'wallOfCircles',
    'vertical-stripes': 'verticalStripes',
    triptych: 'triptych',
    'hexagon-wall': 'hexagonWall',
    concert: 'concert',
    'pillar-array': 'pillarArray',
    'horizontal-bars': 'horizontalBars',
    'diamond-grid': 'diamondGrid',
    'festival-mainstage': 'festivalMainstage',
    'arena-hero': 'arenaHero',
    'club-wrap': 'clubWrap',
    'conference-curved': 'conferenceCurved',
    'tetris-tower': 'tetrisTower',
    'festival-fan': 'festivalFan',
  };

  function templateLabel(tpl: StageTemplate): string {
    const catalogKey = templateCatalogKeys[tpl.id];
    if (!catalogKey) return tpl.label;
    const key = `projection.stage.templates.${catalogKey}.label`;
    const translated = $t(key);
    return translated === key ? tpl.label : translated;
  }

  function shortTemplateLabel(tpl: StageTemplate): string {
    const catalogKey = templateCatalogKeys[tpl.id];
    if (!catalogKey) return tpl.label;
    const key = `projection.stage.templates.${catalogKey}.short`;
    const translated = $t(key);
    return translated === key ? tpl.label : translated;
  }
  function handleFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    importSvgFile(f);
    (e.target as HTMLInputElement).value = '';
  }
  function importSvgFile(file: File) {
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      alert($t('projection.stage.errors.invalidSvg'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (!surfaceStore.importSVG(text)) {
        alert($t('projection.stage.errors.noPolygons'));
      }
    };
    reader.readAsText(file);
  }
  function onCanvasDragOver(e: DragEvent) {
    // Show the drop overlay only if the drag actually carries files.
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      isDraggingFile = true;
    }
  }
  function onCanvasDragLeave(_e: DragEvent) {
    isDraggingFile = false;
  }
  function onCanvasDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingFile = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) importSvgFile(f);
  }

  // ── Coordinate transforms ─────────────────────────────────
  // screen <-> surface (the surface's intrinsic width/height). All
  // polygon storage is in surface coords; we apply zoom + pan only at
  // the wrapper transform layer.
  function screenToSurface(clientX: number, clientY: number): Point2D | null {
    if (!canvasEl || !$activeSurface) return null;
    const rect = canvasEl.getBoundingClientRect();
    // canvas-local px coords (pre-zoom/pan):
    const localX = (clientX - rect.left - panX) / zoom;
    const localY = (clientY - rect.top - panY) / zoom;
    return { x: localX, y: localY };
  }

  // ── Mouse handling ─────────────────────────────────────────
  // The canvas is a single big mousedown target — we dispatch based on
  // the active tool, modifier keys, and what (if anything) was hit
  // (a slice vertex / handle / body / empty canvas). Mousemove +
  // mouseup are wired on the window so a fast drag that escapes the
  // canvas bounds doesn't lose tracking.
  function onCanvasMouseDown(e: MouseEvent) {
    // Pan: middle button or shift+left, regardless of tool.
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, px: panX, py: panY };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    const pt = screenToSurface(e.clientX, e.clientY);
    if (!pt) return;

    // Pen tool: place a new vertex. If the user starts dragging
    // before releasing, the drag pulls out a bezier handle.
    if (tool === 'pen') {
      if (!penDraft) {
        penDraft = [{ x: pt.x, y: pt.y }];
        penPulling = { anchorIndex: 0, anchorPos: { x: pt.x, y: pt.y } };
        e.preventDefault();
        return;
      }
      const first = penDraft[0];
      const closeDistSurface = 12 / zoom;
      const dx = first.x - pt.x,
        dy = first.y - pt.y;
      if (penDraft.length >= 3 && Math.hypot(dx, dy) < closeDistSurface) {
        surfaceStore.addSlice(penDraft);
        penDraft = null;
        penCursor = null;
        penPulling = null;
      } else {
        const newAnchor: BezierPoint = { x: pt.x, y: pt.y };
        penDraft = [...penDraft, newAnchor];
        penPulling = { anchorIndex: penDraft.length - 1, anchorPos: { x: pt.x, y: pt.y } };
      }
      e.preventDefault();
      return;
    }

    // Select tool: hit-test in priority order — handles, anchors,
    // selected slice body for moving, then pending click/marquee select.
    if (tool === 'select' && $selectedSlice) {
      const sl = $selectedSlice;
      const hitR = 8 / zoom;
      for (let idx = 0; idx < sl.polygon.length; idx++) {
        const v = sl.polygon[idx];
        // Handles only show while selected; check them first so a
        // handle on top of an anchor still wins.
        if (v.cpIn && Math.hypot(v.cpIn.x - pt.x, v.cpIn.y - pt.y) < hitR) {
          beginVertexDrag({ kind: 'cpIn', sliceId: sl.id, idx });
          e.preventDefault();
          return;
        }
        if (v.cpOut && Math.hypot(v.cpOut.x - pt.x, v.cpOut.y - pt.y) < hitR) {
          beginVertexDrag({ kind: 'cpOut', sliceId: sl.id, idx });
          e.preventDefault();
          return;
        }
        if (Math.hypot(v.x - pt.x, v.y - pt.y) < hitR) {
          beginVertexDrag({ kind: 'anchor', sliceId: sl.id, idx });
          e.preventDefault();
          return;
        }
      }
      // Click inside an already-selected slice body → start a move drag.
      if (!sl.locked && $selectedSliceIds.includes(sl.id) && pointInPolygon(pt, sl.polygon)) {
        const selectedSet = new Set($selectedSliceIds.length > 0 ? $selectedSliceIds : [sl.id]);
        const startPolygons = $activeSurfaceSlices
          .filter((slice) => selectedSet.has(slice.id) && !slice.locked)
          .map((slice) => ({ sliceId: slice.id, polygon: clonePolygon(slice.polygon) }));
        beginVertexDrag({
          kind: 'sliceMove',
          sliceId: sl.id,
          startMouse: pt,
          startPolygons,
        });
        e.preventDefault();
        return;
      }
    }
    if (tool === 'select') {
      const hitSlice = hitTestSlices(pt);
      sliceDragSelect = {
        startSurface: pt,
        startClient: { x: e.clientX, y: e.clientY },
        hitSliceId: hitSlice?.id ?? null,
        additive: e.metaKey || e.ctrlKey,
        initialIds: [...$selectedSliceIds],
        active: false,
      };
      e.preventDefault();
    }
  }
  function onWindowMouseMove(e: MouseEvent) {
    if (isPanning) {
      panX = panStart.px + (e.clientX - panStart.x);
      panY = panStart.py + (e.clientY - panStart.y);
      return;
    }
    const pt = screenToSurface(e.clientX, e.clientY);
    if (!pt) return;

    if (sliceDragSelect) {
      const start = sliceDragSelect.startClient;
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!sliceDragSelect.active && distance < DRAG_SELECT_THRESHOLD_PX) return;
      if (!sliceDragSelect.active) {
        sliceDragSelect.active = true;
        isSliceMarqueeSelecting = true;
        sliceMarqueeStart = sliceDragSelect.startSurface;
      }
      sliceMarqueeCurrent = pt;
      const hits = collectSlicesInRect(sliceDragSelect.startSurface, pt);
      const next = sliceDragSelect.additive
        ? [...sliceDragSelect.initialIds, ...hits.filter((id) => !sliceDragSelect!.initialIds.includes(id))]
        : hits;
      surfaceStore.setSliceSelection(next[0] ?? null, next);
      return;
    }

    // Pen-tool bezier-handle pull-out. While the mouse is held after
    // placing a vertex, drag distance > ~3px (in surface units)
    // pulls symmetric handles out of that vertex.
    if (tool === 'pen' && penPulling && penDraft) {
      const a = penPulling.anchorPos;
      const dx = pt.x - a.x,
        dy = pt.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 3 / zoom) {
        // Symmetric: cpOut at drag pos, cpIn reflected through anchor.
        const idx = penPulling.anchorIndex;
        const updated = [...penDraft];
        updated[idx] = {
          ...updated[idx],
          cpOut: { x: a.x + dx, y: a.y + dy },
          cpIn: { x: a.x - dx, y: a.y - dy },
        };
        penDraft = updated;
      }
      return;
    }
    if (tool === 'pen' && penDraft) {
      penCursor = pt;
      return;
    }

    if (vertexDrag) {
      if (vertexDrag.kind === 'sliceMove') {
        const dx = pt.x - vertexDrag.startMouse.x;
        const dy = pt.y - vertexDrag.startMouse.y;
        for (const item of vertexDrag.startPolygons) {
          const moved: BezierPoint[] = item.polygon.map((p) => ({
            x: p.x + dx,
            y: p.y + dy,
            cpIn: p.cpIn ? { x: p.cpIn.x + dx, y: p.cpIn.y + dy } : undefined,
            cpOut: p.cpOut ? { x: p.cpOut.x + dx, y: p.cpOut.y + dy } : undefined,
          }));
          surfaceStore.updateSlice(item.sliceId, { polygon: moved });
        }
      } else if (vertexDrag.kind === 'sliceRotate') {
        // Rotate every anchor + handle around the centroid by the
        // angular delta from initial pointer position to current.
        const c = vertexDrag.centroid;
        const ang = Math.atan2(pt.y - c.y, pt.x - c.x);
        const delta = ang - vertexDrag.startAngle;
        const cos = Math.cos(delta),
          sin = Math.sin(delta);
        const rotate = (p: Point2D): Point2D => {
          const dx = p.x - c.x,
            dy = p.y - c.y;
          return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
        };
        const next: BezierPoint[] = vertexDrag.startPolygon.map((p) => {
          const r = rotate(p);
          return {
            x: r.x,
            y: r.y,
            cpIn: p.cpIn ? rotate(p.cpIn) : undefined,
            cpOut: p.cpOut ? rotate(p.cpOut) : undefined,
          };
        });
        surfaceStore.updateSlice(vertexDrag.sliceId, { polygon: next });
      } else if (vertexDrag.kind === 'sliceScale') {
        // Uniform scale around centroid based on the ratio of the
        // current pointer-to-centroid distance vs. the starting
        // distance. Floor at 1% so the slice doesn't collapse to a
        // point that's impossible to grab again.
        const c = vertexDrag.centroid;
        const curDist = Math.hypot(pt.x - c.x, pt.y - c.y);
        const ratio = Math.max(0.01, curDist / Math.max(0.0001, vertexDrag.startDist));
        const scale = (p: Point2D): Point2D => ({
          x: c.x + (p.x - c.x) * ratio,
          y: c.y + (p.y - c.y) * ratio,
        });
        const next: BezierPoint[] = vertexDrag.startPolygon.map((p) => {
          const s = scale(p);
          return {
            x: s.x,
            y: s.y,
            cpIn: p.cpIn ? scale(p.cpIn) : undefined,
            cpOut: p.cpOut ? scale(p.cpOut) : undefined,
          };
        });
        surfaceStore.updateSlice(vertexDrag.sliceId, { polygon: next });
      } else {
        // Single-vertex / single-handle drag. Reach into the slice
        // store; pull out the polygon, patch the one field, write back.
        // Local alias so TS keeps the narrow type inside the .map cb
        // (kind: 'anchor' | 'cpIn' | 'cpOut' — all have `idx`).
        const drag = vertexDrag;
        const slice = $activeSurfaceSlices.find((x) => x.id === drag.sliceId);
        if (slice) {
          const next = slice.polygon.map((v, i) => {
            if (i !== drag.idx) return v;
            if (drag.kind === 'anchor') {
              // Move the anchor and its handles together (preserve
              // local-relative handle offsets so the curve shape is
              // preserved under translation).
              const dx = pt.x - v.x;
              const dy = pt.y - v.y;
              return {
                x: pt.x,
                y: pt.y,
                cpIn: v.cpIn ? { x: v.cpIn.x + dx, y: v.cpIn.y + dy } : undefined,
                cpOut: v.cpOut ? { x: v.cpOut.x + dx, y: v.cpOut.y + dy } : undefined,
              };
            }
            if (drag.kind === 'cpIn') return { ...v, cpIn: { x: pt.x, y: pt.y } };
            if (drag.kind === 'cpOut') return { ...v, cpOut: { x: pt.x, y: pt.y } };
            return v;
          });
          surfaceStore.updateSlice(drag.sliceId, { polygon: next });
        }
      }
    }
  }
  function onWindowMouseUp(_e: MouseEvent) {
    if (sliceDragSelect) {
      const pending = sliceDragSelect;
      if (!pending.active) {
        if (pending.hitSliceId) {
          if (pending.additive) {
            const exists = pending.initialIds.includes(pending.hitSliceId);
            const next = exists
              ? pending.initialIds.filter((id) => id !== pending.hitSliceId)
              : [...pending.initialIds, pending.hitSliceId];
            surfaceStore.setSliceSelection(pending.hitSliceId, next.length > 0 ? next : [pending.hitSliceId]);
          } else {
            surfaceStore.selectSlice(pending.hitSliceId);
          }
        } else if (!pending.additive) {
          surfaceStore.selectSlice(null);
        }
      }
      sliceDragSelect = null;
      sliceMarqueeStart = null;
      sliceMarqueeCurrent = null;
      isSliceMarqueeSelecting = false;
    }
    isPanning = false;
    penPulling = null;
    if (vertexDrag) surfaceStore.endHistoryGesture();
    vertexDrag = null;
  }

  /** Ray-cast point-in-polygon test for hit-detecting slice bodies.
   *  Uses anchor positions only — beziers may slightly under/over-test
   *  near curve apexes; acceptable for a click-tolerance test. */
  function pointInPolygon(p: Point2D, poly: BezierPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        yi = poly[i].y;
      const xj = poly[j].x,
        yj = poly[j].y;
      const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function hitTestSlices(p: Point2D): SurfaceSlice | null {
    for (let i = $activeSurfaceSlices.length - 1; i >= 0; i--) {
      const slice = $activeSurfaceSlices[i];
      if (!slice.visible || slice.locked) continue;
      if (pointInPolygon(p, slice.polygon)) return slice;
    }
    return null;
  }

  function collectSlicesInRect(a: Point2D, b: Point2D): string[] {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const rectCorners: Point2D[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    const ids: string[] = [];
    for (const slice of $activeSurfaceSlices) {
      if (!slice.visible || slice.locked) continue;
      const bbox = polygonBBox(slice.polygon);
      const bboxOverlaps = bbox.maxX >= minX && bbox.minX <= maxX && bbox.maxY >= minY && bbox.minY <= maxY;
      if (!bboxOverlaps) continue;
      const anchorInRect = slice.polygon.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
      const rectHitsSlice = rectCorners.some((p) => pointInPolygon(p, slice.polygon));
      if (anchorInRect || rectHitsSlice || bboxOverlaps) ids.push(slice.id);
    }
    return ids;
  }
  function onCanvasWheel(e: WheelEvent) {
    if (!canvasEl) return;
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const cx = e.clientX - rect.left,
      cy = e.clientY - rect.top;
    const oldZoom = zoom;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(0.1, Math.min(8, oldZoom * factor));
    // Anchor zoom on the cursor — adjust pan so the surface point
    // under the cursor stays put across the zoom change.
    const scaleDelta = next / oldZoom;
    panX = cx - (cx - panX) * scaleDelta;
    panY = cy - (cy - panY) * scaleDelta;
    zoom = next;
  }

  // ── Keyboard ──────────────────────────────────────────────
  function onWindowKeyDown(e: KeyboardEvent) {
    if (!$activeSurface) return;
    // Ignore when typing in an input.
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) surfaceStore.redo();
      else surfaceStore.undo();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (vertexDrag) {
        surfaceStore.cancelHistoryGesture();
        vertexDrag = null;
        e.preventDefault();
        return;
      }
      if (penDraft) {
        penDraft = null;
        penCursor = null;
        e.preventDefault();
        return;
      }
      workspace.closeAll();
      return;
    }
    if (e.key === 'Enter' && tool === 'pen' && penDraft && penDraft.length >= 3) {
      surfaceStore.addSlice(penDraft);
      penDraft = null;
      penCursor = null;
      e.preventDefault();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ($selectedSliceIds.length > 0 || $selectedSlice)) {
      const ids = $selectedSliceIds.length > 0 ? $selectedSliceIds : [$selectedSlice!.id];
      surfaceStore.beginHistoryGesture();
      for (const id of ids) surfaceStore.deleteSlice(id);
      surfaceStore.endHistoryGesture();
      e.preventDefault();
      return;
    }
    if (e.key === 'v' || e.key === 'V') {
      tool = 'select';
      return;
    }
    if (e.key === 'p' || e.key === 'P') {
      tool = 'pen';
      return;
    }
  }

  // ── Slice interactions ────────────────────────────────────
  function selectSliceFromList(slice: SurfaceSlice, e: MouseEvent | KeyboardEvent) {
    if (e.metaKey || e.ctrlKey) {
      const exists = $selectedSliceIds.includes(slice.id);
      const next = exists ? $selectedSliceIds.filter((id) => id !== slice.id) : [...$selectedSliceIds, slice.id];
      surfaceStore.setSliceSelection(slice.id, next.length > 0 ? next : [slice.id]);
    } else {
      surfaceStore.selectSlice(slice.id);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  /**
   * Emit an SVG path d-string for a polygon. Each segment becomes a
   * cubic `C` when EITHER endpoint carries a control handle (the
   * other endpoint defaults to the anchor itself, which yields a
   * straight segment shape from one side and a curve from the other —
   * matches Illustrator's behavior). When neither endpoint has a
   * handle, emit `L`. Closes with `Z`. Open polylines (e.g. mid-pen
   * draft) skip the `Z` — caller decides via the `close` arg.
   */
  function polygonToPath(pts: BezierPoint[], close = true): string {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      if (prev.cpOut || curr.cpIn) {
        const c1 = prev.cpOut ?? { x: prev.x, y: prev.y };
        const c2 = curr.cpIn  ?? { x: curr.x, y: curr.y };
        d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${curr.x} ${curr.y}`;
      } else {
        d += ` L ${curr.x} ${curr.y}`;
      }
    }
    if (close && pts.length >= 3) {
      // Closing segment: also bezier if the last/first carry handles.
      const last = pts[pts.length - 1], first = pts[0];
      if (last.cpOut || first.cpIn) {
        const c1 = last.cpOut  ?? { x: last.x,  y: last.y  };
        const c2 = first.cpIn  ?? { x: first.x, y: first.y };
        d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${first.x} ${first.y}`;
      }
      d += ' Z';
    }
    return d;
  }

  // ── Premade shape builder ─────────────────────────────────
  // Drops a shape centered in the visible viewport.
  function viewportCenter(): Point2D {
    if (!canvasEl || !$activeSurface) return { x: 200, y: 200 };
    const rect = canvasEl.getBoundingClientRect();
    return screenToSurface(rect.left + rect.width / 2, rect.top + rect.height / 2) ?? { x: 200, y: 200 };
  }
  function addPremade(kind: 'rect' | 'circle' | 'triangle' | 'star' | 'hex' | 'ellipse' | 'pill') {
    const c = viewportCenter();
    const r = 120;
    let pts: BezierPoint[] = [];
    let name = $t('projection.stage.shapes.shape');
    if (kind === 'rect') {
      name = $t('projection.stage.shapes.rectangle');
      pts = [
        { x: c.x - r, y: c.y - r * 0.7 },
        { x: c.x + r, y: c.y - r * 0.7 },
        { x: c.x + r, y: c.y + r * 0.7 },
        { x: c.x - r, y: c.y + r * 0.7 },
      ];
    } else if (kind === 'circle') {
      name = $t('projection.stage.shapes.circle');
      // True circle as 4 cubic-bezier quadrants. The magic constant
      // 0.5522847... = (4/3) * tan(π/8) makes the quadrant a near-
      // perfect quarter circle (max error < 0.027% of radius). This
      // beats the N-sided polygon approximation at every zoom level
      // AND makes the shape editable as a real bezier path — drag
      // a handle and the curve flexes naturally.
      const K = 0.5522847498307936 * r;
      pts = [
        { x: c.x,     y: c.y - r, cpIn: { x: c.x + K, y: c.y - r }, cpOut: { x: c.x - K, y: c.y - r } },
        { x: c.x - r, y: c.y,     cpIn: { x: c.x - r, y: c.y - K }, cpOut: { x: c.x - r, y: c.y + K } },
        { x: c.x,     y: c.y + r, cpIn: { x: c.x - K, y: c.y + r }, cpOut: { x: c.x + K, y: c.y + r } },
        { x: c.x + r, y: c.y,     cpIn: { x: c.x + r, y: c.y + K }, cpOut: { x: c.x + r, y: c.y - K } },
      ];
    } else if (kind === 'ellipse') {
      name = $t('projection.stage.shapes.ellipse');
      const rx = r, ry = r * 0.6;
      const Kx = 0.5522847498307936 * rx, Ky = 0.5522847498307936 * ry;
      pts = [
        { x: c.x,      y: c.y - ry, cpIn: { x: c.x + Kx, y: c.y - ry }, cpOut: { x: c.x - Kx, y: c.y - ry } },
        { x: c.x - rx, y: c.y,      cpIn: { x: c.x - rx, y: c.y - Ky }, cpOut: { x: c.x - rx, y: c.y + Ky } },
        { x: c.x,      y: c.y + ry, cpIn: { x: c.x - Kx, y: c.y + ry }, cpOut: { x: c.x + Kx, y: c.y + ry } },
        { x: c.x + rx, y: c.y,      cpIn: { x: c.x + rx, y: c.y + Ky }, cpOut: { x: c.x + rx, y: c.y - Ky } },
      ];
    } else if (kind === 'pill') {
      // Rounded rectangle (stadium): two straight long sides + two
      // semicircular caps. Useful for projection mapping LED bars.
      name = $t('projection.stage.shapes.pill');
      const w = r * 1.4, h = r * 0.5;
      const K = 0.5522847498307936 * h;
      pts = [
        { x: c.x - w, y: c.y - h,
          cpIn:  { x: c.x - w, y: c.y - h },
          cpOut: { x: c.x + w, y: c.y - h } },
        { x: c.x + w, y: c.y - h,
          cpIn:  { x: c.x - w, y: c.y - h },
          cpOut: { x: c.x + w + K, y: c.y - h } },
        { x: c.x + w + h, y: c.y,
          cpIn:  { x: c.x + w + h, y: c.y - K },
          cpOut: { x: c.x + w + h, y: c.y + K } },
        { x: c.x + w, y: c.y + h,
          cpIn:  { x: c.x + w + K, y: c.y + h },
          cpOut: { x: c.x - w, y: c.y + h } },
        { x: c.x - w, y: c.y + h,
          cpIn:  { x: c.x + w, y: c.y + h },
          cpOut: { x: c.x - w - K, y: c.y + h } },
        { x: c.x - w - h, y: c.y,
          cpIn:  { x: c.x - w - h, y: c.y + K },
          cpOut: { x: c.x - w - h, y: c.y - K } },
      ];
    } else if (kind === 'triangle') {
      name = $t('projection.stage.shapes.triangle');
      pts = [
        { x: c.x, y: c.y - r },
        { x: c.x + r * 0.866, y: c.y + r * 0.5 },
        { x: c.x - r * 0.866, y: c.y + r * 0.5 },
      ];
    } else if (kind === 'star') {
      name = $t('projection.stage.shapes.star');
      const N = 10;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.42;
        pts.push({ x: c.x + Math.cos(t) * rr, y: c.y + Math.sin(t) * rr });
      }
    } else if (kind === 'hex') {
      name = $t('projection.stage.shapes.hexagon');
      const N = 6;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2 - Math.PI / 6;
        pts.push({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r });
      }
    }
    surfaceStore.addSlice(pts, name);
  }

  // ── Auto-create a default surface when user opens the panel
  //    without one — saves them a click.
  $: if (!$activeSurface && $surfaceStore.surfaces.length === 0) {
    // Defer one tick so the reactive graph settles before we mutate.
    queueMicrotask(() => surfaceStore.createSurface($t('projection.stage.defaultSurfaceName')));
  }

  // ── Auto-fit the surface to the viewport when it changes —
  //    so first-time imports aren't tiny in the corner.
  $: if ($activeSurface && canvasEl) fitToViewport();
  function fitToViewport() {
    if (!canvasEl || !$activeSurface) return;
    const rect = canvasEl.getBoundingClientRect();
    const padding = 40;
    const sw = $activeSurface.width;
    const sh = $activeSurface.height;
    const fit = Math.min((rect.width - padding * 2) / sw, (rect.height - padding * 2) / sh);
    zoom = Math.max(0.05, Math.min(4, fit));
    panX = (rect.width - sw * zoom) / 2;
    panY = (rect.height - sh * zoom) / 2;
  }

  onMount(() => {
    // Reverse-sync slice polygons FROM their bound mapping layers so
    // any warping / corner adjustment the user did in mapping mode
    // is reflected when they reopen the designer. Walks
    // slice.sourceBinding.layerId for each slice and recomputes its
    // polygon from the layer's corners + customPoints. No-ops cleanly
    // for slices with no binding or whose bound layer was deleted.
    const liveLayers = get(projectLayers);
    surfaceStore.syncFromMappingLayers(liveLayers);

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('keydown', onWindowKeyDown);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('keydown', onWindowKeyDown);
    };
  });

  onDestroy(() => {
    // Nothing per-instance — listeners are removed in onMount cleanup.
  });
</script>

<div class="stage-overlay">
  <!-- Header ── tools, surface name, close button ───────────────── -->
  <header class="stage-header">
    <div class="header-left">
      <!-- Back button — closes the designer WITHOUT applying. The
           surface state stays saved on the project; the user can come
           back any time to edit. Apply Stage on the right is the
           commit-to-mapping action. -->
      <button class="back-btn" onclick={() => workspace.closeAll()} title={$t('projection.stage.header.backTitle')}>
        <span class="back-arrow">←</span>
        {$t('projection.stage.header.back')}
      </button>
      <span class="title">{$t('projection.stage.header.title')}</span>
      {#if $activeSurface}
        <input
          class="surface-name-input"
          type="text"
          value={$activeSurface.name}
          onchange={(e) => surfaceStore.renameSurface($activeSurface!.id, (e.target as HTMLInputElement).value)}
        />
        <span class="surface-dims">{$activeSurface.width} × {$activeSurface.height}</span>
      {/if}
    </div>

    <div class="header-center">
      <!-- Tool palette moved out to a persistent left sidebar — see
           .tool-palette below. Header stays uncluttered (surface name
           on the left, zoom on the right). -->
    </div>
    <!-- File picker for SVG import — triggered from the left palette. -->
    <input
      bind:this={fileInput}
      type="file"
      accept=".svg,image/svg+xml"
      style="display:none"
      onchange={handleFile}
    />

    <div class="header-right">
      <button
        class="zoom-btn"
        disabled={!$surfaceCanUndo}
        onclick={() => surfaceStore.undo()}
        title={$t('projection.stage.header.undoTitle')}
        aria-label={$t('projection.stage.header.undoAria')}>↶</button>
      <button
        class="zoom-btn"
        disabled={!$surfaceCanRedo}
        onclick={() => surfaceStore.redo()}
        title={$t('projection.stage.header.redoTitle')}
        aria-label={$t('projection.stage.header.redoAria')}>↷</button>
      <button class="zoom-btn" onclick={fitToViewport} title={$t('projection.stage.header.fitTitle')}>⛶</button>
      <span class="zoom-readout">{Math.round(zoom * 100)}%</span>
      <span class="header-sep"></span>
      <!-- Apply Stage: turn slices into mapping layers + jump to the
           main workspace so the user can drop content onto each layer.
           Disabled until the surface has at least one slice. -->
      <button
        class="apply-stage-btn"
        disabled={!$activeSurface || $activeSurfaceSlices.length === 0}
        onclick={async () => {
          const ok = await surfaceStore.applyStage();
          if (!ok) alert($t('projection.stage.errors.applyEmpty'));
        }}
        title={$t('projection.stage.header.applyTitle')}
      >
        {$t('projection.stage.header.apply')}
      </button>
    </div>
  </header>

  <!-- Body ── tool palette | slice list | canvas | inspector ─────── -->
  <div class="stage-body">
    <!-- Always-visible tool palette (Illustrator-style). Icon-only
         buttons; full tooltip on hover. Pen + shapes + Import SVG
         live here permanently so they're never cropped off the
         header at narrow window widths. -->
    <aside class="tool-palette">
      <button
        class="palette-btn"
        class:active={tool === 'select'}
        onclick={() => (tool = 'select')}
        title={$t('projection.stage.tools.selectTitle')}
      >
        <span class="p-icon">↖</span><span class="p-label">{$t('projection.stage.tools.select')}</span>
      </button>
      <button
        class="palette-btn"
        class:active={tool === 'pen'}
        onclick={() => (tool = 'pen')}
        title={$t('projection.stage.tools.penTitle')}
      >
        <span class="p-icon">✎</span><span class="p-label">{$t('projection.stage.tools.pen')}</span>
      </button>

      <div class="palette-divider"></div>
      <div class="palette-section">{$t('projection.stage.tools.shapes')}</div>
      <button class="palette-btn" onclick={() => addPremade('rect')} title={$t('projection.stage.tools.rectTitle')}>
        <span class="p-icon">▭</span><span class="p-label">{$t('projection.stage.tools.rect')}</span>
      </button>
      <button class="palette-btn" onclick={() => addPremade('circle')} title={$t('projection.stage.tools.circleTitle')}>
        <span class="p-icon">◯</span><span class="p-label">{$t('projection.stage.tools.circle')}</span>
      </button>
      <button
        class="palette-btn"
        onclick={() => addPremade('ellipse')}
        title={$t('projection.stage.tools.ellipseTitle')}
      >
        <span class="p-icon">⬭</span><span class="p-label">{$t('projection.stage.tools.ellipse')}</span>
      </button>
      <button
        class="palette-btn"
        onclick={() => addPremade('triangle')}
        title={$t('projection.stage.tools.triangleTitle')}
      >
        <span class="p-icon">△</span><span class="p-label">{$t('projection.stage.tools.triangle')}</span>
      </button>
      <button class="palette-btn" onclick={() => addPremade('star')} title={$t('projection.stage.tools.starTitle')}>
        <span class="p-icon">☆</span><span class="p-label">{$t('projection.stage.tools.star')}</span>
      </button>
      <button class="palette-btn" onclick={() => addPremade('hex')} title={$t('projection.stage.tools.hexTitle')}>
        <span class="p-icon">⬡</span><span class="p-label">{$t('projection.stage.tools.hex')}</span>
      </button>
      <button class="palette-btn" onclick={() => addPremade('pill')} title={$t('projection.stage.tools.pillTitle')}>
        <span class="p-icon">▱</span><span class="p-label">{$t('projection.stage.tools.pill')}</span>
      </button>

      <div class="palette-divider"></div>
      <div class="palette-section">{$t('projection.stage.tools.templates')}</div>
      <!-- Predesigned one-click stage layouts. Each replaces the
           active surface's slices with a clean starter geometry. -->
      {#each STAGE_TEMPLATES as tpl (tpl.id)}
        <button
          class="palette-btn"
          onclick={() => applyTemplate(tpl)}
          title={$t('projection.stage.tools.templateTitle', { values: { label: templateLabel(tpl) } })}
        >
          <span class="p-icon">{tpl.icon}</span><span class="p-label">{shortTemplateLabel(tpl)}</span>
        </button>
      {/each}

      <div class="palette-divider"></div>
      <div class="palette-section">{$t('projection.stage.tools.import')}</div>
      <button class="palette-btn primary-btn" onclick={triggerFilePicker} title={$t('projection.stage.tools.importTitle')}
      >
        <span class="p-icon">↑</span><span class="p-label">{$t('projection.stage.tools.svg')}</span>
      </button>
    </aside>

    <!-- Slice list -->
    <aside class="slice-list-panel">
      <div class="panel-header">
        <span>{$t('projection.stage.slices.heading')}</span>
        <span class="slice-count">{$activeSurfaceSlices.length}</span>
      </div>
      <div class="slice-list">
        {#each $activeSurfaceSlices as slice, idx (slice.id)}
	          <div
	            class="slice-row"
	            class:selected={$selectedSliceIds.includes(slice.id)}
	            class:primary={$selectedSlice?.id === slice.id}
	            onclick={(e) => selectSliceFromList(slice, e)}
	            role="button"
	            tabindex="0"
	            onkeydown={(e) => e.key === 'Enter' && selectSliceFromList(slice, e)}
	          >
            <span class="slice-color-dot" style="background: {slice.color}"></span>
            <span class="slice-name">{slice.name}</span>
            <button
              class="slice-icon-btn"
              class:active={slice.visible}
              onclick={(e) => { e.stopPropagation(); surfaceStore.updateSlice(slice.id, { visible: !slice.visible }); }}
              title={$t('projection.stage.slices.visible')}>{slice.visible ? '◉' : '○'}</button>
            <button
              class="slice-icon-btn"
              class:active={slice.locked}
              onclick={(e) => { e.stopPropagation(); surfaceStore.updateSlice(slice.id, { locked: !slice.locked }); }}
              title={$t('projection.stage.slices.locked')}>{slice.locked ? '🔒' : '🔓'}</button>
            <button
              class="slice-icon-btn danger"
              onclick={(e) => { e.stopPropagation(); surfaceStore.deleteSlice(slice.id); }}
              title={$t('projection.stage.slices.delete')}>×</button>
          </div>
        {/each}
        {#if $activeSurfaceSlices.length === 0}
          <div class="slice-empty">
            {$t('projection.stage.slices.empty')}
          </div>
        {/if}
      </div>
    </aside>

    <!-- Design canvas -->
    <div
      class="design-canvas"
      class:tool-pen={tool === 'pen'}
      class:drop-active={isDraggingFile}
      bind:this={canvasEl}
      onmousedown={onCanvasMouseDown}
      onwheel={onCanvasWheel}
      ondragover={onCanvasDragOver}
      ondragleave={onCanvasDragLeave}
      ondrop={onCanvasDrop}
      role="application"
      tabindex="0"
    >
      {#if $activeSurface}
        <!-- Surface bounds + slices, all under a single transform -->
        <svg
          class="canvas-svg"
          width={$activeSurface.width * zoom}
          height={$activeSurface.height * zoom}
          viewBox="0 0 {$activeSurface.width} {$activeSurface.height}"
          style="transform: translate({panX}px, {panY}px);"
        >
          <!-- Surface background -->
          <rect
            x="0" y="0"
            width={$activeSurface.width}
            height={$activeSurface.height}
            fill="#0a0a0c"
            stroke="#2a2a30"
            stroke-width={1 / zoom}
          />

          <!-- Existing slices -->
	          {#each $activeSurfaceSlices as slice (slice.id)}
	            {#if slice.visible}
	              {@const isSelected = $selectedSliceIds.includes(slice.id)}
	              {@const isPrimary = $selectedSlice?.id === slice.id}
	              <path
	                d={polygonToPath(slice.polygon)}
	                fill={isSelected ? slice.color + '33' : slice.color + '18'}
	                stroke={slice.color}
	                stroke-width={(isPrimary ? 2.4 : isSelected ? 1.8 : 1.2) / zoom}
	                style="cursor: {tool === 'select' && !slice.locked ? 'pointer' : 'default'};"
	                onkeydown={(e) => e.key === 'Enter' && selectSliceFromList(slice, e)}
	                role="button"
	                tabindex="0"
	              />
              <!-- Label at first vertex -->
              {#if slice.polygon.length > 0}
                <text
                  x={slice.polygon[0].x + 8 / zoom}
                  y={slice.polygon[0].y - 8 / zoom}
                  fill={slice.color}
                  font-size={11 / zoom}
                  font-family="IBM Plex Mono, ui-monospace, monospace"
                  pointer-events="none"
                >{slice.name}</text>
              {/if}
              <!-- Vertex + bezier-handle controls for the selected
                   slice. Anchor handles are square, bezier handles
                   are smaller circles joined to their anchor by a
                   thin tangent line — matches Illustrator/Figma
                   convention so the user gets a free legible UX. -->
	              {#if isPrimary}
                {#each slice.polygon as v, vi}
                  <!-- Bezier handle tangent lines + nubs -->
                  {#if v.cpIn}
                    <line
                      x1={v.x} y1={v.y}
                      x2={v.cpIn.x} y2={v.cpIn.y}
                      stroke={slice.color}
                      stroke-width={0.8 / zoom}
                      opacity="0.55"
                    />
                    <circle
                      cx={v.cpIn.x} cy={v.cpIn.y}
                      r={3 / zoom}
                      fill={slice.color}
                      opacity="0.9"
                    />
                  {/if}
                  {#if v.cpOut}
                    <line
                      x1={v.x} y1={v.y}
                      x2={v.cpOut.x} y2={v.cpOut.y}
                      stroke={slice.color}
                      stroke-width={0.8 / zoom}
                      opacity="0.55"
                    />
                    <circle
                      cx={v.cpOut.x} cy={v.cpOut.y}
                      r={3 / zoom}
                      fill={slice.color}
                      opacity="0.9"
                    />
                  {/if}
                  <!-- Anchor — square so it's distinct from bezier handles -->
                  <rect
                    x={v.x - 4 / zoom}
                    y={v.y - 4 / zoom}
                    width={8 / zoom}
                    height={8 / zoom}
                    fill="#0a0a0c"
                    stroke={slice.color}
                    stroke-width={1.5 / zoom}
                  />
                {/each}
                <!-- Uniform scale + rotate handles, positioned at the
                     polygon's bbox top-right and above-top so they
                     don't overlap with anchor handles. Mouse-down on
                     either kicks off a transform drag whose math
                     lives in onWindowMouseMove. -->
                {@const bbox = polygonBBox(slice.polygon)}
                {@const cent = polygonCentroid(slice.polygon)}
                <!-- Connector line: centroid → rotate handle (above bbox top edge) -->
                {@const rotateY = bbox.minY - 40 / zoom}
                {@const rotateX = (bbox.minX + bbox.maxX) / 2}
                <line
                  x1={rotateX}
                  y1={bbox.minY}
                  x2={rotateX}
                  y2={rotateY}
                  stroke={slice.color}
                  stroke-width={0.8 / zoom}
                  stroke-dasharray="{3 / zoom},{3 / zoom}"
                  opacity="0.55"
                />
                <!-- Rotate handle (circle with ↻ icon) -->
                <circle
                  cx={rotateX}
                  cy={rotateY}
                  r={10 / zoom}
                  fill="#0a0a0c"
                  stroke={slice.color}
                  stroke-width={1.5 / zoom}
                  style="cursor: grab;"
                  onmousedown={(e) => {
                    e.stopPropagation();
                    const c = polygonCentroid(slice.polygon);
                    beginVertexDrag({
                      kind: 'sliceRotate',
                      sliceId: slice.id,
                      centroid: c,
                      startAngle: Math.atan2(rotateY - c.y, rotateX - c.x),
                      startPolygon: slice.polygon.map((p) => ({
                        x: p.x,
                        y: p.y,
                        cpIn: p.cpIn ? { ...p.cpIn } : undefined,
                        cpOut: p.cpOut ? { ...p.cpOut } : undefined,
                      })),
                    });
                  }}
                />
                <text
                  x={rotateX}
                  y={rotateY + 4 / zoom}
                  text-anchor="middle"
                  font-size={11 / zoom}
                  fill={slice.color}
                  pointer-events="none"
                  font-family="Space Grotesk, system-ui, sans-serif">↻</text
                >
                <!-- Scale handle (square at bottom-right of bbox) -->
                {@const scaleX = bbox.maxX + 24 / zoom}
                {@const scaleY = bbox.maxY + 24 / zoom}
                <line
                  x1={bbox.maxX}
                  y1={bbox.maxY}
                  x2={scaleX}
                  y2={scaleY}
                  stroke={slice.color}
                  stroke-width={0.8 / zoom}
                  stroke-dasharray="{3 / zoom},{3 / zoom}"
                  opacity="0.55"
                />
                <rect
                  x={scaleX - 8 / zoom}
                  y={scaleY - 8 / zoom}
                  width={16 / zoom}
                  height={16 / zoom}
                  fill="#0a0a0c"
                  stroke={slice.color}
                  stroke-width={1.5 / zoom}
                  style="cursor: nwse-resize;"
                  onmousedown={(e) => {
                    e.stopPropagation();
                    const c = polygonCentroid(slice.polygon);
                    beginVertexDrag({
                      kind: 'sliceScale',
                      sliceId: slice.id,
                      centroid: c,
                      startDist: Math.hypot(scaleX - c.x, scaleY - c.y),
                      startPolygon: slice.polygon.map((p) => ({
                        x: p.x,
                        y: p.y,
                        cpIn: p.cpIn ? { ...p.cpIn } : undefined,
                        cpOut: p.cpOut ? { ...p.cpOut } : undefined,
                      })),
                    });
                  }}
                />
                <text
                  x={scaleX}
                  y={scaleY + 4 / zoom}
                  text-anchor="middle"
                  font-size={11 / zoom}
                  fill={slice.color}
                  pointer-events="none"
                  font-family="Space Grotesk, system-ui, sans-serif">⤡</text
                >
              {/if}
            {/if}
          {/each}

          {#if isSliceMarqueeSelecting && sliceMarqueeStart && sliceMarqueeCurrent}
            {@const mx = Math.min(sliceMarqueeStart.x, sliceMarqueeCurrent.x)}
            {@const my = Math.min(sliceMarqueeStart.y, sliceMarqueeCurrent.y)}
            {@const mw = Math.abs(sliceMarqueeCurrent.x - sliceMarqueeStart.x)}
            {@const mh = Math.abs(sliceMarqueeCurrent.y - sliceMarqueeStart.y)}
            <rect class="slice-marquee" x={mx} y={my} width={mw} height={mh} stroke-width={1.5 / zoom} rx={2 / zoom} />
          {/if}

          <!-- Pen-tool live draft. The committed segments render
               with their bezier curves (since penDraft is BezierPoint[]);
               the trailing segment from last vertex to cursor renders
               separately as a dashed preview so the user knows it's
               not yet placed. -->
          {#if penDraft && penDraft.length > 0}
            <path
              d={polygonToPath(penDraft, false)}
              fill="none"
              stroke="#4cd1ff"
              stroke-width={1.5 / zoom}
              opacity="0.9"
            />
            {#if penCursor}
              <line
                x1={penDraft[penDraft.length - 1].x}
                y1={penDraft[penDraft.length - 1].y}
                x2={penCursor.x}
                y2={penCursor.y}
                stroke="#4cd1ff"
                stroke-width={1.5 / zoom}
                stroke-dasharray="{4 / zoom},{3 / zoom}"
                opacity="0.6"
              />
            {/if}
            {#each penDraft as v, vi}
              {#if v.cpIn}
                <line x1={v.x} y1={v.y} x2={v.cpIn.x} y2={v.cpIn.y}
                      stroke="#4cd1ff" stroke-width={0.7 / zoom} opacity="0.5" />
                <circle cx={v.cpIn.x} cy={v.cpIn.y} r={2.5 / zoom} fill="#4cd1ff" opacity="0.7" />
              {/if}
              {#if v.cpOut}
                <line x1={v.x} y1={v.y} x2={v.cpOut.x} y2={v.cpOut.y}
                      stroke="#4cd1ff" stroke-width={0.7 / zoom} opacity="0.5" />
                <circle cx={v.cpOut.x} cy={v.cpOut.y} r={2.5 / zoom} fill="#4cd1ff" opacity="0.7" />
              {/if}
              <rect
                x={v.x - 3.5 / zoom} y={v.y - 3.5 / zoom}
                width={7 / zoom} height={7 / zoom}
                fill="#4cd1ff" stroke="#0a0a0c" stroke-width={1 / zoom}
              />
            {/each}
          {/if}
        </svg>
      {/if}

      <!-- Empty-state CTAs — visible only when the surface has no
           slices yet AND the user isn't mid-pen-draft. Two big
           obvious buttons + a dotted drop zone so the user can't
           miss either entry point. -->
      {#if $activeSurfaceSlices.length === 0 && !penDraft}
        <div class="canvas-empty">
          <div class="empty-card">
            <p class="empty-title">{$t('projection.stage.empty.title')}</p>
            <p class="empty-sub">{$t('projection.stage.empty.subtitle')}</p>
            <div class="empty-actions">
              <button class="empty-btn primary" onclick={triggerFilePicker}>
                {$t('projection.stage.empty.importSvg')}
              </button>
              <button class="empty-btn" onclick={() => (tool = 'pen')}>
                {$t('projection.stage.empty.drawPen')}
              </button>
              <button class="empty-btn" onclick={() => addPremade('rect')}>
                {$t('projection.stage.empty.startRectangle')}
              </button>
            </div>
            <p class="empty-hint">{$t('projection.stage.empty.hint')}</p>
            <p class="empty-shortcut">{$t('projection.stage.empty.shortcut')}</p>
          </div>
        </div>
      {/if}

      <!-- Live drop indicator while a file is being dragged over the
           canvas — overrides the empty-state CTA so the user sees
           exactly where the drop will land. -->
      {#if isDraggingFile}
        <div class="canvas-drop-overlay">
          <div class="drop-card">
            <span class="drop-icon">↧</span>
            <p>{$t('projection.stage.empty.dropSvg')}</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Inspector -->
    <aside class="inspector-panel">
      <div class="panel-header"><span>{$t('projection.stage.inspector.heading')}</span></div>

      <!-- Slice-specific section (visible only with a selection). -->
      {#if $selectedSlice}
        {@const sl = $selectedSlice}
        <div class="inspector-section">
          <label>
            {$t('projection.stage.inspector.name')}
            <input
              type="text"
              value={sl.name}
              onchange={(e) => surfaceStore.updateSlice(sl.id, { name: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label>
            {$t('projection.stage.inspector.color')}
            <input
              type="color"
              value={sl.color}
              onchange={(e) => surfaceStore.updateSlice(sl.id, { color: (e.target as HTMLInputElement).value })}
            />
          </label>
          <div class="inspector-row">
            <label class="check">
              <input type="checkbox" checked={sl.visible} onchange={(e) => surfaceStore.updateSlice(sl.id, { visible: (e.target as HTMLInputElement).checked })}/>
              {$t('projection.stage.inspector.visible')}
            </label>
            <label class="check">
              <input type="checkbox" checked={sl.locked} onchange={(e) => surfaceStore.updateSlice(sl.id, { locked: (e.target as HTMLInputElement).checked })}/>
              {$t('projection.stage.inspector.locked')}
            </label>
          </div>
          <div class="inspector-stat"><span>{$t('projection.stage.inspector.vertices')}</span><span>{sl.polygon.length}</span></div>
          <!-- Simplify — RDP-reduces the polygon to ~24 anchors, keeping
               bezier-handled anchors intact. Useful for SVG imports
               that arrived with hundreds of dense sample points; the
               import itself preserves them so the user can choose. -->
          {#if sl.polygon.length > 12}
            <button
              class="inspector-action"
              onclick={() => surfaceStore.simplifySlice(sl.id, 24)}
              title={$t('projection.stage.inspector.simplifyTitle')}>{$t('projection.stage.inspector.simplify')}</button>
          {/if}
          <!-- Binding section — shows what content source feeds this
               slice. After Apply Stage, sourceBinding.kind = 'layer'
               and points at the mapping layer the user can populate
               in the main workspace. -->
          {#if sl.sourceBinding?.kind === 'layer'}
            {@const bindingLayerId = (sl.sourceBinding as { kind: 'layer'; layerId: string }).layerId}
            {@const linkedLayer = $projectLayers.find((l) => l.id === bindingLayerId)}
            <div class="binding-card">
              <div class="binding-label">{$t('projection.stage.inspector.boundLayer')}</div>
              <div class="binding-name">{linkedLayer ? linkedLayer.name : $t('projection.stage.inspector.layerRemoved')}</div>
              <button
                class="binding-action"
                onclick={() => workspace.closeAll()}
                title={$t('projection.stage.inspector.openMappingTitle')}
                >{$t('projection.stage.inspector.openMapping')}</button>
            </div>
          {:else}
            <div class="inspector-stat"><span>{$t('projection.stage.inspector.binding')}</span><span class="muted">{$t('projection.stage.inspector.unbound')}</span></div>
            <div class="inspector-note">
              {$t('projection.stage.inspector.noteBefore')}<strong>{$t('projection.stage.inspector.noteAction')}</strong>{$t('projection.stage.inspector.noteAfter')}
            </div>
          {/if}
        </div>
      {:else}
        <div class="inspector-empty">{$t('projection.stage.inspector.empty')}</div>
      {/if}

    </aside>
  </div>
</div>

<style>
  .stage-overlay {
    position: fixed;
    inset: 0;
    /* Must sit ABOVE the main .toolbar (z-index 1000 in App.svelte)
       so the Stage Designer's own header — Back to Mapping, Apply
       Stage, zoom controls — isn't cropped behind the app toolbar.
       Matches VJModePanel's overlay z-index. */
    z-index: 1001;
    background: var(--bg-primary, #050507);
    color: var(--text-primary, #ddd);
    display: flex;
    flex-direction: column;
    font-family: var(--ga-font-ui, 'Space Grotesk', system-ui, sans-serif);
    user-select: none;
  }

  /* ─── Header ─── */
  .stage-header {
    flex: 0 0 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    background: linear-gradient(180deg, #0e0e12, #08080a);
    border-bottom: 1px solid #1d1d22;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .back-btn {
    height: 28px;
    padding: 0 12px;
    border: 1px solid #2a2a30;
    background: var(--bg-tertiary, #14141a);
    color: var(--text-primary, #ccc);
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .back-btn:hover {
    background: #1c1c24;
    border-color: #4cd1ff;
    color: #fff;
  }
  .back-arrow {
    font-size: 15px;
    line-height: 1;
  }
  .title {
    font-size: 12px;
    letter-spacing: 2px;
    color: #4cd1ff;
    font-weight: 600;
  }
  .surface-name-input {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--text-primary, #ddd);
    padding: 4px 6px;
    font-size: 14px;
    min-width: 160px;
  }
  .surface-name-input:hover {
    border-color: #2a2a30;
  }
  .surface-name-input:focus {
    border-color: #4cd1ff;
    outline: none;
  }
  .surface-dims {
    color: #666;
    font-size: 12px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }

  /* ─── Toolbar ─── */
  .header-center.toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tool-btn {
    min-width: 30px;
    height: 30px;
    padding: 0 6px;
    border: 1px solid #2a2a30;
    background: var(--bg-tertiary, #14141a);
    color: var(--text-secondary, #aaa);
    border-radius: 4px;
    font-size: 15px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .tool-btn.labeled {
    padding: 0 9px 0 7px;
  }
  .tool-btn .t-icon {
    font-size: 15px;
    line-height: 1;
  }
  .tool-btn .t-label {
    font-size: 12px;
    letter-spacing: 0.3px;
    font-weight: 500;
  }
  .tool-btn:hover {
    border-color: #4cd1ff;
    color: #fff;
  }
  .tool-btn.active {
    background: rgba(76, 209, 255, 0.15);
    border-color: #4cd1ff;
    color: #4cd1ff;
  }
  .tool-btn.import-btn {
    width: auto;
    padding: 0 14px;
    font-size: 12.5px;
    letter-spacing: 0.5px;
    font-weight: 600;
    background: linear-gradient(180deg, rgba(76, 209, 255, 0.18), rgba(76, 209, 255, 0.08));
    border-color: rgba(76, 209, 255, 0.4);
    color: #b6e8ff;
    gap: 6px;
  }
  .tool-btn.import-btn:hover {
    background: linear-gradient(180deg, rgba(76, 209, 255, 0.32), rgba(76, 209, 255, 0.18));
    border-color: #4cd1ff;
    color: #fff;
  }
  .tool-btn.import-btn .import-icon {
    font-size: 14px;
    font-weight: 700;
  }
  .tool-sep {
    width: 1px;
    height: 22px;
    background: #2a2a30;
    margin: 0 6px;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .zoom-btn {
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid #2a2a30;
    color: var(--text-secondary, #aaa);
    border-radius: 4px;
    cursor: pointer;
  }
  .zoom-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }
  .zoom-readout {
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 12px;
    color: var(--text-muted, #888);
    min-width: 44px;
    text-align: right;
  }
  .header-sep {
    width: 1px;
    height: 22px;
    background: #2a2a30;
    margin: 0 4px;
  }

  /* Apply Stage — the primary commit action. Cyan→violet gradient
     so it visually echoes the STAGE button in the main header (the
     workspace's entry point) and Import SVG. */
  .apply-stage-btn {
    background: linear-gradient(135deg, #4cd1ff, #6f5cff);
    color: #fff;
    border: none;
    padding: 7px 14px;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.4px;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: 0 0 0 1px rgba(76,209,255,0.4), 0 2px 8px rgba(76,209,255,0.2);
  }
  .apply-stage-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #80dfff, #8a7aff);
    transform: scale(1.03);
    box-shadow: 0 0 0 1px #4cd1ff, 0 4px 14px rgba(76,209,255,0.35);
  }
  .apply-stage-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Binding card — shown in the inspector when a slice is linked to
     a mapping layer post-apply. */
  .binding-card {
    background: rgba(76,209,255,0.06);
    border: 1px solid rgba(76,209,255,0.25);
    border-radius: 5px;
    padding: 10px;
    margin-top: 4px;
  }
  .binding-label {
    font-size: 10.5px;
    letter-spacing: 1px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .binding-name {
    font-size: 14px;
    font-weight: 600;
    color: #4cd1ff;
    margin-bottom: 8px;
  }
  .binding-action {
    background: transparent;
    border: 1px solid #4cd1ff;
    color: #4cd1ff;
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    width: 100%;
  }
  .binding-action:hover {
    background: rgba(76,209,255,0.15);
    color: #fff;
  }
  .inspector-stat .muted { color: #555; font-style: italic; }
  .inspector-note strong { color: #4cd1ff; font-weight: 600; }

  /* ── Stage Effects panel ── */
  .effects-section {
    border-top: 1px solid #1d1d22;
    padding: 10px 12px 16px;
  }
  .effects-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    letter-spacing: 1.5px;
    color: #4cd1ff;
    text-transform: uppercase;
    margin-bottom: 10px;
    font-weight: 600;
  }
  .effects-count {
    color: #555;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-weight: normal;
  }

  .effects-pointer {
    font-size: 12px;
    color: #bbb;
    line-height: 1.6;
    padding: 10px 12px;
    background: rgba(76,209,255,0.05);
    border-left: 2px solid rgba(76,209,255,0.4);
    border-radius: 0 4px 4px 0;
  }
  .effects-pointer p {
    margin: 0 0 6px;
  }
  .effects-pointer strong {
    color: #4cd1ff;
    font-weight: 600;
  }
  .effects-catalog-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .effects-catalog-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
    color: var(--text-muted, #888);
    border-top: 1px solid rgba(76,209,255,0.08);
  }
  .effects-catalog-icon {
    color: #4cd1ff;
    font-size: 14px;
    width: 18px;
    text-align: center;
  }

  /* ─── Body ─── */
  .stage-body {
    flex: 1;
    display: grid;
    /* tool palette | slice list | canvas | inspector */
    grid-template-columns: 64px 220px 1fr 280px;
    min-height: 0;
  }

  /* ─── Tool palette (left) ─── */
  /* Always-visible vertical strip — Photoshop / Illustrator
     convention. Compact (64px wide) so it doesn't eat canvas
     space; icon + tiny label below each button so the user can
     identify tools without hovering for tooltips. */
  .tool-palette {
    background: #08080a;
    border-right: 1px solid #1d1d22;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 8px 6px;
    gap: 4px;
  }
  .palette-section {
    font-size: 10px;
    letter-spacing: 1.2px;
    color: #555;
    text-transform: uppercase;
    padding: 6px 4px 2px;
    text-align: center;
  }
  .palette-divider {
    height: 1px;
    background: #1d1d22;
    margin: 4px 4px;
  }
  .palette-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 6px 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-secondary, #aaa);
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.12s;
    min-height: 44px;
  }
  .palette-btn:hover {
    background: var(--bg-tertiary, #14141a);
    color: #fff;
    border-color: #2a2a30;
  }
  .palette-btn.active {
    background: rgba(76, 209, 255, 0.15);
    border-color: #4cd1ff;
    color: #4cd1ff;
  }
  .palette-btn .p-icon {
    font-size: 17px;
    line-height: 1;
  }
  .palette-btn .p-label {
    font-size: 10px;
    letter-spacing: 0.3px;
    font-weight: 500;
    color: var(--text-muted, #888);
  }
  .palette-btn:hover .p-label,
  .palette-btn.active .p-label {
    color: inherit;
  }
  .palette-btn.primary-btn {
    background: linear-gradient(180deg, rgba(76, 209, 255, 0.18), rgba(76, 209, 255, 0.06));
    border-color: rgba(76, 209, 255, 0.4);
    color: #b6e8ff;
  }
  .palette-btn.primary-btn:hover {
    background: linear-gradient(180deg, rgba(76, 209, 255, 0.32), rgba(76, 209, 255, 0.16));
    border-color: #4cd1ff;
    color: #fff;
  }
  .palette-btn.primary-btn .p-label {
    color: #b6e8ff;
    font-weight: 600;
  }

  /* ─── Slice list (left) ─── */
  .slice-list-panel {
    background: var(--bg-primary, #0a0a0c);
    border-right: 1px solid #1d1d22;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .panel-header {
    flex: 0 0 28px;
    padding: 6px 12px;
    font-size: 11px;
    letter-spacing: 1.5px;
    color: var(--text-muted, #888);
    background: #08080a;
    border-bottom: 1px solid #1d1d22;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .slice-count {
    color: #555;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
  .slice-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .slice-row {
    display: grid;
    grid-template-columns: 14px 1fr 22px 22px 22px;
    gap: 4px;
    align-items: center;
    padding: 4px 10px;
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .slice-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .slice-row.selected {
    background: rgba(76, 209, 255, 0.08);
    border-left-color: #4cd1ff;
  }
  .slice-row.selected.primary {
    background: rgba(76, 209, 255, 0.14);
  }
  .slice-color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .slice-name {
    font-size: 13px;
    color: var(--text-primary, #ccc);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slice-icon-btn {
    background: transparent;
    border: none;
    color: #555;
    cursor: pointer;
    font-size: 13px;
    padding: 2px;
    border-radius: 3px;
  }
  .slice-icon-btn.active {
    color: var(--text-secondary, #aaa);
  }
  .slice-icon-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }
  .slice-icon-btn.danger:hover {
    color: #ff8888;
  }
  .slice-empty {
    padding: 24px 12px;
    color: #555;
    font-size: 12px;
    line-height: 1.5;
    text-align: center;
  }

  /* ─── Design canvas ─── */
  .design-canvas {
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(45deg, #0c0c10 25%, transparent 25%), linear-gradient(-45deg, #0c0c10 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #0c0c10 75%), linear-gradient(-45deg, transparent 75%, #0c0c10 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
    background-color: #050507;
    cursor: default;
  }
  .design-canvas.tool-pen {
    cursor: crosshair;
  }
  .canvas-svg {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    /* Wrapper transform scales the SVG via width/height — keeps text
       and stroke widths legible at any zoom via the /zoom divisions
	       above. */
  }
  .slice-marquee {
    fill: rgba(76, 209, 255, 0.1);
    stroke: rgba(76, 209, 255, 0.85);
    stroke-dasharray: 6 4;
    pointer-events: none;
  }
  /* Empty-state card — replaces the previous tiny hint, gives users
     three actionable buttons + clear instructions to drop an SVG. */
  .canvas-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 1;
  }
  .empty-card {
    pointer-events: auto;
    background: rgba(10, 10, 14, 0.85);
    border: 1px solid #1d1d22;
    border-radius: 10px;
    padding: 32px 36px;
    text-align: center;
    max-width: 460px;
    backdrop-filter: blur(8px);
  }
  .empty-title {
    font-size: 19px;
    font-weight: 700;
    color: #4cd1ff;
    letter-spacing: 2px;
    margin: 0 0 6px;
  }
  .empty-sub {
    font-size: 14px;
    color: var(--text-secondary, #aaa);
    margin: 0 0 22px;
    line-height: 1.5;
  }
  .empty-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 18px;
  }
  .empty-btn {
    padding: 11px 18px;
    border-radius: 6px;
    border: 1px solid #2a2a30;
    background: var(--bg-tertiary, #14141a);
    color: var(--text-primary, #ddd);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .empty-btn:hover {
    background: #1c1c24;
    border-color: #4cd1ff;
    color: #fff;
  }
  .empty-btn.primary {
    background: linear-gradient(135deg, #4cd1ff, #6f5cff);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }
  .empty-btn.primary:hover {
    background: linear-gradient(135deg, #80dfff, #8a7aff);
    transform: scale(1.02);
  }
  .empty-hint {
    font-size: 12px;
    color: #777;
    margin: 0 0 4px;
  }
  .empty-shortcut {
    font-size: 11.5px;
    color: #555;
    margin: 0;
    letter-spacing: 0.3px;
  }

  /* Live drop overlay — shown while a file is being dragged over the
     canvas. The .drop-active class on the canvas root provides the
     dashed border accent; this is the centered card. */
  .design-canvas.drop-active {
    box-shadow: inset 0 0 0 3px rgba(76, 209, 255, 0.6);
  }
  .canvas-drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(76, 209, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
  }
  .drop-card {
    background: rgba(10, 10, 14, 0.95);
    border: 2px dashed #4cd1ff;
    border-radius: 12px;
    padding: 24px 40px;
    text-align: center;
    color: #4cd1ff;
  }
  .drop-icon {
    display: block;
    font-size: 33px;
    margin-bottom: 6px;
  }
  .drop-card p {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 1px;
  }

  /* ─── Inspector (right) ─── */
  .inspector-panel {
    background: var(--bg-primary, #0a0a0c);
    border-left: 1px solid #1d1d22;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .inspector-section {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .inspector-section label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    letter-spacing: 1px;
    color: var(--text-muted, #888);
  }
  .inspector-section label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    letter-spacing: 0;
    color: #bbb;
    text-transform: none;
  }
  .inspector-section input[type='text'] {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    border-radius: 3px;
    color: var(--text-primary, #ddd);
    padding: 5px 8px;
    font-size: 13px;
  }
  .inspector-section input[type='text']:focus {
    border-color: #4cd1ff;
    outline: none;
  }
  .inspector-section input[type='color'] {
    width: 100%;
    height: 28px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    border-radius: 3px;
  }
  .inspector-row {
    display: flex;
    gap: 12px;
  }
  .inspector-stat {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-muted, #888);
    padding: 4px 0;
    border-top: 1px solid #1a1a20;
  }
  .inspector-stat span:last-child {
    color: var(--text-primary, #ddd);
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
  .inspector-action {
    margin-top: 4px;
    background: transparent;
    border: 1px solid #2a2a30;
    color: var(--text-secondary, #aaa);
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .inspector-action:hover {
    border-color: #4cd1ff;
    color: #4cd1ff;
    background: rgba(76,209,255,0.06);
  }
  .inspector-note {
    font-size: 11px;
    color: #555;
    line-height: 1.5;
    padding: 8px;
    background: rgba(76,209,255,0.04);
    border-left: 2px solid rgba(76,209,255,0.3);
    margin-top: 8px;
  }
  .inspector-empty {
    padding: 24px 12px;
    color: #555;
    font-size: 12px;
    text-align: center;
  }
</style>
