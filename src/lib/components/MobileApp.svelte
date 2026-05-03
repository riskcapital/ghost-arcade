<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { Project, Point2D, WarpCorners, BlendMode, Effect, EffectType, EffectParams } from '../types';
  import { EFFECT_PARAM_DEFS } from '../effects/effectParamDefs';
  import MobileVJController from './mobile/MobileVJController.svelte';

  // Connection state
  let connected = false;
  let connecting = false;
  let serverUrl = '';
  let error = '';
  let ws: WebSocket | null = null;
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Auto-reconnect state
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 20;
  const RECONNECT_DELAYS = [2000, 3000, 5000, 10000, 15000, 30000]; // exponential backoff

  function getReconnectDelay(): number {
    const idx = Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1);
    return RECONNECT_DELAYS[idx];
  }

  function stopReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
  }

  function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS || !serverUrl) return;
    const delay = getReconnectDelay();
    console.log(`[Mobile] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
    error = `Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`;
    reconnectTimer = setTimeout(() => {
      reconnectAttempts++;
      if (!connected && !connecting && serverUrl) {
        connect();
      }
    }, delay);
  }

  // Mobile mode switcher: mapping (warp controls) or VJ (clip launcher / mixer)
  let mobileMode: 'mapping' | 'vj' | 'paint' = 'mapping';

  // ─── Light Painting (iPad Apple Pencil) ─────────────────────────
  let paintLayerId: string | null = null;
  // NOTE: color is 0-255 RGB to match LightPaintingBrush interface used by the renderer.
  let paintBrush = {
    type: 'glow' as string,
    color: [255, 160, 40] as number[],  // warm amber default, matches desktop createDefaultLightPaintingBrush
    secondaryColor: null as number[] | null,
    size: 20,
    glow: 2,
    softness: 0.5,
    jitter: 0,
    opacity: 1,
    smoothing: 0.5,
    speed: 1,
    taper: false,
    pressureSensitivity: true,
    secondaryGlow: false,
  };
  let isPainting = false;
  let showBrushPanel = false;         // Slide-up brush settings drawer
  let cursorX = -1;                   // Hover crosshair position (CSS px), -1 = hidden
  let cursorY = -1;
  let localLivePoints: { x: number; y: number; pressure: number; timestamp: number }[] = [];

  // SVG path string for the in-flight stroke — coords in canvas display pixels.
  // Mirrors desktop's live preview so the user sees a smooth line instantly.
  $: livePreviewSvgPath = (() => {
    if (!isPainting || localLivePoints.length < 2 || canvasDisplay.w <= 0) return '';
    const { w, h } = canvasDisplay;
    let d = '';
    for (let i = 0; i < localLivePoints.length; i++) {
      const p = localLivePoints[i];
      const x = p.x * w;
      const y = p.y * h;
      if (i === 0) {
        d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      } else if (i < localLivePoints.length - 1) {
        // Smooth with quadratic bezier (average of current and next → control)
        const next = localLivePoints[i + 1];
        const mx = (p.x + next.x) / 2 * w;
        const my = (p.y + next.y) / 2 * h;
        d += ` Q${x.toFixed(1)} ${y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      } else {
        d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      }
    }
    return d;
  })();
  const brushTypes = ['glow', 'neon', 'flame', 'electric', 'particle', 'smoke', 'laser', 'ribbon', 'calligraphy', 'spray', 'paintbrush', 'marker', 'watercolor'];
  // Color presets in 0-255 RGB (matches LightPaintingBrush format)
  const colorPresets = [
    [255, 100, 0], [255, 0, 0], [255, 0, 128], [255, 0, 255], [128, 0, 255],
    [0, 50, 255], [0, 150, 255], [0, 255, 255], [0, 255, 100], [0, 255, 0],
    [128, 255, 0], [255, 255, 0], [255, 255, 255], [128, 128, 128],
  ];

  // Local LightPaintingRenderer instance — mirrors the same visual output as desktop.
  // Lazy-initialized when paint mode is entered, lives for the session.
  let paintRenderer: any = null;
  let paintRendererCls: any = null;
  let paintCanvasEl: HTMLCanvasElement | null = null;  // Visible mirror surface on iPad
  let paintSurfaceEl: HTMLDivElement | null = null;    // Outer surface that captures pointer events
  let paintRafId: number | null = null;
  let paintLastFrameMs = 0;
  // Letterboxed canvas display rect within the surface (recomputed on resize)
  let canvasDisplay = { x: 0, y: 0, w: 0, h: 0 };
  let surfaceRO: ResizeObserver | null = null;

  function recomputeCanvasDisplay() {
    if (!paintSurfaceEl || !projectState) return;
    const sw = paintSurfaceEl.clientWidth;
    const sh = paintSurfaceEl.clientHeight;
    const ar = (projectState.width || 1920) / (projectState.height || 1080);
    let w = sw;
    let h = Math.round(sw / ar);
    if (h > sh) { h = sh; w = Math.round(sh * ar); }
    canvasDisplay = {
      x: Math.round((sw - w) / 2),
      y: Math.round((sh - h) / 2),
      w, h,
    };
  }

  /**
   * Insert interpolated points between pointermove samples so the stamp-based
   * brush renderer produces a smooth, continuous line instead of dots.
   * Coordinates are normalized (0-1); we project to the renderer resolution
   * to calculate screen-space distance and target ~brush.size/4 spacing.
   */
  function densifyStrokePoints(
    points: { x: number; y: number; pressure: number; timestamp: number }[],
    brushSize: number,
  ): typeof points {
    if (points.length < 2) return points;
    const w = projectState?.width || 1920;
    const h = projectState?.height || 1080;
    const targetSpacing = Math.max(2, brushSize * 0.25); // overlap guarantees continuity
    const out: typeof points = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = (b.x - a.x) * w;
      const dy = (b.y - a.y) * h;
      const dist = Math.hypot(dx, dy);
      if (dist > targetSpacing) {
        const steps = Math.min(64, Math.ceil(dist / targetSpacing));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          out.push({
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            pressure: a.pressure + (b.pressure - a.pressure) * t,
            timestamp: a.timestamp + (b.timestamp - a.timestamp) * t,
          });
        }
      }
      out.push(b);
    }
    return out;
  }

  async function ensurePaintRenderer() {
    if (paintRenderer) return paintRenderer;
    if (!paintRendererCls) {
      const mod = await import('../lightpainting/renderer');
      paintRendererCls = mod.LightPaintingRenderer;
    }
    // Use a reduced-resolution canvas for iPad perf — 960×540 is plenty for
    // on-device preview and cuts render cost by 4x vs native 1920×1080.
    // Stamps are still rendered at correct proportional size.
    const srcW = projectState?.width || 1920;
    const srcH = projectState?.height || 1080;
    const aspect = srcW / srcH;
    const targetW = 960;
    const w = targetW;
    const h = Math.round(targetW / aspect);
    paintRenderer = new paintRendererCls(w, h);
    return paintRenderer;
  }

  // Render-gating state — avoid re-drawing the canvas on every RAF when nothing
  // visible has changed. The SVG overlay handles the live in-flight stroke, so
  // the underlying canvas only needs to redraw when finalized strokes change.
  let lastRenderedFingerprint = '';
  let renderDirty = true;

  // RAF loop — continuously redraw the mirror canvas from the active layer's
  // lightPaintingContent (synced from server) plus any in-flight local stroke.
  function paintRafTick(tMs: number) {
    paintRafId = null;
    if (mobileMode !== 'paint' || !paintLayerId || !paintCanvasEl || !paintRenderer) {
      // Restart RAF if we're still in paint mode but not ready yet (e.g. renderer async loading)
      if (mobileMode === 'paint') paintRafId = requestAnimationFrame(paintRafTick);
      return;
    }

    const dt = paintLastFrameMs > 0 ? (tMs - paintLastFrameMs) / 1000 : 0;
    paintLastFrameMs = tMs;

    const layer = projectState?.layers?.find(l => l.id === paintLayerId);
    const content = layer?.lightPaintingContent;
    if (content) {
      // Fingerprint the state the canvas depends on. While drawing locally the
      // SVG overlay handles the in-flight stroke, so we DON'T re-render the
      // canvas on every pointermove — only when finalized strokes change or
      // the server pushes a live preview.
      const strokes = content.strokes || [];
      const fp = `${strokes.length}:${strokes[strokes.length - 1]?.id || ''}:${strokes[strokes.length - 1]?.points?.length || 0}:${(content as any).livePreviewStroke ? 'lp' : ''}`;
      if (fp !== lastRenderedFingerprint || renderDirty) {
        lastRenderedFingerprint = fp;
        renderDirty = false;
        // Densify finalized strokes once per change so stamps form continuous lines
        const densifiedStrokes = strokes.map((s: any) => ({
          ...s,
          points: densifyStrokePoints(s.points, s.brush?.size ?? 20),
        }));
        const withLive = {
          ...content,
          strokes: densifiedStrokes,
          livePreviewStroke: (content as any).livePreviewStroke || null,
        };
        try {
          paintRenderer.render(withLive, dt);
        } catch (err) { /* swallow render errors */ }
        // Copy renderer output to the visible iPad canvas
        const srcCanvas: HTMLCanvasElement = paintRenderer.getCanvas();
        const dstCtx = paintCanvasEl.getContext('2d');
        if (dstCtx && srcCanvas) {
          if (paintCanvasEl.width !== srcCanvas.width || paintCanvasEl.height !== srcCanvas.height) {
            paintCanvasEl.width = srcCanvas.width;
            paintCanvasEl.height = srcCanvas.height;
          }
          dstCtx.clearRect(0, 0, paintCanvasEl.width, paintCanvasEl.height);
          dstCtx.drawImage(srcCanvas, 0, 0);
        }
      }
    }

    paintRafId = requestAnimationFrame(paintRafTick);
  }

  // Start/stop the RAF loop when paint mode toggles
  $: if (mobileMode === 'paint' && paintLayerId) {
    renderDirty = true; // force a render when entering paint mode or switching layers
    ensurePaintRenderer().then(() => {
      if (paintRafId === null) paintRafId = requestAnimationFrame(paintRafTick);
    });
  } else if (paintRafId !== null) {
    cancelAnimationFrame(paintRafId);
    paintRafId = null;
    paintLastFrameMs = 0;
  }

  // Observe paint surface size so we can keep the letterboxed canvas rect in sync.
  $: if (paintSurfaceEl && mobileMode === 'paint') {
    recomputeCanvasDisplay();
    if (!surfaceRO && typeof ResizeObserver !== 'undefined') {
      surfaceRO = new ResizeObserver(() => recomputeCanvasDisplay());
      surfaceRO.observe(paintSurfaceEl);
    }
  }
  // Also recompute if project dimensions change
  $: if (projectState?.width && projectState?.height && paintSurfaceEl) {
    recomputeCanvasDisplay();
  }

  function handlePaintPointer(e: PointerEvent) {
    // Apple Pencil and mouse only — touch is reserved for UI (scrolling panels, etc.)
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
    if (!paintLayerId) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Crosshair in surface-relative pixels (matches display of canvas overlay)
    cursorX = sx;
    cursorY = sy;

    // Normalize to project coords against the LETTERBOXED canvas rect (not the
    // full surface). This guarantees 1:1 mapping between pen position and the
    // point drawn on the canvas, regardless of aspect-ratio padding.
    const { x: cx, y: cy, w: cw, h: ch } = canvasDisplay;
    if (cw <= 0 || ch <= 0) return;
    // Clamp to [0,1] so strokes outside the letterbox land on the edge
    const nx = Math.max(0, Math.min(1, (sx - cx) / cw));
    const ny = Math.max(0, Math.min(1, (sy - cy) / ch));

    const pressure = e.pressure;

    // Hover mode: move without pressure → crosshair only (both local + send to desktop)
    if (!isPainting && (pressure === 0 || e.type === 'pointermove')) {
      if (e.type !== 'pointerdown') {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'lightpainting_hover', x: nx, y: ny }));
        }
        return;
      }
    }

    if (e.type === 'pointerdown' || (e.type === 'pointermove' && pressure > 0 && !isPainting)) {
      isPainting = true;
      localLivePoints = [];
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'lightpainting_stroke_start', layerId: paintLayerId, brush: paintBrush }));
      }
    }

    if (isPainting && (e.type === 'pointermove' || e.type === 'pointerdown')) {
      const ts = performance.now();
      // Local point buffer used for live preview rendering on iPad (zero-latency)
      localLivePoints.push({ x: nx, y: ny, pressure: pressure || 0.5, timestamp: ts });
      // Cap the buffer so long strokes don't blow memory (8k = ~2 min @ 60hz)
      if (localLivePoints.length > 8000) localLivePoints.shift();

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'lightpainting_stroke_point',
          layerId: paintLayerId,
          x: nx, y: ny, pressure, timestamp: ts,
        }));
      }
    }
  }

  function handlePaintPointerUp(e: PointerEvent) {
    if (!isPainting || !paintLayerId) return;
    isPainting = false;
    localLivePoints = [];
    renderDirty = true; // finalized stroke will arrive via sync — force a re-render
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'lightpainting_stroke_end', layerId: paintLayerId }));
    }
  }

  function handlePaintPointerLeave() {
    cursorX = -1;
    cursorY = -1;
    if (isPainting) {
      isPainting = false;
      localLivePoints = [];
      renderDirty = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'lightpainting_stroke_end', layerId: paintLayerId }));
      }
    }
  }

  // Auto-select first light painting layer when entering paint mode
  $: if (mobileMode === 'paint' && !paintLayerId && projectState?.layers) {
    const first = projectState.layers.find(l => l.type === 'lightpainting');
    if (first) paintLayerId = first.id;
  }

  // Project state (synced from server)
  let projectState: Project | null = null;
  let selectedLayerId: string | null = null;

  // Touch state for corners
  let draggingCorner: keyof WarpCorners | null = null;
  let touchStartPos = { x: 0, y: 0 };
  let cornerStartPos: Point2D = { x: 0, y: 0 };

  // Touch state for mesh points
  let draggingMeshPoint: { row: number; col: number } | null = null;
  let meshPointStartPos: Point2D = { x: 0, y: 0 };

  // View mode: corners only or full mesh
  let viewMode: 'corners' | 'mesh' = 'corners';

  // Media library state
  let showMediaLibrary = false;

  // Mesh grid size
  let meshRows = 4;
  let meshCols = 4;

  // Viewport dimensions
  let viewportEl: HTMLDivElement;
  let viewportWidth = 300;
  let viewportHeight = 200;

  // Viewport padding - percentage based for better mobile scaling
  const VIEWPORT_PADDING_PERCENT = 0.08; // 8% padding on each side

  // Viewport pan/zoom state for mobile gestures
  let viewportScale = 1;
  let viewportPanX = 0;
  let viewportPanY = 0;

  // Viewport navigation is now controlled by sliders instead of pinch/pan gestures
  // This frees up all touch interactions for layer/mesh manipulation

  // Built-in Three.js sources available for triggering
  const threejsSources = [
    { id: 'threejs-embryo', name: 'Embryo', src: '/threejs/embryo/index.html' },
    { id: 'threejs-flow', name: 'Flow', src: '/threejs/flow/index-new.html' },
  ];

  // Effects panel state
  let showEffectsPanel = false;
  let effectsLayerIndex: number | null = null;

  // Available effect types organized by category for easy selection
  const effectCategories = [
    {
      name: 'Color',
      effects: [
        { type: 'colorama' as EffectType, name: 'Colorama', icon: '🎨' },
        { type: 'thermal' as EffectType, name: 'Thermal', icon: '🔥' },
        { type: 'invert' as EffectType, name: 'Invert', icon: '🔄' },
        { type: 'posterize' as EffectType, name: 'Posterize', icon: '🎭' },
      ]
    },
    {
      name: 'Distort',
      effects: [
        { type: 'glitch' as EffectType, name: 'Glitch', icon: '⚡' },
        { type: 'wave' as EffectType, name: 'Wave', icon: '🌊' },
        { type: 'fisheye' as EffectType, name: 'Fisheye', icon: '👁️' },
        { type: 'mirror' as EffectType, name: 'Mirror', icon: '🪞' },
        { type: 'kaleidoscope' as EffectType, name: 'Kaleidoscope', icon: '❄️' },
      ]
    },
    {
      name: 'Filter',
      effects: [
        { type: 'blur' as EffectType, name: 'Blur', icon: '💨' },
        { type: 'sharpen' as EffectType, name: 'Sharpen', icon: '🔪' },
        { type: 'pixelate' as EffectType, name: 'Pixelate', icon: '🧱' },
        { type: 'dither' as EffectType, name: 'Dither', icon: '📺' },
      ]
    },
    {
      name: 'Edge',
      effects: [
        { type: 'edgeDetect' as EffectType, name: 'Edge Detect', icon: '📐' },
        { type: 'outline' as EffectType, name: 'Outline', icon: '✏️' },
        { type: 'emboss' as EffectType, name: 'Emboss', icon: '🏔️' },
      ]
    },
    {
      name: 'Retro',
      effects: [
        { type: 'vhs' as EffectType, name: 'VHS', icon: '📼' },
        { type: 'scanlines' as EffectType, name: 'Scanlines', icon: '📡' },
        { type: 'noise' as EffectType, name: 'Noise', icon: '📻' },
        { type: 'nightVision' as EffectType, name: 'Night Vision', icon: '🌙' },
      ]
    },
    {
      name: 'Mask',
      effects: [
        { type: 'vignette' as EffectType, name: 'Vignette', icon: '⭕' },
        { type: 'edgeFeather' as EffectType, name: 'Edge Feather', icon: '🪶' },
      ]
    },
    {
      name: 'Procedural',
      effects: [
        { type: 'plasma' as EffectType, name: 'Plasma', icon: '🌈' },
      ]
    },
  ];

  // Use shared effect parameter definitions (covers all 81+ effects)
  const effectParamDefs = EFFECT_PARAM_DEFS;

  // Shaders loaded from manifest
  interface ShaderInfo {
    id: string;
    name: string;
    src: string;
    thumbnail?: string; // URL to pre-generated thumbnail image
  }
  let shaders: ShaderInfo[] = [];
  let shadersLoading = false;
  let thumbnailManifest: Record<string, string> = {}; // shader filename → thumbnail jpg

  // Media library items received from desktop
  interface LibraryItem {
    id: string;
    name: string;
    src: string;
    type: 'video' | 'image';
    thumbnail?: string;
  }
  let libraryItems: LibraryItem[] = [];

  // VJ Clip Launcher state received from desktop
  interface VJClipInfo {
    id: string;
    type: 'shader' | 'video' | 'image' | 'threejs';
    name: string;
    src: string;
    thumbnail?: string;
    shaderCode?: string;
    shaderValues?: Record<string, any>;
    effects?: Effect[];
  }
  interface VJBlockInfo {
    id: string;
    name: string;
    clipGrid: (VJClipInfo | null)[][];
    bankBClipGrid?: (VJClipInfo | null)[][];
  }
  interface VJLayerStateInfo {
    opacity: number;
    blendMode: string;
    activeColumn: number | null;
    activeClip: VJClipInfo | null;
    solo?: boolean;
    mute?: boolean;
    effects: Effect[];
  }
  // ── Performer-surface companion state (added v0.3.x) ──
  interface MobileMacroInfo {
    id: string;
    name: string;
    color: string;
    value: number;
    destCount: number;
    pulseMode?: string;
  }
  interface MobileSnapshotInfo {
    id: string;
    slot: number;
    name: string;
    color: string;
    populated: boolean;
  }
  interface VJClipsState {
    blocks: VJBlockInfo[];
    activeBlockId: string;
    layerStates: VJLayerStateInfo[];
    bankBLayerStates?: VJLayerStateInfo[];
    isLive: boolean;
    masterOpacity?: number;
    compositionEffects?: Effect[];
    // Crossfader
    crossfaderEnabled?: boolean;
    crossfaderValue?: number;
    crossfaderTransition?: string;
    crossfaderCurve?: string;
    crossfaderBlendMode?: string;
    selectedDeck?: 'A' | 'B';
    // Quantization
    quantization?: string;
    pendingTriggerCount?: number;
    // Performer surfaces
    macros?: MobileMacroInfo[];
    snapshots?: MobileSnapshotInfo[];
    activeSnapshotId?: string | null;
    // Tempo
    bpm?: number;
    manualBPM?: number | null;
    beat?: boolean;
  }
  let vjClipsState: VJClipsState | null = null;

  // Beat pulse state — bumped by every `beat_pulse` message from desktop.
  // Counter form so child components can `{#key beatPulseCount}` to
  // restart their flash animations cleanly on every beat. Intensity
  // decays to 0 ~80ms after the pulse so the visual effect lasts one
  // frame at any reasonable BPM.
  let beatPulseCount = 0;
  let beatPulseIntensity = 0;
  let beatPulseTimer: ReturnType<typeof setTimeout> | null = null;

  // Expanded effect tracking for mobile UI
  let expandedEffectId: string | null = null;

  // ═══ Drag guard: track which params are being touched to prevent WS bounce-back ═══
  const activeDrags = new Set<string>();

  function markDragActive(key: string) {
    activeDrags.add(key);
  }

  function markDragEnd(key: string) {
    // Delay clearing to let the final WS round-trip settle
    setTimeout(() => activeDrags.delete(key), 300);
  }

  // Safety net: a lost pointercancel (browser-handled gesture, modal,
  // visibility change, app switch) can leave a drag key in activeDrags
  // forever, permanently muting WS sync for that param. We listen for
  // global pointercancel + visibility-hidden + window blur to flush
  // the entire set as a fallback. Runs ~zero overhead under normal
  // operation since these events are rare.
  function flushAllDrags() {
    if (activeDrags.size === 0) return;
    activeDrags.clear();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pointercancel', flushAllDrags);
    window.addEventListener('blur', flushAllDrags);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAllDrags();
    });
  }

  // ═══ Throttle utility: send at most once per interval, with trailing edge ═══
  function createThrottle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
    let lastCall = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: any[] | null = null;
    return ((...args: any[]) => {
      lastArgs = args;
      const now = Date.now();
      const remaining = ms - (now - lastCall);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        lastCall = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          lastCall = Date.now();
          timer = null;
          if (lastArgs) fn(...lastArgs);
        }, remaining);
      }
    }) as T;
  }

  // ═══ PWA install state ═══
  let isPWA = false;
  let deferredInstallPrompt: any = null;
  let showInstallBanner = false;

  // Compositions/presets received from desktop
  interface CompositionInfo {
    id: string;
    name: string;
    thumbnail?: string;
  }
  let compositions: CompositionInfo[] = [];

  // View tab for media library (shaders, media, vj clips, compositions)
  let mediaTab: 'shaders' | 'media' | 'vj' | 'presets' = 'vj';

  const blendModes: BlendMode[] = [
    'normal', 'multiply', 'screen', 'difference',
    'add', 'subtract', 'overlay', 'darken', 'lighten',
    'exclusion', 'hardlight', 'softlight', 'color-dodge', 'color-burn',
    'hue', 'saturation', 'color', 'luminosity',
    'divide', 'average', 'negation', 'phoenix',
    'linear-light', 'hard-mix', 'vivid-light', 'pin-light'
  ];

  // Generate simple UUID for shader IDs
  function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Load pre-generated thumbnails manifest
  async function loadThumbnailManifest() {
    try {
      const resp = await fetch('./ISF/thumbnails/manifest.json');
      if (resp.ok) {
        const data = await resp.json();
        // Build lookup: shader filename (no ext) → jpg filename
        if (data && typeof data === 'object') {
          for (const [key, val] of Object.entries(data)) {
            thumbnailManifest[key] = val as string;
          }
        }
      }
    } catch {
      // No thumbnails manifest — that's fine, we'll show fallback icons
    }
  }

  // Load shaders from manifest
  async function loadShaders() {
    shadersLoading = true;
    // Load thumbnail manifest in parallel
    await loadThumbnailManifest();
    try {
      const response = await fetch('./ISF/manifest.json');
      const manifest = await response.json();

      const loadedShaders: ShaderInfo[] = [];
      // Support both v1 (flat array) and v2 (objects with metadata) manifest formats
      const entries: Array<{ file: string }> =
        manifest.version === 2
          ? manifest.shaders.filter((s: any) => s.enabled !== false)
          : manifest.shaders.map((f: string) => ({ file: f }));
      for (const entry of entries) {
        const filename = entry.file;
        const baseName = filename.replace('.fs', '');
        const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
        // Look up thumbnail from pre-generated manifest
        const thumbFile = thumbnailManifest[baseName] || thumbnailManifest[filename];
        loadedShaders.push({
          id: generateUUID(),
          name: baseName.replace('DM-', ''),
          src: `./ISF/${encodedPath}`,
          thumbnail: thumbFile ? `./ISF/thumbnails/${encodeURIComponent(thumbFile)}` : undefined,
        });
      }
      shaders = loadedShaders;
    } catch (err) {
      console.error('Failed to load shader manifest:', err);
    }
    shadersLoading = false;
  }

  onMount(() => {
    // ── PWA detection ──
    isPWA = !!(window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;

    // Listen for the install prompt (Chrome/Edge on Android)
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      // Show install banner on the connect screen (not if already PWA)
      if (!isPWA) showInstallBanner = true;
    });

    // Determine server URL: prefer saved, then derive from page hostname
    const hostname = window.location.hostname;
    let savedUrl: string | null = null;
    try { savedUrl = localStorage.getItem('ghost-arcade_server_url'); } catch { /* private browsing */ }

    if (savedUrl) {
      // Validate saved URL matches current hostname (IP may have changed via DHCP)
      try {
        const savedHost = new URL(savedUrl).hostname;
        if (savedHost === hostname || savedHost === 'localhost' || savedHost === '127.0.0.1') {
          serverUrl = savedUrl;
        } else {
          serverUrl = `ws://${hostname}:9001`;
        }
      } catch {
        serverUrl = `ws://${hostname}:9001`;
      }
    } else {
      serverUrl = `ws://${hostname}:9001`;
    }

    updateViewportSize();
    window.addEventListener('resize', updateViewportSize);

    // Load shaders from manifest
    loadShaders();

    // If running as PWA, auto-connect
    if (isPWA && serverUrl) {
      connect();
    }
  });

  onDestroy(() => {
    disconnect();
    window.removeEventListener('resize', updateViewportSize);
  });

  function updateViewportSize() {
    if (viewportEl) {
      const rect = viewportEl.getBoundingClientRect();
      viewportWidth = rect.width;
      viewportHeight = rect.height;
    }
  }

  function connect() {
    if (ws) {
      ws.close();
    }

    error = '';
    connecting = true;

    // Clear any previous timeout
    if (connectTimeout) {
      clearTimeout(connectTimeout);
      connectTimeout = null;
    }

    // If serverUrl is empty, compute from page hostname
    if (!serverUrl || serverUrl.trim() === '') {
      serverUrl = `ws://${window.location.hostname}:9001`;
    }

    // Store the current serverUrl so we can reference it in callbacks
    const targetUrl = serverUrl;
    let socket: WebSocket;

    try {
      socket = new WebSocket(targetUrl);
    } catch (err) {
      error = 'Invalid URL format. Use format: ws://IP_ADDRESS:9001';
      connecting = false;
      return;
    }

    ws = socket;

    // Timeout if connection doesn't complete within 6 seconds
    connectTimeout = setTimeout(() => {
      if (!connected && socket.readyState !== WebSocket.OPEN) {
        socket.close();
        connecting = false;
        error = `Could not reach server at ${targetUrl}. Check that the desktop app is running and both devices are on the same network.`;
      }
    }, 6000);

    socket.onopen = () => {
      console.log('[Mobile] WebSocket connected to', targetUrl);
      // Reset reconnect state on successful connection
      stopReconnect();
      // Update state — use setTimeout to guarantee Svelte picks up the change
      setTimeout(() => {
        connected = true;
        connecting = false;
        error = '';
        tick(); // Force Svelte to flush DOM updates
      }, 0);

      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      try { localStorage.setItem('ghost-arcade_server_url', targetUrl); } catch { /* private browsing */ }
      // Request initial sync
      socket.send(JSON.stringify({ type: 'sync_request' }));
      // Retry sync_request after delays in case desktop hasn't sent state yet
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN && (!projectState?.layers?.length)) {
          socket.send(JSON.stringify({ type: 'sync_request' }));
        }
      }, 2000);
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN && (!projectState?.layers?.length)) {
          socket.send(JSON.stringify({ type: 'sync_request' }));
        }
      }, 5000);
    };

    socket.onclose = () => {
      console.log('[Mobile] WebSocket closed');
      const wasConnected = connected;
      connected = false;
      connecting = false;
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      // Auto-reconnect if we were previously connected (not a manual disconnect or first-time failure)
      if (wasConnected && serverUrl) {
        scheduleReconnect();
      }
    };

    socket.onerror = (evt) => {
      console.error('[Mobile] WebSocket error:', evt);
      error = `Connection failed to ${targetUrl}. Check the server URL and ensure both devices are on the same WiFi.`;
      connected = false;
      connecting = false;
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
    };

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleMessage(msg);
      } catch (err) {
        console.error('[Mobile] Failed to parse message:', err);
      }
    };
  }

  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
    connected = false;
    connecting = false;
    projectState = null;
    if (connectTimeout) {
      clearTimeout(connectTimeout);
      connectTimeout = null;
    }
  }

  function handleMessage(msg: { type: string; [key: string]: unknown }) {
    switch (msg.type) {
      case 'sync':
        projectState = msg.project as Project;
        selectedLayerId = projectState?.selectedLayerId || null;
        // Update mesh size from selected layer if available
        if (selectedLayer?.meshGrid) {
          meshRows = selectedLayer.meshGrid.rows;
          meshCols = selectedLayer.meshGrid.cols;
        }
        break;

      case 'control_point': {
        const { layerId, corner, position } = (msg.payload as unknown) as {
          layerId: string;
          corner: keyof WarpCorners;
          position: Point2D;
        };
        if (projectState) {
          const layer = projectState.layers.find(l => l.id === layerId);
          if (layer) {
            layer.corners[corner] = position;
            projectState = projectState; // Trigger reactivity
          }
        }
        break;
      }

      case 'mesh_point': {
        const { layerId, row, col, position } = (msg.payload as unknown) as {
          layerId: string;
          row: number;
          col: number;
          position: Point2D;
        };
        if (projectState) {
          const layer = projectState.layers.find(l => l.id === layerId);
          if (layer?.meshGrid?.points?.[row]) {
            layer.meshGrid.points[row][col] = position;
            projectState = projectState; // Trigger reactivity
          }
        }
        break;
      }

      case 'parameter': {
        const { layerId, param, value } = (msg.payload as unknown) as {
          layerId: string;
          param: string;
          value: number | string | boolean;
        };
        if (projectState) {
          const layer = projectState.layers.find(l => l.id === layerId);
          if (layer) {
            if (param === 'opacity') layer.opacity = value as number;
            if (param === 'blendMode') layer.blendMode = value as BlendMode;
            if (param === 'visible') layer.visible = value as boolean;
            projectState = projectState;
          }
        }
        break;
      }

      case 'select_layer':
        selectedLayerId = msg.layerId as string;
        break;

      case 'library_sync':
        // Receive media library from desktop
        libraryItems = (msg.library as LibraryItem[]) || [];
        break;

      case 'vj_clips_sync': {
        // Receive VJ clips state from desktop
        const incoming = (msg.vjClips as VJClipsState) || null;
        if (incoming && vjClipsState && activeDrags.size > 0) {
          // ── Preserve locally-dragged values to prevent bounce-back ──
          // Any drag key marked active by a sender means the local UI is
          // mid-gesture; use the local value instead of the incoming one
          // until the gesture ends. Without this, fast drags visibly
          // fight the WS sync and snap-back.
          if (activeDrags.has('master-opacity')) {
            incoming.masterOpacity = vjClipsState.masterOpacity;
          }
          // Bank A + Bank B per-layer opacity drags — keys match the
          // format set by setVJLayerOpacityBank: `layer-opacity-A-${i}`
          // or `layer-opacity-B-${i}`. (v17.1: legacy `layer-opacity-${i}`
          // is also still preserved for the older non-bank sender.)
          for (let i = 0; i < (incoming.layerStates?.length ?? 0); i++) {
            if (activeDrags.has(`layer-opacity-${i}`) || activeDrags.has(`layer-opacity-A-${i}`)) {
              incoming.layerStates[i].opacity = vjClipsState.layerStates[i]?.opacity ?? incoming.layerStates[i].opacity;
            }
            // Preserve effect param values being actively dragged
            for (const key of activeDrags) {
              const match = key.match(/^effect-param-(\d+)-(.+)-(.+)$/);
              if (match && parseInt(match[1]) === i) {
                const effectId = match[2];
                const paramKey = match[3];
                const localEffect = vjClipsState.layerStates[i]?.effects?.find(e => e.id === effectId);
                const incomingEffect = incoming.layerStates[i]?.effects?.find(e => e.id === effectId);
                if (localEffect && incomingEffect) {
                  (incomingEffect.params as any)[paramKey] = (localEffect.params as any)[paramKey];
                }
              }
            }
            // Preserve shader-param values being dragged
            for (const key of activeDrags) {
              const match = key.match(/^shader-param-(\d+)-(.+)$/);
              if (match && parseInt(match[1]) === i) {
                const paramName = match[2];
                const localClip = vjClipsState.layerStates[i]?.activeClip;
                const incomingClip = incoming.layerStates[i]?.activeClip;
                if (localClip?.shaderValues && incomingClip) {
                  if (!incomingClip.shaderValues) incomingClip.shaderValues = {};
                  incomingClip.shaderValues[paramName] = localClip.shaderValues[paramName];
                }
              }
            }
          }
          // Bank B per-layer opacity drags
          if (incoming.bankBLayerStates) {
            for (let i = 0; i < incoming.bankBLayerStates.length; i++) {
              if (activeDrags.has(`layer-opacity-B-${i}`)) {
                incoming.bankBLayerStates[i].opacity =
                  vjClipsState.bankBLayerStates?.[i]?.opacity ?? incoming.bankBLayerStates[i].opacity;
              }
            }
          }
          // Crossfader value drag — single global field
          if (activeDrags.has('crossfader-value')) {
            incoming.crossfaderValue = vjClipsState.crossfaderValue;
          }
          // Macro value drags — keyed by macro id (`macro-${id}`)
          if (incoming.macros && vjClipsState.macros) {
            for (const m of incoming.macros) {
              if (activeDrags.has(`macro-${m.id}`)) {
                const local = vjClipsState.macros.find(mm => mm.id === m.id);
                if (local) m.value = local.value;
              }
            }
          }
          // Preserve comp effect params being dragged
          for (const key of activeDrags) {
            const match = key.match(/^comp-effect-param-(.+)-(.+)$/);
            if (match && incoming.compositionEffects && vjClipsState.compositionEffects) {
              const effectId = match[1];
              const paramKey = match[2];
              const localEffect = vjClipsState.compositionEffects.find(e => e.id === effectId);
              const incomingEffect = incoming.compositionEffects.find(e => e.id === effectId);
              if (localEffect && incomingEffect) {
                (incomingEffect.params as any)[paramKey] = (localEffect.params as any)[paramKey];
              }
            }
          }
          // Preserve clip effect params being dragged
          // (key format: `clip-effect-param-${layerIndex}-${columnIndex}-${effectId}-${paramKey}`)
          for (const key of activeDrags) {
            const match = key.match(/^clip-effect-param-(\d+)-(\d+)-(.+)-(.+)$/);
            if (match && incoming.blocks && vjClipsState.blocks) {
              const layerIndex = parseInt(match[1]);
              const columnIndex = parseInt(match[2]);
              const effectId = match[3];
              const paramKey = match[4];
              const incomingBlock = incoming.blocks.find(b => b.id === incoming.activeBlockId);
              const localBlock = vjClipsState.blocks.find(b => b.id === vjClipsState!.activeBlockId);
              const localClip = localBlock?.clipGrid[layerIndex]?.[columnIndex];
              const incomingClip = incomingBlock?.clipGrid[layerIndex]?.[columnIndex];
              if (localClip?.effects && incomingClip?.effects) {
                const localEffect = localClip.effects.find(e => e.id === effectId);
                const incomingEffect = incomingClip.effects.find(e => e.id === effectId);
                if (localEffect && incomingEffect) {
                  (incomingEffect.params as any)[paramKey] = (localEffect.params as any)[paramKey];
                }
              }
            }
          }
        }
        vjClipsState = incoming;
        break;
      }

      case 'beat_pulse': {
        // Tiny dedicated message: the desktop's audio analyzer detected
        // a beat. We don't try to thread this through vjClipsState
        // because the throttled sync would miss the rising edge.
        // Bump a counter that the TempoStrip watches to flash its TAP
        // button + BPM number in tempo with the music.
        beatPulseCount++;
        beatPulseIntensity = (msg as any).intensity ?? 1;
        // Auto-reset intensity after one frame so the visual flash decays
        if (beatPulseTimer) clearTimeout(beatPulseTimer);
        beatPulseTimer = setTimeout(() => { beatPulseIntensity = 0; }, 80);
        break;
      }

      case 'compositions_sync':
        // Receive compositions/presets from desktop
        compositions = (msg.compositions as CompositionInfo[]) || [];
        break;
    }
  }

  function sendControlPoint(layerId: string, corner: keyof WarpCorners, position: Point2D) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'control_point',
        layerId,
        corner,
        position,
      }));
    }
  }

  function sendMeshPoint(layerId: string, row: number, col: number, position: Point2D) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'mesh_point',
        layerId,
        row,
        col,
        position,
      }));
    }
  }

  function sendParameter(layerId: string, param: string, value: number | string | boolean) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'parameter',
        layerId,
        param,
        value,
      }));
    }
  }

  function selectLayer(layerId: string) {
    selectedLayerId = layerId;
    // Update mesh size from selected layer
    const layer = projectState?.layers.find(l => l.id === layerId);
    if (layer?.meshGrid) {
      meshRows = layer.meshGrid.rows;
      meshCols = layer.meshGrid.cols;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'select_layer',
        layerId,
      }));
    }
  }

  // Send warp mode change
  function sendWarpMode(mode: 'corners' | 'mesh') {
    if (!selectedLayer || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'warp_mode',
      layerId: selectedLayer.id,
      mode,
    }));
  }

  // Send mesh grid resize
  function sendMeshResize(rows: number, cols: number) {
    if (!selectedLayer || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'mesh_resize',
      layerId: selectedLayer.id,
      rows,
      cols,
    }));
  }

  // Handle view mode change - also sends warp mode to desktop
  function setViewMode(mode: 'corners' | 'mesh') {
    viewMode = mode;
    sendWarpMode(mode);
  }

  // Handle mesh size change
  function handleMeshSizeChange() {
    sendMeshResize(meshRows, meshCols);
  }

  // Send media trigger to set layer source
  function triggerMedia(sourceType: 'threejs' | 'shader' | 'video' | 'image', sourceSrc: string, sourceName: string) {
    if (!selectedLayerId || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'set_layer_source',
      layerId: selectedLayerId,
      sourceType,
      sourceSrc,
      sourceName,
    }));
    // Close the media library after triggering
    showMediaLibrary = false;
  }

  // VJ Clip Launcher control functions
  function triggerVJClip(layerIndex: number, columnIndex: number) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'trigger_vj_clip',
      layerIndex,
      columnIndex,
    }));
  }

  function triggerVJColumn(columnIndex: number) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'trigger_vj_column',
      columnIndex,
    }));
  }

  function stopVJLayer(layerIndex: number) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'stop_vj_layer',
      layerIndex,
    }));
  }

  function stopAllVJ() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'stop_all_vj',
    }));
  }

  function setVJBlock(blockId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'set_vj_block',
      blockId,
    }));
  }

  function toggleVJLive() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !vjClipsState) return;
    ws.send(JSON.stringify({
      type: 'set_vj_live',
      isLive: !vjClipsState.isLive,
    }));
  }

  // Throttled WS senders (30fps max — smooth for VJ without flooding the socket)
  const throttledSendMasterOpacity = createThrottle((opacity: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_master_opacity', opacity }));
  }, 33);

  const throttledSendLayerOpacity = createThrottle((layerIndex: number, opacity: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_layer_opacity', layerIndex, opacity }));
  }, 33);

  const throttledSendEffectParams = createThrottle((type: string, payload: any) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }, 33);

  const throttledSendShaderValue = createThrottle((layerIndex: number, paramName: string, value: any) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'update_vj_shader_value', layerIndex, paramName, value }));
  }, 33);

  function setVJMasterOpacity(opacity: number) {
    markDragActive('master-opacity');
    // Update local state IMMEDIATELY (no throttle on UI)
    if (vjClipsState) {
      vjClipsState.masterOpacity = opacity;
      vjClipsState = vjClipsState;
    }
    // Throttle the network send
    throttledSendMasterOpacity(opacity);
  }

  function onMasterOpacityDragEnd() {
    markDragEnd('master-opacity');
  }

  function loadComposition(compositionId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'load_composition',
      compositionId,
    }));
    showMediaLibrary = false;
  }

  // VJ Layer control functions
  function setVJLayerOpacity(layerIndex: number, opacity: number) {
    markDragActive(`layer-opacity-${layerIndex}`);
    // Update local state IMMEDIATELY (no throttle on UI)
    if (vjClipsState && vjClipsState.layerStates[layerIndex]) {
      vjClipsState.layerStates[layerIndex].opacity = opacity;
      vjClipsState = vjClipsState;
    }
    // Throttle the network send
    throttledSendLayerOpacity(layerIndex, opacity);
  }

  function onLayerOpacityDragEnd(layerIndex: number) {
    markDragEnd(`layer-opacity-${layerIndex}`);
  }

  function setVJLayerBlendMode(layerIndex: number, blendMode: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'set_vj_layer_blend_mode',
      layerIndex,
      blendMode,
    }));
    // Update local state for immediate feedback
    if (vjClipsState && vjClipsState.layerStates[layerIndex]) {
      vjClipsState.layerStates[layerIndex].blendMode = blendMode;
      vjClipsState = vjClipsState;
    }
  }

  // VJ Layer Effect functions
  function addVJLayerEffect(layerIndex: number, effectType: EffectType) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Create effect with default params
    const params: EffectParams = {};
    const paramDefs = effectParamDefs[effectType] || [];
    for (const def of paramDefs) {
      (params as Record<string, number>)[def.param as string] = def.default;
    }

    const effect: Effect = {
      id: generateUUID(),
      type: effectType,
      enabled: true,
      params,
    };

    ws.send(JSON.stringify({
      type: 'add_vj_layer_effect',
      layerIndex,
      effect,
    }));

    // Update local state for immediate feedback
    if (vjClipsState && vjClipsState.layerStates[layerIndex]) {
      if (!vjClipsState.layerStates[layerIndex].effects) {
        vjClipsState.layerStates[layerIndex].effects = [];
      }
      vjClipsState.layerStates[layerIndex].effects.push(effect);
      vjClipsState = vjClipsState;
      // Auto-expand newly added effect
      expandedEffectId = effect.id;
    }
  }

  function removeVJLayerEffect(layerIndex: number, effectId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'remove_vj_layer_effect',
      layerIndex,
      effectId,
    }));

    // Update local state for immediate feedback
    if (vjClipsState && vjClipsState.layerStates[layerIndex]) {
      vjClipsState.layerStates[layerIndex].effects =
        vjClipsState.layerStates[layerIndex].effects.filter(e => e.id !== effectId);
      vjClipsState = vjClipsState;
    }

    if (expandedEffectId === effectId) {
      expandedEffectId = null;
    }
  }

  function toggleVJLayerEffect(layerIndex: number, effectId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'toggle_vj_layer_effect',
      layerIndex,
      effectId,
    }));

    // Update local state for immediate feedback
    if (vjClipsState && vjClipsState.layerStates[layerIndex]) {
      const effect = vjClipsState.layerStates[layerIndex].effects.find(e => e.id === effectId);
      if (effect) {
        effect.enabled = !effect.enabled;
        vjClipsState = vjClipsState;
      }
    }
  }

  function updateVJLayerEffectParams(layerIndex: number, effectId: string, params: Partial<EffectParams>) {
    // Mark each param as actively dragged
    for (const key of Object.keys(params)) {
      markDragActive(`effect-param-${layerIndex}-${effectId}-${key}`);
    }

    // Update local state IMMEDIATELY
    if (vjClipsState && vjClipsState.layerStates[layerIndex]) {
      const effect = vjClipsState.layerStates[layerIndex].effects.find(e => e.id === effectId);
      if (effect) {
        effect.params = { ...effect.params, ...params };
        vjClipsState = vjClipsState;
      }
    }

    // Throttle the network send
    throttledSendEffectParams('update_vj_layer_effect_params', { layerIndex, effectId, params });
  }

  function onEffectParamDragEnd(layerIndex: number, effectId: string, paramKey: string) {
    markDragEnd(`effect-param-${layerIndex}-${effectId}-${paramKey}`);
  }

  // Update a shader parameter value on an active clip
  function updateVJShaderValue(layerIndex: number, paramName: string, value: any) {
    markDragActive(`shader-param-${layerIndex}-${paramName}`);
    // Update local state IMMEDIATELY
    if (vjClipsState && vjClipsState.layerStates[layerIndex]?.activeClip) {
      if (!vjClipsState.layerStates[layerIndex].activeClip.shaderValues) {
        vjClipsState.layerStates[layerIndex].activeClip.shaderValues = {};
      }
      vjClipsState.layerStates[layerIndex].activeClip.shaderValues[paramName] = value;
      vjClipsState = vjClipsState;
    }
    // Throttle the network send
    throttledSendShaderValue(layerIndex, paramName, value);
  }

  function onShaderParamDragEnd(layerIndex: number, paramName: string) {
    markDragEnd(`shader-param-${layerIndex}-${paramName}`);
  }

  // ═══ Composition Effect Functions ═══

  function addVJCompEffect(effectType: EffectType) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const params: EffectParams = {};
    const paramDefs = effectParamDefs[effectType] || [];
    for (const def of paramDefs) {
      (params as Record<string, number>)[def.param as string] = def.default;
    }

    const effect: Effect = {
      id: generateUUID(),
      type: effectType,
      enabled: true,
      params,
    };

    ws.send(JSON.stringify({
      type: 'add_vj_comp_effect',
      effect,
    }));

    // Update local state for immediate feedback
    if (vjClipsState) {
      if (!vjClipsState.compositionEffects) {
        vjClipsState.compositionEffects = [];
      }
      vjClipsState.compositionEffects.push(effect);
      vjClipsState = vjClipsState;
    }
  }

  function removeVJCompEffect(effectId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'remove_vj_comp_effect',
      effectId,
    }));

    if (vjClipsState && vjClipsState.compositionEffects) {
      vjClipsState.compositionEffects = vjClipsState.compositionEffects.filter(e => e.id !== effectId);
      vjClipsState = vjClipsState;
    }
  }

  function toggleVJCompEffect(effectId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'toggle_vj_comp_effect',
      effectId,
    }));

    if (vjClipsState && vjClipsState.compositionEffects) {
      const effect = vjClipsState.compositionEffects.find(e => e.id === effectId);
      if (effect) {
        effect.enabled = !effect.enabled;
        vjClipsState = vjClipsState;
      }
    }
  }

  function updateVJCompEffectParams(effectId: string, params: Partial<EffectParams>) {
    for (const key of Object.keys(params)) {
      markDragActive(`comp-effect-param-${effectId}-${key}`);
    }

    if (vjClipsState && vjClipsState.compositionEffects) {
      const effect = vjClipsState.compositionEffects.find(e => e.id === effectId);
      if (effect) {
        effect.params = { ...effect.params, ...params };
        vjClipsState = vjClipsState;
      }
    }

    throttledSendEffectParams('update_vj_comp_effect_params', { effectId, params });
  }

  function onCompEffectParamDragEnd(effectId: string, paramKey: string) {
    markDragEnd(`comp-effect-param-${effectId}-${paramKey}`);
  }

  // ═══ Clip Effect Functions ═══

  function addVJClipEffect(layerIndex: number, columnIndex: number, effectType: EffectType) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const params: EffectParams = {};
    const paramDefs = effectParamDefs[effectType] || [];
    for (const def of paramDefs) {
      (params as Record<string, number>)[def.param as string] = def.default;
    }

    const effect: Effect = {
      id: generateUUID(),
      type: effectType,
      enabled: true,
      params,
    };

    ws.send(JSON.stringify({
      type: 'add_vj_clip_effect',
      layerIndex,
      columnIndex,
      effect,
    }));

    // Update local state for immediate feedback
    if (vjClipsState) {
      const activeBlock = vjClipsState.blocks.find(b => b.id === vjClipsState!.activeBlockId);
      if (activeBlock) {
        const clip = activeBlock.clipGrid[layerIndex]?.[columnIndex];
        if (clip) {
          if (!clip.effects) clip.effects = [];
          clip.effects.push(effect);
          vjClipsState = vjClipsState;
        }
      }
    }
  }

  function removeVJClipEffect(layerIndex: number, columnIndex: number, effectId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'remove_vj_clip_effect',
      layerIndex,
      columnIndex,
      effectId,
    }));

    if (vjClipsState) {
      const activeBlock = vjClipsState.blocks.find(b => b.id === vjClipsState!.activeBlockId);
      if (activeBlock) {
        const clip = activeBlock.clipGrid[layerIndex]?.[columnIndex];
        if (clip && clip.effects) {
          clip.effects = clip.effects.filter(e => e.id !== effectId);
          vjClipsState = vjClipsState;
        }
      }
    }
  }

  function toggleVJClipEffect(layerIndex: number, columnIndex: number, effectId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'toggle_vj_clip_effect',
      layerIndex,
      columnIndex,
      effectId,
    }));

    if (vjClipsState) {
      const activeBlock = vjClipsState.blocks.find(b => b.id === vjClipsState!.activeBlockId);
      if (activeBlock) {
        const clip = activeBlock.clipGrid[layerIndex]?.[columnIndex];
        if (clip && clip.effects) {
          const effect = clip.effects.find(e => e.id === effectId);
          if (effect) {
            effect.enabled = !effect.enabled;
            vjClipsState = vjClipsState;
          }
        }
      }
    }
  }

  function updateVJClipEffectParams(layerIndex: number, columnIndex: number, effectId: string, params: Partial<EffectParams>) {
    for (const key of Object.keys(params)) {
      markDragActive(`clip-effect-param-${layerIndex}-${columnIndex}-${effectId}-${key}`);
    }

    if (vjClipsState) {
      const activeBlock = vjClipsState.blocks.find(b => b.id === vjClipsState!.activeBlockId);
      if (activeBlock) {
        const clip = activeBlock.clipGrid[layerIndex]?.[columnIndex];
        if (clip && clip.effects) {
          const effect = clip.effects.find(e => e.id === effectId);
          if (effect) {
            effect.params = { ...effect.params, ...params };
            vjClipsState = vjClipsState;
          }
        }
      }
    }

    throttledSendEffectParams('update_vj_clip_effect_params', { layerIndex, columnIndex, effectId, params });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Performer-surface senders (added v0.3.x)
  //  Crossfader / dual-deck triggers / quantization / macros / snapshots
  //  / tap tempo. All mirror the desktop wiring so the iPad can drive
  //  the same paths the keyboard + MIDI can.
  // ═══════════════════════════════════════════════════════════════════

  // Per-deck triggers — bank='A' | 'B'. Falls back to the legacy untargeted
  // trigger when bank is omitted (older desktop builds without dual decks).
  function triggerVJClipBank(layerIndex: number, columnIndex: number, bank: 'A' | 'B' = 'A') {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'trigger_vj_clip', layerIndex, columnIndex, bank }));
  }
  function triggerVJColumnBank(columnIndex: number, bank: 'A' | 'B' = 'A') {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'trigger_vj_column', columnIndex, bank }));
  }
  function stopVJLayerBank(layerIndex: number, bank: 'A' | 'B' = 'A') {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'stop_vj_layer', layerIndex, bank }));
  }
  function setVJLayerOpacityBank(layerIndex: number, opacity: number, bank: 'A' | 'B' = 'A') {
    markDragActive(`layer-opacity-${bank}-${layerIndex}`);
    if (vjClipsState) {
      const ls = bank === 'B'
        ? vjClipsState.bankBLayerStates?.[layerIndex]
        : vjClipsState.layerStates[layerIndex];
      if (ls) {
        ls.opacity = opacity;
        vjClipsState = vjClipsState;
      }
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_vj_layer_opacity', layerIndex, opacity, bank }));
    }
  }
  function setVJLayerBlendModeBank(layerIndex: number, blendMode: string, bank: 'A' | 'B' = 'A') {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_layer_blend_mode', layerIndex, blendMode, bank }));
    if (vjClipsState) {
      const ls = bank === 'B'
        ? vjClipsState.bankBLayerStates?.[layerIndex]
        : vjClipsState.layerStates[layerIndex];
      if (ls) {
        ls.blendMode = blendMode;
        vjClipsState = vjClipsState;
      }
    }
  }
  function toggleVJLayerSolo(layerIndex: number, bank: 'A' | 'B' = 'A') {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'toggle_vj_layer_solo', layerIndex, bank }));
  }
  function toggleVJLayerMute(layerIndex: number, bank: 'A' | 'B' = 'A') {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'toggle_vj_layer_mute', layerIndex, bank }));
  }

  // ── Crossfader ──
  // Throttled sender so dragging the fader doesn't flood the socket. Local
  // state still updates immediately for tactile feedback.
  const throttledSendCrossfader = createThrottle((value: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_crossfader_value', value }));
  }, 33);
  function setVJCrossfaderValue(value: number) {
    markDragActive('crossfader-value');
    if (vjClipsState) {
      vjClipsState.crossfaderValue = value;
      vjClipsState = vjClipsState;
    }
    throttledSendCrossfader(value);
  }
  function setVJCrossfaderEnabled(enabled: boolean) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_crossfader_enabled', enabled }));
    if (vjClipsState) {
      vjClipsState.crossfaderEnabled = enabled;
      vjClipsState = vjClipsState;
    }
  }
  function setVJCrossfaderTransition(transition: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_crossfader_transition', transition }));
    if (vjClipsState) {
      vjClipsState.crossfaderTransition = transition;
      vjClipsState = vjClipsState;
    }
  }
  function setVJCrossfaderCurve(curve: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_crossfader_curve', curve }));
    if (vjClipsState) {
      vjClipsState.crossfaderCurve = curve;
      vjClipsState = vjClipsState;
    }
  }
  function setVJCrossfaderBlendMode(blendMode: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_crossfader_blend_mode', blendMode }));
    if (vjClipsState) {
      (vjClipsState as any).crossfaderBlendMode = blendMode;
      vjClipsState = vjClipsState;
    }
  }
  function vjCutToA() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'vj_cut_to_a' }));
    if (vjClipsState) {
      vjClipsState.crossfaderValue = 0;
      vjClipsState.selectedDeck = 'A';
      vjClipsState = vjClipsState;
    }
  }
  function vjCutToB() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'vj_cut_to_b' }));
    if (vjClipsState) {
      vjClipsState.crossfaderValue = 1;
      vjClipsState.selectedDeck = 'B';
      vjClipsState = vjClipsState;
    }
  }

  // ── Quantization ──
  function setVJQuantization(grid: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_quantization', grid }));
    if (vjClipsState) {
      vjClipsState.quantization = grid;
      vjClipsState = vjClipsState;
    }
  }
  function clearVJPendingTriggers() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'clear_vj_pending_triggers' }));
    if (vjClipsState) {
      vjClipsState.pendingTriggerCount = 0;
      vjClipsState = vjClipsState;
    }
  }

  // ── Macros (8 knobs) ──
  // Throttle the macro-value send the same way as opacity faders. Local
  // state updates immediately so dragging feels tactile, but we cap the
  // wire rate so a fast sweep doesn't saturate the socket.
  const throttledSendMacroValue = createThrottle((macroId: string, value: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set_vj_macro_value', macroId, value }));
  }, 33);
  function setVJMacroValue(macroId: string, value: number) {
    markDragActive(`macro-${macroId}`);
    if (vjClipsState && vjClipsState.macros) {
      const m = vjClipsState.macros.find(mm => mm.id === macroId);
      if (m) {
        m.value = value;
        vjClipsState = vjClipsState;
      }
    }
    throttledSendMacroValue(macroId, value);
  }

  // ── Snapshots (16 slots) ──
  function recallVJSnapshot(index: number) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'recall_vj_snapshot', index }));
  }
  function saveVJSnapshot(index: number, name?: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'save_vj_snapshot', index, name }));
  }

  // ── Tempo ──
  function vjTapTempo() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'vj_tap_tempo' }));
  }
  function vjClearManualBPM() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'vj_clear_manual_bpm' }));
  }

  // Open effects panel for a specific layer
  function openEffectsPanel(layerIndex: number) {
    effectsLayerIndex = layerIndex;
    showEffectsPanel = true;
    expandedEffectId = null;
  }

  function closeEffectsPanel() {
    showEffectsPanel = false;
    effectsLayerIndex = null;
    expandedEffectId = null;
  }

  // Get current layer effects
  $: currentLayerEffects = effectsLayerIndex !== null && vjClipsState
    ? (vjClipsState.layerStates[effectsLayerIndex]?.effects || [])
    : [];

  // VJ Mixer panel visibility
  let showVJMixer = false;

  // Blend modes for VJ layers
  const vjBlendModes: BlendMode[] = [
    'normal', 'add', 'screen', 'multiply', 'overlay',
    'difference', 'exclusion', 'darken', 'lighten', 'hardlight', 'softlight', 'color-dodge', 'color-burn',
    'hue', 'saturation', 'color', 'luminosity',
    'divide', 'average', 'negation', 'phoenix',
    'linear-light', 'hard-mix', 'vivid-light', 'pin-light'
  ];

  // Get active block from VJ clips state
  $: activeVJBlock = vjClipsState?.blocks.find(b => b.id === vjClipsState?.activeBlockId) || null;

  // Touch handling for warp control
  function handleTouchStart(corner: keyof WarpCorners, e: TouchEvent) {
    e.preventDefault();
    const layer = selectedLayer;
    if (!layer || layer.locked) return;

    draggingCorner = corner;
    const touch = e.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };
    cornerStartPos = { ...layer.corners[corner] };
  }

  function handleTouchMove(e: TouchEvent) {
    if (!draggingCorner || !selectedLayer || !viewportEl) return;
    e.preventDefault();

    const touch = e.touches[0];

    // Calculate padding based on viewport size
    const paddingX = viewportWidth * VIEWPORT_PADDING_PERCENT;
    const paddingY = viewportHeight * VIEWPORT_PADDING_PERCENT;
    const drawWidth = viewportWidth - paddingX * 2;
    const drawHeight = viewportHeight - paddingY * 2;

    // Calculate delta in normalized coordinates
    const deltaX = (touch.clientX - touchStartPos.x) / drawWidth;
    const deltaY = -(touch.clientY - touchStartPos.y) / drawHeight; // Invert Y

    // No clamping - allow dragging off-canvas like desktop
    const newPos: Point2D = {
      x: cornerStartPos.x + deltaX,
      y: cornerStartPos.y + deltaY,
    };

    // Update local state immediately for responsiveness
    if (projectState) {
      const layer = projectState.layers.find(l => l.id === selectedLayerId);
      if (layer) {
        layer.corners[draggingCorner] = newPos;
        projectState = projectState;
      }
    }

    // Send to server
    sendControlPoint(selectedLayerId!, draggingCorner, newPos);
  }

  function handleTouchEnd() {
    draggingCorner = null;
    draggingMeshPoint = null;
  }

  // Viewport navigation — pinch-to-zoom + two-finger-pan (native touch gestures)
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 5;
  const MAX_PAN = 500;

  // Pinch/pan gesture state
  let gestureActive = false;
  let gesturePrevDist = 0;
  let gesturePrevCenterX = 0;
  let gesturePrevCenterY = 0;
  let gestureStartScale = 1;

  function handleViewportTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      // Two-finger gesture: start pinch/pan
      e.preventDefault();
      gestureActive = true;
      const t0 = e.touches[0], t1 = e.touches[1];
      gesturePrevDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      gesturePrevCenterX = (t0.clientX + t1.clientX) / 2;
      gesturePrevCenterY = (t0.clientY + t1.clientY) / 2;
      gestureStartScale = viewportScale;
    }
    // Single-finger touches pass through for layer/mesh dragging
  }

  function handleViewportTouchMove(e: TouchEvent) {
    if (!gestureActive || e.touches.length < 2) return;
    e.preventDefault();

    const t0 = e.touches[0], t1 = e.touches[1];
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const centerX = (t0.clientX + t1.clientX) / 2;
    const centerY = (t0.clientY + t1.clientY) / 2;

    // Pinch zoom
    if (gesturePrevDist > 0) {
      const scaleFactor = dist / gesturePrevDist;
      viewportScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewportScale * scaleFactor));
    }

    // Two-finger pan
    const panDx = centerX - gesturePrevCenterX;
    const panDy = centerY - gesturePrevCenterY;
    viewportPanX = Math.max(-MAX_PAN, Math.min(MAX_PAN, viewportPanX + panDx));
    viewportPanY = Math.max(-MAX_PAN, Math.min(MAX_PAN, viewportPanY + panDy));

    gesturePrevDist = dist;
    gesturePrevCenterX = centerX;
    gesturePrevCenterY = centerY;
  }

  function handleViewportTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) {
      gestureActive = false;
    }
  }

  // Svelte action: mount touch gesture listeners on viewport with passive:false
  function mountViewportGestures(el: HTMLElement) {
    el.addEventListener('touchstart', handleViewportTouchStart, { passive: false });
    el.addEventListener('touchmove', handleViewportTouchMove, { passive: false });
    el.addEventListener('touchend', handleViewportTouchEnd, { passive: false });
    return {
      destroy() {
        el.removeEventListener('touchstart', handleViewportTouchStart);
        el.removeEventListener('touchmove', handleViewportTouchMove);
        el.removeEventListener('touchend', handleViewportTouchEnd);
      }
    };
  }

  // Reset viewport zoom/pan (double-tap or button)
  function resetViewportTransform() {
    viewportScale = 1;
    viewportPanX = 0;
    viewportPanY = 0;
  }

  // Mesh point touch handling
  function handleMeshTouchStart(row: number, col: number, e: TouchEvent) {
    e.preventDefault();
    const layer = selectedLayer;
    if (!layer || layer.locked || !layer.meshGrid) return;

    draggingMeshPoint = { row, col };
    const touch = e.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };
    meshPointStartPos = { ...layer.meshGrid.points[row][col] };
  }

  function handleMeshTouchMove(e: TouchEvent) {
    if (!draggingMeshPoint || !selectedLayer || !viewportEl || !selectedLayer.meshGrid) return;
    e.preventDefault();

    const touch = e.touches[0];

    // Calculate padding based on viewport size
    const paddingX = viewportWidth * VIEWPORT_PADDING_PERCENT;
    const paddingY = viewportHeight * VIEWPORT_PADDING_PERCENT;
    const drawWidth = viewportWidth - paddingX * 2;
    const drawHeight = viewportHeight - paddingY * 2;

    // Calculate delta in normalized coordinates
    const deltaX = (touch.clientX - touchStartPos.x) / drawWidth;
    const deltaY = -(touch.clientY - touchStartPos.y) / drawHeight; // Invert Y

    // No clamping - allow dragging off-canvas like desktop
    const newPos: Point2D = {
      x: meshPointStartPos.x + deltaX,
      y: meshPointStartPos.y + deltaY,
    };

    // Update local state immediately for responsiveness
    if (projectState) {
      const layer = projectState.layers.find(l => l.id === selectedLayerId);
      if (layer?.meshGrid?.points?.[draggingMeshPoint.row]) {
        layer.meshGrid.points[draggingMeshPoint.row][draggingMeshPoint.col] = newPos;
        projectState = projectState;
      }
    }

    // Send to server
    sendMeshPoint(selectedLayerId!, draggingMeshPoint.row, draggingMeshPoint.col, newPos);
  }

  // Computed
  $: selectedLayer = projectState?.layers.find(l => l.id === selectedLayerId) || null;

  // Calculate drawable area with padding for centered display
  $: paddingX = viewportWidth * VIEWPORT_PADDING_PERCENT;
  $: paddingY = viewportHeight * VIEWPORT_PADDING_PERCENT;
  $: drawWidth = viewportWidth - paddingX * 2;
  $: drawHeight = viewportHeight - paddingY * 2;
  $: drawOffsetX = paddingX;
  $: drawOffsetY = paddingY;

  // Convert normalized to pixel for display (with centering)
  function toPixel(point: Point2D): { x: number; y: number } {
    return {
      x: drawOffsetX + point.x * drawWidth,
      y: drawOffsetY + (1 - point.y) * drawHeight,
    };
  }

  $: handlePositions = selectedLayer?.corners
    ? {
        topLeft: toPixel(selectedLayer.corners.topLeft),
        topRight: toPixel(selectedLayer.corners.topRight),
        bottomLeft: toPixel(selectedLayer.corners.bottomLeft),
        bottomRight: toPixel(selectedLayer.corners.bottomRight),
      }
    : null;

  $: lines = handlePositions
    ? [
        { from: handlePositions.topLeft, to: handlePositions.topRight },
        { from: handlePositions.topRight, to: handlePositions.bottomRight },
        { from: handlePositions.bottomRight, to: handlePositions.bottomLeft },
        { from: handlePositions.bottomLeft, to: handlePositions.topLeft },
      ]
    : [];

  // Check if layer has mesh warp
  $: hasMeshWarp = selectedLayer?.warpMode === 'mesh' && selectedLayer?.meshGrid;

  // Get mesh points for display
  $: meshPoints = hasMeshWarp && selectedLayer?.meshGrid
    ? selectedLayer.meshGrid.points.flatMap((row, rowIdx) =>
        row.map((point, colIdx) => ({
          row: rowIdx,
          col: colIdx,
          x: drawOffsetX + point.x * drawWidth,
          y: drawOffsetY + (1 - point.y) * drawHeight,
          isCorner: (rowIdx === 0 || rowIdx === selectedLayer!.meshGrid!.rows - 1) &&
                    (colIdx === 0 || colIdx === selectedLayer!.meshGrid!.cols - 1),
        }))
      )
    : [];

  // Get mesh grid lines for display
  $: meshLines = hasMeshWarp && selectedLayer?.meshGrid
    ? (() => {
        const grid = selectedLayer.meshGrid;
        const lines: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];

        // Horizontal lines
        for (let r = 0; r < grid.rows; r++) {
          for (let c = 0; c < grid.cols - 1; c++) {
            lines.push({
              from: {
                x: drawOffsetX + grid.points[r][c].x * drawWidth,
                y: drawOffsetY + (1 - grid.points[r][c].y) * drawHeight,
              },
              to: {
                x: drawOffsetX + grid.points[r][c + 1].x * drawWidth,
                y: drawOffsetY + (1 - grid.points[r][c + 1].y) * drawHeight,
              },
            });
          }
        }

        // Vertical lines
        for (let r = 0; r < grid.rows - 1; r++) {
          for (let c = 0; c < grid.cols; c++) {
            lines.push({
              from: {
                x: drawOffsetX + grid.points[r][c].x * drawWidth,
                y: drawOffsetY + (1 - grid.points[r][c].y) * drawHeight,
              },
              to: {
                x: drawOffsetX + grid.points[r + 1][c].x * drawWidth,
                y: drawOffsetY + (1 - grid.points[r + 1][c].y) * drawHeight,
              },
            });
          }
        }

        return lines;
      })()
    : [];
</script>

<svelte:window
  ontouchmove={(e) => {
    if (draggingCorner) handleTouchMove(e);
    else if (draggingMeshPoint) handleMeshTouchMove(e);
  }}
  ontouchend={handleTouchEnd}
/>

<div class="mobile-app">
  {#if !connected}
    <!-- Connection Screen -->
    <div class="connect-screen">
      <img class="connect-logo" src="{import.meta.env.BASE_URL}logo.png" alt="Ghost Arcade" />

      {#if connecting}
        <div class="connecting-indicator">
          <div class="spinner"></div>
          <p>Connecting to {serverUrl}...</p>
        </div>
      {:else}
        <p class="connect-subtitle">Connect to your desktop app</p>
      {/if}

      <div class="connect-form">
        <input
          type="text"
          bind:value={serverUrl}
          placeholder="ws://192.168.x.x:9001"
        />
        <button onclick={connect}>
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="help">
        <p>Enter the WebSocket URL shown in your desktop app.</p>
        <p>Make sure both devices are on the same WiFi network.</p>
      </div>

      <!-- PWA Install Banner -->
      {#if showInstallBanner}
        <div class="pwa-install-banner">
          <div class="pwa-install-content">
            <img src="{import.meta.env.BASE_URL}logo.png" alt="" class="pwa-install-icon" />
            <div class="pwa-install-text">
              <strong>Install Ghost Arcade</strong>
              <span>Launch fullscreen from your home screen</span>
            </div>
          </div>
          {#if deferredInstallPrompt}
            <button class="pwa-install-btn" onclick={() => {
              deferredInstallPrompt.prompt();
              deferredInstallPrompt.userChoice.then(() => { showInstallBanner = false; });
            }}>Install</button>
          {:else}
            <div class="pwa-install-ios">
              Tap <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2"><path d="M12 5v14M5 12l7-7 7 7"/><rect x="3" y="15" width="18" height="6" rx="2" fill="none"/></svg> then <strong>"Add to Home Screen"</strong>
            </div>
          {/if}
          <button class="pwa-dismiss" onclick={() => showInstallBanner = false}>×</button>
        </div>
      {/if}

      {#if !showInstallBanner && !isPWA}
        <button class="pwa-hint-btn" onclick={() => showInstallBanner = true}>
          📲 Add to Home Screen for fullscreen
        </button>
      {/if}
    </div>
  {:else}
    <!-- Control Interface -->
    <!-- Floating mode switcher — each mode gets the full remaining viewport -->
    <div class="mode-strip" class:over-paint={mobileMode === 'paint'}>
      <div class="mode-switcher">
        <button
          class="mode-pill"
          class:active={mobileMode === 'mapping'}
          onclick={() => mobileMode = 'mapping'}
        >Mapping</button>
        <button
          class="mode-pill"
          class:active={mobileMode === 'vj'}
          onclick={() => mobileMode = 'vj'}
        >VJ</button>
        <button
          class="mode-pill"
          class:active={mobileMode === 'paint'}
          onclick={() => mobileMode = 'paint'}
        >Paint</button>
      </div>
      {#if mobileMode === 'mapping'}
        <button class="media-btn" onclick={() => showMediaLibrary = !showMediaLibrary}>
          {showMediaLibrary ? 'Close' : 'Media'}
        </button>
      {/if}
      <button class="disconnect-btn" onclick={disconnect} title="Disconnect">×</button>
    </div>

    {#if mobileMode === 'vj'}
      <!-- VJ Controller Mode (full-screen) -->
      <MobileVJController
        {vjClipsState}
        onTriggerClip={triggerVJClip}
        onTriggerColumn={triggerVJColumn}
        onStopLayer={stopVJLayer}
        onStopAll={stopAllVJ}
        onSetBlock={setVJBlock}
        onToggleLive={toggleVJLive}
        onSetLayerOpacity={setVJLayerOpacity}
        onSetLayerBlendMode={setVJLayerBlendMode}
        onSetMasterOpacity={setVJMasterOpacity}
        onTriggerClipBank={triggerVJClipBank}
        onTriggerColumnBank={triggerVJColumnBank}
        onStopLayerBank={stopVJLayerBank}
        onSetLayerOpacityBank={setVJLayerOpacityBank}
        onSetLayerBlendModeBank={setVJLayerBlendModeBank}
        onAddLayerEffect={addVJLayerEffect}
        onRemoveLayerEffect={removeVJLayerEffect}
        onToggleLayerEffect={toggleVJLayerEffect}
        onUpdateLayerEffectParams={updateVJLayerEffectParams}
        onAddCompEffect={addVJCompEffect}
        onRemoveCompEffect={removeVJCompEffect}
        onToggleCompEffect={toggleVJCompEffect}
        onUpdateCompEffectParams={updateVJCompEffectParams}
        onAddClipEffect={addVJClipEffect}
        onRemoveClipEffect={removeVJClipEffect}
        onToggleClipEffect={toggleVJClipEffect}
        onUpdateClipEffectParams={updateVJClipEffectParams}
        onUpdateShaderValue={updateVJShaderValue}
        compositionEffects={vjClipsState?.compositionEffects || []}
        onCrossfaderChange={setVJCrossfaderValue}
        onCrossfaderToggle={setVJCrossfaderEnabled}
        onCrossfaderTransition={setVJCrossfaderTransition}
        onCrossfaderCurve={setVJCrossfaderCurve}
        onCrossfaderBlendMode={setVJCrossfaderBlendMode}
        onCutA={vjCutToA}
        onCutB={vjCutToB}
        onMacroValueChange={setVJMacroValue}
        onSnapshotRecall={recallVJSnapshot}
        onSnapshotSave={saveVJSnapshot}
        onTapTempo={vjTapTempo}
        onClearManualBPM={vjClearManualBPM}
        onQuantizationChange={setVJQuantization}
        onClearPendingTriggers={clearVJPendingTriggers}
        {beatPulseCount}
        {beatPulseIntensity}
      />
    {:else if mobileMode === 'mapping'}
    <!-- View Mode Toggle - Always visible -->
    {#if selectedLayer}
      <div class="view-mode-toggle">
        <button
          class:active={viewMode === 'corners'}
          onclick={() => setViewMode('corners')}
        >
          Corners
        </button>
        <button
          class:active={viewMode === 'mesh'}
          onclick={() => setViewMode('mesh')}
        >
          Mesh Grid
        </button>
      </div>
    {/if}

    <!-- Mesh Grid Preset (visible in mesh mode) - matches desktop presets -->
    {#if selectedLayer && viewMode === 'mesh'}
      <div class="mesh-controls">
        <span class="mesh-preset-label">Grid</span>
        <select
          class="mesh-preset-select"
          value="{meshRows}x{meshCols}"
          onchange={(e) => {
            const [rows, cols] = (e.target as HTMLSelectElement).value.split('x').map(Number);
            meshRows = rows;
            meshCols = cols;
            handleMeshSizeChange();
          }}
        >
          <option value="2x2">2×2</option>
          <option value="3x3">3×3</option>
          <option value="4x4">4×4</option>
          <option value="5x5">5×5</option>
          <option value="6x6">6×6</option>
          <option value="8x8">8×8</option>
          <option value="10x10">10×10</option>
          <option value="12x12">12×12</option>
        </select>
      </div>
    {/if}

    <!-- Warp Control Area with integrated navigation -->
    <div
      class="warp-viewport"
      bind:this={viewportEl}
      use:mountViewportGestures
    >
      <!-- Canvas boundary outline -->
      <div
        class="canvas-boundary"
        style="
          left: {drawOffsetX}px;
          top: {drawOffsetY}px;
          width: {drawWidth}px;
          height: {drawHeight}px;
          transform: translate({viewportPanX}px, {viewportPanY}px) scale({viewportScale});
          transform-origin: {drawWidth / 2}px {drawHeight / 2}px;
        "
      ></div>

      {#if selectedLayer && handlePositions}
        <!-- Transformable content container - same transform origin as canvas (center of draw area) -->
        <div
          class="viewport-content"
          style="transform: translate({viewportPanX}px, {viewportPanY}px) scale({viewportScale}); transform-origin: {drawOffsetX + drawWidth / 2}px {drawOffsetY + drawHeight / 2}px;"
        >
        <!-- Corner mode: show corner edges and handles -->
        {#if viewMode === 'corners' || !hasMeshWarp}
          <!-- Edge lines connecting corner handles -->
          <svg class="lines-svg" style="overflow: visible;">
            {#each lines as line}
              <line
                x1={line.from.x}
                y1={line.from.y}
                x2={line.to.x}
                y2={line.to.y}
                stroke="#67E8F9"
                stroke-width="2"
              />
            {/each}
          </svg>

          <!-- Corner touch handles -->
          {#each Object.entries(handlePositions) as [corner, pos]}
            <div
              class="touch-handle"
              class:active={draggingCorner === corner}
              style="left: {pos.x}px; top: {pos.y}px; transform: scale({1 / viewportScale});"
              ontouchstart={(e) => handleTouchStart(corner as keyof WarpCorners, e)}
            >
              <span class="handle-label">{corner.replace(/([A-Z])/g, ' $1')}</span>
            </div>
          {/each}
        {:else}
          <!-- Mesh mode: show full grid -->
          <svg class="lines-svg" style="overflow: visible;">
            <!-- Mesh grid lines -->
            {#each meshLines as line}
              <line
                x1={line.from.x}
                y1={line.from.y}
                x2={line.to.x}
                y2={line.to.y}
                stroke="#00aaff"
                stroke-width="1"
                opacity="0.6"
              />
            {/each}
          </svg>

          <!-- Mesh point handles -->
          {#each meshPoints as point}
            <div
              class="mesh-handle"
              class:corner={point.isCorner}
              class:active={draggingMeshPoint?.row === point.row && draggingMeshPoint?.col === point.col}
              style="left: {point.x}px; top: {point.y}px; transform: scale({1 / viewportScale});"
              ontouchstart={(e) => handleMeshTouchStart(point.row, point.col, e)}
            ></div>
          {/each}
        {/if}
        </div><!-- end viewport-content -->
      {:else}
        <div class="no-layer">
          <p>Select a layer to control</p>
        </div>
      {/if}

      <!-- Zoom/pan indicator overlay (touch gestures: pinch to zoom, two-finger pan) -->
      {#if viewportScale !== 1 || viewportPanX !== 0 || viewportPanY !== 0}
        <div class="viewport-gesture-overlay">
          <span class="gesture-zoom-label">{viewportScale.toFixed(1)}x</span>
          <button class="gesture-reset-btn" onclick={resetViewportTransform}>Reset</button>
        </div>
      {/if}
      <div class="viewport-gesture-hint">
        <span>Pinch to zoom &bull; Two fingers to pan</span>
      </div>
    </div>

    <!-- Layer Selector -->
    <div class="layer-selector">
      <h3>Layers</h3>
      <div class="layer-list">
        {#if projectState?.layers.length}
          {#each projectState.layers as layer}
            <button
              class="layer-btn"
              class:selected={selectedLayerId === layer.id}
              class:hidden={!layer.visible}
              onclick={() => selectLayer(layer.id)}
            >
              {layer.name}
            </button>
          {/each}
        {:else}
          <p class="no-layers">No layers in project</p>
        {/if}
      </div>
    </div>

    <!-- Quick Controls -->
    {#if selectedLayer}
      <div class="quick-controls">
        <div class="control-row">
          <span>Opacity</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={selectedLayer.opacity}
            oninput={(e) => {
              const val = parseFloat((e.target as HTMLInputElement).value);
              sendParameter(selectedLayer.id, 'opacity', val);
            }}
          />
          <span>{Math.round(selectedLayer.opacity * 100)}%</span>
        </div>

        <div class="control-row">
          <span>Blend</span>
          <select
            value={selectedLayer.blendMode}
            onchange={(e) => {
              sendParameter(selectedLayer.id, 'blendMode', (e.target as HTMLSelectElement).value);
            }}
          >
            {#each blendModes as mode}
              <option value={mode}>{mode}</option>
            {/each}
          </select>
        </div>

        <button
          class="visibility-btn"
          class:hidden={!selectedLayer.visible}
          onclick={() => sendParameter(selectedLayer.id, 'visible', !selectedLayer.visible)}
        >
          {selectedLayer.visible ? 'Hide Layer' : 'Show Layer'}
        </button>
      </div>
    {/if}

    <!-- Media Library Slideout -->
    {#if showMediaLibrary}
      <div class="media-library-overlay" onclick={() => showMediaLibrary = false}></div>
      <div class="media-library-slideout">
        <div class="media-library-header">
          <h3>Media & Clips</h3>
          <button onclick={() => showMediaLibrary = false}>Close</button>
        </div>

        <!-- Tab Navigation -->
        <div class="media-tabs">
          <button class:active={mediaTab === 'vj'} onclick={() => mediaTab = 'vj'}>
            VJ Clips
          </button>
          <button class:active={mediaTab === 'presets'} onclick={() => mediaTab = 'presets'}>
            Presets
          </button>
          <button class:active={mediaTab === 'shaders'} onclick={() => mediaTab = 'shaders'}>
            Shaders
          </button>
          <button class:active={mediaTab === 'media'} onclick={() => mediaTab = 'media'}>
            Media
          </button>
        </div>

        <div class="media-library-content">
          <!-- VJ Clips Tab -->
          {#if mediaTab === 'vj'}
            {#if vjClipsState && activeVJBlock}
              <!-- VJ Live Toggle -->
              <div class="vj-controls">
                <button
                  class="vj-live-btn"
                  class:active={vjClipsState.isLive}
                  onclick={toggleVJLive}
                >
                  {vjClipsState.isLive ? 'LIVE' : 'GO LIVE'}
                </button>
                <button
                  class="vj-mixer-btn"
                  class:active={showVJMixer}
                  onclick={() => showVJMixer = !showVJMixer}
                >
                  Mixer
                </button>
                <button class="vj-stop-btn" onclick={stopAllVJ}>
                  Stop All
                </button>
              </div>

              <!-- VJ Layer Mixer Panel -->
              {#if showVJMixer}
                <div class="vj-mixer-panel">
                  <div class="mixer-header">
                    <span>Layer Mixer</span>
                  </div>
                  {#each vjClipsState.layerStates as layerState, layerIndex}
                    <div class="mixer-layer" class:active={layerState.activeColumn !== null}>
                      <div class="mixer-layer-header">
                        <span class="mixer-layer-num">{layerIndex + 1}</span>
                        <span class="mixer-layer-clip">{layerState.activeClip?.name || '—'}</span>
                        <button
                          class="mixer-fx-btn"
                          class:has-effects={(layerState.effects?.length || 0) > 0}
                          onclick={() => openEffectsPanel(layerIndex)}
                          title="Layer effects"
                        >
                          FX {#if (layerState.effects?.length || 0) > 0}<span class="fx-count">{layerState.effects.length}</span>{/if}
                        </button>
                        <button
                          class="mixer-stop-btn"
                          onclick={() => stopVJLayer(layerIndex)}
                        >
                          ×
                        </button>
                      </div>
                      <div class="mixer-controls">
                        <div class="mixer-slider-row">
                          <span class="mixer-label">Opacity</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={layerState.opacity}
                            oninput={(e) => setVJLayerOpacity(layerIndex, parseFloat(e.currentTarget.value))}
                            class="mixer-slider"
                          />
                          <span class="mixer-value">{Math.round(layerState.opacity * 100)}%</span>
                        </div>
                        <div class="mixer-blend-row">
                          <span class="mixer-label">Blend</span>
                          <select
                            value={layerState.blendMode}
                            onchange={(e) => setVJLayerBlendMode(layerIndex, e.currentTarget.value)}
                            class="mixer-select"
                          >
                            {#each vjBlendModes as mode}
                              <option value={mode}>{mode}</option>
                            {/each}
                          </select>
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}

              <!-- Block Selector -->
              {#if vjClipsState.blocks.length > 1}
                <div class="block-selector">
                  {#each vjClipsState.blocks as block}
                    <button
                      class:active={block.id === vjClipsState.activeBlockId}
                      onclick={() => setVJBlock(block.id)}
                    >
                      {block.name}
                    </button>
                  {/each}
                </div>
              {/if}

              <!-- VJ Clip Grid -->
              <div class="vj-grid">
                {#each activeVJBlock.clipGrid as row, layerIndex}
                  <div class="vj-row">
                    <div class="vj-layer-controls">
                      <span class="layer-num">{layerIndex + 1}</span>
                      <button
                        class="layer-stop-btn"
                        onclick={() => stopVJLayer(layerIndex)}
                        title="Stop layer"
                      >
                        X
                      </button>
                    </div>
                    {#each row as clip, columnIndex}
                      <button
                        class="vj-clip"
                        class:empty={!clip}
                        class:active={vjClipsState.layerStates[layerIndex]?.activeColumn === columnIndex}
                        onclick={() => clip && triggerVJClip(layerIndex, columnIndex)}
                        disabled={!clip}
                      >
                        {#if clip}
                          {#if clip.thumbnail}
                            <img src={clip.thumbnail} alt={clip.name} class="clip-thumb" />
                          {:else}
                            <span class="clip-type">{clip.type.charAt(0).toUpperCase()}</span>
                          {/if}
                          <span class="clip-name">{clip.name}</span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                {/each}
              </div>

              <!-- Column Triggers -->
              <div class="column-triggers">
                <div class="col-spacer"></div>
                {#each Array(activeVJBlock.clipGrid[0]?.length || 8) as _, colIdx}
                  <button
                    class="col-trigger"
                    onclick={() => triggerVJColumn(colIdx)}
                    title="Trigger column {colIdx + 1}"
                  >
                    {colIdx + 1}
                  </button>
                {/each}
              </div>
            {:else}
              <p class="empty-hint">No VJ clips in project. Add clips to the VJ Clip Launcher on desktop.</p>
            {/if}

          <!-- Presets/Compositions Tab -->
          {:else if mediaTab === 'presets'}
            {#if compositions.length > 0}
              <div class="media-section">
                <h4>Saved Presets ({compositions.length})</h4>
                <div class="presets-grid">
                  {#each compositions as comp}
                    <button
                      class="preset-item"
                      onclick={() => loadComposition(comp.id)}
                    >
                      {#if comp.thumbnail}
                        <img src={comp.thumbnail} alt={comp.name} class="preset-thumb" />
                      {:else}
                        <div class="preset-placeholder">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <path d="M3 9h18"/>
                            <path d="M9 21V9"/>
                          </svg>
                        </div>
                      {/if}
                      <span class="preset-name">{comp.name}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {:else}
              <p class="empty-hint">No presets saved. Create presets in VJ Mode on desktop.</p>
            {/if}

          <!-- Shaders Tab -->
          {:else if mediaTab === 'shaders'}
            {#if !selectedLayerId}
              <p class="hint">Select a layer first to trigger shaders</p>
            {:else}
              <div class="media-section">
                <h4>Shaders {shadersLoading ? '(loading...)' : `(${shaders.length})`}</h4>
                <div class="shader-thumb-grid scrollable">
                  {#each shaders as shader}
                    <button
                      class="shader-thumb-item"
                      onclick={() => triggerMedia('shader', shader.src, shader.name)}
                    >
                      {#if shader.thumbnail}
                        <img src={shader.thumbnail} alt={shader.name} class="shader-thumb-img" loading="lazy" />
                      {:else}
                        <div class="shader-thumb-fallback">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/>
                            <line x1="12" y1="22" x2="12" y2="15.5"/>
                            <polyline points="22,8.5 12,15.5 2,8.5"/>
                          </svg>
                        </div>
                      {/if}
                      <span class="shader-thumb-name">{shader.name}</span>
                    </button>
                  {/each}
                  {#if shaders.length === 0 && !shadersLoading}
                    <p class="empty-hint">No shaders loaded</p>
                  {/if}
                </div>
              </div>

              <!-- Built-in Three.js Sources -->
              <div class="media-section">
                <h4>Three.js Visuals</h4>
                <div class="media-grid">
                  {#each threejsSources as source}
                    <button
                      class="media-item"
                      onclick={() => triggerMedia('threejs', source.src, source.name)}
                    >
                      <div class="media-icon threejs">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
                          <path d="M12 22V12"/>
                          <path d="M22 7l-10 5-10-5"/>
                        </svg>
                      </div>
                      <span>{source.name}</span>
                    </button>
                  {/each}
                </div>
              </div>

              <!-- Current Layer Info -->
              <div class="media-section">
                <h4>Target Layer</h4>
                <p class="layer-target">{selectedLayer?.name || 'Unknown'}</p>
              </div>
            {/if}

          <!-- Media Tab -->
          {:else if mediaTab === 'media'}
            {#if !selectedLayerId}
              <p class="hint">Select a layer first to trigger media</p>
            {:else}
              {#if libraryItems.length > 0}
                <div class="media-section">
                  <h4>Media Library ({libraryItems.length})</h4>
                  <div class="media-list scrollable">
                    {#each libraryItems as item}
                      <button
                        class="media-list-item"
                        onclick={() => triggerMedia(item.type, item.src, item.name)}
                      >
                        <div class="media-type-icon {item.type}">
                          {#if item.type === 'image'}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <rect x="3" y="3" width="18" height="18" rx="2"/>
                              <circle cx="8.5" cy="8.5" r="1.5"/>
                              <path d="M21 15l-5-5L5 21"/>
                            </svg>
                          {:else}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <rect x="2" y="4" width="20" height="16" rx="2"/>
                              <path d="M10 9l5 3-5 3V9z"/>
                            </svg>
                          {/if}
                        </div>
                        <span class="media-name">{item.name}</span>
                        <span class="media-type-label">{item.type}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {:else}
                <p class="empty-hint">No media in library. Add videos/images on desktop.</p>
              {/if}
            {/if}
          {/if}
        </div>
      </div>
    {/if}

    <!-- Effects Panel Slideout -->
    {#if showEffectsPanel && effectsLayerIndex !== null}
      <div class="effects-overlay" onclick={closeEffectsPanel}></div>
      <div class="effects-slideout">
        <div class="effects-header">
          <h3>Layer {effectsLayerIndex + 1} Effects</h3>
          <button class="effects-close-btn" onclick={closeEffectsPanel}>Done</button>
        </div>

        <div class="effects-content">
          <!-- Current Effects List -->
          {#if currentLayerEffects.length > 0}
            <div class="effects-list">
              {#each currentLayerEffects as effect (effect.id)}
                <div class="effect-item" class:disabled={!effect.enabled}>
                  <div class="effect-item-header" onclick={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}>
                    <button
                      class="effect-toggle"
                      class:enabled={effect.enabled}
                      onclick={(e) => { e.stopPropagation(); toggleVJLayerEffect(effectsLayerIndex!, effect.id); }}
                    >
                      {effect.enabled ? '●' : '○'}
                    </button>
                    <span class="effect-name">{effect.type}</span>
                    <span class="effect-expand">{expandedEffectId === effect.id ? '▲' : '▼'}</span>
                    <button
                      class="effect-remove"
                      onclick={(e) => { e.stopPropagation(); removeVJLayerEffect(effectsLayerIndex!, effect.id); }}
                    >
                      ×
                    </button>
                  </div>

                  {#if expandedEffectId === effect.id}
                    <div class="effect-params">
                      {#each (effectParamDefs[effect.type] || []) as paramDef}
                        <div class="effect-param-row">
                          <span class="param-name">{paramDef.name}</span>
                          {#if paramDef.type === 'select' && paramDef.options}
                            <select value={(effect.params as Record<string, number>)[paramDef.param as string] ?? paramDef.default}
                              oninput={(e) => {
                                const val = parseFloat((e.target as HTMLSelectElement).value);
                                updateVJLayerEffectParams(effectsLayerIndex!, effect.id, { [paramDef.param]: val });
                              }}
                              style="flex:1; background:#222; color:#fff; border:1px solid #444; border-radius:3px; padding:4px; font-size:12px;">
                              {#each paramDef.options as opt}
                                <option value={opt.value}>{opt.label}</option>
                              {/each}
                            </select>
                          {:else if paramDef.type === 'color' && paramDef.colorParams}
                            {@const cr = (effect.params as Record<string, number>)[paramDef.colorParams.r] ?? 0}
                            {@const cg = (effect.params as Record<string, number>)[paramDef.colorParams.g] ?? 1}
                            {@const cb = (effect.params as Record<string, number>)[paramDef.colorParams.b] ?? 0.4}
                            {@const hexVal = '#' + [cr,cg,cb].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}
                            <input type="color" value={hexVal}
                              oninput={(e) => {
                                const hex = (e.target as HTMLInputElement).value;
                                const r = parseInt(hex.slice(1,3), 16) / 255;
                                const g = parseInt(hex.slice(3,5), 16) / 255;
                                const b = parseInt(hex.slice(5,7), 16) / 255;
                                if (paramDef.colorParams) {
                                  updateVJLayerEffectParams(effectsLayerIndex!, effect.id, {
                                    [paramDef.colorParams.r]: r,
                                    [paramDef.colorParams.g]: g,
                                    [paramDef.colorParams.b]: b,
                                  });
                                }
                              }}
                              style="flex:0 0 44px; height:28px; padding:0; border:1px solid #444; border-radius:3px; cursor:pointer;" />
                          {:else}
                            <input
                              type="range"
                              min={paramDef.min}
                              max={paramDef.max}
                              step={paramDef.step}
                              value={(effect.params as Record<string, number>)[paramDef.param as string] ?? paramDef.default}
                              oninput={(e) => {
                                const val = parseFloat(e.currentTarget.value);
                                updateVJLayerEffectParams(effectsLayerIndex!, effect.id, { [paramDef.param]: val });
                              }}
                              class="effect-slider"
                            />
                            <span class="param-value">
                              {((effect.params as Record<string, number>)[paramDef.param as string] ?? paramDef.default).toFixed(paramDef.step < 0.1 ? 2 : paramDef.step < 1 ? 1 : 0)}
                            </span>
                          {/if}
                        </div>
                      {/each}
                      {#if (effectParamDefs[effect.type] || []).length === 0}
                        <p class="no-params">No adjustable parameters</p>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <p class="no-effects">No effects on this layer</p>
          {/if}

          <!-- Add Effect Section -->
          <div class="add-effect-section">
            <h4>Add Effect</h4>
            <div class="effect-categories">
              {#each effectCategories as category}
                <div class="effect-category">
                  <span class="category-name">{category.name}</span>
                  <div class="category-effects">
                    {#each category.effects as effectDef}
                      <button
                        class="add-effect-btn"
                        onclick={() => addVJLayerEffect(effectsLayerIndex!, effectDef.type)}
                      >
                        <span class="effect-icon">{effectDef.icon}</span>
                        <span class="effect-btn-name">{effectDef.name}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}
    {:else if mobileMode === 'paint'}
      <!-- Light Painting — full-screen drawing surface w/ Apple Pencil hover crosshair -->
      <div class="paint-mode">
        <!-- Floating controls at top (overlay the canvas; don't steal vertical space) -->
        <div class="paint-floating-controls">
          <select class="paint-layer-select" bind:value={paintLayerId}>
            <option value={null}>Select Layer…</option>
            {#each (projectState?.layers || []).filter(l => l.type === 'lightpainting') as layer}
              <option value={layer.id}>{layer.name}</option>
            {/each}
          </select>
          <button
            class="paint-brush-chip"
            onclick={() => showBrushPanel = !showBrushPanel}
            title="Brush settings"
          >
            <span
              class="paint-brush-swatch"
              style="background: rgb({Math.round(paintBrush.color[0])},{Math.round(paintBrush.color[1])},{Math.round(paintBrush.color[2])})"
            ></span>
            <span class="paint-brush-name">{paintBrush.type}</span>
            <span class="paint-brush-size">{paintBrush.size}px</span>
          </button>
        </div>

        <!-- Drawing surface — full screen; canvas is letterboxed to project aspect. -->
        <div
          class="paint-surface"
          class:painting={isPainting}
          bind:this={paintSurfaceEl}
          onpointerdown={handlePaintPointer}
          onpointermove={handlePaintPointer}
          onpointerenter={handlePaintPointer}
          onpointerover={handlePaintPointer}
          onpointerup={handlePaintPointerUp}
          onpointerleave={handlePaintPointerLeave}
          onpointercancel={handlePaintPointerUp}
        >
          {#if !paintLayerId}
            <div class="paint-empty">
              <p>Select a light painting layer above to start drawing.</p>
              <p class="hint">Create one on the desktop if you don't have any.</p>
            </div>
          {:else}
            <!-- Mirror canvas: positioned via style to match project aspect ratio (letterboxed). -->
            <canvas
              class="paint-mirror"
              bind:this={paintCanvasEl}
              style="width: {canvasDisplay.w}px; height: {canvasDisplay.h}px; left: {canvasDisplay.x}px; top: {canvasDisplay.y}px;"
            ></canvas>
            <!-- Live SVG stroke preview: shows a smooth line as you draw, matches desktop. -->
            {#if isPainting && livePreviewSvgPath}
              <svg
                class="paint-live-svg"
                style="width: {canvasDisplay.w}px; height: {canvasDisplay.h}px; left: {canvasDisplay.x}px; top: {canvasDisplay.y}px;"
                viewBox="0 0 {canvasDisplay.w} {canvasDisplay.h}"
              >
                <path d={livePreviewSvgPath} fill="none"
                  stroke="rgba({paintBrush.color[0]},{paintBrush.color[1]},{paintBrush.color[2]},{paintBrush.opacity * 0.3})"
                  stroke-width={paintBrush.size * 1.5} stroke-linecap="round" stroke-linejoin="round"
                  filter="url(#lp-mobile-glow)" />
                <path d={livePreviewSvgPath} fill="none"
                  stroke="rgba({paintBrush.color[0]},{paintBrush.color[1]},{paintBrush.color[2]},{paintBrush.opacity * 0.8})"
                  stroke-width={Math.max(2, paintBrush.size * 0.4)} stroke-linecap="round" stroke-linejoin="round" />
                <path d={livePreviewSvgPath} fill="none"
                  stroke="rgba(255,255,255,{paintBrush.opacity * 0.6})"
                  stroke-width={Math.max(1, paintBrush.size * 0.15)} stroke-linecap="round" stroke-linejoin="round" />
                <defs>
                  <filter id="lp-mobile-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation={paintBrush.glow * 6} result="blur"/>
                    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                </defs>
              </svg>
            {/if}
            <!-- Pencil hover crosshair -->
            {#if cursorX >= 0 && cursorY >= 0}
              <div
                class="paint-crosshair"
                class:drawing={isPainting}
                style="left: {cursorX}px; top: {cursorY}px; width: {paintBrush.size}px; height: {paintBrush.size}px;"
              ></div>
            {/if}
            <div class="paint-status">
              {#if isPainting}
                <span class="paint-active">● Drawing</span>
              {:else if cursorX < 0}
                <span>Apple Pencil: hover or touch to draw</span>
              {:else}
                <span>Ready</span>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Slide-up brush settings panel -->
        {#if showBrushPanel}
          <div class="paint-sheet-backdrop" onclick={() => showBrushPanel = false}></div>
          <div class="paint-sheet" onclick={(e) => e.stopPropagation()}>
            <div class="paint-sheet-handle" onclick={() => showBrushPanel = false}></div>
            <div class="paint-sheet-title">Brush</div>

            <!-- Brush type pills -->
            <div class="brush-types">
              {#each brushTypes as bt}
                <button
                  class="brush-pill"
                  class:active={paintBrush.type === bt}
                  onclick={() => paintBrush = { ...paintBrush, type: bt }}
                >{bt}</button>
              {/each}
            </div>

            <div class="paint-sheet-section-title">Color</div>
            <div class="color-swatches">
              {#each colorPresets as c}
                <button
                  class="color-swatch"
                  class:active={paintBrush.color[0] === c[0] && paintBrush.color[1] === c[1] && paintBrush.color[2] === c[2]}
                  style="background: rgb({Math.round(c[0])},{Math.round(c[1])},{Math.round(c[2])})"
                  onclick={() => paintBrush = { ...paintBrush, color: [...c] }}
                ></button>
              {/each}
            </div>

            <div class="paint-sliders">
              <div class="paint-slider-row">
                <span class="slider-label">Size</span>
                <input type="range" min="1" max="80" step="1" bind:value={paintBrush.size} />
                <span class="slider-val">{paintBrush.size}</span>
              </div>
              <div class="paint-slider-row">
                <span class="slider-label">Glow</span>
                <input type="range" min="0" max="5" step="0.1" bind:value={paintBrush.glow} />
                <span class="slider-val">{paintBrush.glow.toFixed(1)}</span>
              </div>
              <div class="paint-slider-row">
                <span class="slider-label">Opacity</span>
                <input type="range" min="0" max="1" step="0.01" bind:value={paintBrush.opacity} />
                <span class="slider-val">{Math.round(paintBrush.opacity * 100)}%</span>
              </div>
              <div class="paint-slider-row">
                <span class="slider-label">Softness</span>
                <input type="range" min="0" max="1" step="0.01" bind:value={paintBrush.softness} />
                <span class="slider-val">{Math.round(paintBrush.softness * 100)}%</span>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

  {/if}
</div>

<style>
  .mobile-app {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: #0d0d10;
    color: #eee;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    touch-action: none;
  }

  /* Connection Screen */
  .connect-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    touch-action: manipulation;
    gap: 4px;
  }

  .connect-logo {
    width: 140px;
    height: auto;
    margin-bottom: 12px;
    filter: drop-shadow(0 0 16px rgba(187, 134, 252, 0.3));
  }

  .connect-subtitle {
    color: #888;
    margin-bottom: 16px;
    font-size: 14px;
  }

  .connect-screen p {
    color: #888;
  }

  .connecting-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }

  .connecting-indicator p {
    color: #BB86FC;
    font-size: 14px;
    margin: 0;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(187, 134, 252, 0.2);
    border-top: 3px solid #BB86FC;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .connect-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 300px;
    touch-action: manipulation;
  }

  .connect-form input {
    padding: 14px;
    font-size: 16px;
    background: #333;
    border: 1px solid #444;
    border-radius: 8px;
    color: #eee;
    text-align: center;
    touch-action: manipulation;
  }

  .connect-form button {
    padding: 14px;
    font-size: 16px;
    background: #BB86FC;
    color: #000;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }

  .connect-form button:disabled {
    background: #7c5db8;
    opacity: 0.7;
    cursor: wait;
  }

  .error {
    color: #ff4444;
    margin-top: 16px;
  }

  .help {
    margin-top: 32px;
    text-align: center;
    color: #666;
    font-size: 14px;
  }

  /* ── PWA Install Banner ── */
  .pwa-install-banner {
    position: relative;
    margin-top: 24px;
    padding: 14px 16px;
    background: rgba(187, 134, 252, 0.08);
    border: 1px solid rgba(187, 134, 252, 0.25);
    border-radius: 12px;
    width: 100%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: slideUp 0.3s ease-out;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .pwa-install-content {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .pwa-install-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
  }

  .pwa-install-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pwa-install-text strong {
    font-size: 13px;
    color: #eee;
  }

  .pwa-install-text span {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
  }

  .pwa-install-btn {
    padding: 10px;
    background: #BB86FC;
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .pwa-install-btn:active { opacity: 0.8; }

  .pwa-install-ios {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-wrap: wrap;
    line-height: 1.5;
  }
  .pwa-install-ios svg {
    vertical-align: middle;
  }
  .pwa-install-ios strong {
    color: #eee;
  }

  .pwa-dismiss {
    position: absolute;
    top: 6px;
    right: 8px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.3);
    font-size: 18px;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
  }

  .pwa-hint-btn {
    margin-top: 20px;
    padding: 10px 18px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .pwa-hint-btn:active {
    background: rgba(255, 255, 255, 0.08);
  }

  /* Header */
  .mobile-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: #111114;
    border-bottom: 1px solid #333;
    gap: 12px;
  }

  /* Floating mode strip — minimal top bar that lets each mode fill the viewport */
  .mode-strip {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    background: #0f0f12;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    gap: 8px;
    flex-shrink: 0;
    z-index: 10;
  }
  /* In paint mode, overlay the strip on top of the full-screen canvas */
  .mode-strip.over-paint {
    position: absolute;
    top: 0; left: 0; right: 0;
    background: rgba(15, 15, 18, 0.55);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .status {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 4px;
    background: #333;
  }

  .status.connected {
    background: #BB86FC33;
    color: #BB86FC;
  }

  /* Mode Switcher */
  .mode-switcher {
    display: flex;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
    flex: 1;
    max-width: 280px;
  }

  .mode-pill {
    flex: 1;
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
    -webkit-tap-highlight-color: transparent;
  }

  .mode-pill.active {
    background: var(--accent-primary, #BB86FC);
    color: #fff;
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent-primary, #BB86FC) 35%, transparent);
    text-shadow: 0 0 8px rgba(0, 0, 0, 0.3);
  }

  .mode-pill:not(.active):active {
    background: rgba(255, 255, 255, 0.1);
  }

  .project-name {
    flex: 1;
    font-weight: 600;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .media-btn {
    background: #444;
    color: #fff;
    border: none;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .disconnect-btn {
    background: #ff4444;
    color: #fff;
    border: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    font-weight: bold;
    cursor: pointer;
  }

  /* Warp Viewport */
  .warp-viewport {
    flex: 1;
    position: relative;
    background: #111;
    min-height: 200px;
    overflow: hidden;
    touch-action: none;
  }

  .canvas-boundary {
    position: absolute;
    border: 2px solid #0066ff;
    box-sizing: border-box;
    pointer-events: none;
    opacity: 0.6;
    z-index: 1;
  }

  .viewport-content {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    overflow: visible;
  }

  .lines-svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .touch-handle {
    position: absolute;
    width: 48px;
    height: 48px;
    margin-left: -24px;
    margin-top: -24px;
    background: #BB86FC;
    border: 3px solid #fff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
    cursor: grab;
  }

  .touch-handle.active {
    background: #ffff00;
    transform: scale(1.2);
  }

  .handle-label {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    white-space: nowrap;
    margin-bottom: 8px;
  }

  .no-layer {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
  }

  /* Layer Selector */
  .layer-selector {
    padding: 12px;
    background: #111114;
    border-top: 1px solid #333;
  }

  .layer-selector h3 {
    font-size: 12px;
    color: #888;
    margin-bottom: 8px;
  }

  .layer-list {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .layer-btn {
    padding: 8px 16px;
    background: #333;
    border: none;
    border-radius: 6px;
    color: #eee;
    font-size: 14px;
    cursor: pointer;
  }

  .layer-btn.selected {
    background: #BB86FC33;
    border: 1px solid #BB86FC;
    color: #BB86FC;
  }

  .layer-btn.hidden {
    opacity: 0.5;
  }

  .no-layers {
    color: #666;
    font-size: 14px;
  }

  /* Quick Controls */
  .quick-controls {
    padding: 12px;
    background: #202020;
    border-top: 1px solid #333;
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .control-row span:first-child {
    width: 60px;
    color: #888;
    font-size: 13px;
  }

  .control-row input[type='range'] {
    flex: 1;
    accent-color: #BB86FC;
  }

  .control-row span:last-child {
    width: 40px;
    text-align: right;
    font-size: 12px;
    color: #888;
  }

  .control-row select {
    flex: 1;
    padding: 8px;
    background: #333;
    color: #eee;
    border: 1px solid #444;
    border-radius: 6px;
    font-size: 14px;
  }

  .visibility-btn {
    width: 100%;
    padding: 12px;
    background: #333;
    border: none;
    border-radius: 6px;
    color: #eee;
    font-size: 14px;
    cursor: pointer;
  }

  .visibility-btn.hidden {
    background: #ff444433;
    color: #ff8888;
  }

  /* View Mode Toggle */
  .view-mode-toggle {
    display: flex;
    justify-content: center;
    padding: 8px;
    gap: 4px;
    background: #111114;
    border-bottom: 1px solid #333;
  }

  .view-mode-toggle button {
    flex: 1;
    max-width: 140px;
    padding: 8px 16px;
    background: #333;
    border: none;
    border-radius: 6px;
    color: #888;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .view-mode-toggle button.active {
    background: #BB86FC33;
    color: #BB86FC;
    border: 1px solid #BB86FC;
  }

  /* Mesh Grid Preset Controls */
  .mesh-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: #0d0d10;
    border-bottom: 1px solid #333;
  }

  .mesh-preset-label {
    font-size: 13px;
    color: #888;
    font-weight: 600;
  }

  .mesh-preset-select {
    background: #222;
    color: #fff;
    border: 1px solid #555;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    min-width: 80px;
    text-align: center;
  }

  .mesh-preset-select:focus {
    border-color: #BB86FC;
    outline: none;
  }

  /* Vertical Zoom Slider (right side) */
  /* Gesture overlay indicator */
  .viewport-gesture-overlay {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 10;
    background: rgba(0, 0, 0, 0.7);
    padding: 4px 10px;
    border-radius: 6px;
  }

  .gesture-zoom-label {
    font-size: 12px;
    color: #BB86FC;
    font-family: monospace;
    font-weight: 600;
  }

  .gesture-reset-btn {
    padding: 3px 8px;
    background: #555;
    border: none;
    border-radius: 4px;
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
  }

  .gesture-reset-btn:active {
    background: #BB86FC;
  }

  .viewport-gesture-hint {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    background: rgba(0, 0, 0, 0.5);
    padding: 3px 10px;
    border-radius: 10px;
    pointer-events: none;
  }

  .viewport-gesture-hint span {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  /* Shader thumbnail grid */
  .shader-thumb-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    padding: 4px;
    max-height: 400px;
    overflow-y: auto;
  }

  .shader-thumb-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 4px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    color: #ccc;
    overflow: hidden;
  }

  .shader-thumb-item:active {
    background: rgba(187, 134, 252, 0.2);
    border-color: #BB86FC;
  }

  .shader-thumb-img {
    width: 100%;
    aspect-ratio: 16/9;
    object-fit: cover;
    border-radius: 4px;
    background: #111;
  }

  .shader-thumb-fallback {
    width: 100%;
    aspect-ratio: 16/9;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    color: #666;
  }

  .shader-thumb-name {
    font-size: 10px;
    color: #aaa;
    text-align: center;
    line-height: 1.2;
    max-height: 2.4em;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }

  /* Mesh handles */
  .mesh-handle {
    position: absolute;
    width: 28px;
    height: 28px;
    margin-left: -14px;
    margin-top: -14px;
    background: #BB86FC;
    border: 2px solid #fff;
    border-radius: 50%;
    touch-action: none;
    cursor: grab;
    transition: transform 0.1s;
  }

  .mesh-handle.corner {
    width: 36px;
    height: 36px;
    margin-left: -18px;
    margin-top: -18px;
    background: #BB86FC;
    border-width: 3px;
  }

  .mesh-handle.active {
    background: #ffff00;
    transform: scale(1.3);
  }

  /* Media Library Slideout */
  .media-library-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
  }

  .media-library-slideout {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 80%;
    max-width: 320px;
    background: #111114;
    z-index: 101;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 20px rgba(0, 0, 0, 0.5);
  }

  .media-library-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #333;
  }

  .media-library-header h3 {
    margin: 0;
    font-size: 16px;
    color: #BB86FC;
  }

  .media-library-header button {
    background: #444;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
  }

  .media-library-content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
  }

  .hint {
    color: #666;
    text-align: center;
    margin-top: 40px;
    font-size: 14px;
  }

  .media-section {
    margin-bottom: 20px;
  }

  .media-section h4 {
    font-size: 12px;
    color: #888;
    margin: 0 0 12px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .media-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .media-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px 12px;
    background: #333;
    border: none;
    border-radius: 8px;
    color: #eee;
    cursor: pointer;
    transition: all 0.15s;
  }

  .media-item:active {
    background: #BB86FC33;
    transform: scale(0.98);
  }

  .media-icon {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #444;
    border-radius: 8px;
  }

  .media-icon.threejs {
    background: linear-gradient(135deg, #4a3a2a, #3a2a1a);
    color: #c0a080;
  }

  .media-item span {
    font-size: 13px;
  }

  .media-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .media-list.scrollable {
    max-height: 200px;
    overflow-y: auto;
  }

  .empty-hint {
    color: #666;
    font-size: 12px;
    text-align: center;
    padding: 12px;
  }

  .media-list-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: #333;
    border: none;
    border-radius: 8px;
    color: #eee;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    width: 100%;
  }

  .media-list-item:active {
    background: #BB86FC33;
    transform: scale(0.98);
  }

  .media-type-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #444;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .media-type-icon.image {
    background: #2a4a3a;
    color: #6fdf8f;
  }

  .media-type-icon.video {
    background: #4a2a3a;
    color: #df6f8f;
  }

  .media-type-icon.shader {
    background: #3a2a4a;
    color: #8f6fdf;
  }

  .media-type-icon.threejs {
    background: #4a3a2a;
    color: #c0a080;
  }

  .media-name {
    flex: 1;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .media-type-label {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .layer-target {
    color: #BB86FC;
    font-size: 14px;
    margin: 0;
    padding: 10px;
    background: #333;
    border-radius: 6px;
    text-align: center;
  }

  /* Media Tabs */
  .media-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 16px;
    border-bottom: 1px solid #333;
    background: #0d0d10;
  }

  .media-tabs button {
    flex: 1;
    padding: 8px 4px;
    background: #333;
    border: none;
    border-radius: 6px;
    color: #888;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .media-tabs button.active {
    background: #BB86FC33;
    color: #BB86FC;
    border: 1px solid #BB86FC;
  }

  /* VJ Controls */
  .vj-controls {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .vj-live-btn {
    flex: 1;
    padding: 12px;
    background: #333;
    border: 2px solid #555;
    border-radius: 8px;
    color: #888;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-live-btn.active {
    background: #ff444433;
    border-color: #ff4444;
    color: #ff4444;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .vj-stop-btn {
    padding: 12px 16px;
    background: #ff444433;
    border: none;
    border-radius: 8px;
    color: #ff8888;
    font-size: 12px;
    cursor: pointer;
  }

  .vj-mixer-btn {
    padding: 12px 16px;
    background: #333;
    border: 2px solid #555;
    border-radius: 8px;
    color: #888;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-mixer-btn.active {
    background: #BB86FC22;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* VJ Mixer Panel */
  .vj-mixer-panel {
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
  }

  .mixer-header {
    padding: 10px 12px;
    background: #111114;
    border-bottom: 1px solid #333;
    font-size: 12px;
    font-weight: 600;
    color: #BB86FC;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .mixer-layer {
    padding: 10px 12px;
    border-bottom: 1px solid #161618;
    transition: background 0.15s;
  }

  .mixer-layer:last-child {
    border-bottom: none;
  }

  .mixer-layer.active {
    background: #BB86FC09;
  }

  .mixer-layer-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .mixer-layer-num {
    width: 20px;
    height: 20px;
    background: #333;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    color: #888;
  }

  .mixer-layer.active .mixer-layer-num {
    background: #BB86FC33;
    color: #BB86FC;
  }

  .mixer-layer-clip {
    flex: 1;
    font-size: 12px;
    color: #aaa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mixer-stop-btn {
    width: 24px;
    height: 24px;
    background: #ff444422;
    border: none;
    border-radius: 4px;
    color: #ff8888;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mixer-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mixer-slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mixer-label {
    width: 50px;
    font-size: 11px;
    color: #666;
    flex-shrink: 0;
  }

  .mixer-slider {
    flex: 1;
    height: 32px;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .mixer-slider::-webkit-slider-runnable-track {
    height: 6px;
    background: #333;
    border-radius: 3px;
  }

  .mixer-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 24px;
    height: 24px;
    background: #BB86FC;
    border-radius: 50%;
    margin-top: -9px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .mixer-slider::-moz-range-track {
    height: 6px;
    background: #333;
    border-radius: 3px;
  }

  .mixer-slider::-moz-range-thumb {
    width: 24px;
    height: 24px;
    background: #BB86FC;
    border-radius: 50%;
    border: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .mixer-value {
    width: 40px;
    text-align: right;
    font-size: 11px;
    color: #BB86FC;
    font-weight: 600;
    flex-shrink: 0;
  }

  .mixer-blend-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mixer-select {
    flex: 1;
    padding: 8px 10px;
    background: #333;
    border: 1px solid #444;
    border-radius: 6px;
    color: #eee;
    font-size: 12px;
    cursor: pointer;
  }

  .mixer-select:focus {
    outline: none;
    border-color: #BB86FC;
  }

  /* Block Selector */
  .block-selector {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .block-selector button {
    padding: 8px 12px;
    background: #333;
    border: none;
    border-radius: 6px;
    color: #888;
    font-size: 12px;
    cursor: pointer;
  }

  .block-selector button.active {
    background: #BB86FC33;
    color: #BB86FC;
    border: 1px solid #BB86FC;
  }

  /* VJ Grid */
  .vj-grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }

  .vj-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .vj-layer-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 40px;
  }

  .layer-num {
    font-size: 10px;
    color: #666;
    width: 16px;
    text-align: center;
  }

  .layer-stop-btn {
    width: 20px;
    height: 20px;
    padding: 0;
    background: #ff444433;
    border: none;
    border-radius: 4px;
    color: #ff8888;
    font-size: 10px;
    font-weight: bold;
    cursor: pointer;
  }

  .vj-clip {
    flex: 1;
    aspect-ratio: 1.5;
    min-width: 0;
    max-height: 48px;
    background: #333;
    border: 2px solid #444;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    overflow: hidden;
    position: relative;
    transition: all 0.1s;
  }

  .vj-clip.empty {
    background: #222;
    border-color: #333;
    cursor: default;
  }

  .vj-clip.active {
    background: #BB86FC33;
    border-color: #BB86FC;
    box-shadow: 0 0 8px #BB86FC66;
  }

  .vj-clip:not(.empty):active {
    transform: scale(0.95);
  }

  .clip-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    position: absolute;
    top: 0;
    left: 0;
  }

  .clip-type {
    font-size: 12px;
    color: #888;
    font-weight: bold;
  }

  .clip-name {
    font-size: 8px;
    color: #aaa;
    position: absolute;
    bottom: 2px;
    left: 2px;
    right: 2px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: rgba(0, 0, 0, 0.7);
    padding: 1px 2px;
    border-radius: 2px;
  }

  /* Column Triggers */
  .column-triggers {
    display: flex;
    gap: 4px;
    padding-top: 4px;
  }

  .col-spacer {
    min-width: 40px;
  }

  .col-trigger {
    flex: 1;
    padding: 6px 0;
    background: #444;
    border: none;
    border-radius: 4px;
    color: #888;
    font-size: 10px;
    cursor: pointer;
  }

  .col-trigger:active {
    background: #BB86FC33;
    color: #BB86FC;
  }

  /* Presets Grid */
  .presets-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .preset-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: #333;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .preset-item:active {
    background: #BB86FC33;
    transform: scale(0.98);
  }

  .preset-thumb {
    width: 100%;
    aspect-ratio: 16/9;
    object-fit: cover;
    border-radius: 4px;
  }

  .preset-placeholder {
    width: 100%;
    aspect-ratio: 16/9;
    background: #444;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
  }

  .preset-name {
    font-size: 12px;
    color: #eee;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }

  /* FX Button in Mixer */
  .mixer-fx-btn {
    padding: 4px 8px;
    background: #333;
    border: 1px solid #555;
    border-radius: 4px;
    color: #888;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s;
  }

  .mixer-fx-btn:hover {
    background: #3a3a3a;
    border-color: #666;
  }

  .mixer-fx-btn.has-effects {
    background: #8b5cf622;
    border-color: #8b5cf6;
    color: #a78bfa;
  }

  .fx-count {
    background: #8b5cf6;
    color: #fff;
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 8px;
    min-width: 14px;
    text-align: center;
  }

  /* Effects Panel Slideout */
  .effects-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 200;
  }

  .effects-slideout {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 90%;
    max-width: 360px;
    background: #0d0d10;
    z-index: 201;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 20px rgba(0, 0, 0, 0.5);
  }

  .effects-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #333;
    background: #111114;
  }

  .effects-header h3 {
    margin: 0;
    font-size: 16px;
    color: #a78bfa;
  }

  .effects-close-btn {
    background: #8b5cf6;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .effects-content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
  }

  /* Effects List */
  .effects-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 20px;
  }

  .effect-item {
    background: #111114;
    border: 1px solid #333;
    border-radius: 8px;
    overflow: hidden;
    transition: opacity 0.15s;
  }

  .effect-item.disabled {
    opacity: 0.5;
  }

  .effect-item-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    cursor: pointer;
  }

  .effect-toggle {
    width: 24px;
    height: 24px;
    background: none;
    border: none;
    color: #666;
    font-size: 16px;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .effect-toggle.enabled {
    color: #8b5cf6;
  }

  .effect-name {
    flex: 1;
    font-size: 14px;
    color: #eee;
    text-transform: capitalize;
  }

  .effect-expand {
    color: #666;
    font-size: 10px;
    padding: 0 8px;
  }

  .effect-remove {
    width: 28px;
    height: 28px;
    background: #ff444422;
    border: none;
    border-radius: 4px;
    color: #ff8888;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .effect-params {
    padding: 12px;
    padding-top: 0;
    border-top: 1px solid #333;
    margin-top: -1px;
  }

  .effect-param-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
  }

  .param-name {
    width: 70px;
    font-size: 12px;
    color: #888;
    flex-shrink: 0;
  }

  .effect-slider {
    flex: 1;
    height: 32px;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .effect-slider::-webkit-slider-runnable-track {
    height: 6px;
    background: #333;
    border-radius: 3px;
  }

  .effect-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 24px;
    height: 24px;
    background: #8b5cf6;
    border-radius: 50%;
    margin-top: -9px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .effect-slider::-moz-range-track {
    height: 6px;
    background: #333;
    border-radius: 3px;
  }

  .effect-slider::-moz-range-thumb {
    width: 24px;
    height: 24px;
    background: #8b5cf6;
    border-radius: 50%;
    border: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .param-value {
    width: 45px;
    text-align: right;
    font-size: 11px;
    color: #a78bfa;
    font-weight: 600;
    flex-shrink: 0;
  }

  .no-params {
    font-size: 12px;
    color: #666;
    text-align: center;
    padding: 8px 0;
    margin: 0;
  }

  .no-effects {
    color: #666;
    text-align: center;
    padding: 24px;
    font-size: 14px;
  }

  /* Add Effect Section */
  .add-effect-section {
    border-top: 1px solid #333;
    padding-top: 16px;
  }

  .add-effect-section h4 {
    font-size: 12px;
    color: #888;
    margin: 0 0 12px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .effect-categories {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .effect-category {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .category-name {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .category-effects {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .add-effect-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: #333;
    border: 1px solid #444;
    border-radius: 6px;
    color: #eee;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .add-effect-btn:active {
    background: #8b5cf633;
    border-color: #8b5cf6;
    transform: scale(0.98);
  }

  .effect-icon {
    font-size: 14px;
  }

  .effect-btn-name {
    font-size: 11px;
  }

  /* ─── Paint Mode (iPad Apple Pencil) ─── */
  .paint-mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  /* Paint mode: mode-strip is absolute overlay; paint-mode fills entire viewport */
  .paint-mode {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
  }
  /* Floating layer select + brush chip — sits just below the mode strip */
  .paint-floating-controls {
    position: absolute;
    top: 44px; /* below mode-strip */
    left: 10px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 5;
    pointer-events: none; /* Child elements opt back in */
  }
  .paint-floating-controls > * { pointer-events: auto; }
  .paint-layer-select {
    flex: 1;
    max-width: 260px;
    background: rgba(22, 22, 24, 0.75);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.1);
    color: #eee;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 13px;
  }
  .paint-brush-chip {
    background: rgba(22, 22, 24, 0.75);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.1);
  }
  .paint-brush-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    color: #ddd;
    font-size: 12px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .paint-brush-chip:hover { background: rgba(255,255,255,0.08); }
  .paint-brush-swatch {
    display: inline-block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.3);
  }
  .paint-brush-name { text-transform: capitalize; }
  .paint-brush-size { color: rgba(255,255,255,0.5); font-size: 10px; }

  /* Full-screen drawing surface — fills the whole paint-mode container,
     letterboxes the drawable to match project aspect ratio. */
  .paint-surface {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: #050508;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    touch-action: none;
    overflow: hidden;
    cursor: crosshair;
    /* Important: disable browser gestures (pinch, scroll) inside the paint surface */
    -webkit-user-select: none;
    user-select: none;
  }

  /* Mirror canvas — inline style sets letterboxed display rect within the surface */
  .paint-mirror {
    position: absolute;
    background: #000;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.05);
  }

  /* SVG live-stroke overlay — smooth line visible while drawing, like desktop */
  .paint-live-svg {
    position: absolute;
    pointer-events: none;
    overflow: visible;
  }

  /* Pencil hover crosshair — circle preview that tracks the Apple Pencil / mouse */
  .paint-crosshair {
    position: absolute;
    transform: translate(-50%, -50%);
    border: 1.5px solid rgba(255,255,255,0.85);
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 8px rgba(255,255,255,0.35);
    pointer-events: none;
    transition: border-color 60ms ease;
    min-width: 4px;
    min-height: 4px;
  }
  .paint-crosshair::before,
  .paint-crosshair::after {
    content: '';
    position: absolute;
    background: rgba(255,255,255,0.85);
    box-shadow: 0 0 2px rgba(0,0,0,0.8);
  }
  .paint-crosshair::before {
    left: 50%; top: -6px; bottom: -6px;
    width: 1px; transform: translateX(-50%);
  }
  .paint-crosshair::after {
    top: 50%; left: -6px; right: -6px;
    height: 1px; transform: translateY(-50%);
  }
  .paint-crosshair.drawing { border-color: #2ED573; }
  .paint-crosshair.drawing::before,
  .paint-crosshair.drawing::after { background: #2ED573; }

  .paint-status {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    pointer-events: none;
    background: rgba(0,0,0,0.4);
    padding: 4px 10px;
    border-radius: 10px;
    backdrop-filter: blur(4px);
  }
  .paint-active { color: #2ED573; font-weight: 600; }

  .paint-empty {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: #555;
    font-size: 14px;
  }
  .paint-empty .hint { font-size: 11px; color: #444; margin-top: 6px; }

  /* ─── Slide-up brush settings sheet ─── */
  .paint-sheet-backdrop {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 10;
    animation: fadeIn 160ms ease;
  }
  .paint-sheet {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    background: #141418;
    border-top: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px 16px 0 0;
    padding: 12px 16px 24px;
    max-height: 60vh;
    overflow-y: auto;
    z-index: 11;
    animation: slideUpSheet 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  .paint-sheet-handle {
    width: 44px;
    height: 4px;
    background: rgba(255,255,255,0.2);
    border-radius: 2px;
    margin: 0 auto 10px;
    cursor: pointer;
  }
  .paint-sheet-title {
    color: #eee;
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .paint-sheet-section-title {
    color: rgba(255,255,255,0.5);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-top: 12px;
    margin-bottom: 6px;
  }
  @keyframes slideUpSheet {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .brush-types {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  .brush-pill {
    padding: 5px 8px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #aaa;
    border-radius: 12px;
    font-size: 10px;
    cursor: pointer;
    text-transform: capitalize;
    -webkit-tap-highlight-color: transparent;
  }
  .brush-pill.active {
    background: rgba(187,134,252,0.15);
    border-color: #BB86FC;
    color: #fff;
  }
  .color-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .color-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .color-swatch.active { border-color: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.3); }
  .paint-sliders { display: flex; flex-direction: column; gap: 6px; }
  .paint-slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .slider-label { width: 48px; font-size: 11px; color: #888; flex-shrink: 0; }
  .paint-slider-row input[type='range'] { flex: 1; }
  .slider-val { width: 36px; font-size: 10px; color: #666; text-align: right; font-family: monospace; }
</style>
