<script context="module" lang="ts">
  import { writable } from 'svelte/store';
  import { createDefaultLightPaintingBrush as _createBrush } from '../types';
  // Module-level store shared across ALL instances (overlay + sidebar)
  export const _sharedBrush = writable(_createBrush());
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { project, selectedLightPaintingLayer, selectedLightPaintingContent, selectedLayerId } from '../stores/layers';
  import {
    createDefaultLightPaintingBrush,
    generateUUID,
    type LightPaintingBrush,
    type LightPaintingBrushType,
    type LightPaintingDrawMode,
    type LightPaintingLoopMode,
    type LightPaintingPenPoint,
    type LightPaintingStrokePoint,
  } from '../types';

  // Render mode: true = only draw overlay, false = only sidebar controls
  export let overlayOnly = false;

  export let viewportEl: HTMLElement | null = null;
  export let viewportPanX = 0;
  export let viewportPanY = 0;
  export let viewportZoom = 1;
  export let viewportWidth = 800;
  export let viewportHeight = 600;
  export let canvasOffsetX = 0;
  export let canvasOffsetY = 0;
  export let canvasWidth = 800;
  export let canvasHeight = 600;
  export let drawingEnabled = true;

  // currentBrush is synced via module-level sharedBrush store (see <script context="module">)
  let currentBrush: LightPaintingBrush = createDefaultLightPaintingBrush();
  const unsubBrush = _sharedBrush.subscribe(b => { currentBrush = b; });
  onDestroy(unsubBrush);
  let activeSection: 'brush' | 'animation' | 'effects' | 'strokes' = 'brush';
  let isDrawing = false;
  let currentStrokePoints: LightPaintingStrokePoint[] = [];
  let strokeStartTime = 0;
  let livePreviewPoints: { x: number; y: number }[] = [];
  let lastSmoothedPoint: { x: number; y: number } | null = null;

  let penPoints: LightPaintingPenPoint[] = [];
  let penPreviewPoint: { x: number; y: number } | null = null;
  let isDraggingHandle = false;

  // Full-width / full-height crosshair cursor that tracks the pointer over
  // the drawing overlay. Tiny native crosshairs make precise placement hard
  // (especially on dense compositions); these spanning guides make it
  // obvious where the next stroke will start.
  let cursorX: number | null = null;
  let cursorY: number | null = null;

  const colorPresets: [number, number, number][] = [
    [255, 160, 40],   [67, 232, 249],   [50, 100, 255],
    [255, 50, 150],   [50, 255, 100],   [180, 50, 255],
    [255, 50, 50],    [255, 255, 255],  [255, 220, 50],
    [0, 200, 180],    [255, 130, 200],  [100, 255, 200],
  ];

  const secondaryColorPresets: [number, number, number][] = [
    [67, 232, 249],   [255, 50, 150],   [50, 255, 100],
    [180, 50, 255],   [255, 100, 0],    [255, 255, 100],
  ];

  const brushTypes: { type: LightPaintingBrushType; label: string }[] = [
    { type: 'glow', label: 'Glow' },         { type: 'neon', label: 'Neon' },
    { type: 'flame', label: 'Flame' },       { type: 'electric', label: 'Electric' },
    { type: 'ribbon', label: 'Ribbon' },     { type: 'particle', label: 'Particle' },
    { type: 'smoke', label: 'Smoke' },       { type: 'laser', label: 'Laser' },
    { type: 'calligraphy', label: 'Callig.' }, { type: 'spray', label: 'Spray' },
    { type: 'paintbrush', label: 'Paint' },  { type: 'marker', label: 'Marker' },
    { type: 'watercolor', label: 'Water' },
  ];

  const loopModes: { mode: LightPaintingLoopMode; label: string }[] = [
    { mode: 'forward', label: 'Fwd' },    { mode: 'reverse', label: 'Rev' },
    { mode: 'pingpong', label: 'PP' },    { mode: 'once', label: '1x' },
  ];

  $: layer = $selectedLightPaintingLayer;
  $: content = $selectedLightPaintingContent;
  $: layerId = $selectedLayerId;
  $: strokeCount = content?.strokes?.length ?? 0;
  $: drawMode = content?.drawMode ?? 'freehand';
  $: livePreviewPath = buildSvgPath(livePreviewPoints);
  $: penPreviewSvg = buildPenPreviewSvg(penPoints, penPreviewPoint);
  $: brushColorRgb = `${currentBrush.color[0]},${currentBrush.color[1]},${currentBrush.color[2]}`;
  $: customColorHex = '#' + currentBrush.color.map(c => c.toString(16).padStart(2, '0')).join('');
  $: secondaryColorHex = currentBrush.secondaryColor
    ? '#' + currentBrush.secondaryColor.map(c => c.toString(16).padStart(2, '0')).join('')
    : '#43e8f9';

  function buildSvgPath(points: { x: number; y: number }[]): string {
    if (points.length < 2) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      if (i < points.length - 1) {
        const curr = points[i], next = points[i + 1];
        d += ` Q ${curr.x} ${curr.y} ${(curr.x + next.x) / 2} ${(curr.y + next.y) / 2}`;
      } else {
        d += ` L ${points[i].x} ${points[i].y}`;
      }
    }
    return d;
  }

  function buildPenPreviewSvg(anchors: LightPaintingPenPoint[], preview: { x: number; y: number } | null) {
    const dots: { x: number; y: number }[] = [];
    const handles: { x1: number; y1: number; x2: number; y2: number }[] = [];
    if (anchors.length === 0) return { path: '', dots, handles };
    const toPixel = (nx: number, ny: number) => ({
      x: (nx * canvasWidth + canvasOffsetX) * viewportZoom + viewportPanX,
      y: (ny * canvasHeight + canvasOffsetY) * viewportZoom + viewportPanY,
    });
    let d = '';
    for (let i = 0; i < anchors.length; i++) {
      const ap = toPixel(anchors[i].x, anchors[i].y);
      dots.push(ap);
      if (i === 0) { d = `M ${ap.x} ${ap.y}`; }
      else {
        const prev = anchors[i - 1], prevP = toPixel(prev.x, prev.y);
        const cp1 = prev.handleOut ? toPixel(prev.handleOut.x, prev.handleOut.y) : prevP;
        const cp2 = anchors[i].handleIn ? toPixel(anchors[i].handleIn!.x, anchors[i].handleIn!.y) : ap;
        d += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${ap.x} ${ap.y}`;
      }
      if (anchors[i].handleIn) { const hp = toPixel(anchors[i].handleIn!.x, anchors[i].handleIn!.y); handles.push({ x1: ap.x, y1: ap.y, x2: hp.x, y2: hp.y }); }
      if (anchors[i].handleOut) { const hp = toPixel(anchors[i].handleOut!.x, anchors[i].handleOut!.y); handles.push({ x1: ap.x, y1: ap.y, x2: hp.x, y2: hp.y }); }
    }
    if (preview && anchors.length > 0) {
      const last = anchors[anchors.length - 1], lastP = toPixel(last.x, last.y);
      const cp1 = last.handleOut ? toPixel(last.handleOut.x, last.handleOut.y) : lastP;
      d += ` C ${cp1.x} ${cp1.y} ${preview.x} ${preview.y} ${preview.x} ${preview.y}`;
    }
    return { path: d, dots, handles };
  }

  function getCanvasCoords(e: PointerEvent | MouseEvent) {
    // Always use the overlay element (currentTarget) for coordinate conversion —
    // viewportEl may include toolbar area causing a Y offset mismatch
    const el = (e.currentTarget as HTMLElement) ?? viewportEl;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    // Convert screen coords → viewport-local → subtract pan → un-zoom → subtract canvas offset → normalize to 0-1
    const vx = (e.clientX - rect.left - viewportPanX) / viewportZoom - canvasOffsetX;
    const vy = (e.clientY - rect.top - viewportPanY) / viewportZoom - canvasOffsetY;
    return { x: vx / canvasWidth, y: vy / canvasHeight };
  }

  function getOverlayPixelCoords(e: PointerEvent | MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function penPointsToStrokePoints(anchors: LightPaintingPenPoint[], sps = 40): LightPaintingStrokePoint[] {
    if (anchors.length < 2) return [];
    const pts: LightPaintingStrokePoint[] = [], ts = anchors.length - 1, dur = ts * 500;
    for (let seg = 0; seg < ts; seg++) {
      const a = anchors[seg], b = anchors[seg + 1];
      const c1x = a.handleOut?.x ?? a.x, c1y = a.handleOut?.y ?? a.y, c2x = b.handleIn?.x ?? b.x, c2y = b.handleIn?.y ?? b.y;
      for (let s = 0; s <= sps; s++) {
        if (seg > 0 && s === 0) continue;
        const t = s / sps, m = 1 - t;
        pts.push({ x: m*m*m*a.x+3*m*m*t*c1x+3*m*t*t*c2x+t*t*t*b.x, y: m*m*m*a.y+3*m*m*t*c1y+3*m*t*t*c2y+t*t*t*b.y, pressure: 0.5, timestamp: (seg+t)/ts*dur });
      }
    }
    return pts;
  }

  // === SMOOTHING HELPERS ===
  function chaikinSmooth(pts: LightPaintingStrokePoint[]): LightPaintingStrokePoint[] {
    if (pts.length < 3) return pts;
    const result: LightPaintingStrokePoint[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      result.push({
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25,
        pressure: p0.pressure * 0.75 + p1.pressure * 0.25,
        timestamp: p0.timestamp * 0.75 + p1.timestamp * 0.25,
      });
      result.push({
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75,
        pressure: p0.pressure * 0.25 + p1.pressure * 0.75,
        timestamp: p0.timestamp * 0.25 + p1.timestamp * 0.75,
      });
    }
    result.push(pts[pts.length - 1]);
    return result;
  }

  function resamplePoints(pts: LightPaintingStrokePoint[], maxCount: number): LightPaintingStrokePoint[] {
    if (pts.length <= maxCount) return pts;
    const result: LightPaintingStrokePoint[] = [];
    const step = (pts.length - 1) / (maxCount - 1);
    for (let i = 0; i < maxCount; i++) {
      const idx = i * step;
      const lo = Math.floor(idx), hi = Math.min(lo + 1, pts.length - 1);
      const t = idx - lo;
      result.push({
        x: pts[lo].x + (pts[hi].x - pts[lo].x) * t,
        y: pts[lo].y + (pts[hi].y - pts[lo].y) * t,
        pressure: pts[lo].pressure + (pts[hi].pressure - pts[lo].pressure) * t,
        timestamp: pts[lo].timestamp + (pts[hi].timestamp - pts[lo].timestamp) * t,
      });
    }
    return result;
  }

  // === DRAWING ===
  function startStroke(e: PointerEvent) {
    if (!layer || !content || drawMode === 'pen') return;
    // Deselect any selected stroke when starting a new one
    if (isEditingStroke) deselectStroke();
    const coords = getCanvasCoords(e), pixel = getOverlayPixelCoords(e);
    isDrawing = true; strokeStartTime = performance.now();
    currentStrokePoints = [{ x: coords.x, y: coords.y, pressure: (e as any).pressure ?? 0.5, timestamp: 0 }];
    lastSmoothedPoint = { x: coords.x, y: coords.y };
    livePreviewPoints = [pixel];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (layerId) project.updateLightPaintingContent(layerId, { isRecording: true });
  }

  function continueStroke(e: PointerEvent) {
    if (drawMode === 'pen') { penPreviewPoint = getOverlayPixelCoords(e); return; }
    if (!isDrawing) return;
    const coords = getCanvasCoords(e), pixel = getOverlayPixelCoords(e);
    const smoothing = currentBrush.smoothing ?? 0.5;

    // Exponential moving average smoothing (Procreate StreamLine)
    let sx: number, sy: number;
    if (smoothing > 0 && lastSmoothedPoint) {
      const alpha = 1 - smoothing * 0.85; // never fully zero
      sx = lastSmoothedPoint.x + (coords.x - lastSmoothedPoint.x) * alpha;
      sy = lastSmoothedPoint.y + (coords.y - lastSmoothedPoint.y) * alpha;
    } else {
      sx = coords.x;
      sy = coords.y;
    }
    lastSmoothedPoint = { x: sx, y: sy };

    // Minimum distance filter: skip points too close together (prevents clustering at slow speeds)
    const minDist = 0.002; // ~2px at 1000px canvas
    const lastPt = currentStrokePoints[currentStrokePoints.length - 1];
    const dx = sx - lastPt.x, dy = sy - lastPt.y;
    if (dx * dx + dy * dy < minDist * minDist) return;

    currentStrokePoints.push({ x: sx, y: sy, pressure: (e as any).pressure ?? 0.5, timestamp: performance.now() - strokeStartTime });
    // Use overlay pixel coords for live SVG preview (matches getOverlayPixelCoords space)
    const overlayPixel = getOverlayPixelCoords(e);
    livePreviewPoints = [...livePreviewPoints, overlayPixel];

    // Write in-progress stroke to the store so the output window can
    // render it in real-time via BroadcastChannel state sync.
    if (layerId && currentStrokePoints.length % 3 === 0) {
      project.updateLightPaintingContent(layerId, {
        livePreviewStroke: {
          points: [...currentStrokePoints],
          brush: { ...currentBrush },
        },
      });
    }
  }

  function endStroke() {
    if (drawMode === 'pen') return;
    if (!isDrawing || !layerId || currentStrokePoints.length < 2) { isDrawing = false; currentStrokePoints = []; livePreviewPoints = []; lastSmoothedPoint = null; return; }

    // Post-capture Chaikin corner-cutting refinement
    const smoothing = currentBrush.smoothing ?? 0.5;
    let finalPoints = [...currentStrokePoints];
    const passes = Math.ceil(smoothing * 3); // 0-3 passes based on smoothing level
    for (let p = 0; p < passes; p++) {
      finalPoints = chaikinSmooth(finalPoints);
    }
    // Cap point count to bound memory (higher limit to preserve smooth curves)
    finalPoints = resamplePoints(finalPoints, 800);

    project.addLightPaintingStroke(layerId, { id: generateUUID(), points: finalPoints, brush: { ...currentBrush }, duration: performance.now() - strokeStartTime, visible: true, locked: false, drawMode: 'freehand' });
    project.updateLightPaintingContent(layerId, { isRecording: false, livePreviewStroke: null });
    isDrawing = false; currentStrokePoints = []; livePreviewPoints = []; lastSmoothedPoint = null;
  }

  function handlePenClick(e: PointerEvent) {
    if (drawMode !== 'pen' || !layer || !content || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    penPoints = [...penPoints, { x: getCanvasCoords(e).x, y: getCanvasCoords(e).y, handleIn: null, handleOut: null }];
    isDraggingHandle = true;
  }

  function handlePenDrag(e: PointerEvent) {
    if (!isDraggingHandle || penPoints.length === 0) return;
    const coords = getCanvasCoords(e), last = penPoints[penPoints.length - 1];
    const dx = coords.x - last.x, dy = coords.y - last.y;
    const updated = [...penPoints];
    updated[updated.length - 1] = { ...last, handleOut: { x: last.x + dx, y: last.y + dy }, handleIn: { x: last.x - dx, y: last.y - dy } };
    penPoints = updated;
  }

  function finishPenPath() {
    if (!layerId || penPoints.length < 2) { penPoints = []; penPreviewPoint = null; return; }
    const pts = penPointsToStrokePoints(penPoints);
    if (pts.length < 2) { penPoints = []; penPreviewPoint = null; return; }
    project.addLightPaintingStroke(layerId, { id: generateUUID(), points: pts, brush: { ...currentBrush }, duration: Math.max(pts[pts.length - 1].timestamp, 500), visible: true, locked: false, drawMode: 'pen', penPoints: [...penPoints] });
    penPoints = []; penPreviewPoint = null;
  }

  // === STROKE SELECTION & LIVE EDITING ===
  $: selectedStrokeId = content?.selectedStrokeId ?? null;
  $: selectedStroke = content?.strokes.find(s => s.id === selectedStrokeId) ?? null;

  // Track whether we're editing vs drawing (to avoid pushing brush changes during draw)
  let isEditingStroke = false;

  function selectStroke(strokeId: string | null) {
    if (!layerId) return;
    project.updateLightPaintingContent(layerId, { selectedStrokeId: strokeId });
    if (strokeId) {
      const stroke = content?.strokes.find(s => s.id === strokeId);
      if (stroke) {
        // Load the stroke's brush into the panel
        isEditingStroke = true;
        _sharedBrush.set({ ...stroke.brush });
        // Switch to brush tab so user can see/edit settings
        activeSection = 'brush';
      }
    } else {
      isEditingStroke = false;
    }
  }

  function deselectStroke() {
    selectStroke(null);
    isEditingStroke = false;
  }

  // Push brush changes to the selected stroke in real-time
  function updateBrushAndMaybeStroke(newBrush: LightPaintingBrush) {
    _sharedBrush.set(newBrush);
    if (isEditingStroke && selectedStrokeId && layerId) {
      project.updateLightPaintingStrokeBrush(layerId, selectedStrokeId, newBrush);
    }
  }

  function setBrushType(type: LightPaintingBrushType) { updateBrushAndMaybeStroke({ ...currentBrush, type }); }
  function setColor(color: [number, number, number]) { updateBrushAndMaybeStroke({ ...currentBrush, color }); }
  function setSecondaryColor(color: [number, number, number] | null) { updateBrushAndMaybeStroke({ ...currentBrush, secondaryColor: color }); }
  function setDrawMode(mode: LightPaintingDrawMode) {
    if (!layerId) return;
    if (drawMode === 'pen' && penPoints.length > 1) finishPenPath();
    penPoints = []; penPreviewPoint = null;
    project.updateLightPaintingContent(layerId, { drawMode: mode });
  }
  function setLoopMode(mode: LightPaintingLoopMode) { if (layerId) project.updateLightPaintingContent(layerId, { loopMode: mode }); }
  function togglePlayback() { if (layerId && content) project.updateLightPaintingContent(layerId, { isPlaying: !content.isPlaying }); }
  function clearAllStrokes() { if (layerId) project.clearLightPaintingStrokes(layerId); }
  function removeStroke(strokeId: string) { if (layerId) project.removeLightPaintingStroke(layerId, strokeId); }
  function updateSetting(key: string, value: number | boolean) { if (layerId) project.updateLightPaintingContent(layerId, { [key]: value }); }

  function handleCustomColor(e: Event) { const h = (e.target as HTMLInputElement).value; setColor([parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]); }
  function handleCustomSecondaryColor(e: Event) { const h = (e.target as HTMLInputElement).value; setSecondaryColor([parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]); }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && drawMode === 'pen' && penPoints.length > 0) { penPoints = []; penPreviewPoint = null; e.preventDefault(); }
    if (e.key === 'Enter' && drawMode === 'pen' && penPoints.length > 1) { finishPenPath(); e.preventDefault(); }
  }

  function handleOverlayContextMenu(e: MouseEvent) {
    if (drawMode === 'pen') { e.preventDefault(); if (penPoints.length > 1) finishPenPath(); else { penPoints = []; penPreviewPoint = null; } }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if layer && content}
  <!-- ============ OVERLAY MODE (inside viewport) ============ -->
  {#if overlayOnly}
    <div
      class="lp-draw-overlay"
      class:recording={isDrawing}
      class:pen-mode={drawMode === 'pen'}
      onpointerdown={(e) => { const p = getOverlayPixelCoords(e); cursorX = p.x; cursorY = p.y; if (drawMode === 'pen') handlePenClick(e); else startStroke(e); }}
      onpointermove={(e) => { const p = getOverlayPixelCoords(e); cursorX = p.x; cursorY = p.y; if (drawMode === 'pen' && isDraggingHandle) handlePenDrag(e); else continueStroke(e); }}
      onpointerup={() => { if (drawMode === 'pen') { isDraggingHandle = false; } else endStroke(); }}
      onpointerleave={() => { cursorX = null; cursorY = null; if (drawMode !== 'pen') endStroke(); }}
      oncontextmenu={handleOverlayContextMenu}
      role="application"
      aria-label="Light painting canvas"
    >
      <svg class="lp-preview-svg">
        <!-- Full-overlay crosshair guide. Two lines (vertical + horizontal)
             span the entire drawing area at the pointer position so the user
             can land brush strokes precisely. White core + dark drop-shadow
             so it's visible against bright AND dark scenes. Hidden when the
             pointer leaves the overlay. -->
        {#if cursorX !== null && cursorY !== null}
          <line x1={cursorX} y1="0" x2={cursorX} y2="100%" stroke="rgba(0,0,0,0.6)" stroke-width="3" pointer-events="none" />
          <line x1="0" y1={cursorY} x2="100%" y2={cursorY} stroke="rgba(0,0,0,0.6)" stroke-width="3" pointer-events="none" />
          <line x1={cursorX} y1="0" x2={cursorX} y2="100%" stroke="rgba(255,255,255,0.85)" stroke-width="1" pointer-events="none" />
          <line x1="0" y1={cursorY} x2="100%" y2={cursorY} stroke="rgba(255,255,255,0.85)" stroke-width="1" pointer-events="none" />
          <circle cx={cursorX} cy={cursorY} r={Math.max(4, currentBrush.size * 0.35)} fill="none" stroke="rgba(0,0,0,0.7)" stroke-width="2" pointer-events="none" />
          <circle cx={cursorX} cy={cursorY} r={Math.max(4, currentBrush.size * 0.35)} fill="none" stroke="rgba({brushColorRgb},0.95)" stroke-width="1" pointer-events="none" />
        {/if}
        {#if drawMode === 'freehand' && isDrawing && livePreviewPath}
          <path d={livePreviewPath} fill="none" stroke="rgba({brushColorRgb},{currentBrush.opacity * 0.3})"
            stroke-width={currentBrush.size * 1.5} stroke-linecap="round" stroke-linejoin="round" filter="url(#lp-glow)" />
          <path d={livePreviewPath} fill="none" stroke="rgba({brushColorRgb},{currentBrush.opacity * 0.8})"
            stroke-width={Math.max(2, currentBrush.size * 0.4)} stroke-linecap="round" stroke-linejoin="round" />
          <path d={livePreviewPath} fill="none" stroke="rgba(255,255,255,{currentBrush.opacity * 0.6})"
            stroke-width={Math.max(1, currentBrush.size * 0.15)} stroke-linecap="round" stroke-linejoin="round" />
        {/if}
        {#if drawMode === 'pen' && penPreviewSvg.path}
          <path d={penPreviewSvg.path} fill="none" stroke="rgba({brushColorRgb},0.6)"
            stroke-width={Math.max(2, currentBrush.size * 0.3)} stroke-linecap="round" stroke-linejoin="round" />
          <path d={penPreviewSvg.path} fill="none" stroke="rgba(255,255,255,0.4)"
            stroke-width={Math.max(1, currentBrush.size * 0.1)} stroke-linecap="round" stroke-linejoin="round" />
          {#each penPreviewSvg.handles as h}
            <line x1={h.x1} y1={h.y1} x2={h.x2} y2={h.y2} stroke="rgba(103,232,249,0.5)" stroke-width="1" />
            <circle cx={h.x2} cy={h.y2} r="3" fill="#BB86FC" opacity="0.7" />
          {/each}
          {#each penPreviewSvg.dots as dot}
            <circle cx={dot.x} cy={dot.y} r="4" fill="none" stroke="#fff" stroke-width="1.5" />
            <circle cx={dot.x} cy={dot.y} r="2" fill="rgba({brushColorRgb},0.9)" />
          {/each}
        {/if}
        <defs>
          <filter id="lp-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={currentBrush.glow * 6} result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
      </svg>

      {#if strokeCount === 0 && !isDrawing && penPoints.length === 0}
        <div class="draw-hint">
          {#if drawMode === 'pen'}Click to place points - Drag for curves - Enter to finish
          {:else}Click and drag to paint light trails{/if}
        </div>
      {/if}
      {#if isDrawing}<div class="status-pill rec">REC</div>{/if}
      {#if drawMode === 'pen' && penPoints.length > 0}
        <div class="status-pill pen">{penPoints.length} pts - Enter to finish</div>
      {/if}
    </div>
  {/if}

  <!-- ============ SIDEBAR MODE (outside viewport, right panel) ============ -->
  {#if !overlayOnly}
    <div class="lp-sidebar">
      <!-- Header -->
      <div class="lp-header">
        <span class="lp-title">Light Painting</span>
      </div>

      <!-- Draw / Edit toggle -->
      <div class="lp-row">
        <span class="row-label">Mode</span>
        <div class="mode-btns">
          <button class:active={drawingEnabled} onclick={() => drawingEnabled = true}>Draw</button>
          <button class:active={!drawingEnabled} onclick={() => drawingEnabled = false}>Edit</button>
        </div>
      </div>

      <!-- Draw mode -->
      {#if drawingEnabled}
      <div class="lp-row">
        <span class="row-label">Tool</span>
        <div class="mode-btns">
          <button class:active={drawMode === 'freehand'} onclick={() => setDrawMode('freehand')}>Freehand</button>
          <button class:active={drawMode === 'pen'} onclick={() => setDrawMode('pen')}>Pen</button>
        </div>
      </div>
      {/if}

      <!-- Playback -->
      <div class="lp-row">
        <button class="play-btn" class:playing={content.isPlaying} onclick={togglePlayback}>
          {#if content.isPlaying}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          {:else}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          {/if}
        </button>
        {#each loopModes as lm}
          <button class="loop-btn" class:active={content.loopMode === lm.mode} onclick={() => setLoopMode(lm.mode)}>{lm.label}</button>
        {/each}
        {#if strokeCount > 0}<span class="stroke-badge">{strokeCount}</span>{/if}
      </div>

      <!-- Tabs -->
      <div class="lp-tabs">
        <button class:active={activeSection === 'brush'} onclick={() => activeSection = 'brush'}>Brush</button>
        <button class:active={activeSection === 'animation'} onclick={() => activeSection = 'animation'}>Anim</button>
        <button class:active={activeSection === 'effects'} onclick={() => activeSection = 'effects'}>FX</button>
        <button class:active={activeSection === 'strokes'} onclick={() => activeSection = 'strokes'}>Strokes</button>
      </div>

      <!-- Content -->
      <div class="lp-content">
        {#if activeSection === 'brush'}
          <div class="sec-label">Brush Type</div>
          <div class="brush-grid">
            {#each brushTypes as bt}
              <button class="brush-btn" class:active={currentBrush.type === bt.type} onclick={() => setBrushType(bt.type)}>{bt.label}</button>
            {/each}
          </div>

          <div class="sec-label">Color</div>
          <div class="color-grid">
            {#each colorPresets as cp}
              <button class="color-dot"
                class:active={currentBrush.color[0]===cp[0] && currentBrush.color[1]===cp[1] && currentBrush.color[2]===cp[2]}
                style="background:rgb({cp[0]},{cp[1]},{cp[2]}); box-shadow:0 0 8px rgba({cp[0]},{cp[1]},{cp[2]},0.4)"
                onclick={() => setColor(cp)} />
            {/each}
            <input type="color" class="color-picker" value={customColorHex} onchange={handleCustomColor} title="Custom" />
          </div>

          <div class="sec-label">
            Secondary Glow
            <button class="mini-toggle" class:on={currentBrush.secondaryColor !== null}
              onclick={() => setSecondaryColor(currentBrush.secondaryColor ? null : [67, 232, 249])}>
              {currentBrush.secondaryColor ? 'ON' : 'OFF'}
            </button>
          </div>
          {#if currentBrush.secondaryColor}
            <div class="color-grid">
              {#each secondaryColorPresets as cp}
                <button class="color-dot sm"
                  class:active={currentBrush.secondaryColor && currentBrush.secondaryColor[0]===cp[0] && currentBrush.secondaryColor[1]===cp[1] && currentBrush.secondaryColor[2]===cp[2]}
                  style="background:rgb({cp[0]},{cp[1]},{cp[2]})"
                  onclick={() => setSecondaryColor(cp)} />
              {/each}
              <input type="color" class="color-picker sm" value={secondaryColorHex} onchange={handleCustomSecondaryColor} />
            </div>
          {/if}

          <div class="sec-label">Settings</div>
          <div class="slider-col">
            <div class="sc"><label>Size <b>{currentBrush.size}</b></label><input type="range" min="1" max="100" step="1" value={currentBrush.size} oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, size: parseInt((e.target as HTMLInputElement).value) })} /></div>
            <div class="sc"><label>Glow <b>{currentBrush.glow.toFixed(1)}</b></label><input type="range" min="0" max="5" step="0.1" value={currentBrush.glow} oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, glow: parseFloat((e.target as HTMLInputElement).value) })} /></div>
            <div class="sc"><label>Softness <b>{currentBrush.softness.toFixed(1)}</b></label><input type="range" min="0" max="1" step="0.05" value={currentBrush.softness} oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, softness: parseFloat((e.target as HTMLInputElement).value) })} /></div>
            <div class="sc"><label>Jitter <b>{currentBrush.jitter.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={currentBrush.jitter} oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, jitter: parseFloat((e.target as HTMLInputElement).value) })} /></div>
            <div class="sc"><label>Opacity <b>{currentBrush.opacity.toFixed(2)}</b></label><input type="range" min="0.05" max="1" step="0.01" value={currentBrush.opacity} oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, opacity: parseFloat((e.target as HTMLInputElement).value) })} /></div>
            <div class="sc"><label>Smooth <b>{(currentBrush.smoothing ?? 0.5).toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={currentBrush.smoothing} oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, smoothing: parseFloat((e.target as HTMLInputElement).value) })} /></div>
            <div class="sc"><label>Speed <b>{(currentBrush.speed ?? 1).toFixed(2)}</b></label><input type="range" min="0.1" max="5" step="0.05" value={currentBrush.speed ?? 1} oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, speed: parseFloat((e.target as HTMLInputElement).value) })} /></div>
          </div>
          <div class="check-row">
            <label><input type="checkbox" checked={currentBrush.taper} onchange={(e) => updateBrushAndMaybeStroke({ ...currentBrush, taper: (e.target as HTMLInputElement).checked })} /> Taper</label>
            <label><input type="checkbox" checked={currentBrush.pressureSensitive} onchange={(e) => updateBrushAndMaybeStroke({ ...currentBrush, pressureSensitive: (e.target as HTMLInputElement).checked })} /> Pressure</label>
          </div>

        {:else if activeSection === 'animation'}
          <div class="sec-label">Timing</div>
          <div class="slider-col">
            <div class="sc"><label>Speed <b>{content.animationSpeed.toFixed(1)}x</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.animationSpeed} oninput={(e) => updateSetting('animationSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Draw Speed <b>{content.drawSpeed.toFixed(1)}x</b></label><input type="range" min="0.1" max="10" step="0.1" value={content.drawSpeed} oninput={(e) => updateSetting('drawSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Trail Length <b>{content.trailLength.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.trailLength} oninput={(e) => updateSetting('trailLength', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>

          <div class="sec-label">Stagger</div>
          <div class="check-row">
            <label><input type="checkbox" checked={content.staggerStrokes} onchange={(e) => updateSetting('staggerStrokes', (e.target as HTMLInputElement).checked)} /> Stagger strokes sequentially</label>
          </div>
          {#if content.staggerStrokes}
            <div class="slider-col">
              <div class="sc"><label>Stagger Delay <b>{content.staggerDelay}ms</b></label><input type="range" min="0" max="2000" step="50" value={content.staggerDelay} oninput={(e) => updateSetting('staggerDelay', parseInt((e.target as HTMLInputElement).value))} /></div>
            </div>
          {/if}

          <div class="sec-label">Snake</div>
          <div class="slider-col">
            <div class="sc"><label>Head Size <b>{content.snake.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.snake} oninput={(e) => updateSetting('snake', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Snake Speed <b>{content.snakeSpeed.toFixed(1)}x</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.snakeSpeed} oninput={(e) => updateSetting('snakeSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>

        {:else if activeSection === 'effects'}
          <div class="sec-label">Glow & Light</div>
          <div class="slider-col">
            <div class="sc"><label>Bloom <b>{content.bloom.toFixed(1)}</b></label><input type="range" min="0" max="3" step="0.1" value={content.bloom} oninput={(e) => updateSetting('bloom', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Afterglow <b>{content.afterglow.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.afterglow} oninput={(e) => updateSetting('afterglow', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Motion Blur <b>{content.motionBlur.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.motionBlur} oninput={(e) => updateSetting('motionBlur', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>

          <div class="sec-label">Color</div>
          <div class="slider-col">
            <div class="sc"><label>Hue Shift <b>{content.colorShift.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.colorShift} oninput={(e) => updateSetting('colorShift', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>
          <div class="check-row"><label><input type="checkbox" checked={content.multiColorGlow} onchange={(e) => updateSetting('multiColorGlow', (e.target as HTMLInputElement).checked)} /> Multi-Color Glow</label></div>

          <div class="sec-label">Echo Lines</div>
          <div class="slider-col">
            <div class="sc"><label>Echo Count <b>{content.echo}</b></label><input type="range" min="0" max="10" step="1" value={content.echo} oninput={(e) => updateSetting('echo', parseInt((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Echo Offset <b>{content.echoOffset.toFixed(2)}</b></label><input type="range" min="0.01" max="0.2" step="0.005" value={content.echoOffset} oninput={(e) => updateSetting('echoOffset', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Echo Decay <b>{content.echoDecay.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.echoDecay} oninput={(e) => updateSetting('echoDecay', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>

          <div class="sec-label">Pulse & Strobe</div>
          <div class="slider-col">
            <div class="sc"><label>Pulse <b>{content.pulse.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.pulse} oninput={(e) => updateSetting('pulse', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Pulse Speed <b>{content.pulseSpeed.toFixed(1)}</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.pulseSpeed} oninput={(e) => updateSetting('pulseSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Strobe <b>{content.strobe.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.strobe} oninput={(e) => updateSetting('strobe', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>

          <div class="sec-label">Distortion</div>
          <div class="slider-col">
            <div class="sc"><label>Wave <b>{content.wave.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.wave} oninput={(e) => updateSetting('wave', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Wave Freq <b>{content.waveFreq.toFixed(1)}</b></label><input type="range" min="0.5" max="10" step="0.5" value={content.waveFreq} oninput={(e) => updateSetting('waveFreq', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Wave Speed <b>{content.waveSpeed.toFixed(1)}</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.waveSpeed} oninput={(e) => updateSetting('waveSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>

          <div class="sec-label">Particles & Dynamics</div>
          <div class="slider-col">
            <div class="sc"><label>Sparkle <b>{content.sparkle.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.sparkle} oninput={(e) => updateSetting('sparkle', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Flicker <b>{content.flicker.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.flicker} oninput={(e) => updateSetting('flicker', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Breathe <b>{content.breathe.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.breathe} oninput={(e) => updateSetting('breathe', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Breathe Speed <b>{content.breatheSpeed.toFixed(1)}</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.breatheSpeed} oninput={(e) => updateSetting('breatheSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>

        {:else if activeSection === 'strokes'}
          {#if isEditingStroke && selectedStroke}
            <div class="editing-banner">
              <span>Editing: <b>Stroke {(content.strokes.findIndex(s => s.id === selectedStrokeId) ?? 0) + 1}</b> — {selectedStroke.brush.type}</span>
              <button class="done-btn" onclick={deselectStroke}>Done</button>
            </div>
          {/if}
          {#if content.strokes.length === 0}
            <div class="empty-msg">No strokes yet. Draw on the canvas to add strokes.</div>
          {:else}
            <div class="strokes-list">
              {#each content.strokes as stroke, i}
                <div class="stroke-row" class:selected={stroke.id === selectedStrokeId}
                  onclick={() => selectStroke(stroke.id === selectedStrokeId ? null : stroke.id)}>
                  <div class="stroke-dot" style="background:rgb({stroke.brush.color[0]},{stroke.brush.color[1]},{stroke.brush.color[2]}); box-shadow:0 0 6px rgba({stroke.brush.color[0]},{stroke.brush.color[1]},{stroke.brush.color[2]},0.5)"></div>
                  <div class="stroke-info">
                    <span class="sname">{stroke.drawMode === 'pen' ? 'Pen ' : ''}Stroke {i+1}</span>
                    <span class="smeta">{stroke.brush.type} / size {stroke.brush.size} / {stroke.points.length} pts</span>
                  </div>
                  <button class="del-btn" onclick={(e) => { e.stopPropagation(); removeStroke(stroke.id); }}>X</button>
                </div>
              {/each}
            </div>
            <button class="clear-btn" onclick={clearAllStrokes}>Clear All Strokes</button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
{/if}

<style>
  /* ====== OVERLAY (inside viewport) ====== */
  .lp-draw-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 50; cursor: none; touch-action: none; }
  .lp-draw-overlay.recording { cursor: none; }
  .lp-draw-overlay.pen-mode { cursor: crosshair; }
  .lp-preview-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .draw-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: rgba(255,255,255,0.25); font-size: 13px; pointer-events: none; text-align: center; max-width: 300px; }
  .status-pill { position: absolute; top: 10px; left: 10px; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; pointer-events: none; }
  .status-pill.rec { background: rgba(255,50,50,0.85); color: #fff; animation: pulse-rec 1s infinite; }
  .status-pill.pen { background: rgba(103,232,249,0.85); color: #000; }
  @keyframes pulse-rec { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

  /* ====== SIDEBAR ====== */
  .lp-sidebar {
    width: 100%;
    background: #141416;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
  }

  .lp-header {
    padding: 10px 12px 8px;
    border-bottom: 1px solid #161618;
  }
  .lp-title { font-size: 13px; font-weight: 700; color: #BB86FC; letter-spacing: 0.5px; }

  /* Draw mode & playback rows */
  .lp-row {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid #222;
  }
  .row-label { font-size: 11px; color: #888; font-weight: 600; }

  .mode-btns { display: flex; border: 1px solid #444; border-radius: 5px; overflow: hidden; }
  .mode-btns button {
    background: transparent; border: none; color: #888;
    padding: 4px 12px; font-size: 11px; font-weight: 600; cursor: pointer;
  }
  .mode-btns button:hover { color: #ddd; background: rgba(255,255,255,0.04); }
  .mode-btns button.active { color: #BB86FC; background: rgba(103,232,249,0.1); }
  .mode-btns button + button { border-left: 1px solid #444; }

  .play-btn {
    background: #161618; border: 1px solid #444; color: #eee;
    width: 26px; height: 26px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
  }
  .play-btn:hover { background: #333; }
  .play-btn.playing { background: #BB86FC; color: #000; border-color: #BB86FC; }

  .loop-btn {
    background: #222; border: 1px solid #3a3a3a; color: #888;
    padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;
  }
  .loop-btn:hover { color: #ccc; border-color: #555; }
  .loop-btn.active { color: #BB86FC; border-color: #BB86FC; background: rgba(103,232,249,0.08); }

  .stroke-badge {
    background: #BB86FC; color: #000; font-size: 9px; font-weight: 700;
    padding: 1px 5px; border-radius: 8px; margin-left: auto;
  }

  /* Tabs */
  .lp-tabs { display: flex; border-bottom: 1px solid #161618; flex-shrink: 0; }
  .lp-tabs button {
    flex: 1; background: none; border: none; color: #666;
    padding: 7px 4px; font-size: 11px; font-weight: 600; cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .lp-tabs button:hover { color: #aaa; }
  .lp-tabs button.active { color: #BB86FC; border-bottom-color: #BB86FC; }

  /* Content */
  .lp-content { padding: 8px 12px; overflow-y: auto; flex: 1; }

  /* Section labels */
  .sec-label {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.4px;
    margin: 10px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #222;
  }
  .sec-label:first-child { margin-top: 0; }

  /* Full-width slider column */
  .slider-col { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
  .sc { display: flex; flex-direction: column; }
  .sc label {
    font-size: 11px; color: #bbb; margin-bottom: 4px; display: flex; align-items: baseline;
  }
  .sc label b { color: #BB86FC; font-family: monospace; font-size: 11px; font-weight: 400; margin-left: auto; }
  .sc input[type="range"] {
    width: 100%; height: 4px; appearance: none; background: #333; border-radius: 2px; outline: none;
  }
  .sc input[type="range"]::-webkit-slider-thumb {
    appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: #BB86FC; cursor: pointer; border: 2px solid #141416;
  }

  /* Brush grid */
  .brush-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px; }
  .brush-btn {
    background: #0d0d10; border: 1px solid #333; color: #aaa;
    border-radius: 5px; padding: 6px 2px; font-size: 10px; font-weight: 600;
    cursor: pointer; text-align: center;
  }
  .brush-btn:hover { background: #161618; color: #eee; border-color: #555; }
  .brush-btn.active { background: rgba(103,232,249,0.1); color: #BB86FC; border-color: #BB86FC; }

  /* Color grid */
  .color-grid { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
  .color-dot {
    width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer;
  }
  .color-dot.sm { width: 18px; height: 18px; }
  .color-dot:hover { transform: scale(1.15); }
  .color-dot.active { border-color: #fff; transform: scale(1.1); }
  .color-picker { width: 22px; height: 22px; border: none; border-radius: 50%; cursor: pointer; background: none; padding: 0; }
  .color-picker.sm { width: 18px; height: 18px; }

  .mini-toggle {
    background: #161618; border: 1px solid #444; color: #888;
    padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; cursor: pointer;
  }
  .mini-toggle.on { background: rgba(103,232,249,0.12); color: #BB86FC; border-color: #BB86FC; }

  .check-row { display: flex; gap: 12px; margin-bottom: 8px; }
  .check-row label { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #bbb; cursor: pointer; }
  .check-row input[type="checkbox"] { accent-color: #BB86FC; width: 13px; height: 13px; }

  /* Strokes list */
  .strokes-list { max-height: 240px; overflow-y: auto; }
  .empty-msg { text-align: center; color: #555; font-size: 12px; padding: 20px; }
  .stroke-row {
    display: flex; align-items: center; gap: 8px; padding: 5px 8px;
    border: 1px solid #222; border-radius: 5px; margin-bottom: 4px;
    cursor: pointer; transition: border-color 0.15s, background 0.15s;
  }
  .stroke-row:hover { background: #0d0d10; border-color: #333; }
  .stroke-row.selected { border-color: #bb86fc; background: rgba(187, 134, 252, 0.08); }
  .stroke-row.selected:hover { background: rgba(187, 134, 252, 0.12); }

  .editing-banner {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; margin-bottom: 6px;
    background: rgba(187, 134, 252, 0.1); border: 1px solid rgba(187, 134, 252, 0.3);
    border-radius: 6px; font-size: 11px; color: #bb86fc;
  }
  .editing-banner b { color: #fff; }
  .done-btn {
    padding: 2px 10px; background: #bb86fc; color: #000; border: none;
    border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;
  }
  .done-btn:hover { background: #d4b8ff; }
  .stroke-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .stroke-info { flex: 1; min-width: 0; }
  .sname { display: block; font-size: 12px; color: #ddd; }
  .smeta { display: block; font-size: 10px; color: #666; }
  .del-btn {
    background: none; border: 1px solid transparent; color: #666;
    font-size: 11px; font-weight: 700; cursor: pointer; padding: 2px 6px; border-radius: 3px;
  }
  .del-btn:hover { color: #ff5555; background: rgba(255,85,85,0.1); border-color: rgba(255,85,85,0.3); }
  .clear-btn {
    width: 100%; background: rgba(255,85,85,0.06); border: 1px solid rgba(255,85,85,0.2);
    color: #ff7777; padding: 7px; border-radius: 5px; font-size: 11px; font-weight: 600;
    cursor: pointer; margin-top: 8px;
  }
  .clear-btn:hover { background: rgba(255,85,85,0.12); border-color: rgba(255,85,85,0.4); }
</style>
