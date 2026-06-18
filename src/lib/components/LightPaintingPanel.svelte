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
    type LightPaintingSequenceMode,
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
  const LIVE_PREVIEW_SYNC_INTERVAL_MS = 50;
  const LIVE_PREVIEW_MAX_POINTS = 300;
  let livePreviewRafId: number | null = null;
  let lastLivePreviewSyncTime = 0;

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

  const brushTypes: { type: LightPaintingBrushType; label: string; gpu?: boolean }[] = [
    { type: 'glow', label: 'Glow' },         { type: 'neon', label: 'Neon' },
    { type: 'flame', label: 'Flame' },       { type: 'electric', label: 'Electric' },
    { type: 'ribbon', label: 'Ribbon' },     { type: 'particle', label: 'Particle' },
    { type: 'smoke', label: 'Smoke' },       { type: 'laser', label: 'Laser' },
    { type: 'calligraphy', label: 'Callig.' }, { type: 'spray', label: 'Spray' },
    { type: 'paintbrush', label: 'Paint' },  { type: 'marker', label: 'Marker' },
    { type: 'watercolor', label: 'Water' },
    // ── WebGPU compute brushes ──
    // Particles bound to the stroke's tangent + normal vectors,
    // animated by per-frame compute shader. Best for projection-
    // mapping plant/tree work — spiral wraps around limbs, firefly
    // drifts outward like sparks, sap-flow simulates fluid motion.
    { type: 'spiral', label: 'Spiral', gpu: true },
    { type: 'firefly', label: 'Firefly', gpu: true },
    { type: 'sap-flow', label: 'Sap Flow', gpu: true },
    // 'water' (Ectoplasm) and 'smoke' GPU brushes intentionally hidden from
    // the picker — kept in the type union + shader so any project files that
    // already reference them keep loading without errors. Hide until we have
    // proper fluid / volumetric simulation rather than glorified billboards.
    // ── Premium WebGPU compute brushes ──
    // Ported from community's WebGL2 fragment-shader stamps to real
    // GPU particle systems — thousands of particles per stroke,
    // additive HDR trails, true motion. Each one is what its WebGL2
    // ancestor only hinted at.
    { type: 'galaxy', label: 'Galaxy', gpu: true },
    { type: 'nebula', label: 'Nebula', gpu: true },
    { type: 'sparkle', label: 'Sparkle', gpu: true },
    { type: 'vortex', label: 'Vortex', gpu: true },
    { type: 'plasma', label: 'Plasma', gpu: true },
  ];

  // Detect whether the current brush is a GPU brush so the panel
  // can show GPU-specific knobs (radius/speed/pitch, particle count,
  // drift) only when relevant. Keep in sync with GPU_PARTICLE_BRUSHES
  // in webgpuStrokeParticles.ts.
  const GPU_BRUSH_TYPES = new Set<LightPaintingBrushType>([
    'spiral', 'firefly', 'sap-flow', 'water', 'smoke',
    'galaxy', 'nebula', 'sparkle', 'vortex', 'plasma',
  ]);

  const loopModes: { mode: LightPaintingLoopMode; label: string }[] = [
    { mode: 'forward', label: 'Fwd' },    { mode: 'reverse', label: 'Rev' },
    { mode: 'pingpong', label: 'PP' },    { mode: 'once', label: '1x' },
  ];

  const sequenceModes: { mode: LightPaintingSequenceMode; label: string }[] = [
    { mode: 'recorded', label: 'Recorded' },
    { mode: 'random', label: 'Random' },
    { mode: 'alternating', label: 'Alternating' },
    { mode: 'bottomUp', label: 'Bottom Up' },
    { mode: 'topDown', label: 'Top Down' },
    { mode: 'centerOut', label: 'Center Out' },
    { mode: 'outsideIn', label: 'Outside In' },
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
  // Glass-tube color hex for the picker. Falls back to the soft
  // cool-white default when the brush hasn't set one explicitly.
  $: glassTubeColorHex = (currentBrush.gpuGlassTubeColor ?? [220, 230, 255])
    .map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
  $: glassTubeColorHexFull = '#' + glassTubeColorHex;

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

  function getLivePreviewSyncPoints(): LightPaintingStrokePoint[] {
    if (currentStrokePoints.length > LIVE_PREVIEW_MAX_POINTS) {
      return resamplePoints(currentStrokePoints, LIVE_PREVIEW_MAX_POINTS);
    }
    return currentStrokePoints.slice();
  }

  function cancelLivePreviewSync() {
    if (livePreviewRafId !== null) {
      cancelAnimationFrame(livePreviewRafId);
      livePreviewRafId = null;
    }
  }

  function flushLivePreviewSync(force = false) {
    if (!layerId || currentStrokePoints.length < 2) return;

    const now = performance.now();
    if (!force && now - lastLivePreviewSyncTime < LIVE_PREVIEW_SYNC_INTERVAL_MS) return;

    lastLivePreviewSyncTime = now;
    project.updateLightPaintingContent(layerId, {
      livePreviewStroke: {
        points: getLivePreviewSyncPoints(),
        brush: { ...currentBrush },
      },
    });
  }

  function scheduleLivePreviewSync() {
    if (livePreviewRafId !== null) return;
    livePreviewRafId = requestAnimationFrame(() => {
      livePreviewRafId = null;
      flushLivePreviewSync();
    });
  }

  onDestroy(cancelLivePreviewSync);

  // === DRAWING ===
  function startStroke(e: PointerEvent) {
    if (!layer || !content || drawMode === 'pen') return;
    // In path-edit mode the canvas drag is reserved for handle moves;
    // ignore stray pointerdowns on empty space (handles stopPropagation
    // when they're the target).
    if (isPathEditMode) return;
    // Deselect any selected stroke when starting a new one
    if (isEditingStroke) deselectStroke();
    const coords = getCanvasCoords(e), pixel = getOverlayPixelCoords(e);
    isDrawing = true; strokeStartTime = performance.now();
    currentStrokePoints = [{ x: coords.x, y: coords.y, pressure: (e as any).pressure ?? 0.5, timestamp: 0 }];
    lastSmoothedPoint = { x: coords.x, y: coords.y };
    livePreviewPoints = [pixel];
    cancelLivePreviewSync();
    lastLivePreviewSyncTime = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (layerId) project.updateLightPaintingContent(layerId, { isRecording: true });
  }

  function continueStroke(e: PointerEvent) {
    if (drawMode === 'pen') { penPreviewPoint = getOverlayPixelCoords(e); return; }
    if (!isDrawing) return;
    const coords = getCanvasCoords(e);
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

    // Batch in-progress stroke sync so the output window gets responsive
    // previews without cloning a growing point array on every pointer burst.
    scheduleLivePreviewSync();
  }

  function endStroke() {
    if (drawMode === 'pen') return;
    cancelLivePreviewSync();
    if (!isDrawing || !layerId || currentStrokePoints.length < 2) {
      if (layerId) project.updateLightPaintingContent(layerId, { isRecording: false, livePreviewStroke: null });
      isDrawing = false; currentStrokePoints = []; livePreviewPoints = []; lastSmoothedPoint = null; return;
    }

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
      // Exiting selection also exits path-edit mode.
      isPathEditMode = false;
    }
  }

  function deselectStroke() {
    selectStroke(null);
    isEditingStroke = false;
    isPathEditMode = false;
  }

  // ════════════════════════════════════════════════════════════════════
  // PATH EDIT MODE — drag control handles to reshape an existing stroke
  // ════════════════════════════════════════════════════════════════════
  //
  // For freehand strokes the raw points array can be hundreds of entries
  // dense, so dragging every individual point would be tedious. We
  // subsample N evenly-spaced control handles (default 24) — dragging
  // one applies a Gaussian-weighted warp to the nearby raw points so
  // the change reads as a smooth reshape, not a single-vertex spike.
  //
  // For pen-mode strokes the original anchor list (penPoints) IS the
  // editable representation — we drag those anchors directly and
  // regenerate the dense strokePoints via the existing
  // penPointsToStrokePoints() helper. Bezier handles aren't draggable
  // yet in path-edit mode; the user can re-create them by switching
  // back to draw mode + pen tool.
  //
  // The "Show all points" toggle bypasses subsampling and exposes
  // every raw point as a handle — only useful for fine-tuning.

  // Exported so the overlay + sidebar instances of this panel can share
  // a single source of truth via `bind:` from the parent. The "Edit Path"
  // toggle, tool picker, and show-all-points checkbox all live in the
  // sidebar UI — without binding, the overlay would never see them flip
  // and the handles would never render.
  export let isPathEditMode = false;
  export let pathEditShowAllRawPoints = false;
  const PATH_EDIT_HANDLE_COUNT = 24;

  // ── Path-edit toolbox ──
  // Three tools share the path-edit mode: Move (drag handles to warp /
  // rigid-translate selection), Delete (click handle to remove its raw
  // point), Insert (click on the guide path to add a new raw point at
  // the closest position along the stroke).
  type PathEditTool = 'move' | 'delete' | 'insert';
  export let pathEditTool: PathEditTool = 'move';
  // Selection set of handle indices for marquee / shift-click multi-select.
  // Move tool drags any selected group as a rigid translation. Delete tool
  // can wipe the whole selection at once. Cleared whenever editHandles
  // changes (different stroke or show-all toggle) since indices wouldn't
  // map across.
  let pathSelectedHandles = new Set<number>();
  let pathDragIsGroupTranslate = false;
  // Marquee state — pixel coords on the overlay SVG. Drawn as a dashed
  // cyan rect while dragging.
  let pathMarqueeStart: { x: number; y: number } | null = null;
  let pathMarqueeCurrent: { x: number; y: number } | null = null;
  let pathMarqueeStartNorm: { x: number; y: number } | null = null;

  // Drag state — single-handle drag at a time
  let pathDragHandleIndex: number | null = null;
  let pathDragStartNorm: { x: number; y: number } | null = null;
  // We keep the original points around so each pointermove computes the
  // warp from the original (not the accumulated) — feels predictable.
  let pathDragOriginalPoints: LightPaintingStrokePoint[] | null = null;
  let pathDragOriginalPenPoints: LightPaintingPenPoint[] | null = null;

  // Each handle binds to a single raw-point index on the stroke. The
  // drag math then warps a neighbourhood of raw points around that
  // index using a Gaussian falloff. For pen-mode strokes the "index"
  // is into penPoints instead — separately handled.
  //
  // Returns null for strokes that have no editable representation
  // (empty points, or fewer than 2).
  function computeEditHandles(
    stroke: import('../types').LightPaintingStroke | null,
    showAll: boolean,
  ): { x: number; y: number; pointIndex: number; isAnchor: boolean }[] | null {
    if (!stroke || stroke.points.length < 2) return null;
    // Pen-mode strokes use penPoints as the editable representation.
    if (stroke.drawMode === 'pen' && stroke.penPoints && stroke.penPoints.length > 0) {
      return stroke.penPoints.map((p, i) => ({ x: p.x, y: p.y, pointIndex: i, isAnchor: true }));
    }
    // Freehand: either all raw points, or N evenly-spaced.
    if (showAll || stroke.points.length <= PATH_EDIT_HANDLE_COUNT) {
      return stroke.points.map((p, i) => ({ x: p.x, y: p.y, pointIndex: i, isAnchor: false }));
    }
    // Subsample by index — guarantees first and last endpoints are anchors.
    const count = PATH_EDIT_HANDLE_COUNT;
    const last = stroke.points.length - 1;
    const out: { x: number; y: number; pointIndex: number; isAnchor: boolean }[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const idx = Math.round(t * last);
      out.push({ x: stroke.points[idx].x, y: stroke.points[idx].y, pointIndex: idx, isAnchor: i === 0 || i === count - 1 });
    }
    return out;
  }

  $: editHandles = isPathEditMode ? computeEditHandles(selectedStroke, pathEditShowAllRawPoints) : null;

  // Script-level reactive helpers for the path-edit SVG block. Computing
  // these here (instead of {@const} inside the template) avoids any
  // Svelte-5 template-block edge cases that can otherwise silently
  // prevent the {#if} children from entering the DOM even when the
  // condition is truthy and editHandles is populated.
  $: pathGuidePathD = (isPathEditMode && selectedStroke && editHandles)
    ? selectedStroke.points.map((p, i) => {
        const px = normToOverlayPx(p.x, p.y);
        return (i === 0 ? 'M' : 'L') + px.x.toFixed(1) + ',' + px.y.toFixed(1);
      }).join(' ')
    : '';
  $: pathToolPalette = (
    pathEditTool === 'delete'
      ? { stroke: 'rgba(255,90,90,0.95)',  fill: '#FF8080', anchorStroke: 'rgba(255,180,90,0.95)', anchorFill: '#FFC850' }
      : pathEditTool === 'insert'
      ? { stroke: 'rgba(120,220,140,0.95)', fill: '#80E89C', anchorStroke: 'rgba(255,180,90,0.95)', anchorFill: '#FFC850' }
      : { stroke: 'rgba(103,232,249,0.95)', fill: '#67E8F9', anchorStroke: 'rgba(255,200,80,0.95)', anchorFill: '#FFC850' }
  );
  $: pathHandlePositions = (isPathEditMode && editHandles)
    ? editHandles.map(h => normToOverlayPx(h.x, h.y))
    : [];

  // Wipe selection when the handle layout changes — indices wouldn't be
  // valid against the new layout, and the user expectation when toggling
  // Show-all or switching strokes is "clean slate".
  $: { editHandles; pathEditShowAllRawPoints; selectedStrokeId; pathSelectedHandles = new Set(); }

  // Delete the raw point bound to a handle. For freehand strokes this
  // splices out `selectedStroke.points[h.pointIndex]`; for pen strokes
  // it removes the pen anchor + regenerates the raw points. We refuse
  // to drop below 2 points (a stroke needs at least an endpoint pair to
  // remain renderable; below that it would silently disappear). Selection
  // is cleared after a successful delete because all indices shift.
  function deleteHandleByIndex(handleIndex: number) {
    if (!selectedStroke || !layerId || !editHandles) return;
    const h = editHandles[handleIndex];
    if (!h) return;
    if (selectedStroke.drawMode === 'pen' && selectedStroke.penPoints && h.isAnchor) {
      const newPen = selectedStroke.penPoints.filter((_, i) => i !== h.pointIndex);
      if (newPen.length < 2) return;
      const newPts = penPointsToStrokePoints(newPen);
      project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts, newPen);
    } else {
      const newPts = selectedStroke.points.filter((_, i) => i !== h.pointIndex);
      if (newPts.length < 2) return;
      project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts);
    }
    pathSelectedHandles = new Set();
  }

  function deleteSelectedHandles() {
    if (!selectedStroke || !layerId || !editHandles || pathSelectedHandles.size === 0) return;
    // Collect rawpoint indices to remove. Pen-mode: only anchor-bound
    // handles can delete. Freehand: each handle maps to a single raw
    // point. Sort descending so the splice doesn't shift earlier targets.
    const isPen = selectedStroke.drawMode === 'pen' && !!selectedStroke.penPoints;
    const drop = new Set<number>();
    for (const hi of pathSelectedHandles) {
      const h = editHandles[hi];
      if (!h) continue;
      if (isPen && !h.isAnchor) continue;
      drop.add(h.pointIndex);
    }
    if (drop.size === 0) return;
    if (isPen && selectedStroke.penPoints) {
      const newPen = selectedStroke.penPoints.filter((_, i) => !drop.has(i));
      if (newPen.length < 2) return;
      const newPts = penPointsToStrokePoints(newPen);
      project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts, newPen);
    } else {
      const newPts = selectedStroke.points.filter((_, i) => !drop.has(i));
      if (newPts.length < 2) return;
      project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts);
    }
    pathSelectedHandles = new Set();
  }

  // Insert a new raw point at the position along the stroke closest to
  // a normalized click. We find the segment (i, i+1) whose perpendicular
  // distance to the click is smallest, project the click onto it, and
  // splice the new point in. Timestamp/pressure are linearly
  // interpolated between the segment endpoints so playback timing stays
  // monotonic. Pen-mode strokes: we add a new anchor to penPoints (no
  // handles → straight join) and regenerate the raw points.
  function insertPointAtNorm(nx: number, ny: number) {
    if (!selectedStroke || !layerId) return;
    if (selectedStroke.drawMode === 'pen' && selectedStroke.penPoints && selectedStroke.penPoints.length >= 2) {
      // Find closest pen-segment by sampling — the curve isn't a polyline
      // so projection is approximate, but anchor insertion only needs to
      // be near a click; the user can drag the new anchor afterward.
      const pen = selectedStroke.penPoints;
      let bestSeg = 0, bestDist = Infinity, bestT = 0;
      for (let i = 0; i < pen.length - 1; i++) {
        const a = pen[i], b = pen[i + 1];
        for (let s = 0; s <= 10; s++) {
          const t = s / 10;
          const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
          const d2 = (px - nx) ** 2 + (py - ny) ** 2;
          if (d2 < bestDist) { bestDist = d2; bestSeg = i; bestT = t; }
        }
      }
      const a = pen[bestSeg], b = pen[bestSeg + 1];
      const newAnchor = { x: a.x + (b.x - a.x) * bestT, y: a.y + (b.y - a.y) * bestT, handleIn: null, handleOut: null };
      const newPen = [...pen.slice(0, bestSeg + 1), newAnchor, ...pen.slice(bestSeg + 1)];
      const newPts = penPointsToStrokePoints(newPen);
      project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts, newPen);
      return;
    }
    const pts = selectedStroke.points;
    if (pts.length < 2) return;
    let bestSeg = 0, bestDist = Infinity, bestT = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dxs = b.x - a.x, dys = b.y - a.y;
      const len2 = dxs * dxs + dys * dys;
      if (len2 < 1e-12) continue;
      let t = ((nx - a.x) * dxs + (ny - a.y) * dys) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dxs * t, py = a.y + dys * t;
      const d2 = (px - nx) ** 2 + (py - ny) ** 2;
      if (d2 < bestDist) { bestDist = d2; bestSeg = i; bestT = t; }
    }
    const a = pts[bestSeg], b = pts[bestSeg + 1];
    const newPt = {
      x: a.x + (b.x - a.x) * bestT,
      y: a.y + (b.y - a.y) * bestT,
      pressure: a.pressure + (b.pressure - a.pressure) * bestT,
      timestamp: a.timestamp + (b.timestamp - a.timestamp) * bestT,
    };
    const newPts = [...pts.slice(0, bestSeg + 1), newPt, ...pts.slice(bestSeg + 1)];
    project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts);
  }

  // Marquee select — convert pixel rect to normalized rect, then collect
  // every handle whose normalized position falls inside. Replaces the
  // selection (additive mode would require Shift; we keep marquee simple).
  function applyMarquee(startPx: { x: number; y: number }, endPx: { x: number; y: number }) {
    if (!editHandles) return;
    const minX = Math.min(startPx.x, endPx.x), maxX = Math.max(startPx.x, endPx.x);
    const minY = Math.min(startPx.y, endPx.y), maxY = Math.max(startPx.y, endPx.y);
    const next = new Set<number>();
    for (let i = 0; i < editHandles.length; i++) {
      const px = normToOverlayPx(editHandles[i].x, editHandles[i].y);
      if (px.x >= minX && px.x <= maxX && px.y >= minY && px.y <= maxY) next.add(i);
    }
    pathSelectedHandles = next;
  }

  // Gaussian-weighted warp: every raw point near the dragged handle
  // gets a fraction of the delta. Far points stay put. Falloff width
  // sigma is set so neighbouring handles barely overlap — the warp
  // reads as "this segment moved" rather than a sharp spike.
  function warpFreehand(
    originalPoints: LightPaintingStrokePoint[],
    handlePointIndex: number,
    dxNorm: number,
    dyNorm: number,
    handleCount: number,
    showAll: boolean,
  ): LightPaintingStrokePoint[] {
    if (showAll) {
      // Edit a single raw point only — no neighbourhood blending.
      return originalPoints.map((p, i) =>
        i === handlePointIndex ? { ...p, x: p.x + dxNorm, y: p.y + dyNorm } : p
      );
    }
    // Sigma in INDEX units. With 24 handles across N raw points, the
    // spacing is N/24. Sigma = spacing/2 gives a smooth bump with
    // neighbouring handles' bumps tapering toward each other.
    const spacing = originalPoints.length / Math.max(1, handleCount - 1);
    const sigma = Math.max(1, spacing * 0.5);
    const twoSigmaSq = 2 * sigma * sigma;
    return originalPoints.map((p, i) => {
      const d = i - handlePointIndex;
      const w = Math.exp(-(d * d) / twoSigmaSq);
      return { ...p, x: p.x + dxNorm * w, y: p.y + dyNorm * w };
    });
  }

  // Pen-mode anchor drag: moves the anchor + its in/out handles by the
  // same delta (so the curve translates around that anchor rather than
  // changing the tangent direction), then regenerates strokePoints.
  function warpPenStroke(
    originalPenPoints: LightPaintingPenPoint[],
    anchorIndex: number,
    dxNorm: number,
    dyNorm: number,
  ): { penPoints: LightPaintingPenPoint[]; strokePoints: LightPaintingStrokePoint[] } {
    const newPenPoints = originalPenPoints.map((p, i) => {
      if (i !== anchorIndex) return p;
      return {
        x: p.x + dxNorm,
        y: p.y + dyNorm,
        handleIn: p.handleIn ? { x: p.handleIn.x + dxNorm, y: p.handleIn.y + dyNorm } : null,
        handleOut: p.handleOut ? { x: p.handleOut.x + dxNorm, y: p.handleOut.y + dyNorm } : null,
      };
    });
    return {
      penPoints: newPenPoints,
      strokePoints: penPointsToStrokePoints(newPenPoints),
    };
  }

  // Convert a normalized 0..1 stroke point to overlay-SVG pixel coords.
  // The overlay's bounding rect aligns with the same transform basis
  // getCanvasCoords() reverses, so just multiply by canvas dims and add
  // the offset. (viewportZoom + pan are applied to the OVERLAY element
  // by its parent, so SVG-local coords don't need to compensate.)
  function normToOverlayPx(nx: number, ny: number): { x: number; y: number } {
    return {
      x: canvasOffsetX + nx * canvasWidth,
      y: canvasOffsetY + ny * canvasHeight,
    };
  }

  // Handle pointerdown — routes by active tool. Move tool starts a drag
  // (warp or rigid group translate if the handle is part of a selection).
  // Delete tool removes the handle's raw point. Insert tool no-ops here
  // since insertion targets the path between handles, not handles
  // themselves — that's wired on the overlay pointerdown. Shift-click
  // anywhere toggles the handle into the selection without starting a
  // drag; the user can drag a selected handle afterward to move the
  // whole group rigidly.
  function onHandlePointerDown(e: PointerEvent, handleIndex: number) {
    if (!selectedStroke || !layerId) return;
    e.stopPropagation();
    e.preventDefault();
    // Shift-click: toggle into selection set, no drag.
    if (e.shiftKey) {
      const next = new Set(pathSelectedHandles);
      if (next.has(handleIndex)) next.delete(handleIndex); else next.add(handleIndex);
      pathSelectedHandles = next;
      return;
    }
    if (pathEditTool === 'delete') {
      // Bulk-delete if this handle is part of a selection; else single.
      if (pathSelectedHandles.has(handleIndex) && pathSelectedHandles.size > 1) {
        deleteSelectedHandles();
      } else {
        deleteHandleByIndex(handleIndex);
      }
      return;
    }
    if (pathEditTool === 'insert') {
      // Insert tool clicking a handle is a no-op; insertion targets the
      // path between handles (overlay pointerdown handles that).
      return;
    }
    // Move tool: drag start.
    pathDragHandleIndex = handleIndex;
    pathDragStartNorm = getCanvasCoords(e);
    pathDragOriginalPoints = selectedStroke.points.map(p => ({ ...p }));
    pathDragOriginalPenPoints = selectedStroke.penPoints ? selectedStroke.penPoints.map(p => ({ ...p, handleIn: p.handleIn ? { ...p.handleIn } : null, handleOut: p.handleOut ? { ...p.handleOut } : null })) : null;
    // If this handle is in the selection, drag translates the whole
    // group rigidly (every selected raw point moves by the same delta);
    // otherwise fall through to the existing warp logic.
    pathDragIsGroupTranslate = pathSelectedHandles.has(handleIndex) && pathSelectedHandles.size > 1;
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
  }

  function onHandlePointerMove(e: PointerEvent) {
    if (pathDragHandleIndex === null || !pathDragStartNorm || !pathDragOriginalPoints || !selectedStroke || !layerId) return;
    const cur = getCanvasCoords(e);
    const dx = cur.x - pathDragStartNorm.x;
    const dy = cur.y - pathDragStartNorm.y;
    const handles = editHandles;
    if (!handles) return;
    const handle = handles[pathDragHandleIndex];
    if (!handle) return;
    if (pathDragIsGroupTranslate) {
      // Rigid translation of every selected raw point. Pen-mode: translate
      // the corresponding pen anchors (with their handles) and regen.
      if (selectedStroke.drawMode === 'pen' && pathDragOriginalPenPoints) {
        const targetAnchorIdx = new Set<number>();
        for (const hi of pathSelectedHandles) {
          const h = handles[hi];
          if (h && h.isAnchor) targetAnchorIdx.add(h.pointIndex);
        }
        const newPen = pathDragOriginalPenPoints.map((p, i) => {
          if (!targetAnchorIdx.has(i)) return p;
          return {
            x: p.x + dx, y: p.y + dy,
            handleIn: p.handleIn ? { x: p.handleIn.x + dx, y: p.handleIn.y + dy } : null,
            handleOut: p.handleOut ? { x: p.handleOut.x + dx, y: p.handleOut.y + dy } : null,
          };
        });
        project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, penPointsToStrokePoints(newPen), newPen);
      } else {
        const targetPointIdx = new Set<number>();
        for (const hi of pathSelectedHandles) {
          const h = handles[hi];
          if (h) targetPointIdx.add(h.pointIndex);
        }
        const newPts = pathDragOriginalPoints.map((p, i) =>
          targetPointIdx.has(i) ? { ...p, x: p.x + dx, y: p.y + dy } : p
        );
        project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts);
      }
      return;
    }
    if (handle.isAnchor && pathDragOriginalPenPoints && selectedStroke.drawMode === 'pen') {
      const { penPoints: newPen, strokePoints: newPts } = warpPenStroke(pathDragOriginalPenPoints, handle.pointIndex, dx, dy);
      project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts, newPen);
    } else {
      const newPts = warpFreehand(pathDragOriginalPoints, handle.pointIndex, dx, dy, PATH_EDIT_HANDLE_COUNT, pathEditShowAllRawPoints);
      project.updateLightPaintingStrokePoints(layerId, selectedStroke.id, newPts);
    }
  }

  function onHandlePointerUp(e: PointerEvent) {
    if (pathDragHandleIndex === null) return;
    try { (e.currentTarget as SVGElement).releasePointerCapture(e.pointerId); } catch {}
    pathDragHandleIndex = null;
    pathDragStartNorm = null;
    pathDragOriginalPoints = null;
    pathDragOriginalPenPoints = null;
    pathDragIsGroupTranslate = false;
  }

  // ── Marquee + insert handlers on the overlay ──
  // When path-edit mode is on and the user clicks empty overlay space,
  // we intercept here so the overlay's startStroke handler doesn't fire
  // (it would create a new stroke instead of marqueeing). Insert tool
  // splices a new raw point along the closest stroke segment; Move/Delete
  // start a marquee selection.
  function onPathEditOverlayPointerDown(e: PointerEvent): boolean {
    if (!isPathEditMode) return false;
    // Don't compete with the per-handle pointerdown handlers — they call
    // stopPropagation; if we're here the click missed every handle.
    if (pathEditTool === 'insert') {
      const norm = getCanvasCoords(e);
      insertPointAtNorm(norm.x, norm.y);
      e.preventDefault();
      return true;
    }
    // Move + Delete: start marquee.
    const px = getOverlayPixelCoords(e);
    pathMarqueeStart = px;
    pathMarqueeCurrent = px;
    pathMarqueeStartNorm = getCanvasCoords(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    return true;
  }

  function onPathEditOverlayPointerMove(e: PointerEvent): boolean {
    if (!pathMarqueeStart) return false;
    pathMarqueeCurrent = getOverlayPixelCoords(e);
    return true;
  }

  function onPathEditOverlayPointerUp(e: PointerEvent): boolean {
    if (!pathMarqueeStart || !pathMarqueeCurrent) return false;
    // Treat a near-zero drag as a "click on empty space → clear selection"
    // (5px is roughly the slop a steady click produces). Anything bigger
    // is a real marquee — apply it.
    const dx = pathMarqueeCurrent.x - pathMarqueeStart.x;
    const dy = pathMarqueeCurrent.y - pathMarqueeStart.y;
    if (dx * dx + dy * dy < 25) {
      pathSelectedHandles = new Set();
    } else {
      applyMarquee(pathMarqueeStart, pathMarqueeCurrent);
    }
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    pathMarqueeStart = null;
    pathMarqueeCurrent = null;
    pathMarqueeStartNorm = null;
    return true;
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
  function updateSetting(key: string, value: number | boolean | string) { if (layerId) project.updateLightPaintingContent(layerId, { [key]: value }); }
  function reshuffleSequence() {
    if (layerId) project.updateLightPaintingContent(layerId, { randomSequenceSeed: Math.floor(Math.random() * 1_000_000_000) });
  }

  function handleCustomColor(e: Event) { const h = (e.target as HTMLInputElement).value; setColor([parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]); }
  function handleCustomSecondaryColor(e: Event) { const h = (e.target as HTMLInputElement).value; setSecondaryColor([parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]); }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && drawMode === 'pen' && penPoints.length > 0) { penPoints = []; penPreviewPoint = null; e.preventDefault(); }
    if (e.key === 'Enter' && drawMode === 'pen' && penPoints.length > 1) { finishPenPath(); e.preventDefault(); }
    // Path-edit shortcuts: Delete/Backspace removes selected handles,
    // Escape clears the selection without exiting edit mode.
    if (isPathEditMode) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && pathSelectedHandles.size > 0) {
        deleteSelectedHandles();
        e.preventDefault();
      }
      if (e.key === 'Escape' && pathSelectedHandles.size > 0) {
        pathSelectedHandles = new Set();
        e.preventDefault();
      }
    }
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
      class:inactive={!drawingEnabled && !isPathEditMode}
      onpointerdown={(e) => { const p = getOverlayPixelCoords(e); cursorX = p.x; cursorY = p.y; if (onPathEditOverlayPointerDown(e)) return; if (!drawingEnabled) return; if (drawMode === 'pen') handlePenClick(e); else startStroke(e); }}
      onpointermove={(e) => { const p = getOverlayPixelCoords(e); cursorX = p.x; cursorY = p.y; if (onPathEditOverlayPointerMove(e)) return; if (!drawingEnabled) return; if (drawMode === 'pen' && isDraggingHandle) handlePenDrag(e); else continueStroke(e); }}
      onpointerup={(e) => { if (onPathEditOverlayPointerUp(e)) return; if (!drawingEnabled) return; if (drawMode === 'pen') { isDraggingHandle = false; } else endStroke(); }}
      onpointerleave={() => { cursorX = null; cursorY = null; if (!isPathEditMode && drawingEnabled && drawMode !== 'pen') endStroke(); }}
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
        <!-- Path-edit overlay: faint stroke guide + draggable control handles.
             Only rendered when the user has explicitly entered path-edit
             mode on a selected stroke. Handles capture pointer events
             (pointer-events: all on the circles + stopPropagation in the
             handler) so the overlay's startStroke never fires while a
             handle drag is in flight. -->
        {#if isPathEditMode && selectedStroke && editHandles}
          <!-- Guide line that traces the stroke's current shape. Drawn
               with a dark drop-shadow underneath + bright cyan dashed
               on top so it reads against both dark sky and bright glow
               strokes. -->
          <path
            d={pathGuidePathD}
            fill="none"
            stroke="rgba(0,0,0,0.65)"
            stroke-width="3"
            pointer-events="none"
          />
          <path
            d={pathGuidePathD}
            fill="none"
            stroke="rgba(103,232,249,0.95)"
            stroke-width="1.5"
            stroke-dasharray="4 3"
            pointer-events="none"
          />
          <!-- Tool-coloured handles. Move=cyan, Delete=red, Insert=green
               (insert tool doesn't actually act on handle clicks but we
               still tint them so the user knows what mode they're in).
               Selected handles get a bright yellow outer ring. Each
               handle gets a white halo behind so it's visible on bright
               glow strokes. -->
          {#each editHandles as h, i (i)}
            <g>
              <!-- White halo — sits behind the coloured outline and
                   makes the handle pop against any background. -->
              <circle
                cx={pathHandlePositions[i]?.x ?? 0}
                cy={pathHandlePositions[i]?.y ?? 0}
                r={pathDragHandleIndex === i ? 13 : 11}
                fill="rgba(0,0,0,0.55)"
                stroke="rgba(255,255,255,0.95)"
                stroke-width="2"
                pointer-events="none"
              />
              <!-- Outer ring / hit target — tool-coloured, generous click area. -->
              <circle
                cx={pathHandlePositions[i]?.x ?? 0}
                cy={pathHandlePositions[i]?.y ?? 0}
                r={pathDragHandleIndex === i ? 11 : 9}
                fill={pathDragHandleIndex === i ? 'rgba(103,232,249,0.35)' : 'transparent'}
                stroke={h.isAnchor ? pathToolPalette.anchorStroke : pathToolPalette.stroke}
                stroke-width="1.5"
                style="cursor: {pathEditTool === 'delete' ? 'not-allowed' : pathEditTool === 'insert' ? 'crosshair' : 'grab'}; pointer-events: all; touch-action: none;"
                onpointerdown={(e: PointerEvent) => onHandlePointerDown(e, i)}
                onpointermove={onHandlePointerMove}
                onpointerup={onHandlePointerUp}
                onpointercancel={onHandlePointerUp}
              />
              <!-- Selected state: bright yellow ring outside the tool ring. -->
              {#if pathSelectedHandles.has(i)}
                <circle
                  cx={pathHandlePositions[i]?.x ?? 0}
                  cy={pathHandlePositions[i]?.y ?? 0}
                  r={14}
                  fill="none"
                  stroke="rgba(255,220,60,0.95)"
                  stroke-width="2"
                  stroke-dasharray="3 2"
                  pointer-events="none"
                />
              {/if}
              <!-- Inner dot — bigger + brighter for visibility on glow strokes. -->
              <circle
                cx={pathHandlePositions[i]?.x ?? 0}
                cy={pathHandlePositions[i]?.y ?? 0}
                r={h.isAnchor ? 4 : 3.5}
                fill={h.isAnchor ? pathToolPalette.anchorFill : pathToolPalette.fill}
                pointer-events="none"
              />
            </g>
          {/each}
          <!-- Marquee rectangle while user is dragging on empty overlay. -->
          {#if pathMarqueeStart && pathMarqueeCurrent}
            <rect
              x={Math.min(pathMarqueeStart.x, pathMarqueeCurrent.x)}
              y={Math.min(pathMarqueeStart.y, pathMarqueeCurrent.y)}
              width={Math.abs(pathMarqueeCurrent.x - pathMarqueeStart.x)}
              height={Math.abs(pathMarqueeCurrent.y - pathMarqueeStart.y)}
              fill="rgba(103,232,249,0.10)"
              stroke="rgba(103,232,249,0.95)"
              stroke-width="1"
              stroke-dasharray="4 3"
              pointer-events="none"
            />
          {/if}
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
              <button class="brush-btn" class:active={currentBrush.type === bt.type} class:gpu={bt.gpu} onclick={() => setBrushType(bt.type)}>
                {bt.label}{#if bt.gpu}<span class="gpu-badge">GPU</span>{/if}
              </button>
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
            <label><input type="checkbox" checked={currentBrush.taper} onchange={(e) => updateBrushAndMaybeStroke({ ...currentBrush, taper: (e.target as HTMLInputElement).checked })} /> Soft Ends</label>
            <label><input type="checkbox" checked={currentBrush.pressureSensitive} onchange={(e) => updateBrushAndMaybeStroke({ ...currentBrush, pressureSensitive: (e.target as HTMLInputElement).checked })} /> Pressure</label>
          </div>

          <!-- ── Per-stroke taper curve ──
               Two width multipliers + a power curve that let a single
               stroke draw a tapered shape (thicker at one end, thinner
               at the other). This is what lets the same stroke read as
               a tree trunk → branch → twig without needing a layer-
               level mesh warp. Applies to BOTH the CPU brushes and
               the GPU brush + glass tube widths.

               Quick-set buttons jump the sliders to common shapes:
                 trunk → 1, 0.25, 1.5  (thick base, narrow tip)
                 root  → 0.25, 1, 0.7  (narrow start, fans wider)
                 even  → 1, 1, 1       (no taper) -->
          <div class="sec-label sub">
            Taper
            <span style="font-weight:400; opacity:0.7; font-size:0.85em; margin-left:auto;">
              start → end
            </span>
          </div>
          <div class="slider-col">
            <div class="sc">
              <label>Start Width <b>{(currentBrush.taperStart ?? 1).toFixed(2)}×</b></label>
              <input type="range" min="0" max="2" step="0.05"
                value={currentBrush.taperStart ?? 1}
                oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, taperStart: parseFloat((e.target as HTMLInputElement).value) })} />
            </div>
            <div class="sc">
              <label>End Width <b>{(currentBrush.taperEnd ?? 1).toFixed(2)}×</b></label>
              <input type="range" min="0" max="2" step="0.05"
                value={currentBrush.taperEnd ?? 1}
                oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, taperEnd: parseFloat((e.target as HTMLInputElement).value) })} />
            </div>
            <div class="sc">
              <label>Curve <b>{(currentBrush.taperCurve ?? 1).toFixed(2)}</b></label>
              <input type="range" min="0.25" max="4" step="0.05"
                value={currentBrush.taperCurve ?? 1}
                oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, taperCurve: parseFloat((e.target as HTMLInputElement).value) })} />
            </div>
          </div>
          <div class="check-row" style="gap:6px; flex-wrap:wrap;">
            <button class="mini-action" onclick={() => updateBrushAndMaybeStroke({ ...currentBrush, taperStart: 1, taperEnd: 0.25, taperCurve: 1.5 })}>Trunk → tip</button>
            <button class="mini-action" onclick={() => updateBrushAndMaybeStroke({ ...currentBrush, taperStart: 0.25, taperEnd: 1, taperCurve: 0.7 })}>Tip → trunk</button>
            <button class="mini-action" onclick={() => updateBrushAndMaybeStroke({ ...currentBrush, taperStart: 1, taperEnd: 1, taperCurve: 1 })}>Even</button>
          </div>

          <!-- GPU brush controls — surfaced only when the active brush
               is a GPU type (spiral / firefly / sap-flow). Each brush
               consumes a different subset; the panel shows all relevant
               knobs and the WGSL ignores the irrelevant ones. -->
          {#if GPU_BRUSH_TYPES.has(currentBrush.type)}
            <div class="sec-label">
              GPU Brush <span class="gpu-badge inline">WebGPU</span>
            </div>
            <div class="slider-col">
              <div class="sc">
                <label>Particles <b>{currentBrush.gpuParticleCount ?? 800}</b></label>
                <input type="range" min="50" max="4000" step="50"
                  value={currentBrush.gpuParticleCount ?? 800}
                  oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuParticleCount: parseInt((e.target as HTMLInputElement).value) })} />
              </div>
              {#if currentBrush.type === 'spiral'}
                <div class="sc">
                  <label>Wrap Radius <b>{(currentBrush.gpuSpiralRadius ?? 0.025).toFixed(3)}</b></label>
                  <input type="range" min="0.005" max="0.15" step="0.001"
                    value={currentBrush.gpuSpiralRadius ?? 0.025}
                    oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuSpiralRadius: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
                <div class="sc">
                  <label>Wrap Speed <b>{(currentBrush.gpuSpiralSpeed ?? 1.2).toFixed(2)}</b></label>
                  <input type="range" min="-5" max="5" step="0.1"
                    value={currentBrush.gpuSpiralSpeed ?? 1.2}
                    oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuSpiralSpeed: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
                <div class="sc">
                  <label>Helix Pitch <b>{currentBrush.gpuSpiralPitch ?? 8}</b></label>
                  <input type="range" min="1" max="30" step="0.5"
                    value={currentBrush.gpuSpiralPitch ?? 8}
                    oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuSpiralPitch: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
                <div class="check-row">
                  <label>
                    <input type="checkbox"
                      checked={currentBrush.gpuSpiralShowCore ?? false}
                      onchange={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuSpiralShowCore: (e.target as HTMLInputElement).checked })} />
                    Wrap-around mode (core + back-side cull, for tree trunks)
                  </label>
                </div>
              {/if}
              {#if currentBrush.type === 'firefly' || currentBrush.type === 'sap-flow' || currentBrush.type === 'water' || currentBrush.type === 'smoke'}
                <div class="sc">
                  <label>Drift <b>{(currentBrush.gpuParticleDrift ?? 0.05).toFixed(3)}</b></label>
                  <input type="range" min="0.005" max="0.3" step="0.005"
                    value={currentBrush.gpuParticleDrift ?? 0.05}
                    oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuParticleDrift: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
              {/if}
              {#if currentBrush.type === 'water'}
                <div class="sc">
                  <label>Sag (Gravity) <b>{(currentBrush.gpuWaterGravity ?? 1).toFixed(2)}</b></label>
                  <input type="range" min="0" max="2" step="0.05"
                    value={currentBrush.gpuWaterGravity ?? 1}
                    oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuWaterGravity: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
                <div class="sc">
                  <label>Flow Speed <b>{(currentBrush.gpuSpiralSpeed ?? 1.2).toFixed(2)}</b></label>
                  <input type="range" min="0.1" max="5" step="0.1"
                    value={currentBrush.gpuSpiralSpeed ?? 1.2}
                    oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuSpiralSpeed: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
              {/if}
              {#if currentBrush.type === 'smoke'}
                <div class="sc">
                  <label>Rise Speed <b>{(currentBrush.gpuSmokeRise ?? 0.5).toFixed(2)}</b></label>
                  <input type="range" min="0.05" max="1.5" step="0.05"
                    value={currentBrush.gpuSmokeRise ?? 0.5}
                    oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuSmokeRise: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
              {/if}

              <!-- ── Glass-tube container ──
                   Wraps the stroke in a translucent SDF tube whose
                   radius auto-scales with the brush's particle
                   spread (orbit / drift). The tube renders as a
                   fake-3D glass cylinder — bright rim, faint inner
                   glow — so the particles read as if they're
                   contained inside. -->
              <div class="check-row">
                <label>
                  <input type="checkbox"
                    checked={currentBrush.gpuGlassTube ?? false}
                    onchange={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuGlassTube: (e.target as HTMLInputElement).checked })} />
                  Glass tube (translucent container around stroke)
                </label>
              </div>
              {#if currentBrush.gpuGlassTube}
                <div class="sc">
                  <label>Tube Width <b>{(currentBrush.gpuGlassTubeRadiusScale ?? 1.25).toFixed(2)}×</b></label>
                  <input type="range" min="0.5" max="3" step="0.05"
                    value={currentBrush.gpuGlassTubeRadiusScale ?? 1.25}
                    oninput={(e) => updateBrushAndMaybeStroke({ ...currentBrush, gpuGlassTubeRadiusScale: parseFloat((e.target as HTMLInputElement).value) })} />
                </div>
                <!-- Glass-tube color: independent of the particle color
                     so you can tint the container separately from its
                     contents (e.g. cool blue glass containing warm
                     amber fireflies). Presets cover the most useful
                     starting points; the swatch on the right opens a
                     full color picker for anything else. -->
                <div class="sec-label sub">Tube Color</div>
                <div class="color-grid">
                  {#each [[220,230,255],[200,255,240],[255,240,200],[255,200,230],[180,220,255],[255,255,255]] as cp}
                    <button class="color-dot sm"
                      class:active={
                        (currentBrush.gpuGlassTubeColor ?? [220,230,255])[0] === cp[0] &&
                        (currentBrush.gpuGlassTubeColor ?? [220,230,255])[1] === cp[1] &&
                        (currentBrush.gpuGlassTubeColor ?? [220,230,255])[2] === cp[2]
                      }
                      style="background:rgb({cp[0]},{cp[1]},{cp[2]})"
                      onclick={() => updateBrushAndMaybeStroke({ ...currentBrush, gpuGlassTubeColor: [cp[0], cp[1], cp[2]] as [number, number, number] })} />
                  {/each}
                  <input type="color" class="color-picker sm" value={glassTubeColorHexFull}
                    onchange={(e) => {
                      const h = (e.target as HTMLInputElement).value;
                      updateBrushAndMaybeStroke({
                        ...currentBrush,
                        gpuGlassTubeColor: [
                          parseInt(h.slice(1,3),16),
                          parseInt(h.slice(3,5),16),
                          parseInt(h.slice(5,7),16),
                        ] as [number, number, number],
                      });
                    }} />
                </div>
              {/if}
            </div>
            <div class="gpu-hint">
              {#if currentBrush.type === 'spiral'}
                360° helix of particles around the stroke — full visibility front and back. Toggle Wrap-around mode for projections onto tree trunks where you want only the front-side particles + a glowing centerline.
              {:else if currentBrush.type === 'firefly'}
                Particles spawn on the stroke and drift outward, twinkling. Place strokes on branch tips for a fireflies-on-a-tree look.
              {:else if currentBrush.type === 'sap-flow'}
                Particles flow along the stroke at varying phases — like sap moving through veins.
              {:else if currentBrush.type === 'water'}
                Viscous glowing ectoplasm hugs the stroke and undulates slowly. Use a darker green/teal base color and high glow for the slimy fluid look.
              {:else if currentBrush.type === 'smoke'}
                Wisps rise upward from the stroke with curl-noise drift. Use white/grey base color and moderate glow.
              {/if}
            </div>
          {/if}

        {:else if activeSection === 'animation'}
          <div class="sec-label">Timing</div>
          <div class="slider-col">
            <div class="sc"><label>Speed <b>{content.animationSpeed.toFixed(1)}x</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.animationSpeed} oninput={(e) => updateSetting('animationSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Draw Speed <b>{content.drawSpeed.toFixed(1)}x</b></label><input type="range" min="0.1" max="10" step="0.1" value={content.drawSpeed} oninput={(e) => updateSetting('drawSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Trail Length <b>{content.trailLength.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.trailLength} oninput={(e) => updateSetting('trailLength', parseFloat((e.target as HTMLInputElement).value))} /></div>
            {#if content.loopMode === 'pingpong'}
              <div class="sc"><label>Ping Pong Hold <b>{content.pingPongHold ?? 0}ms</b></label><input type="range" min="0" max="5000" step="100" value={content.pingPongHold ?? 0} oninput={(e) => updateSetting('pingPongHold', parseInt((e.target as HTMLInputElement).value))} /></div>
            {/if}
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

          <div class="sec-label">Sequence</div>
          <div class="slider-col">
            <div class="sc">
              <label>Order <b>{sequenceModes.find(sm => sm.mode === (content.sequenceMode ?? 'recorded'))?.label ?? 'Recorded'}</b></label>
              <select value={content.sequenceMode ?? 'recorded'} onchange={(e) => updateSetting('sequenceMode', (e.target as HTMLSelectElement).value)}>
                {#each sequenceModes as sm}
                  <option value={sm.mode}>{sm.label}</option>
                {/each}
              </select>
            </div>
          </div>
          {#if (content.sequenceMode ?? 'recorded') === 'random'}
            <div class="check-row"><button class="mini-action" onclick={reshuffleSequence}>Reshuffle Random Order</button></div>
          {/if}

          <div class="sec-label">Snake</div>
          <div class="slider-col">
            <div class="sc"><label>Head Size <b>{content.snake.toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.snake} oninput={(e) => updateSetting('snake', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Snake Speed <b>{content.snakeSpeed.toFixed(1)}x</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.snakeSpeed} oninput={(e) => updateSetting('snakeSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
          </div>

          <div class="sec-label">Organic Motion</div>
          <div class="slider-col">
            <div class="sc"><label>Wind Sway <b>{(content.windSway ?? 0).toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.windSway ?? 0} oninput={(e) => updateSetting('windSway', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Wind Speed <b>{(content.windSpeed ?? 1).toFixed(1)}x</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.windSpeed ?? 1} oninput={(e) => updateSetting('windSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Wind Detail <b>{(content.windScale ?? 2).toFixed(1)}</b></label><input type="range" min="0.5" max="8" step="0.1" value={content.windScale ?? 2} oninput={(e) => updateSetting('windScale', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Root Lock <b>{(content.windAnchor ?? 0.7).toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.windAnchor ?? 0.7} oninput={(e) => updateSetting('windAnchor', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Flow Pulse <b>{(content.flowPulse ?? 0).toFixed(2)}</b></label><input type="range" min="0" max="1" step="0.01" value={content.flowPulse ?? 0} oninput={(e) => updateSetting('flowPulse', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Flow Speed <b>{(content.flowSpeed ?? 1).toFixed(1)}x</b></label><input type="range" min="0.1" max="5" step="0.1" value={content.flowSpeed ?? 1} oninput={(e) => updateSetting('flowSpeed', parseFloat((e.target as HTMLInputElement).value))} /></div>
            <div class="sc"><label>Flow Width <b>{(content.flowWidth ?? 0.12).toFixed(2)}</b></label><input type="range" min="0.03" max="0.5" step="0.01" value={content.flowWidth ?? 0.12} oninput={(e) => updateSetting('flowWidth', parseFloat((e.target as HTMLInputElement).value))} /></div>
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
            <!-- Path-edit toggle row. Only meaningful when a stroke is
                 selected; that's why it sits inside the editing banner
                 instead of being a permanent UI affordance. -->
            <div class="path-edit-row">
              <button
                class="path-edit-toggle"
                class:active={isPathEditMode}
                onclick={() => { isPathEditMode = !isPathEditMode; }}
                title="Drag control handles on the canvas to reshape this stroke"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
                {isPathEditMode ? 'Done Editing Path' : 'Edit Path'}
              </button>
              {#if isPathEditMode}
                <!-- Tool toolbox: Move / Delete / Insert. Default move
                     keeps the prior drag-to-warp UX; the other tools
                     unlock destructive + additive editing. -->
                <div class="path-edit-tools" role="radiogroup" aria-label="Path edit tool">
                  <button
                    class="path-tool-btn"
                    class:active={pathEditTool === 'move'}
                    onclick={() => { pathEditTool = 'move'; }}
                    title="Move tool — drag a handle to warp / drag a selected group to translate rigidly"
                    aria-pressed={pathEditTool === 'move'}
                  >Move</button>
                  <button
                    class="path-tool-btn delete"
                    class:active={pathEditTool === 'delete'}
                    onclick={() => { pathEditTool = 'delete'; }}
                    title="Delete tool — click a handle to remove its point. Delete/Backspace also wipes the current selection."
                    aria-pressed={pathEditTool === 'delete'}
                  >Delete</button>
                  <button
                    class="path-tool-btn insert"
                    class:active={pathEditTool === 'insert'}
                    onclick={() => { pathEditTool = 'insert'; }}
                    title="Insert tool — click anywhere near the stroke to insert a new point at the closest position"
                    aria-pressed={pathEditTool === 'insert'}
                  >Insert</button>
                </div>
              {/if}
              {#if isPathEditMode && selectedStroke.drawMode !== 'pen'}
                <label class="path-edit-checkbox" title="Show every raw point as a handle (more handles, finer control, but harder to target)">
                  <input type="checkbox" bind:checked={pathEditShowAllRawPoints} />
                  <span>Show all points</span>
                </label>
              {/if}
              {#if isPathEditMode}
                {#if pathSelectedHandles.size > 0}
                  <span class="path-edit-selcount">{pathSelectedHandles.size} selected</span>
                {/if}
                <span class="path-edit-hint">
                  {#if pathEditTool === 'delete'}
                    Click a handle to delete its point. Shift-click adds to selection. Drag empty space to marquee-select. Delete/Backspace removes selection.
                  {:else if pathEditTool === 'insert'}
                    Click anywhere along the stroke to insert a new point at the closest position.
                  {:else if selectedStroke.drawMode === 'pen'}
                    Drag any anchor to reshape. Yellow handles are pen anchors. Shift-click to select multiple; drag a selected anchor to translate the group.
                  {:else if pathEditShowAllRawPoints}
                    {selectedStroke.points.length} handles — drag any single point. Shift-click or marquee to select multiple; drag a selected handle to translate the group rigidly.
                  {:else}
                    {Math.min(PATH_EDIT_HANDLE_COUNT, selectedStroke.points.length)} handles — drag warps the nearby segment. Shift-click or marquee to select multiple; drag a selected handle to translate the group rigidly.
                  {/if}
                </span>
              {/if}
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
  /* Click-through state: layer is selected but we're neither drawing
     nor path-editing. Pointer events fall through to whatever's behind
     (layer transform handles, viewport pan, etc.) while inner SVG
     elements that explicitly set pointer-events:all still work — the
     marquee guide is hidden in this state anyway because pathMarquee*
     is null when not editing. */
  .lp-draw-overlay.inactive { pointer-events: none; cursor: default; }
  .lp-preview-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .draw-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: rgba(255,255,255,0.25); font-size: 15px; pointer-events: none; text-align: center; max-width: 300px; }
  .status-pill { position: absolute; top: 10px; left: 10px; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; pointer-events: none; }
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
  .lp-title { font-size: 15px; font-weight: 700; color: #BB86FC; letter-spacing: 0.5px; }

  /* Draw mode & playback rows */
  .lp-row {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid #222;
  }
  .row-label { font-size: 13px; color: var(--text-muted, #888); font-weight: 600; }

  .mode-btns { display: flex; border: 1px solid #444; border-radius: 5px; overflow: hidden; }
  .mode-btns button {
    background: transparent; border: none; color: var(--text-muted, #888);
    padding: 4px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .mode-btns button:hover { color: var(--text-primary, #ddd); background: rgba(255,255,255,0.04); }
  .mode-btns button.active { color: #BB86FC; background: rgba(103,232,249,0.1); }
  .mode-btns button + button { border-left: 1px solid #444; }

  .play-btn {
    background: var(--bg-tertiary, #161618); border: 1px solid #444; color: var(--text-primary, #eee);
    width: 26px; height: 26px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
  }
  .play-btn:hover { background: #333; }
  .play-btn.playing { background: #BB86FC; color: #000; border-color: #BB86FC; }

  .loop-btn {
    background: #222; border: 1px solid #3a3a3a; color: var(--text-muted, #888);
    padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .loop-btn:hover { color: var(--text-primary, #ccc); border-color: #555; }
  .loop-btn.active { color: #BB86FC; border-color: #BB86FC; background: rgba(103,232,249,0.08); }

  .stroke-badge {
    background: #BB86FC; color: #000; font-size: 11px; font-weight: 700;
    padding: 1px 5px; border-radius: 8px; margin-left: auto;
  }

  /* Tabs */
  .lp-tabs { display: flex; border-bottom: 1px solid #161618; flex-shrink: 0; }
  .lp-tabs button {
    flex: 1; background: none; border: none; color: #666;
    padding: 7px 4px; font-size: 13px; font-weight: 600; cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .lp-tabs button:hover { color: var(--text-secondary, #aaa); }
  .lp-tabs button.active { color: #BB86FC; border-bottom-color: #BB86FC; }

  /* Content */
  .lp-content { padding: 8px 12px; overflow-y: auto; flex: 1; }

  /* Section labels */
  .sec-label {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 13px; font-weight: 600; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.4px;
    margin: 10px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #222;
  }
  .sec-label:first-child { margin-top: 0; }

  /* Full-width slider column */
  .slider-col { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
  .sc { display: flex; flex-direction: column; }
  .sc label {
    font-size: 13px; color: #bbb; margin-bottom: 4px; display: flex; align-items: baseline;
  }
  .sc label b { color: #BB86FC; font-family: monospace; font-size: 13px; font-weight: 400; margin-left: auto; }
  .sc input[type="range"] {
    width: 100%; height: 4px; appearance: none; background: #333; border-radius: 2px; outline: none;
  }
  .sc input[type="range"]::-webkit-slider-thumb {
    appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: #BB86FC; cursor: pointer; border: 2px solid #141416;
  }
  .sc select {
    width: 100%; background: var(--bg-primary, #0d0d10); border: 1px solid #333; color: var(--text-primary, #ddd);
    border-radius: 5px; padding: 6px 8px; font-size: 13px; outline: none;
  }

  /* Brush grid */
  .brush-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px; }
  .brush-btn {
    background: var(--bg-primary, #0d0d10); border: 1px solid #333; color: var(--text-secondary, #aaa);
    border-radius: 5px; padding: 6px 2px; font-size: 12px; font-weight: 600;
    cursor: pointer; text-align: center;
    position: relative;
  }
  .brush-btn:hover { background: var(--bg-tertiary, #161618); color: var(--text-primary, #eee); border-color: #555; }
  .brush-btn.active { background: rgba(103,232,249,0.1); color: #BB86FC; border-color: #BB86FC; }
  /* GPU brush buttons get a subtle gradient hint so they're visually
     distinct from the CPU-rasterised ones in the picker. */
  .brush-btn.gpu {
    background: linear-gradient(135deg, #0d0d10, #181228);
    border-color: #335;
  }
  .brush-btn.gpu:hover { border-color: #6df; }
  .brush-btn.gpu.active {
    background: linear-gradient(135deg, rgba(109,221,255,0.15), rgba(187,134,252,0.15));
    border-color: #6df;
  }
  .gpu-badge {
    display: inline-block;
    background: linear-gradient(135deg, #6df, #b9f);
    color: #000;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 3px;
    border-radius: 999px;
    letter-spacing: 0.4px;
    margin-left: 3px;
    vertical-align: middle;
  }
  .gpu-badge.inline { margin-left: 6px; font-size: 10px; padding: 1px 5px; }
  .gpu-hint {
    margin-top: 8px;
    padding: 6px 8px;
    background: rgba(109,221,255,0.06);
    border: 1px solid rgba(109,221,255,0.2);
    border-radius: 4px;
    font-size: 12px;
    color: #aac;
    line-height: 1.4;
  }

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
    background: var(--bg-tertiary, #161618); border: 1px solid #444; color: var(--text-muted, #888);
    padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; cursor: pointer;
  }
  .mini-toggle.on { background: rgba(103,232,249,0.12); color: #BB86FC; border-color: #BB86FC; }

  .check-row { display: flex; gap: 12px; margin-bottom: 8px; }
  .check-row label { display: flex; align-items: center; gap: 5px; font-size: 13px; color: #bbb; cursor: pointer; }
  .check-row input[type="checkbox"] { accent-color: #BB86FC; width: 13px; height: 13px; }
  .mini-action {
    background: var(--bg-tertiary, #161618); border: 1px solid #333; color: #bbb;
    border-radius: 5px; padding: 5px 8px; font-size: 13px; cursor: pointer;
  }
  .mini-action:hover { border-color: #BB86FC; color: #fff; }

  /* Strokes list */
  .strokes-list { max-height: 240px; overflow-y: auto; }
  .empty-msg { text-align: center; color: #555; font-size: 14px; padding: 20px; }
  .stroke-row {
    display: flex; align-items: center; gap: 8px; padding: 5px 8px;
    border: 1px solid #222; border-radius: 5px; margin-bottom: 4px;
    cursor: pointer; transition: border-color 0.15s, background 0.15s;
  }
  .stroke-row:hover { background: var(--bg-primary, #0d0d10); border-color: #333; }
  .stroke-row.selected { border-color: #bb86fc; background: rgba(187, 134, 252, 0.08); }
  .stroke-row.selected:hover { background: rgba(187, 134, 252, 0.12); }

  .editing-banner {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; margin-bottom: 6px;
    background: rgba(187, 134, 252, 0.1); border: 1px solid rgba(187, 134, 252, 0.3);
    border-radius: 6px; font-size: 13px; color: #bb86fc;
  }
  .editing-banner b { color: #fff; }
  .done-btn {
    padding: 2px 10px; background: #bb86fc; color: #000; border: none;
    border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .done-btn:hover { background: #d4b8ff; }
  .path-edit-row {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    padding: 6px 8px; margin-bottom: 8px;
    background: rgba(103, 232, 249, 0.05); border: 1px solid rgba(103, 232, 249, 0.18);
    border-radius: 6px;
  }
  .path-edit-toggle {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 10px;
    background: transparent; color: #67E8F9;
    border: 1px solid rgba(103, 232, 249, 0.45);
    border-radius: 4px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .path-edit-toggle:hover { background: rgba(103, 232, 249, 0.10); border-color: rgba(103, 232, 249, 0.7); }
  .path-edit-toggle.active { background: #67E8F9; color: #0a0a0c; border-color: #67E8F9; }
  .path-edit-toggle.active:hover { background: #8ff0fc; }
  .path-edit-checkbox {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12px; color: var(--text-secondary, #aaa); cursor: pointer; user-select: none;
  }
  .path-edit-checkbox input { width: 12px; height: 12px; cursor: pointer; accent-color: #67E8F9; }
  .path-edit-hint { font-size: 12px; color: var(--text-muted, #888); flex-basis: 100%; }
  .path-edit-tools {
    display: inline-flex; gap: 0; align-items: stretch;
    border: 1px solid rgba(103, 232, 249, 0.3);
    border-radius: 4px; overflow: hidden;
  }
  .path-tool-btn {
    padding: 4px 9px;
    background: transparent; color: #67E8F9;
    border: none;
    border-right: 1px solid rgba(103, 232, 249, 0.18);
    font-size: 12px; font-weight: 600; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .path-tool-btn:last-child { border-right: none; }
  .path-tool-btn:hover { background: rgba(103, 232, 249, 0.10); }
  .path-tool-btn.active { background: #67E8F9; color: #0a0a0c; }
  .path-tool-btn.delete { color: #FF8080; }
  .path-tool-btn.delete:hover { background: rgba(255, 128, 128, 0.10); }
  .path-tool-btn.delete.active { background: #FF8080; color: #1a0a0a; }
  .path-tool-btn.insert { color: #80E89C; }
  .path-tool-btn.insert:hover { background: rgba(128, 232, 156, 0.10); }
  .path-tool-btn.insert.active { background: #80E89C; color: #0a1a0c; }
  .path-edit-selcount {
    font-size: 12px; font-weight: 600; color: #FFDD3C;
    padding: 2px 6px;
    border: 1px solid rgba(255, 220, 60, 0.5);
    border-radius: 3px;
    background: rgba(255, 220, 60, 0.10);
  }
  .stroke-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .stroke-info { flex: 1; min-width: 0; }
  .sname { display: block; font-size: 14px; color: var(--text-primary, #ddd); }
  .smeta { display: block; font-size: 12px; color: #666; }
  .del-btn {
    background: none; border: 1px solid transparent; color: #666;
    font-size: 13px; font-weight: 700; cursor: pointer; padding: 2px 6px; border-radius: 3px;
  }
  .del-btn:hover { color: #ff5555; background: rgba(255,85,85,0.1); border-color: rgba(255,85,85,0.3); }
  .clear-btn {
    width: 100%; background: rgba(255,85,85,0.06); border: 1px solid rgba(255,85,85,0.2);
    color: #ff7777; padding: 7px; border-radius: 5px; font-size: 13px; font-weight: 600;
    cursor: pointer; margin-top: 8px;
  }
  .clear-btn:hover { background: rgba(255,85,85,0.12); border-color: rgba(255,85,85,0.4); }
</style>
